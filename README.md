# Luma Dashboard (self-hosted)

A self-hostable replacement for [dashboard.noscroll.ing](https://dashboard.noscroll.ing), the web
dashboard that configures the [Luma](https://github.com/vandamd/luma) launcher for the Light
Phone III.

- **Backend:** the open-source [Convex backend](https://github.com/get-convex/convex-backend),
  running the functions in [`convex/`](convex). Luma already speaks the Convex protocol, so the
  phone talks to it directly and changes arrive on the phone in real time.
- **Frontend:** a static React app (Vite) served by nginx, modelled on the hosted dashboard.

Luma needs the **Server** setting on its login screen, which is not in upstream Luma yet. Build
Luma from a branch that has it, then enter this server's URL there.

## Running with Docker

Requires Docker with Compose v2 (or Podman). No checkout is needed, only two files:

```sh
mkdir luma-dashboard && cd luma-dashboard
curl -fsSLO https://raw.githubusercontent.com/vbbot/luma-dashboard/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/vbbot/luma-dashboard/main/.env.example
# edit .env and set PUBLIC_URL (see below)
docker compose up -d
```

The dashboard is then at `http://localhost:8080`. On first start the backend generates its
instance secret, stores it in the data volume, and deploys the functions; it does that again on
every start, so updating the image updates the functions.

Everything is served from one URL, `PUBLIC_URL`: the `web` container serves the dashboard and
proxies the Convex API (`/api/…`, including the sync WebSocket) to the backend, which is not
published at all. Enter the same URL under **Server** in Luma, so it must be reachable **from your
phone**, for example `http://192.168.1.20:8080` on a home network. For anything exposed to the
internet, put port 8080 behind an HTTPS reverse proxy (Caddy, Traefik, nginx) with WebSockets
enabled and use `https://…`. Over plain `http` the account number travels unencrypted.

| Service | Port | Purpose |
|---|---|---|
| `backend` | – | Convex backend with the dashboard functions. Internal only. |
| `web` | 8080 | The dashboard, and a proxy to the backend. Phones and browsers connect here. |
| `convex-admin` | 6791 | Optional Convex admin UI: `docker compose --profile admin up -d convex-admin`. Sign in with `PUBLIC_URL` and the key printed by `docker compose exec backend admin-key`. |

Data lives in the `convex-data` volume. To update, `docker compose pull && docker compose up -d`.
Set `IMAGE_TAG` in `.env` to a release such as `0.1.0` to pin a version instead of `latest`.

### Images

| Image | Contents |
|---|---|
| `ghcr.io/vbbot/luma-dashboard-backend` | Convex backend (built from the pinned [release binary](https://github.com/get-convex/convex-backend/releases)) plus `convex/` |
| `ghcr.io/vbbot/luma-dashboard-web` | The built frontend on nginx, proxying `/api/` to `BACKEND_UPSTREAM` (default `backend:3210`). Has no URL baked in, so one image works for any deployment. |
| `ghcr.io/vbbot/luma-dashboard-convex-admin` | Convex's admin UI from the same release |

All are built for `linux/amd64` and `linux/arm64` by
[`.github/workflows/docker.yml`](.github/workflows/docker.yml): pushes to `main` publish
`latest`, and tags like `v0.1.0` publish `0.1.0` and `0.1`.

To build them from a checkout instead:

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## Development

```sh
npm install
npx convex dev        # runs a local backend and redeploys convex/ on save
npm run dev           # in another terminal; http://localhost:5173
```

`npx convex dev` writes `VITE_CONVEX_URL` to `.env.local`, which the frontend picks up. To test
with a real phone, point Luma's Server setting at `http://<your-computer's-LAN-IP>:3210`.

## Accounts

As on the hosted dashboard, an account is just a random 16-digit number, generated in the browser
with `crypto.getRandomValues`. Anyone who knows the number can read and change the account, and
there is no recovery.

## The Luma ⇄ server protocol

This was worked out from the Luma source (`v2` branch). The launcher uses
`dev.convex:android-convexmobile`, so every call is a Convex function call over the Convex sync
WebSocket. **These function names and shapes are what the phone calls and must not change.** All
other functions in `convex/` are used only by the web dashboard.

| Function | Type | Called by (Luma source) | When |
|---|---|---|---|
| `accounts:attemptDeviceLogin` | mutation | `data/ToolSyncManager.kt` | Login screen submit |
| `accounts:getDeviceSync` | query (subscribed) | `data/ToolSyncManager.kt` | While logged in |
| `accounts:syncInstalledApps` | mutation | `helper/ManagedAppManager.kt` | On login, on resume, and about 1.5 s after any app install/remove |
| `lockscreenMessages:getCurrentForDevice` | query (subscribed) | `data/LockscreenMessageManager.kt` | While the lock screen is visible |
| `managedApps:getReleaseVersions` | query | `helper/LumaUpdateManager.kt` | Settings → update check |

### `accounts:attemptDeviceLogin`

```ts
args:    { accountNumber: string /* 16 digits */, installationId: string /* UUID per install */ }
returns: DeviceSync | null      // null → "That account number was not found."
```

Throwing an error shows the error message on the login screen.

### `accounts:getDeviceSync`

```ts
args:    { accountNumber: string }
returns: DeviceSync | null
```

```ts
type DeviceSync = {
  enabledToolIds: string[];      // see Tool IDs; order = home screen order
  enabledAppIds: string[];       // see managed app IDs
  enabledAndroidApps: { label: string; packageName: string; activityName: string }[];
  requestedAppUpdateVersions: Record<string, string>; // appId -> exact version to install
};
```

How the phone applies it:

- **Tools:** unknown IDs are dropped. If they are missing, `phone` is added first and `settings`
  last.
- **Managed apps:** each enabled app that isn't installed gets downloaded from its GitHub releases
  (`latest`, or the requested version, tried as both `v<version>` and `<version>`) and installed.
  An app removed from the list is **uninstalled** from the phone.
- **Version pins:** if `requestedAppUpdateVersions[appId]` is set and differs from the installed
  version, that exact release is installed.
- **Android apps:** these are added to the home screen. The pair (`packageName`, `activityName`)
  must match an installed launcher activity.

### `accounts:syncInstalledApps`

```ts
args: {
  accountNumber: string;
  installationId: string;
  installedManagedApps: { appId: string; versionName: string }[];
  installedAndroidApps: { label: string; packageName: string; activityName: string }[];
}
returns: anything (ignored)
```

`installedAndroidApps` lists launchable apps on the phone, excluding Luma, `com.lightos.*`,
managed apps, and a fixed list of stock AOSP apps. This feeds the dashboard's **Android** picker.

### `lockscreenMessages:getCurrentForDevice`

```ts
args:    { accountNumber: string }
returns: { messageId: string; text: string; expiresAt: number /* epoch ms */ } | null
```

The phone hides the message once `expiresAt` has passed, so the query does not need to check the
current time.

### `managedApps:getReleaseVersions`

```ts
args:    {}
returns: Record<string, string>   // only the "luma" key is read
```

If `luma` is newer than the installed version, Luma offers to download that release from
`github.com/vandamd/luma`. This server returns nothing by default, because an upstream APK signed
with a different key cannot be installed over your own build. Set a version only if you run
upstream-signed builds:

```sh
npx convex run managedApps:setReleaseVersion '{"appId":"luma","versionName":"2.0.18"}'
```

### IDs

Tool IDs (`data/Tool.kt`): `phone`, `settings`, `album`, `alarm`, `calculator`, `directions`,
`directory`, `camera`, `notes`, `calendar`, `timer`, `music`, `podcasts`, `hotspot`.

Managed app IDs (`data/ManagedApp.kt`, all from `github.com/vandamd/<id>`): `buses`, `passes`,
`weather`, `zero`, `echo`, `reverb`.

Both lists are hard-coded in Luma and mirrored in [`convex/catalog.ts`](convex/catalog.ts). If Luma
adds new ones, update that file.

## Not implemented

The hosted dashboard's **API keys** screen is not reproduced: nothing in the Luma source reads API
keys, so what it stores could not be worked out. The hosted login's Cloudflare Turnstile check is
also left out.
