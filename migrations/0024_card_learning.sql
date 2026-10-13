-- Learning loop (extends 0023): every card with q or qRaw >= 0.65 is
-- snapshotted once per (ET day, symbol, side, setup) and graded against the
-- real 1m bars after it. desk_calibration versions every weight/band change
-- (n >= 30 per factor, shrunk, ±20% cap); prior state is kept and a version
-- can be reverted. Outcomes are never invented: no bars → 'ungradable'.
create table if not exists desk_card_snap (
  id text primary key, day_key text not null, symbol text not null, side text not null, setup text not null,
  band text, q double precision not null, q_raw double precision, opened_ms bigint not null,
  price double precision, atr double precision, entry double precision, stop double precision, target double precision,
  resting boolean, present jsonb not null default '[]'::jsonb, missing jsonb not null default '[]'::jsonb,
  checklist jsonb not null default '[]'::jsonb, ctx jsonb not null default '{}'::jsonb, source text not null default 'live',
  status text not null default 'open', grade jsonb, failure_mode text, hows text, missed text, graded_ms bigint
);
create index if not exists desk_card_snap_status on desk_card_snap (status);
alter table desk_card_snap enable row level security;
create table if not exists desk_calibration (
  version integer primary key, created_ms bigint not null, applied boolean not null default false, reverted boolean not null default false,
  weight_scales jsonb not null default '{}'::jsonb, band_edges jsonb not null default '{}'::jsonb,
  prior jsonb, report jsonb not null default '{}'::jsonb, note text
);
alter table desk_calibration enable row level security;
