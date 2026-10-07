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
- **Loop:** `proposeRhFromManagerFeed({ feed, fire, account, liveQuote, desk?, env })` (`src/lib/room/manager-live-loop.ts`) → `candidateFromFloorPathStand({ manager: managerStateForAgree(feed), ceTouch, tapeAgeSec, dte, seqTake, vetoed, ... })` → `proposeRhFromPathFire` → `proposeRhLiveOption`. Signals come from the same room cycle (`ManagerRoomState.signals`: CE = room `trigger` gate, tape = now − frame time, DTE = card, SEQ = card SMC word, veto = room/Stand/Owner). Returns a shape; never places.
- **Account:** `feed.setAccountFromConnector({ account: get_accounts row, portfolio: get_portfolio data })` → `managerRhAccountFromConnector` → `ManagerRoomState.account`. Until injected, it is the Agentic $0 **snapshot** (can never authorize).

## Risk envelope (Keaton 2026-10-06)

| Rule | Bound |
|------|--------|
| Total debit | **$150 min – $550 max** |
| Contracts | **1–4** |
| Strike | **ATM or 1 strike OTM only** (`ATM` / `OTM_1`) |

Enforced in `evaluateRhTicketEnvelope` before any review/place shape is built.

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

`decideRhCycle` (`src/lib/execution/rh-cycle.ts`) is what the desk's quote poll runs. There is no five-minute timer.

| phase | when | what the sender does |
|-------|------|----------------------|
| look | no desk position, or the proposal is refused | nothing |
| place | `live_when_armed` and the live option id is on the ticket | `review_option_order`, then `place_option_order`, buy to open, no click |
| manage | a position this desk opened, and no exit has printed | nothing |
| close | 15:30 ET, premium at or through −25%, futures invalidation, a 15-minute failed hold, or 11:00 ET while under +50% | `review_option_order`, then `place_option_order`, sell to close |

A position this desk did not open is not closed and blocks a new open. The poll writes the phase. It does not send. The sender is the agent with a fresh `get_portfolio` and `get_option_quotes`. Account **995386158** only.

An A+ card that does not place is stopped by one of `managerAgreeFromRoom`'s `blocks`: `synthetic_feed`, the room beat (not a fill), `no_buy_open`, `no_entry_plan`, a failed room gate, `trigger`, `session`, an owner hold, `card`, `floor`, `floor_ticket`, `dte`, `path_band`, `path_floor`, a B+ gate, `strike_offset`, or the envelope. Two shorts can miss on different ids. LTF and MTF may flip; the higher-timeframe gate stays absolute except through `biasDisrespect`.

## Do not

- Deploy Netlify (Release Watch owns that).
- Call `place_option_order` without env arms + confirmation + clean review.
- Place overnight / before the NY open checklist above.
