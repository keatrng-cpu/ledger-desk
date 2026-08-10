/**
 * Wire schemas for the engine bridge (zod — already a direct dependency).
 *
 * The engine speaks its own journal vocabulary (`src/lib/aplus/sample-run.ts`
 * `JournalRow`: confluence / skip_reason / r_multiple). The desk stores
 * `desk_events` columns (prescore / reason / r). Mapping happens in
 * `toDeskEvent()` below — one place, so the SQL layer never guesses.
 */

import { z } from "zod";

/** Hard cap per POST /api/engine/journal batch. */
export const MAX_EVENTS_PER_BATCH = 500;

/** Engine journal vocabulary — must stay identical to the engine enum. */
export const ENGINE_EVENTS = [
  "CANDIDATE",
  "SKIP",
  "ENTRY",
  "EXIT",
  "HALT",
] as const;

export type EngineEvent = (typeof ENGINE_EVENTS)[number];

const isoTimestamp = z
  .string()
  .min(4)
  .max(64)
  .refine((v) => Number.isFinite(Date.parse(v)), {
    message: "ts must be a parseable ISO-8601 timestamp",
  });

const finiteNumber = z
  .number()
  .refine((v) => Number.isFinite(v), { message: "must be a finite number" });

/** One engine journal row (engine field names). */
export const journalRowSchema = z.object({
  ts: isoTimestamp,
  event: z.enum(ENGINE_EVENTS),
  symbol: z.string().min(1).max(24),
  confluence: finiteNumber.min(0).max(1).optional(),
  skip_reason: z.string().max(500).optional(),
  reason: z.string().max(500).optional(),
  pnl: finiteNumber.optional(),
  r_multiple: finiteNumber.optional(),
});

export type JournalRowInput = z.infer<typeof journalRowSchema>;

/** POST /api/engine/journal body. */
export const journalBatchSchema = z.object({
  // Client-supplied idempotency key. Same id twice => second call is a no-op.
  batch_id: z.string().min(1).max(128).optional(),
  events: z
    .array(journalRowSchema)
    .min(1, "events must contain at least one row")
    .max(
      MAX_EVENTS_PER_BATCH,
      `events exceeds the ${MAX_EVENTS_PER_BATCH}-row batch cap`,
    ),
});

export type JournalBatchInput = z.infer<typeof journalBatchSchema>;

/** Modes the heartbeat may report. */
export const ENGINE_MODES = ["live", "paper", "backtest", "idle"] as const;
export type EngineMode = (typeof ENGINE_MODES)[number];

/** POST /api/engine/heartbeat body. */
export const heartbeatSchema = z.object({
  mode: z.enum(ENGINE_MODES),
  symbol: z.string().min(1).max(24).optional(),
  note: z.string().max(500).optional(),
});

export type HeartbeatInput = z.infer<typeof heartbeatSchema>;

/** Desk-side row shape written into `desk_events`. */
export interface DeskEventRow {
  ts: string;
  event: EngineEvent;
  symbol: string;
  prescore: number | null;
  reason: string | null;
  pnl: number | null;
  r: number | null;
  payload: Record<string, unknown>;
}

/**
 * Engine journal vocabulary -> desk_events columns.
 *
 *   confluence   -> prescore   (engine 0..1 confluence score)
 *   r_multiple   -> r
 *   skip_reason  -> reason     (only when `reason` itself is absent)
 *   pnl          -> pnl
 *
 * The untouched engine row is mirrored into `payload.raw` so nothing the engine
 * sent is lost, alongside the batch id for provenance.
 */
export function toDeskEvent(
  row: JournalRowInput,
  batchId: string | null,
): DeskEventRow {
  const reason = row.reason ?? row.skip_reason ?? null;
  return {
    ts: new Date(row.ts).toISOString(),
    event: row.event,
    symbol: row.symbol,
    prescore: row.confluence ?? null,
    reason,
    pnl: row.pnl ?? null,
    r: row.r_multiple ?? null,
    payload: {
      batch_id: batchId,
      origin: "engine-bridge",
      raw: row as Record<string, unknown>,
    },
  };
}

/** Flatten a zod error into a short, non-leaky message list. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 10).map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "(body)";
    return `${path}: ${issue.message}`;
  });
}
