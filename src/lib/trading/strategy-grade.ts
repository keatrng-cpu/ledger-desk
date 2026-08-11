/**
 * Strategy-native two-axis grading (individual models, not stacked).
 *
 * 1) SMC/ICT structure layer — shared market read (HTF/mid/structure/PD…).
 * 2) Each strategy is graded alone against that market (its own must / any-of / nice).
 * 3) Best single model wins for path — multi-strategy tags do NOT boost score.
 */

import { APLUS_RULES, type RiskGrade } from "@/lib/aplus/config";
import { WEIGHTS, type ComponentKey } from "./engine-weights";
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
  /** Optional boosts for Q within THIS model only */
  nice: ComponentKey[];
  /** SMT alone is never a take — needs entry model companion */
  requiresCompanion?: boolean;
  label: string;
  /** One-line: when this model applies (structure context) */
  structureNote: string;
}

/**
 * Shared SMC/ICT structure keys — context for every model.
 * These describe the market, not a specific entry playbook.
 */
export const SMC_STRUCTURE_KEYS: ComponentKey[] = [
  "structure",
  "mss",
  "displacement",
  "cisd",
  "mid_bias",
  "htf2_bias",
  "daily_bias",
  "weekly_pd",
  "pd",
  "opening_bias",
];

/** Per-strategy completeness templates — different entry models, same structure layer. */
export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    id: "mechanical",
    label: "Mechanical",
    must: ["mechanical_model", "sweep_significant"],
    mustAnyOf: [["ifvg", "order_block"]],
    nice: ["mid_bias", "htf2_bias", "displacement", "mss"],
    structureNote: "Ordered sweep→displace→invert→retest sequence",
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
    structureNote: "IFVG + structure shift entry (Blake path)",
  },
  {
    id: "tjr",
    label: "TJR",
    must: ["sweep_significant", "ifvg"],
    mustAnyOf: [["structure", "mss", "displacement", "mechanical_model"]],
    nice: ["opening_bias", "mid_bias", "order_block"],
    structureNote: "Significant sweep + structure/MSS + IFVG retrace",
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
    structureNote: "Judas sweep of session liquidity then reverse",
  },
  {
    id: "pdi",
    label: "PDI",
    must: ["ifvg", "sweep_significant"],
    mustAnyOf: [["cisd", "structure", "mss", "displacement"]],
    nice: ["smt", "mid_bias"],
    structureNote: "PDI displacement / CISD into IFVG",
  },
  {
    id: "patty",
    label: "Patty",
    must: ["ifvg", "sweep_significant"],
    mustAnyOf: [["displacement", "cisd", "mss"]],
    nice: ["opening_bias", "daily_bias"],
    structureNote: "Patty model: sweep + displace into array",
  },
  {
    id: "continuation",
    label: "Continuation",
    must: ["ifvg", "mid_bias"],
    mustAnyOf: [["structure", "cisd", "mss"]],
    nice: ["htf2_bias", "daily_bias", "pd"],
    structureNote: "HTF continuation pullback into IFVG",
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
    structureNote: "Ronan bias-aligned array entry",
  },
  {
    id: "smt",
    label: "SMT",
    must: ["smt"],
    mustAnyOf: [["ifvg", "order_block", "mechanical_model"]],
    nice: ["structure", "mss", "sweep_significant"],
    requiresCompanion: true,
    structureNote: "SMT divergence — always needs a separate entry model",
  },
];

export interface StrategyMarketGrade {
  id: StrategyId | string;
  label: string;
  /** 0–1 fit of THIS model alone to current market */
  fit: number;
  /** Structure-layer quality only */
  structureQ: number;
  /** Model-specific completeness quality */
  modelQ: number;
  complete: boolean;
  missing: string[];
  note: string;
  structureNote: string;
  band: PathBand;
}

export function templateFor(id: string): StrategyTemplate | undefined {
  return STRATEGY_TEMPLATES.find((t) => t.id === id);
}

/** SMC/ICT structure score from present components (shared layer). */
export function structureLayerScore(components: string[]): number {
  const set = new Set(components);
  let pts = 0;
  let max = 0;
  for (const k of SMC_STRUCTURE_KEYS) {
    const w = WEIGHTS[k] ?? 0;
    max += w;
    if (set.has(k)) pts += w;
  }
  if (max <= 0) return 0;
  return Math.min(1, pts / max);
}

export function isStrategyComplete(
  id: string,
  components: string[],
  /** @deprecated companions no longer required for score — only SMT still needs entry array */
  _strategies: string[] = [],
): { complete: boolean; missing: string[]; note: string } {
  const t = templateFor(id);
  if (!t) {
    return {
      complete: false,
      missing: ["unknown strategy"],
      note: "no template",
    };
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
  // SMT needs an entry array component (not another strategy tag)
  if (t.requiresCompanion) {
    const entryOk =
      set.has("ifvg") ||
      set.has("order_block") ||
      set.has("mechanical_model");
    if (!entryOk) missing.push("entry_array");
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
 * Grade one strategy alone against the market.
 * Structure is shared; model must/any/nice are strategy-specific — no stacking.
 */
export function gradeStrategyAgainstMarket(
  id: string,
  components: string[],
  opts?: {
    htfOk?: boolean;
    killzoneOk?: boolean;
    conditionsOk?: boolean;
  },
): StrategyMarketGrade {
  const t = templateFor(id);
  const label = t?.label ?? id;
  const structureNote = t?.structureNote ?? "";
  const set = new Set(components);
  const structureQ = structureLayerScore(components);

  if (!t) {
    return {
      id,
      label,
      fit: structureQ * 0.4,
      structureQ,
      modelQ: 0,
      complete: false,
      missing: ["unknown strategy"],
      note: "no template",
      structureNote,
      band: "skip",
    };
  }

  // Model axis: only THIS template's requirements
  let modelPts = 0;
  let modelMax = 0;
  for (const m of t.must) {
    modelMax += 1.0;
    if (set.has(m)) modelPts += 1.0;
  }
  for (const group of t.mustAnyOf ?? []) {
    modelMax += 1.0;
    if (group.some((c) => set.has(c))) modelPts += 1.0;
  }
  for (const n of t.nice) {
    modelMax += 0.4;
    if (set.has(n)) modelPts += 0.4;
  }
  const modelQ = modelMax > 0 ? modelPts / modelMax : 0;

  const { complete, missing, note } = isStrategyComplete(id, components, []);

  // Fit = structure context + model fidelity (not other strategies)
  let fit = structureQ * 0.4 + modelQ * 0.55;
  if (opts?.htfOk) fit += 0.025;
  if (opts?.killzoneOk) fit += 0.015;
  if (opts?.conditionsOk) fit += 0.01;
  if (complete) fit += 0.03;
  // Incomplete hard cap below path A- without complete model
  if (!complete) fit = Math.min(fit, PROFIT_ACTION_FLOOR - 0.01);
  fit = Math.min(0.99, Math.max(0, +fit.toFixed(4)));

  const band = pathBand({
    quality: fit,
    complete,
    htfOk: opts?.htfOk !== false,
  });

  return {
    id: t.id,
    label,
    fit,
    structureQ: +structureQ.toFixed(4),
    modelQ: +modelQ.toFixed(4),
    complete,
    missing,
    note,
    structureNote,
    band,
  };
}

/**
 * Evaluate every strategy independently; sort by fit (complete first).
 * This is the desk's primary ranking — never multiplies strategies together.
 */
export function gradeAllStrategies(
  components: string[],
  opts?: {
    htfOk?: boolean;
    killzoneOk?: boolean;
    conditionsOk?: boolean;
  },
): StrategyMarketGrade[] {
  const board = ALWAYS_SCAN.map((id) =>
    gradeStrategyAgainstMarket(id, components, opts),
  );
  board.sort((a, b) => {
    // Complete models outrank incomplete even if raw fit close
    if (a.complete !== b.complete) return a.complete ? -1 : 1;
    return b.fit - a.fit;
  });
  return board;
}

export function bestStrategyGrade(
  components: string[],
  opts?: {
    htfOk?: boolean;
    killzoneOk?: boolean;
    conditionsOk?: boolean;
  },
): StrategyMarketGrade {
  const board = gradeAllStrategies(components, opts);
  return (
    board[0] ?? {
      id: "none",
      label: "None",
      fit: 0,
      structureQ: 0,
      modelQ: 0,
      complete: false,
      missing: ["no model"],
      note: "no model",
      structureNote: "",
      band: "skip",
    }
  );
}

/**
 * @deprecated Multi-strategy quality boost removed.
 * Kept as thin wrapper so call sites use single-model Q.
 */
export function qualityScore(opts: {
  confluence: number;
  strategies: string[];
  htfOk: boolean;
  killzoneOk: boolean;
  conditionsOk: boolean;
  components: string[];
}): number {
  // Prefer independent best-model fit; fall back to structure+confluence
  const best = bestStrategyGrade(opts.components, {
    htfOk: opts.htfOk,
    killzoneOk: opts.killzoneOk,
    conditionsOk: opts.conditionsOk,
  });
  if (best.fit > 0) return best.fit;
  let q = opts.confluence;
  if (opts.htfOk) q += 0.01;
  if (opts.killzoneOk) q += 0.01;
  if (opts.conditionsOk) q += 0.01;
  if (opts.components.includes("pd")) q += 0.015;
  return Math.min(0.99, +q.toFixed(4));
}

/**
 * Find best complete strategy for this candidate (path C axis).
 * Scans ALL templates against market — not only pre-tagged strategies.
 */
export function bestCompleteStrategy(
  strategies: string[],
  components: string[],
): { id: string; complete: boolean; missing: string[]; note: string } | null {
  const board = gradeAllStrategies(components, {});
  const complete = board.find((b) => b.complete);
  if (complete) {
    return {
      id: String(complete.id),
      complete: true,
      missing: [],
      note: complete.note,
    };
  }
  // Prefer pre-tagged incomplete with fewest missing
  const tagged = strategies
    .map((id) => isStrategyComplete(id, components, strategies))
    .map((r, i) => ({ id: strategies[i]!, ...r }));
  const fromBoard = board[0];
  if (fromBoard) {
    return {
      id: String(fromBoard.id),
      complete: false,
      missing: fromBoard.missing,
      note: fromBoard.note,
    };
  }
  tagged.sort((a, b) => a.missing.length - b.missing.length);
  return tagged[0]
    ? {
        id: tagged[0].id,
        complete: false,
        missing: tagged[0].missing,
        note: tagged[0].note,
      }
    : null;
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
  const pathBandOk =
    band === "A+" || band === "A" || band === "A-" || band === "B+";
  if (pathBandOk && c.htfOk !== false && c.strategyComplete !== false) {
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
