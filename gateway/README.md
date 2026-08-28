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

This costs money every month it runs: Databento Live (~$179–199/mo) plus a
small always-on host (~$3–10/mo). Confirm you actually want that recurring
cost before deploying it — the desk works fine without it, just with the
entry-timing limitation stated above.

## What it does

1. Connects to Databento Live **only 08:25–11:05 ET weekdays** (desk PATH window 08:30–11:00). Outside that it idles — no live socket.
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

## Deploying (any host that runs a long-lived process)

This does **not** deploy to Netlify — Netlify is serverless by design and
cannot run this. Pick one:

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
