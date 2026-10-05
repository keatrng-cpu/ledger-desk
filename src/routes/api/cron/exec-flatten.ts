/**
 * GET /api/cron/exec-flatten — the execution layer's unattended safety net.
 *
 * From 15:30 ET (the room's own last-resort flatten) until the close, flatten every contract the executor owns at
 * the broker, even with every browser closed. It never opens anything and never sells what this system did not
 * buy; it does not take the executor lease, so it cannot lock a live browser out. It guarantees no automated
 * position is carried into the close — it does NOT manage a position during the day (that is the room engine,
 * which runs in a browser; a server-side runner is what live still needs).
 *
 * Auth and shape: the same as the other cron routes (lib/alerts/cron.ts) — `Authorization: Bearer <CRON_SECRET>`,
 * 503 when unset, 401 when wrong. `CRON_USER_ID` MUST be this trader's id (the Execution card prints it): the
 * audit table and the arming state are per trader, and a cron has no session. Schedule it at both DST times
 * (vercel.json) or from any scheduler that can send the header; `?force=1` skips the clock for a manual run.
 */

import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, etWindow, isForced, jsonResponse, type CronRunResult } from "@/lib/alerts/cron";
import { getSql } from "@/lib/db";
import { brokerFromEnv } from "@/lib/room/exec/alpaca";
import { PgExecStore } from "@/lib/room/exec/exec-sql";
import { execStep } from "@/lib/room/exec/executor";
import { safetyNetDue } from "@/lib/room/exec/safety-net";

async function handle({ request }: { request: Request }): Promise<Response> {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  const now = new Date();
  const win = etWindow(now, 15);
  const due = safetyNetDue(now.getTime(), isForced(request));
  const base = { ok: true as const, job: "exec-flatten", etDay: win.day, etTime: win.time };
  if (!due.due) return jsonResponse({ ...base, ran: false, skipped: due.why } satisfies CronRunResult, 200);

  try {
    const sql = await getSql();
    const store = new PgExecStore((t, p) => sql.query(t, p), auth.userId);
    const wanted = (await store.state()).wanted;
    await store.markNet(now.getTime());
    if (wanted !== "paper" && wanted !== "live") {
      return jsonResponse({ ...base, ran: false, skipped: `execution phase is ${wanted}: nothing is sent, nothing to flatten` } satisfies CronRunResult, 200);
    }
    const broker = brokerFromEnv(wanted);
    const before = Date.now();
    const res = await execStep(
      { store, broker, nowMs: before, liveKeys: Boolean(process.env.ALPACA_LIVE_KEY_ID && process.env.ALPACA_LIVE_SECRET_KEY) },
      { deviceId: "cron-flatten", entries: [], exits: [], desired: [], feedLagSec: null, flatten: true, force: true },
    );
    const sent = res.rows.filter((r) => r.role === "exit" && r.atMs >= before - 1000);
    return jsonResponse(
      {
        ...base,
        ran: true,
        detail: { phase: wanted, role: res.role, ordersSent: sent.length, positionsLeft: res.positions?.length ?? null, notes: res.notes.slice(0, 5) },
      } satisfies CronRunResult,
      200,
    );
  } catch (err) {
    // Detail server-side; the caller gets a generic message.
    console.error("[cron] exec-flatten failed:", err);
    return jsonResponse({ ok: false, error: "Flatten job failed" }, 500);
  }
}

export const Route = createFileRoute("/api/cron/exec-flatten")({
  server: {
    handlers: {
      GET: handle,
    },
  },
});
