import { v } from "convex/values";
import { action, type MutationCtx } from "./_generated/server";
import { createChallenge, randomInt, verifySolution } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/web/pbkdf2";

// ALTCHA proof-of-work captcha (https://altcha.org) for the login and create
// account forms. The browser spends about a second deriving a key; the
// backend checks it with two HMACs. ALTCHA_HMAC_KEY is set by the backend
// container from INSTANCE_SECRET; for `convex dev` set it with
// `npx convex env set ALTCHA_HMAC_KEY <random string>`.

declare const process: { env: Record<string, string | undefined> };

const CHALLENGE_TTL_SECONDS = 10 * 60;

function secrets() {
  const key = process.env.ALTCHA_HMAC_KEY;
  if (!key) throw new Error("ALTCHA_HMAC_KEY is not set on the deployment");
  return { hmacSignatureSecret: `${key}:challenge`, hmacKeySignatureSecret: `${key}:key` };
}

export const challenge = action({
  args: {},
  handler: async () =>
    await createChallenge({
      algorithm: "PBKDF2/SHA-256",
      cost: 5_000,
      counter: randomInt(5_000, 10_000),
      expiresAt: Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS,
      deriveKey,
      ...secrets(),
    }),
});

export const captchaPayload = v.object({
  challenge: v.object({
    parameters: v.object({
      algorithm: v.string(),
      nonce: v.string(),
      salt: v.string(),
      cost: v.number(),
      keyLength: v.number(),
      keyPrefix: v.string(),
      keySignature: v.optional(v.string()),
      memoryCost: v.optional(v.number()),
      parallelism: v.optional(v.number()),
      expiresAt: v.optional(v.number()),
      data: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()))),
    }),
    signature: v.optional(v.string()),
  }),
  solution: v.object({
    counter: v.number(),
    derivedKey: v.string(),
    time: v.optional(v.number()),
  }),
});

export type CaptchaPayload = typeof captchaPayload.type;

// Throws unless the payload solves a challenge issued by challenge() that has
// not expired and has not been used before.
export async function requireCaptcha(ctx: MutationCtx, payload: CaptchaPayload) {
  const { parameters, signature } = payload.challenge;
  // Only accept the challenges this deployment issues, with the key signature
  // that lets verifySolution skip re-deriving the key.
  if (!parameters.keySignature || !parameters.expiresAt) throw new Error("Captcha failed");
  const result = await verifySolution({
    challenge: payload.challenge,
    solution: payload.solution,
    deriveKey,
    ...secrets(),
  });
  if (!result.verified || !signature) throw new Error("Captcha failed");

  const now = Date.now();
  if (
    await ctx.db
      .query("usedCaptchas")
      .withIndex("by_signature", (q) => q.eq("signature", signature))
      .unique()
  ) {
    throw new Error("Captcha failed");
  }
  await ctx.db.insert("usedCaptchas", { signature, expiresAt: parameters.expiresAt * 1000 });

  // Forget challenges that can no longer be replayed anyway.
  const expired = await ctx.db
    .query("usedCaptchas")
    .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
    .take(50);
  for (const row of expired) await ctx.db.delete(row._id);
}
