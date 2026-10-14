/**
 * /api/desk/paper-journal — PAPER futures journal (source=paper-futures), separate from every live stat.
 * GET: paper-only stats view. POST: one closed paper trade, `Authorization: Bearer <PAPER_JOURNAL_TOKEN>`.
 * No order endpoints; writes only desk_paper_journal.
 */
import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse } from "@/lib/alerts/cron";
import { paperAuthorized, safePaperRow, insertPaperRow, paperStats } from "@/lib/desk/paper-journal";

async function get(): Promise<Response> {
  try { const { getSql } = await import("@/lib/db"); return jsonResponse({ ok: true, ...(await paperStats(await getSql())) }, 200, { "cache-control": "no-store" }); }
  catch (err) { console.error("[desk] paper journal read failed:", err); return jsonResponse({ ok: false, error: "paper journal unavailable" }, 503); }
}
async function post({ request }: { request: Request }): Promise<Response> {
  if (!paperAuthorized(request.headers.get("authorization"))) return jsonResponse({ ok: false, error: "Unauthorized" }, 401, { "www-authenticate": "Bearer" });
  let raw: unknown; try { raw = await request.json(); } catch { return jsonResponse({ ok: false, error: "bad json" }, 400); }
  const v = safePaperRow(raw); if (!v.ok) return jsonResponse({ ok: false, error: `rejected: ${v.why}` }, 422);
  try { const { getSql } = await import("@/lib/db"); const inserted = await insertPaperRow(await getSql(), v.row, Date.now()); return jsonResponse({ ok: true, inserted }, 200); }
  catch (err) { console.error("[desk] paper journal write failed:", err); return jsonResponse({ ok: false, error: "store failed" }, 503); }
}
export const Route = createFileRoute("/api/desk/paper-journal")({ server: { handlers: { GET: get, POST: post } } });
