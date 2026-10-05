/**
 * THE DESK AUDIT — what the five find wrong with the ledger desk, from the evidence in front of them.
 *
 * The trader's brief: the agents should be "analyzing the ledger desk and looking for fixes it needs". The honest form is a
 * deterministic read of facts the desk already holds — the feed's health, the goal's collisions, the R&D board's verdicts,
 * the ghost room's refusals, the execution layer's flags — turned into a short ranked list with an owner, the evidence line
 * and a proposal for the TRADER. Nothing here edits a rule, a config or a size; nothing calls a model; every number is
 * quoted from the read it came from. An item disappears when its evidence does.
 */

import { EXEC_FLAGS } from "./exec/limits";
import type { Character } from "./orchestrator";
import { CATALYST_MAX_AGE_DAYS, type DataFreshness, type FeedRead, type GoalLite, type LabLite, type RndLite, type SeatsLite } from "./live-types";

export interface AuditItem {
  id: string;
  owner: Character;
  area: "data" | "rules" | "model" | "execution" | "goal" | "process";
  severity: "high" | "med" | "low";
  title: string;
  evidence: string;
  proposal: string;
}

const money = (n: number) => `${n < 0 ? "−" : "+"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const ORDER = { high: 0, med: 1, low: 2 } as const;

/** Whole calendar days from `a` to `b` (YYYY-MM-DD both). */
const ageDays = (a: string, b: string): number => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** The earnings calendar reaches ~14 days ahead; past this age it cannot see the whole window. */
export const EARNINGS_AGEING_DAYS = 14;
/** The dated research file: a pass older than this is a reading of last quarter. */
export const RESEARCH_OLD_DAYS = 60;
export const RESEARCH_STALE_DAYS = 90;
/** The source check is a monthly job. */
export const SOURCE_CHECK_OLD_DAYS = 35;
/** The macro calendar feeds the ±15 min blackout; warn a week before it runs out. */
export const MACRO_RUNWAY_DAYS = 7;

/** Findings about the committed data itself — a snapshot says when it was taken, and its age is a fact. */
function freshnessItems(x: DataFreshness): AuditItem[] {
  const out: AuditItem[] = [];
  const earn = ageDays(x.earningsAsOf, x.today);
  if (earn > CATALYST_MAX_AGE_DAYS)
    out.push({ id: "earnings_stale", owner: "Gemma", area: "data", severity: "med", title: "The earnings calendar is out of date", evidence: `captured ${x.earningsAsOf}, ${earn} days ago; the office stops quoting reports from it after ${CATALYST_MAX_AGE_DAYS}`, proposal: "Re-capture it from Alpha Vantage's EARNINGS_CALENDAR into src/data/earnings-calendar.json and stamp capturedAt. The free key allows 25 requests a day." });
  else if (earn > EARNINGS_AGEING_DAYS)
    out.push({ id: "earnings_ageing", owner: "Gemma", area: "data", severity: "low", title: "The earnings calendar is ageing", evidence: `captured ${x.earningsAsOf}, ${earn} days ago; report dates past two weeks out were provisional when it was taken`, proposal: "Re-capture it from Alpha Vantage's EARNINGS_CALENDAR before the next fortnight's reports are the ones that matter." });
  const research = ageDays(x.researchAsOf, x.today);
  if (research > RESEARCH_OLD_DAYS)
    out.push({ id: "research_old", owner: "Jax", area: "data", severity: research > RESEARCH_STALE_DAYS ? "med" : "low", title: "The research file is old", evidence: `src/data/invest-themes.json is as of ${x.researchAsOf}, ${research} days ago; every figure on the research TVs is that old`, proposal: "Re-run the dated research pass from primary pages only, then run scripts/check-research-sources.mjs --write." });
  const sc = x.sourceCheck;
  if (!sc)
    out.push({ id: "sources_unchecked", owner: "Gemma", area: "data", severity: "low", title: "The research figures have no source check on record", evidence: "there is no src/data/source-check-report.json", proposal: "Run scripts/check-research-sources.mjs --write; it tests every quoted figure against its cited page and needs the network." });
  else {
    if (sc.findings > 0)
      out.push({ id: "sources_unmatched", owner: "Gemma", area: "data", severity: "med", title: "Figures that are not on their cited pages", evidence: `${sc.findings} of ${sc.facts} at the check on ${sc.checkedAt}`, proposal: "Open each one in src/data/source-check-report.json and decide whether the page moved or the figure was mistyped; the research TVs quote them." });
    if (ageDays(sc.checkedAt, x.today) > SOURCE_CHECK_OLD_DAYS)
      out.push({ id: "sources_old", owner: "Gemma", area: "data", severity: "low", title: "The source check is more than a month old", evidence: `last run ${sc.checkedAt}, ${ageDays(sc.checkedAt, x.today)} days ago`, proposal: "Run scripts/check-research-sources.mjs --write; live pages move." });
    else if (sc.researchAsOf != null && sc.researchAsOf !== x.researchAsOf)
      out.push({ id: "sources_behind", owner: "Gemma", area: "data", severity: "low", title: "The research file changed after its source check", evidence: `the check was of the ${sc.researchAsOf} file; the file is now ${x.researchAsOf}`, proposal: "Run scripts/check-research-sources.mjs --write on the current file." });
  }
  if (x.macroCalendarEnds == null)
    out.push({ id: "macro_empty", owner: "Gemma", area: "data", severity: "high", title: "There is no macro calendar", evidence: "src/data/news-calendar.json has no events, so the ±15 min news blackout has nothing to read", proposal: "Stamp the official BLS, BEA, Census, ISM and Fed schedules into it (official schedules only)." });
  else {
    const runway = ageDays(x.today, x.macroCalendarEnds);
    if (runway < 0)
      out.push({ id: "macro_ended", owner: "Gemma", area: "data", severity: "high", title: "The macro calendar has run out", evidence: `its last event was ${x.macroCalendarEnds}, ${-runway} day${runway === -1 ? "" : "s"} ago; the news blackout cannot see a release since`, proposal: "Stamp the official BLS, BEA, Census, ISM and Fed schedules into src/data/news-calendar.json (official schedules only)." });
    else if (runway < MACRO_RUNWAY_DAYS)
      out.push({ id: "macro_ending", owner: "Gemma", area: "data", severity: "med", title: "The macro calendar is about to run out", evidence: `its last event is ${x.macroCalendarEnds}${runway === 0 ? ", today" : `, ${runway} day${runway === 1 ? "" : "s"} from now`}; the news blackout reads nothing after it`, proposal: "Stamp the next releases from the official BLS, BEA, Census, ISM and Fed schedules into src/data/news-calendar.json (official schedules only)." });
  }
  return out;
}

export function deskAudit(a: { feed: FeedRead | null; goal: GoalLite | null; lab: LabLite | null; rnd: RndLite | null; seats: SeatsLite | null; fresh?: DataFreshness | null }): AuditItem[] {
  const out: AuditItem[] = [];
  if (a.fresh) out.push(...freshnessItems(a.fresh));
  const f = a.feed;
  if (f) {
    if (f.kind === "synthetic" || f.kind === "none")
      out.push({ id: "feed_dark", owner: "Vince", area: "data", severity: "high", title: "No real prices", evidence: f.kind === "synthetic" ? "the desk's feed is synthetic" : "no feed has printed", proposal: "Start the live gateway (gateway/databento_live_gateway.py) or confirm the Yahoo/Databento keys; nothing priced on this desk is real until a feed prints." });
    else if (f.kind === "yahoo" && (f.lagSec ?? 0) >= 300)
      out.push({ id: "feed_late", owner: "Vince", area: "data", severity: "med", title: "Prices run behind", evidence: `Yahoo futures are ${Math.round((f.lagSec ?? 0) / 60)} min late`, proposal: "The CE-touch alarm and every level exit read this tape. The Databento live gateway (sub-second) is what makes them honest." });
  }
  const g = a.goal;
  if (g) {
    for (const c of g.collisions) {
      if (!c.ask || c.severity === "info") continue;
      out.push({ id: `goal_${c.id}`, owner: "Sterling", area: "goal", severity: c.severity === "blocker" ? "high" : "med", title: c.title, evidence: c.detail.length > 160 ? `${c.detail.slice(0, 157)}…` : c.detail, proposal: c.decision ?? "A number the trader owns." });
    }
    if (g.status === "running" && g.pTarget < 0.001)
      out.push({ id: "goal_odds", owner: "Nova", area: "goal", severity: "med", title: "The goal is not on the table", evidence: `exact odds ${g.pTarget <= 0 ? "zero" : g.pTarget < 0.00001 ? "under 0.001%" : `${(g.pTarget * 100).toFixed(3)}%`} on the measured numbers; ${(g.pNoCard * 100).toFixed(0)}% that no card prints at all${g.winsNeed != null && g.winsNeed > g.tradeBudget ? `; it takes ${g.winsNeed} winners in a row and the desk allows ${g.tradeBudget} tickets` : ""}`, proposal: g.needed.pWin != null ? `It would take ${(g.needed.pWin * 100).toFixed(0)}% winners${g.needed.lambdaMultiple != null ? ` or ${g.needed.lambdaMultiple.toFixed(1)}× the cards` : ""}. Move the target, the window or the evidence — not the gates.` : "No win rate within reach gets there on this many cards. Move the target or the window — not the gates." });
  }
  const l = a.lab;
  if (l) {
    for (const r of l.refusals) {
      if (r.n >= 5 && r.pnlUsd > 0)
        out.push({ id: `gate_${r.gate}`, owner: "Sterling", area: "rules", severity: "low", title: `The ${r.gate} gate is costing money`, evidence: `${r.n} refused tickets would have made ${money(r.pnlUsd)} on the model`, proposal: "Small sample, live-forward. Re-test the gate on the four-year capture (z ≥ 2.87) before touching it." });
    }
    if (l.calibration && l.calibration.n >= 30 && l.calibration.meanP != null && l.calibration.hitRate != null && Math.abs(l.calibration.meanP - l.calibration.hitRate) > 0.1 + 1e-9)
      out.push({ id: "odds_gap", owner: "Nova", area: "model", severity: "med", title: "The card's odds are off", evidence: `said ${(l.calibration.meanP * 100).toFixed(0)}%, T1 printed ${(l.calibration.hitRate * 100).toFixed(0)}% over ${l.calibration.n} plans`, proposal: "Recalibrate hit-odds on the four-year capture (scripts/build-hit-odds.mjs), not live." });
  }
  const dead = Object.entries(EXEC_FLAGS).filter(([, v]) => !v).map(([k]) => k);
  if (dead.includes("SERVER_RUNNER_BUILT"))
    out.push({ id: "runner", owner: "Vince", area: "execution", severity: "med", title: "Nothing manages a position with the tab closed", evidence: "SERVER_RUNNER_BUILT is false: paper positions are managed by an open browser; only the 15:30 flatten has a server cron", proposal: "A scheduled server function that builds the desk and steps the room is what live trading needs; until then keep a tab open or stay on paper." });
  if (a.rnd) {
    const decided = a.rnd.experiments.filter((e) => e.status !== "collecting").length;
    if (decided === 0 && a.rnd.experiments.length)
      out.push({ id: "rnd_empty", owner: "Nova", area: "process", severity: "low", title: "No experiment has enough data yet", evidence: `${a.rnd.experiments.length} are collecting (${a.rnd.experiments.map((e) => `${e.n}/${e.nNeeded}`).join(", ")})`, proposal: "The fastest way to learn is more qualifying tickets — the desk only offers about one in five sessions, so the window is the limit." });
  }
  const s = a.seats;
  if (s && s.touches >= 3) {
    const idle = s.rows.filter((r) => r.taken.n === 0 && r.declined.n === 0 && r.id !== "room");
    if (idle.length >= 2)
      out.push({ id: "idle_seats", owner: "Jax", area: "process", severity: "low", title: "Seats that never trade", evidence: `${idle.map((r) => r.name).join(" and ")} took or declined nothing in ${s.touches} touches`, proposal: "Their size or style cannot buy a contract at this price. That is information about the policy, not a reason to loosen a gate." });
  }
  return out.sort((x, y) => ORDER[x.severity] - ORDER[y.severity]);
}
