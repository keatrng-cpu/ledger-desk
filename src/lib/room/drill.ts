/**
 * THE DRILL — a scripted day on the trading floor.
 *
 * SYNTHETIC, AND LABELLED SO EVERYWHERE. The floor's live mode only moves when
 * the desk does, which is about 90 minutes a weekday; the drill lets the room
 * be watched (and checked) on a Sunday. Every frame is a hand-written tape and
 * a hand-written desk read — the options desk's card, its SMC word, the
 * plan's CE, the release and its "actual" — and nothing in it is a fill, a
 * backtest, an economic print or a claim about how a session behaves. The
 * release is named "(drill)" for that reason. What is real is the machinery:
 * each frame goes through the SAME `runRoomCycle`, the SAME people layer, the
 * SAME paper book and the SAME level exits as live, so the drill is also the
 * floor's integration test (scripts/verify-room.mjs plays it end to end).
 *
 * The day: arrivals and coffee; a meeting before the 08:30 release, the
 * blackout, the release, a meeting after it; the 09:20 brief; a Judas raid
 * Jax calls the wrong way; a B+ card the room reviews and refuses to trade;
 * the A setup — FORMING → ARMED → the CE touch → a 1 DTE call fill; the
 * +40% trim at T1; Sterling refusing a second book on SPY (and the veto being
 * priced 30 minutes later); the 11:00 time stop; lunch; the close debrief;
 * after hours.
 */

import { etWallToEpochMs } from "@/lib/trading/sessions";
import type { Agenda, AgendaEvent, AgendaSetup, MindState } from "./agents";
import { computeExits, computeHeld } from "./desk-read";
import {
  runRoomCycle,
  type RoomCycle,
  type RoomDeskRead,
  type RoomEntryRead,
  type RoomInput,
  type Trend,
  type UnderlierTape,
} from "./orchestrator";
import { applyCycle, emptyBook, exitWatchOf, ledgerOf, markBook, rollCounters, toRoomInput, type RoomBook } from "./paper-book";
import type { Underlier } from "./option-math";

/** A Monday. The drill's clock is its own; nothing here reads today's date. */
export const DRILL_DATE = "2026-10-05";
export const DRILL_LABEL = "SYNTHETIC DRILL — scripted tape, desk reads and release; not market data";

export interface DrillFrame {
  at: string;
  /** What the tape just did, for the narrator strip. */
  caption: string;
  qqq: number;
  spy: number;
  nq: number;
  es: number;
  rsi: [number, number];
  vix: number;
  trend: [Trend, Trend];
  spike: [boolean, boolean];
  judas?: boolean;
  blackout?: string;
  killzone?: string;
  entry: RoomEntryRead | null;
  agenda?: Partial<Agenda>;
  /** Synthetic headlines for the news TV. */
  news?: string[];
}

/** The QQQ book's plan: MNQ long off the Judas low. rr1 = 114 / 72 = 1.58. */
const NQ_PLAN = { entry: 30996, stop: 30924, t1: 31110, t2: 31180, rr1: 1.58 };
/** The SPY book's plan Sterling refuses: ES long, a second book on the same morning. */
const ES_PLAN = { entry: 7846, stop: 7838, t1: 7859, t2: 7868, rr1: 1.63 };

const RELEASE: Omit<AgendaEvent, "minutes"> = { name: "CPI (drill)", date: DRILL_DATE, timeEt: "08:30", impact: "high" };
const NEXT_AFTER: Omit<AgendaEvent, "minutes"> = { name: "Fed speaker (drill)", date: DRILL_DATE, timeEt: "14:00", impact: "medium" };

function minutesBetween(a: string, b: string): number {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return (bh ?? 0) * 60 + (bm ?? 0) - ((ah ?? 0) * 60 + (am ?? 0));
}

function nqCard(over: Partial<RoomEntryRead>): RoomEntryRead {
  return {
    card: "path_continuation",
    name: "PATH continuation 1–2 DTE",
    verdict: "ARMED",
    blocks: [],
    underlier: "QQQ",
    type: "CALL",
    dte: 1,
    band: "A",
    confluence: 0.71,
    futSymbol: "MNQ",
    futSide: "long",
    smcWord: "TAKE",
    smcMissing: "Sequence complete",
    deskContracts: 2,
    sizedFrom: "level",
    deltaMin: 0.35,
    deltaMax: 0.45,
    plan: NQ_PLAN,
    tier: "forming",
    awayPts: null,
    pT1: 0.31,
    expR: 0.12,
    pFill: 0.52,
    patterns: { inducement: false, mitigation: false },
    ...over,
  };
}

function standCard(blocks: string[], over: Partial<RoomEntryRead> = {}): RoomEntryRead {
  return nqCard({
    verdict: "STAND",
    blocks,
    band: null,
    confluence: 0,
    smcWord: "STAND",
    smcMissing: "DOL",
    deskContracts: null,
    sizedFrom: null,
    plan: null,
    tier: null,
    pT1: null,
    expR: null,
    pFill: null,
    patterns: null,
    ...over,
  });
}

const judasCard = (): RoomEntryRead =>
  nqCard({ verdict: "WATCH", blocks: ["Judas 9:30–9:45 — no new day premium"], smcWord: "WAIT", smcMissing: "LTF shift", deskContracts: null, plan: null, tier: null, pFill: null });

const B_PLUS: AgendaSetup = {
  key: "ES:short:B+:drill",
  band: "B+",
  symbol: "ES",
  side: "short",
  confluence: 0.62,
  strategy: "TJR sweep → 5m CHoCH (drill)",
  pT1: 0.27,
  expR: -0.04,
  actionable: false,
  missing: "PATH floor 0.65",
};

export function drillFrames(): DrillFrame[] {
  const calm: Pick<DrillFrame, "vix" | "trend" | "spike"> = { vix: 17.6, trend: ["BULLISH", "BULLISH"], spike: [false, false] };
  const pre = (at: string): Partial<Agenda> => ({ next: { ...RELEASE, minutes: minutesBetween(at, RELEASE.timeEt) }, last: null });
  const post = (at: string, move?: AgendaEvent["move"]): Partial<Agenda> => ({
    next: { ...NEXT_AFTER, minutes: minutesBetween(at, NEXT_AFTER.timeEt) },
    last: { ...RELEASE, minutes: minutesBetween(RELEASE.timeEt, at), actual: "0.2% m/m (drill)", vs: "0.3% est (drill)", move: move ?? null },
  });
  const cpiMove: AgendaEvent["move"] = { symbol: "MNQ", from: 31040, to: 30922, pct: -0.38, window: "first 15 minutes" };
  return [
    {
      at: "07:45",
      caption: "Before the bell. People drift in; the coffee machine is busy.",
      qqq: 775.9,
      spy: 785.6,
      nq: 31036,
      es: 7856,
      rsi: [53, 52],
      ...calm,
      killzone: "premarket",
      entry: standCard(["Not NY AM (Pre-market)"]),
      agenda: pre("07:45"),
      news: ["CPI (drill) due 08:30 ET — consensus 0.3% m/m (drill)", "Futures flat ahead of inflation data (drill)"],
    },
    {
      at: "08:00",
      caption: "Thirty minutes to the release. The director calls the room to the board.",
      qqq: 776.0,
      spy: 785.7,
      nq: 31040,
      es: 7857,
      rsi: [54, 53],
      ...calm,
      killzone: "premarket",
      entry: standCard(["Not NY AM (Pre-market)"]),
      agenda: pre("08:00"),
      news: ["CPI (drill) due 08:30 ET — consensus 0.3% m/m (drill)"],
    },
    {
      at: "08:20",
      caption: "Inside the blackout. Everyone at their own desk.",
      qqq: 775.8,
      spy: 785.6,
      nq: 31032,
      es: 7856,
      rsi: [51, 51],
      vix: 17.9,
      trend: ["BULLISH", "BULLISH"],
      spike: [false, false],
      blackout: "CPI (drill) 08:30 ET — ±15 blackout",
      killzone: "premarket",
      entry: standCard(["Not NY AM (Pre-market)"]),
      agenda: pre("08:20"),
    },
    {
      at: "08:31",
      caption: "The print. MNQ drops 60 points in a minute on a volume spike.",
      qqq: 774.5,
      spy: 784.9,
      nq: 30980,
      es: 7849,
      rsi: [36, 40],
      vix: 18.8,
      trend: ["BULLISH", "BULLISH"],
      spike: [true, true],
      blackout: "CPI (drill) 08:30 ET — ±15 blackout",
      killzone: "premarket",
      entry: standCard(["Not NY AM (Pre-market)"]),
      agenda: post("08:31"),
      news: ["CPI (drill) 0.2% m/m vs 0.3% est (drill)", "Index futures whipsaw after inflation print (drill)"],
    },
    {
      at: "08:47",
      caption: "Blackout over. The room reviews what printed and what the tape did with it.",
      qqq: 773.1,
      spy: 784.3,
      nq: 30924,
      es: 7843,
      rsi: [31, 37],
      vix: 18.6,
      trend: ["BULLISH", "BULLISH"],
      spike: [false, false],
      killzone: "premarket",
      entry: standCard(["Not NY AM (Pre-market)"]),
      agenda: post("08:47", cpiMove),
      news: ["CPI (drill) 0.2% m/m vs 0.3% est (drill)", "Futures pare losses after the print (drill)"],
    },
    {
      at: "09:20",
      caption: "The morning brief.",
      qqq: 774.6,
      spy: 785.0,
      nq: 30984,
      es: 7850,
      rsi: [44, 46],
      ...calm,
      killzone: "premarket",
      entry: standCard(["Not NY AM (Pre-market)"]),
      agenda: post("09:20", cpiMove),
    },
    {
      at: "09:31",
      caption: "The open sells off — MNQ drops into the overnight low.",
      qqq: 774.1,
      spy: 784.6,
      nq: 30964,
      es: 7846,
      rsi: [38, 42],
      vix: 18.4,
      trend: ["BULLISH", "BULLISH"],
      spike: [true, false],
      judas: true,
      entry: judasCard(),
      agenda: post("09:31", cpiMove),
    },
    {
      at: "09:36",
      caption: "The raid: MNQ takes the low by 36 points on a volume spike.",
      qqq: 773.2,
      spy: 784.2,
      nq: 30928,
      es: 7842,
      rsi: [29, 35],
      vix: 18.9,
      trend: ["BULLISH", "BULLISH"],
      spike: [true, true],
      judas: true,
      entry: judasCard(),
      agenda: post("09:36", cpiMove),
    },
    {
      at: "09:40",
      caption: "A B+ card prints on ES. The director pulls the room in to review it.",
      qqq: 774.6,
      spy: 784.8,
      nq: 30984,
      es: 7848,
      rsi: [46, 47],
      vix: 18.3,
      trend: ["BULLISH", "BULLISH"],
      spike: [false, false],
      judas: true,
      entry: judasCard(),
      agenda: { ...post("09:40", cpiMove), setup: B_PLUS },
    },
    {
      at: "09:47",
      caption: "Displacement up through the raid's origin — MSS. The sequence prices a CE at 30,996.",
      qqq: 776.3,
      spy: 785.6,
      nq: 31052,
      es: 7856,
      rsi: [63, 58],
      vix: 17.9,
      trend: ["BULLISH", "BULLISH"],
      spike: [true, false],
      entry: nqCard({ tier: "forming", awayPts: 50, pFill: 0.52 }),
      agenda: post("09:47", cpiMove),
    },
    {
      at: "09:52",
      caption: "The retrace starts. 26 points from the array — ARMED.",
      qqq: 775.7,
      spy: 785.3,
      nq: 31028,
      es: 7853,
      rsi: [57, 55],
      ...calm,
      entry: nqCard({ tier: "armed", awayPts: 26, pFill: 0.8 }),
      agenda: post("09:52", cpiMove),
    },
    {
      at: "09:56",
      caption: "MNQ trades 31,000 — inside the array. The CE is touched.",
      qqq: 775.0,
      spy: 785.1,
      nq: 31000,
      es: 7851,
      rsi: [51, 52],
      ...calm,
      entry: nqCard({ tier: "live", awayPts: 0, pFill: 0.97 }),
      agenda: post("09:56", cpiMove),
    },
    {
      at: "10:05",
      caption: "Delivery. MNQ walks off the array toward T1.",
      qqq: 776.7,
      spy: 785.7,
      nq: 31068,
      es: 7857,
      rsi: [62, 58],
      ...calm,
      entry: nqCard({ tier: "forming", awayPts: 66, pFill: 0.52 }),
      agenda: post("10:05", cpiMove),
    },
    {
      at: "10:14",
      caption: "T1 31,110 prints. The calls are through +40%.",
      qqq: 778.1,
      spy: 786.3,
      nq: 31124,
      es: 7863,
      rsi: [70, 63],
      vix: 17.2,
      trend: ["BULLISH", "BULLISH"],
      spike: [true, false],
      entry: nqCard({ tier: "gone", awayPts: 122, pFill: null }),
      agenda: post("10:14", cpiMove),
      news: ["Tech leads as yields ease after CPI (drill)"],
    },
    {
      at: "10:22",
      caption: "ES pulls into its own array — the desk arms an SPY call while QQQ is still open.",
      qqq: 777.6,
      spy: 784.7,
      nq: 31104,
      es: 7847,
      rsi: [61, 49],
      ...calm,
      entry: nqCard({
        underlier: "SPY",
        futSymbol: "ES",
        band: "A−",
        confluence: 0.69,
        plan: ES_PLAN,
        tier: "live",
        awayPts: 0,
        pT1: 0.33,
        expR: 0.1,
        pFill: 0.97,
      }),
      agenda: post("10:22", cpiMove),
    },
    {
      at: "10:37",
      caption: "Both books drift. The QQQ runner holds above breakeven.",
      qqq: 777.9,
      spy: 784.4,
      nq: 31116,
      es: 7844,
      rsi: [60, 47],
      ...calm,
      entry: standCard(["No A+/A/A− PATH"]),
      agenda: post("10:37", cpiMove),
    },
    {
      at: "10:52",
      caption: "Thirty minutes after Sterling's SPY veto — ES slipped. The room checks the refused ticket.",
      qqq: 777.7,
      spy: 783.6,
      nq: 31108,
      es: 7836,
      rsi: [58, 41],
      ...calm,
      entry: standCard(["No A+/A/A− PATH"]),
      agenda: post("10:52", cpiMove),
    },
    {
      at: "11:00",
      caption: "11:00 ET — the day-ticket clock.",
      qqq: 777.8,
      spy: 783.9,
      nq: 31112,
      es: 7839,
      rsi: [58, 44],
      ...calm,
      killzone: "lunch",
      entry: standCard(["Not NY AM (Lunch)"]),
      agenda: post("11:00", cpiMove),
    },
    {
      at: "11:40",
      caption: "Lunch chop. The lounge fills up.",
      qqq: 777.5,
      spy: 784.2,
      nq: 31100,
      es: 7842,
      rsi: [52, 49],
      vix: 17.1,
      trend: ["BULLISH", "CHOPPY"],
      spike: [false, false],
      killzone: "lunch",
      entry: standCard(["Not NY AM (Lunch)"]),
      agenda: post("11:40"),
      news: ["Mega-cap tech steady into midday (drill)"],
    },
    {
      at: "12:30",
      caption: "Still lunch. Coffee, the couch, the news TV.",
      qqq: 777.3,
      spy: 784.0,
      nq: 31092,
      es: 7840,
      rsi: [49, 48],
      vix: 17.0,
      trend: ["BULLISH", "CHOPPY"],
      spike: [false, false],
      killzone: "lunch",
      entry: standCard(["Not NY AM (Lunch)"]),
      agenda: post("12:30"),
    },
    {
      at: "16:02",
      caption: "The close. Debrief at the board.",
      qqq: 778.4,
      spy: 785.1,
      nq: 31136,
      es: 7851,
      rsi: [56, 53],
      vix: 16.8,
      trend: ["BULLISH", "BULLISH"],
      spike: [false, false],
      killzone: "after",
      entry: standCard(["Not NY AM (After hours)"]),
      agenda: { next: null, last: null },
    },
    {
      at: "16:40",
      caption: "After hours. The floor winds down.",
      qqq: 778.2,
      spy: 785.0,
      nq: 31128,
      es: 7850,
      rsi: [55, 52],
      vix: 16.8,
      trend: ["BULLISH", "BULLISH"],
      spike: [false, false],
      killzone: "after",
      entry: standCard(["Not NY AM (After hours)"]),
      agenda: { next: null, last: null },
    },
  ];
}

export function drillNowMs(f: DrillFrame): number {
  return etWallToEpochMs(DRILL_DATE, f.at);
}

export function drillMarket(f: DrillFrame): Record<Underlier, UnderlierTape> {
  return {
    QQQ: { price: f.qqq, rsi: f.rsi[0], vix: f.vix, trend: f.trend[0], volume_spike: f.spike[0] },
    SPY: { price: f.spy, rsi: f.rsi[1], vix: f.vix, trend: f.trend[1], volume_spike: f.spike[1] },
  };
}

export function drillDeskRead(f: DrillFrame, book: RoomBook): RoomDeskRead {
  const futures = { QQQ: { symbol: "MNQ", price: f.nq }, SPY: { symbol: "ES", price: f.es } };
  const watch = exitWatchOf(book);
  const nowMs = drillNowMs(f);
  const next = f.agenda?.next ?? null;
  return {
    isWeekday: true,
    holiday: false,
    killzone: f.killzone ?? "ny_am",
    killzoneLabel:
      f.killzone === "lunch" ? "Lunch" : f.killzone === "premarket" ? "Pre-market" : f.killzone === "after" ? "After hours" : "NY AM",
    nextWindow: f.killzone === "premarket" ? "NY AM 09:30 ET" : f.killzone === "after" ? "London 02:00 ET" : "",
    judas: Boolean(f.judas),
    news: {
      blackout: Boolean(f.blackout),
      reason: f.blackout ?? "",
      next: next ? { name: next.name, timeEt: next.timeEt, minutesAway: next.minutes } : null,
    },
    shock: null,
    htf: { QQQ: f.trend[0] === "BEARISH" ? "bear" : "bull", SPY: f.trend[1] === "BEARISH" ? "bear" : f.trend[1] === "CHOPPY" ? "neutral" : "bull" },
    futures,
    feed: "drill",
    lagSec: null,
    spotSource: { SPY: `SPY ${f.spy.toFixed(2)} (drill)`, QQQ: `QQQ ${f.qqq.toFixed(2)} (drill)` },
    tenYear: 4.12,
    weekKind: null,
    weekTrade: null,
    entry: f.entry,
    // The live desk's exit rules, on the drill's futures prints. No 15m bars
    // are scripted, so the failed-hold close cannot fire in the drill.
    exits: computeExits(watch, futures, { QQQ: [], SPY: [] }, nowMs),
    held: computeHeld(watch, futures),
    agenda: { next: f.agenda?.next ?? null, last: f.agenda?.last ?? null, setup: f.agenda?.setup ?? null },
  };
}

export interface DrillStep {
  frame: DrillFrame;
  nowMs: number;
  input: RoomInput;
  cycle: RoomCycle;
  book: RoomBook;
  minds: MindState | null;
  desk: RoomDeskRead;
}

/** One frame through the real pipeline: mark → read → decide → people → fill. */
export function runDrillStep(book: RoomBook, minds: MindState | null, f: DrillFrame): DrillStep {
  const nowMs = drillNowMs(f);
  const market = drillMarket(f);
  const rolled = rollCounters(book, nowMs, f.killzone ?? "ny_am");
  const marked = markBook(rolled, market, nowMs);
  const input = toRoomInput(marked, market);
  const desk = drillDeskRead(f, marked);
  const cycle = runRoomCycle(input, { desk, ledger: ledgerOf(marked), minds }, nowMs);
  return { frame: f, nowMs, input, cycle, book: applyCycle(marked, cycle, nowMs), minds: cycle.minds, desk };
}

/** The whole day, from an empty $10,000 book and a fresh room. */
export function playDrill(startCash?: number): DrillStep[] {
  const frames = drillFrames();
  let book = emptyBook(startCash, drillNowMs(frames[0]!));
  let minds: MindState | null = null;
  const out: DrillStep[] = [];
  for (const f of frames) {
    const step = runDrillStep(book, minds, f);
    out.push(step);
    book = step.book;
    minds = step.minds;
  }
  return out;
}
