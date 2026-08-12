-- Deny-by-default Row Level Security on every application table.
--
-- WHY THIS EXISTS
-- On Supabase the `public` schema is exposed over PostgREST using the anon
-- key, and that key ships to the browser. A table left with RLS DISABLED is
-- therefore readable by anyone holding it — for this app that is the entire
-- trade history, equity, decision snapshots and strategy attribution of a
-- private trading journal.
--
-- WHY ZERO POLICIES IS THE CORRECT ANSWER HERE
-- This app does not use PostgREST or the anon key at all. It connects over a
-- direct Postgres connection string (node-postgres — src/lib/db.ts) as the
-- `postgres` role, and a superuser BYPASSES RLS. Enabling RLS with no policy
-- attached therefore closes the REST surface completely while leaving the
-- application untouched.
--
-- Normally "RLS on, zero policies" is a bug because it makes a table
-- unreachable. Here unreachable-over-REST is exactly the intent. Supabase's
-- linter will report `rls_enabled_no_policy` at INFO level for each table —
-- that is expected and is the desired state, not a finding to fix. The finding
-- that WOULD matter is `rls_disabled_in_public`, and there are none.
--
-- If a browser client is ever pointed at this database directly, it will
-- correctly read nothing until real per-user policies are written here.
--
-- Safe to re-run: `enable row level security` is idempotent.

alter table "user" enable row level security;
alter table "session" enable row level security;
alter table "account" enable row level security;
alter table "verification" enable row level security;

alter table desk_trades enable row level security;
alter table desk_events enable row level security;
alter table desk_settings enable row level security;
alter table desk_snapshots enable row level security;

alter table engine_runs enable row level security;
alter table engine_status enable row level security;
alter table engine_ingest_batches enable row level security;

alter table push_subscriptions enable row level security;
alter table alert_log enable row level security;
alter table shadow_orders enable row level security;
