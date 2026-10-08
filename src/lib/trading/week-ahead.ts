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
    "Prior week already ran NQ to 31,095 / ES to 7,848.50. This week opens inside that box. Core PCE already printed soft. Hot NFP = October hike repricing, NQ-lead weakness. Soft NFP = squeeze. Do not invent CWH/CWL.",
  po3: "Mon range-build. Tue JOLTS manipulates. Wed PCE distributes. Thu ISM/claims. Fri NFP is the week’s event.",
  macro:
    "Tue JOLTS Aug 10:00 printed 7.079M. Wed ADP Sep +90k + GDP Q2 3rd +2.2% + PCE Aug core +0.2%/3.0%. Thu claims 197k vs 200k; ISM Mfg 54.5 vs 55. Fri NFP Sep +29k vs ~+90k, U 4.2%, AHE +0.1% (BLS 8:30 ET). Week tape: NQ ~30,357–31,282.50 took PWH 31,095 Fri and faded back near it; ES ~7,672.75–7,810, PWL taken Thu, PWH untouched. Oct 28 hike odds cooled further: FedWatch ~17–22% after the print (CNBC 17%, FXStreet 21.6%) vs 24.9% Thu afternoon / 37.6% earlier.",
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
    note: "PWH/PWL = Sep 21–25 week (NQ high 31,094.75 / low 29,904). Live CWH/CWL from bars. Do not hardcode a take into the seed.",
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
    note: "PWH/PWL = Sep 21–25 ES week (7,848.50 / 7,707.25). Live CWH/CWL from bars. No fake live prints.",
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
    { p: 35, name: "In-line slate", detail: "Two-way inside last week’s box. Stand unless A+. Oct hike odds already cooled after PCE; NFP is the swing, not a fresh tick." },
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
      dailyBias: "Selective — prints done, still inside-week",
      kind: "selective",
      news: [
        { timeEt: "08:30", name: "Initial Jobless Claims", impact: "medium", note: "DOL 8:30 ET, week ending Sep 26. Prev 197k. Rarely trends the day." },
        { timeEt: "10:00", name: "ISM Manufacturing PMI (Sep)", impact: "high", note: "ISM first business day. Consensus ~55.0 vs Aug 54.6. Stand 9:45–10:15." },
      ],
      likelyTape: "Claims 197k vs 200k (prev rev 198k). ISM 54.5 vs 55 / prev 54.6; prices 77.9. NQ session 30,529.50–31,151.50 tagged PWH 31,095 and rejected (last ~30,783). ES 7,672.75–7,767.75 took PWL 7,707.25, no PWH take. Failed NQ PWH raid; ES PWL sweep is not a new HTF trend.",
      trade: "Post-print mechanical only if MSS + IFVG. NQ PWH tag failed back inside. ES PWL sweep did not hold. Do not carry a loser into NFP.",
      skipIf: "No hold above PWH — NQ back inside. Chop, or already booked the week.",
      pathNote: "PWH/PWL seed unchanged. NQ failed PWH; ES took PWL. Next is Fri NFP blackout 8:15–9:00.",
    },
    {
      date: "2026-10-02",
      weekday: "Fri",
      dailyBias: "Soft NFP. NQ tagged PWH, no hold. Not a new HTF trend.",
      kind: "nfp",
      news: [{ timeEt: "08:30", name: "NFP / Employment Situation (Sep)", impact: "high", note: "BLS USDL-26-1549. +29k vs ~+90k. U-rate 4.2% (was 4.1%). AHE +0.1% to $37.81 / +3.0% y/y. Participation 61.8%. July/Aug revised -60k combined." }],
      likelyTape: "NFP +29k, U 4.2%, AHE +0.1%. NQ session ~30,760–31,282.50 took PWH 31,095 and faded back near/under it (last ~31,050–31,074). ES ~7,723–7,810 vs PWH 7,848.50 / PWL 7,707.25 — no PWH/PWL take. Soft-print squeeze, not a new HTF trend.",
      trade: "Blackout done. Soft path only: long if SSL in discount + MSS already there. Do not chase the NQ PWH tag that faded. Flatten into the weekend unless BE.",
      skipIf: "No MSS + IFVG. NQ failed to hold PWH. Already took the week.",
      pathNote: "PWH/PWL seed unchanged. Sunday inside-week holds on ES; NQ PWH raid failed to hold. Next session Mon ISM Services 10:00, stand 9:45–10:15.",
    },
  ],
};

/** Week of Oct 5 – Oct 9 2026. ISM Services → trade → Sep minutes → claims → UMich. No NFP. */
export const WEEK_OCT5_OCT9: WeekPlan = {
  id: "2026-10-05",
  weekLabel: "Oct 5 – Oct 9, 2026",
  weekStart: "2026-10-05",
  weekEnd: "2026-10-09",
  headline:
    "Services and minutes week. ISM Services Mon 10:00, trade Tue 8:30, Sep FOMC minutes Wed 14:00, claims Thu 8:30, UMich Fri 10:00. No NFP. CPI is next week.",
  htfBias:
    "Prior week (Sep 28–Oct 2) tape already in the seed: NQ ~30,357–31,282.50 tagged and faded near 31,050–31,074; ES ~7,672.75–7,810, Sep 21–25 PWH 7,848.50 untouched. Soft NFP already printed. Do not invent CWH/CWL.",
  po3: "Mon ISM Services manipulates. Tue trade is not the raid. Wed minutes distribute after 14:00. Thu claims. Fri UMich is a medium close, not NFP.",
  macro:
    "Sep NFP already printed +29k, U 4.2%, AHE +0.1% (BLS USDL-26-1549). ISM Services Sep printed Mon 54.9 vs ~55.0 / prev 55.4 (prices 74.0). BEA trade Aug printed Tue −$105.6B vs Jul rev −$92.8B. ADP NER Pulse Tue +23.75k/wk (four weeks ending Sep 19) vs prior +20k — not monthly ADP. No ISM/JOLTS/claims/NFP Tue. Fed calendar: Sep 15–16 minutes Wed Oct 7 14:00. Claims Thu 8:30. UMich Oct P Fri 10:00. Minutes Oct 7 14:00: most see another hike by year-end, timing unspecified. Oct 28 hike odds little changed after the print: FedWatch ~17% +25 / >80% hold (InvestmentNews 17.2%) vs Reuters ~78% hold pre-release and 22.7/77.3 Oct 6. Thu claims 197k vs 200k (DOL, prev rev 199k); no official FedWatch restamp after the print. CPI Sep is Wed Oct 14, not this week.",
  asymmetry:
    "A+ into ISM and the minutes. Flatten before 13:45 Wed. blake_mech longs stay paper. PATH floor 0.65.",
  nq: {
    settle: 31050,
    rangeLo: 30357,
    rangeHi: 31282.5,
    pwh: 31282.5,
    pwl: 30357,
    eq: 30819.75,
    drawUp: "PWH 31,282.50 already taken (Tue high 31,616.50). Wed failed back through it and reclaimed — next BSL only if the reclaim holds",
    drawDown: "Fail back through PWH 31,282.50 then prior-week 30,357",
    note: "PWH/PWL seed unchanged (Sep 28–Oct 2 ~30,357–31,282.50). Tue high 31,616.50, Mon low 30,957.50. Wed failed back through PWH and reclaimed; not a new weekly low. Live CWH/CWL from bars — not hardcoded.",
  },
  es: {
    settle: 7804,
    rangeLo: 7672.75,
    rangeHi: 7810,
    pwh: 7810,
    pwl: 7672.75,
    eq: 7741.38,
    drawUp: "PWH 7,810 and Sep 21–25 7,848.50 already taken (Tue high 7,897.50). Next only if the hold survives minutes",
    drawDown: "Fail back through 7,848.50 then PWH 7,810 then prior-week 7,672.75",
    note: "PWH/PWL seed unchanged (Sep 28–Oct 2 ~7,672.75–7,810). This week already took PWH and Sep 21–25 7,848.50; Tue high 7,897.50, Mon low 7,760.25. Live CWH/CWL from bars — not hardcoded.",
  },
  filters: [
    "±15 min: ISM Services Mon 10:00 · trade Tue 8:30 · minutes Wed 14:00 · claims Thu 8:30 · UMich Fri 10:00",
    "No entry 9:45–10:15 Mon or Fri",
    "Flatten before 13:45 Wed. No multi-day swing into minutes.",
    "Judas on. One book. PATH floor 0.65.",
  ],
  ops: [
    "Mon stand 9:45–10:15",
    "Tue trade is not a must-take",
    "Wed flatten 13:45; A+ only after 14:15",
    "Thu claims 8:15–8:45 stand",
    "Fri UMich 9:45–10:15 stand",
  ],
  outcomes: [
    { p: 40, name: "Hot services and/or hawkish minutes", detail: "October hike repricing. NQ-lead lower only after BSL raid + MSS. Do not fade the first ISM spike." },
    { p: 35, name: "In-line slate", detail: "Two-way inside last week's box. Stand unless A+. Minutes are the swing, not a fresh tick before 14:00." },
    { p: 25, name: "Soft services / dovish minutes", detail: "Squeeze. Long only SSL in discount + MSS. Still flatten into Wed 13:45." },
  ],
  days: [
    {
      date: "2026-10-05",
      weekday: "Mon",
      dailyBias: "PWH raid held. Not a new HTF trend.",
      kind: "event",
      news: [{ timeEt: "10:00", name: "ISM Services PMI (Sep)", impact: "high", note: "ISM official 54.9 vs ~55.0 / prev 55.4. Prices 74.0, emp 50.1. S&P services final 9:45 is not the blackout." }],
      likelyTape: "ISM 54.9 slight miss, still expansion. NQ session 30,957.50–31,371 settled 31,317.75, took PWH 31,282.50 and held. ES session 7,760.25–7,847.50 settled 7,826.25, took PWH 7,810 and held. PWL untouched. Held raid, not a fresh HTF trend.",
      trade: "Post-print mechanical only if MSS + IFVG. Both PWH taken and held. Do not chase the hold. Do not invent a trend day into Tuesday.",
      skipIf: "Already through PWH without a fail back inside — no chase. No MSS + IFVG.",
      pathNote: "PWH/PWL seed is last week. Live CWH/CWL from bars. Next is Tue trade 8:30.",
    },
    {
      date: "2026-10-06",
      weekday: "Tue",
      dailyBias: "Selective. Trade is not the week's raid.",
      kind: "selective",
      news: [{ timeEt: "08:30", name: "International Trade (Aug)", impact: "medium", note: "BEA official Oct 6 8:30 ET. Deficit −$105.6B vs Jul rev −$92.8B. Not a PATH trigger." }],
      likelyTape: "Trade −$105.6B vs Jul rev −$92.8B. NQ session 31,309.25–31,616.50 last ~31,497, stayed above PWH 31,282.50. ES 7,829.25–7,897.50 last ~7,877, stayed above PWH 7,810 and Sep 21–25 7,848.50. No fail back inside. Held extension, not a new HTF trend.",
      trade: "Mechanical only if Mon left a clean dealing range and MSS + IFVG after 9:45. Do not chase the globex extension. Do not treat 8:30 as NFP.",
      skipIf: "Chop, or already booked Monday. No chase of the overnight high.",
      pathNote: "PWH/PWL seed unchanged. Live CWH/CWL from bars. Next is Wed minutes 14:00. Flatten before 13:45.",
    },
    {
      date: "2026-10-07",
      weekday: "Wed",
      dailyBias: "Minutes hawkish on year-end, Oct hold intact. NQ failed PWH. Not a new HTF trend.",
      kind: "event",
      news: [{ timeEt: "14:00", name: "FOMC Minutes (Sep meeting)", impact: "high", note: "Fed official 14:00 ET. Most: another hike likely appropriate by year-end, no date, data-dependent. Several: current rate not or only mildly restrictive. Consumer credit 15:00 is not the blackout." }],
      likelyTape: "Minutes did not date the next hike. NQ session 31,143–31,521 last ~31,395 failed back through PWH 31,282.50 and reclaimed (Tue high 31,616.50 untouched). ES 7,815.75–7,884 last ~7,853 held seed PWH 7,810, lost Sep 21–25 7,848.50 intraday, reclaimed near it. PWL untouched. Failed NQ PWH hold, not a new HTF trend.",
      trade: "Blackout done. A+ only if MSS + IFVG already there. Do not chase the NQ reclaim of PWH. Minutes are not a new decision.",
      skipIf: "No MSS + IFVG. NQ failed to hold PWH. Already booked the week.",
      pathNote: "PWH/PWL seed unchanged. Next session claims blackout Thu 8:15–8:45. CPI Wed Oct 14.",
    },
    {
      date: "2026-10-08",
      weekday: "Thu",
      dailyBias: "Claims soft-in-line. NQ failed PWH and closed under it. Not a new HTF trend.",
      kind: "selective",
      news: [{ timeEt: "08:30", name: "Initial Jobless Claims", impact: "medium", note: "DOL official Oct 8. 197k vs exp 200k, prev rev 199k (was 197k). Week ending Oct 3. Continuing 1.716M vs 1.699M rev. 4-wk avg 198k. Not a labor-break." }],
      likelyTape: "Claims 197k vs 200k. NQ session 30,792.50–31,466 last ~31,005 failed back through PWH 31,282.50 and closed under it (Tue high 31,616.50 untouched). ES 7,783–7,858.25 last ~7,820 lost seed PWH 7,810 intraday, last near it. PWL untouched both. Failed hold, not a new HTF trend.",
      trade: "Blackout done. Mechanical only if MSS + IFVG already there. Do not chase the NQ fail back under PWH. Do not carry a loser into Friday.",
      skipIf: "No MSS + IFVG. NQ failed to hold PWH. Already booked the week.",
      pathNote: "PWH/PWL seed unchanged. Next session UMich blackout Fri 9:45–10:15. Mon Oct 12 cash closed. CPI Wed Oct 14.",
    },
    {
      date: "2026-10-09",
      weekday: "Fri",
      dailyBias: "Selective. UMich is medium. Cash closed Monday.",
      kind: "selective",
      news: [{ timeEt: "10:00", name: "UMich Sentiment (Oct P)", impact: "medium", note: "10:00 ET prelim. Not NFP. Columbus Day Mon Oct 12 — cash closed." }],
      likelyTape: "Inside the week box unless minutes already resolved it. No NFP. Do not invent a Friday trend.",
      trade: "Stand 9:45–10:15. A+ only after MSS + IFVG. Flatten into the weekend unless BE.",
      skipIf: "No MSS + IFVG. Already took the week. Do not swing into a holiday Globex.",
      pathNote: "PWH/PWL seed unchanged. Next hard print is CPI Wed Oct 14 8:30. Mon Oct 12 cash closed.",
    },
  ],
};

const PLANS: WeekPlan[] = [WEEK_OCT5_OCT9, WEEK_SEP28_OCT2];

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
