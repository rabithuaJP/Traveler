import { json } from "./src/http.ts";
import { hmacSha256Hex, timingSafeEqual } from "./src/hmac.ts";
import { ok, openclawInvoke } from "./src/openclaw.ts";

const PORT = Number(Deno.env.get("PORT") ?? "8788");
const WEBHOOK_PATH = (Deno.env.get("WEBHOOK_PATH") ?? "/webhook").trim();

const SHARED_SECRET = (Deno.env.get("RECEIVER_SHARED_SECRET") ?? "").trim();
const ALLOW_SOURCES_RAW = (Deno.env.get("ALLOW_SOURCES") ?? "").trim();
const ALLOW_SOURCES = new Set(
  ALLOW_SOURCES_RAW
    ? ALLOW_SOURCES_RAW.split(",").map((s) => s.trim()).filter(Boolean)
    : [],
);

const OPENCLAW_GATEWAY_URL = (Deno.env.get("OPENCLAW_GATEWAY_URL") ?? "")
  .trim();
const OPENCLAW_GATEWAY_TOKEN = (Deno.env.get("OPENCLAW_GATEWAY_TOKEN") ?? "")
  .trim();
const OPENCLAW_SESSION_KEY = (Deno.env.get("OPENCLAW_SESSION_KEY") ?? "")
  .trim();

function parseSigHeader(v: string | null): string {
  const raw = (v ?? "").trim();
  if (!raw) return "";
  // Accept either: sha256=<hex> or raw hex.
  if (raw.startsWith("sha256=")) return raw.slice("sha256=".length);
  return raw;
}

function getSource(req: Request): string {
  // Caller can supply an explicit source header.
  const h = (req.headers.get("x-traveler-source") ?? "").trim();
  if (h) return h;
  // GitHub
  if (req.headers.get("x-github-event")) return "github";
  return "custom";
}

Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET" && url.pathname === "/healthz") {
    return json({ ok: true, service: "traveler-receiver" });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  if (url.pathname !== WEBHOOK_PATH) {
    return json({ ok: false, error: "not_found" }, 404);
  }

  const source = getSource(req);
  if (ALLOW_SOURCES.size && !ALLOW_SOURCES.has(source)) {
    return json({
      ok: true,
      ignored: true,
      reason: `source_not_allowed:${source}`,
    });
  }

  const bodyBuf = await req.arrayBuffer();
  const bodyBytes = new Uint8Array(bodyBuf);

  if (SHARED_SECRET) {
    const provided = parseSigHeader(req.headers.get("x-signature-256"));
    const expected = await hmacSha256Hex(SHARED_SECRET, bodyBytes);
    if (!provided || !timingSafeEqual(provided, expected)) {
      return json({ ok: false, error: "signature_verification_failed" }, 401);
    }
  }

  // Build a minimal envelope.
  const envelope = {
    source,
    receivedAt: new Date().toISOString(),
    headers: {
      "x-github-event": req.headers.get("x-github-event"),
      "x-github-delivery": req.headers.get("x-github-delivery"),
    },
    body: (() => {
      try {
        return JSON.parse(new TextDecoder().decode(bodyBytes));
      } catch {
        return new TextDecoder().decode(bodyBytes);
      }
    })(),
  };

  // Forward to OpenClaw if configured.
  if (OPENCLAW_GATEWAY_URL && OPENCLAW_GATEWAY_TOKEN) {
    const text = [
      `[Traveler] Passive event received (${source})`,
      "",
      "Context (structured):",
      JSON.stringify(envelope),
      "",
      "Instruction:",
      "- Decide whether to record this as a Rote note.",
      "- If you write to Rote, include the source + why it matters.",
    ].join("\n");

    await openclawInvoke({
      gatewayUrl: OPENCLAW_GATEWAY_URL,
      gatewayToken: OPENCLAW_GATEWAY_TOKEN,
      tool: "cron", // send a systemEvent into the main session by default
      action: "wake",
      toolArgs: {
        text,
        mode: "now",
      },
      sessionKey: OPENCLAW_SESSION_KEY || undefined,
    }).catch((e) => {
      // If OpenClaw is down, return 500 so sender can retry.
      throw e;
    });
  }

  return ok({
    forwarded: Boolean(OPENCLAW_GATEWAY_URL && OPENCLAW_GATEWAY_TOKEN),
  });
});

console.log(
  `traveler-receiver listening on http://127.0.0.1:${PORT}${WEBHOOK_PATH}`,
);
