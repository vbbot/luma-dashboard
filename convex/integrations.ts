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
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { findAccount } from "./accounts";
import {
  type Conditions,
  cacheKey,
  forecastUrl,
  formatConditions,
  geocodingUrl,
  parseForecast,
  parsePlaces,
} from "./weather";

// Lock screen integrations. Each one produces a glance: one short line of
// text that Luma shows under the lock screen clock (see glances.ts).
//
//   weather  Refreshed here every WEATHER_REFRESH_MS from Open-Meteo.
//   webhook  Anything can POST a line to its secret URL (see http.ts).

export const MAX_INTEGRATIONS = 5;
export const MAX_GLANCE_LENGTH = 60;
export const MAX_LABEL_LENGTH = 40;

const WEATHER_REFRESH_MS = 30 * 60_000;
const WEATHER_CACHE_MS = 15 * 60_000;
// Long enough to ride out a few failed refreshes, short enough that old
// weather does not linger.
const WEATHER_GLANCE_TTL_MS = 3 * 60 * 60_000;
const MAX_BACKOFF_MS = 6 * 60 * 60_000;

export const WEBHOOK_DEFAULT_MINUTES = 60;
export const WEBHOOK_MAX_MINUTES = 7 * 24 * 60;
// Minimum time between pushes to one webhook.
const WEBHOOK_MIN_INTERVAL_MS = 5_000;

const units = v.union(v.literal("celsius"), v.literal("fahrenheit"));

async function requireAccount(ctx: QueryCtx, accountNumber: string) {
  const account = await findAccount(ctx, accountNumber);
  if (account === null) throw new Error("Account not found");
  return account;
}

async function requireIntegration(
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

function cleanLabel(label: string) {
  const trimmed = label.trim();
  if (trimmed === "" || trimmed.length > MAX_LABEL_LENGTH) {
    throw new Error(`Name must be 1-${MAX_LABEL_LENGTH} characters`);
  }
  return trimmed;
}

// Line breaks and runs of spaces collapse; Luma shows a single line.
export function cleanGlanceText(text: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned === "" || cleaned.length > MAX_GLANCE_LENGTH) {
    throw new Error(`Text must be 1-${MAX_GLANCE_LENGTH} characters`);
  }
  return cleaned;
}

async function insertIntegration(
  ctx: MutationCtx,
  account: Doc<"accounts">,
  fields: Omit<Doc<"integrations">, "_id" | "_creationTime" | "accountId" | "order">,
) {
  const existing = await ctx.db
    .query("integrations")
    .withIndex("by_account", (q) => q.eq("accountId", account._id))
    .collect();
  if (existing.length >= MAX_INTEGRATIONS) {
    throw new Error(`An account can have at most ${MAX_INTEGRATIONS} integrations`);
  }
  const order = Math.max(0, ...existing.map((row) => row.order)) + 1;
  return await ctx.db.insert("integrations", { accountId: account._id, order, ...fields });
}

export async function setGlance(
  ctx: MutationCtx,
  integration: Doc<"integrations">,
  text: string | null,
  expiresAt: number,
) {
  const existing = await ctx.db
    .query("glances")
    .withIndex("by_integration", (q) => q.eq("integrationId", integration._id))
    .unique();
  if (text === null) {
    if (existing) await ctx.db.delete(existing._id);
    return;
  }
  const fields = {
    integrationId: integration._id,
    accountId: integration.accountId,
    text,
    updatedAt: Date.now(),
    expiresAt,
  };
  if (existing) {
    await ctx.db.replace(existing._id, fields);
  } else {
    await ctx.db.insert("glances", fields);
  }
}

export async function deleteIntegration(ctx: MutationCtx, integration: Doc<"integrations">) {
  await setGlance(ctx, integration, null, 0);
  await ctx.db.delete(integration._id);
}

// Random 32-byte token, base64url. Generated in actions: randomness inside
// queries and mutations is seeded and must not be used for secrets.
function newWebhookToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export const WEBHOOK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

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
    const glances = await ctx.db
      .query("glances")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    return integrations
      .sort((a, b) => a.order - b.order)
      .map((integration) => {
        const glance = glances.find((row) => row.integrationId === integration._id);
        return {
          integrationId: integration._id,
          kind: integration.kind,
          label: integration.label,
          units: integration.weather?.units,
          webhookToken: integration.webhookToken,
          lastError: integration.lastError,
          glance: glance ? { text: glance.text, expiresAt: glance.expiresAt } : null,
        };
      });
  },
});

export const searchPlaces = action({
  args: { accountNumber: v.string(), query: v.string() },
  handler: async (ctx, { accountNumber, query: search }) => {
    const trimmed = search.trim();
    if (trimmed.length < 2 || trimmed.length > 80) return [];
    if (!(await ctx.runQuery(internal.integrations.accountExists, { accountNumber }))) {
      throw new Error("Account not found");
    }
    const response = await fetch(geocodingUrl(trimmed));
    if (!response.ok) throw new Error(`Place search failed: HTTP ${response.status}`);
    return parsePlaces(await response.json());
  },
});

export const addWeather = mutation({
  args: {
    accountNumber: v.string(),
    label: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    units,
  },
  handler: async (ctx, { accountNumber, label, latitude, longitude, units }) => {
    const account = await requireAccount(ctx, accountNumber);
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error("Invalid location");
    await insertIntegration(ctx, account, {
      kind: "weather",
      label: cleanLabel(label),
      weather: { latitude, longitude, units },
      nextRunAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.integrations.refreshDue, {});
  },
});

export const setWeatherUnits = mutation({
  args: { accountNumber: v.string(), integrationId: v.id("integrations"), units },
  handler: async (ctx, { accountNumber, integrationId, units }) => {
    const integration = await requireIntegration(ctx, accountNumber, integrationId);
    if (integration.weather === undefined) throw new Error("Not a weather integration");
    await ctx.db.patch(integration._id, {
      weather: { ...integration.weather, units },
      nextRunAt: Date.now(),
      failures: 0,
    });
    await ctx.scheduler.runAfter(0, internal.integrations.refreshDue, {});
  },
});

export const addWebhook = action({
  args: { accountNumber: v.string(), label: v.string() },
  handler: async (ctx, args): Promise<Id<"integrations">> =>
    await ctx.runMutation(internal.integrations.insertWebhook, {
      ...args,
      webhookToken: newWebhookToken(),
    }),
});

export const rotateWebhook = action({
  args: { accountNumber: v.string(), integrationId: v.id("integrations") },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.integrations.replaceWebhookToken, {
      ...args,
      webhookToken: newWebhookToken(),
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

// ---------------------------------------------------------------------------
// Internal.
// ---------------------------------------------------------------------------

export const accountExists = internalQuery({
  args: { accountNumber: v.string() },
  handler: async (ctx, { accountNumber }) => (await findAccount(ctx, accountNumber)) !== null,
});

export const insertWebhook = internalMutation({
  args: { accountNumber: v.string(), label: v.string(), webhookToken: v.string() },
  handler: async (ctx, { accountNumber, label, webhookToken }) =>
    await insertIntegration(ctx, await requireAccount(ctx, accountNumber), {
      kind: "webhook",
      label: cleanLabel(label),
      webhookToken,
    }),
});

export const replaceWebhookToken = internalMutation({
  args: {
    accountNumber: v.string(),
    integrationId: v.id("integrations"),
    webhookToken: v.string(),
  },
  handler: async (ctx, { accountNumber, integrationId, webhookToken }) => {
    const integration = await requireIntegration(ctx, accountNumber, integrationId);
    if (integration.kind !== "webhook") throw new Error("Not a webhook integration");
    await ctx.db.patch(integration._id, { webhookToken });
  },
});

// Called by http.ts. Returns an HTTP status for the caller.
export const pushWebhook = internalMutation({
  args: { webhookToken: v.string(), text: v.union(v.string(), v.null()), minutes: v.number() },
  handler: async (ctx, { webhookToken, text, minutes }) => {
    const integration = await ctx.db
      .query("integrations")
      .withIndex("by_webhookToken", (q) => q.eq("webhookToken", webhookToken))
      .unique();
    if (integration === null) return { status: 404, error: "Unknown webhook" };
    const now = Date.now();
    if (
      integration.lastPushAt !== undefined &&
      now - integration.lastPushAt < WEBHOOK_MIN_INTERVAL_MS
    ) {
      return { status: 429, error: "Too many requests; wait a few seconds" };
    }
    let cleaned: string | null = null;
    if (text !== null) {
      try {
        cleaned = cleanGlanceText(text);
      } catch (error) {
        return { status: 400, error: (error as Error).message };
      }
    }
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > WEBHOOK_MAX_MINUTES) {
      return { status: 400, error: `minutes must be 1-${WEBHOOK_MAX_MINUTES}` };
    }
    await ctx.db.patch(integration._id, { lastPushAt: now });
    await setGlance(ctx, integration, cleaned, now + minutes * 60_000);
    return { status: 200, error: null };
  },
});

// Weather refreshes. The cron in crons.ts runs this every few minutes; adding
// or changing a weather integration runs it straight away.

type DueWeather = {
  integrationId: Id<"integrations">;
  latitude: number;
  longitude: number;
  units: "celsius" | "fahrenheit";
  failures: number;
};

// The caller passes the time: a query that reads Date.now() itself can be
// served from cache and miss rows that became due since.
export const dueWeather = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }): Promise<DueWeather[]> => {
    const rows = await ctx.db
      .query("integrations")
      // Push-only kinds have no nextRunAt, and missing values sort first.
      .withIndex("by_nextRunAt", (q) => q.gte("nextRunAt", 0).lte("nextRunAt", now))
      .take(200);
    return rows.flatMap((row) =>
      row.kind === "weather" && row.weather !== undefined && row.nextRunAt !== undefined
        ? [{ integrationId: row._id, ...row.weather, failures: row.failures ?? 0 }]
        : [],
    );
  },
});

export const cachedWeather = internalQuery({
  args: { keys: v.array(v.string()), now: v.number() },
  handler: async (ctx, { keys, now }) => {
    const rows = await Promise.all(
      keys.map((key) =>
        ctx.db
          .query("weatherCache")
          .withIndex("by_key", (q) => q.eq("key", key))
          .unique(),
      ),
    );
    return rows.flatMap((row) => (row && now - row.fetchedAt < WEATHER_CACHE_MS ? [row] : []));
  },
});

const conditions = v.object({
  temperature: v.number(),
  weatherCode: v.number(),
  high: v.number(),
  low: v.number(),
});

export const refreshDue = internalAction({
  args: {},
  handler: async (ctx) => {
    const due: DueWeather[] = await ctx.runQuery(internal.integrations.dueWeather, {
      now: Date.now(),
    });
    if (due.length === 0) return;

    const keys = [...new Set(due.map((row) => cacheKey(row.latitude, row.longitude, row.units)))];
    const cached: (Conditions & { key: string })[] = await ctx.runQuery(
      internal.integrations.cachedWeather,
      { keys, now: Date.now() },
    );
    const results = new Map<string, Conditions | string>(cached.map((row) => [row.key, row]));
    const fetched: (Conditions & { key: string })[] = [];
    for (const key of keys.filter((key) => !results.has(key))) {
      const sample = due.find((row) => cacheKey(row.latitude, row.longitude, row.units) === key)!;
      try {
        const response = await fetch(forecastUrl(sample.latitude, sample.longitude, sample.units));
        if (!response.ok) throw new Error(`Open-Meteo: HTTP ${response.status}`);
        const result = parseForecast(await response.json());
        results.set(key, result);
        fetched.push({ key, ...result });
      } catch (error) {
        results.set(key, error instanceof Error ? error.message : String(error));
      }
    }

    await ctx.runMutation(internal.integrations.saveWeather, {
      fetched,
      updates: due.map((row) => {
        const result = results.get(cacheKey(row.latitude, row.longitude, row.units))!;
        return typeof result === "string"
          ? { integrationId: row.integrationId, failures: row.failures, error: result }
          : {
              integrationId: row.integrationId,
              failures: row.failures,
              text: formatConditions(result),
            };
      }),
    });
  },
});

export const saveWeather = internalMutation({
  args: {
    fetched: v.array(v.object({ key: v.string(), ...conditions.fields })),
    updates: v.array(
      v.object({
        integrationId: v.id("integrations"),
        failures: v.number(),
        text: v.optional(v.string()),
        error: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { fetched, updates }) => {
    const now = Date.now();
    for (const row of fetched) {
      const existing = await ctx.db
        .query("weatherCache")
        .withIndex("by_key", (q) => q.eq("key", row.key))
        .unique();
      const fields = { ...row, fetchedAt: now };
      if (existing) await ctx.db.replace(existing._id, fields);
      else await ctx.db.insert("weatherCache", fields);
    }
    for (const update of updates) {
      // Removed while the refresh was running.
      const integration = await ctx.db.get(update.integrationId);
      if (integration === null) continue;
      if (update.text !== undefined) {
        await ctx.db.patch(integration._id, {
          nextRunAt: now + WEATHER_REFRESH_MS,
          failures: 0,
          lastError: undefined,
        });
        await setGlance(ctx, integration, update.text, now + WEATHER_GLANCE_TTL_MS);
      } else {
        const failures = update.failures + 1;
        await ctx.db.patch(integration._id, {
          nextRunAt: now + Math.min(WEATHER_REFRESH_MS * 2 ** (failures - 1), MAX_BACKOFF_MS),
          failures,
          lastError: update.error,
        });
      }
    }
  },
});
