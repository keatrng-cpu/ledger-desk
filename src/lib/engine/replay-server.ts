/**
 * Server side of the replay calibration harness: fetch real 5d/15m Yahoo
 * bars for MNQ + ES, run the no-lookahead replay in BOTH directions (MNQ
 * with ES as SMT peer and vice versa), and persist the latest report into
 * engine_runs (kind 'replay') for the signed-in user.
 */

import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { fetchYahooBars } from "@/lib/market/yahoo";
import {
  calibrationReport,
  replayScan,
  type CalibrationReport,
  type ReplayOutcome,
} from "@/lib/trading/replay";

export interface ReplayRunMeta {
  ranAt: string;
  range: string;
  interval: string;
  symbols: string[];
  barCounts: Record<string, number>;
  firstBar: string;
  lastBar: string;
}

export interface ReplayRunPayload {
  report: CalibrationReport;
  outcomes: ReplayOutcome[];
  meta: ReplayRunMeta;
}

export type RunReplayResult =
  | ({ ok: true } & ReplayRunPayload)
  | { ok: false; error: string };

export const runReplay = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<RunReplayResult> => {
    try {
      const [mnq, es] = await Promise.all([
        fetchYahooBars("MNQ", "5d", "15m"),
        fetchYahooBars("ES", "5d", "15m"),
      ]);
      if (!mnq || !es) {
        return {
          ok: false,
          error:
            "Yahoo 5d/15m bars unavailable for MNQ/ES — replay needs real bars (no synthetic fallback for calibration).",
        };
      }

      // Both directions: each symbol replayed with the other as SMT peer.
      const outcomes: ReplayOutcome[] = [
        ...replayScan(mnq.bars, es.bars, {
          symbol: mnq.symbol,
          peerSymbol: es.symbol,
        }),
        ...replayScan(es.bars, mnq.bars, {
          symbol: es.symbol,
          peerSymbol: mnq.symbol,
        }),
      ];
      const report = calibrationReport(outcomes);

      const meta: ReplayRunMeta = {
        ranAt: new Date().toISOString(),
        range: "5d",
        interval: "15m",
        symbols: [mnq.symbol, es.symbol],
        barCounts: {
          [mnq.symbol]: mnq.bars.length,
          [es.symbol]: es.bars.length,
        },
        firstBar: mnq.first,
        lastBar: mnq.last,
      };
      const payload: ReplayRunPayload = { report, outcomes, meta };

      // Persist latest report (kind 'replay') — best effort: a DB hiccup
      // must not eat a successful computation.
      try {
        const sql = await getSql();
        await sql`
          insert into engine_runs (id, user_id, kind, label, payload)
          values (${crypto.randomUUID()}, ${context.userId}, ${"replay"},
                  ${`MNQ+ES 5d/15m · ${report.total} outcomes`},
                  ${JSON.stringify(payload)}::jsonb)
        `;
      } catch (err) {
        console.error("[replay] failed to persist replay run:", err);
      }

      return { ok: true, ...payload };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Replay run failed",
      };
    }
  });
