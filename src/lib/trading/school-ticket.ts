/**
 * What the live Robinhood ticket is allowed to say about bias, entry, and target.
 *
 * PB (Patty and Blake): bias is which higher-timeframe gaps are respected and
 * which are closed through. The entry is the close that inverses the highest
 * gap from 1m to 5m after that level holds. The first target is the unfilled
 * 5m or 15m gap, then the next pool. The internal extreme is the break-even.
 *
 * TJR: bias is the higher-timeframe leg the sweep is inside. The entry is not
 * the sweep. It is the retrace into the fair value gap or the order block
 * after the break of structure. The target is the liquidity on the other side.
 *
 * ICT: bias is the unswept draw and the half of the dealing range. Longs are
 * taken from discount, shorts from premium. The entry is the midpoint of the
 * gap after displacement, while price is still inside it. The target is the
 * draw that has not traded.
 *
 * The quarter open is not a bias in any of the three.
 */

export function schoolTicket(symbol: string, side: "long" | "short"): string {
  const same = side === "long" ? "bullish" : "bearish";
  const opp = side === "long" ? "bearish" : "bullish";
  const half = side === "long" ? "discount" : "premium";
  return [
    `${symbol} ${side}.`,
    `Bias — PB: ${same} higher-timeframe gaps respected and ${opp} gaps closed through. TJR: the leg this sweep is inside. ICT: the unswept draw, from ${half}. Not the quarter.`,
    `Entry — PB: the close that inverses the highest 1m–5m gap after that level holds. TJR: sweep, then the break, then the retrace into the gap or the order block. ICT: the midpoint of the gap after displacement, while price is still inside it.`,
    `Target — PB: the unfilled 5m or 15m gap, then the next pool. The internal extreme is the break-even. TJR: the liquidity on the other side of the range. ICT: the draw that has not traded.`,
  ].join(" ");
}
