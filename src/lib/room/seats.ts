/**
 * THE SEATS — five people, five $1,000 paper accounts, one goal.
 *
 * The trader's goal (2026-10-05) is $1,000 → $5,000 in one to two weeks of live options. The five are agents with
 * that goal and three standing jobs: COMPETE (each trades its own account off the same live desk cards, by its own
 * style, and the league ranks them), COOPERATE (two or more taking the same card form a syndicate with shared
 * credit and blame; "The Room" is a sixth account that only takes what at least three of the five back), and
 * IMPROVE THE DESK (rnd.ts: each owns a pre-registered experiment on the evidence these accounts and the ghost
 * room produce, and proposes — in words, for the trader — what the numbers support).
 *
 * WHAT A SEAT IS
 * A seat is not a model. It is the room's own checklist (orchestrator.ts evaluateEntry — the same function, the
 * same gates, the same halts, with that seat's cash, positions and counters) plus a style. Every HARD rule binds
 * every seat exactly as it binds the room: the market hours, the desk's ARMED word and ticket, 0–1 DTE, the daily
 * and weekly halts, the loss cool-down, the slots, one book, one bias, never average, the killzone and month caps,
 * the cash cap, the clock (decay alone reaching the stop), before the 11:00 flat. Positions mark and exit through
 * the one place a simulated position ends (lab.ts stepGhost: the −20% backstop, +40% trim, the level, 11:00,
 * 15:30), so no seat can exit on a rule the room does not have.
 *
 * What a style may do is judge what the rules leave to judgement: Nova's two pricing questions (the ticket's own EV
 * after costs and T1 paying) are SOFT — the room's addition on top of the desk, not measured to pick better
 * tickets — so each person decides on them for themselves, and Jax overrides them. A declined ticket is not
 * forgotten: it opens a ghost at that seat's size and is followed to its end, so what every judgement was worth is
 * measured on the same tape. Nothing here is a fill, a gate or an order: paper only, never the house book, never
 * the broker, never src/lib/aplus/config.ts.
 *
 * The seats do not tune themselves. At about one qualifying ticket in five sessions a seat will see two or three
 * decisions in the whole window; adapting a size on two outcomes is fitting noise. What the evidence supports is
 * reported by rnd.ts with its sample sizes, and applying a change is the trader's.
 */

import { APLUS_RULES } from "@/lib/aplus/config";
import { emptyCounters, ledgerOfCounters, rollCountersOf, type RoomCounters } from "./counters";
import { contractName, usd } from "./format";
import { entriesOpen, goalClock, policyOf, type GoalSpec } from "./goal";
import { htfAligned, ROOM_POLICY } from "./exits";
import { ghostFrom, optionsOpen, stepGhost, type GhostPos, type RoomLab } from "./lab";
import { etDateOf, type Underlier } from "./option-math";
import { ladderSteps } from "./contract-ladder";
import { evaluateEntry, expiryFor, planKey, type Character, type EntryEval, type EntryOpts, type RoomDeskRead, type RoomEntryRead, type RoomInput, type RoomPositionIn, type UnderlierTape } from "./orchestrator";
import type { OptionEv } from "./quant";
import { etWallParts } from "@/lib/trading/sessions";

/* ── The seats ─────────────────────────────────────────────────────────── */

export const PERSONAL_SEATS = ["protect", "mechanical", "structure", "edge", "press"] as const;
export const SEAT_IDS = [...PERSONAL_SEATS, "room"] as const;
export type SeatId = (typeof SEAT_IDS)[number];

export const SEAT_OWNER: Record<SeatId, Character | null> = {
  protect: "Sterling",
  mechanical: "Vince",
  structure: "Gemma",
  edge: "Nova",
  press: "Jax",
  room: null,
};
export const SEAT_NAME: Record<SeatId, string> = {
  protect: "Sterling",
  mechanical: "Vince",
  structure: "Gemma",
  edge: "Nova",
  press: "Jax",
  room: "The Room",
};
export const SEAT_STYLE: Record<SeatId, string> = {
  protect: "A and A+ only, priced twice (the realized decile must not be negative), 25% tickets, one a day — the contract nearest the money that fits",
  mechanical: "the room's rules and the room's two strikes at the experiment's ticket cap, nothing added",
  structure: "only what the higher timeframe backs and that carries no inducement or mitigation block, 40% tickets, one a day",
  edge: "stakes each ticket by its own priced edge (Kelly on the three paths) on the contract with the most EV per dollar — nothing when the edge is not positive",
  press: "overrides Nova's two pricing questions and buys the contract that puts the most delta to work for the cap",
  room: "takes a card only when at least three of the five back it, on the room's two strikes",
};
/** How a seat picks its contract: the room's own chooser (the money or one out), or from the whole ladder. */
export type Chooser = "room" | "nearest" | "ev" | "delta";
export const SEAT_CHOOSER: Record<SeatId, Chooser> = { protect: "nearest", mechanical: "room", structure: "room", edge: "ev", press: "delta", room: "room" };
export const ROOM_BACKERS = 3;
/** The soft gates: Nova's two questions about the OPTION on the plan. Everything else the checklist asks is hard. */
export const SOFT_GATES: ReadonlySet<string> = new Set(["ev", "t1_pays"]);
/** What every seat reads the same way (the desk's card and the clock, not the seat's own account). */
const SHARED_GATES = ["market", "desk", "fresh_tape", "card", "desk_word", "desk_ticket", "dte", "before_flat"] as const;

const KEEP = { closed: 60, skipped: 60, decisions: 40, events: 80, touches: 120, curve: 150, syndicates: 60, seen: 60 } as const;
const money = (n: number) => Math.round(n * 100) / 100;

/* ── State ─────────────────────────────────────────────────────────────── */

export type SeatDecisionAction = "take" | "skip" | "blocked";

export interface SeatDecision {
  at: number;
  planKey: string;
  action: SeatDecisionAction;
  gate: string | null;
  why: string;
  qty: number;
  debitUsd: number;
  ticket: string | null;
  override: string | null;
}

export interface SeatClosed {
  id: string;
  ticker: Underlier;
  type: GhostPos["type"];
  strike: number;
  exp: string;
  qty0: number;
  entryPx: number;
  openedAt: number;
  closedAt: number;
  pnlUsd: number;
  reason: string;
  planKey: string | null;
  syn: string | null;
  override: string | null;
}

export interface SeatStats {
  opened: number;
  closed: number;
  wins: number;
  /** Total P&L of every closed ticket (trims included) — the open ones are not in it. */
  realizedUsd: number;
  peak: number;
  trough: number;
}

export interface Seat {
  id: SeatId;
  status: "running" | "hit" | "floor";
  finishedAt: number | null;
  counters: RoomCounters;
  positions: GhostPos[];
  /** Tickets declined by judgement, followed to their end at the size the seat would have bought. */
  skipped: GhostPos[];
  closed: SeatClosed[];
  stats: SeatStats;
  decisions: SeatDecision[];
  curve: { at: number; eq: number }[];
}

export interface TouchRec {
  key: string;
  at: number;
  etDate: string;
  symbol: string;
  side: "long" | "short";
  band: string | null;
  per: Partial<Record<SeatId, SeatDecisionAction>>;
}

export interface Syndicate {
  id: string;
  planKey: string;
  etDate: string;
  at: number;
  /** Held a ticket · declined by judgement · blocked by a rule. */
  members: SeatId[];
  dissent: SeatId[];
  abstain: SeatId[];
  /** When every member's ticket has closed: what they made together, and what the dissenters' declined tickets made. */
  closedUsd: number | null;
  dissentUsd: number | null;
}

export type SeatEventKind = "start" | "open" | "close" | "skip" | "blocked" | "finish" | "lead" | "syndicate" | "syndicate_closed";

export interface SeatEvent {
  id: string;
  at: number;
  kind: SeatEventKind;
  seat: SeatId | null;
  planKey: string | null;
  usd: number | null;
  qty: number | null;
  debit: number | null;
  contract: string | null;
  gate: string | null;
  why: string | null;
  equity: number | null;
  n: number | null;
  members: SeatId[] | null;
}

export interface SeatBook {
  version: 1;
  goalKey: string;
  goal: GoalSpec;
  seq: number;
  startedAt: number;
  seats: Seat[];
  syndicates: Syndicate[];
  touches: TouchRec[];
  events: SeatEvent[];
  /** The session dates (ET) the seats watched with the options market open inside the window — the denominator of "tickets a session". */
  seen: string[];
  leader: SeatId | null;
}

export function goalKeyOf(g: GoalSpec): string {
  return [g.start, g.target, g.startDate, g.tradingDays, g.floorFrac, g.capFrac, g.minDelta, g.minAskUsd].join("|");
}

function emptySeat(id: SeatId, start: number): Seat {
  return {
    id,
    status: "running",
    finishedAt: null,
    counters: emptyCounters(start),
    positions: [],
    skipped: [],
    closed: [],
    stats: { opened: 0, closed: 0, wins: 0, realizedUsd: 0, peak: start, trough: start },
    decisions: [],
    curve: [],
  };
}

/** A fresh race. `seq0` carries the history counter over a restart, so the backup's "richer wins" never prefers the old race. */
export function newSeatBook(goal: GoalSpec, nowMs: number, seq0 = 0): SeatBook {
  return {
    version: 1,
    goalKey: goalKeyOf(goal),
    goal,
    seq: seq0 + 1,
    startedAt: nowMs,
    seats: SEAT_IDS.map((id) => emptySeat(id, goal.start)),
    syndicates: [],
    touches: [],
    events: [blankEvent(`E${seq0 + 1}`, nowMs, "start", { equity: goal.start, why: `${usd(goal.start)} → ${usd(goal.target)}` })],
    seen: [],
    leader: null,
  };
}

function blankEvent(id: string, at: number, kind: SeatEventKind, over: Partial<SeatEvent> = {}): SeatEvent {
  return { id, at, kind, seat: null, planKey: null, usd: null, qty: null, debit: null, contract: null, gate: null, why: null, equity: null, n: null, members: null, ...over };
}

export function asSeatBook(x: unknown): SeatBook | null {
  const b = x as Partial<SeatBook> | null | undefined;
  if (!b || b.version !== 1 || !b.goal || !Array.isArray(b.seats) || b.seats.length !== SEAT_IDS.length) return null;
  if (!Array.isArray(b.syndicates) || !Array.isArray(b.touches) || !Array.isArray(b.events) || !Array.isArray(b.seen)) return null;
  return b as SeatBook;
}

/** The lab with a race that matches this goal: kept when the goal is unchanged, restarted (history carried) when it is not. */
export function ensureSeats(lab: RoomLab, goal: GoalSpec, nowMs: number): RoomLab {
  const cur = asSeatBook(lab.seats);
  if (cur && cur.goalKey === goalKeyOf(goal)) return lab.seats === cur ? lab : { ...lab, seats: cur };
  return { ...lab, seats: newSeatBook(goal, nowMs, cur?.seq ?? 0) };
}

/* ── Money ─────────────────────────────────────────────────────────────── */

/** Value if every open ticket were sold at the bid it was last marked at. */
export function seatEquity(seat: Seat, start: number): number {
  const open = seat.positions.reduce((s, p) => s + p.realizedUsd + ((p.bid ?? p.entryPx) - p.entryPx) * 100 * p.contracts, 0);
  return money(start + seat.stats.realizedUsd + open);
}

/** Cash: what the account holds besides the contracts still open. */
export function seatCash(seat: Seat, start: number): number {
  return money(start + seat.stats.realizedUsd + seat.positions.reduce((s, p) => s + p.realizedUsd - p.contracts * p.entryPx * 100, 0));
}

/** The seat's ticket share: its own style's, never above the experiment's. */
export function seatCapFrac(id: SeatId, goal: GoalSpec): number {
  if (id === "protect") return Math.min(goal.capFrac, policyOf("protect").frac as number);
  if (id === "structure") return Math.min(goal.capFrac, policyOf("structure").frac as number);
  return goal.capFrac;
}

/* ── A style's judgement ───────────────────────────────────────────────── */

/** Kelly's stake (as a share of equity) for ONE ticket, from its own three priced paths: μ/σ² of the return on the debit. 0 when the edge is not positive. */
export function ticketKelly(ev: OptionEv | null, ask: number): number {
  if (!ev || !(ask > 0)) return 0;
  const cost = ask * 100;
  const rs = ev.scenarios.map((s) => ({ p: s.p, r: s.pnlUsd / cost }));
  const psum = rs.reduce((a, x) => a + x.p, 0);
  if (!(psum > 0)) return 0;
  const mu = rs.reduce((a, x) => a + x.p * x.r, 0) / psum;
  const m2 = rs.reduce((a, x) => a + x.p * x.r * x.r, 0) / psum;
  const variance = m2 - mu * mu;
  return mu > 0 && variance > 0 ? mu / variance : 0;
}

export interface Verdict {
  action: SeatDecisionAction;
  gate: string | null;
  why: string;
  qty: number;
  /** The soft gates this seat took the ticket against (Jax only). */
  override: string | null;
}

const pctTxt = (n: number) => `${Math.round(n * 100)}%`;

/**
 * What one seat does with one card at the touch: the room's hard rules first (blocked — a rule, no judgement, no ghost),
 * then the style (skip — a judgement, a ghost follows it), else take. `backers` is how many of the five took it
 * (only The Room reads it).
 */
export function verdictFor(a: {
  id: SeatId;
  seat: Seat;
  start: number;
  card: RoomEntryRead;
  ev: EntryEval;
  desk: RoomDeskRead | null;
  backers: number;
}): Verdict {
  const { id, seat, card, ev } = a;
  const failed = ev.gates.filter((g) => !g.ok && g.id !== "ev_preview");
  const hard = failed.filter((g) => !SOFT_GATES.has(g.id));
  const soft = failed.filter((g) => SOFT_GATES.has(g.id));
  const blocked = (gate: string | null, why: string): Verdict => ({ action: "blocked", gate, why, qty: 0, override: null });
  const skip = (gate: string, why: string, qty: number): Verdict => ({ action: "skip", gate, why, qty, override: null });
  if (seat.status !== "running") return blocked("finished", seat.status === "hit" ? "the goal is already reached" : "the floor was reached — the experiment is over");
  if (hard[0]) return blocked(hard[0].id, hard[0].label);
  const plan = ev.plan;
  if (!plan || plan.qty < 1) return blocked("cash_cap", "no ticket can be bought");
  const perDay = id === "room" ? APLUS_RULES.maxSetupsPerSession : policyOf(id).perDay;
  if (seat.counters.filledPlans.length >= perDay) return blocked("style_cap", `${perDay} a day, taken`);
  const qty = plan.qty;
  if (soft[0] && id !== "press") return skip(soft[0].id, soft[0].label, qty);
  const override = soft.length ? soft.map((g) => g.id).join("+") : null;

  if (id === "protect") {
    if (card.band !== "A+" && card.band !== "A") return skip("style", `band ${card.band ?? "—"} — Sterling takes A and A+ only`, qty);
    const cal = plan.ev?.calibrated;
    if (cal && cal.evUsd < 0) return skip("style", `the realized-decile EV is ${usd(cal.evUsd)} a contract — priced twice, he passes`, qty);
  }
  if (id === "structure") {
    if (!htfAligned(a.desk?.htf[card.underlier], card.type))
      return skip("style", `the higher timeframe is ${a.desk?.htf[card.underlier] ?? "unread"} — structure does not back a ${card.type === "CALL" ? "call" : "put"}`, qty);
  }
  if (id === "edge") {
    const f = ticketKelly(plan.ev, plan.quote.ask);
    if (!(f > 0)) return skip("style", "this ticket's priced edge is not positive — Kelly stakes nothing", qty);
    const eq = seatEquity(seat, a.start);
    const stake = f * eq;
    const nQty = Math.min(qty, Math.floor(stake / (plan.quote.ask * 100)));
    if (nQty < 1) return skip("style", `Kelly stakes ${pctTxt(f)} = ${usd(stake)}; one contract is ${usd(plan.quote.ask * 100)}`, qty);
    return { action: "take", gate: null, why: `Kelly ${pctTxt(f)} of ${usd(eq)}`, qty: nQty, override };
  }
  if (id === "room" && a.backers < ROOM_BACKERS) return skip("consensus", `${a.backers} of 5 backed it — The Room needs ${ROOM_BACKERS}`, qty);
  return { action: "take", gate: null, why: id === "press" && override ? `overrides ${override}` : "the rules pass", qty, override };
}

/** What depends on which contract is bought; every other gate is the same for every strike. */
const CONTRACT_GATES: ReadonlySet<string> = new Set(["cash_cap", "clock", "t1_pays", "ev", "ev_preview"]);

const hardFails = (ev: EntryEval) => ev.gates.filter((g) => !g.ok && !SOFT_GATES.has(g.id) && g.id !== "ev_preview");

/**
 * One seat's checklist for the card, with the seat's own contract: the room's two strikes for the room's own style,
 * otherwise every strike on the ladder (delta and price floors are the trader's, goal.ts), each run through the same
 * checklist with the contract named. A card/halt/slot gate that fails does not depend on the strike, so it ends the
 * search; otherwise the style chooses among the contracts whose hard gates pass.
 */
export function seatEval(a: {
  id: SeatId;
  card: RoomEntryRead;
  goal: GoalSpec;
  tape: UnderlierTape;
  etDate: string;
  nowMs: number;
  run: (opts: EntryOpts) => EntryEval;
}): EntryEval {
  const base = a.run({});
  const chooser = SEAT_CHOOSER[a.id];
  if (chooser === "room") return base;
  if (base.gates.some((g) => !g.ok && !CONTRACT_GATES.has(g.id))) return base;
  const steps = ladderSteps({ underlier: a.card.underlier, type: a.card.type, spot: a.tape.price, vix: a.tape.vix, exp: expiryFor(a.card.dte, a.etDate), nowMs: a.nowMs, minDelta: a.goal.minDelta, minAskUsd: a.goal.minAskUsd });
  if (!steps.length) return base;
  const evs = steps.map((st) => a.run({ force: st.offset, qtyFrom: a.id === "protect" ? "desk" : "cap" }));
  const fits = evs.filter((ev) => ev.plan && ev.plan.qty >= 1 && hardFails(ev).length === 0);
  // Nothing fits: report the cheapest contract's refusal, so the reason is "$X against a cap of $Y" and not a guess.
  if (!fits.length) return evs[evs.length - 1]!;
  const clean = fits.filter((ev) => ev.gates.every((g) => g.ok || g.id === "ev_preview"));
  const delta = (ev: EntryEval) => Math.abs(ev.plan!.quote.delta);
  if (chooser === "nearest") return clean[0] ?? fits[0]!;
  if (chooser === "ev") {
    const pool = clean.length ? clean : fits;
    return pool.reduce((m, ev) => ((ev.plan!.ev?.evPerDollar ?? -Infinity) > (m.plan!.ev?.evPerDollar ?? -Infinity) ? ev : m), pool[0]!);
  }
  // "delta": the most delta put to work for the cap, soft gates ignored (Jax's style).
  return fits.reduce((m, ev) => (ev.plan!.qty * delta(ev) > m.plan!.qty * delta(m) ? ev : m), fits[0]!);
}

/* ── The step ──────────────────────────────────────────────────────────── */

export interface SeatStepArgs {
  market: Record<Underlier, UnderlierTape>;
  desk: RoomDeskRead | null;
  nowMs: number;
  killzone: string;
}

function positionIn(p: GhostPos): RoomPositionIn {
  return {
    id: p.id,
    ticker: p.ticker,
    type: p.type,
    strike: p.strike,
    exp: p.exp,
    pnl_percent: p.pnlPct,
    contracts: p.contracts,
    trimmed: p.trimmed,
    strike_offset: p.offset,
    entry_px: p.entryPx,
  };
}

const closedRowOf = (p: GhostPos): SeatClosed => ({
  id: p.id,
  ticker: p.ticker,
  type: p.type,
  strike: p.strike,
  exp: p.exp,
  qty0: p.meta?.qty0 ?? p.contracts,
  entryPx: p.entryPx,
  openedAt: p.openedAt,
  closedAt: p.closed?.at ?? p.openedAt,
  pnlUsd: p.closed?.pnlUsd ?? 0,
  reason: p.closed?.reason ?? "",
  planKey: p.planKey,
  syn: p.meta?.syn ?? null,
  override: p.meta?.override ?? null,
});

/** Roll the counters, mark every ticket on the tape and let it exit, enter at the touch, form syndicates, rank. Pure. */
export function stepSeats(prev: SeatBook, a: SeatStepArgs): SeatBook {
  const { market, desk, nowMs } = a;
  const goal = prev.goal;
  const start = goal.start;
  const etDate = etDateOf(nowMs);
  const w = etWallParts(nowMs);
  const etMin = w.hour * 60 + w.minute;
  const open = optionsOpen(nowMs);
  const clock = goalClock(goal, nowMs);
  let seq = prev.seq;
  const events: SeatEvent[] = [];
  const emit = (kind: SeatEventKind, over: Partial<SeatEvent> = {}) => {
    seq += 1;
    events.push(blankEvent(`E${seq}`, nowMs, kind, over));
  };
  const ctx = { market, desk, etDate, etMin, nowMs, open, policy: ROOM_POLICY };
  const nameOf = (p: GhostPos) => contractName(p.ticker, p.strike, p.type, p.exp);

  /* 1 — every seat: roll the counters, mark, exit. */
  let seats: Seat[] = prev.seats.map((s0) => {
    const counters = rollCountersOf(s0.counters, seatEquity(s0, start), nowMs, a.killzone);
    const stats = { ...s0.stats };
    const positions: GhostPos[] = [];
    const closedNow: SeatClosed[] = [];
    for (const p0 of s0.positions) {
      const p = stepGhost(p0, ctx);
      const total = p.closed ? p.closed.pnlUsd : p.realizedUsd;
      const leg = money(total - p0.realizedUsd);
      if (leg !== 0) {
        counters.realizedToday = money(counters.realizedToday + leg);
        counters.realizedWeek = money(counters.realizedWeek + leg);
      }
      if (p.closed) {
        stats.realizedUsd = money(stats.realizedUsd + p.closed.pnlUsd);
        stats.closed += 1;
        if (p.closed.pnlUsd > 0) stats.wins += 1;
        counters.consecLosses = p.closed.pnlUsd < 0 ? counters.consecLosses + 1 : 0;
        closedNow.push(closedRowOf(p));
        emit("close", { seat: s0.id, planKey: p.planKey, usd: p.closed.pnlUsd, qty: p.meta?.qty0 ?? p.contracts, contract: nameOf(p), why: p.closed.reason });
      } else positions.push(p);
    }
    const skipped = s0.skipped.map((g) => stepGhost(g, ctx));
    const mid: Seat = { ...s0, counters, stats, positions, skipped: capSkipped(skipped), closed: [...s0.closed, ...closedNow].slice(-KEEP.closed) };
    return mid;
  });

  /* 2 — status: the goal, or the floor, latches. */
  seats = seats.map((s) => {
    const eq = seatEquity(s, start);
    const stats = { ...s.stats, peak: Math.max(s.stats.peak, eq), trough: Math.min(s.stats.trough, eq) };
    let { status, finishedAt } = s;
    if (status === "running" && eq >= goal.target) {
      status = "hit";
      finishedAt = nowMs;
      emit("finish", { seat: s.id, equity: eq, why: "hit" });
    } else if (status === "running" && eq <= start * goal.floorFrac && goal.floorFrac > 0) {
      status = "floor";
      finishedAt = nowMs;
      emit("finish", { seat: s.id, equity: eq, why: "floor" });
    }
    return { ...s, stats, status, finishedAt };
  });

  /* 3 — the touch. A card at its CE, with a ticket, on a window day before 11:00, is decided by every seat once. */
  const touches = [...prev.touches];
  let syndicates = [...prev.syndicates];
  const canEnter = entriesOpen(clock) && open && desk != null;
  const card = canEnter ? desk!.entry : null;
  const seen = [...prev.seen];
  if (open && clock.state === "running" && clock.dates.includes(etDate) && !seen.includes(etDate)) seen.push(etDate);

  if (card && card.tier === "live" && card.plan && (card.deskContracts ?? 0) >= 1) {
    const pk = planKey(card);
    const key = `${pk}:${etDate}`;
    let ti = touches.findIndex((t) => t.key === key);
    const evals = new Map<SeatId, EntryEval>();
    const evalFor = (id: SeatId): EntryEval => {
      const s = seats.find((x) => x.id === id)!;
      const input: RoomInput = { portfolio: { cash: seatCash(s, start), open_positions: s.positions.map(positionIn) }, market_data: market };
      const run = (opts: EntryOpts) =>
        evaluateEntry(input, { desk, ledger: ledgerOfCounters(s.counters), minds: null, lab: null }, etDate, etMin, nowMs, open, { capFrac: seatCapFrac(id, goal), ...opts });
      return seatEval({ id, card, goal, tape: market[card.underlier], etDate, nowMs, run });
    };
    const first = evalFor("mechanical");
    evals.set("mechanical", first);
    const sharedOk = SHARED_GATES.every((id) => first.gates.some((g) => g.id === id && g.ok));
    if (sharedOk) {
      if (ti < 0) {
        touches.push({ key, at: nowMs, etDate, symbol: card.futSymbol, side: card.futSide, band: card.band, per: {} });
        ti = touches.length - 1;
      }
      const rec: TouchRec = { ...touches[ti]!, per: { ...touches[ti]!.per } };
      const decide = (id: SeatId) => {
        const idx = seats.findIndex((x) => x.id === id);
        const seat = seats[idx]!;
        const prior = rec.per[id];
        if (prior === "take" || prior === "skip") return;
        const ev = evals.get(id) ?? evalFor(id);
        const backers = PERSONAL_SEATS.filter((p) => rec.per[p] === "take").length;
        const v = verdictFor({ id, seat, start, card, ev, desk, backers });
        const plan = ev.plan;
        let next = seat;
        if (v.action === "take" && plan) {
          seq += 1;
          const pid = `S${seq}`;
          const pos = ghostFrom(pid, "seat", id, card, plan.quote.strike, plan.exp, plan.offset, v.qty, plan.quote.ask, nowMs);
          pos.meta = { seat: id, qty0: v.qty, syn: null, override: v.override, gate: null };
          const c = { ...seat.counters };
          c.kzEntries += 1;
          c.monthEntries += 1;
          c.filledPlans = [...c.filledPlans, pk];
          if (!c.underlierDay) c.underlierDay = { day: c.dayKey || etDate, underlier: card.underlier };
          const debit = money(v.qty * plan.quote.ask * 100);
          next = {
            ...seat,
            counters: c,
            positions: [...seat.positions, pos],
            stats: { ...seat.stats, opened: seat.stats.opened + 1 },
            decisions: [...seat.decisions, { at: nowMs, planKey: pk, action: "take" as const, gate: null, why: v.why, qty: v.qty, debitUsd: debit, ticket: pid, override: v.override }].slice(-KEEP.decisions),
          };
          emit("open", { seat: id, planKey: pk, qty: v.qty, debit, contract: nameOf(pos), gate: v.override, why: v.why, equity: seatEquity(next, start) });
        } else if (v.action === "skip" && plan) {
          seq += 1;
          const ghost = ghostFrom(`K${seq}`, "skipped", id, card, plan.quote.strike, plan.exp, plan.offset, Math.max(1, v.qty), plan.quote.ask, nowMs);
          ghost.meta = { seat: id, qty0: Math.max(1, v.qty), syn: null, override: null, gate: v.gate };
          next = {
            ...seat,
            skipped: capSkipped([...seat.skipped, ghost]),
            decisions: [...seat.decisions, { at: nowMs, planKey: pk, action: "skip" as const, gate: v.gate, why: v.why, qty: v.qty, debitUsd: 0, ticket: ghost.id, override: null }].slice(-KEEP.decisions),
          };
          emit("skip", { seat: id, planKey: pk, qty: v.qty, contract: nameOf(ghost), gate: v.gate, why: v.why });
        } else if (prior !== "blocked") {
          next = { ...seat, decisions: [...seat.decisions, { at: nowMs, planKey: pk, action: "blocked" as const, gate: v.gate, why: v.why, qty: 0, debitUsd: 0, ticket: null, override: null }].slice(-KEEP.decisions) };
          emit("blocked", { seat: id, planKey: pk, gate: v.gate, why: v.why });
        }
        seats = seats.map((x, i) => (i === idx ? next : x));
        rec.per[id] = v.action;
      };
      for (const id of PERSONAL_SEATS) decide(id);
      decide("room");
      touches[ti] = rec;

      /* Syndicate: two or more seats holding the same card. */
      const takers = SEAT_IDS.filter((id) => rec.per[id] === "take");
      if (takers.length >= 2) {
        const dissent = SEAT_IDS.filter((id) => rec.per[id] === "skip");
        const abstain = SEAT_IDS.filter((id) => rec.per[id] === "blocked");
        const si = syndicates.findIndex((y) => y.planKey === pk && y.etDate === etDate);
        let sid: string;
        if (si < 0) {
          seq += 1;
          sid = `Y${seq}`;
          syndicates.push({ id: sid, planKey: pk, etDate, at: nowMs, members: takers, dissent, abstain, closedUsd: null, dissentUsd: null });
          emit("syndicate", { planKey: pk, members: takers, n: takers.length, why: dissent.length ? `${dissent.map((d) => SEAT_NAME[d]).join(", ")} declined` : null });
        } else {
          sid = syndicates[si]!.id;
          syndicates[si] = { ...syndicates[si]!, members: takers, dissent, abstain };
        }
        seats = seats.map((s) => ({ ...s, positions: s.positions.map((p) => (p.planKey === pk && p.meta && p.openedAt >= touches[ti]!.at && p.meta.syn !== sid ? { ...p, meta: { ...p.meta, syn: sid } } : p)) }));
      }
    }
  }

  /* 4 — a syndicate resolves when every member's ticket has closed; the dissenters' declined tickets say what saying no was worth. */
  syndicates = syndicates.map((y) => {
    if (y.closedUsd != null && (y.dissentUsd != null || y.dissent.length === 0)) return y;
    const mine = seats.flatMap((s) => s.closed.filter((c) => c.syn === y.id));
    const openMine = seats.some((s) => s.positions.some((p) => p.meta?.syn === y.id));
    let { closedUsd, dissentUsd } = y;
    if (closedUsd == null && !openMine && mine.length >= y.members.length) {
      closedUsd = money(mine.reduce((t, c) => t + c.pnlUsd, 0));
      emit("syndicate_closed", { planKey: y.planKey, usd: closedUsd, members: y.members, n: y.members.length });
    }
    if (closedUsd != null && dissentUsd == null && y.dissent.length > 0) {
      const ghosts = seats.flatMap((s) => s.skipped.filter((g) => g.planKey === y.planKey && g.openedAt >= y.at - 60_000 && y.dissent.includes(s.id as SeatId)));
      if (ghosts.length >= y.dissent.length && ghosts.every((g) => g.closed)) dissentUsd = money(ghosts.reduce((t, g) => t + (g.closed?.pnlUsd ?? 0), 0));
    }
    return closedUsd === y.closedUsd && dissentUsd === y.dissentUsd ? y : { ...y, closedUsd, dissentUsd };
  });

  /* 5 — the curve and the lead. */
  seats = seats.map((s) => {
    const eq = seatEquity(s, start);
    const last = s.curve[s.curve.length - 1];
    const dayChanged = !last || etDateOf(last.at) !== etDate;
    return Math.abs(eq - (last?.eq ?? start)) >= 0.5 || dayChanged ? { ...s, curve: [...s.curve, { at: nowMs, eq }].slice(-KEEP.curve) } : s;
  });
  const ranked = [...seats].map((s) => ({ id: s.id, eq: seatEquity(s, start) })).sort((x, y) => y.eq - x.eq);
  const top = ranked[0]!;
  // Ahead of the start and on top; a tie for first keeps the leader who was already there.
  const prevLeaderEq = ranked.find((r) => r.id === prev.leader)?.eq ?? -Infinity;
  const leader: SeatId | null = top.eq <= start ? null : prev.leader && top.eq - prevLeaderEq < 0.5 ? prev.leader : top.id;
  if (leader && leader !== prev.leader) emit("lead", { seat: leader, equity: top.eq, usd: top.eq - (ranked[1]?.eq ?? top.eq) });

  return {
    ...prev,
    seq,
    seats,
    syndicates: syndicates.slice(-KEEP.syndicates),
    touches: touches.slice(-KEEP.touches),
    events: [...events.reverse(), ...prev.events].slice(0, KEEP.events),
    seen: seen.slice(-KEEP.seen),
    leader,
  };
}

/** Open declined tickets are all kept; closed ones are capped. */
function capSkipped(xs: GhostPos[]): GhostPos[] {
  const open = xs.filter((g) => !g.closed);
  const done = xs.filter((g) => g.closed).slice(-KEEP.skipped);
  return [...done, ...open];
}

/* ── What the league says ──────────────────────────────────────────────── */

export interface LeagueRow {
  id: SeatId;
  owner: Character | null;
  name: string;
  equity: number;
  pnl: number;
  /** Progress from the start to the target, −∞..1+. */
  progress: number;
  status: Seat["status"];
  open: number;
  taken: { n: number; wins: number; usd: number };
  /** What the tickets this seat declined by judgement made at its own size, followed to their end. Negative = saying no saved that much. */
  declined: { n: number; usd: number };
  /** Of the closed tickets: those held in a syndicate and those held alone. */
  coSigned: { n: number; usd: number };
  solo: { n: number; usd: number };
  /** P&L of tickets taken only by overriding the soft gates. */
  overrides: { n: number; usd: number };
  drawdown: number;
  lastAt: number | null;
  /** What the seat did with the last card it saw. */
  last: SeatDecision | null;
}

export interface LeagueRead {
  rows: LeagueRow[];
  leader: SeatId | null;
  start: number;
  target: number;
  syndicates: { n: number; closed: number; usd: number; dissentUsd: number | null; dissentN: number };
  touches: number;
  sessions: number;
}

export function leagueRead(book: SeatBook): LeagueRead {
  const start = book.goal.start;
  const rows: LeagueRow[] = book.seats.map((s) => {
    const equity = seatEquity(s, start);
    const doneSkips = s.skipped.filter((g) => g.closed);
    const sum = (xs: SeatClosed[]) => ({ n: xs.length, usd: money(xs.reduce((t, c) => t + c.pnlUsd, 0)) });
    return {
      id: s.id,
      owner: SEAT_OWNER[s.id],
      name: SEAT_NAME[s.id],
      equity,
      pnl: money(equity - start),
      progress: (equity - start) / (book.goal.target - start),
      status: s.status,
      open: s.positions.length,
      taken: { n: s.stats.closed, wins: s.stats.wins, usd: s.stats.realizedUsd },
      declined: { n: doneSkips.length, usd: money(doneSkips.reduce((t, g) => t + (g.closed?.pnlUsd ?? 0), 0)) },
      coSigned: sum(s.closed.filter((c) => c.syn != null)),
      solo: sum(s.closed.filter((c) => c.syn == null)),
      overrides: sum(s.closed.filter((c) => c.override != null)),
      drawdown: money(s.stats.peak - equity),
      lastAt: s.decisions[s.decisions.length - 1]?.at ?? null,
      last: s.decisions[s.decisions.length - 1] ?? null,
    };
  });
  rows.sort((a, b) => b.equity - a.equity);
  const closedSyn = book.syndicates.filter((y) => y.closedUsd != null);
  const withDissent = book.syndicates.filter((y) => y.dissentUsd != null);
  return {
    rows,
    leader: book.leader,
    start,
    target: book.goal.target,
    syndicates: {
      n: book.syndicates.length,
      closed: closedSyn.length,
      usd: money(closedSyn.reduce((t, y) => t + (y.closedUsd ?? 0), 0)),
      dissentUsd: withDissent.length ? money(withDissent.reduce((t, y) => t + (y.dissentUsd ?? 0), 0)) : null,
      dissentN: withDissent.length,
    },
    touches: book.touches.length,
    sessions: book.seen.length,
  };
}
