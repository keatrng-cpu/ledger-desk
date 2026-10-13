-- Watcher tab: the desk-watcher POSTs its public-safe status JSON (account masked, no balances,
-- no credentials) with the CRON_SECRET bearer; the site serves the latest row read-only.
create table if not exists desk_watcher_status (
  id int primary key default 1, body jsonb not null, received_ms bigint not null
);
alter table desk_watcher_status enable row level security;
