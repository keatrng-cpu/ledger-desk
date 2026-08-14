-- Live market data cache — written by the Python Databento-Live gateway
-- (gateway/databento_live_gateway.py), read by the desk's serverless functions.
--
-- WHY THIS EXISTS
-- The desk's own read path (Netlify functions) cannot hold a persistent
-- connection — no sockets, no long-lived process. Databento's real-time feed
-- (and any comparable low-latency futures feed) is socket-based; there is no
-- REST snapshot endpoint for current price. So a small always-on process
-- (the gateway) holds the one persistent connection and writes here; the
-- desk just SELECTs the latest row on its normal 30s poll. Requested
-- 2026-08-13 because 15m/1H structure tolerates a lagged quote but a 1m/5m
-- OTE entry trigger genuinely needs the current price.
--
-- NOT user-scoped. Market prices are not private data the way a trade is —
-- there is one tape, shared by whichever account reads it. Do not add
-- user_id here; if this app ever goes multi-tenant, every user reads the
-- same rows, same as any other market-data vendor.
--
-- FRESHNESS IS THE WHOLE SAFETY MODEL. `received_at` is when the gateway
-- wrote the row, not just the exchange event time. The desk's reader
-- (market/live-gateway.ts) MUST check `received_at` before trusting a row —
-- a gateway that died an hour ago leaves rows that look structurally valid
-- and are completely wrong. A stale table must fail closed, exactly like
-- the existing quote-lag gate in build-desk.ts.
--
-- Safe to apply with no gateway running: both tables stay empty, every
-- reader falls back to the existing Yahoo/Databento-historical path. This
-- migration changes nothing observable until a gateway process actually
-- writes to it.

create table if not exists live_market_ticks (
  symbol text primary key,
  price numeric not null,
  bid numeric,
  ask numeric,
  -- Exchange event time, from the feed itself.
  ts timestamptz not null,
  -- When the GATEWAY wrote this row. This, not `ts`, is what freshness
  -- checks compare against — a gateway that stalls but keeps echoing a
  -- cached `ts` must still read as stale.
  received_at timestamptz not null default now(),
  source text not null default 'databento_live'
);

create table if not exists live_market_bars_1m (
  symbol text not null,
  -- Bar open time, minute-aligned, exchange time.
  bar_time timestamptz not null,
  o numeric not null,
  h numeric not null,
  l numeric not null,
  c numeric not null,
  v bigint not null default 0,
  received_at timestamptz not null default now(),
  source text not null default 'databento_live',
  primary key (symbol, bar_time)
);

create index if not exists live_market_bars_1m_symbol_time_idx
  on live_market_bars_1m (symbol, bar_time desc);

-- Bound the table's growth — the desk only ever reads a recent window
-- (build-desk.ts fetches ~1mo of 15m-equivalent history at most). Pruning is
-- the gateway's job, not a cron this repo runs; documented in the gateway's
-- own README. This index just keeps the eventual DELETE cheap.
create index if not exists live_market_bars_1m_received_idx
  on live_market_bars_1m (received_at);

-- RLS, same treatment as every other table (0010_rls_lockdown.sql): enabled,
-- zero policies. This app connects over a direct Postgres connection as a
-- superuser (node-postgres, src/lib/db.ts / the Python gateway's psycopg
-- connection) and never through PostgREST/the anon key, so a superuser
-- bypasses RLS regardless. Enabling it with no policy closes the REST
-- surface completely without touching how the app or the gateway read/write.
-- These tables have no user_id to scope a policy to anyway — market data is
-- not per-user the way a trade is.
alter table live_market_ticks enable row level security;
alter table live_market_bars_1m enable row level security;
