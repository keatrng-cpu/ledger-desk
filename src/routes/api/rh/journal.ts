/**
 * /api/rh/journal — the live-trade auto-journal.
 *   GET  → journal rows + the learning aggregate (by band / side / killzone).
 *          ?day=YYYY-MM-DD (ET, default today), ?span=day|week|all.
 *   POST → reconcile now: pull RH orders + realized P&L, build round-trips,
 *          bind each to its card, upsert rh_fill_journal. Read-only vs Robinhood.
 *
 * Session-gated (the trader's own desk). Places no order.
 */
import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse } from "@/lib/alerts/cron";
import { getSessionUser } from "@/lib/auth/verify.server";

function etToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

async function get({ request }: { request: Request }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return jsonResponse({ ok: false, error: "not signed in" }, 401);
  const url = new URL(request.url);
  const span = url.searchParams.get("span") ?? "day";
  const day = url.searchParams.get("day") ?? etToday();
  try {
    const { getSql } = await import("@/lib/db");
    const { analyzeRhJournal } = await import("@/lib/journal/rh-reconcile");
    const sql = await getSql();
    const where = span === "all" ? "" : span === "week" ? "where day_key >= $2" : "where day_key = $2";
    const params: unknown[] = [user.id];
    if (span !== "all") params.push(span === "week" ? weekAgoEt() : day);
    const rows = await sql.query<Record<string, unknown>>(
      `select * from rh_fill_journal where user_id = $1 ${where ? "and " + where.replace(/^where /, "") : ""} order by opened_at desc nulls last limit 500`,
      params,
    );
    const analysis = analyzeRhJournal(
      rows.map((r) => ({
        realized: r.realized as number | null,
        roi: r.roi as number | null,
        hold_secs: r.hold_secs as number | null,
        win: r.win as boolean | null,
        card_band: r.card_band as string | null,
        side: r.side as string | null,
        killzone: r.killzone as string | null,
        card_match: r.card_match as string | null,
      })),
    );
    return jsonResponse({ ok: true, day, span, count: rows.length, analysis, rows }, 200, { "cache-control": "no-store" });
  } catch (err) {
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "read failed" }, 200);
  }
}

async function post(): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return jsonResponse({ ok: false, error: "not signed in" }, 401);
  try {
    const { getSql } = await import("@/lib/db");
    const { reconcileRhFills } = await import("@/lib/journal/rh-reconcile");
    const sql = await getSql();
    const result = await reconcileRhFills(sql, user.id);
    return jsonResponse(result, result.ok ? 200 : 200, { "cache-control": "no-store" });
  } catch (err) {
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "reconcile failed" }, 503);
  }
}

function weekAgoEt(): string {
  return new Date(Date.now() - 7 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export const Route = createFileRoute("/api/rh/journal")({
  server: { handlers: { GET: get, POST: post } },
});
