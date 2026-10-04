-- The trading floor's paper book and the room's memory, one row per trader.
--
-- WHY THIS EXISTS
-- The Floor tab's room (src/lib/room) keeps its paper book, its ghost room
-- (lab.ts: mandate twins, refused tickets, plan watches) and the people's
-- memory in localStorage — one browser. The ghost room only means something
-- once it has accumulated weeks of evidence; a cleared cache or a new phone
-- used to start it from zero. This table keeps the latest copy server-side.
--
-- WHY A SNAPSHOT AND NOT APPEND-ONLY ROWS
-- The room is a deterministic simulation that runs in EVERY open browser.
-- Two devices open at once run two copies of the same decisions, so merging
-- their trades would count each one twice. One canonical copy per trader is
-- the honest unit: the client pushes after cycles that changed the book and
-- adopts the server copy only at startup, and only when it carries more
-- history than the local one (src/lib/room/snapshot-sync.ts). Never merged.
--
-- history = book.seq + lab.seq (both only ever grow); last_at = the newest
-- closed trade or ghost. The pair decides which copy is richer.

create table if not exists room_snapshot (
  user_id text primary key,
  body jsonb not null,
  history integer not null,
  last_at bigint not null,
  saved_at timestamptz not null default now()
);

-- Same posture as every other table (0010_rls_lockdown.sql): RLS on with no
-- policy closes the PostgREST surface; the app connects as the owner role.
alter table room_snapshot enable row level security;
