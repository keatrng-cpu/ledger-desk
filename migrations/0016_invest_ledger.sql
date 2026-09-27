-- Invest ledger: the share book's append-only record, durable.
--
-- WHY THIS EXISTS
-- The Investments tab kept its book and its monthly sweep log in
-- localStorage — one browser. Clearing that browser, or opening the desk on
-- a phone, lost or split the one record the tab exists to keep: "did I
-- actually sweep every month, and what did I buy with it". This table
-- mirrors that ledger (src/lib/invest/ledger.ts) so it survives a cache
-- clear and reads the same on every device.
--
-- WHY APPEND-ONLY, AND WHY (user_id, id) IS THE WHOLE KEY
-- Entries are never updated. A correction is a new 'void' entry naming what
-- it cancels, exactly like the trade journal's discipline. Inserts are
-- insert-or-ignore on (user_id, id), so a device re-sending what the server
-- already holds is a no-op, two devices can never overwrite each other, and
-- a month's sweep (id 'sweep:YYYY-MM') is written once per user no matter
-- how many devices log it — the first one stands and the others are told.
--
-- WHY IT IS ITS OWN TABLE AND NOT desk_trades
-- These are share purchases on a years clock, not trades. Mixing them into
-- desk_trades would put non-trade rows into the attested track record, the
-- analytics and the A+ unlock count.
--
-- body = the full entry (buy / sell / dividend / sweep / void). The scalar
-- columns are copies for ordering and inspection.

create table if not exists invest_ledger (
  user_id text not null,
  id text not null,
  kind text not null check (kind in ('buy', 'sell', 'dividend', 'sweep', 'void')),
  entry_date text not null,
  body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists invest_ledger_user_created_idx
  on invest_ledger (user_id, created_at);

-- Same posture as every other table (0010_rls_lockdown.sql): RLS on with no
-- policy closes the PostgREST surface; the app connects as the owner role.
alter table invest_ledger enable row level security;
