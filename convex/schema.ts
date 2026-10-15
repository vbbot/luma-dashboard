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

  // appId -> latest version. The launcher reads the "luma" key to offer
  // self-updates from GitHub. Edit rows from the Convex dashboard.
  releaseVersions: defineTable({
    appId: v.string(),
    versionName: v.string(),
  }).index("by_appId", ["appId"]),
});
