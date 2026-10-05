-- The execution layer's unattended safety net (src/routes/api/cron/exec-flatten.ts): when it last ran for this
-- trader, so the Execution card can say whether the cron is actually wired to the right trader (CRON_USER_ID).
-- A separate migration on purpose: 0018 may already be applied, and an applied migration is never edited.

alter table room_exec_state add column if not exists net_ms bigint;
