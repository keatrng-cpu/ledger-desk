/**
 * Robinhood tooling over the official trading MCP.
 *
 * The bearer is the short-lived access token from the stored sign-in
 * (rh-oauth.ts). It is not RH_ACCESS_TOKEN and it is not sent to the browser.
 * Review, then place. Account 995386158 only.
 */
import type { Sql } from "@/lib/db";
import type { RhOrder } from "./rh-cycle";
import { RH_PREFERRED_ACCOUNT_NUMBER } from "./rh-autofire-gates";
import { ensureAccess, MCP_RESOURCE, readOauth } from "./rh-oauth";
import type { RhPos, RhQuote, RhReview, RhTooling } from "./rh-tools";
import { refIdFor } from "./rh-tools";

type FetchLike = typeof fetch;

function num(x: unknown): number | null {
  const v = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN;
  return Number.isFinite(v) ? v : null;
}

function asRecord(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

/** Rows from a tool payload, whether Robinhood wrapped them in `data`. */
export function rowsOf(body: unknown): Record<string, unknown>[] {
  const root = asRecord(body);
  const data = root && "data" in root ? root.data : body;
  if (Array.isArray(data)) return data.map(asRecord).filter((x): x is Record<string, unknown> => !!x);
  const box = asRecord(data);
  if (!box) return root ? [root] : [];
  for (const key of ["results", "quotes", "positions", "instruments", "accounts"]) {
    if (Array.isArray(box[key])) return (box[key] as unknown[]).map(asRecord).filter((x): x is Record<string, unknown> => !!x);
  }
  return [box];
}

export function unwrapData(body: unknown): unknown {
  const root = asRecord(body);
  if (root && "data" in root) return root.data;
  return body;
}

/** JSON-RPC / SSE tool result → the tool's own JSON. */
export function toolPayload(rpc: unknown): unknown {
  const root = asRecord(rpc);
  if (!root) return rpc;
  const err = asRecord(root.error);
  if (err) throw new Error(typeof err.message === "string" ? err.message : "Robinhood refused the call.");
  const result = asRecord(root.result) ?? root;
  if (result.isError === true) {
    const text = Array.isArray(result.content)
      ? result.content.map((c) => (asRecord(c)?.text as string) || "").join(" ")
      : "Robinhood refused the call.";
    throw new Error(text || "Robinhood refused the call.");
  }
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  if (Array.isArray(result.content)) {
    const text = result.content.map((c) => (asRecord(c)?.text as string) || "").join("\n").trim();
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    }
    if (text) return text;
  }
  return result;
}

export function quoteFromPayload(body: unknown): { bid: number | null; ask: number | null } | null {
  const row = rowsOf(body)[0];
  if (!row) return null;
  const bid = num(row.bid_price ?? row.bid);
  const ask = num(row.ask_price ?? row.ask);
  if (bid == null && ask == null) return null;
  return { bid, ask };
}

export function positionsFromPayload(body: unknown): RhPos[] {
  return rowsOf(body)
    .map((p): RhPos => {
      const type = String(p.type ?? p.option_type ?? "").toLowerCase();
      const id = String(p.option_id ?? p.instrument_id ?? p.id ?? "");
      return {
        optionId: id.replace(/\/$/, "").split("/").pop() || "",
        quantity: Math.abs(num(p.quantity) ?? num(p.quantity_available) ?? 0),
        averagePrice: num(p.average_price ?? p.avg_price ?? p.average_open_price),
        chainSymbol: String(p.chain_symbol ?? p.symbol ?? ""),
        optionType: type === "call" || type === "put" ? type : null,
      };
    })
    .filter((p) => p.optionId && p.quantity > 0);
}

export function instrumentIdFrom(body: unknown, strike: number): string | null {
  const rows = rowsOf(body);
  const hit =
    rows.find((r) => {
      const s = num(r.strike_price);
      return s != null && Math.abs(s - strike) < 0.001;
    }) ?? rows[0];
  const id = hit?.id ?? hit?.instrument_id;
  return typeof id === "string" && id ? id : null;
}

function alertLines(body: unknown): string[] {
  const root = asRecord(unwrapData(body)) ?? asRecord(body);
  if (!root) return [];
  const raw = root.alerts ?? root.order_checks ?? root.detail;
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) return raw.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).slice(0, 8);
  return [];
}

export function reviewFromPayload(body: unknown, failed: boolean): RhReview {
  const alerts = alertLines(body);
  const blocking = failed || alerts.some((a) => /not enough|rejected|cannot|insufficient|halt/i.test(a));
  return { ok: !failed && !blocking, blocking, alerts };
}

export function orderIdFrom(body: unknown): string | null {
  const root = asRecord(unwrapData(body)) ?? asRecord(body);
  if (!root) return null;
  const id = root.id ?? root.order_id ?? asRecord(root.order)?.id;
  return typeof id === "string" && id ? id : null;
}

function orderArgs(order: RhOrder, refId?: string): Record<string, unknown> {
  const args: Record<string, unknown> = {
    account_number: order.account_number,
    legs: order.legs.map((l) => ({
      option_id: l.option_id,
      side: l.side,
      position_effect: l.position_effect,
      ratio_quantity: l.ratio_quantity,
    })),
    type: order.type,
    quantity: order.quantity,
    time_in_force: order.time_in_force,
    market_hours: order.market_hours,
    chain_symbol: order.chain_symbol,
    underlying_type: order.underlying_type,
  };
  if (order.type === "limit" && order.price) args.price = order.price;
  if (order.legs.length > 1) args.direction = order.legs[0]?.side === "sell" ? "credit" : "debit";
  if (refId) args.ref_id = refId;
  return args;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("text/event-stream") || text.includes("\ndata:")) {
    const chunks = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    const last = chunks[chunks.length - 1];
    if (!last) return null;
    try {
      return JSON.parse(last) as unknown;
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** One MCP session for one desk step. */
export function mcpTooling(accessToken: string, fetchImpl: FetchLike = fetch): RhTooling {
  let session: string | null = null;
  let ready = false;
  let n = 0;
  let dayPct: number | null = null;

  async function rpc(method: string, params: unknown, note = false): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-03-26",
    };
    if (session) headers["Mcp-Session-Id"] = session;
    const body = note ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++n, method, params };
    const res = await fetchImpl(MCP_RESOURCE, { method: "POST", headers, body: JSON.stringify(body) });
    const sid = res.headers.get("mcp-session-id");
    if (sid) session = sid;
    const parsed = await readBody(res);
    if (res.status >= 400) {
      const msg = asRecord(asRecord(parsed)?.error)?.message;
      throw new Error(typeof msg === "string" ? msg : `Robinhood ${res.status}`);
    }
    return parsed;
  }

  async function init(): Promise<void> {
    if (ready) return;
    await rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "ledger-desk", version: "1" },
    });
    await rpc("notifications/initialized", {}, true);
    ready = true;
  }

  async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
    await init();
    return toolPayload(await rpc("tools/call", { name, arguments: args }));
  }

  return {
    async readAccount() {
      const accounts = unwrapData(await call("get_accounts", {}));
      const list = Array.isArray((accounts as { accounts?: unknown })?.accounts)
        ? ((accounts as { accounts: unknown[] }).accounts)
        : rowsOf(accounts);
      const row = (list as unknown[]).map(asRecord).find((a) => a && String(a.account_number ?? "") === RH_PREFERRED_ACCOUNT_NUMBER) ?? null;
      if (!row) return null;
      const portfolio = unwrapData(await call("get_portfolio", { account_number: RH_PREFERRED_ACCOUNT_NUMBER }));
      const p = asRecord(portfolio) ?? {};
      const equity = num(p.equity ?? p.total_value);
      const prev = num(p.adjusted_equity_previous_close ?? p.last_core_equity);
      dayPct = equity != null && prev != null && prev > 0 ? (equity - prev) / prev : null;
      return { account: row, portfolio };
    },
    async dayPnlPct() {
      return dayPct;
    },
    async positions() {
      const body = await call("get_option_positions", { account_number: RH_PREFERRED_ACCOUNT_NUMBER, nonzero: true });
      return positionsFromPayload(body);
    },
    async quote(optionId) {
      const body = await call("get_option_quotes", { instrument_ids: [optionId] });
      const q = quoteFromPayload(body);
      if (!q) return null;
      const out: RhQuote = { bid: q.bid, ask: q.ask, asOfMs: Date.now() };
      return out;
    },
    async findOption(q) {
      const body = await call("get_option_instruments", {
        chain_symbol: q.underlier,
        expiration_dates: q.expiry,
        strike_price: q.strike.toFixed(4),
        type: q.type,
        state: "active",
      });
      return instrumentIdFrom(body, q.strike);
    },
    async review(order) {
      try {
        const body = await call("review_option_order", orderArgs(order));
        return reviewFromPayload(body, false);
      } catch (err) {
        const why = err instanceof Error ? err.message : "review failed";
        return { ok: false, blocking: true, alerts: [why] };
      }
    },
    async place(order, refId) {
      const body = await call("place_option_order", orderArgs(order, refId || refIdFor(order.refKey)));
      const id = orderIdFrom(body);
      if (!id) throw new Error("Robinhood did not return an order id.");
      return { id };
    },
  };
}

/** The stored sign-in, refreshed if the access token is about to lapse. Null when the trader has not connected. */
export async function toolingFromStored(sql: Sql, userId: string, fetchImpl: FetchLike = fetch): Promise<RhTooling | null> {
  const row = await readOauth(sql, userId);
  if (!row) return null;
  const access = await ensureAccess(sql, row, fetchImpl);
  if (!access) return null;
  return mcpTooling(access, fetchImpl);
}

/**
 * Stored sign-in first. A pasted RH_ACCESS_TOKEN still works if one is set.
 * Neither → null, and the cycle sends nothing.
 */
export async function toolingForDesk(sql: Sql, userId: string): Promise<RhTooling | null> {
  try {
    const stored = await toolingFromStored(sql, userId);
    if (stored) return stored;
  } catch (err) {
    console.error("[rh] stored session failed:", err instanceof Error ? err.message : "failed");
  }
  const { toolingFromEnv } = await import("./rh-http");
  return toolingFromEnv();
}
