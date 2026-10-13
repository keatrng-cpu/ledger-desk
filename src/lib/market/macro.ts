/**
 * Fix 5 / item 2: DXY (Yahoo DX-Y.NYB) and the 10y yield (Yahoo ^TNX, ZN=F
 * futures as fallback) — same Yahoo chart path as the index feed. Null when
 * no source answers; never synthesized. 60 s cache.
 */
import { parseYahooChart, yahooChart } from "./yahoo";
import type { OhlcBar } from "./types";

export interface MacroRead { dxyPct: number | null; tnxPct: number | null; source: { dxy: string | null; tnx: string | null }; risk: "risk-off" | "risk-on" | "mixed" | null; asOfMs: number }
let cache: { at: number; v: MacroRead } | null = null;

async function dayPct(sym: string, invert = false): Promise<number | null> {
  try {
    const j = await yahooChart(sym, "1d", "5m");
    if (!j) return null;
    const bars: OhlcBar[] = parseYahooChart(j);
    const m = j.chart?.result?.[0]?.meta as { chartPreviousClose?: number; regularMarketPrice?: number } | undefined;
    const prev = m?.chartPreviousClose;
    const last = m?.regularMarketPrice ?? bars[bars.length - 1]?.c;
    if (!(prev && last)) return null;
    const pct = ((last - prev) / prev) * 100;
    return +(invert ? -pct : pct).toFixed(3);
  } catch { return null; }
}

/** DXY up ≥0.25% AND 10y yield up ≥1% → risk-off; both down the same → risk-on. */
export function macroRisk(dxyPct: number | null, tnxPct: number | null): MacroRead["risk"] {
  if (dxyPct == null || tnxPct == null) return null;
  if (dxyPct >= 0.25 && tnxPct >= 1) return "risk-off";
  if (dxyPct <= -0.25 && tnxPct <= -1) return "risk-on";
  return "mixed";
}

export async function loadMacro(nowMs = Date.now()): Promise<MacroRead> {
  if (cache && nowMs - cache.at < 60_000) return cache.v;
  const dxy = await dayPct("DX-Y.NYB");
  let tnx = await dayPct("^TNX");
  let tnxSrc: string | null = tnx != null ? "^TNX" : null;
  // ZN=F is a PRICE: yields move opposite. Its % is ~1/8 of the yield's %, so scale it ×8 (duration ≈ 8) — labelled.
  if (tnx == null) { const zn = await dayPct("ZN=F", true); if (zn != null) { tnx = +(zn * 8).toFixed(3); tnxSrc = "ZN=F (inverted ×8)"; } }
  const v: MacroRead = { dxyPct: dxy, tnxPct: tnx, source: { dxy: dxy != null ? "DX-Y.NYB" : null, tnx: tnxSrc }, risk: macroRisk(dxy, tnx), asOfMs: nowMs };
  cache = { at: nowMs, v };
  return v;
}
