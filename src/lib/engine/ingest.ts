/**
 * Engine ingest — server functions for uploading and reading REAL
 * Trading-Automation engine output (backtest data.json, confluence
 * knowledge, premarket snapshots) plus desk-side replay reports.
 *
 * Validation policy: zod `looseObject` everywhere — extra engine fields pass
 * through untouched, but the core fields the desk UI renders are REQUIRED
 * and hard-fail with a readable message when missing/mistyped.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

export type EngineRunKind = "backtest" | "knowledge" | "premarket" | "replay";

/** JSON-safe value — what jsonb stores and server fns can serialize. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const KINDS: EngineRunKind[] = ["backtest", "knowledge", "premarket", "replay"];

/* ------------------------------------------------------------------ */
/* Zod schemas — mirror src/lib/aplus shapes (core fields required)     */
/* ------------------------------------------------------------------ */

const biasSchema = z.enum(["bull", "bear", "neutral"]);

/** Core of `Metrics` (src/lib/aplus/analytics.ts) that the UI renders. */
const metricsSchema = z.looseObject({
  trades: z.number(),
  wins: z.number(),
  losses: z.number(),
  winRate: z.number(),
  netPnl: z.number(),
  profitFactor: z.number().nullable(),
  expectancyR: z.number(),
  maxDrawdownPct: z.number(),
  sharpe: z.number(),
  totalCommission: z.number(),
  totalSlippage: z.number(),
  isStatisticallyWeak: z.boolean(),
});

/** Core of `ClosedTrade` (src/lib/aplus/analytics.ts). */
const tradeSchema = z.looseObject({
  id: z.string(),
  symbol: z.string(),
  side: z.enum(["long", "short"]),
  opened: z.string(),
  closed: z.string(),
  entry: z.number(),
  exit: z.number(),
  pnl: z.number(),
  r: z.number(),
  reason: z.string(),
});

const journalRowSchema = z.looseObject({
  ts: z.string(),
  event: z.enum(["CANDIDATE", "SKIP", "ENTRY", "EXIT", "HALT"]),
  symbol: z.string(),
});

/** `BacktestPayload` (src/lib/aplus/sample-run.ts) — core fields required. */
const backtestSchema = z.looseObject({
  mode: z.literal("backtest"),
  symbol: z.string(),
  bars: z.number(),
  first_ts: z.string(),
  last_ts: z.string(),
  starting_equity: z.number(),
  scored: z.number(),
  best_score: z.number(),
  floor: z.number(),
  above_floor: z.number(),
  candidates: z.number(),
  skips: z.number(),
  metrics: metricsSchema,
  equity: z.array(z.number()),
  trades: z.array(tradeSchema),
  histogram: z.array(z.number()),
  components: z.array(
    z.looseObject({ name: z.string(), weight: z.number(), pct: z.number() }),
  ),
  skip_reasons: z.array(
    z.looseObject({ reason: z.string(), count: z.number() }),
  ),
  journal: z.looseObject({
    candidates: z.number(),
    skips: z.number(),
    entries: z.number(),
    exits: z.number(),
    halts: z.number(),
    tail: z.array(journalRowSchema),
  }),
  assumptions: z.string(),
});

/** `ConfluenceKnowledge` (src/lib/aplus/confluence.ts). */
const knowledgeSchema = z.looseObject({
  version: z.number(),
  samples: z.number(),
  bars: z.number(),
  symbol: z.string(),
  window: z.string(),
  floor: z.number(),
  bestScore: z.number(),
  cleared: z.number(),
  componentFirePct: z.record(z.string(), z.number()),
  coldComponents: z.array(z.string()),
  hotComponents: z.array(z.string()),
  lessons: z.array(z.string()),
});

/** `PremarketSnapshot` (src/lib/aplus/sample-run.ts). */
const premarketSchema = z.looseObject({
  symbol: z.string(),
  bias: z.looseObject({
    top_down: biasSchema,
    mid_15m: biasSchema,
    htf_60m: biasSchema,
    po3: biasSchema,
    opening: biasSchema,
    weekly_pd: biasSchema,
    ltf_trend: biasSchema,
  }),
  conditions: z.looseObject({
    tradeable: z.boolean(),
    regime: z.string(),
    volatility: z.string(),
    er: z.number(),
    atr_ratio: z.number(),
    reasons: z.array(z.string()),
  }),
  session: z.looseObject({
    config: z.string(),
    in_session: z.boolean(),
    killzone: z.string(),
    pdh: z.number(),
    pdl: z.number(),
    pwh: z.number(),
    pwl: z.number(),
    day_open: z.number(),
    ny_open: z.number(),
  }),
  news: z.looseObject({
    verdict: z.enum(["clear", "caution", "blackout"]),
    reason: z.string(),
  }),
  dealing_range: z.looseObject({
    low: z.number(),
    high: z.number(),
    equilibrium: z.number(),
    zone: z.string(),
  }),
  levels: z.array(z.looseObject({ name: z.string(), price: z.number() })),
  zone_counts: z.looseObject({
    fvgs: z.number(),
    order_blocks: z.number(),
    breakers: z.number(),
    mitigations: z.number(),
    propulsions: z.number(),
    pools: z.number(),
  }),
  last_sweep: z
    .looseObject({ kind: z.string(), price: z.number(), bars_ago: z.number() })
    .nullable(),
  last_event: z
    .looseObject({
      kind: z.string(),
      direction: biasSchema,
      level: z.number(),
      is_mss: z.boolean(),
      displaced: z.boolean(),
    })
    .nullable(),
  bar: z.looseObject({
    ts: z.string(),
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number(),
  }),
  bars_seen: z.number(),
});

/** Replay report payload (src/lib/trading/replay.ts) — stored by runReplay. */
const replaySchema = z.looseObject({
  report: z.looseObject({
    total: z.number(),
    buckets: z.array(z.looseObject({ label: z.string(), n: z.number() })),
  }),
  outcomes: z.array(z.looseObject({ symbol: z.string() })),
});

const SCHEMAS: Record<EngineRunKind, z.ZodType> = {
  backtest: backtestSchema,
  knowledge: knowledgeSchema,
  premarket: premarketSchema,
  replay: replaySchema,
};

/* ------------------------------------------------------------------ */
/* Row shapes                                                           */
/* ------------------------------------------------------------------ */

export interface EngineRunRow {
  id: string;
  kind: EngineRunKind;
  label: string | null;
  payload: JsonValue;
  ingestedAt: string;
}

export interface EngineRunMeta {
  id: string;
  kind: EngineRunKind;
  label: string | null;
  ingestedAt: string;
}

interface DbRow {
  id: string;
  kind: EngineRunKind;
  label: string | null;
  payload?: JsonValue;
  ingested_at: string | Date;
}

function toIso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

/* ------------------------------------------------------------------ */
/* Server functions (authenticated, user-scoped)                        */
/* ------------------------------------------------------------------ */

export type UploadEngineRunResult =
  | { ok: true; id: string; kind: EngineRunKind; ingestedAt: string }
  | { ok: false; error: string };

/**
 * Validate + store one engine run. `payload` is the parsed JSON of the
 * engine file; unknown extra fields pass through, missing core fields fail.
 * `replay` runs are inserted by the server-side harness — uploads accept
 * them too (same validation), which keeps the API uniform.
 */
export const uploadEngineRun = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: { kind: EngineRunKind; label?: string; payload: JsonValue }) => {
      if (!KINDS.includes(input?.kind)) {
        throw new Error(`kind must be one of ${KINDS.join(", ")}`);
      }
      return {
        kind: input.kind,
        label: typeof input.label === "string" ? input.label.slice(0, 200) : null,
        payload: input.payload,
      };
    },
  )
  .handler(async ({ data, context }): Promise<UploadEngineRunResult> => {
    const parsed = SCHEMAS[data.kind].safeParse(data.payload);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      return {
        ok: false,
        error: `Payload failed ${data.kind} validation — ${issues}`,
      };
    }
    const id = crypto.randomUUID();
    const sql = await getSql();
    const rows = await sql<{ ingested_at: string | Date }>`
      insert into engine_runs (id, user_id, kind, label, payload)
      values (${id}, ${context.userId}, ${data.kind}, ${data.label},
              ${JSON.stringify(parsed.data)}::jsonb)
      returning ingested_at
    `;
    return {
      ok: true,
      id,
      kind: data.kind,
      ingestedAt: toIso(rows[0]!.ingested_at),
    };
  });

export type LatestEngineRunResult =
  | { ok: true; run: EngineRunRow | null }
  | { ok: false; error: string };

/** Most recent run of a kind for the signed-in user (null when none yet). */
export const latestEngineRun = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { kind: EngineRunKind }) => {
    if (!KINDS.includes(input?.kind)) {
      throw new Error(`kind must be one of ${KINDS.join(", ")}`);
    }
    return { kind: input.kind };
  })
  .handler(async ({ data, context }): Promise<LatestEngineRunResult> => {
    const sql = await getSql();
    const rows = await sql<DbRow>`
      select id, kind, label, payload, ingested_at
      from engine_runs
      where user_id = ${context.userId} and kind = ${data.kind}
      order by ingested_at desc
      limit 1
    `;
    const row = rows[0];
    return {
      ok: true,
      run: row
        ? {
            id: row.id,
            kind: row.kind,
            label: row.label,
            payload: row.payload ?? null,
            ingestedAt: toIso(row.ingested_at),
          }
        : null,
    };
  });

export type ListEngineRunsResult =
  | { ok: true; runs: EngineRunMeta[] }
  | { ok: false; error: string };

/** Metadata (no payload) for the user's recent runs, newest first. */
export const listEngineRuns = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input?: { limit?: number }) => {
    const limit = Math.min(Math.max(Math.floor(input?.limit ?? 50), 1), 200);
    return { limit };
  })
  .handler(async ({ data, context }): Promise<ListEngineRunsResult> => {
    const sql = await getSql();
    const rows = await sql<DbRow>`
      select id, kind, label, ingested_at
      from engine_runs
      where user_id = ${context.userId}
      order by ingested_at desc
      limit ${data.limit}
    `;
    return {
      ok: true,
      runs: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        label: r.label,
        ingestedAt: toIso(r.ingested_at),
      })),
    };
  });
