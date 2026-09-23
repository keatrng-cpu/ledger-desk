/**
 * The research universe — what may be held, and what may never be.
 *
 * THE SCORECARD IS A GATE, NOT A NOTE
 * Every name carries the same columns. A blank required field is not a
 * gap in the write-up, it is a refusal: `canAdd()` returns false and the
 * tab prints WHICH field is missing. This is the same discipline as the
 * SMC sequence naming its missing must-layer, moved to a slower clock.
 *
 * THE BAN LIST IS THE PART MOST BOOKS GET WRONG
 * This trader sells and buys QQQ and SPY options for income. IRC section
 * 1091 disallows a loss when, within 30 days either side of the sale, you
 * acquire substantially identical stock OR "a contract or option to
 * acquire" it. Holding QQQ shares while trading QQQ options therefore
 * entangles the two books in both directions: an options loss can be
 * disallowed by a share purchase, and a share loss by an option.
 *
 * The IRS has never defined "substantially identical" for ETFs. Practice
 * treats same-index pairs (VOO/IVV, QQQ/QQQM) as risky and different-index
 * pairs (VOO/VTI) as the standard swap. That unresolved status is exactly
 * why the conservative choice is free here: the trader gives up nothing by
 * holding a total-market fund instead of an S&P fund, and avoids an
 * argument with the IRS they cannot win in advance.
 *
 * So: QQQ, QQQM, SPY, VOO, IVV and SPLG are BANNED from this book while
 * the sleeve trades QQQ/SPY options. VTI and ITOT are the ballast. This
 * is the one place where the fast book legitimately constrains the slow
 * one, and it runs through a static list rather than a live signal.
 *
 * NOT TAX ADVICE. This encodes a conservative default and names the
 * statute; the filed position belongs to a CPA. What the code guarantees
 * is that the trader never stumbles into the ambiguous case by accident.
 *
 * THE OTHER CORRECTION: DIVERSIFY AWAY FROM THE DAY JOB
 * The options sleeve is already a levered long bet on US large-cap tech
 * direction. Buying QQQ shares with its profits is not diversification,
 * it is the same bet twice with the second copy paid for by the first.
 * `concentrationWarning()` prices that overlap so the obvious move — buy
 * more of what you already trade — has to argue for itself.
 */

import snapshot from "../../data/invest-universe.json";

/** The underliers the options sleeve actually trades. Source of the ban. */
export const TRADED_UNDERLIERS = ["QQQ", "SPY"] as const;

/**
 * Tickers that track the same index as something the sleeve trades.
 * Held alongside the options book these risk wash-sale entanglement.
 */
export const WASH_SALE_BANNED: Record<string, string> = {
  QQQ: "the sleeve trades QQQ options — identical security",
  QQQM: "same index as QQQ (Nasdaq-100); practice treats same-index pairs as risky",
  SPY: "the sleeve trades SPY options — identical security",
  VOO: "same index as SPY (S&P 500); the standard swap is VOO/VTI, not VOO/SPY",
  IVV: "same index as SPY (S&P 500)",
  SPLG: "same index as SPY (S&P 500)",
};

export type Sleeve = "ballast" | "compounder" | "drypowder";

/** The verdict vocabulary. Deliberately NOT the PATH words. */
export type InvestVerdict = "CORE" | "ADD" | "HOLD" | "TRIM" | "OUT";

/** Where a name sits in the AI build-out, in the only language that matters. */
export type CycleRole =
  /** Demand persists even if AI capex normalizes hard. */
  | "structural"
  /** Real business, but the multiple is riding the cycle. */
  | "cyclical"
  /** Thesis fails if one customer or one model lab changes plans. */
  | "exposed";

export interface Governance {
  /** Chief executive, and whether they founded the thing. */
  ceo: string;
  founderLed: boolean;
  /** Year the current CEO took the seat — tenure is the signal. */
  ceoSince: number | null;
  chair: string | null;
  /** Voting control that does not match economic ownership. */
  dualClass: boolean;
  /** Insider ownership, percent, from the fundamentals snapshot. */
  insiderPct: number | null;
  /** Written succession question, if it is live. */
  successionNote: string | null;
}

/**
 * A fund has no CEO, no moat of its own and no earnings — its "fundamentals"
 * are the index it tracks and the fee it charges. Requiring a
 * COMPANY_OVERVIEW row for one would permanently block the ballast, which is
 * the single holding that should never be blocked. So the kind is explicit
 * rather than inferred from a blank field.
 */
export type DossierKind = "fund" | "company";

export interface Dossier {
  ticker: string;
  name: string;
  kind: DossierKind;
  sleeve: Sleeve;
  /** What they sell, one sentence. Blank = cannot ADD. */
  sells: string;
  /** Who pays: enterprise, consumer, state, or a mix. Blank = cannot ADD. */
  whoPays: string;
  /** The durable reason margins persist. Blank = cannot ADD. */
  moat: string;
  /** Still useful in 2035 if AI spend normalizes 40%? Blank = cannot ADD. */
  useIn2035: string;
  cycle: CycleRole;
  governance: Governance;
  /** The pre-written condition that takes it OUT. Blank = cannot ADD. */
  killRule: string;
  /** Hard ceiling on this name as a share of the whole book. */
  maxWeight: number;
  /** Anything that could become law rather than stay a headline. */
  regulatory: string | null;
  /** Honest note on what the numbers do NOT say. */
  caveat: string | null;
}

export interface Fundamentals {
  ticker: string;
  asOf: string;
  source: string;
  marketCap: number | null;
  peTrailing: number | null;
  peForward: number | null;
  peg: number | null;
  profitMargin: number | null;
  operatingMargin: number | null;
  roe: number | null;
  revenueGrowthYoy: number | null;
  earningsGrowthYoy: number | null;
  beta: number | null;
  dividendYield: number | null;
  insiderPct: number | null;
  institutionPct: number | null;
  sector: string | null;
  /** 50/200-day moving averages and the 52-week range, for trendRead. */
  ma50?: number | null;
  ma200?: number | null;
  high52?: number | null;
  low52?: number | null;
  /**
   * True when this row has never been captured — blocks ADD for a company.
   * Funds are set false: OVERVIEW returns nothing for an ETF, so queueing one
   * spends a request from a 25/day budget to receive an empty object.
   */
  pendingCapture: boolean;
}

interface UniverseSnapshot {
  capturedAt: string;
  source: string;
  note: string;
  fundamentals: Record<string, Fundamentals>;
}

const SNAP = snapshot as unknown as UniverseSnapshot;

export function snapshotCapturedAt(): string {
  return SNAP.capturedAt;
}

export function fundamentalsFor(ticker: string): Fundamentals | null {
  return SNAP.fundamentals[ticker] ?? null;
}

export function allFundamentals(): Fundamentals[] {
  return Object.values(SNAP.fundamentals);
}

/** Is this ticker forbidden while the sleeve trades what it trades? */
export function washSaleBan(ticker: string): string | null {
  return WASH_SALE_BANNED[ticker] ?? null;
}

export interface Completeness {
  complete: boolean;
  /** Field names that are blank. Each one blocks ADD. */
  missing: string[];
}

/** Which required fields are blank. The gate, not a nicety. */
export function completeness(d: Dossier): Completeness {
  const missing: string[] = [];
  if (!d.sells.trim()) missing.push("sells");
  if (!d.whoPays.trim()) missing.push("whoPays");
  if (!d.moat.trim()) missing.push("moat");
  if (!d.useIn2035.trim()) missing.push("useIn2035");
  if (!d.killRule.trim()) missing.push("killRule");
  if (d.kind === "company" && !d.governance.ceo.trim()) missing.push("governance.ceo");
  // A company must have a captured fundamentals row before it can be bought.
  // A fund must not — see DossierKind.
  if (d.kind === "company") {
    const f = fundamentalsFor(d.ticker);
    if (!f || f.pendingCapture) missing.push("fundamentals (run capture-invest-universe)");
  }
  return { complete: missing.length === 0, missing };
}

export interface AddGate {
  canAdd: boolean;
  /** The one sentence saying why not. */
  reason: string;
}

/**
 * May this name be bought at all? Banned beats incomplete beats allowed,
 * and the reason is always a specific thing the trader can go fix.
 */
export function canAdd(d: Dossier): AddGate {
  const ban = washSaleBan(d.ticker);
  if (ban) {
    return {
      canAdd: false,
      reason: `BANNED — ${ban}. Holding it while the sleeve trades ${TRADED_UNDERLIERS.join("/")} options risks wash-sale entanglement under IRC 1091.`,
    };
  }
  const c = completeness(d);
  if (!c.complete) {
    return { canAdd: false, reason: `Dossier incomplete — missing ${c.missing.join(", ")}.` };
  }
  return { canAdd: true, reason: "Dossier complete and not wash-sale entangled." };
}

/**
 * How much of this book is the same bet the sleeve already makes.
 *
 * The trading income is levered long US large-cap tech direction. A share
 * book stuffed with the same names is one position wearing two hats, and
 * it fails on the same day the sleeve does.
 */
export function concentrationWarning(
  holdings: { ticker: string; weight: number }[],
): { techWeight: number; warn: boolean; line: string } {
  const TECHY = new Set(["MSFT", "AAPL", "NVDA", "GOOGL", "AVGO", "AMD", "TSM", "ASML", "META"]);
  const techWeight = holdings
    .filter((h) => TECHY.has(h.ticker))
    .reduce((s, h) => s + h.weight, 0);
  const warn = techWeight > 0.35;
  return {
    techWeight,
    warn,
    line: warn
      ? `${Math.round(techWeight * 100)}% of this book is US large-cap tech — the same direction the options sleeve is already levered long. That is one bet held twice, not diversification.`
      : `${Math.round(techWeight * 100)}% US large-cap tech. The sleeve is already long that direction; this book is not doubling it.`,
  };
}

/**
 * What the account size actually permits.
 *
 * Both of the classic "recycle the shares" moves — covered calls and
 * cash-secured puts — require 100 shares or the cash to buy them. At a
 * $1,000 sleeve and a share book measured in tens of dollars, neither is
 * available, and recommending them anyway is how advice stops being about
 * the person receiving it. They become real somewhere north of $35k in a
 * single name, so this returns the honest gap rather than the idea.
 */
export function incomeOverlayAvailable(
  sharePriceUsd: number,
  sharesHeld: number,
): { available: boolean; line: string } {
  const need = 100 - sharesHeld;
  if (sharesHeld >= 100) {
    return {
      available: true,
      line: "100+ shares held — a covered call against a slice (never the whole lot) is now mechanically possible.",
    };
  }
  const dollars = Math.round(need * sharePriceUsd);
  return {
    available: false,
    line: `Covered calls need 100 shares — ${need} more, about $${dollars.toLocaleString()}. Not available at this account size; revisit when the position clears 100 shares.`,
  };
}
