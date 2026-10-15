import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { findAccount } from "./accounts";

const MAX_MESSAGE_LENGTH = 280;

// Called by the Luma launcher. Returns the newest message for the account;
// the launcher itself hides it once expiresAt has passed (queries cannot
// depend on the current time without going stale).
export const getCurrentForDevice = query({
  args: { accountNumber: v.string() },
  handler: async (ctx, { accountNumber }) => {
    const account = await findAccount(ctx, accountNumber);
    if (account === null) {
      return null;
    }
    const message = await ctx.db
      .query("lockscreenMessages")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .order("desc")
      .first();
    if (message === null) {
      return null;
    }
    return { messageId: message._id, text: message.text, expiresAt: message.expiresAt };
  },
});

export const send = mutation({
  args: { accountNumber: v.string(), text: v.string(), durationMinutes: v.number() },
  handler: async (ctx, { accountNumber, text, durationMinutes }) => {
    const account = await findAccount(ctx, accountNumber);
    if (account === null) {
      throw new Error("Account not found");
    }
    const trimmed = text.trim();
    if (trimmed === "" || trimmed.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message must be 1-${MAX_MESSAGE_LENGTH} characters`);
    }
    if (!(durationMinutes > 0)) {
      throw new Error("Duration must be positive");
    }

    // Keep only the latest message per account.
    const previous = await ctx.db
      .query("lockscreenMessages")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    for (const row of previous) {
      await ctx.db.delete(row._id);
    }

    await ctx.db.insert("lockscreenMessages", {
      accountId: account._id,
      text: trimmed,
      expiresAt: Date.now() + durationMinutes * 60_000,
    });
  },
});

export const clear = mutation({
  args: { accountNumber: v.string() },
  handler: async (ctx, { accountNumber }) => {
    const account = await findAccount(ctx, accountNumber);
    if (account === null) {
      return;
    }
    const rows = await ctx.db
      .query("lockscreenMessages")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  },
});
