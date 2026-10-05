/**
 * THE CONTRACT LADDER — every SPY/QQQ contract from the money down to the $20 ones, priced the way the room prices one.
 *
 * Why it exists (the trader, 2026-10-05): "robinhood option contracts go anywhere between $20–$300 — how can we not
 * afford option contracts on spy and qqq?" The account can. What limited the room was two rules, not the price list:
 * a ticket may cost at most 10% of cash, and the room only trades two strikes (at the money and the one dollar out —
 * the trader's JSON schema). Everything further out is cheaper, and is a different trade:
 *
 *   - the −20% premium backstop sits closer and closer to the entry in the underlying, and once it is tighter than the
 *     plan's own stop the room re-prices the odds on it (quant.ts premiumStop): the chance of reaching T1 before
 *     being stopped falls while what T1 pays, as a share of the debit, rises;
 *   - the same dollars buy more contracts, so a win or a loss moves the account in coarser or finer steps.
 *
 * This module is the price list and, when a live card gives it a plan, the room's own three-path pricing of each rung
 * (T1 / stopped / flat, after both crossings) — the same `priceOptionPlan` the room's checklist and Nova's ledger use.
 * It is an input to a decision, never an edge claim: the desk's measured −2.1% a ticket is for ATM 1 DTE, and nothing in the
 * repo measures the other strikes.
 *
 * Pure. No network, no clock.
 */

import { ivFor, quoteOption, strikeFor, offsetAt, type OptionType, type StrikeOffset, type Underlier } from "./option-math";
import { etfAt, priceOptionPlan, type OptionEv } from "./quant";

/** The furthest step the ladder walks, and the cheapest contract it lists. */
export const LADDER_MAX_STEPS = 14;

/** What the room priced on a rung when a card gave it a plan. */
export interface RungPricing {
  /** The model's chance of T1 / the stop / neither before the flat, and what each pays per contract (dollars, after both crossings). */
  pT1: number;
  pLoss: number;
  pNone: number;
  t1Usd: number;
  lossUsd: number;
  noneUsd: number;
  evUsd: number;
  /** EV per dollar of debit. */
  evPerDollar: number;
  t1Pays: boolean;
  /** The −20% premium stop is tighter than the plan's stop, so the odds are re-priced on it. */
  stopTighter: boolean;
  /** The three paths as returns on the debit — what the exact goal odds take. */
  outcomes: { kind: "t1" | "loss" | "none"; p: number; r: number }[];
}

export interface Rung {
  offset: StrikeOffset;
  steps: number;
  strike: number;
  /** Per contract, dollars. */
  askUsd: number;
  bidUsd: number;
  delta: number;
  /** How far the ETF must move against the position to reach the −20% backstop, in dollars (null without a plan). */
  stopEtfMove: number | null;
  priced: RungPricing | null;
}

export interface LadderCard {
  futSymbol: string;
  futSide: "long" | "short";
  plan: { entry: number; stop: number; t1: number | null };
  pT1: number;
  atr: number | null;
  /** The futures price the fill is priced at (the CE before the touch, the live print at it) and its ETF. */
  priceFut: number;
  futNow: number;
  flatMs: number;
}

export interface LadderInput {
  underlier: Underlier;
  type: OptionType;
  spot: number;
  vix: number | null;
  exp: string;
  nowMs: number;
  /** Contracts below this delta or this price are not listed (the trader's numbers on the goal). */
  minDelta: number;
  minAskUsd: number;
  maxSteps?: number;
  card?: LadderCard | null;
}

/** The step offsets whose contract passes the floors, nearest the money first — the seats' universe. */
export function ladderSteps(a: Omit<LadderInput, "card">): { offset: StrikeOffset; strike: number; ask: number; delta: number }[] {
  const iv = ivFor(a.underlier, a.vix);
  const out: { offset: StrikeOffset; strike: number; ask: number; delta: number }[] = [];
  for (let k = 0; k <= (a.maxSteps ?? LADDER_MAX_STEPS); k++) {
    const offset = offsetAt(k);
    const strike = strikeFor(a.spot, a.type, offset);
    const q = quoteOption(a.spot, strike, a.exp, a.type, iv, a.nowMs);
    const askUsd = q.ask * 100;
    // Delta falls and the price falls as the strike goes out: the first one below a floor ends the ladder.
    if (Math.abs(q.delta) < a.minDelta || askUsd < a.minAskUsd) break;
    out.push({ offset, strike, ask: q.ask, delta: Math.abs(q.delta) });
  }
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The ladder, with the room's three-path pricing on every rung when a card gave it a plan. */
export function buildLadder(a: LadderInput): Rung[] {
  const iv = ivFor(a.underlier, a.vix);
  const rungs: Rung[] = [];
  for (const s of ladderSteps(a)) {
    const q = quoteOption(a.spot, s.strike, a.exp, a.type, iv, a.nowMs);
    let priced: RungPricing | null = null;
    let stopEtfMove: number | null = null;
    const c = a.card;
    if (c && c.plan.t1 != null) {
      const etfNow = etfAt(c.priceFut, c.futNow, a.spot);
      const ev: OptionEv = priceOptionPlan({
        plan: { side: c.futSide, entry: c.plan.entry, stop: c.plan.stop, t1: c.plan.t1, atr: c.atr, symbol: c.futSymbol },
        pT1: c.pT1,
        type: a.type,
        strike: s.strike,
        exp: a.exp,
        iv: q.iv,
        entryPx: q.ask,
        futNow: c.priceFut,
        etfNow,
        nowMs: a.nowMs,
        fillMs: a.nowMs,
        flatMs: c.flatMs,
      });
      const sc = (kind: "t1" | "loss" | "none") => ev.scenarios.find((x) => x.kind === kind);
      const t1 = sc("t1");
      const loss = sc("loss");
      const none = sc("none");
      const cost = q.ask * 100;
      if (t1 && loss && none && cost > 0) {
        priced = {
          pT1: t1.p,
          pLoss: loss.p,
          pNone: none.p,
          t1Usd: t1.pnlUsd,
          lossUsd: loss.pnlUsd,
          noneUsd: none.pnlUsd,
          evUsd: ev.evUsd,
          evPerDollar: ev.evUsd / cost,
          t1Pays: ev.t1Pays,
          stopTighter: Boolean(ev.premiumStop?.tighter),
          outcomes: [
            { kind: "t1", p: t1.p, r: t1.pnlUsd / cost },
            { kind: "loss", p: loss.p, r: loss.pnlUsd / cost },
            { kind: "none", p: none.p, r: none.pnlUsd / cost },
          ],
        };
        stopEtfMove = ev.premiumStop ? r2(Math.abs(ev.premiumStop.etf - etfNow)) : null;
      }
    }
    rungs.push({ offset: s.offset, steps: rungs.length, strike: s.strike, askUsd: r2(q.ask * 100), bidUsd: r2(q.bid * 100), delta: s.delta, stopEtfMove, priced });
  }
  return rungs;
}

/** The ATM and the strike one out — the two the room trades. */
export const roomRungs = (rungs: Rung[]): Rung[] => rungs.filter((r) => r.steps <= 1);
