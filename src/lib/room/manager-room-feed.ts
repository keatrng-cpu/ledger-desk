/**
 * The REAL Trading Stand Manager feed — ManagerRoomState from actual room state.
 *
 * Source of truth: the room engine's live cycle (orchestrator.ts runRoomCycle —
 * the chair's beat, Sterling's gate checklist, the broker_action call, the
 * entry plan, the lenses / room number) pushed in by room-engine.ts on every
 * desk build, plus the live Agentic RH account read
 * (managerRhAccountFromConnector) injected by the host / agent loop.
 * No demo cycle, no timers, no mock calls.
 *
 * agentAgree (THE Stand bit) is true ONLY when the room's own cycle is a
 * BUY_OPEN fill (every room gate passed, CE touched) AND the chair rules of
 * DESIGN_MANAGER_TRADING_STAND.md hold: Floor ARMED + desk ticket, PATH band
 * A+/A/A- >= 0.65 or B+ through the explicit B+ gate (fit >= 0.60, SEQ TAKE,
 * no veto), DTE 0/1, options session open, no blackout / halt / one-book,
 * envelope-shaped ticket ($150-$550, 1-4 ct — B+ 1 ct — ATM/OTM_1), live (not
 * synthetic) desk feed, and no Owner veto / table / hand-off on this decision.
 * The bit only feeds candidateFromFloorPathStand; every hard gate (env arms,
 * BP on Agentic 995386158, Floor rules, envelope, live quote) still runs in
 * rh-autofire-gates.ts / rh-autofire.ts. Nothing here places an order.
 */
import type { BrokerAction, Gate, RoomEntryRead, RoomOutput, RoomTrace } from "./orchestrator";
import { schoolTicket } from "@/lib/trading/school-ticket";
import type {
  ArmSnap,
  CallAction,
  DiscretionRule,
  ManagerCall,
  ManagerFeed,
  ManagerPhase,
  ManagerRoomSignals,
  ManagerRoomState,
  ManagerSteer,
  OwnerFeedback,
  SteerMove,
} from "./manager-feed";
import {
  DEFAULT_MANAGER_ROOM_ACCOUNT,
  managerRhAccountFromConnector,
  type ManagerRhAccount,
  type RhConnectorAccountRow,
  type RhConnectorPortfolio,
} from "../execution/manager-account";
import {
  evaluateRhBandSize,
  evaluateRhBplusGate,
  evaluateRhTicketEnvelope,
  RH_BPLUS_MAX_CONTRACTS,
  RH_MAX_CONTRACTS,
  RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING,
  isBplusBand,
  rhPathFloorForBand,
} from "../execution/rh-autofire-gates";

/* ── Input: one room frame (duck-typed slice of FloorFrame) ─────────────── */

export interface RoomFrameLite {
  id: number;
  nowMs: number;
  output: { broker_action: BrokerAction } | Pick<RoomOutput, "broker_action">;
  trace: Pick<RoomTrace, "beat" | "gates" | "refusal" | "refusalGate" | "entry" | "optionsOpen" | "meeting">;
  /** Consensus P(T1) (screens.roomP). */
  roomP?: number | null;
  /** Each person's P(T1) (screens.lenses). */
  lenses?: Partial<Record<"Gemma" | "Jax" | "Nova" | "Sterling" | "Vince", { p: number }>> | null;
}

export interface RoomPushContext {
  /** The desk's options card this cycle (read.entry) — present even when the room built no plan. */
  card?: RoomEntryRead | null;
  /** Desk news blackout (read.news.blackout). */
  newsBlackout?: boolean;
  /** desk.feed === "synthetic". A synthetic feed never agrees. */
  synthetic?: boolean;
}

type Lens5 = "Gemma" | "Jax" | "Nova" | "Sterling" | "Vince";
const LENS5: Lens5[] = ["Gemma", "Jax", "Nova", "Sterling", "Vince"];

/** Owner overrides keyed by decisionKey — veto / table / hand-off hold agentAgree false. */
export type OwnerHold = "veto" | "table" | "owner";

function gateFailed(gates: Gate[], id: string): boolean {
  return gates.some((g) => g.id === id && !g.ok);
}

function decisionKeyOf(card: RoomEntryRead | null): string | null {
  if (!card) return null;
  return `${card.futSymbol}:${card.futSide}:${card.plan ? card.plan.entry.toFixed(2) : "none"}:${card.underlier}:${card.type}`;
}

function normOffset(o: string | null | undefined): "ATM" | "OTM_1" | null {
  return o === "ATM" ? "ATM" : o === "OTM_1" ? "OTM_1" : null;
}

/** The chair's agree verdict on a real room cycle. Pure. */
export function managerAgreeFromRoom(args: {
  frame: RoomFrameLite;
  card: RoomEntryRead | null;
  newsBlackout: boolean;
  synthetic: boolean;
  hold: OwnerHold | null;
}): {
  agree: boolean;
  blocks: string[];
  contracts: number | null;
  estDebitEach: number | null;
  estDebitTotal: number | null;
  strikeOffset: "ATM" | "OTM_1" | null;
} {
  const { frame, synthetic, hold } = args;
  const t = frame.trace;
  const ba = frame.output.broker_action;
  const plan = t.entry;
  const card = plan?.entry ?? args.card ?? null;
  const blocks: string[] = [];
  if (synthetic) blocks.push("synthetic_feed");
  if (t.beat !== "fill") blocks.push(t.refusalGate ?? `beat_${t.beat}`);
  if (!(ba.execute_trade && ba.action_type === "BUY_OPEN")) blocks.push("no_buy_open");
  if (!plan) blocks.push("no_entry_plan");
  for (const g of t.gates) if (!g.ok && !blocks.includes(g.id)) blocks.push(g.id);
  if (!t.gates.some((g) => g.id === "trigger" && g.ok)) {
    if (!blocks.includes("trigger")) blocks.push("trigger");
  }
  if (!t.optionsOpen) blocks.push("session");
  // News, the clock, and a shock cut size on the desk. They do not delete an A- the floor already armed.
  // Fit is a size input. The band is the permission. The number does not get a second vote.
  if (hold) blocks.push(`owner_${hold}`);
  let contracts: number | null = null;
  let estDebitEach: number | null = null;
  let estDebitTotal: number | null = null;
  const strikeOffset = normOffset(plan?.offset ?? null);
  if (!card) blocks.push("card");
  else {
    if (card.verdict !== "ARMED") blocks.push("floor");
    if (!((card.deskContracts ?? 0) >= 1)) blocks.push("floor_ticket");
    if (!(card.dte === 0 || card.dte === 1)) blocks.push("dte");
    const floor = rhPathFloorForBand(card.band);
    if (floor == null) blocks.push("path_band");
    if (isBplusBand(card.band)) {
      const bp = evaluateRhBplusGate({
        pathBand: card.band,
        confluence: card.confluence,
        seqTake: card.smcWord === "TAKE",
        vetoed: t.beat === "vetoed" || hold === "veto",
      });
      if (!bp.ok && !blocks.includes(bp.gate)) blocks.push(bp.gate);
    }
  }
  if (plan && card) {
    const cap = isBplusBand(card.band) ? RH_BPLUS_MAX_CONTRACTS : RH_MAX_CONTRACTS;
    // The Stand may only shrink the room's ticket, never grow it.
    contracts = Math.min(Math.max(0, Math.floor(plan.qty)), cap);
    estDebitEach = Number.isFinite(plan.quote?.ask) ? plan.quote.ask : null;
    estDebitTotal = estDebitEach != null ? Math.round(estDebitEach * 100 * contracts) : null;
    if (!strikeOffset) blocks.push("strike_offset");
    const env = evaluateRhTicketEnvelope({ contracts, debitTotal: estDebitTotal ?? Number.NaN, strikeOffset: strikeOffset ?? String(plan.offset) });
    if (!env.ok && !blocks.includes(env.gate)) blocks.push(env.gate);
    const size = evaluateRhBandSize(card.band, contracts);
    if (!size.ok && !blocks.includes(size.gate)) blocks.push(size.gate);
  }
  return { agree: blocks.length === 0, blocks, contracts, estDebitEach, estDebitTotal, strikeOffset };
}

function phaseFor(beat: string, agree: boolean, hasCard: boolean, meeting: boolean, hold: OwnerHold | null): ManagerPhase {
  if (hold === "veto") return "BLOCKED";
  switch (beat) {
    case "fill":
      return agree ? "AGREED" : "BLOCKED";
    case "trigger_wait":
      return "PROPOSING";
    case "vetoed":
    case "rejected":
      return "BLOCKED";
    case "holding":
      return "MANAGING";
    case "exit":
      return "CLOSING";
    case "blocked":
      return meeting || hasCard ? "CHAIRING" : "LISTENING";
    case "closed":
      return "IDLE";
    default:
      return meeting ? "CHAIRING" : "LISTENING";
  }
}

function actionFor(phase: ManagerPhase, agree: boolean, hold: OwnerHold | null): CallAction {
  if (hold === "veto") return "VETO";
  if (hold === "table") return "STAND_ASIDE";
  if (agree) return "AGREE_LIVE";
  switch (phase) {
    case "BLOCKED":
      return "VETO";
    case "MANAGING":
      return "MANAGE_ONLY";
    case "CLOSING":
      return "CLOSE";
    default:
      return "STAND_ASIDE";
  }
}

/** ManagerRoomState from a real room frame. Pure — same inputs, same state. */
export function managerStateFromRoom(args: {
  frame: RoomFrameLite;
  ctx?: RoomPushContext;
  account?: ManagerRhAccount | null;
  arms?: Partial<Pick<ArmSnap, "autofireEnabled" | "liveArmed">>;
  holds?: ReadonlyMap<string, OwnerHold> | null;
}): ManagerRoomState {
  const { frame } = args;
  const ctx = args.ctx ?? {};
  const t = frame.trace;
  const plan = t.entry;
  const card = plan?.entry ?? ctx.card ?? null;
  const decisionKey = decisionKeyOf(card) ?? `room-${frame.id}:none`;
  const hold = args.holds?.get(decisionKey) ?? null;
  const synthetic = ctx.synthetic === true;
  const newsBlackout = ctx.newsBlackout === true;
  const verdict = managerAgreeFromRoom({ frame, card, newsBlackout, synthetic, hold });
  const phase = synthetic ? "BLOCKED" : phaseFor(t.beat, verdict.agree, !!card, !!t.meeting, hold);
  const lenses: ManagerCall["lenses"] = {};
  for (const who of LENS5) {
    const p = frame.lenses?.[who]?.p;
    if (typeof p === "number" && Number.isFinite(p)) lenses[who] = p;
  }
  const band = card?.band ?? null;
  const call: ManagerCall | null =
    card || t.beat === "holding" || t.beat === "exit"
      ? {
          action: actionFor(phase, verdict.agree, hold),
          agentAgree: verdict.agree,
          underlier: card?.underlier ?? null,
          side: card ? (card.type === "PUT" ? "put" : "call") : null,
          strikeOffset: verdict.strikeOffset,
          contracts: verdict.contracts,
          estDebitTotal: verdict.estDebitTotal,
          decisionKey,
          reasoning: {
            thesis: verdict.agree
              ? `Room fills ${card?.underlier} ${card?.type === "PUT" ? "put" : "call"} ${verdict.strikeOffset} ×${verdict.contracts}. ${schoolTicket(card?.futSymbol ?? card?.underlier ?? "Index", card?.futSide === "short" ? "short" : "long")}`
              : t.refusal
                ? `Stand aside — ${t.refusal}`
                : t.beat === "trigger_wait"
                  ? "Resting at the CE — the room only buys the touch."
                  : t.beat === "holding"
                    ? "Managing the room's open position."
                    : t.beat === "exit"
                      ? "Room is closing a position."
                      : `Stand aside — ${verdict.blocks[0] ?? t.beat}.`,
            floorCite: card
              ? `Floor ${card.verdict} · desk ticket ${card.deskContracts ?? 0}× · ${card.dte} DTE · SMC ${card.smcWord}`
              : "No Floor card",
            pathCite: card ? `PATH ${band ?? "—"} Q ${card.confluence.toFixed(2)}` : "No PATH card",
            debateCite: `room beat ${t.beat}${t.meeting ? ` · ${t.meeting.title}` : ""}${t.refusalGate ? ` · gate ${t.refusalGate}` : ""}`,
            blocks: verdict.agree ? [] : verdict.blocks,
          },
          lenses,
          roomP: typeof frame.roomP === "number" ? frame.roomP : null,
        }
      : null;
  const signals: ManagerRoomSignals = {
    frameAt: frame.nowMs,
    beat: t.beat,
    ceTouch: card ? t.gates.some((g) => g.id === "trigger" && g.ok) : null,
    dte: card ? card.dte : null,
    seqTake: card ? card.smcWord === "TAKE" : null,
    vetoed: card ? t.beat === "vetoed" || hold === "veto" || call?.action === "VETO" : null,
    futSymbol: card?.futSymbol ?? null,
    futSide: card?.futSide ?? null,
    expiry: plan?.exp ?? null,
    estDebitEach: verdict.estDebitEach,
    synthetic,
  };
  return {
    version: 1,
    updatedAt: frame.nowMs,
    cycleId: `room-${frame.id}`,
    current: phase,
    call,
    open: null,
    close: null,
    floor: {
      verdict: card?.verdict === "ARMED" ? "ARMED" : card?.verdict === "WATCH" ? "WATCH" : "STAND",
      deskContracts: card?.deskContracts ?? 0,
      cardKey: card ? decisionKey : null,
      strategy: card?.strategy ?? null,
    },
    path: {
      // The desk only ARMs an actionable PATH card; WATCH/STAND are not actionable.
      actionable: card?.verdict === "ARMED",
      band,
      confluence: card?.confluence ?? 0,
    },
    arms: {
      autofireEnabled: args.arms?.autofireEnabled === true,
      liveArmed: args.arms?.liveArmed === true,
      confirmedInWriting: RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING,
      optionsSessionOpen: t.optionsOpen,
      newsBlackout,
      riskHalt: gateFailed(t.gates, "halt_day") || gateFailed(t.gates, "halt_week"),
      oneBookBlocked: gateFailed(t.gates, "one_book"),
    },
    account: args.account ?? DEFAULT_MANAGER_ROOM_ACCOUNT,
    signals,
  };
}

/** State before the first room cycle: listening, no call, never agrees. */
export function managerStateWaiting(account: ManagerRhAccount | null, nowMs: number): ManagerRoomState {
  return {
    version: 1,
    updatedAt: nowMs,
    cycleId: "room-0",
    current: "LISTENING",
    call: null,
    open: null,
    close: null,
    floor: { verdict: "STAND", deskContracts: 0, cardKey: null, strategy: null },
    path: { actionable: false, band: null, confluence: 0 },
    arms: {
      autofireEnabled: false,
      liveArmed: false,
      confirmedInWriting: RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING,
      optionsSessionOpen: false,
      newsBlackout: false,
      riskHalt: false,
      oneBookBlocked: false,
    },
    account: account ?? DEFAULT_MANAGER_ROOM_ACCOUNT,
  };
}

/* ── The feed ───────────────────────────────────────────────────────────── */

export interface RoomManagerFeed extends ManagerFeed {
  /** Marks the real feed (never the stub). */
  readonly live: true;
  readonly stub: false;
  /** One real room cycle (room-engine.ts runLiveCycle). */
  pushRoom(frame: RoomFrameLite, ctx?: RoomPushContext): ManagerRoomState;
  /** Live account block (null → DEFAULT snapshot, which can never authorize). */
  setAccount(a: ManagerRhAccount | null): void;
  /** get_accounts row + get_portfolio data for Agentic 995386158 → ManagerRoomState.account. */
  setAccountFromConnector(args: { account: RhConnectorAccountRow; portfolio: RhConnectorPortfolio; asOf?: string }): ManagerRhAccount;
  /** Host-reported env arms (display; the gates read env themselves). */
  setArms(arms: Partial<Pick<ArmSnap, "autofireEnabled" | "liveArmed">>): void;
  dispose(): void;
}

const STEER_LINES: Record<SteerMove, { address: ManagerSteer["address"]; beat: ManagerSteer["beat"]; line: string }> = {
  OPEN_FLOOR: { address: "ALL", beat: "chair_open", line: "Gemma — clock first; then Nova prices." },
  ASK_LENS: { address: "Nova", beat: "chair_redirect", line: "Nova — give me the number." },
  CUT_LOOP: { address: "ALL", beat: "chair_redirect", line: "Cut the heartbeat — next beat." },
  DEMAND_PREMORTEM: { address: "Sterling", beat: "challenge", line: "Sterling — premortem before any agree." },
  TABLE: { address: "ALL", beat: "chair_close", line: "Table it. Stand aside on this card." },
  CALL_VOTE: { address: "ALL", beat: "verdict", line: "Snapshot the lenses — form the call." },
  DECLARE_AGREE: { address: "ALL", beat: "execution", line: "Agree only if the room's gates clear — the room decides." },
  DECLARE_VETO: { address: "ALL", beat: "chair_close", line: "Stand veto on this card — no live agree." },
  HAND_TO_OWNER: { address: "ALL", beat: "chair_close", line: "Hand to Owner — no agree until Owner clears." },
};

export function createRoomManagerFeed(opts: { account?: ManagerRhAccount | null } = {}): RoomManagerFeed {
  let account: ManagerRhAccount | null = opts.account ?? null;
  let arms: Partial<Pick<ArmSnap, "autofireEnabled" | "liveArmed">> = {};
  let last: { frame: RoomFrameLite; ctx: RoomPushContext } | null = null;
  const holds = new Map<string, OwnerHold>();
  let state = managerStateWaiting(account, Date.now());
  let lastSteer: ManagerSteer | null = null;
  const feedback: OwnerFeedback[] = [];
  const rules: DiscretionRule[] = [];
  const listeners = new Set<(s: ManagerRoomState) => void>();

  const rebuild = () => {
    state = last
      ? managerStateFromRoom({ frame: last.frame, ctx: last.ctx, account, arms, holds })
      : { ...managerStateWaiting(account, Date.now()), arms: { ...managerStateWaiting(account, 0).arms, autofireEnabled: arms.autofireEnabled === true, liveArmed: arms.liveArmed === true } };
    for (const l of listeners) l(state);
    return state;
  };

  return {
    live: true,
    stub: false,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    pushRoom(frame, ctx = {}) {
      last = { frame, ctx };
      return rebuild();
    },
    setAccount(a) {
      account = a;
      rebuild();
    },
    setAccountFromConnector(args) {
      const a = managerRhAccountFromConnector(args);
      account = a;
      rebuild();
      return a;
    },
    setArms(next) {
      arms = { ...arms, ...next };
      rebuild();
    },
    steer(move, o) {
      const def = STEER_LINES[move];
      const ev: ManagerSteer = {
        cycleId: state.cycleId,
        beat: def.beat,
        address: o?.address ?? def.address,
        move,
        line: o?.line ?? def.line,
        injectIntoTalk: false,
      };
      lastSteer = ev;
      const key = state.call?.decisionKey ?? null;
      // Owner chips can only REMOVE agreement (veto / table / hand-off). DECLARE_AGREE
      // never forces agentAgree true — only a real room fill through the chair rules does.
      if (key) {
        if (move === "DECLARE_VETO") holds.set(key, "veto");
        else if (move === "TABLE") holds.set(key, "table");
        else if (move === "HAND_TO_OWNER") holds.set(key, "owner");
        else if (move === "DECLARE_AGREE" && holds.get(key) !== "veto") holds.delete(key);
      }
      rebuild();
      return ev;
    },
    teach(fb) {
      const id = fb.id ?? `fb-${Date.now().toString(36)}`;
      const at = fb.at ?? Date.now();
      const full: OwnerFeedback = {
        id,
        at,
        kind: fb.kind,
        cycleId: fb.cycleId ?? state.cycleId,
        decisionKey: fb.decisionKey ?? state.call?.decisionKey ?? null,
        targetAction: fb.targetAction ?? null,
        text: fb.text,
        ruleDraft: fb.ruleDraft,
      };
      feedback.push(full);
      if (full.kind === "REJECT_CALL" && full.decisionKey) holds.set(full.decisionKey, "veto");
      if (full.kind === "TEACH_RULE" && full.ruleDraft) {
        rules.push({
          id: `rule-${id}`,
          version: 1,
          createdAt: at,
          sourceFeedbackId: id,
          scope: full.ruleDraft.scope,
          scopeKey: full.ruleDraft.scopeKey,
          effect: full.ruleDraft.effect,
          factor: full.ruleDraft.factor,
          text: full.ruleDraft.text || full.text,
          active: true,
          hits: 0,
          lastHitAt: null,
        });
      }
      rebuild();
      return full;
    },
    getLastSteer: () => lastSteer,
    getFeedbackLog: () => [...feedback],
    getRules: () => [...rules],
    dispose() {
      listeners.clear();
    },
  };
}

/* ── One shared real feed for the page (room engine pushes; Floor + loop read) ── */

let shared: RoomManagerFeed | null = null;

export function roomManagerFeed(): RoomManagerFeed {
  if (!shared) shared = createRoomManagerFeed();
  return shared;
}

export function isRoomManagerFeed(feed: ManagerFeed | null | undefined): feed is RoomManagerFeed {
  return !!feed && (feed as Partial<RoomManagerFeed>).live === true && (feed as Partial<RoomManagerFeed>).stub === false;
}

/** Dev-only demo opt-in: ?manager=stub. Everything else gets the real room feed. */
export function managerStubRequested(): boolean {
  if (!import.meta.env?.DEV || typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("manager") === "stub";
}
