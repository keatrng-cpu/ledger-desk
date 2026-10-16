-- PROPOSED, NOT APPLIED (graph-drift-1016 #3). Deliberately NOT in migrations/: scripts/migrate.mjs and the PGLite path
-- apply every file there on build/startup. Move it to migrations/0028_card_reasons_shadow.sql only after review.
--
-- Shadow table for card reasons. desk_card_snap is unchanged (q >= 0.65 only, first snapshot per day, reasons.slice(-12)).
-- This keeps every card's reasons, sampled: one row per card only when its reasons change (src/lib/desk/reasons-shadow.ts
-- reasonsShadowRows dedupes on a 16-hex sha256 of the reasons list). Additive; nothing reads it to grade, gate or fire.
create table if not exists desk_card_reasons_shadow (
  id bigserial primary key,
  at_ms bigint not null,
  day_key text not null,
  symbol text not null,
  side text not null,
  band text,
  q double precision,
  reasons_hash text not null,
  reasons jsonb not null
);
-- One row per (day, card, reasons version): re-sending the same reasons the same day is a no-op.
create unique index if not exists desk_card_reasons_shadow_uniq on desk_card_reasons_shadow (day_key, symbol, side, reasons_hash);
create index if not exists desk_card_reasons_shadow_day on desk_card_reasons_shadow (day_key);
