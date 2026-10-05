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

export type TalkKind = "tape" | "level" | "news" | "calendar" | "session" | "book" | "card" | "pulse" | "feed" | "heartbeat" | "goal" | "seat" | "rnd";

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
}

export interface MindsRead {
  needs: Record<Character, { caffeine: number; fatigue: number; stress: number; loneliness: number; boredom: number }>;
  rank: Record<Character, number>;
  rel: Record<Character, Record<Character, { affinity: number; respect: number }>>;
  memories: { who: Character; against: Character | null; clock: string; kind: string; text: string; outcome: string | null }[];
}

export interface LabLite {
  refusals: { gate: string; n: number; pnlUsd: number; wins: number }[];
  twins: { n: number; deltaUsd: number };
  calibration: { n: number; meanP: number | null; hitRate: number | null; brier: number | null } | null;
  track: Record<Character, { n: number; brier: number | null }>;
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
  block: string | null;
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
  /** The measured headline lines (evidence.ts) — real findings the night shift can quote. */
  evidence: string[];
  /** The scene will be busy with what it already has until this ms. */
  busyUntil: number;
}

/* ── What a tick produces ──────────────────────────────────────────────── */

export interface TalkMove {
  /** The cycle contract's zones, or "ANNEX": presentation-only, an office of the annex (the spot says which). */
  zone?: Zone | "ANNEX";
  /** A spot id from floor-layout.json: a lounge spot (tv_watch_0, window_0, bar_1, coffee, …) or an annex office (office_rnd, office_ops, office_goal). */
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
