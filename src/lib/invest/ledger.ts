/**
 * The share book as an append-only ledger, and everything derived from it.
 *
 * WHY LOTS AND NOT POSITIONS
 * The first version stored one row per ticker and MERGED every buy into it,
 * keeping the earliest date "so the long-term clock is not reset by a $5
 * top-up". That is backwards: the IRS runs a holding period PER LOT. A $5
 * buy last month is short-term no matter when the first share was bought,
 * so the merged row reported long-term status the later lots did not have —
 * exactly the error that turns an expected 15% tax into ordinary income.
 * Every buy is now its own lot, sales relieve lots FIFO (Robinhood's default
 * disposal method; its support article states it), and the holding period
 * is computed per lot.
 *
 * WHY APPEND-ONLY
 * Same reason as the trading journal: the value of this record is being able
 * to ask, a year from now, "what did I actually do" and get a truthful
 * answer. Nothing is edited. A mistake is corrected with a VOID entry that
 * names what it cancels and why, and both stay visible.
 *
 * WASH SALES INSIDE THE BOOK
 * universe.ts bans what the OPTIONS sleeve trades around. This file watches
 * the book trading against itself: a sale at a loss with a purchase of the
 * same fund (or its twin — VTI/ITOT) within 30 days either side. For THIS
 * book that is not an edge case, it is the default: sweeps buy the ballast
 * every month and reinvested dividends buy it every quarter, so almost any
 * loss sale of the ballast lands inside someone's 30-day window. The flag
 * estimates the disallowed loss; the broker's 1099-B makes the actual basis
 * adjustment. NOT tax advice — the filed position belongs to a CPA.
 *
 * Pure. No window, no clock except the dates passed in.
 */

import type { Sleeve } from "./universe";
import { washFamily } from "./universe";
import type { SweepVerdict } from "./policy";

export type BuySource = "sweep" | "dividend" | "other";

interface EntryBase {
  id: string;
  /** Trade date, New York calendar, YYYY-MM-DD. */
  date: string;
  /** When it was recorded (ISO). Orders same-day entries. */
  loggedAt: string;
  note?: string;
}

export interface BuyEntry extends EntryBase {
  kind: "buy";
  ticker: string;
  sleeve: Sleeve;
  shares: number;
  costUsd: number;
  source: BuySource;
  /** Converted from the pre-lot store: its date is the EARLIEST buy of a merged row. */
  migrated?: boolean;
}

export interface SellEntry extends EntryBase {
  kind: "sell";
  ticker: string;
  shares: number;
  proceedsUsd: number;
}

export interface DividendEntry extends EntryBase {
  kind: "dividend";
  ticker: string;
  amountUsd: number;
  /** A reinvested dividend also writes a buy (source "dividend"). */
  reinvested: boolean;
}

export interface SweepEntry extends EntryBase {
  kind: "sweep";
  month: string;
  verdict: SweepVerdict;
  realizedUsd: number;
  rentUsd: number;
  restoreUsd: number;
  sweptUsd: number;
  rate: number;
}

export interface VoidEntry extends EntryBase {
  kind: "void";
  targetId: string;
  reason: string;
}

export type InvestEntry = BuyEntry | SellEntry | DividendEntry | SweepEntry | VoidEntry;

export interface Lot {
  id: string;
  ticker: string;
  sleeve: Sleeve;
  date: string;
  source: BuySource;
  migrated: boolean;
  sharesOrig: number;
  costOrigUsd: number;
  sharesOpen: number;
  /** Cost of the shares still open, pro rata. */
  costOpenUsd: number;
}

export interface Relief {
  lotId: string;
  buyDate: string;
  shares: number;
  costUsd: number;
  longTerm: boolean;
}

export interface WashFlag {
  replacementIds: string[];
  replacementTickers: string[];
  /** Estimated disallowed loss. The 1099-B is authoritative. */
  disallowedEstUsd: number;
  line: string;
}

export interface SaleRead {
  id: string;
  date: string;
  ticker: string;
  shares: number;
  proceedsUsd: number;
  costUsd: number;
  gainUsd: number;
  stGainUsd: number;
  ltGainUsd: number;
  relief: Relief[];
  wash: WashFlag | null;
}

export interface LedgerRead {
  entries: InvestEntry[];
  voided: Map<string, VoidEntry>;
  lots: Lot[];
  sales: SaleRead[];
  dividends: DividendEntry[];
  sweeps: SweepEntry[];
  /** Things the ledger could not apply, said plainly rather than skipped. */
  problems: string[];
}

export const WASH_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Shares are fractional at this size; compare with a tolerance. */
const SHARE_EPS = 1e-6;

export function isDate(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(`${d}T00:00:00Z`));
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Same calendar date one year later, clamped (Feb 29 → Feb 28). */
export function anniversary(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
  return `${y + 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/**
 * Long-term means held MORE than one year: the holding period starts the day
 * after purchase, so a sale on the anniversary itself is still short-term and
 * the first long-term day is the one after it.
 */
export function isLongTerm(buyDate: string, sellDate: string): boolean {
  return sellDate > anniversary(buyDate);
}

/** First date a lot bought on `buyDate` sells as long-term. */
export function longTermFrom(buyDate: string): string {
  return addDays(anniversary(buyDate), 1);
}

function order(a: InvestEntry, b: InvestEntry): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.loggedAt !== b.loggedAt) return a.loggedAt < b.loggedAt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/**
 * `gone` = lots already fully sold when this sale happens (by this sale or an
 * earlier one). Shares you no longer hold cannot replace the ones you sold,
 * so they are excluded; shares still open, and later buys inside the window,
 * are the replacements.
 *
 * Lots THIS sale draws from are excluded even when only partly sold: Rev.
 * Rul. 56-602 — selling part of a block bought within 30 days, at a loss,
 * is a bona fide reduction of the holding and is not washed by the rest of
 * the same block. A DIFFERENT lot bought inside the window (last week's
 * sweep while FIFO sells an older lot) is an acquisition, and is flagged.
 */
function washFor(sale: Omit<SaleRead, "wash">, buys: BuyEntry[], gone: Set<string>): WashFlag | null {
  if (sale.gainUsd >= 0) return null;
  const loss = -sale.gainUsd;
  const family = new Set(washFamily(sale.ticker));
  const relieved = new Set(sale.relief.map((r) => r.lotId));
  const from = addDays(sale.date, -WASH_WINDOW_DAYS);
  const to = addDays(sale.date, WASH_WINDOW_DAYS);
  const hits = buys.filter(
    (b) =>
      family.has(b.ticker) && !relieved.has(b.id) && !gone.has(b.id) && b.date >= from && b.date <= to,
  );
  if (!hits.length) return null;
  let fraction = 0;
  for (const b of hits) {
    fraction +=
      b.ticker === sale.ticker
        ? sale.shares > 0
          ? b.shares / sale.shares
          : 0
        : sale.costUsd > 0
          ? b.costUsd / sale.costUsd
          : 0;
  }
  const disallowed = round2(loss * Math.min(1, fraction));
  const names = [...new Set(hits.map((b) => b.ticker))];
  const dates = hits.map((b) => b.date).sort();
  return {
    replacementIds: hits.map((b) => b.id),
    replacementTickers: names,
    disallowedEstUsd: disallowed,
    line: `Wash sale: a $${round2(loss).toFixed(2)} loss on ${sale.ticker} (${sale.date}) sits within 30 days of ${hits.length} buy${
      hits.length === 1 ? "" : "s"
    } of ${names.join("/")} (${dates[0]}${dates.length > 1 ? ` … ${dates[dates.length - 1]}` : ""}). About $${disallowed.toFixed(
      2,
    )} of it is deferred into the replacement shares' basis, not lost — the 1099-B makes the adjustment.`,
  };
}

/**
 * Replay the ledger. Voids first (they cancel by id), then every surviving
 * entry in date order, relieving lots FIFO per ticker.
 */
export function replay(entries: InvestEntry[]): LedgerRead {
  const problems: string[] = [];
  const byId = new Map<string, InvestEntry>();
  for (const e of entries) {
    if (byId.has(e.id)) {
      problems.push(`Duplicate entry id ${e.id} ignored.`);
      continue;
    }
    byId.set(e.id, e);
  }
  const all = [...byId.values()].sort(order);

  const voided = new Map<string, VoidEntry>();
  for (const e of all) {
    if (e.kind !== "void") continue;
    const target = byId.get(e.targetId);
    if (!target) problems.push(`Void ${e.id} names ${e.targetId}, which is not in the ledger.`);
    else if (target.kind === "void") problems.push(`Void ${e.id} targets another void — not applied.`);
    else voided.set(e.targetId, e);
  }

  const live = all.filter((e) => e.kind !== "void" && !voided.has(e.id));
  const buys = live.filter((e): e is BuyEntry => e.kind === "buy");
  const lots: Lot[] = [];
  const sales: SaleRead[] = [];
  const dividends: DividendEntry[] = [];
  const sweeps: SweepEntry[] = [];
  const seenMonths = new Map<string, string>();

  for (const e of live) {
    if (e.kind === "buy") {
      lots.push({
        id: e.id,
        ticker: e.ticker,
        sleeve: e.sleeve,
        date: e.date,
        source: e.source,
        migrated: !!e.migrated,
        sharesOrig: e.shares,
        costOrigUsd: e.costUsd,
        sharesOpen: e.shares,
        costOpenUsd: e.costUsd,
      });
    } else if (e.kind === "sell") {
      const open = lots
        .filter((l) => l.ticker === e.ticker && l.sharesOpen > SHARE_EPS)
        .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
      const have = open.reduce((s, l) => s + l.sharesOpen, 0);
      if (have + SHARE_EPS < e.shares) {
        problems.push(
          `Sale ${e.id} (${e.shares} ${e.ticker} on ${e.date}) exceeds the ${round2(have)} shares open then — not applied. Void it or record the missing buy.`,
        );
        continue;
      }
      let left = e.shares;
      const relief: Relief[] = [];
      for (const l of open) {
        if (left <= SHARE_EPS) break;
        const take = Math.min(l.sharesOpen, left);
        const cost = l.sharesOpen > 0 ? l.costOpenUsd * (take / l.sharesOpen) : 0;
        relief.push({ lotId: l.id, buyDate: l.date, shares: take, costUsd: round2(cost), longTerm: isLongTerm(l.date, e.date) });
        l.costOpenUsd = round2(l.costOpenUsd - cost);
        l.sharesOpen = l.sharesOpen - take;
        if (l.sharesOpen < SHARE_EPS) {
          l.sharesOpen = 0;
          l.costOpenUsd = 0;
        }
        left -= take;
      }
      const costUsd = round2(relief.reduce((s, r) => s + r.costUsd, 0));
      // Proceeds split across lots in proportion to shares relieved.
      let st = 0;
      let lt = 0;
      for (const r of relief) {
        const g = e.proceedsUsd * (r.shares / e.shares) - r.costUsd;
        if (r.longTerm) lt += g;
        else st += g;
      }
      const base = {
        id: e.id,
        date: e.date,
        ticker: e.ticker,
        shares: e.shares,
        proceedsUsd: e.proceedsUsd,
        costUsd,
        gainUsd: round2(e.proceedsUsd - costUsd),
        stGainUsd: round2(st),
        ltGainUsd: round2(lt),
        relief,
      };
      const gone = new Set(lots.filter((l) => l.sharesOpen <= SHARE_EPS).map((l) => l.id));
      sales.push({ ...base, wash: washFor(base, buys, gone) });
    } else if (e.kind === "dividend") {
      dividends.push(e);
    } else if (e.kind === "sweep") {
      const prior = seenMonths.get(e.month);
      if (prior) {
        problems.push(`${e.month} is logged twice (${prior} and ${e.id}). The first stands; void one of them.`);
        continue;
      }
      seenMonths.set(e.month, e.id);
      sweeps.push(e);
    }
  }

  return { entries: all, voided, lots, sales, dividends, sweeps, problems };
}

export interface HeldPosition {
  ticker: string;
  sleeve: Sleeve;
  shares: number;
  costUsd: number;
  /** Earliest open lot — for display only; the tax clock is per lot. */
  openedAt: string;
  lots: Lot[];
  longTermShares: number;
  longTermCostUsd: number;
  /** Next date an open short-term lot turns long-term, if any. */
  nextLongTerm: string | null;
  /** True if any open lot came from the pre-lot store and its date is a merge. */
  hasMigrated: boolean;
}

/** Open lots rolled up per ticker, with the long-term split as of `today`. */
export function heldPositions(read: LedgerRead, today: string): HeldPosition[] {
  const map = new Map<string, Lot[]>();
  for (const l of read.lots) {
    if (l.sharesOpen <= SHARE_EPS) continue;
    const arr = map.get(l.ticker) ?? [];
    arr.push(l);
    map.set(l.ticker, arr);
  }
  return [...map.entries()]
    .map(([ticker, lots]) => {
      const sorted = [...lots].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const lt = sorted.filter((l) => today > anniversary(l.date));
      const st = sorted.filter((l) => !(today > anniversary(l.date)));
      return {
        ticker,
        sleeve: sorted[sorted.length - 1].sleeve,
        shares: sorted.reduce((s, l) => s + l.sharesOpen, 0),
        costUsd: round2(sorted.reduce((s, l) => s + l.costOpenUsd, 0)),
        openedAt: sorted[0].date,
        lots: sorted,
        longTermShares: lt.reduce((s, l) => s + l.sharesOpen, 0),
        longTermCostUsd: round2(lt.reduce((s, l) => s + l.costOpenUsd, 0)),
        nextLongTerm: st.length ? longTermFrom(st[0].date) : null,
        hasMigrated: sorted.some((l) => l.migrated),
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd);
}

/** Dollars recorded as bought WITH SWEPT CASH — the deploy queue's other side. */
export function sweepFundedUsd(read: LedgerRead): number {
  return round2(read.lots.filter((l) => l.source === "sweep").reduce((s, l) => s + l.costOrigUsd, 0));
}

/**
 * Before a sale is written: what it would realise and whether it washes.
 * Refuses a sale larger than the open shares rather than guessing a lot.
 */
export function previewSale(
  read: LedgerRead,
  sale: { ticker: string; shares: number; proceedsUsd: number; date: string },
): { ok: true; sale: SaleRead } | { ok: false; why: string } {
  if (!isDate(sale.date)) return { ok: false, why: "Trade date must be YYYY-MM-DD." };
  if (!(sale.shares > 0) || !(sale.proceedsUsd >= 0)) return { ok: false, why: "Shares > 0 and the dollars received." };
  const probe: SellEntry = {
    id: "__preview__",
    kind: "sell",
    date: sale.date,
    loggedAt: "9999-12-31T00:00:00.000Z",
    ticker: sale.ticker,
    shares: sale.shares,
    proceedsUsd: sale.proceedsUsd,
  };
  const next = replay([...read.entries, probe]);
  const hit = next.sales.find((s) => s.id === "__preview__");
  if (!hit) {
    const why = next.problems.find((p) => p.includes("__preview__")) ?? "Sale could not be applied.";
    return { ok: false, why: why.replace("Sale __preview__", "This sale") };
  }
  return { ok: true, sale: hit };
}

/**
 * Before a buy is written: does it land within 30 days AFTER a loss sale of
 * the same fund or its twin? The buy is legal; it defers that loss. The
 * trader should know before clicking, not in February.
 */
export function buyWashWarning(read: LedgerRead, ticker: string, date: string): string | null {
  const family = new Set(washFamily(ticker));
  const hits = read.sales.filter(
    (s) => s.gainUsd < 0 && family.has(s.ticker) && s.date <= date && date <= addDays(s.date, WASH_WINDOW_DAYS),
  );
  if (!hits.length) return null;
  const loss = round2(hits.reduce((s, x) => s - x.gainUsd, 0));
  return `This buy is within 30 days of a loss sale of ${[...new Set(hits.map((h) => h.ticker))].join("/")} (${hits
    .map((h) => h.date)
    .join(", ")}). Up to $${loss.toFixed(2)} of that loss would be deferred into these shares. Waiting until ${addDays(
    hits.map((h) => h.date).sort()[hits.length - 1],
    WASH_WINDOW_DAYS + 1,
  )} avoids it — or buy it anyway knowingly.`;
}

export interface TaxYearRead {
  year: number;
  stGainUsd: number;
  ltGainUsd: number;
  washDeferredEstUsd: number;
  dividendsUsd: number;
  sales: number;
  line: string;
}

/** One calendar year, the way the 1099 will group it. */
export function taxYear(read: LedgerRead, year: number): TaxYearRead {
  const y = String(year);
  const sales = read.sales.filter((s) => s.date.startsWith(y));
  const st = round2(sales.reduce((s, x) => s + x.stGainUsd, 0));
  const lt = round2(sales.reduce((s, x) => s + x.ltGainUsd, 0));
  const wash = round2(sales.reduce((s, x) => s + (x.wash?.disallowedEstUsd ?? 0), 0));
  const divs = round2(read.dividends.filter((d) => d.date.startsWith(y)).reduce((s, d) => s + d.amountUsd, 0));
  return {
    year,
    stGainUsd: st,
    ltGainUsd: lt,
    washDeferredEstUsd: wash,
    dividendsUsd: divs,
    sales: sales.length,
    line:
      sales.length === 0 && divs === 0
        ? `${year}: nothing realised and no dividends recorded — a book that never sells owes nothing but the dividend tax.`
        : `${year}: short-term ${st >= 0 ? "+" : "-"}$${Math.abs(st).toFixed(2)} (taxed as income), long-term ${
            lt >= 0 ? "+" : "-"
          }$${Math.abs(lt).toFixed(2)}, dividends $${divs.toFixed(2)}${
            wash > 0 ? `, ~$${wash.toFixed(2)} of losses deferred by wash sales` : ""
          }. The 1099-B/1099-DIV are the filed numbers; this is the check you run before they arrive.`,
  };
}
