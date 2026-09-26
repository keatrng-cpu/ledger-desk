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

export const PATH_MONTH_CAP = APLUS_RULES.targetTradesPerMonth.center; // 9
/** After this many consecutive full losses, next day stand down (unless A+ tight) */
export const MAX_CONSEC_LOSSES = 2;
/** Max PATH same direction in a rolling week */
export const MAX_SAME_SIDE_WEEK = 3;

/**
 * The bands that consume a slot under the ~9 PATH/month cap.
 *
 * ONE list, read by both `pathTakeGate` below and the counter that feeds it.
 * While the two disagreed the cap stopped meaning anything: the counter
 * admitted every paper row and the gate admitted only these, so the book could
 * trip a cap it had never actually filled. B (paper, 0% risk) and C (journal
 * micro, 0.5%) are deliberately absent — they are logged for the sample, they
 * are not PATH trades, and they must never spend a PATH slot. This list does
 * not decide what may be TAKEN; that is the gate, the floor and the sequence.
 */
export const PATH_BANDS: ReadonlySet<string> = new Set(["A+", "A", "A-", "B+"]);

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

  /**
   * MEASURED FIT DECIDES; the priority table only breaks ties.
   *
   * WHAT WAS WRONG: this used to read `if (unique.includes("tjr")) best =
   * "tjr"` — an unconditional override. `c.strategies` admits every model
   * scoring fit >= 0.35 (profit-path.ts), and because `structureQ` is shared
   * across all nine templates, TJR is in that list on almost every candidate.
   * So `strategyPrimary` was force-set to "tjr" regardless of which model
   * actually graded highest.
   *
   * That is not a cosmetic mislabel. `strategyPrimary` is what gets written
   * to `desk_trades.strategy` at log time, which is what the Phase C
   * scoreboard groups by, what `strategyVerdict` promotes/demotes on, and
   * what journal/discretion.ts keys its real sizing factor to. Nine different
   * setups were all booking to one label, so every per-strategy statistic in
   * the app was measuring a mixture rather than a model.
   *
   * Now: pick the model with the highest MEASURED fit among those actually
   * present, preferring one whose own must-conditions are complete. The
   * static `strategyPriority` table survives only as a tiebreak when two
   * models grade within FIT_TIE of each other — a genuine tie is the only
   * case where an author's preference ordering is the honest answer.
   */
  const FIT_TIE = 0.02;
  const gradeOf = (id: string) => c.strategyBoard?.find((b) => b.id === id);

  const ranked = [...unique].sort((a, b) => {
    const ga = gradeOf(a);
    const gb = gradeOf(b);
    // A model with no measured grade cannot outrank one that has it.
    if (ga && !gb) return -1;
    if (!ga && gb) return 1;
    if (ga && gb) {
      if (ga.complete !== gb.complete) return ga.complete ? -1 : 1;
      if (Math.abs(gb.fit - ga.fit) > FIT_TIE) return gb.fit - ga.fit;
    }
    return strategyPriority(b) - strategyPriority(a);
  });
  const best = ranked[0]!;

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

  if (!PATH_BANDS.has(String(band)) && !c.actionable) {
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

  // One book per day ALWAYS when both are path-eligible — not only when the
  // two books share a bias. `sameBias` still selects the wording below.
  {
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

/**
 * Same storage key as paper-manager.ts. Read directly (window-guarded) rather
 * than imported: this module is also used by journal/server.ts, and
 * paper-manager pulls in client-only session/alarm code.
 */
const PAPER_TRADES_KEY = "ledger-paper-trades-v1";

/**
 * The band a paper row was TAKEN at, normalised, or "" when the row carries
 * none that can be read.
 *
 * Precedence matches `pathTakeGate` above (`pathBand || riskGrade || grade`)
 * and `paperAPlusCounters` in paper-manager.ts, because the cap, the A+ sample
 * and the gate all have to answer "what band was this card" the same way or
 * they are measuring three different books. `cardBand` is where the
 * candidate's `riskGrade` lands on a paper row: it is the PRE-demotion band,
 * written since 2026-09-23 and absent on every row older than that, which is
 * why it cannot be read first-and-only. `grade` is last on purpose — it is the
 * SIZING grade, and rule 5's probe rewrites it from "A+" to "A", so on its own
 * it can no longer name the card.
 *
 * Normalises the two dashes a band can be typed with and nothing else. An
 * unrecognised string stays unrecognised; it is never coerced to the nearest
 * band.
 */
function recordedBand(r: Record<string, unknown>): string {
  for (const key of ["pathBand", "cardBand", "grade"] as const) {
    const raw = r[key];
    if (typeof raw !== "string") continue;
    const band = raw.trim().replace(/[\u2212\u2013]/g, "-");
    if (band) return band;
  }
  return "";
}

/**
 * Real fills from the browser's paper book. Used by the client counters below;
 * the server path reads desk_trades instead.
 *
 * TWO COUNTS OVER TWO WINDOWS — they answer different questions.
 *
 * `path` feeds the monthly cap and is scoped to `monthKey`. Until 2026-09-23
 * it incremented on EVERY paper row in the month, so a B-band paper fill and a
 * C-grade journal micro — neither of which `pathTakeGate` would admit as a
 * PATH trade — each burned one of the nine slots. The cap tripped early and
 * the gate then refused live A and A- cards with "month cap hit, A+ only".
 * Against a fixed $199/mo data bill that refusal is expensive in both
 * directions of the arithmetic: break-even average R is 1.07R at 8 trades a
 * month and 1.81R at 4. Rows are now filtered to `PATH_BANDS`. A row whose
 * band cannot be read at all still counts — an unreadable band is not evidence
 * of a free slot, and the protective direction on an overtrade cap is to count
 * it.
 *
 * `aPlusTaken/Wins` is rule 5's unlock sample and is deliberately NOT scoped to
 * the month. The unlock needs n>=20 while the cap is 9/month, so a
 * month-scoped sample can never reach it: the probe would hold on arithmetic
 * rather than on evidence. It is counted over the whole book, the way
 * `paperAPlusCounters` (paper-manager.ts) and the server's `readBookCounters`
 * (journal/server.ts) already count it. Resolved rows only, keyed on the
 * card's band rather than the sizing grade — keying on the sizing grade meant
 * the probe's own "A+" -> "A" rewrite deleted the sample that lifts it, so
 * from 2026-09-23 this client counter could never see an A+ trade at all. A
 * closed row carrying neither a dollar P&L nor an R is UNKNOWN and is left out
 * of the sample entirely rather than booked as a loss.
 */
function paperFillsForMonth(monthKey: string): {
  path: number;
  aPlusTaken: number;
  aPlusWins: number;
} {
  const out = { path: 0, aPlusTaken: 0, aPlusWins: 0 };
  if (typeof window === "undefined") return out;
  let rows: unknown;
  try {
    rows = JSON.parse(window.localStorage.getItem(PAPER_TRADES_KEY) ?? "[]");
  } catch {
    return out;
  }
  if (!Array.isArray(rows)) return out;
  for (const r of rows as Array<Record<string, unknown>>) {
    const band = recordedBand(r);

    if (band === "A+" && r.status === "closed") {
      const resolved =
        typeof r.pnlUsd === "number" && Number.isFinite(r.pnlUsd)
          ? r.pnlUsd
          : typeof r.rMultiple === "number" && Number.isFinite(r.rMultiple)
            ? r.rMultiple
            : null;
      if (resolved != null) {
        out.aPlusTaken += 1;
        if (resolved > 0) out.aPlusWins += 1;
      }
    }

    const openedAt = typeof r.openedAt === "number" ? r.openedAt : NaN;
    if (!Number.isFinite(openedAt) || monthKeyFromMs(openedAt) !== monthKey) continue;
    if (band && !PATH_BANDS.has(band)) continue;
    out.path += 1;
  }
  return out;
}

/**
 * Client-side counters for the PATH gates.
 *
 * Until 2026-09-16 this read `book.pathTaken` from desk memory, which the
 * 2024 backtest seed hydrates to 22 on every page load — so pathThisMonth
 * was 14 (cap 9 + 5) forever, `pathTakeGate` said "month cap hit, A+ only"
 * every day, and auto-paper never took an A or A- card. It also hardcoded
 * aPlusTaken = 0, so the 2% -> 3% A+ unlock could never trigger on the
 * client. Both now come from real fills: `pathThisMonth` from this month's
 * PATH-band rows, the A+ sample from the whole book (see above — a 20-trade
 * unlock cannot be counted inside a 9-trade month).
 *
 * `pathThisWeek`, `lastSides` and `consecLosses` are still left at their empty
 * values here, so the client gate does not enforce the same-side cap or the
 * loss cool-down. The server (journal/server.ts readBookCounters) does. Not
 * fixed in this pass: unlike the month cap those defaults fail OPEN, which is
 * a different and more careful change than this one.
 */
export function countersFromMemory(
  mem?: DeskMemoryState,
  monthKey?: string,
): BookCounters {
  const key = monthKey ?? monthKeyFromMs(Date.now());
  const c = emptyBookCounters(key);
  const fills = paperFillsForMonth(key);
  c.pathThisMonth = fills.path;
  c.aPlusTaken = fills.aPlusTaken;
  c.aPlusWins = fills.aPlusWins;
  // `mem` is accepted for call-site compatibility; the seeded book stats it
  // carries are backtest history, not this month's ledger.
  void mem;
  return c;
}

export function describeProfitRules(): string[] {
  return [
    `1. One book/day — MNQ or ES, never both same bias`,
    `2. blake_mech longs demoted to B+/paper until WR recovers`,
    `3. No model is preferred until n≥12 with positive expectancy — TJR's 2024 "100%" is 3 trades · mechanical needs companion or Q≥0.68`,
    `4. Hard cap ${PATH_MONTH_CAP} PATH/mo — after that A+ only`,
    `5. A+ size ${APLUS_PROBE_RISK * 100}% until n≥${APLUS_FULL_SIZE_MIN_N} WR≥${APLUS_FULL_SIZE_MIN_WR * 100}%`,
    `6. Skips journaled as process wins · wide stops rejected`,
    `7. Gold template (Jul 20): short + mechanical + clean risk-off — a remembered example, not a measured edge (4y: shorts 45% direction vs longs 54%)`,
    `8. Year-2024 seed: 22 PATH · 55% WR · +5.6R — history for the rate card, not this book`,
  ];
}
