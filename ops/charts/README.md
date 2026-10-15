# ops/charts — automatic SMC trade charts + shadow learning loop

Research/ops only: no broker client, no orders, no live-rule writes, no network, no paid data.

## What it does
For every **closed** trade it draws a chart and writes a JSON sidecar of the structure at entry:
`$TC_OUT/YYYY-MM-DD/<chart_id>.png` + `.json` (default `TC_OUT=/workspace/trade-charts`).
* chart_id = the watcher signal (`sig-…`) for live RH options; the paper ticket id (`ES-L-20261013-1912`) for paper futures
  (the desk signal is in the sidecar: paper ids are unique, signals are not).
* Sources: live RH options from the desk watcher (`alerts.log` FIRE/FILLED/TRIM/EXIT, `gates.log` for desk/brain/Floor + gates,
  `ticks/` for the underlying at fill/exit); paper futures from `/workspace/paper-futures/trades.csv` (deduped; last row wins);
  the paper-trend lane `events.jsonl` `paper_exit` rows (box `/workspace/paper-trend`, VPS `/var/lib/ledger-paper`).
* Bars (1m, first source wins): local GLBX ohlcv-1m cache (already pulled at $0) → VPS archive day files → extra CT pickles
  (`TC_EXTRA_BAR_DIRS`, e.g. a postmortem folder) → watcher tick snapshots aggregated to 1m. 5m/15m/1h/4h are resampled.
* Panels: ≤45 min trade → 5m context + 1m zoom; ≤4h → 15m + 5m; longer → 15m + 5m around entry. CT times throughout.
* Marked: FVGs (box until inverted; hatched purple iFVG after a CLOSE through the far edge), OBs, swings, EQH/EQL pools,
  sweeps (★), RTH/ON dealing-range EQ with premium (red) / discount (green) shading, PDH/PDL, ON H/L, premarket H/L, HTF
  bias (computed 1h/4h structure + the card's own), entry/stop/T1/T2, fill/trim/exit markers numbered against an events
  table with timestamps and R, verdicts and decisive gates in the legend column. Right-margin labels are prioritised
  (plan > session levels > iFVG/pools > zones), capped at 14 and de-overlapped.
* Features at entry use only bars CLOSED before the fill (`smc.closed`). `hindsight_*` and MFE/MAE are outcome columns.

## Learning loop (shadow)
`learn` builds `$TC_OUT/learn/features.csv` (one row per trade), `splits.json` and `report.md`: each feature's yes/no arms
with n, win% (raw and shrunk toward the pool with k=10), mean R (clipped to [-2, +3]), lift and shrunk lift
(× n_min/(n_min+10), the proto-weighting rule). It also writes extra data for the check-weighting prototype to
`$TC_PROTO_DIR/extra/` (`chart_features.csv`, `weights_chart_features.json`) — never over `weights.json`.

## Running
```
cd ops/charts
python3 -m trade_charts backfill --since 2026-10-13T00:00 --until 2026-10-15T23:59   # charts + learn
python3 -m trade_charts nightly        # since yesterday 00:00 CT + learn
python3 -m trade_charts exit --signal sig-…   # what the watcher hook runs
python3 -m trade_charts learn          # rebuild table/report from sidecars only
```
Each trade renders in a short-lived child process so peak memory is one trade (measured on the box: parent ~100 MB,
child ≤ ~215 MB with the 7.8-year GLBX cache; less on the VPS with day files).

## Watcher hook — `watcher-exit-hook.patch` (NOT applied to the live watcher)
Adds `watcher/chart_hook.py` and, in `daemon.manage()`, after an `exit` sell has been sent and booked, a call to
`chart_hook.spawn(signal, base_dir)`: `subprocess.Popen` (returns in ~1 ms) of
`timeout -k 10 300 nice -n 10 python3 -m trade_charts exit --delay 90 --signal …`, own session, stdin/stdout detached,
a daemon thread reaps it, every exception swallowed, minimal env (PATH/HOME/LANG/TZ/TC_* only — no broker creds).
Knobs: `TC_HOOK=0` disables; `TC_SRC` (default `/workspace/ld-charts/ops/charts`), `TC_PYTHON`, `TC_HOOK_TIMEOUT`, `TC_HOOK_DELAY`.
Apply at a quiet time: `cd /workspace/desk-watcher && patch -p1 --dry-run < …/watcher-exit-hook.patch` then without `--dry-run`, then restart via ctl.sh.

## VPS
`ops/vps/charts_nightly.py` + `ledger-charts.{service,timer}` (Mon–Fri 18:05 ET, after archive/backtest): MemoryMax=300M,
`PrivateNetwork=yes`, no env file. It uses archive bars only if the last `archive.log` record has `cost_usd == 0`.

## Review fixes (PR #25)
- Swept levels: PD/ON/PM lines and EQH/EQL pools that price trades through are drawn dim + dashed after the sweep and labelled `swept HH:MM CT`; resting levels are drawn faint and unlabelled.
- EQ is snapped to the 0.25 tick. Labels are cut to the levels that matter (entry FVG/OB, swept liquidity, iFVGs, entry/stop/targets, EQ); a plain-English summary box sits under the title.
- Voids: `learn` skips voided trades (snapNotVoided rule) from `TC_VOIDS` or `<out>/voids.jsonl` (`{"row_id": ...}` or `{"day","symbol","side","entry"}`) and from `voided`/`exclude_from_learning` on the sidecar.
- Writes are atomic (tmp + os.replace) and `learn.run` holds an flock on `<out>/.learn.lock`.
- `python -m trade_charts publish [--dest public/trade-charts]` copies charts + whitelisted sidecars + `index.json` for the desk's read-only Charts tab (450 KB/PNG, 20 MB total caps).
