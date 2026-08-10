/**
 * Full setup scanner — port of Trading-Automation strategy/scanner.py scoring
 * + strategy catalog + conditions gate.
 */

import { APLUS_RULES } from "@/lib/aplus/config";
import type { OhlcBar } from "@/lib/market/types";
import { assessConditions, type MarketConditions } from "./conditions";
import {
  summarizeDetectors,
  type DetectorSummary,
  type FvgResult,
} from "./detectors";
import { WEIGHTS, type ComponentKey } from "./engine-weights";
import type { SessionClock } from "./sessions";
import {
  ALWAYS_SCAN,
  classify,
  primaryTag,
  strategyLabel,
  type StrategyId,
} from "./strategies";
import type { HtfBiasRead } from "./structure";
import { smtRead } from "./structure";
import { applyProfitPathToCandidate } from "./profit-path";

export type SetupSide = "long" | "short";

export interface SetupCandidate {
  id: string;
  symbol: string;
  side: SetupSide;
  confluence: number;
  grade: "A+" | "A-" | "B" | "skip";
  title: string;
  reasons: string[];
  missing: string[];
  components: ComponentKey[];
  strategies: StrategyId[];
  strategyPrimary: string;
  strategyWhy: string[];
  entryZone: string;
  invalidation: string;
  targets: string[];
  killzoneOk: boolean;
  htfOk: boolean;
  conditionsOk: boolean;
  actionable: boolean;
  regime: string;
  volatility: string;
  /** Two-axis path band (A+ / A / A- path · B paper · C journal) */
  pathBand?: "A+" | "A" | "A-" | "B+" | "B" | "C" | "skip";
  qualityScore?: number;
  strategyComplete?: boolean;
  completeStrategy?: string;
  completeNote?: string;
  riskGrade?: string;
}

export interface ScanResult {
  floor: number;
  aPlus: number;
  candidates: SetupCandidate[];
  blocked: string[];
  focus: string;
  smt: ReturnType<typeof smtRead>;
  conditions: { left: MarketConditions; right: MarketConditions };
  catalog: string[];
}

function grade(score: number, floor: number): SetupCandidate["grade"] {
  if (score >= APLUS_RULES.aPlusThreshold) return "A+";
  if (score >= floor) return "A-";
  if (score >= floor - 0.12) return "B";
  return "skip";
}

function openingBiasFrom(
  read: HtfBiasRead,
): "bull" | "bear" | "neutral" | null {
  if (read.nyOpen830 == null || !read.last) return null;
  if (read.last > read.nyOpen830 * 1.0002) return "bull";
  if (read.last < read.nyOpen830 * 0.9998) return "bear";
  return "neutral";
}

function weeklyPdBias(
  read: HtfBiasRead,
): "bull" | "bear" | "neutral" | null {
  if (read.pwh == null || read.pwl == null) return null;
  const mid = (read.pwh + read.pwl) / 2;
  if (read.last < mid) return "bull";
  if (read.last > mid) return "bear";
  return "neutral";
}

function sigSweepKinds(label: string): boolean {
  const u = label.toUpperCase();
  return (
    u.includes("PDH") ||
    u.includes("PDL") ||
    u.includes("PWH") ||
    u.includes("PWL") ||
    u.includes("EQH") ||
    u.includes("EQL") ||
    u.includes("SESSION") ||
    u.includes("SWING")
  );
}

function resolveIfvg(
  direction: "bull" | "bear",
  det: DetectorSummary,
): { hit: boolean; inverted: boolean; zone: FvgResult | null } {
  const latest = det.fvg.latest;
  if (!latest) return { hit: false, inverted: false, zone: null };
  if (direction === "bull") {
    if (latest.kind === "bear" && latest.inverted) {
      return { hit: true, inverted: true, zone: latest };
    }
    if (latest.kind === "bull" && latest.fill !== "full" && !latest.inverted) {
      return { hit: true, inverted: false, zone: latest };
    }
    if (det.fvg.inverted > 0 && det.fvg.inversionRetested > 0) {
      return { hit: true, inverted: true, zone: latest };
    }
  } else {
    if (latest.kind === "bull" && latest.inverted) {
      return { hit: true, inverted: true, zone: latest };
    }
    if (latest.kind === "bear" && latest.fill !== "full" && !latest.inverted) {
      return { hit: true, inverted: false, zone: latest };
    }
    if (det.fvg.inverted > 0) {
      return { hit: true, inverted: true, zone: latest };
    }
  }
  return {
    hit: det.fvg.open > 0 || det.fvg.inverted > 0,
    inverted: det.fvg.inverted > 0,
    zone: latest,
  };
}

function scoreDirection(
  direction: "bull" | "bear",
  read: HtfBiasRead,
  det: DetectorSummary,
  bars: OhlcBar[],
  conditions: MarketConditions,
  clock: SessionClock,
  smt: ReturnType<typeof smtRead>,
): SetupCandidate {
  const side: SetupSide = direction === "bull" ? "long" : "short";
  const present: ComponentKey[] = [];
  const missing: string[] = [];
  const reasons: string[] = [];

  const add = (key: ComponentKey, ok: boolean, detail?: string) => {
    if (ok) {
      present.push(key);
      reasons.push(detail ?? key);
    } else {
      missing.push(key);
    }
  };

  const mechDir: "bull" | "bear" | null =
    det.mechanical.direction === "long"
      ? "bull"
      : det.mechanical.direction === "short"
        ? "bear"
        : null;
  const mechHit =
    det.mechanical.complete &&
    det.mechanical.state === "complete" &&
    mechDir === direction;
  add(
    "mechanical_model",
    mechHit,
    mechHit ? "mechanical_model: sweep→displace→invert→retest" : undefined,
  );

  add("mid_bias", read.mid === direction, `mid_bias ${read.mid}`);
  add("htf2_bias", read.ltf === direction, `htf2/ltf ${read.ltf}`);

  const ifvg = resolveIfvg(direction, det);
  add(
    "ifvg",
    ifvg.hit,
    ifvg.hit ? `ifvg${ifvg.inverted ? " (inverted)" : ""}` : undefined,
  );

  const ob = det.orderBlock.latest;
  const obAligned = Boolean(
    ob &&
      !ob.mitigated &&
      ((direction === "bull" && ob.kind === "bull") ||
        (direction === "bear" && ob.kind === "bear")),
  );
  add("order_block", obAligned, obAligned ? "order_block retest" : undefined);

  const smtBlob = `${smt.state} ${smt.note}`.toLowerCase();
  const smtHits =
    smt.edge !== "none" &&
    (smtBlob.includes(direction) ||
      (direction === "bull" &&
        /bull|long|strength|lead|higher low|relat/.test(smtBlob)) ||
      (direction === "bear" &&
        /bear|short|weak|lag|lower high|relat/.test(smtBlob)));
  add("smt", smtHits, smtHits ? `smt: ${smt.state}` : undefined);

  const sweeps = read.liquidity.filter((l) => l.swept);
  const sideSweep =
    direction === "bull"
      ? sweeps.filter((l) => l.side === "sellside")
      : sweeps.filter((l) => l.side === "buyside");
  const detSweepOk = Boolean(
    det.sweep.latest &&
      ((direction === "bull" && det.sweep.latest.side === "sellside") ||
        (direction === "bear" && det.sweep.latest.side === "buyside")),
  );
  const sig =
    sideSweep.some((l) => sigSweepKinds(l.label)) ||
    detSweepOk ||
    (det.mechanical.sweep != null && mechDir === direction);
  add(
    "sweep_significant",
    sig,
    sig
      ? `sweep_significant (${sideSweep[0]?.label ?? det.sweep.latest?.side ?? "det"})`
      : undefined,
  );

  const wpd = weeklyPdBias(read);
  add("weekly_pd", wpd === direction, wpd ? `weekly_pd ${wpd}` : undefined);

  const disp = Boolean(
    det.displacement.latest &&
      det.displacement.latest.direction === direction,
  );
  const structure = read.lastBOS?.direction === direction;
  const cisd = Boolean(structure && disp);
  add("cisd", cisd, cisd ? "cisd (BOS+displacement)" : undefined);
  add("displacement", disp, disp ? "displacement" : undefined);
  add("structure", Boolean(structure), structure ? "structure BOS" : undefined);
  add("mss", Boolean(structure && disp), structure && disp ? "mss" : undefined);

  const openBias = openingBiasFrom(read);
  add(
    "opening_bias",
    openBias === direction,
    openBias ? `opening_bias ${openBias}` : undefined,
  );

  const pdOk =
    (direction === "bull" && read.dealing?.zone === "discount") ||
    (direction === "bear" && read.dealing?.zone === "premium");
  add("pd", Boolean(pdOk), pdOk ? `pd ${read.dealing?.zone}` : undefined);

  const sponsored = ifvg.zone != null && ifvg.zone.middleBodyAtrRatio >= 1.5;
  add("sponsored", sponsored, sponsored ? "sponsored FVG" : undefined);

  // Honest cold components: separate breaker/propulsion detectors not fully ported
  add("breaker", false);
  add("mitigation", Boolean(ob && ob.mitigated && obAligned));
  add("propulsion", false);

  let rejection = false;
  if (bars.length >= 3) {
    const b = bars[bars.length - 1]!;
    const range = b.h - b.l || 1;
    if (direction === "bull") {
      rejection =
        b.l < Math.min(b.o, b.c) &&
        (Math.min(b.o, b.c) - b.l) / range >= 0.45;
    } else {
      rejection =
        b.h > Math.max(b.o, b.c) &&
        (b.h - Math.max(b.o, b.c)) / range >= 0.45;
    }
  }
  add("rejection", rejection, rejection ? "rejection wick" : undefined);
  add("daily_bias", read.daily === direction, `daily_bias ${read.daily}`);

  let score = 0;
  for (const k of present) score += WEIGHTS[k] ?? 0;
  score = Math.min(0.99, +score.toFixed(4));

  const matches = classify({
    direction,
    killzone: clock.killzone,
    components: present,
    topDown: read.topDown,
    mid: read.mid,
    daily: read.daily,
    openingBias: openBias,
    weeklyPd: wpd,
    ifvgInverted: ifvg.inverted,
    significantSweep: sig,
  });
  const primary = primaryTag(matches);
  const stratIds = matches.map((m) => m.strategy);

  const htfOk = read.topDown === direction;
  const killzoneOk = clock.inTradeWindow;
  const conditionsOk = conditions.tradeable;
  const g = grade(score, APLUS_RULES.confluenceFloor);

  const hasEntryModel =
    present.includes("ifvg") || present.includes("order_block");
  const hasSweep =
    present.includes("sweep_significant") ||
    present.includes("mechanical_model");
  // Soft pre-filter — strategy-native path applied in applyProfitPathToCandidate
  const actionable =
    g !== "skip" &&
    htfOk &&
    killzoneOk &&
    clock.isWeekday &&
    conditionsOk &&
    (hasEntryModel || present.includes("mechanical_model")) &&
    (hasSweep || present.includes("structure") || present.includes("mss")) &&
    score >= APLUS_RULES.confluenceFloor - 0.05;

  const titleParts = [
    primary ? strategyLabel(primary) : "Unclassified",
    ...stratIds
      .filter((s) => s !== primary)
      .slice(0, 2)
      .map(strategyLabel),
  ];

  const zone = ifvg.zone;
  const entryZone = zone
    ? `${zone.bottom.toFixed(2)} – ${zone.top.toFixed(2)}`
    : read.dealing
      ? direction === "bull"
        ? `${read.dealing.low.toFixed(2)} – ${read.dealing.eq.toFixed(2)}`
        : `${read.dealing.eq.toFixed(2)} – ${read.dealing.high.toFixed(2)}`
      : "await array";

  return {
    id: `${read.symbol}-${side}`,
    symbol: read.symbol,
    side,
    confluence: score,
    grade: g,
    title: `${read.symbol} ${side} — ${titleParts.join(" · ")}`,
    reasons: [
      ...stratIds.map((s) => `strategy:${s}`),
      ...reasons.slice(0, 12),
    ],
    missing: missing
      .filter((m) => !present.includes(m as ComponentKey))
      .slice(0, 12),
    components: present,
    strategies: stratIds,
    strategyPrimary: primary,
    strategyWhy: matches.flatMap((m) => m.reasons),
    entryZone,
    invalidation:
      direction === "bull"
        ? read.pdl
          ? `Below PDL ${read.pdl.toFixed(2)} / sweep`
          : "Below protected low / sweep"
        : read.pdh
          ? `Above PDH ${read.pdh.toFixed(2)} / sweep`
          : "Above protected high / sweep",
    targets: [
      read.dealing ? `EQ ${read.dealing.eq.toFixed(2)}` : "1R",
      direction === "bull"
        ? read.pdh
          ? `PDH ${read.pdh.toFixed(2)}`
          : "External buyside"
        : read.pdl
          ? `PDL ${read.pdl.toFixed(2)}`
          : "External sellside",
      "Next unfilled pool (clamped 1–3R)",
    ],
    killzoneOk,
    htfOk,
    conditionsOk,
    actionable,
    regime: conditions.regime,
    volatility: conditions.volatility,
  };
}

export function scanSetups(
  left: HtfBiasRead,
  right: HtfBiasRead,
  clock: SessionClock,
  divergence?: Parameters<typeof smtRead>[2],
  leftBars?: OhlcBar[],
  rightBars?: OhlcBar[],
): ScanResult {
  const floor = APLUS_RULES.confluenceFloor;
  const smt = smtRead(left, right, divergence);
  const blocked: string[] = [];
  if (!clock.isWeekday) blocked.push("Weekend — plan only, no session entries");
  if (!clock.inTradeWindow)
    blocked.push(`Outside trade window (${clock.killzoneLabel})`);

  const barsL = leftBars ?? [];
  const barsR = rightBars ?? [];
  const condL = assessConditions(barsL);
  const condR = assessConditions(barsR);
  if (!condL.tradeable)
    blocked.push(`${left.symbol}: ${condL.reasons[0] ?? "conditions gate"}`);
  if (!condR.tradeable)
    blocked.push(`${right.symbol}: ${condR.reasons[0] ?? "conditions gate"}`);

  const detL = summarizeDetectors(barsL);
  const detR = summarizeDetectors(barsR);

  const candidates: SetupCandidate[] = [];
  for (const [read, det, bars, cond] of [
    [left, detL, barsL, condL] as const,
    [right, detR, barsR, condR] as const,
  ]) {
    candidates.push(scoreDirection("bull", read, det, bars, cond, clock, smt));
    candidates.push(scoreDirection("bear", read, det, bars, cond, clock, smt));
  }

  for (const c of candidates) {
    const read = c.symbol === left.symbol ? left : right;
    const need = c.side === "long" ? "bull" : "bear";
    if (read.topDown !== need) {
      c.htfOk = false;
      c.actionable = false;
      if (!c.missing.includes("HTF top-down gate")) {
        c.missing.unshift("HTF top-down gate");
      }
    }
  }

  // Profit path: incomplete-pattern veto + calibration floor (0.65) for action
  const pathCandidates = candidates.map(applyProfitPathToCandidate);
  pathCandidates.sort((a, b) => b.confluence - a.confluence);

  const best = pathCandidates[0];
  let focus = "Stand down — no setup clears engine-aligned gates.";
  if (best && best.actionable) {
    focus = `Focus: ${best.symbol} ${best.side.toUpperCase()} [${best.strategyPrimary || "model"}] (${best.grade}, ${best.confluence.toFixed(2)}). ${best.strategyWhy[0] ?? best.reasons[0] ?? ""}`;
  } else if (best && best.grade !== "skip") {
    focus = `Nearest: ${best.symbol} ${best.side} [${best.strategyPrimary || "—"}] @ ${best.confluence.toFixed(2)} (${best.grade}) — missing: ${best.missing.slice(0, 3).join(", ")}`;
  } else if (blocked.length) {
    focus = blocked[0]!;
  }

  return {
    floor,
    aPlus: APLUS_RULES.aPlusThreshold,
    candidates: pathCandidates.slice(0, 8),
    blocked,
    focus,
    smt,
    conditions: { left: condL, right: condR },
    catalog: [...ALWAYS_SCAN],
  };
}
