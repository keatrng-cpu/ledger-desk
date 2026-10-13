/**
 * Item 3: overnight 5m history (Yahoo 5d/5m) so Asia (20:00–00:00 ET) and
 * London (02:00–05:00 ET) are readable after the live 1m window rolls past
 * them. Cached per ET day once London has closed (05:00 ET).
 */
import { YAHOO_MAP, parseYahooChart, yahooChart } from "./yahoo";
import type { OhlcBar } from "./types";
import type { IndexSymbol } from "./types";

const cache = new Map<string, OhlcBar[]>();
const etDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
const etMin = (ms: number) => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)); return Number(p.find((x) => x.type === "hour")!.value) * 60 + Number(p.find((x) => x.type === "minute")!.value); };

export async function loadOvernight5m(symbol: IndexSymbol, nowMs = Date.now()): Promise<OhlcBar[]> {
  const key = `${symbol}:${etDay(nowMs)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const j = await yahooChart(YAHOO_MAP[symbol].yahoo, "5d", "5m");
    const bars = j ? parseYahooChart(j).filter((b) => b.t + 300_000 <= nowMs) : [];
    // only cache once London is done; before that, refetch each call
    if (bars.length && etMin(nowMs) >= 300) { cache.clear(); cache.set(key, bars); }
    return bars;
  } catch { return []; }
}
