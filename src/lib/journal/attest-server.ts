/**
 * Server side of the attestation chain — appending links, and proving the
 * chain still holds.
 *
 * FAILURE POSTURE (deliberate, and the opposite of what it looks like)
 * `appendAttestation` never throws into the trade path. A fill that happened
 * must be recorded in `desk_trades` even if sealing it hiccups — losing a real
 * trade to protect a hash would corrupt the very record this exists to
 * protect, and would do it in the direction that flatters the trader, since
 * the trades most likely to coincide with an outage are the chaotic ones.
 *
 * The cost of that choice is that the chain can develop a GAP: a trade with no
 * link. A gap is not silent — `findUnattestedTrades()` reports it, and a gap
 * is honest ("this trade was not sealed") in a way that a fabricated backfill
 * would not be. Backfilling a gap later is allowed and is recorded as what it
 * is: an `amend` link whose `recorded_at` is plainly later than the trade.
 *
 * CONCURRENCY
 * Two writers can read the same tip and both try to extend it. The unique
 * index on (user_id, prev_hash) makes the loser fail rather than fork, and the
 * loser retries against the new tip. A fork is the one thing that must never
 * persist: two branches means a choice of records, and a choice of records is
 * not a record.
 */

import type { Sql } from "@/lib/db";
import {
  GENESIS_HASH,
  buildLink,
  verifyChain,
  sealTip,
  type AttestEvent,
  type AttestationRow,
  type ChainVerdict,
  type Seal,
} from "./attest";

/**
 * Retries for a lost race on the chain tip.
 *
 * A chain has exactly one tip, so concurrent appends for the same user are
 * serialised by the unique index and the losers retry. With N simultaneous
 * writers the unluckiest can lose up to N-1 races, so this must exceed any
 * plausible burst: auto-paper firing while a manual trade is logged, a
 * multi-leg close, a backfill running against a live session. Twelve with
 * backoff covers far more than this desk will ever produce at once, and a
 * writer that still loses does not corrupt anything — it reports a gap.
 */
const MAX_APPEND_ATTEMPTS = 12;
/** Jittered backoff so retrying writers stop colliding in lockstep. */
const RETRY_BASE_MS = 8;

/** Postgres unique-violation. */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === "23505") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate key|unique constraint/i.test(msg);
}

async function currentTip(sql: Sql, userId: string): Promise<string> {
  const rows = await sql.query<{ hash: string }>(
    `select hash from desk_attestations
      where user_id = $1 order by seq desc limit 1`,
    [userId],
  );
  return rows[0]?.hash ?? GENESIS_HASH;
}

export interface AppendResult {
  ok: boolean;
  hash: string | null;
  /** Present when the link could not be written. The trade still committed. */
  error: string | null;
}

/**
 * Seal one trade event into the chain.
 *
 * `trade` is the row as it exists AFTER the write being attested, so a close
 * link seals the realised exit, pnl and R rather than the intent.
 */
export async function appendAttestation(
  sql: Sql,
  trade: Record<string, unknown>,
  event: AttestEvent,
): Promise<AppendResult> {
  const userId = String(trade.user_id ?? "");
  if (!userId) return { ok: false, hash: null, error: "trade.user_id missing" };

  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt++) {
    try {
      const prev = await currentTip(sql, userId);
      const link = buildLink(trade, event, prev);
      await sql.query(
        `insert into desk_attestations
           (user_id, trade_id, event, recorded_at, body, body_hash, prev_hash, hash)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
        [
          link.user_id,
          link.trade_id,
          link.event,
          link.recorded_at,
          JSON.stringify(link.body),
          link.body_hash,
          link.prev_hash,
          link.hash,
        ],
      );
      return { ok: true, hash: link.hash, error: null };
    } catch (err) {
      lastError = err;
      if (!isUniqueViolation(err)) break;
      // Lost the race for the tip. Back off with jitter before re-reading, so
      // contending writers desynchronise instead of colliding again in step.
      const wait = Math.round(RETRY_BASE_MS * 2 ** attempt * (0.5 + Math.random()));
      await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 500)));
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  console.error(
    `[attest] could not seal ${event} for trade ${String(trade.id)} — ` +
      `the trade IS recorded but the chain now has a gap. ${message}`,
  );
  return { ok: false, hash: null, error: message };
}

/** Read one user's chain in order, ready for `verifyChain`. */
export async function readChain(sql: Sql, userId: string): Promise<AttestationRow[]> {
  return sql.query<AttestationRow>(
    `select seq::int as seq, user_id, trade_id, event,
            to_char(recorded_at at time zone 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as recorded_at,
            body, body_hash, prev_hash, hash
       from desk_attestations
      where user_id = $1
      order by seq`,
    [userId],
  );
}

export async function verifyUserChain(sql: Sql, userId: string): Promise<ChainVerdict> {
  return verifyChain(await readChain(sql, userId));
}

export async function sealUserChain(sql: Sql, userId: string): Promise<Seal | null> {
  return sealTip(await readChain(sql, userId));
}

export interface ChainGap {
  tradeId: string;
  status: string;
  openedAt: string;
  /** Which links this trade is missing. */
  missing: AttestEvent[];
}

/**
 * Trades with no corresponding link — the gaps the failure posture above
 * permits. An open trade needs an `open` link; a closed one needs both.
 *
 * This is the reconciliation that keeps "never block a fill" honest: the
 * record is allowed to be incomplete, but it is never allowed to LOOK
 * complete while being incomplete.
 */
export async function findUnattestedTrades(sql: Sql, userId: string): Promise<ChainGap[]> {
  const rows = await sql.query<{
    id: string;
    status: string;
    opened_at: string;
    has_open: boolean;
    has_close: boolean;
  }>(
    `select t.id,
            t.status,
            to_char(t.opened_at at time zone 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as opened_at,
            coalesce(bool_or(a.event in ('open', 'amend')), false) as has_open,
            coalesce(bool_or(a.event in ('close', 'amend')), false) as has_close
       from desk_trades t
       left join desk_attestations a
              on a.user_id = t.user_id and a.trade_id = t.id
      where t.user_id = $1
      group by t.id, t.status, t.opened_at
      order by t.opened_at`,
    [userId],
  );

  const gaps: ChainGap[] = [];
  for (const row of rows) {
    const missing: AttestEvent[] = [];
    if (!row.has_open) missing.push("open");
    if (row.status === "closed" && !row.has_close) missing.push("close");
    if (missing.length) {
      gaps.push({
        tradeId: row.id,
        status: row.status,
        openedAt: row.opened_at,
        missing,
      });
    }
  }
  return gaps;
}

export interface ChainHealth {
  verdict: ChainVerdict;
  gaps: ChainGap[];
  seal: Seal | null;
  /** One line for the UI / a compliance log. */
  line: string;
}

/** Everything a "is my record still sound?" panel needs, in one round trip. */
export async function chainHealth(sql: Sql, userId: string): Promise<ChainHealth> {
  const rows = await readChain(sql, userId);
  const verdict = verifyChain(rows);
  const gaps = await findUnattestedTrades(sql, userId);
  const seal = verdict.ok ? sealTip(rows) : null;

  const line = !verdict.ok
    ? `CHAIN BROKEN at link ${verdict.brokenAt} — ${verdict.reason}`
    : gaps.length
      ? `chain intact (${verdict.checked} links) · ${gaps.length} unsealed trade${gaps.length === 1 ? "" : "s"}`
      : `chain intact · ${verdict.checked} links · tip ${verdict.tip?.slice(0, 12)}…`;

  return { verdict, gaps, seal, line };
}
