/**
 * Profit path — strategy-native two-axis grading toward ≥0.70 WR + ~9 PATH/mo.
 * Q quality · C strategy-complete · never take incomplete as path.
 * Math is deterministic. AI never decides trades.
 */

import { APLUS_RULES } from "@/lib/aplus/config";
import type { ClosedTrade, Metrics } from "@/lib/aplus/analytics";
import { computeMetrics } from "@/lib/aplus/analytics";
import type { ComponentKey } from "./engine-weights";
import type { SetupCandidate } from "./scanner";
import {
  bandIsPath,
  bandToDisplayGrade,
  bandToRiskGrade,
  bestStrategyGrade,
  gradeAllStrategies,
  pathBand,
  type PathBand,
} from "./strategy-grade";
import { promotePrimaryStrategy, goldStandardNote } from "./profit-rules";

export const PROFIT_TARGET_WR = 0.7;
export const PROFIT_TARGET_EXPECTANCY_R = 0.35;
export const PROFIT_MIN_SAMPLE = 100;
export const PROFIT_ACTION_FLOOR = APLUS_RULES.confluenceFloorCalibration;
export const PROFIT_A_PLUS = APLUS_RULES.aPlusThreshold;

export const INCOMPLETE_PATTERNS: {
  presentAny: ComponentKey[];
  mustHaveAny: ComponentKey[];
  note: string;
}[] = [
  {
    presentAny: ["ifvg", "structure"],
    mustHaveAny: ["mechanical_model", "mss", "displacement"],
    note: "iFVG+structure without mechanical sequence or true MSS/displacement — incomplete TJR model.",
  },
  {
    presentAny: ["ifvg"],
    mustHaveAny: ["sweep_significant", "mechanical_model", "displacement"],
    note: "iFVG without displacement/significant sweep — zone without the story.",
  },
];

export function isIncompletePattern(components: string[]): {
  incomplete: boolean;
  note: string | null;
} {
  const set = new Set(components);
  for (const p of INCOMPLETE_PATTERNS) {
    if (p.presentAny.length === 1 && p.presentAny[0] === "ifvg") {
      if (
        set.has("ifvg") &&
        !p.mustHaveAny.some((c) => set.has(c)) &&
        !set.has("mechanical_model") &&
        !set.has("mss")
      ) {
        return { incomplete: true, note: p.note };
      }
      continue;
    }
    const hasPresent = p.presentAny.every((c) => set.has(c));
    if (hasPresent && !p.mustHaveAny.some((c) => set.has(c))) {
      if (!set.has("mechanical_model")) {
        return { incomplete: true, note: p.note };
      }
    }
  }
  return { incomplete: false, note: null };
}

export type ProfitGrade = "A+" | "A" | "A-" | "B+" | "B" | "C" | "skip";

export function profitGrade(score: number, incomplete: boolean): ProfitGrade {
  if (incomplete) return "C";
  if (score >= PROFIT_A_PLUS) return "A+";
  if (score >= PROFIT_ACTION_FLOOR + 0.03) return "A";
  if (score >= PROFIT_ACTION_FLOOR) return "A-";
  if (score >= APLUS_RULES.confluenceFloor - 0.05) return "B+";
  if (score >= APLUS_RULES.confluenceFloor - 0.1) return "B";
  if (score >= APLUS_RULES.confluenceFloor - 0.18) return "C";
  return "skip";
}

export function isProfitPathEligible(g: ProfitGrade | PathBand): boolean {
  return g === "A+" || g === "A" || g === "A-" || g === "B+";
}

export function applyProfitPathToCandidate(c: SetupCandidate): SetupCandidate {
  const components = c.components || [];
  const board = gradeAllStrategies(components, {
    htfOk: c.htfOk,
    killzoneOk: c.killzoneOk,
    conditionsOk: c.conditionsOk,
  });
  const best =
    board[0] ??
    bestStrategyGrade(components, {
      htfOk: c.htfOk,
      killzoneOk: c.killzoneOk,
      conditionsOk: c.conditionsOk,
    });
  // Near-complete counts toward path so the desk is not starved of entries.
  const complete = best.complete || Boolean(best.nearComplete);
  const q = best.fit;
  const band = best.band;
  const riskGrade = bandToRiskGrade(band);
  const pathOk = bandIsPath(band);

  const next: SetupCandidate = { ...c };
  next.strategyBoard = board;
  next.structureScore = best.structureQ;
  next.confluence = q;
  next.grade =
    band === "A+"
      ? "A+"
      : band === "A" || band === "A-"
        ? "A-"
        : band === "B" || band === "C"
          ? "B"
          : "skip";
  if (band === "A") {
    next.reasons = [...next.reasons, "band:A (2% risk)"];
  } else if (band === "A-") {
    next.reasons = [...next.reasons, "band:A- (1% risk) — TAKE"];
  } else if (band === "B+") {
    next.reasons = [...next.reasons, "band:B+ (0.5% risk) — TAKE micro"];
  }
  next.pathBand = band;
  next.qualityScore = q;
  next.strategyComplete = complete;
  next.completeStrategy = String(best.id);
  next.completeNote = best.note;
  next.riskGrade = riskGrade;
  next.strategyPrimary = String(best.id);
  next.strategies = board
    .filter((b) => b.fit >= 0.35 || b.complete || Boolean(b.nearComplete))
    .map((b) => b.id as never);

  if (!complete) {
    next.missing = [
      `C incomplete: ${best.note}`,
      ...best.missing.map((m) => `need:${m}`),
      ...next.missing.filter((m) => !m.startsWith("incomplete:")),
    ];
    next.reasons = [
      ...next.reasons,
      `veto: ${best.note}`,
      `structure Q ${best.structureQ.toFixed(2)} · model Q ${best.modelQ.toFixed(2)}`,
    ];
  } else {
    next.reasons = [
      ...next.reasons,
      `C complete: ${best.note} (single model)`,
      `Q ${q.toFixed(2)} · band ${band} · structure ${best.structureQ.toFixed(2)}`,
    ];
  }

  next.reasons = [
    ...next.reasons,
    `models alone: ${board
      .slice(0, 4)
      .map((b) => `${b.label} ${b.fit.toFixed(2)}${b.complete ? "✓" : b.nearComplete ? "~" : ""}`)
      .join(" · ")}`,
  ];

  // Path bands A+/A/A-/B+ actionable when model complete OR near-complete.
  const bandPath = pathOk;
  next.actionable =
    bandPath &&
    (best.complete || Boolean(best.nearComplete) || band === "B+") &&
    c.htfOk &&
    c.conditionsOk &&
    (c.killzoneOk || bandPath) &&
    q >= PROFIT_ACTION_FLOOR - 0.05;

  if (!next.title.includes("[path")) {
    next.title = `${next.title} · [path ${band} · Q ${q.toFixed(2)}]`;
  } else {
    next.title = next.title.replace(
      /\[path[^\]]*\]/,
      `[path ${band} · Q ${q.toFixed(2)}]`,
    );
  }

  const promoted = promotePrimaryStrategy(next);
  const gold = goldStandardNote(promoted);
  if (gold) {
    promoted.reasons = [...promoted.reasons, gold];
  }
  return promoted;
}

export function filterPathTrades<
  T extends { grade?: string; pathBand?: string },
>(rows: T[]): T[] {
  return rows.filter((r) => {
    const b = r.pathBand || r.grade;
    return b === "A+" || b === "A" || b === "A-" || b === "B+";
  });
}

export interface GradeBucketStats {
  grade: string;
  trades: number;
  wins: number;
  winRate: number;
  expectancyR: number;
  netPnl: number;
  avgR: number;
}

export interface StrategyBucketStats {
  strategy: string;
  trades: number;
  wins: number;
  winRate: number;
  expectancyR: number;
  netPnl: number;
}

export interface GradedTrade extends ClosedTrade {
  grade?: string;
  strategy?: string;
}

function gradeFromScore(score?: number): string {
  if (score == null) return "unknown";
  if (score >= PROFIT_A_PLUS) return "A+";
  if (score >= PROFIT_ACTION_FLOOR + 0.03) return "A";
  if (score >= PROFIT_ACTION_FLOOR) return "A-";
  if (score >= APLUS_RULES.confluenceFloor - 0.05) return "B+";
  if (score >= APLUS_RULES.confluenceFloor - 0.1) return "B";
  return "other";
}

export function metricsByGrade(
  trades: GradedTrade[],
  equity: number,
): GradeBucketStats[] {
  const groups = new Map<string, GradedTrade[]>();
  for (const t of trades) {
    const g = (t.grade || gradeFromScore(t.confluence)).toUpperCase();
    const key =
      g.includes("A+") || g === "A+"
        ? "A+"
        : g === "A-" || g.includes("A-")
          ? "A-"
          : g.startsWith("A")
            ? "A"
            : g.includes("B+") || g === "B+"
              ? "B+"
              : g.startsWith("B")
                ? "B"
                : "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const order = ["A+", "A", "A-", "B+", "B", "other"];
  return order
    .filter((k) => groups.has(k))
    .map((k) => {
      const list = groups.get(k)!;
      const m = computeMetrics(list, equity);
      return {
        grade: k,
        trades: m.trades,
        wins: m.wins,
        winRate: m.winRate,
        expectancyR: m.expectancyR,
        netPnl: m.netPnl,
        avgR: m.trades ? list.reduce((s, t) => s + t.r, 0) / m.trades : 0,
      };
    });
}

function extractStrategy(reason: string): string | null {
  const m = reason.match(/strategy[:\s]+([a-z_]+)/i);
  return m?.[1] ?? null;
}

export function metricsByStrategy(
  trades: GradedTrade[],
  equity: number,
): StrategyBucketStats[] {
  const groups = new Map<string, GradedTrade[]>();
  for (const t of trades) {
    const s = (
      t.strategy ||
      extractStrategy(t.reason) ||
      "untagged"
    ).toLowerCase();
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s)!.push(t);
  }
  return [...groups.entries()]
    .map(([strategy, list]) => {
      const m = computeMetrics(list, equity);
      return {
        strategy,
        trades: m.trades,
        wins: m.wins,
        winRate: m.winRate,
        expectancyR: m.expectancyR,
        netPnl: m.netPnl,
      };
    })
    .sort((a, b) => b.trades - a.trades);
}

export interface ProfitPathSnapshot {
  targetWr: number;
  targetExpectancyR: number;
  minSample: number;
  actionFloor: number;
  aPlus: number;
  overall: Metrics;
  byGrade: GradeBucketStats[];
  byStrategy: StrategyBucketStats[];
  pathOnly: Metrics;
  pathTradeCount: number;
  sampleProgress: number;
  wrGap: number;
  onTrack: boolean;
  verdict: string;
  nextActions: string[];
  winsNeededForTarget: number | null;
}

export function buildProfitPath(
  trades: GradedTrade[],
  equity?: number,
): ProfitPathSnapshot {
  const eq = equity ?? (APLUS_RULES.accountEquity as number);
  const overall = computeMetrics(trades, eq);
  const byGrade = metricsByGrade(trades, eq);
  const byStrategy = metricsByStrategy(trades, eq);

  const pathTrades = trades.filter((t) => {
    const g = (t.grade || gradeFromScore(t.confluence)).toUpperCase();
    return (
      g === "A+" ||
      g === "A" ||
      g === "A-" ||
      g === "B+" ||
      g.startsWith("A") ||
      g.includes("B+")
    );
  });
  const pathOnly = computeMetrics(pathTrades, eq);
  const pathTradeCount = pathTrades.length;
  const sampleProgress = Math.min(1, pathTradeCount / PROFIT_MIN_SAMPLE);
  const wrGap = pathOnly.winRate - PROFIT_TARGET_WR;

  const nextActions: string[] = [];
  if (pathTradeCount < 20) {
    nextActions.push(
      "Log every A/A+ candidate (wins AND skips/losses) — sample < 20 is noise.",
    );
  }
  if (pathTradeCount < PROFIT_MIN_SAMPLE) {
    nextActions.push(
      `Build to ${PROFIT_MIN_SAMPLE} graded A-path trades before trusting live size (now ${pathTradeCount}).`,
    );
  }
  nextActions.push(
    `Execute path A+ (3%) / A (2%) / A- (1%) when strategy-complete. B = paper only · C = journal · never incomplete live.`,
  );
  nextActions.push(
    "Path requires strategy-complete template (mechanical/tjr/judas/pdi/…). Incomplete = C, not path.",
  );

  let verdict: string;
  let onTrack = false;
  if (pathTradeCount === 0) {
    verdict =
      "No A-path trades logged yet. Scanner grades live; journal A/A+ only to start the sample.";
  } else if (pathTradeCount < 30) {
    verdict = `Early sample (${pathTradeCount}). Follow path rules; do not judge WR until ~30–50 A-path trades.`;
  } else if (
    pathOnly.winRate >= PROFIT_TARGET_WR &&
    pathOnly.expectancyR >= PROFIT_TARGET_EXPECTANCY_R
  ) {
    verdict = `On track: path WR ${(pathOnly.winRate * 100).toFixed(0)}% and expectancy ${pathOnly.expectancyR.toFixed(2)}R. Keep selectivity.`;
    onTrack = true;
  } else if (pathOnly.winRate >= PROFIT_TARGET_WR - 0.05) {
    verdict = `Close to 70% WR (${(pathOnly.winRate * 100).toFixed(0)}%). Hold floor ${PROFIT_ACTION_FLOOR}; no size-up yet.`;
    onTrack = pathOnly.expectancyR > 0;
  } else {
    verdict = `Below path (${(pathOnly.winRate * 100).toFixed(0)}% WR). Raise bar: A+ only until WR recovers.`;
  }

  let winsNeededForTarget: number | null = null;
  if (pathTradeCount > 0 && pathTradeCount < PROFIT_MIN_SAMPLE) {
    const wins = pathOnly.wins;
    const remaining = PROFIT_MIN_SAMPLE - pathTradeCount;
    const need = Math.ceil(PROFIT_TARGET_WR * PROFIT_MIN_SAMPLE - wins);
    winsNeededForTarget = Math.max(0, Math.min(remaining, need));
  }

  return {
    targetWr: PROFIT_TARGET_WR,
    targetExpectancyR: PROFIT_TARGET_EXPECTANCY_R,
    minSample: PROFIT_MIN_SAMPLE,
    actionFloor: PROFIT_ACTION_FLOOR,
    aPlus: PROFIT_A_PLUS,
    overall,
    byGrade,
    byStrategy,
    pathOnly,
    pathTradeCount,
    sampleProgress,
    wrGap,
    onTrack,
    verdict,
    nextActions,
    winsNeededForTarget,
  };
}

export function demoGradedTrades(): GradedTrade[] {
  return [];
}
