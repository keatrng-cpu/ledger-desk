/**
 * Server fn exposing the real measured-edge discretion factor per strategy —
 * the piece that makes "the brain" actually connected instead of narrative
 * (see journal/discretion.ts for the full rationale and the math).
 *
 * Reads REAL closed trades from Postgres (live + paper, both auth-scoped),
 * blends in the static year-study backtest seed as a fading cold-start prior,
 * and returns one DiscretionResult per attributed strategy. The client
 * (index.tsx) fetches this on the same poll cadence as risk state and
 * applies it as an overlay on the scanner's candidates — same pattern
 * already used for entry-gate suppression, so this is not a new
 * architecture, just a new real data source feeding an existing overlay
 * point.
 */

import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { readClosed } from "./analytics-server";
import { normalizeKey, type AnalyticsTrade } from "./analytics";
import {
  computeDiscretion,
  neutralDiscretion,
  type BacktestPrior,
  type DiscretionResult,
} from "./discretion";
// Bundled at build time (resolveJsonModule) — no runtime fs/network dependency,
// so this never fails on a serverless host the way a fetch("/data/...") would
// server-side. Same file bt-seed.ts already loads client-side for the
// legacy localStorage brain; this is the durable, per-user-blind counterpart.
import btSeed2024 from "../../../public/data/bt-2024-summary.json";

interface YearStratRow {
  n: number;
  wins: number;
  sumR: number;
}

export function backtestPriorFor(strategy: string): BacktestPrior | null {
  const byStrat = (btSeed2024 as { byStrat?: Record<string, YearStratRow> })
    .byStrat;
  const row = byStrat?.[strategy];
  if (!row || row.n <= 0) return null;
  return { n: row.n, wins: row.wins, sumR: row.sumR };
}

function groupByStrategy(
  trades: AnalyticsTrade[],
): Map<string, AnalyticsTrade[]> {
  const map = new Map<string, AnalyticsTrade[]>();
  for (const t of trades) {
    const k = normalizeKey(t.strategy);
    if (k == null) continue; // unattributed rows never get folded into a strategy
    const arr = map.get(k) ?? [];
    arr.push(t);
    map.set(k, arr);
  }
  return map;
}

export interface DiscretionPayload {
  byStrategy: Record<string, DiscretionResult>;
  generatedAt: string;
}

export const getDiscretionState = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<DiscretionPayload> => {
    const sql = await getSql();
    const [live, paper] = await Promise.all([
      readClosed(sql, context.userId, "live", null),
      readClosed(sql, context.userId, "paper", null),
    ]);

    const liveByStrat = groupByStrategy(live);
    const paperByStrat = groupByStrategy(paper);
    const strategies = new Set([...liveByStrat.keys(), ...paperByStrat.keys()]);

    const byStrategy: Record<string, DiscretionResult> = {};
    for (const strategy of strategies) {
      byStrategy[strategy] = computeDiscretion(
        strategy,
        liveByStrat.get(strategy) ?? [],
        paperByStrat.get(strategy) ?? [],
        backtestPriorFor(strategy),
      );
    }

    return { byStrategy, generatedAt: new Date().toISOString() };
  });

/** Client-side lookup helper: exact strategy match, else neutral (never blocks on a miss). */
export function discretionFor(
  payload: DiscretionPayload | null | undefined,
  strategy: string | null | undefined,
): DiscretionResult {
  const key = normalizeKey(strategy ?? null);
  if (!key || !payload) return neutralDiscretion(strategy ?? "unknown");
  return payload.byStrategy[key] ?? neutralDiscretion(key);
}
