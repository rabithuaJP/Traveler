import { createRoteNote } from "./rote.ts";
import type { TravelerConfig } from "./types.ts";

type WebhookEvent = {
  title?: string;
  content?: string;
  event?: string;
  source?: string;
  url?: string;
  tags?: string[];
  timestamp?: string;
  payload?: unknown;
};

function clip(s: unknown, max = 20_000): string {
  const t = String(s ?? "").trim();
  return t.length > max ? t.slice(0, max) : t;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

function hexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(
  secret: string,
  data: Uint8Array,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = new Uint8Array(data).buffer;
  const sig = await crypto.subtle.sign("HMAC", key, buf);
  return hexFromBytes(new Uint8Array(sig));
}

function formatNote(
  event: WebhookEvent,
  personaName = "Traveler",
): { title: string; content: string } {
  const titleBase = event.title ?? event.event ?? "Webhook event";
  const title = `[Webhook] ${clip(titleBase, 200)}`.slice(0, 200);

  const payload = event.payload
    ? clip(JSON.stringify(event.payload, null, 2), 20_000)
    : "";

  const lines = [
    `Source: ${event.source ?? "webhook"}`,
    event.event ? `Event: ${event.event}` : "",
    `Timestamp: ${event.timestamp ?? new Date().toISOString()}`,
    event.url ? `URL: ${event.url}` : "",
    "",
    event.content ? `Content: ${clip(event.content, 20_000)}` : "",
    "",
    payload ? `Payload:\n${payload}` : "",
    "",
    `— ${personaName}`,
  ].filter((l) => l !== "");

  return { title, content: lines.join("\n") };
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function startWebhookServer(cfg: TravelerConfig): Promise<void> {
  const personaName = cfg.persona?.name ?? "Traveler";
  const tagsDefault = cfg.output?.rote?.tags ?? ["inbox", "traveler"];
  const webhookCfg = cfg.webhook ?? {};

  const port = webhookCfg.port ?? 8787;
  const path = webhookCfg.path ?? "/webhook";
  const maxBodyBytes = (webhookCfg.max_body_kb ?? 512) * 1024;

  const token = (Deno.env.get("WEBHOOK_TOKEN") ?? "").trim();
  const secret = (Deno.env.get("WEBHOOK_SECRET") ?? "").trim();

  if (!token && !secret) {
    throw new Error("Missing WEBHOOK_TOKEN or WEBHOOK_SECRET");
  }

  console.log(`Webhook server listening on http://0.0.0.0:${port}${path}`);

  Deno.serve({ port }, async (req) => {
    const url = new URL(req.url);

    if (url.pathname !== path) {
      return jsonResponse(404, { ok: false, error: "not_found" });
    }

    if (req.method !== "POST") {
      return jsonResponse(405, { ok: false, error: "method_not_allowed" });
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return jsonResponse(415, { ok: false, error: "content_type" });
    }

    const bodyBuffer = new Uint8Array(await req.arrayBuffer());
    if (bodyBuffer.byteLength > maxBodyBytes) {
      return jsonResponse(413, { ok: false, error: "payload_too_large" });
    }

    if (token) {
      const auth = req.headers.get("authorization") ?? "";
      const headerToken = req.headers.get("x-webhook-token") ?? "";
      const bearer = auth.toLowerCase().startsWith("bearer ")
        ? auth.slice(7)
        : "";
      const provided = bearer || headerToken;
      if (!provided || !timingSafeEqual(provided, token)) {
        return jsonResponse(401, { ok: false, error: "token_invalid" });
      }
    }

    if (secret) {
      const sigHeader = req.headers.get("x-webhook-signature") ??
        req.headers.get("x-hub-signature-256") ?? "";
      const sig = sigHeader.startsWith("sha256=")
        ? sigHeader.slice("sha256=".length)
        : sigHeader;
      if (!sig) {
        return jsonResponse(401, { ok: false, error: "signature_missing" });
      }
      const expected = await hmacSha256Hex(secret, bodyBuffer);
      if (!timingSafeEqual(sig, expected)) {
        return jsonResponse(401, { ok: false, error: "signature_invalid" });
      }
    }

    let event: WebhookEvent;
    try {
      const text = new TextDecoder().decode(bodyBuffer);
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object") {
        return jsonResponse(400, { ok: false, error: "invalid_json" });
      }
      event = parsed as WebhookEvent;
    } catch {
      return jsonResponse(400, { ok: false, error: "invalid_json" });
    }

    const note = formatNote(event, personaName);
    const tags = event.tags?.length ? event.tags : tagsDefault;

    try {
      const created = await createRoteNote({
        title: note.title,
        content: note.content,
        state: "private",
        type: "rote",
        tags,
        pin: false,
      });
      return jsonResponse(200, { ok: true, id: created.id });
    } catch (err) {
      console.error("webhook_create_note_failed", err);
      return jsonResponse(500, { ok: false, error: "rote_failed" });
    }
  });
}
