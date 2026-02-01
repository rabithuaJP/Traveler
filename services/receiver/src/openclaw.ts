import { json } from "./http.ts";

export async function openclawInvoke(args: {
  gatewayUrl: string;
  gatewayToken: string;
  tool: string;
  action?: string;
  toolArgs?: Record<string, unknown>;
  sessionKey?: string;
}): Promise<unknown> {
  const url = args.gatewayUrl.replace(/\/+$/, "") + "/tools/invoke";

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.gatewayToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      tool: args.tool,
      action: args.action,
      args: args.toolArgs ?? {},
      sessionKey: args.sessionKey,
    }),
  });

  const text = await resp.text().catch(() => "");
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  if (!resp.ok) {
    throw new Error(
      `openclaw_invoke_failed status=${resp.status} body=${text.slice(0, 500)}`,
    );
  }
  return data;
}

export function ok(extra?: Record<string, unknown>): Response {
  return json({ ok: true, ...(extra ?? {}) });
}

export function requireEnv(name: string): string {
  const v = (Deno.env.get(name) ?? "").trim();
  if (!v) throw new Error(`missing_env:${name}`);
  return v;
}
