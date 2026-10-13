-- Fast-move layer (shadow): the watcher POSTs 15s/5s bars + spike events (no account data) with its key.
create table if not exists desk_fast (id int primary key default 1, body jsonb not null, received_ms bigint not null);
alter table desk_fast enable row level security;
