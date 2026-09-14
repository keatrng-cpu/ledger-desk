/**
 * Robinhood sleeve P&L vs Databento rent.
 *
 * First hurdle is $199/mo (~$50/week) so the live CME bill is covered.
 * $1,000/week is a stretch after sample — never a reason to take a B+.
 * Working stop is 25% of debit (not 1/3, not full premium).
 */

export const DATABENTO_MONTHLY_USD = 199;
export const RH_WEEKLY_FLOOR_USD = 50;
export const RH_WEEKLY_STRETCH_USD = 1_000;
export const RH_WORKING_STOP_PCT = 0.25;

export const RH_INCOME_STORAGE = "ledger-rh-income-v1";
export const RH_INCOME_EVENT = "ledger-rh-income";

export interface RhFill {
  id: string;
  openedAt: string;
  closedAt?: string;
  underlier: string;
  side: string;
  debit: number;
  exit?: number;
  pnl?: number;
  note: string;
}

export interface RhIncomeState {
  fills: RhFill[];
}

function empty(): RhIncomeState {
  return { fills: [] };
}

export function etWeekKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "01";
  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));
  const utc = Date.UTC(y, m - 1, d);
  const day = new Date(utc).getUTCDay() || 7;
  const thu = new Date(utc);
  thu.setUTCDate(d + 4 - day);
  const yearStart = Date.UTC(thu.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((thu.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${thu.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function etMonthKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}`;
}

export function loadRhIncome(): RhIncomeState {
  if (typeof window === "undefined") return empty();
  try {
    const raw = localStorage.getItem(RH_INCOME_STORAGE);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<RhIncomeState>;
    return { fills: Array.isArray(parsed.fills) ? parsed.fills : [] };
  } catch {
    return empty();
  }
}

function persist(next: RhIncomeState): RhIncomeState {
  if (typeof window !== "undefined") {
    localStorage.setItem(RH_INCOME_STORAGE, JSON.stringify(next));
    window.dispatchEvent(new Event(RH_INCOME_EVENT));
  }
  return next;
}

export function subscribeRhIncome(fn: (s: RhIncomeState) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const on = () => fn(loadRhIncome());
  window.addEventListener(RH_INCOME_EVENT, on);
  window.addEventListener("storage", on);
  return () => {
    window.removeEventListener(RH_INCOME_EVENT, on);
    window.removeEventListener("storage", on);
  };
}

export function logRhFill(partial: Omit<RhFill, "id" | "openedAt"> & { openedAt?: string }): RhIncomeState {
  const s = loadRhIncome();
  const fill: RhFill = {
    id: `rh-${Date.now().toString(36)}`,
    openedAt: partial.openedAt ?? new Date().toISOString(),
    underlier: partial.underlier,
    side: partial.side,
    debit: Math.round(partial.debit),
    note: partial.note,
    closedAt: partial.closedAt,
    exit: partial.exit,
    pnl: partial.pnl,
  };
  return persist({ fills: [fill, ...s.fills].slice(0, 80) });
}

export function closeRhFill(id: string, exit: number): RhIncomeState {
  const s = loadRhIncome();
  return persist({
    fills: s.fills.map((f) => {
      if (f.id !== id || f.closedAt) return f;
      const pnl = Math.round(exit - f.debit);
      return { ...f, closedAt: new Date().toISOString(), exit: Math.round(exit), pnl };
    }),
  });
}

export function rhWorkingStop(debit: number): number {
  return Math.max(10, Math.round(debit * RH_WORKING_STOP_PCT));
}

export interface RhIncomeRead {
  weekKey: string;
  monthKey: string;
  weekPnl: number;
  monthPnl: number;
  openDebit: number;
  weekFloor: number;
  monthRent: number;
  stretch: number;
  weekCovered: boolean;
  monthCovered: boolean;
  openCount: number;
  closedCount: number;
  honest: string;
}

export function readRhIncome(now = new Date()): RhIncomeRead {
  const s = loadRhIncome();
  const weekKey = etWeekKey(now);
  const monthKey = etMonthKey(now);
  const inWeek = (iso: string) => etWeekKey(new Date(iso)) === weekKey;
  const inMonth = (iso: string) => etMonthKey(new Date(iso)) === monthKey;
  const closed = s.fills.filter((f) => f.closedAt && f.pnl != null);
  const weekPnl = closed.filter((f) => inWeek(f.closedAt!)).reduce((a, f) => a + (f.pnl ?? 0), 0);
  const monthPnl = closed.filter((f) => inMonth(f.closedAt!)).reduce((a, f) => a + (f.pnl ?? 0), 0);
  const open = s.fills.filter((f) => !f.closedAt);
  const openDebit = open.reduce((a, f) => a + f.debit, 0);
  const weekCovered = weekPnl >= RH_WEEKLY_FLOOR_USD;
  const monthCovered = monthPnl >= DATABENTO_MONTHLY_USD;
  const honest = weekCovered
    ? monthCovered
      ? `Rent covered. Stretch is $${RH_WEEKLY_STRETCH_USD}/wk — do not add a B+ to chase it.`
      : `Week floor hit. Month still needs $${DATABENTO_MONTHLY_USD - monthPnl} for Databento.`
    : `Need $${RH_WEEKLY_FLOOR_USD - weekPnl} this week to cover Databento. One clean PATH, not size.`;
  return {
    weekKey,
    monthKey,
    weekPnl,
    monthPnl,
    openDebit,
    weekFloor: RH_WEEKLY_FLOOR_USD,
    monthRent: DATABENTO_MONTHLY_USD,
    stretch: RH_WEEKLY_STRETCH_USD,
    weekCovered,
    monthCovered,
    openCount: open.length,
    closedCount: closed.length,
    honest,
  };
}
