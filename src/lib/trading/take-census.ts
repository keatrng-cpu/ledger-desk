/**
 * Is the sequence too tight, or is the 15m close the wrong clock?
 *
 * THE QUESTION THIS EXISTS TO SETTLE
 * A 63-day replay of closed 15m bars prints ZERO takes on both books
 * (`gate-tuning.ts`, 18 variants). Two explanations fit that equally well and
 * they demand opposite actions:
 *
 *   A. The gate is genuinely too tight. Something must be loosened.
 *   B. The 15m CLOSE is the wrong clock. The desk polls every 20 seconds and
 *      can see price inside the array mid-bar; a condition that is true for
 *      six minutes and false at the close is a TAKE the replay cannot see.
 *
 * Guessing wrong is expensive in both directions — loosening a correct gate
 * costs money on every trade after, and leaving a mis-clocked gate costs every
 * trade that never happened.
 *
 * WHY THE RULE IS WRITTEN DOWN BEFORE THE DATA
 * Because the desk's own record says what happens otherwise. This file already
 * shipped a false green flash whose verifier passed 126/126, and a score
 * display whose verifier passed 135/135 while skipping exactly the cases that
 * were wrong. Both survived because the check was written by the same mind,
 * after the fact, against what it expected to see.
 *
 * A census read after the fact has the same failure mode and no compiler to
 * catch it: "12 takes a week" reads as vindication on a hopeful day and as
 * noise on a sceptical one. So the thresholds and the conclusion each outcome
 * FORCES are fixed here, dated, before a single poll is recorded. Changing
 * them later is allowed — but it is a visible edit to a file with this comment
 * in it, not a quiet reinterpretation.
 *
 * NOTHING HERE LOOSENS A GATE. It produces a verdict a human then acts on.
 * This module imports no gate constants at all — not the confluence floor, not
 * the tuning knobs. `verify-take-census.mjs` asserts that against the source
 * text, so the guarantee survives an edit that only means well.
 */

import type { SmcMasterBook } from "./smc-master";

/* ────────────────────────────────────────────────────────────────────────────
 * THE PRE-REGISTRATION — fixed 2026-09-24, before any poll was recorded.
 * ────────────────────────────────────────────────────────────────────────── */

export const PRE_REGISTERED = {
  registeredAt: "2026-09-24",

  /**
   * Minimum polls before ANY verdict is reported.
   *
   * At a 20s poll across a 2h NY AM window that is 360 polls a day, so this is
   * about two trading weeks. Chosen for calendar coverage rather than for
   * statistical power: one week can be one regime, and the failure being
   * measured is a session-shape failure.
   */
  minPolls: 3_000,

  /** Distinct sessions required, so the sample is not one unusual week. */
  minSessions: 8,

  /**
   * Live TAKE frequency, in takes per trading week, that would make the
   * 15m-close replay the WRONG CLOCK rather than the gate too tight.
   *
   * Anchored to CLAUDE.md's own budget, not picked to be reachable: the desk
   * allows ~9 PATH trades a month and a maximum of 2 per killzone. Nine a
   * month is ~2.1 a week, so a live rate at or above 2/week means the gate is
   * already producing as much as the risk budget can spend, and the replay's
   * zero is a measurement artefact of the closed-bar clock.
   */
  clockNotGateTakesPerWeek: 2.0,

  /**
   * At or below this, the live clock agrees with the replay: the gate really
   * does refuse almost everything, and the binding layer is a real constraint
   * rather than a timing artefact.
   */
  gateTooTightTakesPerWeek: 0.5,

  /**
   * Between the two thresholds the answer is UNDECIDED and the correct action
   * is to keep collecting. This band exists so that a middling result cannot
   * be read as support for whichever change was already wanted.
   */

  /**
   * A layer that blocks more than this share of polls is the BINDING layer.
   * Naming it is the actionable output: "retrace blocks 71% of polls" is a
   * decision, "the gate is tight" is a mood.
   */
  bindingLayerShare: 0.5,

  /**
   * Polls whose data is older than this are excluded from the census entirely.
   *
   * A 600s-lagged Yahoo quote cannot answer an intrabar timing question — it
   * IS the closed-bar clock, ten minutes late. Including those polls would
   * measure the lag and call it the gate. This is the single most important
   * exclusion here and it is why `lagSec` and `source` are recorded per poll.
   */
  maxLagSec: 120,

  /**
   * The shadow book is the other half. A live TAKE rate is only good news if
   * the refusals it would have converted were actually profitable — the
   * shadow book already paper-trades every refusal both ways.
   *
   * If the live rate clears `clockNotGateTakesPerWeek` but shadow expectancy
   * on those same cards is <= 0, the verdict is NOT "loosen": it is "the
   * clock was wrong AND the trades were not worth taking", which argues for
   * fixing the clock and changing nothing else.
   */
  requireShadowPositive: true,
} as const;

/**
 * What each outcome FORCES. Written before the data so that reading the
 * result is not a negotiation.
 */
export const PRE_REGISTERED_CONCLUSIONS = {
  clock_not_gate:
    "The 15m close is the wrong clock. Fix the measurement — grade on the live poll, and re-run the gate sweep against intrabar state. Do NOT loosen any gate on this evidence; the gate was never the thing being measured.",
  gate_too_tight:
    "The live clock agrees with the replay. The binding layer is a real constraint, not a timing artefact. Any change is a deliberate, measured, one-layer-at-a-time decision by the trader — and CLAUDE.md's 0.65 floor is not on the table.",
  undecided:
    "Between the thresholds. Keep collecting. A middling result is not evidence for whichever change was already wanted.",
  insufficient:
    "Not enough clean polls yet. No verdict is reported, deliberately — a rate computed from a handful of polls is the kind of number that gets acted on and should not exist.",
  clock_wrong_trades_bad:
    "The live clock would have produced takes, but the shadow book says those cards were not worth taking. Fix the clock; change nothing about the gates. This is the outcome most easily misread as permission to loosen.",
} as const;

export type CensusVerdict = keyof typeof PRE_REGISTERED_CONCLUSIONS;

/* ────────────────────────────────────────────────────────────────────────────
 * THE RECORD
 * ────────────────────────────────────────────────────────────────────────── */

export interface PollRecord {
  /** Epoch ms of the poll. */
  t: number;
  /** ET session date key, so sessions can be counted without a timezone lib. */
  session: string;
  symbol: string;
  side: "long" | "short" | null;
  word: SmcMasterBook["word"];
  /** Must-layers passing, and how many are needed. */
  mustPass: number;
  mustNeed: number;
  /** The first layer not passing — the thing being waited on. */
  missingLayer: string | null;
  /** Quote age at the moment of the poll. The exclusion criterion. */
  lagSec: number;
  source: string;
  /** The engine's number, for cross-referencing against the sequence word. */
  confluence: number | null;
}

export interface LayerBlock {
  layer: string;
  polls: number;
  share: number;
  binding: boolean;
}

export interface Census {
  /** Polls that cleared the lag exclusion. */
  polls: number;
  /** Polls thrown out for stale data, and why that matters. */
  excludedStale: number;
  sessions: number;
  takes: number;
  /** Distinct (session, symbol, side) TAKE episodes — consecutive polls of one
   *  TAKE are ONE opportunity, not forty. */
  takeEpisodes: number;
  takesPerWeek: number | null;
  byLayer: LayerBlock[];
  bindingLayer: string | null;
  /** Median lag across the counted polls, so the census can be trusted. */
  medianLagSec: number | null;
  /**
   * The census is recording polls and counting none of them.
   *
   * This is the failure mode that looks like patience. Every poll gets stored,
   * the panel shows a tidy zero, and a fortnight later there is still no
   * verdict — because without the gateway up the quotes are ~600s-lagged
   * Yahoo, every one is excluded, and the measurement was never running.
   *
   * Starving is NOT the same as early. Early means the sample is filling;
   * starving means it cannot fill at all until something changes.
   */
  starving: boolean;
  starvingLine: string | null;
  verdict: CensusVerdict;
  /** The pre-registered sentence for that verdict, verbatim. */
  conclusion: string;
  line: string;
}

const WEEK_MS = 7 * 24 * 3_600_000;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Count the polls and apply the pre-registered rule.
 *
 * Pure. `shadowExpR` is the shadow book's expectancy on the refused cards; it
 * is passed in rather than imported so this module cannot accidentally become
 * a second opinion about the shadow book.
 */
export function census(records: PollRecord[], shadowExpR?: number | null): Census {
  const fresh = records.filter((r) => r.lagSec <= PRE_REGISTERED.maxLagSec);
  const excludedStale = records.length - fresh.length;

  const sessions = new Set(fresh.map((r) => r.session)).size;
  const takes = fresh.filter((r) => r.word === "TAKE").length;

  // Consecutive TAKE polls on the same book are ONE opportunity. Counting raw
  // polls would report a single 12-minute TAKE as 36 takes and turn any
  // threshold into a formality.
  let takeEpisodes = 0;
  const lastTake = new Map<string, number>();
  const EPISODE_GAP_MS = 30 * 60_000;
  for (const r of [...fresh].sort((a, b) => a.t - b.t)) {
    if (r.word !== "TAKE") continue;
    const key = `${r.session}|${r.symbol}|${r.side ?? "?"}`;
    const prev = lastTake.get(key);
    if (prev == null || r.t - prev > EPISODE_GAP_MS) takeEpisodes++;
    lastTake.set(key, r.t);
  }

  const span =
    fresh.length > 1
      ? Math.max(...fresh.map((r) => r.t)) - Math.min(...fresh.map((r) => r.t))
      : 0;
  // Calendar weeks, floored at a week so a three-day sample cannot be
  // annualised into a flattering rate.
  const weeks = span > 0 ? Math.max(1, span / WEEK_MS) : 0;
  const takesPerWeek = weeks > 0 ? +(takeEpisodes / weeks).toFixed(2) : null;

  const counts = new Map<string, number>();
  for (const r of fresh) {
    if (r.word === "TAKE" || !r.missingLayer) continue;
    counts.set(r.missingLayer, (counts.get(r.missingLayer) ?? 0) + 1);
  }
  const blocking = fresh.length - takes;
  const byLayer: LayerBlock[] = [...counts.entries()]
    .map(([layer, polls]) => ({
      layer,
      polls,
      share: blocking > 0 ? +(polls / blocking).toFixed(3) : 0,
      binding: blocking > 0 && polls / blocking >= PRE_REGISTERED.bindingLayerShare,
    }))
    .sort((a, b) => b.polls - a.polls);
  const bindingLayer = byLayer.find((l) => l.binding)?.layer ?? null;

  let verdict: CensusVerdict;
  if (fresh.length < PRE_REGISTERED.minPolls || sessions < PRE_REGISTERED.minSessions) {
    verdict = "insufficient";
  } else if (takesPerWeek == null) {
    verdict = "insufficient";
  } else if (takesPerWeek >= PRE_REGISTERED.clockNotGateTakesPerWeek) {
    // The one branch that could be misread as permission to loosen.
    verdict =
      PRE_REGISTERED.requireShadowPositive && shadowExpR != null && shadowExpR <= 0
        ? "clock_wrong_trades_bad"
        : "clock_not_gate";
  } else if (takesPerWeek <= PRE_REGISTERED.gateTooTightTakesPerWeek) {
    verdict = "gate_too_tight";
  } else {
    verdict = "undecided";
  }

  const need = Math.max(0, PRE_REGISTERED.minPolls - fresh.length);
  const line =
    verdict === "insufficient"
      ? `${fresh.length} clean polls over ${sessions} session(s) — ${need} more and ${Math.max(0, PRE_REGISTERED.minSessions - sessions)} more session(s) before a verdict is reported.`
      : `${takeEpisodes} TAKE episode(s) in ${fresh.length} clean polls over ${sessions} sessions = ${takesPerWeek}/week.` +
        (bindingLayer ? ` Binding layer: ${bindingLayer}.` : "") +
        (excludedStale > 0
          ? ` ${excludedStale} poll(s) excluded as stale (>${PRE_REGISTERED.maxLagSec}s) — a lagged quote is the closed-bar clock late, not an intrabar read.`
          : "");

  // Starving: polls ARE arriving and essentially none survive the lag gate.
  // The 0.8 share (rather than 1.0) catches a partly-covered session, where a
  // gateway that ran for twenty minutes hides the fact that the rest of the
  // window collected nothing.
  const staleShare = records.length > 0 ? excludedStale / records.length : 0;
  const starving = records.length >= 20 && staleShare >= 0.8;
  const starvingLine = starving
    ? `${Math.round(staleShare * 100)}% of polls are being excluded as stale — the census is recording and counting almost nothing. ` +
      `That is the gateway being down, not the sample being young: Yahoo lags ~600s and cannot answer an intrabar question. ` +
      `Start the gateway for NY AM (08:15–11:30 ET) or this never reaches a verdict.`
    : null;

  return {
    polls: fresh.length,
    excludedStale,
    starving,
    starvingLine,
    sessions,
    takes,
    takeEpisodes,
    takesPerWeek,
    byLayer,
    bindingLayer,
    medianLagSec: median(fresh.map((r) => r.lagSec)),
    verdict,
    conclusion: PRE_REGISTERED_CONCLUSIONS[verdict],
    line,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * STORAGE — append-only, client-side.
 * ────────────────────────────────────────────────────────────────────────── */

export const CENSUS_STORAGE = "ledger-take-census-v1";
/** ~2 weeks of NY AM polling at 20s. Oldest are dropped first. */
export const CENSUS_MAX = 8_000;

export function loadCensus(): PollRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CENSUS_STORAGE);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PollRecord[]) : [];
  } catch {
    return [];
  }
}

/**
 * Append one poll.
 *
 * Deduplicated on (t, symbol) because the desk re-renders more often than it
 * polls, and a census that counted renders would report whatever the render
 * rate happened to be.
 */
export function recordPoll(r: PollRecord): void {
  if (typeof window === "undefined") return;
  try {
    const all = loadCensus();
    const last = all[all.length - 1];
    if (last && last.t === r.t && last.symbol === r.symbol) return;
    all.push(r);
    const trimmed = all.length > CENSUS_MAX ? all.slice(all.length - CENSUS_MAX) : all;
    localStorage.setItem(CENSUS_STORAGE, JSON.stringify(trimmed));
  } catch {
    // A full quota must never break the desk. Losing census rows is a lost
    // measurement; throwing here would be a lost session.
  }
}
