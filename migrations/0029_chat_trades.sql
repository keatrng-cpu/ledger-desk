-- Chat trades: trades Keaton placed from chat (live-tape armed_*.py), NOT desk fills.
-- Own table (like shadow_trades) so desk_trades track record / A+ unlock stay clean.
-- Read-only input for Brain/Floor and the chat-setup shadow backtest; no gate reads it.
create table if not exists chat_trades (
  id text primary key,
  user_id text not null,
  day_key text not null,
  setup text not null,
  symbol text not null,
  side text not null check (side in ('long','short')),
  contract text,
  qty integer not null,
  entry numeric not null,
  pnl numeric,
  trigger text,
  body jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_trades_day on chat_trades (user_id, day_key);
