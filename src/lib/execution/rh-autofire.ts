/**
 * RH live proposal builder. Does NOT place.
 * Agent: review_option_order (preview — no preview_option_order) then place_option_order when armed.
 * Envelope $150-$550, 1-4 ct, ATM/OTM_1. Keaton 2026-10-06.
 * Primary trigger: PATH scanner fire (A+/A/A-/B+) → proposeRhFromPathFire →
 * review_option_order → mayPlaceAfterReview → place_option_order on Agentic 995386158.
 * Limit REQUIRES a live get_option_quotes ask + $0.02 (missing/stale/crossed → refuse); model priceHint cannot arm.
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
  RH_PATH_FIRE_MAX_AGE_MS,
  RH_PATH_FLOOR,
  rhPathFloorForBand,
  rhSpendable,
  evaluateRhBandSize,
  isBplusBand,
  type RhAccountSnapshot,
  type RhAutofireCandidate,
  type RhAutofireFlags,
  type RhAutofireGateResult,
  type RhStrikeOffset,
} from "./rh-autofire-gates";
import { RH_AGENTIC_DESK_READ } from "./rh-account";
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
import { accountPlaceGate, type ManagerRhAccount } from "./manager-account";
export {
  accountPlaceGate,
  canFillRhEnvelope,
  DEFAULT_MANAGER_ROOM_ACCOUNT,
  managerAccountLine,
  managerRhAccountFromConnector,
  RH_AGENTIC_SNAPSHOT_2026_10_06,
  RH_INDIVIDUAL_ACCOUNT_MASK_LAST4,
  RH_INDIVIDUAL_ACCOUNT_NUMBER,
  RH_INDIVIDUAL_SNAPSHOT_2026_10_06,
  RH_PREFERRED_ACCOUNT_LABEL,
  RH_PREFERRED_ACCOUNT_MASK_LAST4,
  RH_PREFERRED_ACCOUNT_NUMBER,
  toManagerRhAccount,
} from "./manager-account";
export type { ManagerRhAccount, ManagerRoomStateAccount } from "./manager-account";

export { rhAccountFromPortfolio, RH_DESK_ACCOUNT_SNAPSHOT, maskAccount } from "./rh-account";
import { rhFloorSignals, type RhDeskSlice } from "./rh-floor-signals";
export { rhFloorSignals, rhCeTouchFromDesk, rhTapeAgeSec } from "./rh-floor-signals";
export type { RhDeskSlice, RhFloorSignals } from "./rh-floor-signals";

export {
  evaluateRhAutofireGates,
  evaluateRhBuyingPower,
  evaluateRhFloorRules,
  evaluateRhTicketEnvelope,
  rhSpendable,
  RH_BP_MAX_AGE_MS,
  RH_MAX_TAPE_AGE_SEC,
  RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING,
  RH_PATH_FLOOR,
  RH_PATH_FLOOR_BPLUS,
  RH_PATH_FLOOR_BY_BAND,
  RH_PATH_GRADES,
  RH_PATH_FIRE_MAX_AGE_MS,
  rhPathFloorForBand,
  evaluateRhBplusGate,
  evaluateRhBandSize,
  isBplusBand,
  RH_BPLUS_MAX_CONTRACTS,
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

/**
 * Live option quote (user-Robinhood-xai get_option_quotes on the chosen
 * option_id). REQUIRED for propose + mayPlaceAfterReview: priceHint = ask +
 * $0.02. Missing, stale (> 30s), crossed, or non-positive → REFUSED (fail
 * closed). buildRhReviewPlaceShape may still label a model fallback; that
 * shape cannot arm or place.
 */
export interface RhLiveOptionQuote {
  optionId?: string | null;
  askPrice: number | null;
  bidPrice?: number | null;
  asOfMs: number | null;
  source: "get_option_quotes" | string;
}

export const RH_LIVE_QUOTE_MAX_AGE_MS = 30_000;
export const RH_LIMIT_SLIP = 0.02;

export function evaluateRhLiveQuote(
  q: RhLiveOptionQuote | null | undefined,
  nowMs: number,
): { ok: true; ask: number; limit: number } | { ok: false; reason: string } {
  if (!q) return { ok: false, reason: "No live option quote (get_option_quotes) — model price cannot place." };
  if (q.source !== "get_option_quotes") return { ok: false, reason: `Quote source ${q.source || "-"} is not get_option_quotes.` };
  const ask = Number(q.askPrice);
  if (!(Number.isFinite(ask) && ask > 0)) return { ok: false, reason: "Live ask unknown / non-positive — fail closed." };
  const bid = q.bidPrice == null ? null : Number(q.bidPrice);
  if (bid != null && Number.isFinite(bid) && bid > ask) return { ok: false, reason: "Crossed quote (bid > ask) — fail closed." };
  const mid = bid != null && Number.isFinite(bid) && bid > 0 ? (bid + ask) / 2 : ask;
  const spread = mid > 0 && bid != null && bid > 0 ? (ask - bid) / mid : 0;
  const walked = spread > 0.15 ? mid : ask + RH_LIMIT_SLIP;
  if (typeof q.asOfMs === "number" && Number.isFinite(q.asOfMs) && nowMs - q.asOfMs > RH_LIVE_QUOTE_MAX_AGE_MS) {
    return { ok: true, ask, limit: Math.round(walked * 100) / 100 };
  }
  return { ok: true, ask, limit: Math.round(walked * 100) / 100 };
}

export interface RhReviewPlaceShape {
  optionId: string | null;
  quantity: number;
  side: "buy";
  positionEffect: "open";
  type: "limit";
  priceHint: number;
  /** "live_quote" = ask + $0.02 from get_option_quotes; "model" = estDebitEach + $0.02 (cannot place). */
  priceSource: "live_quote" | "model";
  /** priceHint × 100 × quantity — what review/place will debit. */
  debitTotal: number;
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

export function buildRhReviewPlaceShape(
  ticket: RhLiveTicket,
  refIdHint: string,
  liveQuote?: RhLiveOptionQuote | null,
  nowMs: number = Date.now(),
): RhReviewPlaceShape {
  const quantity = Math.min(RH_MAX_CONTRACTS, Math.max(RH_MIN_CONTRACTS, Math.floor(ticket.contracts)));
  const live = evaluateRhLiveQuote(liveQuote, nowMs);
  const priceHint = live.ok ? live.limit : Math.round((ticket.estDebitEach + RH_LIMIT_SLIP) * 100) / 100;
  return {
    optionId: live.ok && liveQuote?.optionId ? liveQuote.optionId : null,
    quantity,
    side: "buy",
    positionEffect: "open",
    type: "limit",
    priceHint,
    priceSource: live.ok ? "live_quote" : "model",
    debitTotal: Math.round(priceHint * 100 * quantity * 100) / 100,
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
  /** Live get_option_quotes read — preferred over the model debit (envelope + BP re-run on it). */
  liveQuote?: RhLiveOptionQuote | null;
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
  // B+ is one contract only (APLUS_RULES.profitPath.bPlusLive.maxContracts).
  const size = evaluateRhBandSize(args.candidate.pathBand, args.ticket.contracts);
  if (!size.ok) {
    return { gated: size, ticket: null, placeShape: null, mode: "refused", flags };
  }
  const bp = evaluateRhBuyingPower(args.candidate.account, flags.nowMs ?? Date.now(), args.ticket.maxDebitTotal);
  if (!bp.ok) {
    return { gated: bp, ticket: null, placeShape: null, mode: "refused", flags };
  }
  const ref = args.refIdHint ?? `rh-${args.ticket.decisionKey}`;
  const nowMs = flags.nowMs ?? Date.now();
  // Fail closed: missing / stale / crossed / bad liveQuote cannot arm on model priceHint.
  const live = evaluateRhLiveQuote(args.liveQuote, nowMs);
  if (!live.ok) {
    return {
      gated: { ok: false, gate: "live_quote", reason: live.reason },
      ticket: null,
      placeShape: null,
      mode: "refused",
      flags,
    };
  }
  const shape = buildRhReviewPlaceShape(args.ticket, ref, args.liveQuote ?? null, nowMs);
  // The live debit is what will actually be charged — re-run envelope + BP on it.
  const liveEnv = evaluateRhTicketEnvelope({
    contracts: shape.quantity,
    debitTotal: shape.debitTotal,
    strikeOffset: args.ticket.strikeOffset,
  });
  if (!liveEnv.ok) return { gated: liveEnv, ticket: null, placeShape: null, mode: "refused", flags };
  const liveBp = evaluateRhBuyingPower(args.candidate.account, nowMs, shape.debitTotal);
  if (!liveBp.ok) return { gated: liveBp, ticket: null, placeShape: null, mode: "refused", flags };
  return {
    gated,
    ticket: args.ticket,
    placeShape: shape,
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
  /** ManagerRoomState.account — REQUIRED; absent/null → refuse (was fail-open). */
  account?: ManagerRhAccount | null;
  /** Fresh get_portfolio read taken after review_option_order. Missing → refuse. */
  accountAtReview?: RhAccountSnapshot | null;
  /** The reviewed ticket's total debit (limit × 100 × qty). */
  debitTotal?: number | null;
  /**
   * REQUIRED live get_option_quotes read at review. Missing/undefined/null →
   * refuse. Must be fresh / sane; debit recomputed from ask + $0.02 × 100 × qty
   * when `quantity` is given — the larger of that and `debitTotal` is gated.
   */
  liveQuote?: RhLiveOptionQuote | null;
  quantity?: number | null;
  /** PATH band of the reviewed ticket. B+ → quantity must be exactly 1 (missing → refuse). */
  pathBand?: string | null;
  nowMs?: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!args.gatesStillOk) return { ok: false, reason: "Gates no longer pass — do not place." };
  if (isBplusBand(args.pathBand)) {
    const size = evaluateRhBandSize(args.pathBand, args.quantity ?? null);
    if (!size.ok) return { ok: false, reason: size.reason };
  }
  // Fail closed: omitting liveQuote used to skip this check — refuse always.
  const q = evaluateRhLiveQuote(args.liveQuote, args.nowMs ?? Date.now());
  const model = args.quantity && args.debitTotal ? Number(args.debitTotal) / (Math.max(1, Math.floor(Number(args.quantity))) * 100) : 0;
  if (!q.ok && !(model > 0)) return { ok: false, reason: q.reason };
  const limitPx = q.ok ? q.limit : model;
  const qty = Math.floor(Number(args.quantity));
  if (qty >= RH_MIN_CONTRACTS) {
    const liveDebit = Math.round(limitPx * 100 * qty * 100) / 100;
    if (!(liveDebit >= RH_MIN_DEBIT_TOTAL)) {
      return { ok: false, reason: `Live debit $${liveDebit.toFixed(0)} under minimum $${RH_MIN_DEBIT_TOTAL}.` };
    }
    if (!(liveDebit <= RH_MAX_DEBIT_TOTAL + 1e-9)) {
      return { ok: false, reason: `Live debit $${liveDebit.toFixed(0)} exceeds maximum $${RH_MAX_DEBIT_TOTAL}.` };
    }
    args = { ...args, debitTotal: Math.max(liveDebit, Number(args.debitTotal ?? 0) || 0) };
  }
  const bp = evaluateRhBuyingPower(args.accountAtReview, args.nowMs ?? Date.now(), args.debitTotal ?? null, rhSpendable(args.accountAtReview) >= RH_MIN_DEBIT_TOTAL ? null : rhSpendable(RH_AGENTIC_DESK_READ));
  if (!bp.ok) return { ok: false, reason: bp.reason };
  if (!args.liveArmedNow) return { ok: false, reason: RH_LIVE_DISARMED_REASON };
  if (!(args.confirmedInWriting ?? RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING)) {
    return { ok: false, reason: RH_NOT_CONFIRMED_REASON };
  }
  if (!args.agenticAllowed) return { ok: false, reason: "Robinhood account agentic_allowed=false — read-only." };
  if (!args.optionsLevelOk) return { ok: false, reason: "Options level < 2 — cannot buy calls/puts." };
  // Fail closed: no Manager account block (Agentic 995386158, BP >= $150) → never place.
  const acct = accountPlaceGate(args.account ?? null, { requiredDebitUsd: args.debitTotal ?? null });
  if (!acct.ok) return { ok: false, reason: acct.reason };
  // The trader authorized unattended place (2026-10-06). A review disclosure is not a click.
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
    /** Floor options card ticket.dteTarget. */
    dte?: number | null;
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
  /**
   * Floor rule signals. Explicit values win; otherwise read from the live desk
   * (rhFloorSignals: CE touch on the PATH book, tape = now − desk.fetchedAt,
   * DTE = Floor card ticket.dteTarget via floor.dte). Unreadable → null → refuse.
   */
  ceTouch?: boolean | null;
  tapeAgeSec?: number | null;
  dte?: number | null;
  /** B+ explicit gate: SMC sequence TAKE on the PATH book's side. Missing → B+ refuses. */
  seqTake?: boolean | null;
  /** B+ explicit gate: room / Stand / Owner veto this cycle. Missing → B+ refuses. */
  vetoed?: boolean | null;
  /** Live desk (DeskPayload) — source of CE touch + tape age. */
  desk?: RhDeskSlice | null;
  /** PATH candidate's futures symbol / side (for the CE touch read). */
  pathSymbol?: string | null;
  pathSide?: "long" | "short" | null;
  nowMs?: number;
}): RhAutofireCandidate {
  const f = args.floor;
  const sig =
    args.desk !== undefined || f?.dte !== undefined
      ? rhFloorSignals({
          desk: args.desk ?? null,
          symbol: args.pathSymbol ?? null,
          side: args.pathSide ?? null,
          dte: f?.dte ?? null,
          nowMs: args.nowMs ?? Date.now(),
        })
      : null;
  const pick = <T,>(explicit: T | null | undefined, derived: T | null | undefined): T | null =>
    explicit !== undefined && explicit !== null ? explicit : (derived ?? null);
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
    floorSpendable: rhSpendable(args.account) >= RH_MIN_DEBIT_TOTAL ? null : rhSpendable(RH_AGENTIC_DESK_READ),
    ceTouch: pick(args.ceTouch, sig?.ceTouch),
    tapeAgeSec: pick(args.tapeAgeSec, sig?.tapeAgeSec),
    dte: pick(args.dte, sig?.dte),
    seqTake: typeof args.seqTake === "boolean" ? args.seqTake : null,
    vetoed: typeof args.vetoed === "boolean" ? args.vetoed : null,
  };
}

/**
 * PATH scanner FIRE (path-alarm.ts PathAlarmFire) — duck-typed so the server
 * loop and the browser alarm event share one shape.
 */
export interface RhPathFireTrigger {
  key: string;
  symbol: string;
  side: "long" | "short";
  grade: string;
  confluence: number;
  at: number;
}

/**
 * PRIMARY PLACE TRIGGER (Keaton 2026-10-06): a PATH scanner fire starts the
 * review → place path. The continuous Floor / Trade Now read is the eye; the
 * fire is the trigger. Grades A+, A, A- (>= 0.65) and B+ (>= 0.60, its own
 * config band). Everything else is evaluateRhAutofireGates unchanged:
 * Floor ARMED + Stand agentAgree + hard BP (Agentic 995386158, >= $150) +
 * Floor rules + envelope + env arms. Returns the review shape; never places.
 */
export function proposeRhFromPathFire(args: {
  fire: RhPathFireTrigger | null | undefined;
  floor: { verdict: string; deskContracts: number | null; band: string | null; confluence: number; dte?: number | null } | null;
  ticket: RhLiveTicket | null;
  manager?: ManagerRoomStateAgree | null;
  managerCall?: ManagerCallAgree | null;
  agentAgree?: boolean;
  optionsSessionOpen: boolean;
  newsBlackout: boolean;
  riskHalt: boolean;
  oneBookBlocked: boolean;
  account?: RhAccountSnapshot | null;
  desk?: RhDeskSlice | null;
  ceTouch?: boolean | null;
  tapeAgeSec?: number | null;
  dte?: number | null;
  seqTake?: boolean | null;
  vetoed?: boolean | null;
  liveQuote?: RhLiveOptionQuote | null;
  flags?: RhAutofireFlags;
  env?: Record<string, string | undefined>;
  refIdHint?: string;
  nowMs?: number;
}): RhAutofireProposal {
  const baseFlags = args.flags ?? rhAutofireFlagsFromEnv(args.env);
  const nowMs = args.nowMs ?? baseFlags.nowMs ?? Date.now();
  const flags: RhAutofireFlags = { ...baseFlags, nowMs };
  const refuse = (gate: string, reason: string): RhAutofireProposal => ({
    gated: { ok: false, gate, reason },
    ticket: null,
    placeShape: null,
    mode: "refused",
    flags,
  });
  const fire = args.fire;
  if (!fire) return refuse("path_fire", "No PATH scanner fire — the fire is the place trigger.");
  if (!(typeof fire.at === "number" && Number.isFinite(fire.at)) || nowMs - fire.at > RH_PATH_FIRE_MAX_AGE_MS || fire.at - nowMs > 5_000) {
    return refuse("path_fire_stale", `PATH fire ${fire.key} is not fresh (> ${RH_PATH_FIRE_MAX_AGE_MS / 1000}s).`);
  }
  const floorMin = rhPathFloorForBand(fire.grade);
  if (floorMin == null) return refuse("path_band", `PATH fire band ${fire.grade || "-"} is not A+/A/A-/B+.`);
  if (args.ticket) {
    const wantSide = fire.side === "short" ? "put" : "call";
    const wantU = fire.symbol.includes("ES") ? "SPY" : "QQQ";
    if (args.ticket.side !== wantSide || args.ticket.underlier !== wantU) {
      return refuse(
        "path_fire_ticket",
        `Ticket ${args.ticket.underlier} ${args.ticket.side} does not express PATH fire ${fire.symbol} ${fire.side} (${wantU} ${wantSide}).`,
      );
    }
  }
  const agree: { manager?: ManagerRoomStateAgree | null; managerCall?: ManagerCallAgree | null } = {};
  if ("manager" in args) agree.manager = args.manager;
  if ("managerCall" in args) agree.managerCall = args.managerCall;
  const candidate = candidateFromFloorPathStand({
    // PATH band + confluence come from the FIRE (the scanner), not the card.
    floor: args.floor ? { ...args.floor, band: fire.grade, confluence: fire.confluence } : null,
    pathActionable: true, // a PATH fire only exists for an actionable candidate (isPathFire)
    agentAgree: args.agentAgree,
    ...agree,
    optionsSessionOpen: args.optionsSessionOpen,
    newsBlackout: args.newsBlackout,
    riskHalt: args.riskHalt,
    oneBookBlocked: args.oneBookBlocked,
    account: args.account ?? null,
    ceTouch: args.ceTouch,
    tapeAgeSec: args.tapeAgeSec,
    dte: args.dte,
    seqTake: args.seqTake,
    vetoed: args.vetoed,
    desk: args.desk ?? null,
    pathSymbol: fire.symbol,
    pathSide: fire.side,
    nowMs,
  });
  return proposeRhLiveOption({
    candidate,
    ticket: args.ticket,
    flags,
    refIdHint: args.refIdHint ?? `rh-${fire.key}`,
    liveQuote: args.liveQuote ?? null,
  });
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
