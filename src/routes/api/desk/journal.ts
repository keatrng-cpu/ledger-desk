/**
 * GET /api/desk/journal — fix 23 band report + the learning loop: snapshot
 * counts, graded outcomes with hows/whys and failure modes, missed trades
 * (fix 40), per-factor lifts, band-edge moves, and the APPLIED calibration
 * version. Read only.
 */
import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse } from "@/lib/alerts/cron";

async function handle(): Promise<Response> {
  try {
    const { getSql } = await import("@/lib/db");
    const { journalReport } = await import("@/lib/desk/card-journal");
    const { learningReport } = await import("@/lib/desk/learning");
    const { BAND_EDGES_BASE } = await import("@/lib/smc/discipline");
    const sql = await getSql();
    const now = Date.now();
    return jsonResponse(
      { ok: true, ...(await journalReport(sql, now, 7)), learning: await learningReport(sql, now, { ...BAND_EDGES_BASE }) },
      200,
      { "cache-control": "no-store" },
    );
  } catch (err) {
    console.error("[desk] journal report failed:", err);
    return jsonResponse({ ok: false, error: "journal unavailable" }, 503);
  }
}

export const Route = createFileRoute("/api/desk/journal")({
  server: { handlers: { GET: handle } },
});
