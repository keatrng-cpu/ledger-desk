/**
 * Which card the Floor talks about: the board's first, unless the tape is delivering the other way.
 *
 * WHY: the Floor took the top-ranked card (the board's order: HTF gate, actionable, expected R, fit). On 2026-10-07 that was an ES short at fit 0.99
 * while the 1, 2 and 3 minute were all delivering UP and the short had no displacement down. The five kept discussing a short the tape was not
 * giving them, because nothing moved their attention to the card the delivery supported. PB (Blake, Patty) enters on the 1 to 5 minute inverse, TJR
 * on the 1 minute after the 5 minute break, ICT on the displacement after the sweep: all three read the lower timeframes to decide WHICH side is
 * in play, and change sides when those rungs change.
 *
 * THE RULE (narration only; it picks what is discussed, never what is traded):
 *   - A card's DELIVERY is read from the ladder of its own index. "against": the trigger rungs (3, 2, 1 minute) point the other way AND either the
 *     15/5 minute confirmation does not point this way or the card is not actionable. "with": the trigger rungs point this way. Otherwise "mixed".
 *   - If the card on top is "against", the focus moves to the best card on the OTHER side whose delivery is "with" and which is at least as takeable
 *     (same board rank or better) or was released by the higher-timeframe disrespect check. The higher-timeframe gate itself is not touched: a long that
 *     the HTF gate still refuses cannot be taken over a short, so the focus stays and the line says the short waits.
 *   - A card in the entry zone (live / armed / forming) keeps priority among cards that are not "against".
 */

export type Delivery = "with" | "against" | "mixed" | "unknown";

export interface FocusCard {
  side: "long" | "short";
  htfOk: boolean;
  actionable: boolean;
  htfDisrespected?: boolean;
}

export const boardRankOf = (c: Pick<FocusCard, "htfOk" | "actionable">): number => (c.htfOk ? 2 : 0) + (c.actionable ? 1 : 0);

/** Trigger and confirmation rung majorities of a ladder ("bull" | "bear" | "neutral"), against a card's side. */
export function deliveryOfLadder(
  ladder: { tier3: string; tier4: string } | null | undefined,
  card: Pick<FocusCard, "side" | "actionable">,
): Delivery {
  if (!ladder) return "unknown";
  const want = card.side === "short" ? "bear" : "bull";
  const opp = card.side === "short" ? "bull" : "bear";
  if (ladder.tier4 === opp && (ladder.tier3 !== want || !card.actionable)) return "against";
  if (ladder.tier4 === want) return "with";
  return "mixed";
}

export interface FocusPick<T> {
  card: T;
  /** The card that was on top and was left, when the focus switched. */
  switchedFrom: T | null;
  /** The delivery of the card that was on top. */
  topDelivery: Delivery;
  /** The delivery of the card now in focus. */
  delivery: Delivery;
}

export function pickFocus<T extends FocusCard>(
  ranked: readonly T[],
  isInZone: (c: T) => boolean,
  deliveryOf: (c: T) => Delivery,
): FocusPick<T> | null {
  if (!ranked.length) return null;
  const inZone = ranked.find((c) => isInZone(c) && deliveryOf(c) !== "against");
  const top = inZone ?? ranked[0]!;
  const topDelivery = deliveryOf(top);
  if (topDelivery === "against") {
    const alt = ranked.find((a) => a.side !== top.side && deliveryOf(a) === "with" && (a.htfDisrespected === true || boardRankOf(a) >= boardRankOf(top)));
    if (alt) return { card: alt, switchedFrom: top, topDelivery, delivery: "with" };
  }
  return { card: top, switchedFrom: null, topDelivery, delivery: topDelivery };
}

/** What the characters say about it, in plain words. Empty when the delivery needs no comment. */
export function deliveryLine(p: FocusPick<FocusCard>): string {
  const dir = (side: "long" | "short") => (side === "short" ? "down" : "up");
  const on = "on the 1 to 3 minute";
  if (p.switchedFrom) {
    return `Displacement is ${dir(p.card.side)} ${on}, not ${dir(p.switchedFrom.side)}. Leaving the ${p.switchedFrom.side} for the ${p.card.side}.`;
  }
  if (p.delivery === "against") {
    const side = p.card.side;
    return `The 1 to 3 minute is delivering ${dir(side === "short" ? "long" : "short")}, against this ${side}, and there is no displacement ${dir(side)} yet. It waits.`;
  }
  return "";
}
