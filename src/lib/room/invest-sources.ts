/**
 * The investment office's inputs, read the way the Invest tab reads them — the same ledger, the same functions — with one
 * difference said out loud: the Floor never fetches prices (the Invest tab fetches closes on request and says so), so the book
 * here is valued at COST and the read carries `valuedAtCost`.
 *
 * Browser-only (the ledger lives in localStorage); on the server, or when the ledger cannot be read, the office is simply
 * dark (`null`) and `investReadProblem()` says why — the rest of the room is unaffected.
 *
 * The one input the Invest tab does not have is "other income": money that is not day-trading P&L and the share the trader
 * chose to send to the long book. It is arithmetic only — stored here as two numbers, never written to the ledger, never moving
 * a dollar — and it is null until the trader enters it.
 */

import { buildBook, nextBuy, rebalanceCheck, type Position } from "@/lib/invest/book";
import { heldPositions, sweepFundedUsd } from "@/lib/invest/ledger";
import { deployQueue, rateLadder } from "@/lib/invest/policy";
import { etToday, loadLedger, subscribeInvest } from "@/lib/invest/store";
import { buildInvest } from "./invest-office";
import type { InvestLite } from "./live-types";

const OTHER_KEY = "ledger-invest-other-income-v1";
const OTHER_EVENT = "ledger-invest-other-income";
const MEMO_MS = 60_000;

export interface OtherIncome {
  monthlyUsd: number;
  ratePct: number;
}

const valid = (v: unknown): v is OtherIncome => {
  const o = v as OtherIncome | null;
  return !!o && typeof o.monthlyUsd === "number" && typeof o.ratePct === "number" && Number.isFinite(o.monthlyUsd) && Number.isFinite(o.ratePct) && o.monthlyUsd >= 0 && o.monthlyUsd <= 1_000_000 && o.ratePct >= 0 && o.ratePct <= 100;
};

export function loadOtherIncome(): OtherIncome | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(OTHER_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    return valid(v) ? { monthlyUsd: v.monthlyUsd, ratePct: v.ratePct } : null;
  } catch {
    return null;
  }
}

/** Save (or clear with null), and SAY whether it stuck. */
export function saveOtherIncome(v: OtherIncome | null): { ok: boolean; why: string } {
  if (typeof window === "undefined") return { ok: false, why: "no browser storage here" };
  if (v != null && !valid(v)) return { ok: false, why: "Monthly dollars must be 0–1,000,000 and the share 0–100%." };
  try {
    if (v == null) window.localStorage.removeItem(OTHER_KEY);
    else window.localStorage.setItem(OTHER_KEY, JSON.stringify({ monthlyUsd: Math.round(v.monthlyUsd * 100) / 100, ratePct: Math.round(v.ratePct * 100) / 100 }));
  } catch (e) {
    return { ok: false, why: `Browser storage refused the write (${String(e).slice(0, 80)}).` };
  }
  memo = null;
  window.dispatchEvent(new Event(OTHER_EVENT));
  return { ok: true, why: v == null ? "cleared" : "saved" };
}

export function subscribeOtherIncome(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(OTHER_EVENT, fn);
  return () => window.removeEventListener(OTHER_EVENT, fn);
}

let memo: { at: number; day: string; v: InvestLite } | null = null;
let problem: string | null = null;
let wired = false;

function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  // A ledger write (this tab or another) or an other-income edit drops the memo; the next read rebuilds it.
  subscribeInvest(() => {
    memo = null;
  });
}

/** Why the office is dark, or null. */
export const investReadProblem = (): string | null => problem;

/** The office's read at this instant (memoised for a minute; a ledger write invalidates it at once). */
export function readInvestOffice(nowMs: number): InvestLite | null {
  if (typeof window === "undefined") return null;
  wire();
  const day = etToday(new Date(nowMs));
  if (memo && memo.day === day && nowMs - memo.at < MEMO_MS && nowMs >= memo.at) return memo.v;
  try {
    const ledger = loadLedger();
    const held = heldPositions(ledger, day);
    const positions: Position[] = held.map((h) => ({ ticker: h.ticker, sleeve: h.sleeve, shares: h.shares, costUsd: h.costUsd, openedAt: h.openedAt }));
    const book = buildBook(positions, {}, nowMs);
    const reb = rebalanceCheck(book);
    const ladder = rateLadder(ledger.sweeps);
    const queue = deployQueue(ledger.sweeps, sweepFundedUsd(ledger), nowMs);
    const next = nextBuy(book, queue.waitingUsd, new Set(held.map((h) => h.ticker)));
    const v = buildInvest({
      dayKey: day,
      book,
      reb,
      ladder,
      queue,
      next,
      held: held.map((h) => h.ticker),
      sweptMonthly: ledger.sweeps.map((s) => s.sweptUsd),
      other: loadOtherIncome(),
    });
    memo = { at: nowMs, day, v };
    problem = null;
    return v;
  } catch (e) {
    problem = `The investment office could not read the ledger: ${String(e).slice(0, 120)}`;
    return null;
  }
}
