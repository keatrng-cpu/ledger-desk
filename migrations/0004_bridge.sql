-- Phase 4 — automation bridge (engine <-> desk).
--
-- Owns ONLY the two bridge-local tables below. Trade/event storage lives in
-- `desk_trades` / `desk_events` from migrations/0002_journal.sql (Phase 1) —
-- this file never creates, alters, or indexes those.
--
--   engine_status         one row per user: engine liveness + desk paper-loop
--                         toggle. `id` carries the user id for real users; the
--                         'singleton' default exists so a manual single-user
--                         insert works without spelling one out.
--   engine_ingest_batches idempotency ledger for POST /api/engine/journal.
--                         Insert-on-conflict-do-nothing on the PK is the
--                         race-safe duplicate test; the batch id is ALSO
--                         mirrored into each desk_events.payload row so the
--                         provenance survives independently of this table.

create table if not exists engine_status (
  id text primary key default 'singleton',
  user_id text not null unique,
  last_seen timestamptz,
  mode text,
  note text,
  symbol text,
  -- Paper loop is the Phase 4 unlock gate: OFF until explicitly turned on.
  paper_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists engine_ingest_batches (
  batch_id text not null,
  user_id text not null,
  event_count integer not null default 0,
  received_at timestamptz not null default now(),
  primary key (user_id, batch_id)
);

create index if not exists engine_ingest_batches_received_idx
  on engine_ingest_batches (user_id, received_at desc);
