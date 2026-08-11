-- Phase 6 — reconcile the two paper books.
--
-- There are two paper mechanisms after the profit-v3 merge:
--   1. paper-manager.ts  — localStorage book, instant one-click, no auth,
--      auto-manages exits against live prints. This is the WORKING book.
--   2. desk_trades (mode='paper') — durable, auth-scoped, what analytics,
--      CSV export and the unlock-ladder evidence read from.
--
-- (1) is mirrored into (2) so the working book stays instant while the record
-- becomes durable and analysable. See src/lib/journal/paper-mirror.ts.
--
-- The 0005 unique index (one OPEN row per mode+symbol+side) is too strict for
-- a mirror: the localStorage book does not enforce that rule, and the mirror
-- must faithfully record what actually happened rather than silently dropping
-- a real second position. Restrict the constraint to LIVE, where "one idea per
-- instrument" is an actual desk rule (see the risk governor copy).

drop index if exists desk_trades_one_open_per_side_idx;

create unique index if not exists desk_trades_one_open_live_idx
  on desk_trades (user_id, symbol, side)
  where status = 'open' and mode = 'live';

-- Mirrored rows are looked up by their client-generated id on close.
create index if not exists desk_trades_paper_open_idx
  on desk_trades (user_id, mode, status);
