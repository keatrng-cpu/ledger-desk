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

/** Week of Sep 28 – Oct 2 2026. JOLTS → PCE → ISM/claims → NFP. */
export const WEEK_SEP28_OCT2: WeekPlan = {
  id: "2026-09-28",
  weekLabel: "Sep 28 – Oct 2, 2026",
  weekStart: "2026-09-28",
  weekEnd: "2026-10-02",
  headline:
    "Labor/inflation week. JOLTS Tue, ADP+PCE Wed, ISM+claims Thu, September NFP Fri 8:30. No multi-day swing into Friday.",
  htfBias:
    "Prior week already ran NQ to 31,095 / ES to 7,848.50. This week opens inside that box. Hot core PCE or hot NFP = October hike repricing, NQ-lead weakness. Soft prints = squeeze. Do not invent CWH/CWL.",
  po3: "Mon range-build. Tue JOLTS manipulates. Wed PCE distributes. Thu ISM/claims. Fri NFP is the week’s event.",
  macro:
    "Tue JOLTS Aug 10:00. Wed ADP Sep 8:15 + GDP Q2 3rd + PCE Aug 8:30. Thu claims 8:30 + ISM Mfg Sep 10:00. Fri NFP Sep 8:30. Consensus cluster: JOLTS ~7.2M, ADP ~+70k, ISM ~55, NFP ~+90–100k / U 4.1%. Oct 28 hike odds still the live bet (~2/3 to ~3/4 on last FedWatch prints; do not invent a tick).",
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
    note: "PWH/PWL = Sep 21–25 week (NQ high 31,094.75 / low 29,904). Live CWH/CWL from bars. Sunday/Mon globex was inside the box, not a new weekly extreme to hardcode.",
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
    note: "PWH/PWL = Sep 21–25 ES week. SMT companion. No fake live prints.",
  },
  filters: [
    "±15 min: JOLTS Tue 10:00 · ADP/GDP/PCE Wed 8:15–8:45 · claims Thu 8:30 · ISM Thu 10:00 · NFP Fri 8:30",
    "No entry 8:00–8:45 Wed or Fri",
    "No multi-day swing into Fri NFP",
    "Judas on. One book. PATH floor 0.65.",
  ],
  ops: [
    "Tue stand 9:45–10:15",
    "Wed second impulse only after 9:45",
    "Thu ISM 9:45–10:15 stand",
    "Fri NFP blackout 8:15–9:00; A+ only after 10:00",
  ],
  outcomes: [
    { p: 40, name: "Hot PCE and/or hot NFP", detail: "October hike repricing. NQ-lead lower. Short after BSL raid + MSS. Do not fade strength into Friday." },
    { p: 35, name: "In-line slate", detail: "Two-way inside last week’s box. Stand unless A+. Odds stay bid for Oct +25." },
    { p: 25, name: "Soft PCE / soft NFP", detail: "Squeeze. Long only SSL in discount + MSS. Still flatten into the next print." },
  ],
  days: [
    {
      date: "2026-09-28",
      weekday: "Mon",
      dailyBias: "Neutral / range-build",
      kind: "range_build",
      news: [],
      likelyTape: "Cash sold inside last week: NQ ~30,357–30,921 vs PWH 31,095 / PWL 29,904; ES ~7,726–7,803 vs 7,848.50 / 7,707.25. No PWH/PWL take. Still inside-week.",
      trade: "Mechanical only if they sweep last week H/L with MSS. Mon did not.",
      skipIf: "No raid of prior-week H/L — already the case into cash close.",
      pathNote: "Not a must-take. Sunday inside-week story holds.",
    },
    {
      date: "2026-09-29",
      weekday: "Tue",
      dailyBias: "Two-way, still inside last week",
      kind: "two_way",
      news: [{ timeEt: "10:00", name: "JOLTS Job Openings (Aug)", impact: "high", note: "Official BLS 10:00 ET. First look at August openings after +162k NFP. Consensus ~7.2M vs Jul 7.271M." }],
      likelyTape: "JOLTS 7.079M vs ~7.23M / Jul rev 7.335M. Cash stayed inside the box: NQ ~30,372–30,726 vs PWH 31,095 / PWL 29,904; ES ~7,712–7,771 vs 7,848.50 / 7,707.25. No PWH/PWL take. Still inside-week, not a new HTF trend.",
      trade: "Post-10:15 mechanical only if MSS + IFVG after the print. Tue did not take prior-week H/L.",
      skipIf: "No raid of prior-week H/L — already the case into cash close.",
      pathNote: "Sunday inside-week story holds. Next is Wed ADP+PCE.",
    },
    {
      date: "2026-09-30",
      weekday: "Wed",
      dailyBias: "Two-way, still inside last week",
      kind: "event",
      news: [
        { timeEt: "08:15", name: "ADP Employment (Sep)", impact: "high", note: "ADP Research 8:15 ET. Consensus cluster ~+70k vs Aug +38k. Inside premarket with PCE." },
        { timeEt: "08:30", name: "GDP Q2 (3rd est) / PCE (Aug)", impact: "high", note: "BEA 8:30 ET. Headline PCE seen ~0.4% m/m / 3.7% y/y; core ~0.3% / 3.3%. Hot core PCE = October hike. Soft = squeeze." },
      ],
      likelyTape: "ADP +90k vs ~+70k / Aug rev +36k. PCE +0.3%/3.4% y/y, core +0.2%/3.0%; GDP Q2 3rd +2.2% vs +1.5% 2nd. Cash stayed inside the box: NQ ~30,512–30,906 vs PWH 31,095 / PWL 29,904; ES ~7,720–7,782 vs 7,848.50 / 7,707.25. No PWH/PWL take. Still inside-week, not a new HTF trend.",
      trade: "Post-print mechanical only if MSS + IFVG. Wed did not take prior-week H/L. Flatten — Thu ISM and Fri NFP still live.",
      skipIf: "No raid of prior-week H/L — already the case into cash close.",
      pathNote: "Sunday inside-week story holds. Soft PCE is the squeeze path; tape did not invent HTF trend. Next is Thu claims+ISM.",
    },
    {
      date: "2026-10-01",
      weekday: "Thu",
      dailyBias: "Selective — claims then ISM",
      kind: "selective",
      news: [
        { timeEt: "08:30", name: "Initial Jobless Claims", impact: "medium", note: "DOL 8:30 ET, week ending Sep 26. Prev 197k. Rarely trends the day." },
        { timeEt: "10:00", name: "ISM Manufacturing PMI (Sep)", impact: "high", note: "ISM first business day. Consensus ~55.0 vs Aug 54.6. Stand 9:45–10:15." },
      ],
      likelyTape: "Claims caution ±15m. ISM 10:00 can raid Wed H/L.",
      trade: "Post-10:15 mechanical. One book. Do not carry a loser into NFP.",
      skipIf: "Chop, or already booked the week.",
      pathNote: "Process skip is fine.",
    },
    {
      date: "2026-10-02",
      weekday: "Fri",
      dailyBias: "NFP. Stand first.",
      kind: "nfp",
      news: [{ timeEt: "08:30", name: "NFP / Employment Situation (Sep)", impact: "high", note: "BLS official 8:30 ET. Consensus cluster ~+90–100k, U-rate 4.1%, AHE ~+0.3%. Aug was +162k / U 4.1%. Do not stamp an actual until BLS prints." }],
      likelyTape: "8:30 seek-and-destroy. Second impulse after 9:45–10:00.",
      trade: "Blackout 8:15–9:00. Hot (>consensus and/or AHE ≥0.3% with U-rate ≤4.1%): hike odds up, NQ-lead lower after BSL raid + MSS. In-line: skip unless A+ after 10:00. Soft (<50k or U-rate 4.3%+): long only SSL in discount. No lookahead on next week.",
      skipIf: "No MSS + IFVG by 10:15. Already took the week.",
      pathNote: "A+ only after 10:00. Flatten into the weekend unless BE.",
    },
  ],
};

const PLANS: WeekPlan[] = [WEEK_SEP28_OCT2];

function addDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utc = Date.UTC(y!, m! - 1, d! + n);
  const dt = new Date(utc);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function resolveWeekAhead(now = new Date()): WeekAheadRead | null {
  const dateKey = etDateKey(now);
  for (const plan of PLANS) {
    const prepDay = addDays(plan.weekStart, -1);
    if (dateKey < prepDay || dateKey > plan.weekEnd) continue;
    const stamped = stampPrints(plan, dateKey);
    const today = stamped.days.find((d) => d.date === dateKey) ?? null;
    const next = stamped.days.find((d) => d.date > dateKey) ?? null;
    const phase: WeekAheadRead["phase"] =
      dateKey < plan.weekStart ? "prep" : dateKey > plan.weekEnd ? "done" : "live";
    return { plan: stamped, dateKey, today, next, phase, focus: today ?? next, live: false, refreshedAt: now.toISOString() };
  }
  return null;
}

export function weekDayFor(dateKey: string): WeekDayPlan | null {
  for (const plan of PLANS) {
    const hit = plan.days.find((d) => d.date === dateKey);
    if (hit) return hit;
  }
  return null;
}

export function weekAheadFocusLine(read: WeekAheadRead | null): string | null {
  if (!read?.focus) return null;
  const tag = read.today ? "TODAY" : "NEXT";
  return `${tag} ${read.focus.weekday} · ${read.focus.dailyBias}`;
}

function stampPrints(plan: WeekPlan, dateKey: string): WeekPlan {
  const days = plan.days.map((d) => {
    const printed = d.date < dateKey;
    const news = d.news.map((n) => {
      const hit = PRINTS.find(
        (p) =>
          p.date === d.date &&
          (p.name === n.name ||
            n.name.toLowerCase().includes(p.name.toLowerCase()) ||
            p.name.toLowerCase().includes(n.name.toLowerCase().slice(0, 12))),
      );
      if (!hit) return n;
      return {
        ...n,
        actual: hit.actual,
        vs: hit.vs,
        note: hit.note ? `${n.note} · ACTUAL ${hit.actual ?? "—"} vs ${hit.vs ?? "exp"} — ${hit.note}` : n.note,
      };
    });
    return { ...d, news, printed };
  });
  return { ...plan, days };
}

function barDateKey(t: number): { key: string; hour: number } {
  const p = etWallParts(t);
  return { key: `${p.year}-${pad2(p.month)}-${pad2(p.day)}`, hour: p.hour };
}

function barInWeek(t: number, weekStart: string, weekEnd: string, today: string): boolean {
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

function overlayBook(seed: WeekBookLevels, range: { high: number; low: number; n: number } | null): WeekBookLevels {
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
  const nextPlan = { ...plan, nq, es };
  const today = nextPlan.days.find((d) => d.date === read.dateKey) ?? null;
  const next = nextPlan.days.find((d) => d.date > read.dateKey) ?? null;
  return { ...read, plan: nextPlan, today, next, focus: today ?? next, live: Boolean(nq.live || es.live), refreshedAt: now.toISOString() };
}
