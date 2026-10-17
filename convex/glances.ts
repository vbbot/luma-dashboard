import { v } from "convex/values";
import { query } from "./_generated/server";
import { findAccount } from "./accounts";
import { cardsInOrder } from "./lockscreen";

// The first integrations build of Luma (one line per integration). Newer
// builds call lockscreen:getForDevice; this returns each card's fallback.
export const getForDevice = query({
  args: { accountNumber: v.string() },
  handler: async (ctx, { accountNumber }) => {
    const account = await findAccount(ctx, accountNumber);
    if (account === null) return [];
    return (await cardsInOrder(ctx, account)).map((card) => ({
      glanceId: card.id,
      text: card.fallback,
      expiresAt: card.expiresAt,
    }));
  },
});
