-- Card ↔ watcher join key. The desk-watcher keys every card it sees as `sig-<16 hex>` (watcher/gates.py signal_key);
-- the journal had no such column, so a live fill could only be matched to its card by day/symbol/side/entry
-- (10/15 sig-85e8feddd99efe46 matched nothing). Additive and nullable: existing rows and queries are untouched.
-- /api/desk/fills stamps it on the matching card when the watcher reports a fill.
alter table desk_card_journal add column if not exists signal text;
-- Not CONCURRENTLY: scripts/migrate.mjs (and the PGLite path in src/lib/db.ts) applies every file inside BEGIN/COMMIT,
-- and CREATE INDEX CONCURRENTLY cannot run in a transaction block. The index is partial (signal is null on every
-- existing row, so it indexes zero rows at creation) and desk_card_journal is small, so the share lock is brief.
create index if not exists desk_card_journal_signal on desk_card_journal (signal) where signal is not null;
