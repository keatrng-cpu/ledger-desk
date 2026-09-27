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
import { canAdd, concentrationWarning, washSaleBan, WASH_SALE_TWINS } from "./universe";

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

/** Everything about the rest of the book a single name's verdict depends on. */
export interface VerdictContext {
  /** Tickers held now. */
  held?: Set<string>;
  /**
   * Look-through weight (exposure.ts): what the book holds of this company
   * directly PLUS inside its funds. The cap is a ceiling on the whole book's
   * exposure, and a direct MSFT buy on top of VTI holds MSFT twice.
   */
  effective?: { total: number; direct: number; viaFunds: number };
  /** A human judged the kill rule TRIPPED (kill-store.ts). Never a model. */
  tripped?: { judgedAt: string; note: string } | null;
  /**
   * The book is under BOOK_MEANINGFUL_USD. Weights there are arithmetic, not
   * allocation — a $60 book that is all VTI is 100% VTI by construction — so
   * a cap cannot produce TRIM (which would tell the trader to sell the one
   * thing the policy says to keep buying).
   */
  belowMeaningful?: boolean;
}

const pctR = (x: number) => `${(x * 100).toFixed(1)}%`;

/**
 * The per-name call. Order matters: a ban beats everything, then a kill rule
 * a person judged tripped, then the dossier gate (blank field or WATCH), then
 * weight against the name's own cap — measured look-through when the book's
 * exposure is known, because the cap is about the book, not the ticket.
 */
export function verdictFor(d: Dossier, weight: number, ctx: VerdictContext = {}): NameVerdict {
  const ban = washSaleBan(d.ticker);
  if (ban) {
    return {
      ticker: d.ticker,
      verdict: "OUT",
      why: `Wash-sale entangled with the options sleeve — ${ban}.`,
    };
  }

  if (ctx.tripped) {
    return {
      ticker: d.ticker,
      verdict: "OUT",
      why: `Kill rule judged TRIPPED by you on ${ctx.tripped.judgedAt.slice(0, 10)} — "${ctx.tripped.note}". The pre-written condition is met; this is an exit, not a debate.`,
    };
  }

  const gate = canAdd(d);
  if (!gate.canAdd) {
    return { ticker: d.ticker, verdict: "HOLD", why: gate.reason };
  }

  // Two total-market funds are one position held twice (the VTI dossier says
  // so). Whichever the book already holds is the one it keeps buying.
  if (d.sleeve === "ballast" && ctx.held) {
    const twins = (WASH_SALE_TWINS[d.ticker] ?? []).filter((t) => ctx.held?.has(t));
    if (twins.length && !ctx.held.has(d.ticker)) {
      return {
        ticker: d.ticker,
        verdict: "HOLD",
        why: `You hold ${twins.join("/")}, which does this job. Pick one total-market fund and stay with it — two is duplication, and selling one at a loss near a buy of the other is the book's own wash-sale trap.`,
      };
    }
  }

  const eff = ctx.effective;
  const w = eff ? Math.max(eff.total, weight) : weight;
  const viaNote =
    eff && eff.viaFunds > 0.0005
      ? ` (${pctR(eff.direct)} direct + ${pctR(eff.viaFunds)} already inside your funds)`
      : "";

  if (w > d.maxWeight && ctx.belowMeaningful) {
    return d.sleeve === "ballast"
      ? {
          ticker: d.ticker,
          verdict: "CORE",
          why: `Default landing pad. Below $${BOOK_MEANINGFUL_USD} every dollar lands here and ${pctR(w)} is arithmetic, not a position size.`,
        }
      : {
          ticker: d.ticker,
          verdict: "HOLD",
          why: `${pctR(w)}${viaNote} of a book under $${BOOK_MEANINGFUL_USD}. The cap binds once the book is real; until then the next dollar goes to the ballast, not here.`,
        };
  }

  if (w > d.maxWeight) {
    if (weight <= 0 && eff) {
      return {
        ticker: d.ticker,
        verdict: "HOLD",
        why: `Your funds alone already hold ${pctR(eff.viaFunds)} of ${d.ticker}, above its ${pctR(d.maxWeight)} cap. Do not add a direct position on top.`,
      };
    }
    return {
      ticker: d.ticker,
      verdict: "TRIM",
      why: `${pctR(w)}${viaNote} against a ${pctR(d.maxWeight)} cap. Starve it with new sweeps before selling a long-term lot.`,
    };
  }

  if (d.sleeve === "ballast") {
    return { ticker: d.ticker, verdict: "CORE", why: "Default landing pad for every swept dollar." };
  }

  if (w < d.maxWeight * 0.5) {
    return {
      ticker: d.ticker,
      verdict: "ADD",
      why: `Dossier complete, ${pctR(w)}${viaNote} against a ${pctR(d.maxWeight)} cap — room to build on the next sweep.`,
    };
  }

  return {
    ticker: d.ticker,
    verdict: "HOLD",
    why: `At working weight: ${pctR(w)}${viaNote} against a ${pctR(d.maxWeight)} cap. Nothing to do.`,
  };
}

export interface NextBuy {
  ticker: string | null;
  sleeve: Sleeve;
  usd: number;
  line: string;
}

/**
 * Where the waiting dollars go. Deterministic for the two sleeves that have
 * a default fund (ballast → the total-market fund already held, else VTI;
 * dry powder → SGOV) and deliberately silent for compounders: the tab lists
 * the ADD names and the trader chooses, because a picker that names a
 * company is a recommendation wearing a rebalancing rule's clothes.
 */
export function nextBuy(book: BookRead, waitingUsd: number, held: Set<string>): NextBuy {
  const ballastFund = held.has("ITOT") && !held.has("VTI") ? "ITOT" : "VTI";
  const usd = Math.round(Math.max(0, waitingUsd) * 100) / 100;
  if (usd <= 0) {
    return { ticker: null, sleeve: "ballast", usd: 0, line: "Nothing waiting to deploy." };
  }
  if (book.belowMeaningful) {
    return {
      ticker: ballastFund,
      sleeve: "ballast",
      usd,
      line: `$${usd.toFixed(2)} → ${ballastFund}. Below $${BOOK_MEANINGFUL_USD} every swept dollar lands in the ballast; the percentages are arithmetic, not allocation.`,
    };
  }
  const lightest = [...book.sleeves].sort((a, b) => a.driftPct - b.driftPct)[0];
  if (lightest.sleeve === "compounder") {
    return {
      ticker: null,
      sleeve: "compounder",
      usd,
      line: `$${usd.toFixed(2)} → the compounder sleeve (${Math.round(lightest.driftPct * 100)}% vs target). Choose among the ADD names below — the tab does not pick a company for you.`,
    };
  }
  const ticker = lightest.sleeve === "drypowder" ? "SGOV" : ballastFund;
  return {
    ticker,
    sleeve: lightest.sleeve,
    usd,
    line: `$${usd.toFixed(2)} → ${ticker} (${lightest.sleeve} is the lightest sleeve, ${Math.round(lightest.driftPct * 100)}% vs target).`,
  };
}

export interface ShadowRead {
  /** What the same dollars, on the same days, would be worth in the benchmark. */
  benchmarkValueUsd: number;
  bookValueUsd: number;
  contributedUsd: number;
  excessUsd: number;
  months: number;
  /** Lots whose benchmark close could not be found (priced at cost on both sides). */
  unpriced: number;
  line: string;
}

/**
 * The honest benchmark: every lot's dollars put into VTI at VTI's close on
 * the lot's own date. Same cash, same days — so the comparison measures the
 * CHOICES (what was bought, when it was sold), not the size of the sweeps.
 * Price return on both sides; a reinvested dividend recorded as a lot is a
 * contribution on both sides too. Under 36 months it says it means nothing.
 */
export function shadowBenchmark(
  lots: { date: string; costOrigUsd: number; sharesOpen: number; sharesOrig: number; ticker: string }[],
  bookValueUsd: number,
  realizedProceedsUsd: number,
  benchmarkCloses: Map<string, number>,
  benchmarkLast: number | null,
  today: string,
): ShadowRead | null {
  if (!lots.length || benchmarkLast == null || !(benchmarkLast > 0)) return null;
  const dates = [...benchmarkCloses.keys()].sort();
  const closeOn = (d: string): number | null => {
    // The close ON the lot's date, else the latest close before it.
    let lo = 0;
    let hi = dates.length - 1;
    let best: string | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] <= d) {
        best = dates[mid];
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best ? (benchmarkCloses.get(best) ?? null) : null;
  };
  let shadowShares = 0;
  let unpricedCost = 0;
  let unpriced = 0;
  let contributed = 0;
  for (const l of lots) {
    contributed += l.costOrigUsd;
    const c = closeOn(l.date);
    if (c && c > 0) shadowShares += l.costOrigUsd / c;
    else {
      unpriced++;
      unpricedCost += l.costOrigUsd;
    }
  }
  const benchmarkValueUsd = Math.round((shadowShares * benchmarkLast + unpricedCost) * 100) / 100;
  // The book's side includes what sales already returned in cash.
  const bookSide = Math.round((bookValueUsd + realizedProceedsUsd) * 100) / 100;
  const first = [...lots].map((l) => l.date).sort()[0];
  const months = Math.max(
    0,
    (Number(today.slice(0, 4)) - Number(first.slice(0, 4))) * 12 + (Number(today.slice(5, 7)) - Number(first.slice(5, 7))),
  );
  const excess = Math.round((bookSide - benchmarkValueUsd) * 100) / 100;
  const cmp = excessVsBenchmark(
    contributed > 0 ? ((bookSide / contributed - 1) * 100) : 0,
    contributed > 0 ? ((benchmarkValueUsd / contributed - 1) * 100) : 0,
    months,
  );
  return {
    benchmarkValueUsd,
    bookValueUsd: bookSide,
    contributedUsd: Math.round(contributed * 100) / 100,
    excessUsd: excess,
    months,
    unpriced,
    line: `Same dollars, same days, all in ${BENCHMARK}: $${benchmarkValueUsd.toFixed(2)} vs this book's $${bookSide.toFixed(2)} (${excess >= 0 ? "+" : "-"}$${Math.abs(excess).toFixed(2)}). ${cmp.line}${
      unpriced ? ` ${unpriced} lot(s) had no ${BENCHMARK} close on record and count at cost on both sides.` : ""
    }`,
  };
}

/** The pre-registered rule for spending dry powder: a 20% fall, not a good idea. */
export const DRY_POWDER_TRIGGER = -0.2;

export interface DryPowderRead {
  drawdown: number | null;
  armed: boolean;
  peak: number | null;
  last: number | null;
  line: string;
}

/**
 * Where the market sits against the dry-powder rule, measured on VTI's own
 * closes over the last year. A number and a rule — no forecast of whether
 * the fall continues.
 */
export function dryPowderTrigger(closes: { date: string; close: number }[]): DryPowderRead {
  const pts = closes.filter((c) => Number.isFinite(c.close) && c.close > 0);
  if (pts.length < 20) {
    return { drawdown: null, armed: false, peak: null, last: null, line: "No year of VTI closes loaded — the dry-powder rule cannot be read." };
  }
  const recent = pts.slice(-252);
  const peak = Math.max(...recent.map((c) => c.close));
  const last = recent[recent.length - 1].close;
  const dd = last / peak - 1;
  const armed = dd <= DRY_POWDER_TRIGGER;
  return {
    drawdown: dd,
    armed,
    peak,
    last,
    line: armed
      ? `VTI is ${(dd * 100).toFixed(1)}% below its 1-year closing high — past the ${Math.round(DRY_POWDER_TRIGGER * 100)}% rule. Dry powder is spent on the ADD list now, in the order the dossiers already set.`
      : `VTI is ${(dd * 100).toFixed(1)}% from its 1-year closing high (${peak.toFixed(2)} → ${last.toFixed(2)}). Dry powder waits for ${Math.round(DRY_POWDER_TRIGGER * 100)}%, not for a good idea.`,
  };
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
