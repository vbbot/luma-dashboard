# Luma Dashboard (self-hosted)

A self-hostable replacement for [dashboard.noscroll.ing](https://dashboard.noscroll.ing), the web
dashboard that configures the [Luma](https://github.com/vandamd/luma) launcher for the Light
Phone III.

- **Backend:** the open-source [Convex backend](https://github.com/get-convex/convex-backend),
  running the functions in [`convex/`](convex). Luma already speaks the Convex protocol, so the
  phone talks to it directly and changes arrive on the phone in real time.
- **Frontend:** a static React app (Vite) served by nginx, modelled on the hosted dashboard.

Luma needs the **Server** setting on its login screen, which is not in upstream Luma yet. Build
Luma from a branch that has it, then enter this server's backend URL there.

## Running with Docker

Requires Docker with Compose v2.

```sh
cp .env.example .env     # then set PUBLIC_BACKEND_URL (see below)
./setup.sh
```

`setup.sh` generates `INSTANCE_SECRET` and `CONVEX_ADMIN_KEY` in `.env`, starts the backend,
deploys the functions, and starts the web dashboard on `http://localhost:8080`.

`PUBLIC_BACKEND_URL` must be reachable **from your phone**, since it is the URL you type into
Luma, for example `http://192.168.1.20:3210` on a home network. For anything exposed to the
internet, put the backend behind an HTTPS reverse proxy (Caddy, Traefik, nginx) that forwards
WebSockets to port 3210, and use `https://…`. Over plain `http` the account number travels
unencrypted.

| Service | Port | Purpose |
|---|---|---|
| `backend` | 3210 | Convex backend. Phones and browsers connect here. |
| `deploy` | – | One-shot job that pushes `convex/` to the backend on every `up`. |
| `web` | 8080 | The dashboard. |
| `convex-dashboard` | 6791 | Optional Convex admin UI: `docker compose --profile admin up -d convex-dashboard`. Log in with `CONVEX_ADMIN_KEY`. |

Data lives in the `convex-data` volume. To update, `git pull && docker compose up -d --build`.

The `web` image has no backend URL baked in. It reads `CONVEX_URL` when the container starts, so
the same image can be published and reused for any deployment.

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
