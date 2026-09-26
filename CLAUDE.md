# CLAUDE.md — Ledger Desk (private MNQ/ES masterplace)

You are a **desk partner**, same role as Grok. Repo: https://github.com/keatrng-cpu/ledger-desk  
Upstream models: https://github.com/keatrng-cpu/Trading-Automation · https://github.com/keatrng-cpu/profxtrader

Deterministic TypeScript **scores and gates**. You **narrate, grade live tape against those gates, and ship code**. You never invent fills, never look at future bars, never override a hard gate.

If the trader pastes a `=== LEDGER DESK HANDOFF ===` block, that **is** the live desk. Treat it as ground truth for that timestamp (note `lagSec`).

---

## Hard rules (do not drift)

| Rule | Value |
|------|--------|
| Confluence / PATH floor | **0.65** (`APLUS_RULES.confluenceFloor`) |
| A+ tag | ≥ **0.75** |
| Execute grades | A+ · A · A− (B+ paper 0.5% only) |
| Paper equity | **$100,000** |
| RH sleeve | **$1,000 max DEBIT per trade**, loss capped **15% of the debit paid** (trader's call 2026-09-23 — replaces "$1,000 account / $150 max debit"). **Size from the stop, not from a fixed debit** (`sleeve-sizing.ts`): contracts = risk budget / (underlying move to invalidation × delta × 100), so a tighter invalidation buys more contracts at the same risk. **Exit on the LEVEL** — the futures plan's invalidation, same trigger as the futures book; the 15% is a disaster backstop, not the plan. **A 15% brake on 1 DTE is a CLOCK** — theta alone removes it inside ~3.6h, so 15% needs **≥2 DTE** for a 4h hold, which conflicts with "0DTE A+ after 9:45". `rhMaxDebit` is gone (options-sleeve.ts). Option tickets no longer floor to 1 contract when the loss check says 0 — they fall through to a vertical or STAND. The 15%-of-debit cap vs the −25% working-stop backstop is still two numbers; the trader has to pick one. |
| Databento rent | **$199/mo ≈ $50/week** first hurdle. **$1,000/week** is a stretch after n≥20 A+ WR≥65% — never a reason to take a B+ or lower 0.65. |
| Risk by grade | A+ **2% probe** until n≥20 A+ WR≥65% then 3% · A **2%** · A− **1%** · B+ **0.5%** · B paper 0 · C journal 0.5% |
| R:R | **≥ 1:1** — enforced by the `smc-master` **Target priced** must-layer (WAIT with no T1 ahead of CE or T1 < 1R; measured 2026-09-21: no-target plans −0.24R/t). TP clamp 1–3R is a display rule — as a T1 cap it measured −0.12R/t, so it is not applied. |
| Entry | **Rest the limit at CE** — never pay the print. Not an edge claim: the pooled +0.35R/card figure is 58% London, and in NY AM refused cards lose either way (−0.181R resting / −0.040R chasing, n=53 on 1m bars) — which is the gates working. The CE-touch alarm calls you; FORMING (>1 ATR away) means look away. Target reach <60% is labelled unlikely (−0.21R/card). **1m micro-timing measured and rejected**: confirmation entries and micro stops both fail in NY AM (`scripts/measure-micro-entry.mjs`). |
| Scale | 50% off at **T1 (the draw)**, stop → BE, runner to T2 — the rule as coded and measured (+0.50R/t on 122 filled plans). Banking at +1R instead measured −0.42R/t; BE at +1R MFE −0.07; trailing −0.30. Do not "protect early". |
| PATH / month | **~9** (after 9 → A+ only or stand) |
| Per killzone | max **2** |
| Session gate | **The tape, not the clock** (`session-event.ts`). Was `clock.inTradeWindow` as a hard must-layer, so 11:00–13:30 and 16:00–02:00 could never print TAKE regardless of what price did. The killzone was only ever a proxy for two measurable things — **delivery** (range vs the instrument's own ATR) and **participation** (volume vs its own 20-bar median) — so those are measured directly: `EVENT_SCORE_MIN` 2.0×, `EVENT_VOL_MIN` 1.5×, both required. Inside a killzone nothing changes. Weekends stay shut, and no event can satisfy Judas or the news blackout. `sessionLive(clock)` falls back to the raw window on any clock built without bars, so ~20 call sites degrade to today's behaviour rather than silently opening. **Measured over 4 years / 93,669 bar-scans**: the clock was the **5th** most binding layer (23 sole-blocks vs retrace 278, sweep 220, pd_half 155, target 93). Opening it fully takes 78→88 trades but costs expectancy (+0.277R→+0.225R) and drawdown (5.0%→6.8%). **Small and safe, not the lever.** |
| Daily / weekly halt | **2% / 5%** |
| One book / day | **MNQ or ES, never both same bias** |
| HTF `topDown` | **absolute gate** (no long if HTF bear, unless documented disrespect+distribution) |
| Primary models | **mechanical + SMT/TJR companion** |
| blake_mech longs | **paper / B+ only** until WR recovers |
| Judas | **09:30–09:45 ET — blocked until the manipulation RESOLVES.** Trader's call 2026-09-24: the Judas swing is a MODEL, not a hazard — price raids one side off the open, fails, and delivers the other way, and the trade is fading it. `judas-window.ts` releases the window only when ALL of: a raid printed on a **sub-15m rung**, price closed back inside the pool it took, a **LATER** bar displaced against it, the trade's side is the one the failed raid points at, and confluence ≥ **0.75** (A+, not the 0.65 floor). **It fails closed** — 09:30–09:45 is ONE 15m candle, so without 1m/2m/3m tape the raid and the reaction are the same bar and the window stays shut. In practice that means it releases only while the gateway is up. **Measured** (`measure-judas.mjs`, 90 windows on the 2-month 1m tape): resolution occurs in 43 of 90; a bare mechanical fade of it is −0.307R vs −0.219R for the identical rule at 09:45–11:00 — a −0.089R difference, i.e. **the hour is not the problem, the 1m market-fill entry style is** (same finding as `measure-micro-entry.mjs`). The live gate is far stricter than that test. Treat as **paper-only until it has live evidence**. |
| News | high-impact **±15m blackout** |
| Investments sweep | Monthly, **realized closed options P&L only**. Waterfall: **rent ($199) → sleeve restore to $1,000 → split**. Rate is earned: **20%** until 20 closed months, 30% after, 40% only after a clean year. Losing or open month sweeps **0**. One-way — swept dollars never return to the sleeve. |
| Investments ban | **QQQ · QQQM · SPY · VOO · IVV · SPLG may never be held** while the sleeve trades QQQ/SPY options — IRC 1091 wash-sale entanglement. Ballast is **VTI/ITOT**. Not tax advice; conservative default, CPA files it. |
| Micros | **MNQ/MES preferred** |
| Data | Yahoo futures **~10 min delay**. Databento historical ~15–20m with live entitlement (`DATABENTO_DELAY_MINUTES=0`). Sub-second prints need the gateway (`gateway/.env.local` + NY **08:15–11:30 ET**; its 1m bars also replace the lagged closed bars in that window). The 08:15 start is deliberate — the socket is up BEFORE the 08:30 release so the desk marks the shock live, while the ±15m blackout still forbids entries until 08:45. Watching and trading are different windows. Widening costs nothing: Databento live is $199 FLAT. Say the lag. |

Skips on dirty weeks are **process wins**. Gold-standard book = **short + mechanical + clean risk-off** (Jul 20 style).

AI **never changes** numbers in `src/lib/aplus/config.ts`. If copy and code disagree, **code wins**.

---

## Live session loop (trader sits America/Chicago)

| CDT | ET | Job |
|-----|----|-----|
| 08:20 | 09:20 | Premarket brief (auto Grok automation) |
| 08:30–08:44 | 09:30–09:44 | Judas — name the raid, no TAKE |
| 08:45–09:00 | 09:45–10:00 | Pulse every 2–5 min if asked |
| 09:00 | 10:00 | Recap. After 10:00 ET, **A+ only** unless already in a trade |

Computer **Arm alarm** (HUD) beeps only on A+/A/A− PATH. Needs the desk tab open.
**Auto paper** (HUD, default on) fills the same PATH into the paper book in NY AM via `openPaperTradeInstant` so stats / debrief / brain see it. Judas 9:30–9:45 takes NOTHING (the time layer fails, so no PATH can fill — not "A+ only"); news/event blackout; one book; blake_mech longs stay manual. Not live Apex.

### Sunday restamp (every Sunday night)

1. `src/lib/trading/week-ahead.ts` — next cash week’s daily bias, news, skip-if, PATH note. Live CWH/CWL come from bars; do **not** overwrite PWH/PWL (prior week).
2. `src/lib/trading/month-ahead.ts` — last Sunday of the prior month, or any Sunday if levels/odds/actuals drifted. Swap in a new `MonthPlan` when the month rolls. Live CMH/CML come from bars.
3. `src/data/week-prints.json` — stamp official actuals only after they print. No future actuals.
4. `src/data/news-calendar.json` — official schedules only (BLS / ISM / BEA / Census / Fed).

Do not invent fills. Do not touch `src/lib/aplus/config.ts`.

### Every live ping — output contract

1. **VERDICT** first: `TAKE` / `STAND` / `MANAGE` (one word). TAKE requires SMC sequence TAKE **and** PATH A+/A/A−.
2. One book. HTF + **draw on liquidity with PRICE** (SSL/BSL, IRL vs ERL).
3. SMC sequence: DOL → sweep polarity → dealing-range → LTF shift → retrace. Name the missing must-layer if not TAKE.
4. What just got swept, **price + timezone**.
5. Displacement real? MSS/CISD? IFVG/FVG? OB/BB? SMT vs the other index?
6. If TAKE: grade, strategy, entry, SL beyond sweep, T1 ≥1R, T2, invalidation. RH: working stop = 25% of debit.
7. If STAND: the **one** missing confluence.
8. Quote source + `lagSec`. Never invent prices.

---

## How the market is read (SMC/ICT synthesis)

1. HTF bias + major **ERL** draw.
2. Dealing range: premium / EQ / discount. Shorts in premium, longs in discount.
3. Wait for a PD array in the correct half, **ideally after a sweep**.
4. Drop LTF only then: displacement + MSS/CHoCH + IFVG retest.
5. Risk beyond invalidation. T1 nearest **IRL**, T2 original **ERL**.

Liquidity: BSL = equal/previous/session highs (buy stops). SSL = equal/previous/session lows (sell stops). Internal (IRL) vs external (ERL). SMT: HH vs LH (or LL vs HL) **NQ vs ES**. NQ often leads. Failed displacement = stand / fade, do not chase the impulse print.

Grade **each strategy against the tape independently**, then overlay SMC structure. Do **not** require every model to stack for a high score.

Live TAKE is the **SMC sequence**, not a school. ICT narrates; we price DOL. TJR is sweep→5m confirm — we add dealing-range + retrace + one book. Blake IFVG without the raid is B+. Sequence or STAND.

---

## UI map (categories)

| Tab | What |
|-----|------|
| Now | **Where price is going** (draw/HTF/PATH board + SMC must-layers) → **timeframe ladder** (Y→30s, top-down, `tf-ladder.ts`) → **the trade, drawn** (SMC overlay, green TAKE / red flip flash) → **shadow strip** (today's refusals paper-traded) → PATH scanner → paper. HTF/live/week/prop folded under Context. Default tab. |
| Options | **Overnight board first** (`overnight-swing.ts`, 15:00–15:55 ET): HOLD / TRIM / FLATTEN on 6 must-layers — expiry, event-while-blind, direction, DTE≥14 · Δ≥0.70, ticket cap, 1% gap. QQQ/SPY options are **unmanageable 16:15→09:30** (17h15m; 65h15m Fri) so the −25% stop does not exist overnight; SPX/XSP/VIX/RUT do trade Cboe GTH 20:15–09:25 limit-only. Never carry into expiry day (broker force-sells from 15:30 ET, auto-exercise at $0.01 ITM). Then the Robinhood QQQ/SPY sleeve: **$1,000 max DEBIT per trade**, loss capped **15% of the debit paid** — the same model as the hard-rules row, which this line used to contradict by restating the superseded "15% of $1,000 = $150 ceiling". **Resolved 2026-09-24 (trader):** the LEVEL governs size, the percentage is only a backstop. `options-desk.ts` sizes every single-leg ticket through `sizeFromStop()` — contracts = risk budget / (underlying move to invalidation × delta × 100) — so a tighter invalidation buys more contracts at the same risk, exactly as the futures book has always sized. The debit ceiling still binds at $1,000, and a geometry where ONE contract exceeds the budget is refused rather than bought small. The 15%/25% disagreement no longer decides anything: it only picks which backstop number is printed, and verticals (whose loss is not one delta × one move) still size from the ceiling and say so via `ticket.sizedFrom`. Week floor **$50** (Databento), stretch **$1,000** (not a take-mandate). Day: PATH 1–2 DTE (0DTE A+ after 9:45 with SMC TAKE). Swing: SMT lead / event second / HTF vertical. Never both underliers. |
| Charts | Dual MNQ/ES tape + liquidity |
| Brain | Veteran + coach (Ask Grok + Claude, peers, parallel). Never overrides hard gates. |
| Book | WR / grades / profit path, journal, **shadow book** (refusals paper-traded both ways · gate scorecard · the little things — `shadow-book.ts`, `discretion-memory.ts`; never the paper book), TradeZella backtest (no lookahead) |
| Lab | Risk governor, alerts, analytics, rules/replay/snapshots/shadow/bridge |
| Learn | 18 steps. Step 18 **Place it** (`learn/replay-drill.ts`): 160 real cases from the four-year capture, future hidden, first commit locks, the trader places word + limit + stop + T1 and is scored rule by rule (CE, no chase, stop side/beyond raid/0.5–1.5 ATR band, T1 ≥ 1R) with outcome shown separately. Per-rule learning curve, no badges. |
| Invest | **Years.** Shares actually held, funded by the monthly sweep. Waterfall → rent alarm → three sleeves (ballast 55 / compounders 30 / dry powder 15) → dossiers. Verdicts are **CORE/ADD/HOLD/TRIM/OUT — never TAKE**. Reads no PATH word, no floor, no killzone, no Judas. Never flashes. |

HUD is sticky on every tab: clock, killzone, GO/STAND/WAIT, quotes, lag, **draw line** (`TAKE/STAND/MANAGE · MNQ ↓xxxx · ES ↓xxxx`), Arm alarm, **halt room** ("$X · N losses at A" — one full A loss is the whole 2% daily halt). Eight tabs (Now, Options, Charts, Brain, Book, Lab, Invest, Learn). Destination first.

---

## Code map

| Path | Role |
|------|------|
| `src/lib/aplus/config.ts` | Non-negotiable numbers |
| `src/lib/trading/profit-rules.ts` | One-book, 9/mo, A+ probe, blake demote |
| `src/lib/trading/profit-path.ts` | Two-axis PATH band |
| `src/lib/trading/scanner.ts` | Per-strategy grade + candidate |
| `src/lib/trading/strategy-grade.ts` | Model-alone fit (do not stack-require) |
| `src/lib/trading/structure.ts` | HTF, swings, SMT stack, PDH/PDL |
| `src/lib/trading/smc-board.ts` | FVG/IFVG/OB/BB/MSS/BOS/displacement tape |
| `src/lib/trading/smc-canon.ts` | Named ICT/TJR/PB models |
| `src/lib/trading/smc-master.ts` | Live sequence grade (DOL → sweep polarity → dealing-range → LTF → **target priced ≥1:1** → retrace). TAKE iff all musts + PATH. `word-hysteresis.ts` (client) holds a printed TAKE through the array edge ≤30 min. |
| `src/lib/trading/rh-income.ts` | RH sleeve journal vs Databento rent. Floor $50/wk · rent $199/mo · stretch $1,000/wk · working stop 25%. |
| `src/lib/trading/session-brief.ts` | Bull/bear/no-trade day |
| `src/lib/trading/week-ahead.ts` | Sunday week plan. Live CWH/CWL overlay from bars (no lookahead). Official prints: `src/data/week-prints.json`. Sep 2026 weeks 1–5 are seeded. |
| `src/lib/trading/month-ahead.ts` | Month bias / phases (Labor → CPI → FOMC → Digest → PCE). Live CMH/CML overlay. Swap on the last Sunday of the prior month. |
| `src/lib/trading/overnight-swing.ts` | The 15:00 ET carry decision, graded like the Now desk. Mechanics, not signal — direction still comes from the sequence. Drift verified (QQQ +0.054%/night t=3.11 over 10y) but concentrated in the 02:00–03:00 ET European hour, and **no option structure showed a distinguishable overnight edge after the spread**. Board + `overnight-board.tsx`; `scripts/verify-overnight.mjs` 27/27. |
| `src/lib/trading/options-desk.ts` | QQQ/SPY RH sleeve ($1k / 15%). Estimates from ES/10 · NQ/40. Long debit or vertical. Working stop −25% of debit. Gated on SMC sequence. |
| `src/lib/trading/sessions.ts` | Killzones + `isJudasWindow` |
| `src/lib/trading/live-session.ts` | CDT ritual + pulse contract |
| `src/lib/trading/claude-handoff.ts` | Clipboard snapshot for you |
| `src/components/desk/price-path-board.tsx` | Draw/HTF/PATH destination. TAKE / STAND / MANAGE. HUD line on every tab. |
| `src/lib/trading/build-desk.ts` | Assembles payload (freshest quotes) |
| `src/lib/trading/veteran-brain.ts` | Discretion over journal+BT+desk |
| `src/lib/trading/ghost-book.ts` | Shadow PATH vs tape. Miss = read HTF/SMT/news/Judas/both books/remaining draw, then NOW action — never a canned "clean skip". |
| `src/lib/trading/shadow-book.ts` | The refusals paper-traded: every PATH card the sequence STANDs/WAITs on opens a limit leg (CE) and a chase leg, resolved on closed bars + prints, ties against. Path, tags, analysis. `shadow_trades` ledger via `shadow-book-server.ts`; `shadow-store.ts` client; `src/data/shadow-replay.json` seed (Jul–Aug 2026). Evidence about gates — never a fill, never a gate. |
| `src/lib/trading/discretion-memory.ts` | Gate scorecard from shadows: per refusing layer chase/limit n·WR·exp·$, verdict (earning / costing → sweep / neutral / early), feature lifts ("little things"), digest for brain + handoff. |
| `src/lib/trading/evidence.ts` | Reads `src/data/evidence-pack.json` (built by `scripts/build-evidence-pack.mjs` from `.cache/signals` + `history-4y.json`, rule AS CODED: limit at CE, 50% at T1, BE, runner T2, ties against, fill bar cannot score T1). Day-clustered CIs, both-halves verdicts. **Every card ≥0.65: −0.139R. Stop outside 0.5–1.5 ATR −0.244R (both halves); inside +0.033R (mixed — the band's value is what it refuses). Q 0.85+ direction 46.3% vs 53.6% at 0.65–0.70. Tape-event cards outside the killzones −0.78R (n=29, both halves).** Printed on every card, in Lab › Evidence, the Brain and the coach prompt. Corrects 68799e1's +0.059/+0.058 (that sim banked 75% at T1). `evidence-dist.json` = per-trade paths for simulators. |
| `src/lib/trading/card-plan.ts` | **One stop, everywhere.** A book's priced plan is attached to the card for the same symbol AND side; the card's invalidation becomes the plan stop. Scanner invalidation without a plan is always on the correct side of the entry (`protectiveInvalidation`). `cardSizeRefusal` is the one refusal the ticket, paper book, Log dialog and Rest button share. `verify-card-plan.mjs`. |
| `src/lib/trading/take-moments.ts` | **Hesitation ledger.** Every desk TAKE / CE-touch on a PATH band logged the instant it prints, linked to the trader's action (rested / real fill) + latency, resolved on the desk's own bars. Book tab. |
| `src/lib/journal/discipline.ts` | Fixed mistake vocabulary (each names the rule it breaks), exit reasons, 1–5 pre-click state; scorecard = rules followed vs broken in $, costliest habit, by desk word. `recordRealFill` (journal/server.ts, migrations/0015) records a real fill and NEVER refuses on a desk rule — it stores what the gate would have said (`override_gate`). |
| `src/lib/propfirm/apex-sim.ts` | Apex eval Monte Carlo on `evidence-dist.json`, day-block bootstrap, EOD vs Intraday trailing (peak open equity), DLL, 30-day clock, always beside a zero-edge control. Lab tab. 50K EOD at 2 MNQ @40pt: pass 8%, bust 15%, **timeout 77%**. |
| `src/lib/execution/autofire-gates.ts` | Apex's current text prohibits automation on **all** account types (evals included). Autofire refuses every phase until `APEX_AUTOMATION_CONFIRMED_IN_WRITING` (code constant) is flipped by a human. Semi-auto only. |
| `src/lib/trading/chart-timeframes.ts` | The card chart's five rungs (1m/5m/15m/1h/4h) off the two real series — `mtf[side].minute` and the 15m the engine grades. Never upsamples; carries a coverage sentence per rung, flags a **partial trailing bucket** (a forming 4h bar is drawn hollow), and `TF_MARKS` gives each rung its own mark set (4h draws no entry line; 1m draws no pools). `autoTf` follows the trade's life (live→1m, armed→5m, missing structure layer→1h), `resolveTf` keeps it off an empty rung. `verify-chart-timeframes.mjs` 104/104. |
| `src/lib/trading/score-drivers.ts` | What is driving a card's score, as **marginal** contribution to `fit` — not `RAW_WEIGHTS`. A raw weight would be a lie: `ifvg` is weight 8 and contributes 0 to `structureLayerScore` (it is outside `SMC_STRUCTURE_KEYS`) while satisfying a template gate instead. Components pay into several channels at once, and a redundant any-of member is worth 0 rather than double-counting its sibling's point. `verify-score-drivers.mjs` 135/135, **differential against the real engine** — each component removed and the observed `fit` drop compared. |
| `src/lib/trading/tf-ladder.ts` | 14 rungs 1y→30s (daily 2y, 15m, 1m + gateway, 30s from prints). Direction from the top, swing/intraday/micro bands → phase + alignment. Narrative; `topDown` stays the gate. |
| `src/lib/trading/entry-trigger.ts` | Tier (LIVE/ARMED/FORMING/WALKED-OFF by ATR distance), the CE-touch alarm test, the loss priced on the **sleeve** before the click, the runner's value, and the draw's measured reach as a target label. `pending-order.ts` rests a limit at CE and fills on the touch, not the print (+0.35R/card vs +0.007R measured). `verify-entry-trigger.mjs` 30/30. |
| `src/lib/trading/gate-tuning.ts` | Sequence knobs + the 2026-09-21 sweep table (18 variants, 0 takes). Live: sameBarDisplacement + sideFromRaid. Change only via `scripts/sweep-gates.mjs`. |
| `src/lib/trading/paper-manager.ts` | One-click paper + real-tape exits |
| `src/lib/market/freshest.ts` | Gateway > lowest lagSec |
| `src/lib/market/yahoo.ts` | Host race, includePrePost |
| `src/lib/market/databento.ts` | GLBX.MDP3 historical |
| `src/lib/market/live-gateway.ts` | Tick file from `gateway/` |
| `src/lib/alerts/path-alarm.ts` | Speaker + OS notify on PATH |
| `src/lib/coach/claude-server.ts` | In-app Grok + Claude **narration only** — peers, one click, parallel. Never a gate. |
| `src/routes/index.tsx` | Shell. 20s desk (PATH/HTF). Quote: 1s if live_gateway, 2s Yahoo. Gateway-first — no extra Databento spend. |
| `src/lib/invest/policy.ts` | The sweep waterfall. Rent → restore → earned split. Pure, monthly, one-way. `rentVsSweep` prices the data bill against the sweep it displaces. |
| `src/lib/invest/universe.ts` | Dossier schema + the wash-sale ban list + the completeness gate (blank field = cannot ADD) + concentration vs the sleeve's own bet. |
| `src/lib/invest/dossiers.ts` | The research. One page per name, caveats always stated, **no composite score**. `RISK_FREE` is the 10y the multiples are judged against. |
| `src/lib/invest/book.ts` | Three sleeves, drift, and a rebalance that refuses to invent work below $25/$500. Benchmark is VTI, and under 36 months it says so. |
| `src/lib/invest/store.ts` | Positions + append-only sweep log (localStorage; buys accumulate and never reset the long-term clock). |
| `src/data/invest-universe.json` | Dated fundamentals snapshot. Free Alpha Vantage key is **25 req/day** → committed, never polled. Refresh: `npm run capture:invest`. |
| `gateway/databento_live_gateway.py` | CME live → tick file |

---

## Env (`.env.example`)

- `DATABENTO_API_KEY` + `DATABENTO_DELAY_MINUTES` (`600` without live; `0` with live)
- `DATABASE_URL` (Neon) or paper/journal die on cold start
- `XAI_API_KEY` — **ACTIVE** on Netlify `ledgeyourtrades` (secret, runtime+functions, set 2026-09-17). Do **not** ask the trader to paste it. Do **not** treat as missing. Do **not** commit it. Peer with Claude, not primary. In-app Ask Grok + Claude fires both.
- `ANTHROPIC_API_KEY` — **ACTIVE** on the same site. Peer with Grok, not a fallback.
- `VAPID_*` — web push
- `CRON_SECRET` — scheduled checklist/review
- Tradovate flags stay **demo / disarmed** unless the trader explicitly arms live

Preview: `0.0.0.0:8080` via `startup.sh` / `npm run dev`.

---

## When coding

- Keep scoring **deterministic**. No LLM in the poll loop.
- Do not gold-plate. Do not lower the 0.65 floor.
- Label synthetic vs Yahoo vs Databento vs `live_gateway`.
- Push to **main** so Grok and Claude share one tree.
- In-app Ask Grok + Claude must remain **narration** (no size/signal). They fire as peers. Cursor/Grok chat **may** TAKE/STAND using this file + handoff.

## When the trader asks “is this a short/long?”

Stand through Judas and news. Demand sweep → displacement → MSS → IFVG in the correct half of the range, HTF aligned, RR≥1, one book. If any of those is missing, **STAND** and name it.
