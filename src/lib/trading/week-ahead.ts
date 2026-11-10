/**
 * Week-ahead plan the desk, session brief, brain, and HUD all read.
 * Sunday seed is static. Live CWH/CWL overlay from bars (no lookahead).
 * Official prints land in src/data/week-prints.json when Grok restamps them.
 */

import rawPrints from "@/data/week-prints.json";
import type { OhlcBar } from "@/lib/market/types";
import { etWallParts } from "./sessions";

export type WeekDayKind =
  | "range_build"
  | "two_way"
  | "a_plus_only"
  | "selective"
  | "nfp"
  | "holiday"
  | "event";

export interface WeekBookLevels {
  settle: number;
  rangeLo: number;
  rangeHi: number;
  pwh: number;
  pwl: number;
  eq: number;
  drawUp: string;
  drawDown: string;
  note: string;
  cwh?: number | null;
  cwl?: number | null;
  live?: boolean;
}

export interface WeekDayPlan {
  date: string;
  weekday: string;
  dailyBias: string;
  kind: WeekDayKind;
  news: {
    timeEt: string;
    name: string;
    impact: "high" | "medium";
    note: string;
    actual?: string;
    vs?: string;
  }[];
  likelyTape: string;
  trade: string;
  skipIf: string;
  pathNote: string;
  printed?: boolean;
}

export interface WeekPlan {
  id: string;
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  headline: string;
  htfBias: string;
  po3: string;
  macro: string;
  asymmetry: string;
  nq: WeekBookLevels;
  es: WeekBookLevels;
  filters: string[];
  ops: string[];
  outcomes: { p: number; name: string; detail: string }[];
  days: WeekDayPlan[];
}

export interface WeekAheadRead {
  plan: WeekPlan;
  dateKey: string;
  today: WeekDayPlan | null;
  next: WeekDayPlan | null;
  phase: "prep" | "live" | "done";
  focus: WeekDayPlan | null;
  live: boolean;
  refreshedAt: string;
}

export interface WeekPrint {
  date: string;
  name: string;
  actual?: string;
  vs?: string;
  note?: string;
}

const PRINTS: WeekPrint[] = (Array.isArray(rawPrints) ? rawPrints : []) as WeekPrint[];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function etDateKey(now = new Date()): string {
  const p = etWallParts(now.getTime());
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Week of Oct 26 – Oct 30 2026. Durable → FOMC → GDP/PCE/claims → ECI. */
export const WEEK_OCT26_OCT30: WeekPlan = {
  id: "2026-09-28",
  weekLabel: "Oct 26 – Oct 30, 2026",
  weekStart: "2026-10-26",
  weekEnd: "2026-10-30",
  headline:
    "FOMC/GDP week. Durable Tue, FOMC Wed, GDP+PCE+claims Thu, ECI Fri 8:30. No multi-day swing into Friday.",
  htfBias:
    "Prior week already ran NQ to 31,095 / ES to 7,848.50. This week opens inside that box. Core PCE already printed soft. Hot NFP = October hike repricing, NQ-lead weakness. Soft NFP = squeeze. Do not invent CWH/CWL.",
  po3: "Mon range-build. Tue JOLTS manipulates. Wed PCE distributes. Thu ISM/claims. Fri NFP is the week’s event.",
  macro:
    "Tue Durable Goods Sep +1.8% (exp ~1.4%). Wed FOMC hold 3.75-4.00% (10-2, Cook/Hammack for 25bp hike). Thu GDP Q3 +3.4% (exp ~3.1-3.2%), claims 194k (exp ~198k), PCE Sep +0.5% m/m / +3.6% y/y, core +0.3%/3.1%. Fri ECI Q3 pending 8:30 (cons 0.8% q/q). Week tape so far: NQ ~29,024–30,178, ES ~7,652–7,820. Dec hike odds ~71-86% post-prints (Benzinga 71.4%, earlier 85+).",
  asymmetry:
    "A+ into the prints. Flatten before NFP unless already BE. blake_mech longs stay paper.",
  nq: {
    settle: 30889,
    rangeLo: 29904,
    rangeHi: 31095,
    pwh: 31095,
    pwl: 29904,
    eq: 30500,
    drawUp: "Prior-week 31,095 then next BSL — only if tape is already there",
    drawDown: "Prior-week 29,904 then next SSL",
    note: "PWH/PWL = Oct 19–23 week (NQ ~30,113 / ~28,987). Live CWH/CWL from bars. Do not hardcode a take into the seed.",
  },
  es: {
    settle: 7804,
    rangeLo: 7707,
    rangeHi: 7849,
    pwh: 7848.5,
    pwl: 7707.25,
    eq: 7778,
    drawUp: "Prior-week 7,848.50",
    drawDown: "Prior-week 7,707.25",
    note: "PWH/PWL = Oct 19–23 ES week (~7,812 / ~7,648). Live CWH/CWL from bars. No fake live prints.",
  },
  filters: [
    "±15 min: Durable Tue 8:30 · FOMC Wed 14:00 · GDP/PCE/claims Thu 8:30 · ECI Fri 8:30",
    "No entry 8:00–8:45 Wed or Fri",
    "No multi-day swing into Fri NFP",
    "Judas on. One book. PATH floor 0.65.",
  ],
  ops: [
    "Tue stand 9:45–10:15",
    "Wed second impulse only after 9:45",
    "Thu ISM 9:45–10:15 stand",
    "Fri ECI blackout 8:15–9:00; A+ only after 10:00",
  ],
  outcomes: [
    { p: 40, name: "Hot PCE and/or hot NFP", detail: "October hike repricing. NQ-lead lower. Short after BSL raid + MSS. Do not fade strength into Friday." },
    { p: 35, name: "In-line slate", detail: "Two-way inside last week’s box. Stand unless A+. Oct hike odds already cooled after PCE; NFP is the swing, not a fresh tick." },
    { p: 25, name: "Soft PCE / soft NFP", detail: "Squeeze. Long only SSL in discount + MSS. Still flatten into the next print." },
  ],
  days: [
    {
      date: "2026-10-26",
      weekday: "Mon",
      dailyBias: "Neutral / range-build",
      kind: "range_build",
      news: [],
      likelyTape: "Opened inside prior-week box. No high-impact. Range-build expected.",
      trade: "Mechanical only on prior-week H/L raid + MSS.",
      skipIf: "No raid of PWH/PWL.",
      pathNote: "Sunday inside-week holds into Mon close.",
    },
    {
      date: "2026-10-27",
      weekday: "Tue",
      dailyBias: "Neutral / two-way",
      kind: "two_way",
      news: [{ timeEt: "08:30", name: "Durable Goods Orders (Sep P)", impact: "medium", note: "Printed +1.8%" }],
      likelyTape: "Durable +1.8% (exp ~1.4%). Still inside prior-week.",
      trade: "Stand unless A+ after 9:45.",
      skipIf: "No clear MSS after the print.",
      pathNote: "Inside-week story intact.",
    },
    {
      date: "2026-10-28",
      weekday: "Wed",
      dailyBias: "Event / selective",
      kind: "event",
      news: [
        { timeEt: "14:00", name: "FOMC Rate Decision", impact: "high", note: "Hold 3.75-4.00% 10-2" },
        { timeEt: "14:30", name: "FOMC Press Conference", impact: "high", note: "" }
      ],
      likelyTape: "FOMC hold as expected. Tape stayed inside box post-decision.",
      trade: "Second impulse only after 9:45. Flatten into the print.",
      skipIf: "No entry 8:00-8:45.",
      pathNote: "Inside-week holds. Dec hike odds elevated.",
    },
    {
      date: "2026-10-29",
      weekday: "Thu",
      dailyBias: "Two-way / selective",
      kind: "two_way",
      news: [
        { timeEt: "08:30", name: "GDP Q3 (advance)", impact: "high", note: "+3.4%" },
        { timeEt: "08:30", name: "Initial Jobless Claims", impact: "medium", note: "194k" },
        { timeEt: "08:30", name: "PCE / Personal Income (Sep)", impact: "high", note: "core +0.3%/3.1%" }
      ],
      likelyTape: "Hot GDP +3.4%, claims 194k, PCE hot headline. Still no PWH/PWL take.",
      trade: "A+ only after the 8:30 cluster. Stand 9:45-10:15.",
      skipIf: "No multi-day into Fri.",
      pathNote: "Inside-week story holds into Thu close.",
    },
    {
      date: "2026-10-30",
      weekday: "Fri",
      dailyBias: "Bearish / breakdown",
      kind: "a_plus_only",
      news: [{ timeEt: "08:30", name: "Employment Cost Index (Q3)", impact: "high", note: "+0.8% in-line", actual: "+0.8% q/q", vs: "exp 0.8% / prev 0.9%" }],
      likelyTape: "ECI +0.8% in-line (not hot). Cash broke PWL hard: NQ session ~28,272–29,180 vs PWL 29,904 / PWH 31,095; ES similarly under 7,707. Inside-week invalidated on downside. Month-end tech sell.",
      trade: "A+ only after 10:00. Short only on BSL raid + MSS if offered; do not chase the flush.",
      skipIf: "No entry 8:15–9:00. No multi-day swing. No fade of the breakdown without structure.",
      pathNote: "Sunday inside-week story broken by the PWL take. Live CWH/CWL from bars. Flatten into weekend.",
      printed: true,
    },
  ],
};

/** Week of Nov 2 – Nov 6 2026. ISM Mfg → JOLTS → ADP/ISM Svc → claims → NFP. */
export const WEEK_NOV2_NOV6: WeekPlan = {
  id: "2026-11-02",
  weekLabel: "Nov 2 – Nov 6, 2026",
  weekStart: "2026-11-02",
  weekEnd: "2026-11-06",
  headline:
    "NFP week. ISM Mfg Mon 10:00, JOLTS Tue 10:00, ADP+ISM Svc Wed, claims Thu, NFP Fri 8:30. No multi-day swing into Friday.",
  htfBias:
    "Prior week (Oct 26–30) seed PWH/PWL NQ 31,095 / 29,904; cash broke PWL hard Fri (session ~28,272–29,180). Opens after downside invalidation of inside-week. Dec hike odds ~68-73% post-ECI. Hot NFP = further hike repricing. Soft = squeeze. Do not invent CWH/CWL.",
  po3: "Mon ISM range-build. Tue JOLTS manipulates. Wed ADP/ISM distributes. Thu claims. Fri NFP is the week’s event.",
  macro:
    "Mon ISM Manufacturing PMI (Oct) 10:00 printed 55.5 (exp ~54.5-54.7 / prev 54.5). Tue JOLTS Job Openings (Sep) 10:00 printed 7.523M (exp ~7.16M / prev 7.079M rev 7.190M). Wed ADP Employment (Oct) 08:15 printed 86K (exp ~67-69K) + ISM Services PMI (Oct) 10:00 printed 54.5 (exp 54.8 / prev 54.9). Thu Initial Jobless Claims 08:30 printed 189k (exp ~196-197k / prev 195k rev). Fri NFP +165k (exp ~59-65k), UR 4.1%, AHE +0.4%/3.1%; UMich 51.0 (exp ~48). Dec hike odds ~78-80% post-NFP. Live CWH/CWL from bars.",
  asymmetry:
    "A+ into the prints. Flatten before NFP unless already BE. blake_mech longs stay paper.",
  nq: {
    settle: 29180,
    rangeLo: 28272,
    rangeHi: 31095,
    pwh: 31095,
    pwl: 29904,
    eq: 30500,
    drawUp: "Prior-week 31,095 then next BSL — only if tape is already there",
    drawDown: "Prior-week low area ~28,272 then next SSL",
    note: "PWH/PWL = Oct 26–30 seed (NQ 31,095 / 29,904). Cash took the low Fri. Live CWH/CWL from bars. Do not hardcode a take into the seed.",
  },
  es: {
    settle: 7700,
    rangeLo: 7650,
    rangeHi: 7849,
    pwh: 7848.5,
    pwl: 7707.25,
    eq: 7778,
    drawUp: "Prior-week 7,848.50",
    drawDown: "Prior-week low area under 7,707",
    note: "PWH/PWL = Oct 26–30 seed. Live CWH/CWL from bars. No fake live prints.",
  },
  filters: [
    "±15 min: ISM Mfg Mon 10:00 · JOLTS Tue 10:00 · ADP Wed 08:15 · ISM Svc Wed 10:00 · claims Thu 08:30 · NFP Fri 08:30",
    "No entry 8:00–8:45 Fri",
    "No multi-day swing into Fri NFP",
    "Judas on. One book. PATH floor 0.65.",
  ],
  ops: [
    "Mon stand 9:45–10:15",
    "Tue stand 9:45–10:15",
    "Wed ADP blackout 8:00–8:45; ISM 9:45–10:15 stand",
    "Fri NFP blackout 8:15–9:00; A+ only after 10:00",
  ],
  outcomes: [
    { p: 40, name: "Hot NFP and/or hot ISM", detail: "December hike repricing. NQ-lead lower. Short after BSL raid + MSS. Do not fade strength into Friday." },
    { p: 35, name: "In-line slate", detail: "Two-way after prior-week breakdown. Stand unless A+. Dec hike odds already cooled after ECI; NFP is the swing." },
    { p: 25, name: "Soft NFP / soft ISM", detail: "Squeeze. Long only SSL in discount + MSS. Still flatten into the next print." },
  ],
  days: [
    {
      date: "2026-11-02",
      weekday: "Mon",
      dailyBias: "Neutral / range-build",
      kind: "range_build",
      news: [{ timeEt: "10:00", name: "ISM Manufacturing PMI (Oct)", impact: "high", note: "Printed 55.5", actual: "55.5", vs: "exp ~54.5-54.7 / prev 54.5" }],
      likelyTape: "Opens after prior-week PWL break. ISM 55.5 beat. Session stayed under PWL (NQ ~28.1k-28.9k, ES ~7.58k-7.69k).",
      trade: "Stand 9:45–10:15. Mechanical only on prior-week H/L raid + MSS after.",
      skipIf: "No raid of prior-week extremes. No clear MSS after the print.",
      pathNote: "Prior-week downside break is the context. Live CWH/CWL from bars. Sunday post-PWL story holds.",
      printed: true,
    },
    {
      date: "2026-11-03",
      weekday: "Tue",
      dailyBias: "Neutral / two-way",
      kind: "two_way",
      news: [{ timeEt: "10:00", name: "JOLTS Job Openings (Sep)", impact: "high", note: "Printed 7.523M", actual: "7.523M", vs: "exp ~7.16M / prev 7.079M (rev 7.190M)" }],
      likelyTape: "JOLTS 7.523M beat. Session stayed well under PWL (NQ ~28.0k-28.4k). Post-breakdown two-way holds.",
      trade: "Stand 9:45–10:15 unless A+ after 10:15.",
      skipIf: "No clear MSS after the print.",
      pathNote: "Prior-week downside break context intact. Live CWH/CWL from bars. No HTF trend invented.",
      printed: true,
    },
    {
      date: "2026-11-04",
      weekday: "Wed",
      dailyBias: "Event / selective",
      kind: "event",
      news: [
        { timeEt: "08:15", name: "ADP Employment (Oct)", impact: "high", note: "Printed 86K", actual: "86K", vs: "exp ~67-69K / prev 86K rev" },
        { timeEt: "10:00", name: "ISM Services PMI (Oct)", impact: "high", note: "Printed 54.5", actual: "54.5", vs: "exp 54.8 / prev 54.9" }
      ],
      likelyTape: "ADP 86K beat + ISM Svc 54.5 slight miss. Session stayed well under PWL (NQ ~27.6k-29.0k). Post-breakdown selective holds; no PWH/PWL take.",
      trade: "ADP blackout 8:00–8:45. ISM stand 9:45–10:15. A+ only after second impulse.",
      skipIf: "No entry 8:00-8:45. No clear MSS after either print. No multi-day into Fri.",
      pathNote: "Prior-week downside break context intact. Live CWH/CWL from bars. No HTF trend invented.",
      printed: true,
    },
    {
      date: "2026-11-05",
      weekday: "Thu",
      dailyBias: "Two-way / selective",
      kind: "two_way",
      news: [{ timeEt: "08:30", name: "Initial Jobless Claims", impact: "medium", note: "Printed 189k", actual: "189k", vs: "exp ~196-197k / prev 195k rev" }],
      likelyTape: "Claims 189k soft (exp ~196k). Session stayed well under PWL (NQ ~26.7k-28.7k). Post-breakdown selective holds; no PWH/PWL take.",
      trade: "A+ only after 8:30. Stand unless clear structure.",
      skipIf: "No multi-day into Fri.",
      pathNote: "Prior-week downside break context intact. Live CWH/CWL from bars. No HTF trend invented. Do not swing into NFP.",
      printed: true,
    },
    {
      date: "2026-11-06",
      weekday: "Fri",
      dailyBias: "Event / A+ only",
      kind: "nfp",
      news: [
        { timeEt: "08:30", name: "NFP / Employment Situation (Oct)", impact: "high", note: "Printed +165k", actual: "+165k / UR 4.1%", vs: "exp ~59-65k / UR 4.2%" },
        { timeEt: "10:00", name: "UMich Sentiment (Nov P)", impact: "medium", note: "Printed 51.0", actual: "51.0", vs: "exp ~48 / prev 48" }
      ],
      likelyTape: "Hot NFP +165k (exp ~65k), UR 4.1%. Session stayed well under PWL (NQ ~26.4k-27.4k, ES ~7.35k-7.47k). Post-breakdown selective holds; no PWH/PWL take. Hike odds up.",
      trade: "A+ only after 10:00. Short only on BSL raid + MSS if offered; do not chase.",
      skipIf: "No entry 8:15–9:00. No multi-day swing. No fade of the first impulse without structure.",
      pathNote: "Prior-week downside break context intact. Live CWH/CWL from bars. No HTF trend invented. Flatten into weekend.",
      printed: true,
    },
  ],
};

/** Week of Nov 9 – Nov 13 2026. CPI Tue → claims Thu → PPI Fri. */
export const WEEK_NOV9_NOV13: WeekPlan = {
  id: "2026-11-09",
  weekLabel: "Nov 9 – Nov 13, 2026",
  weekStart: "2026-11-09",
  weekEnd: "2026-11-13",
  headline:
    "CPI week. CPI Oct Tue 8:30, claims Thu 8:30, PPI Oct Fri 8:30. No multi-day swing into Friday. Post-hot-NFP context.",
  htfBias:
    "Prior week (Nov 2–6) tape stayed well under Oct 26–30 PWL after hot NFP +165k. Opens inside the post-breakdown range. Dec hike odds ~84% (CME FedWatch as of Nov 10 pre-CPI, up from ~68% Nov 8). Hot CPI = further hike repricing. Soft = squeeze. Do not invent CWH/CWL.",
  po3: "Mon range-build. Tue CPI manipulates. Wed two-way. Thu claims. Fri PPI is the week’s secondary event.",
  macro:
    "Mon no high-impact. Tue CPI (Oct) 08:30 (BLS will not publish YoY due to prior shutdown). Thu Initial Jobless Claims 08:30. Fri PPI (Oct) 08:30. No NFP. Dec hike odds ~84% (CME FedWatch Nov 10 pre-CPI). Live CWH/CWL from bars. This-week range so far NQ ~26.75k–28.13k under PWL.",
  asymmetry:
    "A+ into the prints. Flatten before CPI unless already BE. blake_mech longs stay paper.",
  nq: {
    settle: 27400,
    rangeLo: 26400,
    rangeHi: 31095,
    pwh: 31095,
    pwl: 29904,
    eq: 30500,
    drawUp: "Prior seed 31,095 then next BSL — only if tape is already there",
    drawDown: "Prior-week low area ~26,400 then next SSL",
    note: "PWH/PWL = Oct 26–30 seed (already broken). Prior week (Nov 2–6) stayed under. Live CWH/CWL from bars. Do not hardcode a take into the seed.",
  },
  es: {
    settle: 7400,
    rangeLo: 7350,
    rangeHi: 7849,
    pwh: 7848.5,
    pwl: 7707.25,
    eq: 7778,
    drawUp: "Prior seed 7,848.50",
    drawDown: "Prior-week low area ~7,350 then next SSL",
    note: "PWH/PWL = Oct 26–30 seed. Live CWH/CWL from bars. No fake live prints.",
  },
  filters: [
    "±15 min: CPI Tue 08:30 · claims Thu 08:30 · PPI Fri 08:30",
    "No entry 8:00–8:45 Tue or Fri",
    "No multi-day swing into Fri PPI",
    "Judas on. One book. PATH floor 0.65.",
  ],
  ops: [
    "Mon stand unless clean raid",
    "Tue CPI blackout 8:00–8:45; A+ only after 10:00",
    "Thu claims stand after 8:30",
    "Fri PPI blackout 8:15–9:00; A+ only after 10:00",
  ],
  outcomes: [
    { p: 40, name: "Hot CPI and/or hot PPI", detail: "December hike repricing. NQ-lead lower. Short after BSL raid + MSS. Do not fade strength into Friday." },
    { p: 35, name: "In-line slate", detail: "Two-way after prior-week breakdown. Stand unless A+. Dec hike odds ~84% pre-CPI; CPI is the swing." },
    { p: 25, name: "Soft CPI / soft PPI", detail: "Squeeze. Long only SSL in discount + MSS. Still flatten into the next print." },
  ],
  days: [
    {
      date: "2026-11-09",
      weekday: "Mon",
      dailyBias: "Neutral / range-build",
      kind: "range_build",
      news: [],
      likelyTape: "Opens after prior-week post-NFP under PWL. No high-impact. Range-build expected.",
      trade: "Mechanical only on prior-week H/L raid + MSS.",
      skipIf: "No raid of prior extremes.",
      pathNote: "Post-breakdown context. Live CWH/CWL from bars.",
    },
    {
      date: "2026-11-10",
      weekday: "Tue",
      dailyBias: "Event / selective",
      kind: "event",
      news: [{ timeEt: "08:30", name: "CPI (Oct)", impact: "high", note: "No YoY (BLS, prior shutdown)" }],
      likelyTape: "CPI Oct 8:30. Post-hot-NFP context. Expect two-way around the print. No YoY figures.",
      trade: "Blackout 8:00–8:45. A+ only after 10:00 on second impulse.",
      skipIf: "No entry 8:00-8:45. No clear MSS after the print.",
      pathNote: "CPI is the week’s primary event. Live CWH/CWL from bars.",
    },
    {
      date: "2026-11-11",
      weekday: "Wed",
      dailyBias: "Two-way / selective",
      kind: "two_way",
      news: [],
      likelyTape: "Post-CPI two-way. Veterans Day; cash open, bonds closed. Selective holds.",
      trade: "Stand unless A+ after 9:45.",
      skipIf: "No clear structure.",
      pathNote: "Digest day. Live CWH/CWL from bars. No HTF trend invented.",
    },
    {
      date: "2026-11-12",
      weekday: "Thu",
      dailyBias: "Two-way / selective",
      kind: "two_way",
      news: [{ timeEt: "08:30", name: "Initial Jobless Claims", impact: "medium", note: "" }],
      likelyTape: "Claims 8:30. Post-CPI selective. Stand unless clear MSS.",
      trade: "A+ only after 8:30. Stand unless clear structure.",
      skipIf: "No multi-day into Fri.",
      pathNote: "Post-breakdown context intact. Live CWH/CWL from bars.",
    },
    {
      date: "2026-11-13",
      weekday: "Fri",
      dailyBias: "Event / A+ only",
      kind: "event",
      news: [{ timeEt: "08:30", name: "PPI (Oct)", impact: "high", note: "" }],
      likelyTape: "PPI Oct 8:30. Secondary event after CPI. Post-breakdown selective holds.",
      trade: "A+ only after 10:00. Short only on BSL raid + MSS if offered; do not chase.",
      skipIf: "No entry 8:15–9:00. No multi-day swing. No fade of the first impulse without structure.",
      pathNote: "Live CWH/CWL from bars. No HTF trend invented. Flatten into weekend.",
    },
  ],
};

const WEEK_PLANS: WeekPlan[] = [WEEK_NOV9_NOV13, WEEK_NOV2_NOV6, WEEK_OCT26_OCT30];

function addDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utc = Date.UTC(y!, m! - 1, d! + n);
  const dt = new Date(utc);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function resolveWeekAhead(now = new Date()): WeekAheadRead | null {
  const dateKey = etDateKey(now);
  for (const plan of WEEK_PLANS) {
    const prepDay = addDays(plan.weekStart, -1);
    if (dateKey < prepDay || dateKey > plan.weekEnd) continue;
    const today = plan.days.find((d) => d.date === dateKey) ?? null;
    const next = plan.days.find((d) => d.date > dateKey) ?? null;
    const phase: WeekAheadRead["phase"] =
      dateKey < plan.weekStart ? "prep" : dateKey > plan.weekEnd ? "done" : "live";
    const focus = today ?? next;
    return {
      plan,
      dateKey,
      today,
      next,
      phase,
      focus,
      live: false,
      refreshedAt: now.toISOString(),
    };
  }
  return null;
}

const PLANS = WEEK_PLANS;

export function weekDayFor(dateKey: string): WeekDayPlan | null {
  for (const plan of PLANS) {
    const hit = plan.days.find((d) => d.date === dateKey);
    if (hit) return hit;
  }
  return null;
}

export function weekAheadFocusLine(read: WeekAheadRead | null): string | null {
  if (!read || !read.focus) return null;
  const tag = read.today ? "TODAY" : "NEXT";
  return `${tag} · ${read.focus.weekday} · ${read.focus.dailyBias}`;
}

function barDateKey(t: number): { key: string; hour: number } {
  const p = etWallParts(t);
  return {
    key: `${p.year}-${pad2(p.month)}-${pad2(p.day)}`,
    hour: p.hour,
  };
}

function barInWeek(
  t: number,
  weekStart: string,
  weekEnd: string,
  today: string,
): boolean {
  const { key, hour } = barDateKey(t);
  if (key > today || key > weekEnd) return false;
  if (key >= weekStart) return true;
  const prep = addDays(weekStart, -1);
  return key === prep && hour >= 18;
}

export function weekRangeFromBars(
  bars: OhlcBar[],
  weekStart: string,
  weekEnd: string,
  now = new Date(),
): { high: number; low: number; n: number } | null {
  const today = etDateKey(now);
  let high = -Infinity;
  let low = Infinity;
  let n = 0;
  for (const b of bars) {
    if (!barInWeek(b.t, weekStart, weekEnd, today)) continue;
    if (b.h > high) high = b.h;
    if (b.l < low) low = b.l;
    n += 1;
  }
  if (n < 3 || !Number.isFinite(high) || !Number.isFinite(low)) return null;
  return { high, low, n };
}

function overlayBook(
  seed: WeekBookLevels,
  range: { high: number; low: number; n: number } | null,
): WeekBookLevels {
  if (!range) return seed;
  const cwh = +range.high.toFixed(2);
  const cwl = +range.low.toFixed(2);
  const liveEq = +((cwh + cwl) / 2).toFixed(2);
  const tookPwh = cwh >= seed.pwh - 0.25;
  const tookPwl = cwl <= seed.pwl + 0.25;
  return {
    ...seed,
    cwh,
    cwl,
    live: true,
    eq: liveEq,
    drawUp: tookPwh
      ? `CWH ${cwh.toFixed(2)} took PWH ${seed.pwh.toFixed(2)} — next ${seed.drawUp}`
      : `CWH ${cwh.toFixed(2)} then PWH ${seed.pwh.toFixed(2)} · ${seed.drawUp}`,
    drawDown: tookPwl
      ? `CWL ${cwl.toFixed(2)} took PWL ${seed.pwl.toFixed(2)} — next ${seed.drawDown}`
      : `CWL ${cwl.toFixed(2)} then PWL ${seed.pwl.toFixed(2)} · ${seed.drawDown}`,
    note: `${seed.note} LIVE CWH ${cwh.toFixed(2)} / CWL ${cwl.toFixed(2)} from this week’s tape (no lookahead).`,
  };
}

function isNq(symbol: string): boolean {
  return /NQ/i.test(symbol);
}
function isEs(symbol: string): boolean {
  return /ES/i.test(symbol);
}

/** Stamp live weekly range onto the Sunday seed. Prior PWH/PWL stay. */
export function overlayWeekAhead(
  read: WeekAheadRead | null,
  books: { symbol: string; bars: OhlcBar[] }[],
  now = new Date(),
): WeekAheadRead | null {
  if (!read) return null;
  const { plan } = read;
  let nq = plan.nq;
  let es = plan.es;
  for (const b of books) {
    const range = weekRangeFromBars(b.bars, plan.weekStart, plan.weekEnd, now);
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
