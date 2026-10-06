/**
 * Direction from the one-hour and four-hour gaps. The score does not vote.
 *
 * A respected bullish gap, or a bearish gap that failed, is long.
 * A respected bearish gap, or a bullish gap that failed, is short.
 * The bias expires unless the last closed candle is within 8 bars of a touch.
 * Both timeframes have to name the same side. Otherwise there is no direction.
 */

export interface GapBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export type GapSide = "long" | "short";

export function resample(bars: GapBar[], minutes: number): GapBar[] {
  const span = minutes * 60 * 1000;
  const out: GapBar[] = [];
  let cur: GapBar | null = null;
  let key: number | null = null;
  for (const b of bars) {
    if (!(b.t > 0) || !(b.h >= b.l)) continue;
    const k = Math.floor(b.t / span);
    if (k !== key) {
      if (cur) out.push(cur);
      key = k;
      cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c };
    } else if (cur) {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Last gap interaction on this series, or null when it has gone stale. */
export function gapBias(candles: GapBar[]): GapSide | null {
  const fvgs: { side: "bull" | "bear"; top: number; bot: number; born: number; dead?: number }[] = [];
  let last: { side: GapSide; at: number } | null = null;
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2]!;
    const c = candles[i]!;
    if (a.h < c.l) fvgs.push({ side: "bull", top: c.l, bot: a.h, born: i });
    else if (a.l > c.h) fvgs.push({ side: "bear", top: a.l, bot: c.h, born: i });
    let touched: GapSide | null = null;
    for (const g of fvgs) {
      if (g.born >= i || g.dead != null) continue;
      const bar = candles[i]!;
      if (bar.h < g.bot || bar.l > g.top) continue;
      if (g.side === "bull" && bar.c < g.bot) {
        g.dead = i;
        touched = "short";
      } else if (g.side === "bear" && bar.c > g.top) {
        g.dead = i;
        touched = "long";
      } else if (g.side === "bull" && bar.c >= g.bot) touched = "long";
      else if (g.side === "bear" && bar.c <= g.top) touched = "short";
    }
    if (touched) last = { side: touched, at: i };
  }
  if (!last) return null;
  if (candles.length - 1 - last.at > 8) return null;
  return last.side;
}

export interface GapDirection {
  side: GapSide | null;
  h1: GapSide | null;
  h4: GapSide | null;
  line: string;
}

/** Both timeframes, or neither. The printed line is what the card shows. */
export function gapDirection(bars: GapBar[]): GapDirection {
  const h1 = gapBias(resample(bars, 60));
  const h4 = gapBias(resample(bars, 240));
  const side = h1 && h4 && h1 === h4 ? h1 : null;
  const named = (s: GapSide | null) => (s == null ? "no fresh gap" : s);
  const line = side
    ? `Direction ${side}. The one-hour and the four-hour gaps agree. The score does not vote.`
    : `Direction open. One-hour ${named(h1)}, four-hour ${named(h4)}. They have to agree before the side is called. The score does not vote.`;
  return { side, h1, h4, line };
}
