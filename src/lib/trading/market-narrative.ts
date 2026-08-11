/**
 * Market narrative engine — liquidity, draw-on-liquidity (DOL), and entry models.
 *
 * Research-backed ICT/SMC sequences (deterministic, no LLM):
 * - Sweep is SETUP, never entry
 * - Confirmation = displacement + MSS/CISD after sweep
 * - Entry = retest of FVG / IFVG / OB after confirmation
 * - Continuation vs reversal from HTF bias + which liquidity was taken
 * - DOL = next unmitigated opposing liquidity (BSL/SSL, PDH/PDL, EQ)
 *
 * Each strategy maps to a preferred narrative class; graded alone (see strategy-grade).
 */

import type { OhlcBar } from "@/lib/market/types";
import type { DetectorSummary } from "./detectors";
import type { HtfBiasRead } from "./structure";
import type { SessionClock } from "./sessions";
import type { StrategyId } from "./strategies";

export type NarrativeClass =
  | "continuation"
  | "reversal"
  | "range_chop"
  | "indeterminate";

export type EntryModel =
  | "fvg_retest"
  | "ifvg_retest"
  | "ob_retest"
  | "mechanical_retest"
  | "none";

export type ConfirmationState =
  | "none"
  | "sweep_only"
  | "sweep_displace"
  | "confirmed"
  | "armed_entry";

export type LiquiditySide = "bsl" | "ssl" | "none";

export interface LiquidityMap {
  bsl: { label: string; price: number; swept: boolean }[];
  ssl: { label: string; price: number; swept: boolean }[];
  nearestBsl: number | null;
  nearestSsl: number | null;
  lastSweep: LiquiditySide;
  lastSweepLabel: string | null;
}

export interface DrawOnLiquidity {
  direction: "bull" | "bear" | "neutral";
  target: string;
  targetPrice: number | null;
  reason: string;
  confidence: number;
}

export interface MarketNarrative {
  class: NarrativeClass;
  confirmation: ConfirmationState;
  entryModel: EntryModel;
  liquidity: LiquidityMap;
  dol: DrawOnLiquidity;
  sequence: string[];
  waitFor: string[];
  thesis: string;
  preferredStrategies: StrategyId[];
  rules: string[];
  killzoneOk: boolean;
  htfBias: "bull" | "bear" | "neutral";
  dealingZone: string | null;
}

const RULES = [
  "Never enter on the liquidity sweep itself — sweep = setup only.",
  "Confirmation = displacement + MSS/CISD after the sweep (intent proven).",
  "Entry = retest of FVG / IFVG / order block after confirmation.",
  "Continuation: HTF bias held, internal liquidity taken, enter pullback into discount (long) / premium (short).",
  "Reversal: external liquidity swept against prior leg, then MSS + IFVG retest.",
  "DOL (draw on liquidity): target opposing unmitigated BSL/SSL or PDH/PDL.",
  "IFVG = FVG inverted by displacement close-through after sweep — enter on retest.",
  "Mechanical: sweep → displace → invert → retest (ordered sequence).",
  "Judas: session open sweep of liquidity, then reverse with array retest.",
  "SMT: relative strength/weakness across indices — companion entry model required.",
];

function buildLiquidityMap(
  read: HtfBiasRead,
  det: DetectorSummary,
): LiquidityMap {
  const bsl: LiquidityMap["bsl"] = [];
  const ssl: LiquidityMap["ssl"] = [];

  for (const l of read.liquidity || []) {
    const item = {
      label: l.label,
      price: l.price,
      swept: Boolean(l.swept),
    };
    if (l.side === "buyside") bsl.push(item);
    else if (l.side === "sellside") ssl.push(item);
  }

  if (read.pdh != null) {
    bsl.push({
      label: "PDH",
      price: read.pdh,
      swept:
        read.liquidity?.some(
          (x) => x.label?.toLowerCase().includes("pdh") && x.swept,
        ) ?? false,
    });
  }
  if (read.pdl != null) {
    ssl.push({
      label: "PDL",
      price: read.pdl,
      swept:
        read.liquidity?.some(
          (x) => x.label?.toLowerCase().includes("pdl") && x.swept,
        ) ?? false,
    });
  }

  if (read.dealing) {
    bsl.push({
      label: "DR high",
      price: read.dealing.high,
      swept: false,
    });
    ssl.push({
      label: "DR low",
      price: read.dealing.low,
      swept: false,
    });
  }

  const last = det.sweep.latest;
  let lastSweep: LiquiditySide = "none";
  let lastSweepLabel: string | null = null;
  if (last) {
    lastSweep = last.side === "buyside" ? "bsl" : "ssl";
    lastSweepLabel = `${last.side} sweep`;
  } else {
    const sweptB = bsl.find((x) => x.swept);
    const sweptS = ssl.find((x) => x.swept);
    if (sweptB) {
      lastSweep = "bsl";
      lastSweepLabel = sweptB.label;
    } else if (sweptS) {
      lastSweep = "ssl";
      lastSweepLabel = sweptS.label;
    }
  }

  const unsweptB = bsl
    .filter((x) => !x.swept)
    .sort((a, b) => a.price - b.price);
  const unsweptS = ssl
    .filter((x) => !x.swept)
    .sort((a, b) => b.price - a.price);

  return {
    bsl,
    ssl,
    nearestBsl: unsweptB[0]?.price ?? null,
    nearestSsl: unsweptS[0]?.price ?? null,
    lastSweep,
    lastSweepLabel,
  };
}

function drawOnLiquidity(
  read: HtfBiasRead,
  liq: LiquidityMap,
  narrativeClass: NarrativeClass,
): DrawOnLiquidity {
  const htf = read.topDown;
  if (
    liq.lastSweep === "ssl" &&
    (htf === "bull" || narrativeClass === "reversal")
  ) {
    return {
      direction: "bull",
      target:
        liq.nearestBsl != null
          ? `BSL ${liq.nearestBsl.toFixed(2)}`
          : "Buy-side liquidity / PDH",
      targetPrice: liq.nearestBsl ?? read.pdh ?? null,
      reason:
        "SSL swept — smart money typically delivers toward buy-side (DOL up)",
      confidence: htf === "bull" ? 0.75 : 0.55,
    };
  }
  if (
    liq.lastSweep === "bsl" &&
    (htf === "bear" || narrativeClass === "reversal")
  ) {
    return {
      direction: "bear",
      target:
        liq.nearestSsl != null
          ? `SSL ${liq.nearestSsl.toFixed(2)}`
          : "Sell-side liquidity / PDL",
      targetPrice: liq.nearestSsl ?? read.pdl ?? null,
      reason:
        "BSL swept — smart money typically delivers toward sell-side (DOL down)",
      confidence: htf === "bear" ? 0.75 : 0.55,
    };
  }
  if (htf === "bull") {
    return {
      direction: "bull",
      target:
        liq.nearestBsl != null
          ? `BSL ${liq.nearestBsl.toFixed(2)}`
          : "PDH / external buyside",
      targetPrice: liq.nearestBsl ?? read.pdh ?? null,
      reason: "HTF bull — draw on buy-side liquidity / premium arrays",
      confidence: 0.5,
    };
  }
  if (htf === "bear") {
    return {
      direction: "bear",
      target:
        liq.nearestSsl != null
          ? `SSL ${liq.nearestSsl.toFixed(2)}`
          : "PDL / external sellside",
      targetPrice: liq.nearestSsl ?? read.pdl ?? null,
      reason: "HTF bear — draw on sell-side liquidity / discount arrays",
      confidence: 0.5,
    };
  }
  return {
    direction: "neutral",
    target: "Wait for sweep of clear BSL or SSL",
    targetPrice: null,
    reason: "No absolute HTF + no clear sweep — no DOL edge",
    confidence: 0.2,
  };
}

function confirmationState(
  det: DetectorSummary,
  direction: "bull" | "bear",
  liq: LiquidityMap,
): ConfirmationState {
  const sweepOk =
    liq.lastSweep !== "none" ||
    (det.sweep.latest != null &&
      ((direction === "bull" && det.sweep.latest.side === "sellside") ||
        (direction === "bear" && det.sweep.latest.side === "buyside")));

  const disp =
    det.displacement.latest != null &&
    det.displacement.latest.direction === direction;

  const mech =
    det.mechanical.complete &&
    det.mechanical.state === "complete" &&
    ((direction === "bull" && det.mechanical.direction === "long") ||
      (direction === "bear" && det.mechanical.direction === "short"));

  const shift = disp || mech;

  const hasArray =
    det.fvg.count > 0 ||
    det.fvg.open > 0 ||
    det.fvg.inverted > 0 ||
    det.orderBlock.latest != null ||
    det.mechanical.complete;

  if (!sweepOk && !shift) return "none";
  if (sweepOk && !shift) return "sweep_only";
  if (sweepOk && shift && !hasArray) return "sweep_displace";
  if (sweepOk && shift && hasArray) return "armed_entry";
  if (shift && hasArray) return "confirmed";
  return "sweep_displace";
}

function entryModel(
  det: DetectorSummary,
  direction: "bull" | "bear",
  conf: ConfirmationState,
): EntryModel {
  if (conf !== "armed_entry" && conf !== "confirmed") return "none";
  if (
    det.mechanical.complete &&
    det.mechanical.state === "complete" &&
    ((direction === "bull" && det.mechanical.direction === "long") ||
      (direction === "bear" && det.mechanical.direction === "short"))
  ) {
    return "mechanical_retest";
  }
  if (det.fvg.inverted > 0) return "ifvg_retest";
  if (det.fvg.open > 0 || det.fvg.count > 0) return "fvg_retest";
  if (det.orderBlock.latest) return "ob_retest";
  return "none";
}

function classifyNarrative(
  read: HtfBiasRead,
  liq: LiquidityMap,
  direction: "bull" | "bear",
): NarrativeClass {
  if (read.topDown === "neutral" && read.mid === "neutral") return "range_chop";

  const sweepAgainstBull =
    liq.lastSweep === "ssl" && direction === "bull";
  const sweepAgainstBear =
    liq.lastSweep === "bsl" && direction === "bear";

  if (sweepAgainstBull || sweepAgainstBear) {
    if (read.topDown === direction || read.mid === direction) {
      return "continuation";
    }
    return "reversal";
  }

  if (read.topDown === direction || read.mid === direction) {
    return "continuation";
  }
  if (read.topDown !== "neutral" && read.topDown !== direction) {
    return "reversal";
  }
  return "indeterminate";
}

function preferredFor(
  cls: NarrativeClass,
  entry: EntryModel,
): StrategyId[] {
  if (cls === "continuation") {
    return entry === "mechanical_retest"
      ? ["mechanical", "continuation", "tjr"]
      : ["continuation", "tjr", "ronan", "mechanical"];
  }
  if (cls === "reversal") {
    return entry === "ifvg_retest"
      ? ["tjr", "judas", "blake_mech", "pdi"]
      : ["judas", "tjr", "blake_mech", "patty"];
  }
  return ["smt", "ronan"];
}

export function buildMarketNarrative(
  read: HtfBiasRead,
  det: DetectorSummary,
  clock: SessionClock,
  direction: "bull" | "bear",
  _bars?: OhlcBar[],
): MarketNarrative {
  const liquidity = buildLiquidityMap(read, det);
  const cls = classifyNarrative(read, liquidity, direction);
  const conf = confirmationState(det, direction, liquidity);
  const entry = entryModel(det, direction, conf);
  const dol = drawOnLiquidity(read, liquidity, cls);

  const sequence: string[] = [];
  const waitFor: string[] = [];

  if (liquidity.lastSweep !== "none") {
    sequence.push(
      `1. Liquidity: ${liquidity.lastSweepLabel ?? liquidity.lastSweep} taken (setup only — not entry)`,
    );
  } else {
    sequence.push("1. Liquidity: waiting for BSL or SSL sweep");
    waitFor.push("Clear buy-side or sell-side liquidity sweep");
  }

  const disp = det.displacement.latest;
  if (disp && disp.direction === direction) {
    sequence.push(
      `2. Displacement ${disp.direction} — institutional delivery / intent`,
    );
  } else {
    sequence.push("2. Displacement: not confirmed in trade direction");
    if (liquidity.lastSweep !== "none") {
      waitFor.push("Displacement candle in expected direction after sweep");
    }
  }

  if (conf === "armed_entry" || conf === "confirmed") {
    sequence.push(
      "3. Confirmation: MSS/CISD or mechanical shift — intent proven",
    );
  } else if (conf === "sweep_displace") {
    sequence.push("3. Confirmation: partial — need structure shift / array");
    waitFor.push("MSS/CISD or mechanical completion");
  } else {
    sequence.push("3. Confirmation: incomplete");
  }

  if (entry !== "none") {
    sequence.push(
      `4. Entry model armed: ${entry.replace(/_/g, " ")} — wait for retest, not chase`,
    );
  } else {
    sequence.push("4. Entry model: no array yet (FVG/IFVG/OB)");
    waitFor.push("FVG, IFVG, or order block for retest entry");
  }

  sequence.push(`5. DOL: ${dol.direction} → ${dol.target} (${dol.reason})`);

  let thesis: string;
  if (cls === "continuation") {
    thesis = `Continuation ${direction}: HTF/mid aligned — seek pullback entries in ${
      direction === "bull" ? "discount" : "premium"
    } after liquidity grab, target ${dol.target}.`;
  } else if (cls === "reversal") {
    thesis = `Reversal sequence ${direction}: external/session liquidity swept, wait for displacement + MSS, enter IFVG/FVG retest, DOL ${dol.target}.`;
  } else if (cls === "range_chop") {
    thesis =
      "Range/chop — no absolute HTF. Prefer stand down or SMT-only journal until expansion.";
    waitFor.push("HTF bias or clean external sweep + displacement");
  } else {
    thesis = "Indeterminate narrative — map liquidity and wait.";
  }

  if (conf === "sweep_only") {
    waitFor.push("Do NOT enter on sweep — wait confirmation");
  }

  return {
    class: cls,
    confirmation: conf,
    entryModel: entry,
    liquidity,
    dol,
    sequence,
    waitFor: [...new Set(waitFor)],
    thesis,
    preferredStrategies: preferredFor(cls, entry),
    rules: RULES,
    killzoneOk: clock.inTradeWindow,
    htfBias: read.topDown,
    dealingZone: read.dealing?.zone ?? null,
  };
}

export function dualNarrativeSummary(
  left: MarketNarrative,
  right: MarketNarrative,
): string {
  return [
    `L ${left.class}/${left.confirmation}/${left.entryModel}`,
    `R ${right.class}/${right.confirmation}/${right.entryModel}`,
    `DOL L→${left.dol.target}`,
    `DOL R→${right.dol.target}`,
  ].join(" · ");
}

export function narrativeCoachLines(n: MarketNarrative): string[] {
  const lines = [n.thesis, ...n.sequence];
  if (n.waitFor.length) {
    lines.push(`Wait: ${n.waitFor.slice(0, 3).join("; ")}`);
  }
  if (n.confirmation === "armed_entry") {
    lines.push(
      "ARMED — only take on array retest with stop beyond sweep extreme / protected swing.",
    );
  } else if (n.confirmation === "sweep_only") {
    lines.push("STAND DOWN entry — sweep without confirmation is a trap.");
  }
  return lines;
}
