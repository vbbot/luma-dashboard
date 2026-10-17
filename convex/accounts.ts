import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { androidApp, installedManagedApp } from "./schema";
import { captchaPayload, requireCaptcha } from "./captcha";
import { deleteIntegration } from "./integrations";
import {
  ACCOUNT_NUMBER_PATTERN,
  DEFAULT_TOOL_IDS,
  REQUIRED_TOOL_IDS,
  isBuiltinAppId,
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

async function findStoreApp(ctx: QueryCtx, appId: string) {
  return await ctx.db
    .query("storeApps")
    .withIndex("by_appId", (q) => q.eq("appId", appId))
    .unique();
}

// The shape ToolSyncManager.DeviceSyncPayload decodes. managedApps tells Luma
// how to install App Store apps beyond the built-in ones; Luma versions that
// predate it ignore unknown fields and only install built-in apps.
async function toDeviceSync(ctx: QueryCtx, account: Doc<"accounts">) {
  const storeApps = await Promise.all(
    account.enabledAppIds.filter((id) => !isBuiltinAppId(id)).map((id) => findStoreApp(ctx, id)),
  );
  return {
    enabledToolIds: account.enabledToolIds,
    enabledAppIds: account.enabledAppIds,
    enabledAndroidApps: account.enabledAndroidApps,
    requestedAppUpdateVersions: account.requestedAppUpdateVersions,
    managedApps: storeApps.flatMap((app) =>
      app?.packageName && app.latest
        ? [
            {
              id: app.appId,
              label: app.name,
              packageName: app.packageName,
              apkUrl: app.latest.apkUrl,
              versionName: app.latest.version,
              sha256: app.latest.sha256 ?? null,
            },
          ]
        : [],
    ),
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

    return await toDeviceSync(ctx, account);
  },
});

export const getDeviceSync = query({
  args: { accountNumber: v.string() },
  handler: async (ctx, { accountNumber }) => {
    const account = await findAccount(ctx, accountNumber);
    return account === null ? null : await toDeviceSync(ctx, account);
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
      // An enabled app that was installed and no longer is was uninstalled on
      // the phone (for example from Android's settings), so stop offering it.
      const nowInstalled = new Set(args.installedManagedApps.map((app) => app.appId));
      const uninstalled = device.installedManagedApps
        .map((app) => app.appId)
        .filter((appId) => !nowInstalled.has(appId));
      await removeEnabledApps(ctx, account, uninstalled);
      await ctx.db.patch(device._id, fields);
    }
    return null;
  },
});

// Called when an app is removed from Luma's Manage Tools before it was
// installed. Installed apps are uninstalled on the phone and picked up by
// syncInstalledApps instead.
export const removeApp = mutation({
  args: { accountNumber: v.string(), appId: v.string() },
  handler: async (ctx, { accountNumber, appId }) => {
    const account = await findAccount(ctx, accountNumber);
    if (account !== null) {
      await removeEnabledApps(ctx, account, [appId]);
    }
    return null;
  },
});

async function removeEnabledApps(ctx: MutationCtx, account: Doc<"accounts">, appIds: string[]) {
  const remove = new Set(appIds.filter((appId) => account.enabledAppIds.includes(appId)));
  if (remove.size === 0) return;
  const requestedAppUpdateVersions = { ...account.requestedAppUpdateVersions };
  for (const appId of remove) delete requestedAppUpdateVersions[appId];
  await ctx.db.patch(account._id, {
    enabledAppIds: account.enabledAppIds.filter((appId) => !remove.has(appId)),
    requestedAppUpdateVersions,
  });
}

// ---------------------------------------------------------------------------
// Called by the web dashboard.
// ---------------------------------------------------------------------------

export const create = mutation({
  // The browser generates the number with crypto.getRandomValues, because
  // Math.random inside Convex functions is deterministic.
  args: { accountNumber: v.string(), captcha: captchaPayload },
  handler: async (ctx, { accountNumber, captcha }) => {
    if (!ACCOUNT_NUMBER_PATTERN.test(accountNumber)) {
      throw new Error("Account number must be 16 digits");
    }
    await requireCaptcha(ctx, captcha);
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

// Dashboard login: true if the account exists. A mutation so the captcha can
// be marked as used.
export const logIn = mutation({
  args: { accountNumber: v.string(), captcha: captchaPayload },
  handler: async (ctx, { accountNumber, captcha }) => {
    await requireCaptcha(ctx, captcha);
    return (await findAccount(ctx, accountNumber)) !== null;
  },
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
      ...(await toDeviceSync(ctx, account)),
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
    const enabledAppIds: string[] = [];
    for (const appId of new Set(appIds)) {
      if (isBuiltinAppId(appId)) {
        enabledAppIds.push(appId);
        continue;
      }
      const app = await findStoreApp(ctx, appId);
      if (app?.packageName && app.latest) {
        enabledAppIds.push(appId);
      }
    }
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
    if (!isBuiltinAppId(appId)) {
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
    const integrations = await ctx.db
      .query("integrations")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    for (const integration of integrations) {
      await deleteIntegration(ctx, integration);
    }
    await ctx.db.delete(account._id);
  },
});
