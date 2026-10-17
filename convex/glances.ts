import { v } from "convex/values";
import { query } from "./_generated/server";
import { findAccount } from "./accounts";

// Called by Luma 2.0.23+: the lines its integrations currently show, in
// lock screen order. Luma drops expired ones itself (queries cannot depend on
// the current time without going stale) and shows the first two.
export const getForDevice = query({
  args: { accountNumber: v.string() },
  handler: async (ctx, { accountNumber }) => {
    const account = await findAccount(ctx, accountNumber);
    if (account === null) return [];
    const integrations = await ctx.db
      .query("integrations")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    const order = new Map(integrations.map((row) => [row._id, row.order]));
    const glances = await ctx.db
      .query("glances")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    return glances
      .sort((a, b) => (order.get(a.integrationId) ?? 0) - (order.get(b.integrationId) ?? 0))
      .map((glance) => ({
        glanceId: glance.integrationId,
        text: glance.text,
        expiresAt: glance.expiresAt,
      }));
  },
});
