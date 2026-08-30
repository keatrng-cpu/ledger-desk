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
  | "nfp";

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

const PLANS: WeekPlan[] = [WEEK_AUG31_SEP4];

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

