-- Grok SHADOW advisor (Keaton 2026-10-16, PR #45 stack). A LOG, NOT A ROUTE.
-- Written only by src/lib/grok-reader/advisor.ts (flag GROK_ADVISOR_SUPABASE, default off) and the X pulse poller
-- (flag X_PULSE, default off). Nothing reads these tables to fire, block, grade or change a rule.
-- NOT APPLIED: apply to prod only with Keaton's explicit go.

create table if not exists grok_advisor_suggestions (
  id text primary key,                       -- adv:<sym>:<side>:<type>:<decision ms>; repeat writes dedupe
  ts timestamptz not null,                   -- decision time (closed bar)
  symbol text not null check (symbol in ('ES', 'MNQ')),
  side text not null check (side in ('long', 'short')),
  type text not null check (type in ('MISGRADED', 'WRONGLY_BLOCKED', 'NEW_SETUP')),
  entry double precision, stop double precision, target double precision,
  reason_code text not null,
  blocker text,                              -- verbatim desk blocker/veto (WRONGLY_BLOCKED only)
  note text,
  card_id text,
  desk jsonb,                                -- {grade, q, actionable, blockers[]}
  brain text,
  news jsonb,                                -- x_pulse tag within ±15 min, if any
  prompt_version text not null,
  cost_usd numeric(10, 6),
  -- scoring harness (src/lib/grok-reader/grade.ts), filled after the session closes
  outcome text check (outcome in ('TARGET', 'STOP', 'EOD', 'NOFILL', 'NODATA')),
  r double precision,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint blocker_only_when_blocked check ((type = 'WRONGLY_BLOCKED') = (blocker is not null))
);
create index if not exists grok_advisor_suggestions_ts_idx on grok_advisor_suggestions (ts desc);
create index if not exists grok_advisor_suggestions_blocker_idx on grok_advisor_suggestions (blocker) where blocker is not null;

create table if not exists x_pulse (
  id text primary key,                       -- X post id
  ts timestamptz not null,
  author text not null,
  text text not null,
  impact text not null check (impact in ('high', 'medium', 'low')),
  keywords text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists x_pulse_ts_idx on x_pulse (ts desc) where impact = 'high';

-- service role only (same lockdown as 0010): RLS on, no policies.
alter table grok_advisor_suggestions enable row level security;
alter table x_pulse enable row level security;
