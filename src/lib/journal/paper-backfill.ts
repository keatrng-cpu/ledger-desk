/**
 * ROADMAP D1 — one record, not two.
 *
 * THE SPLIT. The paper book (`trading/paper-manager.ts`) is localStorage and
 * works signed-OUT; the mirror and every analytic that reads it require auth.
 * So the record silently forks in both directions:
 *   - trades logged while signed out NEVER reach `desk_trades` — the unlock
 *     evidence is missing exactly the trades taken before anyone logged in;
 *   - clearing browser storage resets the working book while the DB history
 *     survives, so the two disagree and neither is complete.
 *
 * THE FIX. Diff the local book against what the DB already has and replay the
 * difference through the SAME idempotent writes the live mirror uses
 * (`mirrorOpenRow` / `mirrorCloseRow` — money math included, closes recomputed
 * server-side by `computeTradePnl`). Nothing here re-implements an insert, a
 * conflict rule, or a PnL formula.
 *
 * SYMBOL DISCIPLINE. `PaperTrade.symbol` is the RESOLVED contract (MES/MNQ);
 * `PaperTrade.displaySymbol` is the label (ES/NQ). The mirror is priced from
 * `symbol`. Sending the label once priced a micro at full-size economics — a
 * 10x PnL error — so the planner reads `symbol` and never `displaySymbol`
 * (the label rides along in `context`-free metadata only, via `reason`).
 *
 * The planner is PURE (no localStorage, no network) so it is testable and so
 * the same diff can run server-side later if the book ever moves.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  mirrorCloseRow,
  mirrorOpenRow,
  paperCloseSchema,
  paperOpenSchema,
  type MirrorCloseInput,
  type MirrorOpenInput,
} from "./paper-mirror";
import { loadPaperTrades, type PaperTrade } from "@/lib/trading/paper-manager";

/** Max opens (and max closes) accepted per `backfillPaperTrades` call. */
export const PAPER_BACKFILL_MAX = 100;
/** Paper rows read back per reconcile pass. The local book caps at 200. */
export const MIRRORED_LOOKBACK = 500;
/** Safety bound on the client reconcile loop when the cap truncates a plan. */
const MAX_PASSES = 4;
/** Local cache of ids the server has confirmed durable. */
const MIRROR_MARK_KEY = "ledger-paper-mirrored-v1";

export type MirroredStatus = "open" | "closed";

/** What the DB already holds for one mirrored paper trade. */
export interface MirroredRow {
  id: string;
  status: MirroredStatus;
}

export interface PaperBackfillPlan {
  /** Trades with no row in `desk_trades` at all. */
  opens: MirrorOpenInput[];
  /** Trades whose row exists and is still `open` while the book has them closed. */
  closes: MirrorCloseInput[];
  /** Local trades already fully represented in the DB. */
  durable: number;
  /** Ids the mirror cannot accept (bad geometry, missing fields). */
  unusable: string[];
  /** True when `PAPER_BACKFILL_MAX` truncated the plan — run again after commit. */
  truncated: boolean;
}

export interface PaperBackfillResult {
  /** Rows this call actually inserted. */
  opened: number;
  /** Rows this call actually closed. */
  closed: number;
  /** Items submitted that were already durable (idempotent no-ops). */
  noops: number;
}

export interface PaperBackfillOutcome extends PaperBackfillResult {
  ok: boolean;
  /** Local trades that were already durable before this run. */
  durable: number;
  /** Local trades still not durable after this run (cap hit, or unusable). */
  pending: number;
  unusable: number;
  passes: number;
  /** Present when the run could not complete — signed out, or DB unreachable. */
  error?: string;
}

/* ------------------------------------------------------------------ *
 * Pure planner
 * ------------------------------------------------------------------ */

type RemoteState = readonly MirroredRow[] | ReadonlyMap<string, MirroredStatus>;

function toRemoteMap(remote: RemoteState): Map<string, MirroredStatus> {
  if (remote instanceof Map) return new Map(remote);
  const map = new Map<string, MirroredStatus>();
  for (const row of remote as readonly MirroredRow[]) {
    if (row && typeof row.id === "string") map.set(row.id, row.status);
  }
  return map;
}

const KZ_TOKEN = /(?:^|·|\s)kz:([^·]+)/i;

/**
 * The killzone is stamped into `PaperTrade.reason` at open time
 * (`kz:<name>` — see `openPaperTradeInstant`). Recovering it here keeps a
 * backfilled row groupable by session, which is what Phase C reads.
 */
function killzoneFromReason(reason: string | undefined): string | null {
  const hit = reason ? KZ_TOKEN.exec(reason) : null;
  const value = hit?.[1]?.trim();
  return value ? value.slice(0, 32) : null;
}

function positive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function clip(text: string | undefined | null, max: number): string | null {
  const value = typeof text === "string" ? text.trim() : "";
  return value ? value.slice(0, max) : null;
}

/** Prescore must be a 0–1 confluence score or nothing — never a stray value. */
function prescoreOf(t: PaperTrade): number | null {
  return typeof t.score === "number" &&
    Number.isFinite(t.score) &&
    t.score >= 0 &&
    t.score <= 1
    ? t.score
    : null;
}

/** Everything the mirror requires of an OPEN, checked before it is batched. */
function openPayload(t: PaperTrade): MirrorOpenInput | null {
  if (!t || typeof t.id !== "string" || !t.id || t.id.length > 80) return null;
  if (typeof t.symbol !== "string" || !t.symbol || t.symbol.length > 16) return null;
  if (t.side !== "long" && t.side !== "short") return null;
  if (!positive(t.entry) || !positive(t.stop)) return null;
  if (!Number.isInteger(t.contracts) || t.contracts < 1 || t.contracts > 1000) {
    return null;
  }
  if (!Number.isFinite(t.openedAt) || t.openedAt <= 0) return null;

  return {
    id: t.id,
    // RESOLVED contract, never `displaySymbol` — see file header.
    symbol: t.symbol,
    side: t.side,
    entry: t.entry,
    stop: t.stop,
    target: positive(t.tp1) ? t.tp1 : null,
    contracts: t.contracts,
    openedAt: new Date(t.openedAt).toISOString(),
    prescore: prescoreOf(t),
    grade: clip(t.grade, 16),
    killzone: killzoneFromReason(t.reason),
    strategy: clip(t.strategy, 120),
    reason: clip(t.reason, 500),
  };
}

/** A close is only replayable once the book has an exit price and a timestamp. */
function closePayload(t: PaperTrade): MirrorCloseInput | null {
  if (t.status !== "closed" || !positive(t.exit)) return null;
  const closedAt = Number.isFinite(t.closedAt) ? (t.closedAt as number) : null;
  if (!closedAt || closedAt <= 0) return null;
  if (!Number.isInteger(t.contracts) || t.contracts < 1 || t.contracts > 1000) {
    return null;
  }
  return {
    id: t.id,
    exit: t.exit,
    closedAt: new Date(closedAt).toISOString(),
    contracts: t.contracts,
    reason: clip(t.exitReason, 500) ?? "paper exit",
  };
}

/**
 * PURE. Diff the localStorage book against what `desk_trades` already holds and
 * return only the writes that are still missing.
 *
 * Rules, in the order they matter:
 *   - no row at all      -> mirror the OPEN (and the CLOSE too, if it is closed)
 *   - row is `open`      -> mirror only the CLOSE, and only once the book has
 *                           an exit price (a closed-with-no-exit trade is left
 *                           open rather than invented)
 *   - row is `closed`    -> durable, nothing to do
 *
 * Opens and closes are returned separately because they MUST be applied in that
 * order: a trade opened and closed while signed out needs its row to exist
 * before the close can find it.
 */
export function planPaperBackfill(
  book: readonly PaperTrade[],
  remote: RemoteState,
  opts?: { limit?: number },
): PaperBackfillPlan {
  const limit = Math.max(1, Math.min(opts?.limit ?? PAPER_BACKFILL_MAX, PAPER_BACKFILL_MAX));
  const known = toRemoteMap(remote);

  const opens: MirrorOpenInput[] = [];
  const closes: MirrorCloseInput[] = [];
  const unusable: string[] = [];
  let durable = 0;
  let truncated = false;

  for (const trade of book) {
    if (!trade || typeof trade.id !== "string") continue;
    const status = known.get(trade.id);

    // Already closed in the DB — the terminal state, nothing can improve it.
    if (status === "closed") {
      durable += 1;
      continue;
    }

    const close = closePayload(trade);

    if (status === "open") {
      // Row exists. Open trades are already durable; closed ones need the exit.
      if (trade.status !== "closed") {
        durable += 1;
      } else if (close) {
        if (closes.length >= limit) truncated = true;
        else closes.push(close);
      } else {
        // Closed locally with no usable exit price: the open row stays open
        // rather than being closed at a made-up level.
        unusable.push(trade.id);
      }
      continue;
    }

    // No row at all.
    const open = openPayload(trade);
    if (!open) {
      unusable.push(trade.id);
      continue;
    }
    if (opens.length >= limit) {
      truncated = true;
      continue;
    }
    opens.push(open);
    if (trade.status === "closed") {
      if (close) {
        if (closes.length >= limit) truncated = true;
        else closes.push(close);
      } else {
        unusable.push(trade.id);
      }
    }
  }

  return { opens, closes, durable, unusable, truncated };
}

/* ------------------------------------------------------------------ *
 * Server functions
 * ------------------------------------------------------------------ */

const backfillSchema = z.object({
  opens: z.array(paperOpenSchema).max(PAPER_BACKFILL_MAX).default([]),
  closes: z.array(paperCloseSchema).max(PAPER_BACKFILL_MAX).default([]),
});

export type BackfillPaperTradesInput = z.input<typeof backfillSchema>;

/**
 * Replay a batch of missed paper writes into `desk_trades`.
 *
 * Opens are applied before closes so a trade taken AND closed while signed out
 * lands complete in one call. Every write is the same idempotent one the live
 * mirror uses, so re-running this is a no-op rather than a duplicate — which is
 * what makes it safe to call on every login and every mount.
 */
export const backfillPaperTrades = createServerFn({ method: "POST" })
  .validator((input: unknown) => backfillSchema.parse(input ?? {}))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<PaperBackfillResult> => {
    const sql = await getSql();
    let opened = 0;
    let closed = 0;

    for (const open of data.opens) {
      if (await mirrorOpenRow(sql, context.userId, open)) opened += 1;
    }
    for (const close of data.closes) {
      if (await mirrorCloseRow(sql, context.userId, close)) closed += 1;
    }

    const submitted = data.opens.length + data.closes.length;
    return { opened, closed, noops: submitted - opened - closed };
  });

/** What the DB already holds, for the diff. Paper rows only, newest first. */
export const listMirroredPaperTrades = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<MirroredRow[]> => {
    const sql = await getSql();
    const rows = await sql.query<{ id: string; status: MirroredStatus }>(
      `select id, status
         from desk_trades
        where user_id = $1 and mode = 'paper'
        order by opened_at desc
        limit $2`,
      [context.userId, MIRRORED_LOOKBACK],
    );
    return rows;
  });

/* ------------------------------------------------------------------ *
 * Client helpers
 * ------------------------------------------------------------------ */

/**
 * Local record of what the server has confirmed durable.
 *
 * The badge has to answer "is my book saved?" while signed OUT, when the DB is
 * unreachable by definition — so the answer is cached in the browser and only
 * ever written from a server-confirmed read. It is a cache, never a source of
 * truth: wiping it just makes the next backfill pass re-diff and find nothing.
 */
function loadMarks(): Record<string, MirroredStatus> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(MIRROR_MARK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, MirroredStatus>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveMarks(marks: Record<string, MirroredStatus>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MIRROR_MARK_KEY, JSON.stringify(marks));
  } catch {
    /* quota / private mode — the badge degrades, the book does not */
  }
}

/** Record server-confirmed durable state. Closed always wins over open. */
export function markMirrored(rows: readonly MirroredRow[]): void {
  if (!rows.length) return;
  const marks = loadMarks();
  for (const row of rows) {
    if (!row?.id) continue;
    if (marks[row.id] === "closed") continue;
    marks[row.id] = row.status;
  }
  saveMarks(marks);
}

/**
 * How many local paper trades are NOT yet known-durable — the number behind
 * "N trades not yet saved — sign in".
 *
 * Counts a trade when the DB has never confirmed it, and also when the DB holds
 * it open while the book has closed it (the exit is the part not yet saved).
 * Returns 0 during SSR — read it in an effect, not in render.
 */
export function unmirroredCount(book?: readonly PaperTrade[]): number {
  const trades = book ?? loadPaperTrades();
  if (!trades.length) return 0;
  const marks = loadMarks();
  let count = 0;
  for (const t of trades) {
    if (!t?.id) continue;
    const mark = marks[t.id];
    if (!mark) count += 1;
    else if (mark === "open" && t.status === "closed" && positive(t.exit)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Reconcile the whole local book into `desk_trades`. Call on login and on mount
 * when signed in (see INTEGRATION-E.md).
 *
 * Never throws: signed out or DB down, it returns `ok: false` and the working
 * book is untouched — the same fire-and-forget contract as the live mirror.
 */
export async function syncPaperBookToDb(): Promise<PaperBackfillOutcome> {
  const outcome: PaperBackfillOutcome = {
    ok: false,
    opened: 0,
    closed: 0,
    noops: 0,
    durable: 0,
    pending: 0,
    unusable: 0,
    passes: 0,
  };

  try {
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const remote = await listMirroredPaperTrades();
      markMirrored(remote);
      outcome.passes = pass + 1;

      const plan = planPaperBackfill(loadPaperTrades(), remote);
      outcome.durable = plan.durable;
      outcome.unusable = plan.unusable.length;

      if (!plan.opens.length && !plan.closes.length) {
        outcome.ok = true;
        outcome.pending = plan.unusable.length;
        return outcome;
      }

      const res = await backfillPaperTrades({
        data: { opens: plan.opens, closes: plan.closes },
      });
      outcome.opened += res.opened;
      outcome.closed += res.closed;
      outcome.noops += res.noops;

      if (!plan.truncated) {
        // One last read so the local marks reflect the writes just made.
        const settled = await listMirroredPaperTrades();
        markMirrored(settled);
        outcome.ok = true;
        outcome.pending = unmirroredCount();
        return outcome;
      }
    }
    // Cap kept truncating: partial success, caller can run again later.
    outcome.ok = true;
    outcome.pending = unmirroredCount();
    return outcome;
  } catch (err) {
    outcome.error = err instanceof Error ? err.message : "paper backfill failed";
    outcome.pending = unmirroredCount();
    return outcome;
  }
}
