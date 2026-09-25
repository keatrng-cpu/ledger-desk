-- Real fills, recorded with the context that makes them evidence.
--
-- `openTrade` gates live entries (halts, killzone cap, pathTakeGate, one open
-- position). That is right for an ORDER the desk is about to place, and wrong
-- for a FILL that already happened at the broker: an override is exactly the
-- row the discipline record needs most, and it was the row the journal
-- refused. `recordRealFill` (src/lib/journal/server.ts) writes these columns
-- and never refuses on a rule — it records that the rule was broken instead.
--
-- All additive and nullable (override defaults false), so existing rows and
-- every existing query are untouched. Attestation hashes a fixed field list
-- (attest.ts ATTESTED_FIELDS), so the chain is unaffected.

alter table desk_trades add column if not exists desk_word text;
alter table desk_trades add column if not exists missing_layers jsonb;
alter table desk_trades add column if not exists override boolean not null default false;
alter table desk_trades add column if not exists override_gate text;
alter table desk_trades add column if not exists path_band text;
alter table desk_trades add column if not exists why text;
alter table desk_trades add column if not exists why_pre boolean;
alter table desk_trades add column if not exists plan_entry double precision;
alter table desk_trades add column if not exists plan_stop double precision;
alter table desk_trades add column if not exists filled_at timestamptz;
alter table desk_trades add column if not exists state_rating smallint;
alter table desk_trades add column if not exists mistakes jsonb;
alter table desk_trades add column if not exists exit_reason text;
