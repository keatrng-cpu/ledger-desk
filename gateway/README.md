# Live tick gateway

A small, always-on Python process that holds Databento's real-time Live
connection for ES/NQ and writes to the same Postgres the desk already uses.
It exists because the desk (Netlify functions) cannot hold a persistent
socket, and Databento's real-time data only exists over one — there is no
REST snapshot endpoint for current price (confirmed against Databento's own
public roadmap, which has an *open* feature request for exactly that).

Read `databento_live_gateway.py`'s module docstring first — it explains why
this is Python in an otherwise TypeScript repo, and flags the one thing that
has NOT been verified yet: the exact record-iteration idiom, because the
docs page confirming it truncated on fetch while this was written. Do the
one-time check it describes before the first unattended run.

## Before you spend anything

You do not need this gateway to fix the "10 minute lag" problem for
**structure** — that's already solved (`build-desk.ts`'s
structure-vs-execution-freshness split). You need this gateway specifically
because a 1m/5m entry trigger (OTE retest, mechanical sequence) needs the
*current* price, which no free/historical source can give.

This costs money every month it runs. Verified against the Databento portal
2026-09-14: live CME (GLBX.MDP3) requires the **Standard plan, $199/mo flat**
("Unlock with Standard" — usage-based live billing was retired March 2025, so
there is no cheaper Databento tier and the 08:15–11:30 window does **not**
reduce that bill). Standard also bundles 16+ years of L0 history and 1 year
of L1, so the separate usage-based historical charges (~$28/mo on this
account) go to zero — net incremental ≈ $171/mo. Hosting is $0 if you run it
on the desk PC on a schedule (below), or ~$3–10/mo on a VPS. Confirm you
actually want that recurring cost before deploying it — the desk works fine
without it, just with the entry-timing limitation stated above.

## What it does

1. Connects to Databento Live **whenever Globex is open** — Sunday 17:00 ET through Friday 16:00 ET, minus the daily 16:00–17:00 ET maintenance halt (`globex_open()` in the script). This is the default as of 2026-09-23; a narrower `GATEWAY_NY_AM_ONLY=1` fallback restores the old 08:15–11:30 ET-only window (through the 08:30 release → end of the NY AM A+ tail; Judas 09:30–09:45 is inside it but no-entry) for testing or if the always-on mode ever needs to be backed out. Either way, the socket is up well before the 08:30 ET release, so the release candle is covered live — note the asymmetry and do not confuse them: the socket connects at 08:15 ET at the latest, but the ±15m high-impact blackout still means no entry is legal until 08:45. You watch the print; you do not trade it. `GATEWAY_EXIT_AFTER_WINDOW=1` only does anything in the `GATEWAY_NY_AM_ONLY=1` fallback (exits at window-close instead of idling) — in the default always-on mode there is no daily "window close" to exit at, so the flag is a no-op and Task Scheduler's own execution-time-limit is what ends a run (see Option A).
2. On every record: upserts the latest price into `live_market_ticks`
   (one row per symbol — this is what gives you sub-5-second freshness) and
   aggregates 1s bars into `live_market_bars_1m`.
3. Reconnects with exponential backoff on any error. Never crashes silently
   — logs to stdout, which your host captures.

It sends nothing anywhere and places no orders. Read-only from Databento's
side, write-only to Postgres.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | The SAME connection string the main app uses (Session Pooler string from Supabase). One Postgres, shared. |
| `DATABENTO_API_KEY` | yes | Needs a live CME (GLBX.MDP3) entitlement — the historical-only key you have today will authenticate but return nothing on Live. |
| `DATABENTO_DATASET` | no | Defaults to `GLBX.MDP3`. |

## Option A — run it on the desk PC, free (Windows Task Scheduler)

Since the default is now "stream whenever Globex is open" and that costs
nothing extra (flat $199/mo, see above), the cheapest host is the PC you are
already sitting at, running effectively all week instead of a few hours a
day. Two triggers, not one:

- **Sunday 15:45 CT (16:45 ET)** — the primary trigger, 15 minutes ahead of
  the week's 17:00 ET Globex reopen, same reasoning as connecting before the
  08:30 ET release. In the ordinary week this ONE instance runs through to
  Friday's close.
- **Weekdays 07:10 CT (08:10 ET)** — a same-morning self-heal, in case the
  Sunday instance died earlier in the week. `-MultipleInstances IgnoreNew`
  means this is a harmless no-op whenever the Sunday instance is still alive.

Both share one `-ExecutionTimeLimit` of 6 days 12 hours — long enough that
either trigger's instance bridges cleanly to the next one, short enough that
a missed Sunday trigger (PC off) still self-clears within the week. `-WakeToRun`
wakes the machine for either trigger and `-StartWhenAvailable` catches a
missed one — but the PC must not be powered off at the wall.

1. `pip install -r gateway/requirements.txt`
2. Create `gateway/.env.local` (gitignored) with two lines:
   `DATABASE_URL=<the Session Pooler string Netlify uses>` and
   `DATABENTO_API_KEY=<key on a Standard plan>`.
3. `powershell -ExecutionPolicy Bypass -File gateway\install-task.ps1`
   — registers/updates **"LedgerDesk Live Gateway"** with both triggers above.
   It launches `run-local.ps1`, which loads `.env.local` and tees stdout to
   `gateway/logs/YYYY-MM-DD.log`.
4. First run supervised: `Start-ScheduledTask -TaskName "LedgerDesk Live Gateway"`
   during RTH and watch the log for `subscribed:` then `1m bar` lines
   (see the module docstring — the record-iteration idiom has not yet been
   verified against a real socket).

Caveats: runs only while you are logged in (no stored credential); the PC
must be awake at either trigger time (`-WakeToRun` handles sleep, not
shutdown). If either bites, use Option B.

## Option B — any host that runs a long-lived process

This does **not** deploy to Netlify — Netlify is serverless by design and
cannot run this. Leave `GATEWAY_EXIT_AFTER_WINDOW` unset so it idles between
windows. Pick one:

- **Fly.io** (~$3–5/mo shared VM) — best fit, strong for long-lived
  connections. `fly launch`, set the two env vars as secrets, deploy.
- **Railway** (~$5/mo) — simplest to click through, watch usage-based cost.
- **A cheap VPS + systemd** (Hetzner/DigitalOcean, ~$5/mo) — most control,
  most of your own maintenance.

Minimal systemd unit if you go the VPS route:

```ini
[Unit]
Description=ledger-desk live tick gateway
After=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/ledger-gateway.env
ExecStart=/usr/bin/python3 /opt/ledger-desk/gateway/databento_live_gateway.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## Verifying it's actually working

The desk itself is the check — no separate dashboard needed. Once the
gateway has been running for a few seconds during RTH:

1. `src/components/dashboard/dual-index-charts.tsx` should show a **"Live
   tick"** source badge instead of "Yahoo print" or "Databento".
2. The data-quality block in the Trade tab should stop showing "Execution
   blocked: quote Ns old" during active hours.
3. Directly: `select * from live_market_ticks;` — `received_at` should be
   within the last few seconds.

If the gateway stops or crashes, the desk does **not** break — the
freshness check in `src/lib/market/live-gateway.ts` treats a stale/missing
row as "no live gateway," and every existing fallback (Databento historical,
then Yahoo) still runs exactly as it did before this existed.

## Pruning

`live_market_bars_1m` grows forever with nothing in this repo to prune it —
deliberately not a cron this repo owns. Add a periodic
`delete from live_market_bars_1m where received_at < now() - interval '30 days'`
on whatever schedule you're comfortable with (the `live_market_bars_1m_received_idx`
index exists specifically to keep that cheap).
