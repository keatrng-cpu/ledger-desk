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
 * The fee model — one per VENUE, because the same NFL contract costs
 * different amounts depending on where it is traded.
 *
 * FIXED 2026-09-27. The first version charged every trade Kalshi's 7% taker
 * formula plus a flat 1¢ Robinhood commission. That is not what a Robinhood
 * customer pays: Robinhood charges its OWN commission (k·p·(1−p) per
 * contract, capped at 1¢, k = 10% or 5% with Gold, rounded up per trade)
 * plus the LISTING exchange's fee — and on 2026-09-27 Robinhood's NFL
 * moneylines were listed on Rothera (the Robinhood–Susquehanna exchange),
 * not Kalshi. Checked against the published schedules:
 *   Robinhood RHD fee schedule: cdn.robinhood.com/assets/robinhood/legal/RHD_Fee_Schedule.pdf
 *   Rothera fee schedule 2026-05-20: k = 0.02 retail, max(round(k·p(1−p)·C, 2), $0.01) per order
 *   Kalshi fee schedule (eff. 2026-07-07): taker ceil(0.07·C·P(1−P)); via Robinhood $0.01/contract/side
 *   Polymarket US (eff. 2026-09-25): taker 0.0695·C·p(1−p)
 * Reproduces the published-formula worked example: 100 contracts bought at
 * 25¢ and sold at 40¢ cost $2.86 via Robinhood→Rothera, $4.00 via
 * Robinhood→Kalshi, $3.00 as a Kalshi taker, $2.97 as a Polymarket US taker.
 */
export type VenueId = "rh-rothera" | "rh-rothera-gold" | "rh-kalshi" | "rh-kalshi-gold" | "kalshi" | "polymarket-us";

export interface FeeModel {
  id: VenueId;
  label: string;
  /** Dollars charged on ONE side (a buy or a sell) of `contracts` at `price`. */
  perSide: (price: number, contracts: number) => number;
  source: string;
  checkedAt: string;
}

const cents = (x: number) => Math.round(x * 100) / 100;
const ceilCents = (x: number) => Math.ceil(x * 100 - 1e-9) / 100;
/** Robinhood's commission: k·p(1−p) per contract, capped at 1¢, rounded up per trade. */
const rhCommission = (k: number, p: number, c: number) => ceilCents(Math.min(k * p * (1 - p), 0.01) * c);

export const VENUES: Record<VenueId, FeeModel> = {
  "rh-rothera": {
    id: "rh-rothera",
    label: "Robinhood → Rothera",
    perSide: (p, c) => cents(rhCommission(0.1, p, c) + Math.max(cents(0.02 * p * (1 - p) * c), 0.01)),
    source: "Robinhood commission (10%·p(1−p), max 1¢/contract) + Rothera retail fee (2%·p(1−p), min 1¢/order)",
    checkedAt: "2026-09-27",
  },
  "rh-rothera-gold": {
    id: "rh-rothera-gold",
    label: "Robinhood Gold → Rothera",
    perSide: (p, c) => cents(rhCommission(0.05, p, c) + Math.max(cents(0.02 * p * (1 - p) * c), 0.01)),
    source: "Robinhood Gold commission (5%·p(1−p), max 1¢/contract) + Rothera retail fee",
    checkedAt: "2026-09-27",
  },
  "rh-kalshi": {
    id: "rh-kalshi",
    label: "Robinhood → Kalshi",
    perSide: (p, c) => cents(rhCommission(0.1, p, c) + 0.01 * c),
    source: "Robinhood commission (10%·p(1−p), max 1¢/contract) + Kalshi exchange fee 1¢/contract",
    checkedAt: "2026-09-27",
  },
  "rh-kalshi-gold": {
    id: "rh-kalshi-gold",
    label: "Robinhood Gold → Kalshi",
    perSide: (p, c) => cents(rhCommission(0.05, p, c) + 0.01 * c),
    source: "Robinhood Gold commission (5%·p(1−p), max 1¢/contract) + Kalshi exchange fee 1¢/contract",
    checkedAt: "2026-09-27",
  },
  kalshi: {
    id: "kalshi",
    label: "Kalshi direct (taker)",
    perSide: (p, c) => ceilCents(0.07 * c * p * (1 - p)),
    source: "Kalshi taker fee 7%·C·p(1−p), rounded up (NFL makers 1.75%)",
    checkedAt: "2026-09-27",
  },
  "polymarket-us": {
    id: "polymarket-us",
    label: "Polymarket US (taker)",
    perSide: (p, c) => cents(0.0695 * c * p * (1 - p)),
    source: "Polymarket US taker fee 6.95%·C·p(1−p) (makers get a 1.25% rebate)",
    checkedAt: "2026-09-27",
  },
};

/** The trader's venue for NFL moneylines on 2026-09-27: Robinhood, listed on Rothera. */
export const DEFAULT_FEES: FeeModel = VENUES["rh-rothera"];

/** Fees in dollars for one side (a buy or a sell) of `contracts` at `price`. */
export function sideFee(price: number, contracts: number, fees: FeeModel = DEFAULT_FEES): number {
  if (!(price > 0 && price < 1) || !(contracts > 0)) return 0;
  return fees.perSide(price, contracts);
}

/** Per-contract fee, for comparing against a per-contract edge (100-contract order). */
export function feePerContract(price: number, contracts = 100, fees: FeeModel = DEFAULT_FEES): number {
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
  const fee = feePerContract(ask, 100, fees);
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
export function exitRuleShape(entry: number, target: number, fees: FeeModel = DEFAULT_FEES, contracts = 100) {
  if (!(entry > 0 && target > entry && target < 1)) return null;
  // Aldous (2013): for a martingale price that ends at 0 or 1, the chance of
  // ever touching q from p is p/q with continuous paths — and at most p/q
  // with jumps (a touchdown can leap past q). The expected value of "sell at
  // q, else hold" is p either way; costs make it negative.
  const pHit = entry / target;
  const rt = roundTrip(entry, target, contracts, fees);
  const lossIfMiss = -(entry * contracts + sideFee(entry, contracts, fees));
  const ev = pHit * rt.pnl + (1 - pHit) * lossIfMiss;
  return {
    pHit,
    contracts,
    winIfHit: rt.pnl,
    lossIfMiss: Math.round(lossIfMiss * 100) / 100,
    /** Expected P/L if the entry was fairly priced. Always negative: the fees (and the spread). */
    ev: Math.round(ev * 100) / 100,
    evPct: ev / (entry * contracts),
  };
}

/** Where the documented favorite–longshot bias bites hardest. */
export const LONGSHOT_BELOW = 0.2;
