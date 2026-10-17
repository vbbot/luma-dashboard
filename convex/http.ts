import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { WEBHOOK_TOKEN_PATTERN } from "./integrations";
import { WEBHOOK_DEFAULT_MINUTES } from "./kinds/webhook";

// Webhook integrations: POST a line or a card to show it on the lock screen,
// DELETE to clear it. The public nginx proxy forwards only /hooks/ here.
// Body formats: docs/lockscreen-cards.md.
//
//   curl -d "Bins out tonight" https://<dashboard>/hooks/<token>
//   curl -H "Content-Type: application/json" \
//     -d '{"title": "Windows open", "lines": ["Kitchen", "Bedroom"], "minutes": 30}' \
//     https://<dashboard>/hooks/<token>
//   curl -X DELETE https://<dashboard>/hooks/<token>

const MAX_BODY_BYTES = 4096;

function reply(status: number, error: string | null) {
  return new Response(JSON.stringify(error === null ? { ok: true } : { ok: false, error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function readBody(request: Request): Promise<{ payload: unknown; minutes: number } | string> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return "Body too large";
  if (!(request.headers.get("Content-Type") ?? "").includes("application/json")) {
    return { payload: raw, minutes: WEBHOOK_DEFAULT_MINUTES };
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return "Invalid JSON";
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return "Body must be a JSON object";
  const { minutes = WEBHOOK_DEFAULT_MINUTES, ...payload } = body as Record<string, unknown>;
  if (typeof minutes !== "number") return `"minutes" must be a number`;
  return { payload, minutes };
}

// /hooks/<token> and /hooks/webhook/<token>: a generic webhook card.
// /hooks/habitica/<token>: Habitica telling a connection that tasks changed.
const hook = httpAction(async (ctx, request) => {
  const parts = new URL(request.url).pathname.slice("/hooks/".length).split("/");
  const [kind, webhookToken] = parts.length === 1 ? ["webhook", parts[0]] : parts;
  if (parts.length > 2 || !WEBHOOK_TOKEN_PATTERN.test(webhookToken))
    return reply(404, "Unknown webhook");
  if (kind === "habitica") {
    if (request.method !== "POST") return reply(404, "Unknown webhook");
    const result = await ctx.runMutation(internal.connections.inbound, {
      provider: "habitica",
      webhookToken,
    });
    return reply(result.status, result.error);
  }
  if (kind !== "webhook") return reply(404, "Unknown webhook");

  let payload: unknown = null;
  let minutes = WEBHOOK_DEFAULT_MINUTES;
  if (request.method === "POST") {
    const body = await readBody(request);
    if (typeof body === "string") return reply(400, body);
    ({ payload, minutes } = body);
  }
  const result = await ctx.runMutation(internal.integrations.inbound, {
    kind: "webhook",
    webhookToken,
    payload,
    minutes,
  });
  return reply(result.status, result.error);
});

const http = httpRouter();
http.route({ pathPrefix: "/hooks/", method: "POST", handler: hook });
http.route({ pathPrefix: "/hooks/", method: "DELETE", handler: hook });
export default http;
