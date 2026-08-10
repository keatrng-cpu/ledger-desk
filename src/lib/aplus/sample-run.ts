/**
 * Demo dual NQ+ES backtest / premarket / paper payloads shaped like
 * Trading-Automation `dashboard_page.html` data.json.
 * Offline-first so the desk works without Python engine.
 */

import { APLUS_RULES } from "./config";
import {
  computeMetrics,
  equityCurve,
  type ClosedTrade,
  type Metrics,
} from "./analytics";
import { COMPONENT_WEIGHTS, CONFLUENCE_KNOWLEDGE } from "./confluence";

export type Bias = "bull" | "bear" | "neutral";

export interface BiasStack {
  top_down: Bias;
  mid_15m: Bias;
  htf_60m: Bias;
  po3: Bias;
  opening: Bias;
  weekly_pd: Bias;
  ltf_trend: Bias;
}

export interface JournalRow {
  ts: string;
  event: "CANDIDATE" | "SKIP" | "ENTRY" | "EXIT" | "HALT";
  symbol: string;
  confluence?: number;
  skip_reason?: string;
  reason?: string;
  pnl?: number;
  r_multiple?: number;
}

export interface PremarketSnapshot {
  symbol: string;
  bias: BiasStack;
  conditions: {
    tradeable: boolean;
    regime: string;
    volatility: string;
    er: number;
    atr_ratio: number;
    reasons: string[];
  };
  session: {
    config: string;
    in_session: boolean;
    killzone: string;
    pdh: number;
    pdl: number;
    pwh: number;
    pwl: number;
    day_open: number;
    ny_open: number;
  };
  news: { verdict: "clear" | "caution" | "blackout"; reason: string };
  dealing_range: {
    low: number;
    high: number;
    equilibrium: number;
    zone: string;
  };
  levels: { name: string; price: number }[];
  zone_counts: {
    fvgs: number;
    order_blocks: number;
    breakers: number;
    mitigations: number;
    propulsions: number;
    pools: number;
  };
  last_sweep: { kind: string; price: number; bars_ago: number } | null;
  last_event: {
    kind: string;
    direction: Bias;
    level: number;
    is_mss: boolean;
    displaced: boolean;
  } | null;
  bar: {
    ts: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
  bars_seen: number;
}

export interface BacktestPayload {
  mode: "backtest";
  symbol: string;
  bars: number;
  first_ts: string;
  last_ts: string;
  starting_equity: number;
  scored: number;
  best_score: number;
  floor: number;
  above_floor: number;
  candidates: number;
  skips: number;
  metrics: Metrics;
  equity: number[];
  trades: ClosedTrade[];
  histogram: number[];
  components: { name: string; weight: number; pct: number }[];
  skip_reasons: { reason: string; count: number }[];
  journal: {
    candidates: number;
    skips: number;
    entries: number;
    exits: number;
    halts: number;
    tail: JournalRow[];
  };
  assumptions: string;
  source: "demo-offline";
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Build a deterministic dual-symbol demo trade list (~12 trades). */
export function buildDemoTrades(): ClosedTrade[] {
  const rand = seeded(42);
  const trades: ClosedTrade[] = [];
  const base = new Date("2026-05-12T14:35:00Z").getTime();
  const specs = [
    { symbol: "MNQ", side: "long" as const, conf: 0.71, r: 1.8, reason: "sweep→MSS→iFVG retest AM" },
    { symbol: "ES", side: "short" as const, conf: 0.68, r: -1.0, reason: "stop out — partial mechanical" },
    { symbol: "MNQ", side: "short" as const, conf: 0.74, r: 2.1, reason: "SMT crack + bear OB AM" },
    { symbol: "ES", side: "long" as const, conf: 0.69, r: 1.4, reason: "PD array + NY open bias" },
    { symbol: "MNQ", side: "long" as const, conf: 0.52, r: -1.0, reason: "floor test — B-grade (TEST 0.50)" },
    { symbol: "ES", side: "short" as const, conf: 0.72, r: 1.6, reason: "PWH sweep + CISD PM" },
    { symbol: "MNQ", side: "long" as const, conf: 0.77, r: 2.4, reason: "A+ mechanical model PM" },
    { symbol: "ES", side: "long" as const, conf: 0.66, r: 1.1, reason: "weekly PD discount + structure" },
    { symbol: "MNQ", side: "short" as const, conf: 0.7, r: -1.0, reason: "news caution mid-trade" },
    { symbol: "ES", side: "short" as const, conf: 0.73, r: 1.9, reason: "breaker + displacement" },
    { symbol: "MNQ", side: "long" as const, conf: 0.68, r: 1.3, reason: "AM killzone iFVG hold" },
    { symbol: "ES", side: "long" as const, conf: 0.71, r: 2.0, reason: "dual SMT confirm NQ lag" },
  ];

  let day = 0;
  for (let i = 0; i < specs.length; i++) {
    const sp = specs[i]!;
    day += i % 2 === 0 ? 1 : 2;
    const opened = new Date(base + day * 86_400_000 + (i % 3) * 3_600_000);
    const closed = new Date(opened.getTime() + (20 + rand() * 90) * 60_000);
    const risk$ = APLUS_RULES.accountEquity * APLUS_RULES.riskPct;
    const pnl = sp.r * risk$ * (0.92 + rand() * 0.16);
    const entry =
      sp.symbol === "ES"
        ? 5600 + rand() * 80
        : 19_800 + rand() * 400;
    const exit =
      sp.side === "long"
        ? entry + sp.r * (sp.symbol === "ES" ? 8 : 28)
        : entry - sp.r * (sp.symbol === "ES" ? 8 : 28);

    trades.push({
      id: `t-${i + 1}`,
      symbol: sp.symbol,
      side: sp.side,
      opened: opened.toISOString(),
      closed: closed.toISOString(),
      entry: +entry.toFixed(2),
      exit: +exit.toFixed(2),
      pnl: +pnl.toFixed(2),
      r: sp.r,
      commission: sp.symbol === "ES" ? 4 : 1,
      slippage: +(1.5 + rand() * 2).toFixed(2),
      reason: sp.reason,
      confluence: sp.conf,
    });
  }
  return trades;
}

export function buildBacktestPayload(): BacktestPayload {
  const trades = buildDemoTrades();
  const starting = APLUS_RULES.accountEquity;
  const metrics = computeMetrics(trades, starting);
  const equity = equityCurve(trades, starting);

  const histogram = Array.from({ length: 10 }, () => 0);
  // Fake scored distribution peaking just under floor
  const histCounts = [12, 28, 64, 118, 156, 210, 142, 78, 28, 7];
  histCounts.forEach((c, i) => {
    histogram[i] = c;
  });

  const journalTail: JournalRow[] = [
    {
      ts: "2026-06-03T13:42:00Z",
      event: "SKIP",
      symbol: "MNQ",
      confluence: 0.48,
      skip_reason: "below confluence floor",
    },
    {
      ts: "2026-06-03T14:05:00Z",
      event: "CANDIDATE",
      symbol: "ES",
      confluence: 0.71,
    },
    {
      ts: "2026-06-03T14:06:00Z",
      event: "ENTRY",
      symbol: "ES",
      reason: "PD array + NY open bias",
      confluence: 0.71,
    },
    {
      ts: "2026-06-03T15:12:00Z",
      event: "EXIT",
      symbol: "ES",
      pnl: 72.4,
      r_multiple: 1.4,
    },
    {
      ts: "2026-06-04T14:22:00Z",
      event: "SKIP",
      symbol: "MNQ",
      skip_reason: "htf top_down gate — bear vs long idea",
    },
    {
      ts: "2026-06-05T18:40:00Z",
      event: "ENTRY",
      symbol: "MNQ",
      confluence: 0.77,
      reason: "A+ mechanical model PM",
    },
    {
      ts: "2026-06-05T19:55:00Z",
      event: "EXIT",
      symbol: "MNQ",
      pnl: 118.5,
      r_multiple: 2.4,
    },
    {
      ts: "2026-06-06T14:10:00Z",
      event: "HALT",
      symbol: "—",
      reason: "session cap reached (2/2)",
    },
  ];

  return {
    mode: "backtest",
    symbol: "NQ+ES dual",
    bars: 48_200,
    first_ts: "2026-05-12T13:30:00Z",
    last_ts: "2026-06-12T20:00:00Z",
    starting_equity: starting,
    scored: histCounts.reduce((a, b) => a + b, 0),
    best_score: 0.77,
    floor: APLUS_RULES.confluenceFloor,
    above_floor: trades.length + 4,
    candidates: trades.length + 18,
    skips: 214,
    metrics,
    equity,
    trades,
    histogram,
    components: COMPONENT_WEIGHTS.map((c) => ({
      name: c.name,
      weight: c.weight,
      pct: c.firePct,
    })),
    skip_reasons: [
      { reason: "htf top_down gate", count: 86 },
      { reason: "below confluence floor", count: 64 },
      { reason: "outside killzone", count: 28 },
      { reason: "session cap reached", count: 18 },
      { reason: "news blackout/caution", count: 12 },
      { reason: "incomplete mechanical model", count: 6 },
    ],
    journal: {
      candidates: trades.length + 18,
      skips: 214,
      entries: trades.length,
      exits: trades.length,
      halts: 3,
      tail: journalTail,
    },
    assumptions:
      "Demo offline dual run (Ledger desk). " +
      `Floor ${APLUS_RULES.confluenceFloor} (TEST) · calib ${APLUS_RULES.confluenceFloorCalibration} · ` +
      `risk ${APLUS_RULES.riskPct * 100}% · micros · NY AM+PM · max ${APLUS_RULES.maxSetupsPerSession}/killzone. ` +
      "NET pnl after commission+slippage. Source: sample-run.ts (not live engine).",
    source: "demo-offline",
  };
}

export function buildPremarketSnapshot(): PremarketSnapshot {
  return {
    symbol: "MNQ",
    bias: {
      top_down: "bull",
      mid_15m: "bull",
      htf_60m: "bull",
      po3: "bull",
      opening: "neutral",
      weekly_pd: "bull",
      ltf_trend: "bull",
    },
    conditions: {
      tradeable: true,
      regime: "trend",
      volatility: "normal",
      er: 0.42,
      atr_ratio: 1.08,
      reasons: [],
    },
    session: {
      config: "ny",
      in_session: true,
      killzone: "ny_am",
      pdh: 29_920.5,
      pdl: 29_640.0,
      pwh: 30_110.25,
      pwl: 29_480.0,
      day_open: 29_780.0,
      ny_open: 29_802.5,
    },
    news: {
      verdict: "clear",
      reason: "No high-impact window in next 30m",
    },
    dealing_range: {
      low: 29_640,
      high: 29_920.5,
      equilibrium: 29_780.25,
      zone: "discount",
    },
    levels: [
      { name: "PDH", price: 29_920.5 },
      { name: "PDL", price: 29_640.0 },
      { name: "EQ", price: 29_780.25 },
      { name: "NY open", price: 29_802.5 },
      { name: "PWH", price: 30_110.25 },
      { name: "PWL", price: 29_480.0 },
    ],
    zone_counts: {
      fvgs: 6,
      order_blocks: 2,
      breakers: 0,
      mitigations: 1,
      propulsions: 0,
      pools: 3,
    },
    last_sweep: { kind: "buyside_liquidity", price: 29_918, bars_ago: 7 },
    last_event: {
      kind: "BOS",
      direction: "bull",
      level: 29_860,
      is_mss: false,
      displaced: true,
    },
    bar: {
      ts: new Date().toISOString(),
      open: 29_790,
      high: 29_812,
      low: 29_778,
      close: 29_800.75,
      volume: 1840,
    },
    bars_seen: 412,
  };
}

export function buildNarrative(): string[] {
  return [
    "Top-down bull — HTF gate open for longs only.",
    "NY AM killzone active; dual MNQ/ES tape live on desk charts.",
    `Confluence floor ${APLUS_RULES.confluenceFloor} (TEST). A+ still tagged ≥ ${APLUS_RULES.aPlusThreshold}.`,
    "Cold components (OB/breaker/mechanical) still scarce — refuse partials.",
    `Risk ${APLUS_RULES.riskPct * 100}% fixed fractional · max ${APLUS_RULES.maxSetupsPerSession}/killzone.`,
    `Knowledge window: ${CONFLUENCE_KNOWLEDGE.window} · best ${CONFLUENCE_KNOWLEDGE.bestScore} vs floor ${CONFLUENCE_KNOWLEDGE.floor}.`,
  ];
}
