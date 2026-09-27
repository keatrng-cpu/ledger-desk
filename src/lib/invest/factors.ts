/**
 * The analysis layer — and an honest account of what it cannot do.
 *
 * WHAT WAS ASKED FOR AND WHAT IS ACTUALLY BUILDABLE
 * The request was a way to calculate and predict which stocks perform over
 * short, mid and long horizons with high probability. Most of that is not
 * buildable by anyone, and a file that pretended otherwise would be the
 * most expensive thing on this desk. So this file does three things and
 * refuses a fourth:
 *
 *   IT COMPUTES  — arithmetic with no forecast in it. Chiefly `impliedGrowth`,
 *                  which inverts a DCF to ask what the CURRENT PRICE already
 *                  requires. That is not a prediction; it is the market's
 *                  assumption made visible so you can disagree with it.
 *   IT MEASURES  — quality and trend from captured fundamentals, each named
 *                  and each shown raw rather than blended.
 *   IT WARNS     — base rates, because the single most useful number for a
 *                  stock picker is how rarely stock picking works.
 *   IT REFUSES   — no composite score, no price target, no expected return.
 *                  `trading.md` says never present a historical return as an
 *                  expected return, and a score is exactly that with the
 *                  provenance stripped off.
 *
 * WHY NO SHORT-TERM SIGNAL, STATED PLAINLY
 * There is no short-horizon share-selection edge here and this file will not
 * invent one. That is not modesty, it is consistency: this desk swept 18
 * sequence-gate variants and got 0 takes, measured 1m micro-timing and
 * rejected it, and discovered its own headline entry statistic was a
 * killzone artifact. A book that applied that standard to futures and then
 * shipped a short-term stock predictor would be running two different
 * epistemologies for the same trader. Short horizon is what the options
 * sleeve is for. This book's edge is time and not being forced to sell.
 *
 * THE DISCOUNT RATE IS AN ASSUMPTION AND IS LABELLED AS ONE
 * `impliedGrowth` needs a required return. It is built from the captured
 * 10-year Treasury plus an equity risk premium, and the premium is a
 * genuinely contested number — reasonable people use 3.5% to 5.5%, and the
 * answer moves a lot across that range. So it is a parameter with a stated
 * default, `sensitivity()` shows the range, and no output here is quoted
 * without it.
 */

import { RISK_FREE } from "./dossiers";
import type { Fundamentals } from "./universe";

/**
 * Equity risk premium over the 10-year. Contested; this is a middle-of-the
 * -road default, not a fact. Always shown alongside its own sensitivity.
 */
export const DEFAULT_ERP = 0.045;
/** Terminal growth after the explicit period. Roughly long-run nominal GDP. */
export const TERMINAL_GROWTH = 0.025;
/** Explicit forecast period, years. */
export const EXPLICIT_YEARS = 10;

/**
 * The base rates. These are the most important numbers on the tab and they
 * are about the activity, not about any company in it.
 */
export const BASE_RATES = [
  {
    id: "bessembinder-tbills",
    claim:
      "Over 1926–2015, about 58% of US common stocks failed to beat one-month Treasury bills over their full lifetimes, and more than half delivered negative lifetime returns.",
    source: "Bessembinder, 'Do Stocks Outperform Treasury Bills?', Journal of Financial Economics 129(3), 2018",
    url: "https://www.sciencedirect.com/science/article/abs/pii/S0304405X18301521",
    soWhat:
      "The median listed company is not an investment. Index ballast is not the boring option, it is the option that owns the rare winners by construction rather than by selection.",
  },
  {
    id: "bessembinder-concentration",
    claim:
      "The best-performing 4% of listed companies account for the entire net gain of the US stock market since 1926; roughly one third of 1% account for half of it.",
    source: "Bessembinder, JFE 129(3), 2018",
    url: "https://www.sciencedirect.com/science/article/abs/pii/S0304405X18301521",
    soWhat:
      "Returns are not normally distributed across names — they are a lottery with a very thin winning tail. Missing the tail is the default outcome of concentration, which is why per-name caps here are 4–8% and not 20%.",
  },
  {
    id: "growth-persistence",
    claim:
      "Across US stocks, long-term earnings growth shows no persistence beyond what chance predicts; very high growth is rare, and analysts' long-term growth forecasts are too optimistic.",
    source: "Chan, Karceski & Lakonishok, 'The Level and Persistence of Growth Rates', Journal of Finance 58(2), 2003",
    url: "https://onlinelibrary.wiley.com/doi/abs/10.1111/1540-6261.00540",
    soWhat:
      "A company's past growth is the honest reference for what its price requires, not a forecast of it. A price that needs a decade of growth above the company's own record is betting on something the record rarely repeats.",
  },
  {
    id: "mclean-pontiff-decay",
    claim:
      "Across 97 published return predictors, portfolio returns were 26% lower out-of-sample and 58% lower after publication.",
    source: "McLean & Pontiff, 'Does Academic Research Destroy Stock Return Predictability?', Journal of Finance 71(1), 2016",
    url: "https://onlinelibrary.wiley.com/doi/abs/10.1111/jofi.12365",
    soWhat:
      "Any factor you can read about has already been more than half arbitraged away. Treat every screen below as a description of the business, not as a source of excess return.",
  },
] as const;

export type Horizon = "short" | "mid" | "long";

export interface HorizonEvidence {
  horizon: Horizon;
  window: string;
  verdict: string;
  usable: boolean;
}

/**
 * What is actually known at each horizon. Printed on the tab so the answer
 * to "will this go up this month" is always in front of the person asking.
 */
export const HORIZON_EVIDENCE: HorizonEvidence[] = [
  {
    horizon: "short",
    window: "days to a few months",
    usable: false,
    verdict:
      "Nothing here predicts this, and nothing added later will. Short-horizon moves in a single large-cap are dominated by flow, positioning and news none of which is in a quarterly fundamentals snapshot. This is the options sleeve's job, on the sleeve's own gates.",
  },
  {
    horizon: "mid",
    window: "one to three years",
    usable: false,
    verdict:
      "Weakly addressable at best. Trend and momentum have the most mid-horizon support of anything published, and are also among the most decayed post-publication. `trendRead` is shown as a description of where price sits, deliberately NOT as a signal, and it gates nothing.",
  },
  {
    horizon: "long",
    window: "five years and beyond",
    usable: true,
    verdict:
      "The only horizon this book claims. Two things do the work and neither is a forecast: starting valuation (what the price already assumes — `impliedGrowth`) and business durability (whether margins and returns on capital persist). Both are checkable today rather than predicted.",
  },
];

export interface ImpliedGrowth {
  /** Annual earnings growth the current price requires over the explicit period. */
  growth: number | null;
  /** Required return used. */
  discountRate: number;
  erp: number;
  years: number;
  terminal: number;
  /** Trailing earnings the inversion started from, in dollars. */
  earnings: number | null;
  /** Plain-language read of whether that requirement is demanding. */
  demand: "modest" | "reasonable" | "demanding" | "heroic" | "unknown";
  line: string;
}

/**
 * Present value of a stream growing at g for N years, then at the terminal
 * rate forever, discounted at r.
 */
function pv(earnings: number, g: number, r: number, years: number, terminal: number): number {
  let sum = 0;
  let e = earnings;
  for (let t = 1; t <= years; t++) {
    e *= 1 + g;
    sum += e / (1 + r) ** t;
  }
  const tv = (e * (1 + terminal)) / (r - terminal);
  return sum + tv / (1 + r) ** years;
}

/**
 * Invert the DCF: what constant growth rate makes the model equal the
 * market cap? Bisection, because the function is monotone in g and a closed
 * form would hide the assumptions this is trying to expose.
 *
 * This is the single most useful number on the tab for a long-term holder.
 * It converts "is this expensive" — which nobody can answer — into "the
 * price requires 11% a year for a decade, do I believe that", which is a
 * question a person can actually have an opinion about.
 */
export function impliedGrowth(
  f: Fundamentals | null,
  opts: { erp?: number; years?: number; terminal?: number; basis?: "trailing" | "forward" } = {},
): ImpliedGrowth {
  const erp = opts.erp ?? DEFAULT_ERP;
  const years = opts.years ?? EXPLICIT_YEARS;
  const terminal = opts.terminal ?? TERMINAL_GROWTH;
  const r = RISK_FREE.yieldPct / 100 + erp;

  const base: ImpliedGrowth = {
    growth: null,
    discountRate: r,
    erp,
    years,
    terminal,
    earnings: null,
    demand: "unknown",
    line: "No captured fundamentals — cannot invert a price into an assumption.",
  };

  // Forward basis: the same inversion started from the earnings the market
  // EXPECTS next year. Where trailing earnings carry a one-off (GOOGL's +294%
  // quarter) the two answers diverge, and the gap is itself the finding.
  const pe = opts.basis === "forward" ? f?.peForward : f?.peTrailing;
  if (!f || f.pendingCapture || !f.marketCap || !pe || pe <= 0) return base;
  if (r <= terminal) {
    return { ...base, line: "Discount rate must exceed terminal growth; check the ERP assumption." };
  }

  const earnings = f.marketCap / pe;
  if (!Number.isFinite(earnings) || earnings <= 0) return base;

  let lo = -0.5;
  let hi = 1.0;
  // The model must stay below the discount rate for the terminal leg to be
  // finite; growth above that is unpriceable rather than merely optimistic.
  if (pv(earnings, hi, r, years, terminal) < f.marketCap) {
    return {
      ...base,
      earnings,
      demand: "heroic",
      line: "The price implies growth beyond what this model can price. Treat as a pure story valuation.",
    };
  }
  if (pv(earnings, lo, r, years, terminal) > f.marketCap) {
    return {
      ...base,
      earnings,
      demand: "modest",
      line: "The price is below the value of steeply declining earnings — the market expects contraction.",
    };
  }

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (pv(earnings, mid, r, years, terminal) > f.marketCap) hi = mid;
    else lo = mid;
  }
  const g = (lo + hi) / 2;

  const demand: ImpliedGrowth["demand"] =
    g < 0.04 ? "modest" : g < 0.09 ? "reasonable" : g < 0.15 ? "demanding" : "heroic";

  return {
    growth: g,
    discountRate: r,
    erp,
    years,
    terminal,
    earnings,
    demand,
    line: `At today's price the market requires ${(g * 100).toFixed(1)}% annual earnings growth for ${years} years (then ${(terminal * 100).toFixed(1)}% forever), discounted at ${(r * 100).toFixed(2)}% = ${RISK_FREE.yieldPct}% 10y + ${(erp * 100).toFixed(1)}% ERP. That is ${demand}.`,
  };
}

/**
 * How much the answer moves across a defensible ERP range. Quoted with every
 * implied-growth figure, because a number that swings several points on an
 * assumption nobody can pin down should never be shown alone.
 */
export function sensitivity(f: Fundamentals | null): { erp: number; growth: number | null }[] {
  return [0.035, 0.045, 0.055].map((erp) => ({ erp, growth: impliedGrowth(f, { erp }).growth }));
}

export interface QualityRead {
  /** Each leg raw and named — never blended into one number. */
  legs: { label: string; value: number | null; reads: string }[];
  /** How many legs are present and strong. Count, not score. */
  strong: number;
  present: number;
}

/**
 * Quality, shown as its parts. Profitability and stable returns on capital
 * are the characteristics most associated with durability over long holds —
 * which is a statement about what kind of business this is, not a forecast
 * of its share price.
 */
export function qualityRead(f: Fundamentals | null): QualityRead {
  if (!f || f.pendingCapture) return { legs: [], strong: 0, present: 0 };
  const legs = [
    {
      label: "Return on equity",
      value: f.roe,
      reads:
        f.roe == null
          ? "—"
          : f.roe > 0.9
            ? "extreme — check whether buybacks have shrunk equity rather than the business earning it"
            : f.roe > 0.2
              ? "strong"
              : f.roe > 0.1
                ? "adequate"
                : "weak",
    },
    {
      label: "Operating margin",
      value: f.operatingMargin,
      reads:
        f.operatingMargin == null
          ? "—"
          : f.operatingMargin > 0.3
            ? "strong pricing power"
            : f.operatingMargin > 0.15
              ? "healthy"
              : f.operatingMargin > 0.05
                ? "thin — a volume business"
                : "very thin",
    },
    {
      label: "Profit margin",
      value: f.profitMargin,
      reads: f.profitMargin == null ? "—" : f.profitMargin > 0.2 ? "high" : f.profitMargin > 0.08 ? "normal" : "low",
    },
    {
      label: "Earnings growth YoY",
      value: f.earningsGrowthYoy,
      reads:
        f.earningsGrowthYoy == null
          ? "—"
          : f.earningsGrowthYoy < 0
            ? "FALLING — reconcile this against the multiple before anything else"
            : f.earningsGrowthYoy > 0.2
              ? "fast, and fast is rarely durable"
              : "steady",
    },
  ];
  const present = legs.filter((l) => l.value != null).length;
  const strong = legs.filter(
    (l) => l.value != null && !/weak|very thin|FALLING|low/.test(l.reads),
  ).length;
  return { legs, strong, present };
}

export interface EarningsYield {
  /** 1 / trailing P/E. */
  trailing: number | null;
  /** 1 / forward P/E. */
  forward: number | null;
  /** The ten-year the book is judged against. */
  riskFree: number;
  /** Forward (else trailing) earnings yield minus the ten-year, in points. */
  spreadPts: number | null;
  line: string;
}

/**
 * The comparison dossiers.ts promised and the tab never printed: what a
 * dollar of this company EARNS today against what a dollar in Treasuries
 * pays with certainty. A negative spread is not "overvalued" — it is the
 * size of the growth bet you are making instead of owning the bond.
 */
export function earningsYield(f: Fundamentals | null): EarningsYield {
  const rf = RISK_FREE.yieldPct / 100;
  const t = f && !f.pendingCapture && f.peTrailing && f.peTrailing > 0 ? 1 / f.peTrailing : null;
  const fw = f && !f.pendingCapture && f.peForward && f.peForward > 0 ? 1 / f.peForward : null;
  const basis = fw ?? t;
  const spread = basis == null ? null : (basis - rf) * 100;
  const p = (x: number) => `${(x * 100).toFixed(1)}%`;
  return {
    trailing: t,
    forward: fw,
    riskFree: rf,
    spreadPts: spread,
    line:
      basis == null
        ? "No earnings multiple captured."
        : `Earnings yield ${t != null ? `${p(t)} trailing` : "—"}${fw != null ? ` / ${p(fw)} forward` : ""} vs the ${RISK_FREE.yieldPct}% ten-year: ${
            spread! >= 0
              ? `paid ${spread!.toFixed(1)} pts MORE than Treasuries before any growth.`
              : `paid ${Math.abs(spread!).toFixed(1)} pts LESS than Treasuries today — growth has to close that gap before this beats the bond.`
          }`,
  };
}

export interface TrendRead {
  /** Last close above the 200-day — only known when a real close is supplied. */
  above200: boolean | null;
  /** 50-day average above the 200-day average. */
  goldenCross: boolean | null;
  /** Position in the 52-week range, 0 = at the low, 1 = at the high. */
  rangePos: number | null;
  /** What `rangePos` was measured from: a real close, or the 50-day average. */
  rangeFrom: "close" | "ma50" | null;
  line: string;
}

/**
 * Where price sits relative to its own recent history. Shown because it is
 * context a holder should have, and explicitly NOT used as a signal: see
 * HORIZON_EVIDENCE for why the mid-horizon case is weak, and the decay base
 * rate for why the published version of it is weaker than it was.
 *
 * Fixed 2026-09-26: this used to report the 50-DAY AVERAGE's place in the
 * 52-week range as where the stock "sits", and set `above200` to the
 * golden-cross flag — neither was a price. With no real close it now says
 * it is reading the average; with one (a Yahoo close), it reads the price.
 */
export function trendRead(f: Fundamentals | null, lastClose?: number | null): TrendRead {
  const ma50 = f?.ma50 ?? null;
  const ma200 = f?.ma200 ?? null;
  const hi = f?.high52 ?? null;
  const lo = f?.low52 ?? null;
  if (ma50 == null || ma200 == null) {
    return { above200: null, goldenCross: null, rangePos: null, rangeFrom: null, line: "No moving averages captured." };
  }
  const close = lastClose != null && Number.isFinite(lastClose) && lastClose > 0 ? lastClose : null;
  const goldenCross = ma50 > ma200;
  const ref = close ?? ma50;
  const rangePos = hi != null && lo != null && hi > lo ? Math.min(1, Math.max(0, (ref - lo) / (hi - lo))) : null;
  const above200 = close != null ? close > ma200 : null;
  const where =
    rangePos == null
      ? ""
      : close != null
        ? `; the last close sits ${Math.round(rangePos * 100)}% up the 52-week range`
        : `; the 50-day average sits ${Math.round(rangePos * 100)}% up the 52-week range (no close loaded)`;
  return {
    above200,
    goldenCross,
    rangePos,
    rangeFrom: rangePos == null ? null : close != null ? "close" : "ma50",
    line: `50-day ${goldenCross ? "above" : "BELOW"} the 200-day${
      above200 != null ? `, price ${above200 ? "above" : "BELOW"} the 200-day` : ""
    }${where}. Context only — this gates nothing and is not a reason to buy or sell a five-year holding.`,
  };
}

/**
 * The whole read for one name, parts kept separate on purpose.
 * There is no `score` field and there will not be one.
 */
export function analyse(f: Fundamentals | null) {
  return {
    implied: impliedGrowth(f),
    impliedForward: impliedGrowth(f, { basis: "forward" }),
    sensitivity: sensitivity(f),
    quality: qualityRead(f),
    trend: trendRead(f),
    earningsYield: earningsYield(f),
  };
}
