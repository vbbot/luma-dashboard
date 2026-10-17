import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { MAX_GLANCE_LENGTH, WEBHOOK_DEFAULT_MINUTES, WEBHOOK_TOKEN_PATTERN } from "./integrations";

// Webhook integrations: POST a line to show it on the lock screen, DELETE to
// clear it. The public nginx proxy forwards only /hooks/ here.
//
//   curl -d "Bins out tonight" https://<dashboard>/hooks/<token>
//   curl -H "Content-Type: application/json" \
//     -d '{"text": "Bins out tonight", "minutes": 120}' https://<dashboard>/hooks/<token>
//   curl -X DELETE https://<dashboard>/hooks/<token>

const MAX_BODY_BYTES = 4096;

function reply(status: number, error: string | null) {
  return new Response(JSON.stringify(error === null ? { ok: true } : { ok: false, error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function readBody(request: Request): Promise<{ text: string; minutes: number } | string> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return "Body too large";
  if (!(request.headers.get("Content-Type") ?? "").includes("application/json")) {
    return { text: raw, minutes: WEBHOOK_DEFAULT_MINUTES };
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return "Invalid JSON";
  }
  const { text, minutes = WEBHOOK_DEFAULT_MINUTES } = (body ?? {}) as Record<string, unknown>;
  if (typeof text !== "string")
    return `"text" must be a string of up to ${MAX_GLANCE_LENGTH} characters`;
  if (typeof minutes !== "number") return `"minutes" must be a number`;
  return { text, minutes };
}

const hook = httpAction(async (ctx, request) => {
  const webhookToken = new URL(request.url).pathname.slice("/hooks/".length);
  if (!WEBHOOK_TOKEN_PATTERN.test(webhookToken)) return reply(404, "Unknown webhook");

  let text: string | null = null;
  let minutes = WEBHOOK_DEFAULT_MINUTES;
  if (request.method === "POST") {
    const body = await readBody(request);
    if (typeof body === "string") return reply(400, body);
    ({ text, minutes } = body);
  }
  const result = await ctx.runMutation(internal.integrations.pushWebhook, {
    webhookToken,
    text,
    minutes,
  });
  return reply(result.status, result.error);
});

const http = httpRouter();
http.route({ pathPrefix: "/hooks/", method: "POST", handler: hook });
http.route({ pathPrefix: "/hooks/", method: "DELETE", handler: hook });
export default http;
