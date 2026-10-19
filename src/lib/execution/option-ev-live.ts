/**
 * Live option EV for a card (SHADOW / injected greeks).
 *
 * #61 ranks targets by option EV using the backtest's MODELLED option (fixed
 * delta/gamma). This prices the SAME EV from the REAL contract — the live chain's
 * delta, gamma, theta, bid/ask — so the card's best target reflects the option
 * actually being bought, not an approximation.
 *
 * Greeks are INJECTED (LiveGreeks), never fetched here: this keeps the module pure
 * and testable and keeps a network call off the card-build hot path. The thin
 * adapter from the desk's RH chain reader (rhGreeks) is documented below; wiring
 * it into the live card is the gated promotion step. Nothing here places an order.
 */
import { rankTargetsByOptionEv, type TargetEv } from "@/lib/backtest/target-ev";
import { DEFAULT_OPT, type OptModel } from "@/lib/backtest/engine";

/** Real greeks for ONE candidate contract (ATM / OTM1), as the chain reports them. */
export interface LiveGreeks {
  /** Option delta (signed; magnitude is used). */
  delta: number;
  /** Option gamma per 1.0 of the underlying (QQQ/SPY point). Missing → 0 (linear). */
  gamma?: number | null;
  /** Theta per DAY (negative). Used only when minutesToExpiry is absent. */
  thetaPerDay?: number | null;
  bid?: number | null;
  /** Ask = the debit paid. Required to price. */
  ask: number;
  iv?: number | null;
  /** Minutes of option life left (to expiry). Drives the √-time theta curve. */
  minutesToExpiry?: number | null;
  /** OCC symbol, for the row / audit. */
  occ?: string | null;
}

export interface CardTarget {
  price: number;
  /** Futures R vs the plan risk. */
  rr: number;
  /** P(target before stop | fill) from the ladder calibration. Null → not chosen. */
  pWin: number | null;
}

export interface CardForEv {
  symbol: string;
  side: "long" | "short";
  entry: number;
  stop: number;
  targets: CardTarget[];
  /** Underlying-points-per-futures-point (QQQ/NQ, SPY/ES). Default from DEFAULT_OPT. */
  ratio?: number;
}

/** Spread fallback when only the ask is known: a fraction of the ask. */
export const DEFAULT_SPREAD_PCT_OF_ASK = 0.05;

/** Build an engine OptModel from a live option quote. Null when there is no ask to pay. */
export function modelFromGreeks(g: LiveGreeks, ratio: number): OptModel | null {
  if (!(g.ask > 0)) return null;
  const spread = g.bid != null && g.ask != null ? Math.max(0, g.ask - g.bid) : g.ask * DEFAULT_SPREAD_PCT_OF_ASK;
  // thetaPerMin is a fallback only; when minutesToExpiry is known the √-curve governs.
  const MIN_PER_DAY = 6.5 * 60; // one RTH session
  const thetaPerMin = g.thetaPerDay != null ? Math.abs(g.thetaPerDay) / MIN_PER_DAY : 0;
  return {
    delta: Math.abs(g.delta),
    gamma: Math.abs(g.gamma ?? 0),
    thetaPerMin,
    spread,
    ratio,
    premium: g.ask,
  };
}

const ratioFor = (symbol: string): number =>
  DEFAULT_OPT[symbol]?.ratio ?? (symbol.includes("ES") ? 1 / 10 : 1 / 50);

export interface CardOptionEv {
  symbol: string;
  occ: string | null;
  model: OptModel | null;
  best: TargetEv | null;
  ranked: TargetEv[];
  /** Why null, when it is. */
  reason: string | null;
  shadow: true;
}

/**
 * Rank a card's targets by the REAL option EV from live greeks. `best` is the
 * max-EV target with a calibrated pWin and positive EV, or null.
 */
export function cardOptionEv(
  card: CardForEv,
  greeks: LiveGreeks,
  opts: { entryTms?: number; minutesToStop?: number; defaultMinutesPerR?: number } = {},
): CardOptionEv {
  const ratio = card.ratio ?? ratioFor(card.symbol);
  const model = modelFromGreeks(greeks, ratio);
  if (!model) return { symbol: card.symbol, occ: greeks.occ ?? null, model: null, best: null, ranked: [], reason: "no ask to price the contract", shadow: true };
  const { best, ranked } = rankTargetsByOptionEv(
    card.targets.map((t) => ({ price: t.price, rr: t.rr, pWin: t.pWin })),
    {
      model, side: card.side, entry: card.entry, stop: card.stop,
      entryTms: opts.entryTms,
      minutesToExpiry: greeks.minutesToExpiry ?? undefined,
      minutesToStop: opts.minutesToStop,
      defaultMinutesPerR: opts.defaultMinutesPerR,
    },
  );
  return { symbol: card.symbol, occ: greeks.occ ?? null, model, best, ranked, reason: best ? null : "no target with a calibrated pWin and positive option EV", shadow: true };
}

/**
 * Adapter: map one Robinhood `get_option_quotes` row → LiveGreeks. RH returns
 * delta/gamma/theta/implied_volatility and bid_price/ask_price per contract; theta
 * is per day. `minutesToExpiry` is computed from the contract's expiration in ET by
 * the caller (the chain reader knows the expiry). This is the shape the gated live
 * hookup feeds cardOptionEv — kept here so the mapping is one documented place.
 */
export function greeksFromRhQuote(q: {
  delta?: number | string | null; gamma?: number | string | null; theta?: number | string | null;
  implied_volatility?: number | string | null; bid_price?: number | string | null; ask_price?: number | string | null;
  occ_symbol?: string | null;
}, minutesToExpiry: number | null): LiveGreeks | null {
  const n = (v: unknown): number | null => {
    const x = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    return Number.isFinite(x) ? x : null;
  };
  const delta = n(q.delta), ask = n(q.ask_price);
  if (delta == null || ask == null || !(ask > 0)) return null;
  return {
    delta, gamma: n(q.gamma), thetaPerDay: n(q.theta), iv: n(q.implied_volatility),
    bid: n(q.bid_price), ask, minutesToExpiry, occ: q.occ_symbol ?? null,
  };
}
