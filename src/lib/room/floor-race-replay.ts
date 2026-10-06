/**
 * Floor 3D overhaul Chunk D (34–35): race animation + session-moment scrubber — pure presentation.
 *
 * 34  Visual race among school/seat runners from real paper-seat equity vs the goal.
 * 35  Scrub/replay of floor session moments from real seat events / closed paper / book events.
 *
 * Never invents win rates, P&L, or history. Missing seats/goal → labelled empty.
 * Plaque labels use SCHOOL_SHORT only (never Stand meta.label surnames).
 */

import type { Character } from "./orchestrator";
import type { GoalLite, SeatsLite } from "./live-types";
import type { RoomClosedTrade, RoomEvent } from "./paper-book";
import { FLOOR_AVATAR_SCHOOL, type FloorSchoolSeatId } from "./floor-school-contracts";
import { SCHOOL_ACCENT, SCHOOL_SHORT } from "./school-contract";
import { contractName, usd } from "./format";

const CREW_COLOR: Record<Character, string> = {
  Jax: "#e4572e",
  Nova: "#a78bfa",
  Sterling: "#ef4444",
  Gemma: "#22c55e",
  Vince: "#22d3ee",
};

export interface RaceRunner {
  id: string;
  who: Character | null;
  school: FloorSchoolSeatId | null;
  /** SCHOOL_SHORT or "Room" — never founder surnames. */
  label: string;
  equity: number;
  pnl: number;
  /** 0..1 along the goal track from start → target. */
  progress: number;
  status: "running" | "hit" | "floor";
  isLeader: boolean;
  color: string;
}

export interface RaceAnim {
  empty: boolean;
  reason: string | null;
  start: number;
  target: number;
  leaderLabel: string | null;
  runners: RaceRunner[];
  sessions: number;
  touches: number;
}

export type MomentKind = "seat" | "close" | "book";

export interface SessionMoment {
  id: string;
  at: number;
  kind: MomentKind;
  title: string;
  detail: string;
  who: Character | null;
  /** SCHOOL_SHORT when a school presenter; never a surname. */
  schoolShort: string | null;
  usd: number | null;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** School plaque label for a cast member — SCHOOL_SHORT only. */
export function schoolShortFor(who: Character | null): string | null {
  if (!who) return null;
  const id = FLOOR_AVATAR_SCHOOL[who];
  return id ? SCHOOL_SHORT[id] : null;
}

function runnerLabel(row: { owner: Character | null; name: string }): { school: FloorSchoolSeatId | null; label: string; color: string } {
  if (row.owner) {
    const school = FLOOR_AVATAR_SCHOOL[row.owner];
    return { school, label: SCHOOL_SHORT[school], color: SCHOOL_ACCENT[school] ?? CREW_COLOR[row.owner] };
  }
  return { school: null, label: row.name === "The Room" ? "Room" : row.name, color: "#94a3b8" };
}

/**
 * 34 — who is winning the session race from real seat equity. No invented WRs.
 * Empty when seats or goal are missing (lab has not started a race yet).
 */
export function raceAnimFrom(seats: SeatsLite | null, goal: GoalLite | null): RaceAnim {
  if (!seats || !goal) {
    return {
      empty: true,
      reason: !seats && !goal ? "awaiting seats and goal" : !seats ? "awaiting seats" : "awaiting goal",
      start: goal?.start ?? 0,
      target: goal?.target ?? 0,
      leaderLabel: null,
      runners: [],
      sessions: seats?.sessions ?? 0,
      touches: seats?.touches ?? 0,
    };
  }
  const span = Math.max(1, goal.target - goal.start);
  const leaderId = seats.leader;
  const runners: RaceRunner[] = seats.rows.map((r) => {
    const { school, label, color } = runnerLabel(r);
    const progress =
      r.status === "hit" ? 1 : r.status === "floor" ? 0 : clamp01((r.equity - goal.start) / span);
    return {
      id: r.id,
      who: r.owner,
      school,
      label,
      equity: r.equity,
      pnl: r.pnl,
      progress,
      status: r.status,
      isLeader: r.id === leaderId || (leaderId != null && r.name === leaderId),
      color,
    };
  });
  const lead = runners.find((x) => x.isLeader) ?? null;
  return {
    empty: false,
    reason: null,
    start: goal.start,
    target: goal.target,
    leaderLabel: lead?.label ?? null,
    runners,
    sessions: seats.sessions,
    touches: seats.touches,
  };
}

function seatMomentText(ev: SeatsLite["events"][number], nameOf: (id: string | null) => string): { title: string; detail: string } {
  const who = nameOf(ev.seat);
  switch (ev.kind) {
    case "open":
      return { title: `${who} opened`, detail: `${ev.qty ?? "?"}× ${ev.contract ?? "contract"}${ev.debit != null ? ` · ${usd(ev.debit)}` : ""}` };
    case "close":
      return { title: `${who} closed`, detail: `${ev.contract ?? "position"}${ev.usd != null ? ` · ${ev.usd >= 0 ? "+" : "−"}${usd(Math.abs(ev.usd))}` : ""}${ev.why ? ` · ${ev.why}` : ""}` };
    case "skip":
      return { title: `${who} passed`, detail: ev.why ?? "no reason recorded" };
    case "blocked":
      return { title: `${who} blocked`, detail: `${ev.gate ? `${ev.gate}` : "gate"}${ev.why ? ` · ${ev.why}` : ""}` };
    case "lead":
      return { title: `${who} took the lead`, detail: ev.equity != null ? usd(ev.equity) : "—" };
    case "finish":
      return { title: `${who} finished`, detail: ev.why ?? "—" };
    case "syndicate":
      return { title: "Syndicate", detail: `${ev.n ?? ev.members?.length ?? 2} seats${ev.contract ? ` · ${ev.contract}` : ""}` };
    case "syndicate_closed":
      return { title: "Syndicate closed", detail: ev.usd != null ? `${ev.usd >= 0 ? "+" : "−"}${usd(Math.abs(ev.usd))}` : "—" };
    default:
      return { title: "Race started", detail: ev.why ?? "paper seats opened" };
  }
}

/**
 * 35 — session moments from real desk/school history only.
 * Seat events (paper race), closed room trades, and book event log — never fabricated.
 */
export function sessionMoments(args: {
  seats: SeatsLite | null;
  closed: readonly RoomClosedTrade[];
  bookEvents?: readonly RoomEvent[];
}): SessionMoment[] {
  const out: SessionMoment[] = [];
  const nameOf = (id: string | null): string => {
    if (!id) return "someone";
    const row = args.seats?.rows.find((r) => r.id === id);
    if (row) return runnerLabel(row).label;
    return id;
  };
  const whoOfSeat = (id: string | null): Character | null => {
    if (!id) return null;
    return args.seats?.rows.find((r) => r.id === id)?.owner ?? null;
  };

  for (const ev of args.seats?.events ?? []) {
    const who = whoOfSeat(ev.seat);
    const { title, detail } = seatMomentText(ev, nameOf);
    out.push({
      id: `seat:${ev.id}`,
      at: ev.at,
      kind: "seat",
      title,
      detail,
      who,
      schoolShort: schoolShortFor(who),
      usd: ev.usd,
    });
  }

  for (const c of args.closed) {
    const name = contractName(c.ticker, c.strike, c.type, c.exp);
    out.push({
      id: `close:${c.id}:${c.closedAt}`,
      at: c.closedAt,
      kind: "close",
      title: `Room closed ${name}`,
      detail: `${c.pnlUsd >= 0 ? "+" : "−"}${usd(Math.abs(c.pnlUsd))} · ${c.reason}`,
      who: null,
      schoolShort: null,
      usd: c.pnlUsd,
    });
  }

  for (const e of args.bookEvents ?? []) {
    // Skip the empty-book open line when nothing else has happened yet — still real, but noisy alone.
    out.push({
      id: `book:${e.at}:${e.kind}:${e.text.slice(0, 24)}`,
      at: e.at,
      kind: "book",
      title: `Book · ${e.kind}`,
      detail: e.text,
      who: null,
      schoolShort: null,
      usd: null,
    });
  }

  out.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  // Cap for presentation; still only real rows.
  return out.slice(0, 80);
}

/** Selected moment for the scrubber — null when the list is empty or index is out of range. */
export function scrubMoment(moments: readonly SessionMoment[], index: number | null): SessionMoment | null {
  if (index == null || moments.length === 0) return null;
  const i = Math.min(moments.length - 1, Math.max(0, Math.floor(index)));
  return moments[i] ?? null;
}

/** Signature fragment for FloorProps redraw gating. */
export function raceReplaySignature(race: RaceAnim, moments: readonly SessionMoment[]): unknown {
  return {
    empty: race.empty,
    reason: race.reason,
    leader: race.leaderLabel,
    runners: race.runners.map((r) => [r.id, r.label, Math.round(r.progress * 1000), r.status, r.isLeader, Math.round(r.equity)]),
    moments: moments.slice(0, 12).map((m) => [m.id, m.at, m.kind, m.title]),
  };
}
