/**
 * Look-through — what the book actually owns once the funds are opened up.
 *
 * WHY THIS EXISTS
 * `concentrationWarning` (universe.ts) counts DIRECT tech holdings. A book
 * that is 100% VTI therefore read "0% US large-cap tech … this book is not
 * doubling it" — while VTI itself is 33.8% information technology and its
 * eight largest lines are QQQ's eight largest lines. Measured on the captured
 * profiles (2026-09-25 issuer data), VTI overlaps QQQ by 47.8% of its weight:
 * nearly half of the default landing pad for every swept dollar is the same
 * basket the options sleeve is levered to. That is not a reason to avoid VTI
 * — it is the market — but it is the number the "one bet held twice" warning
 * was supposed to be about, and it was invisible.
 *
 * OVERLAP, DEFINED
 * Portfolio overlap by weight = Σ over companies of min(weight in the book,
 * weight in QQQ). 100% means the book IS QQQ; 0% means no shared company.
 * VTI/ITOT profiles keep every QQQ name wherever it ranks, so this is exact
 * for them rather than a top-N lower bound. VXUS's source lists only its
 * US-listed lines, so its overlap (and sector split) is flagged, not guessed.
 *
 * WHAT THIS FILE WILL NOT DO
 * It changes no verdict by itself and it is not a signal. `book.ts` reads the
 * effective per-name weight so a direct buy of a name VTI already carries is
 * sized against the cap INCLUDING what the fund holds — that is arithmetic
 * about the book, not a view on the company.
 */

import profiles from "../../data/invest-etf-profiles.json";
import { fundamentalsFor, fundSector } from "./universe";

export interface FundProfile {
  asOf: string;
  netAssets: number;
  expenseRatio: number;
  dividendYield: number;
  turnover: number | null;
  inception: string;
  holdingsCount: number | null;
  /** False when the source's sector split is unusable (VXUS today). */
  sectorsReliable: boolean;
  /** True when the stored holdings are known to be a slice of the fund. */
  holdingsPartial: boolean;
  sectors: Record<string, number>;
  /** Sum of the stored holdings' weights — how much of the fund is visible. */
  storedWeight: number;
  /** Fund-level overlap with QQQ, computed on full lists at capture time. */
  overlapQQQ: number | null;
  holdings: [string, number][];
}

interface ProfilesDoc {
  capturedAt: string;
  source: string;
  note: string;
  funds: Record<string, FundProfile>;
}

const DOC = profiles as unknown as ProfilesDoc;

/** The index the options sleeve trades that concentrates the bet. */
export const OVERLAP_TARGET = "QQQ";
/** Above this, the tab says out loud that the book and the sleeve share a basket. */
export const OVERLAP_WARN = 0.35;
/** The two sectors that make up "US large-cap tech" as the sleeve trades it. */
export const TECH_SECTORS = ["INFORMATION TECHNOLOGY", "COMMUNICATION SERVICES"] as const;
const CASH_BUCKET = "T-BILLS / CASH";

export function profilesCapturedAt(): string {
  return DOC.capturedAt;
}

export function fundProfile(ticker: string): FundProfile | null {
  return DOC.funds[ticker] ?? null;
}

export interface ExposureInput {
  ticker: string;
  valueUsd: number;
}

export interface LookThroughName {
  ticker: string;
  /** Share of the whole book, direct + inside funds. */
  weight: number;
  direct: number;
  viaFunds: number;
  /** Weight of this company inside QQQ, for the overlap column. */
  inQQQ: number;
}

export interface ExposureRead {
  totalUsd: number;
  /** True when computed on the hypothetical all-VTI book (nothing held yet). */
  preview: boolean;
  names: LookThroughName[];
  sectors: { sector: string; weight: number }[];
  /** Info tech + communication services, look-through, as a share of the WHOLE book. */
  techWeight: number;
  /** Share of the book whose sector split is not known (VXUS today). */
  sectorUnknown: number;
  overlapQQQ: number;
  /** True when part of the overlap sits in a fund whose holdings list is partial. */
  overlapPartial: boolean;
  feeUsdYear: number;
  feeBlended: number;
  warn: boolean;
  line: string;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Open every fund, add the direct holdings, and measure. Pure.
 * An empty input is measured as the default landing pad — all VTI — and
 * flagged `preview`, because "what will my first dollar own" is the useful
 * question before there is a book.
 */
export function lookThrough(input: ExposureInput[]): ExposureRead {
  const held = input.filter((h) => Number.isFinite(h.valueUsd) && h.valueUsd > 0);
  const preview = held.length === 0;
  const rows = preview ? [{ ticker: "VTI", valueUsd: 100 }] : held;
  const total = rows.reduce((s, h) => s + h.valueUsd, 0);

  const direct = new Map<string, number>();
  const via = new Map<string, number>();
  const sectors = new Map<string, number>();
  let sectorUnknown = 0;
  let fee = 0;
  let partialValue = 0;

  for (const h of rows) {
    const fund = fundProfile(h.ticker);
    if (fund) {
      fee += h.valueUsd * fund.expenseRatio;
      if (fund.holdingsPartial) partialValue += h.valueUsd;
      for (const [sym, w] of fund.holdings) via.set(sym, (via.get(sym) ?? 0) + h.valueUsd * w);
      const secEntries = Object.entries(fund.sectors);
      if (fund.holdingsCount === 0 && secEntries.length === 0) {
        sectors.set(CASH_BUCKET, (sectors.get(CASH_BUCKET) ?? 0) + h.valueUsd);
      } else if (!fund.sectorsReliable || secEntries.length === 0) {
        sectorUnknown += h.valueUsd;
      } else {
        const secTotal = secEntries.reduce((s, [, w]) => s + w, 0);
        for (const [k, w] of secEntries) sectors.set(k, (sectors.get(k) ?? 0) + h.valueUsd * w);
        // The source's sector weights sum to ~1 but not exactly; the residual
        // is unknown rather than silently dropped.
        if (secTotal < 1) sectorUnknown += h.valueUsd * (1 - secTotal);
      }
      continue;
    }
    direct.set(h.ticker, (direct.get(h.ticker) ?? 0) + h.valueUsd);
    const sec = fundSector(fundamentalsFor(h.ticker)?.sector);
    if (sec) sectors.set(sec, (sectors.get(sec) ?? 0) + h.valueUsd);
    else sectorUnknown += h.valueUsd;
  }

  const qqq = new Map(fundProfile(OVERLAP_TARGET)?.holdings ?? []);
  const tickers = new Set([...direct.keys(), ...via.keys()]);
  const names: LookThroughName[] = [...tickers]
    .map((t) => {
      const d = (direct.get(t) ?? 0) / total;
      const v = (via.get(t) ?? 0) / total;
      return { ticker: t, weight: d + v, direct: d, viaFunds: v, inQQQ: qqq.get(t) ?? 0 };
    })
    .sort((a, b) => b.weight - a.weight);

  let overlap = 0;
  for (const n of names) overlap += Math.min(n.weight, n.inQQQ);

  const tech = TECH_SECTORS.reduce((s, k) => s + (sectors.get(k) ?? 0), 0) / total;
  const sectorList = [...sectors.entries()]
    .map(([sector, v]) => ({ sector, weight: v / total }))
    .sort((a, b) => b.weight - a.weight);

  const warn = overlap >= OVERLAP_WARN;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const top = names
    .slice(0, 5)
    .map((n) => `${n.ticker} ${pct(n.weight)}`)
    .join(" · ");
  const subject = preview ? "Every swept dollar lands in VTI, which" : "This book";
  const line = warn
    ? `${subject} overlaps QQQ — the index the options sleeve trades — by ${pct(overlap)} of its weight, and is ${pct(tech)} tech + communication services once the funds are opened. Largest look-through lines: ${top}. The ballast is the market, not a hedge against the sleeve; VXUS and SGOV are the only lines here that lower this number.`
    : `${subject} overlaps QQQ by ${pct(overlap)} of its weight and is ${pct(tech)} tech + communication services, look-through. Largest lines: ${top}.`;

  return {
    totalUsd: preview ? 0 : Math.round(total * 100) / 100,
    preview,
    names,
    sectors: sectorList,
    techWeight: round4(tech),
    sectorUnknown: round4(sectorUnknown / total),
    overlapQQQ: round4(overlap),
    overlapPartial: partialValue > 0,
    feeUsdYear: preview ? 0 : Math.round(fee * 100) / 100,
    feeBlended: total > 0 ? fee / total : 0,
    warn,
    line,
  };
}

/**
 * One company's effective weight: what the book holds directly plus what
 * its funds hold of it. Used by the per-name cap so buying MSFT on top of a
 * VTI position is sized against the cap including the MSFT inside VTI.
 */
export function effectiveWeight(read: ExposureRead, ticker: string): { total: number; direct: number; viaFunds: number } {
  if (read.preview) return { total: 0, direct: 0, viaFunds: 0 };
  const n = read.names.find((x) => x.ticker === ticker);
  return n ? { total: n.weight, direct: n.direct, viaFunds: n.viaFunds } : { total: 0, direct: 0, viaFunds: 0 };
}

/** What a fund holds of one company — for dossier cards ("already 6.4% of VTI"). */
export function weightInFund(fund: string, ticker: string): number | null {
  const p = fundProfile(fund);
  if (!p) return null;
  const hit = p.holdings.find(([s]) => s === ticker);
  return hit ? hit[1] : 0;
}
