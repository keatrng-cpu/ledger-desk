/**
 * Prediction-market arithmetic — prices, fees, references, round trips.
 *
 * A contract pays $1 if the event happens and $0 if not, so its price IS a
 * probability the market is quoting. Everything on the Predict tab reduces
 * to comparing that price against something independent, AFTER costs:
 *
 *   edge per contract = reference probability − price paid − fees
 *
 * THE ONE LAW EVERY EXIT RULE OBEYS
 * If the price is a fair probability, it is a martingale: its expected value
 * tomorrow (or at halftime) is today's price. Optional stopping then says no
 * rule for WHEN to sell — "sell when it rises 10 points", "sell at halftime"
 * — changes the expected value of a position. It only changes its shape
 * (more small wins, occasional full losses) and adds a second set of fees
 * and a second spread. An exit rule makes money only if the ENTRY was
 * mispriced. That is why this file prices the entry, and prices the
 * round trip honestly, and never scores an exit rule on its own.
 */

/** American odds → implied probability (still containing the book's margin). */
export function americanToProb(odds: number): number | null {
  if (!Number.isFinite(odds) || odds === 0) return null;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

/** Parse "+260", "-325", "EVEN", 260 → number. */
export function parseAmerican(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().toUpperCase();
  if (s === "EVEN" || s === "EV") return 100;
  const n = Number(s.replace(/^\+/, ""));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/**
 * Remove the bookmaker's margin (the "vig") by normalizing both sides to sum
 * to 1. Proportional de-vigging is the simplest standard method; it slightly
 * over-states longshots relative to methods that assign more of the margin
 * to them, so a no-vig longshot probability here is, if anything, generous.
 */
export function noVig(pA: number | null, pB: number | null): { a: number; b: number; overround: number } | null {
  if (pA == null || pB == null || !(pA > 0) || !(pB > 0)) return null;
  const sum = pA + pB;
  return { a: pA / sum, b: pB / sum, overround: sum - 1 };
}

/**
 * The fee model. Kalshi's published taker fee is ceil(rate × C × P × (1−P))
 * rounded UP to the next cent per order; Robinhood adds a per-contract
 * commission. Rates live here as parameters with their source, so a changed
 * schedule is a one-line edit.
 */
export interface FeeModel {
  /** Kalshi taker rate in the P×(1−P) formula. */
  takerRate: number;
  /** Broker commission per contract per side (Robinhood). */
  brokerPerContract: number;
  source: string;
  checkedAt: string;
}

export const DEFAULT_FEES: FeeModel = {
  takerRate: 0.07,
  brokerPerContract: 0.01,
  source: "Kalshi fee schedule (taker 0.07 × C × P × (1−P), rounded up to the cent) + Robinhood $0.01/contract commission",
  checkedAt: "2026-09-27",
};

/** Fees in dollars for one side (a buy or a sell) of `contracts` at `price`. */
export function sideFee(price: number, contracts: number, fees: FeeModel = DEFAULT_FEES): number {
  if (!(price > 0 && price < 1) || !(contracts > 0)) return 0;
  const exchange = Math.ceil(fees.takerRate * contracts * price * (1 - price) * 100 - 1e-9) / 100;
  return Math.round((exchange + fees.brokerPerContract * contracts) * 100) / 100;
}

/** Per-contract fee, for comparing against a per-contract edge. */
export function feePerContract(price: number, contracts = 10, fees: FeeModel = DEFAULT_FEES): number {
  return sideFee(price, contracts, fees) / contracts;
}

export interface EntryRead {
  /** Price paid (the ask). */
  price: number;
  reference: number;
  fee: number;
  /** Dollars per contract, held to settlement. */
  edge: number;
  /** edge / price — return on the dollars at risk. */
  edgePct: number;
}

/** Expected value of buying at `ask` if `reference` is the true probability, held to settlement. */
export function entryEdge(ask: number, reference: number, fees: FeeModel = DEFAULT_FEES): EntryRead {
  const fee = feePerContract(ask, 10, fees);
  const edge = reference - ask - fee;
  return { price: ask, reference, fee, edge, edgePct: ask > 0 ? edge / ask : 0 };
}

export interface RoundTrip {
  contracts: number;
  cost: number;
  proceeds: number;
  fees: number;
  pnl: number;
  /** Exit price needed just to get your money back, after both sides' fees. */
  breakevenExit: number;
}

/** Buy `contracts` at `entry`, sell them at `exit` before settlement. Both sides pay. */
export function roundTrip(entry: number, exit: number, contracts: number, fees: FeeModel = DEFAULT_FEES): RoundTrip {
  const cost = entry * contracts;
  const proceeds = exit * contracts;
  const f = sideFee(entry, contracts, fees) + sideFee(exit, contracts, fees);
  let lo = entry;
  let hi = 0.99;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const net = mid * contracts - cost - sideFee(entry, contracts, fees) - sideFee(mid, contracts, fees);
    if (net >= 0) hi = mid;
    else lo = mid;
  }
  return {
    contracts,
    cost: Math.round(cost * 100) / 100,
    proceeds: Math.round(proceeds * 100) / 100,
    fees: Math.round(f * 100) / 100,
    pnl: Math.round((proceeds - cost - f) * 100) / 100,
    breakevenExit: Math.ceil(hi * 100) / 100,
  };
}

/**
 * What a "sell when it rises to X" rule is worth if the entry price was fair:
 * the martingale says the chance of touching X before the event resolves is
 * about (entry − 0)/(X − 0) when the alternative path runs to zero — so the
 * rule wins small often and loses everything sometimes, and its expected
 * value is the entry price, minus both sides' fees. Returned so the tab can
 * show the shape, not a promise.
 */
export function exitRuleShape(entry: number, target: number, fees: FeeModel = DEFAULT_FEES) {
  if (!(entry > 0 && target > entry && target < 1)) return null;
  const pHit = entry / target;
  const rt = roundTrip(entry, target, 10, fees);
  const lossIfMiss = -(entry * 10 + sideFee(entry, 10, fees));
  const ev = pHit * rt.pnl + (1 - pHit) * lossIfMiss;
  return {
    pHit,
    winIfHit: rt.pnl,
    lossIfMiss: Math.round(lossIfMiss * 100) / 100,
    /** Expected P/L on 10 contracts if the entry was fairly priced. Always negative: fees. */
    ev: Math.round(ev * 100) / 100,
  };
}

/** Where the documented favorite–longshot bias bites hardest. */
export const LONGSHOT_BELOW = 0.2;
