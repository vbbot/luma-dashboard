import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// Open-Meteo results shared by every weather integration at the same rounded
// place and units (kinds/weather.ts).

const CACHE_MS = 15 * 60_000;

const conditions = {
  temperature: v.number(),
  weatherCode: v.number(),
  high: v.number(),
  low: v.number(),
};

// The caller passes the time: a query that reads Date.now() itself can be
// served from cache and return results that have since gone stale.
export const get = internalQuery({
  args: { key: v.string(), now: v.number() },
  handler: async (ctx, { key, now }) => {
    const row = await ctx.db
      .query("weatherCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    return row && now - row.fetchedAt < CACHE_MS ? row : null;
  },
});

export const put = internalMutation({
  args: { key: v.string(), ...conditions },
  handler: async (ctx, row) => {
    const existing = await ctx.db
      .query("weatherCache")
      .withIndex("by_key", (q) => q.eq("key", row.key))
      .unique();
    const fields = { ...row, fetchedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, fields);
    else await ctx.db.insert("weatherCache", fields);
  },
});
