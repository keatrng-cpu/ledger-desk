# SMC / ICT / TJR: entries, targets and management, graded against the desk
Written Tue Oct 13, 2026, ~6:00 PM CT. Due to Trading Stand by 6:30 AM CT Oct 14. Research only: read-only, no code or watcher edits, no orders.

Builds on:
- Morning AMD audit (branch `research/2026-10-14-morning-amd-audit`, SHA 0d287b0). Its gate findings are referenced as [AMD-§n] and not repeated.
- SMC deep dive (`research/2026-10-06-smc-deep-dive`).
- Accuracy Review gate walk (`ledger-desk-notes/reviews/2026-10-13-live-gate-walk.md`), cited as [AR].

Code read at ledger-desk `main` 915e5ead; watcher at `/workspace/desk-watcher`; Trading-Automation at 5787f86.

**Evidence labels:**
- **STRONG**: our data, n ≥ 100, CI excludes 0, or the desk's own 4-year measure.
- **MODERATE**: our data, but in-sample, small n, or CI includes 0.
- **PRACTITIONER**: an educator says it; no data.
- **UNVERIFIED**: a hit-rate claim with no data, or not independently checkable.

---
## 0. Source access (what worked, what didn't)
- **YouTube transcripts: BLOCKED from the box.** `youtube-transcript-api` returned `IpBlocked` (tested 2026-10-13 ~5:05 PM CT). TJR transcripts were read through third-party transcript sites (SozAI, PickScribe) with timestamps. **No ICT first-party YouTube transcript was read**; ICT rules below come from secondary write-ups, the ICT XWiki lecture index, and one ICT thread on threadreaderapp.
- **X/Twitter: login wall.** One ICT thread was readable via threadreaderapp. No TJR X threads were found through mirrors. Nothing on X is quoted beyond that thread.
- Total sources cited: **35 external** (list in §6) plus the academic references carried over from the AMD audit.

---
## 1. Rules extracted from the sources

### 1a. Entries
| # | Rule | Who / source | Status |
|---|---|---|---|
| E1 | **Sweep = wick beyond a marked level and reversal**. The level is a *pre-marked* session/HTF level (session H/L, 1h H/L, 4h H/L, PDH/PDL, EQH/EQL), not any swing | TJR "How to trade" (YouTube 5pF0hhQ7V1I, 2025-07-13, 0:10–0:25); TJR 2026 strategy video via SozAI 16:55–17:27; ICT 2022 model (innercircletrader.net; nqbacktest.online) | PRACTITIONER |
| E2 | A sweep alone is not a signal; require an **MSS/BOS (candle *close* beyond the last opposing swing)** or **iFVG (close through an FVG)** on the 5m, then a 1m BOS back in the trade direction | TJR SozAI 20:30–21:43, 27:20–27:49, 36:36; innercircletrader.net 2022 ("A wick poke … without an MSS first … fails far more often") | PRACTITIONER |
| E3 | Mechanical sweep definition used by a public TJR backtest: wick ≥0.3×ATR beyond the Asia H/L and close back inside; BOS body >0.5×ATR beyond an 8-bar swing within 40 bars | PickMyTrade TJR Asia-sweep backtest blog | PRACTITIONER (a script spec) |
| E4 | **FVG entry at CE (50%)**; the edge is lower-probability; full fill is not required | innercircletrader.net CE; theinnercircletraders.com FVG; nqbacktest 2022 ("Fill at the CE") | PRACTITIONER. "Statistically most reactive" is claimed with no data → **UNVERIFIED** |
| E5 | **OB entry: body, refined to the Mean Threshold (50% of the OB body)** | writofinance; strefatradingu; lsgclub glossaries | PRACTITIONER |
| E6 | **iFVG**: an FVG closed through (body) flips polarity | tradezella; blitz glossary; TJR SozAI 28:53–29:46 | PRACTITIONER |
| E7 | **BPR**: overlap of opposing FVGs; trade only the overlap | strefatradingu; lsgclub | PRACTITIONER |
| E8 | **Breaker**: a failed OB that price *closes* through after a sweep; requires a full-body break | tradezella; lsgclub | PRACTITIONER |
| E9 | Wait for a continuation confluence (FVG/EQ/OB/breaker fill), then a candle pushing out; **"never enter on the IFVG/raid candle itself"** | TJR "How to trade" 0:25–0:45; SozAI 22:05–23:13, 30:53 | PRACTITIONER |
| E10 | **ES/NQ must agree on the 5m trend**; no trade when they diverge. Sweep on one index is enough | TJR SozAI 38:05, 49:11–51:20 | PRACTITIONER |
| E11 | **No pre-market entries**; done by ~10:30 ET if the indices haven't aligned | TJR SozAI 44:30–44:44, 53:28 | PRACTITIONER |
| E12 | Timing: NY AM 08:30–11:00 ET; Silver Bullet 10–11 / 14–15 ET; macros (e.g. 08:50–09:10, 09:50–10:10 ET); **1st presented FVG** = first FVG 09:30–10:00 ET | innercircletrader.net 1st-presented FVG; ICT XWiki 2025-04-09 lecture; TradingView tristanlee85; nqbacktest SB | PRACTITIONER |
| E13 | CPI days: ICT reviewed a "CPI No Trade" NQ day | bestprops ICT 2025 lecture review (May 13) | PRACTITIONER (anecdote) |

### 1b. Targets
| # | Rule | Source | Status |
|---|---|---|---|
| T1 | Targets = **opposing pre-marked liquidity** (session/1h/4h lows/highs, PDH/PDL, EQH/EQL); entries and exits use the same pool list | TJR SozAI 32:10–34:47; ICT 2022 | PRACTITIONER |
| T2 | **IRL first (internal gap / minor high) = T1; ERL (old high, EQL) = T2** | ictkillzone trade management; equiti | PRACTITIONER |
| T3 | **SD projections**: the ICT 2022 model projects −2/−2.5 SD of the *sweep→MSS leg*. Others anchor CBDR/Asia/OR. "Not statistical; anchor choice is discretionary" | nqbacktest 2022; luxalgo; ictprotools; theforexonlineschool (cites ICT lesson 2023-09-12, ~1:21–1:26) | PRACTITIONER, with explicit caveats |
| T4 | Minimum R:R: no fixed ICT rule. Examples: Backtestify fixed **2R**; PickMyTrade TP1 **1.5R** / TP2 **4R**; TJR takes ~1:1 intermediate highs when far targets are slow (SozAI 40:49–41:14) | as listed | PRACTITIONER |

### 1c. Management
| # | Rule | Source | Status |
|---|---|---|---|
| M1 | **Partial at T1 (a liquidity *place*, not an R multiple), then BE on the rest** | ictkillzone breakeven (Sept 2026); ictkillzone trade management; TJR SozAI 46:19–46:31 ("took my first profit … moved my stop loss to break even") | PRACTITIONER |
| M2 | **BE a few ticks in profit**, not at the fill (fees/spread make "BE" a small loss) | ictkillzone breakeven | PRACTITIONER |
| M3 | **Do not move to BE on favourable movement alone.** ICT entries retrace into CE/OB by design | ictkillzone breakeven | PRACTITIONER |
| M4 | Trail only to *structural* prices (a new HL with displacement, an intermediate pool taken); never fixed distance or every minor swing | ictkillzone breakeven | PRACTITIONER |
| M5 | Stop beyond the **sweep wick** plus a buffer (TJR: "almost always"); conservative alternative = far edge of the FVG | TJR Boot Camp Day 38 (PickScribe); innercircletrader 2022; PickMyTrade (+0.5 ATR) | PRACTITIONER |
| M6 | Invalidation: a *close* through the FVG far edge / an opposite MSS on the entry TF; the window closing (killzone end) is a legitimate exit | nqbacktest 2022; ictkillzone breakeven ("four triggers") | PRACTITIONER |
| M7 | Daily limits: script spec **2 trades / 2 losses per day**, flat after the NY AM session. TJR summaries: 0.5–1% risk per trade, 2–3% daily cap, stop after 2 full losses | PickMyTrade; forex.in.rs (secondary) | PRACTITIONER / UNVERIFIED (secondary) |
| M8 | ICT himself partialled 95% early when he had to leave (anecdotal) | threadreaderapp ICT thread 1936114402367074422 | anecdote |

### 1d. Published stats (all mechanical *translations*, none ICT- or TJR-authored)
| Claim | n | Result | Status |
|---|---|---|---|
| TJR self-reported 2026: daily WR **64.29%**, avg R:R **1:2.33**, ~$875k YTD (broker-synced TradeZella shown on screen) | ? | — | **UNVERIFIED** (self-reported; break-evens counted as losses per his own words, SozAI 05:42–06:36) |
| SU thesis (Stockholm Univ., diva2:2064818): TJR rules on NVDA in MT5 | 275 | WR **43.6%**, PF **1.18**, MaxDD 9.4%, Sharpe 4.45; "not that the framework is generally profitable" | moderate (one asset, one period) |
| Silver Bullet NQ (pinescriptforge) Jan 2023–Mar 2026 | 722 | WR 50.6%, PF 2.01 | vendor, rules unpublished → treat as **UNVERIFIED** |
| 25,000 SB variants, 16 yrs NQ/ES (gist.ly summary of a YouTube video) | 10M sims | 1.7% of configs survived; survivors centred ~52% WR; **the "70–80% SB win rate" community claim is contradicted** | secondary summary |
| Backtestify SB (BTC 5m, longs only, 2R) | 125 | WR 28%, PF 0.47 | different asset |
| Secuora SB (BTC/ETH) | 93 | WR 8.5–17% | different asset |

---
## 2. Graded against the desk (file:line at 915e5ead unless noted)
Grades: ✅ does it correctly · ⚠️ does it with a defect · ❌ missing · ⛔ conflict between components.

| Rule | Desk today | Grade |
|---|---|---|
| E1 session-level sweep | `detectors.ts:736-755` fractal swings only, strict `>`, same-bar close. Session pools are only in shadow kz items 1–2 [AMD-§3, AR #7] | ⚠️ |
| E2 MSS/BOS by close | smc-canon `mss`/`displacement` must-haves (`smc-canon.ts:254-256`); displacement body ≥1.5×ATR (`detectors.ts:32`) | ✅ (stricter than TJR's 0.5×ATR BOS) |
| E4 CE entry | Floor rests a limit at CE (`options-desk.ts:819, 2346`); kz entry = FVG midpoint (`kz_trades.json`); `exit-rules.ts:14` assumes CE entry | ✅ |
| "Sponsored" FVG | `mtf-arrays.ts:26 SPONSORED_BODY_ATR = 1.5`, classified at `:74`; fires 29.7% (`aplus/confluence.ts:45`) | ✅ desk-only concept; no external source uses "sponsored" (FVG+) |
| E5 OB mean threshold | OB present in canon; `order_block` fires **0.0%** in TA knowledge (`confluence.ts` componentFirePct; coldComponents). The MT entry is not a desk entry type | ❌ effectively |
| E6 iFVG | `ifvg` fires 100% (hot); PB Theory inversion in canon (`smc-canon.ts:133`) | ✅ (possibly over-firing: 100%) |
| E7 BPR | **0 implementations** (git grep `bpr|balanced price` → only buying-power hits) | ❌ |
| E8 breaker | `breaker` fires 0.0% (`confluence.ts:46`) | ❌ effectively |
| E9 don't enter on the raid | Canon says so (`smc-canon.ts:290`), but the 8:30 CT MNQ short on Oct 13 entered with the raid [AMD-§2] | ⚠️ |
| E10 ES/NQ alignment | `day-context.ts pairAlignment()` size hint only; brain/SMT as blocks. kz SMT filter: n=36, hit 25%, −0.12R (kz_backtest_report) | ⚠️ partial (size, not a gate; consistent with data) |
| E11 no pre-market | Watcher windows 09:30–11:30 / 12:00–15:30 ET (watcher.log start) | ✅ |
| E12 1st presented FVG / macros | earlyBonus shadow (kzblock item 6): n=14, 42.9%, CI 21–67% [AMD-§2]; macros only in `learn/canon.ts:289-290` (teaching text) | ⚠️ shadow |
| T1/T2 liquidity targets | `paper-manager.ts:345-350`: plan T1 from the draw wins outright ✅. **But** `aplus/config.ts:51-60` scaleOut "TP1 (1R)"; `smc-canon.ts:298` "Bank 50% at +1R"; watcher `fastChain firstTargetR 0.85` trims at **0.85R on the underlying regardless of the plan T1** (`gates.py:818-829`, desk-rules `fastChain`) | ⛔ R multiple vs liquidity place |
| T3 SD projections | OR-anchored only (`day-context.ts:105`, `exec-context.ts:275 sdDraws`). The ICT 2022 sweep→MSS-leg anchor is missing | ⚠️ |
| T4 min R:R | `rrMin 1.0` (desk-rules:12, fastChain:277); band ladder rrMin 1.0/1.5/2.0 (desk-rules:52-60); `bplus_caution` RR ≥2 (gates.py:181) [AR] | ⛔ three different minima |
| M1 partial at T1 then BE | paper: 50% at TP1, stop→BE (`paper-manager.ts:1075-1090`); 1 contract = **full close at TP1** (`:1091-1100`). Watcher fastChain: trim 50% at 0.85R; **1 contract = hold + stop→BE** (`gates.py:829`) | ⛔ 1-contract paths disagree |
| M2 BE + ticks | `beBufferR: 0` (`config.ts:57`, exact entry) | ⚠️ |
| M3 no BE on movement alone | the watcher 1-contract branch moves to BE at 0.85R with nothing banked = BE on movement | ⛔ (vs source) |
| M4 structural trail | paper `trail_stop` label (`paper-manager.ts:1055`); no structural trail rule found | ❌/unclear |
| M5 stop beyond the wick | "Stop beyond sweep wick + buffer. Never widen" (`smc-canon.ts:298`); stop rule bufferAtr / MAE percentile (desk-rules:129) | ✅ |
| M6 invalidation by close | **failed-hold** exit: 15m close beyond entry by ½ risk before T1 (`exit-rules.ts:1-40`, measured n=1327, +0.033R, z=2.60). RH routine: "15-minute failed hold", −25% premium, 11:00 ET if under +50%, 15:30 ET (`RH_LIVE_ROUTINE.md:189`) | ✅ (best-evidenced rule the desk has) |
| M6 window close | `management.ts:49 MAX_BARS_IN_TRADE 12` (60 min no-progress, `PROGRESS_R 0.25`); killzone flatten 5 min before the end (`:71`); kz item 12 expiry 20 min (shadow) | ✅ |
| M7 daily limits | `config.ts:44-46 dailyLossLimitPct 0.15`, `maxSetupsPerSession 2`; weekly `lossLock −300` (desk-rules ~270); RH drawdown breaker | ⚠️ 15%/day on $1k ≫ TJR's 2–3% |

---
## 3. What our own data says (read-only; in-sample)
### 3a. Re-simulation of the 127 kz setups on real 1m futures bars
Inputs:
- Script: `/workspace/research/sim/kz_rules_sim.py`; output `kz_rules_sim_out.json`.
- Setups: `kz_trades.json`, 127 NQ/ES setups over **20 days** (2026-09-16 → 10-13).
- Bars: `fidelity-data/{NQ,ES}=F.1m.json`.

Method:
- Same stop, T1 and T2 prices as the backtest.
- Entry limit valid 20 min after the setup minute; hold ≤120 min.
- **Stop is assumed first on any bar touching both stop and target.**
- 95% CIs: Wilson for win rate, normal for mean R.

Caveats:
- 20 days, in-sample; ES and NQ trades on the same day are correlated, so effective n < n.
- Futures R only; there is no options model here. The AMD audit and the Trading Stand audit show the option leg costs ~0.35R.

| Variant | Filled / setups | Win % (95% CI) | avg R (95% CI) | tot R |
|---|---|---|---|---|
| Entry **near edge**, exit T1 | 127/127 | 74% (66–81) | **+0.22 (+0.10, +0.34)** | +27.9 |
| Entry **CE**, exit T1 (current) | 108/127 (85%) | 56% (47–65) | +0.07 (−0.11, +0.24) | +7.3 |
| Entry **far edge**, exit T1 | 101/127 (80%) | 53% (43–62) | +0.13 (−0.08, +0.34) | +13.0 |
| CE, hold **full to T2** | 108 | 32% (24–42) | −0.06 (−0.34, +0.21) | −6.9 |
| CE, 50% at T1, rest to T2, **no BE** | 108 | 35% (27–45) | +0.00 (−0.20, +0.20) | +0.2 |
| CE, 50% at T1 **+ BE** | 108 | 56% (47–65) | +0.05 (−0.14, +0.24) | +5.1 |
| CE, 50% at T1 + BE **+0.1R buffer** | 108 | 56% | +0.05 | +5.2 |
| CE, T1, **time stop 15 min** | 108 | 59% (50–68) | +0.13 (−0.03, +0.28) | +13.8 |
| CE, T1, **time stop 30 min** | 108 | 62% (53–71) | **+0.14 (−0.02, +0.31)** | +15.3 |
| CE, T1, time stop 60 min | 108 | 60% (51–69) | +0.10 (−0.07, +0.27) | +11.3 |
| CE, 50% T1 + BE, time stop 30 min | 108 | 62% | +0.13 (−0.05, +0.32) | +14.4 |

Reading:
- **Near edge beats CE here, but it is not apples to apples.** The T1 price is fixed, so measured from the near edge T1 is a median **0.69R vs 0.85R** from CE: smaller wins, more often. It also fills 100%, including immediate fills. It is the only CI that excludes 0, but it is 20 in-sample days. **MODERATE → SHADOW.**
- **Holding to T2 is the worst** variant. Partial + BE ≈ full exit at T1 (Δ −0.02R). The **BE buffer makes no measurable difference** (Δ +0.001R).
- **A 30-minute time stop adds about +0.075R vs none** (overlapping CIs). This matches the desk's own `kz_backtest_report` `time_stop_30m` and supports the management.ts 60-min no-progress rule (the 30-min version was slightly better here). **MODERATE.**

### 3b. Desk's own pre-existing evidence
- **Failed-hold exit** (`exit-rules.ts`): n=1327, +0.033R/card, z=2.60, consistent in 2022–24 and 2025–26. It sits just under a strict multiple-comparison bar. **STRONG-ish, already LIVE.**
- **Fidelity replay** (`fidelity-runs/report.json`, 19 days, holdout 4): **0 trades fired**. Per gate, every gate *saved* more R than it *missed*:

  | Gate | Winners missed | Losers saved | R missed | R saved |
  |---|---|---|---|---|
  | verdict/phase | 91 | 183 | 69.4 | 153.3 |
  | bplus_caution | 48 | 132 | 39.2 | 108.4 |
  | entry_distance | 50 | 42 | 28.1 | 33.3 (closest to neutral) |

  Zero gates were "sole" deciders. **Caution: loosening gates is not free.** The merged list below keeps protections and fixes only plumbing and conflicts.
- kz report: tap≠none no lift (n=33, 24%); SMT hurts (n=36, −0.12R); sweep depth >0.5 ATR hurts (n=40, −0.09R); earlyBonus n=14 [AMD].
- Live logs (gates.log, cards.log): no fills, so they cannot measure entries or management. They are used only for gate counts [AMD-§2, AR].

---
## 4. Ranked rule changes (Research Desk)
Shared rule: **any scoring, setup or direction change ships to desk, brain, Floor and RH watcher together**, under one pinned rules hash. CPI prints at **7:30 AM CT**: nothing new should arm before the 8:30 CT cash open, and the news blackout must cover 7:15–7:45 CT [AMD-§4].

| Rank | Change | Evidence | Desk file(s) | Tomorrow |
|---|---|---|---|---|
| 1 | **Make the 1-contract exit agree.** Watcher fastChain on 1 contract currently holds and moves the stop to BE at 0.85R (`gates.py:829`). Desk paper closes fully at TP1 (`paper-manager.ts:1091-1100`). Align the watcher to a **full exit at the first target** (sim: full T1 exit ≥ partial+BE; the source says no BE on movement alone). Most $1k trades are 1 contract | MODERATE data + PRACTITIONER + conflict fix | `desk-watcher/watcher/gates.py:818-835`, `fastchain.py` | **LIVE** (exit-side, reduces risk; no scoring change) |
| 2 | **One R:R minimum** across fastChain (1.0), the band ladder (1.0/1.5/2.0) and bplus_caution (2.0) [AR]. Pick the band ladder and drop the others | conflict | `desk-rules.json:12,52-60,277`; `gates.py:181` | **LIVE as reconciliation only if the value is the strictest already live for that band**; otherwise SHADOW |
| 3 | **Daily loss cap** `dailyLossLimitPct 0.15` (config.ts:45) vs weekly lossLock −$300 vs source 2–3%/day. Apply the strictest existing cap on the live path (stop after 2 losses, consistent with `maxSetupsPerSession 2`) | PRACTITIONER + conflict | `aplus/config.ts:44-46`; desk-rules weekly | **LIVE** (tightening only) |
| 4 | Keep the **failed-hold exit** on, and keep the 60-min no-progress stop; test **30 min** | STRONG (failed-hold) / MODERATE (30m) | `exit-rules.ts`, `management.ts:49` | keep LIVE; 30m **SHADOW** |
| 5 | T1 = **liquidity place** (plan T1 from the draw), not 0.85R/1R. Watcher fastChain trims at `firstTargetR` regardless of the plan | PRACTITIONER; sim neutral | desk-rules `fastChain.firstTargetR`; `gates.py:823`; `config.ts:51`; `smc-canon.ts:298` | SHADOW (log both) |
| 6 | Session-level sweep pools with a 1–3 bar close-back, plus a "don't enter with the raid" guard [AMD P1] | PRACTITIONER; the Oct 13 example | `detectors.ts:736`; kzblock 1–2 | SHADOW (all four components) |
| 7 | Entry near edge vs CE: A/B in shadow (log both fills) | MODERATE (+0.22R vs +0.07R, in-sample, unequal R) | `options-desk.ts:819/2346` CE limit | SHADOW |
| 8 | BE buffer a few ticks (`beBufferR` 0 → ~0.05–0.1R) | PRACTITIONER; sim neutral | `config.ts:57` | SHADOW (low value) |
| 9 | SD projections anchored to the sweep→MSS leg (ICT 2022), not only the OR | PRACTITIONER | `day-context.ts:105`, `exec-context.ts:275` | SHADOW |
| 10 | OB Mean Threshold, breaker and BPR detectors: OB and breaker fire 0%, BPR doesn't exist | PRACTITIONER | `confluence.ts` components; new detector | SHADOW / backlog |
| 11 | 1st-presented-FVG (09:30–10:00 ET) and the earlyBonus: hold until n ≥30 | MODERATE (n=14) | kzblock item 6 | SHADOW |
| 12 | Don't adopt the vendor "70–80% Silver Bullet" claims or TJR's 64% as targets | UNVERIFIED | `profit-path.ts PROFIT_TARGET_WR 0.7` | note only |

**LIVE tomorrow (low-risk, conflict/bug fixes only):** #1 (1-contract exit alignment), #3 (strictest existing daily cap), #2 only if it tightens. Keep the failed-hold exit and the 60-min stop live.
**SHADOW:** #4 (30m), #5–#11.

---
## 5. Merged list: Accuracy Review gate walk + Trading Stand + Research Desk (de-duplicated)
Tags: [AR] Accuracy Review, [TS] Trading Stand audit, [RD-AMD] my morning AMD audit, [RD-SMC] this doc.

| # | Item | Sources | Type | Tomorrow |
|---|---|---|---|---|
| 1 | Floor hand path: 0/1333 rows reached `hand`. Non-model holds in `gateHand` (options-desk.ts:2209-2210) become reasons; merge the 4 Floor gates (gates.py:527-539) into `floor_hand` | AR, RD-AMD, TS | FIX/MERGE | Stand's call. **Fidelity says verdict/phase saved 153R vs missed 69R**, so convert to reasons *without* dropping the holds' protective content |
| 2 | Wire band ignores pathBand/skip (desk-listen.ts:268/414) | AR | FIX (accuracy) | LIVE (tightening) |
| 3 | 202 long cards carry put tickets; fix the ticket side at the source | AR, RD-AMD | FIX | LIVE (bug) |
| 4 | One debit envelope ($550 desk vs $650 watcher) | AR, RD-AMD, TS | MERGE | LIVE at the stricter $550 |
| 5 | Pin one rules hash per session (16 parity fails) | TS, AR | PIN | LIVE |
| 6 | 1-contract exit: watcher hold+BE vs paper full close at T1 | RD-SMC #1 | FIX (conflict) | LIVE |
| 7 | Daily loss cap 15% vs lossLock vs 2–3% | RD-SMC #3, TS (cap risk ~25%/trade) | FIX (conflict) | LIVE (strictest) |
| 8 | One R:R minimum (1.0 / ladder / 2.0) + merge disp_vs_rr, rr_sane, t1_rr | AR, RD-SMC #2 | MERGE | LIVE only if tightening |
| 9 | Desk liveQuote asOfMs = quote time (rh-http.ts:111, rh-mcp.ts:247); add latePnlPending to rh-dispatch.ts | AR | FIX | LIVE (safety) |
| 10 | Cut the watcher `q` gate (same input as band) and the duplicate brain checks (:133, :177) | AR, RD-AMD | CUT | Stand's call (fidelity: grok_agree saved 153R vs missed 68R, so the duplicate *check* can go, but keep one brain gate) |
| 11 | bplus_caution RR ≥2 / 0.25×ATR stricter than spec → soft | AR | SOFT | SHADOW (fidelity: it saved 108R vs missed 39R) |
| 12 | 0.5999 clamp: log qRaw and the cap reason (discipline.ts:231) | RD-AMD, AR, TS | FIX (observability) | LIVE (logging only) |
| 13 | Size caps vs ATM premium (B+ $150, A- $250); debit spread fallback (`fastChain.spreadFallback: true`) | RD-AMD, TS | FIX | Stand's call; CPI premiums are higher |
| 14 | Judas: explicit releasedSide gate; session-level sweeps; "don't trade with the raid" guard | AR, RD-AMD, RD-SMC #6 | SETUP | SHADOW (all four) |
| 15 | One Asia definition (smc/day-context.ts:21-25 vs trading/sessions.ts:183) | RD-AMD (AR correction: TA's is `Trading-Automation/aplus/strategy/sessions.py:131`, not in the watcher) | MERGE | SHADOW |
| 16 | Freshness gates merge (gates.py:520/545/547/641) | AR | MERGE | Stand's call |
| 17 | T1 as a liquidity place; near-edge vs CE A/B; 30m time stop; BE buffer; SD-leg anchor; OB-MT/breaker/BPR | RD-SMC #4–#10 | SETUP/MGMT | SHADOW |
| 18 | Time-of-day: block 13:00–15:00 ET; fast-only (T1 ≤30 min) | TS | FILTER | fastChain is already live from 10-14 per desk-rules |
| 19 | CPI 7:30 CT: confirm the ±15 min blackout is enforced (desk newsGate item 21 is shadow; watcher `news` live) | RD-AMD | SAFETY | LIVE check before 7:15 CT |

**Corrections from AR to my AMD audit:**
- "151 wrong-side short stops" was **not reproduced** by AR over cards.log (they found 0). My count came from gates.log `stop_width` message text ("wire.strategy.stop … wrong side for a short", 151 rows). Both readings stand: the desk *wire* sent wrong-side stops in 151 gates.log rows, and AR's own `resolve_stop` resolves them. **Treat it as a wire-labelling issue, not a stop-math bug.**
- The Asia path correction above is accepted.

---
## 6. Sources (35 external; accessed 2026-10-13 CT unless a date is shown)
1. innercircletrader.net, Complete ICT Trading Strategy 2022: https://innercircletrader.net/tutorials/complete-ict-trading-strategy-2022/
2. innercircletrader.net, ICT Consequent Encroachment: https://innercircletrader.net/tutorials/ict-consequent-encroachment/
3. nqbacktest.online, ICT 2022 Mentorship Model: https://nqbacktest.online/learn/ict-2022-mentorship-model
4. icttraders.net, ICT 2022 Model step by step: https://icttraders.net/ict-2022-model-complete-trading-strategy-explained-step-by-step/
5. theinnercircletraders.com, FVG trading: https://www.theinnercircletraders.com/fvg-trading-ict/
6. TJR, "How to trade" (YouTube, published 2025-07-13), transcript via search index: https://www.youtube.com/watch?v=5pF0hhQ7V1I
7. Stockholm University thesis, "Liquidity-Based Intraday Trading: An Experimental Evaluation" (TJR rules, NVDA): https://su.diva-portal.org/smash/get/diva2:2064818/FULLTEXT01.pdf
8. PickScribe, TJR Boot Camp Day 38: Stop Losses: https://pickscribe.com/v/1FunNCUw_jM
9. PickScribe, TJR Boot Camp Day 8: Liquidity Pt 1: https://pickscribe.com/v/Lxnu7InGhGE
10. PickMyTrade, TJR Asia Sweep Backtest on NQ: https://blog.pickmytrade.trade/tjr-trading-strategy-asia-sweep-backtest/
11. PineScriptForge, NQ ICT Silver Bullet backtest: https://pinescriptforge.com/nq/ict-silver-bullet/backtest
12. gist.ly, "I Backtested 25,000 ICT Silver Bullet Trades": https://gist.ly/youtube-summarizer/i-backtested-25000-ict-silver-bullet-trades
13. Backtestify, ICT Silver Bullet: https://backtestify.com/strategies/ict-silver-bullet
14. Secuora, ICT Silver Bullet 12 months: https://secuora.net/strategy/ict-silver-bullet
15. nqbacktest.online, Silver Bullet explained: https://nqbacktest.online/blog/ict-silver-bullet-explained
16. Strefa Tradingu, ICT glossary: https://strefatradingu.pl/en/blog/ict-glossary/
17. WritoFinance, CE & Mean Threshold: https://www.writofinance.com/consequent-encroachment-and-mean-threshold/
18. LSG Club, ICT A–Z: https://lsgclub.trade/blog/ict-concepts-complete-reference
19. TradeZella, Key ICT Concepts: https://www.tradezella.com/learning-items/key-ict-concepts
20. BlitzPulse, ICT glossary: https://docs.blitzglobalcapital.com/concepts/ict-glossary
21. The Forex Online School, SD projections (cites the ICT 2023-09-12 lesson ~1:21–1:26): https://theforexonlineschool.com/ict-standard-deviation-projections-explained/
22. LuxAlgo, SD projections: https://www.luxalgo.com/library/concept/standard-deviation-projections/
23. ICTProTools, Standard Deviation theory: https://ictprotools.com/guides/standard-deviation-theory/
24. ictkillzone, ICT Trade Management: https://www.ictkillzone.com/ict-trade-management
25. Equiti, Internal vs external structure: https://www.equiti.com/sc-en/news/trading-ideas/internal-vs-external-structure-ict/
26. innercircletrader.net, 1st Presented FVG: https://innercircletrader.net/tutorials/master-ict-1st-presented-fvg/
27. ICT XWiki, 2025 Lecture "How To Disqualify 1st Presented FVGs" (2025-04-09): https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2025/ICT-YT-2025-04-09-2025-Lecture-Series-How-To-Disqualify-1st-Presented-FVGs-04-08-2025/
28. TradingView, ICT ORG + 1st Presented FVG (tristanlee85): https://www.tradingview.com/script/bts7EGX8-ICT-Opening-Range-Gap-1st-Presented-FVG-tristanlee85/
29. BestProps, ICT 2025 NQ review "CPI No Trade" (May 13): https://bestprops.com/ict/2025-lecture-series/ict-2025-nq-review-cpi-no-trade-may-13/
30. Thread Reader, @I_Am_The_ICT thread: https://threadreaderapp.com/thread/1936114402367074422.html
31. ictkillzone, Moving to Breakeven (published Sept 2026): https://www.ictkillzone.com/ict-breakeven-stop
32. ictkillzone, ICT Risk Management: https://www.ictkillzone.com/ict-risk-management
33. SozAI, TJR "My UPDATED Day Trading Strategy (2026)" transcript with timestamps: https://sozai.app/transcript/updated-day-trading-strategy-2026/
34. forex.in.rs, TJR trader strategy (secondary summary): https://www.forex.in.rs/tjr-trader-strategy/
35. forex.in.rs, Words of Rizdom / TJR (secondary): https://www.forex.in.rs/rizdom-trader-strategy-3/

Academic references (Osler 2003/2005; Wood, McInish & Ord 1985; Andersen & Bollerslev 1997; Andersen, Bollerslev, Diebold & Vega 2003/2007; Holmberg et al. 2013) are carried from the AMD audit.

## 7. Open questions
1. Should the 1-contract exit be a full exit at T1 (paper-manager) or hold + BE (watcher)? This doc recommends full exit. Trading Stand must pick one for desk and watcher.
2. Which daily cap is authoritative on the live path: 15% (config.ts), weekly −$300 lossLock, or the RH breaker?
3. Will Stand accept that gates *saved* more R than they cost in the fidelity replay (19 days) before loosening any protective gate?
4. Can someone with a non-blocked IP pull ICT first-party transcripts (2022 mentorship ep. on the model, macros) to replace the secondary sources?
5. The near-edge entry result (+0.22R) uses a fixed T1 price. Should the shadow A/B use T1 re-normalized to the same R?
6. Is `ifvg` firing 100% in the TA knowledge snapshot a detector over-trigger?
