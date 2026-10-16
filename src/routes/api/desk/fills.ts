/**
 * /api/desk/fills — the desk-watcher reports live order events (placed / filled / rejected / exit).
 * POST only, `Authorization: Bearer <WATCHER_STATUS_TOKEN>` only (no CRON_SECRET fallback). Idempotent per signal.
 * Writes room_orders + desk_trades (see src/lib/desk/watcher-fills.ts). Places no order. Owner: env DESK_OWNER_USER_ID.
 */
import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse } from "@/lib/alerts/cron";
import { watcherFillsAuthorized } from "@/lib/desk/watcher-status";
import { watcherFillSchema, applyWatcherFill, WatcherFillRefused } from "@/lib/desk/watcher-fills";
import { captureError } from "@/lib/notify/sentry";

async function post({ request }: { request: Request }): Promise<Response> {
  if (!watcherFillsAuthorized(request.headers.get("authorization")))
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401, { "www-authenticate": "Bearer" });
  const userId = process.env.DESK_OWNER_USER_ID?.trim();
  if (!userId) return jsonResponse({ ok: false, error: "DESK_OWNER_USER_ID is not set" }, 503);
  let raw: unknown;
  try { raw = await request.json(); } catch { return jsonResponse({ ok: false, error: "bad json" }, 400); }
  const p = watcherFillSchema.safeParse(raw);
  if (!p.success) return jsonResponse({ ok: false, error: "rejected: " + p.error.issues.map((i) => i.path.join(".")).join(", ") }, 422);
  if (p.data.shadow || p.data.dryRun) return jsonResponse({ ok: false, error: "shadow/dry-run events are not recorded" }, 422);
  try {
    const { getSql } = await import("@/lib/db");
    const j = await import("@/lib/journal/server");
    const r = await applyWatcherFill(await getSql(), userId, p.data, { recordRealFillFor: j.recordRealFillFor, closeTradeFor: j.closeTradeFor });
    return jsonResponse(r, 200);
  } catch (err) {
    if (err instanceof WatcherFillRefused) return jsonResponse({ ok: false, error: err.message.slice(0, 300) }, 422);
    console.error("[desk] watcher fill write failed:", err);
    void captureError(err, { route: "desk/fills" });
    return jsonResponse({ ok: false, error: "store failed" }, 503);
  }
}

export const Route = createFileRoute("/api/desk/fills")({
  server: { handlers: { POST: post } },
});
