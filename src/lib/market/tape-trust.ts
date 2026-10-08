/**
 * Can this tape arm a card?
 *
 * The wire already REPORTS lag (`LiveQuote.lagSec`, the HUD line, the handoff).
 * Nothing refuses on it: a card graded on a series whose last bar closed three
 * buckets ago is still actionable, and `applyQuoteToLastBar` patches the live
 * print onto the FORMING bar, which the scanner's own detectors then read as
 * bars (scanner.ts reads `bars` directly, not `closedBars(bars, …)`; only
 * shock.ts is handed closed bars today).
 *
 * A sweep, a gap and a displacement are facts about a bar that CLOSED. A
 * forming bar has no close, so "closed back inside the pool" and "body ≥ 1.5
 * ATR" are not statements about it — and its high/low are a single live print,
 * so the wick a sweep needs has not printed yet either.
 *
 * Two pure decisions live here, both free of localStorage, fetch and Date.now:
 *   `tapeTrust(bars, …)`  — more than one closed bar of lag ⇒ the card WAITS.
 *   `closedTape(bars, …)` — the series the detectors may see, forming bar cut.
 *
 * Deliberately NOT done here: no threshold is loosened and no new take is
 * created. This only ever removes a take. The one bar of tolerance is the
 * trader's own rule ("lag of more than one closed bar sets the card to WAIT"),
 * and it is the same tolerance the desk already lives with — Databento
 * historical runs ~15–20 min behind without the live entitlement, which on the
 * 15m series the engine grades is about one bucket.
 */

import type { MarketSource, OhlcBar } from "./types";
import { closedBars, intervalMs } from "./freshest";

export interface TapeTrustInput {
  /** Desk build time (ms epoch). Never read from the clock in here. */
  nowMs: number;
  /** Series interval — "15m", or the millisecond count. */
  interval?: string | number;
  /** `LiveQuote.lagSec`: seconds since the feed last confirmed the print. */
  lagSec?: number | null;
  /** `LiveQuote.source` / `SymbolSeries.source`. "synthetic" never arms. */
  source?: MarketSource | string | null;
}

export interface TapeTrust {
  /** False ⇒ the card reads WAIT. True is never a take on its own. */
  ok: boolean;
  /** Whole closed buckets between the series' last close and `nowMs`. 0 = current. */
  barsBehind: number;
  /** The same count derived from the quote's own lag, or null with no lag given. */
  quoteBarsBehind: number | null;
  /** Open time of the newest FULLY CLOSED bar, or null when there is none. */
  lastClosedMs: number | null;
  /** True when the newest bar in the series is still forming (the normal case). */
  formingBar: boolean;
  /** The sentence the card carries in `missing` when `ok` is false. */
  reason: string;
}

/** More than this many closed bars of lag and the card waits. The trader's rule. */
export const TAPE_MAX_BARS_BEHIND = 1;

/**
 * The freshness decision for one symbol's series.
 *
 * `barsBehind` counts buckets that have fully elapsed since the last closed bar
 * closed: the bucket that closed a moment ago is 0, the one before it 1. A
 * series sitting on a bar that closed two buckets ago is behind by 2 and cannot
 * arm. `quoteBarsBehind` does the same arithmetic on the quote's own lag, so a
 * series stamped fresh by a feed that has actually gone quiet still refuses.
 */
export function tapeTrust(bars: readonly OhlcBar[] | null | undefined, input: TapeTrustInput): TapeTrust {
  const ms = intervalMs(typeof input.interval === "number" ? undefined : input.interval);
  const step = typeof input.interval === "number" && input.interval > 0 ? input.interval : ms;
  const list = Array.isArray(bars) ? bars : [];
  const source = (input.source ?? "") as string;

  if (!Number.isFinite(input.nowMs)) {
    return blind("the desk build has no clock, so bar age cannot be measured", step);
  }
  if (!list.length) {
    return blind("no bars on this series — a sweep and a displacement need closed bars", step);
  }
  if (source === "synthetic") {
    return {
      ...blind("the tape is SYNTHETIC — nothing on it is a fact about the market", step),
      lastClosedMs: null,
    };
  }

  const newest = list[list.length - 1]!;
  const formingBar = newest.t + step > input.nowMs;
  const closed = formingBar ? list.slice(0, -1) : list;
  if (!closed.length) {
    return {
      ok: false,
      barsBehind: Number.POSITIVE_INFINITY,
      quoteBarsBehind: null,
      lastClosedMs: null,
      formingBar,
      reason: "TAPE LATE: the only bar on this series is still forming — no close to read a sweep or a displacement from",
    };
  }

  const lastClosed = closed[closed.length - 1]!;
  const closedAt = lastClosed.t + step;
  const barsBehind = Math.max(0, Math.floor((input.nowMs - closedAt) / step));
  const lagSec = input.lagSec;
  const quoteBarsBehind =
    typeof lagSec === "number" && Number.isFinite(lagSec) && lagSec >= 0
      ? Math.max(0, Math.floor((lagSec * 1000) / step))
      : null;
  const behind = Math.max(barsBehind, quoteBarsBehind ?? 0);
  const ok = behind <= TAPE_MAX_BARS_BEHIND;
  const mins = Math.round(step / 60_000);
  const reason = ok
    ? `Tape current: last close ${barsBehind} bar${barsBehind === 1 ? "" : "s"} back on the ${mins}m series.`
    : `TAPE LATE: the last CLOSED ${mins}m bar is ${behind} bars behind` +
      (quoteBarsBehind != null && quoteBarsBehind > barsBehind ? ` (feed lag ${Math.round(lagSec as number)}s)` : "") +
      " — the sweep and the displacement this card read are not current. WAIT.";

  return { ok, barsBehind, quoteBarsBehind, lastClosedMs: lastClosed.t, formingBar, reason };
}

function blind(why: string, step: number): TapeTrust {
  const mins = Math.round(step / 60_000);
  return {
    ok: false,
    barsBehind: Number.POSITIVE_INFINITY,
    quoteBarsBehind: null,
    lastClosedMs: null,
    formingBar: false,
    reason: `TAPE LATE: ${why} (${mins}m series). WAIT.`,
  };
}

/**
 * The series a detector may read: the forming bar is cut off.
 *
 * This is `closedBars` under a name that says why, so a caller that wants
 * LOCATION (how far price is from the array, which half of the range it sits
 * in) keeps using the full series and a caller that wants a sweep, a gap or a
 * displacement cannot accidentally read a bar that has not closed.
 */
export function closedTape(
  bars: readonly OhlcBar[] | null | undefined,
  nowMs: number,
  interval: string | number = "15m",
): OhlcBar[] {
  const list = Array.isArray(bars) ? bars.slice() : [];
  if (!list.length || !Number.isFinite(nowMs)) return list;
  return closedBars(list, interval, nowMs);
}

/** The minimal card shape this gate touches. Structural on purpose: scanner.ts imports this file, not the other way round. */
export interface TapeGatedCard {
  actionable: boolean;
  missing: string[];
}

/**
 * Stand a card down on a late tape. One call, and it only ever removes a take.
 *
 * Returns true when the card was stood down, so a caller can skip the rest of
 * its own arming work.
 */
export function applyTapeTrust(card: TapeGatedCard, trust: TapeTrust): boolean {
  if (trust.ok) return false;
  card.actionable = false;
  if (!card.missing.includes(trust.reason)) card.missing.unshift(trust.reason);
  return true;
}
