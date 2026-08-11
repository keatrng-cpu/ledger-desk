/**
 * THE trade money math. Pure, no I/O.
 *
 * Live (`journal/server.ts` closeTrade) and paper (`bridge/paper-server.ts`)
 * MUST both go through here. They previously each implemented this
 * independently and drifted: paper charged commission twice (`* 2`) and
 * stored an `r` that was a raw price ratio ignoring commission entirely, so
 * paper R was pinned to exactly -1.00 / +2.00 while an identical live trade
 * booked -1.05. That makes the paper track record look systematically
 * cleaner than live — and that track record is the evidence for whether live
 * trading unlocks (ROADMAP Phase 4). One function, one convention, no drift.
 *
 * COMMISSION CONVENTION: `CONTRACTS[sym].commission` is the **round-turn**
 * cost per contract (entry + exit together), charged ONCE when the trade
 * closes. Do not also charge it on open.
 */

import { CONTRACTS, type ContractKey } from "@/lib/aplus/config";

export interface TradePnlInput {
  symbol: string;
  side: "long" | "short";
  entry: number;
  exit: number;
  /** Planned stop. Null → no defined 1R, so `r` is null. */
  stop: number | null;
  contracts: number;
  /** Dollars, already positive. Paper fills assume 0 unless modeled. */
  slippage?: number;
}

export interface TradePnlResult {
  /** NET dollars: gross − round-turn commission − slippage. */
  pnl: number;
  /** Round-turn commission actually charged (dollars). */
  commission: number;
  /** Planned 1R in dollars (|entry − stop| × pointValue × contracts). */
  riskDollars: number;
  /** NET R multiple. Null when there was no stop to define 1R. */
  r: number | null;
}

/** Contract spec, falling back to MNQ economics for an unknown symbol. */
export function contractSpec(symbol: string) {
  const key = symbol.toUpperCase() as ContractKey;
  return CONTRACTS[key] ?? CONTRACTS.MNQ;
}

/** Whether a symbol is one we actually have real economics for. */
export function isKnownSymbol(symbol: string): boolean {
  return symbol.toUpperCase() in CONTRACTS;
}

export function computeTradePnl(input: TradePnlInput): TradePnlResult {
  const spec = contractSpec(input.symbol);
  const dir = input.side === "long" ? 1 : -1;
  const slippage = input.slippage ?? 0;

  const gross =
    (input.exit - input.entry) * spec.pointValue * input.contracts * dir;
  const commission = spec.commission * input.contracts;
  const pnl = round2(gross - commission - slippage);

  const riskDollars =
    input.stop != null
      ? Math.abs(input.entry - input.stop) * spec.pointValue * input.contracts
      : 0;

  return {
    pnl,
    commission,
    riskDollars,
    // NET of costs, deliberately: a "+2R" that ignores commission is a lie
    // the founder would only discover after trading it live.
    r: riskDollars > 0 ? Math.round((pnl / riskDollars) * 10_000) / 10_000 : null,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
