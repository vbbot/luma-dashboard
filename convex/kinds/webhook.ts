import { CardError, LIMITS, type CardContent, textContent, validateContent } from "../cards";
import { SettingsError, defineKind } from "./types";

// A secret address that anything (Home Assistant, a Shortcut, a script) can
// POST a line, several lines or a full card to (http.ts). Webhook cards cannot
// carry actions: those would make the server call back to an address the
// sender chose.

export const WEBHOOK_DEFAULT_MINUTES = 60;
export const WEBHOOK_MAX_MINUTES = 7 * 24 * 60;

type WebhookSettings = { name: string };

function content(payload: unknown): CardContent {
  if (typeof payload === "string")
    return validateContent(textContent(payload), { allowActions: false });
  const body = (payload ?? {}) as Record<string, unknown>;
  if (body.card !== undefined) return validateContent(body.card, { allowActions: false });
  if (body.lines !== undefined) {
    if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > LIMITS.pages) {
      throw new CardError(`lines: must have 1-${LIMITS.pages} lines`);
    }
    const lines = body.lines.map((text, index) => {
      if (typeof text !== "string") throw new CardError(`lines[${index}]: must be a string`);
      return text;
    });
    const title = typeof body.title === "string" ? body.title : undefined;
    return validateContent(
      {
        title,
        fallback: lines.length === 1 ? lines[0] : `${title ?? "Lines"}: ${lines.length}`,
        size: lines.length > 1 ? "regular" : "compact",
        pages: lines.map((text, index) => ({ id: `${index}`, blocks: [{ type: "text", text }] })),
      },
      { allowActions: false },
    );
  }
  if (typeof body.text !== "string") throw new CardError(`text, lines or card is required`);
  return validateContent(textContent(body.text), { allowActions: false });
}

export const webhook = defineKind<WebhookSettings>({
  kind: "webhook",
  allowActions: false,

  parseSettings(value) {
    const name = (value as { name?: unknown } | null)?.name;
    if (typeof name !== "string" || name.trim() === "" || name.trim().length > 40) {
      throw new SettingsError("Name must be 1-40 characters");
    }
    return { name: name.trim() };
  },

  label: ({ name }) => name,

  inbound: {
    minIntervalMs: 5_000,
    handle({ payload, minutes, now }) {
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > WEBHOOK_MAX_MINUTES) {
        throw new CardError(`minutes must be 1-${WEBHOOK_MAX_MINUTES}`);
      }
      return {
        kind: "card",
        content: payload === null ? null : content(payload),
        expiresAt: now + minutes * 60_000,
      };
    },
  },
});
