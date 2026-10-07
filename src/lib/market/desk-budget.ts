/**
 * THE DESK WALL BUDGET (2026-10-06).
 *
 * WHY THIS EXISTS (measured on the live site, 2026-10-06 NY AM)
 * The desk poll (`fetchTradingDesk`) took 21.8s, then 14.5s, and a cold tab
 * sat on "Building desk…" for more than 40s. The build was two serial phases:
 *
 *   1. bars — Databento (12s budget over a 45s abort, re-downloading a MONTH
 *      of 1m CSV every 20s poll), Yahoo 15m (15s abort PER HOST, hosts tried
 *      one after another → 30s worst case), daily + 1m ladder series (6s);
 *   2. only THEN quotes — gateway tick (0.75s), Yahoo 1m chart (5s), and the
 *      SPY/QQQ spots (5s).
 *
 * Worst case ≈ max(12, 30, 6) + 5.75 ≈ 36s — straddling Netlify's ~30s
 * stream-inactivity cut. Typical case lands right where we measured it.
 *
 * Now: every upstream starts at t0 in parallel, every leg waits at most for
 * what is left of ONE wall budget, and a leg that misses it serves the LAST
 * GOOD value it fetched — flagged `stale` with its age — or nothing at all.
 * Never a made-up number: a missing leg stays missing (and the existing
 * synthetic → stand-down branch in build-desk.ts handles the bars case).
 *
 * The underlying request is NOT abandoned: it stays registered as in-flight,
 * so the next poll on the same server instance joins it instead of starting a
 * second one, and the value it lands becomes the next last-good. A slow
 * upstream therefore costs freshness, never the whole desk.
 */

/** Total wall budget for one desk build (all upstream legs). */
export const DESK_BUDGET_MS = 6_500;

/**
 * A COLD instance has no last-good for the structure bars, so tripping the
 * budget would mean "synthetic → stand down" on a desk that would have had
 * real bars a few seconds later. Only then — and only for legs with nothing
 * to fall back to — the wait stretches to this cap. Still far below the
 * ~30s edge inactivity timeout that motivated build-desk's budgets.
 */
export const DESK_COLD_CAP_MS = 12_000;

/** In-flight fetches older than this are dropped (their own aborts are ≤45s). */
const INFLIGHT_MAX_MS = 60_000;

export type LegStatus =
  /** Fetched inside this build's budget. */
  | "fresh"
  /** Served from cache INSIDE its intended TTL (e.g. daily bars, 10 min). Not stale. */
  | "cached"
  /** The fetch missed the budget or failed; last-good served, older than its TTL. */
  | "stale"
  /** Nothing in time and nothing cached: the leg is absent from this build. */
  | "missing";

export interface BudgetLeg {
  id: string;
  status: LegStatus;
  /** How long this build waited on the leg. */
  ms: number;
  /** Age of the value served (seconds since it was fetched), null when missing. */
  ageSec: number | null;
  note?: string;
}

export interface DeskBudgetRead {
  budgetMs: number;
  coldCapMs: number;
  elapsedMs: number;
  /** Any leg missed its wait (served stale or missing). */
  tripped: boolean;
  /** A leg the desk's GRADES read (structure bars or quotes) was served stale or missing. */
  stale: boolean;
  /** Ids of the stale/missing legs the grades read. */
  staleCore: string[];
  legs: BudgetLeg[];
  /** One honest sentence for the HUD. Empty when nothing is stale. */
  line: string;
}

interface Entry<T> {
  at: number;
  value: T;
}

const lastGood = new Map<string, Entry<unknown>>();
const inflight = new Map<string, { at: number; p: Promise<unknown> }>();

/** Cap so a long-lived instance cannot accumulate unbounded last-good keys. */
const LAST_GOOD_MAX = 64;

function setLastGood<T>(key: string, entry: Entry<T>): void {
  // Re-insert so a refreshed key counts as newest (Map insertion order).
  if (lastGood.has(key)) lastGood.delete(key);
  lastGood.set(key, entry);
  while (lastGood.size > LAST_GOOD_MAX) {
    const oldest = lastGood.keys().next().value;
    if (oldest === undefined) break;
    lastGood.delete(oldest);
  }
}

export interface LegOptions<T> {
  /** How long THIS build may wait for a fresh value. */
  waitMs: number;
  /** Wait used when there is no last-good at all (cold instance). Defaults to waitMs. */
  coldWaitMs?: number;
  /** A cache hit younger than this is served without fetching ("cached", not stale). */
  ttlMs?: number;
  /** A last-good older than this is NOT served — the leg reports missing instead. */
  maxStaleMs: number;
  /** Values that count as a successful fetch (default: non-null). */
  isGood?: (v: T) => boolean;
}

export interface LegResult<T> {
  value: T | null;
  leg: BudgetLeg;
  /** Epoch ms the served value was fetched (null when missing). */
  fetchedAtMs: number | null;
}

function startFetch<T>(key: string, fetcher: () => Promise<T | null>, isGood: (v: T) => boolean): Promise<T | null> {
  const now = Date.now();
  const running = inflight.get(key);
  if (running && now - running.at < INFLIGHT_MAX_MS) return running.p as Promise<T | null>;
  const p = (async () => {
    try {
      const v = await fetcher();
      if (v != null && isGood(v)) setLastGood(key, { at: Date.now(), value: v });
      return v;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, { at: now, p });
  return p;
}

/**
 * One budgeted leg: fresh if it lands in time, else last-good (stale), else
 * missing. Never throws. `clone` protects the cache from callers that mutate
 * what they are given (build-desk patches series in place).
 */
export async function budgetedLeg<T>(
  id: string,
  key: string,
  fetcher: () => Promise<T | null>,
  opts: LegOptions<T>,
  clone: (v: T) => T = (v) => v,
): Promise<LegResult<T>> {
  const t0 = Date.now();
  const isGood = opts.isGood ?? ((v: T) => v != null);
  const hit = lastGood.get(key) as Entry<T> | undefined;

  if (hit && opts.ttlMs != null && t0 - hit.at < opts.ttlMs) {
    return {
      value: clone(hit.value),
      fetchedAtMs: hit.at,
      leg: { id, status: "cached", ms: 0, ageSec: Math.round((t0 - hit.at) / 1000) },
    };
  }

  const usable = hit && t0 - hit.at <= opts.maxStaleMs ? hit : undefined;
  const waitMs = Math.max(0, usable ? opts.waitMs : (opts.coldWaitMs ?? opts.waitMs));
  const TIMEOUT = Symbol("timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const raced = await Promise.race<T | null | typeof TIMEOUT>([
    startFetch(key, fetcher, isGood),
    new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), waitMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  const ms = Date.now() - t0;

  if (raced !== TIMEOUT && raced != null && isGood(raced)) {
    return { value: clone(raced), fetchedAtMs: Date.now(), leg: { id, status: "fresh", ms, ageSec: 0 } };
  }
  const note = raced === TIMEOUT ? `missed ${Math.round(waitMs / 100) / 10}s wait` : "upstream empty/failed";
  // Re-read: a concurrent build may have landed a value while we waited.
  const latest = (lastGood.get(key) as Entry<T> | undefined) ?? usable;
  if (latest && Date.now() - latest.at <= opts.maxStaleMs) {
    const ageSec = Math.round((Date.now() - latest.at) / 1000);
    return { value: clone(latest.value), fetchedAtMs: latest.at, leg: { id, status: "stale", ms, ageSec, note } };
  }
  return { value: null, fetchedAtMs: null, leg: { id, status: "missing", ms, ageSec: null, note } };
}

/** Remaining ms of a budget that started at `t0` (never negative). */
export function remaining(t0: number, budgetMs: number, nowMs = Date.now()): number {
  return Math.max(0, budgetMs - (nowMs - t0));
}

/**
 * Fold the legs into the payload's honest summary. `core` are the leg ids the
 * desk's grades read (structure bars + quotes): only those make the desk
 * `stale`. Ladder/spot legs that trip are listed but do not stale the desk —
 * their consumers already degrade on empty series.
 */
export function summarizeBudget(
  legs: BudgetLeg[],
  core: string[],
  t0: number,
  nowMs = Date.now(),
): DeskBudgetRead {
  const bad = legs.filter((l) => l.status === "stale" || l.status === "missing");
  const staleCore = bad.filter((l) => core.includes(l.id)).map((l) => l.id);
  const describe = (l: BudgetLeg) =>
    l.status === "missing" ? `${l.id} missing` : `${l.id} last-good ${l.ageSec}s old`;
  const coreLegs = bad.filter((l) => core.includes(l.id));
  return {
    budgetMs: DESK_BUDGET_MS,
    coldCapMs: DESK_COLD_CAP_MS,
    elapsedMs: nowMs - t0,
    tripped: bad.length > 0,
    stale: staleCore.length > 0,
    staleCore,
    legs,
    line: coreLegs.length
      ? `Stale desk: ${coreLegs.map(describe).join(" · ")} (upstream missed the ${DESK_BUDGET_MS / 1000}s budget)`
      : "",
  };
}


/**
 * Map a structure-series LegStatus onto the derived Databento quote status.
 * TTL `cached` must not silently become `fresh` (asOf / age semantics).
 */
export function quoteStatusFromSeries(seriesStatus: LegStatus): LegStatus {
  return seriesStatus === "cached" || seriesStatus === "stale" ? seriesStatus : "fresh";
}

/**
 * Fail-closed desk-stale gate: undefined/missing `stale` blocks execution,
 * same as `stale === true`. Only an explicit `false` clears the gate.
 */
export function isDeskStaleBlocked(stale: boolean | undefined | null): boolean {
  return stale !== false;
}

/** Test hook: forget every cached and in-flight value. */
export function __resetDeskBudgetCache(): void {
  lastGood.clear();
  inflight.clear();
}

/** Test hook: last-good Map size (for bound coverage). */
export function __lastGoodSize(): number {
  return lastGood.size;
}

/** Test hook: last-good capacity. */
export function __lastGoodMax(): number {
  return LAST_GOOD_MAX;
}
