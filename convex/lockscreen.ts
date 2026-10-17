import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { findAccount } from "./accounts";
import { type Card, forClient } from "./cards";
import { kindOf } from "./kinds";

const ACTION_MEMORY_MS = 24 * 60 * 60_000;

// Cards for the account in lock screen order (docs/lockscreen-cards.md).
// Expired cards are left for the client to drop: queries cannot depend on the
// current time without going stale.
export async function cardsInOrder(ctx: QueryCtx, account: Doc<"accounts">): Promise<Card[]> {
  const integrations = await ctx.db
    .query("integrations")
    .withIndex("by_account", (q) => q.eq("accountId", account._id))
    .collect();
  const order = new Map(integrations.map((row) => [row._id, row.order]));
  const rows = await ctx.db
    .query("cards")
    .withIndex("by_account", (q) => q.eq("accountId", account._id))
    .collect();
  return rows
    .sort((a, b) => (order.get(a.integrationId) ?? 0) - (order.get(b.integrationId) ?? 0))
    .map((row) => row.card as Card);
}

// Called by Luma. protocol: the highest card schema it understands; blocks:
// the block types it draws. Cards using more come back as their fallback.
export const getForDevice = query({
  args: { accountNumber: v.string(), protocol: v.number(), blocks: v.array(v.string()) },
  handler: async (ctx, { accountNumber, protocol, blocks }) => {
    const account = await findAccount(ctx, accountNumber);
    if (account === null) return [];
    return (await cardsInOrder(ctx, account)).map((card) => forClient(card, protocol, blocks));
  },
});

// Called by Luma when a card's primary action is long-pressed, or pressed
// again to undo. requestId is random per press: a retry of the same press is
// accepted but not run twice.
export const act = mutation({
  args: {
    accountNumber: v.string(),
    cardId: v.string(),
    pageId: v.string(),
    actionId: v.string(),
    undo: v.boolean(),
    requestId: v.string(),
  },
  handler: async (ctx, { accountNumber, cardId, pageId, actionId, undo, requestId }) => {
    const account = await findAccount(ctx, accountNumber);
    if (account === null) throw new Error("Account not found");
    if (!/^[A-Za-z0-9-]{8,64}$/.test(requestId)) throw new Error("Invalid request");
    const seen = await ctx.db
      .query("cardActions")
      .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
      .unique();
    if (seen !== null) return;

    const integrationId = ctx.db.normalizeId("integrations", cardId);
    const integration = integrationId === null ? null : await ctx.db.get(integrationId);
    if (integration === null || integration.accountId !== account._id) {
      throw new Error("Card not found");
    }
    if (!kindOf(integration.kind)?.allowActions) throw new Error("Action not available");
    if (!undo) {
      // The action has to be one the card offered; an undo may follow the
      // page disappearing (the task was completed).
      const row = await ctx.db
        .query("cards")
        .withIndex("by_integration", (q) => q.eq("integrationId", integration._id))
        .unique();
      const page = (row?.card as Card | undefined)?.pages.find((entry) => entry.id === pageId);
      if (page?.primary?.id !== actionId) throw new Error("Action not available");
    }

    const now = Date.now();
    await ctx.db.insert("cardActions", { requestId, expiresAt: now + ACTION_MEMORY_MS });
    for (const old of await ctx.db
      .query("cardActions")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(50)) {
      await ctx.db.delete(old._id);
    }

    // The integration's kind does the work (kinds/), then refreshes the card.
    await ctx.scheduler.runAfter(0, internal.integrations.runAct, {
      integrationId: integration._id,
      pageId,
      actionId,
      undo,
    });
  },
});
