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
 *
 * Phase C adds three things on top of that same discipline:
 *   - a per-strategy scoreboard whose EXPECTANCY stays hidden until n>=30
 *     (`MIN_STRATEGY_N`), because a strategy-level claim is the one people act
 *     on by switching models;
 *   - a strategy x regime x killzone matrix whose whole purpose is naming the
 *     combinations to STOP taking ("mechanical, dead regime, lunch = -0.40R
 *     over 40 trades"), not finding new ones;
 *   - `strategyVerdict`, a pure promote/demote/hold rule driven by the
 *     trailing-30 sample instead of a hand-tuned constant.
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
  /**
   * `SetupCandidate.strategyPrimary` as recorded at log time (migration 0008).
   * Null on every row written before that column existed — those are counted
   * as unattributed, never assigned to a model.
   */
  strategy?: string | null;
  /** `MarketConditions.regime` at log time: trending | ranging | dead. */
  regime?: string | null;
}

/** Below this, a bucket's win rate / expectancy is noise, not signal. */
export const MIN_MEANINGFUL_N = 20;

/** Full statistical sample per the engine's own standard. */
export const STATISTICALLY_MEANINGFUL_N = 100;

/**
 * Sample required before a STRATEGY-level expectancy may be shown at all
 * (ROADMAP C1: "render '—' until n>=30").
 *
 * Deliberately stricter than `MIN_MEANINGFUL_N`. A thin killzone bucket makes
 * you curious; a thin per-strategy expectancy makes you switch models, which
 * is the expensive mistake. Same reason it gates promotion in `strategyVerdict`.
 */
export const MIN_STRATEGY_N = 30;

/** Closes considered by `strategyVerdict` — the trailing window, not all time. */
export const TRAILING_WINDOW = 30;

/** Promotion bar: trailing-window expectancy must clear this, at n>=30. */
export const PROMOTE_EXPECTANCY_R = 0.2;

/**
 * Floor for issuing ANY verdict, including a demotion.
 *
 * Demotion is the risk-reducing direction, so it fires on a smaller sample
 * than promotion (n>=20 vs n>=30) — but not on any sample. A -0.40R read over
 * n=3 is the same noise as a +100% win rate over n=2, and acting on it retires
 * a working model on three unlucky fills. Below this, the verdict is
 * "insufficient-data" and nothing changes.
 */
export const MIN_VERDICT_N = MIN_MEANINGFUL_N;

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

/**
 * One strategy's row on the scoreboard (C1). A `Bucket` plus the second,
 * stricter gate: `meaningful` (n>=20) governs win rate / profit factor, and
 * `expectancyReadable` (n>=30) governs the expectancy figure on its own.
 */
export interface StrategyScore extends Bucket {
  /** n >= MIN_STRATEGY_N — the only condition under which expectancy prints. */
  expectancyReadable: boolean;
  /** Closes still needed to reach MIN_STRATEGY_N. 0 once there. */
  tradesToReadable: number;
}

/**
 * One cell of the C2 matrix: a single strategy, in a single regime, in a
 * single killzone. Thin by construction — a three-way slice of an already
 * small sample — so `meaningful` is false far more often than it is true, and
 * the UI must render "—" rather than a number when it is.
 */
export interface MatrixCell {
  /** `strategy|regime|killzone` — stable React key and lookup id. */
  key: string;
  strategy: string;
  regime: string;
  killzone: string;
  n: number;
  winRate: number;
  expectancyR: number;
  netPnl: number;
  profitFactor: number | null;
  /** n >= MIN_MEANINGFUL_N. False = this cell has no readable number. */
  meaningful: boolean;
}

export interface RegimeMatrix {
  /** Axis values actually present in the sample, in canonical order. */
  strategies: string[];
  regimes: string[];
  killzones: string[];
  /** Only combinations with at least one trade. Empty until attribution lands. */
  cells: MatrixCell[];
  /**
   * The deliverable: readable cells with NEGATIVE expectancy, worst first.
   * "When NOT to use each model" — the desk should refuse these combinations.
   */
  avoid: MatrixCell[];
  /** Readable cells with positive expectancy, best first. */
  favor: MatrixCell[];
  /**
   * Closed trades missing at least one of strategy / regime / killzone, so they
   * could not be placed in any cell. A large number here means the matrix is
   * empty because of a WIRING gap, not because of a lack of trading.
   */
  unclassified: number;
}

/** What measurement says to do with a strategy. Never advice — a rule output. */
export type StrategyVerdict =
  | "promote"
  | "demote"
  | "hold"
  | "insufficient-data";

export interface StrategyVerdictResult {
  strategy: string;
  verdict: StrategyVerdict;
  /** Trades actually examined: min(closes, TRAILING_WINDOW). */
  n: number;
  /** Window size the rule is defined over (TRAILING_WINDOW). */
  window: number;
  /** Of `n`, how many carried a defined R — the only ones expectancy uses. */
  measuredN: number;
  /** Null when no trade in the window had a defined R. */
  expectancyR: number | null;
  winRate: number | null;
  netPnl: number;
  /** Closes still needed to reach the next decision threshold. 0 when at it. */
  tradesNeeded: number;
  /** One deterministic sentence carrying the numbers behind the verdict. */
  reason: string;
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
  /** C1 — per-strategy scoreboard, biggest sample first. */
  byStrategy: StrategyScore[];
  /** Closed trades carrying no `strategy` — the attribution gap, stated plainly. */
  unattributedN: number;
  /** C2 — strategy x regime x killzone, with the "do not take" list. */
  matrix: RegimeMatrix;
  /** C3 — measurement-driven promote/demote for every attributed strategy. */
  verdicts: StrategyVerdictResult[];
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

/**
 * A grouping key, or null when the column carries nothing usable. An empty or
 * whitespace string is a MISSING label, not a category — bucketing "" would
 * create a nameless strategy row that looks like a real model.
 */
export function normalizeKey(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = v.trim();
  return s.length ? s : null;
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
/* C1 — per-strategy scoreboard                                       */
/* ------------------------------------------------------------------ */

/**
 * Group closed trades by the model that produced them.
 *
 * Trades with no `strategy` are EXCLUDED rather than bucketed under a made-up
 * label: an unattributed trade is a gap in the record, and merging gaps into a
 * synthetic "other" row would let a scoreboard look populated while measuring
 * nothing. `AnalyticsReport.unattributedN` reports them separately.
 */
export function byStrategy(trades: AnalyticsTrade[]): StrategyScore[] {
  return groupBy(trades, (t) => normalizeKey(t.strategy)).map((b) => ({
    ...b,
    expectancyReadable: b.n >= MIN_STRATEGY_N,
    tradesToReadable: Math.max(0, MIN_STRATEGY_N - b.n),
  }));
}

/** Trades whose model was never recorded — they can carry no strategy claim. */
export function countUnattributed(trades: AnalyticsTrade[]): number {
  return trades.filter((t) => normalizeKey(t.strategy) == null).length;
}

/* ------------------------------------------------------------------ */
/* C2 — regime matrix ("when NOT to use each model")                  */
/* ------------------------------------------------------------------ */

/** `MarketConditions.regime` values, in the order the desk reasons about them. */
const REGIME_ORDER = ["trending", "ranging", "dead"];

/** `KillzoneId` values, in session order (src/lib/trading/sessions.ts). */
const KILLZONE_ORDER = ["asia", "london", "ny_am", "ny_lunch", "ny_pm", "dead"];

/** Canonical first, anything unrecognised after it, alphabetically. Stable. */
function orderedBy(values: Iterable<string>, canonical: string[]): string[] {
  return [...new Set(values)].sort((a, b) => {
    const ia = canonical.indexOf(a);
    const ib = canonical.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });
}

/**
 * Cross strategy x regime x killzone.
 *
 * Only combinations that actually occurred become cells — a full cartesian
 * product would be mostly zeros and would imply the desk had tried things it
 * never tried. `avoid` is the point of the whole structure: the readable cells
 * that lose money, worst first, so a model can be ruled out in a context
 * rather than ruled out entirely.
 */
/** "mechanical · dead · ny lunch" — the readable name of one matrix cell. */
export function cellLabel(c: MatrixCell): string {
  return `${c.strategy} · ${c.regime} · ${c.killzone.replace(/_/g, " ")}`;
}

export function buildRegimeMatrix(trades: AnalyticsTrade[]): RegimeMatrix {
  const classified = trades.filter(
    (t) =>
      normalizeKey(t.strategy) != null &&
      normalizeKey(t.regime) != null &&
      normalizeKey(t.killzone) != null,
  );

  const groups = new Map<string, AnalyticsTrade[]>();
  for (const t of classified) {
    const key = [
      normalizeKey(t.strategy),
      normalizeKey(t.regime),
      normalizeKey(t.killzone),
    ].join("|");
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }

  const cells: MatrixCell[] = [...groups.entries()].map(([key, list]) => {
    const [strategy = "", regime = "", killzone = ""] = key.split("|");
    const b = bucketOf(key, key, list);
    return {
      key,
      strategy,
      regime,
      killzone,
      n: b.n,
      winRate: b.winRate,
      expectancyR: b.expectancyR,
      netPnl: b.netPnl,
      profitFactor: b.profitFactor,
      meaningful: b.meaningful,
    };
  });

  // Deterministic order: strategy alphabetically, then canonical regime, then
  // canonical killzone — so the same sample always renders the same grid.
  cells.sort(
    (a, b) =>
      a.strategy.localeCompare(b.strategy) ||
      REGIME_ORDER.indexOf(a.regime) - REGIME_ORDER.indexOf(b.regime) ||
      a.regime.localeCompare(b.regime) ||
      KILLZONE_ORDER.indexOf(a.killzone) - KILLZONE_ORDER.indexOf(b.killzone) ||
      a.killzone.localeCompare(b.killzone),
  );

  const readable = cells.filter((c) => c.meaningful);

  return {
    strategies: [...new Set(cells.map((c) => c.strategy))].sort((a, b) =>
      a.localeCompare(b),
    ),
    regimes: orderedBy(
      cells.map((c) => c.regime),
      REGIME_ORDER,
    ),
    killzones: orderedBy(
      cells.map((c) => c.killzone),
      KILLZONE_ORDER,
    ),
    cells,
    avoid: readable
      .filter((c) => c.expectancyR < 0)
      .sort((a, b) => a.expectancyR - b.expectancyR),
    favor: readable
      .filter((c) => c.expectancyR > 0)
      .sort((a, b) => b.expectancyR - a.expectancyR),
    unclassified: trades.length - classified.length,
  };
}

/* ------------------------------------------------------------------ */
/* C3 — promotion / demotion by measurement                           */
/* ------------------------------------------------------------------ */

/**
 * What the trailing sample says to do with one strategy.
 *
 * Pure and total: pass that strategy's closed trades (any length, any order)
 * and it takes the most recent `TRAILING_WINDOW` by close time itself, so a
 * caller cannot accidentally hand it a stale or unsorted window.
 *
 * The rules, in evaluation order:
 *   1. n < MIN_VERDICT_N, or no trade in the window carried a defined R
 *      -> "insufficient-data". Nothing changes. This is the common case and
 *      is meant to be.
 *   2. expectancy < 0 -> "demote". Risk-reducing, so it clears at n>=20.
 *   3. n >= MIN_STRATEGY_N AND expectancy > +0.20R -> "promote".
 *   4. otherwise -> "hold".
 *
 * This is what replaces a hardcoded demotion constant: the rule reads the
 * sample instead of encoding somebody's memory of a bad week.
 */
export function strategyVerdict(
  strategy: string,
  closed: AnalyticsTrade[],
): StrategyVerdictResult {
  const window = [...closed]
    .sort((a, b) => new Date(b.closed).getTime() - new Date(a.closed).getTime())
    .slice(0, TRAILING_WINDOW);

  const n = window.length;
  const withR = window.filter((t) => Number.isFinite(t.r));
  const expectancyR = withR.length
    ? round4(withR.reduce((a, t) => a + t.r, 0) / withR.length)
    : null;
  const wins = window.filter((t) => t.pnl > 0).length;

  const base = {
    strategy,
    n,
    window: TRAILING_WINDOW,
    measuredN: withR.length,
    expectancyR,
    winRate: n ? wins / n : null,
    netPnl: round2(window.reduce((a, t) => a + t.pnl, 0)),
  };

  if (n === 0) {
    return {
      ...base,
      verdict: "insufficient-data",
      tradesNeeded: MIN_VERDICT_N,
      reason: `${strategy}: no closed trades — nothing to measure.`,
    };
  }

  if (n < MIN_VERDICT_N) {
    return {
      ...base,
      verdict: "insufficient-data",
      tradesNeeded: MIN_VERDICT_N - n,
      reason: `${strategy}: n=${n} of ${MIN_VERDICT_N} — too thin to promote OR demote on. ${MIN_VERDICT_N - n} more closes before this reads as anything but noise.`,
    };
  }

  if (expectancyR == null) {
    return {
      ...base,
      verdict: "insufficient-data",
      tradesNeeded: 0,
      reason: `${strategy}: ${n} trailing closes, none with a defined R (no stop recorded) — expectancy cannot be computed, so no verdict.`,
    };
  }

  const stats = `trailing-${n} expectancy ${fmtR(expectancyR)} (${withR.length} R-bearing, WR ${((wins / n) * 100).toFixed(0)}%, net $${base.netPnl.toFixed(2)})`;

  if (expectancyR < 0) {
    return {
      ...base,
      verdict: "demote",
      tradesNeeded: 0,
      reason: `${strategy}: ${stats} — negative over a readable sample. Demote.`,
    };
  }

  if (n >= MIN_STRATEGY_N && expectancyR > PROMOTE_EXPECTANCY_R) {
    return {
      ...base,
      verdict: "promote",
      tradesNeeded: 0,
      reason: `${strategy}: ${stats} — clears +${PROMOTE_EXPECTANCY_R.toFixed(2)}R at n>=${MIN_STRATEGY_N}. Promote.`,
    };
  }

  return {
    ...base,
    verdict: "hold",
    tradesNeeded: Math.max(0, MIN_STRATEGY_N - n),
    reason:
      n < MIN_STRATEGY_N
        ? `${strategy}: ${stats} — not negative, but promotion needs n>=${MIN_STRATEGY_N} (${MIN_STRATEGY_N - n} more). Hold.`
        : `${strategy}: ${stats} — below the +${PROMOTE_EXPECTANCY_R.toFixed(2)}R promotion bar. Hold.`,
  };
}

/** One verdict per attributed strategy, most-traded first. */
export function strategyVerdicts(
  trades: AnalyticsTrade[],
): StrategyVerdictResult[] {
  const map = new Map<string, AnalyticsTrade[]>();
  for (const t of trades) {
    const k = normalizeKey(t.strategy);
    if (k == null) continue;
    const arr = map.get(k) ?? [];
    arr.push(t);
    map.set(k, arr);
  }
  return [...map.entries()]
    .map(([k, list]) => strategyVerdict(k, list))
    .sort((a, b) => b.n - a.n || a.strategy.localeCompare(b.strategy));
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

  // C4 — book coverage is a data decision. State the bar, and where it stands.
  if (r.bySymbol.length) {
    const atBar = r.bySymbol.filter((b) => b.n >= MIN_STRATEGY_N);
    const positive = atBar.filter((b) => b.expectancyR > 0);
    const largest = r.bySymbol[0]!; // groupBy sorts by n desc
    const fmtSym = (b: Bucket) => `${b.label} ${fmtR(b.expectancyR)} (n=${b.n})`;
    lines.push(
      atBar.length === 0
        ? `Book coverage: no instrument has reached n=${MIN_STRATEGY_N} (largest ${largest.label}, n=${largest.n}). Do not add instruments — the current book is unproven.`
        : positive.length === 0
          ? `Book coverage: ${atBar.map(fmtSym).join(", ")} — nothing positive at n>=${MIN_STRATEGY_N}. Another instrument would add exposure to an unproven book, not diversification.`
          : `Book coverage: ${positive.map(fmtSym).join(", ")} positive at n>=${MIN_STRATEGY_N}. Instrument count is now a data question rather than a guess.`,
    );
  }

  // C1 — the scoreboard, and the honest state of its inputs.
  if (r.unattributedN > 0) {
    lines.push(
      `Strategy attribution: ${r.n - r.unattributedN} of ${r.n} closes carry a model label; ${r.unattributedN} do not and are excluded from the scoreboard and the matrix. Rows logged before migration 0008 have no strategy to attribute.`,
    );
  }
  const readableStrategies = r.byStrategy.filter((s) => s.expectancyReadable);
  if (!r.byStrategy.length) {
    lines.push(
      `Per-strategy scoreboard has no input: no closed trade carries a strategy label.`,
    );
  } else if (!readableStrategies.length) {
    const largest = r.byStrategy[0]!;
    lines.push(
      `No strategy has reached n=${MIN_STRATEGY_N} — largest is ${largest.label} at n=${largest.n} (${largest.tradesToReadable} more). Per-strategy expectancy stays hidden until then; a model is not switched on 12 trades.`,
    );
  } else {
    const bs = readableStrategies.reduce((a, b) =>
      b.expectancyR > a.expectancyR ? b : a,
    );
    const ws = readableStrategies.reduce((a, b) =>
      b.expectancyR < a.expectancyR ? b : a,
    );
    lines.push(
      bs.key === ws.key
        ? `Strategy: ${bs.label} is the only model at n>=${MIN_STRATEGY_N} — ${fmtR(bs.expectancyR)} over ${bs.n}.`
        : `Strategy spread: ${bs.label} ${fmtR(bs.expectancyR)} (n=${bs.n}) vs ${ws.label} ${fmtR(ws.expectancyR)} (n=${ws.n}).`,
    );
  }

  // C2 — the actual deliverable: combinations to stop taking.
  const readableCells = r.matrix.cells.filter((c) => c.meaningful).length;
  if (r.matrix.avoid.length) {
    const worstCell = r.matrix.avoid[0]!;
    const rest = r.matrix.avoid.length - 1;
    lines.push(
      `Do not take: ${cellLabel(worstCell)} = ${fmtR(worstCell.expectancyR)} over ${worstCell.n} trades${rest > 0 ? ` — and ${rest} other losing combination${rest === 1 ? "" : "s"} at n>=${MIN_MEANINGFUL_N}` : ""}.`,
    );
  } else if (readableCells > 0) {
    lines.push(
      `Regime matrix: ${readableCells} combination${readableCells === 1 ? "" : "s"} at n>=${MIN_MEANINGFUL_N}, none losing. Nothing to rule out yet.`,
    );
  } else if (r.matrix.cells.length) {
    lines.push(
      `Regime matrix: ${r.matrix.cells.length} strategy/regime/killzone combination${r.matrix.cells.length === 1 ? "" : "s"} seen, none at n>=${MIN_MEANINGFUL_N}. No combination can yet be ruled out on evidence.`,
    );
  }

  // C3 — every verdict that says to change something, with its numbers.
  for (const v of r.verdicts) {
    if (v.verdict === "demote" || v.verdict === "promote") lines.push(v.reason);
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
  } else if (usableScore.length === 1) {
    // Saying "all buckets are under n=20" while one holds n=97 is a false
    // statement about the sample. Ordering needs TWO readable buckets.
    const only = usableScore[0]!;
    lines.push(
      `Only one pre-score bucket has reached n=${MIN_MEANINGFUL_N} (${only.label}, n=${only.n}) — with nothing to compare it against, the score's ordering is still untested.`,
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
    byStrategy: byStrategy(chronological),
    unattributedN: countUnattributed(chronological),
    matrix: buildRegimeMatrix(chronological),
    verdicts: strategyVerdicts(chronological),
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
