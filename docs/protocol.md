# The Luma ⇄ server protocol

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

An enabled app that was in the installation's previous `installedManagedApps` and is missing now
was uninstalled on the phone, so it is removed from the account.

### `accounts:removeApp`

```ts
args: { accountNumber: string; appId: string }
returns: null
```

Sent by Luma 2.0.22+ when an App Store app that was never installed is removed in Manage Tools.

### `lockscreenMessages:getCurrentForDevice`

```ts
args:    { accountNumber: string }
returns: { messageId: string; text: string; expiresAt: number /* epoch ms */ } | null
```

The phone hides the message once `expiresAt` has passed, so the query does not need to check the
current time.

### `lockscreen:getForDevice`

```ts
args:    { accountNumber: string; protocol: number; blocks: string[] }
returns: Card[]   // docs/lockscreen-cards.md
```

The cards from lock screen integrations, in the order chosen on the dashboard. `protocol` and
`blocks` say what the client can draw; cards that need more come back as their one-line fallback.
The first integrations build of Luma called `glances:getForDevice`, which still returns each card's
fallback line.

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

Both lists are hard-coded in Luma and mirrored in [`convex/catalog.ts`](../convex/catalog.ts). If Luma
adds new ones, update that file.

## Not implemented

The hosted dashboard's **API keys** screen is not reproduced: nothing in the Luma source reads API
keys, so what it stores could not be worked out. The hosted login's Cloudflare Turnstile check is
also left out.
