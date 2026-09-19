-- Tamper-evident attestation chain over desk_trades.
--
-- WHY THIS EXISTS
-- A track record only has value to somebody who did not watch it being made
-- if that person can rule out the trader having deleted the losers. Rows in a
-- database the trader controls cannot rule that out. This table makes every
-- trade event a link in a hash chain: each row commits to the hash of the row
-- before it, so altering or removing any historical trade invalidates every
-- link recorded after it. See src/lib/journal/attest.ts for the hashing rules
-- and for how the tip gets anchored to an external clock.
--
-- WHY IT IS A SEPARATE TABLE
-- desk_trades must stay editable: fills get corrected, a fat-fingered exit
-- gets fixed, columns get added. The chain is the immutable shadow of that
-- mutable table. A correction is not forbidden — it is recorded, as an
-- 'amend' link that seals both the fact of the change and the new values.
-- "You may correct the record, but you may not correct it silently" is the
-- property worth having, and the only one that survives contact with a real
-- trading log.
--
-- APPEND-ONLY ENFORCEMENT
-- The trigger below blocks UPDATE and DELETE. This is defence-in-depth
-- against application bugs and accidents, NOT the security boundary: whoever
-- owns the database can drop the trigger. The actual guarantee comes from the
-- hash chain plus an external anchor, which is why sealing the tip publicly
-- is part of the routine and not optional decoration.
--
-- Safe to apply with no rows. An empty chain verifies as ok with tip=null.

create table if not exists desk_attestations (
  seq bigserial primary key,
  user_id text not null,
  -- The desk_trades.id this link attests to. For an event of type 'seal'
  -- this is the literal string 'seal' — a seal commits to the tip, not to a
  -- trade. No FK to desk_trades on purpose: the chain must survive a trade
  -- row being deleted, because detecting exactly that is the point.
  trade_id text not null,
  event text not null check (event in ('open', 'close', 'amend', 'seal')),
  -- Application-supplied, because the hash has to be computed before the
  -- INSERT and must match what is stored. The chain therefore proves ORDER,
  -- not absolute time; absolute time comes from the external anchor.
  recorded_at timestamptz not null,
  -- The canonical attested projection of the trade (RFC 8785 key order is
  -- applied at hash time, not here — jsonb does not preserve key order).
  body jsonb not null,
  body_hash text not null check (body_hash ~ '^[0-9a-f]{64}$'),
  prev_hash text not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  hash text not null unique check (hash ~ '^[0-9a-f]{64}$')
);

-- One chain per user, walked in seq order.
create index if not exists desk_attestations_user_seq_idx
  on desk_attestations (user_id, seq);

-- Finding every link that touched a given trade, for an amend history.
create index if not exists desk_attestations_trade_idx
  on desk_attestations (user_id, trade_id);

-- A user's chain must be a chain, not a tree: two links may not claim the
-- same predecessor. Without this a fork could be inserted and the shorter,
-- more flattering branch presented as the record.
create unique index if not exists desk_attestations_user_prev_uniq
  on desk_attestations (user_id, prev_hash);

create or replace function desk_attestations_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'desk_attestations is append-only (attempted % on seq %)',
    tg_op, coalesce(old.seq, -1)
    using hint = 'Record a new ''amend'' link instead of editing history.';
end;
$$;

drop trigger if exists desk_attestations_no_mutate on desk_attestations;
create trigger desk_attestations_no_mutate
  before update or delete on desk_attestations
  for each row execute function desk_attestations_append_only();

alter table desk_attestations enable row level security;
