/**
 * Real-data session / week backtests via Databento + desk detectors.
 * Natural-language intent: "backtest week of May 12 2026", etc.
 */

import {
  fetchDatabentoAbsoluteRange,
  aggregateBars,
  hasDatabentoKey,
} from "@/lib/market/databento";
import type { IndexSymbol, OhlcBar } from "@/lib/market/types";
import { analyzeStructure, smtDivergence } from "./structure";
import { summarizeDetectors } from "./detectors";
import { assessConditions } from "./conditions";
import { getSessionClock } from "./sessions";
import { scanSetups, type SetupCandidate } from "./scanner";
import {
  analyzeTradezella,
  analysisToMarkdown,
  type TradezellaAnalysis,
} from "./tradezella-analyze";
import { PROFIT_ACTION_FLOOR, PROFIT_TARGET_WR } from "./profit-path";
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
  const fetchStart = window.startMs - 21 * 86400000;
  // Never pull pure-future range past wall clock (no cheating with unreleased bars)
  const fetchEnd = Math.min(window.endMs, Date.now());

  const seriesList = await Promise.all(
    symbols.map((s) => fetchDatabentoAbsoluteRange(s, fetchStart, fetchEnd, 1)),
  );

  if (seriesList.some((s) => !s || s.bars.length < 50)) {
    const analysis = analyzeTradezella({
      message:
        message +
        `\n[Databento returned insufficient bars for ${window.label}. Check license window / symbols.]`,
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

  const left = seriesList[0]!;
  const right = seriesList[1] ?? seriesList[0]!;
  let days = tradingDaysInWindow(window.startMs, window.endMs);
  const MAX_DAYS = 12;
  let truncated = false;
  if (days.length > MAX_DAYS) {
    days = days.slice(0, MAX_DAYS);
    truncated = true;
  }
  const rows: DayBacktestRow[] = [];

  // Do NOT pre-aggregate the full month then peek — rebuild causal series per day.
  const DECISION_HOUR_ET = 10; // NY AM snapshot — only info available at 10:00 ET
  const STRUCTURE_TF_MIN = 15;

  for (const day of days) {
    let decisionMs = decisionMsForDay(day, DECISION_HOUR_ET, 0);
    // If decision is before market data (weekend/holiday weirdness), skip
    if (!Number.isFinite(decisionMs)) continue;

    const l1 = causalOneMinute(left.bars, decisionMs);
    const r1 = causalOneMinute(right.bars, decisionMs);
    const lBars = causalAggregate(left.bars, decisionMs, STRUCTURE_TF_MIN);
    const rBars = causalAggregate(right.bars, decisionMs, STRUCTURE_TF_MIN);

    const causalL = assertCausal(lBars, decisionMs, STRUCTURE_TF_MIN);
    const causalR = assertCausal(rBars, decisionMs, STRUCTURE_TF_MIN);
    const causal1 = assertCausal(l1, decisionMs, 1);

    if (lBars.length < 40 || !causalL.ok || !causal1.ok) {
      rows.push({
        date: day,
        symbol: left.symbol,
        htf: "n/a",
        mid: "n/a",
        ltf: "n/a",
        regime: "n/a",
        tradeable: false,
        best: null,
        pathEligible: false,
        gates: [
          {
            name: "Causal integrity",
            pass: causalL.ok && causal1.ok,
            detail: causalL.ok ? causal1.detail : causalL.detail,
          },
          { name: "data", pass: false, detail: "too few causal bars at decision" },
        ],
        notes: "Insufficient causal history (no future data used)",
      });
      continue;
    }

    // Session change ONLY using bars closed by decision (not full-day close)
    const dayL = l1.filter((b) => dateKeyEt(b.t) === day);
    const dayR = r1.filter((b) => dateKeyEt(b.t) === day);
    const chg =
      dayL.length > 1
        ? ((dayL[dayL.length - 1]!.c - dayL[0]!.o) / dayL[0]!.o) * 100
        : 0;
    const chgR =
      dayR.length > 1
        ? ((dayR[dayR.length - 1]!.c - dayR[0]!.o) / dayR[0]!.o) * 100
        : 0;

    const biasL = analyzeStructure(left.symbol, lBars, chg);
    const biasR = analyzeStructure(right.symbol, rBars, chgR);
    const div = smtDivergence(lBars, rBars);
    const clock = getSessionClock(new Date(decisionMs));
    // scan/detectors/conditions — same causal bars only
    const scan = scanSetups(biasL, biasR, clock, div, lBars, rBars);
    const best =
      scan.candidates.find((c) => c.actionable) ??
      scan.candidates.find((c) => c.grade === "A+" || c.grade === "A-") ??
      scan.candidates[0] ??
      null;

    const cond = assessConditions(lBars);
    const det = summarizeDetectors(lBars);

    const gates = [
      {
        name: "Causal integrity",
        pass: causalL.ok && causalR.ok && causal1.ok,
        detail: `${causalL.detail} · no bar after ${new Date(decisionMs).toISOString()}`,
      },
      {
        name: "HTF gate",
        pass: best ? best.htfOk : biasL.topDown !== "neutral",
        detail: `${left.symbol} ${biasL.topDown} / ${right.symbol} ${biasR.topDown}`,
      },
      {
        name: "Conditions",
        pass: cond.tradeable,
        detail: `${cond.regime} · ${cond.volatility}`,
      },
      {
        name: "Killzone NY",
        pass: true,
        detail: `Decision ${DECISION_HOUR_ET}:00 ET · closed bars only`,
      },
      {
        name: "Path floor",
        pass: best
          ? best.confluence >= PROFIT_ACTION_FLOOR && best.actionable
          : false,
        detail: best ? `score ${best.confluence} · ${best.grade}` : "no candidate",
      },
      {
        name: "Mechanical / complete model",
        pass: det.mechanical.complete,
        detail: det.mechanical.state,
      },
    ];

    // If causal integrity fails, force non-actionable
    const pathEligible =
      Boolean(best?.actionable) && causalL.ok && causalR.ok && causal1.ok;

    rows.push({
      date: day,
      symbol: left.symbol,
      htf: biasL.topDown,
      mid: biasL.mid,
      ltf: biasL.ltf,
      regime: cond.regime,
      tradeable: cond.tradeable,
      best: pathEligible || best ? best : best,
      pathEligible,
      gates,
      notes: `${scan.focus} · decision ${new Date(decisionMs).toISOString()}`,
    });

    if (right.symbol !== left.symbol) {
      const bestR =
        scan.candidates.find(
          (c) =>
            c.symbol === right.symbol &&
            (c.actionable || c.grade !== "skip"),
        ) ?? null;
      const condR = assessConditions(rBars);
      const pathR =
        Boolean(bestR?.actionable) && causalL.ok && causalR.ok;
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
          ? `${bestR.side} ${bestR.grade} ${bestR.confluence} · causal`
          : `${scan.smt.note} · causal`,
      });
    }
  }

  const pathEligibleCount = rows.filter((r) => r.pathEligible).length;
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
  analysis.summary = `Real CME data (${symbols.join("+")}). ${pathEligibleCount} path-eligible slot(s) of ${rows.length}${truncated ? ` (first ${MAX_DAYS} sessions)` : ""}. ${
    pathEligibleCount === 0
      ? "No A-path setups cleared — correct for selectivity."
      : "Review eligible days; Log paper only those grades."
  } Risk ${APLUS_RULES.riskPct * 100}% · max ${APLUS_RULES.maxSetupsPerSession}/KZ.`;
  analysis.chartAttached = false;
  analysis.stats.trades = pathEligibleCount;
  analysis.stats.symbol = symbols[0];
  analysis.stats.dateRange = window.label;
  analysis.stats.sessionLabel = "ny_am";
  analysis.disclaimer =
    "CAUSAL BACKTEST: each day decides at 10:00 ET using only bars fully closed by then. No same-day close, no future sessions, no incomplete buckets. Educational — not an order.";
  analysis.nextActions = [
    "Causal rule: decision 10:00 ET · closed 1m/15m only · no full-day close peek.",
    ...analysis.nextActions.filter((a) => !/causal/i.test(a)),
  ];

  const md = [
    analysisToMarkdown(analysis),
    "",
    "### Day-by-day (real data)",
    ...rows.map((r) => {
      const b = r.best;
      return `- **${r.date} ${r.symbol}** HTF ${r.htf} · mid ${r.mid} · ${r.regime} · ${
        r.pathEligible ? "PATH" : "skip"
      }${
        b
          ? ` · ${b.side} ${b.grade} ${b.confluence.toFixed(2)} · ${b.strategyPrimary || ""}`
          : ""
      }`;
    }),
    "",
    "### Queue",
    ...queue.map((q) => `- [ ] ${q}`),
  ].join("\n");

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
