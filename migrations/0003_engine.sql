-- Engine ingest: raw runs from the Trading-Automation Python engine
-- (backtest data.json, knowledge/confluence.json, premarket snapshots) plus
-- desk-side replay calibration reports. Payload is validated with zod in
-- src/lib/engine/ingest.ts BEFORE insert — this table stores the validated
-- document as-is (tolerant passthrough of extra engine fields).
--
-- Per-user (user_id TEXT NOT NULL — preview dev user id is the string
-- 'dev-user'); every query in src/lib/engine/* scopes by the authenticated
-- user server-side.

create table if not exists engine_runs (
  id text primary key,
  user_id text not null,
  kind text not null check (kind in ('backtest', 'knowledge', 'premarket', 'replay')),
  label text,
  payload jsonb not null,
  ingested_at timestamptz not null default now()
);

create index if not exists engine_runs_user_kind_time_idx
  on engine_runs (user_id, kind, ingested_at);
