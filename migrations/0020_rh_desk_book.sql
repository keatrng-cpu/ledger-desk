-- What this desk opened on Agentic 995386158.
--
-- A file under /tmp dies with the serverless instance. The next poll then
-- sees the contract as someone else's and will neither manage it nor close
-- it, and a second instance can open again. One row, keyed by the trade
-- account, so the floor poll and the cron share the same book.

create table if not exists rh_desk_book (
  account_number text primary key,
  rows jsonb not null default '[]'::jsonb,
  placed_at bigint
);

alter table rh_desk_book enable row level security;
