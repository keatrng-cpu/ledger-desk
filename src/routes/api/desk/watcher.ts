/**
 * /api/desk/watcher — the Watcher tab feed.
 * GET: latest desk-watcher status (public-safe: account masked ••••6158, no balances, no credentials). Read only.
 * POST: the watcher pushes its status with `Authorization: Bearer <WATCHER_STATUS_TOKEN>` (CRON_SECRET fallback); payload is re-checked server side.
 * No order endpoints here — the tab is read-only.
 * `preopen` (additive) is the same verdict the 08:20 CT pre-open check posts to Slack: heartbeat fresh + rules hash == desk.
 * Read/write failures go to Sentry when SENTRY_DSN is set (no-op otherwise).
 */
import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse } from "@/lib/alerts/cron";
import { safeWatcherStatus, watcherAuthorized, WATCHER_STALE_S } from "@/lib/desk/watcher-status";
import { evaluatePreopen } from "@/lib/notify/preopen";
import { captureError } from "@/lib/notify/sentry";
import { RULES_HASH } from "@/lib/desk/rules-hash";

async function get(): Promise<Response> {
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = (await sql`select body, received_ms from desk_watcher_status where id = 1`) as { body: Record<string, unknown>; received_ms: number }[];
    if (!rows.length) return jsonResponse({ ok: true, status: null, note: "watcher has not reported yet" }, 200, { "cache-control": "no-store" });
    const r = rows[0];
    const hb = Number((r.body as { heartbeat?: number }).heartbeat ?? 0) * 1000;
    const ageS = hb ? (Date.now() - hb) / 1000 : null;
    const pre = evaluatePreopen({ ok: true, status: r.body as { rules_hash?: string | null }, heartbeatAgeS: ageS }, RULES_HASH, Date.now());
    return jsonResponse({ ok: true, status: r.body, receivedMs: Number(r.received_ms), heartbeatAgeS: ageS, stale: ageS == null || ageS > WATCHER_STALE_S, preopen: { ok: pre.ok, failures: pre.failures } }, 200, { "cache-control": "no-store" });
  } catch (err) {
    console.error("[desk] watcher status read failed:", err);
    void captureError(err, { route: "desk/watcher", op: "read" });
    return jsonResponse({ ok: false, error: "watcher status unavailable" }, 503);
  }
}

async function post({ request }: { request: Request }): Promise<Response> {
  if (!watcherAuthorized(request.headers.get("authorization")))
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401, { "www-authenticate": "Bearer" });
  let raw: unknown;
  try { raw = await request.json(); } catch { return jsonResponse({ ok: false, error: "bad json" }, 400); }
  const s = safeWatcherStatus(raw);
  if (!s.ok) return jsonResponse({ ok: false, error: `rejected: ${s.why}` }, 422);
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const body = JSON.stringify(s.body);
    await sql`insert into desk_watcher_status (id, body, received_ms) values (1, ${body}::jsonb, ${Date.now()})
              on conflict (id) do update set body = excluded.body, received_ms = excluded.received_ms`;
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    console.error("[desk] watcher status write failed:", err);
    void captureError(err, { route: "desk/watcher", op: "write" });
    return jsonResponse({ ok: false, error: "store failed" }, 503);
  }
}

export const Route = createFileRoute("/api/desk/watcher")({
  server: { handlers: { GET: get, POST: post } },
});
