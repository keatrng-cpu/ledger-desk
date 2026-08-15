/**
 * Desk synapse — continuous cross-tab fusion.
 * Every surface (Trade, Path, BT, Swing, Risk, Lab, Brain, Tape) publishes here;
 * every surface reads fused rates / posture / boosts for higher-probability decisions.
 */

import { create } from "zustand";
import type { DeskPayload } from "./build-desk";
import type { RiskState } from "@/lib/journal/risk";
import type { SetupCandidate } from "./scanner";
import type { SwingSignal } from "./options-swing";
import { evaluateOptionsSwing } from "./options-swing";
import {
  loadDeskMemory,
  rateCardForSetup,
  topStrategyRates,
  memoryDigest,
  type DeskMemoryState,
  type BacktestFillRecord,
} from "./desk-memory";
import { runVeteranBrain, type VeteranBrief } from "./veteran-brain";
import {
  countersFromMemory,
  isGoldStandardSetup,
  strategyPriority,
  PATH_MONTH_CAP,
  describeProfitRules,
} from "./profit-rules";
import { PROFIT_ACTION_FLOOR, PROFIT_TARGET_WR } from "./profit-path";
import { APLUS_RULES } from "@/lib/aplus/config";

export type SynapseTab =
  | "brain"
  | "trade"
  | "swing"
  | "path"
  | "backtest"
  | "tape"
  | "risk"
  | "lab";

export interface StrategyBoost {
  id: string;
  /** Additive confluence nudge from BT rates + gold + side */
  boost: number;
  /** Multiplier for size suggestion */
  sizeMult: number;
  reason: string;
  wr: number | null;
  n: number;
}

export interface FusedSetupView {
  id: string;
  symbol: string;
  side: string;
  strategy: string;
  band: string;
  confluence: number;
  fusedScore: number;
  sizeMult: number;
  actionable: boolean;
  gold: boolean;
  reasons: string[];
}

export interface DeskSynapseState {
  updatedAt: number;
  desk: DeskPayload | null;
  risk: RiskState | null;
  memory: DeskMemoryState;
  swing: SwingSignal | null;
  brain: VeteranBrief | null;
  /** Last BT summary line */
  lastBacktest: {
    label: string;
    taken: number;
    wr: number | null;
    sumR: number;
    at: number;
  } | null;
  /** Strategy boosts for scanner / brain */
  strategyBoosts: Record<string, StrategyBoost>;
  /** Ranked live setups after fusion */
  fusedSetups: FusedSetupView[];
  /** Global posture for all tabs */
  posture: {
    verdict: string;
    line: string;
    pathPace: string;
    bookWr: number | null;
    monthPathEst: number;
    prefer: string[];
    avoid: string[];
    rules: string[];
  };
  /** Feed lines each tab can show */
  feeds: Record<SynapseTab, string[]>;
  /** Publish desk poll */
  publishDesk: (desk: DeskPayload, risk?: RiskState | null) => void;
  publishRisk: (risk: RiskState | null) => void;
  publishMemory: () => void;
  publishBacktest: (opts: {
    label: string;
    taken: number;
    wr: number | null;
    sumR: number;
    fills?: BacktestFillRecord[];
  }) => void;
  /** Fuse everything (idempotent) */
  recompute: () => void;
  /** Boost lookup for a strategy id */
  boostFor: (strategyId: string) => StrategyBoost | null;
  /** Apply fusion ranking to candidates */
  rankCandidates: (cands: SetupCandidate[]) => SetupCandidate[];
}

function buildBoosts(memory: DeskMemoryState): Record<string, StrategyBoost> {
  const out: Record<string, StrategyBoost> = {};
  const tops = topStrategyRates(memory, 1);
  for (const t of tops) {
    let boost = 0;
    let sizeMult = 1;
    let reason = `${t.id}: n=${t.n} WR ${(t.wr * 100).toFixed(0)}% E[R] ${t.expR.toFixed(2)}`;
    if (t.n >= 5 && t.wr >= 0.65 && t.expR > 0.1) {
      boost = 0.04;
      sizeMult = 1.1;
      reason += " · PROMOTE";
    } else if (t.n >= 5 && (t.wr < 0.45 || t.expR < -0.15)) {
      boost = -0.05;
      sizeMult = 0.5;
      reason += " · DEMOTE";
    } else if (t.n >= 3 && t.wr >= 0.55) {
      boost = 0.015;
      reason += " · ok";
    }
    // Priority base (mechanical favored)
    boost += (strategyPriority(t.id) - 50) * 0.0002;
    out[t.id] = {
      id: t.id,
      boost,
      sizeMult,
      reason,
      wr: t.wr,
      n: t.n,
    };
  }
  // Ensure catalog defaults
  for (const id of [
    "tjr",
    "mechanical",
    "smt",
    "judas",
    "blake_mech",
    "pdi",
    "patty",
    "continuation",
    "ronan",
  ]) {
    if (!out[id]) {
      /**
       * NEUTRAL AT n=0 — no sample, no opinion.
       *
       * This branch previously handed out a real edge (`boost`) and a real
       * position-size multiplier (tjr ×1.1, blake_mech ×0.5) in the same
       * object that honestly reported `wr: null, n: 0`. Those numbers were
       * not measured from anything; they were a guess about strategies the
       * book had never traded, and they were live: `boost` feeds
       * `fusedScore` -> `rankCandidates`, which orders the scanner and picks
       * the headline candidate, and `sizeMult` renders as `size×` on the
       * brain card.
       *
       * That is the same defect as the hardcoded `blakeLongTaken/Wins = 0`
       * already fixed in `journal/server.ts` (which now reads real SQL
       * counts) — an invented statistic dressed as a measurement. The house
       * rule is that a number the desk cannot measure does not get to move a
       * score or a size, and `journal/discretion.ts` is the reference
       * implementation: below `MIN_EFFECTIVE_N` it returns exactly 1.0 and
       * the verdict "insufficient-data".
       *
       * The real per-strategy ranking arrives from measured history the
       * moment a sample exists — via the `t.n >= 3/5/8` branches above.
       * Until then every catalog strategy starts level.
       */
      out[id] = {
        id,
        boost: 0,
        sizeMult: 1,
        reason: `${id}: no sample yet — neutral (no boost, no size change)`,
        wr: null,
        n: 0,
      };
    }
  }
  return out;
}

function fuseSetups(
  desk: DeskPayload | null,
  memory: DeskMemoryState,
  boosts: Record<string, StrategyBoost>,
  swing: SwingSignal | null,
): FusedSetupView[] {
  if (!desk) return [];
  const views: FusedSetupView[] = [];
  for (const c of desk.scan.candidates) {
    const strat = c.completeStrategy || c.strategyPrimary || "";
    const b = boosts[strat] ?? {
      id: strat,
      boost: 0,
      sizeMult: 1,
      reason: "—",
      wr: null,
      n: 0,
    };
    const card = rateCardForSetup(memory, {
      strategy: strat,
      side: c.side,
      band: c.pathBand || c.grade,
      symbol: c.symbol,
    });
    const gold = isGoldStandardSetup(c);
    const reasons = [...(c.reasons || []).slice(0, 2)];
    if (b.n > 0) reasons.push(b.reason);
    if (gold) reasons.push("GOLD short+mechanical template");
    const tape =
      desk.smc &&
      (c.symbol === desk.bias.right.symbol ? desk.smc.right : desk.smc.left);
    const tapeDir = c.side === "long" ? "bull" : "bear";
    const tapeAgree = tape?.alerts.some(
      (a) =>
        a.side === tapeDir &&
        (a.kind === "distribution" ||
          a.kind === "mss" ||
          a.kind === "manipulation"),
    );
    const tapeFight = tape?.alerts.some(
      (a) =>
        a.side !== tapeDir &&
        (a.kind === "distribution" || a.kind === "mss"),
    );
    if (tapeAgree && tape) reasons.push(tape.alerts.find((a) => a.side === tapeDir)!.label);
    if (tapeFight) reasons.push("SMC tape fights this side");
    // Swing alignment
    if (
      swing?.timeOccurs &&
      ((swing.side === "call" && c.side === "long") ||
        (swing.side === "put" && c.side === "short"))
    ) {
      reasons.push(`Swing ARMED agrees ${swing.underlier} ${swing.side}`);
    } else if (
      swing &&
      swing.verdict !== "STAND_DOWN" &&
      ((swing.side === "call" && c.side === "short") ||
        (swing.side === "put" && c.side === "long"))
    ) {
      reasons.push("Swing thesis fights this side");
    }

    let fused =
      (c.qualityScore ?? c.confluence) +
      b.boost +
      (gold ? 0.03 : 0) +
      (card.sizeBias - 1) * 0.05 +
      (tapeAgree ? 0.04 : 0) +
      (tapeFight ? -0.08 : 0);
    if (
      swing?.timeOccurs &&
      ((swing.side === "put" && c.side === "short") ||
        (swing.side === "call" && c.side === "long"))
    ) {
      fused += 0.02;
    }
    if (
      swing &&
      !swing.timeOccurs &&
      swing.side &&
      ((swing.side === "put" && c.side === "long") ||
        (swing.side === "call" && c.side === "short"))
    ) {
      // mild only
    }

    views.push({
      id: c.id,
      symbol: c.symbol,
      side: c.side,
      strategy: strat,
      band: String(c.pathBand || c.grade),
      confluence: c.confluence,
      fusedScore: Math.min(0.99, Math.max(0, +fused.toFixed(4))),
      sizeMult: Math.max(0.5, Math.min(1.25, b.sizeMult * card.sizeBias)),
      actionable: Boolean(c.actionable),
      gold,
      reasons: reasons.slice(0, 6),
    });
  }
  return views.sort((a, b) => b.fusedScore - a.fusedScore);
}

function buildFeeds(ctx: {
  desk: DeskPayload | null;
  brain: VeteranBrief | null;
  swing: SwingSignal | null;
  memory: DeskMemoryState;
  fused: FusedSetupView[];
  lastBacktest: DeskSynapseState["lastBacktest"];
  risk: RiskState | null;
  boosts: Record<string, StrategyBoost>;
}): Record<SynapseTab, string[]> {
  const { desk, brain, swing, memory, fused, lastBacktest, risk, boosts } =
    ctx;
  const top = fused[0];
  const bookWr =
    memory.book.pathTaken > 0
      ? memory.book.pathWins / memory.book.pathTaken
      : null;

  const paperTaken = memory.book.paperTaken ?? 0;
  const paperWr =
    paperTaken > 0
      ? (memory.book.paperWins ?? 0) / paperTaken
      : null;
  const paperLine =
    paperTaken > 0
      ? `Live paper ${paperTaken} · WR ${paperWr != null ? (paperWr * 100).toFixed(0) + "%" : "—"} · ΣR ${memory.book.paperSumR ?? 0} · last ${memory.book.lastPaperLabel ?? "—"}`
      : "Live paper empty — Log paper feeds brain rates";

  const trade = [
    desk
      ? `HTF ${desk.bias.left.symbol} ${desk.bias.left.topDown} / ${desk.bias.right.symbol} ${desk.bias.right.topDown}`
      : "Desk loading…",
    top
      ? `Fused #1 ${top.symbol} ${top.side} ${top.strategy} Q ${top.fusedScore.toFixed(2)} · size×${top.sizeMult.toFixed(2)}`
      : "No fused setup",
    paperLine,
    desk?.scan.focus ?? "",
    desk?.smc
      ? `SMC ${desk.bias.left.symbol} ${desk.smc.left.alerts[0]?.label ?? "—"} · ${desk.bias.right.symbol} ${desk.smc.right.alerts[0]?.label ?? "—"}`
      : "",
  ].filter(Boolean);

  const path = [
    `Target WR ${(PROFIT_TARGET_WR * 100).toFixed(0)}% · floor ${PROFIT_ACTION_FLOOR}`,
    bookWr != null
      ? `Book WR ${(bookWr * 100).toFixed(0)}% on ${memory.book.pathTaken} PATH · ΣR ${memory.book.sumR}`
      : "Book empty — BT trains path rates",
    paperLine,
    top?.actionable
      ? `Live path candidate: ${top.symbol} ${top.band}`
      : "No live PATH candidate",
  ];

  const backtest = [
    lastBacktest
      ? `Last BT ${lastBacktest.label}: ${lastBacktest.taken} PATH · WR ${lastBacktest.wr != null ? (lastBacktest.wr * 100).toFixed(0) + "%" : "—"} · ${lastBacktest.sumR}R`
      : "No BT this session — run a week to feed rates",
    ...Object.values(boosts)
      .filter((b) => b.n >= 2)
      .slice(0, 3)
      .map((b) => b.reason),
  ];

  const swingLines = swing
    ? [
        `${swing.verdict}${swing.timeOccurs ? " · TIME OCCURS" : ""}`,
        swing.focus,
        swing.plan
          ? `RH ${swing.plan.side} ${swing.plan.underlier} DTE~${swing.plan.dteTarget} risk $${swing.plan.riskDollars}`
          : "No RH ticket",
      ]
    : ["Swing idle"];

  const riskLines = [
    risk
      ? `Halt D/W: ${risk.dailyHaltHit ? "DAILY" : "ok"} / ${risk.weeklyHaltHit ? "WEEKLY" : "ok"}`
      : "Risk state loading…",
    `Paper equity $${Math.round(memory.book.equity).toLocaleString()} · A+ probe 2% · cap ${PATH_MONTH_CAP}/mo`,
    paperLine,
    desk
      ? `Slot $${desk.risk.riskDollars.toFixed(0)} · micros ${desk.risk.micros ? "on" : "off"}`
      : "",
  ].filter(Boolean);

  const brainLines = brain
    ? [
        `${brain.verdict} · ${brain.headline}`,
        paperLine,
        brain.rateSummary,
        ...brain.rateAdvice.slice(0, 2),
      ]
    : ["Brain waiting for desk", paperLine];

  const tape = desk
    ? [
        `Feed ${desk.feed} · ${desk.quotes.left.symbol} ${desk.quotes.left.price} · ${desk.quotes.right.symbol} ${desk.quotes.right.price}`,
        desk.scan.smt.note,
        desk.smc
          ? `${desk.bias.left.symbol}: ${desk.smc.left.arrays.slice(0, 2).map((a) => a.label).join(", ") || "no array"} · ${desk.smc.left.alerts[0]?.label ?? "no alert"}`
          : `Levels ${desk.levels?.[0]?.items?.length ?? 0}+ marked`,
        desk.smc
          ? `${desk.bias.right.symbol}: ${desk.smc.right.arrays.slice(0, 2).map((a) => a.label).join(", ") || "no array"} · ${desk.smc.right.alerts[0]?.label ?? "no alert"}`
          : "",
      ].filter(Boolean)
    : ["Tape idle"];

  const lab = [
    "Replay / calibration uses same rates + profit rules",
    ...describeProfitRules().slice(0, 3),
  ];

  return {
    brain: brainLines,
    trade,
    swing: swingLines,
    path,
    backtest,
    tape,
    risk: riskLines,
    lab,
  };
}

function buildPosture(ctx: {
  brain: VeteranBrief | null;
  swing: SwingSignal | null;
  memory: DeskMemoryState;
  fused: FusedSetupView[];
  boosts: Record<string, StrategyBoost>;
}): DeskSynapseState["posture"] {
  const { brain, swing, memory, fused, boosts } = ctx;
  const bookWr =
    memory.book.pathTaken > 0
      ? memory.book.pathWins / memory.book.pathTaken
      : null;
  const prefer = Object.values(boosts)
    .filter((b) => b.boost > 0.02 || (b.wr != null && b.wr >= 0.65 && b.n >= 5))
    .map((b) => b.id);
  const avoid = Object.values(boosts)
    .filter((b) => b.boost < -0.02 || (b.wr != null && b.wr < 0.45 && b.n >= 5))
    .map((b) => b.id);
  if (!prefer.includes("mechanical")) prefer.unshift("mechanical");
  if (!avoid.includes("blake_mech_long")) {
    /* named avoid */
  }

  const top = fused[0];
  return {
    verdict: brain?.verdict ?? "STAND_DOWN",
    line:
      brain?.headline ??
      (top
        ? `Fused ${top.symbol} ${top.side} ${top.fusedScore.toFixed(2)}`
        : "Stand down — no fused edge"),
    pathPace: `PATH book ${memory.book.pathTaken} · target ~${PATH_MONTH_CAP}/mo`,
    bookWr,
    monthPathEst: memory.book.pathTaken,
    prefer: [...new Set(prefer)].slice(0, 5),
    avoid: [...new Set([...avoid, "blake_mech long", "dual book same day"])].slice(
      0,
      5,
    ),
    rules: describeProfitRules(),
  };
}

export const useDeskSynapse = create<DeskSynapseState>((set, get) => ({
  updatedAt: 0,
  desk: null,
  risk: null,
  memory: loadDeskMemory(),
  swing: null,
  brain: null,
  lastBacktest: null,
  strategyBoosts: {},
  fusedSetups: [],
  posture: {
    verdict: "STAND_DOWN",
    line: "Synapse booting…",
    pathPace: "",
    bookWr: null,
    monthPathEst: 0,
    prefer: ["mechanical"],
    avoid: [],
    rules: describeProfitRules(),
  },
  feeds: {
    brain: [],
    trade: [],
    swing: [],
    path: [],
    backtest: [],
    tape: [],
    risk: [],
    lab: [],
  },

  publishDesk: (desk, risk) => {
    set({
      desk,
      risk: risk !== undefined ? risk : get().risk,
    });
    get().recompute();
  },

  publishRisk: (risk) => {
    set({ risk });
    get().recompute();
  },

  publishMemory: () => {
    set({ memory: loadDeskMemory() });
    get().recompute();
  },

  publishBacktest: (opts) => {
    set({
      lastBacktest: {
        label: opts.label,
        taken: opts.taken,
        wr: opts.wr,
        sumR: opts.sumR,
        at: Date.now(),
      },
      memory: loadDeskMemory(),
    });
    get().recompute();
  },

  recompute: () => {
    const { desk, risk } = get();
    const memory =
      typeof window !== "undefined" ? loadDeskMemory() : get().memory;
    const boosts = buildBoosts(memory);
    const swing = desk ? evaluateOptionsSwing(desk) : null;
    const brain = desk
      ? runVeteranBrain(
          desk,
          memory,
          undefined,
          risk
            ? {
                dailyHaltHit: risk.dailyHaltHit,
                weeklyHaltHit: risk.weeklyHaltHit,
                killzoneCapHit: risk.killzoneCapHit,
              }
            : null,
        )
      : null;
    const fused = fuseSetups(desk, memory, boosts, swing);
    const lastBacktest = get().lastBacktest;
    // Sync last BT from memory if store empty
    const lb =
      lastBacktest ??
      (memory.book.lastBacktestLabel
        ? {
            label: memory.book.lastBacktestLabel,
            taken: memory.book.lastBacktestPath ?? 0,
            wr: memory.book.lastBacktestWr ?? null,
            sumR: memory.book.lastBacktestSumR ?? 0,
            at: memory.book.updatedAt,
          }
        : null);

    const feeds = buildFeeds({
      desk,
      brain,
      swing,
      memory,
      fused,
      lastBacktest: lb,
      risk,
      boosts,
    });
    const posture = buildPosture({ brain, swing, memory, fused, boosts });

    set({
      updatedAt: Date.now(),
      memory,
      swing,
      brain,
      strategyBoosts: boosts,
      fusedSetups: fused,
      lastBacktest: lb,
      feeds,
      posture,
    });
  },

  boostFor: (strategyId) => get().strategyBoosts[strategyId] ?? null,

  rankCandidates: (cands) => {
    const boosts = get().strategyBoosts;
    const memory = get().memory;
    return [...cands].sort((a, b) => {
      const sa = a.completeStrategy || a.strategyPrimary || "";
      const sb = b.completeStrategy || b.strategyPrimary || "";
      const ba = boosts[sa]?.boost ?? 0;
      const bb = boosts[sb]?.boost ?? 0;
      const ca = rateCardForSetup(memory, {
        strategy: sa,
        side: a.side,
        band: a.pathBand || a.grade,
      }).sizeBias;
      const cb = rateCardForSetup(memory, {
        strategy: sb,
        side: b.side,
        band: b.pathBand || b.grade,
      }).sizeBias;
      const fa = (a.qualityScore ?? a.confluence) + ba + (ca - 1) * 0.05;
      const fb = (b.qualityScore ?? b.confluence) + bb + (cb - 1) * 0.05;
      return fb - fa;
    });
  },
}));

/** Non-hook access for non-React modules */
export function getDeskSynapse(): DeskSynapseState {
  return useDeskSynapse.getState();
}

export function synapseDigest(): string {
  const s = useDeskSynapse.getState();
  return [
    s.posture.verdict,
    s.posture.line,
    memoryDigest(s.memory),
    s.swing ? `Swing ${s.swing.verdict}` : "",
    s.fusedSetups[0]
      ? `Fused ${s.fusedSetups[0].symbol} ${s.fusedSetups[0].side} ${s.fusedSetups[0].fusedScore.toFixed(2)}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
