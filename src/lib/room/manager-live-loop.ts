/**
 * Manager → RH live loop (Design Atelier wiring, Keaton-approved 2026-10-06).
 *
 * Connects the REAL Trading Stand feed to the existing RH live-when-armed path:
 *   managerStateForAgree(feed)        — real feed → feed.getState(); stub → null
 *   → candidateFromFloorPathStand({ manager, ... })  (resolveStandAgentAgree)
 *   → proposeRhFromPathFire / proposeRhLiveOption    (all hard gates unchanged)
 *
 * The Floor → RH signals come from the same real room cycle the Manager read
 * (ManagerRoomState.signals): CE touch = the room's "trigger" gate, tape age =
 * now − frame time (desk.fetchedAt), DTE = the card's DTE, SEQ TAKE = the card's
 * SMC word, veto = room vetoed / Stand VETO / Owner veto. A live desk slice, when
 * passed, is preferred for CE touch (rh-floor-signals.ts). Missing → refuse.
 *
 * PURE. Returns a review/place SHAPE or a refusal. It does not call Robinhood.
 * When this returns live_when_armed, the scheduled desk places it: review_option_order
 * then place_option_order on Agentic 995386158. No click and no second approval.
 */
import {
  candidateFromFloorPathStand,
  evaluateRhBplusGate,
  evaluateRhFloorRules,
  isBplusBand,
  proposeRhFromPathFire,
  rhAutofireFlagsFromEnv,
  ticketFromRhCard,
  type RhAccountSnapshot,
  type RhAutofireCandidate,
  type RhAutofireFlags,
  type RhAutofireGateResult,
  type RhAutofireProposal,
  type RhDeskSlice,
  type RhLiveOptionQuote,
  type RhLiveTicket,
  type RhPathFireTrigger,
} from "../execution/rh-autofire";
import { managerStateForAgree, type ManagerFeed, type ManagerRoomState } from "./manager-feed";
import { decideRhCycle, type RhCycle, type RhHeld } from "../execution/rh-cycle";
import { isPathFire } from "../alerts/path-alarm";
import type { DeskPayload } from "../trading/build-desk";
import { SCHOOL_GATE, schoolFactsFrom, schoolGate, schoolReads } from "../trading/school-brief";

/** Ticket the Stand's call expresses (null when the call is not a live agree). */
export function ticketFromManagerState(s: ManagerRoomState | null): RhLiveTicket | null {
  const c = s?.call;
  const sig = s?.signals;
  if (!c || !sig || c.action !== "AGREE_LIVE" || !c.agentAgree) return null;
  if (!c.underlier || !c.side || !c.strikeOffset || c.contracts == null || c.estDebitTotal == null || sig.dte == null) return null;
  return ticketFromRhCard({
    underlier: c.underlier,
    side: c.side,
    dteTarget: sig.dte,
    expiry: sig.expiry,
    strikeNote: c.strikeOffset,
    strikeOffset: c.strikeOffset,
    contracts: c.contracts,
    estDebitEach: sig.estDebitEach ?? c.estDebitTotal / 100 / Math.max(1, c.contracts),
    estDebitTotal: c.estDebitTotal,
    decisionKey: c.decisionKey,
    reason: c.reasoning.thesis,
  });
}

/** RhAutofireCandidate from the feed. The demo stub gives manager=null → agentAgree false. */
export function rhCandidateFromManagerFeed(args: {
  feed: ManagerFeed | null | undefined;
  /** Fresh get_portfolio(995386158) read (rhAccountFromPortfolio). */
  account: RhAccountSnapshot | null;
  nowMs: number;
  desk?: RhDeskSlice | null;
}): { manager: ManagerRoomState | null; candidate: RhAutofireCandidate } {
  const manager = managerStateForAgree(args.feed);
  const sig = manager?.signals;
  const tapeAgeSec = sig && Number.isFinite(sig.frameAt) && args.nowMs - sig.frameAt >= -5_000 ? Math.max(0, (args.nowMs - sig.frameAt) / 1000) : null;
  const candidate = candidateFromFloorPathStand({
    floor: manager
      ? { verdict: manager.floor.verdict, deskContracts: manager.floor.deskContracts, band: manager.path.band, confluence: manager.path.confluence, dte: sig?.dte ?? null }
      : null,
    pathActionable: manager?.path.actionable === true,
    // THE Stand bit: Manager owns it (null for the stub / no feed → false).
    manager,
    optionsSessionOpen: manager?.arms.optionsSessionOpen === true,
    newsBlackout: manager ? manager.arms.newsBlackout : true,
    riskHalt: manager ? manager.arms.riskHalt : true,
    oneBookBlocked: manager ? manager.arms.oneBookBlocked : true,
    account: args.account,
    // A live desk slice (if given) reads CE touch itself; else the room's trigger gate.
    ceTouch: args.desk ? undefined : (sig?.ceTouch ?? null),
    tapeAgeSec: sig?.synthetic ? null : tapeAgeSec,
    dte: sig?.dte ?? null,
    seqTake: sig?.seqTake ?? null,
    vetoed: sig?.vetoed ?? null,
    desk: args.desk,
    pathSymbol: sig?.futSymbol ?? null,
    pathSide: sig?.futSide ?? null,
    nowMs: args.nowMs,
  });
  return { manager, candidate };
}

/**
 * One live-loop step on a PATH fire (the place trigger). Floor + PATH + Stand
 * (real Manager) + BP + Floor rules + B+ gate + envelope + env arms all via the
 * unchanged gate modules. Returns the proposal — never places.
 */
export function proposeRhFromManagerFeed(args: {
  feed: ManagerFeed | null | undefined;
  fire: RhPathFireTrigger | null | undefined;
  account: RhAccountSnapshot | null;
  liveQuote?: RhLiveOptionQuote | null;
  desk?: RhDeskSlice | null;
  flags?: RhAutofireFlags;
  env?: Record<string, string | undefined>;
  nowMs?: number;
}): RhAutofireProposal & { manager: ManagerRoomState | null } {
  const baseFlags = args.flags ?? rhAutofireFlagsFromEnv(args.env);
  const nowMs = args.nowMs ?? baseFlags.nowMs ?? Date.now();
  const { manager, candidate } = rhCandidateFromManagerFeed({ feed: args.feed, account: args.account, nowMs, desk: args.desk });
  const sig = manager?.signals;
  const p = proposeRhFromPathFire({
    fire: args.fire,
    floor: { verdict: candidate.floorVerdict, deskContracts: candidate.deskContracts, band: candidate.pathBand, confluence: candidate.confluence, dte: candidate.dte },
    ticket: ticketFromManagerState(manager),
    manager,
    optionsSessionOpen: candidate.optionsSessionOpen,
    newsBlackout: candidate.newsBlackout,
    riskHalt: candidate.riskHalt,
    oneBookBlocked: candidate.oneBookBlocked,
    account: args.account,
    desk: args.desk,
    ceTouch: args.desk ? undefined : candidate.ceTouch,
    tapeAgeSec: candidate.tapeAgeSec,
    dte: candidate.dte,
    seqTake: sig?.seqTake ?? null,
    vetoed: sig?.vetoed ?? null,
    liveQuote: args.liveQuote ?? null,
    flags: { ...baseFlags, nowMs },
    nowMs,
  });
  return { ...p, manager };
}

/**
 * Display-only read of the loop for the Manager panel: the Stand bit the RH path
 * would read and the Floor-rule / B+ verdict on the feed's current room signals.
 * No account, no arms, no quote — it can never authorize anything.
 */
export function managerLoopReadout(
  feed: ManagerFeed | null | undefined,
  nowMs: number,
): { standBit: boolean; floor: RhAutofireGateResult; bplus: RhAutofireGateResult | null; line: string } {
  const { manager, candidate } = rhCandidateFromManagerFeed({ feed, account: null, nowMs });
  const floor = evaluateRhFloorRules(candidate, nowMs);
  const bplus = isBplusBand(candidate.pathBand) ? evaluateRhBplusGate(candidate) : null;
  const standBit = candidate.agentAgree === true;
  const parts = [
    manager ? `Stand ${standBit ? "agrees" : "aside"}` : "no live Manager (stub/none) → Stand false",
    floor.ok ? "Floor rules ok" : `Floor rules: ${floor.gate}`,
    ...(bplus ? [bplus.ok ? "B+ gate ok" : `B+ gate: ${bplus.gate}`] : []),
    "BP / arms / live quote checked at propose",
  ];
  return { standBit, floor, bplus, line: parts.join(" · ") };
}

/**
 * The live poll's cycle. Same gates as proposeRhFromManagerFeed. The school
 * gate is read only while SCHOOL_GATE.enabled is on. This does not place.
 */
export function rhCycleOnDesk(args: {
  feed: ManagerFeed | null | undefined;
  desk: DeskPayload | null;
  held: RhHeld | null;
  account: RhAccountSnapshot | null;
  liveQuote?: RhLiveOptionQuote | null;
  nowMs: number;
}): RhCycle {
  const desk = args.desk;
  const top = desk?.scan.candidates.find((c) => isPathFire(c)) ?? null;
  const at = desk ? Date.parse(desk.fetchedAt) : NaN;
  const fire = top
    ? {
        key: `${top.symbol}|${top.side}|${top.pathBand ?? top.grade}`,
        symbol: top.symbol,
        side: top.side === "short" ? ("short" as const) : ("long" as const),
        grade: String(top.pathBand ?? top.grade ?? ""),
        confluence: top.confluence,
        at: Number.isFinite(at) ? at : args.nowMs,
      }
    : null;
  const proposal = proposeRhFromManagerFeed({
    feed: args.feed,
    fire,
    account: args.account,
    liveQuote: args.liveQuote ?? null,
    desk: desk as RhDeskSlice | null,
    nowMs: args.nowMs,
  });
  let school: { ok: boolean; reason: string | null } | null = null;
  if (SCHOOL_GATE.enabled && top && desk) {
    const es = /ES/.test(top.symbol);
    const book = [desk.smcMaster?.left, desk.smcMaster?.right].find((b) => b && /ES/.test(b.symbol) === es && b.side === top.side);
    school = schoolGate(top.strategyPrimary, schoolReads(schoolFactsFrom(top, null, book?.layers ?? null)));
  }
  return decideRhCycle({ proposal, held: args.held, nowMs: args.nowMs, school });
}
