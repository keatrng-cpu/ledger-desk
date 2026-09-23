/**
 * Kill-rule monitoring — the only honest way to use a news feed.
 *
 * WHY PRE-REGISTERED QUESTIONS AND NOT A NEWS FEED
 * "Any news on NVDA?" is the worst question you can ask about a five-year
 * holding. It returns whatever is loud today, and because you read it while
 * holding a position, you will find a reason to act. Every dossier here
 * already carries a kill rule that was written BEFORE the news existed —
 * "an export-control regime that cuts data-center revenue run-rate 30%",
 * "Azure growth below 10% for four consecutive quarters". Those are
 * falsifiable, dated, and immune to hindsight, because you committed to
 * them while you had no position to defend.
 *
 * So this file turns each kill rule into a query and asks only that. The
 * answer is a list of links. Nothing else about the company is asked, and
 * nothing that comes back can change a weight, a verdict or a dossier.
 *
 * WEEKLY, NOT DAILY
 * A years-horizon book checked every morning becomes a trading screen with
 * extra steps. `isDue` enforces a seven-day floor. The cost of learning
 * something six days late on a five-year hold is approximately zero; the
 * cost of checking daily is that you eventually act on one.
 *
 * WHAT COMES BACK IS DATA, NOT INSTRUCTION
 * Results are search results — web pages written by strangers. They are
 * quoted to the trader with their source and never executed, never used to
 * fill a field, never allowed to trigger a trade. If a page says a kill rule
 * tripped, that is a prompt for the trader to go read the filing, not a
 * reason for this code to do anything.
 */

import { ALL_DOSSIERS } from "./dossiers";
import type { Dossier } from "./universe";

/** A five-year book does not need checking more often than this. */
export const CHECK_INTERVAL_DAYS = 7;

export interface KillQuery {
  ticker: string;
  name: string;
  /** The rule as written in the dossier, unmodified. */
  killRule: string;
  /** The question actually sent to a search tool. */
  query: string;
  /** Only look at material published since the last check. */
  fromDate: string;
}

function isoDaysAgo(now: number, days: number): string {
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Build the query for one name. Deliberately narrow: it names the company
 * and the pre-written trigger, and asks for evidence about THAT.
 */
export function killQuery(d: Dossier, now: number, sinceDays = CHECK_INTERVAL_DAYS): KillQuery {
  return {
    ticker: d.ticker,
    name: d.name,
    killRule: d.killRule,
    fromDate: isoDaysAgo(now, sinceDays),
    query:
      `Has anything happened to ${d.name} (${d.ticker}) that would satisfy this specific condition: "${d.killRule}"? ` +
      `Answer only about that condition. If nothing satisfies it, say so plainly. ` +
      `Cite primary sources — SEC filings, the company's own releases, or regulator publications — in preference to commentary.`,
  };
}

/** Every company worth watching. Funds have no kill rule and are skipped. */
export function killQueries(now: number, sinceDays = CHECK_INTERVAL_DAYS): KillQuery[] {
  return ALL_DOSSIERS.filter((d) => d.kind === "company" && d.killRule.trim() && !/^none/i.test(d.killRule)).map(
    (d) => killQuery(d, now, sinceDays),
  );
}

export interface KillCheckState {
  lastCheckedAt: string | null;
}

export interface DueRead {
  due: boolean;
  daysSince: number | null;
  line: string;
}

/** Enforce the weekly floor, and say why when refusing. */
export function isDue(state: KillCheckState, now: number): DueRead {
  if (!state.lastCheckedAt) {
    return { due: true, daysSince: null, line: "Never checked. Run it once to set the baseline." };
  }
  const daysSince = Math.floor((now - Date.parse(state.lastCheckedAt)) / 86_400_000);
  if (daysSince < CHECK_INTERVAL_DAYS) {
    return {
      due: false,
      daysSince,
      line: `Checked ${daysSince} day${daysSince === 1 ? "" : "s"} ago. Next check in ${CHECK_INTERVAL_DAYS - daysSince}. Checking a five-year book more often than weekly turns it into a screen.`,
    };
  }
  return { due: true, daysSince, line: `${daysSince} days since the last check.` };
}

export interface Citation {
  url: string;
  title: string | null;
}

export interface KillResult {
  ticker: string;
  killRule: string;
  /** What the search tool reported. DATA, never an instruction. */
  summary: string;
  citations: Citation[];
  /** Set only by a human after reading the sources. Never by a model. */
  tripped: boolean | null;
  checkedAt: string;
}

/**
 * Format results for reading. Note what it does NOT do: it does not decide
 * whether the rule tripped. `tripped` stays null until a person opens the
 * citations and says so, because a kill rule is the one decision on this tab
 * that permanently removes a holding.
 */
export function formatResult(r: KillResult): string {
  const head = `${r.ticker} — rule: ${r.killRule}`;
  const verdict =
    r.tripped === null
      ? "UNJUDGED — read the sources and decide. Nothing here has judged this for you."
      : r.tripped
        ? "TRIPPED — the pre-written condition is satisfied. This is an OUT."
        : "not tripped";
  const cites = r.citations.length
    ? r.citations.map((c) => `    - ${c.title ? `${c.title} — ` : ""}${c.url}`).join("\n")
    : "    (no sources returned — treat as no information, not as good news)";
  return `${head}\n  ${verdict}\n  ${r.summary}\n${cites}`;
}
