-- Phase C — strategy + regime attribution on the journal.
--
-- C1 (per-strategy scoreboard) and C2 (strategy x regime x killzone matrix)
-- both need columns `desk_trades` never had. `prescore`, `grade` and
-- `killzone` were persisted from day one (0002); the MODEL that produced the
-- setup (`SetupCandidate.strategyPrimary`) and the MARKET it was taken in
-- (`MarketConditions.regime`) were not — they existed only in memory on the
-- scanner's output and were discarded at log time. Without them, "which model
-- should I stop using, and where" is unanswerable no matter how many trades
-- accumulate.
--
-- Both columns are NULLABLE with no backfill, on purpose. Every row written
-- before this migration genuinely carries no attribution, and defaulting them
-- (to 'mechanical', to 'trending') would manufacture exactly the evidence
-- Phase C exists to measure. Unattributed rows are counted and reported as
-- such by src/lib/journal/analytics.ts — never folded into a strategy.
--
-- Writers (src/lib/journal/server.ts, src/lib/journal/paper-mirror.ts,
-- src/lib/bridge/paper-server.ts) are owned by the integrator; until they
-- populate these columns the scoreboard correctly reports 0 attributed
-- trades. See INTEGRATION-D.md.

alter table desk_trades add column if not exists strategy text;
alter table desk_trades add column if not exists regime text;

-- The scoreboard and the matrix read one user+mode's closed rows and group in
-- TypeScript; these partial indexes keep that read (and any later SQL-side
-- grouping) off a full scan as the journal grows. Partial on status='closed'
-- because no analytics path ever reads an open row.
create index if not exists desk_trades_strategy_idx
  on desk_trades (user_id, mode, strategy)
  where status = 'closed';

create index if not exists desk_trades_regime_cell_idx
  on desk_trades (user_id, mode, regime, killzone)
  where status = 'closed';
