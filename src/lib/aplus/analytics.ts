/**
 * Port of keatrng-cpu/Trading-Automation `aplus/analytics.py`
 * Metrics from NET pnl only (after commission + slippage).
 */

export const WEAK_SAMPLE_THRESHOLD = 100;

export interface ClosedTrade {
  id: string;
  symbol: string;
  side: "long" | "short";
  opened: string;
  closed: string;
  entry: number;
  exit: number;
  pnl: number;
  r: number;
  commission: number;
  slippage: number;
  reason: string;
  confluence?: number;
}

export interface Metrics {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  profitFactor: number | null; // null → ∞ display
  expectancyR: number;
  avgWinR: number;
  avgLossR: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpe: number;
  totalCommission: number;
  totalSlippage: number;
  isStatisticallyWeak: boolean;
}

export function equityCurve(
  trades: ClosedTrade[],
  startingEquity: number,
): number[] {
  const curve = [startingEquity];
  let equity = startingEquity;
  for (const t of trades) {
    equity += t.pnl;
    curve.push(equity);
  }
  return curve;
}

export function maxDrawdown(curve: number[]): {
  abs: number;
  pct: number;
} {
  if (!curve.length) return { abs: 0, pct: 0 };
  let peak = curve[0]!;
  let worstAbs = 0;
  let worstPct = 0;
  for (const value of curve) {
    peak = Math.max(peak, value);
    const decline = peak - value;
    if (decline > worstAbs) worstAbs = decline;
    if (peak > 0 && decline / peak > worstPct) worstPct = decline / peak;
  }
  return { abs: worstAbs, pct: worstPct };
}

export function sharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);
  return sd > 0 ? mean / sd : 0;
}

export function computeMetrics(
  trades: ClosedTrade[],
  startingEquity: number,
): Metrics {
  if (!trades.length) {
    return {
      trades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      grossProfit: 0,
      grossLoss: 0,
      netPnl: 0,
      profitFactor: 0,
      expectancyR: 0,
      avgWinR: 0,
      avgLossR: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      sharpe: 0,
      totalCommission: 0,
      totalSlippage: 0,
      isStatisticallyWeak: true,
    };
  }
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const net = trades.reduce((a, t) => a + t.pnl, 0);
  // Finite R only. A trade logged without a stop has no defined 1R and is
  // read back as NaN (analytics-server.ts) — the comment there promised the
  // aggregates guard it, and this one did not: one stopless row turned the
  // Lab expectancy tile into "NaNR".
  const rValues = trades.map((t) => t.r).filter((r) => Number.isFinite(r));
  const finiteR = (xs: typeof trades) => xs.map((t) => t.r).filter((r) => Number.isFinite(r));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const curve = equityCurve(trades, startingEquity);
  const dd = maxDrawdown(curve);

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: wins.length / trades.length,
    grossProfit,
    grossLoss,
    netPnl: net,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    expectancyR: mean(rValues),
    avgWinR: mean(finiteR(wins)),
    avgLossR: mean(finiteR(losses)),
    maxDrawdown: dd.abs,
    maxDrawdownPct: dd.pct,
    sharpe: sharpe(rValues),
    totalCommission: trades.reduce((a, t) => a + t.commission, 0),
    totalSlippage: trades.reduce((a, t) => a + t.slippage, 0),
    isStatisticallyWeak: trades.length < WEAK_SAMPLE_THRESHOLD,
  };
}
