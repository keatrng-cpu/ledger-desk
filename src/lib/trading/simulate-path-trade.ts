/**
 * Causal PATH trade simulation with scale-out risk-off.
 * Entry only at decision (closed bar). Walks FORWARD bars after entry for P&L.
 * At +1R: bank portion of size, move stop to BE (open risk ≈ 0). Runner to TP2.
 */

import type { OhlcBar } from "@/lib/market/types";
import {
  APLUS_RULES,
  CONTRACTS,
  sizeContracts,
  riskGradeFromScore,
  type ContractKey,
  type RiskGrade,
} from "@/lib/aplus/config";
import type { SetupCandidate } from "./scanner";

/** Hard day-trade risk caps (points). Wider than this = structural invalidation too far → skip. */
export const MAX_RISK_PTS: Record<string, number> = {
  MNQ: 48,
  NQ: 48,
  MES: 18,
  ES: 18,
  MYM: 80,
  YM: 80,
  M2K: 8,
  RTY: 8,
};
export const DEFAULT_MAX_RISK_PTS = 48;
/** Prefer ATR-ish min structure — stops tighter than this get padded to minRisk already */

export type TradeExitReason =
  | "stop"
  | "tp1"
  | "tp2"
  | "tp1_tp2"
  | "tp1_be"
  | "tp1_close"
  | "session_close"
  | "no_fill"
  | "skipped";

export interface ScaleLeg {
  at: string;
  price: number;
  contracts: number;
  r: number;
  note: string;
}

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
  rMultiple: number | null;
  pnlUsd: number | null;
  contracts: number;
  riskPct: number;
  riskDollars: number;
  grade: string;
  equity: number;
  entryTimeIso: string;
  exitTimeIso: string | null;
  barsHeld: number;
  riskOff: boolean;
  scaleLegs: ScaleLeg[];
  scaleNote: string;
  /** True when structural stop was wider than max day-trade risk */
  stopClamped: boolean;
  structuralRiskPts: number;
  /** Reject take — stop too wide / no forward path */
  qualitySkip: string | null;
}

function parseFirstPrice(text: string | undefined | null): number | null {
  if (!text) return null;
  const m = text.match(/(\d{3,6}(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function parseZoneMid(entryZone: string): number | null {
  const nums = [...entryZone.matchAll(/(\d{3,6}(?:\.\d+)?)/g)].map((m) =>
    Number(m[1]),
  );
  if (nums.length >= 2 && Number.isFinite(nums[0]) && Number.isFinite(nums[1])) {
    return (nums[0]! + nums[1]!) / 2;
  }
  if (nums.length === 1 && Number.isFinite(nums[0])) return nums[0]!;
  return null;
}

function pointValue(symbol: string): {
  pv: number;
  commission: number;
  key: ContractKey;
} {
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

function hitStop(
  side: "long" | "short",
  bar: OhlcBar,
  stop: number,
): boolean {
  return side === "long" ? bar.l <= stop : bar.h >= stop;
}

function hitTarget(
  side: "long" | "short",
  bar: OhlcBar,
  target: number,
): boolean {
  return side === "long" ? bar.h >= target : bar.l <= target;
}

function resolveGrade(best: SetupCandidate): RiskGrade {
  const rg = best.riskGrade;
  if (
    rg === "A+" ||
    rg === "A" ||
    rg === "A-" ||
    rg === "B+" ||
    rg === "B" ||
    rg === "C" ||
    rg === "skip"
  ) {
    return rg;
  }
  const pb = best.pathBand;
  if (
    pb === "A+" ||
    pb === "A" ||
    pb === "A-" ||
    pb === "B+" ||
    pb === "B" ||
    pb === "C" ||
    pb === "skip"
  ) {
    return pb === "skip" ? "skip" : pb;
  }
  return riskGradeFromScore(best.confluence);
}

export function simulatePathTrade(opts: {
  best: SetupCandidate;
  entryPrice: number;
  decisionMs: number;
  forwardBars: OhlcBar[];
  riskPtsFallback?: number;
  equity?: number;
  /** Override risk grade (A+ probe 2%, B+ 0.5%, etc.) */
  riskGradeOverride?: RiskGrade;
}): SimulatedTrade {
  const { best, entryPrice, decisionMs, forwardBars } = opts;
  const equity = opts.equity ?? APLUS_RULES.paperEquity;
  const side = best.side;
  const symbol = best.symbol;
  const so = APLUS_RULES.scaleOut;

  const invPx = parseFirstPrice(best.invalidation);
  let initialStop: number;
  if (invPx != null) {
    initialStop =
      side === "long"
        ? Math.min(invPx, entryPrice * 0.9985)
        : Math.max(invPx, entryPrice * 1.0015);
  } else {
    const pad = entryPrice * 0.0012;
    initialStop = side === "long" ? entryPrice - pad : entryPrice + pad;
  }

  const minRisk = entryPrice * 0.0006;
  let riskPts = Math.abs(entryPrice - initialStop);
  if (riskPts < minRisk) {
    riskPts = opts.riskPtsFallback ?? minRisk;
    initialStop =
      side === "long" ? entryPrice - riskPts : entryPrice + riskPts;
  }

  // Clamp / veto absurd invalidation distances (main loss source: 500–800pt stops)
  const maxRisk =
    MAX_RISK_PTS[symbol] ??
    MAX_RISK_PTS[symbol.replace(/^M/, "")] ??
    DEFAULT_MAX_RISK_PTS;
  const structuralRiskPts = riskPts;
  let qualitySkip: string | null = null;
  let stopClamped = false;
  if (structuralRiskPts > maxRisk) {
    stopClamped = true;
    if (structuralRiskPts > maxRisk * 1.25) {
      // Too far — invalidation is not a day-trade stop
      qualitySkip = `stop ${structuralRiskPts.toFixed(1)}pts > max ${maxRisk} (structural)`;
    } else {
      riskPts = maxRisk;
      initialStop =
        side === "long" ? entryPrice - riskPts : entryPrice + riskPts;
    }
  }

  const t1raw = parseFirstPrice(best.targets[0]);
  const t2raw = parseFirstPrice(best.targets[1]);
  let tp1 =
    side === "long" ? entryPrice + riskPts * 1.0 : entryPrice - riskPts * 1.0;
  let tp2 =
    side === "long" ? entryPrice + riskPts * 2.0 : entryPrice - riskPts * 2.0;

  if (t1raw != null) {
    const okSide = side === "long" ? t1raw > entryPrice : t1raw < entryPrice;
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
    const okSide = side === "long" ? t2raw > entryPrice : t2raw < entryPrice;
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

  const grade = opts.riskGradeOverride ?? resolveGrade(best);

  if (qualitySkip) {
    return {
      taken: false,
      symbol,
      side,
      entry: entryPrice,
      stop: initialStop,
      tp1,
      tp2,
      riskPts: structuralRiskPts,
      exit: null,
      exitReason: "skipped",
      rMultiple: null,
      pnlUsd: null,
      contracts: 0,
      riskPct: 0,
      riskDollars: 0,
      grade,
      equity,
      entryTimeIso: new Date(decisionMs).toISOString(),
      exitTimeIso: null,
      barsHeld: 0,
      riskOff: false,
      scaleLegs: [],
      scaleNote: qualitySkip,
      stopClamped: true,
      structuralRiskPts,
      qualitySkip,
    };
  }

  const sizing = sizeContracts({
    symbol,
    riskPts,
    equity,
    gradeOrScore: grade,
  });

  if (sizing.contracts < 1 || sizing.riskPct <= 0) {
    return {
      taken: false,
      symbol,
      side,
      entry: entryPrice,
      stop: initialStop,
      tp1,
      tp2,
      riskPts,
      exit: null,
      exitReason: "skipped",
      rMultiple: null,
      pnlUsd: null,
      contracts: 0,
      riskPct: 0,
      riskDollars: 0,
      grade,
      equity,
      entryTimeIso: new Date(decisionMs).toISOString(),
      exitTimeIso: null,
      barsHeld: 0,
      riskOff: false,
      scaleLegs: [],
      scaleNote: "Band B/skip — paper only, not live-sized",
      stopClamped,
      structuralRiskPts,
      qualitySkip: "band not sized",
    };
  }

  const totalContracts = sizing.contracts;
  const scaleLegs: ScaleLeg[] = [];
  let scaleNote = so.enabled
    ? `Risk-off: ${(so.tp1Fraction * 100).toFixed(0)}% @ TP1 → BE stop → runner TP2`
    : "Full size to first exit";

  const base: SimulatedTrade = {
    taken: true,
    symbol,
    side,
    entry: entryPrice,
    stop: initialStop,
    tp1,
    tp2,
    riskPts,
    exit: null,
    exitReason: "no_fill",
    rMultiple: null,
    pnlUsd: null,
    contracts: totalContracts,
    riskPct: sizing.riskPct,
    riskDollars: sizing.riskDollars,
    grade,
    equity,
    entryTimeIso: new Date(decisionMs).toISOString(),
    exitTimeIso: null,
    barsHeld: 0,
    riskOff: so.enabled && totalContracts >= 2,
    scaleLegs,
    scaleNote,
    stopClamped,
    structuralRiskPts,
    qualitySkip: null,
  };

  const path = forwardBars
    .filter((b) => b.t > decisionMs)
    .sort((a, b) => a.t - b.t);

  if (!path.length) {
    return { ...base, taken: true, exitReason: "no_fill" };
  }

  const { pv, commission } = pointValue(symbol);

  if (so.enabled && totalContracts >= 2) {
    const partial = Math.max(1, Math.floor(totalContracts * so.tp1Fraction));
    const runner = totalContracts - partial;
    let stop = initialStop;
    let tookTp1 = false;
    let realizedPtsWeighted = 0;
    let lastExit = entryPrice;
    let lastT = decisionMs;
    let held = 0;
    let reason: TradeExitReason = "session_close";

    for (const b of path) {
      held++;
      if (hitStop(side, b, stop)) {
        const pts = side === "long" ? stop - entryPrice : entryPrice - stop;
        const openCt = tookTp1 ? runner : totalContracts;
        realizedPtsWeighted += pts * openCt;
        scaleLegs.push({
          at: new Date(b.t).toISOString(),
          price: stop,
          contracts: openCt,
          r: riskPts > 0 ? pts / riskPts : 0,
          note: tookTp1 ? "runner stop @ BE/trail" : "full stop",
        });
        lastExit = stop;
        lastT = b.t;
        reason = tookTp1 ? "tp1_be" : "stop";
        break;
      }

      if (!tookTp1 && hitTarget(side, b, tp1)) {
        const pts = side === "long" ? tp1 - entryPrice : entryPrice - tp1;
        realizedPtsWeighted += pts * partial;
        scaleLegs.push({
          at: new Date(b.t).toISOString(),
          price: tp1,
          contracts: partial,
          r: riskPts > 0 ? pts / riskPts : 0,
          note: `risk-off ${(so.tp1Fraction * 100).toFixed(0)}% @ ~1R`,
        });
        tookTp1 = true;
        lastExit = tp1;
        lastT = b.t;
        if (so.moveStopToBeAfterTp1) {
          const buf = riskPts * (so.beBufferR ?? 0);
          stop = side === "long" ? entryPrice + buf : entryPrice - buf;
        }
        if (runner <= 0) {
          reason = "tp1";
          break;
        }
      }

      if (tookTp1 && runner > 0 && hitTarget(side, b, tp2)) {
        const pts = side === "long" ? tp2 - entryPrice : entryPrice - tp2;
        realizedPtsWeighted += pts * runner;
        scaleLegs.push({
          at: new Date(b.t).toISOString(),
          price: tp2,
          contracts: runner,
          r: riskPts > 0 ? pts / riskPts : 0,
          note: "runner @ TP2",
        });
        lastExit = tp2;
        lastT = b.t;
        reason = "tp1_tp2";
        break;
      }

      if (!tookTp1 && hitTarget(side, b, tp2)) {
        const pts = side === "long" ? tp2 - entryPrice : entryPrice - tp2;
        realizedPtsWeighted += pts * totalContracts;
        scaleLegs.push({
          at: new Date(b.t).toISOString(),
          price: tp2,
          contracts: totalContracts,
          r: riskPts > 0 ? pts / riskPts : 0,
          note: "gap through TP1 → full @ TP2",
        });
        lastExit = tp2;
        lastT = b.t;
        reason = "tp2";
        break;
      }
    }

    const stillOpen =
      scaleLegs.reduce((s, l) => s + l.contracts, 0) < totalContracts;
    if (stillOpen) {
      const last = path[path.length - 1]!;
      const openCt =
        totalContracts - scaleLegs.reduce((s, l) => s + l.contracts, 0);
      const pts =
        side === "long" ? last.c - entryPrice : entryPrice - last.c;
      realizedPtsWeighted += pts * openCt;
      scaleLegs.push({
        at: new Date(last.t).toISOString(),
        price: last.c,
        contracts: openCt,
        r: riskPts > 0 ? pts / riskPts : 0,
        note: tookTp1 ? "runner session close" : "session close",
      });
      lastExit = last.c;
      lastT = last.t;
      held = path.length;
      reason = tookTp1 ? "tp1_close" : "session_close";
    }

    const rMultiple =
      riskPts > 0 && totalContracts > 0
        ? realizedPtsWeighted / (riskPts * totalContracts)
        : 0;
    const avgPts =
      totalContracts > 0 ? realizedPtsWeighted / totalContracts : 0;
    const pnlUsd =
      avgPts * pv * totalContracts - commission * totalContracts;

    return {
      ...base,
      exit: lastExit,
      exitReason: reason,
      rMultiple: Math.round(rMultiple * 100) / 100,
      pnlUsd: Math.round(pnlUsd * 100) / 100,
      contracts: totalContracts,
      exitTimeIso: new Date(lastT).toISOString(),
      barsHeld: held,
      riskOff: true,
      scaleLegs,
      scaleNote: scaleLegs.map((l) => `${l.contracts}ct ${l.note}`).join(" · "),
    };
  }

  let exit: number | null = null;
  let reason: TradeExitReason = "session_close";
  let exitT: number | null = null;
  let held = 0;
  let stop = initialStop;

  for (const b of path) {
    held++;
    if (hitStop(side, b, stop)) {
      exit = stop;
      reason = "stop";
      exitT = b.t;
      break;
    }
    if (hitTarget(side, b, tp2)) {
      exit = tp2;
      reason = "tp2";
      exitT = b.t;
      break;
    }
    if (hitTarget(side, b, tp1)) {
      exit = tp1;
      reason = "tp1";
      exitT = b.t;
      break;
    }
  }

  if (exit == null) {
    const last = path[path.length - 1]!;
    exit = last.c;
    reason = "session_close";
    exitT = last.t;
    held = path.length;
  }

  const signedPts = side === "long" ? exit - entryPrice : entryPrice - exit;
  const rMultiple = riskPts > 0 ? signedPts / riskPts : 0;
  const pnlUsd =
    signedPts * pv * totalContracts - commission * totalContracts;

  return {
    ...base,
    exit,
    exitReason: reason,
    rMultiple: Math.round(rMultiple * 100) / 100,
    pnlUsd: Math.round(pnlUsd * 100) / 100,
    contracts: totalContracts,
    exitTimeIso: exitT ? new Date(exitT).toISOString() : null,
    barsHeld: held,
    riskOff: false,
    scaleLegs: [],
    scaleNote: "Full size (no scale)",
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
  riskOffCount: number;
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
    riskOffCount: taken.filter((t) => t.riskOff).length,
  };
}
