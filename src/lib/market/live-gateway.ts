/**
 * Reader for the Python Databento-Live gateway (gateway/databento_live_gateway.py).
 *
 * The gateway is a separate always-on process — this repo's own serverless
 * functions cannot hold the persistent connection real-time futures data
 * needs. It writes to `live_market_ticks` / `live_market_bars_1m`
 * (migrations/0011_live_gateway.sql); this file is the only thing that reads
 * those tables, and it is deliberately paranoid about freshness.
 *
 * FRESHNESS IS THE WHOLE SAFETY MODEL. A row from a gateway that crashed an
 * hour ago is indistinguishable in SHAPE from a row written a second ago —
 * same columns, same types, looks completely valid. The only signal that it
 * is wrong is `received_at`. Every export here checks it and returns null
 * rather than a stale value, so a dead gateway degrades to "no live_gateway
 * data" (silent fallback to Databento-historical/Yahoo in build-desk.ts) —
 * never to a wrong number presented as a right one.
 *
 * This module NEVER throws on a missing gateway. No gateway running is the
 * default, expected state until one is actually deployed and authenticated.
 */

import { getSql } from "@/lib/db";
import type { IndexSymbol, LiveQuote, OhlcBar } from "./types";

/** Beyond this, a tick is not "live" — treat the gateway as down. */
export const TICK_FRESH_MS = 5_000;
/** Beyond this, a 1m bar is not current — the gateway has stalled. */
export const BAR_FRESH_MS = 90_000;

/** Gateway writes ES/NQ. Desk left book is MNQ — same NQ print. */
function tickSymbol(symbol: IndexSymbol): "ES" | "NQ" {
  return symbol === "ES" ? "ES" : "NQ";
}

/**
 * Every failure below used to be a silent `return null` — "whatever, this
 * source is simply unavailable." That reasoning is right for the DESK (a
 * dead gateway must never become a wrong number presented as a right one),
 * but it means a real break (wrong DATABASE_URL, missing migration, RLS,
 * pool exhaustion) is INDISTINGUISHABLE from the ordinary "gateway isn't
 * running right now" case — both look identical from the outside, forever.
 * Found 2026-09-30: the desk showed Yahoo/~600s lag for the whole NY AM
 * session while the gateway was independently confirmed writing fresh
 * sub-second rows into the correct database the entire time — with nothing
 * anywhere to tell us why the read side never saw them.
 *
 * databento.ts already logs its own failures (`[databento] ... HTTP 422`);
 * this matches that convention instead of the total silence that made this
 * one need a live SQL session and a browser to diagnose. Throttled per
 * distinct reason so an ordinary "gateway not running" period (polled every
 * 1-2s) doesn't flood function logs.
 */
const LOG_THROTTLE_MS = 30_000;
const lastLoggedAt = new Map<string, number>();
function logOnce(tag: string, reason: string): void {
  const now = Date.now();
  const last = lastLoggedAt.get(tag) ?? 0;
  if (now - last < LOG_THROTTLE_MS) return;
  lastLoggedAt.set(tag, now);
  console.warn(`[live-gateway] ${tag}: ${reason}`);
}

export interface LiveGatewayTick {
  symbol: IndexSymbol;
  price: number;
  bid: number | null;
  ask: number | null;
  marketTimeMs: number;
  receivedAtMs: number;
  ageMs: number;
}

/** Latest tick, or null if absent/stale/slow. 150ms cap so a hung DB
 *  never blocks the free Yahoo fallback. */
export async function readLiveTickFresh(
  symbol: IndexSymbol,
  waitMs = 150,
): Promise<LiveGatewayTick | null> {
  return Promise.race([
    readLiveTick(symbol).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs)),
  ]);
}

/** Latest tick for one symbol, or null when absent/stale/unreachable. */
export async function readLiveTick(
  symbol: IndexSymbol,
): Promise<LiveGatewayTick | null> {
  try {
    const sql = await getSql();
    const rows = await sql.query<{
      price: string | number;
      bid: string | number | null;
      ask: string | number | null;
      ts: string | Date;
      received_at: string | Date;
    }>(
      `select price, bid, ask, ts, received_at
         from live_market_ticks
        where symbol = $1`,
      [tickSymbol(symbol)],
    );
    const row = rows[0];
    if (!row) {
      logOnce(`tick:${symbol}`, "no row for symbol — gateway has never written, or this is the wrong database");
      return null;
    }

    const receivedAtMs = new Date(row.received_at).getTime();
    const ageMs = Date.now() - receivedAtMs;
    if (!(ageMs >= 0) || ageMs > TICK_FRESH_MS) {
      logOnce(`tick:${symbol}`, `stale — ageMs=${ageMs} (fresh cutoff ${TICK_FRESH_MS}ms)`);
      return null; // stale or clock skew
    }

    return {
      symbol,
      price: Number(row.price),
      bid: row.bid == null ? null : Number(row.bid),
      ask: row.ask == null ? null : Number(row.ask),
      marketTimeMs: new Date(row.ts).getTime(),
      receivedAtMs,
      ageMs,
    };
  } catch (err) {
    // DB unreachable, table missing (migration not yet applied), whatever —
    // this source is simply unavailable to the DESK (never its failure mode),
    // but not to the logs: see logOnce's comment above.
    logOnce(`tick:${symbol}`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Build a LiveQuote from a fresh gateway tick, matching the shape
 * fetchYahooLiveQuote/quoteFromDatabentoSeries already produce, so
 * build-desk.ts can treat all three sources identically.
 */
export function quoteFromLiveTick(
  tick: LiveGatewayTick,
  yahoo: string,
  previousClose: number,
): LiveQuote {
  const change = tick.price - previousClose;
  const now = Date.now();
  return {
    symbol: tick.symbol,
    yahoo,
    price: tick.price,
    marketTimeMs: tick.marketTimeMs,
    marketTimeIso: new Date(tick.marketTimeMs).toISOString(),
    previousClose,
    change,
    changePct: previousClose ? (change / previousClose) * 100 : 0,
    dayHigh: null,
    dayLow: null,
    volume: null,
    fetchedAtMs: now,
    fetchedAtIso: new Date(now).toISOString(),
    lagSec: Math.max(0, Math.round((now - tick.marketTimeMs) / 1000)),
    timezone: "America/New_York",
    source: "live_gateway",
  };
}

/**
 * Recent 1m bars for one symbol, newest-last (matching OhlcBar ordering
 * conventions elsewhere in this repo). Returns [] rather than null on
 * absence — callers already treat an empty/short series as "fall back",
 * same as a failed Yahoo/Databento fetch.
 *
 * Does NOT individually freshness-check every bar — only the newest one,
 * against `BAR_FRESH_MS`. Older bars in a fresh series are supposed to be
 * old; that is what a bar series is.
 */
export async function readLiveBars(
  symbol: IndexSymbol,
  limit = 200,
): Promise<OhlcBar[]> {
  try {
    const sql = await getSql();
    const rows = await sql.query<{
      bar_time: string | Date;
      o: string | number;
      h: string | number;
      l: string | number;
      c: string | number;
      v: string | number;
      received_at: string | Date;
    }>(
      `select bar_time, o, h, l, c, v, received_at
         from live_market_bars_1m
        where symbol = $1
        order by bar_time desc
        limit $2`,
      [tickSymbol(symbol), limit],
    );
    if (!rows.length) {
      logOnce(`bars:${symbol}`, "no rows for symbol — gateway has never written, or this is the wrong database");
      return [];
    }

    const newest = rows[0]!;
    const ageMs = Date.now() - new Date(newest.received_at).getTime();
    if (!(ageMs >= 0) || ageMs > BAR_FRESH_MS) {
      logOnce(`bars:${symbol}`, `stale — newest ageMs=${ageMs} (fresh cutoff ${BAR_FRESH_MS}ms)`);
      return [];
    }

    return rows
      .map((r) => ({
        t: new Date(r.bar_time).getTime(),
        o: Number(r.o),
        h: Number(r.h),
        l: Number(r.l),
        c: Number(r.c),
        v: Number(r.v),
      }))
      .sort((a, b) => a.t - b.t);
  } catch (err) {
    logOnce(`bars:${symbol}`, err instanceof Error ? err.message : String(err));
    return [];
  }
}
