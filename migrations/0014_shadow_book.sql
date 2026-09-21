-- Shadow book: the desk's REFUSALS, paper-traded on real tape.
--
-- WHY THIS EXISTS
-- The paper book (desk_trades, mode='paper') is what the desk took. This is
-- what it turned down: every PATH-grade card that the SMC sequence printed
-- STAND or WAIT on, opened as two shadow legs (the desk's own resting limit,
-- and a chase at the print) and resolved against closed bars plus live
-- prints, with the paper book's scale-out. The 2026-09-21 replay found the
-- sequence takes ~0 trades a month on closed bars, so this table is where
-- the evidence about each gate accumulates — "did refusing on X save money
-- or cost it" is only answerable by counting these.
--
-- WHY IT IS ITS OWN TABLE AND NOT desk_trades
-- Nothing here is a fill the trader made. Mixing it into desk_trades would
-- poison the track record, the attestation chain, the analytics and the
-- n>=20 A+ unlock with trades that never happened. shadow_trades is read by
-- src/lib/trading/discretion-memory.ts only, and it writes nothing back to
-- any gate — it informs, it never permits.
--
-- id  = deterministic: symbol + side + ET day + refusing layer + leg + entry,
--       so the same refusal re-polled every 20s is one row (upsert), not one
--       row per poll.
-- body = the full ShadowTrade (src/lib/trading/shadow-book.ts): path events,
--       layer states at open, the context tags, the analysis. The scalar
--       columns are copies for indexing and aggregation.

create table if not exists shadow_trades (
  id text primary key,
  user_id text not null,
  day_key text not null,
  symbol text not null,
  side text not null check (side in ('long', 'short')),
  leg text not null check (leg in ('limit', 'chase')),
  kind text not null,
  reason_id text not null,
  status text not null,
  opened_at timestamptz not null,
  closed_at timestamptz,
  r numeric,
  pnl numeric,
  source text not null default 'live' check (source in ('live', 'replay')),
  body jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists shadow_trades_user_opened_idx
  on shadow_trades (user_id, opened_at desc);
create index if not exists shadow_trades_user_reason_idx
  on shadow_trades (user_id, reason_id, leg);

alter table shadow_trades enable row level security;
