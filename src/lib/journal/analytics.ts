/**
 * Profitability analytics — pure, deterministic, no I/O.
 *
 * The journal answers "what did I trade". This answers the questions that
 * actually change behaviour:
 *   - Is my pre-score predictive at all? (expectancy by score bucket)
 *   - Which killzone am I actually good in, vs which one I *think* I'm good in?
 *   - Which instrument earns its screen space?
 *   - Am I bleeding on a specific weekday / after a loss (tilt)?
 *   - Where does the equity curve actually turn?
 *
 * LIVE AND PAPER ARE NEVER MIXED. Every function here takes an already
 * mode-filtered trade list, and the server fn runs each aggregate once per
 * mode. Blending a clean paper sample into a live record would manufacture
 * exactly the false confidence this whole desk exists to prevent.
 *
 * Sample-size honesty: every bucket carries its own `n`, and `MIN_MEANINGFUL_N`
 * marks which rows are too thin to read. A 100%-win-rate cell built on n=2 is
 * noise, and the UI must render it as such.
 */

import type { ClosedTrade, Metrics } from "@/lib/aplus/analytics";
import { computeMetrics } from "@/lib/aplus/analytics";

/**
 * A closed trade plus the desk context needed to slice it. `ClosedTrade`
 * (the engine-ported metrics shape) has no killzone/grade — those are desk
 * columns on `desk_trades`, so they are added here rather than widened into
 * the engine port.
 */
export interface AnalyticsTrade extends ClosedTrade {
  killzone?: string | null;
  grade?: string | null;
}

/** Below this, a bucket's win rate / expectancy is noise, not signal. */
export const MIN_MEANINGFUL_N = 20;

/** Full statistical sample per the engine's own standard. */
export const STATISTICALLY_MEANINGFUL_N = 100;

export interface Bucket {
  key: string;
  label: string;
  n: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  /** Mean R per trade — the number that actually compounds. */
  expectancyR: number;
  avgWinR: number;
  avgLossR: number;
  profitFactor: number | null;
  /** True when n is large enough to read without fooling yourself. */
  meaningful: boolean;
}

export interface StreakInfo {
  currentType: "win" | "loss" | "none";
  currentLength: number;
  longestWin: number;
  longestLoss: number;
  /**
   * Expectancy on the trade taken IMMEDIATELY AFTER a loss vs overall.
   * A materially worse number here is revenge-trading / tilt, and it is the
   * single most common way a positive-edge system still loses money.
   */
  afterLossExpectancyR: number | null;
  afterLossN: number;
}

export interface EquityPoint {
  /** ISO timestamp of the close that produced this equity level. */
  t: string;
  equity: number;
  /** Peak-to-here drawdown in dollars (0 at a new high). */
  drawdown: number;
  tradeId: string;
}

export interface AnalyticsReport {
  mode: "live" | "paper";
  overall: Metrics;
  /** Trades in the window; overall.trades is the same number, kept for clarity. */
  n: number;
  meaningful: boolean;
  statisticallyMeaningful: boolean;
  byPrescore: Bucket[];
  byKillzone: Bucket[];
  byGrade: Bucket[];
  bySymbol: Bucket[];
  bySide: Bucket[];
  byWeekday: Bucket[];
  streaks: StreakInfo;
  equityCurve: EquityPoint[];
  /** Plain-language read of what the numbers support. Never advice. */
  readout: string[];
}

/* ------------------------------------------------------------------ */
/* Bucketing                                                          */
/* ------------------------------------------------------------------ */

function emptyBucket(key: string, label: string): Bucket {
  return {
    key,
    label,
    n: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    netPnl: 0,
    expectancyR: 0,
    avgWinR: 0,
    avgLossR: 0,
    profitFactor: null,
    meaningful: false,
  };
}

/** Build one bucket from a trade subset. R-less trades still count for PnL. */
export function bucketOf(
  key: string,
  label: string,
  trades: AnalyticsTrade[],
): Bucket {
  if (!trades.length) return emptyBucket(key, label);

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const withR = trades.filter((t) => Number.isFinite(t.r));
  const winsR = wins.filter((t) => Number.isFinite(t.r));
  const lossesR = losses.filter((t) => Number.isFinite(t.r));

  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));

  return {
    key,
    label,
    n: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: wins.length / trades.length,
    netPnl: round2(trades.reduce((a, t) => a + t.pnl, 0)),
    expectancyR: withR.length
      ? round4(withR.reduce((a, t) => a + t.r, 0) / withR.length)
      : 0,
    avgWinR: winsR.length
      ? round4(winsR.reduce((a, t) => a + t.r, 0) / winsR.length)
      : 0,
    avgLossR: lossesR.length
      ? round4(lossesR.reduce((a, t) => a + t.r, 0) / lossesR.length)
      : 0,
    // null encodes "no losses yet" (infinite PF) — the UI must not print ∞
    // as if it were a real, earned number.
    profitFactor: grossLoss > 0 ? round2(grossProfit / grossLoss) : null,
    meaningful: trades.length >= MIN_MEANINGFUL_N,
  };
}

function groupBy(
  trades: AnalyticsTrade[],
  keyOf: (t: AnalyticsTrade) => string | null,
  labelOf: (key: string) => string = (k) => k,
): Bucket[] {
  const map = new Map<string, AnalyticsTrade[]>();
  for (const t of trades) {
    const k = keyOf(t);
    if (k == null) continue;
    const arr = map.get(k) ?? [];
    arr.push(t);
    map.set(k, arr);
  }
  return [...map.entries()]
    .map(([k, list]) => bucketOf(k, labelOf(k), list))
    .sort((a, b) => b.n - a.n);
}

/** Pre-score buckets. Edges match the replay harness so the two are readable side by side. */
const PRESCORE_EDGES: { label: string; min: number; max: number }[] = [
  { label: "<0.50", min: 0, max: 0.5 },
  { label: "0.50–0.60", min: 0.5, max: 0.6 },
  { label: "0.60–0.70", min: 0.6, max: 0.7 },
  { label: "0.70+", min: 0.7, max: Infinity },
];

export function byPrescore(trades: AnalyticsTrade[]): Bucket[] {
  return PRESCORE_EDGES.map((e) =>
    bucketOf(
      e.label,
      e.label,
      trades.filter(
        (t) =>
          t.confluence != null && t.confluence >= e.min && t.confluence < e.max,
      ),
    ),
  );
}

const WEEKDAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Weekday in ET (the trading calendar), not the viewer's locale — a trade
 * closed 21:00 ET Monday is Monday's, even though it is Tuesday in UTC.
 */
export function etWeekday(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).formatToParts(new Date(iso));
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const idx = WEEKDAY_LABEL.indexOf(wd);
  return idx < 0 ? 0 : idx;
}

/* ------------------------------------------------------------------ */
/* Streaks + tilt                                                     */
/* ------------------------------------------------------------------ */

export function computeStreaks(chronological: AnalyticsTrade[]): StreakInfo {
  if (!chronological.length) {
    return {
      currentType: "none",
      currentLength: 0,
      longestWin: 0,
      longestLoss: 0,
      afterLossExpectancyR: null,
      afterLossN: 0,
    };
  }

  let longestWin = 0;
  let longestLoss = 0;
  let runType: "win" | "loss" | "none" = "none";
  let runLen = 0;
  const afterLossR: number[] = [];

  for (let i = 0; i < chronological.length; i++) {
    const t = chronological[i]!;
    const isWin = t.pnl > 0;
    const type = isWin ? "win" : "loss";
    if (type === runType) runLen += 1;
    else {
      runType = type;
      runLen = 1;
    }
    if (isWin) longestWin = Math.max(longestWin, runLen);
    else longestLoss = Math.max(longestLoss, runLen);

    // Tilt probe: this trade's R, given the PREVIOUS trade lost.
    const prev = chronological[i - 1];
    if (prev && prev.pnl <= 0 && Number.isFinite(t.r)) afterLossR.push(t.r);
  }

  return {
    currentType: runType,
    currentLength: runLen,
    longestWin,
    longestLoss,
    afterLossExpectancyR: afterLossR.length
      ? round4(afterLossR.reduce((a, b) => a + b, 0) / afterLossR.length)
      : null,
    afterLossN: afterLossR.length,
  };
}

/* ------------------------------------------------------------------ */
/* Equity curve                                                       */
/* ------------------------------------------------------------------ */

export function buildEquityCurve(
  chronological: AnalyticsTrade[],
  startingEquity: number,
): EquityPoint[] {
  const out: EquityPoint[] = [];
  let equity = startingEquity;
  let peak = startingEquity;
  for (const t of chronological) {
    equity = round2(equity + t.pnl);
    peak = Math.max(peak, equity);
    out.push({
      t: t.closed,
      equity,
      drawdown: round2(peak - equity),
      tradeId: t.id,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Readout                                                            */
/* ------------------------------------------------------------------ */

function best(buckets: Bucket[]): Bucket | null {
  const usable = buckets.filter((b) => b.meaningful);
  if (!usable.length) return null;
  return usable.reduce((a, b) => (b.expectancyR > a.expectancyR ? b : a));
}

function worst(buckets: Bucket[]): Bucket | null {
  const usable = buckets.filter((b) => b.meaningful);
  if (!usable.length) return null;
  return usable.reduce((a, b) => (b.expectancyR < a.expectancyR ? b : a));
}

/**
 * Plain-language statements the data actually supports. Deterministic —
 * assembled from computed numbers, never generated. Says "not enough data"
 * far more often than it says anything else, on purpose.
 */
export function buildReadout(r: Omit<AnalyticsReport, "readout">): string[] {
  const lines: string[] = [];
  const label = r.mode === "paper" ? "Paper" : "Live";

  if (r.n === 0) {
    return [
      `${label}: no closed trades yet. Expectancy starts counting at the first exit.`,
    ];
  }

  lines.push(
    `${label}: ${r.n} closed trade${r.n === 1 ? "" : "s"} · net $${r.overall.netPnl.toFixed(2)} · expectancy ${fmtR(r.overall.expectancyR)}.`,
  );

  if (!r.statisticallyMeaningful) {
    lines.push(
      `n=${r.n} is below ${STATISTICALLY_MEANINGFUL_N} — treat every number here as directional, not proven. ${STATISTICALLY_MEANINGFUL_N - r.n} more closes before expectancy means much.`,
    );
  }

  const bkz = best(r.byKillzone);
  const wkz = worst(r.byKillzone);
  if (bkz && wkz && bkz.key !== wkz.key) {
    lines.push(
      `Killzone spread: ${bkz.label} ${fmtR(bkz.expectancyR)} (n=${bkz.n}) vs ${wkz.label} ${fmtR(wkz.expectancyR)} (n=${wkz.n}).`,
    );
  }

  const bsym = best(r.bySymbol);
  const wsym = worst(r.bySymbol);
  if (bsym && wsym && bsym.key !== wsym.key) {
    lines.push(
      `Instrument spread: ${bsym.label} ${fmtR(bsym.expectancyR)} (n=${bsym.n}) vs ${wsym.label} ${fmtR(wsym.expectancyR)} (n=${wsym.n}).`,
    );
  }

  // Is the pre-score doing any work at all? Compare top bucket to bottom.
  const usableScore = r.byPrescore.filter((b) => b.meaningful);
  if (usableScore.length >= 2) {
    const lo = usableScore[0]!;
    const hi = usableScore[usableScore.length - 1]!;
    lines.push(
      hi.expectancyR > lo.expectancyR
        ? `Pre-score is ordering correctly so far: ${hi.label} ${fmtR(hi.expectancyR)} beats ${lo.label} ${fmtR(lo.expectancyR)}.`
        : `Pre-score is NOT ordering outcomes: ${hi.label} ${fmtR(hi.expectancyR)} does not beat ${lo.label} ${fmtR(lo.expectancyR)}. The score is not yet earning its gate.`,
    );
  } else {
    lines.push(
      `Pre-score buckets are all under n=${MIN_MEANINGFUL_N} — cannot yet say whether the score predicts anything.`,
    );
  }

  const s = r.streaks;
  if (s.afterLossExpectancyR != null && s.afterLossN >= MIN_MEANINGFUL_N) {
    const delta = s.afterLossExpectancyR - r.overall.expectancyR;
    if (delta < -0.15) {
      lines.push(
        `Tilt signal: trades taken right after a loss run ${fmtR(s.afterLossExpectancyR)} vs ${fmtR(r.overall.expectancyR)} overall (n=${s.afterLossN}). The next trade after a loss is your most expensive one.`,
      );
    } else {
      lines.push(
        `No tilt signal: after-loss expectancy ${fmtR(s.afterLossExpectancyR)} vs ${fmtR(r.overall.expectancyR)} overall (n=${s.afterLossN}).`,
      );
    }
  }

  if (r.overall.maxDrawdown > 0) {
    lines.push(
      `Max drawdown $${r.overall.maxDrawdown.toFixed(2)} (${(r.overall.maxDrawdownPct * 100).toFixed(1)}%) · longest losing run ${s.longestLoss}.`,
    );
  }

  return lines;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                        */
/* ------------------------------------------------------------------ */

/**
 * Build the full report for ONE mode. Caller must pass only that mode's
 * trades — this function never filters by mode itself, so a mistake at the
 * call site can't silently blend live and paper.
 */
export function buildAnalytics(
  trades: AnalyticsTrade[],
  mode: "live" | "paper",
  startingEquity: number,
): AnalyticsReport {
  // Chronological by close for anything order-dependent (streaks, equity).
  const chronological = [...trades].sort(
    (a, b) => new Date(a.closed).getTime() - new Date(b.closed).getTime(),
  );

  const overall = computeMetrics(chronological, startingEquity);
  const partial: Omit<AnalyticsReport, "readout"> = {
    mode,
    overall,
    n: chronological.length,
    meaningful: chronological.length >= MIN_MEANINGFUL_N,
    statisticallyMeaningful:
      chronological.length >= STATISTICALLY_MEANINGFUL_N,
    byPrescore: byPrescore(chronological),
    byKillzone: groupBy(
      chronological,
      (t) => t.killzone ?? null,
      (k) => k.replace(/_/g, " "),
    ),
    byGrade: groupBy(chronological, (t) => t.grade ?? null),
    bySymbol: groupBy(chronological, (t) => t.symbol),
    bySide: groupBy(chronological, (t) => t.side),
    byWeekday: groupBy(
      chronological,
      (t) => String(etWeekday(t.closed)),
      (k) => WEEKDAY_LABEL[Number(k)] ?? k,
    ),
    streaks: computeStreaks(chronological),
    equityCurve: buildEquityCurve(chronological, startingEquity),
  };

  return { ...partial, readout: buildReadout(partial) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
function fmtR(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}
