/**
 * Load year-study backtest seed into desk memory so the brain/rates hold
 * across sessions without re-running Databento every time.
 */

import type { BacktestFillRecord, MemoryKind } from "./desk-memory";
import {
  loadDeskMemory,
  saveDeskMemory,
  type DeskMemoryState,
  type RateBucket,
} from "./desk-memory";

export interface YearStudySeed {
  year: number;
  weeksApprox: number;
  monthsRun: number;
  fills: number;
  wins: number;
  wr: number | null;
  sumR: number;
  sumUsd: number;
  expectancyR: number | null;
  byStrat: Record<
    string,
    { n: number; wins: number; sumR: number; sumUsd?: number }
  >;
  byBand: Record<string, { n: number; wins: number; sumR: number }>;
  bySide: Record<string, { n: number; wins: number; sumR: number }>;
  byExit?: Record<string, { n: number; wins?: number; sumR: number }>;
  months?: Record<string, unknown>;
  fillList?: BacktestFillRecord[];
  optimizedAt?: string;
  learnings?: string[];
}

function toBucket(b: {
  n: number;
  wins: number;
  sumR: number;
}): RateBucket {
  return { n: b.n, wins: b.wins, sumR: b.sumR };
}

/**
 * Replace rates with seed study (idempotent by year tag).
 */
export function hydrateFromYearStudy(
  seed: YearStudySeed,
  opts?: { force?: boolean; applyEquity?: boolean },
): DeskMemoryState {
  const state = loadDeskMemory();
  const tag = `seed-year-${seed.year}`;
  const already = state.items.some(
    (i) => i.kind === "backtest" && i.tags.includes(tag),
  );
  if (already && !opts?.force) {
    return state;
  }

  const empty = state.book.pathTaken === 0 || opts?.force;
  if (empty || opts?.force) {
    state.rates.byStrategy = {};
    state.rates.byBand = {};
    state.rates.bySide = {};
    for (const [k, v] of Object.entries(seed.byStrat || {})) {
      state.rates.byStrategy[k] = toBucket(v);
    }
    for (const [k, v] of Object.entries(seed.byBand || {})) {
      state.rates.byBand[k] = toBucket(v);
    }
    for (const [k, v] of Object.entries(seed.bySide || {})) {
      state.rates.bySide[k] = toBucket(v);
    }
    state.book.pathTaken = seed.fills;
    state.book.pathWins = seed.wins;
    state.book.pathLosses = seed.fills - seed.wins;
    state.book.sumR = seed.sumR;
    state.book.sumUsd = seed.sumUsd;
    if (opts?.applyEquity !== false) {
      const start = state.book.startEquity || 100_000;
      state.book.equity = Math.max(100, start + seed.sumUsd);
      state.book.peakEquity = Math.max(
        state.book.peakEquity || start,
        state.book.equity,
      );
    }
    state.book.lastBacktestLabel = `${seed.year} year study (${seed.monthsRun} mo)`;
    state.book.lastBacktestPath = seed.fills;
    state.book.lastBacktestWr = seed.wr;
    state.book.lastBacktestSumR = seed.sumR;
    state.book.lastBacktestSumUsd = seed.sumUsd;
    state.book.updatedAt = Date.now();
    if (seed.fillList?.length) {
      state.rates.recentFills = seed.fillList.slice(0, 200);
    }
  }

  const learn =
    seed.learnings?.slice(0, 5).join(" · ") ||
    `Year ${seed.year}: ${seed.fills} PATH · WR ${seed.wr != null ? (seed.wr * 100).toFixed(0) + "%" : "—"} · ${seed.sumR}R`;
  state.pins = [
    learn,
    ...state.pins.filter((p) => !p.startsWith(`Year ${seed.year}`)),
  ].slice(0, 20);

  const kind: MemoryKind = "backtest";
  state.items = [
    {
      id: `seed-${seed.year}-${Date.now().toString(36)}`,
      kind,
      ts: Date.now(),
      title: `${seed.year} year study`,
      summary: `PATH ${seed.fills} · WR ${seed.wr != null ? (seed.wr * 100).toFixed(0) + "%" : "—"} · ${seed.sumR}R · $${seed.sumUsd} · ${seed.monthsRun} months`,
      tags: ["backtest", "year-study", tag, "seed"],
      payload: seed as unknown as Record<string, unknown>,
    },
    ...state.items.filter((i) => !i.tags.includes(tag)),
  ].slice(0, 120);

  saveDeskMemory(state);
  return state;
}

export async function fetchYearStudySeed(
  year = 2024,
): Promise<YearStudySeed | null> {
  try {
    const res = await fetch(`/data/bt-${year}-summary.json`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as YearStudySeed;
  } catch {
    return null;
  }
}
