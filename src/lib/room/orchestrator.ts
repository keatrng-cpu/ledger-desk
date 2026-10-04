/**
 * THE TRADING FLOOR — five people, one desk, one ticket per cycle.
 *
 * Jax (TJR momentum), Nova (Blake Mech quant), Sterling (Patty/PB risk), Gemma
 * (ICT macro) and Vince (SMC execution) argue about QQQ/SPY 0–1 DTE options in
 * a 3D office. This file is the cycle: decide the ticket, place the people,
 * write the meeting — in that order, and the later steps can never change the
 * earlier ones.
 *
 * WHY THE ORCHESTRATOR IS CODE
 * CLAUDE.md: "Keep scoring deterministic. No LLM in the poll loop." The floor
 * runs on every desk refresh, so it is in the poll loop by construction. Every
 * decision is a function of the cycle's input, the desk's own gates and the
 * room's book; every number a character says is read or computed, never
 * written by a model; the same input always produces the same JSON.
 *
 * WHERE A TRADE COMES FROM
 * Only from `evaluateOptionsDesk`'s DAY cards — `path_continuation` (1 DTE)
 * and `judas_ifvg_0dte` (0 DTE) — the same gate stack the Options tab prints:
 * PATH A+/A/A−, the SMC sequence word, HTF, Judas, the news blackout, the week
 * card. The room never recounts musts or re-derives "ready". RSI, the trend
 * tag, the volume spike and VIX are what the characters TALK about; none of
 * them is a gate.
 *
 * WHAT THE ROOM ADDS — THE TRADER'S MANDATE (2026-10-04, mandate.ts)
 * Max 3 open, ≤10% of cash per ticket, −20% hard stop, +40% take-profit,
 * 0–1 DTE only — enforced by Sterling ON TOP of the desk's own rules (daily 2%
 * / weekly 5% halt, one underlier a day, max 2 entries a killzone, A+ only
 * after 10:00 ET and after the 9-a-month cap, the 2-loss cool-down, the
 * $1,000 debit ceiling). Where the two disagree the STRICTER number binds.
 *  - +40% closes HALF and the runner's stop moves to breakeven (the options
 *    playbook's "Trim 50% at +40–60% of debit, stop to BE"); one contract
 *    closes whole. `takeProfitCloseFrac` = 1 is the literal mandate.
 *  - −20% is a premium backstop; the PRIMARY exit stays the futures LEVEL
 *    (the plan's invalidation and the 15m failed-hold close).
 *
 * THE PEOPLE (agents.ts) and THE MEETING (meeting.ts) run after the ticket is
 * decided: where everyone stands, what they do between lines, who calls a
 * meeting before a release or over a B+–A+ card, and what they say — with
 * the desk's research and the room's memory of who was right.
 *
 * PAPER ONLY. `broker_action` is the ticket the room would send; the room's
 * paper book fills it at the model ask/bid. Nothing here routes to a broker.
 */

import { APLUS_RULES } from "@/lib/aplus/config";
import { CLOCK_WARN, MAX_DEBIT_USD } from "@/lib/trading/sleeve-sizing";
import { MAX_CONSEC_LOSSES, PATH_MONTH_CAP } from "@/lib/trading/profit-rules";
import { etWallParts, etWallToEpochMs } from "@/lib/trading/sessions";
import { planAgents, type Agenda, type AgentAct, type Meeting, type MindState } from "./agents";
import { STOP_TXT, clockEt, contractName, prem, px, ptsTxt, sideWord, signedPct, usd } from "./format";
import { ROOM_CLOCK, ROOM_MANDATE, VIX_ELEVATED, VIX_STRESSED } from "./mandate";
import { buildMeeting, jaxPush, type Facts } from "./meeting";
import {
  decayToStop,
  etDateOf,
  ivFor,
  nextWeekday,
  offsetOf,
  quoteOption,
  strikeFor,
  type OptionQuote,
  type OptionType,
  type StrikeOffset,
  type Underlier,
} from "./option-math";

export { ROOM_CLOCK, ROOM_MANDATE, VIX_ELEVATED, VIX_STRESSED } from "./mandate";

export type { OptionType, StrikeOffset, Underlier } from "./option-math";

/* ── The contract (the trader's schema, verbatim) ───────────────────────── */

export type Trend = "BULLISH" | "BEARISH" | "CHOPPY";
export type Urgency = "LOW" | "MEDIUM" | "HIGH_ALERT";
export type Character = "Jax" | "Nova" | "Sterling" | "Gemma" | "Vince";
export type ActionType = "BUY_OPEN" | "SELL_CLOSE" | "HOLD";

export type JaxZone = "JAX'S_DESK" | "THE_WHITEBOARD" | "WATERCOOLER";
export type NovaZone = "NOVA'S_DESK" | "THE_WHITEBOARD" | "WATERCOOLER";
export type SterlingZone = "STERLING_DESK" | "THE_WHITEBOARD";
export type GemmaZone = "GEMMA_DESK" | "THE_WHITEBOARD" | "WATERCOOLER";
export type VinceZone = "VINCE_DESK" | "THE_WHITEBOARD";
export type Zone = JaxZone | NovaZone | SterlingZone | GemmaZone | VinceZone;

/** Spelled exactly as the trader's schema spells it ("GESTICURING"). */
export type GemmaAnim = "GESTICURING_AT_WALL" | "PACING" | "EXPLAINING";
export type JaxAnim = "SHOUTING" | "POINTING" | "FURIOUS_TYPING";
export type NovaAnim = "WRITING_ON_WHITEBOARD" | "NODDING" | "ANALYZING";
export type SterlingAnim = "CROSSING_ARMS" | "CHECKING_TABLET" | "APPROVING";
export type VinceAnim = "SMASHING_ENTER_KEY" | "THUMBS_UP" | "STEADY_MONITORING";
export type Animation = GemmaAnim | JaxAnim | NovaAnim | SterlingAnim | VinceAnim;

export const ZONES_BY_CHARACTER: Record<Character, readonly Zone[]> = {
  Jax: ["JAX'S_DESK", "THE_WHITEBOARD", "WATERCOOLER"],
  Nova: ["NOVA'S_DESK", "THE_WHITEBOARD", "WATERCOOLER"],
  Sterling: ["STERLING_DESK", "THE_WHITEBOARD"],
  Gemma: ["GEMMA_DESK", "THE_WHITEBOARD", "WATERCOOLER"],
  Vince: ["VINCE_DESK", "THE_WHITEBOARD"],
};

export const ANIMS_BY_CHARACTER: Record<Character, readonly Animation[]> = {
  Gemma: ["GESTICURING_AT_WALL", "PACING", "EXPLAINING"],
  Jax: ["SHOUTING", "POINTING", "FURIOUS_TYPING"],
  Nova: ["WRITING_ON_WHITEBOARD", "NODDING", "ANALYZING"],
  Sterling: ["CROSSING_ARMS", "CHECKING_TABLET", "APPROVING"],
  Vince: ["SMASHING_ENTER_KEY", "THUMBS_UP", "STEADY_MONITORING"],
};


export interface RoomPositionIn {
  id: string;
  ticker: Underlier;
  type: OptionType;
  strike: number;
  exp: string;
  pnl_percent: number;
  /**
   * OPTIONAL extensions — not in the base schema. The room's own book always
   * sends them. Without `contracts` a SELL_CLOSE closes the whole position
   * and reports `contracts_quantity: 0` (= "all"), because the room will not
   * print a quantity it was never told.
   */
  contracts?: number;
  /** Half already banked at +40%: the runner's stop sits at breakeven. */
  trimmed?: boolean;
  strike_offset?: StrikeOffset;
}

export interface UnderlierTape {
  price: number;
  rsi: number;
  vix: number;
  trend: Trend;
  volume_spike: boolean;
}

export interface RoomInput {
  portfolio: { cash: number; open_positions: RoomPositionIn[] };
  market_data: Record<Underlier, UnderlierTape>;
}

export interface DialogueLine {
  character: Character;
  text: string;
  animation: Animation;
}

export interface BrokerAction {
  execute_trade: boolean;
  action_type: ActionType;
  underlying: Underlier;
  option_type: OptionType;
  strike_offset: StrikeOffset;
  contracts_quantity: number;
  target_position_id: string | null;
}

export interface RoomOutput {
  room_state: {
    market_urgency: Urgency;
    character_locations: {
      Jax: JaxZone;
      Nova: NovaZone;
      Sterling: SterlingZone;
      Gemma: GemmaZone;
      Vince: VinceZone;
    };
  };
  floor_dialogue_and_meetings: DialogueLine[];
  broker_action: BrokerAction;
}


/* ── The desk's read, as the room needs it ──────────────────────────────── */

export type EntryTier = "live" | "armed" | "forming" | "gone";

/** One of the options desk's 0–1 DTE day cards, flattened. */
export interface RoomEntryRead {
  card: "path_continuation" | "judas_ifvg_0dte";
  name: string;
  verdict: "ARMED" | "WATCH" | "STAND";
  /** The desk's own refusals, first is the binding one. */
  blocks: string[];
  underlier: Underlier;
  type: OptionType;
  dte: 0 | 1;
  band: string | null;
  confluence: number;
  futSymbol: string;
  futSide: "long" | "short";
  smcWord: "TAKE" | "WAIT" | "STAND";
  smcMissing: string;
  /** The desk ticket's contract count — the room may only shrink it. Null = no ticket. */
  deskContracts: number | null;
  sizedFrom: "level" | "ceiling" | null;
  deltaMin: number;
  deltaMax: number;
  plan: { entry: number; stop: number; t1: number | null; t2: number | null; rr1: number | null } | null;
  tier: EntryTier | null;
  awayPts: number | null;
  pT1: number | null;
  expR: number | null;
  pFill: number | null;
  /** Measured-negative patterns on the card (scanner.ts) — Sterling quotes them. */
  patterns: { inducement: boolean; mitigation: boolean } | null;
}

export interface RoomExitRead {
  kind: "level" | "failed_hold" | "t2";
  why: string;
}

export interface RoomDeskRead {
  isWeekday: boolean;
  holiday: boolean;
  killzone: string;
  killzoneLabel: string;
  nextWindow: string;
  judas: boolean;
  news: {
    blackout: boolean;
    reason: string;
    next: { name: string; timeEt: string; minutesAway: number } | null;
  };
  shock: string | null;
  htf: Record<Underlier, string>;
  futures: Record<Underlier, { symbol: string; price: number }>;
  feed: string;
  lagSec: number | null;
  spotSource: Record<Underlier, string>;
  tenYear: number | null;
  weekKind: string | null;
  weekTrade: string | null;
  entry: RoomEntryRead | null;
  /** Desk-computed exits for the room's open positions, keyed by position id. */
  exits: Record<string, RoomExitRead>;
  /** The futures plan each open position expresses, with the live futures print. */
  held?: Record<string, HeldLevels>;
  /** What the director schedules around: the next and last release, the best B+–A+ card. */
  agenda?: Agenda | null;
}

export interface HeldLevels {
  symbol: string;
  side: "long" | "short";
  stop: number;
  t1: number | null;
  t2: number | null;
  price: number;
}

/** The room book's own counters — halts, slots, the one-book lock. */
export interface RoomLedger {
  dayStartEquity: number;
  realizedTodayUsd: number;
  weekStartEquity: number;
  realizedWeekUsd: number;
  entriesThisKillzone: number;
  underlierToday: Underlier | null;
  monthEntries: number;
  consecLosses: number;
  /** Plans (planKey) the room already bought today — a plan is filled once, never averaged. */
  filledPlans: string[];
}

export interface RoomContext {
  desk: RoomDeskRead | null;
  ledger: RoomLedger | null;
  /** The people's state from the last cycle (agents.ts). Absent = a fresh room. */
  minds?: MindState | null;
}

/* ── What the cycle decided, with the reasons ───────────────────────────── */

export type Beat =
  | "rejected"
  | "closed"
  | "blind"
  | "exit"
  | "fill"
  | "trigger_wait"
  | "vetoed"
  | "holding"
  | "blocked"
  | "chop";

export interface Gate {
  id: string;
  ok: boolean;
  label: string;
}

export interface ExitPlan {
  position: RoomPositionIn;
  reason: "stop" | "level" | "failed_hold" | "expiry" | "time" | "t2" | "take_profit";
  why: string;
  /** Contracts to close; null = all of an unknown size. */
  qty: number | null;
  closesAll: boolean;
  quote: OptionQuote | null;
}

export interface EntryPlan {
  entry: RoomEntryRead;
  exp: string;
  offset: StrikeOffset;
  quote: OptionQuote;
  qty: number;
  capUsd: number;
  debitUsd: number;
  stopUsd: number;
  decay: number;
  clock: boolean;
}

export interface RoomTrace {
  beat: Beat;
  /** Sterling's checklist, in the order he reads it. */
  gates: Gate[];
  /** The one binding refusal, when there is one. */
  refusal: string | null;
  exit: ExitPlan | null;
  entry: EntryPlan | null;
  /** The instrument the room is looking at (for HOLD tickets and the whiteboard). */
  focus: { underlier: Underlier; type: OptionType; offset: StrikeOffset; quote: OptionQuote | null; exp: string };
  etDate: string;
  etMin: number;
  optionsOpen: boolean;
  errors: string[];
  /** The first gate that failed, by id — the meeting explains that one. */
  refusalGate: string | null;
  /** The director's meeting this cycle, if any. */
  meeting: Meeting | null;
  /** What each person is doing between lines. */
  acts: Record<Character, AgentAct> | null;
}

export interface RoomCycle {
  output: RoomOutput;
  trace: RoomTrace;
  /** The people after this cycle — feed it back as `ctx.minds` next time. */
  minds: MindState | null;
}


/* ── Formatting lives in format.ts; the plan key lives here ─────────────── */


/** One plan = one fill. The key a filled plan is remembered by. */
export function planKey(e: Pick<RoomEntryRead, "futSymbol" | "futSide" | "plan">): string {
  return `${e.futSymbol}:${e.futSide}:${e.plan ? e.plan.entry.toFixed(2) : "none"}`;
}

/* ── Input validation: fail closed ──────────────────────────────────────── */

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateInput(input: unknown): string[] {
  const errs: string[] = [];
  const i = input as Partial<RoomInput> | null;
  if (!i || typeof i !== "object") return ["input is not an object"];
  const p = i.portfolio;
  if (!p || typeof p !== "object") errs.push("portfolio missing");
  else {
    if (!isNum(p.cash) || p.cash < 0) errs.push("portfolio.cash must be a number ≥ 0");
    if (!Array.isArray(p.open_positions)) errs.push("portfolio.open_positions must be an array");
    else {
      const seen = new Set<string>();
      p.open_positions.forEach((o, k) => {
        const at = `open_positions[${k}]`;
        if (!o || typeof o !== "object") return void errs.push(`${at} is not an object`);
        if (typeof o.id !== "string" || !o.id) errs.push(`${at}.id missing`);
        else if (seen.has(o.id)) errs.push(`${at}.id "${o.id}" is duplicated`);
        else seen.add(o.id);
        if (o.ticker !== "SPY" && o.ticker !== "QQQ") errs.push(`${at}.ticker must be SPY or QQQ`);
        if (o.type !== "CALL" && o.type !== "PUT") errs.push(`${at}.type must be CALL or PUT`);
        if (!isNum(o.strike) || o.strike <= 0) errs.push(`${at}.strike must be > 0`);
        if (typeof o.exp !== "string" || !DATE_RE.test(o.exp)) errs.push(`${at}.exp must be YYYY-MM-DD`);
        if (!isNum(o.pnl_percent)) errs.push(`${at}.pnl_percent must be a number`);
        if (o.contracts != null && (!Number.isInteger(o.contracts) || o.contracts < 1))
          errs.push(`${at}.contracts must be a positive integer when present`);
      });
    }
  }
  const m = i.market_data as Partial<Record<Underlier, Partial<UnderlierTape>>> | undefined;
  if (!m || typeof m !== "object") errs.push("market_data missing");
  else
    for (const u of ["SPY", "QQQ"] as const) {
      const t = m[u];
      if (!t || typeof t !== "object") {
        errs.push(`market_data.${u} missing`);
        continue;
      }
      if (!isNum(t.price) || t.price <= 0) errs.push(`market_data.${u}.price must be > 0`);
      if (!isNum(t.rsi) || t.rsi < 0 || t.rsi > 100) errs.push(`market_data.${u}.rsi must be 0–100`);
      if (!isNum(t.vix) || t.vix < 0) errs.push(`market_data.${u}.vix must be ≥ 0`);
      if (t.trend !== "BULLISH" && t.trend !== "BEARISH" && t.trend !== "CHOPPY")
        errs.push(`market_data.${u}.trend must be BULLISH, BEARISH or CHOPPY`);
      if (typeof t.volume_spike !== "boolean") errs.push(`market_data.${u}.volume_spike must be boolean`);
    }
  return errs;
}

/* ── Exits ──────────────────────────────────────────────────────────────── */

const EXIT_RANK: Record<ExitPlan["reason"], number> = {
  stop: 1,
  level: 2,
  failed_hold: 2,
  expiry: 3,
  time: 4,
  t2: 5,
  take_profit: 6,
};

function htfAligned(htf: string | undefined, type: OptionType): boolean {
  return type === "CALL" ? htf === "bull" : htf === "bear";
}

function pickExit(input: RoomInput, desk: RoomDeskRead | null, etDate: string, etMin: number, nowMs: number): ExitPlan | null {
  const plans: ExitPlan[] = [];
  for (const p of input.portfolio.open_positions) {
    const tape = input.market_data[p.ticker];
    const quote = quoteOption(tape.price, p.strike, p.exp, p.type, ivFor(p.ticker, tape.vix), nowMs);
    const all = (reason: ExitPlan["reason"], why: string): ExitPlan => ({
      position: p,
      reason,
      why,
      qty: p.contracts ?? null,
      closesAll: true,
      quote,
    });
    const stopPct = p.trimmed ? 0 : ROOM_MANDATE.hardStopPct;
    if (p.pnl_percent <= stopPct) {
      plans.push(
        all(
          "stop",
          p.trimmed
            ? `runner back to breakeven (${signedPct(p.pnl_percent)}) after the +${ROOM_MANDATE.takeProfitPct}% trim`
            : `${signedPct(p.pnl_percent)} is through the ${STOP_TXT} hard stop`,
        ),
      );
    }
    const deskExit = desk?.exits[p.id];
    if (deskExit && deskExit.kind !== "t2") plans.push(all(deskExit.kind, deskExit.why));
    if (p.exp < etDate) plans.push(all("expiry", `expired ${p.exp} — the contract is past its bell`));
    else if (p.exp === etDate && etMin >= ROOM_CLOCK.flattenAllMin)
      plans.push(all("expiry", `expiry day ${clockEt(etMin)} ET — the broker force-sells from 15:30`));
    else if (etMin >= ROOM_CLOCK.flattenAllMin)
      plans.push(all("time", `${clockEt(etMin)} ET — QQQ/SPY options are unmanageable 16:15→09:30, nothing 0–1 DTE goes home`));
    else if (etMin >= ROOM_CLOCK.dayFlatMin) {
      const dte0 = p.exp === etDate;
      const keep = !dte0 && p.pnl_percent >= ROOM_CLOCK.pastElevenMinPct && htfAligned(desk?.htf[p.ticker], p.type);
      if (!keep)
        plans.push(
          all(
            "time",
            dte0
              ? `${clockEt(etMin)} ET — day tickets are flat by 11:00, and 0 DTE gets no exception`
              : `${clockEt(etMin)} ET — flat by 11:00 unless ≥ +${ROOM_CLOCK.pastElevenMinPct}% with HTF aligned (${signedPct(p.pnl_percent)})`,
          ),
        );
    }
    if (deskExit?.kind === "t2") plans.push(all("t2", deskExit.why));
    if (!p.trimmed && p.pnl_percent >= ROOM_MANDATE.takeProfitPct) {
      const n = p.contracts ?? null;
      const half = n != null && n >= 2 ? Math.max(1, Math.floor(n * ROOM_MANDATE.takeProfitCloseFrac)) : null;
      const closesAll = half == null || half >= (n ?? 0);
      plans.push({
        position: p,
        reason: "take_profit",
        why: closesAll
          ? `${signedPct(p.pnl_percent)} is past the +${ROOM_MANDATE.takeProfitPct}% target with ${n == null ? "an unknown size" : "one contract"}, so it all goes`
          : `${signedPct(p.pnl_percent)} is past the +${ROOM_MANDATE.takeProfitPct}% target — trim ${half} of ${n}`,
        qty: closesAll ? n : half,
        closesAll,
        quote,
      });
    }
  }
  plans.sort((a, b) => EXIT_RANK[a.reason] - EXIT_RANK[b.reason] || a.position.pnl_percent - b.position.pnl_percent);
  return plans[0] ?? null;
}

/* ── Entry: the desk's card, then Sterling's list ──────────────────────── */

function expiryFor(dte: 0 | 1, etDate: string): string {
  return dte === 0 ? etDate : nextWeekday(etDate);
}

/** Nova's strike: whichever of ATM / one-out is nearer the desk ticket's target delta. */
function pickStrike(
  e: RoomEntryRead,
  tape: UnderlierTape,
  exp: string,
  nowMs: number,
): { offset: StrikeOffset; quote: OptionQuote; alt: { offset: StrikeOffset; quote: OptionQuote } } {
  const iv = ivFor(e.underlier, tape.vix);
  const target = (e.deltaMin + e.deltaMax) / 2;
  const q = (o: StrikeOffset) => quoteOption(tape.price, strikeFor(tape.price, e.type, o), exp, e.type, iv, nowMs);
  const atm = { offset: "ATM" as const, quote: q("ATM") };
  const otm = { offset: "OTM_1" as const, quote: q("OTM_1") };
  const dist = (x: OptionQuote) => Math.abs(Math.abs(x.delta) - target);
  // Ties go to ATM: more delta per dollar of decay.
  return dist(otm.quote) < dist(atm.quote) - 1e-9 ? { ...otm, alt: atm } : { ...atm, alt: otm };
}

interface EntryEval {
  gates: Gate[];
  refusal: string | null;
  plan: EntryPlan | null;
  /** The card passed every gate and waits only for the CE touch. */
  waiting: boolean;
}

function evaluateEntry(
  input: RoomInput,
  ctx: RoomContext,
  etDate: string,
  etMin: number,
  nowMs: number,
  optionsOpen: boolean,
): EntryEval {
  const gates: Gate[] = [];
  let refusal: string | null = null;
  const gate = (id: string, ok: boolean, label: string) => {
    gates.push({ id, ok, label });
    if (!ok && refusal == null) refusal = label;
    return ok;
  };
  const desk = ctx.desk;
  const e = desk?.entry ?? null;
  const open = input.portfolio.open_positions;
  const cash = input.portfolio.cash;
  const L = ctx.ledger;

  gate("market", optionsOpen, optionsOpen ? "Options market open" : "Options market closed — 09:30–16:00 ET weekdays");
  gate("desk", Boolean(desk), desk ? `Desk read · ${desk.feed}` : "No desk read on the wire — the room does not open on RSI or a trend tag");
  gate("card", Boolean(e), e ? `${e.name} card` : "No 0–1 DTE card on the desk");
  if (e) {
    gate(
      "desk_word",
      e.verdict === "ARMED",
      e.verdict === "ARMED"
        ? `Desk ARMED · ${e.futSymbol} ${e.futSide} · PATH ${e.band ?? "—"} · SMC ${e.smcWord}`
        : `Desk ${e.verdict}: ${e.blocks[0] ?? e.smcMissing}`,
    );
    gate(
      "desk_ticket",
      (e.deskContracts ?? 0) >= 1,
      (e.deskContracts ?? 0) >= 1
        ? `Desk ticket ${e.deskContracts}× (${e.sizedFrom === "level" ? "sized from the level" : "sized from the ceiling"})`
        : "The desk priced no ticket for this card",
    );
    gate("dte", ROOM_MANDATE.dteAllowed.includes(e.dte), `${e.dte} DTE (mandate 0–1)`);
  }
  if (L) {
    const dayLimit = APLUS_RULES.dailyLossLimitPct * L.dayStartEquity;
    const weekLimit = APLUS_RULES.weeklyLossLimitPct * L.weekStartEquity;
    gate(
      "halt_day",
      L.realizedTodayUsd > -dayLimit,
      L.realizedTodayUsd > -dayLimit
        ? `Day ${usd(L.realizedTodayUsd)} · halt room ${usd(dayLimit + L.realizedTodayUsd)}`
        : `Daily halt — ${usd(L.realizedTodayUsd)} is past ${Math.round(APLUS_RULES.dailyLossLimitPct * 100)}% of ${usd(L.dayStartEquity)}`,
    );
    gate(
      "halt_week",
      L.realizedWeekUsd > -weekLimit,
      L.realizedWeekUsd > -weekLimit
        ? `Week ${usd(L.realizedWeekUsd)} of a ${usd(weekLimit)} halt`
        : `Weekly halt — ${usd(L.realizedWeekUsd)} is past ${Math.round(APLUS_RULES.weeklyLossLimitPct * 100)}% of ${usd(L.weekStartEquity)}`,
    );
    if (e)
      gate(
        "cooldown",
        L.consecLosses < MAX_CONSEC_LOSSES || e.band === "A+",
        L.consecLosses < MAX_CONSEC_LOSSES
          ? `${L.consecLosses} consecutive losses`
          : `Cool-down after ${L.consecLosses} consecutive losses — A+ only (have ${e.band ?? "—"})`,
      );
  } else {
    gate("ledger", false, "No book counters — halts cannot be checked, so nothing opens");
  }
  gate(
    "slots",
    open.length < ROOM_MANDATE.maxOpenPositions,
    `${open.length} of ${ROOM_MANDATE.maxOpenPositions} slots used`,
  );
  if (e) {
    const other = open.find((o) => o.ticker !== e.underlier);
    const locked = L?.underlierToday && L.underlierToday !== e.underlier ? L.underlierToday : null;
    gate(
      "one_book",
      !other && !locked,
      other
        ? `One book — ${other.ticker} is already open, never both underliers`
        : locked
          ? `One book — the room traded ${locked} today, ${e.underlier} waits for tomorrow`
          : `One book · ${e.underlier}`,
    );
    const opposite = open.find((o) => o.ticker === e.underlier && o.type !== e.type);
    gate(
      "one_bias",
      !opposite,
      opposite ? `Already ${sideWord(opposite.type)} on ${opposite.ticker} — never both sides` : `One bias · ${sideWord(e.type)}`,
    );
    const filled = Boolean(e.plan && L?.filledPlans.includes(planKey(e)));
    gate(
      "no_average",
      !filled,
      filled ? `Plan already filled (CE ${px(e.plan?.entry ?? 0)}) — one plan, one fill, never average` : "Fresh plan — not yet filled",
    );
    if (L)
      gate(
        "killzone",
        L.entriesThisKillzone < APLUS_RULES.maxSetupsPerSession,
        `${L.entriesThisKillzone} of ${APLUS_RULES.maxSetupsPerSession} entries this killzone`,
      );
    // A day ticket opened at or after 11:00 would be closed by the time stop
    // on the very next cycle — that is a spread donation, not a trade.
    gate(
      "before_flat",
      etMin < ROOM_CLOCK.dayFlatMin,
      etMin < ROOM_CLOCK.dayFlatMin ? "Before the 11:00 ET day flat" : "11:00 ET or later — day tickets are flat by now, nothing new opens",
    );
    const late = etMin >= ROOM_CLOCK.aPlusOnlyAfterMin;
    gate(
      "after_ten",
      !late || e.band === "A+",
      late ? `After 10:00 ET — A+ only (have ${e.band ?? "—"})` : "Before 10:00 ET — A/A− allowed",
    );
    if (L)
      gate(
        "month",
        L.monthEntries < PATH_MONTH_CAP || e.band === "A+",
        L.monthEntries < PATH_MONTH_CAP
          ? `${L.monthEntries} of ~${PATH_MONTH_CAP} PATH this month`
          : `Month cap ${PATH_MONTH_CAP} reached — A+ only (have ${e.band ?? "—"})`,
      );
  }

  // Sizing and the clock only mean something once the desk has a ticket.
  let plan: EntryPlan | null = null;
  if (e && desk && (e.deskContracts ?? 0) >= 1) {
    const tape = input.market_data[e.underlier];
    const exp = expiryFor(e.dte, etDate);
    const pick = pickStrike(e, tape, exp, nowMs);
    const capUsd = Math.min(ROOM_MANDATE.maxCashFracPerTrade * cash, MAX_DEBIT_USD);
    const afford = (q: OptionQuote) => Math.floor(capUsd / (q.ask * 100));
    let chosen = pick;
    // A cheaper one-out strike is not a lottery while its delta stays inside
    // the desk ticket's band; anything further out is (options-desk.ts).
    if (afford(pick.quote) < 1 && pick.offset === "ATM" && afford(pick.alt.quote) >= 1 && Math.abs(pick.alt.quote.delta) >= e.deltaMin)
      chosen = { ...pick.alt, alt: pick };
    const qty = Math.min(e.deskContracts ?? 0, afford(chosen.quote));
    const debitUsd = Math.round(qty * chosen.quote.ask * 100);
    gate(
      "cash_cap",
      qty >= 1 && debitUsd <= cash,
      qty >= 1
        ? `${qty}× at ${prem(chosen.quote.ask)} = ${usd(debitUsd)} ≤ cap ${usd(capUsd)} (${Math.round(ROOM_MANDATE.maxCashFracPerTrade * 100)}% of ${usd(cash)}, ceiling ${usd(MAX_DEBIT_USD)})`
        : `One ${contractName(e.underlier, chosen.quote.strike, e.type, exp)} is ${usd(chosen.quote.ask * 100)}; the cap is ${usd(capUsd)} (${Math.round(ROOM_MANDATE.maxCashFracPerTrade * 100)}% of ${usd(cash)})`,
    );
    const untilMs = etWallToEpochMs(etDate, clockEt(ROOM_CLOCK.dayFlatMin));
    const decay = decayToStop(
      tape.price,
      chosen.quote.strike,
      exp,
      e.type,
      chosen.quote.iv,
      nowMs,
      untilMs,
      Math.abs(ROOM_MANDATE.hardStopPct) / 100,
    );
    gate(
      "clock",
      decay < 1,
      decay < 1
        ? `Theta to 11:00 eats ${Math.round(decay * 100)}% of the ${STOP_TXT} stop`
        : `The ${STOP_TXT} stop is a clock — decay alone reaches it before 11:00`,
    );
    plan = {
      entry: e,
      exp,
      offset: chosen.offset,
      quote: chosen.quote,
      qty,
      capUsd,
      debitUsd,
      stopUsd: Math.round(debitUsd * (Math.abs(ROOM_MANDATE.hardStopPct) / 100)),
      decay,
      clock: decay >= CLOCK_WARN,
    };
  }

  const allPass = gates.every((g) => g.ok);
  // Every gate passed: the only thing left is price reaching the CE.
  const tierLive = e?.tier === "live";
  if (allPass && e && !tierLive) {
    const tierWhy =
      e.tier == null
        ? "No priced CE to rest at — the room only buys the touch"
        : e.tier === "gone"
          ? "Price walked off / through the entry — wait for a new plan"
          : `Resting at CE ${px(e.plan?.entry ?? 0)} — ${e.awayPts != null ? ptsTxt(e.awayPts) : "?"} away (${e.tier.toUpperCase()})`;
    gates.push({ id: "trigger", ok: false, label: tierWhy });
    return { gates, refusal: e.tier === "gone" || e.tier == null ? tierWhy : null, plan, waiting: e.tier === "armed" || e.tier === "forming" };
  }
  if (allPass && e) gates.push({ id: "trigger", ok: true, label: `CE touched — ${e.futSymbol} at the array` });
  return { gates, refusal, plan, waiting: false };
}

/* ── Urgency, places, animations ────────────────────────────────────────── */

function vixOf(input: RoomInput): number {
  return Math.max(input.market_data.SPY.vix, input.market_data.QQQ.vix);
}

function urgencyFor(beat: Beat, input: RoomInput, entry: RoomEntryRead | null, desk: RoomDeskRead | null): Urgency {
  if (beat === "rejected" || beat === "closed") return "LOW";
  const vix = vixOf(input);
  const spike = input.market_data.SPY.volume_spike || input.market_data.QQQ.volume_spike;
  const volHigh = vix >= VIX_STRESSED || (spike && vix >= VIX_ELEVATED);
  const volMed = vix >= VIX_ELEVATED || spike;
  const printSoon = (desk?.news.next?.minutesAway ?? 999) <= 15 || Boolean(desk?.news.blackout);
  if (beat === "exit" || beat === "fill") return "HIGH_ALERT";
  if ((beat === "trigger_wait" || beat === "vetoed") && entry?.tier && (entry.tier === "armed" || entry.tier === "live"))
    return "HIGH_ALERT";
  if (volHigh) return "HIGH_ALERT";
  if (beat === "trigger_wait" || beat === "vetoed" || beat === "holding" || beat === "blocked" || volMed || printSoon)
    return "MEDIUM";
  return "LOW";
}

/* ── The cycle ──────────────────────────────────────────────────────────── */

function holdTicket(focus: RoomTrace["focus"]): BrokerAction {
  return {
    execute_trade: false,
    action_type: "HOLD",
    underlying: focus.underlier,
    option_type: focus.type,
    strike_offset: focus.offset,
    contracts_quantity: 0,
    target_position_id: null,
  };
}

function focusFor(input: RoomInput, desk: RoomDeskRead | null, entry: EntryPlan | null, etDate: string, nowMs: number): RoomTrace["focus"] {
  if (entry)
    return { underlier: entry.entry.underlier, type: entry.entry.type, offset: entry.offset, quote: entry.quote, exp: entry.exp };
  const card = desk?.entry ?? null;
  // Prefer the desk's card; else QQQ (NQ usually leads), else whichever tape spiked.
  const underlier: Underlier = card?.underlier ?? (input.market_data.SPY.volume_spike && !input.market_data.QQQ.volume_spike ? "SPY" : "QQQ");
  const tape = input.market_data[underlier];
  const type: OptionType = card?.type ?? (tape.trend === "BEARISH" ? "PUT" : "CALL");
  const exp = card ? expiryFor(card.dte, etDate) : nextWeekday(etDate);
  const quote = quoteOption(tape.price, strikeFor(tape.price, type, "ATM"), exp, type, ivFor(underlier, tape.vix), nowMs);
  return { underlier, type, offset: "ATM", quote, exp };
}

/** A neutral tape used only to voice a rejection — never to price anything. */
const SAFE_TAPE: Record<Underlier, UnderlierTape> = {
  SPY: { price: 1, rsi: 50, vix: 0, trend: "CHOPPY", volume_spike: false },
  QQQ: { price: 1, rsi: 50, vix: 0, trend: "CHOPPY", volume_spike: false },
};

const DESKS: RoomOutput["room_state"]["character_locations"] = {
  Jax: "JAX'S_DESK",
  Nova: "NOVA'S_DESK",
  Sterling: "STERLING_DESK",
  Gemma: "GEMMA_DESK",
  Vince: "VINCE_DESK",
};

/**
 * One cycle of the floor. Pure: same arguments, same JSON.
 *
 * @param nowMs the cycle's instant (the desk's fetchedAt in the app, the
 *   request time on the API). The ET clock is read from it, never from Date.now().
 */
export function runRoomCycle(input: RoomInput, ctx: RoomContext | null, nowMs: number): RoomCycle {
  const etParts = etWallParts(nowMs);
  const etDate = etDateOf(nowMs);
  const etMin = etParts.hour * 60 + etParts.minute;
  const seed = Math.floor(nowMs / 60_000);
  const desk = ctx?.desk ?? null;
  const weekday = etParts.weekday >= 1 && etParts.weekday <= 5;
  const optionsOpen =
    weekday && !desk?.holiday && etMin >= ROOM_CLOCK.optionsOpenMin && etMin < ROOM_CLOCK.optionsCloseMin;
  const agenda = desk?.agenda ?? null;

  const errors = validateInput(input);
  if (errors.length) {
    const focus: RoomTrace["focus"] = { underlier: "QQQ", type: "CALL", offset: "ATM", quote: null, exp: etDate };
    const facts: Facts = {
      input: { portfolio: { cash: 0, open_positions: [] }, market_data: SAFE_TAPE },
      desk,
      ledger: ctx?.ledger ?? null,
      beat: "rejected",
      exit: null,
      entry: null,
      card: null,
      refusal: errors[0] ?? null,
      refusalGate: "input",
      gates: [],
      focus,
      etMin,
      etDate,
      seed,
      nowMs,
      errors,
      agenda,
    };
    return {
      output: {
        room_state: { market_urgency: "LOW", character_locations: { ...DESKS } },
        floor_dialogue_and_meetings: buildMeeting(facts, { ...DESKS }, ctx?.minds ?? null, null),
        broker_action: holdTicket(focus),
      },
      trace: {
        beat: "rejected",
        gates: [],
        refusal: errors[0] ?? null,
        refusalGate: "input",
        exit: null,
        entry: null,
        focus,
        etDate,
        etMin,
        optionsOpen,
        errors,
        meeting: null,
        acts: null,
      },
      minds: ctx?.minds ?? null,
    };
  }

  // 1) Exits first — an open position's stop outranks any new idea.
  const exitCandidate = pickExit(input, desk, etDate, etMin, nowMs);
  const exit = optionsOpen ? exitCandidate : null;

  // 2) Entries only on a cycle with no exit to send.
  const ev = evaluateEntry(input, { desk, ledger: ctx?.ledger ?? null }, etDate, etMin, nowMs, optionsOpen);
  const allPass = ev.gates.every((g) => g.ok);
  const card = desk?.entry ?? null;

  let beat: Beat;
  if (!optionsOpen) beat = "closed";
  else if (exit) beat = "exit";
  else if (!desk) beat = "blind";
  else if (allPass && ev.plan) beat = "fill";
  else if (ev.gates.some((g) => g.id === "no_average" && !g.ok))
    beat = input.portfolio.open_positions.length ? "holding" : "chop";
  else if (card?.verdict === "ARMED" && ev.waiting) beat = "trigger_wait";
  else if (card?.verdict === "ARMED" && (card.deskContracts ?? 0) >= 1) beat = "vetoed";
  else if (input.portfolio.open_positions.length) beat = "holding";
  else if (card && card.verdict === "WATCH") beat = "blocked";
  else beat = "chop";

  const entryPlan = beat === "fill" || beat === "trigger_wait" || beat === "vetoed" ? ev.plan : null;
  const focus = focusFor(input, desk, entryPlan, etDate, nowMs);
  const urgency = urgencyFor(beat, input, card, desk);

  let broker: BrokerAction = holdTicket(focus);
  if (beat === "exit" && exit) {
    const pos = exit.position;
    broker = {
      execute_trade: true,
      action_type: "SELL_CLOSE",
      underlying: pos.ticker,
      option_type: pos.type,
      strike_offset: pos.strike_offset ?? offsetOf(input.market_data[pos.ticker].price, pos.strike, pos.type),
      contracts_quantity: exit.qty ?? 0,
      target_position_id: pos.id,
    };
  } else if (beat === "fill" && ev.plan) {
    broker = {
      execute_trade: true,
      action_type: "BUY_OPEN",
      underlying: ev.plan.entry.underlier,
      option_type: ev.plan.entry.type,
      strike_offset: ev.plan.offset,
      contracts_quantity: ev.plan.qty,
      target_position_id: null,
    };
  }

  const firstFail = ev.gates.find((g) => !g.ok) ?? null;
  const refusal =
    beat === "closed"
      ? exitCandidate
        ? `Options closed — ${exitCandidate.position.id} exit (${exitCandidate.reason}) waits for 09:30 ET`
        : "Options market closed"
      : beat === "fill" || beat === "exit"
        ? null
        : ev.refusal;
  const refusalGate = beat === "fill" || beat === "exit" ? null : beat === "closed" ? "market" : (firstFail?.id ?? null);

  // 3) The people — where everyone stands. Reads the ticket; cannot change it.
  const plan = planAgents(ctx?.minds ?? null, {
    nowMs,
    etDate,
    etMin,
    weekday: etParts.weekday,
    optionsOpen,
    beat,
    urgency,
    execute: broker.execute_trade,
    market: input.market_data,
    openCount: input.portfolio.open_positions.length,
    agenda,
    card,
    entryPlan,
    vetoGate: beat === "vetoed" ? refusal : null,
    jaxCall: jaxPush({ beat, card, input }),
    exit:
      beat === "exit" && exit
        ? { reason: exit.reason, id: exit.position.id, pnl: exit.position.pnl_percent, ticker: exit.position.ticker }
        : null,
    fill:
      beat === "fill" && ev.plan
        ? { id: `${ev.plan.entry.underlier} ${ev.plan.quote.strike}${ev.plan.entry.type === "CALL" ? "C" : "P"}`, underlier: ev.plan.entry.underlier }
        : null,
    blackout: Boolean(desk?.news.blackout),
  });
  // A meeting at the board is never a LOW-urgency room (the Sunday restamp is).
  const roomUrgency: Urgency =
    plan.meeting && urgency === "LOW" && plan.meeting.kind !== "restamp" ? "MEDIUM" : urgency;

  // 4) The meeting.
  const facts: Facts = {
    input,
    desk,
    ledger: ctx?.ledger ?? null,
    beat,
    exit,
    entry: entryPlan,
    card,
    refusal,
    refusalGate,
    gates: ev.gates,
    focus,
    etMin,
    etDate,
    seed,
    nowMs,
    errors,
    agenda,
  };

  return {
    output: {
      room_state: { market_urgency: roomUrgency, character_locations: plan.places },
      floor_dialogue_and_meetings: buildMeeting(facts, plan.places, plan.minds, plan.meeting),
      broker_action: broker,
    },
    trace: {
      beat,
      gates: ev.gates,
      refusal,
      refusalGate,
      exit,
      entry: entryPlan,
      focus,
      etDate,
      etMin,
      optionsOpen,
      errors,
      meeting: plan.meeting,
      acts: plan.acts,
    },
    minds: plan.minds,
  };
}

/** Lines in a meeting: an exchange, not a roll call. */
export const MEETING_LINES = { min: 5, max: 9 } as const;

/**
 * The contract check the API route and the verifier share: every key the
 * trader's schema names, every enum inside its allowed set, every location
 * allowed for that character, every animation allowed for that character and
 * possible where that character is standing.
 */
export function outputViolations(o: RoomOutput): string[] {
  const v: string[] = [];
  const urg: Urgency[] = ["LOW", "MEDIUM", "HIGH_ALERT"];
  if (!urg.includes(o.room_state.market_urgency)) v.push(`market_urgency ${o.room_state.market_urgency}`);
  const locs = o.room_state.character_locations as Record<string, string>;
  for (const c of Object.keys(ZONES_BY_CHARACTER) as Character[]) {
    if (!ZONES_BY_CHARACTER[c].includes(locs[c] as Zone)) v.push(`${c} at ${locs[c]}`);
  }
  if (Object.keys(locs).length !== 5) v.push("character_locations must name exactly five people");
  const lines = o.floor_dialogue_and_meetings;
  if (lines.length < MEETING_LINES.min || lines.length > MEETING_LINES.max)
    v.push(`${lines.length} dialogue lines, want ${MEETING_LINES.min}–${MEETING_LINES.max}`);
  for (const c of Object.keys(ZONES_BY_CHARACTER) as Character[]) {
    if (!lines.some((l) => l.character === c)) v.push(`${c} never speaks`);
  }
  const at = o.room_state.character_locations;
  const b = o.broker_action;
  lines.forEach((l) => {
    if (!ANIMS_BY_CHARACTER[l.character]?.includes(l.animation)) v.push(`${l.character} cannot ${l.animation}`);
    if (typeof l.text !== "string" || !l.text.trim()) v.push(`${l.character} said nothing`);
    // Movement maps to the line: nobody writes on a board they are not standing at.
    if (l.character === "Nova" && l.animation === "WRITING_ON_WHITEBOARD" && at.Nova !== "THE_WHITEBOARD")
      v.push("Nova writing on a whiteboard she is not at");
    if (l.character === "Gemma" && l.animation === "GESTICURING_AT_WALL" && at.Gemma !== "THE_WHITEBOARD")
      v.push("Gemma gesturing at a wall she is not at");
    if (l.character === "Vince" && l.animation === "SMASHING_ENTER_KEY" && (at.Vince !== "VINCE_DESK" || !b.execute_trade))
      v.push("Vince smashing enter with nothing to send or no keyboard");
  });
  if (!["BUY_OPEN", "SELL_CLOSE", "HOLD"].includes(b.action_type)) v.push(`action_type ${b.action_type}`);
  if (!["SPY", "QQQ"].includes(b.underlying)) v.push(`underlying ${b.underlying}`);
  if (!["CALL", "PUT"].includes(b.option_type)) v.push(`option_type ${b.option_type}`);
  if (!["ATM", "OTM_1"].includes(b.strike_offset)) v.push(`strike_offset ${b.strike_offset}`);
  if (!Number.isInteger(b.contracts_quantity) || b.contracts_quantity < 0) v.push(`contracts_quantity ${b.contracts_quantity}`);
  if (b.execute_trade !== (b.action_type !== "HOLD")) v.push("execute_trade must be true exactly when action_type is not HOLD");
  if (b.action_type === "BUY_OPEN" && (b.contracts_quantity < 1 || b.target_position_id !== null)) v.push("BUY_OPEN needs ≥1 contract and no target");
  if (b.action_type === "SELL_CLOSE" && !b.target_position_id) v.push("SELL_CLOSE needs a target_position_id");
  if (b.action_type === "HOLD" && (b.contracts_quantity !== 0 || b.target_position_id !== null)) v.push("HOLD carries 0 contracts and no target");
  // Execution phase: the two who own the ticket are at their desks.
  if (b.execute_trade) {
    if (at.Vince !== "VINCE_DESK") v.push("execution with Vince away from his desk");
    if (at.Sterling !== "STERLING_DESK") v.push("execution with Sterling away from his desk");
  }
  return v;
}
