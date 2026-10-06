/**
 * Floor 3D overhaul — Chunk B (16–24) presentation adapter.
 *
 * Consumes Trading Stand's typed seats from `@/lib/room/floor-school-contracts`
 * (feat/floor-school-contracts @ 15e6d23). Does not rewrite those contracts.
 *
 * Widens bundles with live desk/manager/lab/minds fields when present.
 * CRITICAL: null/stub fields stay labelled "awaiting model data" —
 * never invent schoolSequence pass chips, StrategyBucketStats WR, or smcThesis
 * without gradeSmcMaster / SessionBrief / CanonStack bound.
 */

/**
 * TODO(Accuracy / Chunk D): when Trading Stand merges `feat/floor-school-contracts`
 * @ 15e6d23 into main, replace the vendored `floor-school-contracts.ts` copy with the
 * shared module (today it is kept byte-aligned; do not invent a second divergent copy).
 * Floor plaques MUST keep using SCHOOL_SHORT below — never Stand `meta.label` surnames.
 */

import { DIRECTOR } from "./agents";
import type { Character } from "./orchestrator";
import type { LabLite, MindsRead, TalkWorld, TapeBook } from "./live-types";
import type { ManagerRoomState, ManagerSteer, DebateBeat } from "./manager-feed";
import { etWallParts } from "@/lib/trading/sessions";
import {
  FLOOR_SCHOOL_SEAT_IDS,
  FLOOR_SCHOOL_AVATAR,
  FLOOR_AVATAR_SCHOOL,
  allFloorSchoolSeatBundles,
  floorSchoolSeatBundle,
  widenSignatureFromSmc,
  widenMustFromCanonStack,
  widenMustFromSmcLayers,
  widenMustFromSessionBrief,
  widenHitRateFromLab,
  widenDebateFromManager,
  type FloorSchoolSeatId,
  type FloorSchoolSeatBundle,
  type FloorSchoolSignatureLines,
  type FloorSchoolMustChecklist,
  type FloorSchoolMustItem,
  type FloorSchoolHitRateRank,
  type FloorSchoolDebateBriefing,
  type SmcMasterRead,
  type SessionBrief,
  type CanonStack,
  type LabRead,
  type MindState,
  type TrackRecord,
} from "./floor-school-contracts";

export type FloorSchoolId = FloorSchoolSeatId;
export const FLOOR_SCHOOLS = FLOOR_SCHOOL_SEAT_IDS;
export const DISCIPLE_OF = FLOOR_AVATAR_SCHOOL;
export const DISCIPLE_WHO = FLOOR_SCHOOL_AVATAR;

export const SCHOOL_ACCENT: Record<FloorSchoolSeatId, string> = {
  ict: "#15803d",
  tjr: "#e4572e",
  blake: "#6d28d9",
  patty: "#1e3a5f",
  smc: "#111827",
};

export const SCHOOL_SHORT: Record<FloorSchoolSeatId, string> = {
  ict: "ICT",
  tjr: "TJR",
  blake: "Blake Mech",
  patty: "Patty / PB",
  smc: "SMC",
};

/** Hook slot — Stand contracts are the live source; version bumps if Stand ships a richer hook later. */
export interface SchoolModelHook {
  version: number | null;
  source: "trading-stand" | "awaiting";
  /** Optional live wideners Prototype Lab / room engine may inject. */
  smcMaster?: SmcMasterRead | null;
  sessionBrief?: SessionBrief | null;
  canonStack?: CanonStack | null;
  labRead?: LabRead | null;
  minds?: MindState | null;
}

export const AWAITING_SCHOOL_MODEL: SchoolModelHook = {
  version: 1,
  source: "trading-stand",
};

/* ── Presentation rows (Canvas drawers) ──────────────────────────────────── */

export interface SchoolDisciple {
  who: Character;
  school: FloorSchoolSeatId;
  schoolName: string;
  role: string;
  creed: string;
  accent: string;
  deskId: string;
  deskPos: [number, number];
  /** Static canon sequence (labels only). */
  sequence: readonly string[];
  style: string;
}

export interface SchoolDeskLine {
  school: FloorSchoolSeatId;
  who: Character;
  line: string;
  source: "smc-master" | "book" | "creed" | "canon" | "awaiting-model";
  empty: boolean;
}

export type CheckState = "pass" | "fail" | "unknown" | "awaiting-model";

export interface ChecklistItem {
  id: string;
  label: string;
  must: boolean;
  state: CheckState;
  detail: string;
  source: FloorSchoolMustItem["source"];
}

export interface DebatePanel {
  phase: string;
  beat: DebateBeat | null;
  address: string | null;
  line: string;
  thesis: string | null;
  floorCite: string | null;
  pathCite: string | null;
  debateCite: string | null;
  blocks: string[];
  lenses: { who: Character; p: number }[];
  roomP: number | null;
  empty: boolean;
  source: "manager-feed" | "awaiting";
}

export type BriefingPhase = "pre" | "council" | "morning_brief" | "open" | "done" | "weekend";

export interface BriefingBeat {
  phase: BriefingPhase;
  label: string;
  clock: string;
  inMin: number;
  lines: string[];
  awaitingModel: boolean;
}

export interface HitRank {
  who: Character;
  school: FloorSchoolSeatId;
  hitRate: number | null;
  meanP: number | null;
  n: number;
  rank: number | null;
  /** MindState credibility 0–100 — not a market WR. */
  credibility: number | null;
  label: string;
  source: "lab-track" | "awaiting-model";
}

export type BodyLangKey =
  | "IDLE"
  | "CROSSING_ARMS"
  | "CHECKING_TABLET"
  | "ANALYZING"
  | "STEADY_MONITORING"
  | "FURIOUS_TYPING"
  | "NODDING"
  | "STRETCH"
  | "FACEPALM"
  | "CHEER";

export interface BodyLang {
  who: Character;
  anim: BodyLangKey;
  reason: string;
}

export interface RelLink {
  a: Character;
  b: Character;
  affinity: number;
  respect: number;
  strength: number;
  tone: "warm" | "cool" | "frayed" | "neutral";
}

export interface SchoolFloor {
  hook: SchoolModelHook;
  /** Raw Stand bundles (widened) — drawers may read either layer. */
  bundles: FloorSchoolSeatBundle[];
  disciples: SchoolDisciple[];
  desks: SchoolDeskLine[];
  checklist: ChecklistItem[];
  debate: DebatePanel;
  briefing: BriefingBeat;
  ranks: HitRank[];
  body: BodyLang[];
  rels: RelLink[];
}

const DESK_POS: Record<Character, [number, number]> = {
  Jax: [-11.5, -9.2],
  Nova: [-6.5, -9.2],
  Gemma: [-1.5, -9.2],
  Sterling: [-11.5, 4.3],
  Vince: [-6.5, 4.3],
};

const ROLE: Record<Character, string> = {
  Gemma: "Macro",
  Jax: "Momentum",
  Nova: "Quant",
  Sterling: "Risk",
  Vince: "Execution",
};

const COUNCIL_START = 8 * 60 + 30;
const COUNCIL_END = 9 * 60 + 15;

/** Map LabLite → LabRead-shaped track for widenHitRateFromLab (pass-through only). */
function labReadFromLite(lab: LabLite | null): LabRead | null {
  if (!lab) return null;
  const track = Object.fromEntries(
    (Object.entries(lab.track) as [Character, { n: number; brier: number | null; meanP?: number | null; hitRate?: number | null }][]).map(
      ([who, t]) =>
        [
          who,
          {
            n: t.n,
            brier: t.brier,
            meanP: t.meanP ?? null,
            hitRate: t.hitRate ?? null,
          } satisfies TrackRecord,
        ] as const,
    ),
  ) as LabRead["track"];
  return {
    ghostsOpen: 0,
    twins: { n: lab.twins.n, roomUsd: 0, mandateUsd: 0, deltaUsd: lab.twins.deltaUsd },
    refusals: lab.refusals,
    calibration: lab.calibration
      ? {
          n: lab.calibration.n,
          meanP: lab.calibration.meanP,
          hitRate: lab.calibration.hitRate,
          brier: lab.calibration.brier,
          bins: [],
        }
      : { n: 0, meanP: null, hitRate: null, brier: null, bins: [] },
    track,
    recent: [],
    open: [],
  };
}

function itemState(it: FloorSchoolMustItem): CheckState {
  if (it.pass === true) return "pass";
  if (it.pass === false) return "fail";
  // schoolSequence chips are labels only until a school grader exists — never invent pass.
  if (it.source === "school_sequence") return "awaiting-model";
  return "awaiting-model";
}

function flattenChecklist(c: FloorSchoolMustChecklist): ChecklistItem[] {
  const rows: FloorSchoolMustItem[] = [...c.deskMust, ...c.liveLayers, ...c.sessionGates, ...c.schoolSequence];
  // Prefer liveLayers over deskMust when same id graded.
  const byId = new Map<string, FloorSchoolMustItem>();
  for (const it of rows) {
    const prev = byId.get(it.id);
    if (!prev || (prev.pass == null && it.pass != null)) byId.set(it.id, it);
    else if (!prev) byId.set(it.id, it);
  }
  // Stable order: desk must, then live extras, then school sequence (always awaiting).
  const ordered = [...c.deskMust.map((d) => byId.get(d.id) ?? d), ...c.liveLayers.filter((l) => !c.deskMust.some((d) => d.id === l.id)), ...c.sessionGates, ...c.schoolSequence];
  return ordered.map((it) => ({
    id: it.id,
    label: it.label,
    must: it.must,
    state: itemState(it),
    detail: it.detail?.trim() || (it.pass == null ? "awaiting model data" : ""),
    source: it.source,
  }));
}

function deskLineFromBundle(sig: FloorSchoolSignatureLines, books: TalkWorld["books"], who: Character, school: FloorSchoolSeatId): SchoolDeskLine {
  if (sig.smcThesis?.trim()) {
    return { school, who, line: sig.smcThesis.trim(), source: "smc-master", empty: false };
  }
  if (sig.smcMissing?.trim()) {
    const detail = sig.smcMissingDetail ? ` — ${sig.smcMissingDetail}` : "";
    return { school, who, line: `missing ${sig.smcMissing}${detail}`, source: "smc-master", empty: false };
  }
  const book = pickBook(books);
  if (book?.smcWord) {
    const miss = book.smcMissing ? ` · missing ${book.smcMissing}` : "";
    return { school, who, line: `${book.say} seq ${book.smcWord}${miss}`, source: "book", empty: false };
  }
  // Creed / first canon step — identity plate, not a live score.
  const step = sig.canonSequence[0];
  if (step) return { school, who, line: `${sig.creed}`, source: "creed", empty: true };
  return { school, who, line: "awaiting model data", source: "awaiting-model", empty: true };
}

function pickBook(books: TalkWorld["books"]): TapeBook | null {
  return books.QQQ ?? books.SPY ?? null;
}

export function debatePanel(manager: ManagerRoomState | null, lastSteer: ManagerSteer | null = null): DebatePanel {
  if (!manager) {
    return {
      phase: "—",
      beat: null,
      address: null,
      line: "awaiting Manager feed",
      thesis: null,
      floorCite: null,
      pathCite: null,
      debateCite: null,
      blocks: [],
      lenses: [],
      roomP: null,
      empty: true,
      source: "awaiting",
    };
  }
  const call = manager.call;
  const lenses = (Object.entries(call?.lenses ?? {}) as [Character, number][])
    .filter(([, p]) => Number.isFinite(p))
    .map(([who, p]) => ({ who, p }))
    .sort((a, b) => b.p - a.p);
  const steerLine = lastSteer?.line ?? null;
  const thesis = call?.reasoning.thesis?.trim() || null;
  return {
    phase: manager.current,
    beat: lastSteer?.beat ?? null,
    address: lastSteer?.address ?? null,
    line: steerLine || thesis || `${manager.current} · Floor ${manager.floor.verdict} · PATH ${manager.path.band ?? "—"}`,
    thesis,
    floorCite: call?.reasoning.floorCite ?? null,
    pathCite: call?.reasoning.pathCite ?? null,
    debateCite: call?.reasoning.debateCite ?? null,
    blocks: call?.reasoning.blocks ?? [],
    lenses,
    roomP: call?.roomP ?? null,
    empty: false,
    source: "manager-feed",
  };
}

export function briefingBeat(nowMs: number, w: Pick<TalkWorld, "clock" | "card" | "week" | "feed">, sessionBrief: SessionBrief | null = null): BriefingBeat {
  const p = etWallParts(nowMs);
  const etMin = p.hour * 60 + p.minute;
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)} ET`;
  const weekday = w.clock.isWeekday;
  const until = (target: number) => (target - etMin + 1440) % 1440;

  let phase: BriefingPhase;
  let label: string;
  let inMin = 0;
  if (!weekday || w.clock.holiday) {
    phase = "weekend";
    label = w.clock.holiday ? "Exchange holiday — no briefing beat" : "Weekend — next council Mon 08:30 ET";
    inMin = until(COUNCIL_START);
  } else if (etMin >= COUNCIL_START && etMin < COUNCIL_END) {
    phase = "council";
    label = "08:30 ET goal council window";
  } else if (etMin >= DIRECTOR.briefStartMin && etMin < DIRECTOR.briefEndMin) {
    phase = "morning_brief";
    label = "Morning brief at the board";
  } else if (etMin >= DIRECTOR.briefEndMin && etMin < 11 * 60) {
    phase = "open";
    label = "Session open — briefing done";
  } else if (etMin < COUNCIL_START) {
    phase = "pre";
    label = "Pre-council";
    inMin = until(COUNCIL_START);
  } else {
    phase = "done";
    label = "Briefing complete for today";
    inMin = until(COUNCIL_START);
  }

  const lines: string[] = [];
  // SessionBrief live fields only — never invent path text.
  if (sessionBrief) {
    if (sessionBrief.primaryPath) lines.push(`Session path: ${sessionBrief.primaryPath}`);
    for (const g of sessionBrief.gates.slice(0, 4)) {
      lines.push(`${g.ok ? "✓" : "✗"} ${g.label}${g.detail ? ` — ${g.detail}` : ""}`);
    }
  }
  if (w.week?.headline) lines.push(w.week.headline);
  if (w.week?.today) {
    lines.push(`${w.week.today.date}: ${w.week.today.trade}`);
    if (w.week.today.dailyBias) lines.push(`Bias: ${w.week.today.dailyBias}`);
    for (const n of w.week.today.news.slice(0, 3)) lines.push(`${n.timeEt} ${n.name} (${n.impact})`);
  }
  if (w.card) lines.push(`Card ${w.card.verdict} · ${w.card.futSymbol} ${w.card.futSide}${w.card.strategy ? ` · ${w.card.strategy}` : ""}`);
  if (w.clock.blackout) lines.push(`Blackout: ${w.clock.blackoutReason ?? "news"}`);
  if (w.feed.kind === "synthetic") lines.push("Feed is SYN — briefing is presentation only");

  const awaitingModel = lines.length === 0;
  if (awaitingModel) lines.push("awaiting model data");

  return { phase, label, clock, inMin, lines: lines.slice(0, 8), awaitingModel };
}

function ranksFromBundles(bundles: FloorSchoolSeatBundle[]): HitRank[] {
  const rows: HitRank[] = bundles.map((b) => {
    const t = b.hitRate.track;
    const n = t?.n ?? 0;
    const hitRate = t?.hitRate ?? null;
    const meanP = t?.meanP ?? null;
    // strategyHitBySchool is always null per Stand — never invent WR.
    if (n > 0 && hitRate != null && Number.isFinite(hitRate)) {
      return {
        who: b.meta.avatar,
        school: b.meta.id,
        hitRate,
        meanP,
        n,
        rank: null,
        credibility: b.hitRate.credibilityRank,
        label: `${Math.round(hitRate * 100)}% hit · n ${n}${meanP != null ? ` · said ${Math.round(meanP * 100)}%` : ""}`,
        source: "lab-track" as const,
      };
    }
    const cred = b.hitRate.credibilityRank;
    return {
      who: b.meta.avatar,
      school: b.meta.id,
      hitRate: null,
      meanP: null,
      n: 0,
      rank: null,
      credibility: cred,
      label: cred != null ? `no scored plans · credibility ${cred}` : "no scored plans · awaiting model data",
      source: "awaiting-model" as const,
    };
  });
  const scored = rows.filter((r) => r.hitRate != null).sort((a, b) => b.hitRate! - a.hitRate! || b.n - a.n);
  scored.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

const CREW_CHARS: readonly Character[] = ["Gemma", "Jax", "Nova", "Sterling", "Vince"];

export function bodyLanguage(minds: MindsRead | null, entryMood: "WAIT" | "STALKING" | "ARMED" | "ENTER" | null): BodyLang[] {
  return CREW_CHARS.map((who) => {
    const school = FLOOR_AVATAR_SCHOOL[who];
    const n = minds?.needs?.[who];
    if (!n) return { who, anim: schoolDefaultAnim(school), reason: "no mind state" };
    if (n.stress >= 0.7) return { who, anim: "CROSSING_ARMS", reason: `stress ${Math.round(n.stress * 100)}%` };
    if (n.fatigue >= 0.7) return { who, anim: "STRETCH", reason: `fatigue ${Math.round(n.fatigue * 100)}%` };
    if (n.boredom >= 0.7) return { who, anim: "CHECKING_TABLET", reason: `boredom ${Math.round(n.boredom * 100)}%` };
    if (entryMood === "ARMED" || entryMood === "ENTER") {
      return { who, anim: who === "Sterling" ? "CROSSING_ARMS" : "ANALYZING", reason: `entry ${entryMood}` };
    }
    if (entryMood === "STALKING") return { who, anim: "STEADY_MONITORING", reason: "entry STALKING" };
    if (n.caffeine >= 0.65) return { who, anim: "FURIOUS_TYPING", reason: `caffeine ${Math.round(n.caffeine * 100)}%` };
    return { who, anim: schoolDefaultAnim(school), reason: "steady" };
  });
}

function schoolDefaultAnim(school: FloorSchoolSeatId): BodyLangKey {
  if (school === "tjr") return "FURIOUS_TYPING";
  if (school === "blake") return "ANALYZING";
  if (school === "patty") return "CROSSING_ARMS";
  if (school === "smc") return "STEADY_MONITORING";
  return "CHECKING_TABLET";
}

export function relationshipLinks(minds: MindsRead | null, minStrength = 0.15): RelLink[] {
  if (!minds?.rel) return [];
  const out: RelLink[] = [];
  const seen = new Set<string>();
  for (const a of CREW_CHARS) {
    for (const b of CREW_CHARS) {
      if (a === b) continue;
      const key = [a, b].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const r1 = minds.rel[a]?.[b];
      const r2 = minds.rel[b]?.[a];
      if (!r1 && !r2) continue;
      const affinity = ((r1?.affinity ?? 0) + (r2?.affinity ?? 0)) / 2;
      const respect = ((r1?.respect ?? 0) + (r2?.respect ?? 0)) / 2;
      const strength = Math.min(1, (Math.abs(affinity) + Math.abs(respect)) / 2);
      if (strength < minStrength) continue;
      const tone: RelLink["tone"] =
        affinity >= 0.25 && respect >= 0.1 ? "warm" : affinity <= -0.25 ? "frayed" : respect < -0.15 ? "cool" : "neutral";
      out.push({ a, b, affinity, respect, strength, tone });
    }
  }
  return out.sort((x, y) => y.strength - x.strength);
}

/**
 * Widen one Stand bundle with whatever live inputs the room has.
 * Leaves stub/TODO nulls alone (smcThesis, schoolSequence.pass, strategyHitBySchool).
 */
export function widenBundle(
  id: FloorSchoolSeatId,
  hook: SchoolModelHook,
  labLite: LabLite | null,
): FloorSchoolSeatBundle {
  let b = floorSchoolSeatBundle(id);
  const smc = hook.smcMaster ?? null;
  if (smc) {
    b = {
      ...b,
      signature: widenSignatureFromSmc(b.signature, smc),
      checklist: widenMustFromSmcLayers(b.checklist, smc.oneBook?.layers ?? smc.left.layers),
    };
  }
  if (hook.canonStack) b = { ...b, checklist: widenMustFromCanonStack(b.checklist, hook.canonStack) };
  if (hook.sessionBrief) b = { ...b, checklist: widenMustFromSessionBrief(b.checklist, hook.sessionBrief) };
  const lab = hook.labRead ?? labReadFromLite(labLite);
  b = {
    ...b,
    hitRate: widenHitRateFromLab(b.hitRate, lab, hook.minds ?? null),
    debate: widenDebateFromManager(b.debate, null, null),
  };
  return b;
}

export function buildSchoolFloor(
  w: TalkWorld,
  opts: {
    manager?: ManagerRoomState | null;
    lastSteer?: ManagerSteer | null;
    entryMood?: "WAIT" | "STALKING" | "ARMED" | "ENTER" | null;
    hook?: SchoolModelHook;
  } = {},
): SchoolFloor {
  const hook: SchoolModelHook = opts.hook ?? AWAITING_SCHOOL_MODEL;
  const bundles = FLOOR_SCHOOL_SEAT_IDS.map((id) => widenBundle(id, hook, w.lab));

  // Manager debate is shared (chair), not per-seat — widen display panel once.
  const debate = debatePanel(opts.manager ?? null, opts.lastSteer ?? null);
  for (let i = 0; i < bundles.length; i++) {
    bundles[i] = {
      ...bundles[i]!,
      debate: widenDebateFromManager(bundles[i]!.debate, opts.manager ?? null, opts.lastSteer ?? null),
    };
  }

  const disciples: SchoolDisciple[] = bundles.map((b) => ({
    who: b.meta.avatar,
    school: b.meta.id,
    schoolName: SCHOOL_SHORT[b.meta.id],
    role: ROLE[b.meta.avatar],
    creed: b.meta.creed,
    accent: SCHOOL_ACCENT[b.meta.id],
    deskId: `desk_${b.meta.avatar}`,
    deskPos: DESK_POS[b.meta.avatar],
    sequence: b.meta.canon.sequence,
    style: b.meta.style,
  }));

  const desks = bundles.map((b) => deskLineFromBundle(b.signature, w.books, b.meta.avatar, b.meta.id));

  // Shared desk must-checklist from first seat (CONFLUENCE_STACK identical) + any live layers.
  const checklist = flattenChecklist(bundles[0]!.checklist);

  return {
    hook,
    bundles,
    disciples,
    desks,
    checklist,
    debate,
    briefing: briefingBeat(w.nowMs, w, hook.sessionBrief ?? null),
    ranks: ranksFromBundles(bundles),
    body: bodyLanguage(w.minds, opts.entryMood ?? null),
    rels: relationshipLinks(w.minds),
  };
}

/** Re-export Stand helpers Prototype Lab may want beside Floor props. */
export { allFloorSchoolSeatBundles, floorSchoolSeatBundle, FLOOR_SCHOOL_SEAT_IDS, FLOOR_SCHOOL_AVATAR };
