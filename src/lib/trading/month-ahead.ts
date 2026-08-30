/**
 * Month-ahead bias the desk, session brief, brain, and HUD all read.
 * Sunday seed is static. Live CMH/CML overlay from bars (no lookahead).
 * Swap/add a MonthPlan on the last Sunday of the prior month.
 */

import type { OhlcBar } from "@/lib/market/types";
import { etDateKey } from "./week-ahead";
import { etWallParts } from "./sessions";

export type MonthPhaseId =
  | "labor"
  | "holiday_cpi"
  | "fomc"
  | "digest"
  | "pce";

export interface MonthBookLevels {
  settle: number;
  pwh: number;
  pwl: number;
  ath: number;
  eq: number;
  drawUp: string;
  drawDown: string;
  note: string;
  /** Current-month high from tape (this month only, no future bars). */
  cmh?: number | null;
  cml?: number | null;
  live?: boolean;
}

export interface MonthPhase {
  id: MonthPhaseId;
  label: string;
  start: string;
  end: string;
  character: string;
  dailyBias: string;
  pathQuota: string;
  book: string;
  strategy: string;
  skipIf: string;
  blackouts: string;
}

export interface MonthLiq {
  bsl: string[];
  irl: string[];
  ssl: string[];
}

export interface MonthPlan {
  id: string;
  monthLabel: string;
  monthStart: string;
  monthEnd: string;
  headline: string;
  thesis: string;
  htfBias: string;
  fed: string;
  seasonality: string;
  nq: MonthBookLevels;
  es: MonthBookLevels;
  liqNq: MonthLiq;
  liqEs: MonthLiq;
  rules: string[];
  ops: string[];
  phases: MonthPhase[];
  outcomes: { p: number; name: string; detail: string }[];
}

export interface MonthAheadRead {
  plan: MonthPlan;
  dateKey: string;
  phase: MonthPhase | null;
  nextPhase: MonthPhase | null;
  window: "prep" | "live" | "done";
  live: boolean;
  refreshedAt: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function addDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utc = Date.UTC(y!, m! - 1, d! + n);
  const dt = new Date(utc);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** September 2026 — data-then-Fed. Visible from Sun Aug 30. */
export const MONTH_SEP_2026: MonthPlan = {
  id: "2026-09",
  monthLabel: "September 2026",
  monthStart: "2026-08-31",
  monthEnd: "2026-09-30",
  headline:
    "Data-then-Fed month — not a clean trend. Labor → CPI → FOMC. News is liquidity, not a directional call.",
  thesis:
    "Conditional two-way on NQ. ES is the stronger book. Last prints that matter before Sep 16 are the labor + CPI stack, not speeches.",
  htfBias:
    "NQ weaker (duration + hike repricing), −2.9% 3-month, ~1,480 pts off Jun 16 ATH 30,975. ES holds better, ~116 pts off Aug 13 ATH 7,838. SMT shorts need NQ to take a high ES does not (or NQ to take a low ES refuses).",
  fed: "Funds 3.50–3.75%. July 9–3 hold; three wanted a hike. Sep 16 is SEP + dots. Statement 14:00 ET, presser 14:30 ET. Live bet is hold vs +25, not a cut. Odds stale until NFP Fri 9/4 and CPI Fri 9/11 restamp them.",
  seasonality:
    "September is the weakest S&P month on a long sample (~−0.6% to −1.2%). Tendency, not a setup. Do not short “because September.” Size down and demand A / A+.",
  nq: {
    settle: 29492,
    pwh: 29811,
    pwl: 28947,
    ath: 30975,
    eq: 29379,
    drawUp: "PWH 29,811 then Aug 18 30,121 / Aug 17 30,343. ATH 30,975 only on soft-data + dovish Fed — do not pre-buy.",
    drawDown: "Fri low 29,436 then 29,367 then PWL 28,947 then early-Aug 28,314 if 28,947 goes.",
    note: "Fri 8/28 settle just above EQ of 28,947–29,811. Premium shorts only after they raid PWH. First real break of last week’s range after quiet VIX is usually the one that sticks.",
  },
  es: {
    settle: 7723,
    pwh: 7783,
    pwl: 7655,
    ath: 7838.5,
    eq: 7719,
    drawUp: "7,783 then ATH 7,838.50",
    drawDown: "Hold-zone 7,700 then 7,690 then 7,655",
    note: "SMT companion. Not the primary book unless NQ is dead and ES has the clean raid.",
  },
  liqNq: {
    bsl: ["Fri/PWH 29,811", "Aug 18 30,121", "Aug 17 30,343", "ATH 30,975"],
    irl: ["EQ ~29,379", "Fri settle 29,492", "29,367"],
    ssl: ["Fri low 29,436", "PWL 28,947 (Aug 24)", "Early-Aug 28,314"],
  },
  liqEs: {
    bsl: ["Week high ~7,783", "ATH 7,838.50"],
    irl: ["Settle ~7,723", "EQ ~7,719"],
    ssl: ["Hold 7,700", "PWL area 7,655"],
  },
  rules: [
    "One book per day. MNQ or ES, not both same bias.",
    "Judas 9:30–9:45 ET every day. No entry 8:15–9:00 on NFP / CPI / FOMC morning.",
    "After 10:00 ET, A+ only on event days.",
    "blake_mech longs stay paper / B+ until WR recovers.",
    "Primary: mechanical + SMT/TJR companion.",
    "PATH floor 0.65. Month cap ~9 — after 9, A+ only or stand. 6–9 is the cap not the goal.",
    "Soft-data longs you skipped that paid are still process wins.",
    "A+ size 2% until A+ sample n≥20 and WR≥65%.",
  ],
  ops: [
    "8:20 CDT brief. 8:30–8:44 Judas. 8:45–9:00 pulses. After 10:00 ET on event days, A+ only.",
    "Blackouts ±15m: 9/1 10:00 · 9/2 8:15 · 9/3 8:30/10:00 · 9/4 8:30 · 9/10 8:30 · 9/11 8:30 · 9/16 8:30 and 13:45–15:00 · 9/29 10:00 · 9/30 8:15–8:45.",
    "Journal skips on Labor Day Tue, FOMC Tue, and CPI/NFP opens with no MSS as process wins.",
    "Sunday night: restamp this file if levels, odds, or actuals drifted. Do not invent fills.",
  ],
  phases: [
    {
      id: "labor",
      label: "Labor",
      start: "2026-08-31",
      end: "2026-09-04",
      character: "Two-way. NFP Fri is the raid, not a directional call.",
      dailyBias: "Conditional two-way. Lean short only if ISM/ADP/NFP stack hot.",
      pathQuota: "1–2 PATH is a win. Cap is not the job on an NFP week.",
      book: "MNQ primary. ES only if NQ is dead.",
      strategy:
        "Mechanical + SMT after the print. Mon range-build. Tue ISM/JOLTS 10:00 stand 9:50–10:15. Wed ADP A+ only, flatten before AVGO. Thu selective. Fri NFP: no entry 8:15–9:00, second impulse after 9:45, stand if no MSS+IFVG by 10:15.",
      skipIf: "No raid of Friday extremes by 10:00 Mon. No displacement after 10:15 on event days.",
      blackouts: "Tue 10:00 · Wed 8:15 · Thu 8:30/10:00 · Fri 8:30",
    },
    {
      id: "holiday_cpi",
      label: "Holiday + CPI",
      start: "2026-09-07",
      end: "2026-09-11",
      character: "Thin Tuesday then inflation. Last hard CPI before FOMC.",
      dailyBias: "A / A+ only into CPI. Do not fade the first 30 min of CPI.",
      pathQuota: "A / A+ only. If Week 1 already took a hawkish short and CPI is hot, you do not need a second Friday short.",
      book: "One book. MNQ primary.",
      strategy:
        "Mon Labor Day — cash closed, Globex fake, do not treat Asia as HTF. Tue post-holiday Judas, A+ until the range is in. Wed quiet PATH if Week 1 left a clean dealing range. Thu PPI = CPI sneak preview. Fri CPI same protocol as NFP. Hot core ≥0.3% m/m → draw PWL 28,947 after BSL raid + MSS. In-line → stand unless A+. Soft → squeeze 29,811 / 7,838 only after SSL in discount.",
      skipIf: "No MSS + IFVG by 10:15 Fri. Do not short the first CPI spike.",
      blackouts: "Thu 8:30 PPI · Fri 8:30 CPI",
    },
    {
      id: "fomc",
      label: "FOMC + SEP",
      start: "2026-09-14",
      end: "2026-09-18",
      character: "Compression then the event. Most desks overtrade after 14:00. Yours should not.",
      dailyBias: "Stand into the decision. Delivery is Thu/Fri, not Wed 14:01.",
      pathQuota: "0–1 PATH before 14:00 Wed. After the decision: stand or A+ displacement only.",
      book: "Flatten before 13:45 ET Wednesday. Do not hold a runner into 14:00.",
      strategy:
        "Mon: do not buy strength into Tue/Wed. Tue FOMC day 1 — A+ only, no statement. Wed Retail Sales 8:30 then statement 14:00 + dots + presser 14:30. Do not invent a PATH from the first 60 seconds. Hold+hawkish SEP → NQ-lead lower, SMT short if ES holds, take Thu/Fri. +25 hike → both sides first, real move after presser fail. Hold+dovish → raid Week 2 lows then squeeze, long only discount SSL + MSS.",
      skipIf: "Already have a book this week. Anything still open at 13:45 Wed.",
      blackouts: "Wed 8:30 Retail · Wed 13:45–15:00 decision/presser",
    },
    {
      id: "digest",
      label: "Digest",
      start: "2026-09-21",
      end: "2026-09-25",
      character: "Quietest cash week. July-20-style mechanical if the range is clean.",
      dailyBias: "Normal PATH if FOMC resolved the range. Two-way if it did not.",
      pathQuota: "Normal PATH. Gold-standard = raid + mechanical + clean risk-off.",
      book: "MNQ primary. Use post-Fed CMH/CML — do not keep trading August PWH/PWL if taken.",
      strategy:
        "If FOMC resolved the range, HTF draw is the post-Fed extreme. If not, still inside the Aug 24–Sep 16 box — same Week 1 two-way rules. Claims Thu 8:30. Housing / Richmond / confidence midweek are not your trigger.",
      skipIf: "No clean raid. Do not force the 9/month quota on a dead week.",
      blackouts: "Thu 8:30 claims (medium)",
    },
    {
      id: "pce",
      label: "PCE",
      start: "2026-09-28",
      end: "2026-09-30",
      character: "Next labor/inflation cycle. PCE is the Fed’s gauge. Oct 2 is September NFP — do not swing into it.",
      dailyBias: "Hot core PCE after a hold = October hike repricing, NQ-lead weakness. Soft PCE = squeeze.",
      pathQuota: "A+ into the prints. No multi-day swing Wed night into Oct 2 NFP.",
      book: "MNQ primary. SMT: NQ still the leader if hike is re-priced.",
      strategy:
        "Tue JOLTS Aug 10:00 — first look at August openings after NFP. Wed ADP 8:15 + GDP Q2 3rd + PCE Aug 8:30. Same 8:00–8:45 blackout. Mechanical after the second impulse only.",
      skipIf: "No MSS + IFVG by 10:15 Wed. Do not carry a runner into Oct 2.",
      blackouts: "Tue 10:00 JOLTS · Wed 8:15–8:45 ADP/GDP/PCE",
    },
  ],
  outcomes: [
    {
      p: 40,
      name: "Two-way into FOMC",
      detail: "Labor + CPI split. NQ stays inside 28,947–29,811 into Sep 16. Best PATH days: post-ISM, post-ADP, post-CPI second impulse, post-Fed Thu.",
    },
    {
      p: 35,
      name: "Hawkish stack",
      detail: "Hot labor and/or hot CPI. Hike odds up. NQ draws 29,367 → 28,947. ES holds = SMT short month. Highest-quality mechanical shorts: NFP week and post-Fed Thu/Fri.",
    },
    {
      p: 25,
      name: "Squeeze",
      detail: "Soft labor + soft CPI, fade Warsh. Raid Friday/holiday lows then squeeze 29,811 / 7,838. Long only SSL in discount + MSS. Do not buy strength into FOMC.",
    },
  ],
};

const PLANS: MonthPlan[] = [MONTH_SEP_2026];

export function resolveMonthAhead(now = new Date()): MonthAheadRead | null {
  const dateKey = etDateKey(now);
  for (const plan of PLANS) {
    const prepDay = addDays(plan.monthStart, -1);
    if (dateKey < prepDay || dateKey > plan.monthEnd) continue;
    const phase =
      plan.phases.find((p) => dateKey >= p.start && dateKey <= p.end) ?? null;
    const nextPhase =
      plan.phases.find((p) => p.start > dateKey) ?? null;
    const window: MonthAheadRead["window"] =
      dateKey < plan.monthStart ? "prep" : dateKey > plan.monthEnd ? "done" : "live";
    return {
      plan,
      dateKey,
      phase,
      nextPhase,
      window,
      live: false,
      refreshedAt: now.toISOString(),
    };
  }
  return null;
}

export function monthPhaseFor(dateKey: string): MonthPhase | null {
  for (const plan of PLANS) {
    const hit = plan.phases.find((p) => dateKey >= p.start && dateKey <= p.end);
    if (hit) return hit;
  }
  return null;
}

export function monthAheadFocusLine(read: MonthAheadRead | null): string | null {
  if (!read) return null;
  const p = read.phase ?? read.nextPhase;
  if (!p) return null;
  const tag = read.phase ? "SEP" : "SEP NEXT";
  return `${tag} · ${p.label} · ${p.dailyBias}`;
}

function barDateKey(t: number): { key: string; hour: number } {
  const p = etWallParts(t);
  return {
    key: `${p.year}-${pad2(p.month)}-${pad2(p.day)}`,
    hour: p.hour,
  };
}

function barInMonth(
  t: number,
  monthStart: string,
  monthEnd: string,
  today: string,
): boolean {
  const { key, hour } = barDateKey(t);
  if (key > today || key > monthEnd) return false;
  if (key >= monthStart) return true;
  const prep = addDays(monthStart, -1);
  return key === prep && hour >= 18;
}

export function monthRangeFromBars(
  bars: OhlcBar[],
  monthStart: string,
  monthEnd: string,
  now = new Date(),
): { high: number; low: number; n: number } | null {
  const today = etDateKey(now);
  let high = -Infinity;
  let low = Infinity;
  let n = 0;
  for (const b of bars) {
    if (!barInMonth(b.t, monthStart, monthEnd, today)) continue;
    if (b.h > high) high = b.h;
    if (b.l < low) low = b.l;
    n += 1;
  }
  if (n < 3 || !Number.isFinite(high) || !Number.isFinite(low)) return null;
  return { high, low, n };
}

function overlayBook(
  seed: MonthBookLevels,
  range: { high: number; low: number; n: number } | null,
): MonthBookLevels {
  if (!range) return seed;
  const cmh = +range.high.toFixed(2);
  const cml = +range.low.toFixed(2);
  const liveEq = +((cmh + cml) / 2).toFixed(2);
  const tookPwh = cmh >= seed.pwh - 0.25;
  const tookPwl = cml <= seed.pwl + 0.25;
  return {
    ...seed,
    cmh,
    cml,
    live: true,
    eq: liveEq,
    drawUp: tookPwh
      ? `CMH ${cmh.toFixed(2)} took PWH ${seed.pwh.toFixed(2)} — next ${seed.drawUp}`
      : `CMH ${cmh.toFixed(2)} then PWH ${seed.pwh.toFixed(2)} · ${seed.drawUp}`,
    drawDown: tookPwl
      ? `CML ${cml.toFixed(2)} took PWL ${seed.pwl.toFixed(2)} — next ${seed.drawDown}`
      : `CML ${cml.toFixed(2)} then PWL ${seed.pwl.toFixed(2)} · ${seed.drawDown}`,
    note: `${seed.note} LIVE CMH ${cmh.toFixed(2)} / CML ${cml.toFixed(2)} from this month’s tape (no lookahead).`,
  };
}

function isNq(symbol: string): boolean {
  return /NQ/i.test(symbol);
}
function isEs(symbol: string): boolean {
  return /ES/i.test(symbol);
}

/** Stamp live monthly range onto the Sunday seed. Prior PWH/PWL stay. */
export function overlayMonthAhead(
  read: MonthAheadRead | null,
  books: { symbol: string; bars: OhlcBar[] }[],
  now = new Date(),
): MonthAheadRead | null {
  if (!read) return null;
  const { plan } = read;
  let nq = plan.nq;
  let es = plan.es;
  for (const b of books) {
    const range = monthRangeFromBars(b.bars, plan.monthStart, plan.monthEnd, now);
    if (isNq(b.symbol)) nq = overlayBook(nq, range);
    if (isEs(b.symbol)) es = overlayBook(es, range);
  }
  return {
    ...read,
    plan: { ...plan, nq, es },
    live: Boolean(nq.live || es.live),
    refreshedAt: now.toISOString(),
  };
}
