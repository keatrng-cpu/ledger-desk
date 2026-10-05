/**
 * Server side of the room backup (migrations/0017_room_snapshot.sql).
 *
 * One row per trader: the latest room book + the people's memory. The rank
 * (history, last activity) is recomputed HERE from the body, never trusted
 * from the browser, and every query is scoped to `context.userId`.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { MAX_SNAPSHOT_BYTES, SNAPSHOT_UPSERT_SQL, isSnapshot, rankOf, type RoomSnapshot, type SnapshotRank } from "./snapshot";

export interface SnapshotPull {
  snapshot: RoomSnapshot | null;
  rank: SnapshotRank | null;
  savedAt: string | null;
}

export const getRoomSnapshot = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<SnapshotPull> => {
    const sql = await getSql();
    const rows = await sql.query<{ body: unknown; saved_at: string | Date }>(
      `select body, saved_at from room_snapshot where user_id = $1 limit 1`,
      [context.userId],
    );
    const r = rows[0];
    if (!r) return { snapshot: null, rank: null, savedAt: null };
    const body = typeof r.body === "string" ? (JSON.parse(r.body) as unknown) : r.body;
    if (!isSnapshot(body)) return { snapshot: null, rank: null, savedAt: null };
    return { snapshot: body, rank: rankOf(body.book), savedAt: new Date(r.saved_at).toISOString() };
  });

export interface SnapshotPush {
  saved: boolean;
  rank: SnapshotRank | null;
  why: string;
}

/** Upsert by SNAPSHOT_UPSERT_SQL: a poorer copy never overwrites a richer one; a reset (`force`) does. */
export const putRoomSnapshot = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ snapshot: z.unknown(), force: z.boolean().optional() }))
  .handler(async ({ data, context }): Promise<SnapshotPush> => {
    if (!isSnapshot(data.snapshot)) return { saved: false, rank: null, why: "not a room snapshot" };
    const text = JSON.stringify(data.snapshot);
    if (text.length > MAX_SNAPSHOT_BYTES) return { saved: false, rank: null, why: `snapshot is ${text.length} bytes (cap ${MAX_SNAPSHOT_BYTES})` };
    const rank = rankOf(data.snapshot.book);
    const sql = await getSql();
    const rows = await sql.query<{ user_id: string }>(SNAPSHOT_UPSERT_SQL, [
      context.userId,
      text,
      rank.history,
      Math.round(rank.lastAt),
      Boolean(data.force),
    ]);
    return rows.length
      ? { saved: true, rank, why: "saved" }
      : { saved: false, rank, why: "the server holds a richer copy — it is adopted on the next start" };
  });
