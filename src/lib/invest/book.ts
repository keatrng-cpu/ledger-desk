/**
 * The share book — three sleeves, one benchmark, and a verdict vocabulary
 * that cannot be confused with the trading desk's.
 *
 * THE WORDS ARE DIFFERENT ON PURPOSE
 * This file prints CORE / ADD / HOLD / TRIM / OUT. It never prints TAKE,
 * STAND or MANAGE. Those belong to PATH and they mean "in the next fifteen
 * minutes". If the same word appeared on a five-year holding the trader
 * would eventually act on it at the wrong speed, which is the specific
 * failure this whole tab is built to prevent.
 *
 * THE SLEEVES
 *   BALLAST      — market return you cannot out-think. The default landing
 *                  pad for every swept dollar.
 *   COMPOUNDERS  — businesses that should still matter in 2035. Capped hard
 *                  per name, because conviction is not a position size.
 *   DRY POWDER   — what gets spent when the book is down 20%, not when an
 *                  idea is good.
 *
 * THE REBALANCE GUARD IS THE HONEST PART
 * Percentage drift is meaningless on a small book. Five percent of sixty
 * dollars is three dollars, and no action worth taking costs less than the
 * spread it crosses. `rebalanceCheck` therefore refuses to signal below a
 * dollar floor and says so, rather than generating tidy quarterly busywork
 * that makes a $60 book feel like a portfolio. The first year of this book
 * should be boring. If the tab is giving you things to do, it is lying.
 */

import type { Dossier, InvestVerdict, Sleeve } from "./universe";
import { canAdd, concentrationWarning, washSaleBan } from "./universe";

/** Target weights. Ranges follow the desk's agreed sleeve split. */
export const SLEEVE_TARGET: Record<Sleeve, number> = {
  ballast: 0.55,
  compounder: 0.3,
  drypowder: 0.15,
};

/** Drift beyond this is a rebalance candidate — if the dollars justify it. */
export const DRIFT_BAND = 0.05;

/**
 * Below this, rebalancing costs more than it corrects. A trade that moves
 * eight dollars is not portfolio management, it is friction with a
 * spreadsheet attached.
 */
export const REBALANCE_MIN_TRADE_USD = 25;

/** Below this total, the book is a habit rather than an allocation. */
export const BOOK_MEANINGFUL_USD = 500;

/** The benchmark. Excess is measured against this, never against the week. */
export const BENCHMARK = "VTI";

export interface Position {
  ticker: string;
  sleeve: Sleeve;
  /** Fractional shares are the norm at this size. */
  shares: number;
  /** Total dollars paid, for cost basis and long-term lot tracking. */
  costUsd: number;
  /** First purchase, for the one-year long-term capital gains line. */
  openedAt: string;
}

export interface Valued extends Position {
  priceUsd: number | null;
  valueUsd: number;
  weight: number;
  plUsd: number;
  plPct: number;
  /** True once held more than a year — sales before this are short-term. */
  longTerm: boolean;
}

export interface SleeveRead {
  sleeve: Sleeve;
  valueUsd: number;
  weight: number;
  target: number;
  driftPct: number;
  /** Dollars that would restore the target. Signed. */
  correctionUsd: number;
}

export interface BookRead {
  totalUsd: number;
  positions: Valued[];
  sleeves: SleeveRead[];
  /** True when the book is too small for allocation to mean anything. */
  belowMeaningful: boolean;
  concentration: ReturnType<typeof concentrationWarning>;
  /** Any held ticker that should never have been bought. */
  banned: { ticker: string; why: string }[];
  note: string;
}

const YEAR_MS = 365 * 24 * 3600 * 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Value the book. Prices may be missing — a null price values the position
 * at cost and says so, rather than inventing a mark.
 */
export function buildBook(
  positions: Position[],
  prices: Record<string, number>,
  now: number,
): BookRead {
  const valued: Valued[] = positions.map((p) => {
    const price = Number.isFinite(prices[p.ticker]) && prices[p.ticker] > 0 ? prices[p.ticker] : null;
    const valueUsd = price != null ? round2(price * p.shares) : round2(p.costUsd);
    const plUsd = price != null ? round2(valueUsd - p.costUsd) : 0;
    return {
      ...p,
      priceUsd: price,
      valueUsd,
      weight: 0,
      plUsd,
      plPct: p.costUsd > 0 ? round2((plUsd / p.costUsd) * 100) / 100 : 0,
      longTerm: now - Date.parse(p.openedAt) > YEAR_MS,
    };
  });

  const totalUsd = round2(valued.reduce((s, v) => s + v.valueUsd, 0));
  for (const v of valued) v.weight = totalUsd > 0 ? v.valueUsd / totalUsd : 0;

  const sleeves: SleeveRead[] = (["ballast", "compounder", "drypowder"] as Sleeve[]).map((s) => {
    const valueUsd = round2(valued.filter((v) => v.sleeve === s).reduce((a, v) => a + v.valueUsd, 0));
    const weight = totalUsd > 0 ? valueUsd / totalUsd : 0;
    const target = SLEEVE_TARGET[s];
    return {
      sleeve: s,
      valueUsd,
      weight,
      target,
      driftPct: weight - target,
      correctionUsd: round2(target * totalUsd - valueUsd),
    };
  });

  const banned = valued
    .map((v) => ({ ticker: v.ticker, why: washSaleBan(v.ticker) }))
    .filter((b): b is { ticker: string; why: string } => b.why != null);

  const belowMeaningful = totalUsd < BOOK_MEANINGFUL_USD;

  return {
    totalUsd,
    positions: valued,
    sleeves,
    belowMeaningful,
    concentration: concentrationWarning(valued.map((v) => ({ ticker: v.ticker, weight: v.weight }))),
    banned,
    note: belowMeaningful
      ? `Book is $${totalUsd.toFixed(2)}. Below $${BOOK_MEANINGFUL_USD} the weights are arithmetic rather than allocation — keep sweeping into ballast and ignore the percentages.`
      : `Book is $${totalUsd.toFixed(2)} across ${valued.length} positions.`,
  };
}

export interface RebalanceAction {
  sleeve: Sleeve;
  /** Positive = buy into this sleeve, negative = trim it. */
  usd: number;
  reason: string;
}

export interface RebalanceRead {
  due: boolean;
  actions: RebalanceAction[];
  note: string;
}

/**
 * Quarterly weight check. Refuses to generate a trade that is too small to
 * be worth its own spread, and prefers directing the NEXT sweep over
 * selling anything — selling is a taxable event and this book's whole
 * advantage is that it never has to sell.
 */
export function rebalanceCheck(book: BookRead): RebalanceRead {
  if (book.belowMeaningful) {
    return {
      due: false,
      actions: [],
      note: "Too small to rebalance. Direct the next sweep at the lightest sleeve and do nothing else.",
    };
  }

  const drifted = book.sleeves.filter((s) => Math.abs(s.driftPct) > DRIFT_BAND);
  const actionable = drifted.filter((s) => Math.abs(s.correctionUsd) >= REBALANCE_MIN_TRADE_USD);

  if (!actionable.length) {
    return {
      due: false,
      actions: [],
      note: drifted.length
        ? `${drifted.length} sleeve(s) outside the ${Math.round(DRIFT_BAND * 100)}% band, but every correction is under $${REBALANCE_MIN_TRADE_USD}. Not worth the spread.`
        : "All sleeves inside the band. Nothing to do.",
    };
  }

  const actions: RebalanceAction[] = actionable.map((s) => ({
    sleeve: s.sleeve,
    usd: s.correctionUsd,
    reason:
      s.correctionUsd > 0
        ? `${s.sleeve} is ${Math.abs(Math.round(s.driftPct * 100))}% light — point the next sweep here before selling anything.`
        : `${s.sleeve} is ${Math.round(s.driftPct * 100)}% heavy. Prefer starving it with new sweeps over selling a long-term lot.`,
  }));

  return {
    due: true,
    actions,
    note: "Correct with the next sweep where possible. Selling realises gains; sweeping does not.",
  };
}

export interface NameVerdict {
  ticker: string;
  verdict: InvestVerdict;
  why: string;
}

/**
 * The per-name call. Order matters: a ban beats everything, then the
 * dossier gate, then weight against the name's own cap.
 */
export function verdictFor(d: Dossier, weight: number): NameVerdict {
  const ban = washSaleBan(d.ticker);
  if (ban) {
    return {
      ticker: d.ticker,
      verdict: "OUT",
      why: `Wash-sale entangled with the options sleeve — ${ban}.`,
    };
  }

  const gate = canAdd(d);
  if (!gate.canAdd) {
    return { ticker: d.ticker, verdict: "HOLD", why: gate.reason };
  }

  if (weight > d.maxWeight) {
    return {
      ticker: d.ticker,
      verdict: "TRIM",
      why: `${Math.round(weight * 100)}% against a ${Math.round(d.maxWeight * 100)}% cap. Starve it with new sweeps before selling a long-term lot.`,
    };
  }

  if (d.sleeve === "ballast") {
    return { ticker: d.ticker, verdict: "CORE", why: "Default landing pad for every swept dollar." };
  }

  if (weight < d.maxWeight * 0.5) {
    return {
      ticker: d.ticker,
      verdict: "ADD",
      why: `Dossier complete, ${Math.round(weight * 100)}% against a ${Math.round(d.maxWeight * 100)}% cap — room to build on the next sweep.`,
    };
  }

  return { ticker: d.ticker, verdict: "HOLD", why: "At working weight. Nothing to do." };
}

/**
 * Excess return against the benchmark. Reported as the only performance
 * number this tab is allowed to show, because measuring a five-year book
 * against a trading week is how a good hold becomes a bad sale.
 */
export function excessVsBenchmark(
  bookReturnPct: number,
  benchmarkReturnPct: number,
  months: number,
): { excessPct: number; meaningful: boolean; line: string } {
  const excessPct = round2(bookReturnPct - benchmarkReturnPct);
  const meaningful = months >= 36;
  return {
    excessPct,
    meaningful,
    line: meaningful
      ? `${excessPct >= 0 ? "+" : ""}${excessPct}% against ${BENCHMARK} over ${months} months.`
      : `${excessPct >= 0 ? "+" : ""}${excessPct}% against ${BENCHMARK} over ${months} months — too short to mean anything. Three years is the earliest this number is evidence rather than weather.`,
  };
}
