-- 0028_rh_fill_journal — the auto-journal of LIVE Robinhood option round-trips,
-- each bound to the desk card that suggested it and scored on what happened.
--
-- WHY a new table (not desk_trades): desk_trades keeps the UNDERLIER plan terms
-- (MNQ/ES entry/stop/target). This records the OPTION that was actually filled
-- (QQQ 718P, debit 2.04 -> credit 2.23, +$57), the card it came from, and the
-- realized outcome — the "read what the option was, what card suggested it, why,
-- and what happened" loop. Additive and read-only to the rest of the schema.
--
-- One row = one option_id cycle (open -> flat) on the Agentic account 995386158.
-- Reconciled from get_option_orders + get_pnl_trade_history (authoritative P&L).

create table if not exists rh_fill_journal (
  id              text primary key,          -- `${account}:${option_id}:${day_key}:${cycle}`
  user_id         text,
  account_number  text not null,
  day_key         text not null,             -- ET yyyy-mm-dd (trade date)

  -- what the option was
  underlying      text not null,             -- QQQ / SPY
  option_type     text,                      -- call / put
  strike          numeric,
  expiration      date,
  dte             integer,
  side            text not null,             -- long / short (call=long, put=short)
  contracts       integer not null,

  -- open
  opened_at       timestamptz,
  open_order_id   text,
  debit           numeric,                   -- avg per-contract open premium
  debit_total     numeric,                   -- $ out (debit * contracts * 100)

  -- close
  closed_at       timestamptz,
  close_count     integer default 0,         -- number of closing orders
  credit          numeric,                   -- avg per-contract close premium
  credit_total    numeric,                   -- $ in

  -- outcome
  realized        numeric,                   -- net $ (pnl-history authoritative when matched)
  roi             numeric,                   -- realized / debit_total
  hold_secs       integer,
  status          text not null,             -- open / closed
  win             boolean,

  -- attribution: the card that suggested it
  card_match      text,                      -- signal / time / none
  card_id         text,
  card_signal     text,
  card_band       text,                      -- A+ / A / A-
  card_side       text,                      -- long / short (as the card called it)
  card_symbol     text,                      -- NQ / MNQ / ES (the card's instrument)
  plan_entry      numeric,
  plan_stop       numeric,
  plan_target     numeric,
  plan_rr         numeric,
  why             jsonb,                      -- distilled reasons the card fired
  card            jsonb,                      -- the bound card-journal context snapshot

  -- learning
  slippage        numeric,                   -- plan_entry vs fill, underlier terms, when derivable
  hit_target      boolean,
  killzone        text,
  notes           text,

  recorded_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists rh_fill_journal_day  on rh_fill_journal (day_key);
create index if not exists rh_fill_journal_acct on rh_fill_journal (account_number, day_key);
create index if not exists rh_fill_journal_band on rh_fill_journal (card_band);
