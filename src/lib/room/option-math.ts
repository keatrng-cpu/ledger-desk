/**
 * Option arithmetic for the trading floor — one pricer for every number the
 * room quotes: the strike Nova picks, the limit Vince routes, the fill the
 * paper book books, the mark a position is stopped on.
 *
 * WHY BLACK-SCHOLES HERE AND NOT `estimateDebitContract`
 * The options desk prices a DELTA (0.40Δ ≈ 0.4·S·σ·√T), not a strike, because
 * a ticket on the Options tab is advice, and advice can say "about 0.40Δ". The
 * room books fills on a named strike and marks them every cycle until a stop
 * fires, so it needs a price that moves with spot and with the clock. Plain
 * Black-Scholes with r = 0 is the smallest model that does both.
 *
 * WHAT IT IS NOT
 * Not a chain mid. There is no live chain on this desk. IV is VIX-scaled (SPY
 * reads VIX/100, QQQ reads VIX/100 × the desk's own QQQ:SPY IV ratio), so skew,
 * the 0DTE pin and the morning IV crush are all missing. Every quote the room
 * prints says "model", and the spread is the desk's measured crossing cost,
 * not a guess at the book.
 */

import { IV as DESK_IV, roundTripCost } from "@/lib/trading/options-desk";
import { etWallParts, etWallToEpochMs } from "@/lib/trading/sessions";

export type Underlier = "SPY" | "QQQ";
export type OptionType = "CALL" | "PUT";
/**
 * The room's contract and the trader's JSON schema allow ATM and the strike one dollar out. The seats' experiment account
 * (seats.ts) may reach further, so the type carries any step; `offsetOf` — what a close ticket reads — still only
 * ever answers ATM or OTM_1.
 */
export type StrikeOffset = "ATM" | `OTM_${number}`;

/**
 * Half the bid/ask, per share. The desk prices a single-leg round trip at
 * `roundTripCost("single")` dollars per contract — two crossings — so one
 * crossing from mid is half of that, over 100 shares.
 */
export const HALF_SPREAD = roundTripCost("single") / 2 / 100;

/** The smallest time value the pricer will use: 15 minutes before the bell. */
const MIN_T_YEARS = 15 / (365 * 24 * 60);
const YEAR_MS = 365 * 24 * 60 * 60_000;

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 7.5e-8). */
export function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export interface BsRead {
  /** Fair value per share. */
  price: number;
  /** 0–1 for calls, −1–0 for puts. */
  delta: number;
  /** Value lost per calendar day at this spot, per share (positive number). */
  thetaDay: number;
}

/** Black-Scholes, r = 0, European. Fine for a 0–1 DTE ETF option. */
export function blackScholes(spot: number, strike: number, tYears: number, iv: number, type: OptionType): BsRead {
  const t = Math.max(tYears, MIN_T_YEARS);
  const sig = Math.max(iv, 0.01);
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + 0.5 * sig * sig * t) / (sig * sqrtT);
  const d2 = d1 - sig * sqrtT;
  const call = spot * normCdf(d1) - strike * normCdf(d2);
  const price = type === "CALL" ? call : call - spot + strike;
  const delta = type === "CALL" ? normCdf(d1) : normCdf(d1) - 1;
  const thetaYear = (spot * normPdf(d1) * sig) / (2 * sqrtT);
  return { price: Math.max(price, 0), delta, thetaDay: thetaYear / 365 };
}

/** The bell on expiry day: 16:00 ET. */
export function expiryMs(expEtDate: string): number {
  return etWallToEpochMs(expEtDate, "16:00");
}

const DAY_MS = 24 * 60 * 60_000;
const isoPlusDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const isWeekendDate = (d: string) => {
  const w = new Date(`${d}T12:00:00Z`).getUTCDay();
  return w === 0 || w === 6;
};

/** Milliseconds of Saturday and Sunday (ET calendar days) inside [fromMs, toMs]. */
function weekendMsBetween(fromMs: number, toMs: number): number {
  let total = 0;
  const last = etDateOf(toMs);
  for (let d = etDateOf(fromMs), n = 0; n < 14; d = isoPlusDays(d, 1), n++) {
    if (isWeekendDate(d)) {
      const start = etWallToEpochMs(d, "00:00");
      const end = etWallToEpochMs(isoPlusDays(d, 1), "00:00");
      total += Math.max(0, Math.min(end, toMs) - Math.max(start, fromMs));
    }
    if (d === last) break;
  }
  return total;
}

/**
 * Years of option life left: calendar time with the weekend taken out. Variance accrues on trading days, so a
 * Friday option that expires Monday has about one trading day of life, not three calendar days. At full
 * calendar weight a Friday "1 DTE" ATM call cost 66% more than the same 12.5 trading hours on a Thursday
 * (QQQ 777.5, IV 19.1%: $5.33 vs $3.22). Weekday overnights keep full weight, so Mon–Thu pricing, and every
 * measurement made on it, is unchanged. Market holidays are not removed (no calendar in the repo).
 */
export function yearsToExpiry(nowMs: number, expEtDate: string): number {
  const end = expiryMs(expEtDate);
  if (!(end > nowMs)) return 0;
  return Math.max((end - nowMs - weekendMsBetween(nowMs, end)) / YEAR_MS, 0);
}

/**
 * Implied vol the room prices with. SPY reads VIX directly (VIX is SPX 30-day
 * IV); QQQ scales it by the desk's own QQQ:SPY ratio from options-desk.ts.
 * Without a VIX print the desk's fixed IVs are used, and `ivSource` says so.
 */
export function ivFor(underlier: Underlier, vix: number | null): number {
  if (vix == null || !Number.isFinite(vix) || vix <= 0) return DESK_IV[underlier];
  const spy = vix / 100;
  return underlier === "SPY" ? spy : spy * (DESK_IV.QQQ / DESK_IV.SPY);
}

export function ivSource(vix: number | null): string {
  return vix != null && Number.isFinite(vix) && vix > 0 ? `VIX ${vix.toFixed(1)}` : "desk fixed IV (no VIX print)";
}

/** SPY and QQQ list $1 strikes on 0–1 DTE. ATM is the nearest; OTM_k is k steps out. */
export function strikeFor(spot: number, type: OptionType, offset: StrikeOffset): number {
  const atm = Math.round(spot);
  if (offset === "ATM") return atm;
  const k = Math.max(1, Math.round(Number(offset.slice(4))) || 1);
  return type === "CALL" ? atm + k : atm - k;
}

/** The step count an offset names: ATM is 0. */
export const stepsOf = (offset: StrikeOffset): number => (offset === "ATM" ? 0 : Math.max(1, Math.round(Number(offset.slice(4))) || 1));
export const offsetAt = (steps: number): StrikeOffset => (steps <= 0 ? "ATM" : (`OTM_${Math.round(steps)}` as StrikeOffset));

/** Which label a held strike carries against today's spot (for a close ticket). */
export function offsetOf(spot: number, strike: number, type: OptionType): StrikeOffset {
  const otmBy = type === "CALL" ? strike - spot : spot - strike;
  return otmBy >= 0.5 ? "OTM_1" : "ATM";
}

export interface OptionQuote {
  strike: number;
  mid: number;
  bid: number;
  ask: number;
  delta: number;
  thetaDay: number;
  iv: number;
}

function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Model mid with the desk's crossing cost either side, on the penny grid. */
export function quoteOption(
  spot: number,
  strike: number,
  expEtDate: string,
  type: OptionType,
  iv: number,
  nowMs: number,
): OptionQuote {
  const bs = blackScholes(spot, strike, yearsToExpiry(nowMs, expEtDate), iv, type);
  const mid = cents(Math.max(bs.price, 0.01));
  return {
    strike,
    mid,
    bid: cents(Math.max(mid - HALF_SPREAD, 0.01)),
    ask: cents(mid + HALF_SPREAD),
    delta: bs.delta,
    thetaDay: bs.thetaDay,
    iv,
  };
}

/**
 * How much of a premium stop pure decay eats before the time stop, with spot
 * held still. 1.0 = the stop fires on the calendar alone — it is a clock, not
 * a level (the same test sleeve-sizing.ts runs with its crude decay curve;
 * here it is priced on the strike actually being bought).
 */
export function decayToStop(
  spot: number,
  strike: number,
  expEtDate: string,
  type: OptionType,
  iv: number,
  nowMs: number,
  untilMs: number,
  stopFrac: number,
): number {
  const now = blackScholes(spot, strike, yearsToExpiry(nowMs, expEtDate), iv, type).price;
  const later = blackScholes(spot, strike, yearsToExpiry(Math.max(untilMs, nowMs), expEtDate), iv, type).price;
  if (!(now > 0) || !(stopFrac > 0)) return 0;
  return Math.max(0, (now - later) / now) / stopFrac;
}

/** YYYY-MM-DD in ET for an instant. */
export function etDateOf(ms: number): string {
  const p = etWallParts(ms);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The next weekday after `etDate` (1 DTE). Holidays are not modelled. */
export function nextWeekday(etDate: string): string {
  const [y, m, d] = etDate.split("-").map(Number);
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12));
  do t.setUTCDate(t.getUTCDate() + 1);
  while (t.getUTCDay() === 0 || t.getUTCDay() === 6);
  return t.toISOString().slice(0, 10);
}

/** "Oct 5" — for the floor's spoken lines. */
export function shortDate(etDate: string): string {
  const [y, m, d] = etDate.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
