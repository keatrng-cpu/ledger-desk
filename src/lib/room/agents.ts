/**
 * THE PEOPLE — how the five behave when the desk is not forcing their hand.
 *
 * Two game-AI ideas, both deterministic and both kept out of the trade:
 *
 *  1. AMBIENT LIFE (the GTA idea). Each person has NEEDS that build with the
 *     clock (caffeine, fatigue, stress, loneliness, boredom), a SCHEDULE (the
 *     09:20 brief, the session, lunch, the close, the Sunday restamp) and
 *     TRAITS from the trading school they come from. When nothing on the desk
 *     demands them, each picks the activity with the best utility — coffee,
 *     the couch, the news TV, a chat — and commits to it for a while instead
 *     of twitching between choices every cycle.
 *
 *  2. MEMORY (the Shadow of War / Nemesis idea). The room remembers what its
 *     people said and scores it against what the tape did next: Jax's chase
 *     calls are checked on the ETF print 30 minutes later, and every ticket
 *     Sterling refuses is priced on the same model 30 minutes later — saved
 *     or cost. Those scores move RANK (credibility) and the RELATIONSHIPS
 *     between them (respect, grudges), and the meeting lines quote them back.
 *     The scoring rule is the room's own bookkeeping (±0.10% on the ETF print,
 *     the model option bid), labelled as such — not a desk statistic.
 *
 * WHAT THIS LAYER MAY NOT DO: change a ticket. The broker action is decided
 * before anyone's mood is read. The people layer chooses where they stand,
 * what they do with their hands and what they bring up — never what is
 * bought or sold. Execution-phase placement (Vince and Sterling at their
 * desks) and the HIGH_ALERT gathering are hard rules it cannot override.
 */

import type {
  Beat,
  Character,
  EntryPlan,
  GemmaZone,
  JaxZone,
  NovaZone,
  RoomEntryRead,
  SterlingZone,
  Urgency,
  UnderlierTape,
  VinceZone,
} from "./orchestrator";
import { ivFor, quoteOption, type OptionType, type Underlier } from "./option-math";
import { absorbAtlas, improveAtlas, offerToBrains, saveAtlas, syncPeople, type DeskAtlas, type PeopleBrains } from "./desk-atlas";

export const CREW: readonly Character[] = ["Gemma", "Jax", "Nova", "Sterling", "Vince"];

/* ── Traits: the school each person trades ─────────────────────────────── */

export interface Traits {
  /** smc-canon.ts SchoolId — the personality's source. */
  school: "ict" | "tjr" | "blake" | "patty" | "smc";
  schoolName: string;
  /** One line from the school's canon, the thing they would say about themselves. */
  creed: string;
  aggression: number;
  caution: number;
  sociability: number;
  diligence: number;
  /** Caffeine need gained per minute awake. */
  caffeineRate: number;
  /** May this person leave the desk for the lounge at all? (Risk and execution never do.) */
  roams: boolean;
  /** Ambient activities this person gravitates to, best first. */
  likes: Activity[];
}

export const TRAITS: Record<Character, Traits> = {
  Gemma: {
    school: "ict",
    schoolName: "ICT",
    creed: "Time first: Power of 3, the Judas swing, the killzone. Price comes to the time.",
    aggression: 0.35,
    caution: 0.6,
    sociability: 0.75,
    diligence: 0.7,
    caffeineRate: 0.008,
    roams: true,
    likes: ["tv", "coffee", "chat", "window"],
  },
  Jax: {
    school: "tjr",
    schoolName: "TJR",
    creed: "Sweep first, 5m context, 1m trigger. The TJR-school read is never chase — Jax hears it every day.",
    aggression: 0.95,
    caution: 0.15,
    sociability: 0.8,
    diligence: 0.55,
    caffeineRate: 0.012,
    roams: true,
    likes: ["coffee", "tv", "chat", "couch"],
  },
  Nova: {
    school: "blake",
    schoolName: "Blake Mech",
    creed: "Mechanical: sweep, inversion, 1:1. At 1:1 the model needs ~70% to be positive — so prove it.",
    aggression: 0.3,
    caution: 0.7,
    sociability: 0.45,
    diligence: 0.9,
    caffeineRate: 0.006,
    roams: true,
    likes: ["cooler", "window", "chat", "couch"],
  },
  Sterling: {
    school: "patty",
    schoolName: "Patty / PB",
    creed: "Conditions, not predictions. Objectives already met → no more trades.",
    aggression: 0.1,
    caution: 0.98,
    sociability: 0.3,
    diligence: 0.95,
    caffeineRate: 0.005,
    roams: false,
    likes: ["desk_drink", "desk_lean"],
  },
  Vince: {
    school: "smc",
    schoolName: "SMC",
    creed: "POI after the sweep, the shift, then the retest. The order rests at CE; it never chases.",
    aggression: 0.45,
    caution: 0.65,
    sociability: 0.5,
    diligence: 0.85,
    caffeineRate: 0.009,
    roams: false,
    likes: ["desk_drink", "desk_phone", "desk_stretch"],
  },
};

/* ── Activities, needs, memory ─────────────────────────────────────────── */

export type Activity =
  | "desk"
  | "desk_drink"
  | "desk_lean"
  | "desk_phone"
  | "desk_stretch"
  | "meeting"
  | "coffee"
  | "cooler"
  | "couch"
  | "tv"
  | "window"
  | "chat"
  | "phone";

/** Lounge activities and the spot (floor-layout.json `spots`) each one uses. */
export const ACTIVITY_SPOTS: Partial<Record<Activity, string[]>> = {
  coffee: ["coffee"],
  cooler: ["cooler"],
  couch: ["couch_0", "couch_1"],
  tv: ["tv_watch_0", "tv_watch_1"],
  window: ["window_0", "window_1"],
  chat: ["bar_0", "bar_1", "bar_2"],
  phone: ["phone_corner"],
};

const LOUNGE: ReadonlySet<Activity> = new Set(["coffee", "cooler", "couch", "tv", "window", "chat", "phone"]);

export interface Needs {
  caffeine: number;
  fatigue: number;
  stress: number;
  loneliness: number;
  boredom: number;
}

export interface Relationship {
  /** Liking: −1 (grudge) … +1 (friends). */
  affinity: number;
  /** Professional respect: −1 … +1. */
  respect: number;
}

export type MemoryKind = "chase_call" | "veto" | "fill" | "stop" | "win" | "news" | "setup" | "session" | "tape" | "smc";

export interface Memory {
  id: string;
  at: number;
  /** "09:36" ET — what people say when they bring it up. */
  clock: string;
  kind: MemoryKind;
  who: Character;
  against?: Character;
  text: string;
  /** A call the tape can grade later. */
  call?: { underlier: Underlier; price: number; dir: 1 | -1; resolveAt: number };
  /** A refused ticket, priced again later on the same model. */
  shadow?: {
    underlier: Underlier;
    type: OptionType;
    strike: number;
    exp: string;
    qty: number;
    entryAsk: number;
    resolveAt: number;
  };
  outcome?: { at: number; verdict: "right" | "wrong" | "flat" | "saved" | "cost" | "even"; movePct?: number; usd?: number } | null;
}

export interface AgentAct {
  act: Activity;
  since: number;
  /** floor-layout.json spot id for lounge activities, null at a desk or the board. */
  spot: string | null;
  /** Who they are with (chat). */
  with: Character | null;
}

export interface Record_ {
  right: number;
  wrong: number;
  flat: number;
  savedUsd: number;
  costUsd: number;
}

export interface MindState {
  version: 1;
  at: number;
  dayKey: string;
  needs: Record<Character, Needs>;
  acts: Record<Character, AgentAct>;
  rel: Record<Character, Record<Character, Relationship>>;
  memories: Memory[];
  /** Today's scored calls per person. */
  record: Record<Character, Record_>;
  /** Credibility 0–100, the Nemesis "power level". Persists across days, drifts back to 50. */
  rank: Record<Character, number>;
  /** Last futures print we wrote a tape memory from, so a move is remembered once. */
  tapeMark?: Partial<Record<Underlier, { px: number; at: number }>>;
  /** Director meetings already held (key → when), so one release is one meeting. */
  held: Record<string, number>;
  seq: number;
  /** Shared desk brain: cards, charts, SMC. Replaced, not re-read. */
  atlas?: DeskAtlas;
  /** Five personal brains connected to the desk. */
  people?: PeopleBrains;
}

/* ── The director's agenda — what the desk says is coming ─────────────── */

export interface AgendaEvent {
  name: string;
  date: string;
  timeEt: string;
  impact: "high" | "medium";
  minutes: number;
  actual?: string | null;
  vs?: string | null;
  /** The futures move from the release to +15m (or now), from the desk's 1m bars. */
  move?: { symbol: string; from: number; to: number; pct: number; window: string } | null;
}

export interface AgendaSetup {
  key: string;
  band: string;
  symbol: string;
  side: "long" | "short";
  confluence: number;
  strategy: string;
  pT1: number | null;
  expR: number | null;
  actionable: boolean;
  missing: string | null;
}

export interface Agenda {
  next: AgendaEvent | null;
  last: AgendaEvent | null;
  setup: AgendaSetup | null;
}

export type MeetingKind = "brief" | "pre_news" | "post_news" | "setup" | "debrief" | "restamp";

export interface Meeting {
  kind: MeetingKind;
  key: string;
  title: string;
  /** Who stands at the board; everyone else carries on. */
  attendees: Character[];
  event?: AgendaEvent | null;
  setup?: AgendaSetup | null;
}

/** Director windows, minutes. Meetings are scheduled off the desk's own calendar. */
export const DIRECTOR = {
  briefStartMin: 9 * 60 + 15,
  briefEndMin: 9 * 60 + 28,
  /** Before a high-impact release: gather T−35 … T−15 (the blackout starts at T−15). */
  preNewsFrom: 35,
  preNewsTo: 15,
  /** After it: T+15 (blackout over) … T+35. */
  postNewsFrom: 15,
  postNewsTo: 35,
  setupMinutes: 6,
  debriefStartMin: 16 * 60,
  debriefEndMin: 16 * 60 + 15,
  /** Sunday restamp (CLAUDE.md): Gemma and Nova at the board, 18:00–21:00 ET. */
  restampStartMin: 18 * 60,
  restampEndMin: 21 * 60,
  /** Setup bands that call a meeting (B+ reviews but never trades). */
  setupBands: ["A+", "A", "A-", "A−", "B+"] as readonly string[],
} as const;

/** The room's bookkeeping for scoring calls — not a desk statistic. */
export const SCORING = {
  resolveMin: 30,
  /** A chase call is right/wrong when the ETF moved ≥ this % its way/against it. */
  deadbandPct: 0.1,
  memoryCap: 80,
} as const;

/* ── Small deterministic helpers ───────────────────────────────────────── */

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const clampRel = (x: number) => Math.min(1, Math.max(-1, x));

/** Stable 0–1 noise from a string — no Math.random anywhere in this file. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

function baseRel(a: Character, b: Character): Relationship {
  // Starting chemistry, from the schools. The momentum trader and the risk
  // officer start cool; the two mechanical minds start warm.
  const pair = [a, b].sort().join("-");
  const seed: Record<string, Relationship> = {
    "Jax-Sterling": { affinity: -0.25, respect: 0.1 },
    "Jax-Nova": { affinity: 0.15, respect: 0.05 },
    "Jax-Vince": { affinity: 0.3, respect: 0.2 },
    "Gemma-Jax": { affinity: 0.25, respect: 0.1 },
    "Nova-Sterling": { affinity: 0.2, respect: 0.45 },
    "Nova-Vince": { affinity: 0.3, respect: 0.4 },
    "Gemma-Nova": { affinity: 0.35, respect: 0.35 },
    "Gemma-Sterling": { affinity: 0.1, respect: 0.4 },
    "Gemma-Vince": { affinity: 0.2, respect: 0.3 },
    "Sterling-Vince": { affinity: 0.35, respect: 0.55 },
  };
  return seed[pair] ?? { affinity: 0, respect: 0 };
}

export function freshMinds(nowMs: number, dayKey = ""): MindState {
  const rel = {} as Record<Character, Record<Character, Relationship>>;
  const needs = {} as Record<Character, Needs>;
  const acts = {} as Record<Character, AgentAct>;
  const record = {} as Record<Character, Record_>;
  const rank = {} as Record<Character, number>;
  for (const a of CREW) {
    rel[a] = {} as Record<Character, Relationship>;
    for (const b of CREW) if (a !== b) rel[a][b] = baseRel(a, b);
    needs[a] = { caffeine: 0.35 + hash01(`c${a}`) * 0.3, fatigue: 0.1, stress: 0.15, loneliness: 0.2, boredom: 0.1 };
    acts[a] = { act: "desk", since: nowMs, spot: null, with: null };
    record[a] = { right: 0, wrong: 0, flat: 0, savedUsd: 0, costUsd: 0 };
    rank[a] = 50;
  }
  return { version: 1, at: nowMs, dayKey, needs, acts, rel, memories: [], record, rank, held: {}, seq: 0 };
}

/* ── The situation the people react to ─────────────────────────────────── */

export interface Situation {
  nowMs: number;
  etDate: string;
  etMin: number;
  weekday: number;
  optionsOpen: boolean;
  beat: Beat;
  urgency: Urgency;
  execute: boolean;
  market: Record<Underlier, UnderlierTape>;
  openCount: number;
  agenda: Agenda | null;
  /** The armed card (trigger / veto / fill), if any. */
  card: RoomEntryRead | null;
  entryPlan: EntryPlan | null;
  vetoGate: string | null;
  /** Gate id when an A- or better was not filled. Null on a fill. */
  refusalCode: string | null;
  /** The direction Jax pushed this cycle (his chase call), if he made one. */
  jaxCall: { underlier: Underlier; dir: 1 | -1 } | null;
  exit: { reason: string; id: string; pnl: number; ticker: Underlier } | null;
  fill: { id: string; underlier: Underlier } | null;
  /** Is a high-impact release inside its ±15 minute blackout? */
  blackout: boolean;
}

/* ── The director ───────────────────────────────────────────────────────── */

export function directorMeeting(s: Situation): Meeting | null {
  const a = s.agenda;
  const weekday = s.weekday >= 1 && s.weekday <= 5;
  if (!weekday) {
    // Sunday evening: the week plan gets restamped (CLAUDE.md "Sunday restamp").
    if (s.weekday === 0 && s.etMin >= DIRECTOR.restampStartMin && s.etMin < DIRECTOR.restampEndMin)
      return { kind: "restamp", key: `restamp:${s.etDate}`, title: "Sunday restamp", attendees: ["Gemma", "Nova"] };
    return null;
  }
  const all = [...CREW];
  if (a?.next && a.next.impact === "high" && a.next.minutes <= DIRECTOR.preNewsFrom && a.next.minutes > DIRECTOR.preNewsTo)
    return { kind: "pre_news", key: `pre:${a.next.date}:${a.next.name}`, title: `Before ${a.next.name}`, attendees: all, event: a.next };
  if (a?.last && a.last.impact === "high" && a.last.minutes >= DIRECTOR.postNewsFrom && a.last.minutes <= DIRECTOR.postNewsTo)
    return { kind: "post_news", key: `post:${a.last.date}:${a.last.name}`, title: `After ${a.last.name}`, attendees: all, event: a.last };
  if (s.etMin >= DIRECTOR.briefStartMin && s.etMin < DIRECTOR.briefEndMin)
    return { kind: "brief", key: `brief:${s.etDate}`, title: "Morning brief", attendees: all };
  if (s.etMin >= DIRECTOR.debriefStartMin && s.etMin < DIRECTOR.debriefEndMin)
    return { kind: "debrief", key: `debrief:${s.etDate}`, title: "Close debrief", attendees: all };
  if (a?.setup && DIRECTOR.setupBands.includes(a.setup.band) && s.optionsOpen)
    return { kind: "setup", key: `setup:${s.etDate}:${a.setup.key}`, title: `${a.setup.band} setup review`, attendees: all, setup: a.setup };
  return null;
}

/** A setup review lasts DIRECTOR.setupMinutes from first sight, then the room goes back to work. */
function meetingStillOn(m: Meeting, minds: MindState, nowMs: number): boolean {
  if (m.kind !== "setup") return true;
  const first = minds.held[m.key];
  return first == null || nowMs - first <= DIRECTOR.setupMinutes * 60_000;
}

/* ── Needs ──────────────────────────────────────────────────────────────── */

function decayNeeds(prev: Needs, who: Character, act: Activity, dtMin: number, s: Situation): Needs {
  const t = TRAITS[who];
  const inSession = s.optionsOpen && s.etMin < 11 * 60 + 30;
  const n = { ...prev };
  const lounging = LOUNGE.has(act);
  n.caffeine = clamp01(n.caffeine + t.caffeineRate * dtMin - (act === "coffee" || act === "cooler" || act === "desk_drink" ? 0.09 * dtMin : 0));
  n.fatigue = clamp01(
    n.fatigue + (inSession ? 0.0025 : 0.0012) * dtMin + (s.urgency === "HIGH_ALERT" ? 0.004 * dtMin : 0) -
      (act === "couch" ? 0.03 * dtMin : act === "desk_lean" ? 0.012 * dtMin : 0),
  );
  n.stress = clamp01(
    n.stress + (s.urgency === "HIGH_ALERT" ? 0.02 : s.urgency === "MEDIUM" ? 0.004 : -0.006) * dtMin - (lounging ? 0.01 * dtMin : 0),
  );
  n.loneliness = clamp01(n.loneliness + (act === "chat" || act === "meeting" ? -0.05 : 0.004 * t.sociability) * dtMin);
  n.boredom = clamp01(n.boredom + (s.beat === "chop" || s.beat === "closed" ? 0.006 : -0.01) * dtMin - (lounging ? 0.02 * dtMin : 0));
  return n;
}

/* ── Utility choice for free time ───────────────────────────────────────── */

const MIN_DWELL_MIN: Partial<Record<Activity, number>> = {
  coffee: 3,
  cooler: 3,
  couch: 10,
  tv: 6,
  window: 3,
  chat: 5,
  phone: 4,
  desk: 8,
  desk_drink: 3,
  desk_lean: 6,
  desk_phone: 4,
  desk_stretch: 2,
};

function utility(who: Character, act: Activity, n: Needs, s: Situation, minuteBucket: number): number {
  const t = TRAITS[who];
  const session = s.optionsOpen && s.etMin < 11 * 60;
  const lunch = s.etMin >= 11 * 60 + 30 && s.etMin < 13 * 60 + 30;
  const like = t.likes.indexOf(act);
  const likeBonus = like < 0 ? 0 : 0.12 - like * 0.03;
  const noise = (hash01(`${who}:${act}:${minuteBucket}`) - 0.5) * 0.12;
  const spike = s.market.QQQ.volume_spike || s.market.SPY.volume_spike;
  switch (act) {
    case "desk":
      return 0.45 + t.diligence * 0.25 + (session ? 0.35 : 0) + (s.openCount ? 0.3 : 0) + (spike && who === "Jax" ? 0.25 : 0) - n.boredom * 0.3 - n.fatigue * 0.15 + noise;
    case "coffee":
    case "cooler":
      return n.caffeine * 1.05 + likeBonus + (session ? -0.25 : 0) + noise;
    case "couch":
      return n.fatigue * 0.9 + (lunch ? 0.35 : 0) + likeBonus - (session ? 0.5 : 0) + noise;
    case "tv":
      return n.boredom * 0.6 + (who === "Gemma" ? 0.18 : 0) + (spike ? 0.15 : 0) + likeBonus - (session ? 0.25 : 0) + noise;
    case "window":
      return n.boredom * 0.45 + n.stress * 0.25 + likeBonus - (session ? 0.35 : 0) + noise;
    case "chat":
      return n.loneliness * 0.85 * t.sociability + likeBonus + (lunch ? 0.15 : 0) - (session ? 0.3 : 0) + noise;
    case "phone":
      return n.boredom * 0.3 + (who === "Jax" ? 0.1 : 0) - (session ? 0.4 : 0) + noise;
    case "desk_drink":
      return n.caffeine * 0.9 + likeBonus + noise;
    case "desk_lean":
      return n.fatigue * 0.7 + n.boredom * 0.3 + likeBonus - (session ? 0.2 : 0) + noise;
    case "desk_phone":
      return n.boredom * 0.4 + likeBonus - (session ? 0.3 : 0) + noise;
    case "desk_stretch":
      return n.fatigue * 0.5 + likeBonus * 0.5 + noise;
    default:
      return -1;
  }
}

function chooseFree(who: Character, prev: AgentAct, n: Needs, s: Situation, minds: MindState): AgentAct {
  const t = TRAITS[who];
  const bucket = Math.floor(s.nowMs / 60_000);
  const options: Activity[] = t.roams
    ? ["desk", "coffee", "cooler", "couch", "tv", "window", "chat", "phone"]
    : ["desk", "desk_drink", "desk_lean", "desk_phone", "desk_stretch"];
  const dwellMin = (s.nowMs - prev.since) / 60_000;
  const committed = dwellMin < (MIN_DWELL_MIN[prev.act] ?? 3) && options.includes(prev.act);
  const scored = options.map((a) => ({ a, u: utility(who, a, n, s, Math.floor(bucket / 3)) }));
  scored.sort((x, y) => y.u - x.u);
  const best = scored[0]!;
  const current = scored.find((x) => x.a === prev.act);
  // Hysteresis: stay unless something is clearly better, and never before the dwell.
  if (committed || (current && best.u < current.u + 0.15)) {
    return options.includes(prev.act) ? prev : { act: "desk", since: s.nowMs, spot: null, with: null };
  }
  const act = best.a;
  const spots = ACTIVITY_SPOTS[act] ?? null;
  let withWho: Character | null = null;
  if (act === "chat") {
    // Chat with the roamer they like most who is also free.
    const mates = CREW.filter((c) => c !== who && TRAITS[c].roams).sort(
      (x, y) => minds.rel[who][y].affinity - minds.rel[who][x].affinity,
    );
    withWho = mates[0] ?? null;
  }
  const spot = spots ? spots[Math.floor(hash01(`${who}:${act}:${bucket}`) * spots.length)] ?? spots[0]! : null;
  // Risk and execution do not roam, and an idle desk is still the book: Sterling
  // works the halt page, Vince works the resting order. A drink or a phone stays.
  if (!t.roams && act === "desk") {
    const work: Activity = who === "Sterling" ? "desk_lean" : "desk_stretch";
    if (prev.act === work) return prev;
    return { act: work, since: s.nowMs, spot: null, with: null };
  }
  return { act, since: s.nowMs, spot, with: withWho };
}

/* ── Memory: record, then grade against the tape ───────────────────────── */

function remember(m: MindState, mem: Omit<Memory, "id">): MindState {
  const seq = m.seq + 1;
  return { ...m, seq, memories: [{ ...mem, id: `m${seq}` }, ...m.memories].slice(0, SCORING.memoryCap) };
}

function nudge(m: MindState, a: Character, b: Character, d: Partial<Relationship>): void {
  const r = m.rel[a][b];
  m.rel[a][b] = { affinity: clampRel(r.affinity + (d.affinity ?? 0)), respect: clampRel(r.respect + (d.respect ?? 0)) };
}

function resolveMemories(m0: MindState, s: Situation): MindState {
  const m: MindState = {
    ...m0,
    rel: Object.fromEntries(CREW.map((a) => [a, { ...m0.rel[a] }])) as MindState["rel"],
    record: Object.fromEntries(CREW.map((a) => [a, { ...m0.record[a] }])) as MindState["record"],
    rank: { ...m0.rank },
  };
  m.memories = m0.memories.map((mem) => {
    if (mem.outcome) return mem;
    if (mem.call && s.nowMs >= mem.call.resolveAt) {
      // Only grade on a print near the deadline — a stale tab must not score a call on tomorrow's open.
      if (s.nowMs - mem.call.resolveAt > 20 * 60_000 || !s.optionsOpen) return { ...mem, outcome: { at: s.nowMs, verdict: "flat", movePct: 0 } };
      const px = s.market[mem.call.underlier].price;
      const movePct = ((px - mem.call.price) / mem.call.price) * 100 * mem.call.dir;
      const verdict = movePct >= SCORING.deadbandPct ? "right" : movePct <= -SCORING.deadbandPct ? "wrong" : "flat";
      const rec = m.record[mem.who];
      rec[verdict] += 1;
      if (verdict === "right") {
        m.rank[mem.who] = Math.min(100, m.rank[mem.who] + 3);
        nudge(m, "Nova", mem.who, { respect: 0.06 });
        nudge(m, mem.who, "Nova", { affinity: -0.02 });
      } else if (verdict === "wrong") {
        m.rank[mem.who] = Math.max(0, m.rank[mem.who] - 2);
        nudge(m, "Nova", mem.who, { respect: -0.04 });
        nudge(m, "Sterling", mem.who, { respect: -0.03 });
      }
      return { ...mem, outcome: { at: s.nowMs, verdict, movePct: Math.round(movePct * 100) / 100 } };
    }
    if (mem.shadow && s.nowMs >= mem.shadow.resolveAt) {
      const sh = mem.shadow;
      if (s.nowMs - sh.resolveAt > 20 * 60_000 || !s.optionsOpen) return { ...mem, outcome: { at: s.nowMs, verdict: "even", usd: 0 } };
      const tape = s.market[sh.underlier];
      const q = quoteOption(tape.price, sh.strike, sh.exp, sh.type, ivFor(sh.underlier, tape.vix), s.nowMs);
      const usd = Math.round((q.bid - sh.entryAsk) * 100 * sh.qty);
      // The refused ticket LOST money → the veto saved it; it MADE money → the veto cost it.
      const verdict = usd < 0 ? "saved" : usd > 0 ? "cost" : "even";
      const rec = m.record[mem.who];
      if (usd < 0) {
        rec.savedUsd += -usd;
        m.rank[mem.who] = Math.min(100, m.rank[mem.who] + 3);
        if (mem.against) nudge(m, mem.against, mem.who, { respect: 0.08 });
      } else if (usd > 0) {
        rec.costUsd += usd;
        m.rank[mem.who] = Math.max(0, m.rank[mem.who] - 2);
        if (mem.against) nudge(m, mem.against, mem.who, { affinity: -0.08 });
      }
      return { ...mem, outcome: { at: s.nowMs, verdict, usd } };
    }
    return mem;
  });
  return m;
}

function recordEvents(m0: MindState, s: Situation, meeting: Meeting | null): MindState {
  let m = m0;
  const clock = hhmm(s.etMin);
  if (s.jaxCall) {
    const u = s.jaxCall.underlier;
    // One open call per underlier at a time — he says it every cycle, it is one call.
    const open = m.memories.find((x) => x.kind === "chase_call" && !x.outcome && x.call?.underlier === u);
    if (!open)
      m = remember(m, {
        at: s.nowMs,
        clock,
        kind: "chase_call",
        who: "Jax",
        text: `Jax called ${s.jaxCall.dir > 0 ? "calls" : "puts"} on ${u} at ${s.market[u].price.toFixed(2)}`,
        call: { underlier: u, price: s.market[u].price, dir: s.jaxCall.dir, resolveAt: s.nowMs + SCORING.resolveMin * 60_000 },
        outcome: null,
      });
  }
  if (s.beat === "vetoed" && s.entryPlan && s.card) {
    const e = s.entryPlan;
    const key = `${e.entry.underlier}:${e.quote.strike}:${e.entry.type}:${e.exp}`;
    const already = m.memories.some((x) => x.kind === "veto" && x.shadow && `${x.shadow.underlier}:${x.shadow.strike}:${x.shadow.type}:${x.shadow.exp}` === key);
    if (!already && e.qty >= 1) {
      m = remember(m, {
        at: s.nowMs,
        clock,
        kind: "veto",
        who: "Sterling",
        against: "Jax",
        text: `Sterling refused ${e.qty}× ${e.entry.underlier} ${e.quote.strike}${e.entry.type === "CALL" ? "C" : "P"} (${s.vetoGate ?? "a gate"})`,
        shadow: {
          underlier: e.entry.underlier,
          type: e.entry.type,
          strike: e.quote.strike,
          exp: e.exp,
          qty: e.qty,
          entryAsk: e.quote.ask,
          resolveAt: s.nowMs + SCORING.resolveMin * 60_000,
        },
        outcome: null,
      });
      const mm = { ...m, rel: Object.fromEntries(CREW.map((a) => [a, { ...m.rel[a] }])) as MindState["rel"] };
      nudge(mm, "Jax", "Sterling", { affinity: -0.05 });
      m = mm;
    }
  }
  if (s.fill)
    m = remember(m, { at: s.nowMs, clock, kind: "fill", who: "Vince", text: `Vince filled ${s.fill.id}` });
  if (s.exit) {
    const win = s.exit.pnl >= 0;
    m = remember(m, {
      at: s.nowMs,
      clock,
      kind: win ? "win" : "stop",
      who: win ? "Nova" : "Sterling",
      text: `${s.exit.id} closed ${s.exit.pnl >= 0 ? "+" : "−"}${Math.abs(s.exit.pnl).toFixed(1)}% (${s.exit.reason.replace("_", " ")})`,
    });
  }
  if (meeting && !m.held[meeting.key]) {
    m = { ...m, held: { ...m.held, [meeting.key]: s.nowMs } };
    if (meeting.kind === "pre_news" || meeting.kind === "post_news")
      m = remember(m, { at: s.nowMs, clock, kind: "news", who: "Gemma", text: meeting.title });
    if (meeting.kind === "setup" && meeting.setup)
      m = remember(m, {
        at: s.nowMs,
        clock,
        kind: "setup",
        who: "Nova",
        text: `${meeting.setup.band} ${meeting.setup.symbol} ${meeting.setup.side} reviewed`,
      });
  }
  if (s.card && (s.card.verdict === "ARMED" || s.card.smcWord === "TAKE" || s.card.tier === "live" || s.card.tier === "armed")) {
    const c = s.card;
    const text = `${c.futSymbol} ${c.futSide} ${c.smcWord}${c.band ? ` ${c.band}` : ""}`;
    if (!seenLately(m, "smc", text, s.nowMs, 20 * 60_000))
      m = remember(m, { at: s.nowMs, clock, kind: "smc", who: "Nova", text, outcome: null });
  }
  const sess = `Session ${s.etDate} ${hhmm(Math.floor(s.etMin / 60) * 60)}. ${s.card ? `${s.card.futSymbol} ${s.card.futSide} ${s.card.smcWord}` : "No card."} ${s.blackout ? "News on — size only." : "The chart leads."}`;
  if (!seenLately(m, "session", sess, s.nowMs, 50 * 60_000))
    m = remember(m, { at: s.nowMs, clock, kind: "session", who: "Gemma", text: sess, outcome: null });
  const marks = { ...(m.tapeMark ?? {}) };
  for (const u of ["SPY", "QQQ"] as const) {
    const px = s.market[u]?.price;
    if (!(px > 0)) continue;
    const prev = marks[u];
    if (prev && prev.px > 0 && s.nowMs - prev.at >= 5 * 60_000) {
      const pct = ((px - prev.px) / prev.px) * 100;
      if (Math.abs(pct) >= 0.12) {
        const mins = Math.max(1, Math.round((s.nowMs - prev.at) / 60_000));
        const text = `${u} ${pct >= 0 ? "bid" : "offered"} ${Math.abs(pct).toFixed(2)}% in ${mins}m, ${prev.px.toFixed(2)} to ${px.toFixed(2)}. The chart moved. That is information, not a chase.`;
        if (!seenLately(m, "tape", text, s.nowMs, 10 * 60_000))
          m = remember(m, { at: s.nowMs, clock, kind: "tape", who: "Jax", text, outcome: null });
        marks[u] = { px, at: s.nowMs };
      }
    } else if (!prev) marks[u] = { px, at: s.nowMs };
  }
  m = { ...m, tapeMark: marks };
  let atlas = absorbAtlas(m.atlas, {
    nowMs: s.nowMs,
    etMin: s.etMin,
    cardKey: s.card ? `${s.card.futSymbol}:${s.card.futSide}:${s.card.band ?? ""}:${s.card.smcWord}` : null,
    cardLine: s.card ? `${s.card.futSymbol} ${s.card.futSide} ${s.card.smcWord}${s.card.band ? ` ${s.card.band}` : ""}. Entry is the array.` : null,
    exitId: s.exit?.id ?? null,
    exitLine: s.exit ? `${s.exit.id} ${s.exit.pnl >= 0 ? "paid" : "cost"} ${Math.abs(s.exit.pnl).toFixed(1)}%` : null,
    newsOn: s.blackout,
  });
  let people = syncPeople(m.people, atlas, s.nowMs);
  if (s.exit) {
    const wrote = offerToBrains(people, atlas, {
      who: s.exit.pnl >= 0 ? "Nova" : "Sterling",
      text: `${s.exit.ticker} ${s.exit.reason.replaceAll("_", " ")} ${s.exit.pnl >= 0 ? "paid" : "cost"} ${Math.abs(s.exit.pnl).toFixed(1)}%. ${s.exit.pnl >= 0 ? "It improved the book, so it goes on the desk." : "Mine only. A loss does not become a desk rule."}`,
      about: `close ${s.exit.id}`.slice(0, 40),
      shelf: "backtest",
      nowMs: s.nowMs,
      pnl: s.exit.pnl,
      pT1: null,
      expR: null,
    });
    people = wrote.people;
    atlas = wrote.desk;
  }
  const band = s.card?.band ?? "";
  const graded = band === "A+" || band === "A" || band === "A-" || band === "A−" || band === "B+";
  if (s.card && graded && s.refusalCode && s.beat === "vetoed") {
    const text = `${s.card.futSymbol} ${band} was not filled. The gate was ${s.refusalCode}. Grade that gate, not the fit. The score does not go up because it was high.`;
    atlas = improveAtlas(atlas, {
      shelf: "discretion",
      title: `Miss ${s.card.futSymbol}`,
      text,
      who: "Sterling",
      nowMs: s.nowMs,
    });
    const wrote = offerToBrains(people, atlas, {
      who: "Sterling",
      text,
      about: `miss ${s.card.futSymbol} ${s.refusalCode}`.slice(0, 40),
      shelf: "discretion",
      nowMs: s.nowMs,
      pnl: null,
      pT1: null,
      expR: null,
    });
    people = wrote.people;
    atlas = wrote.desk;
    saveAtlas(atlas);
  }
  return { ...m, atlas, people };
}

/* ── Placement: the contract's zones, decided by rules then by people ──── */

export interface Places {
  Jax: JaxZone;
  Nova: NovaZone;
  Sterling: SterlingZone;
  Gemma: GemmaZone;
  Vince: VinceZone;
}

const DESK: Record<Character, Places[Character]> = {
  Jax: "JAX'S_DESK",
  Nova: "NOVA'S_DESK",
  Sterling: "STERLING_DESK",
  Gemma: "GEMMA_DESK",
  Vince: "VINCE_DESK",
};

function zoneFor(who: Character, act: Activity): Places[Character] {
  if (act === "meeting") return "THE_WHITEBOARD";
  if (LOUNGE.has(act) && TRAITS[who].roams) return "WATERCOOLER" as Places[Character];
  return DESK[who];
}

export interface AgentPlan {
  places: Places;
  acts: Record<Character, AgentAct>;
  meeting: Meeting | null;
  minds: MindState;
}

/**
 * Advance every mind to `s.nowMs` and decide where everyone is.
 * Order of authority: execution phase → HIGH_ALERT gathering → the blackout →
 * a director meeting → each person's own choice.
 */
/** A setup that is ready to enter: the whole floor stands at the war board. */
function readyBoard(s: Situation): boolean {
  if (!s.optionsOpen || s.beat === "closed") return false;
  if (s.beat === "trigger_wait" || s.beat === "fill") return true;
  const t = s.card?.tier;
  return (t === "armed" || t === "live") && (s.card?.verdict === "ARMED" || s.beat === "vetoed");
}

function seenLately(m: MindState, kind: MemoryKind, text: string, now: number, withinMs: number): boolean {
  return m.memories.some((x) => x.kind === kind && x.text === text && now - x.at < withinMs);
}

export function planAgents(prev: MindState | null, s: Situation): AgentPlan {
  const dayKey = s.etDate;
  let minds = prev && prev.version === 1 ? prev : freshMinds(s.nowMs, dayKey);
  if (minds.dayKey !== dayKey) {
    // A new day: needs reset to morning, today's record clears, ranks drift
    // halfway back to 50, relationships drift 10% toward their starting chemistry.
    const fresh = freshMinds(s.nowMs, dayKey);
    const rank = Object.fromEntries(CREW.map((c) => [c, Math.round(50 + (minds.rank[c] - 50) * 0.5)])) as MindState["rank"];
    const rel = Object.fromEntries(
      CREW.map((a) => [
        a,
        Object.fromEntries(
          CREW.filter((b) => b !== a).map((b) => {
            const base = baseRel(a, b);
            const cur = minds.rel[a]?.[b] ?? base;
            return [b, { affinity: cur.affinity * 0.9 + base.affinity * 0.1, respect: cur.respect * 0.9 + base.respect * 0.1 }];
          }),
        ),
      ]),
    ) as MindState["rel"];
    minds = { ...fresh, rank, rel, memories: minds.memories.slice(0, SCORING.memoryCap), tapeMark: minds.tapeMark, seq: minds.seq, atlas: minds.atlas, people: minds.people };
  }
  const dtMin = Math.min(30, Math.max(0, (s.nowMs - minds.at) / 60_000));

  const candidate = directorMeeting(s);
  const meeting = candidate && meetingStillOn(candidate, minds, s.nowMs) ? candidate : null;

  minds = resolveMemories(minds, s);
  minds = recordEvents(minds, s, meeting);

  const needs = {} as Record<Character, Needs>;
  const acts = {} as Record<Character, AgentAct>;
  const places = {} as Record<Character, Places[Character]>;
  for (const who of CREW) {
    const prevAct = minds.acts[who] ?? { act: "desk" as Activity, since: s.nowMs, spot: null, with: null };
    needs[who] = decayNeeds(minds.needs[who], who, prevAct.act, dtMin, s);
    let act: AgentAct;
    const forced = (a: Activity): AgentAct => (prevAct.act === a ? prevAct : { act: a, since: s.nowMs, spot: null, with: null });
    if (readyBoard(s)) {
      // The floor gathers at the board. The two who send the order stay at their desks.
      act = s.execute && (who === "Vince" || who === "Sterling") ? forced("desk") : forced("meeting");
    } else if (s.execute && (who === "Vince" || who === "Sterling")) act = forced("desk");
    else if (s.urgency === "HIGH_ALERT" && s.beat !== "closed") {
      // Sterling only walks to the board to stand in front of it (a veto).
      act = who === "Sterling" ? forced(s.beat === "vetoed" ? "meeting" : "desk") : forced("meeting");
      if (s.execute && who === "Vince") act = forced("desk");
    } else if (s.blackout && s.weekday >= 1 && s.weekday <= 5) act = forced("desk");
    else if (meeting && meeting.attendees.includes(who)) act = forced("meeting");
    else if (s.openCount > 0 && s.optionsOpen && !TRAITS[who].roams) act = forced("desk");
    else act = chooseFree(who, prevAct, needs[who], s, minds);
    acts[who] = act;
    places[who] = zoneFor(who, act.act);
  }
  minds = { ...minds, at: s.nowMs, needs, acts };
  return { places: places as unknown as Places, acts, meeting, minds };
}

/* ── What a person can bring up (for the meeting lines) ─────────────────── */

export function lastScored(minds: MindState | null, kind: MemoryKind, who?: Character): Memory | null {
  if (!minds) return null;
  return minds.memories.find((m) => m.kind === kind && m.outcome && (!who || m.who === who) && m.outcome.verdict !== "flat" && m.outcome.verdict !== "even") ?? null;
}

export function recordLine(minds: MindState | null, who: Character): string | null {
  if (!minds) return null;
  const r = minds.record[who];
  const n = r.right + r.wrong;
  if (who === "Sterling") {
    if (!r.savedUsd && !r.costUsd) return null;
    return `vetoes today saved $${r.savedUsd.toLocaleString()} and cost $${r.costUsd.toLocaleString()} on the model`;
  }
  if (!n) return null;
  return `${r.right} for ${n} on tape calls today`;
}

export function relationWord(minds: MindState | null, a: Character, b: Character): "grudge" | "cool" | "neutral" | "warm" | "respect" {
  if (!minds) return "neutral";
  const r = minds.rel[a][b];
  if (r.affinity <= -0.35) return "grudge";
  if (r.respect >= 0.45) return "respect";
  if (r.affinity >= 0.35) return "warm";
  if (r.affinity <= -0.15) return "cool";
  return "neutral";
}

export function rankTitle(rank: number): string {
  return rank >= 70 ? "on a heater" : rank >= 58 ? "trusted" : rank <= 30 ? "on thin ice" : rank <= 42 ? "shaky" : "steady";
}
