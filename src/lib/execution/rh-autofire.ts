/**
 * RH live proposal builder. Does NOT place.
 * Agent: review_option_order (preview — no preview_option_order) then place_option_order when armed.
 * Envelope $150-$550, 1-4 ct, ATM/OTM_1. Keaton 2026-10-06.
 * BP hard gate: agent calls get_portfolio before propose (candidate.account) and
 * again before place (mayPlaceAfterReview.accountAtReview). BP < $150 → refused.
 */
import {
  evaluateRhAutofireGates,
  evaluateRhBuyingPower,
  evaluateRhTicketEnvelope,
  RH_LIVE_DISARMED_REASON,
  RH_MAX_CONTRACTS,
  RH_MAX_DEBIT_TOTAL,
  RH_MIN_CONTRACTS,
  RH_MIN_DEBIT_TOTAL,
  RH_NOT_CONFIRMED_REASON,
  RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING,
  RH_PATH_FLOOR,
  type RhAccountSnapshot,
  type RhAutofireCandidate,
  type RhAutofireFlags,
  type RhAutofireGateResult,
  type RhStrikeOffset,
} from "./rh-autofire-gates";
import {
  resolveStandAgentAgree,
  type ManagerCallAgree,
  type ManagerRoomStateAgree,
} from "./manager-agree";

export {
  agentAgreeFromManagerCall,
  agentAgreeFromManagerRoomState,
  resolveStandAgentAgree,
} from "./manager-agree";
export type { ManagerCallAgree, ManagerRoomStateAgree } from "./manager-agree";

export { rhAccountFromPortfolio, RH_DESK_ACCOUNT_SNAPSHOT, maskAccount } from "./rh-account";

export {
  evaluateRhAutofireGates,
  evaluateRhBuyingPower,
  evaluateRhTicketEnvelope,
  rhSpendable,
  RH_BP_MAX_AGE_MS,
  RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING,
  RH_PATH_FLOOR,
  RH_MIN_DEBIT_TOTAL,
  RH_MAX_DEBIT_TOTAL,
  RH_MIN_CONTRACTS,
  RH_MAX_CONTRACTS,
  RH_LIVE_DISARMED_REASON,
  RH_NOT_CONFIRMED_REASON,
} from "./rh-autofire-gates";
export type { RhAccountSnapshot, RhAutofireCandidate, RhAutofireFlags, RhAutofireGateResult, RhStrikeOffset };

function boolEnv(name: string, env: Record<string, string | undefined> = process.env): boolean {
  return (env[name] ?? "").trim().toLowerCase() === "true";
}

export function rhAutofireEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return boolEnv("RH_OPTIONS_AUTOFIRE_ENABLED", env);
}

export function rhLiveArmed(env: Record<string, string | undefined> = process.env): boolean {
  return boolEnv("RH_LIVE_ARMED", env);
}

export function rhAutofireFlagsFromEnv(
  env: Record<string, string | undefined> = process.env,
): RhAutofireFlags {
  return {
    autofireEnabled: rhAutofireEnabled(env),
    liveArmed: rhLiveArmed(env),
    confirmedInWriting: RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING,
  };
}

export interface RhLiveTicket {
  underlier: "QQQ" | "SPY";
  side: "call" | "put";
  dteTarget: number;
  expiry?: string | null;
  strikeNote: string;
  strikeOffset: RhStrikeOffset;
  contracts: number;
  estDebitEach: number;
  maxDebitTotal: number;
  decisionKey: string;
  reason: string;
}

export interface RhReviewPlaceShape {
  optionId: string | null;
  quantity: number;
  side: "buy";
  positionEffect: "open";
  type: "limit";
  priceHint: number;
  timeInForce: "gfd";
  refIdHint: string;
  underlier: "QQQ" | "SPY";
  optionType: "call" | "put";
  expiry: string | null;
  strikeNote: string;
  decisionKey: string;
  reason: string;
}

export interface RhAutofireProposal {
  gated: RhAutofireGateResult;
  ticket: RhLiveTicket | null;
  placeShape: RhReviewPlaceShape | null;
  mode: "live_when_armed" | "refused";
  flags: RhAutofireFlags;
}

export function buildRhReviewPlaceShape(ticket: RhLiveTicket, refIdHint: string): RhReviewPlaceShape {
  const slip = 0.02;
  return {
    optionId: null,
    quantity: Math.min(RH_MAX_CONTRACTS, Math.max(RH_MIN_CONTRACTS, Math.floor(ticket.contracts))),
    side: "buy",
    positionEffect: "open",
    type: "limit",
    priceHint: Math.round((ticket.estDebitEach + slip) * 100) / 100,
    timeInForce: "gfd",
    refIdHint,
    underlier: ticket.underlier,
    optionType: ticket.side,
    expiry: ticket.expiry ?? null,
    strikeNote: ticket.strikeNote,
    decisionKey: ticket.decisionKey,
    reason: ticket.reason,
  };
}

export function proposeRhLiveOption(args: {
  candidate: RhAutofireCandidate;
  ticket: RhLiveTicket | null;
  flags?: RhAutofireFlags;
  refIdHint?: string;
  env?: Record<string, string | undefined>;
}): RhAutofireProposal {
  const flags = args.flags ?? rhAutofireFlagsFromEnv(args.env);
  const gated = evaluateRhAutofireGates(args.candidate, flags);
  if (!gated.ok) {
    return { gated, ticket: null, placeShape: null, mode: "refused", flags };
  }
  if (!args.ticket) {
    return {
      gated: { ok: false, gate: "ticket", reason: "No live ticket attached after gates cleared." },
      ticket: null,
      placeShape: null,
      mode: "refused",
      flags,
    };
  }
  const envelope = evaluateRhTicketEnvelope({
    contracts: args.ticket.contracts,
    debitTotal: args.ticket.maxDebitTotal,
    strikeOffset: args.ticket.strikeOffset,
  });
  if (!envelope.ok) {
    return { gated: envelope, ticket: null, placeShape: null, mode: "refused", flags };
  }
  const bp = evaluateRhBuyingPower(args.candidate.account, flags.nowMs ?? Date.now(), args.ticket.maxDebitTotal);
  if (!bp.ok) {
    return { gated: bp, ticket: null, placeShape: null, mode: "refused", flags };
  }
  const ref = args.refIdHint ?? `rh-${args.ticket.decisionKey}`;
  return {
    gated,
    ticket: args.ticket,
    placeShape: buildRhReviewPlaceShape(args.ticket, ref),
    mode: "live_when_armed",
    flags,
  };
}

export function mayPlaceAfterReview(args: {
  gatesStillOk: boolean;
  liveArmedNow: boolean;
  confirmedInWriting?: boolean;
  reviewHadBlockingAlert: boolean;
  agenticAllowed: boolean;
  optionsLevelOk: boolean;
  /** Fresh get_portfolio read taken after review_option_order. Missing → refuse. */
  accountAtReview?: RhAccountSnapshot | null;
  /** The reviewed ticket's total debit (limit × 100 × qty). */
  debitTotal?: number | null;
  nowMs?: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!args.gatesStillOk) return { ok: false, reason: "Gates no longer pass — do not place." };
  const bp = evaluateRhBuyingPower(args.accountAtReview, args.nowMs ?? Date.now(), args.debitTotal ?? null);
  if (!bp.ok) return { ok: false, reason: bp.reason };
  if (!args.liveArmedNow) return { ok: false, reason: RH_LIVE_DISARMED_REASON };
  if (!(args.confirmedInWriting ?? RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING)) {
    return { ok: false, reason: RH_NOT_CONFIRMED_REASON };
  }
  if (!args.agenticAllowed) return { ok: false, reason: "Robinhood account agentic_allowed=false — read-only." };
  if (!args.optionsLevelOk) return { ok: false, reason: "Options level < 2 — cannot buy calls/puts." };
  if (args.reviewHadBlockingAlert) {
    return { ok: false, reason: "review_option_order surfaced a blocking alert — human must acknowledge before place." };
  }
  return { ok: true };
}

/**
 * Build RhAutofireCandidate from Floor + PATH + Trading Stand Manager.
 *
 * Prefer `manager` (ManagerRoomState.call.agentAgree) or `managerCall`.
 * When Manager feed is absent, pass explicit `agentAgree` or omit → false.
 * Does not soften evaluateRhAutofireGates / envelope / arm checks.
 */
export function candidateFromFloorPathStand(args: {
  floor: {
    verdict: string;
    deskContracts: number | null;
    band: string | null;
    confluence: number;
  } | null;
  pathActionable: boolean;
  /**
   * Explicit Stand bit (legacy / tests). Ignored when `manager` or
   * `managerCall` is provided — Manager owns agentAgree.
   */
  agentAgree?: boolean;
  /** Design ManagerRoomState — call.agentAgree is THE Stand bit. */
  manager?: ManagerRoomStateAgree | null;
  /** Design ManagerCall (or duck-typed). */
  managerCall?: ManagerCallAgree | null;
  optionsSessionOpen: boolean;
  newsBlackout: boolean;
  riskHalt: boolean;
  oneBookBlocked: boolean;
  /** Fresh get_portfolio read (rhAccountFromPortfolio). Missing → gates refuse bp_unknown. */
  account?: RhAccountSnapshot | null;
}): RhAutofireCandidate {
  const f = args.floor;
  const agreeArgs: {
    manager?: ManagerRoomStateAgree | null;
    managerCall?: ManagerCallAgree | null;
    agentAgree?: boolean;
  } = { agentAgree: args.agentAgree };
  if ("manager" in args) agreeArgs.manager = args.manager;
  if ("managerCall" in args) agreeArgs.managerCall = args.managerCall;
  const agentAgree = resolveStandAgentAgree(agreeArgs);
  return {
    floorVerdict: f?.verdict ?? "STAND",
    deskContracts: f?.deskContracts ?? 0,
    pathActionable: args.pathActionable,
    pathBand: f?.band ?? null,
    confluence: typeof f?.confluence === "number" ? f.confluence : 0,
    agentAgree,
    optionsSessionOpen: args.optionsSessionOpen,
    newsBlackout: args.newsBlackout,
    riskHalt: args.riskHalt,
    oneBookBlocked: args.oneBookBlocked,
    account: args.account ?? null,
  };
}

export function ticketFromRhCard(args: {
  underlier: "QQQ" | "SPY";
  side: "call" | "put";
  dteTarget: number;
  expiry?: string | null;
  strikeNote: string;
  strikeOffset: RhStrikeOffset;
  contracts: number;
  estDebitEach: number;
  estDebitTotal: number;
  decisionKey: string;
  reason: string;
}): RhLiveTicket {
  return {
    underlier: args.underlier,
    side: args.side,
    dteTarget: args.dteTarget,
    expiry: args.expiry ?? null,
    strikeNote: args.strikeNote,
    strikeOffset: args.strikeOffset,
    contracts: args.contracts,
    estDebitEach: args.estDebitEach,
    maxDebitTotal: args.estDebitTotal,
    decisionKey: args.decisionKey,
    reason: args.reason,
  };
}
