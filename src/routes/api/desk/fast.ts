/** /api/desk/fast — GET the latest fast-move layer (shadow); POST from the watcher (Bearer WATCHER_STATUS_TOKEN). */
import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse } from "@/lib/alerts/cron";
import { safeWatcherStatus, watcherAuthorized } from "@/lib/desk/watcher-status";
import { fastWire } from "@/lib/desk/fast";

async function get(): Promise<Response> {
  try {
    const sql = await (await import("@/lib/db")).getSql();
    const r = (await sql`select body from desk_fast where id = 1`) as { body: never }[];
    return jsonResponse({ ok: true, fast: fastWire(r[0]?.body ?? null, Date.now()) }, 200, { "cache-control": "no-store" });
  } catch { return jsonResponse({ ok: false, error: "fast unavailable" }, 503); }
}
async function post({ request }: { request: Request }): Promise<Response> {
  if (!watcherAuthorized(request.headers.get("authorization"))) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  let raw: unknown; try { raw = await request.json(); } catch { return jsonResponse({ ok: false, error: "bad json" }, 400); }
  const s = safeWatcherStatus(raw); if (!s.ok) return jsonResponse({ ok: false, error: `rejected: ${s.why}` }, 422);
  try {
    const sql = await (await import("@/lib/db")).getSql();
    await sql`insert into desk_fast (id, body, received_ms) values (1, ${JSON.stringify(s.body)}::jsonb, ${Date.now()})
              on conflict (id) do update set body = excluded.body, received_ms = excluded.received_ms`;
    return jsonResponse({ ok: true }, 200);
  } catch { return jsonResponse({ ok: false, error: "store failed" }, 503); }
}
export const Route = createFileRoute("/api/desk/fast")({ server: { handlers: { GET: get, POST: post } } });
