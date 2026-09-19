/**
 * The one skill the Learn tab trains.
 *
 * Name the first failing must-layer. If none fail and PATH is A+/A/A−, TAKE.
 * Else STAND or WAIT. Then write the invalidation.
 *
 * Labels are the strings smc-master.ts actually prints in `missing`. A drill
 * that scored a different vocabulary than the Now tab would train a desk
 * that does not exist.
 */

export const WORDS = ["TAKE", "WAIT", "STAND"] as const;
export type Word = (typeof WORDS)[number];

/** Closed set — the must-layers plus the two non-layer blockers. */
export const MUST_LAYERS = [
  "Draw on liquidity",
  "HTF bias + DOL",
  "Liquidity sweep",
  "POI in correct half",
  "LTF shift + displacement",
  "Kill zone",
  "Retrace into array",
  "Judas / news",
  "No A+/A/A− PATH",
  "Sequence complete",
] as const;
export type MustLayer = (typeof MUST_LAYERS)[number];

export interface Call {
  word: Word;
  missing: string;
}

export interface CallScore {
  wordOk: boolean;
  layerOk: boolean;
  grade: "hit" | "word" | "miss";
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** True when the trader named the same blocker the engine did. */
export function layerMatch(guess: string, truth: string): boolean {
  const a = norm(guess);
  const b = norm(truth);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const keys = [
    ["poi", "half", "premium", "discount", "dealing"],
    ["sweep", "raid"],
    ["ltf", "shift", "displacement"],
    ["retrace", "array"],
    ["draw", "dol"],
    ["judas", "news"],
    ["kill zone", "killzone"],
    ["path"],
    ["sequence complete", "complete"],
    ["htf"],
  ];
  for (const group of keys) {
    const ga = group.some((k) => a.includes(k));
    const gb = group.some((k) => b.includes(k));
    if (ga && gb) return true;
  }
  return false;
}

export function scoreCall(guess: Call, truth: Call): CallScore {
  const wordOk = guess.word === truth.word;
  const layerOk =
    truth.word === "TAKE"
      ? guess.word === "TAKE" || layerMatch(guess.missing, "Sequence complete")
      : layerMatch(guess.missing, truth.missing);
  return {
    wordOk,
    layerOk,
    grade: wordOk && layerOk ? "hit" : wordOk ? "word" : "miss",
  };
}

export function pickLayer(label: string): string {
  const hit = MUST_LAYERS.find((l) => layerMatch(l, label));
  return hit ?? label;
}

/**
 * Scenario STAND/WAIT maps onto the layer the scenario is teaching.
 * TAKE maps to Sequence complete. A missing id scores the word only.
 */
export const SCENARIO_LAYER: Record<string, string> = {
  "bias-bull": "Sequence complete",
  "bias-bear": "Sequence complete",
  "bias-expansion": "HTF bias + DOL",
  "bias-coil": "HTF bias + DOL",
  "conflict-aligned": "Sequence complete",
  "conflict-premium-override": "HTF bias + DOL",
  "conflict-discount-override": "HTF bias + DOL",
  "against-sweep-only": "LTF shift + displacement",
  "against-full": "Sequence complete",
  "against-stale": "LTF shift + displacement",
  "sweep-clean": "Retrace into array",
  "sweep-breakout": "Liquidity sweep",
  "sweep-polarity": "Liquidity sweep",
  "sweep-stale": "Liquidity sweep",
  "range-premium-short": "Sequence complete",
  "range-discount-short": "POI in correct half",
  "range-eq": "POI in correct half",
  "shift-clean": "Retrace into array",
  "shift-wick": "LTF shift + displacement",
  "shift-early": "LTF shift + displacement",
  "retrace-into": "Sequence complete",
  "retrace-never": "Retrace into array",
};

export function scenarioCall(id: string, verdict: Word): Call {
  return {
    word: verdict,
    missing: SCENARIO_LAYER[id] ?? (verdict === "TAKE" ? "Sequence complete" : verdict),
  };
}

/**
 * Historic figure ids that are a right/wrong pair. Stamped onto getFigure so
 * the renderer and verify-curriculum agree without editing the JSON by hand.
 */
export const CONTRAST_VERDICT: Record<string, "right" | "wrong"> = {
  "bias-bull": "right",
  "bias-expansion": "wrong",
  "sweep-clean": "right",
  "sweep-breakout": "wrong",
  "range-premium-short": "right",
  "range-discount-short": "wrong",
};
