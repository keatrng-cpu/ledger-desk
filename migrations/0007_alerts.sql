-- Phase B4/B5 — alerts that reach you, and a record that a scheduled job ran.
--
-- Two tables, one job each:
--
-- push_subscriptions — one row per browser push endpoint. The endpoint URL is
--   the push service's opaque address for this browser; `p256dh` and `auth` are
--   the subscriber's public key and shared secret (base64url, exactly as the
--   browser's PushSubscription exposes them). Neither is a server secret: they
--   are useless without the VAPID private key, which lives only in env.
--   `endpoint` is globally unique because it IS the identity of a subscription.
--   Re-subscribing from the same browser under a different account therefore
--   re-attributes the row rather than duplicating it (see store-server.ts).
--
-- alert_log — the idempotency ledger. The whole point of B4 is that an alert is
--   a fact about the session ("halt hit"), not a UI event, and the desk may
--   evaluate that fact many times: a 30s poll re-notices the same halt, a cron
--   endpoint gets retried, two tabs are open. `(user_id, kind, dedupe_key)` is
--   unique, so "send this alert" is an INSERT that either claims the fact or
--   loses the race — never a read-then-write with a window in the middle.
--   Callers choose the dedupe key to encode the intended granularity:
--     halt_hit                -> 'halt:daily:2026-08-11'   (once per day)
--     setup_armed             -> 'armed:MNQ:long:<candidate id>'
--     news_blackout_15m       -> 'blackout:2026-08-11T12:30Z'
--     cron_premarket_checklist-> 'checklist:2026-08-11'     (once per ET day)
--
--   It doubles as the answer to "did the 16:15 review actually run on the 4th?"
--   — which is the question a scheduled job exists to make answerable. Rows are
--   kept, not pruned: this table is small (a handful of rows per session day)
--   and its history is the audit trail.

create table if not exists push_subscriptions (
  id text primary key,
  user_id text not null,
  -- The push service URL. Unique: one row per physical browser subscription.
  endpoint text not null unique,
  -- Subscriber public key (uncompressed P-256 point) and auth secret, base64url.
  p256dh text not null,
  auth text not null,
  -- Diagnostic only ("which device stopped receiving?"). Never used for auth.
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error text,
  -- Push services return 404/410 for a dead endpoint; those are deleted on
  -- sight. This counts soft failures (timeouts, 5xx) so a permanently broken
  -- endpoint can be spotted without reading logs.
  failure_count integer not null default 0
);

create index if not exists push_subscriptions_user_idx
  on push_subscriptions (user_id);

create table if not exists alert_log (
  id bigint generated always as identity primary key,
  user_id text not null,
  kind text not null check (kind in (
    'setup_armed',
    'halt_hit',
    'position_flattened',
    'news_blackout_15m',
    'cron_premarket_checklist',
    'cron_session_review',
    'cron_weekly_review'
  )),
  -- Caller-chosen idempotency key. See the header for the conventions.
  dedupe_key text not null,
  title text not null,
  body text,
  -- Structured context (counts, symbols, R) so the review screen and a future
  -- digest can render the alert without re-deriving it.
  payload jsonb,
  -- How many push endpoints accepted the notification. 0 is normal and not an
  -- error: the fact is still recorded when no browser is subscribed.
  delivered integer not null default 0,
  created_at timestamptz not null default now()
);

-- The idempotency guarantee. An alert is claimed by INSERT ... on conflict do
-- nothing; zero rows returned means "already sent", not "failed".
create unique index if not exists alert_log_user_kind_dedupe_idx
  on alert_log (user_id, kind, dedupe_key);

create index if not exists alert_log_user_created_idx
  on alert_log (user_id, created_at desc);
