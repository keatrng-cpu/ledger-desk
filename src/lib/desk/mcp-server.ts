/**
 * Ledger desk as a remote MCP server (streamable HTTP, 2025-03-26).
 * Grok connects the same way it connects Robinhood: a public HTTPS URL.
 * Tools read the scanner, floor, and brain. They do not see the account.
 */
import type { DeskListenCard } from "@/lib/trading/desk-listen";

export const MCP_PROTOCOL = "2025-03-26";

const TOOLS = [
  {
    name: "read_desk",
    description: "Live ledger desk: clock, quotes, scanner, floor verdict, and brain. No account, no positions, no orders.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_scanner",
    description: "Top setup-scanner cards: symbol, side, PATH band, confluence, actionable.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_floor",
    description: "Options floor verdict, blocks, and the ticket shape if one exists. Does not place.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_brain",
    description: "SMC brain: one book, TAKE / WAIT / STAND, and the missing layer.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

type ToolName = (typeof TOOLS)[number]["name"];

export interface McpReply {
  status: number;
  body: unknown | null;
  sse: boolean;
}

function slice(card: DeskListenCard, name: ToolName): unknown {
  if (name === "read_scanner") return { at: card.at, clock: card.clock, quotes: card.quotes, scanner: card.scanner };
  if (name === "read_floor") return { at: card.at, clock: card.clock, floor: card.floor };
  if (name === "read_brain") return { at: card.at, clock: card.clock, brain: card.brain };
  return card;
}

function result(id: unknown, value: unknown): McpReply {
  return { status: 200, sse: false, body: { jsonrpc: "2.0", id, result: value } };
}

function fail(id: unknown, code: number, message: string): McpReply {
  return { status: 200, sse: false, body: { jsonrpc: "2.0", id: id ?? null, error: { code, message } } };
}

export async function handleMcpMessage(raw: unknown, load: () => Promise<DeskListenCard>): Promise<McpReply> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail(null, -32600, "Invalid request");
  const msg = raw as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(msg.id, -32600, "Invalid request");
  const note = msg.id === undefined;

  if (msg.method === "initialize") {
    return result(msg.id, {
      protocolVersion: MCP_PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "ledger-desk", version: "1" },
    });
  }
  if (msg.method === "notifications/initialized" || msg.method.startsWith("notifications/")) {
    return { status: 202, sse: false, body: null };
  }
  if (msg.method === "ping") return result(msg.id, {});
  if (msg.method === "tools/list") return result(msg.id, { tools: TOOLS });
  if (msg.method === "tools/call") {
    const params = (msg.params ?? {}) as { name?: unknown };
    const name = params.name;
    const known = TOOLS.some((t) => t.name === name);
    if (!known) {
      return result(msg.id, { content: [{ type: "text", text: "Unknown tool" }], isError: true });
    }
    try {
      const card = await load();
      const text = JSON.stringify(slice(card, name as ToolName));
      return result(msg.id, { content: [{ type: "text", text }], isError: false });
    } catch (err) {
      const why = err instanceof Error ? err.message : "Desk unavailable";
      return result(msg.id, { content: [{ type: "text", text: why }], isError: true });
    }
  }
  if (note) return { status: 202, sse: false, body: null };
  return fail(msg.id, -32601, "Method not found");
}

export function wantsSse(accept: string | null): boolean {
  const a = (accept ?? "").toLowerCase();
  return a.includes("text/event-stream") && !a.includes("application/json");
}

export function encodeMcp(reply: McpReply, sse: boolean): { status: number; contentType: string; body: string } {
  if (reply.body == null) return { status: reply.status, contentType: "text/plain", body: "" };
  if (!sse) {
    return { status: 200, contentType: "application/json", body: JSON.stringify(reply.body) };
  }
  return {
    status: 200,
    contentType: "text/event-stream",
    body: `event: message\ndata: ${JSON.stringify(reply.body)}\n\n`,
  };
}
