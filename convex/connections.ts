import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { findAccount } from "./accounts";
import {
  deleteIntegration,
  errorText,
  hookUrl,
  newToken,
  openSecrets,
  publicSettings,
  requireAccount,
  sealSecrets,
} from "./integrations";
import { IntegrationError, SettingsError, type Settings } from "./kinds/types";
import { PROVIDERS } from "./providers";

// Accounts linked once and shared by the cards that use them (providers/).
// Disconnecting removes those cards too.

const providerValidator = v.literal("habitica");

// Refresh every card using the connection, after delayMs.
async function scheduleCardRefreshes(
  ctx: MutationCtx,
  connectionId: Id<"connections">,
  delayMs: number,
) {
  for (const integration of await ctx.db
    .query("integrations")
    .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
    .collect()) {
    await ctx.scheduler.runAfter(delayMs, internal.integrations.refreshOne, {
      integrationId: integration._id,
    });
  }
}

// Removes a connection and every card that uses it (also used when an account
// is deleted).
export async function deleteConnection(ctx: MutationCtx, connectionId: Id<"connections">) {
  const connection = await ctx.db.get(connectionId);
  if (connection === null) return;
  for (const integration of await ctx.db
    .query("integrations")
    .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
    .collect()) {
    await deleteIntegration(ctx, integration);
  }
  await ctx.scheduler.runAfter(0, internal.connections.runDisconnect, {
    provider: connection.provider,
    settings: connection.settings,
  });
  await ctx.db.delete(connectionId);
}

export const list = query({
  args: { accountNumber: v.string() },
  handler: async (ctx, { accountNumber }) => {
    const account = await findAccount(ctx, accountNumber);
    if (account === null) return null;
    const rows = await ctx.db
      .query("connections")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    return rows.map((row) => {
      const provider = PROVIDERS[row.provider];
      return {
        connectionId: row._id,
        provider: row.provider,
        name: provider.name,
        settings: publicSettings(provider, (row.settings ?? {}) as Settings),
      };
    });
  },
});

export const connect = action({
  args: { accountNumber: v.string(), provider: providerValidator, settings: v.any() },
  handler: async (
    ctx,
    { accountNumber, provider: name, settings: input },
  ): Promise<Id<"connections">> => {
    const provider = PROVIDERS[name];
    if (!(await ctx.runQuery(internal.connections.accountExists, { accountNumber }))) {
      throw new Error("Account not found");
    }
    try {
      let settings = provider.parseSettings(input);
      const webhookToken = provider.inbound ? newToken() : undefined;
      const connected = await provider.onConnect?.({
        ctx,
        settings,
        now: Date.now(),
        hookUrl: webhookToken ? hookUrl(name, webhookToken) : null,
      });
      if (connected) settings = connected;
      return await ctx.runMutation(internal.connections.insert, {
        accountNumber,
        provider: name,
        settings: await sealSecrets(provider, settings),
        webhookToken,
      });
    } catch (error) {
      if (error instanceof SettingsError) throw new Error(error.message);
      throw error;
    }
  },
});

// Removes the connection and every card that uses it.
export const disconnect = mutation({
  args: { accountNumber: v.string(), connectionId: v.id("connections") },
  handler: async (ctx, { accountNumber, connectionId }) => {
    const account = await requireAccount(ctx, accountNumber);
    const connection = await ctx.db.get(connectionId);
    if (connection === null || connection.accountId !== account._id)
      throw new Error("Connection not found");
    await deleteConnection(ctx, connectionId);
  },
});

// A provider's dashboard operation (providers/types.ts `operations`), e.g.
// adding a Habitica task. Refreshes the cards that use the connection after
// anything that changes data.
export const operate = action({
  args: {
    accountNumber: v.string(),
    connectionId: v.id("connections"),
    operation: v.string(),
    args: v.any(),
  },
  handler: async (ctx, { accountNumber, connectionId, operation, args }): Promise<unknown> => {
    const stored = await ctx.runQuery(internal.connections.forOwner, {
      accountNumber,
      connectionId,
    });
    if (stored === null) throw new Error("Connection not found");
    const provider = PROVIDERS[stored.provider];
    const handler = provider.operations?.[operation];
    if (handler === undefined) throw new Error("Not available");
    try {
      const settings = await openSecrets(provider, stored.settings);
      const result = await handler.run({ ctx, settings, now: Date.now(), args });
      if (!handler.readOnly) {
        await ctx.runMutation(internal.connections.refreshCards, { connectionId });
      }
      return result ?? null;
    } catch (error) {
      if (error instanceof SettingsError || error instanceof IntegrationError)
        throw new Error(error.message);
      throw error;
    }
  },
});

// ---------------------------------------------------------------------------
// Internal.
// ---------------------------------------------------------------------------

export const accountExists = internalQuery({
  args: { accountNumber: v.string() },
  handler: async (ctx, { accountNumber }) => (await findAccount(ctx, accountNumber)) !== null,
});

export const insert = internalMutation({
  args: {
    accountNumber: v.string(),
    provider: providerValidator,
    settings: v.any(),
    webhookToken: v.optional(v.string()),
  },
  handler: async (ctx, { accountNumber, provider, settings, webhookToken }) => {
    const account = await requireAccount(ctx, accountNumber);
    return await ctx.db.insert("connections", {
      accountId: account._id,
      provider,
      settings,
      webhookToken,
    });
  },
});

export const forOwner = internalQuery({
  args: { accountNumber: v.string(), connectionId: v.id("connections") },
  handler: async (ctx, { accountNumber, connectionId }) => {
    const account = await findAccount(ctx, accountNumber);
    const connection = await ctx.db.get(connectionId);
    if (account === null || connection === null || connection.accountId !== account._id)
      return null;
    return { provider: connection.provider, settings: (connection.settings ?? {}) as Settings };
  },
});

// Refresh every card using the connection, soon.
export const refreshCards = internalMutation({
  args: { connectionId: v.id("connections"), delayMs: v.optional(v.number()) },
  handler: async (ctx, { connectionId, delayMs = 0 }) =>
    await scheduleCardRefreshes(ctx, connectionId, delayMs),
});

export const runDisconnect = internalAction({
  args: { provider: providerValidator, settings: v.any() },
  handler: async (ctx, { provider: name, settings }) => {
    const provider = PROVIDERS[name];
    try {
      await provider.onDisconnect?.({
        ctx,
        settings: await openSecrets(provider, settings),
        now: Date.now(),
      });
    } catch (error) {
      console.warn(`Cleanup after disconnecting failed: ${errorText(error)}`);
    }
  },
});

// The provider called /hooks/<provider>/<token> (http.ts): something changed
// there. The body is not trusted; the token says which connection it is.
export const inbound = internalMutation({
  args: { provider: providerValidator, webhookToken: v.string() },
  handler: async (ctx, { provider: name, webhookToken }) => {
    const connection = await ctx.db
      .query("connections")
      .withIndex("by_webhookToken", (q) => q.eq("webhookToken", webhookToken))
      .unique();
    const provider = PROVIDERS[name];
    if (connection === null || connection.provider !== name || provider.inbound === undefined) {
      return { status: 404, error: "Unknown webhook" };
    }
    const now = Date.now();
    // A burst of notifications shares one refresh, a moment later so the
    // provider has finished its changes.
    if (
      connection.lastPushAt === undefined ||
      now - connection.lastPushAt >= provider.inbound.minIntervalMs
    ) {
      await ctx.db.patch(connection._id, { lastPushAt: now });
      await scheduleCardRefreshes(ctx, connection._id, 2_000);
    }
    return { status: 200, error: null };
  },
});
