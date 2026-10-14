-- Paper-futures journal (source = 'paper-futures'). Kept in its OWN table so no live stat, PATH n-to-100 count,
-- calibration (factor lifts / band edges) or live-trade metric can read it. Shadow/ablation readers only.
create table if not exists desk_paper_journal (
  id text primary key,
  source text not null default 'paper-futures' check (source = 'paper-futures'),
  signal text, symbol text not null, side text not null, band text, q double precision,
  result_r double precision, pnl_usd double precision, mfe_r double precision, mae_r double precision,
  outcome text, lesson text, live_would_block jsonb not null default '[]'::jsonb,
  closed_ms bigint, received_ms bigint not null, body jsonb not null);
create index if not exists desk_paper_journal_closed on desk_paper_journal (closed_ms);
alter table desk_paper_journal enable row level security;
