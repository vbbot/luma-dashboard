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
# edit .env: set PUBLIC_URL and INSTANCE_SECRET (see below)
docker compose up -d
```

Two settings in `.env` are required, and Compose refuses to start without them:

- `PUBLIC_URL`: the address of the dashboard. Enter the same URL under **Server** in Luma, so it
  must be reachable from your phone, e.g. `https://luma.example.com`, or
  `http://192.168.1.20:8080` on a home network.
- `INSTANCE_SECRET`: the backend's root secret. Every admin key is derived from it. Generate it
  with `openssl rand -hex 32`; it must be exactly 64 lowercase hex characters, so general password
  generators such as `pwgen` will not work. Keep it private and don't change it once there is data.

On every start the backend deploys the dashboard functions, so updating the image updates them.

### Exposure

| Service | Listens on | Purpose |
|---|---|---|
| `web` | `WEB_PORT` (8080), all interfaces | `PUBLIC_URL`. Serves the dashboard and proxies **only** the Convex sync WebSocket (`/api/sync` for Luma, `/api/<version>/sync` for the dashboard). Every other `/api/` path, such as deploying code or exporting data, returns 404. |
| `convex-admin` | `127.0.0.1:6791` only | Convex's admin UI, with a proxy to the full backend API. |
| `backend` | not published | Reached only through the two containers above. |

For internet access, put `WEB_PORT` behind an HTTPS reverse proxy (Caddy, Traefik, nginx) with
WebSockets enabled, and use the `https://` address as `PUBLIC_URL`. Over plain `http` the
account number travels unencrypted.

An admin key can still talk to the backend over the public sync connection: it can read and
change data, but deploying code and the other admin endpoints are unreachable from outside.
Treat admin keys and `INSTANCE_SECRET` like root passwords.

### Admin UI

```sh
docker compose exec backend admin-key   # prints an admin key; each run prints a new valid one
```

Open http://127.0.0.1:6791 on the Docker host and sign in with `http://127.0.0.1:6791` as the
deployment URL and the printed key. From another machine, tunnel the port first:

```sh
ssh -L 6791:127.0.0.1:6791 user@docker-host
```

### Updating

Data lives in the `convex-data` volume. To update, `docker compose pull && docker compose up -d`.
Set `IMAGE_TAG` in `.env` to a release such as `0.1.0` to pin a version instead of `latest`.

### Images

| Image | Contents |
|---|---|
| `ghcr.io/vbbot/luma-dashboard-backend` | Convex backend (built from the pinned [release binary](https://github.com/get-convex/convex-backend/releases)) plus `convex/` |
| `ghcr.io/vbbot/luma-dashboard-web` | The built frontend on nginx, proxying the sync WebSocket to `BACKEND_UPSTREAM` (default `backend:3210`). Has no URL baked in, so one image works for any deployment. |
| `ghcr.io/vbbot/luma-dashboard-convex-admin` | Convex's admin UI from the same release, proxying the full API to `BACKEND_UPSTREAM` |

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

## App Store

**Tools → + → App Store** lists every app from three sources, merged into one catalog:

| Source | What it provides |
|---|---|
| No Scrolling | Vandam's apps (`buses`, `passes`, `weather`, `zero`, `echo`, `reverb`), which every Luma version can install |
| [Bright Market](https://github.com/gi-os/brightmarket-index) | `index-v1.json`: package names, APK links with SHA-256, screenshots |
| [awesome-light](https://github.com/garado/awesome-light) | `content/apps/*/index.md`: descriptions, categories, screenshots |

`appStore:refresh` ([`convex/appStore.ts`](convex/appStore.ts)) rebuilds the catalog when the
backend starts and every 6 hours:

- **Duplicates.** Apps are matched by GitHub repo, then by package name, since Android can only
  hold one app per package. A merged app lists every source it came from.
- **Categories.** Both sources' categories map onto one list (`convex/storeSources.ts`).
- **Releases.** For apps whose source has no APK link, the latest GitHub release is looked up
  (cached by ETag). GitHub allows 60 lookups an hour without a token; set `GITHUB_TOKEN` (no
  scopes needed) to do them all in one refresh.
- **Package names.** For APKs with no listed package, the backend reads it from the APK's
  `AndroidManifest.xml` using HTTP range requests, without downloading the whole APK.

Apps with no APK in their latest release (or no release at all) are listed but can't be added.
Adding an App Store app beyond Vandam's needs a Luma build with App Store support; older builds
ignore those apps.

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
  // App Store apps in enabledAppIds other than the built-in ones. Luma
  // versions without App Store support ignore this field.
  managedApps: {
    id: string;          // "owner/repo", lowercase
    label: string;
    packageName: string;
    apkUrl: string;      // the APK to download and install
    versionName: string; // release version
    sha256: string | null; // checked against the download when present
  }[];
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

Built-in managed app IDs (`data/ManagedApp.kt`, all from `github.com/vandamd/<id>`): `buses`,
`passes`, `weather`, `zero`, `echo`, `reverb`. Other App Store apps use their lowercase
`owner/repo` as ID and reach Luma through `managedApps`.

Both lists are hard-coded in Luma and mirrored in [`convex/catalog.ts`](convex/catalog.ts). If Luma
adds new ones, update that file.

## Not implemented

The hosted dashboard's **API keys** screen is not reproduced: nothing in the Luma source reads API
keys, so what it stores could not be worked out. The hosted login's Cloudflare Turnstile check is
also left out.
