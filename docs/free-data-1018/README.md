# Free data feeds (10-18): order flow, FF calendar, VIX term structure, ZN/6E

Everything here is **shadow / log-only**. Nothing changes `shared/desk-rules.json` (RULES_HASH stays `9eeed9b4083700cb`),
the score, any gate, the fire path, order review or the news gate. Config lives in `shared/free-data.json` (`mode: shadow`,
`live: false`), outside the rules hash. No new spend. TopstepX, Trading Economics, FMP, older Databento years and GEX are not used.

## Is Databento live free on this plan?
- **No Databento API returns the plan or the live entitlement.** I probed `metadata.get_cost` with `mode=live`. The parameter is
  deprecated and the server ignores it: it returns the same number as historical, $0.5137 for the 2024-10-16 control in both modes.
  `list_unit_prices` returns list prices only.
- **The cost pattern matches the CME Standard plan.** `get_cost` is $0 for ES/NQ trades, TBBO and MBP-1 over the last 12 months,
  but $0.51 for 2024 trades. That fits Standard exactly: 12 months of L1 included, older L1 billed. Usage-based billing would charge
  for 2026 too. Plus would make 2024 free.
- **Standard includes live CME with no per-message billing.** The fee is flat, license fees are included, and personal use is
  limited to 2 devices. Usage-based CME live was discontinued on 2025-04-16 (Databento blog, pricing page).
  `gateway/README.md` records the portal check on 2026-09-14.
- **The key already streams live right now.** The VPS `ledger-gateway` writes `live_market_ticks` with an age of 1–2 s and
  `live_market_bars_1m` about 1 s after each minute closes (`source = databento_live`).
- **Caveats.** Standard allows 10 live sessions per dataset. The personal-use licence covers 2 devices. The VPS gateway is one
  device, so a second always-on streamer should run on the same VPS or the desk PC, not a third machine.

## Blocker: the box cannot open a Databento Live socket
The Live API is raw TCP on port 13000 (`glbx-mdp3.lsg.databento.com`). The box only allows egress on port 443, so connecting
times out (`live_trades.preflight()` reports this). `feeds/free_data/live_trades.py` is ready to run on a host that can reach
port 13000. Until then:
- **Live 1m OHLCV on the box:** the gateway's `live_market_bars_1m`, read over Supabase REST. This is the same Databento Live
  session, about 1–2 s after the close, at $0 extra.
- **Aggressor delta and CVD on the box:** historical trades, cost-checked at $0. They lag about 7–10 min (the historical
  publish delay).

## What's here
| path | what |
|---|---|
| `feeds/free_data/bars.py` | Builds 30s and 1m bars from trades, with delta from the aggressor side (`B` +, `A` −, `N` 0) and session CVD that resets at 18:00 ET. It emits closed bars only. Bars bucket on `ts_recv`, which matches Databento ohlcv-1m exactly: 180 of 180 ES/NQ bars on 10/16 08:30–10:00 CT. Bucketing on `ts_event` gave 6 mismatches. |
| `feeds/free_data/dbguard.py` | The only historical pull path. It allows GLBX.MDP3 only, enforces a schema allow-list, and limits L1 to the last 360 days. It runs `get_cost` with the identical arguments before every pull and aborts unless the cost is exactly 0. Results are cached under `/workspace/data/databento/`, and each cost is logged to `cost_log.jsonl`. |
| `feeds/free_data/live_trades.py` | Live trades → bars runner (port 13000 hosts), with a replay mode for DBN files. |
| `feeds/free_data/ff_calendar.py` | FF weekly JSON: cached, at most one fetch per 15 min, backs off on 429 (Retry-After, else 30 min), and falls back to the cache on error. Times are normalized to CT. Scope is USD High/Medium. Shows forecast, previous and actual, plus the surprise sign. Also adds the shadow 07:30 CT print-window flag (−5/+15 min). |
| `feeds/free_data/vix.py` | Cboe VIX / VIX9D / VIX3M CSVs → VIX9D/VIX and VIX/VIX3M ratios, a regime label, and a front-end inversion flag. Closed days only: today's row is used only after 15:30 CT. |
| `feeds/free_data/xasset.py` | ZN / 6E: closed 1m bars, 30 and 60 min % change. |
| `feeds/free_data/snapshot.py` | Writes `free-features.json` for the watcher shadow row. |
| `src/lib/free-data/features.ts` | TS twin for the desk: `card.freeData` → wire `freeData`, a Brain (master seat) narrative line, and a Floor `freeDataShadow` line. It caches per instance, never throws, waits ≤ 1.2 s on a cold start, and turns off with `DESK_FREE_DATA=0`. |
| `docs/free-data-1018/watcher-free-data.patch` | Adds `watcher/free_data.py` plus a daemon hook. It writes one `free_data_shadow.jsonl` row per minute (desk freeData plus local order flow and xasset). It does no broker or gate work. |

**FF limitation.** The free FF feed has no `actual` field (checked JSON and XML on 2026-10-18), so the surprise sign stays `null`
unless an actual shows up. FF rates the 10/20 07:30 CT Housing Starts (forecast 1.30M, previous 1.28M) as **Low**. It is outside
the USD High/Medium scope, but the 07:30 CT print-window flag still fires for it.

## Deploy (desk and watcher together; not applied)
Apply the watcher patch in a flat window after a STOP, in the same window the desk deploys:
```
cd /workspace/desk-watcher && patch -p1 --dry-run < <repo>/docs/free-data-1018/watcher-free-data.patch && patch -p1 < ...
.venv/bin/python -m pytest -q -o testpaths=tests
```
The patch applies cleanly to watcher master `33090af` (the live watcher today) and to #52's watcher head `3ace8d5`. It needs no
new pip packages.

## Rebase after #52
#52 touches `build-desk.ts` and `desk-listen.ts`. This PR adds one import and two to three lines in each, next to `rule1`. A trial
merge of #52 into this branch is reported in the PR body. The RULES_HASH test here does not pin a value, so the hash change in
#52 needs no edit here.

## Tests
- `python3 -m pytest -q feeds/free_data/tests`: bar builder (OHLCV, delta/CVD sign, the 30s boundary, no lookahead via prefix
  invariance, clock grace, late trades, session reset), FF parser, surprise sign, print window, 15-min cache and 429 back-off,
  VIX ratios and closed-day rule, the cost guard (non-zero aborts before download, cache, 12-month refusal), and live router.
- `node --test scripts/free-data.test.mjs`: the TS twin, plus the Brain verdict and checks staying unchanged when freeData is added.
- Watcher: `tests/test_free_data_shadow.py` (in the patch).
