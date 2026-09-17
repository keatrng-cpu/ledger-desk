/**
 * Catastrophic-candle detector — the desk's circuit breaker.
 *
 * A Trump post, an unscheduled headline, a guidance leak: no calendar entry,
 * so the scheduled-news gate (news-calendar.json ± 15m) never fires. The first
 * candle blows through the array, the displacement detector reads a 4×ATR body
 * as a shift, and the retrace layer starts hunting a fill into a spike that was
 * a news reaction, not a model. This catches that from the TAPE — no news feed,
 * no LLM, no API — and locks the desk the same way an 8:30 print does.
 *
 * STATELESS BY DESIGN. The desk rebuilds every ~20s and cold-starts on every
 * serverless invocation, so there is no in-memory streak to trust. The lock is
 * derived from the bars themselves: the bars ARE the memory. If a shock-sized
 * candle printed inside the lock window, the lock is on — that fact survives
 * restarts, redeploys and tab reloads because it lives in the price series.
 *
 * NOTHING here forms a directional bias or gates a trade on sentiment. It sets
 * news.verdict = "blackout" for a fixed window (the desk already refuses TAKE /
 * auto-paper / alarm / options on blackout) and floors the SMC array time so a
 * NEW sequence must build after the shock. Deterministic; house rule intact.
 */

import type { OhlcBar } from "@/lib/market/types";
import { rollingAtr } from "./detectors";

/* ── Tunables. One place. Re-baseline after watching a few fire live. ────── */

/** A bar (or the live move) counts as a shock at ≥ this × the trailing ATR. */
export const SHOCK_RANGE_MULT = 3;
/** Hard lock after a shock: no entries, verdict blackout. */
export const SHOCK_LOCK_MS = 15 * 60_000;
/** After the lock, an A+-only tail while the dust settles. */
export const SHOCK_TAIL_MS = 60 * 60_000;
/**
 * Dead-market floor: below this the ATR multiple is noise (a 0.5-pt bar in a
 * 0.15-pt-ATR lull is "3× ATR" but not a shock). Points on the index itself.
 */
export const SHOCK_MIN_PTS: Record<string, number> = { ES: 12, NQ: 45, MNQ: 45 };
/** How many trailing bars the lock can reach back over (covers lock+tail). */
const SCAN_BARS = 8; // 8 × 15m = 2h — comfortably spans lock (15m) + tail (60m)

export type ShockKind = "macro" | "nq-led" | "es-led" | "single";

/**
 * Emitted when a shock is detected. The Tier-2 "explain this shock" hook
 * (xAI / Grok, out of the poll loop, narration only) consumes this — it is a
 * label request, never a gate. Serialisable so it can be journaled.
 */
export interface ShockEvent {
  at: number;
  symbol: string;
  side: "up" | "down";
  pts: number;
  atrMult: number;
  kind: ShockKind;
}

export interface ShockRead {
  /** Within the hard lock — desk stands down. */
  active: boolean;
  /** Past the lock, within the A+-only tail. */
  tail: boolean;
  at: number | null;
  ageSec: number | null;
  lockUntilMs: number | null;
  tailUntilMs: number | null;
  /** Floor for SMC arrays / sweeps: nothing before this counts post-shock. */
  freshFloorMs: number | null;
  event: ShockEvent | null;
  /** One line for the banner / news reason. */
  line: string;
}

const NONE: ShockRead = {
  active: false,
  tail: false,
  at: null,
  ageSec: null,
  lockUntilMs: null,
  tailUntilMs: null,
  freshFloorMs: null,
  event: null,
  line: "",
};

interface BookShock {
  at: number;
  side: "up" | "down";
  pts: number;
  atrMult: number;
}

/** Root symbol → the absolute-points floor. */
function minPts(symbol: string): number {
  const root = symbol.replace(/^M/, "");
  return SHOCK_MIN_PTS[symbol] ?? SHOCK_MIN_PTS[root] ?? 20;
}

/**
 * The most recent shock on ONE book, or null. Scans the last SCAN_BARS closed
 * bars for a range ≥ mult × ATR-at-that-bar, and also tests the live forming
 * move (quote vs last closed close) so a shock in progress is caught on the
 * very next 1-2s quote poll, not one 15m bar later.
 */
export function detectBookShock(
  symbol: string,
  closedBars: OhlcBar[],
  quote: { price: number; marketTimeMs: number } | null,
  nowMs: number,
): BookShock | null {
  if (closedBars.length < 20) return null;
  const atrs = rollingAtr(closedBars);
  const floor = minPts(symbol);
  let best: BookShock | null = null;

  const from = Math.max(1, closedBars.length - SCAN_BARS);
  for (let i = from; i < closedBars.length; i++) {
    const b = closedBars[i]!;
    const atr = atrs[i - 1]; // ATR up to the PRIOR bar — no self-reference
    if (!atr || !Number.isFinite(atr) || atr <= 0) continue;
    const range = b.h - b.l;
    const mult = range / atr;
    if (range >= floor && mult >= SHOCK_RANGE_MULT) {
      // A shock candle: direction from its body.
      const side: "up" | "down" = b.c >= b.o ? "up" : "down";
      if (!best || b.t > best.at) best = { at: b.t, side, pts: +range.toFixed(2), atrMult: +mult.toFixed(2) };
    }
  }

  // Live forming move: how far price has run from the last CLOSED close.
  const lastClosed = closedBars[closedBars.length - 1]!;
  const lastAtr = atrs[atrs.length - 1];
  if (quote && lastAtr && lastAtr > 0) {
    const move = Math.abs(quote.price - lastClosed.c);
    const mult = move / lastAtr;
    if (move >= floor && mult >= SHOCK_RANGE_MULT) {
      const side: "up" | "down" = quote.price >= lastClosed.c ? "up" : "down";
      const at = quote.marketTimeMs || nowMs;
      if (!best || at > best.at) best = { at, side, pts: +move.toFixed(2), atrMult: +mult.toFixed(2) };
    }
  }

  return best;
}

function fmtPts(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/**
 * Merge the two books into one desk-wide shock read. Correlation classifies
 * the cause — which changes nothing the desk DOES (it stands down either way),
 * but tells the trader (and the Tier-2 hook) what to look for.
 */
export function readShock(
  left: { symbol: string; closedBars: OhlcBar[]; quote: { price: number; marketTimeMs: number } | null },
  right: { symbol: string; closedBars: OhlcBar[]; quote: { price: number; marketTimeMs: number } | null },
  nowMs: number,
): ShockRead {
  const l = detectBookShock(left.symbol, left.closedBars, left.quote, nowMs);
  const r = detectBookShock(right.symbol, right.closedBars, right.quote, nowMs);
  if (!l && !r) return NONE;

  // Lead = the larger move in ATR terms.
  const lead =
    l && r ? (l.atrMult >= r.atrMult ? { s: left.symbol, b: l } : { s: right.symbol, b: r }) : l ? { s: left.symbol, b: l } : { s: right.symbol, b: r! };
  const at = Math.max(l?.at ?? 0, r?.at ?? 0);

  // Classify: both books shocked ≈ macro/political; one book ≫ other = that
  // index's own news (mega-cap earnings hit NQ far harder than ES).
  let kind: ShockKind;
  if (l && r) {
    const ratio = lead.b.atrMult / Math.min(l.atrMult, r.atrMult);
    if (ratio < 1.6) kind = "macro";
    else kind = lead.s.replace(/^M/, "") === "NQ" ? "nq-led" : "es-led";
  } else {
    kind = "single";
  }

  const lockUntilMs = at + SHOCK_LOCK_MS;
  const tailUntilMs = at + SHOCK_TAIL_MS;
  const active = nowMs < lockUntilMs;
  const tail = !active && nowMs < tailUntilMs;
  const arrow = lead.b.side === "up" ? "▲" : "▼";
  const kindLabel =
    kind === "macro" ? "macro/political — both books" : kind === "nq-led" ? "NQ-led (mega-cap?)" : kind === "es-led" ? "ES-led" : "single-index";
  const line = `SHOCK ${lead.s} ${arrow}${fmtPts(lead.b.pts)}pt · ${lead.b.atrMult.toFixed(1)}× ATR · ${kindLabel}`;

  return {
    active,
    tail,
    at,
    ageSec: Math.max(0, Math.round((nowMs - at) / 1000)),
    lockUntilMs,
    tailUntilMs,
    freshFloorMs: at,
    event: { at, symbol: lead.s, side: lead.b.side, pts: lead.b.pts, atrMult: lead.b.atrMult, kind },
    line,
  };
}
