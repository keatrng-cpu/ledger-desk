/**
 * GET /api/cron/exec-flatten — the execution layer's unattended safety net.
 *
 * From 15:30 ET until the close: close every Robinhood option this desk opened,
 * even with the execution phase off and every browser closed. The Alpaca
 * executor is not the sender (its broker stays null). A kill stops new entries
 * on the room step; this route only flattens.
 *
 * Auth and shape: the same as the other cron routes (lib/alerts/cron.ts) — `Authorization: Bearer <CRON_SECRET>`,
 * 503 when unset, 401 when wrong. `CRON_USER_ID` MUST be this trader's id (the Execution card prints it): the
 * audit table and the arming state are per trader, and a cron has no session. Schedule it at both DST times
 * (vercel.json) or from any scheduler that can send the header; `?force=1` skips the clock for a manual run.
 */

import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, etWindow, isForced, jsonResponse, type CronRunResult } from "@/lib/alerts/cron";
import { getSql } from "@/lib/db";
import { rhAutofireEnabled, rhLiveArmed } from "@/lib/execution/rh-autofire";
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
    const before = Date.now();
    let alpaca: { role: string; ordersSent: number; notes: string[] } | null = null;
    if (wanted === "paper" || wanted === "live") {
      const broker = null;
      const res = await execStep(
        { store, broker, nowMs: before, liveKeys: rhAutofireEnabled() && rhLiveArmed() },
        { deviceId: "cron-flatten", entries: [], exits: [], desired: [], feedLagSec: null, flatten: true, force: true },
      );
      const sent = res.rows.filter((r) => r.role === "exit" && r.atMs >= before - 1000);
      alpaca = { role: res.role, ordersSent: sent.length, notes: res.notes.slice(0, 5) };
    }
    let rh: { sent: boolean; phase: string; why: string } = { sent: false, phase: "look", why: "not run" };
    try {
      const { runRhDesk } = await import("@/lib/execution/rh-dispatch");
      const { fileLedger } = await import("@/lib/execution/rh-ledger");
      const { toolingFromEnv } = await import("@/lib/execution/rh-http");
      const out = await runRhDesk({
        desk: null,
        manager: null,
        nowMs: before,
        tooling: toolingFromEnv(),
        ledger: fileLedger(),
        flatten: true,
      });
      rh = { sent: out.sent, phase: out.cycle.phase, why: out.why };
    } catch (err) {
      console.error("[cron] exec-flatten robinhood failed:", err);
      rh = { sent: false, phase: "look", why: "sender failed" };
    }
    return jsonResponse(
      {
        ...base,
        ran: true,
        detail: { phase: wanted, role: alpaca?.role ?? "robinhood", ordersSent: alpaca?.ordersSent ?? 0, positionsLeft: null, notes: alpaca?.notes ?? [], rh },
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
