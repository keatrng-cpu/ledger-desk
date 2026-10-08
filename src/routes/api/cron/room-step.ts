/**
 * GET /api/cron/room-step — one paper cycle with the tab closed.
 *
 * Builds the same desk the browser builds, then rolls, marks, and runs the
 * room. The fill is the room's paper book (applyCycle / applyLab). The five
 * already decided the ticket; this only persists that decision and their
 * memory. It does not import the Alpaca executor.
 *
 * After the book is saved it runs the Robinhood sender on this same desk
 * (review, then place or close). No token means the cycle is decided and
 * nothing is sent. A sender failure does not roll back the paper book.
 *
 * Skips outside the options session (09:30–16:00 ET, which includes the
 * 15:30 flatten). Skips when a browser saved the book inside the 90s lease.
 * Skips a synthetic feed and does not persist it. A late Yahoo print still
 * steps, so an exit can fire; fresh_tape already blocks the entry.
 *
 * The 15:30 broker flatten stays the broker backstop. This route does not
 * set SERVER_RUNNER_BUILT.
 *
 * Auth: Bearer CRON_SECRET (503 unset, 401 wrong). CRON_USER_ID is the
 * trader, same as the other crons. `?force=1` skips the clock only.
 */

import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, etWindow, isForced, jsonResponse, type CronRunResult } from "@/lib/alerts/cron";
import { getSql } from "@/lib/db";
import { loadPulse } from "@/lib/news/news-server";
import { marketDataFromDesk, readDeskForRoom } from "@/lib/room/desk-read";
import { asLab, labRead } from "@/lib/room/lab";
import { outputViolations, runRoomCycle } from "@/lib/room/orchestrator";
import { applyCycle, applyLab, emptyBook, exitWatchOf, ledgerOf, markBook, rollCounters, toRoomInput } from "@/lib/room/paper-book";
import {
  PAPER_STEP_CAS_SQL,
  PAPER_STEP_INSERT_SQL,
  PAPER_STEP_READ_SQL,
  browserHoldsLease,
  feedMayStep,
  paperStepDue,
  savedAtMsOf,
} from "@/lib/room/paper-step";
import { asSeatBook } from "@/lib/room/seats";
import { MAX_SNAPSHOT_BYTES, isSnapshot, rankOf, type RoomSnapshot } from "@/lib/room/snapshot";
import { fetchTradingDesk } from "@/lib/trading/build-desk";
import { evaluateOptionsDesk } from "@/lib/trading/options-desk";

async function handle({ request }: { request: Request }): Promise<Response> {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  const now = new Date();
  const win = etWindow(now, 0);
  const base = { ok: true as const, job: "room-step", etDay: win.day, etTime: win.time };
  const due = paperStepDue(now.getTime(), isForced(request));
  if (!due.due) return jsonResponse({ ...base, ran: false, skipped: due.why } satisfies CronRunResult, 200);

  try {
    const sql = await getSql();
    const rows = await sql.query<{ body: unknown; saved_ms: unknown; saved_at: string | null }>(PAPER_STEP_READ_SQL, [auth.userId]);
    const row = rows[0];
    const savedAtMs = row ? savedAtMsOf(row.saved_ms) : null;
    if (browserHoldsLease(savedAtMs, Date.now())) {
      return jsonResponse({ ...base, ran: false, skipped: "browser holds the lease" } satisfies CronRunResult, 200);
    }

    let book = emptyBook(undefined, now.getTime());
    let minds: RoomSnapshot["minds"] = null;
    if (row) {
      const body = typeof row.body === "string" ? (JSON.parse(row.body) as unknown) : row.body;
      if (!isSnapshot(body)) {
        return jsonResponse({ ...base, ran: false, skipped: "snapshot is not a room book" } satisfies CronRunResult, 200);
      }
      book = body.book;
      minds = body.minds;
    }

    const res = await fetchTradingDesk({ data: { left: "MNQ", right: "ES" } });
    if (!res.ok) return jsonResponse({ ok: false, error: res.error, desk: "unavailable" }, 503);
    const feed = feedMayStep(res.feed);
    if (!feed.step) return jsonResponse({ ...base, ran: false, skipped: feed.why } satisfies CronRunResult, 200);

    const nowMs = Date.parse(res.fetchedAt) || Date.now();
    const pulse = await loadPulse().catch(() => null);
    const vix = pulse?.pulse.find((p) => p.label === "VIX")?.last ?? null;
    const tenYear = pulse?.pulse.find((p) => p.label === "10y yield")?.last ?? null;
    const od = evaluateOptionsDesk(res);
    const { market } = marketDataFromDesk(res, vix, nowMs);
    book = rollCounters(book, nowMs, res.clock.killzone);
    book = markBook(book, market, nowMs);
    const read = readDeskForRoom(res, od, exitWatchOf(book), nowMs, tenYear);
    const cycle = runRoomCycle(
      toRoomInput(book, market),
      { desk: read, ledger: ledgerOf(book), minds, lab: labRead(asLab(book.lab), book.closed) },
      nowMs,
    );
    const bad = outputViolations(cycle.output);
    if (bad.length) {
      console.error("[cron] room-step contract violation:", bad);
      return jsonResponse({ ok: false, error: "Contract violation" }, 500);
    }
    book = applyCycle(book, cycle, nowMs);
    const goal = asSeatBook(asLab(book.lab).seats)?.goal ?? null;
    book = applyLab(book, cycle, market, read, nowMs, goal);

    const next: RoomSnapshot = { version: 1, book, minds: cycle.minds };
    if (!isSnapshot(next)) return jsonResponse({ ok: false, error: "Room step failed" }, 500);
    const text = JSON.stringify(next);
    if (text.length > MAX_SNAPSHOT_BYTES) return jsonResponse({ ok: false, error: "Room step failed" }, 500);
    const rank = rankOf(book);
    const wrote = row
      ? await sql.query<{ user_id: string }>(PAPER_STEP_CAS_SQL, [auth.userId, text, rank.history, Math.round(rank.lastAt), row.saved_at])
      : await sql.query<{ user_id: string }>(PAPER_STEP_INSERT_SQL, [auth.userId, text, rank.history, Math.round(rank.lastAt)]);
    if (!wrote.length) {
      return jsonResponse({ ...base, ran: false, skipped: "snapshot changed while the room stepped" } satisfies CronRunResult, 200);
    }
    const ba = cycle.output.broker_action;
    let rh: { sent: boolean; phase: string; why: string } = { sent: false, phase: "look", why: "not run" };
    try {
      const { runRhDesk } = await import("@/lib/execution/rh-dispatch");
      const { fileLedger } = await import("@/lib/execution/rh-ledger");
      const { toolingFromEnv } = await import("@/lib/execution/rh-http");
      const { createRoomManagerFeed } = await import("@/lib/room/manager-room-feed");
      const { PgExecStore } = await import("@/lib/room/exec/exec-sql");
      const feed = createRoomManagerFeed();
      feed.pushRoom(
        { id: Math.max(1, cycle.trace.etMin || 1), nowMs, output: cycle.output, trace: cycle.trace, lenses: cycle.trace.lenses },
        { card: read.entry, newsBlackout: read.news.blackout, synthetic: res.feed === "synthetic" },
      );
      let blockNewEntries = false;
      try {
        blockNewEntries = (await new PgExecStore((t, p) => sql.query(t, p), auth.userId).state()).killed === true;
      } catch {
        blockNewEntries = true;
      }
      const out = await runRhDesk({
        desk: res,
        manager: feed.getState(),
        nowMs,
        tooling: toolingFromEnv(),
        ledger: fileLedger(),
        blockNewEntries,
      });
      rh = { sent: out.sent, phase: out.cycle.phase, why: out.why };
    } catch (err) {
      console.error("[cron] room-step robinhood failed:", err);
      rh = { sent: false, phase: "look", why: "sender failed" };
    }
    return jsonResponse(
      {
        ...base,
        ran: true,
        detail: {
          beat: cycle.trace.beat,
          execute: ba.execute_trade,
          action: ba.action_type,
          feed: res.feed,
          lagSec: read.lagSec,
          positions: book.positions.length,
          history: rank.history,
          rh,
        },
      } satisfies CronRunResult,
      200,
    );
  } catch (err) {
    console.error("[cron] room-step failed:", err);
    return jsonResponse({ ok: false, error: "Room step failed" }, 500);
  }
}

export const Route = createFileRoute("/api/cron/room-step")({
  server: {
    handlers: {
      GET: handle,
    },
  },
});
