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
  /** Current-week high from tape (this week only, no future bars). */
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

/** Week of Aug 31 – Sep 4 2026. Last labor print before Sep 15–16 FOMC. */
export const WEEK_AUG31_SEP4: WeekPlan = {
  id: "2026-08-31",
  weekLabel: "Aug 31 – Sep 4, 2026",
  weekStart: "2026-08-31",
  weekEnd: "2026-09-04",
  headline:
    "Range / two-way / news-compression week — NFP Fri is the fulcrum, not a directional call",
  htfBias:
    "Conditional bearish-to-two-way on NQ. ES is the stronger book. NQ-lead weakness after Warsh — SMT shorts need NQ to take a high ES does not.",
  po3: "Mon–Tue accumulate / define the week’s high or low. Wed–Thu manipulate around ADP + Broadcom. Fri distribute on NFP (seek-and-destroy base case).",
  macro:
    "Warsh: inflation still too high, Fed may have work to do. Sep 16 hike odds ~56–60% (was ~35%). July NFP −23k. Consensus Fri +45k to +65k, U-rate 4.2%. PCE 3.7% vs 2%.",
  asymmetry:
    "Hot jobs/wages = bearish (hike locked). Soft print = squeeze (fade Warsh). Do not fade strength into Friday if ADP/JOLTS already baked hot.",
  nq: {
    settle: 29492,
    rangeLo: 29436,
    rangeHi: 29811,
    pwh: 29811,
    pwl: 28947,
    eq: 29379,
    drawUp: "Fri high 29,811 then 30,000s",
    drawDown: "29,367 (50%) then 28,947 PWL",
    note: "Close just above EQ. Premium shorts only after they raid PWH. 3-month −2.9%, ~1,480 pts off Jun 16 ATH 30,975.",
  },
  es: {
    settle: 7722,
    rangeLo: 7712,
    rangeHi: 7783,
    pwh: 7783,
    pwl: 7655,
    eq: 7719,
    drawUp: "7,783 then ATH 7,838.50",
    drawDown: "7,700–7,690 then 7,655",
    note: "~116 pts off Aug 13 ATH. Holds better than NQ — SMT companion, not the primary book unless NQ is dead.",
  },
  filters: [
    "±15 min blackout: ISM Tue/Thu 10:00 ET, ADP Wed 8:15 ET, NFP Fri 8:30 ET",
    "Judas 9:30–9:45 ET every day — no entries",
    "After 10:00 ET, A+ only unless already in a managed trade",
    "One book: MNQ primary (NQ is the SMT leader). Do not also short ES the same bias",
    "PATH quota 1–2 this week is a win. Cap is not the job on an NFP week",
    "blake_mech longs stay paper / B+",
  ],
  ops: [
    "Book: MNQ primary. ES only if NQ is dead and ES has the clean raid",
    "8:20 CDT brief · 8:30–8:44 Judas · 8:45–9:00 pulses · after 10:00 ET A+ only",
    "Debrief every close and every skip",
  ],
  outcomes: [
    {
      p: 45,
      name: "Two-way",
      detail: "NQ closes inside 28,947–29,811. Mon/Tue sets one extreme, NFP the other. Best PATH: Tue post-ISM or Wed post-ADP.",
    },
    {
      p: 30,
      name: "Hawkish follow-through",
      detail: "Hot JOLTS + ADP + NFP. NQ draws 29,367 → 28,947. ES holds = SMT short week. Highest-quality mechanical short week.",
    },
    {
      p: 25,
      name: "Squeeze",
      detail: "Soft labor, fade Warsh. Raid Fri/Tue lows then squeeze 29,811 / 7,838. Long only SSL in discount + MSS. Do not buy strength into NFP.",
    },
  ],
  days: [
    {
      date: "2026-08-31",
      weekday: "Mon",
      dailyBias: "Neutral / range-build",
      kind: "range_build",
      news: [
        {
          timeEt: "10:30",
          name: "Dallas Fed (low)",
          impact: "medium",
          note: "UK bank holiday — thinner London. No U.S. high-impact.",
        },
      ],
      likelyTape:
        "ICT Monday. Asia/London print a range; NY AM hunts Fri high 29,811 / 7,783 or Fri low 29,436 / 7,712. Often sets the weekly high or low.",
      trade:
        "Reduced size. Mechanical only if they sweep Friday H or L and reclaim with MSS + IFVG. If Mon closes inside Friday’s range, week is inside — do not invent HTF trend.",
      skipIf: "No raid of Friday extremes by 10:00 ET",
      pathNote: "Not a must-take. Process skip is fine.",
    },
    {
      date: "2026-09-01",
      weekday: "Tue",
      dailyBias: "Two-way, lean short if ISM + prices stay hot",
      kind: "two_way",
      news: [
        {
          timeEt: "10:00",
          name: "ISM Manufacturing + Prices + JOLTS",
          impact: "high",
          note: "ISM prev 55.6 exp ~55.3. Prices Paid prev 71.1 (hot). JOLTS prev 7.36M. EZ flash CPI. PANW after close.",
        },
      ],
      likelyTape:
        "First real volatility. 10:00 ET Judas-style raid of Mon high/low. Hot ISM prices + firm JOLTS = NQ sell-the-news after the spike. Soft ISM = squeeze into 29,811.",
      trade:
        "Stand 9:50–10:15 ET. Then only the post-10:15 mechanical that aligns with the reaction. SMT: NQ sweeps Mon high, ES does not → short MNQ.",
      skipIf: "No displacement + IFVG after the 10:15 reopen",
      pathNote: "A− possible. Not a must-take.",
    },
    {
      date: "2026-09-02",
      weekday: "Wed",
      dailyBias: "Wait / A+ only after ADP",
      kind: "a_plus_only",
      news: [
        {
          timeEt: "08:15",
          name: "ADP Employment (Aug)",
          impact: "high",
          note: "Exp ~+47k, July +44k. Inside premarket — 8:15–8:45 engineered sweep then 9:30 Judas.",
        },
        {
          timeEt: "16:00",
          name: "Broadcom / HPE / Snowflake earnings",
          impact: "medium",
          note: "AI capex follow-through after Nvidia beat-and-sold-off. Flatten before close unless BE. Do not carry through the print.",
        },
      ],
      likelyTape:
        "ADP 8:15 is 15m before the 8:30 window. Overnight Wed is AVGO binary. Hot ADP (>70k) + dump into discount array = week’s cleanest A short if SMT confirms.",
      trade:
        "One PATH max. If ADP is dead and they squeeze Warsh, do not chase longs until LTF MSS.",
      skipIf: "Still open into the cash close — flatten. No AVGO overnight risk.",
      pathNote: "A+ only. Cap at one book.",
    },
    {
      date: "2026-09-03",
      weekday: "Thu",
      dailyBias: "Selective — services + claims",
      kind: "selective",
      news: [
        {
          timeEt: "08:30",
          name: "Initial Jobless Claims",
          impact: "medium",
          note: "Rarely trends the day.",
        },
        {
          timeEt: "10:00",
          name: "ISM Services (Aug)",
          impact: "high",
          note: "Prev 54.1, employment component 47.4 (already contraction). Services prices 66–70 keep hike narrative.",
        },
      ],
      likelyTape:
        "ISM Services 10:00 can. Sub-50 employment + claims up = market prices soft NFP → squeeze into Friday. Hot services prices = NQ stays offered.",
      trade:
        "Raid of Wed high/low at 10:00, then mechanical. Gold-standard: short + mechanical + clean risk-off if they raid BSL first.",
      skipIf: "Already took a book this week and the card is not A+",
      pathNote: "Do not stack a second book ahead of NFP.",
    },
    {
      date: "2026-09-04",
      weekday: "Fri",
      dailyBias: "Stand first. Fade the second impulse.",
      kind: "nfp",
      news: [
        {
          timeEt: "08:30",
          name: "NFP / Employment Situation (Aug)",
          impact: "high",
          note: "Consensus +45k to +65k, U-rate 4.2%, AHE +0.2% m/m. July −23k. Last labor print before Sep 16 FOMC.",
        },
      ],
      likelyTape:
        "Seek-and-destroy. First 8:30–8:50 spike takes both sides of Thursday’s range. Real move often after 9:45–10:00 once the first run fails.",
      trade:
        "Hot (>100k and/or AHE ≥0.3%): hike odds up, NQ lead lower, draw 29,367 then 28,947 — short MNQ after raid + MSS. In-line: skip unless A+ after 10:00. Soft (<20k or U-rate 4.3%+): long only in discount after SSL sweep. blake_mech longs stay paper.",
      skipIf: "No displacement + IFVG by 10:15 ET — stand and journal the skip",
      pathNote: "No entry 8:15–9:00. Judas still on. Do not hold a runner into Sunday Globex unless BE.",
    },
  ],
};

/** Week of Sep 8 – 11 2026. Labor Day Mon, then PPI/CPI into FOMC. */
export const WEEK_SEP07_SEP11: WeekPlan = {
  id: "2026-09-07",
  weekLabel: "Sep 7 – 11, 2026",
  weekStart: "2026-09-07",
  weekEnd: "2026-09-11",
  headline:
    "Holiday then inflation — last hard CPI before Sep 16 FOMC. Thin Tuesday is often the trap.",
  htfBias:
    "Still conditional two-way on NQ until CPI prints. If Week 1 labor was hot, lean short after BSL raid. If labor was soft, do not buy strength into Friday CPI.",
  po3: "Mon holiday. Tue accumulate a range. Wed quiet. Thu PPI manipulates. Fri CPI distributes.",
  macro:
    "PPI Thu 8:30 is the CPI sneak preview. CPI Fri 8:30 is the last inflation print the Sep 16 SEP can use. ECB this week is not your trigger.",
  asymmetry:
    "Hot core CPI ≥0.3% m/m = hike odds up, draw PWL 28,947. Soft = squeeze 29,811 / 7,838 only after SSL in discount. If Week 1 already took a hawkish A+ short and CPI is also hot, stand Friday — cap is not the job.",
  nq: {
    settle: 29492,
    rangeLo: 29436,
    rangeHi: 29811,
    pwh: 29811,
    pwl: 28947,
    eq: 29379,
    drawUp: "PWH 29,811 then 30,121",
    drawDown: "29,367 then 28,947 then 28,314",
    note: "Use live CWH/CWL from Week 1 if they printed. Do not keep August levels that have been taken.",
  },
  es: {
    settle: 7723,
    rangeLo: 7712,
    rangeHi: 7783,
    pwh: 7783,
    pwl: 7655,
    eq: 7719,
    drawUp: "7,783 then ATH 7,838.50",
    drawDown: "7,700 then 7,655",
    note: "SMT companion. ES holds better.",
  },
  filters: [
    "Mon Labor Day — cash closed. Globex thin and fake. Do not treat Asia as HTF.",
    "Tue A+ only until the post-holiday range is in",
    "±15 min: PPI Thu 8:30, CPI Fri 8:30",
    "No CPI fade in the first 30 minutes",
    "Judas every day. One book. blake_mech longs paper / B+",
  ],
  ops: [
    "Book: MNQ primary",
    "8:20 CDT brief · Judas · after 10:00 A+ on event days",
    "If Week 1 already used the hawkish short, Friday skip is a process win",
  ],
  outcomes: [
    {
      p: 40,
      name: "In-line CPI",
      detail: "Two-way into FOMC week. Stand unless A+ after 10:15 Fri.",
    },
    {
      p: 35,
      name: "Hot CPI",
      detail: "Hike odds up. Short MNQ after BSL raid + MSS. Draw 28,947.",
    },
    {
      p: 25,
      name: "Soft CPI",
      detail: "Squeeze 29,811 / 7,838. Long only SSL in discount + MSS.",
    },
  ],
  days: [
    {
      date: "2026-09-07",
      weekday: "Mon",
      dailyBias: "Stand. Cash closed.",
      kind: "holiday",
      news: [],
      likelyTape: "Labor Day. Globex is thin and fake. Do not treat Sunday/Monday Asia as HTF.",
      trade: "No PATH. Plan only.",
      skipIf: "Always — holiday.",
      pathNote: "Process skip. Journal it.",
    },
    {
      date: "2026-09-08",
      weekday: "Tue",
      dailyBias: "A+ only until the range is in",
      kind: "a_plus_only",
      news: [
        {
          timeEt: "11:00",
          name: "NY Fed SCE",
          impact: "medium",
          note: "First cash session after the holiday. Typical post-holiday Judas.",
        },
      ],
      likelyTape:
        "Many “good” Tuesday opens are the week’s trap. NY AM hunts the holiday Globex extremes.",
      trade:
        "A+ mechanical only after a raid of Globex H/L and MSS + IFVG. Reduced size.",
      skipIf: "No raid of holiday extremes by 10:00 ET",
      pathNote: "A+ until the range is in. Not a must-take.",
    },
    {
      date: "2026-09-09",
      weekday: "Wed",
      dailyBias: "Selective — quiet BLS",
      kind: "selective",
      news: [
        {
          timeEt: "10:00",
          name: "ECEC (low/medium)",
          impact: "medium",
          note: "Best normal PATH day of this week if Week 1 left a clean dealing range.",
        },
      ],
      likelyTape: "Inside last week’s range unless Tue already broke it. Mechanical + SMT.",
      trade: "One book. Gold-standard: raid + mechanical + clean risk-off.",
      skipIf: "Already took Tue and the card is not A+",
      pathNote: "Do not stack ahead of PPI/CPI.",
    },
    {
      date: "2026-09-10",
      weekday: "Thu",
      dailyBias: "Two-way, PPI as raid",
      kind: "two_way",
      news: [
        {
          timeEt: "08:30",
          name: "PPI (Aug)",
          impact: "high",
          note: "CPI sneak preview. Hot core PPI → NQ lead lower into Friday. Soft → squeeze toward PWH, fade strength into CPI.",
        },
      ],
      likelyTape:
        "8:30 engineered sweep of Wed high/low. Real move after 9:45 once the first run fails.",
      trade:
        "No entry 8:15–9:00. Then mechanical aligned with the reaction. Do not fade the first spike.",
      skipIf: "No displacement + IFVG by 10:15",
      pathNote: "A− possible. Flatten before Friday CPI unless BE.",
    },
    {
      date: "2026-09-11",
      weekday: "Fri",
      dailyBias: "Stand first. CPI is the last inflation print before FOMC.",
      kind: "event",
      news: [
        {
          timeEt: "08:30",
          name: "CPI (Aug)",
          impact: "high",
          note: "Hot = core ≥0.3% m/m or headline surprise higher. In-line = two-way. Soft = squeeze. UMich prelim 10:00 is secondary.",
        },
      ],
      likelyTape:
        "Same as NFP. First 8:30–8:50 takes both sides. Real move after 9:45–10:00 once the first run fails.",
      trade:
        "Hot: short MNQ after BSL raid + MSS, draw 28,947. In-line: A+ after 10:00 only. Soft: long only SSL in discount + MSS. blake_mech longs paper.",
      skipIf: "No MSS + IFVG by 10:15. Do not short the first spike. If Week 1 already took the hawkish short, skip is a win.",
      pathNote: "No entry 8:15–9:00. Judas on. No runner into Sunday Globex unless BE.",
    },
  ],
};

/** Week of Sep 14 – 18 2026. FOMC + SEP. Flatten before 13:45 Wed. */
export const WEEK_SEP14_SEP18: WeekPlan = {
  id: "2026-09-14",
  weekLabel: "Sep 14 – 18, 2026",
  weekStart: "2026-09-14",
  weekEnd: "2026-09-18",
  headline:
    "FOMC + SEP week. Compression then the event. Delivery is Thu/Fri, not Wed 14:01.",
  htfBias:
    "Do not invent HTF trend into the meeting. After the statement: hold+hawkish SEP = NQ-lead lower; +25 = both sides first; hold+dovish = squeeze only after SSL in discount.",
  po3: "Mon–Tue accumulate inside last week’s range. Wed manipulate around Retail Sales then the decision. Thu–Fri distribute.",
  macro:
    "Statement 14:00 ET, dots + SEP, presser 14:30. Retail Sales 8:30 Wed. Live bet is hold vs +25. Minutes print Oct 7 — irrelevant for PATH this week.",
  asymmetry:
    "Flatten before 13:45 Wed. Do not invent a PATH from the first 60 seconds of the statement. Best book is Thu if Wed left a swept extreme + LTF MSS.",
  nq: {
    settle: 29492,
    rangeLo: 29436,
    rangeHi: 29811,
    pwh: 29811,
    pwl: 28947,
    eq: 29379,
    drawUp: "Post-CPI CWH then 29,811 / 30,121",
    drawDown: "Post-CPI CML then 28,947",
    note: "Use live CWH/CWL. August PWH/PWL only if still untaken.",
  },
  es: {
    settle: 7723,
    rangeLo: 7712,
    rangeHi: 7783,
    pwh: 7783,
    pwl: 7655,
    eq: 7719,
    drawUp: "7,783 then 7,838.50",
    drawDown: "7,700 then 7,655",
    note: "SMT companion into the presser.",
  },
  filters: [
    "Quota 0–1 PATH before 14:00 Wed",
    "Flatten before 13:45 ET Wednesday — no runner into the decision",
    "Tue FOMC day 1 = A+ only",
    "±15 min Retail Sales Wed 8:30 · blackout 13:45–15:00 decision/presser",
    "One book. Judas on.",
  ],
  ops: [
    "Mon: do not buy strength into Tue/Wed",
    "Wed AM: Retail Sales can raid. Same 8:15–9:00 blackout",
    "Thu is the delivery day if Wed left the sweep + MSS",
  ],
  outcomes: [
    {
      p: 40,
      name: "Hold + hawkish SEP",
      detail: "Dots still show a 2026 hike. NQ lead lower. SMT short if ES holds. Take Thu/Fri, not 14:01.",
    },
    {
      p: 30,
      name: "+25 hike",
      detail: "First impulse both sides. Real move after the presser fail. Do not chase 14:00–14:20.",
    },
    {
      p: 30,
      name: "Hold + dovish presser",
      detail: "Hike odds collapse. Raid Week 2 lows then squeeze. Long only discount SSL + MSS.",
    },
  ],
  days: [
    {
      date: "2026-09-14",
      weekday: "Mon",
      dailyBias: "Neutral / positioning",
      kind: "range_build",
      news: [],
      likelyTape: "Often inside last week’s range. ICT Monday hunts Fri CPI extremes.",
      trade: "Reduced size. Mechanical only if they sweep Friday H or L and reclaim with MSS.",
      skipIf: "No raid of Friday extremes by 10:00. Do not buy strength into Tue/Wed.",
      pathNote: "Not a must-take.",
    },
    {
      date: "2026-09-15",
      weekday: "Tue",
      dailyBias: "A+ only. FOMC day 1 — no statement.",
      kind: "a_plus_only",
      news: [],
      likelyTape: "Compressed. Day-1 FOMC is usually a range.",
      trade: "A+ only. If you already have a book this week, stand.",
      skipIf: "Anything that is not a complete A+ after a raid.",
      pathNote: "Cap at zero if Mon already filled the week quota.",
    },
    {
      date: "2026-09-16",
      weekday: "Wed",
      dailyBias: "Stand into 14:00. Retail Sales AM only.",
      kind: "event",
      news: [
        {
          timeEt: "08:30",
          name: "Retail Sales (Aug)",
          impact: "high",
          note: "Morning raid possible. Same 8:15–9:00 blackout.",
        },
        {
          timeEt: "14:00",
          name: "FOMC Rate Decision + SEP",
          impact: "high",
          note: "Flatten before 13:45. Do not invent a PATH from the first 60 seconds.",
        },
        {
          timeEt: "14:30",
          name: "FOMC Press Conference",
          impact: "high",
          note: "Real move often after the presser fail, not the statement tick.",
        },
      ],
      likelyTape:
        "AM: Retail Sales seek-and-destroy. PM: both sides of the range at 14:00, then the presser.",
      trade:
        "Morning PATH only if A+ after 10:15 and you can flatten by 13:45. After 14:00: stand or A+ displacement only — usually wait for Thu.",
      skipIf: "Still open at 13:45. First 60 seconds of the statement. 14:00–14:20 chase.",
      pathNote: "Quota 0–1 before 14:00. Delivery is tomorrow.",
    },
    {
      date: "2026-09-17",
      weekday: "Thu",
      dailyBias: "Selective — post-Fed delivery",
      kind: "selective",
      news: [],
      likelyTape:
        "Best post-Fed PATH if Wed left a swept extreme and LTF MSS. BoE is not your trigger.",
      trade:
        "One book. Mechanical + SMT aligned with the statement reaction, not the first tick.",
      skipIf: "No swept extreme left from Wednesday.",
      pathNote: "Gold-standard day if the raid is clean.",
    },
    {
      date: "2026-09-18",
      weekday: "Fri",
      dailyBias: "TGIF. After 10:00 A+ only.",
      kind: "selective",
      news: [
        {
          timeEt: "09:15",
          name: "Industrial Production (Aug)",
          impact: "medium",
          note: "UMich final ~10:00. Not your trigger.",
        },
      ],
      likelyTape: "Follow-through or fade of Thursday. Liquidity thins.",
      trade: "A+ only after 10:00. No runner into the weekend unless BE.",
      skipIf: "Already took Thu.",
      pathNote: "Process skip is fine.",
    },
  ],
};

/** Week of Sep 21 – 25 2026. Digestion. July-20-style mechanical. */
export const WEEK_SEP21_SEP25: WeekPlan = {
  id: "2026-09-21",
  weekLabel: "Sep 21 – 25, 2026",
  weekStart: "2026-09-21",
  weekEnd: "2026-09-25",
  headline:
    "Quietest cash week. If FOMC resolved the range, trade the new extreme. If not, two-way inside the Aug 24–Sep 16 box.",
  htfBias:
    "HTF draw is now the post-Fed CMH/CML. Do not keep trading August PWH/PWL if they have been taken.",
  po3: "Mon range-build. Midweek housing/confidence is not the trigger. Thu claims rarely trend. Fri TGIF.",
  macro: "No high-impact Fed. Claims Thu 8:30. This is where mechanical + SMT should look like Jul 20: raid, entry, clean risk-off.",
  asymmetry:
    "Do not force the 9/month quota on a dead week. One clean book beats three C’s.",
  nq: {
    settle: 29492,
    rangeLo: 29436,
    rangeHi: 29811,
    pwh: 29811,
    pwl: 28947,
    eq: 29379,
    drawUp: "Post-Fed CMH then next BSL",
    drawDown: "Post-Fed CML then next SSL",
    note: "Live CWH/CWL from this week. Seed levels are fallback only.",
  },
  es: {
    settle: 7723,
    rangeLo: 7712,
    rangeHi: 7783,
    pwh: 7783,
    pwl: 7655,
    eq: 7719,
    drawUp: "Post-Fed ES CMH",
    drawDown: "Post-Fed ES CML",
    note: "SMT companion.",
  },
  filters: [
    "Normal PATH if the range is clean",
    "Judas on. One book.",
    "Claims Thu 8:30 medium — ±15m caution not a blackout unless it spikes",
  ],
  ops: [
    "Gold-standard: raid + mechanical + clean risk-off",
    "If FOMC did not resolve the range, same Week 1 two-way rules",
  ],
  outcomes: [
    {
      p: 50,
      name: "Resolved range",
      detail: "Post-Fed extreme holds. Mechanical with the new draw.",
    },
    {
      p: 50,
      name: "Still inside",
      detail: "Aug 24–Sep 16 box. Two-way. Do not invent HTF trend.",
    },
  ],
  days: [
    {
      date: "2026-09-21",
      weekday: "Mon",
      dailyBias: "Neutral / range-build",
      kind: "range_build",
      news: [],
      likelyTape: "ICT Monday hunts last week’s FOMC extremes.",
      trade: "Reduced size. Mechanical if they sweep Fri H/L and reclaim with MSS.",
      skipIf: "No raid by 10:00.",
      pathNote: "Not a must-take.",
    },
    {
      date: "2026-09-22",
      weekday: "Tue",
      dailyBias: "Selective mechanical",
      kind: "selective",
      news: [],
      likelyTape: "Quiet. Best two-way PATH if Mon set an extreme.",
      trade: "One book. Mechanical + SMT.",
      skipIf: "No clean raid.",
      pathNote: "Jul 20 style if it shows up.",
    },
    {
      date: "2026-09-23",
      weekday: "Wed",
      dailyBias: "Selective",
      kind: "selective",
      news: [],
      likelyTape: "Housing / Richmond-type prints are not your trigger.",
      trade: "Same model. Do not force.",
      skipIf: "Already took a book this week and the card is not A+.",
      pathNote: "Cap.",
    },
    {
      date: "2026-09-24",
      weekday: "Thu",
      dailyBias: "Selective — claims",
      kind: "selective",
      news: [
        {
          timeEt: "08:30",
          name: "Initial Jobless Claims",
          impact: "medium",
          note: "Rarely trends the day.",
        },
      ],
      likelyTape: "Claims caution ±15m. Then mechanical.",
      trade: "Raid of Wed high/low, then mechanical.",
      skipIf: "Chop.",
      pathNote: "One book.",
    },
    {
      date: "2026-09-25",
      weekday: "Fri",
      dailyBias: "TGIF. After 10:00 A+ only.",
      kind: "selective",
      news: [],
      likelyTape: "Liquidity thins. No runner into the weekend unless BE.",
      trade: "A+ only after 10:00.",
      skipIf: "Already took the week.",
      pathNote: "Process skip is fine.",
    },
  ],
};

/** Week of Sep 28 – 30 2026. JOLTS then PCE. Do not swing into Oct 2 NFP. */
export const WEEK_SEP28_SEP30: WeekPlan = {
  id: "2026-09-28",
  weekLabel: "Sep 28 – 30, 2026",
  weekStart: "2026-09-28",
  weekEnd: "2026-09-30",
  headline:
    "PCE week. Fed’s inflation gauge. Oct 2 is September NFP — do not start a multi-day swing Wednesday night.",
  htfBias:
    "Hot core PCE after a hold = October hike repricing, NQ-lead weakness. Soft PCE = squeeze. SMT: NQ still the leader if hike is re-priced.",
  po3: "Mon range-build. Tue JOLTS manipulates. Wed PCE distributes.",
  macro:
    "Tue JOLTS Aug 10:00 — first look at August openings after NFP. Wed ADP 8:15 + GDP Q2 3rd + PCE Aug 8:30.",
  asymmetry:
    "A+ into the prints. No runner into Oct 2. blake_mech longs stay paper.",
  nq: {
    settle: 29492,
    rangeLo: 29436,
    rangeHi: 29811,
    pwh: 29811,
    pwl: 28947,
    eq: 29379,
    drawUp: "Month CMH then 29,811 / 30,121",
    drawDown: "Month CML then 28,947",
    note: "Use live month CMH/CML.",
  },
  es: {
    settle: 7723,
    rangeLo: 7712,
    rangeHi: 7783,
    pwh: 7783,
    pwl: 7655,
    eq: 7719,
    drawUp: "Month ES CMH then 7,838.50",
    drawDown: "Month ES CML then 7,655",
    note: "SMT companion.",
  },
  filters: [
    "±15 min: JOLTS Tue 10:00 · ADP/GDP/PCE Wed 8:15–8:45",
    "No entry 8:00–8:45 Wed",
    "No multi-day swing into Oct 2 NFP",
    "Judas on. One book.",
  ],
  ops: [
    "Tue stand 9:45–10:15",
    "Wed second impulse only after 9:45",
  ],
  outcomes: [
    {
      p: 45,
      name: "Hot PCE",
      detail: "October hike repricing. NQ-lead lower. Short after BSL raid + MSS.",
    },
    {
      p: 30,
      name: "In-line",
      detail: "Two-way into Oct 2 NFP. Stand unless A+.",
    },
    {
      p: 25,
      name: "Soft PCE",
      detail: "Squeeze. Long only SSL in discount + MSS. Do not carry into Oct 2.",
    },
  ],
  days: [
    {
      date: "2026-09-28",
      weekday: "Mon",
      dailyBias: "Neutral / range-build",
      kind: "range_build",
      news: [],
      likelyTape: "ICT Monday. Reduced size.",
      trade: "Mechanical only if they sweep last week H/L with MSS.",
      skipIf: "No raid by 10:00.",
      pathNote: "Not a must-take.",
    },
    {
      date: "2026-09-29",
      weekday: "Tue",
      dailyBias: "Two-way, JOLTS as raid",
      kind: "two_way",
      news: [
        {
          timeEt: "10:00",
          name: "JOLTS Job Openings (Aug)",
          impact: "high",
          note: "First look at August openings after NFP.",
        },
      ],
      likelyTape: "10:00 raid of Mon high/low. Stand 9:45–10:15.",
      trade: "Post-10:15 mechanical aligned with the reaction. SMT if NQ sweeps and ES does not.",
      skipIf: "No displacement + IFVG after 10:15.",
      pathNote: "A− possible.",
    },
    {
      date: "2026-09-30",
      weekday: "Wed",
      dailyBias: "Stand first. PCE is the Fed’s gauge.",
      kind: "event",
      news: [
        {
          timeEt: "08:15",
          name: "ADP Employment (Sep)",
          impact: "high",
          note: "Inside premarket with PCE.",
        },
        {
          timeEt: "08:30",
          name: "GDP Q2 (3rd) / PCE (Aug)",
          impact: "high",
          note: "Hot core PCE after a hold = October hike. Soft = squeeze. Do not carry into Oct 2 NFP.",
        },
      ],
      likelyTape: "8:15–8:50 seek-and-destroy. Real move after 9:45.",
      trade:
        "No entry 8:00–8:45. Hot PCE: short after BSL raid + MSS. Soft: long only SSL in discount. Flatten before the close — Oct 2 is NFP.",
      skipIf: "No MSS + IFVG by 10:15. Any overnight into Oct 2.",
      pathNote: "A+ into the prints. No runner.",
    },
  ],
};

const PLANS: WeekPlan[] = [
  WEEK_AUG31_SEP4,
  WEEK_SEP07_SEP11,
  WEEK_SEP14_SEP18,
  WEEK_SEP21_SEP25,
  WEEK_SEP28_SEP30,
];

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
    return {
      plan: stamped,
      dateKey,
      today,
      next,
      phase,
      focus: today ?? next,
      live: false,
      refreshedAt: now.toISOString(),
    };
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

/** HUD / brain one-liner. */
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
        note: hit.note
          ? `${n.note} · ACTUAL ${hit.actual ?? "—"} vs ${hit.vs ?? "exp"} — ${hit.note}`
          : n.note,
      };
    });
    return { ...d, news, printed };
  });
  return { ...plan, days };
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

/**
 * Stamp live weekly range onto the Sunday seed.
 * Prior-week PWH/PWL stay. CWH/CWL + EQ come from bars dated this week only.
 */
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
  return {
    ...read,
    plan: nextPlan,
    today,
    next,
    focus: today ?? next,
    live: Boolean(nq.live || es.live),
    refreshedAt: now.toISOString(),
  };
}

