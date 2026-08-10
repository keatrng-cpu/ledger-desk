/**
 * Profitability enforcement — calibrated from Jul 2024/2026 book analysis.
 * 1. One book per day (MNQ or ES, not both same bias)
 * 2. blake_mech longs → paper / B+ only until WR recovers
 * 3. mechanical (+ SMT/TJR companion) primary
 * 4. Hard cap ~9 PATH/mo (after 9 → A+ only or stand down)
 * 5. A+ size 2% until n≥20 A+ with WR≥65%
 * 6. Journal skips as process wins
 * 7. Gold-standard weeks = short + mechanical + clean risk-off (Jul 20 style)
 */

import { APLUS_RULES, type RiskGrade } from "@/lib/aplus/config";
import type { SetupCandidate } from "./scanner";
import type { DeskMemoryState } from "./desk-memory";
import { loadDeskMemory } from "./desk-memory";

export const PATH_MONTH_CAP = APLUS_RULES.targetTradesPerMonth.center; // 9
/** After this many consecutive full losses, next day stand down (unless A+ tight) */
export const MAX_CONSEC_LOSSES = 2;
/** Max PATH same direction in a rolling week */
export const MAX_SAME_SIDE_WEEK = 3;

export const APLUS_FULL_SIZE_MIN_N = 20;
export const APLUS_FULL_SIZE_MIN_WR = 0.65;
/** Temporary A+ risk until sample proves out */
export const APLUS_PROBE_RISK = 0.02;
export const APLUS_FULL_RISK = 0.03;

export const PRIMARY_STRATEGIES = [
  "mechanical",
  "tjr",
  "smt",
] as const;

export const DEMOTED_LONG_STRATEGIES = ["blake_mech"] as const;

export interface BookCounters {
  /** PATH fills taken this calendar month (paper book) */
  pathThisMonth: number;
  monthKey: string; // YYYY-MM
  aPlusTaken: number;
  aPlusWins: number;
  blakeLongTaken: number;
  blakeLongWins: number;
  consecLosses: number;
  lastSides: string[]; // recent PATH sides
  weekKey: string;
  pathThisWeek: number;
}

export function monthKeyFromMs(ms: number): string {
  const d = new Date(ms);
  // ET-ish: use UTC date of decision for stability in BT
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function emptyBookCounters(monthKey: string, weekKey = ""): BookCounters {
  return {
    pathThisMonth: 0,
    monthKey,
    aPlusTaken: 0,
    aPlusWins: 0,
    blakeLongTaken: 0,
    blakeLongWins: 0,
    consecLosses: 0,
    lastSides: [],
    weekKey,
    pathThisWeek: 0,
  };
}

/** blake_mech long WR recovered? need n≥15 and WR≥0.55 to re-promote */
export function blakeLongRecovered(c: BookCounters): boolean {
  if (c.blakeLongTaken < 15) return false;
  return c.blakeLongWins / c.blakeLongTaken >= 0.55;
}

export function aPlusFullSizeUnlocked(c: BookCounters): boolean {
  if (c.aPlusTaken < APLUS_FULL_SIZE_MIN_N) return false;
  return c.aPlusWins / c.aPlusTaken >= APLUS_FULL_SIZE_MIN_WR;
}

export function aPlusRiskPct(c: BookCounters): number {
  return aPlusFullSizeUnlocked(c) ? APLUS_FULL_RISK : APLUS_PROBE_RISK;
}

export function pathCapReached(c: BookCounters): boolean {
  return c.pathThisMonth >= PATH_MONTH_CAP;
}

/**
 * After monthly cap: only A+ may still take; else stand down.
 */
export function allowedAfterCap(
  band: string | undefined,
  capHit: boolean,
): boolean {
  if (!capHit) return true;
  return band === "A+";
}

/** Rule 2: blake_mech long demoted unless recovered */
export function isBlakeLongDemoted(
  c: SetupCandidate,
  counters: BookCounters,
): boolean {
  if (c.side !== "long") return false;
  const primary = c.completeStrategy || c.strategyPrimary || "";
  const strats = c.strategies || [];
  const isBlake =
    primary === "blake_mech" || strats.includes("blake_mech" as never);
  if (!isBlake) return false;
  return !blakeLongRecovered(counters);
}

/** Rule 3: strategy rank — higher = preferred primary */
export function strategyPriority(id: string): number {
  // 2024 year study: TJR 3/3 +1.98E[R]; mechanical alone ~flat
  const rank: Record<string, number> = {
    tjr: 110,
    mechanical: 95,
    smt: 90,
    judas: 70,
    pdi: 65,
    patty: 60,
    continuation: 55,
    ronan: 50,
    blake_mech: 35,
  };
  return rank[id] ?? 10;
}

/** Prefer mechanical / tjr / smt as complete primary when multiple complete */
export function promotePrimaryStrategy(c: SetupCandidate): SetupCandidate {
  const strats = [...(c.strategies || [])].map(String);
  if (c.strategyPrimary) strats.unshift(c.strategyPrimary);
  if (c.completeStrategy) strats.unshift(c.completeStrategy);
  const unique = [...new Set(strats)];
  if (!unique.length) return c;

  // Boost if mechanical + companion (smt or tjr)
  const hasMech = unique.includes("mechanical");
  const hasCompanion =
    unique.includes("smt") || unique.includes("tjr") || unique.includes("judas");

  unique.sort((a, b) => strategyPriority(b) - strategyPriority(a));
  let best = unique[0]!;
  // 2024: TJR first when present; else mechanical + companion stack
  if (unique.includes("tjr")) {
    best = "tjr";
  } else if (hasMech && hasCompanion) {
    best = "mechanical";
  }

  const next = { ...c };
  next.strategyPrimary = best;
  if (c.strategyComplete) next.completeStrategy = best;
  if (hasMech && hasCompanion) {
    next.reasons = [
      ...next.reasons,
      "primary: mechanical + SMT/TJR companion (promoted)",
    ];
    // Small quality nudge already applied elsewhere; tag for path
    next.reasons = [...next.reasons, "gold-stack: mechanical+companion"];
  }
  return next;
}

export type PathGateReason =
  | "ok"
  | "blake_long_demoted"
  | "month_cap"
  | "dual_book_block"
  | "not_path_band"
  | "htf"
  | "other";

export interface PathGateResult {
  take: boolean;
  reason: PathGateReason;
  detail: string;
  /** Force band down for demoted setups */
  forceBand?: "B+" | "B" | "skip";
  forceRiskGrade?: RiskGrade;
}

/**
 * Final take gate for a single candidate (rules 2, 4, band).
 */
export function pathTakeGate(
  c: SetupCandidate,
  counters: BookCounters,
  opts?: { alreadyTookSymbolToday?: string | null },
): PathGateResult {
  const band = c.pathBand || c.riskGrade || c.grade || "";

  if (!c.htfOk) {
    return { take: false, reason: "htf", detail: "HTF gate" };
  }

  // Rule 2 — blake long demote
  if (isBlakeLongDemoted(c, counters)) {
    return {
      take: false,
      reason: "blake_long_demoted",
      detail:
        "blake_mech long demoted to paper/B+ until WR recovers (n≥15, WR≥55%)",
      forceBand: "B+",
      forceRiskGrade: "B+",
    };
  }

  // Rule 4 — month cap
  const cap = pathCapReached(counters);
  if (cap && band !== "A+") {
    return {
      take: false,
      reason: "month_cap",
      detail: `PATH month cap ${PATH_MONTH_CAP} hit — only A+ allowed (now ${counters.pathThisMonth})`,
    };
  }

  // Loss streak cool-down
  if (counters.consecLosses >= MAX_CONSEC_LOSSES && band !== "A+") {
    return {
      take: false,
      reason: "other",
      detail: `Cool-down after ${counters.consecLosses} consec losses — A+ tight only`,
    };
  }

  // Same-side overtrade
  const side = c.side;
  const recentSame = counters.lastSides.filter((s) => s === side).length;
  if (recentSame >= MAX_SAME_SIDE_WEEK && band !== "A+") {
    return {
      take: false,
      reason: "other",
      detail: `Same-side cap: ${recentSame} recent ${side}s — wait flip or A+ only`,
    };
  }

  // Demote pure B+ chop unless gold/mechanical short with score
  if (band === "B+" && (c.confluence ?? 0) < 0.58) {
    return {
      take: false,
      reason: "not_path_band",
      detail: "B+ below 0.58 — skip micro edge noise",
    };
  }

  // Rule 1 helper — if another symbol already taken today, block
  if (
    opts?.alreadyTookSymbolToday &&
    opts.alreadyTookSymbolToday !== c.symbol
  ) {
    return {
      take: false,
      reason: "dual_book_block",
      detail: `One book/day — already PATH on ${opts.alreadyTookSymbolToday}`,
    };
  }

  const pathBands = new Set(["A+", "A", "A-", "B+"]);
  if (!pathBands.has(String(band)) && !c.actionable) {
    return { take: false, reason: "not_path_band", detail: `band ${band}` };
  }

  return { take: true, reason: "ok", detail: "path take allowed" };
}

/**
 * Rule 1: from dual candidates same day, pick one book.
 * Prefer higher quality, mechanical primary, not demoted blake long.
 */
export function pickOneBookPerDay(
  left: SetupCandidate | null,
  right: SetupCandidate | null,
  counters: BookCounters,
): {
  chosen: SetupCandidate | null;
  blocked: SetupCandidate | null;
  why: string;
} {
  const score = (c: SetupCandidate | null): number => {
    if (!c) return -1e9;
    if (isBlakeLongDemoted(c, counters)) return -1e6;
    let s = (c.qualityScore ?? c.confluence) * 100;
    s += strategyPriority(c.completeStrategy || c.strategyPrimary || "") * 0.1;
    if ((c.strategies || []).includes("mechanical" as never)) s += 5;
    if ((c.strategies || []).includes("smt" as never)) s += 2;
    if ((c.strategies || []).includes("tjr" as never)) s += 2;
    // Prefer shorts slightly when both equal (Jul 20 gold style)
    if (c.side === "short") s += 1.5;
    return s;
  };

  const ls = score(left);
  const rs = score(right);
  if (!left && !right) return { chosen: null, blocked: null, why: "no candidates" };
  if (left && !right) return { chosen: left, blocked: null, why: "single book" };
  if (right && !left) return { chosen: right, blocked: null, why: "single book" };

  // Same direction bias → must pick one
  const sameBias =
    left &&
    right &&
    left.side === right.side;

  if (sameBias || true) {
    // Always one book per day when both path-eligible
    if (ls >= rs) {
      return {
        chosen: left,
        blocked: right,
        why: sameBias
          ? `One book/day same bias ${left!.side} — kept ${left!.symbol} (Q/mech priority)`
          : `One book/day — kept ${left!.symbol}`,
      };
    }
    return {
      chosen: right,
      blocked: left,
      why: sameBias
        ? `One book/day same bias ${right!.side} — kept ${right!.symbol} (Q/mech priority)`
        : `One book/day — kept ${right!.symbol}`,
    };
  }

  return { chosen: left, blocked: right, why: "fallback" };
}

/** Rule 5 — resolve risk grade with A+ probe size */
export function resolveRiskGradeForTake(
  c: SetupCandidate,
  counters: BookCounters,
): RiskGrade {
  const band = (c.pathBand || c.riskGrade || c.grade || "skip") as string;
  if (band === "A+") {
    // Until unlocked, treat sizing as A (2%)
    return aPlusFullSizeUnlocked(counters) ? "A+" : "A";
  }
  if (
    band === "A" ||
    band === "A-" ||
    band === "B+" ||
    band === "B" ||
    band === "C" ||
    band === "skip"
  ) {
    return band as RiskGrade;
  }
  return "skip";
}

/** Rule 6 — format skip as process win for journal/memory */
export function formatSkipAsProcessWin(opts: {
  date: string;
  symbol: string;
  reason: string;
  bestScore?: number;
}): string {
  return `PROCESS WIN (skip) ${opts.date} ${opts.symbol}: ${opts.reason}${
    opts.bestScore != null ? ` · nearest ${opts.bestScore.toFixed(2)}` : ""
  }. Selectivity protected the book.`;
}

/** Rule 7 — gold standard pattern flags */
export function isGoldStandardSetup(c: SetupCandidate): boolean {
  const primary = c.completeStrategy || c.strategyPrimary || "";
  const strats = c.strategies || [];
  const mech =
    primary === "mechanical" || strats.includes("mechanical" as never);
  const short = c.side === "short";
  const path =
    c.pathBand === "A+" ||
    c.pathBand === "A" ||
    c.pathBand === "A-" ||
    c.actionable;
  return Boolean(mech && short && path && c.htfOk);
}

export function goldStandardNote(c: SetupCandidate): string | null {
  if (!isGoldStandardSetup(c)) return null;
  return "GOLD (Jul-20 style): short + mechanical + path — preferred template";
}

/** Merge counters from desk memory book stats (best-effort) */
export function countersFromMemory(
  mem?: DeskMemoryState,
  monthKey?: string,
): BookCounters {
  const m = mem ?? (typeof window !== "undefined" ? loadDeskMemory() : null);
  const key = monthKey ?? monthKeyFromMs(Date.now());
  const c = emptyBookCounters(key);
  if (!m) return c;
  // Approximate: use pathTaken as monthly if same session; real monthly tracked in BT loop
  c.pathThisMonth = Math.min(m.book.pathTaken, PATH_MONTH_CAP + 5);
  c.aPlusTaken = 0;
  c.aPlusWins = 0;
  return c;
}

export function describeProfitRules(): string[] {
  return [
    `1. One book/day — MNQ or ES, never both same bias`,
    `2. blake_mech longs demoted to B+/paper until WR recovers`,
    `3. TJR primary (2024 100% WR) · mechanical needs companion or Q≥0.68`,
    `4. Hard cap ${PATH_MONTH_CAP} PATH/mo — after that A+ only`,
    `5. A+ size ${APLUS_PROBE_RISK * 100}% until n≥${APLUS_FULL_SIZE_MIN_N} WR≥${APLUS_FULL_SIZE_MIN_WR * 100}%`,
    `6. Skips journaled as process wins · wide stops rejected`,
    `7. Gold: short + mechanical/TJR + risk-off · A- favored over soft A`,
    `8. Year-2024 seed: 22 PATH · 55% WR · +5.6R — brain rates loaded`,
  ];
}
