-- ops monitoring tables (infra only; no trading data). RLS on, no policies => service_role / direct DB only.
create table if not exists ops_heartbeats (
  source text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists ops_alerts (
  id bigserial primary key,
  alert_key text not null,
  severity text not null default 'warn',
  state text not null default 'open' check (state in ('open','resolved')),
  message text not null,
  detail jsonb not null default '{}'::jsonb,
  opened_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  notified_open boolean not null default true,
  notified_resolved boolean not null default false
);
-- one open incident per key: this is the dedupe
create unique index if not exists ops_alerts_one_open on ops_alerts(alert_key) where state='open';
create index if not exists ops_alerts_opened on ops_alerts(opened_at desc);
create or replace view ops_alerts_open as
  select alert_key, severity, message, opened_at, last_seen_at from ops_alerts where state='open';
alter table ops_heartbeats enable row level security;
alter table ops_alerts enable row level security;
revoke all on ops_heartbeats, ops_alerts, ops_alerts_open from anon, authenticated;
