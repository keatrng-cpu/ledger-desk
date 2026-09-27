/**
 * The one wire from the options sleeve into the share book — read-only.
 *
 * THE SWEEP'S INPUT
 * The sweep is priced on REALIZED, CLOSED options P&L, and the tab asked the
 * trader to type it because "the desk cannot read a broker it is not
 * connected to". True of the broker; not true of the desk's own RH journal
 * (rh-income.ts), where the trader already logs every sleeve fill and its
 * close. So the month's closed P&L is offered from that journal — as a
 * figure the trader confirms, never a default, and never including an open
 * position (open premium is not cash).
 *
 * THE BAN FOLLOWS THE TAPE
 * universe.ts bans what the sleeve trades — QQQ and SPY, as a static list.
 * If the journal shows options on another underlier inside the 61-day
 * window IRC §1091 looks across (30 days either side of a sale), that
 * underlier is banned from the book too, and the tab names the fill that
 * put it there. Static list for the known case; the journal for the rest.
 */

import { loadRhIncome, etMonthKey, type RhFill } from "../trading/rh-income";
import { WASH_SALE_BANNED } from "./universe";

/** The journal keeps only its most recent fills (rh-income.ts slices to 80). */
export const RH_JOURNAL_CAP = 80;
/** 30 days before + the day + 30 days after. */
export const WASH_LOOKBACK_DAYS = 61;

export interface RhMonthRead {
  month: string;
  realizedUsd: number;
  closedCount: number;
  openCount: number;
  openDebitUsd: number;
  /** Set when the journal may no longer hold the whole month. */
  capNote: string | null;
  line: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Pure core, exported for the verifier. */
export function rhMonthFrom(fills: RhFill[], month: string): RhMonthRead {
  const closed = fills.filter((f) => f.closedAt && f.pnl != null && etMonthKey(new Date(f.closedAt)) === month);
  const open = fills.filter((f) => !f.closedAt);
  const realized = round2(closed.reduce((s, f) => s + (f.pnl ?? 0), 0));
  const openDebit = round2(open.reduce((s, f) => s + (f.debit ?? 0), 0));
  const oldest = fills.map((f) => f.openedAt).sort()[0];
  const capNote =
    fills.length >= RH_JOURNAL_CAP && oldest && oldest.slice(0, 7) >= month
      ? `The journal keeps its last ${RH_JOURNAL_CAP} fills and its oldest is ${oldest.slice(0, 10)} — ${month} may be incomplete. Check the broker's statement.`
      : null;
  const line =
    closed.length === 0
      ? `No sleeve trades closed in ${month} in this browser's RH journal.`
      : `RH journal: ${realized >= 0 ? "+" : "-"}$${Math.abs(realized).toFixed(2)} realized across ${closed.length} closed trade${
          closed.length === 1 ? "" : "s"
        } in ${month}${open.length ? ` · ${open.length} still open ($${openDebit.toFixed(0)} premium — not cash, not swept)` : ""}.`;
  return {
    month,
    realizedUsd: realized,
    closedCount: closed.length,
    openCount: open.length,
    openDebitUsd: openDebit,
    capNote,
    line,
  };
}

export function rhMonth(month: string): RhMonthRead {
  return rhMonthFrom(loadRhIncome().fills, month);
}

/** Underliers with a fill opened or closed inside the look-back window. */
export function recentUnderliersFrom(fills: RhFill[], now: number): { underlier: string; lastAt: string }[] {
  const cutoff = now - WASH_LOOKBACK_DAYS * 86_400_000;
  const seen = new Map<string, string>();
  for (const f of fills) {
    const u = String(f.underlier ?? "").trim().toUpperCase();
    if (!/^[A-Z][A-Z.]{0,9}$/.test(u)) continue;
    for (const at of [f.openedAt, f.closedAt]) {
      if (!at) continue;
      const t = Date.parse(at);
      if (Number.isFinite(t) && t >= cutoff) {
        const prev = seen.get(u);
        if (!prev || at > prev) seen.set(u, at);
      }
    }
  }
  return [...seen.entries()].map(([underlier, lastAt]) => ({ underlier, lastAt }));
}

/**
 * The full ban for a buy made now: the static list plus any underlier the
 * journal traded inside the window. Returns the reason, or null.
 */
export function banReasonFrom(fills: RhFill[], ticker: string, now: number): string | null {
  const t = ticker.trim().toUpperCase();
  if (WASH_SALE_BANNED[t]) return WASH_SALE_BANNED[t];
  const hit = recentUnderliersFrom(fills, now).find((u) => u.underlier === t);
  return hit
    ? `the RH journal shows ${t} options as recently as ${hit.lastAt.slice(0, 10)} — inside the ${WASH_LOOKBACK_DAYS}-day wash-sale window`
    : null;
}

export function banReason(ticker: string, now = Date.now()): string | null {
  return banReasonFrom(loadRhIncome().fills, ticker, now);
}

/** Underliers the sleeve traded that the static ban list does not cover. */
export function uncoveredUnderliers(now = Date.now()): { underlier: string; lastAt: string }[] {
  return recentUnderliersFrom(loadRhIncome().fills, now).filter((u) => !WASH_SALE_BANNED[u.underlier]);
}
