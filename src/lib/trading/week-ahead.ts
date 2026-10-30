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
export const WEEK_SEP28_OCT2: WeekPlan = {
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
