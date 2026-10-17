import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type ActionCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { decrypt, encrypt } from "./secrets";
import {
  HabiticaError,
  type HabiticaShow,
  buildHabiticaCard,
  fetchHabitica,
  habiticaRequest,
} from "./habiticaCards";
import {
  cleanLabel,
  insertIntegration,
  newWebhookToken,
  requireAccount,
  requireIntegration,
  setCard,
} from "./integrations";

// Habitica integration: stores the user's credentials (token encrypted),
// keeps the card current and scores tasks from the lock screen.
//
// Updates come from three places: Habitica's own webhook (taskActivity,
// registered when the integration is added) for changes made elsewhere, a
// refresh after every lock screen action, and a scheduled refresh every
// REFRESH_MS or sooner when time alone changes the card (a reminder, the
// day resetting).

declare const process: { env: Record<string, string | undefined> };

const REFRESH_MS = 15 * 60_000;
const MAX_BACKOFF_MS = 6 * 60 * 60_000;
// Webhook notifications closer together than this share one refresh.
const NOTIFY_INTERVAL_MS = 5_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const show = v.union(
  v.literal("dailies"),
  v.literal("todos"),
  v.literal("habits"),
  v.literal("stats"),
);

const LABELS: Record<HabiticaShow, string> = {
  dailies: "Habitica · Dailies",
  todos: "Habitica · To-Dos",
  habits: "Habitica · Habits",
  stats: "Habitica · Stats",
};

// Habitica can only notify a server it can reach over HTTPS.
function webhookUrl(token: string) {
  const base = process.env.PUBLIC_URL?.replace(/\/+$/, "");
  if (!base || !base.startsWith("https://")) return null;
  return `${base}/hooks/habitica/${token}`;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// --- Dashboard ----------------------------------------------------------------

export const add = action({
  args: { accountNumber: v.string(), userId: v.string(), apiToken: v.string(), show },
  handler: async (ctx, { accountNumber, userId, apiToken, show }): Promise<Id<"integrations">> => {
    userId = userId.trim();
    apiToken = apiToken.trim();
    if (!UUID.test(userId) || !UUID.test(apiToken)) {
      throw new Error(
        "The User ID and API Token are both in the form xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      );
    }
    // Check the credentials before storing anything.
    const { user, tasks } = await fetchHabitica(userId, apiToken);
    const webhookToken = newWebhookToken();
    const integrationId: Id<"integrations"> = await ctx.runMutation(internal.habitica.insert, {
      accountNumber,
      userId,
      apiToken: await encrypt(apiToken),
      show,
      webhookToken,
    });

    const url = webhookUrl(webhookToken);
    if (url !== null) {
      try {
        const webhook = await habiticaRequest<{ id: string }>(
          userId,
          apiToken,
          "POST",
          "/user/webhook",
          {
            url,
            label: "Luma lock screen",
            type: "taskActivity",
            options: { created: true, updated: true, deleted: true, scored: true },
          },
        );
        await ctx.runMutation(internal.habitica.setWebhookId, {
          integrationId,
          webhookId: webhook.id,
        });
      } catch (error) {
        // Scheduled refreshes still keep the card current.
        console.warn("Could not register the Habitica webhook", errorText(error));
      }
    }

    const card = buildHabiticaCard(show, tasks, user, Date.now());
    await ctx.runMutation(internal.habitica.saveCard, {
      integrationId,
      content: card.content,
      expiresAt: card.expiresAt,
      nextRunAt: Math.min(Date.now() + REFRESH_MS, card.rebuildAt),
    });
    return integrationId;
  },
});

export const setShow = mutation({
  args: { accountNumber: v.string(), integrationId: v.id("integrations"), show },
  handler: async (ctx, { accountNumber, integrationId, show }) => {
    const integration = await requireIntegration(ctx, accountNumber, integrationId);
    if (integration.habitica === undefined) throw new Error("Not a Habitica integration");
    await ctx.db.patch(integration._id, {
      habitica: { ...integration.habitica, show },
      label: LABELS[show],
      nextRunAt: Date.now(),
      failures: 0,
    });
    await ctx.scheduler.runAfter(0, internal.habitica.refreshOne, { integrationId });
  },
});

// --- Internal -------------------------------------------------------------------

export const insert = internalMutation({
  args: {
    accountNumber: v.string(),
    userId: v.string(),
    apiToken: v.string(),
    show,
    webhookToken: v.string(),
  },
  handler: async (ctx, { accountNumber, userId, apiToken, show, webhookToken }) =>
    await insertIntegration(ctx, await requireAccount(ctx, accountNumber), {
      kind: "habitica",
      label: cleanLabel(LABELS[show]),
      habitica: { userId, apiToken, show },
      webhookToken,
    }),
});

export const setWebhookId = internalMutation({
  args: { integrationId: v.id("integrations"), webhookId: v.string() },
  handler: async (ctx, { integrationId, webhookId }) => {
    const integration = await ctx.db.get(integrationId);
    if (integration?.habitica === undefined) return;
    await ctx.db.patch(integrationId, { habitica: { ...integration.habitica, webhookId } });
  },
});

export const forRefresh = internalQuery({
  args: { integrationId: v.id("integrations") },
  handler: async (ctx, { integrationId }) => {
    const integration = await ctx.db.get(integrationId);
    if (integration?.habitica === undefined) return null;
    return { ...integration.habitica, failures: integration.failures ?? 0 };
  },
});

export const saveCard = internalMutation({
  args: {
    integrationId: v.id("integrations"),
    content: v.any(),
    expiresAt: v.number(),
    nextRunAt: v.number(),
  },
  handler: async (ctx, { integrationId, content, expiresAt, nextRunAt }) => {
    const integration = await ctx.db.get(integrationId);
    // Removed while the refresh was running.
    if (integration === null) return;
    await ctx.db.patch(integrationId, { nextRunAt, failures: 0, lastError: undefined });
    await setCard(ctx, integration, content, expiresAt);
  },
});

export const saveError = internalMutation({
  args: { integrationId: v.id("integrations"), error: v.string(), rejected: v.boolean() },
  handler: async (ctx, { integrationId, error, rejected }) => {
    const integration = await ctx.db.get(integrationId);
    if (integration === null) return;
    const failures = (integration.failures ?? 0) + 1;
    await ctx.db.patch(integrationId, {
      failures,
      lastError: error,
      // Rejected credentials will not start working by retrying soon.
      nextRunAt:
        Date.now() +
        (rejected ? MAX_BACKOFF_MS : Math.min(REFRESH_MS * 2 ** (failures - 1), MAX_BACKOFF_MS)),
    });
  },
});

// Pass the time in: a query that read Date.now() itself could be served from
// cache and miss rows that became due since.
export const due = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const rows = await ctx.db
      .query("integrations")
      .withIndex("by_nextRunAt", (q) => q.gte("nextRunAt", 0).lte("nextRunAt", now))
      .take(200);
    return rows.filter((row) => row.kind === "habitica").map((row) => row._id);
  },
});

async function refresh(ctx: ActionCtx, integrationId: Id<"integrations">) {
  const stored = await ctx.runQuery(internal.habitica.forRefresh, { integrationId });
  if (stored === null) return;
  try {
    const { user, tasks } = await fetchHabitica(stored.userId, await decrypt(stored.apiToken));
    const now = Date.now();
    const card = buildHabiticaCard(stored.show, tasks, user, now);
    await ctx.runMutation(internal.habitica.saveCard, {
      integrationId,
      content: card.content,
      expiresAt: card.expiresAt,
      nextRunAt: Math.min(now + REFRESH_MS, card.rebuildAt),
    });
  } catch (error) {
    await ctx.runMutation(internal.habitica.saveError, {
      integrationId,
      error: errorText(error),
      rejected: error instanceof HabiticaError && error.status === 401,
    });
  }
}

export const refreshOne = internalAction({
  args: { integrationId: v.id("integrations") },
  handler: async (ctx, { integrationId }) => await refresh(ctx, integrationId),
});

// Run by the cron in crons.ts.
export const refreshDue = internalAction({
  args: {},
  handler: async (ctx) => {
    const ids: Id<"integrations">[] = await ctx.runQuery(internal.habitica.due, {
      now: Date.now(),
    });
    // One at a time: Habitica allows 30 requests a minute per user, and a
    // refresh makes two.
    for (const integrationId of ids) await refresh(ctx, integrationId);
  },
});

// Habitica's webhook arrived (http.ts): something changed there.
export const notified = internalMutation({
  args: { webhookToken: v.string() },
  handler: async (ctx, { webhookToken }) => {
    const integration = await ctx.db
      .query("integrations")
      .withIndex("by_webhookToken", (q) => q.eq("webhookToken", webhookToken))
      .unique();
    if (integration === null || integration.kind !== "habitica") return false;
    const now = Date.now();
    if (integration.lastPushAt !== undefined && now - integration.lastPushAt < NOTIFY_INTERVAL_MS) {
      return true;
    }
    await ctx.db.patch(integration._id, { lastPushAt: now });
    // A short delay lets a burst of changes (e.g. ticking several tasks)
    // land before the refresh reads them.
    await ctx.scheduler.runAfter(2_000, internal.habitica.refreshOne, {
      integrationId: integration._id,
    });
    return true;
  },
});

// A lock screen action (lockscreen:act): score the task, then refresh so the
// phone sees the result.
export const score = internalAction({
  args: {
    integrationId: v.id("integrations"),
    taskId: v.string(),
    direction: v.union(v.literal("up"), v.literal("down")),
  },
  handler: async (ctx, { integrationId, taskId, direction }) => {
    const stored = await ctx.runQuery(internal.habitica.forRefresh, { integrationId });
    if (stored === null) return;
    try {
      await habiticaRequest(
        stored.userId,
        await decrypt(stored.apiToken),
        "POST",
        `/tasks/${encodeURIComponent(taskId)}/score/${direction}`,
      );
    } catch (error) {
      await ctx.runMutation(internal.habitica.saveError, {
        integrationId,
        error: errorText(error),
        rejected: error instanceof HabiticaError && error.status === 401,
      });
    }
    await refresh(ctx, integrationId);
  },
});

export const deleteWebhook = internalAction({
  args: { userId: v.string(), apiToken: v.string(), webhookId: v.string() },
  handler: async (_ctx, { userId, apiToken, webhookId }) => {
    try {
      await habiticaRequest(
        userId,
        await decrypt(apiToken),
        "DELETE",
        `/user/webhook/${encodeURIComponent(webhookId)}`,
      );
    } catch (error) {
      console.warn("Could not remove the Habitica webhook", errorText(error));
    }
  },
});
