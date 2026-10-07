/**
 * THE GOAL — $1,000 → $5,000 in one to two weeks of live options, planned honestly.
 *
 * The trader's goal (2026-10-05): once Alpaca is set up, turn $1,000 of live capital into $5,000 within one to two
 * weeks. The five are asked to plan it together and to react to the market as they do. This module is the part of
 * that which must be exact, so it is code and not conversation: what the goal requires, what the desk's own measured
 * numbers say about reaching it, which of the desk's rules collide with it, and what today would have to give.
 * The people narrate it (live-talk.ts); nothing here is read off a model.
 *
 * HOW THE ODDS ARE COMPUTED — exact, not sampled
 * A path is a sequence of trades, each one a win (+W of the debit) or a loss (−L of the debit); how many contracts
 * a trade buys depends on the equity at that moment, so order matters and a Monte Carlo would add sampling noise to a
 * probability that is already tiny. The state space is small (a handful of trades, two outcomes each), so the
 * probability of every path is enumerated: a day-by-day dynamic programme over (equity, trades used), merging equal
 * equities. `pTarget`, `pFloor` and the end-equity quantiles are exact for the model — no seed, no noise, and a
 * brute-force enumeration in the verifier agrees with it to 1e-12.
 *
 * WHERE THE MODEL'S NUMBERS COME FROM — all measured on this desk, none chosen to make the goal look reachable
 *   win rate and mean return per trade  src/data/room-ev-test.json — 146 filled NY AM cards priced as ATM 1 DTE
 *                                       options on four years of real tape: win rate 31.5%, mean −2.1% of the premium
 *   loss size                            the trader's −20% backstop (mandate.ts) — the premium lost when the plan fails
 *   win size                             solved so the model's mean return equals the measured mean (so a measured
 *                                       −2.1% edge cannot be hidden inside a generous win size)
 *   opportunities per session            src/data/evidence-dist.json perWeek (6.4 filled in-band cards a week, both
 *                                       books, all sessions) × the share filled inside NY AM (room-time-odds.json:
 *                                       202 of 1332) ÷ 5 sessions — about one a week, which is ALL the room can take:
 *                                       it trades 09:45–11:00 only
 * THE MODEL IS A REFERENCE, NOT A FORECAST. It prices the option on the plan as the desk measured it; the Execution
 * card's shadow phase is what will test it against real quotes. It says what the measured numbers imply, and what
 * would have to be better than anything measured for the goal to be likely.
 *
 * WHAT THIS MODULE NEVER DOES
 * It never changes a rule. The goal is a reason to PLAN, size and discuss — never a reason to relax a gate (CLAUDE.md:
 * a stretch target "is never a reason to take a B+ or lower 0.65"). Where a rule collides with the goal it says so and
 * names the number the trader owns; the decision stays with the trader.
 */

import { APLUS_RULES } from "@/lib/aplus/config";
import { PATH_MONTH_CAP } from "@/lib/trading/profit-rules";
import { MAX_DEBIT_USD } from "@/lib/trading/sleeve-sizing";
import { etWallParts } from "@/lib/trading/sessions";
import EVIDENCE_DIST from "@/data/evidence-dist.json";
import ROOM_EV_TEST from "@/data/room-ev-test.json";
import ROOM_TIME_ODDS from "@/data/room-time-odds.json";
import { EXEC_FLAGS, EXEC_LIMITS, LIVE_EVIDENCE } from "./exec/limits";
import { ROOM_CLOCK, ROOM_MANDATE } from "./mandate";
import { etDateOf } from "./option-math";
import type { Rung } from "./contract-ladder";
import type { Character } from "./orchestrator";

/* ── The goal ──────────────────────────────────────────────────────────── */

export interface GoalSpec {
  version: 1;
  /** Starting capital and the target, in dollars. */
  start: number;
  target: number;
  /** The ET date of day one (a weekday) and how many trading sessions the window holds. */
  startDate: string;
  tradingDays: number;
  /** The experiment stops when equity falls to this share of the start. The trader's number. */
  floorFrac: number;
  /**
   * What share of equity one ticket may cost, on the EXPERIMENT account (the paper seats). The room's mandate is 10% of
   * cash (mandate.ts), which on $1,000 is $100 — less than one ATM contract, so at 10% nothing could ever trade. The
   * default is a proposal that lets the rehearsal run, and it is the trader's number to set. The house room's book and the
   * Execution card's limits are NOT changed by it — see the `exec_cap` collision.
   */
  capFrac: number;
  /**
   * Which contracts the experiment account may buy: delta at or above this, ask at least this many dollars. The room
   * itself trades two strikes (at the money and one out); the paper seats may reach every strike that passes these
   * floors. The trader's numbers — the house room and the Execution card are not changed by them.
   */
  minDelta: number;
  minAskUsd: number;
}

export const GOAL_STORAGE = "ledger-room-goal-v3";

export const DEFAULT_GOAL_CONSTANTS = { start: 996, target: 5_000, tradingDays: 30, floorFrac: 0.5, capFrac: 0.56, minDelta: 0.15, minAskUsd: 20 } as const;

const pad2 = (n: number) => String(n).padStart(2, "0");

const dateOf = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

/** The next weekday on or after an ET date (holidays are not modelled, as everywhere in the room). */
export function weekdayOnOrAfter(etDate: string): string {
  const d = parseDate(etDate);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return dateOf(d);
}

/** `n` trading sessions starting at `startDate` (weekdays only). */
export function tradingDates(startDate: string, n: number): string[] {
  const out: string[] = [];
  const d = parseDate(weekdayOnOrAfter(startDate));
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(dateOf(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function defaultGoal(nowMs: number): GoalSpec {
  return {
    version: 1,
    start: DEFAULT_GOAL_CONSTANTS.start,
    target: DEFAULT_GOAL_CONSTANTS.target,
    startDate: weekdayOnOrAfter(etDateOf(nowMs)),
    tradingDays: DEFAULT_GOAL_CONSTANTS.tradingDays,
    floorFrac: DEFAULT_GOAL_CONSTANTS.floorFrac,
    capFrac: DEFAULT_GOAL_CONSTANTS.capFrac,
    minDelta: DEFAULT_GOAL_CONSTANTS.minDelta,
    minAskUsd: DEFAULT_GOAL_CONSTANTS.minAskUsd,
  };
}

export function asGoal(x: unknown): GoalSpec | null {
  const g = x as Partial<GoalSpec> | null;
  if (!g || g.version !== 1) return null;
  const ok = (n: unknown, lo: number, hi: number) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
  if (!ok(g.start, 1, 1e7) || !ok(g.target, 1, 1e8) || !ok(g.tradingDays, 1, 60) || !ok(g.floorFrac, 0, 0.95) || !ok(g.capFrac, 0.01, 1)) return null;
  if (typeof g.startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(g.startDate)) return null;
  if ((g.target as number) <= (g.start as number)) return null;
  // A goal saved before the strike floors existed loads with the defaults; a bad value is not silently repaired.
  const minDelta = g.minDelta === undefined ? DEFAULT_GOAL_CONSTANTS.minDelta : g.minDelta;
  const minAskUsd = g.minAskUsd === undefined ? DEFAULT_GOAL_CONSTANTS.minAskUsd : g.minAskUsd;
  if (!ok(minDelta, 0.01, 1) || !ok(minAskUsd, 1, 100_000)) return null;
  return { ...(g as GoalSpec), minDelta, minAskUsd };
}

export interface GoalClock {
  state: "before" | "running" | "past";
  /** 1-based index of today inside the window; 0 before it starts. */
  day: number;
  of: number;
  /** Sessions in which a NEW ticket can still be bought (today counts until the 16:00 ET cash close). */
  daysLeft: number;
  /** Those sessions' dates, in order. */
  remaining: string[];
  deadline: string;
  /** Today's date and whether today's entry window (to the 16:00 ET close) is already over. */
  today: string;
  entriesOver: boolean;
  dates: string[];
}

export function goalClock(spec: GoalSpec, nowMs: number): GoalClock {
  const dates = tradingDates(spec.startDate, spec.tradingDays);
  const today = etDateOf(nowMs);
  const w = etWallParts(nowMs);
  const etMin = w.hour * 60 + w.minute;
  const isWeekday = w.weekday >= 1 && w.weekday <= 5;
  const entriesOver = !isWeekday || etMin >= ROOM_CLOCK.optionsCloseMin;
  const deadline = dates[dates.length - 1] ?? spec.startDate;
  const base = { of: dates.length, deadline, today, entriesOver, dates };
  if (today < (dates[0] ?? today)) return { ...base, state: "before", day: 0, daysLeft: dates.length, remaining: dates };
  if (today > deadline) return { ...base, state: "past", day: dates.length, daysLeft: 0, remaining: [] };
  const idx = dates.indexOf(today);
  const todayOpen = idx >= 0 && !entriesOver;
  const remaining = dates.filter((d) => (todayOpen ? d >= today : d > today));
  return { ...base, state: "running", day: idx >= 0 ? idx + 1 : dates.filter((d) => d < today).length, daysLeft: remaining.length, remaining };
}

/** New tickets may be bought now: inside the window, on a session day, until the 16:00 ET close. Lunch is not a stop. */
export const entriesOpen = (c: GoalClock): boolean => c.state === "running" && c.dates.includes(c.today) && !c.entriesOver;

/** Per session: true when it opens a new week (its weekday does not come after the previous session's). Index 0 is never a break — it is the week in progress. */
export function weekBreaksOf(dates: string[]): boolean[] {
  const wd = (d: string) => parseDate(d).getUTCDay() || 7;
  return dates.map((d, i) => i > 0 && wd(d) <= wd(dates[i - 1]!));
}

/* ── What the measured numbers say a trade is ──────────────────────────── */

export interface TradeModel {
  /** Chance a taken ticket wins, and what it returns on the debit when it does / when it does not. */
  pWin: number;
  winPct: number;
  lossPct: number;
  /** The expected return on the debit, per trade — the measured mean when the model came from measurement. */
  meanPct: number;
  /** Sample behind the win rate and the mean, or null when the model is hypothetical. */
  n: number | null;
  source: string;
  /**
   * The ticket's outcomes as returns on the debit, when it has more than a win and a loss (a contract priced on a card's
   * three paths: T1, stopped, flat). Absent = [win at winPct with pWin, loss at −lossPct with 1 − pWin].
   */
  outcomes?: { p: number; r: number }[];
}

/** Every way a ticket can end, as (probability, return on the debit). */
export function outcomesOf(m: TradeModel): { p: number; r: number }[] {
  if (m.outcomes && m.outcomes.length) return m.outcomes;
  return [
    { p: m.pWin, r: m.winPct },
    { p: 1 - m.pWin, r: -m.lossPct },
  ];
}

/** A model from a win rate, a loss size and the mean return the win size must reproduce. */
export function modelFromMean(pWin: number, lossPct: number, meanPct: number, n: number | null, source: string): TradeModel {
  const winPct = Math.max(0, (meanPct + (1 - pWin) * lossPct) / pWin);
  return { pWin, winPct, lossPct, meanPct, n, source };
}

/** The reference trade: NY AM, VIX 18, 1 DTE, ATM, every filled card (room-ev-test.json) with the mandate's loss. */
export function referenceModel(): TradeModel {
  const row = (ROOM_EV_TEST.results as { pop: string; vix: number; dte: number; half: string; all: { n: number; winRate: number; meanPctPremium: number } }[]).find(
    (r) => r.pop === "nyam" && r.vix === 18 && r.dte === 1 && r.half === "all",
  );
  if (!row) throw new Error("room-ev-test.json has no NY AM / VIX 18 / 1 DTE row");
  return modelFromMean(row.all.winRate, Math.abs(ROOM_MANDATE.hardStopPct) / 100, row.all.meanPctPremium, row.all.n, `room-ev-test.json · NY AM · VIX 18 · 1 DTE · n ${row.all.n}`);
}

/** Qualifying tickets the room can take per session — the measured NY AM fills, which is all it is open for. */
export interface Opportunity {
  perSession: number;
  source: string;
}

export function opportunityRate(): Opportunity {
  const perWeek = (EVIDENCE_DIST as { perWeek: number }).perWeek;
  const pop = (ROOM_TIME_ODDS as { population: { fills: number; nyAmFills: number } }).population;
  const nyShare = pop.nyAmFills / pop.fills;
  return { perSession: (perWeek * nyShare) / 5, source: `evidence-dist.json ${perWeek}/week × NY AM share ${pop.nyAmFills}/${pop.fills} ÷ 5 sessions` };
}

/** Kelly's stake as a share of equity for a win/loss ticket; 0 when the edge is not positive. */
export function kellyFrac(m: TradeModel): number {
  if (m.winPct <= 0 || m.lossPct <= 0) return 0;
  return Math.max(0, m.pWin / m.lossPct - (1 - m.pWin) / m.winPct);
}

/* ── The path, and where today stands on it ────────────────────────────── */

export interface GoalRead {
  spec: GoalSpec;
  clock: GoalClock;
  equity: number;
  status: "before" | "running" | "hit" | "floor" | "expired";
  floor: number;
  multipleNeeded: number;
  /** Compounded return per remaining session, and dollars per remaining session in a straight line. */
  perSessionNeeded: number | null;
  perSessionUsd: number | null;
  /** The geometric ladder from the start to the target, and what the ladder says equity should be at the end of today. */
  ladder: { date: string; equity: number }[];
  pathToday: number | null;
  pace: { vsPathUsd: number; vsPathPct: number; label: "ahead" | "on path" | "behind" } | null;
}

export function readGoal(spec: GoalSpec, equity: number, nowMs: number): GoalRead {
  const clock = goalClock(spec, nowMs);
  const floor = spec.start * spec.floorFrac;
  const ratio = spec.target / spec.start;
  const ladder = clock.dates.map((date, i) => ({ date, equity: spec.start * Math.pow(ratio, (i + 1) / clock.dates.length) }));
  const status: GoalRead["status"] =
    equity >= spec.target ? "hit" : equity <= floor ? "floor" : clock.state === "before" ? "before" : clock.state === "past" ? "expired" : "running";
  const idx = clock.dates.indexOf(clock.today);
  const pathToday = clock.state === "running" && idx >= 0 ? (ladder[idx]?.equity ?? null) : clock.state === "before" ? spec.start : null;
  const pace =
    pathToday != null && clock.state === "running"
      ? (() => {
          const d = equity - pathToday;
          const pct = (d / pathToday) * 100;
          return { vsPathUsd: d, vsPathPct: pct, label: (Math.abs(pct) < 5 ? "on path" : d > 0 ? "ahead" : "behind") as "ahead" | "on path" | "behind" };
        })()
      : null;
  const left = Math.max(0, clock.daysLeft);
  return {
    spec,
    clock,
    equity,
    status,
    floor,
    multipleNeeded: spec.target / Math.max(equity, 1e-9),
    perSessionNeeded: left > 0 && equity > 0 ? Math.pow(spec.target / equity, 1 / left) - 1 : null,
    perSessionUsd: left > 0 ? (spec.target - equity) / left : null,
    ladder,
    pathToday,
    pace,
  };
}

/* ── The exact odds ────────────────────────────────────────────────────── */

export interface SimPolicy {
  /** Share of equity one ticket may cost (already capped by the experiment mandate). */
  frac: number;
  /** Most tickets taken in a session. */
  perDay: number;
  /** The room's halts, as the room reads them: realized P&L for the day / the ISO week at or past this share of its starting equity ends trading until it rolls. */
  dayHaltFrac: number;
  weekHaltFrac: number;
}

export interface SimInput {
  equity: number;
  target: number;
  floor: number;
  /** Sessions left to buy a ticket in. */
  days: number;
  model: TradeModel;
  policy: SimPolicy;
  /** What one contract costs, in dollars (ask × 100), and the most one ticket may cost. */
  contractUsd: number;
  maxDebitUsd: number;
  /** Qualifying tickets per session (Poisson) and the most tickets the rules allow in the whole window. */
  lambda: number;
  tradeBudget: number;
  /** Per remaining session: true when it opens a new ISO week (the weekly counter resets). Day 0's week is the one in progress. */
  weekBreaks?: boolean[];
  /** Realized P&L so far today and so far this week (the room book's own counters), for a window already under way. */
  dayNet0?: number;
  weekNet0?: number;
  /** Paths below this probability are not followed and their mass is reported as `pLost` (default 1e-15: nothing is lost). */
  eps?: number;
}

export interface SimOutput {
  pTarget: number;
  pFloor: number;
  /** Neither by the deadline. */
  pBetween: number;
  pNoTrade: number;
  expectedEnd: number;
  p10: number;
  p50: number;
  p90: number;
  expectedTrades: number;
  /** Contracts one ticket buys at today's equity, and its debit — 0 when the cap cannot buy one. */
  contractsNow: number;
  debitNow: number;
  states: number;
  /** Probability mass of paths dropped below `eps` — the answer is exact to within this much. */
  pLost: number;
}


/** P(k tickets in a session), k = 0..kMax, Poisson(lambda) with the tail folded into kMax. */
export function arrivalPmf(lambda: number, kMax: number): number[] {
  const out: number[] = [];
  let p = Math.exp(-Math.max(0, lambda));
  let sum = 0;
  for (let k = 0; k < kMax; k++) {
    out.push(p);
    sum += p;
    p = (p * Math.max(0, lambda)) / (k + 1);
  }
  out.push(Math.max(0, 1 - sum));
  return out;
}

/** Contracts one ticket buys at `equity` under the policy and the caps. */
export function contractsFor(equity: number, contractUsd: number, frac: number, maxDebitUsd: number): number {
  if (!(contractUsd > 0) || !(equity > 0)) return 0;
  const byFrac = Math.floor((frac * equity + 1e-9) / contractUsd);
  const byCeiling = Math.floor((maxDebitUsd + 1e-9) / contractUsd);
  return Math.max(0, Math.min(byFrac, byCeiling));
}

interface Cell {
  eq: number;
  used: number;
  /** Equity at the start of the ISO week this state is in — the weekly halt's base. */
  wk: number;
  p: number;
}

/**
 * The exact distribution of where an account ends, day by day. A state is (equity, tickets used, the week's starting
 * equity); a day gives a Poisson number of qualifying tickets (at most `perDay`, at most what the budget has left);
 * each is taken at the policy's size, wins +W or loses −L of its debit, and the room's halts are applied as the room
 * applies them (orchestrator.ts): realized P&L for the day at or past `dayHaltFrac` of the day's starting equity, or
 * for the ISO week past `weekHaltFrac` of the week's, stops new tickets until that counter rolls. Reaching the target
 * or the floor ends the path. Equal states are merged; the result is exact for the model.
 *
 * Not modelled: the cool-down after two straight losses (A+ only afterwards — it thins tickets further), and the
 * killzone count beyond the per-session cap.
 */
export function goalDp(i: SimInput): SimOutput {
  const { target, floor, model, policy } = i;
  const EPS = i.eps ?? 1e-15;
  let pLost = 0;
  const outs = outcomesOf(model);
  const key = (eq: number, used: number, wk: number) => `${Math.round(eq * 100)}:${used}:${Math.round(wk * 100)}`;
  const weekNet0 = i.weekNet0 ?? 0;
  const dayNet0 = i.dayNet0 ?? 0;
  let cur = new Map<string, Cell>();
  cur.set(key(i.equity, 0, i.equity - weekNet0), { eq: i.equity, used: 0, wk: i.equity - weekNet0, p: 1 });
  const hits: { eq: number; p: number }[] = [];
  const floors: { eq: number; p: number }[] = [];
  let expectedTrades = 0;
  let pNoTrade = 0;
  let states = 1;

  if (i.equity >= target) return doneOut(i, 1, 0, 1);
  if (i.equity <= floor) return doneOut(i, 0, 1, 1);

  for (let day = 0; day < i.days; day++) {
    const next = new Map<string, Cell>();
    const park = (eq: number, used: number, wk: number, p: number) => {
      const k = key(eq, used, wk);
      const c = next.get(k);
      if (c) c.p += p;
      else next.set(k, { eq, used, wk, p });
    };
    const newWeek = day > 0 && Boolean(i.weekBreaks?.[day]);
    for (const s of cur.values()) {
      const wk = newWeek ? s.eq : s.wk;
      const dayNetStart = day === 0 ? dayNet0 : 0;
      const dayStart = s.eq - dayNetStart;
      const dayLimit = policy.dayHaltFrac * dayStart;
      const weekLimit = policy.weekHaltFrac * wk;
      const haltedNow = (eq: number, dayNet: number) => dayNet <= -dayLimit + 1e-9 || eq - wk <= -weekLimit + 1e-9;
      const left = Math.min(policy.perDay, Math.max(0, i.tradeBudget - s.used));
      if (left <= 0 || haltedNow(s.eq, dayNetStart) || contractsFor(s.eq, i.contractUsd, policy.frac, i.maxDebitUsd) < 1) {
        park(s.eq, s.used, wk, s.p);
        continue;
      }
      const pmf = arrivalPmf(i.lambda, left);
      for (let k = 0; k <= left; k++) {
        const mass0 = s.p * (pmf[k] ?? 0);
        if (mass0 < EPS) {
          pLost += mass0;
          continue;
        }
        if (k === 0) {
          park(s.eq, s.used, wk, mass0);
          continue;
        }
        // k tickets today, taken one after another.
        const stack: { eq: number; used: number; p: number; left: number; dayNet: number }[] = [{ eq: s.eq, used: s.used, p: mass0, left: k, dayNet: dayNetStart }];
        while (stack.length) {
          const x = stack.pop()!;
          if (x.left === 0) {
            park(x.eq, x.used, wk, x.p);
            continue;
          }
          const c = contractsFor(x.eq, i.contractUsd, policy.frac, i.maxDebitUsd);
          if (c < 1) {
            park(x.eq, x.used, wk, x.p);
            continue;
          }
          const debit = c * i.contractUsd;
          expectedTrades += x.p;
          for (const o of outs) {
            const pr = x.p * o.p;
            if (pr < EPS) {
              pLost += pr;
              continue;
            }
            const delta = debit * o.r;
            const eq = x.eq + delta;
            const used = x.used + 1;
            if (eq >= target) {
              hits.push({ eq, p: pr });
              continue;
            }
            if (eq <= floor) {
              floors.push({ eq, p: pr });
              continue;
            }
            const dayNet = x.dayNet + delta;
            if (haltedNow(eq, dayNet) || used >= i.tradeBudget) {
              park(eq, used, wk, pr);
              continue;
            }
            stack.push({ eq, used, p: pr, left: x.left - 1, dayNet });
          }
        }
      }
    }
    cur = next;
    states = Math.max(states, cur.size);
  }

  const between = [...cur.values()];
  for (const b of between) if (b.used === 0) pNoTrade += b.p;
  const pTarget = hits.reduce((a, h) => a + h.p, 0);
  const pFloor = floors.reduce((a, h) => a + h.p, 0);
  const pBetween = between.reduce((a, h) => a + h.p, 0);
  const all = [...hits, ...floors, ...between.map((b) => ({ eq: b.eq, p: b.p }))].sort((a, b) => a.eq - b.eq);
  const q = (qq: number) => {
    let acc = 0;
    for (const a of all) {
      acc += a.p;
      if (acc >= qq - 1e-12) return a.eq;
    }
    return all[all.length - 1]?.eq ?? i.equity;
  };
  const c0 = contractsFor(i.equity, i.contractUsd, policy.frac, i.maxDebitUsd);
  return {
    pTarget,
    pFloor,
    pBetween,
    pNoTrade,
    expectedEnd: all.reduce((a, h) => a + h.eq * h.p, 0),
    p10: q(0.1),
    p50: q(0.5),
    p90: q(0.9),
    expectedTrades,
    contractsNow: c0,
    debitNow: c0 * i.contractUsd,
    states,
    pLost,
  };
}

function doneOut(i: SimInput, pTarget: number, pFloor: number, p: number): SimOutput {
  return { pTarget, pFloor, pBetween: 0, pNoTrade: 0, expectedEnd: i.equity * p, p10: i.equity, p50: i.equity, p90: i.equity, expectedTrades: 0, contractsNow: 0, debitNow: 0, states: 1, pLost: 0 };
}

/* ── The five policies ─────────────────────────────────────────────────── */

export type FracRule = "cap" | "kelly" | number;

export interface PolicyDef {
  id: "protect" | "mechanical" | "structure" | "edge" | "press";
  owner: Character;
  label: string;
  /** How the person sizes: a fixed share, the experiment cap, or Kelly (zero without a measured edge). */
  frac: FracRule;
  perDay: number;
  /** The one-line case the person makes for it. */
  stance: string;
}

/**
 * Each person's approach to the goal, as a sizing policy. These are TASTE, not findings: they are the starting
 * positions the five argue from and the five paper seats race on. What the exact odds say about each of them is
 * `policyTable`; what actually happens is the league (seats.ts).
 */
export const POLICIES: PolicyDef[] = [
  { id: "protect", owner: "Sterling", label: "Protect the floor", frac: 0.25, perDay: 1, stance: "small tickets, one a day — the account must still exist to hit anything" },
  { id: "mechanical", owner: "Vince", label: "Mechanical, at the cap", frac: "cap", perDay: 2, stance: "the room's rules, at the experiment's ticket cap" },
  { id: "structure", owner: "Gemma", label: "Structure only", frac: 0.56, perDay: 2, stance: "the chart and the dealing range, sized to the $150–$550 envelope" },
  { id: "edge", owner: "Nova", label: "Edge-weighted", frac: "kelly", perDay: 2, stance: "stake what the measured edge supports — nothing, if it supports nothing" },
  { id: "press", owner: "Jax", label: "Press", frac: 1, perDay: 2, stance: "the goal needs size; take every ticket the gates allow, as big as the cap lets you" },
];

export const policyOf = (id: PolicyDef["id"]): PolicyDef => POLICIES.find((p) => p.id === id)!;

export function resolveFrac(p: PolicyDef, capFrac: number, model: TradeModel): number {
  if (p.frac === "cap") return capFrac;
  if (p.frac === "kelly") return Math.min(capFrac, kellyFrac(model));
  return Math.min(capFrac, p.frac);
}

export interface PlanContext {
  contractUsd: number;
  capFrac: number;
  maxDebitUsd: number;
  lambda: number;
  model: TradeModel;
  tradeBudget: number;
  dayHaltFrac: number;
  weekHaltFrac: number;
  /** What the room book has already realized today and this week (0 before the window starts). */
  dayNet0: number;
  weekNet0: number;
}

export interface PolicyRow {
  def: PolicyDef;
  frac: number;
  out: SimOutput;
}

/** The trades the rules allow in what is left of the window: two a session, and the PATH cap for the month. */
export function tradeBudget(daysLeft: number, monthEntries: number): number {
  return Math.max(0, Math.min(APLUS_RULES.maxSetupsPerSession * daysLeft, PATH_MONTH_CAP - monthEntries));
}

export function planContext(a: {
  contractUsd: number;
  capFrac: number;
  daysLeft: number;
  monthEntries: number;
  model?: TradeModel;
  lambda?: number;
  dayNet0?: number;
  weekNet0?: number;
}): PlanContext {
  return {
    contractUsd: a.contractUsd,
    capFrac: a.capFrac,
    maxDebitUsd: MAX_DEBIT_USD,
    lambda: a.lambda ?? opportunityRate().perSession,
    model: a.model ?? referenceModel(),
    tradeBudget: tradeBudget(a.daysLeft, a.monthEntries),
    dayHaltFrac: APLUS_RULES.dailyLossLimitPct,
    weekHaltFrac: APLUS_RULES.weeklyLossLimitPct,
    dayNet0: a.dayNet0 ?? 0,
    weekNet0: a.weekNet0 ?? 0,
  };
}

export function simFor(read: GoalRead, ctx: PlanContext, policy: SimPolicy, over: Partial<SimInput> = {}): SimOutput {
  return goalDp({
    equity: read.equity,
    target: read.spec.target,
    floor: read.floor,
    days: Math.max(0, read.clock.daysLeft),
    model: ctx.model,
    policy,
    contractUsd: ctx.contractUsd,
    maxDebitUsd: ctx.maxDebitUsd,
    lambda: ctx.lambda,
    tradeBudget: ctx.tradeBudget,
    weekBreaks: weekBreaksOf(read.clock.remaining),
    dayNet0: ctx.dayNet0,
    weekNet0: ctx.weekNet0,
    ...over,
  });
}

/** What the exact odds say about each of the five approaches, from here. */
export function policyTable(read: GoalRead, ctx: PlanContext): PolicyRow[] {
  return POLICIES.map((def) => {
    const frac = resolveFrac(def, ctx.capFrac, ctx.model);
    return { def, frac, out: simFor(read, ctx, { frac, perDay: def.perDay, dayHaltFrac: ctx.dayHaltFrac, weekHaltFrac: ctx.weekHaltFrac }) };
  });
}

/* ── The ladder: what the cheaper contracts do to the odds ─────────────── */

export interface LadderRow {
  rung: Rung;
  /** What the experiment's ticket cap buys at today's equity, and what that costs. */
  contracts: number;
  debitUsd: number;
  /** One stopped ticket as a share of equity. */
  stopShare: number | null;
  /** The exact odds if every ticket looked like today's card, priced on THIS rung — a model on one card, not a measurement. Null without a card. */
  out: SimOutput | null;
}

/** A trade model from the room's three-path pricing of one contract. */
export function modelFromRung(r: Rung): TradeModel | null {
  const px = r.priced;
  if (!px) return null;
  const loss = px.outcomes.find((o) => o.kind === "loss")?.r ?? 0;
  const t1 = px.outcomes.find((o) => o.kind === "t1")?.r ?? 0;
  return {
    pWin: px.pT1,
    winPct: t1,
    lossPct: Math.abs(loss),
    meanPct: px.outcomes.reduce((a, o) => a + o.p * o.r, 0),
    n: null,
    source: `priced on today's card · ${r.offset} ${r.strike} · the room's three paths`,
    outcomes: px.outcomes.map((o) => ({ p: o.p, r: o.r })),
  };
}

/** The ladder's odds drop paths below this probability and say how much mass that was (SimOutput.pLost): an answer exact to within it. */
export const LADDER_EPS = 1e-9;

export function ladderTable(read: GoalRead, ctx: PlanContext, rungs: Rung[]): LadderRow[] {
  const policy: SimPolicy = { frac: ctx.capFrac, perDay: 2, dayHaltFrac: ctx.dayHaltFrac, weekHaltFrac: ctx.weekHaltFrac };
  return rungs.map((rung) => {
    const contracts = contractsFor(read.equity, rung.askUsd, ctx.capFrac, ctx.maxDebitUsd);
    const model = modelFromRung(rung);
    const debitUsd = contracts * rung.askUsd;
    const loss = rung.priced?.outcomes.find((o) => o.kind === "loss")?.r ?? null;
    return {
      rung,
      contracts,
      debitUsd,
      stopShare: loss != null && read.equity > 0 ? (debitUsd * Math.abs(loss)) / read.equity : null,
      out: model ? simFor(read, ctx, policy, { model, contractUsd: rung.askUsd, eps: LADDER_EPS }) : null,
    };
  });
}

/* ── What would have to be true ────────────────────────────────────────── */

export interface Needed {
  /** The chance the answer is for, and the policy it is for (the most aggressive one the caps allow). */
  pStar: number;
  /** Win rate needed with the measured win and loss sizes and opportunity rate; null if no win rate gets there. */
  pWin: number | null;
  /** Opportunities per session needed at the measured win rate; null if none gets there within 40× the measured rate. */
  lambda: number | null;
  lambdaMultiple: number | null;
  /** Win size (return on the debit) needed at the measured win rate; null if none within 500%. */
  winPct: number | null;
}

function bisect(f: (x: number) => number, lo: number, hi: number, want: number): number | null {
  if (f(hi) < want) return null;
  if (f(lo) >= want) return lo;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) >= want) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** What would have to be better than anything measured for the goal to be a `pStar` chance: win rate, win size, frequency. */
export function needed(read: GoalRead, ctx: PlanContext, pStar: number): Needed {
  const press = policyOf("press");
  const policy: SimPolicy = { frac: Math.min(ctx.capFrac, 1), perDay: press.perDay, dayHaltFrac: ctx.dayHaltFrac, weekHaltFrac: ctx.weekHaltFrac };
  const m = ctx.model;
  const p = (over: Partial<SimInput>) => simFor(read, ctx, policy, over).pTarget;
  const pWin = bisect((x) => p({ model: { ...m, pWin: x, meanPct: x * m.winPct - (1 - x) * m.lossPct } }), m.pWin, 0.98, pStar);
  const lam = bisect((x) => p({ lambda: x }), ctx.lambda, ctx.lambda * 40, pStar);
  const win = bisect((x) => p({ model: { ...m, winPct: x, meanPct: m.pWin * x - (1 - m.pWin) * m.lossPct } }), m.winPct, 5, pStar);
  return { pStar, pWin, lambda: lam, lambdaMultiple: lam == null ? null : lam / ctx.lambda, winPct: win };
}

/** Straight-line arithmetic of the goal at full size, with no luck assumed: how many straight wins, and how many tickets there will be. */
export function winsNeeded(equity: number, target: number, model: TradeModel, frac: number, contractUsd: number, maxDebitUsd: number): number | null {
  let eq = equity;
  for (let n = 1; n <= 60; n++) {
    const c = contractsFor(eq, contractUsd, frac, maxDebitUsd);
    if (c < 1) return null;
    eq += c * contractUsd * model.winPct;
    if (eq >= target) return n;
  }
  return null;
}

/* ── Where the desk's own rules collide with the goal ──────────────────── */

export interface Collision {
  id: string;
  severity: "blocker" | "warn" | "info";
  title: string;
  detail: string;
  /** The number or the call that is the TRADER's — the agents never change it. */
  decision: string | null;
  /** True when the trader has something to SET or DECIDE for the goal to proceed (the room says so out loud); false when it is a fact about a rule that is not moved. */
  ask: boolean;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;

/**
 * The places the desk's rules and the goal cannot both be true, each with its arithmetic and the number the trader
 * owns. Order is by how much they matter.
 */
export function collisions(read: GoalRead, ctx: PlanContext, o: { cheapestUsd: number | null; cheapestName: string | null; paperFills: number | null }): Collision[] {
  const out: Collision[] = [];
  const eq = read.equity;
  const capUsd = Math.min(ctx.capFrac * eq, ctx.maxDebitUsd);
  const L = ctx.model.lossPct;
  const left = Math.max(0, read.clock.daysLeft);

  if (capUsd < ctx.contractUsd) {
    const minFrac = ctx.contractUsd / eq;
    const reachable = o.cheapestUsd != null && o.cheapestUsd <= capUsd;
    out.push({
      id: "cap_vs_contract",
      severity: reachable ? "warn" : "blocker",
      title: reachable ? "The room's two strikes cost more than a ticket may" : "Not even the cheapest contract fits a ticket",
      detail: `The room trades the money and the strike one out — about ${money(ctx.contractUsd)} the cheaper of the two today. ${pct1(ctx.capFrac)} of ${money(eq)} is ${money(capUsd)}.${
        o.cheapestUsd != null
          ? reachable
            ? ` Contracts further out cost less: the cheapest on the ladder is ${o.cheapestName ?? "a further strike"} at about ${money(o.cheapestUsd)}. The account is not priced out — the room's two strikes are, and the seats may reach the ladder.`
            : ` The cheapest contract on the ladder is ${o.cheapestName ?? "a further strike"} at about ${money(o.cheapestUsd)} — still over the cap.`
          : ""
      }`,
      decision: reachable
        ? `The ticket share is yours: at least ${Math.ceil(minFrac * 100)}% buys one of the room's two strikes (the room's mandate is ${Math.round(ROOM_MANDATE.maxCashFracPerTrade * 100)}%). The strike floors — delta ${read.spec.minDelta}, ${money(read.spec.minAskUsd)} — are yours too.`
        : `Set the experiment account's ticket share to at least ${Math.ceil(minFrac * 100)}% (the room's mandate is ${Math.round(ROOM_MANDATE.maxCashFracPerTrade * 100)}%), or lower the strike floors so a cheaper contract is allowed.`,
      ask: true,
    });
  }
  const execCapUsd = Math.min(EXEC_LIMITS.maxCashFracPerTrade * eq, EXEC_LIMITS.maxTicketUsd);
  if (execCapUsd < ctx.contractUsd) {
    out.push({
      id: "exec_cap",
      severity: "warn",
      title: "The Execution card would refuse the room's tickets on a $1,000 account",
      detail: `The broker side caps a ticket at ${Math.round(EXEC_LIMITS.maxCashFracPerTrade * 100)}% of broker cash (limits.ts) — ${money(execCapUsd)} on ${money(eq)} — and the room's cheaper strike is about ${money(ctx.contractUsd)}. The paper seats run at ${pct1(ctx.capFrac)}; a live account under today's limits could only buy a contract cheaper than ${money(execCapUsd)}, and the room itself never picks one — it trades two strikes.`,
      decision: `maxCashFracPerTrade in exec/limits.ts is yours; at least ${Math.ceil((ctx.contractUsd / eq) * 100)}% buys one contract today. It is not moved for the goal.`,
      ask: true,
    });
  }
  const sizeable = Math.min(ctx.capFrac, 1) * eq >= ctx.contractUsd;
  const winsNeed = sizeable ? winsNeeded(eq, read.spec.target, ctx.model, ctx.capFrac, ctx.contractUsd, ctx.maxDebitUsd) : null;
  const expectedTickets = ctx.lambda * left;
  if (winsNeed != null) {
    out.push({
      id: "frequency",
      severity: "info",
      title: `${winsNeed} straight winners at this size is the whole goal`,
      detail: `At the cap, ${winsNeed} winning ticket${winsNeed === 1 ? "" : "s"} in a row would reach ${money(read.spec.target)}. That is the pace if every one won — not a reason to stand down. We still take every B+ the chart clears. The desk's measured rate is ${ctx.lambda.toFixed(2)} a session, about ${expectedTickets.toFixed(1)} in the ${left} left.`,
      decision: null,
      ask: false,
    });
  }
  const winsFree = sizeable ? winsNeeded(eq, read.spec.target, ctx.model, ctx.capFrac, ctx.contractUsd, Infinity) : null;
  if (winsNeed != null && winsFree != null && winsNeed > winsFree) {
    out.push({
      id: "ceiling",
      severity: "warn",
      title: "The per-ticket ceiling caps the compounding",
      detail: `One ticket may cost at most ${money(ctx.maxDebitUsd)} (the sleeve's debit ceiling and the Execution card's). At a ${(ctx.model.winPct * 100).toFixed(0)}% win the ceiling binds once equity passes about ${money(ctx.maxDebitUsd / ctx.capFrac)}, after which every win adds the same dollars: ${winsNeed} straight wins to reach ${money(read.spec.target)} with it, ${winsFree} without.`,
      decision: "The ceiling is yours (MAX_DEBIT_USD in sleeve-sizing.ts, maxTicketUsd in exec/limits.ts); it is not moved for the goal.",
      ask: false,
    });
  }
  if (ctx.model.meanPct <= 0) {
    out.push({
      id: "edge",
      severity: "warn",
      title: "The measured edge per ticket is not positive",
      detail: `On ${ctx.model.n ?? "n/a"} real NY AM cards priced as options the mean return was ${(ctx.model.meanPct * 100).toFixed(1)}% of the premium at a ${pct1(ctx.model.pWin)} win rate (${ctx.model.source}). Sizing up widens both tails; it does not move the middle. Kelly's stake is ${(kellyFrac(ctx.model) * 100).toFixed(0)}%.`,
      decision: null,
      ask: false,
    });
  }
  if (capUsd >= ctx.contractUsd) {
    const c = contractsFor(eq, ctx.contractUsd, ctx.capFrac, ctx.maxDebitUsd);
    const debit = c * ctx.contractUsd;
    const oneLoss = debit * L;
    const dayLimit = ctx.dayHaltFrac * (eq - ctx.dayNet0);
    const weekLimit = ctx.weekHaltFrac * (eq - ctx.weekNet0);
    if (oneLoss >= dayLimit) {
      const weekToo = oneLoss >= weekLimit;
      out.push({
        id: "halt",
        severity: weekToo ? "warn" : "info",
        title: weekToo ? "One stopped ticket ends the day, and the week" : "One stopped ticket ends the day",
        detail: `A ${c}-contract ticket (${money(debit)}) stopped at ${(L * 100).toFixed(0)}% loses about ${money(oneLoss)}. The daily halt is ${(ctx.dayHaltFrac * 100).toFixed(0)}% of ${money(eq - ctx.dayNet0)} = ${money(dayLimit)}${weekToo ? `, and the weekly halt is ${(ctx.weekHaltFrac * 100).toFixed(0)}% of ${money(eq - ctx.weekNet0)} = ${money(weekLimit)} — so after one loss the room takes nothing more until the next ISO week (Monday)` : ", so after one loss the room is done for the session"}.`,
        decision: weekToo ? `The halts are the desk's (config.ts) and are not moved for the goal; a smaller ticket is the only way to stay inside them: at ${money(weekLimit)} a week, a ticket may cost at most ${money(weekLimit / L)}.` : null,
      ask: false,
    });
    }
    const perLoss = oneLoss / eq;
    if (perLoss > 0 && read.spec.floorFrac > 0) {
      const steps = Math.ceil(Math.log(read.spec.floorFrac) / Math.log(1 - perLoss));
      out.push({
        id: "floor",
        severity: "info",
        title: "How fast the floor arrives",
        detail: `A ticket at today's size costs about ${(perLoss * 100).toFixed(0)}% of equity when stopped. ${steps} losses in a row reach the floor of ${money(read.floor)}.`,
        decision: `The floor (${Math.round(read.spec.floorFrac * 100)}% of the start) is yours to set.`,
      ask: true,
    });
    }
  }
  const fillsNeeded = LIVE_EVIDENCE.minPaperFills;
  const sessionsToEvidence = ctx.lambda > 0 ? fillsNeeded / ctx.lambda : Infinity;
  const live = Object.values(EXEC_FLAGS).every(Boolean);
  if (!live) {
    out.push({
      id: "live_gate",
      severity: "warn",
      title: "Live is shut, and the evidence gate is slower than the goal",
      detail: `Live needs ${fillsNeeded} paper fills and ${LIVE_EVIDENCE.minPaperRoundTrips} round trips on the broker's paper account${o.paperFills != null ? ` (${o.paperFills} so far)` : ""}, and three flags only you can flip. At ${ctx.lambda.toFixed(2)} qualifying tickets a session, ${fillsNeeded} fills is about ${Number.isFinite(sessionsToEvidence) ? Math.round(sessionsToEvidence) : "∞"} sessions — the goal's window is ${read.spec.tradingDays}.`,
      decision: "Whether to go live before the paper record exists is yours: the numbers are in limits.ts (LIVE_EVIDENCE, EXEC_FLAGS).",
      ask: true,
    });
  }
  const order = { blocker: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/* ── Today ─────────────────────────────────────────────────────────────── */

export interface DayPlan {
  /** What the ladder asks of today, and what is already banked above or below it. */
  needTodayUsd: number | null;
  /** The most a bad day may cost: the daily halt, and what is left above the floor. */
  maxLossUsd: number;
  /** Tickets today: the policy's per-session cap, and what the rules have left. */
  maxTickets: number;
  /** One ticket's debit and what one ATR of the underlying is worth on it, from the live tape. */
  contracts: number;
  debitUsd: number;
  perAtrUsd: number | null;
  /** How many ATRs, all going the ticket's way, the day's ask needs. */
  atrsNeeded: number | null;
}

export function dayPlan(read: GoalRead, ctx: PlanContext, o: { frac: number; perDay: number; atrUsdPerContract: number | null }): DayPlan {
  const contracts = contractsFor(read.equity, ctx.contractUsd, Math.min(o.frac, ctx.capFrac), ctx.maxDebitUsd);
  const needToday = read.pathToday != null ? read.pathToday - read.equity : null;
  const perAtr = o.atrUsdPerContract != null && contracts > 0 ? o.atrUsdPerContract * contracts : null;
  return {
    needTodayUsd: needToday != null && needToday > 0 ? needToday : needToday != null ? 0 : null,
    maxLossUsd: Math.max(0, Math.min(ctx.dayHaltFrac * read.equity, read.equity - read.floor)),
    maxTickets: Math.max(0, Math.min(o.perDay, ctx.tradeBudget)),
    contracts,
    debitUsd: contracts * ctx.contractUsd,
    perAtrUsd: perAtr,
    atrsNeeded: needToday != null && needToday > 0 && perAtr != null && perAtr > 0 ? needToday / perAtr : null,
  };
}

/* ── One call for everything the engine and the talk need ──────────────── */

export interface GoalView {
  read: GoalRead;
  ctx: PlanContext;
  table: PolicyRow[];
  /** The contract ladder with exact odds per rung, when the live card priced one; null otherwise. */
  ladder: LadderRow[] | null;
  needed: Needed;
  collisions: Collision[];
  plan: DayPlan;
  /** The cheapest of the contracts offered today, for the collision message. */
  cheapestUsd: number | null;
  /** Wins in a row the goal takes at the cap, and the tickets the window is expected to offer. */
  winsNeed: number | null;
  expectedTickets: number;
}

export function viewGoal(a: {
  spec: GoalSpec;
  equity: number;
  nowMs: number;
  /** What the room's cheaper strike costs (the measured reference's cost basis). */
  contractUsd: number;
  cheapest: { usd: number; name: string } | null;
  /** Today's ladder, priced on the live card when there is one. */
  ladder?: Rung[] | null;
  monthEntries: number;
  atrUsdPerContract: number | null;
  paperFills: number | null;
  model?: TradeModel;
  dayNet0?: number;
  weekNet0?: number;
}): GoalView {
  const read = readGoal(a.spec, a.equity, a.nowMs);
  const ctx = planContext({
    contractUsd: a.contractUsd,
    capFrac: a.spec.capFrac,
    daysLeft: read.clock.daysLeft,
    monthEntries: a.monthEntries,
    model: a.model,
    dayNet0: a.dayNet0,
    weekNet0: a.weekNet0,
  });
  const table = policyTable(read, ctx);
  const mech = table.find((r) => r.def.id === "mechanical")!;
  const rungs = a.ladder && a.ladder.length ? a.ladder : null;
  const cheapRung = rungs ? rungs.reduce((m, r) => (r.askUsd < m.askUsd ? r : m), rungs[0]!) : null;
  const cheapest = a.cheapest ?? (cheapRung ? { usd: cheapRung.askUsd, name: `${cheapRung.offset.replace("_", " ")} ${cheapRung.strike}` } : null);
  return {
    read,
    ctx,
    table,
    ladder: rungs ? ladderTable(read, ctx, rungs) : null,
    needed: needed(read, ctx, 0.1),
    collisions: collisions(read, ctx, { cheapestUsd: cheapest?.usd ?? null, cheapestName: cheapest?.name ?? null, paperFills: a.paperFills }),
    plan: dayPlan(read, ctx, { frac: mech.frac, perDay: mech.def.perDay, atrUsdPerContract: a.atrUsdPerContract }),
    cheapestUsd: cheapest?.usd ?? null,
    winsNeed: winsNeeded(a.equity, a.spec.target, ctx.model, a.spec.capFrac, ctx.contractUsd, ctx.maxDebitUsd),
    expectedTickets: ctx.lambda * Math.max(0, read.clock.daysLeft),
  };
}
