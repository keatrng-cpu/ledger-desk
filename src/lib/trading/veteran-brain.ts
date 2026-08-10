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
  type DeskMemoryState,
} from "./desk-memory";
import { APLUS_RULES } from "@/lib/aplus/config";
import { PROFIT_ACTION_FLOOR } from "./profit-path";

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
  asked?: string;
  answer?: string;
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
): VeteranBrief {
  const memory = mem ?? loadDeskMemory();
  const { clock, bias, scan, risk, news } = desk;
  const candidates = scan.candidates ?? [];
  const rawBest =
    candidates.find((c) => c.actionable) ??
    candidates.find(
      (c) => c.confluence >= PROFIT_ACTION_FLOOR && c.htfOk,
    ) ??
    candidates[0] ??
    null;

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

  // 3) Model / strategy completeness
  if (rawBest) {
    const missing = rawBest.missing || [];
    const hasMech = (rawBest.components || []).includes("mechanical_model");
    const hasSweep = (rawBest.components || []).includes("sweep_significant");
    const multiStrat = (rawBest.strategies || []).length >= 2;
    if (rawBest.confluence >= PROFIT_ACTION_FLOOR && hasMech && hasSweep) {
      layers.push({
        id: "model",
        label: "Model",
        tone: "pass",
        score: 1.5,
        detail: `${rawBest.strategyPrimary || "model"} complete · ${rawBest.grade} ${rawBest.confluence.toFixed(2)}`,
      });
      score += 1.5;
      green.push(`Complete model · ${rawBest.strategyPrimary}`);
    } else if (rawBest.confluence >= PROFIT_ACTION_FLOOR) {
      layers.push({
        id: "model",
        label: "Model",
        tone: "warn",
        score: 0.5,
        detail: `Score ok but incomplete — missing ${missing.slice(0, 3).join(", ") || "pieces"}`,
      });
      score += 0.5;
      yellow.push("Partial model — veteran wants full sequence");
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
      green.push(`Multi-strategy: ${(rawBest.strategies || []).join(", ")}`);
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

  // 7) Memory / book
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

  // Verdict from score + hard vetoes
  let verdict: DiscretionVerdict = "STAND_DOWN";
  let sizeMult = 0;
  if (vetoes.length) {
    verdict = "STAND_DOWN";
    sizeMult = 0;
  } else if (
    rawBest &&
    rawBest.confluence >= PROFIT_ACTION_FLOOR &&
    rawBest.htfOk &&
    clock.inTradeWindow &&
    score >= 3
  ) {
    verdict = "TAKE";
    sizeMult = 1;
  } else if (
    rawBest &&
    rawBest.confluence >= PROFIT_ACTION_FLOOR &&
    rawBest.htfOk &&
    clock.inTradeWindow &&
    score >= 1.5
  ) {
    verdict = "REDUCE";
    sizeMult = 0.5; // half grade size (veteran cut)
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
    asked,
    answer,
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
