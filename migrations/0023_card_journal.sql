-- Fix 23/25: self-scoring journal of A-/A/A+ cards. One row per card
-- (day, symbol, side, entry). Outcomes are SAMPLED at card reads, not tick
-- data. Report only: nothing here changes a band.
create table if not exists desk_card_journal (
  id text primary key,
  day_key text not null,
  symbol text not null,
  side text not null,
  band text not null,
  q double precision not null,
  entry double precision not null,
  stop double precision not null,
  target double precision not null,
  rr double precision,
  opened_ms bigint not null,
  filled boolean not null default false,
  status text not null default 'open',
  r double precision,
  closed_ms bigint,
  context jsonb not null default '{}'::jsonb,
  review text
);
create index if not exists desk_card_journal_day on desk_card_journal (day_key);
alter table desk_card_journal enable row level security;
