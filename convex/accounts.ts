import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { androidApp, installedManagedApp } from "./schema";
import {
  ACCOUNT_NUMBER_PATTERN,
  DEFAULT_TOOL_IDS,
  REQUIRED_TOOL_IDS,
  isManagedAppId,
  isToolId,
} from "./catalog";

// The account number is the only credential, exactly as on the hosted
// dashboard: whoever knows it can read and change the account.

export async function findAccount(
  ctx: QueryCtx,
  accountNumber: string,
): Promise<Doc<"accounts"> | null> {
  if (!ACCOUNT_NUMBER_PATTERN.test(accountNumber)) {
    return null;
  }
  return await ctx.db
    .query("accounts")
    .withIndex("by_accountNumber", (q) => q.eq("accountNumber", accountNumber))
    .unique();
}

async function requireAccount(ctx: QueryCtx, accountNumber: string) {
  const account = await findAccount(ctx, accountNumber);
  if (account === null) {
    throw new Error("Account not found");
  }
  return account;
}

// Exactly the shape ToolSyncManager.DeviceSyncPayload decodes.
function toDeviceSync(account: Doc<"accounts">) {
  return {
    enabledToolIds: account.enabledToolIds,
    enabledAppIds: account.enabledAppIds,
    enabledAndroidApps: account.enabledAndroidApps,
    requestedAppUpdateVersions: account.requestedAppUpdateVersions,
  };
}

function normalizeToolIds(toolIds: string[]): string[] {
  const ids = [...new Set(toolIds.filter(isToolId))].filter(
    (id) => !(REQUIRED_TOOL_IDS as readonly string[]).includes(id),
  );
  return ["phone", ...ids, "settings"];
}

function androidAppKey(app: { packageName: string; activityName: string }) {
  return `${app.packageName}|${app.activityName}`;
}

function dedupeAndroidApps<T extends { packageName: string; activityName: string }>(
  apps: T[],
): T[] {
  const byKey = new Map<string, T>();
  for (const app of apps) {
    if (!byKey.has(androidAppKey(app))) {
      byKey.set(androidAppKey(app), app);
    }
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------------------
// Called by the Luma launcher. Names and argument shapes must not change.
// ---------------------------------------------------------------------------

export const attemptDeviceLogin = mutation({
  args: { accountNumber: v.string(), installationId: v.string() },
  handler: async (ctx, { accountNumber, installationId }) => {
    const account = await findAccount(ctx, accountNumber);
    if (account === null) {
      return null;
    }

    const device = await ctx.db
      .query("devices")
      .withIndex("by_account_installation", (q) =>
        q.eq("accountId", account._id).eq("installationId", installationId),
      )
      .unique();
    if (device === null) {
      await ctx.db.insert("devices", {
        accountId: account._id,
        installationId,
        lastSeenAt: Date.now(),
        installedManagedApps: [],
        installedAndroidApps: [],
      });
    } else {
      await ctx.db.patch(device._id, { lastSeenAt: Date.now() });
    }

    return toDeviceSync(account);
  },
});

export const getDeviceSync = query({
  args: { accountNumber: v.string() },
  handler: async (ctx, { accountNumber }) => {
    const account = await findAccount(ctx, accountNumber);
    return account === null ? null : toDeviceSync(account);
  },
});

export const syncInstalledApps = mutation({
  args: {
    accountNumber: v.string(),
    installationId: v.string(),
    installedManagedApps: v.array(installedManagedApp),
    installedAndroidApps: v.array(androidApp),
  },
  handler: async (ctx, args) => {
    const account = await findAccount(ctx, args.accountNumber);
    if (account === null) {
      return null;
    }

    const fields = {
      lastSeenAt: Date.now(),
      installedManagedApps: args.installedManagedApps,
      installedAndroidApps: dedupeAndroidApps(args.installedAndroidApps),
    };
    const device = await ctx.db
      .query("devices")
      .withIndex("by_account_installation", (q) =>
        q.eq("accountId", account._id).eq("installationId", args.installationId),
      )
      .unique();
    if (device === null) {
      await ctx.db.insert("devices", {
        accountId: account._id,
        installationId: args.installationId,
        ...fields,
      });
    } else {
      await ctx.db.patch(device._id, fields);
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Called by the web dashboard.
// ---------------------------------------------------------------------------

export const create = mutation({
  // The browser generates the number with crypto.getRandomValues, because
  // Math.random inside Convex functions is deterministic.
  args: { accountNumber: v.string() },
  handler: async (ctx, { accountNumber }) => {
    if (!ACCOUNT_NUMBER_PATTERN.test(accountNumber)) {
      throw new Error("Account number must be 16 digits");
    }
    if ((await findAccount(ctx, accountNumber)) !== null) {
      throw new Error("Account number already taken");
    }
    await ctx.db.insert("accounts", {
      accountNumber,
      enabledToolIds: DEFAULT_TOOL_IDS,
      enabledAppIds: [],
      enabledAndroidApps: [],
      requestedAppUpdateVersions: {},
    });
    return accountNumber;
  },
});

export const exists = query({
  args: { accountNumber: v.string() },
  handler: async (ctx, { accountNumber }) =>
    (await findAccount(ctx, accountNumber)) !== null,
});

export const getDashboard = query({
  args: { accountNumber: v.string() },
  handler: async (ctx, { accountNumber }) => {
    const account = await findAccount(ctx, accountNumber);
    if (account === null) {
      return null;
    }

    const devices = await ctx.db
      .query("devices")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    const installedAndroidApps = dedupeAndroidApps(
      devices
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
        .flatMap((device) => device.installedAndroidApps),
    );

    return {
      ...toDeviceSync(account),
      installedAndroidApps,
      devices: devices.map((device) => ({
        installationId: device.installationId,
        lastSeenAt: device.lastSeenAt,
        installedManagedApps: device.installedManagedApps,
      })),
    };
  },
});

export const setEnabledTools = mutation({
  args: { accountNumber: v.string(), toolIds: v.array(v.string()) },
  handler: async (ctx, { accountNumber, toolIds }) => {
    const account = await requireAccount(ctx, accountNumber);
    await ctx.db.patch(account._id, { enabledToolIds: normalizeToolIds(toolIds) });
  },
});

export const setEnabledApps = mutation({
  args: { accountNumber: v.string(), appIds: v.array(v.string()) },
  handler: async (ctx, { accountNumber, appIds }) => {
    const account = await requireAccount(ctx, accountNumber);
    const enabledAppIds = [...new Set(appIds.filter(isManagedAppId))];
    const requestedAppUpdateVersions = Object.fromEntries(
      Object.entries(account.requestedAppUpdateVersions).filter(([appId]) =>
        enabledAppIds.includes(appId),
      ),
    );
    await ctx.db.patch(account._id, { enabledAppIds, requestedAppUpdateVersions });
  },
});

export const setEnabledAndroidApps = mutation({
  args: { accountNumber: v.string(), apps: v.array(androidApp) },
  handler: async (ctx, { accountNumber, apps }) => {
    const account = await requireAccount(ctx, accountNumber);
    const enabledAndroidApps = dedupeAndroidApps(
      apps
        .map((app) => ({
          label: app.label.trim() || app.packageName.trim(),
          packageName: app.packageName.trim(),
          activityName: app.activityName.trim(),
        }))
        .filter((app) => app.packageName !== "" && app.activityName !== ""),
    );
    await ctx.db.patch(account._id, { enabledAndroidApps });
  },
});

export const requestAppVersion = mutation({
  args: {
    accountNumber: v.string(),
    appId: v.string(),
    versionName: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { accountNumber, appId, versionName }) => {
    const account = await requireAccount(ctx, accountNumber);
    if (!isManagedAppId(appId)) {
      throw new Error("Unknown app");
    }
    const requestedAppUpdateVersions = { ...account.requestedAppUpdateVersions };
    if (versionName === null || versionName.trim() === "") {
      delete requestedAppUpdateVersions[appId];
    } else {
      requestedAppUpdateVersions[appId] = versionName.trim().replace(/^v/, "");
    }
    await ctx.db.patch(account._id, { requestedAppUpdateVersions });
  },
});

export const remove = mutation({
  args: { accountNumber: v.string() },
  handler: async (ctx, { accountNumber }) => {
    const account = await requireAccount(ctx, accountNumber);
    const devices = await ctx.db
      .query("devices")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    const messages = await ctx.db
      .query("lockscreenMessages")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    for (const row of [...devices, ...messages]) {
      await ctx.db.delete(row._id);
    }
    await ctx.db.delete(account._id);
  },
});
