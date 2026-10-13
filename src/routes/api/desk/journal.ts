/**
 * GET /api/desk/journal — fix 23: what the A-/A/A+ cards earned over the
 * last 7 ET days, band by band, with a recalibration SUGGESTION that is never
 * applied automatically (insufficient n says so).
 */
import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse } from "@/lib/alerts/cron";

async function handle(): Promise<Response> {
  try {
    const { getSql } = await import("@/lib/db");
    const { journalReport } = await import("@/lib/desk/card-journal");
    return jsonResponse({ ok: true, ...(await journalReport(await getSql(), Date.now(), 7)) }, 200, { "cache-control": "no-store" });
  } catch (err) {
    console.error("[desk] journal report failed:", err);
    return jsonResponse({ ok: false, error: "journal unavailable" }, 503);
  }
}

export const Route = createFileRoute("/api/desk/journal")({
  server: { handlers: { GET: handle } },
});
