-- The trading floor's execution layer (src/lib/room/exec): an audit trail of every decision it carried
-- toward a broker, and the per-trader arming state.
--
-- WHY room_orders IS AN AUDIT TRAIL WITH A UNIQUE KEY
-- Two browsers can run the same deterministic room, so the same decision can arrive twice.
-- client_order_id is derived from the decision, and (user_id, client_order_id) is unique: the first
-- insert reserves the order, a second one is a no-op, and only the first ever reaches a broker. Shadow
-- rows (no broker call at all) live here too, with phase = 'shadow', so the record of what the
-- automation WOULD have done sits beside what it did. Refused rows keep every reason.
--
-- WHY room_exec_state IS SERVER-SIDE
-- The browser must not be able to arm anything by itself: the wanted phase and the kill switch are
-- read by the server, and the executor lease says which ONE device may send orders for this trader.

create table if not exists room_orders (
  id bigserial primary key,
  user_id text not null,
  client_order_id text not null,
  phase text not null,
  role text not null,
  symbol text not null,
  side text not null,
  qty integer not null,
  limit_px numeric,
  status text not null,
  broker_status text,
  reasons jsonb not null default '[]'::jsonb,
  broker_order_id text,
  filled_qty integer not null default 0,
  filled_avg_px numeric,
  attempt integer not null default 0,
  intent jsonb not null,
  quote jsonb,
  at_ms bigint not null,
  updated_ms bigint not null,
  created_at timestamptz not null default now(),
  unique (user_id, client_order_id)
);

create index if not exists room_orders_user_recent on room_orders (user_id, id desc);
create index if not exists room_orders_user_open on room_orders (user_id, phase, status);

create table if not exists room_exec_state (
  user_id text primary key,
  wanted text not null default 'off',
  -- when the phase last CHANGED: a position the room opened before the phase was switched on is never 'unsent'.
  wanted_at_ms bigint,
  killed boolean not null default false,
  kill_reason text,
  lease_holder text,
  lease_ms bigint,
  updated_at timestamptz not null default now()
);

-- Same posture as every other table (0010_rls_lockdown.sql): RLS on with no policy closes the
-- PostgREST surface; the app connects as the owner role.
alter table room_orders enable row level security;
alter table room_exec_state enable row level security;
