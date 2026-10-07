/**
 * Floor SMC school disciples — presentation contracts for Prototype Lab.
 *
 * Schools (ICT, TJR, Blake, Patty/PB, SMC), not impersonations of living traders.
 * Floor avatars (Gemma / Jax / Nova / Sterling / Vince) are cast seats that
 * *present* a school; Prototype Lab should key UI by FloorSchoolSeatId.
 *
 * Types only: re-exports and thin widenings of real desk fields.
 * Never invents live market numbers — hit-rate / calibration / PATH bands
 * stay null or pass-through from LabRead / SmcMaster / SessionBrief.
 *
 * When feat/pm-signal-engine lands, Prediction Market signal types
 * (MarketSignal, SignalBoard, …) come from src/lib/predict/signal-engine.ts
 * separately — do not mix them into these Floor school seats.
 */

/* ── Real desk sources (consume these paths) ─────────────────────────────── */

import {
  CONFLUENCE_STACK,
  ENTRY_SKELETON,
  SCHOOLS,
  STRATEGY_SCHOOL,
  TOP_DOWN,
  type CanonFactor,
  type CanonStack,
  type SchoolCanon,
  type SchoolId,
} from "@/lib/trading/smc-canon";
import type { SmcLayer, SmcMasterBook, SmcMasterRead } from "@/lib/trading/smc-master";
import type { PathBand } from "@/lib/trading/strategy-grade";
import type { SessionBrief } from "@/lib/trading/session-brief";
import type { PathAlarmFire, PathAlarmState } from "@/lib/alerts/path-alarm";
import {
  TRAITS,
  type Memory,
  type MindState,
  type Meeting,
  type Traits,
  type Agenda,
} from "@/lib/room/agents";
import type { Character, DialogueLine } from "@/lib/room/orchestrator";
import type { Argument, Lens, Lenses } from "@/lib/room/debate";
import type { LabRead, TrackRecord } from "@/lib/room/lab";
import type {
  DebateBeat,
  FloorSnap,
  ManagerCall,
  ManagerRoomState,
  ManagerSteer,
  PathSnap,
} from "@/lib/room/manager-feed";
import type { Facts } from "@/lib/room/meeting";
import type { SpokenPhrase, VoiceCast } from "@/lib/room/floor-voice";
import type { TalkWorld } from "@/lib/room/live-types";

/* ── Re-exports Prototype Lab should import from this module ─────────────── */

export type {
  SchoolId,
  SchoolCanon,
  CanonFactor,
  CanonStack,
  SmcLayer,
  SmcMasterBook,
  SmcMasterRead,
  PathBand,
  SessionBrief,
  PathAlarmFire,
  PathAlarmState,
  Memory,
  MindState,
  Meeting,
  Traits,
  Agenda,
  Character,
  DialogueLine,
  Argument,
  Lens,
  Lenses,
  LabRead,
  TrackRecord,
  DebateBeat,
  FloorSnap,
  ManagerCall,
  ManagerRoomState,
  ManagerSteer,
  PathSnap,
  Facts,
  SpokenPhrase,
  VoiceCast,
  TalkWorld,
};

export {
  SCHOOLS,
  STRATEGY_SCHOOL,
  CONFLUENCE_STACK,
  ENTRY_SKELETON,
  TOP_DOWN,
  TRAITS,
};

/**
 * Note: there is no type named `StandMemory` on main.
 * Closest live types: `Memory` + `MindState.memories` (@/lib/room/agents).
 * Manager Stand state is `ManagerRoomState` (@/lib/room/manager-feed).
 */

/* ── Five presentation seats (schools, not people) ───────────────────────── */

/** Prototype Lab Floor school seats — excludes `ronan` (canon-only today). */
export type FloorSchoolSeatId = Extract<SchoolId, "ict" | "tjr" | "blake" | "patty" | "smc">;

export const FLOOR_SCHOOL_SEAT_IDS = ["ict", "tjr", "blake", "patty", "smc"] as const satisfies readonly FloorSchoolSeatId[];

/**
 * Floor cast avatar that *presents* the school on the Trading Floor.
 * Presentation cast only — not an impersonation of the school founder.
 */
export const FLOOR_SCHOOL_AVATAR: Record<FloorSchoolSeatId, Character> = {
  ict: "Gemma",
  tjr: "Jax",
  blake: "Nova",
  patty: "Sterling",
  smc: "Vince",
};

export const FLOOR_AVATAR_SCHOOL: Record<Character, FloorSchoolSeatId> = {
  Gemma: "ict",
  Jax: "tjr",
  Nova: "blake",
  Sterling: "patty",
  Vince: "smc",
};

export interface FloorSchoolSeatMeta {
  id: FloorSchoolSeatId;
  /** Display label for Prototype Lab plaques (school name, not avatar name). */
  label: string;
  /** Floor avatar that presents this school (cast seat). */
  avatar: Character;
  /** Static canon from smc-canon.ts SCHOOLS[id]. */
  canon: SchoolCanon;
  /** Static traits creed from agents.ts TRAITS[avatar]. */
  creed: string;
  style: SchoolCanon["style"];
}

export function floorSchoolSeat(id: FloorSchoolSeatId): FloorSchoolSeatMeta {
  const avatar = FLOOR_SCHOOL_AVATAR[id];
  const canon = SCHOOLS[id];
  const traits = TRAITS[avatar];
  return {
    id,
    label: canon.name,
    avatar,
    canon,
    creed: traits.creed,
    style: canon.style,
  };
}

export function allFloorSchoolSeats(): FloorSchoolSeatMeta[] {
  return FLOOR_SCHOOL_SEAT_IDS.map(floorSchoolSeat);
}

/* ── Signature lines (what a seat “says” as its school) ──────────────────── */

/**
 * Static + live signature surfaces already on the desk.
 * Live strings come from SmcMaster / meeting dialogue — never fabricated here.
 */
export interface FloorSchoolSignatureLines {
  seat: FloorSchoolSeatId;
  /** LIVE (static desk data): SchoolCanon.sequence */
  canonSequence: readonly string[];
  /** LIVE (static desk data): Traits.creed for the presenting avatar */
  creed: string;
  /** LIVE (static): SchoolCanon.entry / timeFilter / journal / discretion */
  entry: string;
  timeFilter: string;
  journal: string;
  discretion: string;
  /**
   * LIVE when a SmcMasterRead is on the desk: thesis / vsSchools / book.missing.
   * TODO/stub until Prototype Lab wires gradeSmcMaster — leave null, do not invent.
   */
  smcThesis: string | null;
  smcVsSchools: string | null;
  smcMissing: string | null;
  smcMissingDetail: string | null;
  /**
   * LIVE when meeting/talk has DialogueLine[] for this avatar.
   * TODO/stub until a cycle is bound — empty array, do not invent lines.
   */
  spokenLines: readonly DialogueLine[];
  /** LIVE voice cast metadata (pace/pattern only) — from floor-voice VOICE_CAST. */
  voice: VoiceCast | null;
}

/** Build signature lines from static canon only (safe without a live desk). */
export function signatureLinesFromCanon(id: FloorSchoolSeatId): FloorSchoolSignatureLines {
  const seat = floorSchoolSeat(id);
  return {
    seat: id,
    canonSequence: seat.canon.sequence,
    creed: seat.creed,
    entry: seat.canon.entry,
    timeFilter: seat.canon.timeFilter,
    journal: seat.canon.journal,
    discretion: seat.canon.discretion,
    smcThesis: null,
    smcVsSchools: null,
    smcMissing: null,
    smcMissingDetail: null,
    spokenLines: [],
    voice: null,
  };
}

/**
 * Widen a live SmcMasterRead onto a seat without inventing prose.
 * Uses book.missing / missingDetail / entry from the one-book or side book.
 */
export function widenSignatureFromSmc(
  base: FloorSchoolSignatureLines,
  read: SmcMasterRead | null | undefined,
  book: SmcMasterBook | null | undefined = read?.oneBook ?? null,
): FloorSchoolSignatureLines {
  if (!read) return base;
  return {
    ...base,
    smcThesis: read.thesis,
    smcVsSchools: read.vsSchools,
    smcMissing: book?.missing ?? null,
    smcMissingDetail: book?.missingDetail ?? null,
  };
}

/* ── Must-checklists ─────────────────────────────────────────────────────── */

export interface FloorSchoolMustItem {
  id: string;
  label: string;
  must: boolean;
  /**
   * LIVE when CanonStack / SmcMasterBook.layers are available.
   * null = not graded yet (stub) — never invent pass/fail.
   */
  pass: boolean | null;
  detail: string | null;
  source: "confluence_stack" | "school_sequence" | "smc_layer" | "canon_factor" | "session_gate";
}

export interface FloorSchoolMustChecklist {
  seat: FloorSchoolSeatId;
  /** Desk-wide must stack (smc-canon CONFLUENCE_STACK) — shared by all seats. */
  deskMust: readonly FloorSchoolMustItem[];
  /** School-specific sequence steps (presentation checklist from SCHOOLS[id].sequence). */
  schoolSequence: readonly FloorSchoolMustItem[];
  /**
   * LIVE graded factors when CanonStack / SmcMasterBook is wired.
   * Empty until then — TODO, do not invent.
   */
  liveLayers: readonly FloorSchoolMustItem[];
  /** LIVE session brief gates when SessionBrief is wired. */
  sessionGates: readonly FloorSchoolMustItem[];
}

export function mustChecklistFromCanon(id: FloorSchoolSeatId): FloorSchoolMustChecklist {
  const deskMust: FloorSchoolMustItem[] = CONFLUENCE_STACK.map((c) => ({
    id: c.id,
    label: c.label,
    must: c.must,
    pass: null,
    detail: null,
    source: "confluence_stack" as const,
  }));
  const schoolSequence: FloorSchoolMustItem[] = SCHOOLS[id].sequence.map((label, i) => ({
    id: `${id}_seq_${i}`,
    label,
    must: true,
    pass: null,
    detail: null,
    source: "school_sequence" as const,
  }));
  return { seat: id, deskMust, schoolSequence, liveLayers: [], sessionGates: [] };
}

export function widenMustFromCanonStack(
  checklist: FloorSchoolMustChecklist,
  stack: CanonStack | null | undefined,
): FloorSchoolMustChecklist {
  if (!stack) return checklist;
  const liveLayers: FloorSchoolMustItem[] = stack.factors.map((f: CanonFactor) => ({
    id: f.id,
    label: f.label,
    must: f.must,
    pass: f.pass,
    detail: f.detail,
    source: "canon_factor" as const,
  }));
  return { ...checklist, liveLayers };
}

export function widenMustFromSmcLayers(
  checklist: FloorSchoolMustChecklist,
  layers: readonly SmcLayer[] | null | undefined,
): FloorSchoolMustChecklist {
  if (!layers?.length) return checklist;
  const fromLayers: FloorSchoolMustItem[] = layers.map((l) => ({
    id: l.id,
    label: l.label,
    must: l.must,
    pass: l.state === "pass" ? true : l.state === "fail" ? false : null,
    detail: l.detail,
    source: "smc_layer" as const,
  }));
  return { ...checklist, liveLayers: [...checklist.liveLayers, ...fromLayers] };
}

export function widenMustFromSessionBrief(
  checklist: FloorSchoolMustChecklist,
  brief: SessionBrief | null | undefined,
): FloorSchoolMustChecklist {
  if (!brief) return checklist;
  const sessionGates: FloorSchoolMustItem[] = brief.gates.map((g) => ({
    id: g.id,
    label: g.label,
    must: true,
    pass: g.ok,
    detail: g.detail,
    source: "session_gate" as const,
  }));
  return { ...checklist, sessionGates };
}

/* ── Hit-rate / rank ─────────────────────────────────────────────────────── */

/**
 * Hit-rate and credibility for a school seat.
 * Numbers only exist when LabRead / MindState are supplied — otherwise null/TODO.
 */
export interface FloorSchoolHitRateRank {
  seat: FloorSchoolSeatId;
  avatar: Character;
  /**
   * LIVE: LabRead.track[avatar] — Brier / meanP / hitRate over scored plans.
   * null fields when n < MIN_TRACK or no lab yet.
   */
  track: TrackRecord | null;
  /**
   * LIVE: MindState.rank[avatar] — credibility 0–100 (Nemesis power), NOT a market WR.
   * TODO/stub until minds are bound.
   */
  credibilityRank: number | null;
  /**
   * LIVE: LabRead.calibration (room-level, not per-school).
   * Exposed for briefing plaques; same object for every seat.
   */
  roomCalibration: LabRead["calibration"] | null;
  /**
   * Per-school strategy hit buckets (profit-path StrategyBucketStats) keyed by
   * STRATEGY_SCHOOL — NOT wired as a school aggregate yet.
   * TODO: aggregate GradedTrade / StrategyBucketStats by SchoolId when Prototype Lab needs it.
   */
  strategyHitBySchool: null;
}

export function hitRateRankStub(id: FloorSchoolSeatId): FloorSchoolHitRateRank {
  return {
    seat: id,
    avatar: FLOOR_SCHOOL_AVATAR[id],
    track: null,
    credibilityRank: null,
    roomCalibration: null,
    strategyHitBySchool: null,
  };
}

export function widenHitRateFromLab(
  stub: FloorSchoolHitRateRank,
  lab: LabRead | null | undefined,
  minds: MindState | null | undefined = null,
): FloorSchoolHitRateRank {
  const avatar = stub.avatar;
  return {
    ...stub,
    track: lab?.track[avatar] ?? null,
    credibilityRank: minds?.rank[avatar] ?? null,
    roomCalibration: lab?.calibration ?? null,
    strategyHitBySchool: null,
  };
}

/* ── Debate / briefing feeds ─────────────────────────────────────────────── */

/**
 * Debate + briefing surfaces Prototype Lab may bind for a school seat.
 * All live payloads are optional; empty/null = not wired (never invent quotes).
 */
export interface FloorSchoolDebateBriefing {
  seat: FloorSchoolSeatId;
  avatar: Character;
  /** LIVE: debate lens for this avatar when a card is priced (Lenses[avatar]). */
  lens: Lens | null;
  /** LIVE: thesis/challenge/rebuttal Argument rows that cite this school owner. */
  arguments: readonly Argument[];
  /** LIVE: Manager steer beats (DebateBeat) — chair feed, not school-authored. */
  steer: ManagerSteer | null;
  /** LIVE: current Manager call debateCite / floorCite / pathCite. */
  managerCites: ManagerCall["reasoning"] | null;
  /** LIVE: Floor + PATH snaps from ManagerRoomState. */
  floor: FloorSnap | null;
  path: PathSnap | null;
  /** LIVE: meeting lines for this avatar (DialogueLine.who === avatar). */
  meetingLines: readonly DialogueLine[];
  /** LIVE: agents Meeting block when a director meeting is active. */
  meeting: Meeting | null;
  /** LIVE: Agenda (setups / events) from agents — shared briefing shelf. */
  agenda: Agenda | null;
  /** LIVE: SessionBrief day path — shared, not per-school. */
  sessionBrief: SessionBrief | null;
  /** LIVE: meeting Facts bundle when room cycle is bound. */
  facts: Facts | null;
  /** LIVE: TalkWorld pulse from live-world (tape/news/book lite). */
  world: TalkWorld | null;
  /**
   * Stand memory: use Memory[] filtered by who === avatar.
   * There is no StandMemory type — this is the real field.
   */
  memories: readonly Memory[];
}

export function debateBriefingStub(id: FloorSchoolSeatId): FloorSchoolDebateBriefing {
  return {
    seat: id,
    avatar: FLOOR_SCHOOL_AVATAR[id],
    lens: null,
    arguments: [],
    steer: null,
    managerCites: null,
    floor: null,
    path: null,
    meetingLines: [],
    meeting: null,
    agenda: null,
    sessionBrief: null,
    facts: null,
    world: null,
    memories: [],
  };
}

export function widenDebateFromManager(
  stub: FloorSchoolDebateBriefing,
  state: ManagerRoomState | null | undefined,
  steer: ManagerSteer | null | undefined = null,
): FloorSchoolDebateBriefing {
  if (!state) return { ...stub, steer: steer ?? stub.steer };
  return {
    ...stub,
    steer: steer ?? stub.steer,
    managerCites: state.call?.reasoning ?? null,
    floor: state.floor,
    path: state.path,
  };
}

export function widenDebateFromLabLenses(
  stub: FloorSchoolDebateBriefing,
  lenses: Lenses | null | undefined,
): FloorSchoolDebateBriefing {
  if (!lenses) return stub;
  return { ...stub, lens: lenses[stub.avatar] ?? null };
}

/* ── Per-seat field inventory (documentation for Prototype Lab) ──────────── */

export type FieldStatus = "live" | "stub" | "todo";

export interface SeatFieldRef {
  role: "signature" | "must_checklist" | "hit_rate" | "debate_briefing";
  status: FieldStatus;
  /** Exact export path Prototype Lab should import. */
  exportPath: string;
  typeName: string;
  notes: string;
}

/**
 * Exact live vs stub map for each school seat.
 * Status is about *desk availability*, not whether a school has a story —
 * all five seats share the same live wiring (avatar → Character key).
 */
export const FLOOR_SCHOOL_FIELD_INVENTORY: Record<FloorSchoolSeatId, readonly SeatFieldRef[]> = {
  ict: seatInventory("ict"),
  tjr: seatInventory("tjr"),
  blake: seatInventory("blake"),
  patty: seatInventory("patty"),
  smc: seatInventory("smc"),
};

function seatInventory(id: FloorSchoolSeatId): SeatFieldRef[] {
  const avatar = FLOOR_SCHOOL_AVATAR[id];
  return [
    {
      role: "signature",
      status: "live",
      exportPath: "@/lib/trading/smc-canon",
      typeName: `SCHOOLS['${id}']`,
      notes: `SchoolCanon.sequence / entry / timeFilter / journal / discretion — static canon lines for ${id}.`,
    },
    {
      role: "signature",
      status: "live",
      exportPath: "@/lib/room/agents",
      typeName: `TRAITS.${avatar}.creed`,
      notes: `Presenting avatar creed (school disciple voice, not founder impersonation).`,
    },
    {
      role: "signature",
      status: "live",
      exportPath: "@/lib/trading/smc-master",
      typeName: "SmcMasterRead.thesis | vsSchools | SmcMasterBook.missing*",
      notes: "Live when gradeSmcMaster(desk) is bound; otherwise leave null.",
    },
    {
      role: "signature",
      status: "live",
      exportPath: "@/lib/room/orchestrator",
      typeName: "DialogueLine",
      notes: `Meeting/talk lines with who === '${avatar}'.`,
    },
    {
      role: "signature",
      status: "live",
      exportPath: "@/lib/room/floor-voice",
      typeName: `VOICE_CAST.${avatar}`,
      notes: "Spoken presentation pace/pattern only.",
    },
    {
      role: "must_checklist",
      status: "live",
      exportPath: "@/lib/trading/smc-canon",
      typeName: "CONFLUENCE_STACK | CanonStack.factors",
      notes: "Desk must-stack; CanonFactor.pass is live only after scoreCanonStack.",
    },
    {
      role: "must_checklist",
      status: "live",
      exportPath: "@/lib/trading/smc-master",
      typeName: "SmcLayer[]",
      notes: "Independent sequence layers (must/state/detail).",
    },
    {
      role: "must_checklist",
      status: "live",
      exportPath: "@/lib/trading/session-brief",
      typeName: "SessionBrief.gates",
      notes: "Day brief gates — shared across seats.",
    },
    {
      role: "must_checklist",
      status: "stub",
      exportPath: "@/lib/room/floor-school-contracts",
      typeName: "FloorSchoolMustChecklist.schoolSequence",
      notes: "School sequence as checklist chips (labels from SCHOOLS only; pass always null until a school-specific grader exists).",
    },
    {
      role: "hit_rate",
      status: "live",
      exportPath: "@/lib/room/lab",
      typeName: `LabRead.track.${avatar}`,
      notes: "TrackRecord: n / brier / meanP / hitRate. Null brier until MIN_TRACK scored plans.",
    },
    {
      role: "hit_rate",
      status: "live",
      exportPath: "@/lib/room/agents",
      typeName: `MindState.rank.${avatar}`,
      notes: "Credibility 0–100 (Nemesis), not market win-rate.",
    },
    {
      role: "hit_rate",
      status: "live",
      exportPath: "@/lib/room/lab",
      typeName: "LabRead.calibration",
      notes: "Room-level calibration hitRate — shared plaque, not per-school.",
    },
    {
      role: "hit_rate",
      status: "todo",
      exportPath: "@/lib/trading/profit-path",
      typeName: "StrategyBucketStats via STRATEGY_SCHOOL",
      notes: "No SchoolId aggregate yet — do not invent WR; wire when Prototype Lab needs school-ranked PATH buckets.",
    },
    {
      role: "debate_briefing",
      status: "live",
      exportPath: "@/lib/room/debate",
      typeName: `Lenses / Argument / thesisOwner`,
      notes: `thesisOwner maps strategy → ${avatar} for ${id}; lensesFor prices each Character.`,
    },
    {
      role: "debate_briefing",
      status: "live",
      exportPath: "@/lib/room/meeting",
      typeName: "Facts / buildMeeting → DialogueLine[]",
      notes: "Briefing exchange; quotes SCHOOLS + memory, no invented numbers.",
    },
    {
      role: "debate_briefing",
      status: "live",
      exportPath: "@/lib/room/manager-feed",
      typeName: "DebateBeat / ManagerSteer / ManagerCall.reasoning / FloorSnap / PathSnap",
      notes: "Stand chair + cites; presentation-safe.",
    },
    {
      role: "debate_briefing",
      status: "live",
      exportPath: "@/lib/room/agents",
      typeName: "Meeting / Agenda / Memory",
      notes: "No StandMemory type — use Memory + MindState.memories.",
    },
    {
      role: "debate_briefing",
      status: "live",
      exportPath: "@/lib/trading/session-brief",
      typeName: "SessionBrief",
      notes: "Bull/bear/stand-down day brief — shared shelf.",
    },
    {
      role: "debate_briefing",
      status: "live",
      exportPath: "@/lib/room/live-world",
      typeName: "TalkWorld via worldFromDesk",
      notes: "Tape/news/book lite for Floor talk.",
    },
    {
      role: "debate_briefing",
      status: "live",
      exportPath: "@/lib/alerts/path-alarm",
      typeName: "PathAlarmState / PathAlarmFire / isPathFire",
      notes: "PATH fire bands for briefing; no RH place wiring here.",
    },
  ];
}

/* ── Bundle helper ───────────────────────────────────────────────────────── */

export interface FloorSchoolSeatBundle {
  meta: FloorSchoolSeatMeta;
  signature: FloorSchoolSignatureLines;
  checklist: FloorSchoolMustChecklist;
  hitRate: FloorSchoolHitRateRank;
  debate: FloorSchoolDebateBriefing;
  inventory: readonly SeatFieldRef[];
}

/** Static-safe bundle (no live desk). Prototype Lab can widen later. */
export function floorSchoolSeatBundle(id: FloorSchoolSeatId): FloorSchoolSeatBundle {
  return {
    meta: floorSchoolSeat(id),
    signature: signatureLinesFromCanon(id),
    checklist: mustChecklistFromCanon(id),
    hitRate: hitRateRankStub(id),
    debate: debateBriefingStub(id),
    inventory: FLOOR_SCHOOL_FIELD_INVENTORY[id],
  };
}

export function allFloorSchoolSeatBundles(): FloorSchoolSeatBundle[] {
  return FLOOR_SCHOOL_SEAT_IDS.map(floorSchoolSeatBundle);
}

/* ── pm-signal-engine note ───────────────────────────────────────────────── */

/**
 * feat/pm-signal-engine (when landed / merged) supplies Prediction Market types
 * separately — Prototype Lab must not read them from this Floor school module:
 *
 *   @/lib/predict/signal-engine
 *     MarketSignal, SignalBoard, SignalGrade, EdgeRead, CrowdRead, HallLayout, …
 *   @/lib/predict/signal-evidence
 *     PriceBin, PRICE_BINS, FLB_SOURCE, …
 *   @/lib/predict/prediction-market-feed
 *     PredictionMarket, PredictionMarketFeedState, …
 *
 * Those are Mead Hall / Predict tab contracts, not SMC school disciple seats.
 */
export const PM_SIGNAL_ENGINE_TYPE_PATHS = [
  "@/lib/predict/signal-engine",
  "@/lib/predict/signal-evidence",
  "@/lib/predict/prediction-market-feed",
] as const;
