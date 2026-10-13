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

/**
 * ONE HTF definition (2026-10-13): buckets anchored at 18:00 ET (the futures
 * session open) and CLOSED candles only — the forming 1h/4h candle is dropped,
 * so the Floor's gap block and the scanner's band read the same thing.
 */
function etOffsetMs(t: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t));
  const g = (k: string) => Number(parts.find((p) => p.type === k)!.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"));
  return asUtc - Math.floor(t / 60_000) * 60_000;
}

export function resample(bars: GapBar[], minutes: number): GapBar[] {
  const span = minutes * 60 * 1000;
  const out: GapBar[] = [];
  if (!bars.length) return out;
  // 18:00 ET anchor: shift into ET wall time, then by −18h so buckets start at 18:00.
  const off = etOffsetMs(bars[bars.length - 1]!.t) - 18 * 3600_000;
  let cur: GapBar | null = null;
  let key: number | null = null;
  for (const b of bars) {
    if (!(b.t > 0) || !(b.h >= b.l)) continue;
    const k = Math.floor((b.t + off) / span);
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
  // Closed only: the last bucket is complete when the input's last bar closes it.
  if (cur && key != null) {
    const step = bars.length > 1 ? bars[bars.length - 1]!.t - bars[bars.length - 2]!.t : 0;
    const end = (key + 1) * span - off;
    if (bars[bars.length - 1]!.t + step >= end) out.push(cur);
  }
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
