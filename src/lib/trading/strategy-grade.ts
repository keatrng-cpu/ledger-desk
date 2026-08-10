/**
 * Strategy-native two-axis grading.
 * Q = quality (location, HTF, multi-strategy, conditions)
 * C = completeness (that strategy's required stack is filled)
 * Path = C complete ∧ HTF ∧ killzone ∧ Q band — never incomplete B as path.
 */

import { APLUS_RULES, type RiskGrade } from "@/lib/aplus/config";
import type { ComponentKey } from "./engine-weights";
import { ALWAYS_SCAN, type StrategyId } from "./strategies";

const PROFIT_ACTION_FLOOR = APLUS_RULES.confluenceFloorCalibration;
const PROFIT_A_PLUS = APLUS_RULES.aPlusThreshold;

export type PathBand = "A+" | "A" | "A-" | "B+" | "B" | "C" | "skip";

export interface StrategyTemplate {
  id: StrategyId;
  /** Required components — all must be present for C=complete */
  must: ComponentKey[];
  /** Any-of groups: at least one from each group */
  mustAnyOf?: ComponentKey[][];
  /** Optional boosts for Q */
  nice: ComponentKey[];
  /** SMT alone is never a take — needs entry model companion */
  requiresCompanion?: boolean;
  label: string;
}

/** Per-strategy completeness templates — same catalog, different "complete". */
export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    id: "mechanical",
    label: "Mechanical",
    must: ["mechanical_model", "sweep_significant"],
    mustAnyOf: [["ifvg", "order_block"]],
    nice: ["mid_bias", "htf2_bias", "displacement", "mss"],
  },
  {
    id: "blake_mech",
    label: "Blake Mech",
    must: ["ifvg"],
    mustAnyOf: [
      ["structure", "cisd", "mss"],
      ["displacement", "mss", "mechanical_model"],
    ],
    nice: ["sweep_significant", "mid_bias", "order_block"],
  },
  {
    id: "tjr",
    label: "TJR",
    must: ["sweep_significant", "ifvg"],
    mustAnyOf: [["structure", "mss", "displacement", "mechanical_model"]],
    nice: ["opening_bias", "mid_bias", "order_block"],
  },
  {
    id: "judas",
    label: "Judas",
    must: ["sweep_significant", "ifvg"],
    mustAnyOf: [
      ["structure", "mss", "cisd"],
      ["opening_bias", "daily_bias", "mid_bias"],
    ],
    nice: ["displacement", "weekly_pd"],
  },
  {
    id: "pdi",
    label: "PDI",
    must: ["ifvg", "sweep_significant"],
    mustAnyOf: [["cisd", "structure", "mss", "displacement"]],
    nice: ["smt", "mid_bias"],
  },
  {
    id: "patty",
    label: "Patty",
    must: ["ifvg", "sweep_significant"],
    mustAnyOf: [["displacement", "cisd", "mss"]],
    nice: ["opening_bias", "daily_bias"],
  },
  {
    id: "continuation",
    label: "Continuation",
    must: ["ifvg", "mid_bias"],
    mustAnyOf: [["structure", "cisd", "mss"]],
    nice: ["htf2_bias", "daily_bias", "pd"],
  },
  {
    id: "ronan",
    label: "Ronan",
    must: ["ifvg"],
    mustAnyOf: [
      ["structure", "cisd", "displacement"],
      ["mid_bias", "daily_bias", "opening_bias", "weekly_pd"],
    ],
    nice: ["sweep_significant", "smt"],
  },
  {
    id: "smt",
    label: "SMT",
    must: ["smt"],
    mustAnyOf: [["ifvg", "order_block", "mechanical_model"]],
    nice: ["structure", "mss", "sweep_significant"],
    requiresCompanion: true,
  },
];

export function templateFor(id: string): StrategyTemplate | undefined {
  return STRATEGY_TEMPLATES.find((t) => t.id === id);
}

export function isStrategyComplete(
  id: string,
  components: string[],
  strategies: string[],
): { complete: boolean; missing: string[]; note: string } {
  const t = templateFor(id);
  if (!t) {
    return { complete: false, missing: ["unknown strategy"], note: "no template" };
  }
  const set = new Set(components);
  const missing: string[] = [];

  for (const m of t.must) {
    if (!set.has(m)) missing.push(m);
  }
  if (t.mustAnyOf) {
    for (const group of t.mustAnyOf) {
      if (!group.some((c) => set.has(c))) {
        missing.push(`any(${group.join("|")})`);
      }
    }
  }
  if (t.requiresCompanion) {
    const companions = strategies.filter((s) => s !== "smt");
    if (!companions.length) {
      missing.push("companion_model");
    }
  }

  const complete = missing.length === 0;
  return {
    complete,
    missing,
    note: complete
      ? `${t.label} complete`
      : `${t.label} incomplete: ${missing.slice(0, 4).join(", ")}`,
  };
}

/**
 * Quality axis 0–1: base confluence + multi-strategy boost + location soft factors.
 * Does not replace confluence — adjusts for path banding.
 */
export function qualityScore(opts: {
  confluence: number;
  strategies: string[];
  htfOk: boolean;
  killzoneOk: boolean;
  conditionsOk: boolean;
  components: string[];
}): number {
  let q = opts.confluence;
  // Multi-strategy agreement boost (quality without lowering floor)
  const n = new Set(opts.strategies).size;
  if (n >= 3) q += 0.04;
  else if (n >= 2) q += 0.025;
  if (opts.htfOk) q += 0.01;
  if (opts.killzoneOk) q += 0.01;
  if (opts.conditionsOk) q += 0.01;
  // Location
  if (opts.components.includes("pd")) q += 0.015;
  if (opts.components.includes("smt")) q += 0.01;
  return Math.min(0.99, +q.toFixed(4));
}

/**
 * Find best complete strategy for this candidate (path C axis).
 */
export function bestCompleteStrategy(
  strategies: string[],
  components: string[],
): { id: string; complete: boolean; missing: string[]; note: string } | null {
  const order = [
    ...strategies.filter((s) => ALWAYS_SCAN.includes(s as StrategyId)),
    ...ALWAYS_SCAN.filter((s) => !strategies.includes(s)),
  ];
  let bestIncomplete: {
    id: string;
    complete: boolean;
    missing: string[];
    note: string;
  } | null = null;

  for (const id of order) {
    const r = isStrategyComplete(id, components, strategies);
    if (r.complete) return { id, ...r };
    if (
      !bestIncomplete ||
      r.missing.length < bestIncomplete.missing.length
    ) {
      bestIncomplete = { id, ...r };
    }
  }
  return bestIncomplete;
}

/**
 * Path band from Q + C. Incomplete → C or skip, never A-path.
 */
export function pathBand(opts: {
  quality: number;
  complete: boolean;
  htfOk: boolean;
}): PathBand {
  if (!opts.complete) {
    if (opts.quality >= PROFIT_ACTION_FLOOR - 0.08) return "C";
    return "skip";
  }
  if (!opts.htfOk) return "B"; // complete but HTF fight — not path
  if (opts.quality >= PROFIT_A_PLUS) return "A+";
  if (opts.quality >= PROFIT_ACTION_FLOOR + 0.03) return "A";
  if (opts.quality >= PROFIT_ACTION_FLOOR) return "A-";
  // B+ = strategy-complete, Q within 0.05 below floor (e.g. 0.60–0.65)
  if (opts.quality >= PROFIT_ACTION_FLOOR - 0.05) return "B+";
  if (opts.quality >= PROFIT_ACTION_FLOOR - 0.1) return "B";
  if (opts.quality >= PROFIT_ACTION_FLOOR - 0.18) return "C";
  return "skip";
}

export function bandIsPath(band: PathBand): boolean {
  return band === "A+" || band === "A" || band === "A-" || band === "B+";
}

export function bandToDisplayGrade(
  band: PathBand,
): "A+" | "A-" | "B" | "skip" {
  if (band === "A+") return "A+";
  if (band === "A" || band === "A-") return "A-";
  if (band === "B+" || band === "B" || band === "C") return "B";
  return "skip";
}

export function bandToRiskGrade(band: PathBand): RiskGrade {
  if (band === "A+") return "A+";
  if (band === "A") return "A";
  if (band === "A-") return "A-";
  if (band === "B+") return "B+";
  if (band === "B") return "B";
  if (band === "C") return "C";
  return "skip";
}

export function bandSizeMult(band: PathBand): number {
  if (band === "A+" || band === "A" || band === "A-" || band === "B+") return 1;
  if (band === "B") return 0;
  if (band === "C") return 0;
  return 0;
}

export function bandLiveAllowed(band: PathBand): boolean {
  return bandIsPath(band);
}

export function bandPaperOnly(band: PathBand): boolean {
  return band === "B";
}

/** True when candidate should be auto-taken (A+ / A / A- path). */
export function isPathTake(c: {
  actionable?: boolean;
  pathBand?: string | null;
  grade?: string | null;
  riskGrade?: string | null;
  strategyComplete?: boolean;
  htfOk?: boolean;
  confluence?: number;
} | null | undefined): boolean {
  if (!c) return false;
  if (c.actionable) return true;
  const band = c.pathBand || c.riskGrade || c.grade || "";
  const pathBand =
    band === "A+" || band === "A" || band === "A-" || band === "B+";
  if (pathBand && c.htfOk !== false && c.strategyComplete !== false) {
    return true;
  }
  if (
    (c.grade === "A-" ||
      c.riskGrade === "A-" ||
      c.pathBand === "A-" ||
      c.pathBand === "B+" ||
      c.riskGrade === "B+") &&
    c.htfOk !== false &&
    (c.confluence ?? 0) >= PROFIT_ACTION_FLOOR - 0.05
  ) {
    return true;
  }
  return false;
}
