/**
 * Trading Stand Manager — room state contract (Design Atelier).
 *
 * Presentation + stub only. Does NOT wire agentAgree into rh-autofire gates,
 * does not place orders, does not touch Robinhood / exec/**.
 *
 * Open/close lifecycle may report through reportAutomation (read-only seam).
 */

import { reportAutomation } from "@/lib/ui/automation-state";
import { agentAgreeFromManagerRoomState } from "@/lib/execution/manager-agree";
import {
  DEFAULT_MANAGER_ROOM_ACCOUNT,
  type ManagerRhAccount,
} from "@/lib/execution/manager-account";

/* ── Floor cast extension (Stand is Manager; Owner is not a line-speaker) ─ */

export type FloorCharacter =
  | "Gemma"
  | "Jax"
  | "Nova"
  | "Sterling"
  | "Vince"
  | "Stand";

/* ── ManagerRoomState (exact contract) ──────────────────────────────────── */

export type ManagerPhase =
  | "IDLE"
  | "LISTENING"
  | "CHAIRING"
  | "PROPOSING"
  | "AGREED"
  | "REVIEWING"
  | "OPEN"
  | "MANAGING"
  | "CLOSING"
  | "POST"
  | "BLOCKED";

export type CallSide = "call" | "put";
export type CallAction = "STAND_ASIDE" | "AGREE_LIVE" | "AGREE_PAPER" | "VETO" | "MANAGE_ONLY" | "CLOSE";
export type StrikeOffset = "ATM" | "OTM_1";

export interface ManagerCall {
  action: CallAction;
  /** THE Stand bit for rh-autofire — stub may set it; never wired into gates here. */
  agentAgree: boolean;
  underlier: "QQQ" | "SPY" | null;
  side: CallSide | null;
  strikeOffset: StrikeOffset | null;
  contracts: number | null;
  estDebitTotal: number | null;
  decisionKey: string;
  reasoning: {
    thesis: string;
    floorCite: string;
    pathCite: string;
    debateCite: string;
    blocks: string[];
  };
  lenses: Partial<Record<"Gemma" | "Jax" | "Nova" | "Sterling" | "Vince", number>>;
  roomP: number | null;
}

export type ManageRuleId = string;

export interface ManagerOpenPosition {
  source: "rh_live" | "paper_room" | "rh_fill_log";
  id: string;
  underlier: "QQQ" | "SPY";
  side: CallSide;
  contracts: number;
  strikeNote: string;
  expiry: string | null;
  openedAt: number;
  entryDebit: number;
  mark: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  plan: {
    symbol: string;
    futSide: "long" | "short";
    entry: number;
    stop: number;
    t1: number | null;
    t2: number | null;
  } | null;
  manageRules: ManageRuleId[];
}

export type CloseResult = "win" | "loss" | "flat";
export type CloseReason =
  | "t1"
  | "t2"
  | "stop"
  | "time_flat"
  | "owner_override"
  | "manager_discretion"
  | "risk_halt"
  | "manual_log";

export interface ManagerCloseResult {
  result: CloseResult;
  reason: CloseReason;
  pnlUsd: number;
  label: string;
  closedAt: number;
  taught: boolean;
}

export interface FloorSnap {
  verdict: "ARMED" | "WATCH" | "STAND";
  deskContracts: number;
  cardKey: string | null;
  strategy: string | null;
}

export interface PathSnap {
  actionable: boolean;
  band: "A+" | "A" | "A-" | string | null;
  confluence: number;
}

export interface ArmSnap {
  autofireEnabled: boolean;
  liveArmed: boolean;
  confirmedInWriting: boolean;
  optionsSessionOpen: boolean;
  newsBlackout: boolean;
  riskHalt: boolean;
  oneBookBlocked: boolean;
}

export interface ManagerRoomState {
  version: 1;
  updatedAt: number;
  cycleId: string;
  current: ManagerPhase;
  call: ManagerCall | null;
  open: ManagerOpenPosition | null;
  close: ManagerCloseResult | null;
  floor: FloorSnap;
  path: PathSnap;
  arms: ArmSnap;
  /**
   * Read-only RH account block (Trading Stand, manager-account.ts): cash,
   * options BP, envelope, canFillEnvelope. Defaults to
   * DEFAULT_MANAGER_ROOM_ACCOUNT — the Individual ••••7477 snapshot
   * (isSnapshot) — until a host injects managerRhAccountFromConnector.
   * Display + accountPlaceGate only; nothing here places.
   */
  account: ManagerRhAccount;
}

/* ── Steer (chips → emit only; no gate wiring) ──────────────────────────── */

export type DebateBeat =
  | "thesis"
  | "price"
  | "challenge"
  | "rebuttal"
  | "numbers"
  | "verdict"
  | "execution"
  | "chair_open"
  | "chair_redirect"
  | "chair_close";

export type SteerMove =
  | "OPEN_FLOOR"
  | "ASK_LENS"
  | "CUT_LOOP"
  | "DEMAND_PREMORTEM"
  | "TABLE"
  | "CALL_VOTE"
  | "DECLARE_AGREE"
  | "DECLARE_VETO"
  | "HAND_TO_OWNER";

export interface ManagerSteer {
  cycleId: string;
  beat: DebateBeat;
  address: "Gemma" | "Jax" | "Nova" | "Sterling" | "Vince" | "ALL";
  move: SteerMove;
  line: string;
  injectIntoTalk: boolean;
}

/* ── Owner feedback / teach ─────────────────────────────────────────────── */

export type FeedbackKind =
  | "AFFIRM_CALL"
  | "REJECT_CALL"
  | "OVERRIDE_ACTION"
  | "TEACH_RULE"
  | "ANNOTATE_CLOSE";

export type RuleScope = "strategy" | "session" | "path_band" | "underlier" | "global";
export type RuleEffect =
  | "prefer_agree"
  | "prefer_aside"
  | "size_haircut"
  | "force_premortem"
  | "forbid_agree"
  | "manage_tighten"
  | "require_owner";

export interface DiscretionRuleDraft {
  scope: RuleScope;
  scopeKey: string;
  effect: RuleEffect;
  factor: number | null;
  text: string;
}

export interface DiscretionRule {
  id: string;
  version: 1;
  createdAt: number;
  sourceFeedbackId: string;
  scope: RuleScope;
  scopeKey: string;
  effect: RuleEffect;
  factor: number | null;
  text: string;
  active: boolean;
  hits: number;
  lastHitAt: number | null;
}

export interface OwnerFeedback {
  id: string;
  at: number;
  kind: FeedbackKind;
  cycleId: string | null;
  decisionKey: string | null;
  targetAction: CallAction | null;
  text: string;
  ruleDraft: DiscretionRuleDraft | null;
}

/* ── Feed interface ─────────────────────────────────────────────────────── */

export interface ManagerFeed {
  getState(): ManagerRoomState;
  subscribe(listener: (s: ManagerRoomState) => void): () => void;
  /** Emit a steer chip — stub records + returns the event; does not touch gates. */
  steer(move: SteerMove, opts?: Partial<Pick<ManagerSteer, "address" | "line">>): ManagerSteer;
  /** Owner teach / affirm / reject — mock DiscretionRule OK. */
  teach(fb: Omit<OwnerFeedback, "id" | "at"> & { id?: string; at?: number }): OwnerFeedback;
  getLastSteer(): ManagerSteer | null;
  getFeedbackLog(): OwnerFeedback[];
  getRules(): DiscretionRule[];
}

export interface StubManagerFeed extends ManagerFeed {
  /** Marks the demo feed: its state must never reach the RH Stand bit. */
  readonly stub: true;
  /** Optional: desk EntryState → bias demo phase cycle (presentation). */
  setEntryMood(mood: "WAIT" | "STALKING" | "ARMED" | "ENTER"): void;
  dispose(): void;
}

/* ── Demo captions / phase cycle ────────────────────────────────────────── */

const PHASE_CYCLE: ManagerPhase[] = [
  "IDLE",
  "LISTENING",
  "CHAIRING",
  "PROPOSING",
  "AGREED",
  "REVIEWING",
  "OPEN",
  "MANAGING",
  "CLOSING",
  "POST",
];

const PHASE_FROM_MOOD: Record<"WAIT" | "STALKING" | "ARMED" | "ENTER", ManagerPhase[]> = {
  WAIT: ["IDLE", "LISTENING", "BLOCKED"],
  STALKING: ["LISTENING", "CHAIRING", "PROPOSING"],
  ARMED: ["PROPOSING", "AGREED", "REVIEWING"],
  ENTER: ["OPEN", "MANAGING", "CLOSING", "POST"],
};

const STEER_LINES: Record<SteerMove, { address: ManagerSteer["address"]; beat: DebateBeat; line: string }> = {
  OPEN_FLOOR: { address: "ALL", beat: "chair_open", line: "Gemma — clock first; then Nova prices." },
  ASK_LENS: { address: "Nova", beat: "chair_redirect", line: "Nova — give me the number." },
  CUT_LOOP: { address: "ALL", beat: "chair_redirect", line: "Cut the heartbeat — next beat." },
  DEMAND_PREMORTEM: { address: "Sterling", beat: "challenge", line: "Sterling — premortem before any agree." },
  TABLE: { address: "ALL", beat: "chair_close", line: "Table it. Stand aside this cycle." },
  CALL_VOTE: { address: "ALL", beat: "verdict", line: "Snapshot the lenses — form the call." },
  DECLARE_AGREE: { address: "ALL", beat: "execution", line: "Stand agrees — paper path only (stub)." },
  DECLARE_VETO: { address: "ALL", beat: "chair_close", line: "Stand veto — hand to Owner if needed." },
  HAND_TO_OWNER: { address: "ALL", beat: "chair_close", line: "Hand to Owner — Prototype Lab teach." },
};

function mockCall(phase: ManagerPhase, cycleId: string): ManagerCall | null {
  if (phase === "IDLE" || phase === "LISTENING") return null;
  if (phase === "BLOCKED") {
    return {
      action: "VETO",
      agentAgree: false,
      underlier: "QQQ",
      side: "call",
      strikeOffset: "ATM",
      contracts: 1,
      estDebitTotal: 220,
      decisionKey: `${cycleId}:blocked`,
      reasoning: {
        thesis: "Blocked — arm or gate refuses.",
        floorCite: "Floor WATCH",
        pathCite: "PATH not actionable",
        debateCite: "stub",
        blocks: ["arm_live", "path_band"],
      },
      lenses: { Sterling: 0.42, Nova: 0.55 },
      roomP: 0.48,
    };
  }
  const agreeing = phase === "AGREED" || phase === "REVIEWING" || phase === "OPEN" || phase === "MANAGING" || phase === "CLOSING";
  return {
    action: phase === "CLOSING" || phase === "POST" ? "CLOSE" : agreeing ? "AGREE_PAPER" : phase === "PROPOSING" ? "AGREE_PAPER" : "STAND_ASIDE",
    agentAgree: agreeing,
    underlier: "QQQ",
    side: "call",
    strikeOffset: "ATM",
    contracts: 1,
    estDebitTotal: 240,
    decisionKey: `${cycleId}:qqq-atm`,
    reasoning: {
      thesis:
        phase === "CHAIRING"
          ? "Chairing the five — waiting on lenses."
          : phase === "PROPOSING"
            ? "Proposing QQQ ATM call ×1 — paper envelope."
            : agreeing
              ? "Managing the paper path — rest the limit at CE."
              : "Listening — no call yet.",
      floorCite: "Floor ARMED · Vince fill tier (stub)",
      pathCite: "PATH A Q 0.71 actionable (stub)",
      debateCite: "Sterling verdict beat (stub)",
      blocks: [],
    },
    lenses: { Gemma: 0.62, Jax: 0.58, Nova: 0.71, Sterling: 0.66, Vince: 0.64 },
    roomP: 0.64,
  };
}

function mockOpen(phase: ManagerPhase, cycleId: string, now: number): ManagerOpenPosition | null {
  if (phase !== "OPEN" && phase !== "MANAGING" && phase !== "CLOSING") return null;
  return {
    source: "paper_room",
    id: `paper-${cycleId}`,
    underlier: "QQQ",
    side: "call",
    contracts: 1,
    strikeNote: "ATM stub",
    expiry: null,
    openedAt: now - 60_000,
    entryDebit: 240,
    mark: 255,
    pnlUsd: 15,
    pnlPct: 6.25,
    plan: { symbol: "QQQ", futSide: "long", entry: 480.2, stop: 478.5, t1: 482.0, t2: 484.0 },
    manageRules: ["stub_trail"],
  };
}

function mockClose(phase: ManagerPhase, now: number): ManagerCloseResult | null {
  if (phase !== "POST" && phase !== "CLOSING") return null;
  return {
    result: "win",
    reason: "t1",
    pnlUsd: 85,
    label: "QQQ call · T1 (stub)",
    closedAt: now,
    taught: false,
  };
}

function baseSnaps(mood: "WAIT" | "STALKING" | "ARMED" | "ENTER"): Pick<ManagerRoomState, "floor" | "path" | "arms"> {
  const armed = mood === "ARMED" || mood === "ENTER";
  return {
    floor: {
      verdict: armed ? "ARMED" : mood === "STALKING" ? "WATCH" : "STAND",
      deskContracts: armed ? 1 : 0,
      cardKey: armed ? "stub-path-a" : null,
      strategy: armed ? "blake_mech" : null,
    },
    path: {
      actionable: armed,
      band: armed ? "A" : null,
      confluence: armed ? 0.71 : 0.4,
    },
    arms: {
      autofireEnabled: false,
      liveArmed: false,
      confirmedInWriting: false,
      optionsSessionOpen: true,
      newsBlackout: false,
      riskHalt: false,
      oneBookBlocked: false,
    },
  };
}

function buildState(
  phase: ManagerPhase,
  cycleId: string,
  mood: "WAIT" | "STALKING" | "ARMED" | "ENTER",
  now: number,
): ManagerRoomState {
  return {
    version: 1,
    updatedAt: now,
    cycleId,
    current: phase,
    call: mockCall(phase, cycleId),
    open: mockOpen(phase, cycleId, now),
    close: mockClose(phase, now),
    ...baseSnaps(mood),
    // The RH account block: the Individual ••••7477 snapshot until a host injects a live read.
    account: DEFAULT_MANAGER_ROOM_ACCOUNT,
  };
}

/**
 * The stub reports its DEMO open/close into the automation seam (IN TRADE
 * badge, green glow, close flashes) only when asked: dev build + ?manager=stub.
 * Otherwise a demo cycle would paint a fake "IN TRADE (stub)" over a real desk.
 */
function stubReportsAutomation(): boolean {
  if (!import.meta.env?.DEV || typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("manager") === "stub";
}

/**
 * Local demo feed: cycles ManagerPhase, mock call/open/close.
 * Reports open/close through reportAutomation (presentation seam only) — see
 * stubReportsAutomation. Never places orders or touches RH gates.
 */
export function createStubManagerFeed(
  opts: { reportAutomation?: boolean } = {},
): StubManagerFeed {
  const reportsAutomation = opts.reportAutomation ?? stubReportsAutomation();
  let mood: "WAIT" | "STALKING" | "ARMED" | "ENTER" = "WAIT";
  let tick = 0;
  let cycleId = `stub-${Date.now().toString(36)}`;
  let phase: ManagerPhase = "IDLE";
  let state = buildState(phase, cycleId, mood, Date.now());
  let lastSteer: ManagerSteer | null = null;
  const feedback: OwnerFeedback[] = [];
  const rules: DiscretionRule[] = [];
  const listeners = new Set<(s: ManagerRoomState) => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastAutoPhase: "idle" | "open" | "closed" = "idle";

  const reportLife = (s: ManagerRoomState) => {
    if (!reportsAutomation) return;
    // Presentation seam only — same reportAutomation ScreenFlash already uses.
    if (s.open && (s.current === "OPEN" || s.current === "MANAGING")) {
      if (lastAutoPhase !== "open") {
        lastAutoPhase = "open";
        reportAutomation({
          phase: "open",
          label: `STAND ${s.open.underlier} ${s.open.side} ×${s.open.contracts} (stub)`,
          at: Date.now(),
          quiet: false,
        });
      }
    } else if (s.close && (s.current === "POST" || s.current === "CLOSING")) {
      if (lastAutoPhase !== "closed") {
        lastAutoPhase = "closed";
        reportAutomation({
          phase: "closed",
          result: s.close.result,
          label: `STAND ${s.close.label}`,
          at: Date.now(),
        });
      }
    } else if (lastAutoPhase !== "idle" && (s.current === "IDLE" || s.current === "LISTENING")) {
      lastAutoPhase = "idle";
      reportAutomation({ phase: "idle" });
    }
  };

  const emit = () => {
    state = buildState(phase, cycleId, mood, Date.now());
    reportLife(state);
    for (const l of listeners) l(state);
  };

  const advance = () => {
    tick += 1;
    const pool = PHASE_FROM_MOOD[mood];
    phase = pool[tick % pool.length]!;
    if (phase === "IDLE" || tick % pool.length === 0) cycleId = `stub-${Date.now().toString(36)}`;
    emit();
  };

  const arm = () => {
    if (timer != null) return;
    timer = setInterval(advance, 5000);
  };
  const disarm = () => {
    if (timer == null) return;
    clearInterval(timer);
    timer = null;
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      arm();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) disarm();
      };
    },
    setEntryMood(next) {
      if (next === mood) return;
      mood = next;
      tick = 0;
      phase = PHASE_FROM_MOOD[mood][0]!;
      cycleId = `stub-${Date.now().toString(36)}`;
      emit();
    },
    steer(move, opts) {
      const def = STEER_LINES[move];
      const ev: ManagerSteer = {
        cycleId: state.cycleId,
        beat: def.beat,
        address: opts?.address ?? def.address,
        move,
        line: opts?.line ?? def.line,
        injectIntoTalk: false, // stub: never inject into live talk / gates
      };
      lastSteer = ev;
      // Soft presentation reaction — still no gate wiring.
      if (move === "TABLE") {
        phase = "IDLE";
        emit();
      } else if (move === "DECLARE_AGREE") {
        phase = "AGREED";
        emit();
      } else if (move === "DECLARE_VETO") {
        phase = "BLOCKED";
        emit();
      } else if (move === "HAND_TO_OWNER") {
        phase = "POST";
        emit();
      } else if (move === "DEMAND_PREMORTEM" || move === "ASK_LENS" || move === "OPEN_FLOOR") {
        phase = "CHAIRING";
        emit();
      }
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
      if (state.close && (full.kind === "AFFIRM_CALL" || full.kind === "REJECT_CALL" || full.kind === "TEACH_RULE" || full.kind === "ANNOTATE_CLOSE")) {
        state = { ...state, close: { ...state.close, taught: true }, updatedAt: Date.now() };
        for (const l of listeners) l(state);
      }
      return full;
    },
    getLastSteer: () => lastSteer,
    getFeedbackLog: () => [...feedback],
    getRules: () => [...rules],
    stub: true,
    dispose() {
      disarm();
      listeners.clear();
      if (lastAutoPhase !== "idle") {
        lastAutoPhase = "idle";
        reportAutomation({ phase: "idle" });
      }
    },
  };
}

/** Caption text for the Manager speech bubble from room state. */
export function managerBubbleText(s: ManagerRoomState): string | null {
  if (s.call?.reasoning.thesis) return `[${s.current}] ${s.call.reasoning.thesis}`;
  return `[${s.current}] Standing by.`;
}

/** Map ManagerPhase → rough EntryMood tint for the avatar accent. */
export function phaseToMoodTint(phase: ManagerPhase): "WAIT" | "STALKING" | "ARMED" | "ENTER" {
  switch (phase) {
    case "OPEN":
    case "MANAGING":
    case "CLOSING":
    case "POST":
      return "ENTER";
    case "PROPOSING":
    case "AGREED":
    case "REVIEWING":
      return "ARMED";
    case "CHAIRING":
    case "LISTENING":
      return "STALKING";
    default:
      return "WAIT";
  }
}

void PHASE_CYCLE;

/* ── Stand bit wiring (manager-agree.ts) ───────────────────────────────── */

export function isStubManagerFeed(feed: ManagerFeed | null | undefined): feed is StubManagerFeed {
  return !!feed && (feed as Partial<StubManagerFeed>).stub === true;
}

/**
 * THE ManagerRoomState the RH path may read for agentAgree — pass the result
 * as `manager` to candidateFromFloorPathStand / resolveStandAgentAgree
 * (src/lib/execution/manager-agree.ts). A real feed gives feed.getState(); the
 * demo stub (or no feed) gives null, which manager-agree resolves to false —
 * a demo cycle's AGREED must never become the live Stand bit.
 */
export function managerStateForAgree(feed: ManagerFeed | null | undefined): ManagerRoomState | null {
  if (!feed || isStubManagerFeed(feed)) return null;
  return feed.getState();
}

/** The Stand bit the RH automation would read from this feed right now. */
export function standAgentAgree(feed: ManagerFeed | null | undefined): boolean {
  return agentAgreeFromManagerRoomState(managerStateForAgree(feed));
}
