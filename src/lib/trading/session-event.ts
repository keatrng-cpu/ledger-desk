/**
 * Is there a tradable session right now — asked of the tape, not the clock.
 *
 * THE PROBLEM THIS REPLACES
 * `sessions.ts` answers "is it between 08:30 and 11:00 ET" and the SMC
 * sequence treats that answer as a must-layer. Outside the window the `time`
 * layer goes to "wait", `mustWait` is truthy, and `smc-master.ts` can never
 * print TAKE no matter what the tape does (smc-master.ts:278 and :504-509).
 * The word "wait" makes it read like a soft state; it is a hard veto.
 *
 * That is the right default and the wrong absolute. A CPI print at 08:32, a
 * Fed headline at 14:10, an overnight gap that runs the prior day's high —
 * these are the highest-participation bars of the week, and the desk refused
 * them on the grounds that a clock said so. The trader watched QQQ add $3 in
 * ten minutes with the board showing nothing.
 *
 * WHAT THE KILLZONE WAS ACTUALLY PROXYING FOR
 * Not the hour. The hour is a stand-in for two things that matter:
 *
 *   PARTICIPATION — enough volume that a resting limit fills at the price you
 *                   rested it and a stop does not get slipped three points.
 *   DELIVERY      — enough range that the structural levels the desk prices
 *                   off actually get traded to, rather than drifting.
 *
 * Both are measurable on the bar in front of you, and measuring them is
 * strictly better than inferring them from the time of day: it admits the
 * 08:32 release AND it refuses the dead 10:40 tape that the clock waves
 * through. This module measures them.
 *
 * WHAT IT DOES NOT TOUCH
 * Judas (09:30-09:45) and the news blackout stay absolute and are checked
 * elsewhere; nothing here can satisfy them. The weekend stays closed. The
 * 0.65 confluence floor, the HTF gate, the sweep, the dealing-range half, the
 * LTF shift, the priced target and the retrace all still have to pass on
 * their own — this decides ONE must-layer out of nine, and a session event
 * with no sequence behind it is still a STAND.
 *
 * ONE HONEST CAVEAT, KEPT WHERE THE CODE IS
 * Out-of-window fills are genuinely worse than in-window ones in a way a 15m
 * OHLC backtest cannot see: the spread is wider and a stop slips further than
 * the single tick `backtest-account.mjs` charges. The thresholds here are set
 * ABOVE where the measurement said the edge starts, to buy back some of that
 * unmodelled cost, and the gap is named rather than papered over.
 */

import type { OhlcBar } from "../market/types";
import { resolveKillzone } from "./sessions";

/** Bars of recent history the shock read needs before it means anything. */
export const SHOCK_WARMUP = 21;

/**
 * How unlike its own recent tape is this bar?
 *
 * THE ONE DEFINITION. `scripts/backtest-account.mjs` imports this exact
 * function rather than keeping a second copy, because a live gate and the
 * measurement that justified it drifting apart is how a desk ends up trading
 * a rule nothing ever tested. Everything is scaled to the instrument's own
 * ATR and its own median volume, so ES and MNQ produce comparable numbers
 * and neither needs a hand-set point threshold.
 */
export function shockScore(bars: OhlcBar[], end = bars.length - 1): number {
  if (end < 1 || end >= bars.length) return 0;
  const b = bars[end]!;
  let tr = 0;
  let k = 0;
  for (let i = Math.max(1, end - 13); i <= end; i++) {
    const c = bars[i]!;
    const p = bars[i - 1]!;
    tr += Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
    k++;
  }
  const atr = k > 0 ? tr / k : 0;
  if (!(atr > 0)) return 0;
  const prev = bars[end - 1]!;
  const rng = (b.h - b.l) / atr;
  const body = Math.abs(b.c - b.o) / atr;
  const gap = Math.abs(b.o - prev.c) / atr;
  // Three readings of "something just happened", and the strongest one wins:
  // a wide bar, a decisive body, or a gap. Weighted so that a body and a gap
  // have to be smaller than a range to say the same thing, because a range
  // can be two-sided noise while a body and a gap are directional delivery.
  return Math.max(rng, body * 1.35, gap * 2);
}

/** Volume on this bar against its own 20-bar median. 0 when volume is absent. */
export function volumeRatio(bars: OhlcBar[], end = bars.length - 1): number {
  if (end < 1) return 0;
  const v: number[] = [];
  for (let i = Math.max(0, end - 20); i < end; i++) v.push(bars[i]!.v ?? 0);
  if (!v.length) return 0;
  v.sort((a, b) => a - b);
  const med = v[Math.floor(v.length / 2)]!;
  return med > 0 ? (bars[end]!.v ?? 0) / med : 0;
}

/**
 * MEASURED, NOT CHOSEN.
 *
 * Set by `scripts/backtest-account.mjs` over the four-year tape: every
 * clock-only refusal — every moment where the whole sequence passed and the
 * hour was the single thing stopping it — was simulated forward and bucketed
 * by this score. See the SESSION-EVENT block in that script's output for the
 * bucket table these two numbers come from, and the notes in CLAUDE.md.
 *
 * Both are deliberately set one bucket ABOVE where expectancy first turns
 * positive, to pay for the out-of-window spread the backtest cannot see.
 */
export const EVENT_SCORE_MIN = 2.0;
export const EVENT_VOL_MIN = 1.5;

export type SessionSource = "killzone" | "event" | "none";

export interface SessionRead {
  /** True when the desk may treat this moment as a tradable session. */
  live: boolean;
  source: SessionSource;
  score: number;
  volX: number;
  /** One clause for the layer detail — always safe to print. */
  reason: string;
}

/**
 * The session layer's answer.
 *
 * `killzone` — the ordinary path, unchanged. `event` — outside the window,
 * but this bar cleared both the delivery and the participation bar, so the
 * layer passes and names why. `none` — quiet tape outside the window, which
 * is the overwhelming majority of out-of-window bars and still a refusal.
 */
export function readSession(
  bars: OhlcBar[],
  clock: { etHour: number; etMinute: number; weekday: number; inTradeWindow: boolean; killzoneLabel: string },
): SessionRead {
  const score = bars.length > SHOCK_WARMUP ? shockScore(bars) : 0;
  const volX = bars.length > SHOCK_WARMUP ? volumeRatio(bars) : 0;

  if (clock.inTradeWindow) {
    return { live: true, source: "killzone", score, volX, reason: clock.killzoneLabel };
  }
  // The weekend is not a thin session, it is a closed one. No amount of
  // Sunday-evening range makes it a window this desk trades.
  const weekday = clock.weekday >= 1 && clock.weekday <= 5;
  if (!weekday) {
    return { live: false, source: "none", score, volX, reason: "Weekend — plan only" };
  }
  if (score >= EVENT_SCORE_MIN && volX >= EVENT_VOL_MIN) {
    return {
      live: true,
      source: "event",
      score,
      volX,
      reason: `Session event outside ${resolveKillzone(clock.etHour, clock.etMinute).label} — ${score.toFixed(1)}× ATR on ${volX.toFixed(1)}× median volume`,
    };
  }
  const missing =
    score < EVENT_SCORE_MIN && volX < EVENT_VOL_MIN
      ? `${score.toFixed(1)}× ATR on ${volX.toFixed(1)}× volume`
      : score < EVENT_SCORE_MIN
        ? `only ${score.toFixed(1)}× ATR (needs ${EVENT_SCORE_MIN})`
        : `only ${volX.toFixed(1)}× volume (needs ${EVENT_VOL_MIN})`;
  return {
    live: false,
    source: "none",
    score,
    volX,
    reason: `Outside ${clock.killzoneLabel} and no session event — ${missing}`,
  };
}

/**
 * Stamp the session read onto a clock, from whatever bars the caller has.
 *
 * WHY "EITHER BOOK" AND NOT "THIS BOOK"
 * The clock is shared by both books and by the UI, so its flag answers the
 * coarse question — is the desk awake at all. A shock on ES is a session on
 * ES, and the board should not go dark just because MNQ was quiet in the same
 * fifteen minutes. The places where the distinction actually decides money —
 * the SMC sequence in `smc-master.ts` and the CE-touch alarm in
 * `path-alarm.ts` — do NOT use this flag; each re-reads `readSession` against
 * its own book's bars, so neither book can borrow the other's event to
 * justify a trade.
 */
export function applySession<
  T extends {
    etHour: number;
    etMinute: number;
    weekday: number;
    inTradeWindow: boolean;
    killzoneLabel: string;
  },
>(clock: T, ...books: (readonly OhlcBar[] | undefined | null)[]): T {
  let best: SessionRead | null = null;
  for (const bars of books) {
    if (!bars?.length) continue;
    const read = readSession(bars as OhlcBar[], clock);
    if (!best || (read.live && !best.live) || read.score > best.score) best = read;
  }
  const read = best ?? readSession([], clock);
  return {
    ...clock,
    sessionLive: read.live,
    sessionSource: read.source,
    sessionReason: read.reason,
  };
}
