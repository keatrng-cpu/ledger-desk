/**
 * POST /api/mcp — the desk as a Grok custom connector.
 * Streamable HTTP. Paste https://<site>/api/mcp at grok.com/connectors → Custom.
 */
import { createFileRoute } from "@tanstack/react-router";
import { fetchTradingDesk } from "@/lib/trading/build-desk";
import { deskListenCard, type DeskListenCard } from "@/lib/trading/desk-listen";
import { encodeMcp, handleMcpMessage, wantsSse } from "@/lib/desk/mcp-server";

const FRESH_MS = 20_000;
let cached: { at: number; card: DeskListenCard } | null = null;

async function loadCard(): Promise<DeskListenCard> {
  const now = Date.now();
  if (cached && now - cached.at < FRESH_MS) return cached.card;
  const res = await fetchTradingDesk({ data: { left: "MNQ", right: "ES" } });
  if (!res.ok) throw new Error(res.error || "Desk unavailable");
  const card = deskListenCard(res);
  cached = { at: now, card };
  return card;
}

function out(reply: ReturnType<typeof encodeMcp>): Response {
  return new Response(reply.body, {
    status: reply.status,
    headers: {
      "content-type": reply.contentType,
      "cache-control": "no-store",
    },
  });
}

async function post({ request }: { request: Request }): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    const reply = encodeMcp(
      { status: 200, sse: false, body: { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } } },
      false,
    );
    return out(reply);
  }
  const handled = await handleMcpMessage(raw, loadCard);
  return out(encodeMcp(handled, wantsSse(request.headers.get("accept"))));
}

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      POST: post,
      GET: () => new Response("POST JSON-RPC", { status: 405, headers: { allow: "POST" } }),
    },
  },
});
