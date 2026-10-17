import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { findAccount } from "./accounts";
import { geocodingUrl, parsePlaces } from "./weather";
import {
  CARD_SCHEMA,
  CardError,
  type Card,
  type CardContent,
  LIMITS,
  textContent,
  validateContent,
} from "./cards";
import { decrypt, encrypt } from "./secrets";
import { KINDS, kindOf } from "./kinds";
import {
  IntegrationError,
  type IntegrationKind,
  type Kind,
  SettingsError,
  type Settings,
} from "./kinds/types";

// Lock screen integrations: the shared machinery behind every kind
// (kinds/). Each produces a card that Luma shows under the lock screen clock
// (format: docs/lockscreen-cards.md, cards.ts). This file stores settings
// (secret fields encrypted), refreshes on a schedule with backoff, validates
// and stores cards, runs lock screen actions and routes provider webhooks.

declare const process: { env: Record<string, string | undefined> };

export const MAX_INTEGRATIONS = 5;
const DEFAULT_REFRESH_MS = 30 * 60_000;
const MAX_BACKOFF_MS = 6 * 60 * 60_000;
// Refreshes run a few at a time.
const REFRESH_CONCURRENCY = 4;

export const WEBHOOK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const kindValidator = v.union(v.literal("weather"), v.literal("webhook"), v.literal("habitica"));

export async function requireAccount(ctx: QueryCtx, accountNumber: string) {
  const account = await findAccount(ctx, accountNumber);
  if (account === null) throw new Error("Account not found");
  return account;
}

export async function requireIntegration(
  ctx: QueryCtx,
  accountNumber: string,
  integrationId: Id<"integrations">,
) {
  const account = await requireAccount(ctx, accountNumber);
  const integration = await ctx.db.get(integrationId);
  if (integration === null || integration.accountId !== account._id) {
    throw new Error("Integration not found");
  }
  return integration;
}

function kindFor(integration: { kind: string }): IntegrationKind {
  const kind = kindOf(integration.kind);
  if (kind === null) throw new Error(`Unknown integration kind ${integration.kind}`);
  return kind;
}

// Random 32-byte token, base64url. Generated in actions: randomness inside
// queries and mutations is seeded and must not be used for secrets.
function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// The public address a provider calls (http.ts); null unless the dashboard
// is on HTTPS, since providers like Habitica cannot reach it otherwise.
// Generic webhooks keep their original /hooks/<token> address.
function hookUrl(kind: Kind, token: string) {
  const base = process.env.PUBLIC_URL?.replace(/\/+$/, "");
  if (!base || !base.startsWith("https://")) return null;
  return kind === "webhook" ? `${base}/hooks/${token}` : `${base}/hooks/${kind}/${token}`;
}

async function sealSecrets(kind: IntegrationKind, settings: Settings): Promise<Settings> {
  const sealed = { ...settings };
  for (const field of kind.secret ?? []) {
    if (typeof sealed[field] === "string") sealed[field] = await encrypt(sealed[field] as string);
  }
  return sealed;
}

async function openSecrets(kind: IntegrationKind, settings: Settings): Promise<Settings> {
  const open = { ...settings };
  for (const field of kind.secret ?? []) {
    if (typeof open[field] === "string") open[field] = await decrypt(open[field] as string);
  }
  return open;
}

// Settings the browser may see: everything but the secret fields.
function publicSettings(kind: IntegrationKind, settings: Settings) {
  const shown = { ...settings };
  for (const field of kind.secret ?? []) delete shown[field];
  return shown;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// Stores what an integration currently shows, or clears it. Content is
// validated again here so a faulty integration can never store a card that
// breaks the phone.
export async function setCard(
  ctx: MutationCtx,
  integration: Doc<"integrations">,
  content: CardContent | null,
  expiresAt: number,
) {
  const existing = await ctx.db
    .query("cards")
    .withIndex("by_integration", (q) => q.eq("integrationId", integration._id))
    .unique();
  if (content === null) {
    if (existing) await ctx.db.delete(existing._id);
    return;
  }
  const valid = validateContent(content, { allowActions: kindFor(integration).allowActions });
  const card: Card = {
    ...valid,
    // Luma shows one integration at a time under a header, so every card
    // needs a name; the integration's own label unless the card sets one.
    title: valid.title ?? integration.label.slice(0, LIMITS.title),
    // Phone notifications only where the person has them on.
    notifications: integration.notify === false ? undefined : valid.notifications,
    id: integration._id,
    schema: CARD_SCHEMA,
    updatedAt: Date.now(),
    expiresAt,
  };
  const fields = { integrationId: integration._id, accountId: integration.accountId, card };
  if (existing) {
    await ctx.db.replace(existing._id, fields);
  } else {
    await ctx.db.insert("cards", fields);
  }
}

export async function deleteIntegration(ctx: MutationCtx, integration: Doc<"integrations">) {
  await setCard(ctx, integration, null, 0);
  const kind = kindFor(integration);
  if (kind.onRemove !== undefined && integration.settings !== undefined) {
    await ctx.scheduler.runAfter(0, internal.integrations.runRemove, {
      kind: integration.kind,
      settings: integration.settings,
    });
  }
  await ctx.db.delete(integration._id);
}

// ---------------------------------------------------------------------------
// Called by the web dashboard.
// ---------------------------------------------------------------------------

export const list = query({
  args: { accountNumber: v.string() },
  handler: async (ctx, { accountNumber }) => {
    const account = await findAccount(ctx, accountNumber);
    if (account === null) return null;
    const integrations = await ctx.db
      .query("integrations")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    return integrations
      .sort((a, b) => a.order - b.order)
      .map((integration) => {
        const kind = kindFor(integration);
        const row = cards.find((entry) => entry.integrationId === integration._id);
        return {
          integrationId: integration._id,
          kind: integration.kind,
          label: integration.label,
          settings: publicSettings(kind, (integration.settings ?? {}) as Settings),
          editable: kind.editable ?? [],
          notify: integration.notify !== false,
          webhookToken: integration.kind === "webhook" ? integration.webhookToken : undefined,
          lastError: integration.lastError,
          card: row ? (row.card as Card) : null,
        };
      });
  },
});

export const add = action({
  args: { accountNumber: v.string(), kind: kindValidator, settings: v.any() },
  handler: async (
    ctx,
    { accountNumber, kind: kindName, settings: input },
  ): Promise<Id<"integrations">> => {
    const kind = KINDS[kindName];
    if (!(await ctx.runQuery(internal.integrations.canAdd, { accountNumber }))) {
      throw new Error(`An account can have at most ${MAX_INTEGRATIONS} integrations`);
    }
    let settings: Settings;
    try {
      settings = kind.parseSettings(input);
      const webhookToken = kind.inbound ? newToken() : undefined;
      const added = await kind.onAdd?.({
        ctx,
        settings,
        now: Date.now(),
        hookUrl: webhookToken ? hookUrl(kindName, webhookToken) : null,
      });
      if (added) settings = added;
      const integrationId: Id<"integrations"> = await ctx.runMutation(
        internal.integrations.insert,
        {
          accountNumber,
          kind: kindName,
          label: kind.label(settings).slice(0, 40),
          settings: await sealSecrets(kind, settings),
          webhookToken,
          refreshes: kind.refresh !== undefined,
        },
      );
      // Show something straight away rather than at the next scheduled run.
      if (kind.refresh) await refresh(ctx, integrationId);
      return integrationId;
    } catch (error) {
      // SettingsError messages are meant for the person setting it up.
      if (error instanceof SettingsError) throw new Error(error.message);
      throw error;
    }
  },
});

// Changes the editable settings (e.g. weather units) and refreshes.
export const update = mutation({
  args: { accountNumber: v.string(), integrationId: v.id("integrations"), settings: v.any() },
  handler: async (ctx, { accountNumber, integrationId, settings: input }) => {
    const integration = await requireIntegration(ctx, accountNumber, integrationId);
    const kind = kindFor(integration);
    const changes = Object.fromEntries(
      Object.entries((input ?? {}) as Settings).filter(([key]) =>
        (kind.editable ?? []).includes(key),
      ),
    );
    let settings: Settings;
    try {
      settings = kind.parseSettings(changes, (integration.settings ?? {}) as Settings);
    } catch (error) {
      if (error instanceof SettingsError) throw new Error(error.message);
      throw error;
    }
    await ctx.db.patch(integration._id, {
      settings,
      label: kind.label(settings).slice(0, 40),
      ...(kind.refresh ? { nextRunAt: Date.now(), failures: 0 } : {}),
    });
    if (kind.refresh) {
      await ctx.scheduler.runAfter(0, internal.integrations.refreshOne, { integrationId });
    }
  },
});

// Turns phone notifications from this integration on or off.
export const setNotify = mutation({
  args: { accountNumber: v.string(), integrationId: v.id("integrations"), notify: v.boolean() },
  handler: async (ctx, { accountNumber, integrationId, notify }) => {
    const integration = await requireIntegration(ctx, accountNumber, integrationId);
    await ctx.db.patch(integration._id, { notify });
    if (kindFor(integration).refresh) {
      await ctx.db.patch(integration._id, { nextRunAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.integrations.refreshOne, { integrationId });
    } else if (!notify) {
      // Push-only kinds: drop the notifications from the card now.
      const row = await ctx.db
        .query("cards")
        .withIndex("by_integration", (q) => q.eq("integrationId", integration._id))
        .unique();
      if (row)
        await ctx.db.patch(row._id, { card: { ...(row.card as Card), notifications: undefined } });
    }
  },
});

// A new secret address for a webhook integration (the old one stops working).
export const rotateToken = action({
  args: { accountNumber: v.string(), integrationId: v.id("integrations") },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.integrations.replaceToken, {
      ...args,
      webhookToken: newToken(),
    });
  },
});

export const remove = mutation({
  args: { accountNumber: v.string(), integrationId: v.id("integrations") },
  handler: async (ctx, { accountNumber, integrationId }) => {
    await deleteIntegration(ctx, await requireIntegration(ctx, accountNumber, integrationId));
  },
});

// Swaps an integration with its neighbour; the order is the order on the
// lock screen.
export const move = mutation({
  args: {
    accountNumber: v.string(),
    integrationId: v.id("integrations"),
    direction: v.union(v.literal("up"), v.literal("down")),
  },
  handler: async (ctx, { accountNumber, integrationId, direction }) => {
    const integration = await requireIntegration(ctx, accountNumber, integrationId);
    const siblings = (
      await ctx.db
        .query("integrations")
        .withIndex("by_account", (q) => q.eq("accountId", integration.accountId))
        .collect()
    ).sort((a, b) => a.order - b.order);
    const index = siblings.findIndex((row) => row._id === integration._id);
    const other = siblings[direction === "up" ? index - 1 : index + 1];
    if (other === undefined) return;
    await ctx.db.patch(integration._id, { order: other.order });
    await ctx.db.patch(other._id, { order: integration.order });
  },
});

// For the weather setup screen.
export const searchPlaces = action({
  args: { accountNumber: v.string(), query: v.string() },
  handler: async (ctx, { accountNumber, query: search }) => {
    const trimmed = search.trim();
    if (trimmed.length < 2 || trimmed.length > 80) return [];
    if (!(await ctx.runQuery(internal.integrations.canAdd, { accountNumber }))) return [];
    const response = await fetch(geocodingUrl(trimmed));
    if (!response.ok) throw new Error(`Place search failed: HTTP ${response.status}`);
    return parsePlaces(await response.json());
  },
});

// ---------------------------------------------------------------------------
// Internal.
// ---------------------------------------------------------------------------

export const canAdd = internalQuery({
  args: { accountNumber: v.string() },
  handler: async (ctx, { accountNumber }) => {
    const account = await findAccount(ctx, accountNumber);
    if (account === null) return false;
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    return existing.length < MAX_INTEGRATIONS;
  },
});

export const insert = internalMutation({
  args: {
    accountNumber: v.string(),
    kind: kindValidator,
    label: v.string(),
    settings: v.any(),
    webhookToken: v.optional(v.string()),
    refreshes: v.boolean(),
  },
  handler: async (ctx, { accountNumber, kind, label, settings, webhookToken, refreshes }) => {
    const account = await requireAccount(ctx, accountNumber);
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    if (existing.length >= MAX_INTEGRATIONS) {
      throw new Error(`An account can have at most ${MAX_INTEGRATIONS} integrations`);
    }
    return await ctx.db.insert("integrations", {
      accountId: account._id,
      order: Math.max(0, ...existing.map((row) => row.order)) + 1,
      kind,
      label,
      settings,
      webhookToken,
      nextRunAt: refreshes ? Date.now() : undefined,
    });
  },
});

export const replaceToken = internalMutation({
  args: {
    accountNumber: v.string(),
    integrationId: v.id("integrations"),
    webhookToken: v.string(),
  },
  handler: async (ctx, { accountNumber, integrationId, webhookToken }) => {
    const integration = await requireIntegration(ctx, accountNumber, integrationId);
    // Providers that registered the old address (e.g. Habitica) would lose it.
    if (integration.kind !== "webhook") throw new Error("Only webhooks can change their address");
    await ctx.db.patch(integration._id, { webhookToken });
  },
});

export const forRun = internalQuery({
  args: { integrationId: v.id("integrations") },
  handler: async (ctx, { integrationId }) => {
    const integration = await ctx.db.get(integrationId);
    if (integration === null) return null;
    return {
      kind: integration.kind,
      settings: (integration.settings ?? {}) as Settings,
      failures: integration.failures ?? 0,
    };
  },
});

export const saveRefresh = internalMutation({
  args: {
    integrationId: v.id("integrations"),
    content: v.any(),
    expiresAt: v.number(),
    nextRunAt: v.union(v.number(), v.null()),
  },
  handler: async (ctx, { integrationId, content, expiresAt, nextRunAt }) => {
    const integration = await ctx.db.get(integrationId);
    // Removed while the refresh was running.
    if (integration === null) return;
    await ctx.db.patch(integrationId, {
      nextRunAt: nextRunAt ?? undefined,
      failures: 0,
      lastError: undefined,
    });
    await setCard(ctx, integration, content as CardContent | null, expiresAt);
  },
});

export const saveFailure = internalMutation({
  args: { integrationId: v.id("integrations"), error: v.string(), permanent: v.boolean() },
  handler: async (ctx, { integrationId, error, permanent }) => {
    const integration = await ctx.db.get(integrationId);
    if (integration === null) return;
    const failures = (integration.failures ?? 0) + 1;
    const base = kindFor(integration).refreshMs ?? DEFAULT_REFRESH_MS;
    await ctx.db.patch(integrationId, {
      failures,
      lastError: error,
      nextRunAt:
        Date.now() +
        (permanent ? MAX_BACKOFF_MS : Math.min(base * 2 ** (failures - 1), MAX_BACKOFF_MS)),
    });
  },
});

// The caller passes the time: a query that reads Date.now() itself can be
// served from cache and miss rows that became due since.
export const due = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const rows = await ctx.db
      .query("integrations")
      // Push-only kinds have no nextRunAt, and missing values sort first.
      .withIndex("by_nextRunAt", (q) => q.gte("nextRunAt", 0).lte("nextRunAt", now))
      .take(100);
    return rows.map((row) => row._id);
  },
});

async function refresh(ctx: ActionCtx, integrationId: Id<"integrations">) {
  const stored = await ctx.runQuery(internal.integrations.forRun, { integrationId });
  if (stored === null) return;
  const kind = kindFor(stored);
  if (kind.refresh === undefined) return;
  try {
    const now = Date.now();
    const result = await kind.refresh({
      ctx,
      settings: await openSecrets(kind, stored.settings),
      now,
    });
    await ctx.runMutation(internal.integrations.saveRefresh, { integrationId, ...result });
  } catch (error) {
    await ctx.runMutation(internal.integrations.saveFailure, {
      integrationId,
      error: errorText(error),
      permanent: error instanceof IntegrationError && error.permanent,
    });
  }
}

export const refreshOne = internalAction({
  args: { integrationId: v.id("integrations") },
  handler: async (ctx, { integrationId }) => await refresh(ctx, integrationId),
});

// Run every minute by the cron in crons.ts.
export const refreshDue = internalAction({
  args: {},
  handler: async (ctx) => {
    const ids: Id<"integrations">[] = await ctx.runQuery(internal.integrations.due, {
      now: Date.now(),
    });
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(REFRESH_CONCURRENCY, ids.length) }, async () => {
        while (next < ids.length) await refresh(ctx, ids[next++]);
      }),
    );
  },
});

// A lock screen action (lockscreen:act): run it, then refresh so the phone
// sees the result.
export const runAct = internalAction({
  args: {
    integrationId: v.id("integrations"),
    pageId: v.string(),
    actionId: v.string(),
    undo: v.boolean(),
  },
  handler: async (ctx, { integrationId, pageId, actionId, undo }) => {
    const stored = await ctx.runQuery(internal.integrations.forRun, { integrationId });
    if (stored === null) return;
    const kind = kindFor(stored);
    if (kind.act === undefined) return;
    try {
      const settings = await openSecrets(kind, stored.settings);
      await kind.act({ ctx, settings, now: Date.now(), pageId, actionId, undo });
    } catch (error) {
      console.warn(`Lock screen action failed: ${errorText(error)}`);
    }
    await refresh(ctx, integrationId);
  },
});

export const runRemove = internalAction({
  args: { kind: kindValidator, settings: v.any() },
  handler: async (ctx, { kind: kindName, settings }) => {
    const kind = KINDS[kindName];
    try {
      await kind.onRemove?.({ ctx, settings: await openSecrets(kind, settings), now: Date.now() });
    } catch (error) {
      console.warn(`Cleanup after removing an integration failed: ${errorText(error)}`);
    }
  },
});

// A provider called /hooks/... (http.ts). Returns an HTTP status.
export const inbound = internalMutation({
  // payload: the request body (string or parsed JSON); null for DELETE.
  args: { kind: kindValidator, webhookToken: v.string(), payload: v.any(), minutes: v.number() },
  handler: async (ctx, { kind: kindName, webhookToken, payload, minutes }) => {
    const integration = await ctx.db
      .query("integrations")
      .withIndex("by_webhookToken", (q) => q.eq("webhookToken", webhookToken))
      .unique();
    const kind = KINDS[kindName];
    if (integration === null || integration.kind !== kindName || kind.inbound === undefined) {
      return { status: 404, error: "Unknown webhook" };
    }
    const now = Date.now();
    const tooSoon =
      integration.lastPushAt !== undefined &&
      now - integration.lastPushAt < kind.inbound.minIntervalMs;
    let result;
    try {
      result = kind.inbound.handle({ payload, minutes, now });
    } catch (error) {
      if (error instanceof CardError) return { status: 400, error: error.message };
      throw error;
    }
    if (result.kind === "refresh") {
      // A burst of notifications shares one refresh, a moment later so the
      // provider has finished its changes.
      if (!tooSoon) {
        await ctx.db.patch(integration._id, { lastPushAt: now });
        await ctx.scheduler.runAfter(2_000, internal.integrations.refreshOne, {
          integrationId: integration._id,
        });
      }
      return { status: 200, error: null };
    }
    if (tooSoon) return { status: 429, error: "Too many requests; wait a few seconds" };
    await ctx.db.patch(integration._id, { lastPushAt: now });
    await setCard(ctx, integration, result.content, result.expiresAt);
    return { status: 200, error: null };
  },
});

// Before kinds/: settings were stored in kind-specific fields. Moves them
// into `settings`. Run at backend start (docker/backend/entrypoint.sh); a
// no-op once done.
export const migrateSettings = internalMutation({
  args: {},
  handler: async (ctx) => {
    let moved = 0;
    for (const row of await ctx.db.query("integrations").collect()) {
      if (row.settings !== undefined) continue;
      let settings: Settings;
      if (row.kind === "weather" && row.weather) {
        settings = { place: row.label.replace(/^Weather · /, "").slice(0, 30), ...row.weather };
      } else if (row.kind === "habitica" && row.habitica) {
        settings = { ...row.habitica };
      } else {
        settings = { name: row.label };
      }
      await ctx.db.patch(row._id, { settings, weather: undefined, habitica: undefined });
      moved++;
    }
    return moved;
  },
});

// Existing deployments stored one-line glances before cards existed. Run at
// backend start (docker/backend/entrypoint.sh); a no-op once they are gone.
export const migrateGlances = internalMutation({
  args: {},
  handler: async (ctx) => {
    const glances = await ctx.db.query("glances").take(500);
    for (const glance of glances) {
      const integration = await ctx.db.get(glance.integrationId);
      if (integration !== null && glance.expiresAt > Date.now()) {
        await setCard(ctx, integration, textContent(glance.text), glance.expiresAt);
      }
      await ctx.db.delete(glance._id);
    }
    return glances.length;
  },
});
