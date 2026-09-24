/**
 * The setup drawn BEFORE it exists — what has printed, and what you are
 * waiting to see.
 *
 * WHY THIS IS NOT JUST "SHOW THE CHART WHEN THE SCORE IS HIGH"
 * The desk can print A+ 0.95 next to "SMC skip 1/5". Those measure different
 * things — the engine grades how well a MODEL fits the tape, the sequence
 * grades how much of the TRADE has printed — and a chart drawn on the engine
 * score alone is a picture of a model's opinion, which is exactly the print a
 * trader should not be chasing.
 *
 * So the markup is drawn at a high score, but it is drawn HONESTLY: every
 * element carries whether it has PRINTED, is AWAITED, or is DEAD for the
 * session. That is how an SMC trader actually marks a chart — the pool, the
 * expected raid, the displacement and the entry array go on the chart before
 * any of them happen, and get confirmed one at a time. A markup with no
 * anticipation in it is a screenshot taken after the fact.
 *
 * WHAT EACH ELEMENT CARRIES
 * `watchFor` is the sentence that makes this useful at 09:35: not "sweep:
 * missing" but "price must trade above 7848.50 and close back under it".
 * Anticipated levels are PRICED wherever the tape allows — the pool that must
 * be raided has a price today, even though the raid has not happened — so the
 * line can be drawn where the event will occur rather than floated in a
 * legend.
 *
 * THE FLASH IS THE LAST LAYER, NOT THE FIRST
 * Green means every must-layer has printed AND price is in the array now.
 * Nothing else earns it. A card that is one layer short is drawn, labelled,
 * and deliberately not flashing — because the entire failure mode this desk
 * has measured is entering early on a setup that looked nearly ready.
 *
 * AND A TARGET NOBODY CAN REACH IS A WARNING, NOT A TARGET
 * On 2026-09-23 the board showed two A+ cards (0.95 and 0.94) whose draws sat
 * 4.18 and 8.33 ATR away with a 0% base rate — "0 of the last 24 sessions
 * travelled that far". The engine loved a setup whose target has never once
 * printed from here. `targetReachable` puts that on the chart instead of
 * leaving it in small grey text under the entry.
 */

import type { SetupCandidate } from "./scanner";
import type { CanonStack } from "./smc-canon";
import type { LiquidityTarget } from "./draw";

/** Engine score at or above which the setup is worth drawing. */
export const MARKUP_MIN_ENGINE = 0.85;
/** Or this much of the sequence, whichever comes first. */
export const MARKUP_MIN_PROGRESS = 0.7;
/**
 * A draw this far out, at a base rate this low, is not a target. Both must be
 * true — a near level at 0% is usually a thin sample, a far level at 40% is a
 * real stretch. Together they describe a level the tape does not visit.
 */
export const UNREACHABLE_MAX_REACH = 0.1;
export const UNREACHABLE_MIN_ATR = 3;

export type StepState =
  /** It happened. Draw it solid. */
  | "printed"
  /** Not yet, and it still can today. Draw it dashed — this is the watch. */
  | "awaited"
  /** Failed for this session. Draw it struck through; waiting will not fix it. */
  | "dead";

export type MarkKind =
  | "pool"
  | "sweep"
  | "displacement"
  | "array"
  | "entry"
  | "stop"
  | "target"
  | "eq";

export interface AnticipatedMark {
  kind: MarkKind;
  label: string;
  /** Where to draw it. Null when the tape has not priced it yet. */
  price: number | null;
  state: StepState;
  /** The sentence that makes this actionable: what must be SEEN. */
  watchFor: string;
}

export type EntryState =
  /** The sequence is incomplete. Nothing to arm. */
  | "not-yet"
  /** Sequence complete, price not in the array. Watch it. */
  | "armed"
  /** Sequence complete AND price is in the array. This is the flash. */
  | "live"
  /** Price has left the array or the stop is traded. */
  | "gone";

export interface SetupAnticipation {
  symbol: string;
  side: "long" | "short";
  /** Both numbers, because they disagree and the disagreement is the point. */
  engine: number;
  progress: number;
  mustPass: number;
  mustNeed: number;
  /** Whether the card earns a chart at all. */
  draw: boolean;
  drawWhy: string;
  marks: AnticipatedMark[];
  /** The single next thing, in tape terms. */
  next: string;
  entry: EntryState;
  /** Green pulse. Only ever true at `live`. */
  flash: boolean;
  targetReachable: boolean;
  targetNote: string | null;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * Is the named draw somewhere the tape actually goes?
 *
 * Reach probability alone is not enough: 0% over four sessions is noise, and a
 * level 0.3 ATR away at 20% is simply near. Distance AND base rate together
 * describe the thing worth warning about — a target the session has never
 * travelled to.
 */
export function targetReachable(draw: LiquidityTarget | null | undefined): {
  reachable: boolean;
  note: string | null;
} {
  if (!draw) return { reachable: true, note: null };
  const far = draw.distanceAtr >= UNREACHABLE_MIN_ATR;
  const rare = draw.reachProbability <= UNREACHABLE_MAX_REACH;
  if (!(far && rare)) return { reachable: true, note: null };
  return {
    reachable: false,
    note: `${draw.name} is ${draw.distanceAtr.toFixed(1)} ATR away and ${pct(draw.reachProbability)} of prior sessions reached it. This is not a target, it is a direction. Price a nearer one or stand.`,
  };
}

/**
 * A layer's state, from smc-master's own grading.
 *
 * The first version looked ids up in CanonStack.factors, which does not
 * contain `retrace`, `dol`, `target` or `clean` — so the entry-array mark could
 * never reach "printed" and rendered "price must come BACK into the array" on
 * a card that was simultaneously flashing ENTER NOW. One card, two
 * contradictory instructions, at the moment of action.
 *
 * smc-master already distinguishes pass / wait / fail properly. Use it, and
 * fall back to the canon stack only for ids smc-master does not carry.
 */
function stateOf(id: string, seq: SequenceRead | null | undefined, canon: CanonStack | undefined): StepState {
  const st = seq?.states?.[id];
  if (st === "pass") return "printed";
  if (st === "fail") return "dead";
  if (st === "wait") return "awaited";
  const f = canon?.factors?.find((x) => x.id === id);
  if (f?.pass) return "printed";
  return "awaited";
}

/**
 * The desk's OWN verdict, handed in rather than recomputed.
 *
 * This is the correction for the defect that made the first version of this
 * file BROKEN. `complete` was derived from CanonStack musts, which are five
 * (htf, sweep, pd_half, ltf, time). smc-master has NINE — those plus dol,
 * target (the >=1:1 floor), retrace and clean (Judas/news). So the flash ran
 * on a strictly weaker gate than the desk's own TAKE, and fired inside the
 * Judas window on a 0.42-confluence "skip" card with the R:R unpriced and the
 * draw pointing the wrong way. Reachable at 09:35 every morning.
 *
 * The lesson is structural, not arithmetic: ANY parallel computation of "is
 * the sequence complete" will drift from the real one. So there is no longer a
 * second computation. `word` is smc-master's, `states` are its layers, and the
 * flash is downstream of both.
 */
export interface SequenceRead {
  /** smc-master's verdict. The flash requires TAKE and nothing less. */
  word: "TAKE" | "WAIT" | "STAND";
  mustPass: number;
  mustNeed: number;
  /** Every layer id to its graded state — the real ids, not canon's subset. */
  states: Record<string, "pass" | "wait" | "fail">;
}

export interface AnticipationInput {
  c: SetupCandidate;
  canon?: CanonStack;
  /** smc-master's read for THIS side. Without it nothing can flash. */
  sequence?: SequenceRead | null;
  /**
   * Is the trader allowed to enter at all right now (risk governor, halts)?
   * The card already receives this; the flash must honour it.
   */
  entryAllowed?: boolean;
  /** The named draw, for target reachability and the target mark. */
  draw?: LiquidityTarget | null;
  /** Live price — decides `live` vs `armed`. */
  price?: number | null;
  /** The entry array, when the tape has priced one. */
  zone?: { top: number; bottom: number } | null;
  /** Pools that must be raided, for the anticipated sweep line. */
  sweepLevel?: number | null;
  /** Layers smc-master has declared dead for the session. */
  deadLayers?: string[];
  /**
   * The standing pools either side, so the chart can draw the MAGNETS and not
   * only the one raid this setup waits on. These are levels, not events: they
   * exist on the tape right now, which is why they print solid.
   */
  pools?: { bsl?: number | null; ssl?: number | null } | null;
  /** smc-master's dealing range, for the EQ line and the premium/discount tint. */
  dealing?: { high: number; low: number; eq: number } | null;
  /**
   * The priced plan, when smc-master has built one. Entry and stop are drawn
   * ONLY from here — deriving a stop from "beyond the sweep" plus a buffer I
   * chose would be inventing a price, which is the one thing a markup may
   * never do.
   */
  plan?: { entry: number; stop: number } | null;
}

/**
 * Build the markup. Pure — same inputs, same picture.
 */
export function anticipate(input: AnticipationInput): SetupAnticipation {
  const { c, canon, draw, price, zone, sweepLevel, sequence } = input;
  const side = c.side === "long" ? "long" : "short";
  const long = side === "long";
  const dead = new Set(input.deadLayers ?? []);
  // smc-master's counts, not a recount of a different must-set.
  const mustPass = sequence?.mustPass ?? 0;
  const mustNeed = sequence?.mustNeed || 1;
  const progress = sequence ? mustPass / mustNeed : 0;
  const engine = c.confluence ?? 0;

  const st = (id: string): StepState =>
    dead.has(id) ? "dead" : stateOf(id, sequence, canon);

  const reach = targetReachable(draw);
  const marks: AnticipatedMark[] = [];

  // The pool that has to go. Priced today even though the raid has not happened.
  if (sweepLevel != null) {
    const s = st("sweep");
    marks.push({
      kind: "sweep",
      label: `${long ? "SSL" : "BSL"} raid`,
      price: sweepLevel,
      state: s,
      watchFor:
        s === "printed"
          ? `Raid printed at ${sweepLevel.toFixed(2)} — the stops are gone, this is the reversal's footprint.`
          : `Price must trade ${long ? "BELOW" : "ABOVE"} ${sweepLevel.toFixed(2)} and close back ${long ? "above" : "under"} it. Until it does there is no raid, and a ${side} here is a guess.`,
    });
  }

  // The standing pools. The `sweep` mark above is the raid this setup is
  // waiting ON; these are the other draws in the book — the magnets a trader
  // reads on the slow rungs, where an entry line would be false precision.
  // The one already drawn as the raid is skipped rather than drawn twice.
  for (const [name, price] of [
    ["BSL", input.pools?.bsl],
    ["SSL", input.pools?.ssl],
  ] as const) {
    if (price == null || !Number.isFinite(price)) continue;
    if (sweepLevel != null && Math.abs(price - sweepLevel) < 1e-9) continue;
    marks.push({
      kind: "pool",
      label: name,
      price,
      // A pool is a level, not a step: it is on the tape now. Solid.
      state: "printed",
      watchFor: `${name} resting at ${price.toFixed(2)} — a magnet, not an entry. Price reaches for it; it is not a reason to be in.`,
    });
  }

  if (input.dealing && Number.isFinite(input.dealing.eq)) {
    marks.push({
      kind: "eq",
      label: "EQ",
      price: input.dealing.eq,
      state: "printed",
      watchFor: `Equilibrium ${input.dealing.eq.toFixed(2)}. Shorts belong above it, longs below — this is the half the pd_half layer grades.`,
    });
  }

  const dsp = st("ltf");
  marks.push({
    kind: "displacement",
    label: "Displacement / MSS",
    price: null,
    state: dsp,
    watchFor:
      dsp === "printed"
        ? "Displacement printed — the shift is on the tape."
        : `After the raid, one candle must close ${long ? "up" : "down"} through structure with a body bigger than the recent range. No displacement, no trade.`,
  });

  if (zone) {
    const arr = st("retrace");
    marks.push({
      kind: "array",
      label: "Entry array",
      price: (zone.top + zone.bottom) / 2,
      state: arr,
      watchFor:
        arr === "printed"
          ? `Price is in ${zone.bottom.toFixed(2)}–${zone.top.toFixed(2)} now. This is the fill.`
          : `Price must come BACK into ${zone.bottom.toFixed(2)}–${zone.top.toFixed(2)}. Do not chase the impulse — the retrace is the entry.`,
    });
  }

  // The limit and the stop, but only at prices smc-master actually published.
  if (input.plan && Number.isFinite(input.plan.entry)) {
    marks.push({
      kind: "entry",
      label: "Limit @ CE",
      price: input.plan.entry,
      // Awaited until it fills: the level is real, the fill is not.
      state: "awaited",
      watchFor: `Rest the limit at ${input.plan.entry.toFixed(2)}. Never pay the print — the CE-touch alarm calls you.`,
    });
  }
  if (input.plan && Number.isFinite(input.plan.stop)) {
    marks.push({
      kind: "stop",
      label: "Stop",
      price: input.plan.stop,
      state: "awaited",
      watchFor: `Invalidation ${input.plan.stop.toFixed(2)}, beyond the sweep. If price trades here the read was wrong — that is the whole risk.`,
    });
  }

  if (draw) {
    marks.push({
      kind: "target",
      label: reach.reachable ? `Target ${draw.name}` : `${draw.name} — UNREACHABLE`,
      price: draw.price,
      state: "awaited",
      watchFor: reach.note ?? `${pct(draw.reachProbability)} of prior sessions travelled this far from here.`,
    });
  }

  // Entry state. `live` is the only thing that flashes.
  //
  // `complete` is smc-master's word and NOTHING ELSE. It is not recomputed
  // from a must-count, because a count over the wrong must-set is precisely
  // the bug this file shipped with: five canon musts standing in for nine.
  // If the desk says STAND or WAIT, this card cannot flash, whatever its
  // engine score or its own layer pills say.
  const complete = sequence?.word === "TAKE" && input.entryAllowed !== false;
  let entry: EntryState = "not-yet";
  if (complete && zone && price != null) {
    const inZone = price >= zone.bottom && price <= zone.top;
    const past = long ? price < zone.bottom : price > zone.top;
    entry = inZone ? "live" : past ? "gone" : "armed";
  } else if (complete) {
    entry = "armed";
  }

  // Count EVERY dead layer, not just the ones with a drawn mark. clean
  // (Judas/news), dol and target have no line on the chart, so counting only
  // drawn marks made the single code path that exists to say "waiting will not
  // fix this" silent for the layers that most need it — including the one that
  // blocks the whole session.
  // TWO sources, because either alone misses cases: `deadLayers` is what the
  // caller passes, and `sequence.states` is smc-master's own grading. A layer
  // failed in the states map but absent from deadLayers was invisible.
  const deadIds = new Set<string>([
    ...dead,
    ...Object.entries(sequence?.states ?? {})
      .filter(([, st]) => st === "fail")
      .map(([id]) => id),
  ]);
  const deadCount = deadIds.size;
  const deadNames = [...deadIds].join(", ");
  const nextMark = marks.find((m) => m.state === "awaited");
  const next = complete
    ? entry === "live"
      ? "Sequence complete and price is in the array. This is the entry, at the price already named."
      : "Sequence complete. Wait for price to come back into the array — the fill is the retrace, not the print."
    : deadCount > 0
      ? `${deadCount} layer${deadCount === 1 ? "" : "s"} failed for this session (${deadNames}). Waiting will not fix this one — the tape has to change, not the clock.`
      : (nextMark?.watchFor ?? `${mustPass}/${mustNeed} musts printed.`);

  const drawIt = engine >= MARKUP_MIN_ENGINE || progress >= MARKUP_MIN_PROGRESS;
  const drawWhy = !drawIt
    ? `Engine ${engine.toFixed(2)} and ${mustPass}/${mustNeed} musts — below both markup thresholds.`
    : complete
      ? "Sequence complete — this is the trade, drawn."
      : `Engine ${engine.toFixed(2)} at ${mustPass}/${mustNeed} musts. Drawn as an ANTICIPATION: solid is printed, dashed is what you are waiting to see. The score says the model fits; it does not say the trade is ready.`;

  return {
    symbol: c.symbol,
    side,
    engine,
    progress,
    mustPass,
    mustNeed,
    draw: drawIt,
    drawWhy,
    marks,
    next,
    entry,
    // The whole point of the flash is that it cannot mean "nearly".
    flash: entry === "live",
    targetReachable: reach.reachable,
    targetNote: reach.note,
  };
}
