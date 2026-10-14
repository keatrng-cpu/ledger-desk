/**
 * Fix 10 — execution fidelity (shadow).
 * (a) intradayTicket: AMD/SMT intraday tickets take optExec.dteByTime (0DTE before zeroDteUntilEt, never past
 *     session.zeroDteCutoffEt) on the book's ETF (MNQ→QQQ, ES→SPY) at a LIVE cross ratio (ETF quote and future
 *     quote within maxCrossSkewS of each other by feed time). No live cross → refused; a model strike is refused
 *     (audit F10). The 5DTE swing card stays a separate card.
 * (b) rungEval: every rung 1m/2m/3m/5m/15m judges its LAST CLOSED bar (by feed time) against each mapped array:
 *     the WICK decides a sweep/tap, the BODY close decides respect vs fail. Minute series older than
 *     maxStaleS (feed clock) → stale, and LTF decisions are refused (audit F9).
 */
import type { OhlcBar } from "@/lib/market/types";
import { dteTarget } from "@/lib/execution/opt-exec";
import { closedBuckets, type MapArray } from "./premarket-map";
import { etOf, r2, seqMode, seqNum, type Mode, type Side } from "./rules";

export const ETF_OF: Record<string, string> = { MNQ: "QQQ", NQ: "QQQ", ES: "SPY", MES: "SPY" };

export interface IntradayTicket {
  mode: Mode; book: string; etf: string | null; side: Side; dte: number;
  crossRatio: number | null; strike: number | null; right: "call" | "put";
  refused: string | null;
}
export function intradayTicket(i: { book: string; side: Side; nowMs: number; entry: number; fut: { price: number | null; marketTimeMs: number | null }; etfQuote: { price: number | null; marketTimeMs: number | null } | null; strikeSource?: "chain" | "model" | null }): IntradayTicket {
  const etf = ETF_OF[i.book] ?? null;
  const dte = dteTarget(etOf(i.nowMs).hm);
  const base: IntradayTicket = { mode: seqMode("intradayExec"), book: i.book, etf, side: i.side, dte, crossRatio: null, strike: null, right: i.side === "long" ? "call" : "put", refused: null };
  if (!etf) return { ...base, refused: "no ETF for this book" };
  const q = i.etfQuote, f = i.fut;
  if (!q?.price || !f.price || q.marketTimeMs == null || f.marketTimeMs == null) return { ...base, refused: "no live ETF cross (quote missing)" };
  if (Math.abs(q.marketTimeMs - f.marketTimeMs) > seqNum("intradayExec", "maxCrossSkewS", 60) * 1000) return { ...base, refused: "no live ETF cross (quotes not simultaneous)" };
  if (i.strikeSource === "model") return { ...base, refused: "model strike refused — chain strike required" };
  const ratio = q.price / f.price;
  return { ...base, crossRatio: +ratio.toFixed(6), strike: Math.round(i.entry * ratio) };
}

export interface RungEval { tf: string; barT: number; events: { array: string; event: "sweep" | "tap" | "respect" | "fail" }[] }
export interface RungRead { mode: Mode; stale: boolean; minuteAgeS: number | null; rungs: RungEval[] }

export function rungEval(closed1m: OhlcBar[], feedNowMs: number | null, arrays: MapArray[]): RungRead {
  const last = closed1m.at(-1);
  const age = last && feedNowMs != null ? Math.round((feedNowMs - (last.t + 60_000)) / 1000) : null;
  const stale = age == null || age > seqNum("intradayExec", "maxStaleS", 120);
  const out: RungRead = { mode: seqMode("intradayExec"), stale, minuteAgeS: age, rungs: [] };
  if (stale || feedNowMs == null) return out;
  for (const [tf, mins] of [["1m", 1], ["2m", 2], ["3m", 3], ["5m", 5], ["15m", 15]] as const) {
    const x = closedBuckets(closed1m, mins * 60_000, feedNowMs).at(-1);
    if (!x) continue;
    const ev: RungEval["events"] = [];
    for (const a of arrays.filter((z) => z.live)) {
      const name = `${a.tf} ${a.dir} ${a.kind} ${r2(a.lo)}–${r2(a.hi)}`;
      const top = Math.max(x.o, x.c), bot = Math.min(x.o, x.c);
      if (a.dir === "bear") { // resistance from above-approach: wick into = tap; wick beyond hi with body back below = sweep; body close above hi = fail
        if (x.c > a.hi) ev.push({ array: name, event: "fail" });
        else if (x.h > a.hi && top <= a.hi) ev.push({ array: name, event: "sweep" });
        else if (x.h >= a.lo && x.c < a.lo) ev.push({ array: name, event: "respect" });
        else if (x.h >= a.lo) ev.push({ array: name, event: "tap" });
      } else {
        if (x.c < a.lo) ev.push({ array: name, event: "fail" });
        else if (x.l < a.lo && bot >= a.lo) ev.push({ array: name, event: "sweep" });
        else if (x.l <= a.hi && x.c > a.hi) ev.push({ array: name, event: "respect" });
        else if (x.l <= a.hi) ev.push({ array: name, event: "tap" });
      }
    }
    out.rungs.push({ tf, barT: x.t, events: ev });
  }
  return out;
}
