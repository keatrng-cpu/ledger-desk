/**
 * Market conditions gate — port of Trading-Automation `strategy/conditions.py`.
 * Hard gate: dead regime or extreme ATR ratio → not tradeable.
 */

import type { OhlcBar } from "@/lib/market/types";

export const DEFAULT_ER_N = 20;
export const DEFAULT_ATR_N = 14;
export const DEFAULT_ER_TREND = 0.3;
export const DEFAULT_MIN_ATR_RATIO = 0.4;
export const DEFAULT_MAX_ATR_RATIO = 3.0;
export const DEFAULT_BASELINE_ATR_N = 200;

function atr(bars: OhlcBar[], n: number): number {
  if (bars.length < 2) return 0;
  const start = Math.max(1, bars.length - n);
  let total = 0;
  let count = 0;
  for (let i = start; i < bars.length; i++) {
    const h = bars[i]!.h;
    const low = bars[i]!.l;
    const pc = bars[i - 1]!.c;
    total += Math.max(h - low, Math.abs(h - pc), Math.abs(low - pc));
    count++;
  }
  return count ? total / count : 0;
}

/** Kaufman efficiency ratio in [0, 1]. */
export function efficiencyRatio(bars: OhlcBar[], n = DEFAULT_ER_N): number {
  if (bars.length <= n) return 0;
  const window = bars.slice(-(n + 1));
  const net = Math.abs(window[window.length - 1]!.c - window[0]!.c);
  let path = 0;
  for (let i = 1; i < window.length; i++) {
    path += Math.abs(window[i]!.c - window[i - 1]!.c);
  }
  return path ? net / path : 0;
}

export interface MarketConditions {
  regime: "trending" | "ranging" | "dead";
  volatility: "high" | "normal" | "low";
  tradeable: boolean;
  er: number;
  atrRatio: number;
  reasons: string[];
}

export function assessConditions(bars: OhlcBar[]): MarketConditions {
  if (bars.length < Math.max(DEFAULT_ER_N, DEFAULT_ATR_N) + 5) {
    return {
      regime: "dead",
      volatility: "low",
      tradeable: false,
      er: 0,
      atrRatio: 0,
      reasons: ["insufficient history"],
    };
  }

  const er = efficiencyRatio(bars, DEFAULT_ER_N);
  const curAtr = atr(bars.slice(-(DEFAULT_ATR_N + 1)), DEFAULT_ATR_N);
  const baseAtr = atr(bars, Math.min(bars.length - 1, DEFAULT_BASELINE_ATR_N));
  const atrRatio = baseAtr ? curAtr / baseAtr : 0;

  let regime: MarketConditions["regime"] =
    er >= DEFAULT_ER_TREND
      ? "trending"
      : er >= DEFAULT_ER_TREND / 2
        ? "ranging"
        : "dead";

  const volatility: MarketConditions["volatility"] =
    atrRatio >= 1.5 ? "high" : atrRatio <= 0.6 ? "low" : "normal";

  const reasons: string[] = [];
  let tradeable = true;
  if (regime === "dead") {
    const sessionEr = efficiencyRatio(bars, 12);
    if (sessionEr >= DEFAULT_ER_TREND) {
      regime = "trending";
      reasons.push(
        `session impulse ER ${sessionEr.toFixed(2)} overrides overnight chop`,
      );
    } else {
      tradeable = false;
      reasons.push(`dead regime (efficiency ${er.toFixed(2)}) — chop, stand aside`);
    }
  }
  if (atrRatio < DEFAULT_MIN_ATR_RATIO) {
    tradeable = false;
    reasons.push(`volatility too low (ATR ratio ${atrRatio.toFixed(2)})`);
  }
  if (atrRatio > DEFAULT_MAX_ATR_RATIO) {
    tradeable = false;
    reasons.push(`volatility too high (ATR ratio ${atrRatio.toFixed(2)})`);
  }
  if (tradeable) {
    reasons.push(`${regime} regime, ${volatility} volatility — environment OK`);
  }

  return {
    regime,
    volatility,
    tradeable,
    er: +er.toFixed(3),
    atrRatio: +atrRatio.toFixed(3),
    reasons,
  };
}
