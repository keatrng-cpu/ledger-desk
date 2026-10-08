# Robinhood live options routine (live-when-armed)

**Status:** implemented as pure gates + proposal builder. Production mode is **live when armed**. Paper (Floor Alpaca `room/exec`, desk `auto-paper`) stays for testing.

Keaton confirmed in writing (2026-10-06, restated 2026-10-07) that the floor places when Floor + PATH + Stand agree. No click and no second approval. `RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING` is **true**. Both env arms default **on**. Set either to `false` to disarm. A failed gate still refuses the ticket.

## Armed (2026-10-07)

The old "stay disarmed / do not arm / do not place" line is withdrawn. The buying-power gate and the account check still run on every proposal:

1. `evaluateRhBuyingPower` on a fresh `get_portfolio` of Agentic 995386158, and
2. that account accessible to the agent, option level ≥ 2, buying power able to carry the ticket.

`RH_OPTIONS_AUTOFIRE_ENABLED` and `RH_LIVE_ARMED` are **true** in `.env.example` and default on when unset. An explicit `false` is the only disarm.

**Trade account (revised 2026-10-06):** **Agentic ••6158** — `account_number` **`995386158`** (`RH_PREFERRED_ACCOUNT_NUMBER`), option_level_2, limited_margin, `agentic_allowed=true`. **$0 until Keaton funds ~$1000 at ~08:30 ET.** `DEFAULT_MANAGER_ROOM_ACCOUNT` is the Agentic $0 snapshot (`isSnapshot=true` → can never authorize). **Individual ••7477** (`415577477`) is **display-only** — every BP / place gate refuses it (`bp_wrong_account`).

## Trigger model (Keaton 2026-10-06)

- **The eye:** the continuous Floor / **Trade Now** read (options card verdict, desk feed, Stand). It watches every poll; it does **not** place by itself.
- **The place trigger:** a **PATH scanner FIRE** (`considerPathAlarm` → `PathAlarmFire`, `isPathFire`), or the live print already in the array. A fresh fire (≤ 30 s) starts `proposeRhFromPathFire`. With no fire, the place still starts when the Stand agrees, the Floor is **ARMED**, and price is in the array (`ceTouch` or a live desk). A stale fire with no touch and no desk refuses `path_fire_stale`. Then **`review_option_order`** → `mayPlaceAfterReview` → **`place_option_order`**. There is no five-minute place timer.
- **Grades accepted on the LIVE path:** **A+, A, A−, and B+** (`RH_PATH_GRADES` = `APLUS_RULES.profitPath.onlyExecuteGrades`). B+ is live, not paper-only. B / C / skip never fire.
- **Account:** **Agentic ••6158 (`995386158`) only.** Individual ••7477 is display-only.
- **Funding:** Keaton funds the Agentic account **~09:30 ET**; until `get_portfolio(995386158)` shows BP ≥ $150 every place refuses (`bp_floor`).

## Triple agreement (all required)

1. **Floor desk** — options card `verdict === "ARMED"` and `deskContracts >= 1` (Floor characters cite SMC research + live PATH scanner).
2. **Live PATH scanner FIRE** — actionable; band **A+/A/A− with confluence ≥ 0.65**, or **B+ with confluence ≥ 0.60** (`RH_PATH_FLOOR_BY_BAND`). The PATH floor stays **0.65**; B+ has its own band in `src/lib/aplus/config.ts` / `strategy-grade.ts pathBand` (`confluenceFloor − 0.05` = 0.60) — the config band edge, no new score.
3. **Trading Stand (agent)** — `agentAgree === true` for this cycle (explicit; absence refuses). Source: the **real** Manager feed (`src/lib/room/manager-room-feed.ts`), built from the room engine's actual cycle — never the demo stub (see below).

Floor mandate still names after **10:00 ET A+ only** and flat at **11:00** on the room. The RH gate itself does not hard-refuse on that clock: `evaluateRhFloorRules` lets 11:00 ET and a B+ after 10:00 pass. The room's own rules still apply before Stand agree.

### B+ explicit gate (Accuracy + Keaton 2026-10-06) — `evaluateRhBplusGate`

RH_PATH_FLOOR stays **0.65** for A+/A/A−; B+ never lowers it. A B+ ticket needs **all** of:

| gate | rule |
|------|------|
| `path_floor` | fit (confluence) **≥ 0.60** (`APLUS_RULES.profitPath.bPlusLive.fitFloor`) |
| `bplus_seq` | SMC sequence **TAKE** on the PATH book's side (`candidate.seqTake === true`; unknown → refuse) |
| `bplus_veto` | **no veto** — room beat not `vetoed`, Stand call not `VETO`, no Owner `DECLARE_VETO` (`candidate.vetoed === false`; unknown → refuse) |
| shared | CE touch · tape ≤ 30 s · DTE 0\|1 · BP ≥ $150 (Agentic 995386158, fresh) |
| `bplus_size` | **exactly 1 contract** (`RH_BPLUS_MAX_CONTRACTS`), checked in `proposeRhLiveOption` and again in `mayPlaceAfterReview({ pathBand, quantity })` |

B+ debit stays inside the normal **$150–$550** envelope (1 contract must cost ≥ $150 or it refuses `debit_floor`).

Plus: options session open, no news blackout, no risk halt, one-book clear.

## Manager feed → live loop (Design Atelier, Keaton-approved 2026-10-06)

- **Real feed:** `roomManagerFeed()` (`createRoomManagerFeed`). `room-engine.ts runLiveCycle` pushes every live room cycle (beat, Sterling's gates, `broker_action`, entry plan, lenses, room P) via `pushRoom`. The Floor scene uses it by default; the demo stub only on dev `?manager=stub`.
- **agentAgree** (`managerAgreeFromRoom`) is true **only** on a room **BUY_OPEN fill** (every room gate passed, CE touched) where: Floor ARMED + desk ticket · PATH A+/A/A− ≥ 0.65 or B+ via the explicit B+ gate · DTE 0/1 · session open · no blackout · live (not synthetic) feed · envelope-shaped ticket ($150–$550, 1–4 ct, B+ 1 ct, ATM/OTM_1; the Stand may only shrink the room's qty) · no Owner veto / table / hand-off on that decision. Owner chips can only remove agreement; `DECLARE_AGREE` never forces it.
- **Wiring point:** `managerStateForAgree(feed)` (`manager-feed.ts`) → real feed `feed.getState()`, **stub / no feed → `null` → agentAgree false**.
- **Loop:** `proposeRhFromManagerFeed({ feed, fire, account, liveQuote, desk?, env })` (`src/lib/room/manager-live-loop.ts`) → `candidateFromFloorPathStand({ manager: managerStateForAgree(feed), ceTouch, tapeAgeSec, dte, seqTake, vetoed, ... })` → `proposeRhFromPathFire` → `proposeRhLiveOption`. Signals come from the same room cycle (`ManagerRoomState.signals`: CE = room `trigger` gate, tape = now − frame time, DTE = card, SEQ = card SMC word, veto = room/Stand/Owner). Returns a shape; it does not place. `runRhDesk` (`src/lib/execution/rh-dispatch.ts`) is the sender.
- **Account:** `feed.setAccountFromConnector({ account: get_accounts row, portfolio: get_portfolio data })` → `managerRhAccountFromConnector` → `ManagerRoomState.account`. Until injected, it is the Agentic $0 **snapshot** (can never authorize).

## Risk envelope (Keaton 2026-10-06)

| Rule | Bound |
|------|--------|
| Total debit | **$150 min – $550 max** |
| Contracts | **1–4** |
| Strike | **ATM or 1 strike OTM only** (`ATM` / `OTM_1`) |

Enforced in `evaluateRhTicketEnvelope` before any review/place shape is built.

## Circuit breaker (2026-10-07)

Two more refusals sit in the gate chain right after the risk halt (`evaluateRhCircuitBreaker`, `rh-autofire-gates.ts`). They refuse NEW entries only; they never place, cancel or sell anything.

| gate | rule |
|------|------|
| `throttle` | the last placement was under **60 s** ago (`RH_MIN_PLACE_GAP_MS`, the trader's number), or its timestamp is in the future (clocks disagree: fail closed) |
| `drawdown` | the trade account is down at least the desk's own daily loss limit today (`APLUS_RULES.dailyLossLimitPct`, no new number). The reason says to flatten what is open through `review_option_order`. |

**The agent must pass both inputs** (`lastPlaceAtMs`: when it last placed an order; `dayPnlPct`: the trade account's P&L today as a fraction of its value at the open, from `get_portfolio`, -0.04 = down 4%). An absent input is "not asserted", never "passed", so these two gates only bite when the agent supplies them. Also: **`RH_OPTIONS_AUTOFIRE_ENABLED` and `RH_LIVE_ARMED` arm when unset or blank, and disarm on ANY other value that is not true/1/on/yes** ("disabled", "nope" and typos disarm).

## Arm / confirmation

| Switch | Where | Default / status |
|--------|--------|------------------|
| `RH_OPTIONS_AUTOFIRE_ENABLED=true` | env | **on**. `false` disarms |
| `RH_LIVE_ARMED=true` | env | **on**. `false` disarms |
| `RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING` | `rh-autofire-gates.ts` | **`true`** (Keaton chat 2026-10-06) |

### Buying-power hard gate (Keaton 2026-10-06)

The agent **must call `get_portfolio` (account_number) before `proposeRhLiveOption`** and again after `review_option_order`, before any place. Pass the read via `rhAccountFromPortfolio` as `candidate.account` and `mayPlaceAfterReview({ accountAtReview, debitTotal })`.

`evaluateRhBuyingPower` (in `rh-autofire-gates.ts`) refuses, fail-closed:

| gate | when |
|------|------|
| `bp_unknown` | no account read, or BP / options BP null · NaN · non-number (a `get_portfolio` without `buying_power` parses to NaN, not $0) |
| `bp_wrong_account` | `accountNumber !== 995386158` (Agentic) — label / mask alone never clears |
| `bp_source` | read is not a live `get_portfolio` (e.g. the desk screenshot snapshot) |
| `bp_stale` | read older than 5 min |
| `account_access` | `agentic_allowed` not `true` (unknown = no) |
| `options_level` | a reported options level that is not 2 or 3. A level that was not reported (`null`) does not refuse. |
| `bp_floor` | spendable < **$150** — nothing in the $150–$550 envelope can place |
| `bp_ticket` | spendable < this ticket's debit |

Spendable = `buying_power.buying_power` (and options BP when reported) — **never `cash`**: on a cash account unsettled proceeds sit in cash but are not spendable.

**Manager block side:** `mayPlaceAfterReview` now **requires** `account` (`ManagerRoomState.account`) — omitting it refuses (was fail-open). `accountPlaceGate` refuses: no block · not account 995386158 · not agent-accessible · level < 2 · static snapshot (`bp_snapshot`) · BP unknown · BP < $150 (recomputed, `canFillEnvelope` not trusted) · BP < ticket debit.

### Floor rules on the RH path (`evaluateRhFloorRules`, fail closed)

Run after risk/session/one-book, before Floor/PATH/Stand, on `flags.nowMs`:

| gate | rule |
|------|------|
| `dte` | **DTE 0 or 1**; missing → refuse |
| `tape_unknown` / `tape_stale` | desk tape age **≤ 30 s**; missing → refuse |
| `ce_touch` | CE touch must be confirmed (`ceTouch === true`) |

The clock is not a refuse on this gate. 11:00 ET with a fresh BP is still ok. B+ after 10:00 ET with a fresh BP is still ok. The room mandate still names those cuts; this function does not re-apply them.

**Wired (2026-10-06, `rh-floor-signals.ts`):** `candidateFromFloorPathStand` / `proposeRhFromPathFire` take `desk` (DeskPayload) + `floor.dte` and derive, fail-closed:

| signal | source |
|------|------|
| `ceTouch` | the PATH book's smc-master plan (same symbol **and** side); live desk quote `readEntry(plan, price).inZone` and not `behind` — same read the CE-touch alarm fires on |
| `tapeAgeSec` | `now − desk.fetchedAt` |
| `dte` | Floor options card `ticket.dteTarget` (passed as `floor.dte`) |

Explicit values still win; anything unreadable → `null` → refuse.

**Desk today (screenshot + read-only get_portfolio 01:46 UTC):** Individual ••7477, cash account, $984.12 cash, $972.56 unsettled, **$11.56 buying power**, options level 2, −$179.84 (−15.45%) today. → `bp_floor` blocks every ticket. The Individual account is also not tradable by this agent (`account_access`), and the Agentic ••6158 trade account (option_level_2, limited_margin) has $0 until funded → `bp_floor`. The Floor seats quote this (`rhAccountNote` / `rhArmedPathNote`).

### Session checklist

The arms are already on. Do not flip them off at the close. Set either env var to `false` only when the trader says to disarm.

1. Desk and Floor up. PATH scanner live. Manager `agentAgree` wired.
2. Agentic 995386158 is the account the agent can trade, option level ≥ 2, and `get_portfolio` shows buying power that can carry the ticket.
3. Envelope still **$150–$550**, **1–4** contracts, **ATM / OTM_1**. Review, then place. No click.
4. On a PATH fire: `get_accounts` + `get_portfolio(995386158)` → Floor ARMED + Manager agree + buying power → `get_option_quotes` → `proposeRhFromManagerFeed` → `review_option_order` → `mayPlaceAfterReview` → `place_option_order` on Agentic 995386158. If a gate fails, do not place that ticket.

## Agent send path (user-Robinhood-xai)

There is **no** `preview_option_order` tool. Use **`review_option_order`** as the preview.

1. Build candidate + ticket (ATM/OTM_1, 1–4 ct, $150–$550); set `agentAgree` only when Stand agrees.
2. `proposeRhLiveOption(...)` — if `mode !== "live_when_armed"`, stop.
3. `get_accounts` — require `agentic_allowed` and option level ≥ 2.
4. `get_option_chains` → `get_option_instruments` — fill `option_id`.
5. `get_option_quotes(option_id)` → pass as `liveQuote` (`source: "get_option_quotes"`, `asOfMs`) — **required**: missing/omitted `liveQuote` refuses both `proposeRhLiveOption` and `mayPlaceAfterReview` (no arm on model `priceHint`). The limit is **live ask + $0.02** (`placeShape.priceSource === "live_quote"`); the model `estDebitEach + $0.02` is a shape label only and cannot arm. Envelope + BP are re-run on the **live** debit. Quote > 30 s old, crossed, or ask ≤ 0 → **refused**.
   **`review_option_order`** with that limit. Surface alerts verbatim.
6. Re-run gates + `mayPlaceAfterReview({ ..., liveQuote, quantity })`. If not ok, **do not place**.
7. **`place_option_order`** only if still armed; same params; fresh `ref_id` UUID (reuse on transport retry only).

Options only. No equities, no Tradovate, no Apex autofire. The session clock and the gates decide whether this ticket places.

## Code

| File | Role |
|------|------|
| `src/lib/execution/rh-autofire-gates.ts` | Pure triple + risk + envelope gates |
| `src/lib/execution/rh-autofire.ts` | Env flags, proposal, `proposeRhFromPathFire` (primary trigger), live quote, `mayPlaceAfterReview`, `candidateFromFloorPathStand` |
| `src/lib/execution/rh-floor-signals.ts` | CE touch / tape age / DTE from the live desk + Floor card |
| `src/lib/alerts/path-alarm.ts` | `isPathFire` (A+/A/A−/B+) — PATH fire = place trigger |
| `scripts/verify-rh-path-fire.mjs` | Pins grades, B+ explicit gate, signals, live quote, PATH fire → propose |
| `src/lib/room/manager-room-feed.ts` | REAL Manager feed from room cycles; `managerAgreeFromRoom`; `setAccountFromConnector` |
| `src/lib/room/manager-live-loop.ts` | `proposeRhFromManagerFeed` / `rhCandidateFromManagerFeed` / `ticketFromManagerState` |
| `scripts/verify-manager-live-loop.mjs` | Pins real feed → loop, stub never agrees, Owner veto, B+, live account (run from verify-rh-autofire-gates) |
| `src/lib/execution/manager-agree.ts` | Manager → Stand `agentAgree` adapter (feed.getState when Design lands) |
| `src/lib/execution/manager-account.ts` | `ManagerRoomState.account` (Agentic default snapshot, Individual display-only), `accountPlaceGate` |
| `src/lib/execution/rh-account.ts` | get_portfolio → `RhAccountSnapshot`; desk snapshot (context only) |
| `scripts/verify-rh-autofire-gates.mjs` | Pins refusals + envelope + BP gate |
| `scripts/verify-floor-rh-account.mjs` | Pins Floor RH account awareness |
| `scripts/verify-manager-agree.mjs` | Pins Manager agentAgree companion |

## Follow-ups (not in this commit)

- Per-day cooldown after a loss / max fires per session on the RH path (Floor mandate `maxSetupsPerSession` is not yet re-read RH-side).
- Monthly loss cap, `room_orders` ledger write of each review/place, sleeve sizing re-read against live BP.

## The cycle (Keaton 2026-10-07)

`decideRhCycle` (`src/lib/execution/rh-cycle.ts`) is what each desk build runs. There is no extra wait on top of that build. With the tab closed, room-step runs every minute during the session and uses the same sender.

| phase | when | what the sender does |
|-------|------|----------------------|
| look | no desk position, or the proposal is refused | nothing |
| place | `live_when_armed` and the live option id is on the ticket | `review_option_order`, then `place_option_order`, buy to open, no click |
| manage | a position this desk opened, and no exit has printed | nothing |
| close | 15:30 ET, premium at or through −25%, futures invalidation, a 15-minute failed hold, or 11:00 ET while under +50% | `review_option_order`, then `place_option_order`, sell to close |

A position this desk did not open is not closed and blocks a new open. The open desk and the room-step cron call the desk sender (`runRhDesk`): review, then place or close, on account **995386158**, through the trading MCP. The book of what this desk opened is `rh_desk_book` (one row for that account), so a cold start still manages and closes it. The sign-in is one click on the floor (`/api/rh/connect`). The refresh token stays in `rh_oauth`. Opening the desk again does not connect again. With no stored sign-in the cycle is decided and nothing is sent. Closes of a position this desk opened do not wait on a click or on the Alpaca phase. Python does not place. The brain does not place. The floor and the cron are the sender.

An A+ card that does not place is stopped by one of `managerAgreeFromRoom`'s `blocks`: `synthetic_feed`, the room beat (not a fill), `no_buy_open`, `no_entry_plan`, a failed room gate, `trigger`, `session`, an owner hold, `card`, `floor`, `floor_ticket`, `dte`, `path_band`, `path_floor`, a B+ gate, `strike_offset`, or the envelope. Two shorts can miss on different ids. LTF and MTF may flip; the higher-timeframe gate stays absolute except through `biasDisrespect`.

## The desk job: the close does not need a chat open (2026-10-08, ITEM 19)

**Route:** `GET /api/cron/rh-manage` (`src/routes/api/cron/rh-manage.ts`). **Ships OFF.**

### What was wrong

The cycle could already decide to close. Every path that actually **sent** that close was a passenger on something else:

| sender | dies when |
|--------|-----------|
| the browser poll (`room-engine.ts` → `stepRhDesk`) | the tab closes |
| `/api/cron/room-step` | the Robinhood sender sits at the **end** of a paper-book pipeline. It is never reached when the desk build fails (503), the feed is synthetic (200 skipped), the stored snapshot is not a room book (200 skipped), the room output violates its contract (500), the snapshot is oversized (500), the compare-and-swap loses to a browser write (200 skipped), or anything in `runRoomCycle` / `applyCycle` throws (500) |
| `/api/cron/exec-flatten` | only runs from 15:30 ET |

So a wick that broke the level at 10:05 with the tab closed had no closer until **15:30** unless the paper book happened to write cleanly that minute. `rh-manage` is the close path with nothing upstream of it: no paper book, no snapshot, no room cycle, no contract check. Read the broker, read the desk, decide, close.

### It cannot open — four independent layers

1. `manager: null` — with no live Manager there is no `AGREE_LIVE` ticket to place.
2. `blockNewEntries: true` — `runRhDesk` rewrites a `place` phase to `look`.
3. `closeOnlyTooling` — in the route itself: `review` returns a blocking alert and `place` **throws** on any leg that is not `{ side: "sell", position_effect: "close" }`. This layer lives in the caller on purpose, so a future edit to `rh-dispatch.ts` cannot quietly turn this job into an opener.
4. The arm (below).

Each layer is tested alone in `scripts/verify-rh-desk-job.mjs`, against a **control** that proves the same configuration does open when the sender is called normally.

### What it closes

Only what this system opened. `sqlLedger` (`rh_desk_book`) is the desk book, and `runRhDesk` leaves a Robinhood position with no row in it alone. There is no "flatten everything" here — that is `exec-flatten`.

### Stale or synthetic feed

The desk is passed **only** when the feed is real and inside `RH_MAX_TAPE_AGE_SEC` (30 s). Otherwise `desk: null` goes in, which is a hard refusal to read a level off a price we do not trust: with no desk the **futures invalidation and the 15-minute failed hold cannot fire at all**. What still fires is priced on broker numbers, which are always current — the −25% premium backstop, the drawdown breaker, and 15:30 ET.

This is deliberately **not** "send nothing on a stale feed". That reading would disable the −25% backstop exactly when the tape is misbehaving, which is worse than closing on a number the broker just quoted. Flagged as a judgement call, not a measurement.

### One wick, one close

| mechanism | what it stops |
|-----------|----------------|
| `refIdFor("close:<decisionKey>")` is a **stable** uuid per position, passed to `place_option_order` as `ref_id` (`rh-mcp.ts`) | a resend of the same close, deduped broker-side |
| a sent close drops the row from `rh_desk_book` | the next run has nothing to close |
| `ledger.claim(now)` — the route takes the one placement slot (a single conditional `UPDATE`, so two instances cannot both win) **before** it sends, and only when a desk-owned row exists | two serverless instances closing the same wick |
| an in-process `inFlight` guard | the same instance being rung twice |

No row means nothing to close, so the slot is left alone and an opener is never delayed by this job.

### Arm and kill switch

| switch | where | default |
|--------|-------|---------|
| `RH_DESK_JOB_CONFIRMED_IN_WRITING` | `src/routes/api/cron/rh-manage.ts` (code constant) | **`false`** — only a human edits that line |
| `RH_DESK_JOB_ENABLED` | env | unset = off. Must be exactly `true` |

**Both** are required. Setting the env var alone does nothing; editing the constant alone does nothing. `RH_DESK_JOB_ENABLED` is read per request, so flipping it in Netlify stops the job on the next minute with no deploy — that is the kill switch. The Execution card's own kill (`room_exec_state.killed`) is read and reported; it blocks entries and by design does **not** trap a close.

### Where the Robinhood refresh token actually lives

In Postgres: table **`rh_oauth`**, one row per `user_id`, written by `/api/rh/callback` and read by `readOauth` → `ensureAccess` → `toolingForDesk` (`rh-oauth.ts`, `rh-mcp.ts`). It never reaches the browser, git or a log line. The access token is short-lived and refreshed in place; `invalid_grant` drops the row and the trader signs in once more.

**Can a Netlify scheduled function reach it? Yes — with two conditions.**

1. `DATABASE_URL` must be the real Supabase **transaction pooler** host. Without a working one `db.ts` falls back to ephemeral PGLite, where `rh_oauth` is empty on every cold start, so the job finds no sign-in and sends nothing.
2. `CRON_USER_ID` must be the trader's own user id. A cron has no session, so it uses `cronUserId()`; a wrong id reads no token, `toolingForDesk` falls through to `RH_ACCESS_TOKEN` (normally unset) and returns `null`. The route reports `userId` and `linked` in its own response precisely so that failure is visible instead of silent.

The function itself is not the sender — the SSR route is (that is the function with the database), exactly as `netlify/functions/room-step.mjs` rings `/api/cron/room-step`. A ringer for this route is listed under **Still missing**.

### Before it is switched on

Every line below must be true. None of them is checked by code; they are the trader's to confirm.

1. `DATABASE_URL` is the Supabase pooler host, and `select 1 from rh_oauth where user_id = '<CRON_USER_ID>'` returns a row. (Grep any new value for `db.` + `.supabase.co` first — that trap has bitten twice.)
2. `CRON_USER_ID` equals that `user_id`. Run `?force=1` once and read `detail.userId` / `detail.linked` in the response.
3. `CRON_SECRET` is set on the site, and an unauthenticated `GET` of the route returns **401** (503 would mean the secret is missing).
4. The ringer and the schedule exist (**Still missing** below), and a forced run has been seen returning `ran: true` with `phase: "manage"` on a real open position.
5. At least one close has been observed end to end **in the browser path** first, so the review → place shape is known good on a real Robinhood response.
6. `scripts/verify-rh-desk-job.mjs` passes, and `npx tsc --noEmit` is clean.
7. The trader has read the stale-feed trade-off above and accepts that a refused feed leaves the level stop inactive until the tape recovers.
8. Only then: set `RH_DESK_JOB_ENABLED=true` **and** edit `RH_DESK_JOB_CONFIRMED_IN_WRITING` to `true` in the route.

### Still missing

- **A scheduler.** Not wired, because `vercel.json`, `netlify/functions/*` and `scripts/install-netlify-cron.mjs` are owned elsewhere. What is needed: `netlify/functions/rh-manage.mjs`, a copy of `room-step.mjs` with the path and log label changed and `export const config = { schedule: "* 13-21 * * 1-5" }`; `"rh-manage.mjs"` added to the copy list in `install-netlify-cron.mjs`; and `/api/cron/rh-manage` at `"*/2 13-21 * * 1-5"` in `vercel.json` if the site ever runs there. Until then the route only answers a manual `?force=1` or any scheduler that can send the bearer header.
- **The row is dropped when the close is SUBMITTED, not when it fills** (`placeOrder` in `rh-dispatch.ts`). An unfilled close therefore turns the position into a "foreign" one the desk will never close again. That is good idempotency and bad management. The fix belongs in `rh-dispatch.ts` / `rh-ledger.ts`: keep the row, stamp `closingRefId` + `closingAt` on it, and drop it only once `get_option_positions` no longer lists the contract (or re-send the same `ref_id` after a timeout). Not done here — those files are owned elsewhere this pass.
- **The 11:00 rule is not in the cycle.** `RH_DAY_FLAT_MIN` and `RH_PAST_ELEVEN_MIN_PCT` are exported from `rh-cycle.ts` and read by nothing; `decideRhCycle` applies 15:30, −25%, the level and the failed hold only. The table above ("11:00 ET while under +50%") describes the mandate, not the code. Belongs in `rh-cycle.ts`.
- **No live Robinhood response has been seen through this route.** The guard, the gates and the sender are tested against a simulated `RhTooling` on PGLite, not against Robinhood's servers.

## Do not

- Deploy Netlify (Release Watch owns that).
- Call `place_option_order` without env arms + confirmation + clean review.
- Place overnight / before the NY open checklist above.
