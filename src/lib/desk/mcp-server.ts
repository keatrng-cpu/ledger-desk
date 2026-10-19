/**
 * Ledger desk as a remote MCP server (streamable HTTP, 2025-03-26).
 * Grok connects the same way it connects Robinhood: a public HTTPS URL.
 * Tools read the scanner, floor, and brain. They do not see the account.
 */
import type { DeskListenCard } from "@/lib/trading/desk-listen";
import RULES from "../../../shared/desk-rules.json";
import { RULES_HASH } from "./rules-hash";
import LATEST_BACKTEST from "../../../ai/backtest/latest.json";
import { CONFLUENCE_KNOWLEDGE } from "@/lib/aplus/confluence";
import LADDER_CAL from "@/lib/smc/seq/ladder-calibration.json";

export const MCP_PROTOCOL = "2025-03-26";

const TOOLS = [
  {
    name: "read_desk",
    description: "Live ledger desk on one card: Databento or gateway tape with lag, the strategy, chart levels, the brain word, the floor ticket, and Grok's last report. No account balance. Does not place.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_scanner",
    description: "Top setup-scanner cards plus the shared wire: strategy name, entry, stop, draw, and tape source.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_floor",
    description: "Options floor verdict, the ticket if one exists, and what Vince, Sterling, and Nova just said. Does not place.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_brain",
    description: "SMC brain: one book, TAKE / WAIT / STAND, and the missing layer.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_rules",
    description:
      "The desk's full rule set (shared/desk-rules.json) with its RULES_HASH — the non-negotiable gates: band edges, min stop ATR, R:R floors, kill params, displacement-vs-R:R, session windows. For engineering the engine, not a live market read.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_backtest",
    description:
      "The latest walk-forward backtest summary (ai/backtest/latest.json): per-split and per-symbol hit rate, avg R, sum R, avg option %, with the train/holdout/skipped session lists. The raw trades array is omitted; the trade count is given.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_calibration",
    description:
      "Scoring calibration: the confluence knowledge (sample size, best score, per-component fire %, hot/cold components, lessons) and the ladder calibration metadata (method, input bars, train/holdout windows). The engine's measured self-knowledge.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "report_trade",
    description:
      "Report back to the floor after a ticket was handed to Grok. Say whether it was taken, the pnl, a journal paragraph, and the status: placed, stood, managing, or closed.",
    inputSchema: {
      type: "object",
      properties: {
        taken: { type: "boolean" },
        status: { type: "string", enum: ["placed", "stood", "managing", "closed"] },
        pnl: { type: ["number", "null"] },
        journal: { type: "string" },
        underlier: { type: "string" },
        side: { type: "string" },
        contracts: { type: "number" },
        entry: { type: "number" },
        exit: { type: "number" },
        reason: { type: "string" },
      },
      required: ["taken", "status", "journal"],
      additionalProperties: false,
    },
  },
] as const;

type ToolName = (typeof TOOLS)[number]["name"];

export interface McpReply {
  status: number;
  body: unknown | null;
  sse: boolean;
}

function slice(card: DeskListenCard, name: ToolName): unknown {
  const wire = card.wire ?? null;
  if (name === "read_scanner") return { at: card.at, clock: card.clock, quotes: card.quotes, scanner: card.scanner, optionMarks: card.optionMarks, wire };
  if (name === "read_floor") return { at: card.at, clock: card.clock, floor: card.floor, said: card.said, optionMarks: card.optionMarks, wire };
  if (name === "read_brain") return { at: card.at, clock: card.clock, brain: card.brain, optionMarks: card.optionMarks, wire };
  return card;
}

/** Codex-oriented static reads: the engine's rules, backtest and calibration (not the live card). */
const STATIC_TOOLS = new Set(["read_rules", "read_backtest", "read_calibration"]);
function readStatic(name: string): unknown {
  if (name === "read_rules") return { rulesHash: RULES_HASH, rules: RULES };
  if (name === "read_backtest") {
    const b = LATEST_BACKTEST as Record<string, unknown> & { trades?: unknown[] };
    const { trades, ...rest } = b;
    return { ...rest, tradeCount: Array.isArray(trades) ? trades.length : 0 };
  }
  const cal = LADDER_CAL as { method?: unknown; inputs?: unknown; train?: unknown; holdout?: unknown };
  return { confluence: CONFLUENCE_KNOWLEDGE, ladder: { method: cal.method, inputs: cal.inputs, train: cal.train, holdout: cal.holdout } };
}

function result(id: unknown, value: unknown): McpReply {
  return { status: 200, sse: false, body: { jsonrpc: "2.0", id, result: value } };
}

function fail(id: unknown, code: number, message: string): McpReply {
  return { status: 200, sse: false, body: { jsonrpc: "2.0", id: id ?? null, error: { code, message } } };
}

export async function handleMcpMessage(
  raw: unknown,
  load: () => Promise<DeskListenCard>,
  report?: (args: unknown) => Promise<unknown>,
): Promise<McpReply> {
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
    const params = (msg.params ?? {}) as { name?: unknown; arguments?: unknown };
    const name = params.name;
    const known = TOOLS.some((t) => t.name === name);
    if (!known) {
      return result(msg.id, { content: [{ type: "text", text: "Unknown tool" }], isError: true });
    }
    if (name === "report_trade") {
      if (!report) return result(msg.id, { content: [{ type: "text", text: "Report is not wired" }], isError: true });
      try {
        const saved = await report(params.arguments ?? {});
        return result(msg.id, { content: [{ type: "text", text: JSON.stringify(saved) }], isError: false });
      } catch (err) {
        const why = err instanceof Error ? err.message : "Report failed";
        return result(msg.id, { content: [{ type: "text", text: why }], isError: true });
      }
    }
    if (STATIC_TOOLS.has(name as string)) {
      try {
        return result(msg.id, { content: [{ type: "text", text: JSON.stringify(readStatic(name as string)) }], isError: false });
      } catch (err) {
        const why = err instanceof Error ? err.message : "Read failed";
        return result(msg.id, { content: [{ type: "text", text: why }], isError: true });
      }
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
