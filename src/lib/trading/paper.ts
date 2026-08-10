/**
 * Paper-trade loop — Phase 4, step 1 of the unlock ladder (ROADMAP).
 *
 * PURE FUNCTIONS ONLY. No timers, no I/O, no `Date.now()` branching on
 * wall-clock behaviour, no DB. The polling desk calls `evaluatePaperCycle()`
 * once per poll and hands the result to `@/lib/bridge/paper-server` for
 * persistence. That split is what makes the loop testable and replayable: the
 * same function can be driven by historical bars.
 *
 * Everything produced here is PAPER. Rows land with mode='paper',
 * source='paper'; nothing in this module can place a real order.
 *
 * Semantics (deliberately conservative — a paper sample that flatters itself is
 * worse than no sample):
 *   entry  = midpoint of the candidate's side of the dealing range
 *            long  -> midpoint(low, eq)   [discount half]
 *            short -> midpoint(eq, high)  [premium half]
 *   stop   = the numeric invalidation level: PDL for longs, PDH for shorts
 *            (falls back to the dealing-range extreme when PDH/PDL is absent)
 *   target = 2R from entry
 *   size   = 1 micro contract
 *   exits  = touch-based on the current bar's high/low. If BOTH the stop and
 *            the target are inside the same bar, the STOP wins — intrabar
 *            sequence is unknowable from OHLC, so we always assume the adverse
 *            path.
 */

import type { OhlcBar } from "@/lib/market/types";
import type { SetupCandidate, SetupSide } from "./scanner";
import type { HtfBiasRead } from "./structure";
import { isPathTake } from "./strategy-grade";

/** One micro contract per paper trade — fixed, not risk-scaled. */
export const PAPER_CONTRACTS = 1;

/** Reward multiple used for the paper target. */
export const PAPER_TARGET_R = 2;

/** An open paper position as stored in `desk_trades` (mode/source = 'paper'). */
export interface OpenPaperTrade {
  id: string;
  symbol: string;
  side: SetupSide;
  entry: number;
  stop: number;
  target: number;
  contracts: number;
  openedAt: string;
}

/** A proposed paper entry for this cycle. */
export interface PaperIntent {
  candidateId: string;
  symbol: string;
  side: SetupSide;
  entry: number;
  stop: number;
  target: number;
  contracts: number;
  riskPoints: number;
  prescore: number;
  grade: SetupCandidate["grade"];
  reason: string;
}

/** A close produced by this cycle. */
export interface PaperExitEvent {
  tradeId: string;
  symbol: string;
  side: SetupSide;
  entry: number;
  exit: number;
  outcome: "stop" | "target";
  r: number;
  reason: string;
}

/** Why an actionable candidate did not become an intent. */
export interface PaperSkip {
  candidateId: string;
  symbol: string;
  side: SetupSide;
  reason: string;
}

export interface PaperCycleResult {
  entries: PaperIntent[];
  exits: PaperExitEvent[];
  skips: PaperSkip[];
}

export interface PaperBiasPair {
  left: HtfBiasRead;
  right: HtfBiasRead;
}

/** Current bar per symbol, e.g. `{ MNQ: lastBar, ES: lastBar }`. */
export type CurrentBars = Record<string, OhlcBar | undefined>;

const round2 = (n: number) => Math.round(n * 100) / 100;

function readFor(bias: PaperBiasPair, symbol: string): HtfBiasRead | null {
  if (bias.left?.symbol === symbol) return bias.left;
  if (bias.right?.symbol === symbol) return bias.right;
  return null;
}

/** Numeric midpoint of the candidate's half of the dealing range. */
export function zoneMidpoint(read: HtfBiasRead, side: SetupSide): number | null {
  const d = read.dealing;
  if (!d) return null;
  const mid = side === "long" ? (d.low + d.eq) / 2 : (d.eq + d.high) / 2;
  return Number.isFinite(mid) ? round2(mid) : null;
}

/** Numeric invalidation: PDL (long) / PDH (short), dealing extreme as fallback. */
export function invalidationLevel(
  read: HtfBiasRead,
  side: SetupSide,
): number | null {
  const level =
    side === "long"
      ? (read.pdl ?? read.dealing?.low ?? null)
      : (read.pdh ?? read.dealing?.high ?? null);
  return level != null && Number.isFinite(level) ? round2(level) : null;
}

/** 2R target from a validated entry/stop pair. */
export function targetFor(
  entry: number,
  stop: number,
  side: SetupSide,
  rMultiple = PAPER_TARGET_R,
): number {
  const risk = Math.abs(entry - stop);
  return round2(side === "long" ? entry + rMultiple * risk : entry - rMultiple * risk);
}

/** Realized R of a close (exactly -1 at the stop, +2 at the 2R target). */
export function realizedR(
  trade: Pick<OpenPaperTrade, "entry" | "stop" | "side">,
  exit: number,
): number {
  const risk = Math.abs(trade.entry - trade.stop);
  if (risk <= 0) return 0;
  const move = trade.side === "long" ? exit - trade.entry : trade.entry - exit;
  return Math.round((move / risk) * 10_000) / 10_000;
}

/** Build the paper intent for one candidate, or the reason it is unusable. */
export function buildIntent(
  candidate: SetupCandidate,
  read: HtfBiasRead,
): PaperIntent | PaperSkip {
  const base = {
    candidateId: candidate.id,
    symbol: candidate.symbol,
    side: candidate.side,
  };
  const entry = zoneMidpoint(read, candidate.side);
  if (entry == null) {
    return { ...base, reason: "no dealing range — cannot price the zone" };
  }
  const stop = invalidationLevel(read, candidate.side);
  if (stop == null) {
    return { ...base, reason: "no PDH/PDL invalidation level" };
  }
  const valid = candidate.side === "long" ? stop < entry : stop > entry;
  if (!valid) {
    return {
      ...base,
      reason: `invalidation ${stop} on the wrong side of entry ${entry}`,
    };
  }
  const riskPoints = round2(Math.abs(entry - stop));
  if (riskPoints <= 0) {
    return { ...base, reason: "zero-width risk" };
  }
  return {
    ...base,
    entry,
    stop,
    target: targetFor(entry, stop, candidate.side),
    contracts: PAPER_CONTRACTS,
    riskPoints,
    prescore: candidate.confluence,
    grade: candidate.grade,
    reason: `PAPER ${candidate.grade} · ${candidate.title}`,
  };
}

function isSkip(v: PaperIntent | PaperSkip): v is PaperSkip {
  return !("entry" in v);
}

/** Touch test for one open trade against the current bar (stop wins ties). */
export function evaluateOpenTrade(
  trade: OpenPaperTrade,
  bar: OhlcBar,
): PaperExitEvent | null {
  const stopHit =
    trade.side === "long" ? bar.l <= trade.stop : bar.h >= trade.stop;
  const targetHit =
    trade.side === "long" ? bar.h >= trade.target : bar.l <= trade.target;

  if (!stopHit && !targetHit) return null;

  // Conservative: same-bar ambiguity always resolves to the stop.
  const outcome: PaperExitEvent["outcome"] = stopHit ? "stop" : "target";
  const exit = stopHit ? trade.stop : trade.target;
  return {
    tradeId: trade.id,
    symbol: trade.symbol,
    side: trade.side,
    entry: trade.entry,
    exit,
    outcome,
    r: realizedR(trade, exit),
    reason:
      stopHit && targetHit
        ? "PAPER stop and target both inside the bar — stop assumed first"
        : stopHit
          ? "PAPER stop touched"
          : "PAPER 2R target touched",
  };
}

/**
 * One paper cycle: propose entries for actionable candidates that have no open
 * paper position on the same symbol+side, and close open positions whose stop
 * or target the current bar touched.
 *
 * Pure: identical inputs always produce identical output.
 */
export function evaluatePaperCycle(
  candidates: SetupCandidate[],
  bias: PaperBiasPair,
  openPaperTrades: OpenPaperTrade[],
  currentBars: CurrentBars,
): PaperCycleResult {
  const entries: PaperIntent[] = [];
  const skips: PaperSkip[] = [];
  const exits: PaperExitEvent[] = [];

  const taken = new Set(
    openPaperTrades.map((t) => `${t.symbol}|${t.side}`),
  );

  for (const candidate of candidates) {
    if (!candidate.actionable && !isPathTake(candidate)) continue;
    const key = `${candidate.symbol}|${candidate.side}`;
    if (taken.has(key)) continue; // one paper position per symbol+side
    const read = readFor(bias, candidate.symbol);
    if (!read) {
      skips.push({
        candidateId: candidate.id,
        symbol: candidate.symbol,
        side: candidate.side,
        reason: "no HTF bias read for symbol",
      });
      continue;
    }
    const built = buildIntent(candidate, read);
    if (isSkip(built)) {
      skips.push(built);
      continue;
    }
    entries.push(built);
    taken.add(key); // never two intents for the same symbol+side in one cycle
  }

  for (const trade of openPaperTrades) {
    const bar = currentBars[trade.symbol];
    if (!bar) continue;
    const exit = evaluateOpenTrade(trade, bar);
    if (exit) exits.push(exit);
  }

  return { entries, exits, skips };
}
