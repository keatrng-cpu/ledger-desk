/**
 * Server-side persistence for the engine bridge. Every statement is
 * parameterized (`@/lib/db` contract) — no string interpolation of values.
 *
 * Tables:
 *   desk_events            (migrations/0002_journal.sql — Phase 1 owns it)
 *   engine_status          (migrations/0004_bridge.sql — this phase)
 *   engine_ingest_batches  (migrations/0004_bridge.sql — this phase)
 */

import { getSql } from "@/lib/db";
import type { DeskEventRow, EngineMode } from "./schema";

/** Source tag for everything the Python engine pushes in. */
export const ENGINE_SOURCE = "engine" as const;

export interface IngestResult {
  inserted: number;
  duplicate: boolean;
  batchId: string | null;
}

/**
 * Claim a batch id. Returns false when the id was already ingested — the PK
 * conflict is the race-safe test, so two concurrent retries cannot both win.
 * Batches without an id are never deduplicated (documented in ENGINE_BRIDGE.md).
 */
async function claimBatch(
  userId: string,
  batchId: string,
  eventCount: number,
): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql.query<{ batch_id: string }>(
    `insert into engine_ingest_batches (batch_id, user_id, event_count)
     values ($1, $2, $3)
     on conflict (user_id, batch_id) do nothing
     returning batch_id`,
    [batchId, userId, eventCount],
  );
  return rows.length > 0;
}

async function releaseBatch(userId: string, batchId: string): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `delete from engine_ingest_batches where user_id = $1 and batch_id = $2`,
    [userId, batchId],
  );
}

/**
 * Insert engine journal rows into `desk_events` with source='engine'.
 * Idempotent per `batchId`: a repeat id inserts nothing and reports duplicate.
 */
export async function ingestEngineEvents(
  userId: string,
  events: DeskEventRow[],
  batchId: string | null,
): Promise<IngestResult> {
  if (events.length === 0) {
    return { inserted: 0, duplicate: false, batchId };
  }

  if (batchId) {
    const claimed = await claimBatch(userId, batchId, events.length);
    if (!claimed) return { inserted: 0, duplicate: true, batchId };
  }

  const sql = await getSql();
  const params: unknown[] = [];
  const tuples = events.map((e) => {
    const base = params.length;
    params.push(
      userId,
      e.ts,
      e.event,
      e.symbol,
      e.prescore,
      e.reason,
      e.pnl,
      e.r,
      JSON.stringify(e.payload),
    );
    return (
      `($${base + 1}, $${base + 2}::timestamptz, $${base + 3}, $${base + 4}, ` +
      `$${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, ` +
      `'${ENGINE_SOURCE}', $${base + 9}::jsonb)`
    );
  });

  try {
    await sql.query(
      `insert into desk_events
         (user_id, ts, event, symbol, prescore, reason, pnl, r, source, payload)
       values ${tuples.join(", ")}`,
      params,
    );
  } catch (err) {
    // Compensate the claim so a retry of the same batch id can succeed. (The
    // Neon path is a pool, so a real transaction across statements is not
    // available through the shared `Sql` surface.)
    if (batchId) await releaseBatch(userId, batchId).catch(() => undefined);
    throw err;
  }

  return { inserted: events.length, duplicate: false, batchId };
}

export interface EngineStatusRow {
  user_id: string;
  last_seen: string | null;
  mode: string | null;
  note: string | null;
  symbol: string | null;
  paper_enabled: boolean;
}

/** Heartbeat upsert — one `engine_status` row per user (id carries user id). */
export async function recordHeartbeat(
  userId: string,
  input: { mode: EngineMode; symbol?: string; note?: string },
): Promise<EngineStatusRow> {
  const sql = await getSql();
  const rows = await sql.query<EngineStatusRow>(
    `insert into engine_status (id, user_id, last_seen, mode, symbol, note, updated_at)
     values ($1, $1, now(), $2, $3, $4, now())
     on conflict (user_id) do update
       set last_seen = now(),
           mode = excluded.mode,
           symbol = excluded.symbol,
           note = excluded.note,
           updated_at = now()
     returning user_id, last_seen, mode, note, symbol, paper_enabled`,
    [userId, input.mode, input.symbol ?? null, input.note ?? null],
  );
  const row = rows[0];
  if (!row) throw new Error("engine_status upsert returned no row");
  return row;
}

/** Read the bridge status row (null when the engine has never checked in). */
export async function readEngineStatus(
  userId: string,
): Promise<EngineStatusRow | null> {
  const sql = await getSql();
  const rows = await sql.query<EngineStatusRow>(
    `select user_id, last_seen, mode, note, symbol, paper_enabled
       from engine_status
      where user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

/** Flip the desk-side paper loop on/off (defaults OFF, see 0004_bridge.sql). */
export async function setPaperEnabled(
  userId: string,
  enabled: boolean,
): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql.query<{ paper_enabled: boolean }>(
    `insert into engine_status (id, user_id, paper_enabled, updated_at)
     values ($1, $1, $2, now())
     on conflict (user_id) do update
       set paper_enabled = excluded.paper_enabled,
           updated_at = now()
     returning paper_enabled`,
    [userId, enabled],
  );
  return rows[0]?.paper_enabled ?? enabled;
}

/** Count of engine-sourced events since UTC midnight (bridge status card). */
export async function countEngineEventsToday(userId: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql.query<{ n: number }>(
    `select count(*)::int as n
       from desk_events
      where user_id = $1
        and source = $2
        and ts >= date_trunc('day', now() at time zone 'utc')`,
    [userId, ENGINE_SOURCE],
  );
  return rows[0]?.n ?? 0;
}
