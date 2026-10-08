-- Grok's report back to the floor. One row. The connector writes it.
-- The next desk read speaks it: taken or not, pnl, and the journal line.

create table if not exists grok_desk_report (
  id text primary key,
  taken boolean not null,
  pnl double precision,
  journal text not null,
  detail jsonb not null default '{}'::jsonb,
  at_ms bigint not null
);

alter table grok_desk_report enable row level security;
