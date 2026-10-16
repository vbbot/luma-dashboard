import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const androidApp = v.object({
  label: v.string(),
  packageName: v.string(),
  activityName: v.string(),
});

export const installedManagedApp = v.object({
  appId: v.string(),
  versionName: v.string(),
});

export const release = v.object({
  version: v.string(),
  apkUrl: v.string(),
  sha256: v.optional(v.string()),
});

export const storeApp = v.object({
  appId: v.string(),
  name: v.string(),
  summary: v.string(),
  category: v.string(),
  sources: v.array(v.object({ id: v.string(), url: v.string() })),
  repo: v.string(),
  author: v.string(),
  authorUrl: v.optional(v.string()),
  screenshots: v.array(v.string()),
  packageName: v.optional(v.string()),
  latest: v.optional(release),
  editorPick: v.optional(v.boolean()),
});

export default defineSchema({
  accounts: defineTable({
    accountNumber: v.string(),
    enabledToolIds: v.array(v.string()),
    enabledAppIds: v.array(v.string()),
    enabledAndroidApps: v.array(androidApp),
    // appId -> exact version the launcher should install.
    requestedAppUpdateVersions: v.record(v.string(), v.string()),
  }).index("by_accountNumber", ["accountNumber"]),

  // One row per Luma installation that has logged in to an account.
  devices: defineTable({
    accountId: v.id("accounts"),
    installationId: v.string(),
    lastSeenAt: v.number(),
    installedManagedApps: v.array(installedManagedApp),
    installedAndroidApps: v.array(androidApp),
  })
    .index("by_account", ["accountId"])
    .index("by_account_installation", ["accountId", "installationId"]),

  lockscreenMessages: defineTable({
    accountId: v.id("accounts"),
    text: v.string(),
    // Unix epoch milliseconds. The launcher hides the message after this.
    expiresAt: v.number(),
  }).index("by_account", ["accountId"]),

  // App Store catalog, rebuilt by appStore:refresh from all sources.
  storeApps: defineTable(storeApp).index("by_appId", ["appId"]),

  // Caches that let a refresh skip unchanged GitHub releases and APKs.
  storeReleases: defineTable({
    repo: v.string(),
    etag: v.optional(v.string()),
    release: v.optional(release),
    checkedAt: v.number(),
  }).index("by_repo", ["repo"]),
  storePackages: defineTable({
    apkUrl: v.string(),
    packageName: v.optional(v.string()),
    error: v.optional(v.string()),
    checkedAt: v.number(),
  }).index("by_apkUrl", ["apkUrl"]),

  storeStatus: defineTable({
    refreshedAt: v.number(),
    appCount: v.number(),
    errors: v.array(v.string()),
  }),

  // appId -> latest version. The launcher reads the "luma" key to offer
  // self-updates from GitHub. Edit rows from the Convex dashboard.
  releaseVersions: defineTable({
    appId: v.string(),
    versionName: v.string(),
  }).index("by_appId", ["appId"]),
});
