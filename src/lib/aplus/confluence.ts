/**
 * Port of knowledge/confluence.json from Trading-Automation.
 * Offline-learned component fire rates + lessons for the desk.
 */

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

/** Snapshot from repo knowledge/confluence.json (NQ window). */
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
  ],
};

export interface ComponentWeight {
  name: string;
  weight: number;
  firePct: number;
}

/** Display weights (illustrative — production weights live in strategy/scanner). */
export const COMPONENT_WEIGHTS: ComponentWeight[] = [
  { name: "htf2_bias", weight: 0.12, firePct: 21.6 },
  { name: "structure", weight: 0.1, firePct: 68.7 },
  { name: "mechanical_model", weight: 0.14, firePct: 4.5 },
  { name: "sweep_significant", weight: 0.1, firePct: 34.5 },
  { name: "mss", weight: 0.08, firePct: 22.2 },
  { name: "ifvg", weight: 0.08, firePct: 100 },
  { name: "order_block", weight: 0.07, firePct: 0 },
  { name: "pd", weight: 0.06, firePct: 61.4 },
  { name: "weekly_pd", weight: 0.05, firePct: 27.4 },
  { name: "displacement", weight: 0.05, firePct: 13.3 },
  { name: "opening_bias", weight: 0.04, firePct: 28.8 },
  { name: "mid_bias", weight: 0.04, firePct: 34.4 },
  { name: "rejection", weight: 0.03, firePct: 40.7 },
  { name: "cisd", weight: 0.02, firePct: 33.2 },
  { name: "sponsored", weight: 0.02, firePct: 29.7 },
];
