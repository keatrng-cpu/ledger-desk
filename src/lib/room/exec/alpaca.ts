/**
 * Alpaca, behind the OptionsBroker interface (types.ts). Read against the vendor's own docs 2026-10-05:
 *
 *   orders     POST/GET/DELETE  {paper-api|api}.alpaca.markets/v2/orders  — options use the equity Orders API:
 *              whole-number `qty` (a string), no `notional`, `time_in_force` day|gtc, limit or market for a
 *              single leg, no extended hours. A buy of a call/put is the Tier-2 payload (docs/options-orders).
 *   positions  GET /v2/positions · account GET /v2/account · orders by client id GET /v2/orders:by_client_order_id
 *   quotes     GET data.alpaca.markets/v1beta1/options/snapshots?symbols=…&feed=opra|indicative
 *              → { snapshots: { [OCC]: { latestQuote: { t, bp, bs, ap, as, bx, ax, c }, greeks, impliedVolatility } } }
 *              `indicative` is free and its quotes are MODIFIED: it never prices a live order (gates.ts).
 *
 * NOT verified against a live response: the account's options fields (`options_trading_level`,
 * `options_buying_power`) — they parse defensively and a missing one reads "unknown", which live refuses.
 * Pure over an injectable `fetch`; the keys are never logged or echoed into an error.
 */

import type { BrokerAccount, BrokerOrder, BrokerPosition, BrokerQuote, OptionsBroker } from "./types";

export const ALPACA_TRADING = { paper: "https://paper-api.alpaca.markets", live: "https://api.alpaca.markets" } as const;
export const ALPACA_DATA = "https://data.alpaca.markets";
const TIMEOUT_MS = 8_000;

export interface AlpacaConfig {
  keyId: string;
  secret: string;
  env: "paper" | "live";
  feed: "opra" | "indicative";
  fetch?: typeof fetch;
  /** Override the hosts (tests). */
  tradingBase?: string;
  dataBase?: string;
}

export class AlpacaError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`Alpaca ${status}: ${message}`);
  }
}

const num = (x: unknown): number | null => {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

/** RFC-3339 with nanoseconds ("2024-04-22T19:59:59.992734208Z") → epoch ms. */
export function parseTs(s: unknown): number {
  if (typeof s !== "string") return 0;
  const t = Date.parse(s.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isFinite(t) ? t : 0;
}

type Json = Record<string, unknown>;

function orderOf(o: Json): BrokerOrder {
  return {
    id: String(o.id ?? ""),
    clientOrderId: String(o.client_order_id ?? ""),
    status: String(o.status ?? "unknown"),
    symbol: String(o.symbol ?? ""),
    side: o.side === "sell" ? "sell" : "buy",
    qty: num(o.qty) ?? 0,
    limitPx: num(o.limit_price),
    filledQty: num(o.filled_qty) ?? 0,
    filledAvgPx: num(o.filled_avg_price),
  };
}

export function alpacaBroker(cfg: AlpacaConfig): OptionsBroker {
  const f = cfg.fetch ?? fetch;
  const trading = cfg.tradingBase ?? ALPACA_TRADING[cfg.env];
  const data = cfg.dataBase ?? ALPACA_DATA;

  async function call(base: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; json: unknown }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await f(`${base}${path}`, {
        method: init.method ?? "GET",
        headers: {
          "APCA-API-KEY-ID": cfg.keyId,
          "APCA-API-SECRET-KEY": cfg.secret,
          accept: "application/json",
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: ctl.signal,
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!res.ok) {
        const m = json && typeof json === "object" && "message" in json ? String((json as Json).message) : text.slice(0, 160);
        throw new AlpacaError(res.status, m || res.statusText);
      }
      return { status: res.status, json };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: "alpaca",
    env: cfg.env,
    dataFeed: cfg.feed,

    async account(): Promise<BrokerAccount> {
      const a = (await call(trading, "/v2/account")).json as Json;
      const level = num(a.options_trading_level) ?? num(a.options_approved_level);
      const blocked = a.trading_blocked === undefined && a.account_blocked === undefined ? null : a.trading_blocked === true || a.account_blocked === true;
      return {
        equity: num(a.equity) ?? 0,
        cash: num(a.cash) ?? 0,
        buyingPower: num(a.buying_power) ?? 0,
        optionsBuyingPower: num(a.options_buying_power),
        optionsLevel: level,
        status: typeof a.status === "string" ? a.status : null,
        blocked,
      };
    },

    async quote(symbol: string): Promise<BrokerQuote | null> {
      const { json } = await call(data, `/v1beta1/options/snapshots?symbols=${encodeURIComponent(symbol)}&feed=${cfg.feed}`);
      const snap = ((json as Json | null)?.snapshots as Record<string, Json> | undefined)?.[symbol];
      const q = snap?.latestQuote as Json | undefined;
      if (!q) return null;
      const bid = num(q.bp);
      const ask = num(q.ap);
      const ts = parseTs(q.t);
      if (bid == null || ask == null || !ts) return null;
      const greeks = snap?.greeks as Json | undefined;
      return { bid, ask, mid: Math.round(((bid + ask) / 2) * 1000) / 1000, ts, feed: cfg.feed, iv: num(snap?.impliedVolatility), delta: num(greeks?.delta) };
    },

    async positions(): Promise<BrokerPosition[]> {
      const { json } = await call(trading, "/v2/positions");
      const rows = Array.isArray(json) ? (json as Json[]) : [];
      return rows
        .filter((p) => p.asset_class === "us_option" || /^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(String(p.symbol ?? "")))
        .map((p) => ({ symbol: String(p.symbol), qty: num(p.qty) ?? 0, avgPx: num(p.avg_entry_price) ?? 0 }));
    },

    async openOrders(): Promise<BrokerOrder[]> {
      const { json } = await call(trading, "/v2/orders?status=open&limit=100&direction=desc");
      return (Array.isArray(json) ? (json as Json[]) : []).map(orderOf);
    },

    async submit(o): Promise<BrokerOrder> {
      const body: Json = {
        symbol: o.symbol,
        qty: String(o.qty),
        side: o.side,
        type: o.limitPx == null ? "market" : "limit",
        time_in_force: "day",
        client_order_id: o.clientOrderId,
      };
      if (o.limitPx != null) body.limit_price = o.limitPx.toFixed(2);
      return orderOf((await call(trading, "/v2/orders", { method: "POST", body })).json as Json);
    },

    async get(id: string): Promise<BrokerOrder> {
      return orderOf((await call(trading, `/v2/orders/${encodeURIComponent(id)}`)).json as Json);
    },

    async byClientId(clientOrderId: string): Promise<BrokerOrder | null> {
      try {
        return orderOf((await call(trading, `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`)).json as Json);
      } catch (e) {
        if (e instanceof AlpacaError && e.status === 404) return null;
        throw e;
      }
    },

    async cancel(id: string): Promise<void> {
      try {
        await call(trading, `/v2/orders/${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch (e) {
        // 404 / 422: it already filled or is already gone — the caller re-reads the order.
        if (e instanceof AlpacaError && (e.status === 404 || e.status === 422)) return;
        throw e;
      }
    },
  };
}

/**
 * The broker for a phase, from the environment. Paper and live keys are SEPARATE variables so a paper key
 * can never be used live and the reverse. Shadow only reads quotes, so it takes the paper keys first.
 */
export function brokerFromEnv(phase: "shadow" | "paper" | "live", env: Record<string, string | undefined> = process.env, f?: typeof fetch): OptionsBroker | null {
  const paper = env.ALPACA_KEY_ID && env.ALPACA_SECRET_KEY ? { keyId: env.ALPACA_KEY_ID, secret: env.ALPACA_SECRET_KEY, env: "paper" as const } : null;
  const live = env.ALPACA_LIVE_KEY_ID && env.ALPACA_LIVE_SECRET_KEY ? { keyId: env.ALPACA_LIVE_KEY_ID, secret: env.ALPACA_LIVE_SECRET_KEY, env: "live" as const } : null;
  const pick = phase === "live" ? live : phase === "paper" ? paper : (paper ?? live);
  if (!pick) return null;
  // The feed is the trader's subscription: opra only when they say they have it. The default is the free one, and says so everywhere.
  const feed = env.ALPACA_DATA_FEED === "opra" ? "opra" : "indicative";
  // Host overrides exist for local end-to-end runs against a simulator, and ONLY in an explicit development or test
  // environment: a production runtime (or one that does not say) always talks to Alpaca's own hosts.
  const local = env.NODE_ENV === "development" || env.NODE_ENV === "test";
  return alpacaBroker({ ...pick, feed, fetch: f, tradingBase: local ? env.ALPACA_TRADING_BASE : undefined, dataBase: local ? env.ALPACA_DATA_BASE : undefined });
}
