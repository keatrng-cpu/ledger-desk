-- Per-account peak-equity tracking for the Apex trailing-drawdown breaker
-- (execution/execution-gate.ts's apexAccountRisk).
--
-- WHY THIS EXISTS
-- Apex's Tradovate evaluations ($50K "Intraday Trail" product, confirmed via
-- Apex's own docs): trailing drawdown tracks PEAK balance — including
-- UNREALIZED gains on open positions — and never stops trailing during the
-- eval (unlike Rithmic evals, where it locks at the profit target). Touching
-- the threshold at ANY moment fails the account immediately. That threshold
-- moves every time a new peak is made, so it has to be tracked continuously,
-- not just checked against today's starting balance the way the generic
-- daily-loss breaker does.
--
-- This is PER TRADOVATE ACCOUNT (account_id), not per desk user — the 5
-- sibling Apex evaluations (APEX-644704-01..05) each have their OWN $50K
-- starting balance and own $2,500 trail, entirely independent of each
-- other. One account failing does not affect the other four.
--
-- user_id is still included for RLS/multi-tenant consistency with every
-- other table in this app, even though this desk is currently single-user.
--
-- Safe to apply with no rows: apexAccountRisk() treats a missing row as
-- "no peak recorded yet" and seeds it from the account's current equity on
-- first read, same fail-safe-empty pattern as 0011's tables.

create table if not exists apex_account_peak (
  user_id text not null,
  -- Tradovate's numeric account id, as text (Tradovate ids are integers,
  -- stored as text here so this table never has to agree with Tradovate's
  -- own type on a schema change).
  account_id text not null,
  account_name text,
  peak_equity numeric not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, account_id)
);

alter table apex_account_peak enable row level security;
