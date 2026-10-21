-- Idempotent: 0029 was applied in prod before RLS was added to it.
alter table chat_trades enable row level security;
