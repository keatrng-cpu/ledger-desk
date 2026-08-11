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
  "smt",
];

/**
 * Which market story each model is built for.
 * Graded alone — never stacked for a higher confluence score.
 */
export const STRATEGY_NARRATIVE: Record<
  StrategyId,
  { story: "continuation" | "reversal" | "either"; entry: string; liquidity: string }
> = {
  mechanical: {
    story: "either",
    entry: "Ordered retest after sweep→displace→invert",
    liquidity: "Significant sweep starts the sequence",
  },
  tjr: {
    story: "either",
    entry: "IFVG/FVG retest after significant sweep + structure",
    liquidity: "Sweep then MSS — entry on retrace not chase",
  },
  judas: {
    story: "reversal",
    entry: "Session open sweep reverse into array retest",
    liquidity: "Judas swing grabs session SSL/BSL then reverses",
  },
  pdi: {
    story: "reversal",
    entry: "CISD/displacement into IFVG",
    liquidity: "Sweep + change in state of delivery",
  },
  patty: {
    story: "reversal",
    entry: "Sweep + displace into FVG",
    liquidity: "External grab then delivery",
  },
  continuation: {
    story: "continuation",
    entry: "Pullback IFVG with mid bias held",
    liquidity: "Internal liquidity; DOL toward external",
  },
  blake_mech: {
    story: "either",
    entry: "IFVG + structure/CISD + displacement",
    liquidity: "Sweep preferred but structure path allowed",
  },
  ronan: {
    story: "continuation",
    entry: "Bias-aligned array with multi-TF agreement",
    liquidity: "Seeks PD arrays in discount/premium",
  },
  smt: {
    story: "either",
    entry: "Relative strength — needs separate entry model",
    liquidity: "Divergence at liquidity pools across indices",
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
}

function componentsOf(reasons: string[]): Set<string> {
  return new Set(reasons.filter((r) => SCORE_KEYS.has(r)));
}

function nyWindow(killzone: string): boolean {
  const kz = killzone.toLowerCase().replace(/\s+/g, "_");
  return (
    kz.includes("ny_am") ||
    kz.includes("ny_open") ||
    kz.includes("new_york") ||
    (kz.includes("ny") && !kz.includes("asia") && !kz.includes("london"))
  );
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
    matches.push({
      strategy: "blake_mech",
      reasons: ["blake mech: mechanical sequence + IFVG path"],
    });
  } else if (ifvg && (structure || cisd) && (disp || mss)) {
    matches.push({
      strategy: "blake_mech",
      reasons: ["blake mech: IFVG + structure/CISD + displacement"],
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
  const judasBias =
    openB || daily || input.daily === dir;
  if (sig && judasShift && judasBias && ifvg) {
    const why = ["judas: significant sweep + shift + bias + IFVG"];
    if (nyWindow(input.killzone)) why.push("session/open window");
    matches.push({ strategy: "judas", reasons: why });
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

  if (ifvg && sig && (disp || cisd || mss) && (nyWindow(input.killzone) || openB)) {
    matches.push({
      strategy: "patty",
      reasons: ["patty: open/session manip + IFVG + displacement/CISD"],
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
  if (narrative && (structure || cisd || disp)) {
    matches.push({
      strategy: "ronan",
      reasons: ["ronan: HTF narrative + IFVG + confirmation"],
    });
  }

  if (smt && (structure || mss || cisd || ifvg)) {
    matches.push({
      strategy: "smt",
      reasons: ["smt: correlated-pair divergence favors direction + entry model"],
    });
  } else if (smt) {
    matches.push({
      strategy: "smt",
      reasons: ["smt: correlated-pair divergence favors direction"],
    });
  }

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
