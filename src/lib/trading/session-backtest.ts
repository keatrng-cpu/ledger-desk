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

export function parseBacktestIntent(message: string): DateWindow | null {
  const lower = message.trim().toLowerCase();

  const isoRange = lower.match(
    /(\d{4}-\d{2}-\d{2})\s*(?:to|through|[-–]|until)\s*(\d{4}-\d{2}-\d{2})/,
  );
  if (isoRange) {
    const a = Date.parse(isoRange[1]! + "T00:00:00-04:00");
    const b = Date.parse(isoRange[2]! + "T23:59:59-04:00");
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      return {
        startMs: a,
        endMs: b,
        label: `${isoRange[1]} → ${isoRange[2]}`,
        kind: "range",
      };
    }
  }

  const isoDay = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const wantsWeek =
    /\bweek\b/.test(lower) ||
    /\bbacktest\b/.test(lower) ||
    /\bbt\b/.test(lower) ||
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
    anchor = new Date(isoDay[1]! + "T16:00:00Z");
  } else if (/\b(backtest|bt|analyze)\b/.test(lower) && isoDay) {
    const a = Date.parse(isoDay[1]! + "T00:00:00-04:00");
    const b = Date.parse(isoDay[1]! + "T23:59:59-04:00");
    return { startMs: a, endMs: b, label: isoDay[1]!, kind: "day" };
  }

  if (!anchor) {
    const md = lower.match(
      /\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/,
    );
    if (md && MONTHS[md[1]!.toLowerCase()] != null && wantsWeek) {
      const mon = MONTHS[md[1]!.toLowerCase()]!;
      const day = Number(md[2]);
      const year = Number(md[3] || 2026);
      anchor = new Date(Date.UTC(year, mon, day, 16, 0, 0));
    }
  }

  if (!anchor || !wantsWeek) return null;

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
  const fetchEnd = window.endMs;

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
  const days = tradingDaysInWindow(window.startMs, window.endMs);
  const rows: DayBacktestRow[] = [];

  const left15 = { ...left, bars: aggregateBars(left.bars, 15) };
  const right15 = { ...right, bars: aggregateBars(right.bars, 15) };

  for (const day of days) {
    const cutoff = Date.parse(`${day}T17:00:00-04:00`);
    const lBars = left15.bars.filter((b) => b.t <= cutoff);
    const rBars = right15.bars.filter((b) => b.t <= cutoff);
    if (lBars.length < 40) {
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
        gates: [{ name: "data", pass: false, detail: "too few bars" }],
        notes: "Insufficient history",
      });
      continue;
    }

    const dayL = sliceDay(left.bars, day);
    const chg =
      dayL.length > 1
        ? ((dayL[dayL.length - 1]!.c - dayL[0]!.o) / dayL[0]!.o) * 100
        : 0;
    const dayR = sliceDay(right.bars, day);
    const chgR =
      dayR.length > 1
        ? ((dayR[dayR.length - 1]!.c - dayR[0]!.o) / dayR[0]!.o) * 100
        : 0;

    const biasL = analyzeStructure(left.symbol, lBars, chg);
    const biasR = analyzeStructure(right.symbol, rBars, chgR);
    const div = smtDivergence(lBars, rBars);
    const nyAmMs = Date.parse(`${day}T10:00:00-04:00`);
    const clock = getSessionClock(new Date(nyAmMs));
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
        detail: "Evaluated at 10:00 ET snapshot",
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

    rows.push({
      date: day,
      symbol: left.symbol,
      htf: biasL.topDown,
      mid: biasL.mid,
      ltf: biasL.ltf,
      regime: cond.regime,
      tradeable: cond.tradeable,
      best,
      pathEligible: Boolean(best?.actionable),
      gates,
      notes: scan.focus,
    });

    if (right.symbol !== left.symbol) {
      const bestR =
        scan.candidates.find(
          (c) =>
            c.symbol === right.symbol &&
            (c.actionable || c.grade !== "skip"),
        ) ?? null;
      const condR = assessConditions(rBars);
      rows.push({
        date: day,
        symbol: right.symbol,
        htf: biasR.topDown,
        mid: biasR.mid,
        ltf: biasR.ltf,
        regime: condR.regime,
        tradeable: condR.tradeable,
        best: bestR,
        pathEligible: Boolean(bestR?.actionable),
        gates: gates.map((g) =>
          g.name === "HTF gate"
            ? { ...g, detail: `${right.symbol} ${biasR.topDown}` }
            : g,
        ),
        notes: bestR
          ? `${bestR.side} ${bestR.grade} ${bestR.confluence}`
          : scan.smt.note,
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
  analysis.summary = `Real CME data (${symbols.join("+")}). ${pathEligibleCount} path-eligible slot(s) of ${rows.length}. ${
    pathEligibleCount === 0
      ? "No A-path setups cleared — correct for selectivity."
      : "Review eligible days; Log paper only those grades."
  } Risk ${APLUS_RULES.riskPct * 100}% · max ${APLUS_RULES.maxSetupsPerSession}/KZ.`;
  analysis.chartAttached = false;
  analysis.stats.trades = pathEligibleCount;
  analysis.stats.symbol = symbols[0];
  analysis.stats.dateRange = window.label;
  analysis.stats.sessionLabel = "ny_am";

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
  const lower = message.toLowerCase();
  if (parseBacktestIntent(message)) return true;
  return (
    (/\b(backtest|bt)\b/.test(lower) || /\bweek of\b/.test(lower)) &&
    (/\b20\d{2}\b/.test(lower) ||
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(lower) ||
      /\d{4}-\d{2}-\d{2}/.test(lower))
  );
}
