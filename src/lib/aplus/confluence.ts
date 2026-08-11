/**
 * Port of knowledge/confluence.json + engine weights from Trading-Automation.
 */

import { RAW_WEIGHTS, WEIGHTS, type ComponentKey } from "@/lib/trading/engine-weights";

export interface ConfluenceKnowledge {
  version: number;
  samples: number;
  bars: number;
  symbol: string;
  window: string;
  floor: number;
  bestScore: number;
  cleared: number;
  componentFirePct: Record<string, number>;
  coldComponents: string[];
  hotComponents: string[];
  lessons: string[];
}

export const CONFLUENCE_KNOWLEDGE: ConfluenceKnowledge = {
  version: 1,
  samples: 843,
  bars: 28_739,
  symbol: "NQ",
  window: "2026-01-01T18:00:00 → 2026-01-30T16:59:00",
  floor: 0.75,
  bestScore: 0.6353,
  cleared: 0,
  componentFirePct: {
    mechanical_model: 4.5,
    structure: 68.7,
    mid_bias: 34.4,
    ifvg: 100.0,
    sweep_significant: 34.5,
    htf2_bias: 21.6,
    weekly_pd: 27.4,
    order_block: 0.0,
    cisd: 33.2,
    displacement: 13.3,
    mss: 22.2,
    opening_bias: 28.8,
    pd: 61.4,
    sponsored: 29.7,
    breaker: 0.0,
    mitigation: 0.0,
    rejection: 40.7,
    propulsion: 1.4,
    daily_bias: 35.1,
    smt: 0, // added post-knowledge snapshot
  },
  coldComponents: [
    "mechanical_model",
    "order_block",
    "breaker",
    "mitigation",
    "propulsion",
  ],
  hotComponents: ["ifvg", "structure"],
  lessons: [
    "Observed 843 scored candidates; best 0.635 vs floor 0.75; cleared 0 — selectivity held.",
    "Hot (low-information alone): ifvg, structure — require complementary cold/mechanical confirmation.",
    "Cold: mechanical_model, order_block, breaker, mitigation, propulsion — detection gap or scarce.",
    "Mechanical model (sweep→displace→invert→retest) is rare. Refuse partial sequences.",
    "HTF top_down remains an absolute gate — not a weighted input.",
    "Strategy catalog always-on: mechanical, tjr, judas, pdi, patty, continuation, blake_mech, ronan, smt.",
  ],
};

export interface ComponentWeight {
  name: ComponentKey | string;
  weight: number;
  firePct: number;
  raw: number;
}

/** Engine-aligned display weights (from scanner.py RAW_WEIGHTS). */
export const COMPONENT_WEIGHTS: ComponentWeight[] = (
  Object.keys(RAW_WEIGHTS) as ComponentKey[]
).map((name) => ({
  name,
  weight: WEIGHTS[name],
  raw: RAW_WEIGHTS[name],
  firePct: CONFLUENCE_KNOWLEDGE.componentFirePct[name] ?? 0,
}));

export const STRATEGY_CATALOG = [
  "mechanical",
  "blake_mech",
  "tjr",
  "judas",
  "pdi",
  "patty",
  "continuation",
  "ronan",
  "smt",
] as const;
