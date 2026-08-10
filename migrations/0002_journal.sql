-- Phase 1 — Trade journal + desk events + settings (active risk governor).
--
-- App tables: snake_case, `user_id TEXT NOT NULL`, every query scoped to the
-- authenticated user server-side (see src/lib/journal/server.ts).
--
-- desk_trades   — the journal. One row per logged trade (open -> closed).
--                 pnl/r are NET of commission + slippage, computed server-side
--                 with CONTRACTS point values (src/lib/aplus/config.ts).
-- desk_events   — append-only tape of desk decisions (CANDIDATE/SKIP/ENTRY/
--                 EXIT/HALT) powering review + the governor audit trail.
-- desk_settings — one row per user (account equity for risk sizing).

create table if not exists desk_trades (
  id text primary key,
  user_id text not null,
  mode text not null default 'live' check (mode in ('live', 'paper')),
  source text not null default 'desk' check (source in ('desk', 'engine', 'paper')),
  symbol text not null,
  side text not null check (side in ('long', 'short')),
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null,
  closed_at timestamptz,
  entry double precision not null,
  stop double precision,
  target double precision,
  exit double precision,
  contracts integer not null default 1,
  pnl double precision,
  r double precision,
  commission double precision not null default 0,
  slippage double precision not null default 0,
  reason text,
  prescore double precision,
  grade text,
  killzone text,
  components_present jsonb,
  components_missing jsonb,
  created_at timestamptz not null default now()
);

create index if not exists desk_trades_user_opened_idx
  on desk_trades (user_id, opened_at);

create table if not exists desk_events (
  id bigint generated always as identity primary key,
  user_id text not null,
  ts timestamptz not null,
  event text not null check (event in ('CANDIDATE', 'SKIP', 'ENTRY', 'EXIT', 'HALT')),
  symbol text,
  prescore double precision,
  reason text,
  pnl double precision,
  r double precision,
  source text not null default 'desk' check (source in ('desk', 'engine', 'paper')),
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists desk_events_user_ts_idx
  on desk_events (user_id, ts);

create table if not exists desk_settings (
  user_id text primary key,
  equity double precision not null default 10000,
  updated_at timestamptz not null default now()
);
