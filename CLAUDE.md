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
| RH sleeve | **$1,000** · risk **15% = $150** max debit. Working stop **−25% of debit** (never 1/3, never full premium). Sell when futures invalidates **or** −25%, whichever first. |
| Databento rent | **$199/mo ≈ $50/week** first hurdle. **$1,000/week** is a stretch after n≥20 A+ WR≥65% — never a reason to take a B+ or lower 0.65. |
| Risk by grade | A+ **2% probe** until n≥20 A+ WR≥65% then 3% · A **2%** · A− **1%** · B+ **0.5%** · B paper 0 · C journal 0.5% |
| R:R | **≥ 1:1** — enforced by the `smc-master` **Target priced** must-layer (WAIT with no T1 ahead of CE or T1 < 1R; measured 2026-09-21: no-target plans −0.24R/t). TP clamp 1–3R is a display rule — as a T1 cap it measured −0.12R/t, so it is not applied. |
| Scale | 50% off at **T1 (the draw)**, stop → BE, runner to T2 — the rule as coded and measured (+0.50R/t on 122 filled plans). Banking at +1R instead measured −0.42R/t; BE at +1R MFE −0.07; trailing −0.30. Do not "protect early". |
| PATH / month | **~9** (after 9 → A+ only or stand) |
| Per killzone | max **2** |
| Daily / weekly halt | **2% / 5%** |
| One book / day | **MNQ or ES, never both same bias** |
| HTF `topDown` | **absolute gate** (no long if HTF bear, unless documented disrespect+distribution) |
| Primary models | **mechanical + SMT/TJR companion** |
| blake_mech longs | **paper / B+ only** until WR recovers |
| Judas | **09:30–09:45 ET — no entries** (A+ exception only if fully complete after the raid, still wait the window) |
| News | high-impact **±15m blackout** |
| Micros | **MNQ/MES preferred** |
| Data | Yahoo futures **~10 min delay**. Databento historical ~15–20m with live entitlement (`DATABENTO_DELAY_MINUTES=0`). Sub-second prints need the gateway (`gateway/.env.local` + NY 09:00–11:30 ET; its 1m bars also replace the lagged closed bars in that window). Say the lag. |

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
**Auto paper** (HUD, default on) fills the same PATH into the paper book in NY AM via `openPaperTradeInstant` so stats / debrief / brain see it. Judas 9:30–9:45 A+ only; news/event blackout; one book; blake_mech longs stay manual. Not live Apex.

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
| Options | **Overnight board first** (`overnight-swing.ts`, 15:00–15:55 ET): HOLD / TRIM / FLATTEN on 6 must-layers — expiry, event-while-blind, direction, DTE≥14 · Δ≥0.70, ticket cap, 1% gap. QQQ/SPY options are **unmanageable 16:15→09:30** (17h15m; 65h15m Fri) so the −25% stop does not exist overnight; SPX/XSP/VIX/RUT do trade Cboe GTH 20:15–09:25 limit-only. Never carry into expiry day (broker force-sells from 15:30 ET, auto-exercise at $0.01 ITM). Then the Robinhood QQQ/SPY sleeve **$1,000 · risk 15% = $150** max debit. Working stop **−25% of debit**. Week floor **$50** (Databento), stretch **$1,000** (not a take-mandate). Day: PATH 1–2 DTE (0DTE A+ after 9:45 with SMC TAKE). Swing: SMT lead / event second / HTF vertical. Never both underliers. |
| Charts | Dual MNQ/ES tape + liquidity |
| Brain | Veteran + coach (Ask Grok + Claude, peers, parallel). Never overrides hard gates. |
| Book | WR / grades / profit path, journal, **shadow book** (refusals paper-traded both ways · gate scorecard · the little things — `shadow-book.ts`, `discretion-memory.ts`; never the paper book), TradeZella backtest (no lookahead) |
| Lab | Risk governor, alerts, analytics, rules/replay/snapshots/shadow/bridge |

HUD is sticky on every tab: clock, killzone, GO/STAND/WAIT, quotes, lag, **draw line** (`TAKE/STAND/MANAGE · MNQ ↓xxxx · ES ↓xxxx`), Arm alarm. Six tabs. Destination first.

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
| `src/lib/trading/tf-ladder.ts` | 14 rungs 1y→30s (daily 2y, 15m, 1m + gateway, 30s from prints). Direction from the top, swing/intraday/micro bands → phase + alignment. Narrative; `topDown` stays the gate. |
| `src/lib/trading/gate-tuning.ts` | Sequence knobs + the 2026-09-21 sweep table (18 variants, 0 takes). Live: sameBarDisplacement + sideFromRaid. Change only via `scripts/sweep-gates.mjs`. |
| `src/lib/trading/paper-manager.ts` | One-click paper + real-tape exits |
| `src/lib/market/freshest.ts` | Gateway > lowest lagSec |
| `src/lib/market/yahoo.ts` | Host race, includePrePost |
| `src/lib/market/databento.ts` | GLBX.MDP3 historical |
| `src/lib/market/live-gateway.ts` | Tick file from `gateway/` |
| `src/lib/alerts/path-alarm.ts` | Speaker + OS notify on PATH |
| `src/lib/coach/claude-server.ts` | In-app Grok + Claude **narration only** — peers, one click, parallel. Never a gate. |
| `src/routes/index.tsx` | Shell. 20s desk (PATH/HTF). Quote: 1s if live_gateway, 2s Yahoo. Gateway-first — no extra Databento spend. |
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
