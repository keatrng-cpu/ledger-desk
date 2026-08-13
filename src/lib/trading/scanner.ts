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
import {
  buildImpulseLeg,
  readOte,
  inOte,
  oteZoneOverlap,
  consequentEncroachment,
} from "./fib";
import { biasDisrespect } from "./htf-invalidation";
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
import {
  drawOnLiquidity,
  drawTargetsForSide,
  type LiquidityTarget,
} from "./draw";
import {
  gradeAllStrategies,
  structureLayerScore,
  type StrategyMarketGrade,
} from "./strategy-grade";

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
  /**
   * True when this candidate trades AGAINST the HTF read and the gate
   * released because the bias was disrespected + distributed
   * (htf-invalidation.ts). A counter-bias trade must never be
   * indistinguishable from a with-bias one — sizing and review both care.
   */
  htfDisrespected?: boolean;
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
  strategyBoard?: StrategyMarketGrade[];
  structureScore?: number;
  /**
   * The specific liquidity level this setup is drawn toward, with the
   * empirical reach rate measured across past sessions (trading/draw.ts).
   * Null when nothing in the trade's direction is a viable magnet.
   */
  draw?: LiquidityTarget | null;
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
  /**
   * Which book this read is. SMT is a statement about ONE symbol relative to
   * the other — the divergence credits the symbol that HELD, not both — so
   * scoring it correctly requires knowing which side we are scoring.
   */
  book: "left" | "right",
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
  // `complete` already implies the sequence is alive (detectors.ts A2:
  // complete === legsComplete && alive), so an expired or invalidated model
  // can no longer light the engine's highest-weight component.
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

  /**
   * SMT divergence — typed, not regex-matched on prose.
   *
   * WHAT WAS WRONG: this used to build a lowercase blob of `state + note` and
   * regex it. The bull pattern and the bear pattern BOTH contained `relat`,
   * and `smtRead` returns the states `relative_strength` / `relative_weakness`
   * — so on any relative-performance read the component fired for LONG and
   * SHORT simultaneously, inflating both sides of the same book at once.
   *
   * WHAT IT MEANS NOW, per the ICT definition: SMT is a DIVERGENCE — one
   * index makes the extreme and the correlated one fails to confirm. Only
   * `bullish_smt` / `bearish_smt` are that. `relative_strength` and
   * `relative_weakness` are relative performance, a different (weaker) fact,
   * and crediting them as SMT was inflating confluence with something the
   * framework does not count. They no longer fire this component.
   *
   * And the credit goes to ONE book: `smt.edge` names the side that HELD
   * (the tradeable one). The book that swept does not get the confluence.
   */
  const smtDirectional =
    smt.state === "bullish_smt"
      ? "bull"
      : smt.state === "bearish_smt"
        ? "bear"
        : null;
  const smtHits = smtDirectional === direction && smt.edge === book;
  add("smt", smtHits, smtHits ? `smt: ${smt.state} (holds ${read.symbol})` : undefined);

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
  // A sweep only counts from the mechanical model while that sequence is
  // still ALIVE (detectors.ts A2). Before liveness existed, a sweep whose
  // sequence had been dead for hundreds of bars kept lighting this component.
  const sig =
    sideSweep.some((l) => sigSweepKinds(l.label)) ||
    detSweepOk ||
    (det.mechanical.alive &&
      det.mechanical.sweep != null &&
      mechDir === direction);
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

  /**
   * OTE — Optimal Trade Entry (trading/fib.ts).
   *
   * The leg is anchored on the SWEEP's wick extreme when one exists, which
   * is the ICT construction: the raid makes the extreme, the displacement
   * away from it defines the leg, and you buy/sell the 61.8%-79%
   * retracement back into it. Anchoring on the sweep (rather than the
   * window's own extreme) is what makes this a post-manipulation entry
   * rather than a generic pullback measurement.
   *
   * Until 2026-08-13 this component did not exist in any form — the desk
   * named OTE in its rules and strategy copy while computing nothing. The
   * cost showed up the same day: an open that manipulated into equilibrium
   * and a gap then reversed to the highs had no OTE read to price the
   * reversal entry with.
   */
  const sweepAnchor =
    det.sweep.latest &&
    ((direction === "bull" && det.sweep.latest.side === "sellside") ||
      (direction === "bear" && det.sweep.latest.side === "buyside"))
      ? det.sweep.latest
      : null;
  const impulseLeg = buildImpulseLeg(bars, direction, {
    originPrice: sweepAnchor?.wickExtreme,
    originIndex: sweepAnchor?.index,
  });
  const oteRead = readOte(impulseLeg);
  const lastClose = bars.length ? bars[bars.length - 1]!.c : Number.NaN;
  const oteHit = inOte(oteRead, lastClose);
  add(
    "ote",
    oteHit,
    oteHit && oteRead
      ? `ote ${oteRead.zoneLow.toFixed(2)}–${oteRead.zoneHigh.toFixed(2)} (opt ${oteRead.optimal.toFixed(2)})`
      : undefined,
  );

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

  // Component bag is raw market truth. Score is NOT sum-of-all-strategies.
  // 1) SMC/ICT structure layer  2) each model graded alone  3) best model wins
  const htfOk = read.topDown === direction;
  const killzoneOk = clock.inTradeWindow;
  const conditionsOk = conditions.tradeable;

  const structureScore = structureLayerScore(present);
  const strategyBoard = gradeAllStrategies(present, {
    htfOk,
    killzoneOk,
    conditionsOk,
  });
  const bestModel = strategyBoard[0]!;
  const score = bestModel.fit;

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
  const primary = String(bestModel.id || primaryTag(matches));
  const stratIds = strategyBoard
    .filter((b) => b.fit >= 0.35 || b.complete)
    .map((b) => b.id as import("./strategies").StrategyId);

  const g = grade(score, APLUS_RULES.confluenceFloor);

  const hasEntryModel =
    present.includes("ifvg") || present.includes("order_block");
  const hasSweep =
    present.includes("sweep_significant") ||
    present.includes("mechanical_model");
  const actionable =
    g !== "skip" &&
    htfOk &&
    killzoneOk &&
    clock.isWeekday &&
    conditionsOk &&
    bestModel.complete &&
    (hasEntryModel || present.includes("mechanical_model")) &&
    (hasSweep || present.includes("structure") || present.includes("mss")) &&
    score >= APLUS_RULES.confluenceFloor - 0.05;

  const titleParts = [
    bestModel.label ||
      (primary ? strategyLabel(primary as never) : "Unclassified"),
  ];

  /**
   * Entry price, in ICT construction order — most specific first.
   *
   * 1. OTE x array overlap. Two independent reasons agreeing on one price is
   *    the highest-quality entry there is, so when the retracement band and
   *    the FVG/OB intersect, that intersection IS the entry.
   * 2. Consequent Encroachment — the 50% of the gap, not its edges. ICT
   *    prices an FVG at CE; quoting the whole gap (as this did) makes the
   *    planned 1R depend on which edge you happened to fill at, which is why
   *    the same setup could book materially different R.
   * 3. The OTE band alone, when there is no array to intersect with.
   * 4. Dealing-range half — the old coarse fallback, unchanged.
   */
  const zone = ifvg.zone;
  const overlap = zone ? oteZoneOverlap(oteRead, zone.top, zone.bottom) : null;
  const entryZone = overlap
    ? `${overlap.low.toFixed(2)} – ${overlap.high.toFixed(2)} (OTE×array, CE ${overlap.mid.toFixed(2)})`
    : zone
      ? `${zone.bottom.toFixed(2)} – ${zone.top.toFixed(2)} (CE ${consequentEncroachment(zone.top, zone.bottom).toFixed(2)})`
      : oteRead
        ? `${oteRead.zoneLow.toFixed(2)} – ${oteRead.zoneHigh.toFixed(2)} (OTE, opt ${oteRead.optimal.toFixed(2)})`
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
      `smc structure Q ${structureScore.toFixed(2)}`,
      `best model: ${bestModel.label} fit ${bestModel.fit.toFixed(2)} (alone)`,
      ...strategyBoard.slice(0, 4).map(
        (b) =>
          `${b.label}: fit ${b.fit.toFixed(2)}${b.complete ? " ✓" : " · " + b.missing.slice(0, 2).join(",")}`,
      ),
      ...reasons.slice(0, 8),
    ],
    missing: [
      ...(bestModel.complete
        ? []
        : bestModel.missing.map((m) => `${bestModel.label}:${m}`)),
      ...missing
        .filter((m) => !present.includes(m as ComponentKey))
        .slice(0, 8),
    ],
    components: present,
    strategies: stratIds,
    strategyPrimary: primary,
    strategyWhy: [
      bestModel.structureNote,
      bestModel.note,
      ...matches.flatMap((m) => m.reasons).slice(0, 4),
    ],
    strategyBoard,
    structureScore,
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

/**
 * Everything a caller can vary. Bars are OPTIONAL only so that a caller with
 * genuinely no series can still get structure-only scoring — but note what
 * omitting them costs: `summarizeDetectors([])` returns nothing,
 * `assessConditions([])` gates on nothing, and the draw engine is skipped
 * (needs ≥30 bars). Pass the bars.
 */
export interface ScoreCandidatesOptions {
  /** Timestamp-aligned swing divergence (structure.ts `smtDivergence`). */
  divergence?: Parameters<typeof smtRead>[2];
  leftBars?: OhlcBar[];
  rightBars?: OhlcBar[];
}

/**
 * THE scorer. Phase A3: live, replay, backtest and the paper loop all reach
 * the market through this one function, so a component added here cannot be
 * present in one context and missing in another. Callers differ only in what
 * they PASS, never in how it is scored.
 *
 * `scanSetups` below is the positional-argument façade kept for existing
 * callers; it does nothing but forward here.
 */
export function scoreCandidates(
  left: HtfBiasRead,
  right: HtfBiasRead,
  clock: SessionClock,
  opts: ScoreCandidatesOptions = {},
): ScanResult {
  const { divergence, leftBars, rightBars } = opts;
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
  for (const [read, det, bars, cond, book] of [
    [left, detL, barsL, condL, "left"] as const,
    [right, detR, barsR, condR, "right"] as const,
  ]) {
    candidates.push(scoreDirection("bull", read, det, bars, cond, clock, smt, book));
    candidates.push(scoreDirection("bear", read, det, bars, cond, clock, smt, book));
  }

  /**
   * HTF top-down gate — absolute UNTIL the bias is disrespected.
   *
   * The gate stays absolute in the normal case. What changed on 2026-08-13
   * is that it now has the release path the trading model always specified:
   * a bias holds until price sweeps liquidity, displaces against it, breaks
   * structure and drags both lower timeframes with it. At that point the
   * old read is spent, and gating on it blocks the correct side of a
   * reversal for the entire move (which is exactly what happened that day).
   *
   * The release requires the FULL signature (htf-invalidation.ts) — never a
   * partial one — and is recorded on the candidate rather than applied
   * silently, so a counter-bias trade is always visibly a counter-bias
   * trade.
   */
  for (const c of candidates) {
    const read = c.symbol === left.symbol ? left : right;
    const det = c.symbol === left.symbol ? detL : detR;
    const bars = c.symbol === left.symbol ? barsL : barsR;
    const need = c.side === "long" ? "bull" : "bear";
    if (read.topDown === need) continue;

    const disrespect = biasDisrespect(read, det, need, bars.length);
    if (disrespect.disrespected) {
      // Bias invalidated: the gate releases, and says so on the record.
      c.htfDisrespected = true;
      c.reasons.push(disrespect.reason);
      continue;
    }
    c.htfOk = false;
    c.actionable = false;
    if (!c.missing.includes("HTF top-down gate")) {
      c.missing.unshift("HTF top-down gate");
    }
  }

  // Draw on liquidity — WHICH level price is empirically likely to reach,
  // from the distribution of remaining excursion across past sessions plus
  // current distance / liquidity magnitude / HTF alignment (trading/draw.ts).
  // Attached AFTER scoring so it enriches targets without perturbing the
  // engine-ported component weights.
  const drawByBook = new Map<string, ReturnType<typeof drawOnLiquidity>>();
  if (barsL.length >= 30) drawByBook.set(left.symbol, drawOnLiquidity(left, barsL));
  if (barsR.length >= 30) drawByBook.set(right.symbol, drawOnLiquidity(right, barsR));

  for (const c of candidates) {
    const draw = drawByBook.get(c.symbol);
    if (!draw) continue;
    const inDirection = drawTargetsForSide(draw, c.side);
    if (!inDirection.length) {
      c.draw = null;
      c.missing.push("no liquidity draw in trade direction");
      continue;
    }
    // Highest-scoring reachable magnet, not merely the nearest level.
    const primary = [...inDirection].sort((a, b) => b.score - a.score)[0]!;
    c.draw = primary;
    c.targets = inDirection
      .slice(0, 3)
      .map(
        (t) =>
          `${t.name} ${t.price.toFixed(2)} · ${(t.reachProbability * 100).toFixed(0)}%`,
      );
    c.reasons.push(
      `Draw: ${primary.name} ${primary.price.toFixed(2)} (${(primary.reachProbability * 100).toFixed(0)}% base rate, ${primary.distanceAtr.toFixed(2)} ATR)`,
    );
    if (primary.reachProbability < 0.5) {
      c.missing.push(
        `strong draw (best ${primary.name} only ${(primary.reachProbability * 100).toFixed(0)}%)`,
      );
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

/**
 * Positional façade over `scoreCandidates` — the historical signature used by
 * `build-desk.ts` and `session-backtest.ts`. Kept so those callers are
 * untouched; there is no second implementation behind it.
 */
export function scanSetups(
  left: HtfBiasRead,
  right: HtfBiasRead,
  clock: SessionClock,
  divergence?: Parameters<typeof smtRead>[2],
  leftBars?: OhlcBar[],
  rightBars?: OhlcBar[],
): ScanResult {
  return scoreCandidates(left, right, clock, {
    divergence,
    leftBars,
    rightBars,
  });
}
