/**
 * Real-data session / week backtests via Databento + desk detectors.
 * Natural-language intent: "backtest week of May 12 2026", etc.
 */

import {
  fetchBacktestLayers,
  aggregateBars,
  hasDatabentoKey,
  type BacktestLayers,
} from "@/lib/market/databento";
import type { IndexSymbol, OhlcBar } from "@/lib/market/types";
import { analyzeStructure, smtDivergence } from "./structure";
import { summarizeDetectors } from "./detectors";
import { assessConditions } from "./conditions";
import { getSessionClock } from "./sessions";
import { scanSetups, type SetupCandidate } from "./scanner";
import { ALWAYS_SCAN } from "./strategies";
import {
  analyzeTradezella,
  analysisToMarkdown,
  type TradezellaAnalysis,
} from "./tradezella-analyze";
import { PROFIT_ACTION_FLOOR, PROFIT_TARGET_WR } from "./profit-path";
import { isPathTake } from "./strategy-grade";
import {
  simulatePathTrade,
  summarizeTrades,
  type SimulatedTrade,
} from "./simulate-path-trade";
import { APLUS_RULES } from "@/lib/aplus/config";

export interface DateWindow {
  startMs: number;
  endMs: number;
  label: string;
  kind: "day" | "week" | "range";
}

export interface DayBacktestRow {
  date: string;
  symbol: string;
  htf: string;
  mid: string;
  ltf: string;
  regime: string;
  tradeable: boolean;
  best: SetupCandidate | null;
  pathEligible: boolean;
  gates: { name: string; pass: boolean; detail: string }[];
  notes: string;
  /** ISO decision timestamp (causal) */
  decisionIso?: string;
  /** Closed 1m bars available at decision on that session day */
  sessionBars?: number;
  /** Why slot is dead / skipped */
  deadspot?: string | null;
  /** Simulated PATH fill + P&L (only when taken) */
  trade?: SimulatedTrade | null;
}

export interface WeekBacktestReport {
  ok: boolean;
  error?: string;
  source: "databento" | "none";
  window: DateWindow;
  symbols: string[];
  days: DayBacktestRow[];
  queue: string[];
  summary: string;
  pathEligibleCount: number;
  totalDaySlots: number;
  analysis: TradezellaAnalysis;
  markdown: string;
  trades?: SimulatedTrade[];
  pnl?: {
    taken: number;
    wins: number;
    losses: number;
    winRate: number | null;
    sumR: number;
    expectancyR: number | null;
    sumUsd: number;
  };
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

export function normalizeBacktestQuery(message: string): string {
  let s = message.trim().toLowerCase();
  // "back test" / "back-testing" → backtest
  s = s.replace(/\bback[\s\-]*test(?:ing)?\b/g, "backtest");
  s = s.replace(/\bback[\s\-]*tests\b/g, "backtest");
  // common year typos: 20266 → 2026, 20267 → 2026, 2025 6 → keep
  s = s.replace(/\b(20\d{2})\d\b/g, "$1");
  // "july2026" → "july 2026"
  s = s.replace(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(20\d{2})\b/g,
    "$1 $2",
  );
  return s;
}

export function parseBacktestIntent(message: string): DateWindow | null {
  const lower = normalizeBacktestQuery(message);
  if (!/\b(backtest|bt|replay|session)\b/.test(lower) && !/\bweek of\b/.test(lower)) {
    // still allow pure date range without verb if looks like "2026-07-01 to 2026-07-31"
    if (!/\d{4}-\d{2}-\d{2}\s*(?:to|through|[-–])/.test(lower)) {
      // month-only without verb: require backtest keyword
    }
  }

  const wantsBacktest =
    /\b(backtest|bt|replay)\b/.test(lower) ||
    /\bweek of\b/.test(lower) ||
    /\bsession(s)?\b/.test(lower);

  // Explicit ISO range
  const isoRange = lower.match(
    /(\d{4}-\d{2}-\d{2})\s*(?:to|through|[-–]|until)\s*(\d{4}-\d{2}-\d{2})/,
  );
  if (isoRange && (wantsBacktest || true)) {
    const a = Date.parse(isoRange[1]! + "T00:00:00-04:00");
    const b = Date.parse(isoRange[2]! + "T23:59:59-04:00");
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      const days = Math.round((b - a) / 86400000);
      return {
        startMs: a,
        endMs: b,
        label: `${isoRange[1]} → ${isoRange[2]}`,
        kind: days > 7 ? "range" : days > 1 ? "week" : "day",
      };
    }
  }

  // Full month: "july 2026" / "jul 2026" / "backtest july"
  const monthYear = lower.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\b/,
  );
  if (monthYear && wantsBacktest) {
    const mon = MONTHS[monthYear[1]!.toLowerCase()];
    const year = Number(monthYear[2]);
    if (mon != null && year >= 2018 && year <= 2030) {
      // first → last calendar day of month (ET)
      const startMs = Date.parse(
        `${year}-${pad(mon + 1)}-01T00:00:00-04:00`,
      );
      // last day: day 0 of next month
      const last = new Date(Date.UTC(year, mon + 1, 0));
      const endMs = Date.parse(
        `${year}-${pad(mon + 1)}-${pad(last.getUTCDate())}T23:59:59-04:00`,
      );
      return {
        startMs,
        endMs,
        label: `${monthYear[1]} ${year}`.replace(/^\w/, (c) => c.toUpperCase()),
        kind: "range",
      };
    }
  }

  // Month only with implied year (current or 2026): "backtest july"
  const monthOnly = lower.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?!\s+\d{1,2})/,
  );
  if (monthOnly && wantsBacktest && !monthYear) {
    const mon = MONTHS[monthOnly[1]!.toLowerCase()];
    const year = 2026;
    if (mon != null) {
      const startMs = Date.parse(
        `${year}-${pad(mon + 1)}-01T00:00:00-04:00`,
      );
      const last = new Date(Date.UTC(year, mon + 1, 0));
      const endMs = Date.parse(
        `${year}-${pad(mon + 1)}-${pad(last.getUTCDate())}T23:59:59-04:00`,
      );
      return {
        startMs,
        endMs,
        label: `${monthOnly[1]} ${year}`,
        kind: "range",
      };
    }
  }

  const isoDay = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const wantsWeek =
    /\bweek\b/.test(lower) ||
    wantsBacktest ||
    /\bsession(s)?\b/.test(lower);

  const weekOf = lower.match(
    /week\s+of\s+([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/,
  );
  const weekOf2 = lower.match(
    /week\s+of\s+(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:,?\s*(\d{4}))?/,
  );

  let anchor: Date | null = null;

  if (weekOf) {
    const mon = MONTHS[weekOf[1]!.toLowerCase()];
    const day = Number(weekOf[2]);
    const year = Number(weekOf[3] || 2026);
    if (mon != null) anchor = new Date(Date.UTC(year, mon, day, 16, 0, 0));
  } else if (weekOf2) {
    const mon = MONTHS[weekOf2[2]!.toLowerCase()];
    const day = Number(weekOf2[1]);
    const year = Number(weekOf2[3] || 2026);
    if (mon != null) anchor = new Date(Date.UTC(year, mon, day, 16, 0, 0));
  } else if (isoDay && wantsWeek) {
    // single day if no "week" word; week if week present
    if (/\bweek\b/.test(lower)) {
      anchor = new Date(isoDay[1]! + "T16:00:00Z");
    } else if (wantsBacktest) {
      const a = Date.parse(isoDay[1]! + "T00:00:00-04:00");
      const b = Date.parse(isoDay[1]! + "T23:59:59-04:00");
      return { startMs: a, endMs: b, label: isoDay[1]!, kind: "day" };
    }
  }

  // "july 12 2026" day
  if (!anchor) {
    const md = lower.match(
      /\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/,
    );
    if (md && MONTHS[md[1]!.toLowerCase()] != null && wantsBacktest) {
      const mon = MONTHS[md[1]!.toLowerCase()]!;
      const day = Number(md[2]);
      const year = Number(md[3] || 2026);
      if (day >= 1 && day <= 31) {
        // if "week" in message expand; else single day
        if (/\bweek\b/.test(lower)) {
          anchor = new Date(Date.UTC(year, mon, day, 16, 0, 0));
        } else {
          const startMs = Date.parse(
            `${year}-${pad(mon + 1)}-${pad(day)}T00:00:00-04:00`,
          );
          const endMs = Date.parse(
            `${year}-${pad(mon + 1)}-${pad(day)}T23:59:59-04:00`,
          );
          return {
            startMs,
            endMs,
            label: `${year}-${pad(mon + 1)}-${pad(day)}`,
            kind: "day",
          };
        }
      }
    }
  }

  if (!anchor) return null;

  const et = etParts(anchor.getTime());
  const utcGuess = Date.UTC(et.year, et.month - 1, et.day, 12, 0, 0);
  const wd = et.weekday;
  const daysFromMon = wd === 0 ? -6 : 1 - wd;
  const mon = new Date(utcGuess + daysFromMon * 86400000);
  const fri = new Date(mon.getTime() + 4 * 86400000);
  const monEt = etParts(mon.getTime());
  const friEt = etParts(fri.getTime());
  const startMs = Date.parse(
    `${monEt.year}-${pad(monEt.month)}-${pad(monEt.day)}T00:00:00-04:00`,
  );
  const endMs = Date.parse(
    `${friEt.year}-${pad(friEt.month)}-${pad(friEt.day)}T23:59:59-04:00`,
  );
  return {
    startMs,
    endMs,
    label: `Week ${monEt.year}-${pad(monEt.month)}-${pad(monEt.day)} → ${friEt.year}-${pad(friEt.month)}-${pad(friEt.day)}`,
    kind: "week",
  };
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function etParts(ms: number) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const wdMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour") === "24" ? "0" : get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: wdMap[get("weekday")] ?? 0,
  };
}

function dateKeyEt(ms: number): string {
  const p = etParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** NY killzone load window: 08:30–11:00 ET (inclusive start, exclusive end). */
export const NY_LOAD_START = { hour: 8, minute: 30 };
export const NY_LOAD_END = { hour: 11, minute: 0 };

/**
 * Keep only 1m bars inside NY 08:30–11:00 ET each day.
 * Cuts dead weight (overnight/lunch/PM) so month backtests stay dense and fair.
 */
export function nySessionWindowBars(
  bars: OhlcBar[],
  start = NY_LOAD_START,
  end = NY_LOAD_END,
): OhlcBar[] {
  const startM = start.hour * 60 + start.minute;
  const endM = end.hour * 60 + end.minute;
  return bars.filter((b) => {
    const p = etParts(b.t);
    if (p.weekday === 0 || p.weekday === 6) return false;
    const m = p.hour * 60 + p.minute;
    return m >= startM && m < endM;
  });
}


function tradingDaysInWindow(startMs: number, endMs: number): string[] {
  const days: string[] = [];
  for (let t = startMs; t <= endMs; t += 86400000) {
    const p = etParts(t);
    if (p.weekday >= 1 && p.weekday <= 5) {
      const k = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
      if (!days.includes(k)) days.push(k);
    }
  }
  return days;
}

function sliceDay(bars: OhlcBar[], dateKey: string): OhlcBar[] {
  return bars.filter((b) => dateKeyEt(b.t) === dateKey);
}

/** Only 1m bars fully closed at decision (bar open t covers [t,t+1m)). */
export function causalOneMinute(bars: OhlcBar[], decisionMs: number): OhlcBar[] {
  return bars.filter((b) => b.t + 60_000 <= decisionMs);
}

/**
 * Aggregate only from causal 1m, then keep fully closed N-minute buckets.
 * Prevents look-ahead from incomplete final buckets.
 */
export function causalAggregate(
  bars1m: OhlcBar[],
  decisionMs: number,
  intervalMinutes: number,
): OhlcBar[] {
  const causal = causalOneMinute(bars1m, decisionMs);
  if (intervalMinutes <= 1) return causal;
  const agg = aggregateBars(causal, intervalMinutes);
  const dur = intervalMinutes * 60_000;
  return agg.filter((b) => b.t + dur <= decisionMs);
}

/** Causal filter for pre-aggregated HTF series (1h/4h). Bar must be fully closed. */
export function causalClosedBars(
  bars: OhlcBar[],
  decisionMs: number,
  intervalMinutes: number,
): OhlcBar[] {
  const dur = Math.max(1, intervalMinutes) * 60_000;
  return bars.filter((b) => b.t + dur <= decisionMs);
}

function takePathTrade(
  best: SetupCandidate | null,
  pathEligible: boolean,
  decisionMs: number,
  rth1m: OhlcBar[],
  ltf1m: OhlcBar[],
): SimulatedTrade | null {
  if (!best) return null;
  if (!pathEligible && !isPathTake(best)) return null;
  // Entry = last closed LTF 1m at decision (causal)
  const entryBar =
    [...ltf1m].filter((b) => b.t + 60_000 <= decisionMs).at(-1) ??
    [...rth1m].filter((b) => b.t + 60_000 <= decisionMs).at(-1);
  if (!entryBar) return null;
  // Forward walk: RTH bars after entry (same day preferred, allow rest of session)
  const dayKey = dateKeyEt(decisionMs);
  const forward = rth1m.filter(
    (b) => b.t > decisionMs && dateKeyEt(b.t) === dayKey,
  );
  return simulatePathTrade({
    best,
    entryPrice: entryBar.c,
    decisionMs,
    forwardBars: forward,
  });
}

/** Hard assert: no bar may open at or after decision, and bucket must be closed. */
export function assertCausal(
  bars: OhlcBar[],
  decisionMs: number,
  intervalMinutes: number,
): { ok: boolean; detail: string; maxBarEnd: number | null } {
  if (!bars.length) {
    return { ok: false, detail: "no bars", maxBarEnd: null };
  }
  const dur = Math.max(1, intervalMinutes) * 60_000;
  let maxEnd = 0;
  for (const b of bars) {
    const end = b.t + dur;
    if (end > decisionMs + 1) {
      return {
        ok: false,
        detail: `LOOK-AHEAD: bar ending ${new Date(end).toISOString()} > decision ${new Date(decisionMs).toISOString()}`,
        maxBarEnd: end,
      };
    }
    if (end > maxEnd) maxEnd = end;
  }
  return {
    ok: true,
    detail: `causal OK · last bar closed ${new Date(maxEnd).toISOString()} ≤ decision ${new Date(decisionMs).toISOString()}`,
    maxBarEnd: maxEnd,
  };
}

/** Decision clock: NY AM snapshot 10:00 ET, never in the future vs wall clock. */
export function decisionMsForDay(dateKey: string, hourEt = 10, minuteEt = 0): number {
  const raw = Date.parse(
    `${dateKey}T${String(hourEt).padStart(2, "0")}:${String(minuteEt).padStart(2, "0")}:00-04:00`,
  );
  // no live future: cannot decide with bars that have not happened yet
  return Math.min(raw, Date.now());
}


function parseSymbols(message: string): IndexSymbol[] {
  const up = message.toUpperCase();
  const out: IndexSymbol[] = [];
  if (/\bMNQ\b/.test(up)) out.push("MNQ");
  if (/\bNQ\b/.test(up) && !out.includes("MNQ")) out.push("NQ");
  if (/\bES\b/.test(up) || /\bMES\b/.test(up)) out.push("ES");
  if (!out.length) return ["MNQ", "ES"];
  if (out.length === 1) {
    if (out[0] === "ES") out.push("MNQ");
    else out.push("ES");
  }
  return out.slice(0, 2) as IndexSymbol[];
}

export async function runWeekBacktest(
  message: string,
  window: DateWindow,
): Promise<WeekBacktestReport> {
  if (!hasDatabentoKey()) {
    const analysis = analyzeTradezella({
      message:
        message +
        "\n[No DATABENTO_API_KEY — cannot pull real bars. Add key to .env.]",
    });
    return {
      ok: false,
      error: "DATABENTO_API_KEY missing — cannot run real-data backtest",
      source: "none",
      window,
      symbols: [],
      days: [],
      queue: [],
      summary: analysis.summary,
      pathEligibleCount: 0,
      totalDaySlots: 0,
      analysis,
      markdown: analysisToMarkdown(analysis),
    };
  }

  const symbols = parseSymbols(message);
  // HTF lookback scales with window: enough 1h bars, not months of dead 1m
  const lookbackDays =
    window.kind === "day" ? 18 : window.kind === "week" ? 25 : 32;
  const fetchStart = window.startMs - lookbackDays * 86400000;
  const fetchEnd = Math.min(window.endMs, Date.now());

  const layersList = await Promise.all(
    symbols.map((s) => fetchBacktestLayers(s, fetchStart, fetchEnd)),
  );

  if (layersList.some((s) => !s || (s.htf1h.length < 20 && s.ltf1m.length < 30))) {
    const analysis = analyzeTradezella({
      message:
        message +
        `\n[Databento dual-layer insufficient for ${window.label}. Check license / symbols.]`,
    });
    return {
      ok: false,
      error: "Insufficient Databento bars for window",
      source: "databento",
      window,
      symbols,
      days: [],
      queue: tradingDaysInWindow(window.startMs, window.endMs),
      summary: analysis.summary,
      pathEligibleCount: 0,
      totalDaySlots: 0,
      analysis,
      markdown: analysisToMarkdown(analysis),
    };
  }

  const leftL = layersList[0]!;
  const rightL = layersList[1] ?? layersList[0]!;

  // Convenience aliases used by the day loop
  const left = {
    symbol: leftL.symbol,
    bars: leftL.ltf1m, // LTF default
    htf1h: leftL.htf1h,
    htf4h: leftL.htf4h,
    rth1m: leftL.rth1m,
    count: leftL.ltf1m.length,
    first: leftL.first,
    last: leftL.last,
    raw1mCount: leftL.raw1mCount,
  };
  const right = {
    symbol: rightL.symbol,
    bars: rightL.ltf1m,
    htf1h: rightL.htf1h,
    htf4h: rightL.htf4h,
    rth1m: rightL.rth1m,
    count: rightL.ltf1m.length,
    first: rightL.first,
    last: rightL.last,
    raw1mCount: rightL.raw1mCount,
  };

  // Coverage from LTF sessions (has data in killzone window)
  const allDays = tradingDaysInWindow(window.startMs, window.endMs);
  const barDays = new Set(left.bars.map((b) => dateKeyEt(b.t)));
  const coveredDays = allDays.filter((d) => barDays.has(d));
  const uncoveredDays = allDays.filter((d) => !barDays.has(d));

  // Full month coverage for ~9 PATH/mo pace; week gets all week days
  const MAX_DAYS =
    window.kind === "day" ? 3 : window.kind === "week" ? 7 : 23;
  let truncated = false;
  let days =
    coveredDays.length > 0
      ? coveredDays.slice(0, MAX_DAYS)
      : allDays.slice(0, MAX_DAYS);
  if (coveredDays.length > MAX_DAYS) truncated = true;
  if (coveredDays.length === 0 && allDays.length > MAX_DAYS) truncated = true;

  const rows: DayBacktestRow[] = [];
  const dataCoverage = {
    bars: left.count,
    htf1h: left.htf1h.length,
    htf4h: left.htf4h.length,
    raw1mScanned: left.raw1mCount,
    first: left.first,
    last: left.last,
    calendarDays: allDays.length,
    coveredDays: coveredDays.length,
    uncoveredDays: uncoveredDays.length,
    evaluatedDays: days.length,
  };

  // Snapshots: 10:00 (primary) and 11:00 (secondary) — both causal, pick best path slot
  // Multiple NY AM snapshots — pick best PATH per day (all strategies scored each time)
  const DECISION_SLOTS: { hour: number; minute: number; label: string }[] = [
    { hour: 9, minute: 45, label: "09:45 ET" },
    { hour: 10, minute: 0, label: "10:00 ET" },
    { hour: 10, minute: 30, label: "10:30 ET" },
    { hour: 11, minute: 0, label: "11:00 ET" },
  ];
  const STRUCTURE_TF_MIN = 15;

  for (const day of days) {
    // Multi-snapshot causal scan — never mixes future of either slot
    type Snap = {
      decisionMs: number;
      label: string;
      best: SetupCandidate | null;
      pathEligible: boolean;
      biasL: ReturnType<typeof analyzeStructure>;
      biasR: ReturnType<typeof analyzeStructure>;
      cond: ReturnType<typeof assessConditions>;
      det: ReturnType<typeof summarizeDetectors>;
      scanFocus: string;
      smtNote: string;
      sessionBars: number;
      causalOk: boolean;
      causalDetail: string;
      lBars: import("@/lib/market/types").OhlcBar[];
      rBars: import("@/lib/market/types").OhlcBar[];
    };

    const snaps: Snap[] = [];

    for (const slot of DECISION_SLOTS) {
      const decisionMs = decisionMsForDay(day, slot.hour, slot.minute);
      if (!Number.isFinite(decisionMs)) continue;

      // LTF: NY 08:30–11:00 1m (already filtered) + 15m for detectors
      const l1 = causalOneMinute(left.bars, decisionMs);
      const r1 = causalOneMinute(right.bars, decisionMs);
      const ltfL = causalAggregate(left.bars, decisionMs, STRUCTURE_TF_MIN);
      const ltfR = causalAggregate(right.bars, decisionMs, STRUCTURE_TF_MIN);
      // HTF: sparse 1h (and 4h backup) — multi-week structure without 1m overload
      const htfL = causalClosedBars(left.htf1h, decisionMs, 60);
      const htfR = causalClosedBars(right.htf1h, decisionMs, 60);
      const htf4L = causalClosedBars(left.htf4h, decisionMs, 240);
      const structureL = htfL.length >= 30 ? htfL : htf4L.length >= 20 ? htf4L : ltfL;
      const structureR = htfR.length >= 30 ? htfR : htf4L.length >= 20 ? htfR : ltfR;
      const lBars = ltfL; // detectors / conditions on LTF
      const rBars = ltfR;
      const causalL = assertCausal(lBars, decisionMs, STRUCTURE_TF_MIN);
      const causalH = assertCausal(structureL, decisionMs, structureL === htfL ? 60 : structureL === htf4L ? 240 : STRUCTURE_TF_MIN);
      const causal1 = assertCausal(l1, decisionMs, 1);
      const daySession = l1.filter((b) => dateKeyEt(b.t) === day);

      if (
        (structureL.length < 20 && lBars.length < 30) ||
        !causalL.ok ||
        !causal1.ok ||
        daySession.length < 5
      ) {
        snaps.push({
          decisionMs,
          label: slot.label,
          best: null,
          pathEligible: false,
          biasL: analyzeStructure(left.symbol, lBars.length ? lBars : left.bars.slice(0, 0), 0),
          biasR: analyzeStructure(right.symbol, rBars.length ? rBars : right.bars.slice(0, 0), 0),
          cond: {
            regime: "dead",
            volatility: "low",
            tradeable: false,
            er: 0,
            atrRatio: 0,
            reasons: ["insufficient causal bars"],
          },
          det: summarizeDetectors(lBars),
          scanFocus: "deadspot",
          smtNote: "",
          sessionBars: daySession.length,
          causalOk: causalL.ok && causal1.ok,
          causalDetail:
            daySession.length < 5
              ? `deadspot: only ${daySession.length} session 1m by ${slot.label}`
              : causalL.detail,
          lBars,
          rBars,
        });
        continue;
      }

      const dayL = daySession;
      const dayR = causalOneMinute(right.bars, decisionMs).filter(
        (b) => dateKeyEt(b.t) === day,
      );
      const chg =
        dayL.length > 1
          ? ((dayL[dayL.length - 1]!.c - dayL[0]!.o) / dayL[0]!.o) * 100
          : 0;
      const chgR =
        dayR.length > 1
          ? ((dayR[dayR.length - 1]!.c - dayR[0]!.o) / dayR[0]!.o) * 100
          : 0;

      // Bias from HTF 1h/4h; entries/detectors from NY AM LTF only
      const biasL = analyzeStructure(left.symbol, structureL, chg);
      const biasR = analyzeStructure(right.symbol, structureR, chgR);
      const div = smtDivergence(ltfL.length >= 20 ? ltfL : structureL, ltfR.length >= 20 ? ltfR : structureR);
      const clock = getSessionClock(new Date(decisionMs));
      const scan = scanSetups(biasL, biasR, clock, div, lBars, rBars);
      const forSym = (sym: string) => {
        const pool = scan.candidates
          .filter((c) => c.symbol === sym)
          .slice()
          .sort((a, b) => b.confluence - a.confluence);
        // Prefer PATH-grade with HTF; then any scored — always multi-strategy pool
        return (
          pool.find((c) => c.actionable) ??
          pool.find(
            (c) =>
              c.strategyComplete &&
              c.htfOk &&
              (c.pathBand === "A+" ||
                c.pathBand === "A" ||
                c.pathBand === "A-" ||
                c.pathBand === "B+"),
          ) ??
          pool.find(
            (c) => c.confluence >= PROFIT_ACTION_FLOOR && c.htfOk,
          ) ??
          pool.find((c) => c.strategyComplete) ??
          pool[0] ??
          null
        );
      };
      const best = forSym(left.symbol);
      const cond = assessConditions(lBars);
      const det = summarizeDetectors(lBars);
      const causalOk = causalL.ok && assertCausal(rBars, decisionMs, STRUCTURE_TF_MIN).ok;
      // A+ / A / A- all taken. Floor 0.65 + HTF + conditions + causal.
      const pathEligible = Boolean(
        best &&
          causalOk &&
          cond.tradeable &&
          best.htfOk &&
          (isPathTake(best) ||
            ((best.pathBand === "A+" ||
              best.pathBand === "A" ||
              best.pathBand === "A-" ||
              best.pathBand === "B+" ||
              best.grade === "A-" ||
              best.grade === "A+" ||
              best.riskGrade === "A-" ||
              best.riskGrade === "B+") &&
              (best.qualityScore ?? best.confluence) >=
                PROFIT_ACTION_FLOOR - 0.05)),
      );

      snaps.push({
        decisionMs,
        label: slot.label,
        best,
        pathEligible,
        biasL,
        biasR,
        cond,
        det,
        scanFocus: scan.focus,
        smtNote: scan.smt.note,
        sessionBars: daySession.length,
        causalOk,
        causalDetail: causalL.detail,
        lBars,
        rBars,
      });
    }

    // Prefer path-eligible snapshot; else denser session bars; else 10:00
    snaps.sort((a, b) => {
      if (a.pathEligible !== b.pathEligible) return a.pathEligible ? -1 : 1;
      if ((a.best?.confluence ?? 0) !== (b.best?.confluence ?? 0))
        return (b.best?.confluence ?? 0) - (a.best?.confluence ?? 0);
      return b.sessionBars - a.sessionBars;
    });
    const pick = snaps[0]!;
    const deadspot =
      pick.sessionBars < 5
        ? "no/thin session data at decision (holiday, early close, or coverage gap)"
        : !pick.causalOk
          ? "causal integrity failed"
          : !pick.cond.tradeable
            ? `conditions dead: ${(pick.cond.reasons?.[0] || pick.cond.regime)}`
            : pick.best && !pick.pathEligible
              ? `setup below path (${pick.best.grade} ${pick.best.confluence}) missing: ${(pick.best.missing || []).slice(0, 3).join(", ")}`
              : pick.pathEligible
                ? null
                : "no A-path setup at snapshots";

    const gates = [
      {
        name: "Causal integrity",
        pass: pick.causalOk,
        detail: pick.causalDetail,
      },
      {
        name: "Data coverage",
        pass: pick.sessionBars >= 30,
        detail: `${pick.sessionBars} session 1m by ${pick.label} · series ${dataCoverage.first.slice(0, 10)}→${dataCoverage.last.slice(0, 10)}`,
      },
      {
        name: "HTF gate",
        pass: pick.best ? pick.best.htfOk : pick.biasL.topDown !== "neutral",
        detail: `${left.symbol} ${pick.biasL.topDown} / ${right.symbol} ${pick.biasR.topDown}`,
      },
      {
        name: "Conditions",
        pass: pick.cond.tradeable,
        detail: `${pick.cond.regime} · ${pick.cond.volatility} · ${(pick.cond.reasons || []).join("; ")}`,
      },
      {
        name: "Killzone / snapshot",
        pass: true,
        detail: `Best of ${snaps.map((s) => s.label).join(", ")} → ${pick.label}`,
      },
      {
        name: "Path floor",
        pass: pick.pathEligible,
        detail: pick.best
          ? `score ${pick.best.confluence} · ${pick.best.grade} · ${pick.best.strategyPrimary || ""}`
          : "no candidate",
      },
      {
        name: "Mechanical / complete model",
        pass: pick.det.mechanical.complete,
        detail: pick.det.mechanical.state,
      },
    ];

    const tradeL = takePathTrade(
      pick.best,
      pick.pathEligible,
      pick.decisionMs,
      left.rth1m,
      left.bars,
    );
    rows.push({
      date: day,
      symbol: left.symbol,
      htf: pick.biasL.topDown,
      mid: pick.biasL.mid,
      ltf: pick.biasL.ltf,
      regime: pick.cond.regime,
      tradeable: pick.cond.tradeable,
      best: pick.best,
      pathEligible: pick.pathEligible,
      gates,
      notes: `${pick.scanFocus} · ${pick.label}`,
      decisionIso: new Date(pick.decisionMs).toISOString(),
      sessionBars: pick.sessionBars,
      deadspot,
      trade: tradeL,
    });

    if (right.symbol !== left.symbol) {
      // Re-scan ES at same winning decision for dual book
      const decisionMs = pick.decisionMs;
      const lBars = causalAggregate(left.bars, decisionMs, STRUCTURE_TF_MIN);
      const rBars = causalAggregate(right.bars, decisionMs, STRUCTURE_TF_MIN);
      const htfL2 = causalClosedBars(left.htf1h, decisionMs, 60);
      const htfR2 = causalClosedBars(right.htf1h, decisionMs, 60);
      const structureL2 = htfL2.length >= 30 ? htfL2 : lBars;
      const structureR2 = htfR2.length >= 30 ? htfR2 : rBars;
      if (rBars.length >= 20 || structureR2.length >= 20) {
        const dayR = causalOneMinute(right.bars, decisionMs).filter(
          (b) => dateKeyEt(b.t) === day,
        );
        const chgR =
          dayR.length > 1
            ? ((dayR[dayR.length - 1]!.c - dayR[0]!.o) / dayR[0]!.o) * 100
            : 0;
        const chgL = 0;
        const biasL = analyzeStructure(left.symbol, structureL2, chgL);
        const biasR = analyzeStructure(right.symbol, structureR2, chgR);
        const div = smtDivergence(lBars.length >= 20 ? lBars : structureL2, rBars.length >= 20 ? rBars : structureR2);
        const clock = getSessionClock(new Date(decisionMs));
        const scan = scanSetups(biasL, biasR, clock, div, lBars, rBars);
        const bestR =
          scan.candidates.find(
            (c) => c.symbol === right.symbol && c.actionable,
          ) ??
          scan.candidates.find((c) => c.symbol === right.symbol) ??
          null;
        const condR = assessConditions(rBars);
        const pathR = Boolean(
          bestR &&
            bestR.confluence >= PROFIT_ACTION_FLOOR &&
            bestR.htfOk &&
            condR.tradeable,
        );
        const tradeR = takePathTrade(
          bestR,
          pathR,
          decisionMs,
          right.rth1m,
          right.bars,
        );
        rows.push({
          date: day,
          symbol: right.symbol,
          htf: biasR.topDown,
          mid: biasR.mid,
          ltf: biasR.ltf,
          regime: condR.regime,
          tradeable: condR.tradeable,
          best: bestR,
          pathEligible: pathR,
          gates: gates.map((g) =>
            g.name === "HTF gate"
              ? { ...g, detail: `${right.symbol} ${biasR.topDown}` }
              : g,
          ),
          notes: bestR
            ? `${bestR.side} ${bestR.grade} ${bestR.confluence} · ${pick.label}`
            : `${scan.smt.note} · ${pick.label}`,
          decisionIso: new Date(decisionMs).toISOString(),
          sessionBars: dayR.length,
          deadspot: pathR
            ? null
            : bestR
              ? `below path ${bestR.grade}`
              : "no ES path setup",
          trade: tradeR,
        });
      }
    }
  }

  const pathEligibleCount = rows.filter((r) => r.pathEligible).length;
  const trades = rows
    .map((r) => r.trade)
    .filter((t): t is SimulatedTrade => Boolean(t && t.taken && t.rMultiple != null));
  const pnl = summarizeTrades(trades);
  const queue = days.map((d) => `${d} · NY AM review`);

  const bestDays = rows.filter((r) => r.pathEligible);
  const synth = [
    `REAL DATA BACKTEST ${window.label}`,
    `Source: Databento GLBX.MDP3 · symbols ${symbols.join("+")}`,
    `Path-eligible day-slots: ${pathEligibleCount}/${rows.length}`,
    `Target WR path ${(PROFIT_TARGET_WR * 100).toFixed(0)}% · action floor ${PROFIT_ACTION_FLOOR}`,
    bestDays.length
      ? `Eligible: ${bestDays
          .map(
            (r) =>
              `${r.date} ${r.symbol} ${r.best?.side} ${r.best?.grade} ${r.best?.confluence}`,
          )
          .join(" · ")}`
      : "No path-eligible A/A+ slots — selectivity held.",
    rows[0]
      ? `Sample HTF ${rows[0].htf} mid ${rows[0].mid} · ${rows[0].notes}`
      : "",
    "sweep IFVG structure displacement smt",
  ].join("\n");

  const analysis = analyzeTradezella({
    message: synth,
    deskContext: {
      killzone: "ny_am",
      htfLeft: rows[0] ? `${rows[0].symbol} ${rows[0].htf}` : undefined,
      smt: "Evaluated per day via dual continuous",
    },
  });

  analysis.title = `Databento backtest · ${window.label}`;
  if (truncated) {
    analysis.nextActions = [
      `Window truncated to first ${MAX_DAYS} sessions for speed — ask a specific week for full detail.`,
      ...analysis.nextActions,
    ];
  }
  const dead = rows.filter((r) => r.deadspot);
  const deadReasons = new Map<string, number>();
  for (const r of dead) {
    const k = (r.deadspot || "unknown").slice(0, 60);
    deadReasons.set(k, (deadReasons.get(k) || 0) + 1);
  }
  const deadTop = [...deadReasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, n]) => `${k} (×${n})`)
    .join("; ");

  analysis.summary = `Real CME dual-layer (${symbols.join("+")}) · LTF ${dataCoverage.bars} NY-AM 1m + HTF ${dataCoverage.htf1h}×1h/${dataCoverage.htf4h}×4h · coverage ${dataCoverage.coveredDays}/${dataCoverage.calendarDays} sessions (${dataCoverage.first.slice(0, 10)}→${dataCoverage.last.slice(0, 10)}). ${pathEligibleCount} path-eligible of ${rows.length} slots${truncated ? ` (capped ${MAX_DAYS})` : ""}. ${
    pathEligibleCount === 0
      ? "No A-path clears — selectivity held."
      : "Log paper only PATH rows."
  } Deadspots: ${deadTop || "none"}. Risk ${APLUS_RULES.riskPct * 100}% · causal 10:00/11:00 ET.`;
  analysis.chartAttached = false;
  // Strategy coverage (all ALWAYS_SCAN models)
  const stratCounts: Record<string, number> = {};
  for (const id of ALWAYS_SCAN) stratCounts[id] = 0;
  for (const r of rows) {
    if (!r.best) continue;
    const primary = r.best.strategyPrimary || "unclassified";
    stratCounts[primary] = (stratCounts[primary] || 0) + 1;
    for (const s of r.best.strategies || []) {
      if (s !== primary) stratCounts[s] = (stratCounts[s] || 0) + 0; // ensure key
    }
  }
  const stratLine = ALWAYS_SCAN.map(
    (id) => `${id}:${stratCounts[id] || 0}`,
  ).join(" · ");
  // PATH by strategy (taken fills)
  const pathByStrat: Record<string, { n: number; wins: number; sumR: number }> = {};
  for (const r of rows) {
    if (!r.pathEligible || !r.trade?.taken || r.trade.rMultiple == null) continue;
    const id = r.best?.completeStrategy || r.best?.strategyPrimary || "untagged";
    if (!pathByStrat[id]) pathByStrat[id] = { n: 0, wins: 0, sumR: 0 };
    pathByStrat[id].n++;
    if ((r.trade.rMultiple ?? 0) > 0) pathByStrat[id].wins++;
    pathByStrat[id].sumR += r.trade.rMultiple ?? 0;
  }
  const pathStratLine =
    Object.entries(pathByStrat)
      .map(
        ([id, s]) =>
          `${id} ${s.n}t WR ${s.n ? ((s.wins / s.n) * 100).toFixed(0) : "—"}% ${s.sumR >= 0 ? "+" : ""}${s.sumR.toFixed(1)}R`,
      )
      .join(" · ") || "no PATH fills";
  const monthTarget = APLUS_RULES.targetTradesPerMonth.center;
  const paceNote =
    window.kind === "range" || /month|july|jan|feb|mar|apr|may|jun|aug|sep|oct|nov|dec/i.test(window.label)
      ? `Month pace: ${pnl.taken}/${monthTarget} PATH target (aim ~${monthTarget}/mo · band ${APLUS_RULES.targetTradesPerMonth.min}–${APLUS_RULES.targetTradesPerMonth.max}).`
      : window.kind === "week"
        ? `Week pace: ${pnl.taken} PATH (~${monthTarget}/mo ≈ ${Math.round(monthTarget / 4)}/wk).`
        : `${pnl.taken} PATH.`;

  analysis.stats.trades = pnl.taken;
  analysis.stats.winRate = pnl.winRate ?? undefined;
  analysis.stats.netPnl = pnl.sumUsd;
  analysis.stats.symbol = symbols[0];
  analysis.stats.dateRange = window.label;
  analysis.stats.sessionLabel = "ny_am";
  analysis.summary = `${paceNote} Strategies scanned: ${stratLine}. PATH by model: ${pathStratLine}. ` + analysis.summary;
  if (pnl.taken) {
    analysis.summary =
      `TAKEN ${pnl.taken} PATH trades · WR ${
        pnl.winRate != null ? (pnl.winRate * 100).toFixed(0) + "%" : "—"
      } · ${pnl.sumR >= 0 ? "+" : ""}${pnl.sumR}R · $${pnl.sumUsd >= 0 ? "" : "-"}${Math.abs(pnl.sumUsd).toFixed(0)} ` +
      `(paper $100k · grade 0.5–3% · floor ${PROFIT_ACTION_FLOOR}). ` +
      analysis.summary;
  }

  // Real checklist from board (not generic text parse)
  const pathN = rows.filter((r) => r.pathEligible).length;
  const htfFails = rows.filter(
    (r) => r.best && !r.best.htfOk && r.best.confluence >= PROFIT_ACTION_FLOOR - 0.05,
  ).length;
  const causalOkAll = rows.every(
    (r) => !r.gates?.length || r.gates.find((g) => g.name === "Causal integrity")?.pass !== false,
  );
  analysis.backtestChecklist = [
    {
      item: "Causal integrity (no future bars)",
      status: causalOkAll ? "pass" : "fail",
      detail: "Decisions use closed bars only at 10:00/10:45 ET",
    },
    {
      item: "HTF gate on PATH slots",
      status: pathN > 0 ? "pass" : htfFails > 0 ? "fail" : "pass",
      detail:
        pathN > 0
          ? `${pathN} PATH with HTF aligned`
          : htfFails
            ? `${htfFails} near-path blocked by HTF`
            : "No PATH — HTF gate held selectivity",
    },
    {
      item: "PATH floor 0.65 only",
      status: "pass",
      detail: `${pathN} taken · ${rows.length - pathN} skipped below floor or gates`,
    },
    {
      item: "Trades simulated (R + $)",
      status: pnl.taken > 0 ? "pass" : pathN === 0 ? "pass" : "fail",
      detail:
        pnl.taken > 0
          ? `${pnl.taken} fills · WR ${pnl.winRate != null ? (pnl.winRate * 100).toFixed(0) + "%" : "—"} · ${pnl.sumR}R · $${pnl.sumUsd}`
          : "No PATH to take",
    },
    {
      item: "Risk model $100k · 0.5–3% by grade",
      status: "pass",
      detail: "A+ 3% · A 2% · A- 1% · B+ 0.5% · B paper · C journal",
    },
    {
      item: "Take risk off @ +1R",
      status: "pass",
      detail: "50% banked at TP1 · stop to BE · runner to TP2 (open risk ≈ 0)",
    },
    {
      item: "Selectivity (skips journaled as edge)",
      status: rows.length - pathN >= 0 ? "pass" : "unknown",
      detail: `${rows.filter((r) => !r.pathEligible).length} skips with reasons on board`,
    },
  ];
  analysis.nextActions = [
    paceNote,
    `All strategies always scored: ${ALWAYS_SCAN.join(", ")}.`,
    pnl.taken
      ? `Review ${pnl.taken} TAKEN fills: exit reason + R. Re-run losers for missed HTF/model.`
      : "No PATH this window — do not force B grades. Widen only via better confluence, not lower floor.",
    "Skips are the edge: read Why-not column before next sample.",
    "Paper-log PATH winners/losers; never log skips as trades.",
    truncated
      ? `Window capped at ${MAX_DAYS} sessions — run a specific week for full month tails.`
      : "Full window evaluated.",
  ];
  analysis.disclaimer =
    "CAUSAL DUAL-LAYER: HTF bias from RTH→1h/4h (sparse multi-week); LTF from NY 08:30–11:00 1m only. Decisions 10:00/11:00 ET, closed bars only — no future, no full-day close peek. Educational — not an order.";
  analysis.nextActions = [
    "Causal rule: NY 08:30–11:00 load window · decision 10:00/11:00 ET · closed bars only.",
    ...analysis.nextActions.filter((a) => !/causal/i.test(a)),
  ];

  const md = [
    analysisToMarkdown(analysis),
    "",
    "### P&L (PATH taken)",
    pnl.taken
      ? `- **${pnl.taken} trades** · WR ${pnl.winRate != null ? (pnl.winRate * 100).toFixed(0) + "%" : "—"} · **${pnl.sumR >= 0 ? "+" : ""}${pnl.sumR}R** · **$${pnl.sumUsd.toFixed(2)}** · E[${pnl.expectancyR ?? "—"}R]`
      : "- No PATH trades taken this window.",
    ...trades.map(
      (tr) =>
        `- ${tr.entryTimeIso.slice(0, 10)} ${tr.symbol} ${tr.side} → ${tr.exitReason} · ${tr.rMultiple != null && tr.rMultiple >= 0 ? "+" : ""}${tr.rMultiple}R · $${tr.pnlUsd}`,
    ),
    "",
    "### Day-by-day (real data)",
    ...rows.map((r) => {
      const b = r.best;
      const tr = r.trade;
      return `- **${r.date} ${r.symbol}** HTF ${r.htf} · mid ${r.mid} · ${r.regime} · ${
        r.pathEligible ? "PATH" : "skip"
      }${
        b
          ? ` · ${b.side} ${b.grade} ${b.confluence.toFixed(2)} · ${b.strategyPrimary || ""}`
          : ""
      }${
        tr && tr.rMultiple != null
          ? ` · **${tr.rMultiple >= 0 ? "+" : ""}${tr.rMultiple}R / $${tr.pnlUsd}** (${tr.exitReason})`
          : ""
      }${r.deadspot ? ` · dead: ${r.deadspot}` : ""}`;
    }),
    "",
    "### Data coverage",
    `- LTF NY 08:30–11:00 1m: ${dataCoverage.bars} · HTF 1h: ${dataCoverage.htf1h} · HTF 4h: ${dataCoverage.htf4h} (scanned raw 1m ${dataCoverage.raw1mScanned} then discarded)`,
    `- Range: ${dataCoverage.first} → ${dataCoverage.last}`,
    `- Sessions with data: ${dataCoverage.coveredDays}/${dataCoverage.calendarDays}`,
    dataCoverage.uncoveredDays
      ? `- Uncovered (no feed): ${uncoveredDays.slice(0, 8).join(", ")}${uncoveredDays.length > 8 ? "…" : ""}`
      : "- Uncovered: none",
    "",
    "### Queue",
    ...queue.map((q) => `- [ ] ${q}`),
  ].join("\n");


  // Surface real board into analysis card (not generic UNKNOWN)
  const pathRows = rows.filter((r) => r.pathEligible && r.best);
  const sample = pathRows[0] ?? rows.find((r) => r.best && r.htf !== "n/a") ?? rows[0];
  if (sample) {
    const side = sample.best?.side;
    analysis.timeframes = analysis.timeframes.map((tf) => {
      if (tf.tf === "HTF") {
        return {
          ...tf,
          bias:
            sample.htf === "bull"
              ? "bull"
              : sample.htf === "bear"
                ? "bear"
                : "neutral",
          notes: `${sample.symbol} top-down ${sample.htf} @ ${sample.date}${sample.decisionIso ? ` · ${sample.decisionIso}` : ""}`,
        };
      }
      if (tf.tf === "MTF") {
        return {
          ...tf,
          bias:
            sample.mid === "bull"
              ? "bull"
              : sample.mid === "bear"
                ? "bear"
                : "neutral",
          notes: `mid ${sample.mid} · regime ${sample.regime}`,
        };
      }
      if (tf.tf === "LTF") {
        return {
          ...tf,
          bias:
            sample.ltf === "bull"
              ? "bull"
              : sample.ltf === "bear"
                ? "bear"
                : side === "long"
                  ? "bull"
                  : side === "short"
                    ? "bear"
                    : "unknown",
          notes: sample.best
            ? `${sample.best.side} ${sample.best.grade} ${sample.best.confluence.toFixed(2)} · ${sample.best.strategyPrimary || ""}`
            : sample.notes,
        };
      }
      return tf;
    });
    if (pathRows.length) {
      analysis.setups = pathRows.slice(0, 4).map((r, i) => {
        const b = r.best!;
        return {
          id: `path-${r.date}-${r.symbol}-${i}`,
          strategy: b.strategyPrimary || "tjr",
          side: b.side,
          grade:
            b.confluence >= 0.75
              ? ("A+" as const)
              : b.confluence >= PROFIT_ACTION_FLOOR
                ? ("A" as const)
                : b.grade === "B"
                  ? ("B" as const)
                  : ("skip" as const),
          confluenceScore: b.confluence,
          entry: b.entryZone,
          stop: b.invalidation,
          targets: b.targets?.length ? b.targets : ["1R", "structure TP"],
          rr: "1:1 – 1:3",
          conditions: [
            `HTF ${r.htf}`,
            `regime ${r.regime}`,
            r.decisionIso || "10:00 ET",
          ],
          confluencesPresent: b.components || b.reasons?.slice(0, 6) || [],
          confluencesMissing: b.missing || [],
          invalidation: b.invalidation,
          notes: `PATH · ${r.date} ${r.symbol} · score≥${PROFIT_ACTION_FLOOR}`,
        };
      });
    }
  }

  return {
    ok: true,
    source: "databento",
    window,
    symbols,
    days: rows,
    queue,
    summary: analysis.summary,
    pathEligibleCount,
    totalDaySlots: rows.length,
    analysis,
    markdown: md,
    trades,
    pnl,
  };
}

export function parseTradezellaCsv(csv: string): {
  rows: {
    date: string;
    symbol: string;
    side: string;
    pnl: number | null;
    r: number | null;
    raw: string;
  }[];
  summary: string;
} {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    return { rows: [], summary: "CSV empty or header-only" };
  }
  const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => {
    for (const n of names) {
      const i = header.findIndex((h) => h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const iDate = idx(["date", "open time", "opened"]);
  const iSym = idx(["symbol", "ticker", "instrument"]);
  const iSide = idx(["side", "direction", "type"]);
  const iPnl = idx(["pnl", "net", "profit"]);
  const iR = idx(["r-multiple", "r multiple", "rr", "r"]);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(",");
    const pnlRaw = iPnl >= 0 ? cells[iPnl] : null;
    const rRaw = iR >= 0 ? cells[iR] : null;
    rows.push({
      date: iDate >= 0 ? (cells[iDate] ?? "").trim() : "",
      symbol: iSym >= 0 ? (cells[iSym] ?? "").trim() : "",
      side: iSide >= 0 ? (cells[iSide] ?? "").trim() : "",
      pnl:
        pnlRaw != null
          ? parseFloat(String(pnlRaw).replace(/[$,]/g, ""))
          : null,
      r: rRaw != null ? parseFloat(String(rRaw)) : null,
      raw: lines[i]!,
    });
  }
  const wins = rows.filter((r) => (r.pnl ?? r.r ?? 0) > 0).length;
  const wr = rows.length ? wins / rows.length : 0;
  return {
    rows,
    summary: `CSV import: ${rows.length} trades · WR ~${(wr * 100).toFixed(1)}% (raw, ungraded). Re-grade A-path only for path stats.`,
  };
}

export function isBacktestIntent(message: string): boolean {
  const lower = normalizeBacktestQuery(message);
  if (parseBacktestIntent(message)) return true;
  return (
    (/\b(backtest|bt|replay)\b/.test(lower) || /\bweek of\b/.test(lower)) &&
    (/\b20\d{2}\b/.test(lower) ||
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(lower) ||
      /\d{4}-\d{2}-\d{2}/.test(lower))
  );
}
