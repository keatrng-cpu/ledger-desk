/**
 * Durability — the record the price's requirement is compared against.
 *
 * WHY THIS EXISTS
 * `impliedGrowth` says what growth today's price REQUIRES for a decade. Alone
 * it cannot say whether that is a lot for this company. What the company has
 * already DELIVERED can — not as a forecast (growth barely persists: Chan,
 * Karceski & Lakonishok found no persistence in long-term earnings growth
 * beyond chance), but as the honest reference point. "The price needs 16% a
 * year; the business delivered 8% over ten" is a sentence a person can
 * disagree with. "Buy / don't buy" is not, and this file never writes it.
 *
 * THE LEGS, EACH SHOWN RAW — NO BLEND
 *   required vs delivered · FCF conversion (are earnings cash?) · stock-based
 *   comp against operating cash · capex intensity now vs four years ago (the
 *   AI build-out bill) · share count per year (buybacks vs dilution).
 *
 * Data: src/data/invest-durability.json (scripts/capture-durability.mjs).
 * Four-year legs from Yahoo's fundamentals timeseries (unofficial, keyless);
 * 5/10-year net income and FCF growth from Alpha Vantage annual cash-flow
 * reports (10-K data) where captured.
 */

import data from "../../data/invest-durability.json";
import { impliedGrowth } from "./factors";
import { fundamentalsFor } from "./universe";

interface YahooLegs {
  source?: string;
  error?: string;
  fiscalYears?: string[];
  revenueCagr?: number | null;
  revenueCagrWhy?: string | null;
  revenueYears?: number;
  fcfConversion3y?: number | null;
  fcfLast?: number | null;
  niLast?: number | null;
  sbcToOcf?: number | null;
  capexToOcf?: number | null;
  capexToOcfFirst?: number | null;
  sharesCagr?: number | null;
  sharesCagrWhy?: string | null;
  sharesYears?: number;
}

interface LongRecord {
  source: string;
  years: number;
  lastFy: string;
  niCagr10y: number | null;
  niCagr10yWhy: string | null;
  fcfCagr10y: number | null;
  fcfCagr10yWhy: string | null;
  niCagr5y: number | null;
  niCagr5yWhy: string | null;
  fcfCagr5y: number | null;
  fcfCagr5yWhy: string | null;
  window10: string | null;
  window5: string | null;
  fcfLast3: [string, number | null][];
}

export interface DurabilityRow {
  ticker: string;
  yahoo: YahooLegs;
  long: LongRecord | null;
}

interface DurabilityDoc {
  capturedAt: string;
  note: string;
  companies: Record<string, DurabilityRow>;
}

const DOC = data as unknown as DurabilityDoc;

export function durabilityCapturedAt(): string {
  return DOC.capturedAt;
}

export function durabilityFor(ticker: string): DurabilityRow | null {
  return DOC.companies[ticker] ?? null;
}

/** Above this delivered rate the comparison flatters the company, and says so. */
export const HIGH_GROWTH_CAVEAT = 0.3;
/** Within this many points, the price is asking for roughly the record. */
export const GAP_BAND_PTS = 3;

export interface RequiredVsDelivered {
  required: number | null;
  /** The same inversion from FORWARD earnings — differs when trailing carries a one-off. */
  requiredForward: number | null;
  delivered: number | null;
  deliveredBasis: string | null;
  deliveredFcf: number | null;
  gapPts: number | null;
  read: "asks-less" | "about-record" | "asks-more" | "unknown";
  line: string;
}

const pc = (x: number) => `${(x * 100).toFixed(1)}%`;

/**
 * The price's requirement next to the company's own record. Delivered is
 * net income growth over the longest clean window (10y, else 5y), else the
 * 4-year revenue growth labelled as such. A window across a loss is not
 * silently shortened — it reads as unknown with the reason.
 */
export function requiredVsDelivered(ticker: string): RequiredVsDelivered {
  const f = fundamentalsFor(ticker);
  const req = impliedGrowth(f).growth;
  const reqFwd = impliedGrowth(f, { basis: "forward" }).growth;
  const d = durabilityFor(ticker);
  const l = d?.long ?? null;
  let delivered: number | null = null;
  let basis: string | null = null;
  let fcf: number | null = null;
  if (l?.niCagr10y != null) {
    delivered = l.niCagr10y;
    basis = `net income, 10 fiscal years (${l.window10})`;
    fcf = l.fcfCagr10y;
  } else if (l?.niCagr5y != null) {
    delivered = l.niCagr5y;
    basis = `net income, 5 fiscal years (${l.window5})`;
    fcf = l.fcfCagr5y;
  } else if (d?.yahoo?.revenueCagr != null) {
    delivered = d.yahoo.revenueCagr;
    basis = `revenue, ${d.yahoo.revenueYears} fiscal years — no long earnings record captured`;
  }
  if (req == null || delivered == null) {
    return {
      required: req,
      requiredForward: reqFwd,
      delivered,
      deliveredBasis: basis,
      deliveredFcf: fcf,
      gapPts: null,
      read: "unknown",
      line:
        req == null
          ? "No implied-growth figure — the price cannot be inverted without captured earnings."
          : "No delivered-growth record captured for this company yet.",
    };
  }
  const gap = (req - delivered) * 100;
  const read: RequiredVsDelivered["read"] =
    gap <= -GAP_BAND_PTS ? "asks-less" : gap >= GAP_BAND_PTS ? "asks-more" : "about-record";
  const headline =
    read === "asks-less"
      ? `The price asks for ${pc(req)} a year — less than the ${pc(delivered)} it delivered (${basis}). It already assumes a slowdown.`
      : read === "asks-more"
        ? `The price asks for ${pc(req)} a year — MORE than the ${pc(delivered)} it delivered (${basis}). It needs the business to accelerate past its own record.`
        : `The price asks for ${pc(req)} a year, about the ${pc(delivered)} it delivered (${basis}). It extends the record, no more.`;
  const fcfNote =
    fcf != null && Math.abs(fcf - delivered) >= 0.05
      ? ` Free cash flow grew ${pc(fcf)} over the same window — ${fcf < delivered ? "well behind earnings; the gap is capex or working capital" : "ahead of earnings"}.`
      : "";
  const caveat =
    delivered >= HIGH_GROWTH_CAVEAT
      ? " A record this fast has rarely persisted for a decade at this size, so the comparison flatters it."
      : "";
  const fwdNote =
    reqFwd != null && Math.abs(reqFwd - req) * 100 >= GAP_BAND_PTS
      ? ` From FORWARD earnings the requirement is ${pc(reqFwd)} — ${reqFwd > req ? "higher: trailing earnings carry something the market does not expect to repeat" : "lower: the market expects earnings to rise"}.`
      : "";
  return {
    required: req,
    requiredForward: reqFwd,
    delivered,
    deliveredBasis: basis,
    deliveredFcf: fcf,
    gapPts: gap,
    read,
    line: headline + fwdNote + fcfNote + caveat,
  };
}

export interface DurabilityLeg {
  key: "fcf" | "sbc" | "capex" | "shares";
  label: string;
  value: number | null;
  reads: string;
  /** True when the leg is a warning worth reading before anything else. */
  flag: boolean;
}

/** The four legs, each raw with a plain reading. Never summed. */
export function durabilityLegs(ticker: string): DurabilityLeg[] {
  const y = durabilityFor(ticker)?.yahoo;
  if (!y || y.error) return [];
  const legs: DurabilityLeg[] = [];
  const conv = y.fcfConversion3y ?? null;
  legs.push({
    key: "fcf",
    label: "FCF conversion (3y)",
    value: conv,
    reads:
      conv == null
        ? "unknown"
        : conv < 0
          ? "NEGATIVE — three years of free cash flow below zero while reporting profits"
          : conv < 0.6
            ? "most reported earnings did not reach free cash flow"
            : conv < 0.9
              ? "most earnings convert; capex or working capital takes the rest"
              : "earnings are cash",
    flag: conv != null && conv < 0.6,
  });
  const sbc = y.sbcToOcf ?? null;
  legs.push({
    key: "sbc",
    label: "Stock comp / operating cash",
    value: sbc,
    reads:
      sbc == null ? "not reported" : sbc > 0.15 ? "heavy — owners pay staff in shares the P/E does not count" : sbc > 0.05 ? "material" : "light",
    flag: sbc != null && sbc > 0.15,
  });
  const cx = y.capexToOcf ?? null;
  const cx0 = y.capexToOcfFirst ?? null;
  const rising = cx != null && cx0 != null && cx - cx0 >= 0.15;
  legs.push({
    key: "capex",
    label: "Capex / operating cash",
    value: cx,
    reads:
      cx == null
        ? "not reported"
        : rising
          ? `RISING — ${pc(cx)} now vs ${pc(cx0!)} four years ago; the build-out is consuming the cash flow`
          : cx0 != null && cx0 - cx >= 0.15
            ? `falling — ${pc(cx)} now vs ${pc(cx0)}`
            : cx > 1
              ? "capex exceeds operating cash — funded by debt or equity"
              : `stable around ${pc(cx)}`,
    flag: rising || (cx != null && cx > 1),
  });
  const s = y.sharesCagr ?? null;
  legs.push({
    key: "shares",
    label: "Share count per year",
    value: s,
    reads:
      s == null
        ? "unknown"
        : s <= -0.01
          ? `shrinking ${pc(-s)} a year — buybacks outrun dilution`
          : s >= 0.01
            ? `DILUTING ${pc(s)} a year — each share owns less of the business`
            : "flat",
    flag: s != null && s >= 0.01,
  });
  return legs;
}
