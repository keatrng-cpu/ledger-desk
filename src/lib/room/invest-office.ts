/**
 * The investment office's read of the Invest tab — pure.
 *
 * Everything the long-game crew says or draws is computed HERE, by code, from the same functions the Invest tab uses
 * (book.ts, policy.ts) and the dated research file (invest-themes.ts). No model, no network, no new policy number: the
 * sleeve targets, the drift band, the sweep ladder and the next-buy rule are the trader's, read as they are. The one input
 * that is new is `other` — income that is not day-trading P&L, with the percentage the trader chose; it is arithmetic only
 * (it never moves money, never writes a ledger entry) and it is null until the trader enters it.
 *
 * Marks: the Floor never fetches prices (the Invest tab fetches closes on request and says so), so the book here is valued
 * at COST and `book.valuedAtCost` says so — a stale mark would be a number the code invented.
 */

import { DRIFT_BAND, type BookRead, type NextBuy, type RebalanceRead } from "@/lib/invest/book";
import { contributionPath, type DeployQueue, type RateLadder } from "@/lib/invest/policy";
import type { InvestLite, InvestThemeLite } from "./live-types";
import { RESEARCH, usableThemes, type ResearchTheme } from "./invest-themes";

export interface InvestInputs {
  /** ET date, YYYY-MM-DD — the day's theme is chosen from it, so the same day always says the same thing. */
  dayKey: string;
  book: BookRead;
  reb: RebalanceRead;
  ladder: RateLadder;
  queue: DeployQueue;
  next: NextBuy;
  /** Tickers in the book. */
  held: string[];
  /** `sweptUsd` of each logged month. */
  sweptMonthly: number[];
  other: { monthlyUsd: number; ratePct: number } | null;
  themes?: ResearchTheme[];
  themesAsOf?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The Invest tab's next-buy line ends "…below — the tab does not pick a company for you", written for someone looking at that
 * tab. On the Floor nobody is, so that one known tail is reworded; every figure and the rest of the line are untouched.
 */
const TAB_TAIL = "Choose among the ADD names below — the tab does not pick a company for you.";
const FLOOR_TAIL = "Which company is the trader's call, from the Invest tab's ADD list — the office never picks one.";
export const floorWords = (line: string): string => line.replace(TAB_TAIL, FLOOR_TAIL);

export function buildInvest(i: InvestInputs): InvestLite {
  const heldSet = new Set(i.held.map((t) => t.toUpperCase()));
  const themes: InvestThemeLite[] = (i.themes ?? usableThemes()).map((t) => ({
    id: t.id,
    name: t.name,
    tier: t.tier,
    horizon: t.horizon,
    summary: t.summary,
    demand: t.demand.map((d) => ({ claim: d.claim, figure: d.figure, asOf: d.asOf, sourceName: d.sourceName })),
    innovations: t.innovations,
    competitors: t.competitors,
    risks: t.risks,
    vehicles: t.vehicles,
    evidence: t.evidence,
    held: t.vehicles.map((v) => v.ticker).filter((tk) => heldSet.has(tk.toUpperCase())),
  }));

  // What a headline has to mention to matter: the book's own tickers, a theme's vehicles, a competitor's name or ticker.
  const watch: InvestLite["watch"] = {};
  const put = (key: string, label: string, kind: "held" | "theme" | "competitor") => {
    const k = key.trim();
    if (k.length >= 3 && !watch[k]) watch[k] = { label, kind };
  };
  for (const tk of heldSet) put(tk, tk, "held");
  for (const t of themes) {
    for (const v of t.vehicles) put(v.ticker.toUpperCase(), t.name, "theme");
    for (const c of t.competitors) {
      put(c.name.toLowerCase(), `${t.name} — ${c.name}`, "competitor");
      const first = c.name.split(/\s+/)[0] ?? "";
      if (first.length >= 5) put(first.toLowerCase(), `${t.name} — ${c.name}`, "competitor");
      if (c.ticker) put(c.ticker.toUpperCase(), `${t.name} — ${c.name}`, "competitor");
    }
  }

  const months = i.sweptMonthly;
  const avg = months.length ? months.reduce((s, x) => s + x, 0) / months.length : null;
  const avgPos = avg != null && avg > 0 ? avg : null;

  return {
    book: {
      totalUsd: i.book.totalUsd,
      positions: i.book.positions.length,
      belowMeaningful: i.book.belowMeaningful,
      valuedAtCost: true,
      sleeves: i.book.sleeves.map((s) => ({ sleeve: s.sleeve, weight: s.weight, target: s.target, driftPct: s.driftPct, correctionUsd: s.correctionUsd })),
      // Under the meaningful line the Invest tab refuses to read drift at all ("too small to rebalance"), so the office does too.
      beyondBand: i.book.belowMeaningful ? 0 : i.book.sleeves.filter((s) => Math.abs(s.driftPct) > DRIFT_BAND).length,
      rebalanceDue: i.reb.due,
      driftBand: DRIFT_BAND,
    },
    funnel: {
      ratePct: Math.round(i.ladder.rate * 100),
      closedMonths: i.ladder.closedMonths,
      sweptUsd: i.queue.sweptUsd,
      waitingUsd: i.queue.waitingUsd,
      avgMonthlyUsd: avgPos != null ? round2(avgPos) : null,
      fiveYearUsd: avgPos != null ? contributionPath(avgPos, 5).totalUsd : null,
      tenYearUsd: avgPos != null ? contributionPath(avgPos, 10).totalUsd : null,
      ladderLine: i.ladder.line,
    },
    next: i.next.usd > 0 ? { ticker: i.next.ticker, sleeve: i.next.sleeve, usd: i.next.usd, line: floorWords(i.next.line) } : null,
    other: i.other && i.other.monthlyUsd > 0 && i.other.ratePct > 0 ? i.other : null,
    themes,
    themesAsOf: i.themesAsOf ?? RESEARCH.asOf,
    watch,
    dayKey: i.dayKey,
  };
}
