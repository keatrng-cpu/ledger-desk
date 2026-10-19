/**
 * Deep audit 2026-10-15 (audits/deep-audit-1015/report.md) — pure helpers for the
 * card seal that runs LAST in build-desk, after discipline and the loss guards:
 *   #1/#13 invalidation (price at/through the stop, or adverse distance past the stop)
 *   #2     the 1m bars "since entry" so "T1 already traded" can fire
 *   #12    stale tape withholds grades
 *   #14    the stop text is rendered from the number
 *   #15    levels on the 0.25 tick grid
 *   #16    level hysteresis (levels change only on a closed defining-tf bar)
 *   #5/#6  the option ticket follows the card (underlier, side, DTE)
 * Nothing here reads the network or the clock; build-desk and desk-listen call it.
 */
import type { OhlcBar } from "@/lib/market/types";

export const TICK: Record<string, number> = { ES: 0.25, MES: 0.25, NQ: 0.25, MNQ: 0.25 };
export const tickOf = (symbol: string) => TICK[symbol.toUpperCase()] ?? 0.25;

/** Round onto the grid. "up"/"down" are directional; "near" is nearest. Float-safe. */
export function roundTick(px: number, symbol: string, mode: "near" | "up" | "down" = "near"): number {
  const t = tickOf(symbol);
  const k = px / t;
  const e = 1e-9;
  const n = mode === "up" ? Math.ceil(k - e) : mode === "down" ? Math.floor(k + e) : Math.round(k);
  return +(n * t).toFixed(4);
}

export interface PlanLike { entry: number; stop: number; t1: number | null; t2: number | null; riskPts?: number; rr1?: number | null; rr2?: number | null; entryZone?: { top: number; bottom: number } | null }

/**
 * #15: entry rounds TOWARD the market (so a resting limit is reachable), the stop
 * AWAY from the entry (never tighter than the plan), targets TOWARD the entry
 * (never promise more than the plan). riskPts / rr are recomputed from the rounded levels.
 */
export function roundPlan<T extends PlanLike>(p: T, side: "long" | "short", symbol: string, price: number | null): T {
  const long = side === "long";
  const towardMkt = price == null ? "near" : price >= p.entry ? "up" : "down";
  const entry = roundTick(p.entry, symbol, towardMkt);
  const stop = roundTick(p.stop, symbol, long ? "down" : "up");
  const tgt = (x: number | null) => (x == null ? null : roundTick(x, symbol, long ? "down" : "up"));
  const t1 = tgt(p.t1), t2 = tgt(p.t2);
  const risk = Math.abs(entry - stop);
  const rr = (t: number | null) => (t == null || !(risk > 0) ? null : +(Math.abs(t - entry) / risk).toFixed(2));
  const out = { ...p, entry, stop, t1, t2 } as T;
  if ("riskPts" in p) out.riskPts = +risk.toFixed(2);
  if ("rr1" in p) out.rr1 = rr(t1);
  if ("rr2" in p) out.rr2 = rr(t2);
  return out;
}

/** #14: one renderer. Keeps the "— why" tail of the old text, replaces the number. */
export function stopText(stopPx: number, old?: string | null): string {
  const tail = old && old.includes("—") ? old.slice(old.indexOf("—")).trim() : null;
  return `Stop ${stopPx.toFixed(2)}${tail ? ` ${tail}` : ""}`;
}
/** The number the text claims; null when the text names no stop. */
export function stopFromText(text: string | null | undefined): number | null {
  const m = /Stop\s+(-?\d+(?:\.\d+)?)/.exec(text ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * #1/#13: the plan is dead once price is at/through the stop (adverse side), or
 * the stop already printed in the bars since entry. A resting order whose stop
 * is already through can only fill-and-stop in the same tick (paper -4.1R 10/14 14:33).
 */
export function invalidationOf(o: { side: "long" | "short"; price: number | null; entry: number | null; stop: number | null; atr?: number | null; sinceEntry?: OhlcBar[] | null }): { invalid: boolean; why: string | null; beyondAtr: number | null; unknown?: boolean } {
  const { side, price, entry, stop } = o;
  // Accuracy PR #19: no price (or no stop) is UNKNOWN, not "valid" — the caller makes the card not actionable.
  if (price == null || !Number.isFinite(price) || stop == null) return { invalid: false, why: price == null || !Number.isFinite(price) ? "UNKNOWN: no live price — cannot tell whether the stop printed, not actionable" : "UNKNOWN: no stop priced — not actionable", beyondAtr: null, unknown: true };
  const long = side === "long";
  const beyond = long ? stop - price : price - stop; // > 0 = price through the stop
  const beyondAtr = o.atr && o.atr > 0 ? +(beyond / o.atr).toFixed(2) : null;
  if (beyond >= 0) return { invalid: true, why: `INVALIDATED: price ${price} is ${long ? "at/below" : "at/above"} the stop ${stop}${beyondAtr != null ? ` (${beyondAtr}×ATR through)` : ""}`, beyondAtr };
  if (entry != null && (long ? stop >= entry : stop <= entry)) return { invalid: true, why: `INVALIDATED: stop ${stop} is on the wrong side of entry ${entry}`, beyondAtr };
  const printed = (o.sinceEntry ?? []).find((b) => (long ? b.l <= stop : b.h >= stop));
  if (printed) return { invalid: true, why: `INVALIDATED: the stop ${stop} printed at ${new Date(printed.t).toISOString()}`, beyondAtr };
  return { invalid: false, why: null, beyondAtr };
}

/**
 * #2: the 1m bars since the card's entry level was last traded (the move away from entry),
 * in the window `lookback` bars. No touch in the window → the last `fallback` bars (the
 * card's plausible print window). The forming bar (last) is included: the current print counts.
 */
export function barsSinceEntry(minute: OhlcBar[] | null | undefined, entry: number | null, lookback = 240, fallback = 30, from: "last" | "first" = "last"): OhlcBar[] {
  const m = minute ?? [];
  if (!m.length || entry == null) return [];
  const w = m.slice(-lookback);
  // "first": from the FIRST entry touch in the window, so T1-then-back-to-entry stays played out (Accuracy PR #19).
  if (from === "first") {
    const i = w.findIndex((b) => b.l <= entry && b.h >= entry);
    return i >= 0 ? w.slice(i) : w.slice(-fallback);
  }
  for (let i = w.length - 1; i >= 0; i--) {
    const b = w[i]!;
    if (b.l <= entry && b.h >= entry) return w.slice(i);
  }
  return w.slice(-fallback);
}

/**
 * Played-out scan, 10/19 fix (Accuracy 08:55 ET: MNQ short continuation demoted on a T1 that printed at 07:34 ET,
 * an hour BEFORE its entry gap formed at 08:38 ET). The bars that can play a card out start at the LATER of
 *   - the entry gap / plan anchor's formation bar (`formedT`, ms), and
 *   - the first entry touch at or after that formation.
 * A touch or a T1 print from before the setup existed never counts. No touch since formation → the last
 * `fallback` bars since formation (T1 running away unfilled is still a miss). `formedT` null → the old
 * first-touch-in-window scan (barsSinceEntry "first"), so a plan without an anchor keeps today's behavior.
 */
export function playedOutBars(minute: OhlcBar[] | null | undefined, entry: number | null, formedT: number | null | undefined, lookback = 240, fallback = 30): OhlcBar[] {
  if (formedT == null || !Number.isFinite(formedT)) return barsSinceEntry(minute, entry, lookback, fallback, "first");
  const m = minute ?? [];
  if (!m.length || entry == null) return [];
  const w = m.slice(-lookback).filter((b) => b.t >= formedT);
  const i = w.findIndex((b) => b.l <= entry && b.h >= entry);
  return i >= 0 ? w.slice(i) : w.slice(-fallback);
}

/**
 * The formation time of the plan's entry anchor: the plan's own `entryFormedT` — set by the build-desk LTF-arm /
 * iFVG-flip / planAt plans, exec-context, and cardPlanFrom (entry gap's time, else the raid time) — else the newest
 * `rows` array (the caller passes mtfArrays: recent 1m-derived rows only) whose zone matches `entryZone` to the tick
 * (iFVG → its inversion time). Null when neither exists — the caller keeps the old first-touch scan.
 */
export function entryFormedTOf(plan: { entryFormedT?: number | null; entryZone?: { top: number; bottom: number } | null } | null | undefined,
  rows: { lo: number; hi: number; kind?: string; createdT: number; invertedT?: number | null }[] = [], tick = 0.25): number | null {
  if (!plan) return null;
  if (plan.entryFormedT != null && Number.isFinite(plan.entryFormedT)) return plan.entryFormedT;
  const z = plan.entryZone;
  if (!z) return null;
  let best: number | null = null;
  for (const r of rows) {
    if (Math.abs(r.lo - z.bottom) > tick + 1e-9 || Math.abs(r.hi - z.top) > tick + 1e-9) continue;
    const t = r.kind === "ifvg" ? (r.invertedT ?? r.createdT) : r.createdT;
    if (Number.isFinite(t) && (best == null || t > best)) best = t;
  }
  return best;
}

/**
 * Accuracy #56 (2): stop and T1 are judged on the SAME formation-anchored bars (playedOutBars); whichever prints
 * first decides. Both on one bar → "stop" (conservative: a 1R loss is never graded as T1 traded).
 */
export function firstPrintOf(bars: OhlcBar[], side: "long" | "short", stop: number | null, t1: number | null): "stop" | "t1" | null {
  const L = side === "long";
  for (const b of bars) {
    if (stop != null && (L ? b.l <= stop : b.h >= stop)) return "stop";
    if (t1 != null && (L ? b.h >= t1 : b.l <= t1)) return "t1";
  }
  return null;
}

/** #12: the tape is stale when either book's quote lags more than maxLagSec. */
export const STALE_TAPE_SEC = 30;
export function tapeStale(lags: (number | null | undefined)[], maxLagSec = STALE_TAPE_SEC): boolean {
  return lags.some((x) => x == null || !Number.isFinite(x) || x > maxLagSec);
}

/**
 * #16: hysteresis. A card's levels (entry/stop/t1/t2) are pinned per signal key and only
 * change on a new CLOSED bar of the defining timeframe. Warm-instance memory.
 */
export interface Pinned { entry: number; stop: number; t1: number | null; t2: number | null; barT: number; at: number }
const PINS = new Map<string, Pinned>();
export function pinKey(symbol: string, side: string, anchor: string | number | null | undefined) { return `${symbol}:${side}:${anchor ?? "-"}`; }
export function pinLevels(key: string, next: Omit<Pinned, "at">, nowMs: number, store: Map<string, Pinned> = PINS, ttlMs = 30 * 60_000): { levels: Pinned; held: boolean } {
  for (const [k, v] of store) if (nowMs - v.at > ttlMs) store.delete(k);
  const prev = store.get(key);
  if (prev && prev.barT >= next.barT) { prev.at = nowMs; return { levels: prev, held: prev.entry !== next.entry || prev.stop !== next.stop || prev.t1 !== next.t1 || prev.t2 !== next.t2 }; }
  const v = { ...next, at: nowMs };
  store.set(key, v);
  return { levels: v, held: false };
}

/** #5: the ticket follows the card. MNQ/NQ → QQQ, ES/MES → SPY; long → call, short → put. */
export function ticketForCard(symbol: string, side: "long" | "short"): { underlier: "QQQ" | "SPY"; right: "call" | "put" } {
  const u = /NQ$/i.test(symbol) ? "QQQ" : "SPY";
  return { underlier: u, right: side === "long" ? "call" : "put" };
}
export function ticketMatchesCard(t: { underlier?: string | null; right?: string | null; side?: string | null } | null | undefined, symbol: string, side: "long" | "short"): { ok: boolean; why: string | null } {
  if (!t) return { ok: true, why: null };
  const want = ticketForCard(symbol, side);
  const right = String(t.right ?? t.side ?? "").toLowerCase();
  const und = String(t.underlier ?? "").toUpperCase();
  const bad: string[] = [];
  if (und && und !== want.underlier) bad.push(`underlier ${und} ≠ ${want.underlier}`);
  if (right && !right.startsWith(want.right)) bad.push(`${right} ≠ ${want.right} for a ${side} card`);
  return { ok: bad.length === 0, why: bad.length ? `ticket contradicts the card (${symbol} ${side}): ${bad.join("; ")}` : null };
}
/** #6: an intraday plan wants 0–1 DTE; a swing plan any. */
export function dteFitsPlan(dte: number | null | undefined, horizon: "intraday" | "swing"): boolean {
  if (dte == null || !Number.isFinite(dte)) return false;
  return horizon === "swing" ? dte >= 1 : dte === 0; // owner rule 2026-10-15: intraday 0DTE only, 1DTE+ swing only
}

/** #4: one journal row per setup idea per day — symbol + side + structural anchor. */
export function journalSetupId(day: string, c: { symbol: string; side: string; entry: number | null; context?: Record<string, unknown> }): string {
  const a = c.context?.anchor ?? c.context?.sweep ?? c.context?.poi;
  return `${day}:${c.symbol}:${c.side}:${a != null && a !== "" ? String(a) : "idea"}`;
}
