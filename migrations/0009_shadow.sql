-- ROADMAP E4 — shadow mode. A LOG, NOT A ROUTE.
--
-- `shadow_orders` stores the OrderIntent the desk WOULD have placed, with the
-- timestamp and the desk context it was computed from, so it can be diffed
-- against what the human actually did (desk_trades / the paper book). Nothing
-- reads this table to send anything: there is no broker adapter, no HTTP
-- client and no credential anywhere in `src/lib/execution/`, deliberately.
--
-- An adapter that can transmit is gated on ROADMAP Phase E's four unlock
-- conditions — >=100 mirrored paper trades, positive LIVE-mode expectancy,
-- Phase A shipped (one scorer), B1 shipped (one rule set) — plus E4's own
-- ">=2 weeks of boring diff". This table is how that diff gets measured; it is
-- not a step toward transmitting on its own.
--
-- id  = the intent's client order id. Recording the same computed intent twice
--       (the desk re-evaluates the same armed setup every poll) must be one
--       row, not one row per poll — so the PK does the deduping and callers use
--       `on conflict do nothing`.
-- ts  = when the intent was COMPUTED (decision time), which is what the diff
--       compares against; `created_at` is when the row landed.

create table if not exists shadow_orders (
  id text primary key,
  user_id text not null,
  ts timestamptz not null,
  -- Full OrderIntent (src/lib/execution/order-intent.ts), version-stamped.
  intent jsonb not null,
  source text not null default 'desk'
    check (source in ('desk', 'scanner', 'engine', 'manual')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists shadow_orders_user_ts_idx
  on shadow_orders (user_id, ts desc);
