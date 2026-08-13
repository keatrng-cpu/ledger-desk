/**
 * SMC/ICT day-trading veteran brain — discretionary layer over desk truth.
 * Deterministic: fuses live structure, journal/risk, and desk memory.
 * Never overrides hard risk/HTF gates; only adds or subtracts discretion.
 */

import type { DeskPayload } from "./build-desk";
import type { SetupCandidate } from "./scanner";
import {
  loadDeskMemory,
  memoryDigest,
  rateCardForSetup,
  topStrategyRates,
  bucketWr,
  bucketExpectancy,
  type DeskMemoryState,
} from "./desk-memory";
import { narrativeCoachLines } from "./market-narrative";
import { APLUS_RULES } from "@/lib/aplus/config";
import { PROFIT_ACTION_FLOOR } from "./profit-path";
import {
  describeProfitRules,
  isBlakeLongDemoted,
  isGoldStandardSetup,
  countersFromMemory,
  PATH_MONTH_CAP,
} from "./profit-rules";
import { ALWAYS_SCAN, type StrategyId } from "./strategies";
import type { StrategyMarketGrade } from "./strategy-grade";
import {
  listOpenPaperTrades,
  loadPaperTrades,
} from "./paper-manager";
import { recentByKind } from "./desk-memory";
// Aliased: journal/discretion.ts's own DiscretionVerdict ("demote"/"favor"/…)
// is a different type from this file's own DiscretionVerdict export
// ("TAKE"/"REDUCE"/…) a few lines below — same name, unrelated meaning.
import {
  MIN_EFFECTIVE_N as REAL_DISCRETION_MIN_N,
  type DiscretionResult as RealDiscretionResult,
} from "@/lib/journal/discretion";
import {
  scoreCanonStack,
  canonCoachLines,
  canonInputForCandidate,
  type CanonStack,
} from "./smc-canon";

export type DiscretionVerdict =
  | "TAKE"
  | "REDUCE"
  | "WATCH"
  | "SKIP"
  | "STAND_DOWN";

export type LayerTone = "pass" | "warn" | "fail" | "info";

export interface BrainLayer {
  id: string;
  label: string;
  tone: LayerTone;
  score: number; // -2 .. +2 contribution
  detail: string;
}

export interface TabRead {
  tab: string;
  status: "ok" | "warn" | "hot" | "idle";
  line: string;
}

export interface StrategyRead {
  id: StrategyId | string;
  status: "ready" | "forming" | "absent" | "blocked";
  score: number;
  note: string;
}

export interface VeteranBrief {
  name: string;
  posture: string;
  verdict: DiscretionVerdict;
  confidence: number; // 0-1 discretionary confidence
  headline: string;
  layers: BrainLayer[];
  /** Why a veteran would still pass even if raw score is high */
  vetoes: string[];
  /** Soft green flags */
  green: string[];
  /** Soft yellow flags */
  yellow: string[];
  focus: string;
  memoryLine: string;
  /** Suggested size multiplier on top of grade size (0.5 reduce, 1 full) */
  sizeMult: number;
  /** Best setup if any after discretion */
  setup: SetupCandidate | null;
  /** Short script the UI can show as "veteran says" */
  monologue: string[];
  /** Auto-read of every desk tab */
  tabReads: TabRead[];
  /** Auto score of every strategy model */
  strategyBoard: StrategyRead[];
  /** What the brain is doing automatically right now */
  autoActions: string[];
  /** Live setup vs backtest rates */
  rateAdvice: string[];
  rateSummary: string;
  /** Suggested size mult from BT rates (0.5–1.1) */
  rateSizeBias: number;
  asked?: string;
  answer?: string;
  /** Live ICT/SMC/TJR/PB confluence stack */
  canonStack: CanonStack;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function bookWr(mem: DeskMemoryState): number | null {
  if (mem.book.pathTaken < 3) return null;
  return mem.book.pathWins / mem.book.pathTaken;
}

/**
 * Core discretion stack. Hard rules still win; this only scores soft edge.
 */
export function runVeteranBrain(
  desk: DeskPayload,
  mem?: DeskMemoryState,
  question?: string,
  liveRisk?: {
    dailyHaltHit?: boolean;
    weeklyHaltHit?: boolean;
    killzoneCapHit?: boolean;
  } | null,
  /**
   * Real per-strategy discretion, server-computed from Postgres live+paper
   * history (journal/discretion.ts via getDiscretionState) — keyed the same
   * way rateCardForSetup below is: completeStrategy || strategyPrimary.
   *
   * Optional and additive: everything downstream still runs off `rateCard`
   * (the localStorage/backtest-only estimate) exactly as before. When a real
   * entry exists for the chosen candidate's strategy AND clears
   * MIN_EFFECTIVE_N, it OVERRIDES rateCard's sizeBias and strategy bucket in
   * place — this is what makes the "BT ..." lines below, the size×, and
   * every other rateCard-derived reason actually describe real trades
   * instead of a 19-trade static seed. Below that sample floor, the
   * pre-existing backtest-only estimate keeps narrating — cold start should
   * not read as silence.
   */
  realDiscretion?: Record<string, RealDiscretionResult> | null,
): VeteranBrief {
  const memory = mem ?? loadDeskMemory();
  const counters = countersFromMemory(memory);
  const { clock, bias, scan, risk, news } = desk;
  const candidates = scan.candidates ?? [];
  let rawBest =
    candidates.find((c) => c.actionable) ??
    candidates.find(
      (c) => c.confluence >= PROFIT_ACTION_FLOOR && c.htfOk,
    ) ??
    candidates[0] ??
    null;

  // Prefer strategies with strong BT rates when choosing among path candidates
  const pathPool = candidates.filter(
    (c) =>
      c.actionable ||
      c.pathBand === "A+" ||
      c.pathBand === "A" ||
      c.pathBand === "A-" ||
      c.pathBand === "B+",
  );
  if (pathPool.length > 1) {
    const ranked = pathPool
      .map((c) => {
        const card = rateCardForSetup(memory, {
          strategy: c.completeStrategy || c.strategyPrimary,
          side: c.side,
          band: c.pathBand || c.grade,
          symbol: c.symbol,
        });
        const wr = card.strategy
          ? (card.strategy.wins / Math.max(1, card.strategy.n))
          : 0.5;
        return {
          c,
          score:
            (c.qualityScore ?? c.confluence) * 10 +
            card.sizeBias * 2 +
            wr * 3 +
            (c.side === "short" && (c.strategyPrimary === "mechanical" || c.completeStrategy === "mechanical")
              ? 1.5
              : 0),
        };
      })
      .sort((a, b) => b.score - a.score);
    rawBest = ranked[0]!.c;
  }

  const rawRateCard = rawBest
    ? rateCardForSetup(memory, {
        strategy: rawBest.completeStrategy || rawBest.strategyPrimary,
        side: rawBest.side,
        band: rawBest.pathBand || rawBest.grade,
        symbol: rawBest.symbol,
      })
    : rateCardForSetup(memory, {});

  // Substitute the real, server-measured factor in place of the
  // localStorage/backtest-only estimate wherever we have enough real
  // evidence to trust it. Every downstream reference to `rateCard` below
  // (headline, monologue, green/yellow reasons, sizeMult) inherits this
  // automatically — one substitution point instead of patching ~15 call
  // sites individually, and it fails safe: no match or too little sample
  // leaves rawRateCard untouched.
  const realKey = rawBest?.completeStrategy || rawBest?.strategyPrimary;
  const real = realKey ? realDiscretion?.[realKey] : undefined;
  const rateCard =
    real && real.effectiveN >= REAL_DISCRETION_MIN_N
      ? {
          ...rawRateCard,
          sizeBias: real.factor,
          strategy: {
            n: Math.round(real.effectiveN),
            wins: Math.round((real.winRate ?? 0) * real.effectiveN),
            sumR: (real.expectancyR ?? 0) * real.effectiveN,
          },
          advice: [
            `LIVE+PAPER (not just BT): ${real.reason}`,
            ...rawRateCard.advice,
          ],
        }
      : rawRateCard;
  const topRates = topStrategyRates(memory, 2);

  const layers: BrainLayer[] = [];
  const vetoes: string[] = [];
  const green: string[] = [];
  const yellow: string[] = [];
  let score = 0;

  // 1) Session / killzone
  if (!clock.isWeekday) {
    layers.push({
      id: "session",
      label: "Session",
      tone: "fail",
      score: -2,
      detail: "Weekend — plan only",
    });
    score -= 2;
    vetoes.push("Weekend — no day-trade entries");
  } else if (!clock.inTradeWindow) {
    layers.push({
      id: "session",
      label: "Session",
      tone: "warn",
      score: -1,
      detail: `${clock.killzoneLabel} — outside entry window`,
    });
    score -= 1;
    yellow.push("Outside killzone — watch only");
  } else {
    layers.push({
      id: "session",
      label: "Session",
      tone: "pass",
      score: 1,
      detail: `${clock.killzoneLabel} open · ${clock.sessionPhase}`,
    });
    score += 1;
    green.push(`In window: ${clock.killzoneLabel}`);
  }

  // 2) HTF absolute gate
  const htfL = bias.left.topDown;
  const htfR = bias.right.topDown;
  if (rawBest && !rawBest.htfOk) {
    layers.push({
      id: "htf",
      label: "HTF gate",
      tone: "fail",
      score: -2,
      detail: `${rawBest.symbol} ${rawBest.side} fights HTF ${rawBest.symbol === bias.left.symbol ? htfL : htfR}`,
    });
    score -= 2;
    vetoes.push("HTF absolute gate — do not fade top-down");
  } else if (htfL === "neutral" && htfR === "neutral") {
    layers.push({
      id: "htf",
      label: "HTF gate",
      tone: "warn",
      score: -0.5,
      detail: "Both books neutral — need cleaner displacement",
    });
    score -= 0.5;
    yellow.push("Dual neutral HTF");
  } else {
    layers.push({
      id: "htf",
      label: "HTF gate",
      tone: "pass",
      score: 1,
      detail: `${bias.left.symbol} ${htfL} · ${bias.right.symbol} ${htfR}`,
    });
    score += 1;
    green.push("HTF stack readable");
  }

  // 3) Model / strategy completeness (strategy-native C axis)
  if (rawBest) {
    const missing = rawBest.missing || [];
    const multiStrat = (rawBest.strategies || []).length >= 2;
    const complete = Boolean(rawBest.strategyComplete);
    const band = rawBest.pathBand || rawBest.grade;
    if (complete && rawBest.confluence >= PROFIT_ACTION_FLOOR - 0.02) {
      layers.push({
        id: "model",
        label: "Model",
        tone: "pass",
        score: 1.5,
        detail: `${rawBest.completeStrategy || rawBest.strategyPrimary || "model"} C-complete · band ${band} · Q ${(rawBest.qualityScore ?? rawBest.confluence).toFixed(2)}`,
      });
      score += 1.5;
      green.push(`C-complete · ${rawBest.completeStrategy || rawBest.strategyPrimary}`);
    } else if (rawBest.confluence >= PROFIT_ACTION_FLOOR) {
      layers.push({
        id: "model",
        label: "Model",
        tone: "warn",
        score: 0.5,
        detail: `Q ok but C incomplete — ${rawBest.completeNote || missing.slice(0, 3).join(", ") || "pieces"}`,
      });
      score += 0.5;
      yellow.push("Partial — need strategy template complete");
    } else {
      layers.push({
        id: "model",
        label: "Model",
        tone: "fail",
        score: -1,
        detail: `Below path ${rawBest.confluence.toFixed(2)} < ${PROFIT_ACTION_FLOOR}`,
      });
      score -= 1;
    }
    if (multiStrat) {
      score += 0.5;
      green.push(`Models graded alone: ${(rawBest.strategies || []).join(", ")}`);
    }
    if (isBlakeLongDemoted(rawBest, counters)) {
      score -= 1.5;
      yellow.push("blake_mech long demoted — paper/B+ only");
      vetoes.push("blake_mech long demoted until WR recovers");
    }
    if (isGoldStandardSetup(rawBest)) {
      score += 0.75;
      green.push("GOLD Jul-20 template: short + mechanical");
    }
    if (counters.pathThisMonth >= PATH_MONTH_CAP && rawBest.pathBand !== "A+") {
      score -= 1;
      yellow.push(`Month PATH cap ${PATH_MONTH_CAP} — A+ only or stand down`);
    }
  } else {
    layers.push({
      id: "model",
      label: "Model",
      tone: "info",
      score: 0,
      detail: "No candidate on the board",
    });
  }

  // 4) SMT / dual book discretion
  const smtNote = (scan.smt?.note || "").toLowerCase();
  if (smtNote.includes("div") || smtNote.includes("lead") || smtNote.includes("lag")) {
    layers.push({
      id: "smt",
      label: "SMT",
      tone: "pass",
      score: 0.5,
      detail: scan.smt.note,
    });
    score += 0.5;
    green.push("SMT narrative present");
  } else {
    layers.push({
      id: "smt",
      label: "SMT",
      tone: "info",
      score: 0,
      detail: scan.smt?.note || "No SMT edge",
    });
  }

  // 5) News
  if (news.verdict === "blackout") {
    layers.push({
      id: "news",
      label: "News",
      tone: "fail",
      score: -2,
      detail: news.reason,
    });
    score -= 2;
    vetoes.push(`News blackout — ${news.reason}`);
  } else if (news.verdict === "caution") {
    layers.push({
      id: "news",
      label: "News",
      tone: "warn",
      score: -0.75,
      detail: news.reason,
    });
    score -= 0.75;
    yellow.push(`News caution — ${news.reason}`);
  } else {
    layers.push({
      id: "news",
      label: "News",
      tone: "pass",
      score: 0.25,
      detail: news.nextEvent
        ? `Clear · next ${news.nextEvent.name} in ${news.nextEvent.minutesAway}m`
        : "Calendar clear",
    });
    score += 0.25;
  }

  // 6) Risk governor (desk rules + optional live risk state)
  if (liveRisk?.dailyHaltHit || liveRisk?.weeklyHaltHit) {
    layers.push({
      id: "risk",
      label: "Risk",
      tone: "fail",
      score: -2,
      detail: "Halt active — no new risk",
    });
    score -= 2;
    vetoes.push("Risk halt — desk closed for new entries");
  } else if (liveRisk?.killzoneCapHit) {
    layers.push({
      id: "risk",
      label: "Risk",
      tone: "warn",
      score: -1,
      detail: "Killzone cap hit",
    });
    score -= 1;
    yellow.push("Max setups this KZ already used");
  } else {
    layers.push({
      id: "risk",
      label: "Risk",
      tone: "pass",
      score: 0.5,
      detail: `Slot $${risk.riskDollars.toFixed(0)} · grade 0.5–3% · risk-off 50%@1R`,
    });
    score += 0.5;
  }

  // 6b) Liquidity / confirmation narrative (SMC sequence)
  const narrPkg = desk.narrative;
  if (narrPkg) {
    const pick =
      narrPkg.left.confirmation === "armed_entry" ||
      narrPkg.left.confirmation === "confirmed"
        ? narrPkg.left
        : narrPkg.right.confirmation === "armed_entry" ||
            narrPkg.right.confirmation === "confirmed"
          ? narrPkg.right
          : narrPkg.left;
    const nTone =
      pick.confirmation === "armed_entry"
        ? "pass"
        : pick.confirmation === "sweep_only"
          ? "warn"
          : "info";
    layers.push({
      id: "narrative",
      label: "Liquidity story",
      tone: nTone as "pass" | "warn" | "info" | "fail",
      score:
        pick.confirmation === "armed_entry"
          ? 0.5
          : pick.confirmation === "sweep_only"
            ? -0.75
            : 0,
      detail: `${pick.class} · ${pick.confirmation} · entry ${pick.entryModel} · DOL ${pick.dol.target}`,
    });
    if (pick.confirmation === "armed_entry") {
      score += 0.5;
      green.push(
        `Story armed (${pick.class}): ${pick.entryModel} — retest only`,
      );
    } else if (pick.confirmation === "sweep_only") {
      score -= 0.75;
      yellow.push("Sweep alone is not an entry — wait displacement + MSS");
    }
    // stash for monologue enrichment
    (desk as any).__narrLines = narrativeCoachLines(pick).slice(0, 4);
  }

  // 7) Memory / book + backtest rates → live
  const wr = bookWr(memory);
  const monthTarget = APLUS_RULES.targetTradesPerMonth.center;
  if (wr != null && wr < 0.55 && memory.book.pathTaken >= 8) {
    layers.push({
      id: "memory",
      label: "Memory",
      tone: "warn",
      score: -0.75,
      detail: `Book WR ${(wr * 100).toFixed(0)}% on ${memory.book.pathTaken} PATH — tighten selectivity`,
    });
    score -= 0.75;
    yellow.push("Cold streak — only A+ or stand down");
  } else if (wr != null && wr >= 0.7) {
    layers.push({
      id: "memory",
      label: "Memory",
      tone: "pass",
      score: 0.5,
      detail: `Book WR ${(wr * 100).toFixed(0)}% · ΣR ${memory.book.sumR} · pace toward ${monthTarget}/mo`,
    });
    score += 0.5;
    green.push("Book supports process");
  } else {
    layers.push({
      id: "memory",
      label: "Memory",
      tone: "info",
      score: 0,
      detail: memoryDigest(memory),
    });
  }


  // 7a) Live paper book — open risk + recent fills feed discretion
  const openPaper =
    typeof window !== "undefined" ? listOpenPaperTrades() : [];
  const paperItems =
    typeof window !== "undefined" ? recentByKind("paper", 6) : [];
  const paperOpenMem =
    typeof window !== "undefined" ? recentByKind("paper_open", 3) : [];
  if (openPaper.length > 0) {
    const lines = openPaper.map(
      (tr) =>
        `${tr.displaySymbol} ${tr.side} ${tr.contractsOpen}ct @ ${tr.entry} SL ${tr.workingStop} TP ${tr.tp1}/${tr.tp2} (${tr.grade})`,
    );
    layers.push({
      id: "paper_open",
      label: "Paper open",
      tone: "warn",
      score: -0.25,
      detail: lines.join(" · "),
    });
    yellow.push(
      `Open paper: ${openPaper.length} — manage exits before new PATH risk`,
    );
    // One book: if open ES short, don't stack same-bias NQ short etc.
    score -= 0.25;
  }
  const pTaken = memory.book.paperTaken ?? 0;
  const pWins = memory.book.paperWins ?? 0;
  if (pTaken > 0 || paperItems.length > 0) {
    const pWr = pTaken > 0 ? pWins / pTaken : null;
    const last = memory.book.lastPaperLabel;
    const lastR = memory.book.lastPaperR;
    layers.push({
      id: "paper_tape",
      label: "Paper tape",
      tone:
        pWr != null && pWr >= 0.65
          ? "pass"
          : pWr != null && pWr < 0.45 && pTaken >= 3
            ? "fail"
            : "info",
      score:
        pWr != null && pWr >= 0.65
          ? 0.4
          : pWr != null && pWr < 0.45 && pTaken >= 3
            ? -0.6
            : 0.1,
      detail: `Live paper ${pTaken} · WR ${pWr != null ? (pWr * 100).toFixed(0) + "%" : "—"} · ΣR ${memory.book.paperSumR ?? 0} · last ${last ?? "—"} ${lastR != null ? lastR + "R" : ""}`,
    });
    if (pWr != null && pWr >= 0.65) {
      score += 0.4;
      green.push("Live paper tape supports process");
    } else if (pWr != null && pWr < 0.45 && pTaken >= 3) {
      score -= 0.6;
      yellow.push("Live paper cold — only A+ or structure-confirmed");
    }
    if (paperItems[0]) {
      green.push(`Last paper: ${paperItems[0].title} — ${paperItems[0].summary.slice(0, 80)}`);
    }
  } else if (paperOpenMem[0]) {
    layers.push({
      id: "paper_tape",
      label: "Paper tape",
      tone: "info",
      score: 0,
      detail: paperOpenMem[0].summary,
    });
  }

  // 7b) Backtest rates applied to live setup
  const stratWr = bucketWr(rateCard.strategy ?? undefined);
  const stratExp = bucketExpectancy(rateCard.strategy ?? undefined);
  if (rateCard.strategy && rateCard.strategy.n >= 3) {
    const detail = `BT ${rawBest?.completeStrategy || rawBest?.strategyPrimary || "model"}: ${rateCard.strategy.n}t WR ${stratWr != null ? (stratWr * 100).toFixed(0) + "%" : "—"} · E[R] ${stratExp?.toFixed(2) ?? "—"} · size×${rateCard.sizeBias.toFixed(2)}`;
    if (rateCard.sizeBias <= 0.5 || (stratWr != null && stratWr < 0.45)) {
      layers.push({
        id: "bt_rates",
        label: "BT rates",
        tone: "fail",
        score: -1.25,
        detail,
      });
      score -= 1.25;
      yellow.push(...rateCard.advice.slice(0, 2));
    } else if (rateCard.sizeBias >= 1.05 && stratWr != null && stratWr >= 0.65) {
      layers.push({
        id: "bt_rates",
        label: "BT rates",
        tone: "pass",
        score: 0.75,
        detail,
      });
      score += 0.75;
      green.push(...rateCard.advice.slice(0, 2));
    } else {
      layers.push({
        id: "bt_rates",
        label: "BT rates",
        tone: "info",
        score: 0,
        detail,
      });
    }
  } else {
    layers.push({
      id: "bt_rates",
      label: "BT rates",
      tone: "info",
      score: 0,
      detail:
        topRates.length > 0
          ? `Top BT: ${topRates.map((r) => `${r.id} ${(r.wr * 100).toFixed(0)}%/${r.n}`).join(" · ")}`
          : "No BT rates yet — run week/month backtest to train brain",
    });
  }
  for (const a of rateCard.advice) {
    if (!yellow.includes(a) && !green.includes(a)) {
      if (rateCard.sizeBias < 1) yellow.push(a);
      else green.push(a);
    }
  }

  // Pins act as discretionary reminders
  for (const pin of memory.pins.slice(0, 3)) {
    yellow.push(`Pin: ${pin}`);
  }

  // 8) Dealing range location
  if (rawBest && bias.left.dealing) {
    const zone = bias.left.dealing.zone;
    const aligned =
      (rawBest.side === "long" && zone === "discount") ||
      (rawBest.side === "short" && zone === "premium");
    if (aligned) {
      score += 0.5;
      green.push(`Dealing ${zone} favors ${rawBest.side}`);
    } else if (zone === "equilibrium") {
      yellow.push("Equilibrium — wait for displacement");
      score -= 0.25;
    } else {
      yellow.push(`Dealing ${zone} fights ${rawBest.side}`);
      score -= 0.5;
    }
  }

  // 8b) Canon stack — independent ICT/SMC/TJR/PB factors
  const book =
    rawBest && rawBest.symbol === bias.right.symbol ? bias.right : bias.left;
  // Own-book narrative, not narrPick's "whichever side confirms" heuristic —
  // scoring rawBest's canon stack off the OTHER book's liquidity/confirmation
  // state would grade it against a story that isn't its own.
  const ownNarrative =
    rawBest && narrPkg
      ? rawBest.symbol === bias.right.symbol
        ? narrPkg.right
        : narrPkg.left
      : null;
  const canonStack = rawBest
    ? scoreCanonStack(
        canonInputForCandidate(rawBest, book, ownNarrative, {
          inTradeWindow: clock.inTradeWindow,
          killzoneLabel: clock.killzoneLabel,
        }),
      )
    : scoreCanonStack({
        side: null,
        htf: book.topDown,
        mtf: book.mid,
        dealingZone: book.dealing?.zone ?? null,
        swept: "none",
        confirmation: "none",
        inKillzone: clock.inTradeWindow,
        killzoneLabel: clock.killzoneLabel,
        smt: false,
        components: [],
      });
  layers.push({
    id: "canon",
    label: "Canon stack",
    tone:
      canonStack.grade === "A+" || canonStack.grade === "A"
        ? "pass"
        : canonStack.grade === "A-" || canonStack.grade === "B"
          ? "warn"
          : "fail",
    score:
      canonStack.grade === "A+"
        ? 1
        : canonStack.grade === "A"
          ? 0.6
          : canonStack.grade === "A-"
            ? 0.15
            : canonStack.grade === "B"
              ? -0.25
              : -0.75,
    detail: `${canonStack.grade} · ${canonStack.mustHits}/${canonStack.mustNeed} must · ${canonStack.thesis}`,
  });
  if (canonStack.grade === "A+" || canonStack.grade === "A") {
    score += canonStack.grade === "A+" ? 1 : 0.6;
    green.push(`Canon ${canonStack.grade}: ${canonStack.thesis}`);
  } else if (canonStack.grade === "skip") {
    score -= 0.75;
    yellow.push(
      canonStack.factors
        .filter((f) => f.must && !f.pass)
        .map((f) => f.label)
        .join(" + ") || "Canon incomplete",
    );
  } else {
    score += canonStack.grade === "A-" ? 0.15 : -0.25;
  }


  // Verdict from score + hard vetoes
  let verdict: DiscretionVerdict = "STAND_DOWN";
  let sizeMult = 0;
  if (vetoes.length) {
    verdict = "STAND_DOWN";
    sizeMult = 0;
  } else if (
    rawBest &&
    rawBest.actionable &&
    rawBest.htfOk &&
    clock.inTradeWindow &&
    score >= 3
  ) {
    verdict = "TAKE";
    sizeMult = rawBest.pathBand === "A-" ? 1 : 1; // size from grade risk already
  } else if (
    rawBest &&
    (rawBest.actionable || rawBest.strategyComplete) &&
    rawBest.htfOk &&
    clock.inTradeWindow &&
    score >= 1.5
  ) {
    verdict = "REDUCE";
    sizeMult = 0.5;
  } else if (rawBest && rawBest.confluence >= APLUS_RULES.confluenceFloor - 0.08) {
    verdict = "WATCH";
    sizeMult = 0;
  } else if (rawBest) {
    verdict = "SKIP";
    sizeMult = 0;
  } else {
    verdict = "STAND_DOWN";
    sizeMult = 0;
  }

  // Cold book forces REDUCE even on TAKE
  if (verdict === "TAKE" && wr != null && wr < 0.6 && memory.book.pathTaken >= 10) {
    verdict = "REDUCE";
    sizeMult = 0.5;
    yellow.push("Veteran size-down: book WR soft");
  }
  // Backtest rates size bias
  if (verdict === "TAKE" || verdict === "REDUCE") {
    sizeMult = Math.max(0, Math.min(1.25, sizeMult * rateCard.sizeBias));
    if (rateCard.sizeBias <= 0.5 && verdict === "TAKE") {
      verdict = "REDUCE";
      yellow.push("BT rates forced REDUCE");
    }
  }

  const confidence = clamp01((score + 4) / 8);
  const posture =
    verdict === "TAKE"
      ? "Hunt — veteran aligned"
      : verdict === "REDUCE"
        ? "Small — edge soft"
        : verdict === "WATCH"
          ? "Stalk levels"
          : "Stand down";

  const headline =
    verdict === "TAKE" && rawBest
      ? `TAKE ${rawBest.symbol} ${rawBest.side.toUpperCase()} ${rawBest.grade} @ ${rawBest.confluence.toFixed(2)} · full grade size · risk-off 50%@1R`
      : verdict === "REDUCE" && rawBest
        ? `REDUCE ${rawBest.symbol} ${rawBest.side} — half size (${rawBest.confluence.toFixed(2)}) · same invalidation`
        : verdict === "WATCH"
          ? "WATCH — almost path, missing clean trigger"
          : "STAND DOWN — selectivity is the edge";

  const monologue = [
    "I've traded this model for years: sweep → displacement → IFVG/OB → only with HTF.",
    vetoes[0]
      ? `Hard stop: ${vetoes[0]}.`
      : green[0]
        ? `What I like: ${green[0]}.`
        : "Board is quiet — that is information.",
    yellow[0] ? `What bothers me: ${yellow[0]}.` : "No major yellow flags.",
    memory.book.lastBacktestLabel
      ? `I remember ${memory.book.lastBacktestLabel}: ${memory.book.lastBacktestPath ?? 0} PATH, ${memory.book.lastBacktestSumR ?? 0}R.`
      : "Run a week backtest so I have sample memory.",
    verdict === "TAKE"
      ? "If entry tags and holds, take it. Bank half at +1R, BE the rest."
      : verdict === "REDUCE"
        ? "If you take it, cut size in half — protect the book."
        : "Walk away is a position. Journal the skip.",
  ];

  const focus =
    verdict === "TAKE" && rawBest
      ? `Plan ${rawBest.symbol} ${rawBest.side} · entry ${rawBest.entryZone} · invalid ${rawBest.invalidation} · size ${(sizeMult * 100).toFixed(0)}% of grade · strategies ${(rawBest.strategies || []).join("/")}`
      : "Update PDH/PDL, dealing EQ, wait for NY AM stack. No force.";

  let asked: string | undefined;
  let answer: string | undefined;
  if (question && question.trim()) {
    asked = question.trim();
    answer = answerVeteranQuestion(asked, {
      desk,
      memory,
      verdict,
      rawBest,
      layers,
      green,
      yellow,
      vetoes,
    });
  }


  // ---- Auto-read every desk "tab" + all strategies (no user click needed) ----
  const tabReads: TabRead[] = [
    {
      tab: "Trade",
      status: clock.inTradeWindow
        ? rawBest && rawBest.confluence >= PROFIT_ACTION_FLOOR
          ? "hot"
          : "ok"
        : "idle",
      line: `${clock.killzoneLabel} · HTF ${bias.left.topDown}/${bias.right.topDown} · ${
        rawBest
          ? `${rawBest.symbol} ${rawBest.side} ${rawBest.grade} ${rawBest.confluence.toFixed(2)}`
          : "no path idea"
      }`,
    },
    {
      tab: "Path",
      status:
        wr != null && wr >= 0.7 ? "ok" : wr != null && wr < 0.55 ? "warn" : "idle",
      line: `Floor ${PROFIT_ACTION_FLOOR} · target ~${monthTarget}/mo · book ${memory.book.pathTaken} PATH · WR ${
        wr != null ? (wr * 100).toFixed(0) + "%" : "—"
      } · ΣR ${memory.book.sumR}`,
    },
    {
      tab: "Paper",
      status:
        (typeof window !== "undefined" ? listOpenPaperTrades().length : 0) > 0
          ? "hot"
          : (memory.book.paperTaken ?? 0) > 0
            ? "ok"
            : "idle",
      line: (() => {
        const opens =
          typeof window !== "undefined" ? listOpenPaperTrades() : [];
        const pt = memory.book.paperTaken ?? 0;
        const pw = memory.book.paperWins ?? 0;
        const pwr = pt > 0 ? ((pw / pt) * 100).toFixed(0) + "%" : "—";
        if (opens.length) {
          return `OPEN ${opens.length}: ${opens
            .map((tr) => `${tr.displaySymbol} ${tr.side} @ ${tr.entry} TP ${tr.tp1}`)
            .join(" · ")} · closed ${pt} WR ${pwr} ΣR ${memory.book.paperSumR ?? 0}`;
        }
        return pt
          ? `Live paper ${pt} · WR ${pwr} · ΣR ${memory.book.paperSumR ?? 0} · last ${memory.book.lastPaperLabel ?? "—"}`
          : "No live paper yet — Log paper on Trade feeds brain rates";
      })(),
    },
    {
      tab: "Backtest",
      status: memory.book.lastBacktestLabel ? "ok" : "idle",
      line: memory.book.lastBacktestLabel
        ? `${memory.book.lastBacktestLabel}: ${memory.book.lastBacktestPath ?? 0} PATH · WR ${
            memory.book.lastBacktestWr != null
              ? (memory.book.lastBacktestWr * 100).toFixed(0) + "%"
              : "—"
          } · ${memory.book.lastBacktestSumR ?? 0}R`
        : "No BT in memory — run week/month in Backtest tab (auto-ingested)",
    },
    {
      tab: "Tape",
      status: "ok",
      line: `${desk.quotes.left.symbol} ${desk.quotes.left.price} · ${desk.quotes.right.symbol} ${desk.quotes.right.price} · feed ${desk.feed} · levels ${desk.levels?.[0]?.items?.length ?? 0}+`,
    },
    {
      tab: "Risk",
      status:
        liveRisk?.dailyHaltHit || liveRisk?.weeklyHaltHit
          ? "warn"
          : "ok",
      line: liveRisk?.dailyHaltHit || liveRisk?.weeklyHaltHit
        ? "HALT — no new risk"
        : `Open · grade 0.5–3% · risk-off 50%@1R · max ${risk.maxSetups}/KZ`,
    },
    {
      tab: "Veteran",
      status:
        verdict === "TAKE" ? "hot" : verdict === "REDUCE" ? "warn" : "ok",
      line: `${verdict} · size ×${sizeMult} · conf ${(confidence * 100).toFixed(0)}%`,
    },
    {
      tab: "Lab",
      status: canonStack.grade === "A+" || canonStack.grade === "A" ? "ok" : "idle",
      line: `Canon ${canonStack.grade} · ${canonStack.mustHits}/${canonStack.mustNeed} · school ${canonStack.schoolHint ?? "smc"}`,
    },
  ];

  /**
   * Strategy board — every ALWAYS_SCAN model at its OWN measured fit.
   *
   * WHAT WAS WRONG: this filtered candidates by tag membership and then
   * reported `top.confluence` — the WINNING model's score — against every one
   * of the nine names. Because the tag cutoff is loose (profit-path.ts admits
   * a model at fit >= 0.35), one candidate typically carries most of the nine
   * tags, so all nine rows selected the same candidate and printed the same
   * number. The board read "9 strategies scanned" while showing one score
   * nine times.
   *
   * The nine genuinely distinct fits already existed the whole time:
   * `gradeAllStrategies` computes them (strategy-grade.ts) and every candidate
   * carries the full board on `c.strategyBoard`. This reads that instead.
   *
   * Status now means something per model: `complete` is the model's own
   * must-conditions being met, not a shared confluence number clearing a
   * floor. Global vetoes (halt, news blackout) still block everything —
   * correctly, since a halt is not model-specific.
   */
  const strategyBoard: StrategyRead[] = ALWAYS_SCAN.map((id) => {
    let best: { g: StrategyMarketGrade; c: SetupCandidate } | null = null;
    for (const c of candidates) {
      const g = c.strategyBoard?.find((b) => b.id === id);
      if (!g) continue;
      if (!best || g.fit > best.g.fit) best = { g, c };
    }
    if (!best) {
      return {
        id,
        status: "absent" as const,
        score: 0,
        note: "Not firing on current bars",
      };
    }
    const { g, c } = best;
    const missing = g.missing.length
      ? ` · missing ${g.missing.slice(0, 2).join("+")}`
      : "";
    const detail = `${c.symbol} ${c.side} fit ${g.fit.toFixed(2)} ${g.band}${g.complete ? " · complete" : missing}`;

    if (vetoes.length || !c.htfOk) {
      return {
        id,
        status: "blocked" as const,
        score: g.fit,
        note: `${detail} — ${vetoes.length ? "gate veto" : "HTF block"}`,
      };
    }
    if (g.complete && g.fit >= PROFIT_ACTION_FLOOR) {
      return {
        id,
        status: "ready" as const,
        score: g.fit,
        note: `${detail} · PATH-eligible`,
      };
    }
    return {
      id,
      status: "forming" as const,
      score: g.fit,
      note: `${detail} · needs complete + ${PROFIT_ACTION_FLOOR}`,
    };
  }).sort((a, b) => b.score - a.score);

  const readyStrats = strategyBoard.filter((s) => s.status === "ready");
  const autoActions: string[] = [
    "Auto-scanned Trade · Path · Backtest · Tape · Risk · Lab",
    `Auto-scored ${ALWAYS_SCAN.length} strategies: ${readyStrats.length} ready`,
    memory.book.pathTaken > 0
      ? `BT book live: ${memory.book.pathTaken} PATH · WR ${wr != null ? (wr * 100).toFixed(0) + "%" : "—"} · size bias ×${rateCard.sizeBias.toFixed(2)}`
      : "BT book empty — run backtest to train rates",
    verdict === "TAKE" && rawBest
      ? `AUTO PLAN: ${rawBest.symbol} ${rawBest.side} full grade · risk-off 50%@1R · log paper first`
      : verdict === "REDUCE" && rawBest
        ? `AUTO PLAN: ${rawBest.symbol} ${rawBest.side} half size · same invalidation`
        : "AUTO PLAN: flat — no PATH stack complete",
    memory.book.lastBacktestLabel
      ? `Memory linked to last BT (${memory.book.lastBacktestLabel})`
      : "Waiting for first backtest ingest",
  ];

  // Enrich monologue with auto tab + strategy summary
  monologue.unshift(
    `I just read every tab. Trade=${tabReads[0]!.line}. Path=${tabReads[1]!.line}.`,
  );
  if (readyStrats[0]) {
    monologue.push(
      `Strongest model right now: ${readyStrats[0].id} — ${readyStrats[0].note}.`,
    );
  } else {
    monologue.push(
      `No strategy is PATH-ready. Closest: ${strategyBoard[0]?.id ?? "—"} ${strategyBoard[0]?.note ?? ""}.`,
    );
  }
  if (memory.book.pathTaken > 0) {
    monologue.push(
      `From your backtests: book ${memory.book.pathTaken} PATH · WR ${wr != null ? (wr * 100).toFixed(0) + "%" : "—"} · ΣR ${memory.book.sumR}. I size live off those rates.`,
    );
  }
  if (rateCard.advice[0]) monologue.push(rateCard.advice[0]!);
  if (typeof window !== "undefined") {
    const opens = listOpenPaperTrades();
    if (opens.length) {
      monologue.push(
        `Open paper risk: ${opens.map((tr) => `${tr.displaySymbol} ${tr.side} @ ${tr.entry}→TP ${tr.tp1}`).join(" | ")}`,
      );
    }
    const lastPaper = recentByKind("paper", 1)[0];
    if (lastPaper) monologue.push(`Paper memory: ${lastPaper.title} · ${lastPaper.summary.slice(0, 100)}`);
  }

  const narrLines = (desk as { __narrLines?: string[] }).__narrLines;
  if (narrLines?.length) monologue.push(...narrLines);
  monologue.push(...canonCoachLines(canonStack));



  return {
    name: "Veteran · SMC/ICT",
    posture,
    verdict,
    confidence,
    headline,
    layers,
    vetoes,
    green,
    yellow,
    focus,
    memoryLine: memoryDigest(memory),
    sizeMult,
    setup: rawBest,
    monologue,
    tabReads,
    strategyBoard,
    autoActions,
    rateAdvice: rateCard.advice,
    rateSummary:
      topRates.length > 0
        ? topRates
            .map(
              (r) =>
                `${r.id} n=${r.n} WR ${(r.wr * 100).toFixed(0)}% E[R] ${r.expR.toFixed(2)}`,
            )
            .join(" · ")
        : "No strategy rates — run a backtest",
    rateSizeBias: rateCard.sizeBias,
    asked,
    answer,
    canonStack,
  };
}

function answerVeteranQuestion(
  q: string,
  ctx: {
    desk: DeskPayload;
    memory: DeskMemoryState;
    verdict: DiscretionVerdict;
    rawBest: SetupCandidate | null;
    layers: BrainLayer[];
    green: string[];
    yellow: string[];
    vetoes: string[];
  },
): string {
  const l = q.toLowerCase();
  const { desk, memory, verdict, rawBest, vetoes, green, yellow } = ctx;

  if (/should i (take|enter|buy|sell)|take (it|this)|go long|go short/.test(l)) {
    if (vetoes.length) return `No. ${vetoes[0]}`;
    if (verdict === "TAKE" && rawBest)
      return `Yes — ${rawBest.symbol} ${rawBest.side} only if ${rawBest.entryZone} holds. Full grade size, 50% off at +1R, BE runner.`;
    if (verdict === "REDUCE" && rawBest)
      return `Only half size. ${rawBest.symbol} ${rawBest.side} is path-grade but soft: ${yellow[0] || "edge incomplete"}.`;
    return "No. Skip is correct. Edge is saying wait.";
  }
  if (/htf|bias|direction|trend/.test(l)) {
    return `Top-down: ${desk.bias.left.symbol} ${desk.bias.left.topDown}, ${desk.bias.right.symbol} ${desk.bias.right.topDown}. ${desk.bias.left.summary}`;
  }
  if (/memory|backtest|journal|how am i|performance|wr|win rate/.test(l)) {
    return memoryDigest(memory);
  }
  if (/risk|size|contract|percent/.test(l)) {
    return `Grade risk A+ 3% / A 2% / B 1% / C 0.5% on $${APLUS_RULES.paperEquity.toLocaleString()}. Discretion size mult now ${verdict === "REDUCE" ? "50%" : verdict === "TAKE" ? "100%" : "0%"}. Always risk-off 50% at +1R.`;
  }
  if (/strategy|model|mechanical|judas|tjr|smt/.test(l)) {
    return rawBest
      ? `Primary ${rawBest.strategyPrimary || "—"} · also ${(rawBest.strategies || []).join(", ") || "none"} · missing ${rawBest.missing.slice(0, 4).join(", ") || "nothing key"}.`
      : "No live strategy stack — wait for sweep + displacement + retrace.";
  }
  if (/news|fomc|cpi|nfp/.test(l)) {
    return `News: ${desk.news.verdict} — ${desk.news.reason}. Blackout = flat.`;
  }
  if (/skip|why not|deadspot/.test(l)) {
    return vetoes[0] || yellow[0] || "Nothing path-grade right now — that is the skip reason.";
  }
  return `Verdict ${verdict}. ${green[0] || ""} ${yellow[0] || ""} ${vetoes[0] || ""} Focus: stay selective for ~${APLUS_RULES.targetTradesPerMonth.center} PATH/mo.`.replace(
    /\s+/g,
    " ",
  ).trim();
}
