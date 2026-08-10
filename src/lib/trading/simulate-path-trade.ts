/**
 * Causal PATH trade simulation.
 * Entry only at decision (closed bar). Walks FORWARD bars after entry for P&L.
 * Looking at post-entry bars is legitimate fill simulation — not look-ahead bias
 * for the decision (decision already made).
 */

import type { OhlcBar } from "@/lib/market/types";
import {
  APLUS_RULES,
  CONTRACTS,
  sizeContracts,
  riskGradeFromScore,
  type ContractKey,
} from "@/lib/aplus/config";
import type { SetupCandidate } from "./scanner";

export type TradeExitReason =
  | "stop"
  | "tp1"
  | "tp2"
  | "session_close"
  | "no_fill"
  | "skipped";

export interface SimulatedTrade {
  taken: boolean;
  symbol: string;
  side: "long" | "short";
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  riskPts: number;
  exit: number | null;
  exitReason: TradeExitReason;
  /** +R multiple at exit (negative = loss) */
  rMultiple: number | null;
  /** Dollar P&L on paper book (grade-sized micros − commission) */
  pnlUsd: number | null;
  contracts: number;
  /** Risk % used for size (1–3% by grade) */
  riskPct: number;
  riskDollars: number;
  grade: string;
  equity: number;
  entryTimeIso: string;
  exitTimeIso: string | null;
  barsHeld: number;
}

function parseFirstPrice(text: string | undefined | null): number | null {
  if (!text) return null;
  const m = text.match(/(\d{3,6}(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseZoneMid(entryZone: string): number | null {
  const nums = [...entryZone.matchAll(/(\d{3,6}(?:\.\d+)?)/g)].map((m) =>
    Number(m[1]),
  );
  if (nums.length >= 2 && Number.isFinite(nums[0]) && Number.isFinite(nums[1])) {
    return (nums[0]! + nums[1]!) / 2;
  }
  if (nums.length === 1 && Number.isFinite(nums[0])) return nums[0]!;
  return null;
}

function pointValue(symbol: string): { pv: number; commission: number; key: ContractKey } {
  const key = (symbol in CONTRACTS ? symbol : "MNQ") as ContractKey;
  if (APLUS_RULES.useMicros) {
    const micro = CONTRACTS[key].micro as ContractKey;
    if (micro in CONTRACTS) {
      const c = CONTRACTS[micro];
      return { pv: c.pointValue, commission: c.commission, key: micro };
    }
  }
  const c = CONTRACTS[key] ?? CONTRACTS.MNQ;
  return { pv: c.pointValue, commission: c.commission, key };
}

/**
 * Simulate one PATH trade.
 * @param forwardBars RTH 1m bars with t > decisionMs (same session day preferred)
 * @param entryPrice decision close (causal last print)
 */
export function simulatePathTrade(opts: {
  best: SetupCandidate;
  entryPrice: number;
  decisionMs: number;
  forwardBars: OhlcBar[];
  /** Risk distance override in points; default from stop structure or ~0.15% */
  riskPtsFallback?: number;
  /** Paper / backtest equity (default $100k). */
  equity?: number;
}): SimulatedTrade {
  const { best, entryPrice, decisionMs, forwardBars } = opts;
  const equity = opts.equity ?? APLUS_RULES.paperEquity;
  const side = best.side;
  const symbol = best.symbol;

  // Structural stop from invalidation text, else ~0.12% of price
  const invPx = parseFirstPrice(best.invalidation);
  let stop: number;
  if (invPx != null) {
    stop =
      side === "long"
        ? Math.min(invPx, entryPrice * 0.9985)
        : Math.max(invPx, entryPrice * 1.0015);
  } else {
    const pad = entryPrice * 0.0012;
    stop = side === "long" ? entryPrice - pad : entryPrice + pad;
  }

  // Ensure minimum risk ticks
  const minRisk = entryPrice * 0.0006;
  let riskPts = Math.abs(entryPrice - stop);
  if (riskPts < minRisk) {
    riskPts = opts.riskPtsFallback ?? minRisk;
    stop = side === "long" ? entryPrice - riskPts : entryPrice + riskPts;
  }

  // Targets: parse structure, clamp 1R–3R
  const t1raw = parseFirstPrice(best.targets[0]);
  const t2raw = parseFirstPrice(best.targets[1]);
  let tp1 =
    side === "long" ? entryPrice + riskPts * 1.0 : entryPrice - riskPts * 1.0;
  let tp2 =
    side === "long" ? entryPrice + riskPts * 2.0 : entryPrice - riskPts * 2.0;

  // Only accept structure targets on the correct side of entry
  if (t1raw != null) {
    const okSide =
      side === "long" ? t1raw > entryPrice : t1raw < entryPrice;
    const rDist = Math.abs(t1raw - entryPrice);
    if (
      okSide &&
      rDist >= riskPts * 0.8 &&
      rDist <= riskPts * APLUS_RULES.tpMaxR
    ) {
      tp1 = t1raw;
    }
  }
  if (t2raw != null) {
    const okSide =
      side === "long" ? t2raw > entryPrice : t2raw < entryPrice;
    const rDist = Math.abs(t2raw - entryPrice);
    if (
      okSide &&
      rDist > Math.abs(tp1 - entryPrice) &&
      rDist <= riskPts * APLUS_RULES.tpMaxR
    ) {
      tp2 = t2raw;
    } else {
      tp2 =
        side === "long"
          ? entryPrice + Math.abs(tp1 - entryPrice) * 1.5
          : entryPrice - Math.abs(tp1 - entryPrice) * 1.5;
    }
  }

  const grade = riskGradeFromScore(best.confluence);
  const sizing = sizeContracts({
    symbol,
    riskPts,
    equity,
    gradeOrScore: best.confluence,
  });

  const base: SimulatedTrade = {
    taken: true,
    symbol,
    side,
    entry: entryPrice,
    stop,
    tp1,
    tp2,
    riskPts,
    exit: null,
    exitReason: "no_fill",
    rMultiple: null,
    pnlUsd: null,
    contracts: sizing.contracts,
    riskPct: sizing.riskPct,
    riskDollars: sizing.riskDollars,
    grade,
    equity,
    entryTimeIso: new Date(decisionMs).toISOString(),
    exitTimeIso: null,
    barsHeld: 0,
  };

  // Walk forward only — bars after decision
  const path = forwardBars
    .filter((b) => b.t > decisionMs)
    .sort((a, b) => a.t - b.t);

  if (!path.length) {
    return { ...base, taken: true, exitReason: "no_fill" };
  }

  let exit: number | null = null;
  let reason: TradeExitReason = "session_close";
  let exitT: number | null = null;
  let held = 0;

  for (const b of path) {
    held++;
    if (side === "long") {
      // stop first (conservative: same bar stop before TP)
      if (b.l <= stop) {
        exit = stop;
        reason = "stop";
        exitT = b.t;
        break;
      }
      if (b.h >= tp2) {
        exit = tp2;
        reason = "tp2";
        exitT = b.t;
        break;
      }
      if (b.h >= tp1) {
        exit = tp1;
        reason = "tp1";
        exitT = b.t;
        break;
      }
    } else {
      if (b.h >= stop) {
        exit = stop;
        reason = "stop";
        exitT = b.t;
        break;
      }
      if (b.l <= tp2) {
        exit = tp2;
        reason = "tp2";
        exitT = b.t;
        break;
      }
      if (b.l <= tp1) {
        exit = tp1;
        reason = "tp1";
        exitT = b.t;
        break;
      }
    }
  }

  if (exit == null) {
    // Session close = last bar close
    const last = path[path.length - 1]!;
    exit = last.c;
    reason = "session_close";
    exitT = last.t;
    held = path.length;
  }

  const signedPts = side === "long" ? exit - entryPrice : entryPrice - exit;
  const rMultiple = riskPts > 0 ? signedPts / riskPts : 0;
  const { pv, commission } = pointValue(symbol);
  const contracts = base.contracts;
  const pnlUsd = signedPts * pv * contracts - commission * contracts;

  return {
    ...base,
    exit,
    exitReason: reason,
    rMultiple: Math.round(rMultiple * 100) / 100,
    pnlUsd: Math.round(pnlUsd * 100) / 100,
    contracts,
    exitTimeIso: exitT ? new Date(exitT).toISOString() : null,
    barsHeld: held,
  };
}

export function summarizeTrades(trades: SimulatedTrade[]): {
  taken: number;
  wins: number;
  losses: number;
  winRate: number | null;
  sumR: number;
  expectancyR: number | null;
  sumUsd: number;
  avgR: number | null;
} {
  const taken = trades.filter((t) => t.taken && t.rMultiple != null);
  const wins = taken.filter((t) => (t.rMultiple ?? 0) > 0).length;
  const losses = taken.filter((t) => (t.rMultiple ?? 0) <= 0).length;
  const sumR = taken.reduce((s, t) => s + (t.rMultiple ?? 0), 0);
  const sumUsd = taken.reduce((s, t) => s + (t.pnlUsd ?? 0), 0);
  const n = taken.length;
  return {
    taken: n,
    wins,
    losses,
    winRate: n ? wins / n : null,
    sumR: Math.round(sumR * 100) / 100,
    expectancyR: n ? Math.round((sumR / n) * 100) / 100 : null,
    sumUsd: Math.round(sumUsd * 100) / 100,
    avgR: n ? Math.round((sumR / n) * 100) / 100 : null,
  };
}

export { parseZoneMid };
