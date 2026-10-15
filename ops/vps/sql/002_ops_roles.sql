-- Least-privilege login roles for the VPS ops services (passwords are set by install.sh, never stored in git).
-- ledger_ops_paper   : paper lane  -> SELECT live_market_bars_1m only (read-only)
-- ledger_ops_watchdog: watchdog    -> SELECT gateway tables + heartbeats; write only its own ops tables
do $$ begin
  if not exists (select 1 from pg_roles where rolname='ledger_ops_paper') then create role ledger_ops_paper login noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='ledger_ops_watchdog') then create role ledger_ops_watchdog login noinherit; end if;
end $$;
alter role ledger_ops_paper set default_transaction_read_only = on;
alter role ledger_ops_paper connection limit 3;
alter role ledger_ops_watchdog connection limit 3;
grant usage on schema public to ledger_ops_paper, ledger_ops_watchdog;
grant select on live_market_bars_1m to ledger_ops_paper;
grant select on live_market_bars_1m, live_market_ticks, ops_heartbeats, ops_alerts to ledger_ops_watchdog;
grant insert, update on ops_alerts, ops_heartbeats to ledger_ops_watchdog;
grant usage on sequence ops_alerts_id_seq to ledger_ops_watchdog;
-- RLS is on for the ops tables with no policies; give the watchdog role explicit policies (nobody else gets any)
drop policy if exists watchdog_all on ops_alerts;      create policy watchdog_all on ops_alerts      for all to ledger_ops_watchdog using (true) with check (true);
drop policy if exists watchdog_all on ops_heartbeats;  create policy watchdog_all on ops_heartbeats  for all to ledger_ops_watchdog using (true) with check (true);
-- Gateway tables have RLS on with no policies (only the owner/service_role reads them). Add SELECT-only policies scoped to
-- these two roles; no other role's access changes and nothing can write through them.
drop policy if exists ops_ro_select on live_market_bars_1m;
create policy ops_ro_select on live_market_bars_1m for select to ledger_ops_paper, ledger_ops_watchdog using (true);
drop policy if exists ops_ro_select on live_market_ticks;
create policy ops_ro_select on live_market_ticks for select to ledger_ops_watchdog using (true);
