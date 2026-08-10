/**
 * Risk governor — pure deterministic time + math helpers (no I/O).
 *
 * Trading calendar (matches CME index futures):
 *   - Trading DAY starts 18:00 America/New_York (the 6pm reopen).
 *   - Trading WEEK starts Sunday 18:00 America/New_York.
 * All boundaries are computed DST-correctly via Intl (no fixed UTC offset).
 *
 * The server fn (src/lib/journal/server.ts getRiskState) runs the SQL
 * aggregates against these boundaries and feeds the totals into
 * `computeRiskFlags` below. Halt thresholds come from APLUS_RULES —
 * non-negotiable, AI never overrides.
 */

import { APLUS_RULES } from "@/lib/aplus/config";
import type { KillzoneId, SessionClock } from "@/lib/trading/sessions";

/** Offset (ms) such that `utc + offset = ET wall clock` at the given instant. */
function etOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  // Truncate `at` to whole seconds — formatToParts has no ms.
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** ET calendar date (y/m/d) plus minutes-since-midnight for an instant. */
export function etDateParts(at: Date): {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  minutes: number; // ET minutes since midnight
  weekday: number; // 0=Sun … 6=Sat (ET calendar day)
} {
  const offset = etOffsetMs(at);
  const wall = new Date(Math.floor(at.getTime() / 1000) * 1000 + offset);
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
    minutes: wall.getUTCHours() * 60 + wall.getUTCMinutes(),
    weekday: wall.getUTCDay(),
  };
}

/**
 * UTC instant of a given ET wall-clock time (DST-correct). Two-pass offset
 * refinement handles the offset changing between the guess and the target.
 */
export function etWallToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute = 0,
): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let utc = wallAsUtc - etOffsetMs(new Date(wallAsUtc));
  utc = wallAsUtc - etOffsetMs(new Date(utc));
  return new Date(utc);
}

/**
 * Start of the current trading day: most recent 18:00 ET at/before `now`.
 * (Date.UTC inside etWallToUtc normalizes `day - 1` across month/year edges.)
 */
export function tradingDayStart(now = new Date()): Date {
  const p = etDateParts(now);
  const today = etWallToUtc(p.year, p.month, p.day, 18);
  if (today.getTime() <= now.getTime()) return today;
  return etWallToUtc(p.year, p.month, p.day - 1, 18);
}

/**
 * Start of the current trading week: most recent Sunday 18:00 ET at/before
 * `now`. Derived from the trading-day start date (whose ET weekday tells us
 * how many days to step back to Sunday).
 */
export function tradingWeekStart(now = new Date()): Date {
  const dayStart = tradingDayStart(now);
  const p = etDateParts(dayStart); // 18:0x ET on the trading-day anchor date
  return etWallToUtc(p.year, p.month, p.day - p.weekday, 18);
}

/** ET-minute windows per killzone id (see src/lib/trading/sessions.ts). */
const KILLZONE_WINDOWS: Record<
  KillzoneId,
  { startMin: number; endMin: number; crossesMidnight: boolean }
> = {
  asia: { startMin: 19 * 60, endMin: 2 * 60, crossesMidnight: true },
  london: { startMin: 2 * 60, endMin: 8 * 60 + 30, crossesMidnight: false },
  ny_am: { startMin: 8 * 60 + 30, endMin: 11 * 60, crossesMidnight: false },
  ny_lunch: {
    startMin: 11 * 60,
    endMin: 13 * 60 + 30,
    crossesMidnight: false,
  },
  ny_pm: { startMin: 13 * 60 + 30, endMin: 16 * 60, crossesMidnight: false },
  dead: { startMin: 16 * 60, endMin: 19 * 60, crossesMidnight: false },
};

/**
 * UTC bounds of the CURRENT killzone window containing `now` (today's
 * occurrence). Used to count entries this killzone — deterministic, no state.
 */
export function currentKillzoneWindow(
  killzone: KillzoneId,
  now = new Date(),
): { startUtc: Date; endUtc: Date } {
  const w = KILLZONE_WINDOWS[killzone];
  const p = etDateParts(now);
  const sh = Math.floor(w.startMin / 60);
  const sm = w.startMin % 60;
  const eh = Math.floor(w.endMin / 60);
  const em = w.endMin % 60;
  if (!w.crossesMidnight) {
    return {
      startUtc: etWallToUtc(p.year, p.month, p.day, sh, sm),
      endUtc: etWallToUtc(p.year, p.month, p.day, eh, em),
    };
  }
  // Asia: 19:00 -> 02:00 next ET day.
  if (p.minutes >= w.startMin) {
    return {
      startUtc: etWallToUtc(p.year, p.month, p.day, sh, sm),
      endUtc: etWallToUtc(p.year, p.month, p.day + 1, eh, em),
    };
  }
  return {
    startUtc: etWallToUtc(p.year, p.month, p.day - 1, sh, sm),
    endUtc: etWallToUtc(p.year, p.month, p.day, eh, em),
  };
}

/** Snapshot returned by the getRiskState server fn. */
export interface RiskState {
  equity: number;
  /** Realized NET PnL since 18:00 ET (closed trades). */
  dayPnl: number;
  /** Realized NET PnL since Sunday 18:00 ET (closed trades). */
  weekPnl: number;
  /** Dollar loss limits (positive numbers). */
  dailyLimit: number;
  weeklyLimit: number;
  dailyHaltHit: boolean;
  weeklyHaltHit: boolean;
  killzone: KillzoneId;
  killzoneLabel: string;
  entriesThisKillzone: number;
  killzoneCap: number;
  killzoneCapHit: boolean;
  openTrades: number;
  /** Boundaries used (ISO), for audit/debug display. */
  dayStartUtc: string;
  weekStartUtc: string;
}

/** Pure flag math from SQL aggregates + the session clock. */
export function computeRiskFlags(input: {
  equity: number;
  dayPnl: number;
  weekPnl: number;
  entriesThisKillzone: number;
  openTrades: number;
  clock: SessionClock;
  dayStart: Date;
  weekStart: Date;
}): RiskState {
  const dailyLimit = input.equity * APLUS_RULES.dailyLossLimitPct;
  const weeklyLimit = input.equity * APLUS_RULES.weeklyLossLimitPct;
  return {
    equity: input.equity,
    dayPnl: input.dayPnl,
    weekPnl: input.weekPnl,
    dailyLimit,
    weeklyLimit,
    dailyHaltHit: input.dayPnl <= -dailyLimit,
    weeklyHaltHit: input.weekPnl <= -weeklyLimit,
    killzone: input.clock.killzone,
    killzoneLabel: input.clock.killzoneLabel,
    entriesThisKillzone: input.entriesThisKillzone,
    killzoneCap: APLUS_RULES.maxSetupsPerSession,
    killzoneCapHit:
      input.entriesThisKillzone >= APLUS_RULES.maxSetupsPerSession,
    openTrades: input.openTrades,
    dayStartUtc: input.dayStart.toISOString(),
    weekStartUtc: input.weekStart.toISOString(),
  };
}
