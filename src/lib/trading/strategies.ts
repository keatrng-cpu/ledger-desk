/**
 * Named strategy classifiers — port of Trading-Automation `strategy/strategies.py`.
 * Always evaluated on every scored candidate. LLM never decides tags.
 */

import { SCORE_KEYS, type ComponentKey } from "./engine-weights";
// One definition of each model's hours and required pool. smc-canon.ts imports
// only the TYPE `StrategyId` back from here, so this is not a runtime cycle.
import { modelMayBeNamed } from "./smc-canon";

export type StrategyId =
  | "tjr"
  | "mechanical"
  | "blake_mech"
  | "judas"
  | "pdi"
  | "continuation"
  | "patty"
  | "ronan"
  | "silver_bullet"
  | "smt";

export const ALWAYS_SCAN: StrategyId[] = [
  "mechanical",
  "tjr",
  "judas",
  "pdi",
  "patty",
  "continuation",
  "blake_mech",
  "ronan",
  // ITEM 24: a named model so 10:00–11:00 stops being "just NY AM" that a
  // Patty or a continuation can take. Window-gated in gradeAllStrategies.
  "silver_bullet",
  // "smt" is NOT scanned as a model (trader's call 2026-10-02): SMT forms the
  // timeframe bias and scores only as a component, only at a major level or
  // HTF array (smt-level.ts). As a standalone model, "SMT + any array" made a
  // mid-range divergence a complete strategy that could title a card.
];

/**
 * Which market story each model is built for.
 * Graded alone — never stacked for a higher confluence score.
 */
export const STRATEGY_NARRATIVE: Record<
  StrategyId,
  { story: "continuation" | "reversal" | "either"; entry: string; liquidity: string; school: string; confirm: string }
> = {
  mechanical: {
    story: "either",
    entry: "The body close through the pre-raid gap after sweep→displace. The close is the entry; a retest is a note.",
    liquidity: "Significant sweep starts the sequence",
    school: "Blake Mech",
    confirm: "Inversion + unfilled FVG after hunt",
  },
  tjr: {
    story: "either",
    entry: "IFVG/FVG retest after significant sweep + structure",
    liquidity: "HTF sweep first (1H/4H, PDH/PDL, EQH/EQL) — non-negotiable",
    school: "TJR",
    confirm: "5m BOS or IFVG or 79% close or SMT — then retrace, never chase",
  },
  judas: {
    story: "reversal",
    entry: "Session open sweep reverse into array retest",
    liquidity: "Judas swing grabs session SSL/BSL then reverses (AMD manipulate)",
    school: "ICT",
    confirm: "Displacement + MSS after the raid into premium/discount array",
  },
  pdi: {
    story: "reversal",
    entry: "CISD/displacement into IFVG",
    liquidity: "Sweep + change in state of delivery",
    school: "Blake / PDI",
    confirm: "Inverted FVG after significant sweep",
  },
  patty: {
    story: "continuation",
    entry: "5m confirmation at a 1H/4H gap — the touch is not the trade",
    liquidity: "Nearest significant liquidity after the higher-timeframe gap",
    school: "Patty",
    confirm: "HTF gap, then a 5m gap or shift. Objective met, day done.",
  },
  silver_bullet: {
    story: "reversal",
    entry: "The raid of the 09:30–10:00 range, then the displacement away from it",
    liquidity: "The OPENING range's own high/low — not the overnight range, which is Judas's pool",
    school: "ICT",
    confirm: "or_raid of the 09:30–10:00 dealing range + displacement, 10:00–11:00 ET. Full size.",
  },
  continuation: {
    story: "continuation",
    entry: "Pullback IFVG with mid bias held",
    liquidity: "IRL taken; DOL toward ERL",
    school: "SMC",
    confirm: "With-trend MSS + array in discount (long) / premium (short)",
  },
  blake_mech: {
    story: "either",
    entry: "IFVG + structure/CISD + displacement",
    liquidity: "Sweep preferred but structure path allowed (ATH continuation)",
    school: "Blake Mech",
    confirm: "Inversion of FVG after hunt",
  },
  ronan: {
    story: "continuation",
    entry: "Bias-aligned array with multi-TF agreement",
    liquidity: "HTF unfilled FVG / inefficiency + DOL",
    school: "Ronan (PB coach)",
    confirm: "HTF narrative first, then LTF structure/CISD/disp",
  },
  smt: {
    story: "either",
    entry: "Relative strength — needs separate entry model",
    liquidity: "Divergence at liquidity pools across indices (ES vs NQ)",
    school: "ICT / all",
    confirm: "Companion (TJR/mech/IFVG) required — SMT alone is not a take",
  },
};

export interface StrategyMatch {
  strategy: StrategyId;
  reasons: string[];
}

export interface ClassifyInput {
  direction: "bull" | "bear";
  killzone: string;
  /** Components that fired (keys from SCORE_KEYS). */
  components: string[];
  topDown: "bull" | "bear" | "neutral";
  mid: "bull" | "bear" | "neutral";
  daily: "bull" | "bear" | "neutral";
  openingBias: "bull" | "bear" | "neutral" | null;
  weeklyPd: "bull" | "bear" | "neutral" | null;
  ifvgInverted: boolean;
  significantSweep: boolean;
  /** Minutes after midnight ET. Judas is only 09:30–09:45. */
  etMin?: number | null;
}

function componentsOf(reasons: string[]): Set<string> {
  return new Set(reasons.filter((r) => SCORE_KEYS.has(r)));
}

export function classify(input: ClassifyInput): StrategyMatch[] {
  const comps = componentsOf(input.components);
  const matches: StrategyMatch[] = [];

  const mechanical = comps.has("mechanical_model");
  const structure = comps.has("structure");
  const mss = comps.has("mss");
  const ifvg = comps.has("ifvg");
  const cisd = comps.has("cisd");
  const disp = comps.has("displacement");
  const mid = comps.has("mid_bias");
  const daily = comps.has("daily_bias");
  const openB = comps.has("opening_bias");
  const sig = comps.has("sweep_significant") || input.significantSweep;
  const inverted = input.ifvgInverted;
  const smt = comps.has("smt");
  const dir = input.direction;

  if (mechanical) {
    matches.push({
      strategy: "mechanical",
      reasons: ["ordered sweep→displace→body close through the pre-raid gap"],
    });
  }

  // Blake is the body-close inversion after the sweep. The wick back into
  // the gap is the mechanical retest, a different fill, and it does not
  // wear Blake's name.
  if (!mechanical && sig && cisd && ifvg && inverted) {
    matches.push({
      strategy: "blake_mech",
      reasons: ["blake: sweep, then the body-close inversion. Not the wick retest."],
    });
  }

  if ((structure || mss) && ifvg && sig) {
    matches.push({
      strategy: "tjr",
      reasons: ["tjr: significant sweep + structure/MSS + IFVG retrace"],
    });
  } else if (mechanical && (structure || mss)) {
    matches.push({
      strategy: "tjr",
      reasons: ["tjr: mechanical path with structure shift"],
    });
  }

  const judasShift = structure || mss || cisd;
  const judasBias = openB || daily || input.daily === dir;
  // Same hours and the same pool requirement as everything else that reads
  // MODEL_REQUIREMENTS — the 09:30/09:45 literals used to live here as well.
  const judasName = modelMayBeNamed("judas", {
    etMin: input.etMin ?? null,
    components: input.components,
  });
  if (sig && judasShift && judasBias && ifvg && judasName.ok) {
    matches.push({ strategy: "judas", reasons: ["judas: 09:30–09:45 raid, then the failure"] });
  }

  if (ifvg && inverted && sig && (structure || cisd || mss)) {
    matches.push({
      strategy: "pdi",
      reasons: ["pdi: inverted FVG after significant sweep (pre-distribution)"],
    });
  } else if (ifvg && sig && cisd && !mechanical) {
    matches.push({
      strategy: "pdi",
      reasons: ["pdi: sweep + CISD + IFVG (distribution trigger proxy)"],
    });
  }

  /**
   * ITEM 14 — PATTY IS A HIGHER-TIMEFRAME GAP.
   *
   * This read `ifvg`, which is ANY gap on the execution series. So a 15-minute
   * gap with the daily merely agreeing and a displacement anywhere completed
   * "Patty" — a model whose whole premise is a 1h/4h gap the market has not
   * mitigated and a 5m close back into THAT gap. Patty now needs `htf_gap`
   * (scanner.ts: a 1h/4h fvg/ifvg on this side, still fresh or partial, with a
   * close back inside it). Hours and the requirement come from one definition
   * (`MODEL_REQUIREMENTS.patty`), not from a literal repeated in three files.
   *
   * `ifvg` stays in the condition: the execution-series gap is still where the
   * 5m confirmation prints. It is no longer SUFFICIENT.
   */
  const pattyName = modelMayBeNamed("patty", { etMin: input.etMin ?? null, components: input.components });
  const htfContext = input.daily === dir || input.mid === dir || comps.has("weekly_pd");
  if (pattyName.ok && ifvg && htfContext && (cisd || mss || disp)) {
    matches.push({
      strategy: "patty",
      reasons: [`patty: ${pattyName.why}`],
    });
  }

  /**
   * ITEM 24 — THE SILVER BULLET IS THE RAID OF THE 09:30–10:00 RANGE.
   *
   * 10:00–11:00 ET was just "NY AM", so whatever model happened to fit took
   * the hour's name. The silver bullet is Judas's shape on a different range:
   * the opening range gets raided, then price displaces away from it. Any OTHER
   * sweep in that hour is not one — which is what `or_raid` in
   * `MODEL_REQUIREMENTS.silver_bullet.requires` enforces.
   *
   * FULL SIZE by the trader's rule, and NO size bonus from this name:
   * `or_raid` carries weight 0 and `SILVER_BULLET_EVIDENCE.grantsSize` is
   * false. The window measured flat; this is a naming fix.
   */
  const sbName = modelMayBeNamed("silver_bullet", {
    etMin: input.etMin ?? null,
    components: input.components,
  });
  if (sbName.ok && (ifvg || comps.has("order_block"))) {
    matches.push({ strategy: "silver_bullet", reasons: [`silver_bullet: ${sbName.why}`] });
  }

  const withTrend =
    mid || input.mid === dir;
  if (ifvg && withTrend && (structure || cisd)) {
    matches.push({
      strategy: "continuation",
      reasons: ["continuation: with-trend IFVG + structure (internal→external)"],
    });
  } else if (ifvg && mid && structure) {
    matches.push({
      strategy: "continuation",
      reasons: ["continuation: mid-bias + structure + IFVG"],
    });
  }

  const narrative =
    input.topDown === dir &&
    ifvg &&
    (mid || daily || openB || input.weeklyPd === dir);
  // A narrative name is not a confirmation. Ronan needs the body close after the raid.
  if (narrative && cisd) {
    matches.push({
      strategy: "ronan",
      reasons: ["ronan: HTF narrative + the body close after the raid"],
    });
  }

  // SMT is not a model (2026-10-02) — a component, at a level only.
  void smt;

  const seen = new Set<StrategyId>();
  const out: StrategyMatch[] = [];
  for (const m of matches) {
    if (seen.has(m.strategy)) continue;
    seen.add(m.strategy);
    out.push(m);
  }
  return out;
}

export function primaryTag(matches: StrategyMatch[]): string {
  if (!matches.length) return "";
  const rank = new Map(ALWAYS_SCAN.map((s, i) => [s, i]));
  let best = matches[0]!;
  for (const m of matches) {
    if ((rank.get(m.strategy) ?? 99) < (rank.get(best.strategy) ?? 99)) best = m;
  }
  return best.strategy;
}

export function strategyLabel(id: string): string {
  const map: Record<string, string> = {
    mechanical: "Mechanical",
    blake_mech: "Blake Mech",
    tjr: "TJR",
    judas: "Judas",
    pdi: "PDI",
    patty: "Patty",
    continuation: "Continuation",
    ronan: "Ronan",
    silver_bullet: "Silver Bullet",
    smt: "SMT",
  };
  return map[id] ?? id;
}

export type { ComponentKey };
