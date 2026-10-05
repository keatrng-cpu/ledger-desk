/**
 * Reading an `InvestLite` — pure, and free of the research file, so the talk engine and the voices depend on types only.
 * (invest-office.ts builds the InvestLite and is the one module that loads the dated research JSON.)
 */

import { hash32, type InvestLite, type InvestThemeLite, type InvestTier } from "./live-types";

export type WatchHit = { key: string; label: string; kind: "held" | "theme" | "competitor" };

/** How many of each research tier have a vehicle in the book. */
export function tierCoverage(inv: InvestLite): { tier: InvestTier; themes: number; covered: number }[] {
  return (["safe", "mid", "high"] as InvestTier[]).map((tier) => {
    const ts = inv.themes.filter((t) => t.tier === tier);
    return { tier, themes: ts.length, covered: ts.filter((t) => t.held.length > 0).length };
  });
}

/** The day's theme: the same ET date always picks the same one; `offset` walks the rotation for a second look later in the day. */
export function themeOfTheDay(inv: InvestLite, offset = 0): InvestThemeLite | null {
  if (!inv.themes.length) return null;
  return inv.themes[(hash32(inv.dayKey) + offset) % inv.themes.length] ?? null;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first watched name a headline mentions, or null. Tickers must match as whole upper-case words; names as lower-case words. Held beats theme beats competitor. */
export function watchHit(inv: InvestLite, title: string, tickers: string[]): WatchHit | null {
  const lower = title.toLowerCase();
  const up = new Set(tickers.map((t) => t.toUpperCase()));
  let best: WatchHit | null = null;
  const rank = { held: 0, theme: 1, competitor: 2 } as const;
  for (const [key, v] of Object.entries(inv.watch)) {
    const isTicker = key === key.toUpperCase() && !/\s/.test(key);
    const hit = isTicker ? up.has(key) || new RegExp(`(^|[^A-Za-z])${esc(key)}([^A-Za-z]|$)`).test(title) : new RegExp(`(^|[^a-z])${esc(key)}([^a-z]|$)`).test(lower);
    if (hit && (!best || rank[v.kind] < rank[best.kind])) best = { key, label: v.label, kind: v.kind };
  }
  return best;
}

/**
 * The day's two theme looks, in minutes after ET midnight: after the live window on a weekday, mid-morning and mid-afternoon
 * on a weekend. The talk engine fires them and the TVs show the same theme — both read this one function.
 */
export const investLooks = (weekday: boolean): [number, number] => (weekday ? [12 * 60 + 30, 14 * 60 + 30] : [10 * 60 + 30, 15 * 60]);

/** Which look is current at this ET minute: 0 = the day's first theme, 1 = the second look. */
export const lookAt = (etMin: number, weekday: boolean): 0 | 1 => (etMin >= investLooks(weekday)[1] ? 1 : 0);

export interface AgendaItem {
  kind: "waiting" | "rebalance" | "drift" | "small";
  usd?: number;
}

/** What the board has in front of it. The voice and the TV both read this — one list, two renderings. */
export function boardAgenda(inv: InvestLite): AgendaItem[] {
  const out: AgendaItem[] = [];
  if (inv.funnel.waitingUsd > 0) out.push({ kind: "waiting", usd: inv.funnel.waitingUsd });
  if (inv.book.rebalanceDue) out.push({ kind: "rebalance" });
  else if (inv.book.beyondBand > 0) out.push({ kind: "drift" });
  if (inv.book.positions > 0 && inv.book.belowMeaningful) out.push({ kind: "small" });
  return out;
}
