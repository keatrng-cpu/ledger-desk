/**
 * What is actually driving this card's score — in points, per component.
 *
 * WHY A RAW WEIGHT WOULD BE A LIE
 * The obvious implementation is to draw each component's `RAW_WEIGHTS` value
 * next to its mark: the IFVG box gets "8", the sweep gets "4". That number is
 * wrong in both directions and the error is not small.
 *
 * `ifvg` has weight 8 — the joint-highest in the table — and contributes
 * EXACTLY ZERO to `structureLayerScore`, because that function ratios over
 * `SMC_STRUCTURE_KEYS` and `ifvg` is not in it. What `ifvg` actually does is
 * satisfy a template gate: it is a `must` for blake/silver-bullet/unicorn and
 * one half of an any-of for mechanical. Labelling the drawn box "8 pts" would
 * put a confident number on a chart that no line of scoring code computes.
 *
 * Meanwhile `structure` also has weight 8 and DOES score — but it is worth
 * `8/45 × 0.40 = 0.071` of fit, not 8 of anything.
 *
 * WHAT THIS MODULE COMPUTES INSTEAD
 * The marginal contribution: how much `fit` would drop if this component were
 * absent and nothing else changed. That is the number a trader can act on,
 * because it answers the only question they are really asking of a mark —
 * "how much of this score is resting on that?"
 *
 * HOW IT IS COMPUTED: BY DIFFERENCING THE ENGINE, NOT BY MIRRORING IT
 * This module first re-derived `fit` from its parts — structureQ × 0.40 plus
 * modelQ × 0.55 — and that was wrong by up to 24 points on the components
 * that matter most. `gradeStrategyAgainstMarket` also adds a +0.03
 * completeness bonus and clamps `fit` to `PROFIT_ACTION_FLOOR - 0.02` when a
 * strategy is neither complete nor near-complete. Removing a `must` breaks
 * completeness, so it forfeits the bonus AND trips the floor — neither of
 * which a mirror of the two main terms can see.
 *
 * Measured on an ordinary A+ mechanical card (fit 0.9257): the mirror printed
 * `sweep_significant 12p`, while removing the raid actually takes fit to the
 * 0.63 floor — 29.6 points, and A+ (a 2% probe) down to C (journal only).
 * The chart understated the load-bearing mark threefold.
 *
 * So each figure is now `fit(components) - fit(components without this one)`,
 * which is what the number was always defined to mean. There is no second
 * copy of the formula left to drift out of step.
 *
 * THE ANY-OF CASE IS THE INTERESTING ONE
 * A component inside a satisfied any-of group is worth its full 0.55 share
 * ONLY when it is the sole member present. If both `ifvg` and `order_block`
 * are on the tape, removing either changes nothing — the group stays
 * satisfied — so each is marginally worth zero, and the chart says
 * "redundant" rather than printing a number that would vanish on removal.
 * Two marks each claiming credit for the same point is double-counting, and
 * it is the specific way a confluence display flatters a setup.
 *
 * WHY THE FIGURES DO NOT SUM TO THE SCORE
 * They are not meant to. Through a clamp, two musts can each be worth ~30
 * points on their own removal while jointly carrying about 30 — removing
 * either one drops the card to the same floor. Marginal contributions
 * overlap whenever a threshold is involved, which is a property of the
 * scoring rule and not an error in the measurement. `reconstruct()` says so
 * rather than asserting a total that would have to be wrong.
 */

import { WEIGHTS, type ComponentKey } from "./engine-weights";
import {
  SMC_STRUCTURE_KEYS,
  gradeStrategyAgainstMarket,
  templateFor,
} from "./strategy-grade";
import type { MarkKind } from "./setup-anticipation";

/** Which scoring channel a component pays into. */
export type DriverChannel =
  /** Inside SMC_STRUCTURE_KEYS — pays into structureQ, the 0.40 half. */
  | "structure"
  /** A template `must` — pays into modelQ at full weight. */
  | "must"
  /** One of an any-of group, and the only member present. Load-bearing. */
  | "anyof-sole"
  /** One of an any-of group with a sibling also present. Marginally free. */
  | "anyof-redundant"
  /** A template `nice` — pays into modelQ at 0.4 weight. */
  | "nice"
  /** Present on the tape, but this strategy's template never reads it. */
  | "unscored";

export interface ScoreDriver {
  key: ComponentKey;
  label: string;
  /** The dominant channel, for a one-word badge. */
  channel: DriverChannel;
  /** EVERY channel this component pays into — often more than one. */
  channels: DriverChannel[];
  /** Marginal contribution to `fit`, in fit units (0–1). */
  points: number;
  /** The same figure in score points out of 100, for display. */
  pts100: number;
  /** Which chart mark this component is drawn as, when it has one. */
  draws: MarkKind | null;
  /** One line: what the trader should be able to SEE on the chart for this. */
  what: string;
}

const LABELS: Record<ComponentKey, string> = {
  mechanical_model: "Mechanical sequence",
  structure: "Structure",
  mid_bias: "Mid bias",
  ifvg: "IFVG",
  smt: "SMT divergence",
  sweep_significant: "Significant sweep",
  htf2_bias: "HTF₂ bias",
  weekly_pd: "Weekly PD",
  order_block: "Order block",
  ote: "OTE retrace",
  cisd: "CISD",
  displacement: "Displacement",
  mss: "MSS",
  opening_bias: "Opening bias",
  pd: "Premium/discount",
  sponsored: "Sponsored candle",
  breaker: "Breaker",
  mitigation: "Mitigation block",
  rejection: "Rejection block",
  propulsion: "Propulsion block",
  daily_bias: "Daily bias",
};

/**
 * Which mark a component appears as on the chart.
 *
 * Null means the component is real and scored but has no single price to draw
 * — a bias is a direction, not a level. Those still appear in the driver
 * LIST; they just do not get a line. Inventing a price for them is how a
 * chart ends up with confident marks nobody can verify.
 */
const DRAWN_AS: Partial<Record<ComponentKey, MarkKind>> = {
  sweep_significant: "sweep",
  displacement: "displacement",
  ifvg: "array",
  order_block: "array",
  breaker: "array",
  mitigation: "array",
  rejection: "array",
  propulsion: "array",
  sponsored: "array",
  ote: "array",
  mss: "displacement",
  cisd: "displacement",
  pd: "eq",
  weekly_pd: "eq",
};

const WHAT: Partial<Record<ComponentKey, string>> = {
  sweep_significant: "A wick through a prior high/low that closed back inside.",
  displacement: "A wide-range bar leaving an imbalance behind it.",
  ifvg: "A gap that was filled and then rejected from the other side.",
  order_block: "The last opposing candle before the displacement leg.",
  mss: "Price closing through the last opposing swing point.",
  cisd: "Close through the open of the originating candle series.",
  ote: "Retrace into 61.8–79% of the post-sweep leg.",
  smt: "NQ and ES disagreeing at the same swing — one made the high, one did not.",
  pd: "Which half of the dealing range price is trading in.",
  weekly_pd: "Where price sits against the weekly range.",
  structure: "Higher highs and higher lows, or the reverse, still intact.",
  mid_bias: "The intermediate-term swing direction.",
  htf2_bias: "The second higher timeframe agreeing with the trade.",
  daily_bias: "The daily candle's direction.",
  opening_bias: "Position relative to the session open.",
  mechanical_model: "The full ordered sweep → displace → invert → retest.",
  breaker: "A failed order block price has traded back through.",
  mitigation: "A block price returned to and respected.",
  rejection: "A long wick refusing a level.",
  propulsion: "Continuation from inside a prior block.",
};

/** Heaviest first. A `must` outranks a structure key; redundant ranks last. */
const CHANNEL_RANK: DriverChannel[] = [
  "must",
  "anyof-sole",
  "structure",
  "nice",
  "unscored",
  "anyof-redundant",
];

function heaviest(channels: DriverChannel[]): DriverChannel {
  for (const c of CHANNEL_RANK) if (channels.includes(c)) return c;
  return channels[0] ?? "unscored";
}

/**
 * Every component on the tape, with what it is actually worth to this
 * strategy's fit. Sorted by contribution, because the chart should label the
 * load-bearing marks first when space runs out.
 */
export function scoreDrivers(
  strategyId: string,
  components: readonly string[],
  /**
   * The session flags the card was graded with. They must be passed: they
   * move `fit` by up to 0.08 and decide which side of the not-complete floor
   * a removal lands on, so grading the counterfactual without them would
   * measure a different card than the one on screen.
   */
  opts?: { htfOk?: boolean; killzoneOk?: boolean; conditionsOk?: boolean },
): ScoreDriver[] {
  const t = templateFor(strategyId);
  const set = new Set(components);
  const structureSet = new Set<string>(SMC_STRUCTURE_KEYS);
  const list = [...components];
  const baseFit = gradeStrategyAgainstMarket(strategyId, list, opts).fit;
  const without = (k: string) => list.filter((c) => c !== k);

  const out: ScoreDriver[] = [];

  for (const raw of components) {
    const key = raw as ComponentKey;
    if (!(key in WEIGHTS)) continue;

    // A component can pay into SEVERAL channels at once and the engine sums
    // them independently, so this must accumulate rather than pick the first
    // match. `tjr` is the case that proves it: `ifvg` sits in both an any-of
    // group and in `nice`, and an else-if chain that stopped at the any-of
    // reported 0 points for something worth 0.048 of fit.
    const channels: DriverChannel[] = [];
    let points = 0;

    // Which channels this key pays into. Classification only — the POINTS come
    // from the engine below, never from re-deriving its formula here.
    if (structureSet.has(key)) channels.push("structure");
    if (t) {
      if (t.must.includes(key)) channels.push("must");
      for (const group of t.mustAnyOf ?? []) {
        if (!group.includes(key)) continue;
        const siblings = group.filter((c) => c !== key && set.has(c));
        channels.push(siblings.length > 0 ? "anyof-redundant" : "anyof-sole");
      }
      if (t.nice.includes(key)) channels.push("nice");
    }

    if (channels.length === 0) channels.push("unscored");

    // THE NUMBER: grade the tape without this component and take the drop.
    //
    // This module used to mirror the formula — structureQ share plus modelQ
    // share — and it was wrong by up to 24 points on exactly the components
    // that matter most. `gradeStrategyAgainstMarket` also adds a +0.03
    // completeness bonus and, when a strategy is neither complete nor near,
    // clamps `fit` down to PROFIT_ACTION_FLOOR - 0.02. Removing a `must`
    // breaks completeness, so it loses the bonus AND trips the floor. A
    // mirror that models neither showed `sweep_significant` as 12p on an A+
    // mechanical card where removing the raid actually takes 0.9257 to 0.63 —
    // A+ to C, a no-trade. The chart understated the load-bearing mark by 3x.
    //
    // Differencing is also simply what the figure MEANS ("how much would fit
    // drop without this"), so there is no second formula left to drift.
    // Cost is one extra pure grade per component per card: arithmetic over a
    // Set, no fetches, still deterministic.
    points = baseFit - gradeStrategyAgainstMarket(strategyId, without(key), opts).fit;
    if (points < 0) points = 0;

    out.push({
      key,
      label: LABELS[key] ?? key,
      // The heaviest channel, for a one-word badge. Ordered explicitly rather
      // than taking the first push: push order is structure → must → any-of →
      // nice, so "first non-redundant" named `structure` for a key that is
      // also a must, which is the lighter of the two.
      channel: heaviest(channels),
      channels,
      points: +points.toFixed(4),
      pts100: +(points * 100).toFixed(1),
      draws: DRAWN_AS[key] ?? null,
      what: WHAT[key] ?? "",
    });
  }

  return out.sort((a, b) => b.points - a.points || a.label.localeCompare(b.label));
}

/**
 * What the marks are JOINTLY resting on — never a reconstruction of the score.
 *
 * The earlier version of this function summed the drivers and asserted the
 * total was exact within 0.09. That claim cannot hold and was actively
 * harmful: on the A+ mechanical card above it returned `exact: true` while
 * certifying figures that were three times too small.
 *
 * Marginal contributions through a threshold overlap by construction, so the
 * sum OVERSTATES once more than one component is load-bearing. It is still
 * worth showing — "these marks are carrying the card" is the real question —
 * so it is returned as an overlapping total that says it overlaps.
 */
export function reconstruct(
  drivers: ScoreDriver[],
  actualFit: number,
): { summed: number; overlaps: boolean; note: string } {
  const summed = +drivers.reduce((a, d) => a + d.points, 0).toFixed(4);
  const load = drivers.filter((d) => d.points > 0).length;
  const overlaps = summed > actualFit + 1e-9;
  return {
    summed,
    overlaps,
    note: overlaps
      ? `${load} components are each load-bearing; their drops overlap through the completeness floor, so they do not add up to ${(actualFit * 100).toFixed(0)}.`
      : `${load} components carry ${(summed * 100).toFixed(0)} of ${(actualFit * 100).toFixed(0)} points.`,
  };
}

/** The handful worth labelling on a small chart, most load-bearing first. */
export function topDrivers(drivers: ScoreDriver[], n = 5): ScoreDriver[] {
  return drivers.filter((d) => d.points > 0).slice(0, n);
}

/**
 * The components a template wants that the tape has NOT produced. This is the
 * "what to anticipate" half — a chart that only draws what already printed
 * cannot tell you what you are waiting for.
 */
export function missingDrivers(
  strategyId: string,
  components: readonly string[],
): { key: ComponentKey; label: string; channel: "must" | "anyof" | "nice"; what: string }[] {
  const t = templateFor(strategyId);
  if (!t) return [];
  const set = new Set(components);
  const out: { key: ComponentKey; label: string; channel: "must" | "anyof" | "nice"; what: string }[] = [];

  for (const m of t.must) {
    if (!set.has(m)) out.push({ key: m, label: LABELS[m] ?? m, channel: "must", what: WHAT[m] ?? "" });
  }
  for (const g of t.mustAnyOf ?? []) {
    if (!g.some((c) => set.has(c))) {
      for (const c of g) {
        out.push({ key: c, label: LABELS[c] ?? c, channel: "anyof", what: WHAT[c] ?? "" });
      }
    }
  }
  for (const n of t.nice) {
    if (!set.has(n)) out.push({ key: n, label: LABELS[n] ?? n, channel: "nice", what: WHAT[n] ?? "" });
  }
  return out;
}
