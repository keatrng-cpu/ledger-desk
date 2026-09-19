/**
 * A tiny composable tape builder for teaching figures.
 *
 * WHY THIS EXISTS
 * The first set of figures was hand-indexed: a leg list, then `bars[4].o` and
 * `bars[6].h` picked by eye to locate a gap. That produced a genuinely wrong
 * diagram — the retrace figure's "array" was measured from the displacement
 * bar's own open instead of the real three-bar construction, so it drew a band
 * the height of the entire move. The bug was invisible in the code and obvious
 * on screen, which is the worst combination.
 *
 * So the builder REMEMBERS what it drew. When you call `raidUp()` it records
 * which bar raided and at what price; when you call `displaceDown()` it
 * computes the fair value gap from the bars either side, the way the detector
 * does. Scenarios then reference `t.marks.gap` instead of guessing an index,
 * and a figure cannot disagree with its own annotation.
 *
 * Deterministic: same seed, same bars, forever. A lesson whose diagram changes
 * shape between visits teaches nothing.
 */

import type { FigureBar } from "./figures";

export interface TapeMarks {
  /** Bar index and wick price of the last raid. */
  raidBar: number | null;
  raidPrice: number | null;
  /** The level the raid ran through. */
  poolPrice: number | null;
  /** Bar index of the last displacement. */
  displaceBar: number | null;
  /** Bar index of the last ACCEPTANCE break (breakUp/breakDown). */
  breakBar: number | null;
  /** FVG left by the last displacement, per the three-bar rule. */
  gap: { top: number; bottom: number } | null;
  /** Highest high / lowest low of everything built so far. */
  high: number;
  low: number;
  /** Peak of the most recent pullback — where a retest entry would sit. */
  pullbackBar: number | null;
  pullbackPrice: number | null;
}

export class Tape {
  readonly bars: FigureBar[] = [];
  private px: number;
  private rnd: () => number;
  readonly marks: TapeMarks = {
    raidBar: null,
    raidPrice: null,
    poolPrice: null,
    displaceBar: null,
    breakBar: null,
    gap: null,
    high: -Infinity,
    low: Infinity,
    pullbackBar: null,
    pullbackPrice: null,
  };

  constructor(start = 100, seed = 7) {
    this.px = start;
    let s = seed >>> 0;
    this.rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  private push(o: number, c: number, wickUp: number, wickDown: number): void {
    const bar: FigureBar = {
      o: +o.toFixed(2),
      h: +(Math.max(o, c) + wickUp).toFixed(2),
      l: +(Math.min(o, c) - wickDown).toFixed(2),
      c: +c.toFixed(2),
    };
    this.bars.push(bar);
    this.px = c;
    this.marks.high = Math.max(this.marks.high, bar.h);
    this.marks.low = Math.min(this.marks.low, bar.l);
  }

  /** n bars drifting by `slope` per bar, with ordinary noise and wicks. */
  leg(n: number, slope: number, noise = 4): this {
    for (let i = 0; i < n; i++) {
      const o = this.px;
      const c = o + slope + (this.rnd() - 0.5) * noise;
      this.push(o, c, this.rnd() * noise * 0.4 + 0.5, this.rnd() * noise * 0.4 + 0.5);
    }
    return this;
  }

  /** Sideways — no directional information, which is itself a lesson. */
  chop(n: number, amp = 5): this {
    for (let i = 0; i < n; i++) {
      const o = this.px;
      const c = o + (this.rnd() - 0.5) * amp;
      this.push(o, c, this.rnd() * amp * 0.6 + 0.6, this.rnd() * amp * 0.6 + 0.6);
    }
    return this;
  }

  /**
   * One bar that runs THROUGH `pool` and closes back on the original side.
   * This is a raid. The close is the entire signal.
   */
  raidUp(pool: number, depth = 6): this {
    const o = this.px;
    const c = pool - depth * 0.55; // closes back UNDER the pool
    this.marks.raidBar = this.bars.length;
    this.marks.poolPrice = pool;
    this.marks.raidPrice = +(pool + depth).toFixed(2);
    this.push(o, c, Math.max(0, pool + depth - Math.max(o, c)), 1);
    return this;
  }

  raidDown(pool: number, depth = 6): this {
    const o = this.px;
    const c = pool + depth * 0.55;
    this.marks.raidBar = this.bars.length;
    this.marks.poolPrice = pool;
    this.marks.raidPrice = +(pool - depth).toFixed(2);
    this.push(o, c, 1, Math.max(0, Math.min(o, c) - (pool - depth)));
    return this;
  }

  /**
   * One bar that closes BEYOND `pool` and holds — acceptance, not a raid.
   * Deliberately available so the "this is not a sweep" figures are built by
   * the same code path as the real ones and differ only in the close.
   */
  breakUp(pool: number, beyond = 5): this {
    const o = this.px;
    const c = pool + beyond;
    this.marks.poolPrice = pool;
    this.marks.breakBar = this.bars.length;
    this.push(o, c, 1.5, 1);
    return this;
  }

  /**
   * A wide body, and the fair value gap it leaves.
   *
   * The gap is computed from the bars EITHER SIDE of the displacement, which
   * is what a fair value gap is: for a down move, the low of the bar before
   * against the high of the bar after. Recorded only when a gap genuinely
   * exists, so a scenario cannot annotate one that did not form.
   */
  displaceDown(size: number): this {
    const prev = this.bars[this.bars.length - 1];
    const o = this.px;
    this.push(o, o - size, 0.8, 0.8);
    const idx = this.bars.length - 1;
    this.marks.displaceBar = idx;
    // Next bar completes the three-bar window.
    this.leg(1, -size * 0.12, 2);
    const next = this.bars[this.bars.length - 1]!;
    this.marks.gap = prev && next.h < prev.l ? { top: prev.l, bottom: next.h } : null;
    return this;
  }

  displaceUp(size: number): this {
    const prev = this.bars[this.bars.length - 1];
    const o = this.px;
    this.push(o, o + size, 0.8, 0.8);
    const idx = this.bars.length - 1;
    this.marks.displaceBar = idx;
    this.leg(1, size * 0.12, 2);
    const next = this.bars[this.bars.length - 1]!;
    this.marks.gap = prev && next.l > prev.h ? { top: next.l, bottom: prev.h } : null;
    return this;
  }

  /**
   * Pull back toward `target` over n bars and record the turn.
   *
   * Used for "price returns into the array". The peak is recorded so an entry
   * callout lands on the bar that actually made the retest rather than on an
   * index picked by eye.
   */
  pullbackTo(target: number, n = 4): this {
    const from = this.px;
    const stepSize = (target - from) / n;
    for (let i = 0; i < n; i++) {
      const o = this.px;
      const c = o + stepSize + (this.rnd() - 0.5) * 1.5;
      this.push(o, c, this.rnd() * 1.2 + 0.4, this.rnd() * 1.2 + 0.4);
    }
    // The extreme of the pullback, in the direction it travelled.
    const up = stepSize > 0;
    let best = this.bars.length - n;
    for (let i = this.bars.length - n; i < this.bars.length; i++) {
      const b = this.bars[i]!;
      const cur = this.bars[best]!;
      if (up ? b.h > cur.h : b.l < cur.l) best = i;
    }
    this.marks.pullbackBar = best;
    this.marks.pullbackPrice = up ? this.bars[best]!.h : this.bars[best]!.l;
    return this;
  }

  /** A swing high `n` bars back — for building equal highs to raid. */
  swingHigh(lookback = 0): number {
    const slice = lookback ? this.bars.slice(-lookback) : this.bars;
    return slice.reduce((m, b) => Math.max(m, b.h), -Infinity);
  }

  swingLow(lookback = 0): number {
    const slice = lookback ? this.bars.slice(-lookback) : this.bars;
    return slice.reduce((m, b) => Math.min(m, b.l), Infinity);
  }

  get last(): number {
    return this.px;
  }

  get length(): number {
    return this.bars.length;
  }
}

export function tape(start = 100, seed = 7): Tape {
  return new Tape(start, seed);
}
