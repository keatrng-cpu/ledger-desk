/**
 * The live room's talk — types, constants and the small tools every part shares.
 *
 * WHY THIS EXISTS (2026-10-05, trader's call)
 * The Floor looped: it opened on a scripted drill whenever options were shut, quiet moments replayed a
 * three-variant bank of canned banter, an unchanged story was talked through again every 150 s, and a replay
 * slider moved time. "Everything needs to be live … looking at the real live market and news." So the room
 * has no script and no clock of its own. What the people say is a function of what the desk can see RIGHT NOW
 * — the tape, the levels, the headlines, the calendar, the book, the feed's honesty — and of what they have
 * already said (memory), never of a timer.
 *
 * THE BOUNDARY (CLAUDE.md: "Keep scoring deterministic. No LLM in the poll loop")
 * Nothing in this folder calls a model. Every number a line quotes is produced by code and registered with
 * `Facts` as it is printed; `scripts/verify-live-talk.mjs` checks that every number in every line was
 * registered. The words are fixed phrase banks in each person's voice; the choice of words is a deterministic
 * function of the event and the memory. Talk is narration: it never gates, sizes or sends anything.
 *
 * THE THRESHOLDS BELOW ARE PRESENTATION, NOT MEASUREMENT. "How big a move is worth a remark" is a taste
 * constant, not a finding; none of it reaches `config.ts`, a gate, a score or a ticket.
 */

import type { Animation, Beat, Character, DialogueLine, EntryTier, Zone } from "./orchestrator";
import type { OptionType, Underlier } from "./option-math";
import type { Sleeve } from "@/lib/invest/universe";

export type TalkKind = "tape" | "level" | "news" | "calendar" | "session" | "book" | "card" | "pulse" | "feed" | "heartbeat" | "goal" | "seat" | "rnd" | "invest" | "hall";

/** 0 = chatter (waits for a quiet room), 1 = worth interrupting the chatter, 2 = drop everything. */
export type Urgency = 0 | 1 | 2;

export const TALK = {
  /** A move worth a remark, as a fraction of the 15m ATR, per look-back window. Not a finding. */
  tapeWindows: [
    { sec: 60, atr: 0.22, pct: 0.1 },
    { sec: 180, atr: 0.38, pct: 0.18 },
    { sec: 600, atr: 0.65, pct: 0.3 },
  ],
  /** At or past this, it is violent: the room says so. */
  tapeBigAtr: 0.6,
  tapeCooldownMs: 150_000,
  /** The ring of prints kept per book, and how thin it may be before a window is "unknown". */
  ringKeepMs: 40 * 60_000,
  ringMinPrintGapMs: 1_000,
  /** A look-back window is only read if a print exists within this fraction of it of the exact moment. */
  windowSlack: 0.35,
  level: {
    approachAtr: 0.35,
    touchAtr: 0.08,
    throughAtr: 0.06,
    backInsideAtr: 0.04,
    acceptAtr: 0.15,
    acceptSec: 120,
    sweepLookbackSec: 240,
    cooldownMs: 20 * 60_000,
    approachPerBookMs: 5 * 60_000,
  },
  news: {
    /** On first load only headlines this young are announced; older ones are marked seen. */
    firstLoadAgeMin: 25,
    /** Fresh headlines older than this when they arrive are context, not breaking. */
    breakingAgeMin: 90,
    tier2GapMs: 4 * 60_000,
    tier1GapMs: 40_000,
  },
  /** Minutes before a release the room speaks. The director's own meeting owns T−35…T−15 and T+15…T+35. */
  calendarPre: [60, 5, 1],
  calendarPost: [0, 5],
  pulse: { vixPts: 0.8, tenYearPct: 0.03, gapMs: 30 * 60_000 },
  spacingMs: { 2: 4_000, 1: 12_000, 0: 0 } as Record<Urgency, number>,
  /** Chatter waits this long after the last thing anyone said (and after the scene is done with it). */
  quietGapMs: { min: 55_000, max: 105_000 },
  /** A topic whose data has not moved comes back after this; one whose data moved may after the shorter gap. */
  heartbeatTopicCooldownMs: 70 * 60_000,
  heartbeatChangedGapMs: 8 * 60_000,
  /** Two topics of one family (range on NQ, then range on ES) are not back to back. */
  heartbeatFamilyGapMs: 14 * 60_000,
  /** No more than this many exchanges in any 10 minutes, and no more than this many of them chatter. */
  budget: { windowMs: 10 * 60_000, max: 14, maxChatter: 6 },
  /** After the tab was hidden or the desk stalled this long, the first look back is silent. */
  resumeGapMs: 90_000,
  resumeSilenceMs: 6_000,
  /** An exchange that has not started this long after it was made is stale and is dropped. */
  ttlMs: { 0: 60_000, 1: 45_000, 2: 25_000 } as Record<Urgency, number>,
  recentKeep: 60,
  wireKeep: 90,
} as const;

/* ── The world: what the room can see ──────────────────────────────────── */

export interface TapeSample {
  t: number;
  px: number;
}

export interface LevelRef {
  name: string;
  price: number;
  kind: string;
  /** A liquidity pool a raid can take (PDH/PDL/PWH/PWL, equal highs/lows, the dealing range's edges) — not an open. */
  pool: boolean;
}

export interface TapeBook {
  u: Underlier;
  /** Two-sided ladder as text (bull + bear entries/stops/targets with odds, flip line). Display context only — never a gate. */
  ladder?: string[] | null;
  /** The futures symbol the desk reads for this ETF. */
  sym: string;
  /** What the room calls it. */
  say: "NQ" | "ES";
  px: number;
  prevClose: number | null;
  changePct: number | null;
  /** The exchange day's range so far, from the quote. */
  dayHigh: number | null;
  dayLow: number | null;
  /** 15m ATR in futures points. */
  atr: number | null;
  samples: TapeSample[];
  levels: LevelRef[];
  /** Futures points per ETF point (≈ 40 NQ→QQQ, ≈ 10 ES→SPY): the desk's crossover when it has one, the fixed fallback otherwise. */
  perEtfPt: number;
  htf: "bull" | "bear" | "none";
  smcWord: string | null;
  smcMissing: string | null;
  draw: { name: string; price: number } | null;
  rangeUsedPct: number | null;
  volRatio: number | null;
}

export interface FeedRead {
  kind: "live_gateway" | "yahoo" | "databento" | "synthetic" | "none";
  /** The newest print's age. */
  lagSec: number | null;
}

export interface NewsLite {
  id: string;
  title: string;
  source: string;
  publishedMs: number | null;
  tier: 1 | 2 | 3;
  why: string;
  /** The feed layer's fixed-rule "what it moves" line (`impactOf`), or null. */
  impact: string | null;
  tickers: string[];
  topics: string[];
  primary: boolean;
}

export interface CalEvent {
  name: string;
  date: string;
  timeEt: string;
  atMs: number;
  impact: "high" | "medium";
}

export interface CalRead {
  /** Today's and tomorrow's releases, oldest first, with their instants. */
  events: CalEvent[];
  /** What the desk stamped for a release that has printed (week-prints.json), keyed `${date}|${timeEt}|${name}`. */
  prints: Record<string, { actual?: string; vs?: string; note?: string }>;
}

export interface ClockRead {
  nowMs: number;
  etDate: string;
  /** Minutes after ET midnight. */
  etMin: number;
  weekday: number;
  isWeekday: boolean;
  holiday: boolean;
  /** Cash equity-option hours on a trading day. */
  optionsOpen: boolean;
  /** CME Globex: Sun 18:00 ET → Fri 17:00 ET, minus the 17:00–18:00 halt. */
  globexOpen: boolean;
  killzone: string;
  killzoneLabel: string;
  judas: boolean;
  blackout: boolean;
  blackoutReason: string | null;
}

export interface PositionRead {
  id: string;
  name: string;
  u: Underlier;
  type: OptionType;
  contracts: number;
  pnlPct: number;
  trimmed: boolean;
  openedAt: number;
  plan: { symbol: string; side: "long" | "short"; entry: number; stop: number; t1: number | null; t2: number | null } | null;
}

export interface BookRead {
  positions: PositionRead[];
  dayPnl: number;
  equity: number;
  closedToday: number;
  winsToday: number;
  consecLosses: number;
  monthEntries: number;
}

export interface CardRead {
  key: string;
  name: string;
  verdict: "ARMED" | "WATCH" | "STAND";
  u: Underlier;
  type: OptionType;
  band: string | null;
  tier: EntryTier | null;
  awayPts: number | null;
  futSymbol: string;
  futSide: "long" | "short";
  entry: number | null;
  stop: number | null;
  t1: number | null;
  pT1: number | null;
  expR: number | null;
  block: string | null;
  strategy: string | null;
  /** The confluences on the card, in the words those words actually mean. */
  setup: string | null;
  /** Scanner fit, 0–1. At 0.80 the floor reads the card out loud and arms. */
  fit?: number | null;
  /** Named sequence on the card: AMD, TJR, reversal, inverse, gap tap. */
  sequence?: string | null;
  /** What the floor says about that sequence. */
  entryLine?: string | null;
  /** The same read in the words the voice uses (no strip, no reminder). The screens keep `entryLine`. */
  entrySay?: string | null;
  /**
   * What ICT, TJR, Blake and Patty each make of this card, graded from facts the desk already carries (school-brief.ts).
   * `by` is keyed by the cast seat that presents the school: Gemma ICT, Jax TJR, Nova Blake, Sterling Patty. Narration, never a gate.
   */
  schools?: { line: string; by: Record<string, string> };
  /**
   * What the lower timeframes are doing against this card, or that the focus just moved to it (focus-pick.ts). Empty when the delivery needs no
   * comment. The Floor says it first: a short with no displacement down and the 1 to 3 minute delivering up is not something to keep trying to take.
   */
  delivery?: string | null;
  /** What the last graded 0.90-plus cards like this one did, from the high-alert ledger (hi-alert.ts). Null when there is no history. */
  recall?: string | null;
  /**
   * PB's tiered map and if-then (sponsored-gap.ts): where price stands against the 1 hour / 4 hour sponsored gap on this side and whether the
   * 1 to 5 minute inverse printed inside it. Null when there is no such gap. Narration only.
   */
  sponsored?: string | null;
  /**
   * The LESSON for the layer the grader named as missing (live-lesson.ts
   * `sayForMissing`), in one sentence. The mouth has to match the detector:
   * before this, a seat saying what was missing read a phrase bank, so it could
   * ask for a retest the detector no longer wants. Null when the layer has no
   * lesson. Narration only — nothing reads it as a gate.
   */
  lessonSay?: string | null;
}

export interface MindsRead {
  needs: Record<Character, { caffeine: number; fatigue: number; stress: number; loneliness: number; boredom: number }>;
  rank: Record<Character, number>;
  rel: Record<Character, Record<Character, { affinity: number; respect: number }>>;
  memories: { id: string; who: Character; against: Character | null; clock: string; kind: string; text: string; outcome: string | null; pnl: string | null; at: number }[];
}

export interface LabLite {
  refusals: { gate: string; n: number; pnlUsd: number; wins: number }[];
  twins: { n: number; deltaUsd: number };
  calibration: { n: number; meanP: number | null; hitRate: number | null; brier: number | null } | null;
  track: Record<Character, { n: number; brier: number | null; meanP?: number | null; hitRate?: number | null }>;
}

export interface WeekLite {
  today: { date: string; kind: string; trade: string; skipIf: string; pathNote: string; dailyBias: string; news: { timeEt: string; name: string; impact: string; note: string }[] } | null;
  next: { date: string; weekday: string; kind: string; trade: string; skipIf: string; dailyBias: string; news: { timeEt: string; name: string; impact: string; note: string }[] } | null;
  headline: string | null;
}

/** The goal's planner read, as the talk needs it — every number already computed by goal.ts. */
export interface GoalLite {
  start: number;
  startDate: string;
  target: number;
  floor: number;
  floorFrac: number;
  status: "before" | "running" | "hit" | "floor" | "expired";
  day: number;
  of: number;
  daysLeft: number;
  entriesOver: boolean;
  /** The leading seat's equity (the start before anyone has traded). */
  equity: number;
  leader: string | null;
  multipleNeeded: number;
  perSessionNeeded: number | null;
  pathToday: number | null;
  paceLabel: "ahead" | "on path" | "behind" | null;
  paceUsd: number | null;
  lambda: number;
  expectedTickets: number;
  /** How many tickets the desk's own rules allow in the window (the PATH monthly cap). */
  tradeBudget: number;
  /** Exact odds on the measured numbers for the best of the five approaches, and whose it is. */
  pTarget: number;
  pTargetBy: string;
  pFloor: number;
  pNoTrade: number;
  /** The chance that no qualifying card prints at all in the sessions left (Poisson at the measured rate). */
  pNoCard: number;
  expectedEnd: number;
  needed: { pStar: number; pWin: number | null; lambdaMultiple: number | null; winPct: number | null };
  winsNeed: number | null;
  measured: { pWin: number; winPct: number; lossPct: number; meanPct: number; n: number | null };
  collisions: { id: string; severity: "blocker" | "warn" | "info"; title: string; detail: string; decision: string | null; ask: boolean }[];
  ladder: {
    n: number;
    cheapestUsd: number | null;
    richestUsd: number | null;
    priced: boolean;
    /** The rung with the best odds of the goal on today's card, when there is a card. */
    best: { name: string; askUsd: number; delta: number; contracts: number; pTarget: number | null; evPerDollar: number | null } | null;
    /** The room's own cheaper strike, for comparison. */
    room: { name: string; askUsd: number; contracts: number } | null;
  };
  plan: { needTodayUsd: number | null; maxLossUsd: number; contracts: number; debitUsd: number; perAtrUsd: number | null; atrsNeeded: number | null };
  capFrac: number;
  roomCapFrac: number;
  minDelta: number;
  minAskUsd: number;
  /** One stopped ticket at the cap, as a share of the account. */
  stopShare: number | null;
  vix: number | null;
  /** Presentation (the race track): each of the five approaches' exact odds of the target, by owner. Optional for old frames. */
  approaches?: { owner: string; pTarget: number; contractsNow: number }[];
  /** Presentation (the race track): the geometric path, one mark per session (goal.ts `ladder`). */
  path?: { date: string; equity: number }[];
}

export interface SeatRowLite {
  id: string;
  name: string;
  owner: Character | null;
  equity: number;
  pnl: number;
  open: number;
  taken: { n: number; wins: number; usd: number };
  declined: { n: number; usd: number };
  status: "running" | "hit" | "floor";
}

export interface SeatEventLite {
  id: string;
  at: number;
  kind: "start" | "open" | "close" | "skip" | "blocked" | "finish" | "lead" | "syndicate" | "syndicate_closed";
  seat: string | null;
  usd: number | null;
  qty: number | null;
  debit: number | null;
  contract: string | null;
  gate: string | null;
  why: string | null;
  equity: number | null;
  members: string[] | null;
  planKey: string | null;
  /** A syndicate's size. */
  n: number | null;
}

export interface SeatsLite {
  rows: SeatRowLite[];
  leader: string | null;
  /** Newest first. */
  events: SeatEventLite[];
  sessions: number;
  touches: number;
  syndicates: { n: number; closed: number; usd: number };
}

export interface RndLite {
  experiments: { id: string; owner: Character; title: string; status: "collecting" | "supported" | "not_supported" | "undecided"; n: number; nNeeded: number; read: string; proposal: string | null }[];
}

/** One setup-scanner card as the war room's TV shows it. */
export interface ScanCardLite {
  key: string;
  name: string;
  /** The futures symbol the card is on, as the desk graded it (MNQ, MES, NQ, ES). */
  symbol: string;
  strategy: string | null;
  verdict: "ARMED" | "WATCH" | "STAND";
  band: string | null;
  u: Underlier;
  side: "long" | "short";
  tier: EntryTier | null;
  awayPts: number | null;
  pT1: number | null;
  expR: number | null;
  entry: number | null;
  stop: number | null;
  t1: number | null;
  /** Live Robinhood ask for this card's underlier and side. Null when the session has no quote. */
  ask: number | null;
  block: string | null;
  /** live enters. armed and forming are anticipation. gone does not chase. */
  entryState: "live" | "armed" | "forming" | "gone" | "wait";
  entryLine: string;
  sequence: string;
}

/* ── The investment office ─────────────────────────────────────────────────
 * The Invest tab's book and the dated research file, as the long-game crew reads them (invest-office.ts builds it — pure,
 * from the Invest tab's own functions). Narration and drawing only: nothing here is a verdict, a size or a sleeve target.
 */

export type InvestTier = "safe" | "mid" | "high";

export interface InvestSleeveRead {
  sleeve: Sleeve;
  weight: number;
  target: number;
  driftPct: number;
  correctionUsd: number;
}

export interface InvestThemeLite {
  id: string;
  name: string;
  tier: InvestTier;
  horizon: "mid" | "long";
  summary: string;
  demand: { claim: string; figure: string; asOf: string; sourceName: string }[];
  innovations: string[];
  competitors: { name: string; ticker: string | null; angle: string }[];
  risks: string[];
  vehicles: { ticker: string; kind: "fund" | "stock"; note: string }[];
  evidence: "strong" | "moderate" | "thin";
  /** The vehicles of this theme the book holds. */
  held: string[];
}

/** A report on the committed earnings calendar that touches the office: a name the book holds, a name on the Invest tab's long board, a theme's vehicle, or a competitor on the research list. */
export interface InvestCatalyst {
  /** The calendar's own date, YYYY-MM-DD. */
  date: string;
  when: "pre-market" | "after close" | "time not stated";
  ticker: string;
  name: string;
  why: "held" | "board" | "theme" | "competitor";
  /** The research theme it ties to, or null for a held name that is in no theme. */
  theme: string | null;
  /** The long-board sleeve of a name that is on the Invest tab's long board (a held name on the board carries it too), else null/absent. */
  sleeve?: string | null;
  /** The trader's pre-written rule that takes the name out (its dossier), or null when it has none. */
  killRule: string | null;
}

/** What a headline can touch: the book, a theme's vehicle, a name on the long board, a competitor on the research list. */
export type WatchKind = "held" | "theme" | "board" | "competitor";

/* ── The firm's standing reviews ───────────────────────────────────────────
 * What an investment firm looks at that is NOT a price: look-through and caps, the restricted list, the kill-rule record, the
 * ledger's health, tax lots, the funding waterfall, one company memo, the funnel and the long board, the policy's own evidence and the
 * data's age. invest-firm.ts builds it (pure, from the Invest tab's own functions); the book is valued at COST so nothing here
 * is a performance, an unrealised figure, a drawdown or a trend. Bounded and JSON-small on purpose. Narration and drawing only.
 */

export type FirmReviewId = "memo" | "macro" | "risk" | "compliance" | "ops" | "diligence" | "tax" | "funding" | "board" | "policy" | "fresh";

export interface FirmRisk {
  /** Nothing is held: the look-through is the default all-VTI landing pad, said as such. */
  preview: boolean;
  totalUsd: number;
  overlapQQQ: number;
  overlapWarn: number;
  overlapPartial: boolean;
  techWeight: number;
  sectorUnknown: number;
  feeUsdYear: number;
  feeBlended: number;
  /** Largest look-through lines (direct + inside funds), at most three. */
  names: { ticker: string; weight: number; direct: number; viaFunds: number }[];
  sectors: { sector: string; weight: number }[];
  directTechWeight: number;
  directTechWarn: boolean;
  nameCap: number;
  sleeveCap: number;
  /** Look-through names above the per-name cap (never the funds themselves). */
  namesOverCap: { ticker: string; weight: number }[];
  /** The long board's sleeves the book holds, with the sleeve cap applied. */
  sleeves: { sleeve: string; weight: number; over: boolean }[];
  /** Long-board names that are the same bet as the options sleeve. */
  computeNames: string[];
  /** The funnel's compute slice: its share of a swept dollar, and the Invest tab's own reason it is small. */
  computeShare: number;
  computeDemand: string;
  /** The reason sentence of that text (its second), the tab's own words for why the slice is small. */
  computeWhy: string;
}

export interface FirmCompliance {
  /** The static wash-sale list while the sleeve trades QQQ and SPY options. */
  banned: string[];
  traded: string[];
  twins: string[];
  /** Held tickers that should not be held (book.banned). */
  heldBanned: { ticker: string }[];
  /** Underliers the RH journal traded inside the look-back that the static list does not cover. */
  dynamic: { underlier: string; lastAt: string; throughDate: string }[];
  lookbackDays: number;
  /** Days either side of a sale that a replacement purchase defers the loss (ledger.ts WASH_WINDOW_DAYS). */
  washWindowDays: number;
  /** Fills in the RH journal, or null when it could not be read. */
  journalFills: number | null;
  watch: { ticker: string; source: "dossier" | "board"; reason: string; clearsWhen: string }[];
  dossiers: number;
  addable: number;
  blocked: number;
  /** Dossiers with a blank required field, with the fields. */
  incomplete: { ticker: string; missing: string[] }[];
}

export interface FirmDiligence {
  /** Kill rules that exist (dossiers with a written rule). */
  rules: number;
  intervalDays: number;
  /** Days until the next check is due (0 when due now), or null when no check is on record. */
  dueInDays: number | null;
  /** The kill-rule store could be read (false on a server, or when storage is blocked). */
  readable: boolean;
  lastRanAt: string | null;
  daysSince: number | null;
  due: boolean;
  results: number;
  sourced: number;
  /** Results in the last run with no judgement by a person dated on/after the run. */
  unjudged: number;
  /** Rules a PERSON judged tripped (their latest judgement), newest first. */
  tripped: { ticker: string; judgedAt: string }[];
  judgedCount: number;
}

/** What the ledger replay could not apply, by kind (ledger.ts words each problem; invest-firm.ts sorts them into these). */
export type LedgerProblemKind = "duplicate" | "void-missing" | "void-void" | "sale-short" | "month-twice" | "other";

export interface FirmOps {
  entries: number;
  problemCount: number;
  problems: { kind: LedgerProblemKind; n: number }[];
  voidCount: number;
  voids: { date: string; kind: string; ticker: string | null; reason: string }[];
  missedCount: number;
  missed: string[];
  /** Sweep-funded buys above the sweep (the deploy queue's over-spend line), else 0. */
  overSpendUsd: number;
  waitingUsd: number;
  /** The RH journal's size against its cap, or null when it could not be read. */
  journal: { fills: number; cap: number; atCap: boolean } | null;
}

export interface FirmTaxYear {
  year: number;
  stGainUsd: number;
  ltGainUsd: number;
  washDeferredEstUsd: number;
  dividendsUsd: number;
  sales: number;
}

export interface FirmTax {
  thisYear: FirmTaxYear;
  lastYear: FirmTaxYear | null;
  openLots: number;
  positions: { ticker: string; lots: number; shares: number; longTermShares: number; nextLongTerm: string | null }[];
  /** The earliest date an open short-term lot turns long-term, and whose it is. */
  nextTurn: { ticker: string; date: string } | null;
  /** A lot came from the pre-lot store and its date is approximate. */
  approx: boolean;
  washFlagged: number;
}

export interface FirmFunding {
  months: number;
  ratePct: number;
  rentUsd: number;
  sleeveTargetUsd: number;
  /** The share of gross at which the tab says the data bill is the story (policy.ts RENT_DRAG_ALARM). */
  rentAlarmAt: number;
  last: {
    month: string;
    verdict: string;
    realizedUsd: number;
    rentUsd: number;
    restoreUsd: number;
    sweptUsd: number;
    ratePct: number;
    rentDrag: number | null;
    rentAlarm: boolean;
    annualRentUsd: number;
    annualSweepUsd: number;
  } | null;
  /** The RH journal's closed P&L for the month before this one, or null when the journal could not be read. */
  journal: { month: string; realizedUsd: number; closed: number; open: number; openDebitUsd: number; capNote: string | null } | null;
  /** What a month must realize for a sweep of this size at the earned rate (policy.realizedNeededFor). */
  needs: { sweepUsd: number; realizedUsd: number }[];
}

export interface FirmMemo {
  ticker: string;
  name: string;
  held: boolean;
  /** The Invest tab's long-board sleeve, or null. */
  sleeve: string | null;
  dossier: boolean;
  sells: string | null;
  moat: string | null;
  useIn2035: string | null;
  killRule: string | null;
  boardKill: string | null;
  boardEvidence: string | null;
  competitor: string | null;
  boardRole: string | null;
  regulatory: string | null;
  caveat: string | null;
  operator: { ceo: string; level: "verified" | "asserted" | "blank" } | null;
  gate: { canAdd: boolean; reason: string } | null;
  watch: { reason: string; clearsWhen: string } | null;
  fundamentalsAsOf: string | null;
  durabilityAsOf: string;
  required: number | null;
  delivered: number | null;
  deliveredBasis: string | null;
  read: "asks-less" | "about-record" | "asks-more" | "unknown";
  earningsYield: number | null;
  earningsYieldBasis: "forward" | "trailing" | null;
  riskFreePct: number;
  riskFreeAsOf: string;
  spreadPts: number | null;
  maxWeight: number | null;
  /** The look-through weight in the book at cost, or null when nothing is held. */
  weight: number | null;
  catalyst: { date: string; when: "pre-market" | "after close" | "time not stated" } | null;
}

export interface FirmBoard {
  waitingUsd: number;
  /** The eight sleeves of the funnel, in the policy's order, with the next name in each. */
  split: { sleeve: string; weight: number; usd: number; ticker: string | null; state: "pass" | "wait" | "fail" | "none"; line: string }[];
  counts: { pass: number; wait: number; fail: number; total: number };
  /** Why names wait, most common first (first sentence of the board's own reason). */
  reasons: { reason: string; n: number }[];
  leftOff: { area: string; why: string }[];
  ipo: {
    capturedAt: string;
    upcoming: number;
    nextUpcoming: { company: string; ticker: string | null; expected: string | null; status: string } | null;
    priced: { company: string; ticker: string; stage: string; eligibleFrom: string | null; lockupEnds: string | null; onBoard: boolean }[];
    lockupDays: number;
    trackRecordDays: number;
  };
}

export interface FirmPolicy {
  horizons: { horizon: string; window: string; usable: boolean; say: string }[];
  baseRates: { id: string; say: string; soWhat: string }[];
  traps: { ticker: string; lesson: string }[];
}

export interface FirmFresh {
  maxDays: number;
  items: { id: string; label: string; asOf: string; ageDays: number }[];
  stalest: { id: string; label: string; asOf: string; ageDays: number } | null;
  stale: boolean;
}

export interface FirmMacro {
  riskFreePct: number;
  riskFreeAsOf: string;
}

export interface InvestFirm {
  /** The ET date the reads were taken for. */
  asOf: string;
  risk: FirmRisk;
  compliance: FirmCompliance;
  diligence: FirmDiligence;
  /** Null when the ledger could not be read (a world built without one). */
  ops: FirmOps | null;
  tax: FirmTax | null;
  funding: FirmFunding | null;
  memo: FirmMemo | null;
  board: FirmBoard;
  policy: FirmPolicy;
  fresh: FirmFresh;
  macro: FirmMacro;
}

export interface InvestLite {
  book: {
    totalUsd: number;
    positions: number;
    belowMeaningful: boolean;
    /** The Floor never fetches prices, so the book is valued at cost and says so. */
    valuedAtCost: true;
    sleeves: InvestSleeveRead[];
    beyondBand: number;
    rebalanceDue: boolean;
    driftBand: number;
  };
  funnel: {
    ratePct: number;
    closedMonths: number;
    sweptUsd: number;
    waitingUsd: number;
    avgMonthlyUsd: number | null;
    fiveYearUsd: number | null;
    tenYearUsd: number | null;
    ladderLine: string;
  };
  next: { ticker: string | null; sleeve: Sleeve; usd: number; line: string } | null;
  /** Income that is not day-trading P&L, and the share the trader chose to send to the long book. Arithmetic only. */
  other: { monthlyUsd: number; ratePct: number } | null;
  themes: InvestThemeLite[];
  themesAsOf: string;
  /** Reports in the next fourteen days that touch the office, earliest first; the calendar is a committed snapshot, captured on `catalystsAsOf`. */
  catalysts: InvestCatalyst[];
  catalystsAsOf: string;
  /** What a headline has to mention to matter to the office: the book's tickers, a theme's vehicles, a competitor. */
  watch: Record<string, { label: string; kind: WatchKind }>;
  /** The firm's standing reviews (invest-firm.ts), or null/absent in a world built without them. */
  firm?: InvestFirm | null;
  dayKey: string;
}

/**
 * A few prediction rows the floor has actually read. Paper only. Empty when the feed has not come back.
 * `event` is a READABLE label ("NFL game, October 5"), never a Kalshi ticker. `grade` is the signal engine's letter, or null when the
 * engine has none (no model input: "no edge read") — null is "no grade", never a placeholder letter.
 */
export interface PredictLite {
  asOf: string;
  source: string;
  reason: string | null;
  rows: { event: string; outcome: string; yesCents: number | null; grade: string | null }[];
}

/* ── The Mead Hall: the prediction board the hall is showing ───────────── */

/** A time to settle, already in the unit a person would say it in. */
export interface HallSpan {
  n: number;
  unit: "minute" | "minutes" | "hour" | "hours" | "day" | "days";
}

/** One market on the hall's screens: the jumbotron (slot 0) or one of the Rune Board's five (slots 1–5). Every number is the engine's own field, rounded for speech. */
export interface HallRowLite {
  /** The Kalshi ticker. Never spoken; the verifier joins rows to the engine's signals by it. */
  id: string;
  /** 0 = jumbotron, 1–5 = the Rune Board, in the hall's order. */
  slot: number;
  /** The family tag the hall's screens use (NFL, NBA, ECON, WEATHER, CRYPTO, POLITICS, MARKET…) and its spoken name ("NFL game"). */
  fam: string;
  famSay: string;
  /** "on October 5", "in October 2026", "for the third quarter of 2026" — read from the event ticker's date part, or null. */
  when: string | null;
  /** The contract's outcome, made speakable (° → degrees, ≥ → at least). */
  outcome: string;
  nfl: boolean;
  yesAskC: number | null;
  yesBidC: number | null;
  noAskC: number | null;
  /** The book's mid, in cents (one decimal). */
  midC: number | null;
  /** What YES must win to pay after the taker fee and a cent of slippage, in percent (one decimal), and the same for NO. */
  needsYesPct: number | null;
  needsNoPct: number | null;
  /** needsYesPct minus midC, in points: what crossing the spread and paying the fee costs before the contract is right at all. */
  costPts: number | null;
  /** The taker fee at the YES ask, cents per contract (two decimals). */
  feeYesC: number | null;
  spreadC: number | null;
  liq: "deep" | "ok" | "thin" | "none";
  liqScore: number;
  askSize: number | null;
  /** Move since the open reference, cents (one decimal, signed), and where the reference came from. */
  moveC: number | null;
  moveBasis: "candles_open" | "previous_day" | "none";
  /** Velocity in cents per hour (one decimal, signed) over `velHours` hours, from `velPoints` real hourly trade points — only when the engine has real trades. */
  velCph: number | null;
  velHours: number | null;
  velPoints: number;
  /** Time to settle, and the engine's phase word. */
  settle: HallSpan | null;
  phase: "open" | "closing_soon" | "closed" | "unknown";
  /** The engine's freshness at the moment it read the book, and its stale flag. */
  fresh: "live" | "recent" | "stale";
  stale: boolean;
  staleReason: string | null;
  basis: "book" | "last_trade" | "none";
  /** The engine's own word: "edge" when a real model input exists, else the literal "no edge read". */
  edgeStatus: "edge" | "no edge read";
  /** The edge, only when a real model input exists. */
  edge: null | { side: "yes" | "no"; netC: number; modelPct: number; needPct: number | null; modelSrc: string };
  /** Why there is no edge read (the engine's reason, made speakable), or null when there is one. */
  noEdgeWhy: string | null;
  /** The engine's letter, or null for "no grade". Never a placeholder. */
  grade: "A" | "B" | "C" | "D" | "F" | null;
  /** The setup score (0–100), shown with or without a letter. */
  score: number;
  /** The side the engine's grade is for (yes unless a real edge favours no) and that side's ask, in cents. */
  gradedSide: "yes" | "no";
  gradedAskC: number | null;
  /** The price band of the side the engine graded. */
  bin: null | { id: string; loC: number; hiC: number; points: number; cap: "C" | "D" | null };
  /** The engine's own cap and down-grade reasons, made speakable and shortened. */
  why: string[];
  /** The sports scanner's eight must-layers for this contract, when the scanner has it. `clears` = every layer passes. */
  scan: null | { passed: number; total: number; clears: boolean; miss: string | null; limitC: number | null; askC: number | null; gapC: number | null; ref: string | null; live: boolean };
  /** The four conditions the lectern states, for this row. */
  conds: { model: boolean; edge: boolean; fresh: boolean; depth: boolean };
  /** How many of the four hold. */
  condsMet: number;
}

/** What the paper side of the hall has on record, read in the browser. Null fields are "nothing on record". */
export interface HallRecordLite {
  /** The scanner's go ledger. */
  goN: number;
  goSettled: number;
  goWins: number;
  /** Dollars per contract held to settlement, summed over settled prints. */
  goNet: number;
  /** The Predict tab's journal of the trader's own fills. */
  jOpen: number;
  jClosed: number;
  jNet: number;
  /** The analyzer's paper book. */
  paperTickets: number;
  paperOpen: number;
  paperSettled: number;
  /** "ok" once the scorer has the samples to read; otherwise "too few to read". */
  paperRead: "ok" | "too few to read";
  paperHitPct: number | null;
  /** Settled count under which every record here is noise (the engine's own rule). */
  minSettled: number;
}

export interface HallLite {
  /** When the board was read (ISO), how old that is now, and where it came from. */
  asOf: string;
  ageSec: number;
  source: string;
  /** The board's full source label as the engine prints it. */
  label: string;
  /** The engine's rule: a quote older than this is stale. A read older than `talkMaxSec` is not talked from at all. */
  staleSec: number;
  talkMaxSec: number;
  /** Older than the engine's staleness rule (or the engine itself said stale). */
  stale: boolean;
  /** Older than `talkMaxSec`. */
  old: boolean;
  /** A failed pull kept the last board. */
  held: boolean;
  /** The pull ran out of time, and the markets it skipped. */
  partial: boolean;
  skipped: number;
  reason: string | null;
  total: number;
  counts: { A: number; B: number; C: number; D: number; F: number };
  ungraded: number;
  /** Markets with no edge read, and markets with a real model input behind them. */
  noEdge: number;
  modeled: number;
  crowd: { mood: "surging" | "sliding" | "restless" | "quiet"; energyPct: number | null; basedOn: number; reaction: "cheer" | "groan" | "hail" | null; reason: string };
  /** Kalshi's fee schedule as the engine prices it: rates in percent, and the per-contract fee at fifty cents and at ten. */
  fee: { takerPct: number; makerPct: number; peakPriceC: number; peakC: number; lowPriceC: number; lowC: number; slipC: number };
  /** The evidence the price bands rest on. */
  flb: { authors: string; year: number; takerLossPct: number; makerLossPct: number };
  /** The numbers behind the lectern's conditions, all read from the code that enforces them. */
  rules: { modelMaxMin: number; staleSec: number; minDepth: number; maxSpreadC: number; velWindowH: number; minSettled: number };
  rows: HallRowLite[];
  /** The scanner's rows came with this read (count), and how old they are. */
  scanned: number;
  scanAgeSec: number | null;
  record: HallRecordLite | null;
}

/** A catalyst list built from an earnings calendar captured more than this many days ago is not spoken from, and the audit says so. */
export const CATALYST_MAX_AGE_DAYS = 21;

/**
 * How old the committed data the office speaks from is (data-fresh.ts binds the files). A snapshot says when it was taken; this is
 * the one place the desk compares that date with today, so the audit and the talk read the same ages.
 */
export interface DataFreshness {
  /** ET date the ages are measured to. */
  today: string;
  /** When the committed earnings calendar was captured. */
  earningsAsOf: string;
  /** The dated research file's own as-of. */
  researchAsOf: string;
  /** The last date on the committed macro calendar (the blackout windows come from it), or null when it is empty. */
  macroCalendarEnds: string | null;
  /** The last full `check-research-sources.mjs --write` run, or null when none is on record. */
  sourceCheck: { checkedAt: string; facts: number; findings: number; researchAsOf: string | null } | null;
  /** The Invest tab's committed snapshots (fundamentals, durability, fund profiles, IPO watch) with their own dates. Absent in worlds built without them, which raises nothing. */
  invest?: { id: string; label: string; asOf: string }[];
  /** How old (in days) an Invest snapshot may be before the long board turns a name to wait — the board's own line, carried so the audit holds no number of its own. */
  investMaxDays?: number;
}

export interface TalkWorld {
  nowMs: number;
  clock: ClockRead;
  feed: FeedRead;
  books: Record<Underlier, TapeBook | null>;
  pulse: { vix: number | null; tenYear: number | null; at: number | null };
  news: NewsLite[];
  cal: CalRead;
  book: BookRead;
  card: CardRead | null;
  beat: Beat | null;
  minds: MindsRead | null;
  lab: LabLite | null;
  week: WeekLite | null;
  /** The goal, the race and the R&D board (goal.ts, seats.ts, rnd.ts) — null before the engine has computed them. */
  goal: GoalLite | null;
  seats: SeatsLite | null;
  rnd: RndLite | null;
  /** The investment office's read of the Invest tab and the research file — null until the engine has computed it. */
  invest: InvestLite | null;
  /** Prediction rows the floor has read. Null until a closed-hours poll returns. Paper only. */
  predict: PredictLite | null;
  /** The prediction board the Mead Hall shows (signal engine + sports scanner + the paper records). Absent in worlds built without it; null until a read returns. */
  hall?: HallLite | null;
  /** How old the committed data is (the audit reads it). Absent in worlds built without it, which raises nothing. */
  fresh?: DataFreshness | null;
  /** The measured headline lines (evidence.ts) — real findings the night shift can quote. */
  evidence: string[];
  /** The scene will be busy with what it already has until this ms. */
  busyUntil: number;
}

/* ── What a tick produces ──────────────────────────────────────────────── */

export interface TalkMove {
  /**
   * The cycle contract's zones, or "ANNEX": presentation-only, an office of the annex (the spot says which); or "HALL": the Mead Hall wing
   * (mead-hall-layout.ts), presentation-only, where the spot is one of HALL_SPOTS and any of the five may stand.
   */
  zone?: Zone | "ANNEX" | "HALL";
  /** A spot id from floor-layout.json: a lounge spot (tv_watch_0, window_0, bar_1, coffee, …), an annex office (office_rnd, office_ops, office_goal) or a hall spot (mead_jumbo_0, mead_lectern, …). */
  spot?: string;
}

export interface TalkItem {
  id: string;
  at: number;
  kind: TalkKind;
  /** The anti-repeat key. */
  topic: string;
  /** Why this was said, in one line, for the wire log. */
  label: string;
  urgency: Urgency;
  lines: DialogueLine[];
  moves: Partial<Record<Character, TalkMove>>;
  /** Every number the lines quote, exactly as printed. */
  facts: string[];
  /** How long the scene takes to play it. */
  estMs: number;
  ttlMs: number;
}

/**
 * Heartbeat topics that restate facts the brain and the boards already hold: the PATH counters, the goal and the balance,
 * the contract price list. They speak the first time and again only when their data MOVES, never because 70 minutes passed
 * (that was the same script on every visit). `loadTalk` also carries their memory across the 16-hour state expiry, so a new
 * day does not start by reciting them.
 */
export const STABLE_HEARTBEATS: readonly string[] = ["rules", "goalnight", "ladder"];

export interface TalkState {
  v: 1;
  seq: number;
  dayKey: string;
  primed: boolean;
  lastTickMs: number;
  lastEmitAt: number;
  /** When the scene should be done with the last exchange. */
  lastEndAt: number;
  silentUntil: number;
  emits: { at: number; kind: TalkKind; chatter: boolean }[];
  topicAt: Record<string, number>;
  /** The data signature a heartbeat topic last spoke on — a topic repeats early only if its data moved. */
  topicSig: Record<string, string>;
  /** Remembered calls already brought up — a call is quoted once, not every half hour. */
  memSaid: string[];
  recent: string[];
  variant: Record<string, number>;
  spoke: Record<string, number[]>;
  newsSeen: string[];
  newsPrimed: boolean;
  /** Older tier-1 headlines found on the first look, waiting to be summarised once, and when they stop being worth it. */
  newsCatch: string[];
  newsCatchAt: number;
  newsAt: { 1: number; 2: number };
  calFired: Record<string, true>;
  sessFired: Record<string, true>;
  killzone: string | null;
  feedKind: string | null;
  /** A feed change must hold for a few seconds before the room remarks on it. */
  feedPend: { kind: string; since: number } | null;
  feedNoteAt: number;
  /** The baseline a pulse move is measured from, and when it was taken. */
  pulse: { vix: number | null; tenYear: number | null; baseAt: number };
  /** The last pool each book raided, so the next move can say what it came off. */
  raid: Record<string, { name: string; at: number }>;
  tier: Record<string, string>;
  pnlStep: Record<string, number>;
  nearFired: Record<string, number>;
  ghostN: number;
  levelAt: Record<string, number>;
  bookApproachAt: Record<string, number>;
  tapeAt: Record<string, number>;
  /** The size (futures points) of the last remark per book and direction — a move that doubles is worth a second one. */
  tapeSize: Record<string, number>;
  /** The seats' events already announced, and whether the first look has marked the backlog as seen. */
  seatSeen: string[];
  seatPrimed: boolean;
  /** What the goal talk last spoke on, so it speaks again when the data moves and not before: key → signature. */
  goalSig: Record<string, string>;
  /** Each experiment's status the last time its verdict was announced. */
  rndSeen: Record<string, string>;
  rndPrimed: boolean;
  /** Graded calls already turned into a lesson, plus the day's shelf review. */
  lessonSeen?: string[];
  suppressed: number;
}

export function freshTalkState(): TalkState {
  return {
    v: 1,
    seq: 0,
    dayKey: "",
    primed: false,
    lastTickMs: 0,
    lastEmitAt: 0,
    lastEndAt: 0,
    silentUntil: 0,
    emits: [],
    topicAt: {},
    topicSig: {},
    memSaid: [],
    recent: [],
    variant: {},
    spoke: {},
    newsSeen: [],
    newsPrimed: false,
    newsCatch: [],
    newsCatchAt: 0,
    newsAt: { 1: 0, 2: 0 },
    calFired: {},
    sessFired: {},
    killzone: null,
    feedKind: null,
    feedPend: null,
    feedNoteAt: 0,
    pulse: { vix: null, tenYear: null, baseAt: 0 },
    raid: {},
    tier: {},
    pnlStep: {},
    nearFired: {},
    ghostN: 0,
    levelAt: {},
    bookApproachAt: {},
    tapeAt: {},
    tapeSize: {},
    seatSeen: [],
    seatPrimed: false,
    goalSig: {},
    rndSeen: {},
    rndPrimed: false,
    lessonSeen: [],
    suppressed: 0,
  };
}

/* ── Tools ─────────────────────────────────────────────────────────────── */

/** FNV-1a. A stable seed from any string — the same event always picks the same words. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Lowercased, punctuation-free: two lines that differ only in case or a comma are the same line. */
export function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Every number a line prints goes through here, so the line's numbers are a SET code produced. The verifier
 * extracts the numbers from the finished text and requires each one to be in `list`.
 */
export class Facts {
  readonly list: string[] = [];

  private add(s: string): string {
    const digits = s.match(/\d[\d,]*\.?\d*/g);
    if (digits)
      for (const raw of digits) {
        const d = raw.replace(/[.,]+$/, "");
        if (d && !this.list.includes(d)) this.list.push(d);
      }
    return s;
  }

  /** A plain word or phrase that may itself carry numbers (a headline, a level name, a feed's own line). */
  raw(s: string): string {
    return this.add(s);
  }
  int(n: number): string {
    return this.add(String(Math.round(n)));
  }
  /** Futures points: whole above 10, one decimal below. Always positive — the sentence carries the direction. */
  pts(n: number): string {
    const v = Math.abs(n);
    return this.add(v >= 10 ? v.toFixed(0) : v.toFixed(1));
  }
  /** A price with thousands separators and two decimals. */
  px(n: number): string {
    return this.add(Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }
  /** A level or a plan price: no decimals once it is in the thousands. */
  lvl(n: number): string {
    return this.add(Math.abs(n) >= 1000 ? Math.round(n).toLocaleString("en-US") : n.toFixed(2));
  }
  pct(n: number, dp = 0): string {
    return this.add(`${Math.abs(n).toFixed(dp)}%`);
  }
  /** A fraction as a percent (0.29 → "29%"). */
  frac(n: number): string {
    return this.add(`${Math.round(n * 100)}%`);
  }
  x(n: number): string {
    return this.add(`${Math.abs(n).toFixed(Math.abs(n) >= 10 ? 0 : 1)}×`);
  }
  usd(n: number, dp = 0): string {
    return this.add(`$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
  }
  r(n: number): string {
    return this.add(`${Math.abs(n).toFixed(2)}R`);
  }
  /** "3 min", "1 min", "47 s". */
  span(sec: number): string {
    if (sec < 90) return this.add(`${Math.round(sec)} s`);
    const m = Math.round(sec / 60);
    return this.add(`${m} min`);
  }
  mins(n: number): string {
    return this.add(`${Math.round(n)} min`);
  }
  /** 09:41 ET from an instant. */
  clock(ms: number, tz = "America/New_York"): string {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
    return this.add(p);
  }
  /** Minutes after midnight as 09:30. */
  hhmm(min: number): string {
    return this.add(`${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);
  }
}

/** An ATM option's delta, for "what is that move worth a contract". A modelling convenience, said as such. */
export const ATM_DELTA = 0.5;

export type Line = DialogueLine;

/** Which animations each person has (the trader's schema), for building lines that are always legal. */
export const ANIM: Record<Character, Record<string, Animation>> = {
  Gemma: { wall: "GESTICURING_AT_WALL", pace: "PACING", explain: "EXPLAINING" },
  Jax: { shout: "SHOUTING", point: "POINTING", type: "FURIOUS_TYPING" },
  Nova: { write: "WRITING_ON_WHITEBOARD", nod: "NODDING", analyze: "ANALYZING" },
  Sterling: { arms: "CROSSING_ARMS", tablet: "CHECKING_TABLET", approve: "APPROVING" },
  Vince: { enter: "SMASHING_ENTER_KEY", thumbs: "THUMBS_UP", watch: "STEADY_MONITORING" },
};

/** How long the scene takes over a line (floor-scene.ts tick: clamp(1.6 + words × 0.3, 2.8, 8) seconds). */
export function lineMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.min(8, Math.max(2.8, 1.6 + words * 0.3)) * 1000;
}

export function playMs(lines: Line[]): number {
  return lines.reduce((s, l) => s + lineMs(l.text), 0);
}
