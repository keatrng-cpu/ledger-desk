/**
 * Windowed desk aggregates for the scheduled reviews.
 *
 * Deliberately pure SQL against `desk_trades` / `desk_events` — no Yahoo, no
 * Databento, no desk build. A scheduled job that depends on a third-party
 * quote feed fails on the days that feed is slow, which is exactly when you
 * most want the review to have run. Everything here is already in the
 * database.
 *
 * Live and paper are returned SEPARATELY and never summed. Blending them is
 * the specific bug that made Path win rate meaningless once the paper mirror
 * started writing (see listTrades' `mode` default in journal/server.ts).
 */

import { getSql } from "@/lib/db";

export interface ModeStats {
  closed: number;
  wins: number;
  losses: number;
  sumR: number;
  netPnl: number;
  entries: number;
  open: number;
}

export interface WindowStats {
  live: ModeStats;
  paper: ModeStats;
  /** Decisions NOT taken. The discipline half of the review. */
  skips: number;
  candidates: number;
  halts: number;
}

type StatsRow = {
  live_closed: number;
  live_wins: number;
  live_losses: number;
  live_sum_r: number;
  live_net: number;
  live_entries: number;
  live_open: number;
  paper_closed: number;
  paper_wins: number;
  paper_losses: number;
  paper_sum_r: number;
  paper_net: number;
  paper_entries: number;
  paper_open: number;
};

const EMPTY: ModeStats = {
  closed: 0,
  wins: 0,
  losses: 0,
  sumR: 0,
  netPnl: 0,
  entries: 0,
  open: 0,
};

/**
 * Aggregate one window `[from, to)`.
 *
 * `open` intentionally ignores the window: an overnight position opened last
 * Thursday is the single most important line of a premarket checklist, and
 * windowing it away would hide it.
 */
export async function windowStats(
  userId: string,
  from: Date,
  to: Date,
): Promise<WindowStats> {
  const sql = await getSql();

  const [tradeRows, eventRows] = await Promise.all([
    sql.query<StatsRow>(
      `select
         count(*) filter (where mode = 'live' and status = 'closed'
                            and closed_at >= $2 and closed_at < $3) as live_closed,
         count(*) filter (where mode = 'live' and status = 'closed'
                            and closed_at >= $2 and closed_at < $3 and pnl > 0) as live_wins,
         count(*) filter (where mode = 'live' and status = 'closed'
                            and closed_at >= $2 and closed_at < $3 and pnl < 0) as live_losses,
         coalesce(sum(r) filter (where mode = 'live' and status = 'closed'
                            and closed_at >= $2 and closed_at < $3), 0)::double precision as live_sum_r,
         coalesce(sum(pnl) filter (where mode = 'live' and status = 'closed'
                            and closed_at >= $2 and closed_at < $3), 0)::double precision as live_net,
         count(*) filter (where mode = 'live'
                            and opened_at >= $2 and opened_at < $3) as live_entries,
         count(*) filter (where mode = 'live' and status = 'open') as live_open,
         count(*) filter (where mode = 'paper' and status = 'closed'
                            and closed_at >= $2 and closed_at < $3) as paper_closed,
         count(*) filter (where mode = 'paper' and status = 'closed'
                            and closed_at >= $2 and closed_at < $3 and pnl > 0) as paper_wins,
         count(*) filter (where mode = 'paper' and status = 'closed'
                            and closed_at >= $2 and closed_at < $3 and pnl < 0) as paper_losses,
         coalesce(sum(r) filter (where mode = 'paper' and status = 'closed'
                            and closed_at >= $2 and closed_at < $3), 0)::double precision as paper_sum_r,
         coalesce(sum(pnl) filter (where mode = 'paper' and status = 'closed'
                            and closed_at >= $2 and closed_at < $3), 0)::double precision as paper_net,
         count(*) filter (where mode = 'paper'
                            and opened_at >= $2 and opened_at < $3) as paper_entries,
         count(*) filter (where mode = 'paper' and status = 'open') as paper_open
       from desk_trades
       where user_id = $1`,
      [userId, from, to],
    ),
    sql.query<{ skips: number; candidates: number; halts: number }>(
      `select
         count(*) filter (where event = 'SKIP') as skips,
         count(*) filter (where event = 'CANDIDATE') as candidates,
         count(*) filter (where event = 'HALT') as halts
       from desk_events
       where user_id = $1 and ts >= $2 and ts < $3`,
      [userId, from, to],
    ),
  ]);

  const t = tradeRows[0];
  const e = eventRows[0];
  const num = (v: number | undefined) => Number(v ?? 0);

  return {
    live: t
      ? {
          closed: num(t.live_closed),
          wins: num(t.live_wins),
          losses: num(t.live_losses),
          sumR: num(t.live_sum_r),
          netPnl: num(t.live_net),
          entries: num(t.live_entries),
          open: num(t.live_open),
        }
      : { ...EMPTY },
    paper: t
      ? {
          closed: num(t.paper_closed),
          wins: num(t.paper_wins),
          losses: num(t.paper_losses),
          sumR: num(t.paper_sum_r),
          netPnl: num(t.paper_net),
          entries: num(t.paper_entries),
          open: num(t.paper_open),
        }
      : { ...EMPTY },
    skips: num(e?.skips),
    candidates: num(e?.candidates),
    halts: num(e?.halts),
  };
}

/** `+1.20R` / `−0.40R`, with a real minus sign. */
export function fmtR(r: number): string {
  return `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`;
}

/** Win rate, or "—" when there is nothing to divide. */
export function fmtWr(wins: number, closed: number): string {
  return closed > 0 ? `${((wins / closed) * 100).toFixed(0)}%` : "—";
}
