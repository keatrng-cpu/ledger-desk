/**
 * Named strategy classifiers — port of Trading-Automation `strategy/strategies.py`.
 * Always evaluated on every scored candidate. LLM never decides tags.
 */

import { SCORE_KEYS, type ComponentKey } from "./engine-weights";

export type StrategyId =
  | "tjr"
  | "mechanical"
  | "blake_mech"
  | "judas"
  | "pdi"
  | "continuation"
  | "patty"
  | "ronan"
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
    entry: "Ordered retest after sweep→displace→invert",
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
      reasons: ["ordered sweep→displace→invert→retest"],
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
  const judasMin = input.etMin;
  if (
    sig &&
    judasShift &&
    judasBias &&
    ifvg &&
    comps.has("opening_raid") &&
    judasMin != null &&
    judasMin >= 9 * 60 + 30 &&
    judasMin < 9 * 60 + 45
  ) {
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

  const pattyMin = input.etMin;
  const pattyClock =
    pattyMin != null &&
    ((pattyMin >= 9 * 60 + 45 && pattyMin < 11 * 60) ||
      (pattyMin >= 13 * 60 + 30 && pattyMin < 14 * 60 + 30));
  const htfContext = input.daily === dir || input.mid === dir || comps.has("weekly_pd");
  if (ifvg && htfContext && (cisd || mss || disp) && pattyClock) {
    matches.push({
      strategy: "patty",
      reasons: ["patty: higher-timeframe gap, then the 5m confirmation — not the touch"],
    });
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
    smt: "SMT",
  };
  return map[id] ?? id;
}

export type { ComponentKey };
