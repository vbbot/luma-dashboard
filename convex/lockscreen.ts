import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { findAccount } from "./accounts";
import { type Card, forClient } from "./cards";

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
