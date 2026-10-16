/**
 * Weekly cost summary — Edgewonk "Edge Finder" style: where the week's money leaked, priced, from the desk's own
 * measured record. Inputs are the existing outputs of discipline.ts (disciplineScorecard) and analytics.ts
 * (buildAnalytics). Nothing new is scored here.
 *
 * NO BADGES, NO STREAKS, NO COMPOSITE SCORE. discipline.ts already refuses them (Chapkovski et al.: they raise volume,
 * not results). This file prices leaks and says the sample size.
 *
 * Grok may NARRATE the facts built here. Its paragraph is used only if every number in it is one of these facts
 * (ungroundedNumbers); otherwise the deterministic lines go out instead.
 */
import type { DisciplineScorecard } from "./discipline";
import { MIN_READ } from "./discipline";
import type { AnalyticsReport, Bucket } from "./analytics";
import { grokSearch, ungroundedNumbers, type GrokSearchResult } from "@/lib/news/grok-search";

export interface CostFact {
  id: string;
  text: string;
}

export interface WeeklyCost {
  weekStart: string;
  closed: number;
  facts: CostFact[];
  /** The deterministic summary (always available). */
  lines: string[];
  thin: boolean;
}

const money = (x: number) => `${x >= 0 ? "+" : "−"}$${Math.abs(Math.round(x)).toLocaleString("en-US")}`;
const r2 = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}R`;

function worstBucket(bs: Bucket[] | undefined): Bucket | null {
  const list = (bs ?? []).filter((b) => b.n > 0 && Number.isFinite(b.netPnl));
  if (!list.length) return null;
  const w = [...list].sort((a, b) => a.netPnl - b.netPnl)[0]!;
  return w.netPnl < 0 ? w : null;
}

export function buildWeeklyCost(weekStart: string, card: DisciplineScorecard, report: AnalyticsReport | null): WeeklyCost {
  const facts: CostFact[] = [];
  const closed = card.closed;
  if (closed > 0) {
    facts.push({ id: "split", text: `Rules followed: ${card.followed.n} trades, ${money(card.followed.pnl)}. Rules broken: ${card.broken.n}, ${money(card.broken.pnl)}.` });
    const worst = card.byMistake[0];
    if (worst && worst.pnl < 0) facts.push({ id: "mistake", text: `Costliest mistake: ${worst.label.toLowerCase()}, ${worst.n}×, ${money(worst.pnl)} (rule: ${worst.rule}).` });
    const hot = card.byState.filter((s) => s.v >= 4);
    const hotPnl = hot.reduce((s, x) => s + x.pnl, 0);
    const hotN = hot.reduce((s, x) => s + x.n, 0);
    if (hotN > 0) facts.push({ id: "state", text: `Impatient/tilted clicks: ${hotN}, ${money(hotPnl)}.` });
    const against = card.byWord.filter((w) => w.word !== "TAKE");
    const aN = against.reduce((s, x) => s + x.n, 0);
    if (aN > 0) facts.push({ id: "against", text: `Taken when the desk said WAIT or STAND: ${aN}, ${money(against.reduce((s, x) => s + x.pnl, 0))}.` });
  }
  if (report && report.n > 0) {
    const kz = worstBucket(report.byKillzone);
    if (kz) facts.push({ id: "killzone", text: `Worst killzone: ${kz.label}, ${kz.n} trades, ${money(kz.netPnl)}.` });
    const wd = worstBucket(report.byWeekday);
    if (wd) facts.push({ id: "weekday", text: `Worst weekday: ${wd.label}, ${wd.n} trades, ${money(wd.netPnl)}.` });
    const friction = (report.overall.totalCommission ?? 0) + (report.overall.totalSlippage ?? 0);
    if (friction > 0) facts.push({ id: "friction", text: `Commission and slippage: ${money(-friction)}.` });
    const exp = report.overall.expectancyR;
    if (Number.isFinite(exp)) facts.push({ id: "expectancy", text: `Expectancy this week: ${r2(exp)} per trade.` });
  }
  const thin = closed < MIN_READ;
  const lines = facts.length
    ? [...facts.map((f) => f.text), thin ? `n=${closed} closed — a direction, not a rate.` : `n=${closed} closed.`]
    : ["No closed real fills this week — nothing to price."];
  return { weekStart, closed, facts, lines, thin };
}

export const COST_INSTRUCTIONS =
  "You narrate a trader's weekly cost review in three short sentences, plain and unsentimental. Use ONLY the facts given; " +
  "repeat a number only exactly as written in a fact, never compute, round or add one. Lead with the largest leak. " +
  "No praise, badges, streaks, scores, predictions or trade ideas. If the sample is small, say so.";

export async function narrateWeeklyCost(
  w: WeeklyCost,
  search: (a: Parameters<typeof grokSearch>[0]) => Promise<GrokSearchResult> = grokSearch,
): Promise<{ text: string; byModel: boolean; rejected: string | null }> {
  const fallback = w.lines.join(" ");
  if (!w.facts.length) return { text: fallback, byModel: false, rejected: "no facts" };
  const res = await search({ instructions: COST_INSTRUCTIONS, input: w.lines.join("\n"), ms: 15_000, webSearch: false, maxTokens: 260 });
  if (!res.ok) return { text: fallback, byModel: false, rejected: res.error };
  const text = res.text.replace(/\s+/g, " ").trim().slice(0, 700);
  const bad = ungroundedNumbers(text, w.lines);
  if (bad.length) return { text: fallback, byModel: false, rejected: `ungrounded numbers: ${bad.join(", ")}` };
  return { text, byModel: true, rejected: null };
}
