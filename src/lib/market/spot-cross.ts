/**
 * The futures → ETF crossover for the options desk (QQQ ← MNQ/NQ, SPY ← ES).
 *
 * WHY THIS EXISTS
 * A 1-DTE ATM option costs about 0.4% of the ETF (QQQ 777.50, IV 19%, ~$3.2), so a 1% error
 * in the spot an option is priced on is roughly the whole premium. The desk took the Yahoo
 * ETF print as "now" for up to 15 minutes (PROXY_SPOT_MAX_LAG_SEC) and read its ratio to the
 * LIVE future off that stale print — mixing two different moments. Futures trade almost 24h
 * and arrive from the Databento gateway at sub-second, so they are the live clock; the ETF
 * print only has to say what the ratio WAS at the instant it printed.
 *
 *   ratio = future-at-the-print's-own-timestamp ÷ the print          (time-aligned)
 *   ETF now = future now ÷ ratio                                     (live)
 *
 * The future at the print's timestamp comes from the desk's own 1m bars (Yahoo's series with
 * the gateway's closed bars overlaid), interpolated open→close inside the minute. Pure.
 * `estimateSpot` (options-desk.ts) divides the CURRENT future by this ratio, so the ETF
 * spot keeps moving at futures speed between desk builds.
 */

import type { OhlcBar } from "./types";
import type { ProxySpot } from "./yahoo";

/** The fixed fallback the desk always had: SPY = ES/10, QQQ = NQ/40. Used only when nothing can be aligned. */
export const DEFAULT_RATIO = { SPY: 10, QQQ: 40 } as const;

/** An aligned ratio must sit within this share of the default, or it is not a ratio (a bad print or a mismatched series). */
export const RATIO_BAND = 0.08;
/** A print this young IS the spot: no bar alignment needed. */
export const PRINT_FRESH_SEC = 5;
/** The weekend: Friday's 16:00 print still calibrates Sunday night's ratio. Older than this, fall back. */
export const PRINT_MAX_AGE_SEC = 72 * 3600;
/** The future's last bar and the live quote must agree within this share, or the series changed under us (a roll). */
export const SERIES_AGREE = 0.01;
/** A print inside a bar gap may borrow the nearest bar's close only this close. */
export const ALIGN_MAX_GAP_SEC = 150;
/**
 * A fresh print calibrates against the NOW future only when the future is itself live. Yahoo's
 * futures run ~10 min behind its ETF prints; dividing one by the other reads two moments as one
 * ratio — the bug this module removes. Past this lag the real-time print is the better clock.
 */
export const FUT_LIVE_MAX_LAG_SEC = 30;

const MIN_MS = 60_000;

/**
 * The future's price at an instant, from ascending 1m bars: open→close interpolated by the
 * position inside the minute that contains it. Null when the bars do not cover the instant
 * (before the first bar, or more than ALIGN_MAX_GAP_SEC past the last bar's end).
 */
export function futAt(bars: readonly OhlcBar[], tMs: number): number | null {
  if (!bars.length || !Number.isFinite(tMs)) return null;
  const first = bars[0]!;
  if (tMs < first.t) return null;
  // Last bar that starts at or before the instant.
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid]!.t <= tMs) lo = mid;
    else hi = mid - 1;
  }
  const b = bars[lo]!;
  const inside = tMs - b.t;
  if (inside < MIN_MS) {
    const frac = Math.min(1, Math.max(0, inside / MIN_MS));
    const px = b.o + (b.c - b.o) * frac;
    return px > 0 ? px : null;
  }
  // Past this bar's end with no later bar: a gap (halt, thin overnight minute).
  return (inside - MIN_MS) / 1000 <= ALIGN_MAX_GAP_SEC && b.c > 0 ? b.c : null;
}

export interface CrossRead {
  /** futures ÷ ETF at the print's instant; null when it could not be aligned. */
  ratio: number | null;
  /** Why it is (not) there, for the card copy and the tests. */
  how:
    | "fresh_print"
    | "aligned"
    | "no_print"
    | "print_too_old"
    | "bars_do_not_cover"
    | "ratio_out_of_band"
    | "series_mismatch"
    | "no_future"
    | "future_not_live";
}

/** The live future the ETF is crossed against: its price and how old that price is (gateway ~1 s, Yahoo ~600 s). */
export interface FutureNow {
  px: number;
  lagSec: number;
}

/**
 * The time-aligned ratio for one underlier, or why not. `fut` is the live future (gateway
 * first); `bars` the same symbol's 1m bars; `nowMs` the desk's clock.
 */
export function alignRatio(
  underlier: "SPY" | "QQQ",
  proxy: Pick<ProxySpot, "price" | "marketTimeMs"> | null,
  bars: readonly OhlcBar[],
  fut: FutureNow,
  nowMs: number,
): CrossRead {
  if (!proxy || !(proxy.price > 0)) return { ratio: null, how: "no_print" };
  if (!(fut.px > 0)) return { ratio: null, how: "no_future" };
  const ageSec = Math.max(0, (nowMs - proxy.marketTimeMs) / 1000);
  const def = DEFAULT_RATIO[underlier];
  const accept = (r: number): CrossRead =>
    Math.abs(r / def - 1) <= RATIO_BAND
      ? { ratio: Math.round(r * 10_000) / 10_000, how: ageSec <= PRINT_FRESH_SEC ? "fresh_print" : "aligned" }
      : { ratio: null, how: "ratio_out_of_band" };
  if (ageSec <= PRINT_FRESH_SEC) {
    // Two moments in one ratio is the failure: a delayed future against a live print is not aligned.
    return fut.lagSec <= FUT_LIVE_MAX_LAG_SEC ? accept(fut.px / proxy.price) : { ratio: null, how: "future_not_live" };
  }
  if (ageSec > PRINT_MAX_AGE_SEC) return { ratio: null, how: "print_too_old" };
  const last = bars[bars.length - 1];
  if (last && last.c > 0 && Math.abs(fut.px / last.c - 1) > SERIES_AGREE) return { ratio: null, how: "series_mismatch" };
  const at = futAt(bars, proxy.marketTimeMs);
  if (at == null) return { ratio: null, how: "bars_do_not_cover" };
  return accept(at / proxy.price);
}

/** The proxy with its aligned ratio and print age attached (never mutates). Null in, null out. */
export function crossProxy(
  underlier: "SPY" | "QQQ",
  proxy: ProxySpot | null,
  bars: readonly OhlcBar[],
  fut: FutureNow,
  nowMs: number,
): ProxySpot | null {
  if (!proxy) return proxy;
  const r = alignRatio(underlier, proxy, bars, fut, nowMs);
  return { ...proxy, printAgeSec: Math.max(0, Math.round((nowMs - proxy.marketTimeMs) / 1000)), ratio: r.ratio };
}

/** One futures book as the desk holds it: its symbol, the freshest quote, its 1m bars. */
export interface CrossBook {
  symbol: string;
  quote: { price: number; lagSec: number; source: string };
  minute: readonly OhlcBar[];
}

const isNq = (s: string) => s === "NQ" || s === "MNQ";
const isEs = (s: string) => s === "ES" || s === "MES";

/**
 * Both ETF spots crossed against the book that holds THEIR future (QQQ ← NQ/MNQ, SPY ← ES/MES),
 * wherever the desk put it (left or right). A quote whose source `isLive` rejects (synthetic: a
 * constant stamped lag 0) crosses nothing — that ETF's proxy comes back untouched.
 */
export function crossBoth(
  books: { left: CrossBook; right: CrossBook },
  spots: { SPY: ProxySpot | null; QQQ: ProxySpot | null },
  nowMs: number,
  isLive: (source: string) => boolean,
): { SPY: ProxySpot | null; QQQ: ProxySpot | null } {
  const one = (u: "SPY" | "QQQ", book: CrossBook | null): ProxySpot | null => {
    const spot = spots[u];
    if (!book || !isLive(book.quote.source)) return spot;
    return crossProxy(u, spot, book.minute, { px: book.quote.price, lagSec: book.quote.lagSec }, nowMs);
  };
  const { left, right } = books;
  const nq = isNq(left.symbol) ? left : isNq(right.symbol) ? right : null;
  const es = isEs(right.symbol) ? right : isEs(left.symbol) ? left : null;
  return { SPY: one("SPY", es), QQQ: one("QQQ", nq) };
}

/** The ETF now: the live future through the aligned ratio. Null when there is no ratio or the answer is not credible. */
export function etfFromFuture(ratio: number | null | undefined, futNow: number, printPx: number): number | null {
  if (!(ratio != null && ratio > 0) || !(futNow > 0)) return null;
  const px = futNow / ratio;
  // Never more than 10% from the last print (a futures glitch must not move the ETF a tenth).
  return printPx > 0 && Math.abs(px / printPx - 1) > 0.1 ? null : px;
}
