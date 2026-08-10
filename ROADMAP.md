# ROADMAP — closing the gap between the desk and actual profitability

Audit date: 2026-08-10 · basis: commit `6dab236` · full source review of `src/lib/trading`,
`src/lib/aplus`, `src/lib/market`, desk components, and the ported Trading-Automation artifacts.

## The core finding

The desk is a **mirror with no memory**. It displays rules, bias, and setups, but nothing it
shows is measured, enforced, or fed back. Profitability = edge × discipline × sample size —
the desk currently produces evidence for none of the three.

## Dead spots (verified in code)

| # | Dead spot | Where | Why it matters |
|---|-----------|-------|----------------|
| D1 | **Lab backtest is 100% fabricated.** 12 hand-written trades, fake histogram, fake journal, fake news verdict | `src/lib/aplus/sample-run.ts` → `aplus-ops.tsx` | The "deep aplus backtest" section has zero connection to real Trading-Automation output. Real `data.json` is never ingested. |
| D2 | **Two disagreating confluence scales share one number line.** Desk scanner: 7 crude components, base score 0.22. Engine: 19 components (ifvg, OB, breaker, mechanical_model, CISD, displacement…) | `scanner.ts` vs `confluence.ts` | Engine knowledge: 843 candidates, best **0.6353**, cleared **0** at floor 0.75. Desk scanner mints "A+ ≥ 0.75" routinely from a different, easier scale. The desk systematically overstates edge. |
| D3 | **No trade capture → no feedback loop.** `analytics.ts` can compute expectancy/PF/DD but nothing feeds it real trades | db + migrations exist (`0001_auth.sql` only) | The 0.50-TEST vs 0.67-calibration floor question is unanswerable forever without logged outcomes. |
| D4 | **Risk governor displays but never governs.** Daily 2%/weekly 5% halts, 2/KZ cap — untracked. Checklist "risk armed" hardcoded `ok: true`. Equity hardcoded $10k | `build-desk.ts:146-150`, `config.ts:32` | Discipline is the one thing a dashboard *can* enforce, and it doesn't. |
| D5 | **Engine's highest-signal components missing from live structure**: no FVG/iFVG (100% fire, "hot"), no order blocks, no mechanical model sweep→displace→invert→retest (highest weight 0.14), no weekly PD (PWH/PWL), no NY open / opening bias, no displacement/CISD | `structure.ts` detects only swings, BOS, dealing range, EQH/EQL, PDH/PDL | The desk cannot even represent the setups the engine trades. |
| D6 | **SMT is a %-change proxy, not real SMT** (swing divergence at liquidity). `pearsonCorr`/`alignedReturnPairs` exist in `yahoo.ts` but scanner ignores them | `structure.ts:329` `smtRead` | SMT is a core model component; the proxy fires on noise. |
| D7 | **Data quality never gates "actionable".** `lagSec` computed but not surfaced; synthetic fallback flows silently into bias/scanner; `source` carried but unchecked | `yahoo.ts:170`, `build-desk.ts:47-65` | A Yahoo outage produces confident-looking setups from fake bars. Yahoo lags ~10m intraday. |
| D8 | **PDH/PDL grouped by UTC calendar date**, not 18:00 ET futures session rollover | `structure.ts:199` `priorDayHl` | PDH/PDL is an entry/invalidation anchor — mislabeled near boundaries and DST. |
| D9 | **No news/econ calendar.** Engine has news blackout (demo shows 12 news skips); live desk has nothing | absent | CPI/FOMC/NFP at 8:30/14:00 ET land inside the killzones the desk marks "trade window open". |
| D10 | Dead weight: revenue-analytics remnants (`sample-revenue.ts`, `ai/analyze.ts`, kpi/trend/breakdown/ai-insights components) unmounted; `peer` param dead in scanner; prod build broken (`grok-pwa.ts` imports missing `install-page.html`) | various | Noise for every AI session working the repo; broken Vercel build. |

## Hard truth the desk hides

The confluence knowledge snapshot says the calibrated engine **never fired**: 843 scored
candidates over a month of NQ, best 0.6353 against floor 0.75, cleared 0. The floor was cut to
0.50 as a TEST — but nothing measures what 0.50 admits. Every phase below serves one goal:
**replace that unknown with logged evidence.**

## Plan

### Phase 0 — Truth & safety (hours)
- [ ] Fix prod build: restore `scripts/install-page.html` or strip `server/middleware/grok-pwa.ts`.
- [ ] HUD data-quality chip: show `lagSec`; hard red banner when either feed is `synthetic`.
- [ ] Gate `actionable`: require `source === "yahoo"` and lag under threshold (e.g. 120s for 15m context).
- [ ] Rename desk scanner score to **"desk pre-score"** in UI; reserve "A+/0.75" language for engine-scored numbers only (kills D2's lie at the display layer).
- [ ] Delete revenue dead code; remove dead `peer` param.

### Phase 1 — Journal + active risk governor (the profit driver; 1–2 days)
- [ ] `migrations/0002_journal.sql`: `trades` (ClosedTrade shape + confluence + components present/missing) and `events` (CANDIDATE/SKIP/ENTRY/EXIT/HALT — same vocabulary as the engine journal).
- [ ] "Log this setup" button on each scanner card → pre-filled entry form (symbol, side, entry zone, invalidation, targets, pre-score). Exit form computes R and net PnL from `CONTRACTS` (point value, commission).
- [ ] Metrics panel: `computeMetrics()` over real journal rows — expectancy R, PF, win rate, DD, with the `< 100 trades = statistically weak` badge front and center.
- [ ] Risk governor goes live: realized day/week PnL from journal → halt banner at −2%/−5%; count entries per killzone → suppress `actionable` after 2; checklist "risk armed" becomes real (halts not hit && caps not hit). Equity becomes an editable setting.

### Phase 2 — One confluence language (2–4 days)
- [ ] **Ingest real engine output**: upload/sync endpoint for Trading-Automation `data.json` + `knowledge/confluence.json` → Lab renders real backtests, deletes `sample-run.ts` fakes. Engine stays source of truth.
- [ ] Port highest-signal detectors to `structure.ts`, in order: **FVG/iFVG → displacement → mechanical-model sequence** (sweep→displace→invert→retest) → order blocks. Add to scanner with engine-aligned weights.
- [ ] **Replay calibration harness**: nightly/on-demand replay of last N sessions of 15m bars through the TS scanner; for each candidate record whether entry zone tagged and whether invalidation or 1R/2R hit first. Bucket outcomes by pre-score → answers the 0.50 vs 0.67 floor question with data. (This is the seed of the standalone automation project — same code path scores live and replayed bars.)

### Phase 3 — Signal quality (2–3 days)
- [ ] Real SMT: timestamp-aligned swing divergence (one index makes the high, the other fails, at a pool) via `alignedReturnPairs`; demote %-change spread to a secondary note.
- [ ] Session-correct levels: 18:00 ET rollover for PDH/PDL; add PWH/PWL, midnight open, NY 8:30 open (the engine's reference-level set).
- [ ] Econ calendar: even a manually maintained `news.json` of red-folder events (CPI/FOMC/NFP/PPI) → verdict chip + blackout gating, mirroring the engine's skip reason.
- [ ] Data upgrade path: Databento via profxtrader for true real-time; Yahoo stays fallback. (Cost: Databento live CME micros ~$/GB — price before committing.)

### Phase 4 — Automation bridge (the separate project)
- [ ] Engine → desk: Trading-Automation posts journal events + payloads to a desk endpoint; desk becomes the monitoring UI over the *real* engine instead of a parallel reimplementation.
- [ ] **Paper-trade loop first**: engine paper-executes candidates that clear the floor; fills auto-populate the journal → builds the 100+ trade sample fast, risk-free. Only after expectancy is positive over ≥100 paper trades does live execution (mode + credentials + risk ack) unlock.

## Sequencing rule

Phase 1 before everything else that isn't Phase 0. A journal with an enforced risk governor
compounds the value of every later phase; nothing else does.
