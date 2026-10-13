# CLAUDE.md — Ledger Desk (private MNQ/ES masterplace)

You are a **desk partner**, same role as Grok. Repo: https://github.com/keatrng-cpu/ledger-desk  
Upstream models: https://github.com/keatrng-cpu/Trading-Automation · https://github.com/keatrng-cpu/profxtrader

Deterministic TypeScript **scores and gates**. You **narrate, grade live tape against those gates, and ship code**. You never invent fills, never look at future bars, never override a hard gate.

If the trader pastes a `=== LEDGER DESK HANDOFF ===` block, that **is** the live desk. Treat it as ground truth for that timestamp (note `lagSec`).

## Dual workflow — read before you edit

Grok and Claude share **one** `main`. Neither has a private tree. A commit you have not read is code you have not seen.

```
git fetch origin main
node scripts/agent-sync.mjs --agent claude
```

Grok runs the same command with `--agent grok`. The script lists every commit and new file since that agent's bookmark (`docs/agent-sync.json`), writes the brief to `docs/agent-sync.md`, then moves the bookmark to HEAD. Exit 2 means origin is ahead: `git pull --rebase origin main` and run it again. Read `git show SHA -- path` before editing a file in the brief. Do not redo a commit already on main, and do not revert the other agent's commit to land yours. Push to `main`, then run the script once more so the bookmark matches what you pushed.

## Tools that fire without being asked

Four project skills auto-trigger from their descriptions — do not wait to be told, and never make the trader type a slash command:

| When | Invoke |
|---|---|
| Start of any coding session, before a commit, after a pull | **agent-sync** — `node scripts/agent-sync.mjs --agent claude`, so Grok's commits are read, not redone |
| Before opening any file | **code-index** — `.ai/locator.md`, then `docs/code-index.md`. Never walk `src/` |
| A figure from outside the repo enters the desk; any calculation, projection, option price or backtest result is reported | **desk-accuracy** — a model may find, read and explain a number; it may never be the source of one |
| The desk needs a number it does not hold (a filing, holdings, a KPI, an earnings or macro calendar, a yield, an option chain, a dated research figure) or work touches Supabase, Netlify, the gateway task, a three.js / TanStack / Vite API, or `office.glb` | **desk-data** — which connector is the source, and which of the ~40 connected ones belong near this desk at all |

Reach for the connector rather than recall: **Alpha Vantage** (fundamentals, earnings, ETF holdings, chains — free key is 25/day, which is why those files are committed), **Financial Datasets** (SEC filings and items without `SEC_USER_AGENT`, insider and institutional holdings, segments, KPIs, macro), **Bigdata.com** (`bigdata_events_calendar` — the four-year release calendar `exits.ts`'s `event` rule and `measure-room-ev.mjs` are blocked on), **FireCrawl** (the primary page behind a figure), **Supabase** (`nfwuvpsxnxctinywwrgh` — migrations, rows, advisors, logs), **Netlify** (deploy + whether an env var is present, never its value), **Context7** (three.js / TanStack / Vite signatures instead of a guess). None of them may enter the scoring loop, a verifier, or a poll — the desk stays deterministic and the gates read committed files.

Also standing: **code-review** and **security-review** before a push that touches the order path; **dataviz** before any chart; **claude-api** before touching `coach/claude-server.ts` or anything that calls Anthropic or xAI. The `small-business`, `sales`, `marketing`, `human-resources`, `legal`, `bio-research`, `pigment` and `activecampaign` skills and servers are noise in this repo — do not reach for them, and do not report their auth errors as problems here.


## Find the file before you read it

Start at [.ai/locator.md](./.ai/locator.md). It names the function. Do not walk `src/` and do not read the code map below to locate a file. On a miss, search [docs/code-index.md](./docs/code-index.md) — one line per file, exports and the header sentence — then open only the hit. Who calls whom is [.ai/dependency_graph.md](./.ai/dependency_graph.md). Edit style is [.ai/prompt_rules.md](./.ai/prompt_rules.md).

```
rg -n "raid|entry|floor" docs/code-index.md
```

Regenerate with `node scripts/code-index.mjs` after a file is added or renamed. The code map below is the history of decisions, not the locator.

---

## Hard rules (do not drift)

| Rule | Value |
|------|--------|
| Confluence / PATH floor | **0.65** (`APLUS_RULES.confluenceFloor`) |
| A+ tag | ≥ **0.75** |
| Execute grades | A+ · A · A− at PATH floor **0.65** (unchanged) · **B+ LIVE on the RH path** (Accuracy + Keaton 2026-10-06) behind its own explicit gate `evaluateRhBplusGate`: fit **≥ 0.60** (config band `confluenceFloor − 0.05`, `APLUS_RULES.profitPath.bPlusLive`), SMC sequence **TAKE** on its side, **no veto** (room / Stand / Owner; unknown = refuse), plus the same CE touch · tape ≤ 30 s · DTE 0\|1 · BP ≥ $50 on Agentic 995386158 · options session open rules. Live RH gate refuses on a news blackout (rh-autofire-gates.ts:438); the clock no longer refuses. News adds +0.05 to the bar, and news, shock or post-10:00 cut 1 contract (min 1) on the desk ticket (options-desk.ts:1633, 1705). **B+ size: exactly 1 contract**, debit still inside the $50–$550 envelope. B / B− / C never fire. Futures paper sizing for B+ stays 0.5%. |
| Paper equity | **$100,000** |
| RH sleeve | **$1,000 max DEBIT per trade**, loss capped **15% of the debit paid** (trader's call 2026-09-23 — replaces "$1,000 account / $150 max debit"). **Size from the stop, not from a fixed debit** (`sleeve-sizing.ts`): contracts = risk budget / (underlying move to invalidation × delta × 100), so a tighter invalidation buys more contracts at the same risk. **Exit on the LEVEL** — the futures plan's invalidation, same trigger as the futures book; the 15% is a disaster backstop, not the plan. **A 15% brake on 1 DTE is a CLOCK** — theta alone removes it inside ~3.6h, so 15% needs **≥2 DTE** for a 4h hold, which conflicts with "0DTE A+ after 9:45". `rhMaxDebit` is gone (options-sleeve.ts). Option tickets no longer floor to 1 contract when the loss check says 0 — they fall through to a vertical or STAND. The 15%-of-debit cap vs the −25% working-stop backstop is still two numbers; the trader has to pick one. |
| Databento rent | **$199/mo ≈ $50/week** first hurdle. **$1,000/week** is a stretch after n≥20 A+ WR≥65% — never a reason to take a B+ or lower 0.65. |
| Risk by grade | A+ **2% probe** until n≥20 A+ WR≥65% then 3% · A **2%** · A− **1%** · B+ **0.5%** · B paper 0 · C journal 0.5% |
| R:R | **≥ 1:1** — enforced by the `smc-master` **Target priced** must-layer (WAIT with no T1 ahead of CE or T1 < 1R; measured 2026-09-21: no-target plans −0.24R/t). TP clamp 1–3R is a display rule — as a T1 cap it measured −0.12R/t, so it is not applied. |
| Entry | **Rest the limit at CE** — never pay the print. Not an edge claim: the pooled +0.35R/card figure is 58% London, and in NY AM refused cards lose either way (−0.181R resting / −0.040R chasing, n=53 on 1m bars) — which is the gates working. The CE-touch alarm calls you; FORMING (>1 ATR away) means look away. Target reach <60% is labelled unlikely (−0.21R/card). **1m micro-timing measured and rejected**: confirmation entries and micro stops both fail in NY AM (`scripts/measure-micro-entry.mjs`). **Entry location measured on four years (2026-10-01, `scripts/measure-entry-location.mjs`, paired per card, unfilled = 0, rule fixed before the run, family bar z ≥ 2.87 for 12 tests): CE stays.** On the in-band cards the desk trades (n=1870, +0.047R/card), none of nine variants beats it: ¼ shallower +0.009; ¼ deeper −0.053; half-way to the stop ("far edge") −0.134 z −1.93, negative in both halves (fills 58% vs 71%, stopped 78% vs 50%); OTE 70.5% instead of CE −0.006; cancel after 1h +0.013 / 2h −0.010; 15m close-confirmation −0.017 (fills 41%); stop ¼ / ½ ATR wider −0.004 / −0.028. On all cards, confirmation (+0.069 z 2.69) and a wider stop (+0.060 z 2.41) look better only because they repair the too-tight out-of-band stops the band already refuses. Watch, not wired: price already at CE when the card prints (LIVE) −0.201 vs −0.056R/card, z −2.02, worse in both halves; ARMED +0.119 vs −0.004 in-band, z 1.35. **Stopped in-band fills: 56% touch T1 within 8h, after running a median 1.84 ATR beyond the stop** — the stop is not in the noise and widening it does not help; the entry is early. The raid the card read was not the low. |
| Scale | 50% off at **T1 (the draw)**, stop → BE, runner to T2 — the rule as coded and measured (+0.50R/t on 122 filled plans). Banking at +1R instead measured −0.42R/t; BE at +1R MFE −0.07; trailing −0.30. Do not "protect early". **Failed-hold exit (2026-10-01, `exit-rules.ts`):** before T1, a **15m CLOSE** beyond entry by ½ the entry→stop distance exits at market — a wick does not; the hard stop beyond the raid is unchanged. The trader's own rule ("a close through the entry array after you are filled"), and the one exit from their research that measured: in-band cards (stop 0.5–1.5 ATR) **+0.033R → +0.066R/card, z=2.6, both halves**, full-stop exits 67% → 50%, stop-or-breakeven 82% → 65% (`scripts/measure-exit-plan.mjs`, paired on the same fills; all cards Δ +0.017R z=1.13 — secondary analysis, eight variants, just under a strict multiple-comparison bar). It lowers win rate while raising expectancy — and the A+ unlock is a win-rate threshold. Paper book + card print the same level; `FAILED_HOLD_ENABLED` switches it. **Tested and not adopted** (same file): ⅔ partial Δ −0.002R (no effect on R, PF or drawdown); runner held by 15m structure +0.018R (all from holding to 24h, not the structure exit); external T2 when none Δ +0.004R; flat by 16:00 ET +0.012R; full trader plan +0.033R z=1.72 (maxDD 508R → 392R); **T1 ≥ 2R filter is WORSE** (−0.18R vs −0.105R) — farther first targets are reached less often. 79% of all fills end on a stop — **65% the full stop, 14% breakeven after T1** (corrected 2026-10-01: the exit-plan script counted BE exits as stops, so this line first said "79% at the full stop"). |
| PATH / month | **~9** (after 9 → A+ only or stand) |
| Per killzone | max **2** |
| Session gate | **The tape, not the clock** (`session-event.ts`). Was `clock.inTradeWindow` as a hard must-layer, so 11:00–13:30 and 16:00–02:00 could never print TAKE regardless of what price did. The killzone was only ever a proxy for two measurable things — **delivery** (range vs the instrument's own ATR) and **participation** (volume vs its own 20-bar median) — so those are measured directly: `EVENT_SCORE_MIN` 2.0×, `EVENT_VOL_MIN` 1.5×, both required. Inside a killzone nothing changes. Weekends stay shut, and no event can satisfy Judas or the news blackout. `sessionLive(clock)` falls back to the raw window on any clock built without bars, so ~20 call sites degrade to today's behaviour rather than silently opening. **Measured over 4 years / 93,669 bar-scans**: the clock was the **5th** most binding layer (23 sole-blocks vs retrace 278, sweep 220, pd_half 155, target 93). Opening it fully takes 78→88 trades but costs expectancy (+0.277R→+0.225R) and drawdown (5.0%→6.8%). **Small and safe, not the lever.** |
| Daily / weekly halt | **2% / 5%** |
| One book / day | **MNQ or ES, never both same bias** |
| HTF `topDown` | **absolute gate** (no long if HTF bear, unless documented disrespect+distribution) |
| Card score | **P(T1 reached, if filled)** — the big number on every card since 2026-10-02 (trader's call: "score a trade's probability of hitting target"). `hit-odds.ts` + `src/data/hit-odds-model.json`, built by `scripts/build-hit-odds.mjs` on the four-year capture (4,908 cards, 3,508 fills, 997 T1) under the LIVE rule (CE limit, failed-hold exit, hard stop, 8h). Rule fixed before the run: fit 2022–24, test 2025–26, a richer model replaces a simpler one only at OOS log-loss z ≤ −2. **Geometry won (M0: T1 distance in R + stop band).** Every researched context item together (Tier-1 ladder, weekly+daily, inducement, mitigation, SMT at a level, London/NY AM, Friday, the fit itself, side, symbol) improved OOS log loss by 0.003, z −0.54 — not shipped. The 18-session race (`target-odds.ts`) added nothing on top (z −0.49) and lost to M0 head-to-head (log loss 0.578 vs 0.537, z −2.57), so it is retired from every headline. M0 out of sample: AUC 0.73, mean p 29.2% vs 29.3% hit, calibration slope 1.17. Reliable effects: farther T1 in R (−12.8 pts per sd), stop under 0.5 ATR (−10 pts). Secondary (in-sample, not shipped): price already at CE −3.7 pts (interval clear of zero); weekly+daily BOTH AGAINST **+9.3 pts** (the opposite of "W/D disagree = no trade"); SMT at a level +3.6, inducement −4.1, mitigation −4.1 (intervals touching zero); the fit −0.5 (nothing). Card: P(T1) headline, E[R] per fill (payoff 0.16 + 0.93·rr1 on a T1 hit, −0.89 otherwise), fill rate by location (LIVE 97% · ARMED 80% · FORMING 52%), the geometry-alone reference 1/(1+rr), drivers in probability points. **E[R] ranks correctly but is optimistic at the top**: OOS top fifth priced +0.23R, realized +0.04R. The board sorts by E[R] per card inside each takeable group (`compareForBoard`). **Not a gate**: the 0.65 floor and the PATH bands still run on the fit — moving them to probability needs the trader's numbers in config.ts. The handoff, the PATH alarm and the sequence's target layer quote the same P(T1). `verify-hit-odds.mjs`. |
| Primary models | **mechanical + TJR companion.** SMT is a **bias input, not a model** (trader's call 2026-10-02): it helps form the timeframe bias and scores only as a component, only when the divergence printed AT a major level (PDH/PDL, PWH/PWL, Asia/London H/L) or a 1h/4h array, within 0.5 ATR (`smt-level.ts`). It left `ALWAYS_SCAN`, `PRIMARY_STRATEGIES` and the one-book +2 bonus; "SMT + any array" used to be a complete model on its own and could title a card. The relative-strength fallback in `smtRead` (a bias spread labelled "bullish_smt" with no divergence) can no longer score. |
| blake_mech longs | **paper / B+ only** until WR recovers |
| Judas | **09:30–09:45 ET — blocked until the manipulation RESOLVES.** Trader's call 2026-09-24: the Judas swing is a MODEL, not a hazard — price raids one side off the open, fails, and delivers the other way, and the trade is fading it. `judas-window.ts` releases the window only when ALL of: a raid printed on a **sub-15m rung**, price closed back inside the pool it took, a **LATER** bar displaced against it, the trade's side is the one the failed raid points at, and confluence ≥ **0.75** (A+, not the 0.65 floor). **It fails closed** — 09:30–09:45 is ONE 15m candle, so without 1m/2m/3m tape the raid and the reaction are the same bar and the window stays shut. In practice that means it releases only while the gateway is up. **Measured** (`measure-judas.mjs`, 90 windows on the 2-month 1m tape): resolution occurs in 43 of 90; a bare mechanical fade of it is −0.307R vs −0.219R for the identical rule at 09:45–11:00 — a −0.089R difference, i.e. **the hour is not the problem, the 1m market-fill entry style is** (same finding as `measure-micro-entry.mjs`). The live gate is far stricter than that test. Treat as **paper-only until it has live evidence**. |
| News | high-impact **±15m blackout** (timing only). **Release-direction bias tested and rejected** (`scripts/measure-news-bias.mjs`, run 2026-09-30 on the 4y tape — the script existed since `68799e1` but its result was never captured anywhere until now): does the 08:30 ET release-slot reaction predict the 09:45–11:00 ET session the desk actually trades, vs an 08:00 ET no-release control on the same days. MNQ 50.3% agree (n=1011) vs 50.5% control — gap −0.1pp, noise. ES 50.4% (n=991) vs 52.9% control — gap −2.6pp, i.e. the control beats the "news" slot. No split by release size (0–2+ ATR) clears n≥20 with a real edge. **No news-direction signal is coded anywhere** — correctly: `session-brief.ts` already treats the first 08:30 impulse as suspect ("often the Judas ... wait for the retest"), and this is why. Documented so the idea isn't silently re-proposed. |
| Investments sweep | Monthly, **realized closed options P&L only**. Waterfall: **rent ($199) → sleeve restore to $1,000 → split**. Rate is earned: **20%** until 20 closed months, 30% after, 40% only after a clean year. Losing or open month sweeps **0**. One-way — swept dollars never return to the sleeve. |
| Investments ban | **QQQ · QQQM · SPY · VOO · IVV · SPLG may never be held** while the sleeve trades QQQ/SPY options — IRC 1091 wash-sale entanglement. Ballast is **VTI/ITOT**. Not tax advice; conservative default, CPA files it. |
| Micros | **MNQ/MES preferred** |
| Data | Yahoo futures **~10 min delay**. Databento historical ~15–20m with live entitlement (`DATABENTO_DELAY_MINUTES=0`). Sub-second prints need the gateway (`gateway/.env.local`); since 2026-09-23 it defaults to streaming **whenever Globex is open** (Sun 17:00 ET–Fri 16:00 ET, minus the daily halt), not just a narrow morning window — widening costs nothing, Databento live is $199 FLAT. `08:15–11:30 ET` (`NY_AM_LIVE_*` in `sessions.ts`) is now only the GUARANTEED floor / the `GATEWAY_NY_AM_ONLY=1` fallback, not the actual runtime window. **Fixed 2026-09-30:** the live scheduled task had drifted stale — one weekday trigger, 9h kill-limit, no Sunday trigger — leaving ~15h/day and the whole weekend-open dark regardless of what the code allowed; `install-task.ps1` now fires Sunday 15:45 CT (primary, ahead of the week's reopen) + weekday 07:10 CT (same-morning self-heal if that instance died), sharing one 6.5-day `ExecutionTimeLimit` so one instance normally spans the whole week. Same fix caught `live-says.ts` reporting "Gateway idle" any time the clock was outside 08:15–11:30 ET even with a genuinely fresh tick underneath — `live` is now decided by tick freshness alone, never the clock. Watching and trading are still different windows (±15m blackout). **Quiet-tape lag fixed 2026-10-05:** the reader trusted a tick only while `received_at` was under 5 s old, and `ohlcv-1s` emits only for a second with a trade, so in the thin overnight session ES went quiet past the window and the desk fell back to Yahoo ("lag 620s") with a healthy socket — the gateway log showed a bar every minute the whole time. `received_at` is now the last time the gateway had evidence the stored print is still current: a trade, or any record on its socket (it asks Databento for a heartbeat every 5 s, the minimum), re-stamped at most once a second and only for a print under ten minutes old, so a symbol that stopped trading or a dead socket still ages out. The reader trusts a tick for 12 s (`TICK_FRESH_MS`: two missed heartbeats and a second); a gateway quote's `lagSec` is the time since that confirmation, not since the last print, and its `marketTimeMs` stays the print's time (bars are placed by it). The desk now waits 750 ms (was 150) for the tick read — a cold serverless connection lost about one poll in twenty to Yahoo — and reuses its last tick while that is still inside the 12 s window (`tickOrCached`; the window is counted from the gateway's confirmation, so a slow read can never make a stale price look live). `verify-live-gateway.mjs` 34 runs the gateway's own SQL on PGLite with the real migration. Say the lag. |

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

> Moved verbatim to [docs/agents/CLAUDE-reference.md#ui-map-categories](docs/agents/CLAUDE-reference.md#ui-map-categories) — open it when this section is relevant.

## Code map

> Moved verbatim to [docs/agents/CLAUDE-reference.md#code-map](docs/agents/CLAUDE-reference.md#code-map) — open it when this section is relevant.

## Env (`.env.example`)

> Moved verbatim to [docs/agents/CLAUDE-reference.md#env-envexample](docs/agents/CLAUDE-reference.md#env-envexample) — open it when this section is relevant.

## When coding

- Keep scoring **deterministic**. No LLM in the poll loop.
- Do not gold-plate. Do not lower the 0.65 floor.
- Label synthetic vs Yahoo vs Databento vs `live_gateway`.
- Push to **main** so Grok and Claude share one tree.
- In-app Ask Grok + Claude must remain **narration** (no size/signal). They fire as peers. Cursor/Grok chat **may** TAKE/STAND using this file + handoff.

## When the trader asks “is this a short/long?”

Stand through Judas and news. Demand sweep → displacement → MSS → IFVG in the correct half of the range, HTF aligned, RR≥1, one book. If any of those is missing, **STAND** and name it.
