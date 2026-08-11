-- Phase 5 — data integrity + analytics support.
--
-- 1. Enforce the "one open position per mode+symbol+side" invariant in the
--    DATABASE, not just in application code. `evaluatePaperCycle` deduped
--    against a snapshot of open trades read earlier in the same cycle, so two
--    overlapping polls (stale tab + fresh reload, or a retry) could each read
--    zero open MNQ-longs and both insert one. The `on conflict (id)` guard did
--    not help: each cycle generates its own timestamped id, so the ids differ
--    and neither conflicts. A partial unique index makes the second insert
--    fail regardless of timing.
--
--    Scoped by `mode` so a live and a paper position on the same symbol+side
--    can coexist — live and paper are tracked separately by design.
--
-- 2. Indexes for the analytics aggregates (src/lib/journal/analytics.ts).
--    Every analytics query filters user_id + mode + status='closed' and sorts
--    by closed_at; without this it is a full scan per panel render.
--
-- 3. `desk_snapshots` — decision-time context. The journal records WHAT was
--    traded; this records WHAT THE DESK LOOKED LIKE when the decision was
--    made (HTF bias, killzone, news verdict, data quality, the full candidate
--    set). Without it, reviewing a losing trade months later cannot answer
--    "what did I actually see?" — which is the question that changes behavior.

create unique index if not exists desk_trades_one_open_per_side_idx
  on desk_trades (user_id, mode, symbol, side)
  where status = 'open';

create index if not exists desk_trades_closed_analytics_idx
  on desk_trades (user_id, mode, status, closed_at);

create index if not exists desk_events_user_source_ts_idx
  on desk_events (user_id, source, ts);

create table if not exists desk_snapshots (
  id text primary key,
  user_id text not null,
  ts timestamptz not null,
  -- Optional link to the trade this snapshot justified (null = periodic capture).
  trade_id text,
  symbol text,
  killzone text,
  -- Denormalized for cheap filtering/grouping without unpacking jsonb.
  htf_left text,
  htf_right text,
  news_verdict text,
  data_quality_ok boolean not null default true,
  best_prescore double precision,
  actionable_count integer not null default 0,
  -- Full DeskPayload-shaped context for deep review.
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists desk_snapshots_user_ts_idx
  on desk_snapshots (user_id, ts desc);

create index if not exists desk_snapshots_trade_idx
  on desk_snapshots (user_id, trade_id);
