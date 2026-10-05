/**
 * The day / week / month / killzone counters an account keeps — the halts, the slots and the one-book lock read them.
 * The room's paper book and each seat's account (seats.ts) keep the same counters and roll them on the same keys,
 * so a seat can never be halted, or released, by a rule the room does not have.
 */

import { etMonthKey, etWeekKey } from "@/lib/trading/rh-income";
import { etDateOf, type Underlier } from "./option-math";
import type { RoomLedger } from "./orchestrator";

export interface RoomCounters {
  dayKey: string;
  dayStartEquity: number;
  realizedToday: number;
  weekKey: string;
  weekStartEquity: number;
  realizedWeek: number;
  monthKey: string;
  monthEntries: number;
  kzKey: string;
  kzEntries: number;
  underlierDay: { day: string; underlier: Underlier } | null;
  consecLosses: number;
  /** planKey of every plan bought today — one plan, one fill. */
  filledPlans: string[];
}

export function emptyCounters(cash: number): RoomCounters {
  return {
    dayKey: "",
    dayStartEquity: cash,
    realizedToday: 0,
    weekKey: "",
    weekStartEquity: cash,
    realizedWeek: 0,
    monthKey: "",
    monthEntries: 0,
    kzKey: "",
    kzEntries: 0,
    underlierDay: null,
    consecLosses: 0,
    filledPlans: [],
  };
}

/** Day, week, month and killzone counters roll on their own keys. `eq` is the account's equity right now. */
export function rollCountersOf(c0: RoomCounters, eq: number, nowMs: number, killzone: string): RoomCounters {
  const c = { ...c0 };
  const day = etDateOf(nowMs);
  const week = etWeekKey(new Date(nowMs));
  const month = etMonthKey(new Date(nowMs));
  if (c.dayKey !== day) Object.assign(c, { dayKey: day, dayStartEquity: eq, realizedToday: 0, filledPlans: [] });
  if (!Array.isArray(c.filledPlans)) c.filledPlans = [];
  if (c.weekKey !== week) Object.assign(c, { weekKey: week, weekStartEquity: eq, realizedWeek: 0 });
  if (c.monthKey !== month) Object.assign(c, { monthKey: month, monthEntries: 0 });
  const kz = `${day}:${killzone}`;
  if (c.kzKey !== kz) Object.assign(c, { kzKey: kz, kzEntries: 0 });
  if (c.underlierDay && c.underlierDay.day !== day) c.underlierDay = null;
  return c;
}

/** The counters in the shape the room's checklist reads (orchestrator.ts RoomLedger). */
export function ledgerOfCounters(c: RoomCounters): RoomLedger {
  return {
    dayStartEquity: c.dayStartEquity,
    realizedTodayUsd: c.realizedToday,
    weekStartEquity: c.weekStartEquity,
    realizedWeekUsd: c.realizedWeek,
    entriesThisKillzone: c.kzEntries,
    underlierToday: c.underlierDay?.underlier ?? null,
    monthEntries: c.monthEntries,
    consecLosses: c.consecLosses,
    filledPlans: c.filledPlans ?? [],
  };
}
