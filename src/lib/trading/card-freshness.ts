/**
 * Is this card still a trade, or has the tape already run it?
 *
 * THE BUG THIS EXISTS FOR
 * On 2026-09-23 the board showed MNQ at 30,838.25 with a draw of 30,860.75
 * labelled "below, 100% base rate" and an entry zone of 30,870.75–30,901.75.
 * Every one of those numbers sits ABOVE the price. Price had already traded
 * through the target of a short that was still being presented as live, with
 * a 100% reach on a distance that no longer existed.
 *
 * The cause is a split brain about what "now" means. `structure.ts` sets
 * `last: bars[bars.length - 1]?.c` — the close of the last CLOSED bar — and
 * `drawOnLiquidity` computes side, distance and therefore reach probability
 * from that. The price rendered next to it comes from the freshest quote.
 * On a quiet tape they agree. On a ten-minute Yahoo lag and a fast leg they
 * do not, and the board confidently describes a setup the market has already
 * resolved.
 *
 * WHY THIS IS WORSE THAN A COSMETIC LAG
 * A spent card does not merely mislead, it invites the single most expensive
 * mistake available: entering late on an idea that already paid. The desk
 * already refuses this for one case — "Do not get in late on a spent card.
 * Re-grade the new array" fires when price prints the target without ever
 * trading the entry. This generalises it to every way a card can die.
 *
 * WHAT IT DOES NOT KNOW
 * Whether the entry actually filled. The desk has no broker connection, so
 * `target_hit` means "this card is finished", not "you made money". Both
 * readings end in the same instruction — stop looking at it — which is why
 * the state is still worth computing without the fill.
 */

import type { DrawRead, LiquidityTarget } from "./draw";
import type { TradePlan } from "./trade-plan";

export type CardState =
  /** Entry and target both still ahead. Tradable. */
  | "live"
  /** Price has traded through the target. The idea is finished. */
  | "target_hit"
  /** Price ran past the entry the wrong way and never came back. */
  | "entry_gone"
  /** The draw's side disagrees with the live price — computed on a stale bar. */
  | "side_stale";

export interface Freshness {
  state: CardState;
  /** The price this was judged against, so the caller cannot mix sources. */
  judgedAt: number;
  /** Bar-close price the draw was originally computed from, when known. */
  staleAt: number | null;
  /** Points between the two. Large values mean the board is describing history. */
  driftPts: number | null;
  /** Never show a reach percentage for a level price is already through. */
  reachStillMeaningful: boolean;
  line: string;
}

/**
 * Judge a card against the freshest price available.
 *
 * `livePrice` must be the same number the UI renders. Passing a bar close
 * here reproduces the exact bug this file was written for.
 */
export function cardFreshness(
  plan: Pick<TradePlan, "side" | "entry" | "entryZone" | "stop" | "t1">,
  livePrice: number,
  staleAt?: number | null,
): Freshness {
  const short = plan.side === "short";
  const driftPts = staleAt != null && Number.isFinite(staleAt) ? Math.abs(livePrice - staleAt) : null;

  const base = { judgedAt: livePrice, staleAt: staleAt ?? null, driftPts };

  if (!Number.isFinite(livePrice) || livePrice <= 0) {
    return {
      ...base,
      state: "live",
      reachStillMeaningful: true,
      line: "No live price — cannot judge whether this card is spent. Treat it as unverified, not as valid.",
    };
  }

  // 1. Target already printed. A short's target sits below entry; if price is
  //    at or through it, the move the card described has happened.
  if (plan.t1 != null) {
    const through = short ? livePrice <= plan.t1 : livePrice >= plan.t1;
    if (through) {
      return {
        ...base,
        state: "target_hit",
        reachStillMeaningful: false,
        line: `TARGET ALREADY PRINTED at ${plan.t1.toFixed(2)} — price is ${livePrice.toFixed(2)}. This card is finished whether or not it filled. Do not enter it late. Re-scan for the next draw beyond it (continuation) or the opposite pool (reversal), and price a NEW entry and stop for whichever you take.`,
      };
    }
  }

  // 2. Entry ran away. For a short the entry sits above price and price comes
  //    UP into it; if price has fallen well past it, the retrace never came.
  const zone = plan.entryZone;
  if (zone) {
    const past = short ? livePrice < zone.bottom : livePrice > zone.top;
    if (past) {
      return {
        ...base,
        state: "entry_gone",
        reachStillMeaningful: false,
        line: `ENTRY GONE — the array was ${zone.bottom.toFixed(2)}–${zone.top.toFixed(2)} and price is ${livePrice.toFixed(2)}, already past it. The retrace this card was waiting for did not happen. A return to the zone is NOT a fill of this ticket; it is a different trade that has to be graded from scratch.`,
      };
    }
  }

  // 3. Stop already tagged — the idea is dead rather than spent.
  const stopped = short ? livePrice >= plan.stop : livePrice <= plan.stop;
  if (stopped) {
    return {
      ...base,
      state: "entry_gone",
      reachStillMeaningful: false,
      line: `INVALIDATION AT ${plan.stop.toFixed(2)} IS ALREADY TRADED — price ${livePrice.toFixed(2)}. This card is dead, not waiting.`,
    };
  }

  return {
    ...base,
    state: "live",
    reachStillMeaningful: true,
    line: `Entry ${plan.entry.toFixed(2)} and target ${plan.t1?.toFixed(2) ?? "unpriced"} are both still ahead of ${livePrice.toFixed(2)}.`,
  };
}

/**
 * Does the draw's own side still match the live price?
 *
 * This is the direct check for the split brain: `drawOnLiquidity` labelled a
 * level "below" from a bar close while the live quote had already passed it.
 */
export function drawSideStale(
  target: Pick<LiquidityTarget, "price" | "side">,
  livePrice: number,
): { stale: boolean; line: string } {
  if (!Number.isFinite(livePrice) || livePrice <= 0) {
    return { stale: false, line: "No live price to check the draw against." };
  }
  const actual = target.price > livePrice ? "above" : "below";
  if (actual === target.side) {
    return { stale: false, line: `Draw is ${actual} price, as labelled.` };
  }
  return {
    stale: true,
    line: `STALE DRAW — labelled "${target.side}" but ${target.price.toFixed(2)} is ${actual} the live ${livePrice.toFixed(2)}. Price has crossed it since the bar this was computed from. The reach percentage is meaningless: it is the base rate for a distance that no longer exists.`,
  };
}

export interface NextLook {
  /** Same direction, a further pool. */
  continuation: LiquidityTarget | null;
  /** The other way, back into the opposite pool. */
  reversal: LiquidityTarget | null;
  line: string;
}

/**
 * When a card is spent, what is worth looking at next.
 *
 * Returns CANDIDATES, not a plan. Both need a fresh entry array and a fresh
 * invalidation before they are trades — reusing the spent card's levels is
 * precisely the late entry this file exists to prevent. The sequence has to
 * be re-run against the new array; nothing here shortcuts that.
 */
export function nextLook(draw: DrawRead, side: "long" | "short", livePrice: number): NextLook {
  const short = side === "short";
  const all = [draw.primary, draw.above, draw.below, ...draw.alternates].filter(
    (t): t is LiquidityTarget => t != null,
  );

  // Continuation: the nearest pool still ahead in the SAME direction.
  const ahead = all
    .filter((t) => (short ? t.price < livePrice : t.price > livePrice))
    .sort((a, b) => Math.abs(a.price - livePrice) - Math.abs(b.price - livePrice));

  // Reversal: the nearest pool the other way.
  const behind = all
    .filter((t) => (short ? t.price > livePrice : t.price < livePrice))
    .sort((a, b) => Math.abs(a.price - livePrice) - Math.abs(b.price - livePrice));

  const continuation = ahead[0] ?? null;
  const reversal = behind[0] ?? null;

  const parts: string[] = [];
  if (continuation) {
    parts.push(
      `CONTINUATION — next pool ${short ? "below" : "above"} is ${continuation.name} at ${continuation.price.toFixed(2)} (${(continuation.reachProbability * 100).toFixed(0)}% base rate from here).`,
    );
  }
  if (reversal) {
    parts.push(
      `REVERSAL — the opposite pool is ${reversal.name} at ${reversal.price.toFixed(2)}, which is where a failed continuation goes.`,
    );
  }
  parts.push(
    "Both are CANDIDATES, not plans. Each needs its own entry array, its own invalidation and a full re-run of the sequence. Reusing the spent card's entry or stop is the late entry that just cost you the last one.",
  );

  return { continuation, reversal, line: parts.join(" ") };
}
