/**
 * Worked scenarios — the same subject in several dresses.
 *
 * One figure per concept teaches recognition of that figure. Mastery is
 * recognising the concept when it arrives wearing something else: the raid
 * that is actually a breakout, the shift that printed before the sweep, the
 * bias that reads bullish on the daily and is overridden anyway. So each
 * subject carries a set of scenarios — the textbook case, the near-miss, and
 * the trap — each ending in the word the desk would actually print.
 *
 * Every scenario names a verdict (TAKE / WAIT / STAND) because a lesson that
 * stops at "here is what a sweep looks like" has not taught the decision. The
 * verdicts follow this desk's own gates, not generic SMC: where a scenario
 * says STAND it is because smc-master.ts would refuse it, and the reason given
 * is the layer that refuses.
 *
 * Built on `tape.ts`, so annotations are derived from what was drawn rather
 * than from hand-picked bar indices.
 */

import type { Figure, FigureBar, FigureMark } from "./figures";
import { getFigure } from "./figures";
import { tape, type Tape } from "./tape";

export type Verdict = "TAKE" | "WAIT" | "STAND";

export interface Scenario {
  id: string;
  moduleId: string;
  /** Short label for the tab strip. */
  name: string;
  /** What you are looking at, before any judgement. */
  situation: string;
  figure: Figure;
  verdict: Verdict;
  /** The reasoning, in the desk's own terms. */
  read: string;
}

function fig(id: string, caption: string, t: Tape, marks: FigureMark[]): Figure {
  const real = getFigure(id);
  if (real?.bars?.length && real.id === id) {
    // Historic slice, but this is a SCENARIO — Ring 2. Drop contrast
    // right/wrong banners; the scenario's own TAKE/WAIT/STAND is the verdict.
    return { ...real, caption, verdict: undefined };
  }
  return { id, caption, bars: t.bars, marks };
}

/* ── Bias: reading structure ─────────────────────────────────────────────── */

/**
 * The last two swing highs and lows, found as PIVOTS.
 *
 * An earlier version split the series in half and took each half's extreme.
 * That is fragile in exactly the place it matters: the boundary tends to land
 * next to a trough, so the "second" low is the same low as the first, one bar
 * later, and a compression tape reads as a downtrend. Pivots — a bar that is
 * the extreme of a window either side of it — have no such boundary, and it
 * is what structure.ts does with real bars.
 */
export function swingPoints(t: { bars: FigureBar[] }): {
  h1: number;
  h2: number;
  l1: number;
  l2: number;
  iH1: number;
  iH2: number;
  iL1: number;
  iL2: number;
} {
  const b = t.bars;
  const K = 2; // bars either side that a pivot must beat
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = K; i < b.length - K; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - K; j <= i + K; j++) {
      if (j === i) continue;
      if (b[j]!.h >= b[i]!.h) isHigh = false;
      if (b[j]!.l <= b[i]!.l) isLow = false;
    }
    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }
  /**
   * The last two pivots, or a separated fallback.
   *
   * The fallback must never return ADJACENT bars: two lows one bar apart are
   * the same low, and comparing them produces a meaningless verdict — which
   * is exactly how a compression tape came to read as a downtrend. Candidates
   * must sit at least K+1 bars apart to count as two distinct swings.
   */
  const pickTwo = (idx: number[], kind: "h" | "l"): [number, number] => {
    if (idx.length >= 2) return [idx[idx.length - 2]!, idx[idx.length - 1]!];
    const all = b.map((_, i) => i);
    const better = (x: number, y: number) => (kind === "h" ? b[x]!.h > b[y]!.h : b[x]!.l < b[y]!.l);
    const sorted = [...all].sort((x, y) => (better(x, y) ? -1 : 1));
    const first = sorted[0]!;
    const second = sorted.find((i) => Math.abs(i - first) > K) ?? sorted[1]!;
    return first < second ? [first, second] : [second, first];
  };
  const [iH1, iH2] = pickTwo(highs, "h");
  const [iL1, iL2] = pickTwo(lows, "l");
  return { h1: b[iH1]!.h, h2: b[iH2]!.h, l1: b[iL1]!.l, l2: b[iL2]!.l, iH1, iH2, iL1, iL2 };
}

/**
 * Structure by the desk's rule: HH AND HL = bull, LH AND LL = bear, anything
 * mixed = neutral. Exported so the verification suite can assert that a
 * scenario's TAPE actually shows the structure its text claims.
 */
export function structureOf(t: { bars: FigureBar[] }): "bull" | "bear" | "neutral" {
  const s = swingPoints(t);
  if (s.h2 > s.h1 && s.l2 > s.l1) return "bull";
  if (s.h2 < s.h1 && s.l2 < s.l1) return "bear";
  return "neutral";
}

/**
 * Swing labels DERIVED from the prices, never passed in.
 *
 * The first version took the labels as arguments, and a fixture that did not
 * actually make a higher high still rendered "HIGHER high" next to a lower
 * one — a diagram teaching the exact opposite of its lesson, which no
 * well-formedness check can catch. Deriving them makes that impossible.
 */
function swingMarks(t: { bars: FigureBar[] }): FigureMark[] {
  const s = swingPoints(t);
  return [
    { kind: "point", bar: s.iH1, price: s.h1, label: "prior high", tone: "neutral" },
    {
      kind: "point",
      bar: s.iH2,
      price: s.h2,
      label: s.h2 > s.h1 ? "HIGHER high" : "LOWER high",
      tone: s.h2 > s.h1 ? "good" : "bad",
    },
    { kind: "point", bar: s.iL1, price: s.l1, label: "prior low", tone: "neutral" },
    {
      kind: "point",
      bar: s.iL2,
      price: s.l2,
      label: s.l2 > s.l1 ? "HIGHER low" : "LOWER low",
      tone: s.l2 > s.l1 ? "good" : "bad",
    },
  ];
}

function biasScenarios(): Scenario[] {
  // Each tape is built so the SECOND half's extremes land where the lesson
  // says. Verified in scripts/verify-curriculum.mjs, which recomputes the
  // structure from the bars and compares it to the claim.
  // Each ends with a short counter-leg so the FINAL swing has bars on both
  // sides of it and registers as a pivot. Without that tail the last low is
  // the last bar, which can never be a pivot, and the swing read silently
  // falls back to comparing two points that are really one.
  const bull = tape(100, 3).leg(5, 4).leg(4, -3).leg(6, 5).leg(5, -2.6).leg(3, 1.5); // HH + HL
  const bear = tape(140, 5).leg(4, 2).leg(5, -5.6).leg(5, 3.6).leg(6, -5).leg(3, 1.8); // LH + LL
  const expand = tape(120, 11).leg(5, 4).leg(5, -5).leg(5, 8).leg(6, -8.3).leg(3, 2); // HH + LL
  // The second-half minimum must clear the first-half minimum with room to
  // spare: the halving boundary sits right after leg 2's trough, so a shallow
  // leg 3 lets the trough itself count as the "second" low and the tape reads
  // bear. Low noise and a steep leg 3 keep the two lows genuinely apart.
  const coil = tape(120, 17).leg(5, 5, 2).leg(5, -7, 2).leg(6, 6, 2).leg(5, -2.5, 2).leg(3, 1.4, 2); // LH + HL

  return [
    {
      id: "bias-bull",
      moduleId: "bias-structure",
      name: "Clean bull",
      situation: "Each swing high is above the last, and each swing low is above the last.",
      figure: fig(
        "bias-bull",
        "Higher high AND higher low. Both conditions, not one.",
        bull,
        swingMarks(bull),
      ),
      verdict: "TAKE",
      read: "Bull. Longs are permitted from discount. This is the only structure that returns 'bull' — a higher high on its own does not, because price can make a new high and still be breaking down underneath it.",
    },
    {
      id: "bias-bear",
      moduleId: "bias-structure",
      name: "Clean bear",
      situation: "Each swing high is below the last, and each swing low is below the last.",
      figure: fig(
        "bias-bear",
        "Lower high AND lower low.",
        bear,
        swingMarks(bear),
      ),
      verdict: "TAKE",
      read: "Bear. Shorts are permitted from premium. The gold-standard book on this desk is a short with mechanical confirmation and clean risk-off, and it starts here.",
    },
    {
      id: "bias-expansion",
      moduleId: "bias-structure",
      name: "Higher high, LOWER low",
      situation: "Price made a new high, then a new low. Both extremes extended.",
      figure: fig(
        "bias-expansion",
        "Expansion: both ends extended. Structure says nothing directional.",
        expand,
        swingMarks(expand),
      ),
      verdict: "STAND",
      read: "Neutral, not bullish. The rule needs BOTH conditions: higher high AND higher low. A higher high against a lower low is expansion — the range is widening and there is no trend to lean on. This is the shape that most often gets read as a breakout.",
    },
    {
      id: "bias-coil",
      moduleId: "bias-structure",
      name: "Lower high, HIGHER low",
      situation: "The range is narrowing from both sides.",
      figure: fig(
        "bias-coil",
        "Compression: highs falling, lows rising. Also neutral.",
        coil,
        swingMarks(coil),
      ),
      verdict: "STAND",
      read: "Neutral. Compression resolves violently and in a direction structure cannot yet name. Waiting costs one setup; guessing the break costs the stop plus the reversal.",
    },
  ];
}

/* ── Bias: which one to lean toward when they disagree ───────────────────── */

function conflictScenarios(): Scenario[] {
  const aligned = tape(100, 23).leg(6, -2.4).leg(4, 1.2).leg(7, -2.6).leg(5, 1.0);
  const t2 = tape(100, 29).leg(6, 2.4).leg(5, -1.0).leg(6, 2.2).leg(6, -2.6);
  const hi2 = t2.marks.high;
  const lo2 = t2.marks.low;
  const eq2 = (hi2 + lo2) / 2;

  const t3 = tape(140, 31).leg(6, -2.4).leg(5, 1.0).leg(6, -2.2).leg(6, 2.6);
  const hi3 = t3.marks.high;
  const lo3 = t3.marks.low;
  const eq3 = (hi3 + lo3) / 2;

  return [
    {
      id: "conflict-aligned",
      moduleId: "bias-conflict",
      name: "All three agree",
      situation: "Daily bear, mid bear, and the last break of structure was bearish.",
      figure: fig("conflict-aligned", "Three votes, one direction.", aligned, [
        { kind: "level", price: aligned.swingLow(8), label: "last BOS — bearish", tone: "bad", dash: true },
      ]),
      verdict: "TAKE",
      read: "Bear, at high confidence. The desk votes daily, mid and the last BOS; unanimity is what pushes confidence up. Every additional timeframe that agrees adds to it, and confidence is what separates a probe from full size.",
    },
    {
      id: "conflict-premium-override",
      moduleId: "bias-conflict",
      name: "Daily bull, mid bear, price expensive",
      situation: "The daily still reads bull. The mid timeframe has turned bear. Price is in the upper half of the range.",
      figure: fig("conflict-premium-override", "The vote says bull. The override says neutral.", t2, [
        { kind: "zone", top: hi2, bottom: eq2, label: "premium — price is here", tone: "bad" },
        { kind: "level", price: eq2, label: "EQ", tone: "neutral", dash: true },
      ]),
      verdict: "STAND",
      read: "The desk forces this to NEUTRAL, and this is the single most useful rule it has. A majority vote would return bull, but holding a bullish bias while price is expensive AND the mid timeframe has already turned is how you buy the top of a distribution. Two of three votes is not enough when the disagreeing one is the timeframe you actually trade and price is in the wrong half.",
    },
    {
      id: "conflict-discount-override",
      moduleId: "bias-conflict",
      name: "Daily bear, mid bull, price cheap",
      situation: "The mirror: daily bear, mid turned bull, price in the lower half.",
      figure: fig("conflict-discount-override", "The same override, the other way up.", t3, [
        { kind: "zone", top: eq3, bottom: lo3, label: "discount — price is here", tone: "good" },
        { kind: "level", price: eq3, label: "EQ", tone: "neutral", dash: true },
      ]),
      verdict: "STAND",
      read: "Forced to NEUTRAL again. Shorting something already cheap while the mid timeframe has turned up is selling into the pool that is about to be bid. Neutral is a real answer — it means no book today, not 'pick the one you like'.",
    },
  ];
}

/* ── Bias: when you may trade against it ─────────────────────────────────── */

function againstScenarios(): Scenario[] {
  const sweepOnly = tape(100, 37).leg(8, -1.8).leg(4, 0.6);
  const pool1 = sweepOnly.swingLow(6);
  sweepOnly.raidDown(pool1, 7).leg(5, 0.8);

  const full = tape(100, 41).leg(8, -1.8).leg(3, 0.5);
  const pool2 = full.swingLow(6);
  full.raidDown(pool2, 7);
  full.displaceUp(16);
  full.leg(6, 2.2);

  const stale = tape(100, 43).leg(5, -1.6);
  const pool3 = stale.swingLow(4);
  stale.raidDown(pool3, 6);
  stale.displaceUp(14);
  stale.leg(18, 0.15); // distribution happened, then nothing for a long time

  return [
    {
      id: "against-sweep-only",
      moduleId: "bias-against",
      name: "Sweep only",
      situation: "HTF is bear. Price raided the lows and bounced.",
      figure: fig("against-sweep-only", "A raid, and then nothing. Manipulation without distribution.", sweepOnly, [
        { kind: "level", price: pool1, label: "SSL", tone: "warn", dash: true },
        {
          kind: "point",
          bar: sweepOnly.marks.raidBar!,
          price: sweepOnly.marks.raidPrice!,
          label: "raided",
          tone: "warn",
        },
      ]),
      verdict: "STAND",
      read: "Not enough to go long against a bear HTF. A sweep is manipulation — it says stops were taken, not that control changed hands. Every downtrend is full of sweeps that resolve lower. The gate stays shut.",
    },
    {
      id: "against-full",
      moduleId: "bias-against",
      name: "Sweep, displacement, distribution",
      situation: "Same bear HTF. This time the raid is followed by a wide body up and continued delivery higher.",
      figure: fig("against-full", "The full signature: manipulation AND distribution.", full, [
        { kind: "level", price: pool2, label: "SSL", tone: "warn", dash: true },
        { kind: "point", bar: full.marks.raidBar!, price: full.marks.raidPrice!, label: "raided", tone: "warn" },
        {
          kind: "point",
          bar: full.marks.displaceBar!,
          price: full.bars[full.marks.displaceBar!]!.c,
          label: "displacement up",
          tone: "good",
        },
      ]),
      verdict: "TAKE",
      read: "The counter-bias gate releases. HTF bias is absolute until disrespected AND distributed — both halves, recently. The release is auditable: the desk lists each requirement and whether it passed, so a counter-trend trade is never indistinguishable from a with-trend one. It is still a counter-bias trade, and it is documented as one.",
    },
    {
      id: "against-stale",
      moduleId: "bias-against",
      name: "Distribution, but old",
      situation: "The signature printed — but a long time ago, and price has gone quiet since.",
      figure: fig("against-stale", "Right shape, wrong age.", stale, [
        { kind: "level", price: pool3, label: "SSL", tone: "warn", dash: true },
        {
          kind: "point",
          bar: stale.marks.displaceBar!,
          price: stale.bars[stale.marks.displaceBar!]!.c,
          label: "displacement — but stale",
          tone: "bad",
        },
      ]),
      verdict: "STAND",
      read: "Recency is part of the rule, not a refinement of it. The claim being made is that the market is CURRENTLY distributing; evidence from long ago cannot support a claim about now. Displacement must be recent for the release to hold.",
    },
  ];
}

/* ── The raid, in four dresses ───────────────────────────────────────────── */

function sweepScenarios(): Scenario[] {
  // The pool is the PRIOR swing high, captured before price pulls away from
  // it — not a local high of the last few bars, which is what an earlier
  // version used and which put the level in the wrong place.
  const clean = tape(100, 7).leg(6, 1.8, 3);
  const poolA = clean.swingHigh();
  clean.leg(5, -1.6, 3).leg(4, 1.2, 3);
  clean.raidUp(poolA, 7).leg(7, -2.2, 3);

  const broke = tape(100, 7).leg(6, 1.8, 3);
  const poolB = broke.swingHigh();
  broke.leg(5, -1.6, 3).leg(4, 1.2, 3);
  broke.breakUp(poolB, 6).leg(7, 2.4, 3);

  const polarity = tape(100, 13).leg(6, -1.6).leg(4, 1.0);
  const poolC = polarity.swingLow(5);
  polarity.raidDown(poolC, 7).leg(8, 1.8);

  const stale = tape(100, 19).leg(4, 1.4);
  const poolD = stale.swingHigh(3);
  stale.raidUp(poolD, 6).leg(22, -0.25);

  return [
    {
      id: "sweep-clean",
      moduleId: "sweep",
      name: "Clean raid",
      situation: "Price runs through equal highs and closes back underneath them.",
      figure: fig("sweep-clean", "Wick through, body back inside. This is the trigger.", clean, [
        { kind: "level", price: poolA, label: "BSL — equal highs", tone: "warn", dash: true },
        { kind: "point", bar: clean.marks.raidBar!, price: clean.marks.raidPrice!, label: "closed back under", tone: "good" },
        { kind: "split", bar: clean.marks.raidBar!, label: "sequence starts here", tone: "accent" },
      ]),
      verdict: "WAIT",
      read: "The raid is valid, and it arms a SHORT — but a raid alone is not an entry. The sequence still needs the shift and the retrace. WAIT is the honest word here; a valid raid is permission to keep reading, not to click.",
    },
    {
      id: "sweep-breakout",
      moduleId: "sweep",
      name: "Breakout, not a raid",
      situation: "Same pool. This time the candle closes above it and the next bars hold above.",
      figure: fig("sweep-breakout", "Closed beyond and held. Acceptance.", broke, [
        { kind: "level", price: poolB, label: "BSL — equal highs", tone: "warn", dash: true },
        {
          kind: "point",
          bar: broke.marks.breakBar!,
          price: broke.bars[broke.marks.breakBar!]!.c,
          label: "closed ABOVE",
          tone: "bad",
        },
      ]),
      verdict: "STAND",
      read: "Do not fade this. The level broke, and the stop for a short would sit on the correct side of a move that is still accelerating. This is the most expensive error in the model because it inverts the trade rather than merely mistiming it.",
    },
    {
      id: "sweep-polarity",
      moduleId: "sweep",
      name: "Right raid, wrong side",
      situation: "A clean raid — of the LOWS — while you were looking for a short.",
      figure: fig("sweep-polarity", "A valid raid that arms the opposite direction.", polarity, [
        { kind: "level", price: poolC, label: "SSL — prior lows", tone: "warn", dash: true },
        { kind: "point", bar: polarity.marks.raidBar!, price: polarity.marks.raidPrice!, label: "sellside raid", tone: "good" },
      ]),
      verdict: "STAND",
      read: "Polarity has to match the direction. A sellside raid takes sell stops and arms a LONG; it is not evidence for a short, no matter how clean it is. The desk checks this explicitly — a short requires a buyside raid — because 'there was a sweep' is not the same claim as 'there was a sweep of the right pool'.",
    },
    {
      id: "sweep-stale",
      moduleId: "sweep",
      name: "Valid raid, hours ago",
      situation: "The raid was textbook. It was also a long time ago, and price has drifted since.",
      figure: fig("sweep-stale", "Correct shape, expired.", stale, [
        { kind: "level", price: poolD, label: "BSL", tone: "warn", dash: true },
        { kind: "point", bar: stale.marks.raidBar!, price: stale.marks.raidPrice!, label: "raided — long ago", tone: "bad" },
      ]),
      verdict: "STAND",
      read: "A raid has a shelf life. The liquidity it collected has already been used or abandoned, and the order flow that made the rejection is gone. The desk bounds sweep recency in bars for exactly this reason — history is context, not a trigger.",
    },
  ];
}

/* ── Where in the range ──────────────────────────────────────────────────── */

function rangeScenarios(): Scenario[] {
  const prem = tape(100, 53).leg(6, 2.2).leg(5, -1.6).leg(6, 2.4).leg(3, -0.8);
  const premHi = prem.marks.high;
  const premLo = prem.marks.low;
  const premEq = (premHi + premLo) / 2;

  const disc = tape(100, 59).leg(6, 2.2).leg(5, -1.6).leg(6, 2.0).leg(8, -3.0);
  const discHi = disc.marks.high;
  const discLo = disc.marks.low;
  const discEq = (discHi + discLo) / 2;

  const eqChop = tape(100, 61).leg(6, 2.4).leg(6, -2.6).chop(10, 4);
  const eqHi = eqChop.marks.high;
  const eqLo = eqChop.marks.low;
  const eqMid = (eqHi + eqLo) / 2;

  return [
    {
      id: "range-premium-short",
      moduleId: "range",
      name: "Short from premium",
      situation: "You want a short. Price is in the upper half of the dealing range.",
      figure: fig("range-premium-short", "Selling something expensive.", prem, [
        { kind: "zone", top: premHi, bottom: premEq, label: "premium", tone: "bad" },
        { kind: "zone", top: premEq, bottom: premLo, label: "discount", tone: "good" },
        { kind: "level", price: premEq, label: "EQ", tone: "neutral", dash: true },
      ]),
      verdict: "TAKE",
      read: "Correct half. The dealing-range layer passes. This is the mechanical version of 'sell high' — you are short from the expensive end, so the draw toward the lows is in front of you rather than behind.",
    },
    {
      id: "range-discount-short",
      moduleId: "range",
      name: "Short from discount",
      situation: "Same short idea, but price has already fallen to the lower half.",
      figure: fig("range-discount-short", "Selling something already cheap.", disc, [
        { kind: "zone", top: discHi, bottom: discEq, label: "premium", tone: "bad" },
        { kind: "zone", top: discEq, bottom: discLo, label: "discount — price is here", tone: "good" },
        { kind: "level", price: discEq, label: "EQ", tone: "neutral", dash: true },
      ]),
      verdict: "STAND",
      read: "Wrong half, and this is a must-layer, so it is fatal on its own. It looks weak because it is sitting where buyers are waiting. The move you want already happened; the trade left is the retrace against you.",
    },
    {
      id: "range-eq",
      moduleId: "range",
      name: "Sitting on equilibrium",
      situation: "Price is oscillating around the midpoint.",
      figure: fig("range-eq", "No edge in either direction.", eqChop, [
        { kind: "zone", top: eqHi, bottom: eqMid, label: "premium", tone: "bad" },
        { kind: "zone", top: eqMid, bottom: eqLo, label: "discount", tone: "good" },
        { kind: "level", price: eqMid, label: "EQ — price is here", tone: "neutral" },
      ]),
      verdict: "STAND",
      read: "At EQ you are neither buying cheap nor selling expensive, and the stop has to clear noise in both directions. There is no version of this trade with a good R. Skips on days like this are process wins, not missed opportunities.",
    },
  ];
}

/* ── The shift ───────────────────────────────────────────────────────────── */

function shiftScenarios(): Scenario[] {
  const good = tape(100, 67).leg(5, 1.4).leg(4, -1.6).leg(4, 1.2);
  const protectedLow = good.swingLow(5);
  good.leg(2, -1.0);
  good.displaceDown(15);
  good.leg(6, -1.8);

  const wick = tape(100, 71).leg(5, 1.4).leg(4, -1.6).leg(4, 1.2);
  const protectedLow2 = wick.swingLow(5);
  wick.leg(2, -1.0);
  // Pokes below and closes back up — no shift.
  wick.raidDown(protectedLow2, 6);
  wick.leg(7, 0.9);

  const early = tape(100, 73).leg(3, -1.2);
  early.displaceDown(14);
  early.leg(3, 1.4);
  const poolE = early.swingHigh(4);
  early.raidUp(poolE, 6).leg(7, -1.2);

  return [
    {
      id: "shift-clean",
      moduleId: "shift",
      name: "Body closes through",
      situation: "A wide candle closes below the last protected low.",
      figure: fig("shift-clean", "Displacement through structure. This is a shift.", good, [
        { kind: "level", price: protectedLow, label: "protected low", tone: "warn", dash: true },
        {
          kind: "point",
          bar: good.marks.displaceBar!,
          price: good.bars[good.marks.displaceBar!]!.c,
          label: "MSS — closed through",
          tone: "good",
        },
      ]),
      verdict: "WAIT",
      read: "The shift is confirmed and it left a gap behind it. Still WAIT, not TAKE — the entry is the retrace into that gap, and price has not come back yet.",
    },
    {
      id: "shift-wick",
      moduleId: "shift",
      name: "Wick through only",
      situation: "Price traded below the level intrabar, then closed back above it.",
      figure: fig("shift-wick", "Through on the wick, back above on the close.", wick, [
        { kind: "level", price: protectedLow2, label: "protected low", tone: "warn", dash: true },
        { kind: "point", bar: wick.marks.raidBar!, price: wick.marks.raidPrice!, label: "no close through", tone: "bad" },
      ]),
      verdict: "STAND",
      read: "Not a shift — the opposite. A wick through that closes back inside is a raid of the lows, which arms a LONG. Reading this as a bearish break is how a trader ends up short at the exact low.",
    },
    {
      id: "shift-early",
      moduleId: "shift",
      name: "Displacement before the raid",
      situation: "There is a big body and a raid. The body printed first.",
      figure: fig("shift-early", "Right ingredients, wrong order.", early, [
        {
          kind: "point",
          bar: early.marks.displaceBar!,
          price: early.bars[early.marks.displaceBar!]!.c,
          label: "displacement (earlier)",
          tone: "bad",
        },
        { kind: "level", price: poolE, label: "BSL", tone: "warn", dash: true },
        { kind: "point", bar: early.marks.raidBar!, price: early.marks.raidPrice!, label: "raid (later)", tone: "warn" },
      ]),
      verdict: "STAND",
      read: "That body is the leg INTO the raid, not the reaction to it. The desk requires the displacement to print later than the sweep it belongs to, precisely so this cannot be scored as a shift. Order is the model — the same two events in the other sequence are a different market.",
    },
  ];
}

/* ── The entry ───────────────────────────────────────────────────────────── */

function retraceScenarios(): Scenario[] {
  const back = tape(100, 79).leg(4, 1.4);
  const poolR = back.swingHigh(3);
  back.raidUp(poolR, 6);
  back.displaceDown(14);
  const gapBack = back.marks.gap!;
  back.pullbackTo(gapBack.bottom + (gapBack.top - gapBack.bottom) * 0.6, 5);
  back.leg(8, -2.0);

  const never = tape(100, 83).leg(4, 1.4);
  const poolN = never.swingHigh(3);
  never.raidUp(poolN, 6);
  never.displaceDown(14);
  const gapNever = never.marks.gap!;
  never.leg(10, -2.2); // just keeps going

  return [
    {
      id: "retrace-into",
      moduleId: "retrace",
      name: "Price comes back",
      situation: "After the shift, price trades back up into the gap.",
      figure: fig("retrace-into", "Inside the array. This is the entry.", back, [
        { kind: "zone", top: gapBack.top, bottom: gapBack.bottom, label: "FVG", tone: "accent", from: back.marks.displaceBar! - 1 },
        { kind: "point", bar: back.marks.pullbackBar!, price: back.marks.pullbackPrice!, label: "entry", tone: "good" },
        { kind: "level", price: back.marks.raidPrice!, label: "stop beyond the raid", tone: "bad", dash: true },
      ]),
      verdict: "TAKE",
      read: "Every layer is present and in order: raid, shift, price inside a fresh array formed after the raid. The stop goes beyond the raid wick, which makes the risk small and defined. This is the trade.",
    },
    {
      id: "retrace-never",
      moduleId: "retrace",
      name: "Price never comes back",
      situation: "The shift was clean. Price kept going and never returned to the gap.",
      figure: fig("retrace-never", "A correct read that never offered an entry.", never, [
        { kind: "zone", top: gapNever.top, bottom: gapNever.bottom, label: "FVG — never filled", tone: "accent", from: never.marks.displaceBar! - 1 },
        { kind: "point", bar: never.length - 1, price: never.bars[never.length - 1]!.c, label: "price is here", tone: "bad" },
      ]),
      verdict: "STAND",
      read: "This is the hardest one to accept, because the direction was right and the move happened without you. It is still not a trade: entering here puts the stop the full distance away, and the first ordinary retrace takes it out. The desk names the distance to the array and says do not chase — a correct read you could not enter is a normal outcome, not a failure.",
    },
  ];
}

/* ── Export ──────────────────────────────────────────────────────────────── */

export const SCENARIOS: Scenario[] = [
  ...biasScenarios(),
  ...conflictScenarios(),
  ...againstScenarios(),
  ...sweepScenarios(),
  ...rangeScenarios(),
  ...shiftScenarios(),
  ...retraceScenarios(),
];

/** The bias tapes, exposed so the suite can assert claimed vs actual structure. */
export const BIAS_TAPES = {
  "bias-bull": "bull",
  "bias-bear": "bear",
  "bias-expansion": "neutral",
  "bias-coil": "neutral",
} as const;

export function scenariosFor(moduleId: string): Scenario[] {
  return SCENARIOS.filter((s) => s.moduleId === moduleId);
}
