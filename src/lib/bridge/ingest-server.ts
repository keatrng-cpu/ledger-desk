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
 * Insert engine journal rows into `desk_events` with source='engine'.
 * Idempotent per `batchId`: a repeat id inserts nothing and reports duplicate.
 *
 * Claim + insert run as ONE statement (a `with` CTE chain), not two
 * round-trips with a compensating delete on failure. A single SQL statement
 * is atomic by Postgres's own rules even without an explicit transaction, so
 * there is no window where the batch id gets claimed but the events don't
 * land — the earlier two-statement version had exactly that window, and if
 * the compensating `delete` also failed (e.g. the same connection blip that
 * broke the insert), the batch id was claimed forever: every retry would
 * report `duplicate: true` with zero rows ever inserted, silently.
 */
export async function ingestEngineEvents(
  userId: string,
  events: DeskEventRow[],
  batchId: string | null,
): Promise<IngestResult> {
  if (events.length === 0) {
    return { inserted: 0, duplicate: false, batchId };
  }

  const sql = await getSql();
  const ts = events.map((e) => e.ts);
  const event = events.map((e) => e.event);
  const symbol = events.map((e) => e.symbol ?? null);
  const prescore = events.map((e) => e.prescore ?? null);
  const reason = events.map((e) => e.reason ?? null);
  const pnl = events.map((e) => e.pnl ?? null);
  const r = events.map((e) => e.r ?? null);
  const payload = events.map((e) => JSON.stringify(e.payload ?? null));

  const unnestCols =
    `unnest($${batchId ? 4 : 2}::timestamptz[], $${batchId ? 5 : 3}::text[], ` +
    `$${batchId ? 6 : 4}::text[], $${batchId ? 7 : 5}::double precision[], ` +
    `$${batchId ? 8 : 6}::text[], $${batchId ? 9 : 7}::double precision[], ` +
    `$${batchId ? 10 : 8}::double precision[], $${batchId ? 11 : 9}::jsonb[]) ` +
    `as u(ts, event, symbol, prescore, reason, pnl, r, payload)`;

  if (batchId) {
    const rows = await sql.query<{ n: number }>(
      `with claim as (
         insert into engine_ingest_batches (batch_id, user_id, event_count)
         values ($1, $2, $3)
         on conflict (user_id, batch_id) do nothing
         returning 1
       ), ins as (
         insert into desk_events
           (user_id, ts, event, symbol, prescore, reason, pnl, r, source, payload)
         select $2, u.ts, u.event, u.symbol, u.prescore, u.reason, u.pnl, u.r,
                '${ENGINE_SOURCE}', u.payload
         from claim, ${unnestCols}
         returning 1
       )
       select count(*)::int as n from ins`,
      [batchId, userId, events.length, ts, event, symbol, prescore, reason, pnl, r, payload],
    );
    const inserted = rows[0]?.n ?? 0;
    return inserted > 0
      ? { inserted, duplicate: false, batchId }
      : { inserted: 0, duplicate: true, batchId };
  }

  await sql.query(
    `insert into desk_events
       (user_id, ts, event, symbol, prescore, reason, pnl, r, source, payload)
     select $1, u.ts, u.event, u.symbol, u.prescore, u.reason, u.pnl, u.r,
            '${ENGINE_SOURCE}', u.payload
     from ${unnestCols}`,
    [userId, ts, event, symbol, prescore, reason, pnl, r, payload],
  );
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
