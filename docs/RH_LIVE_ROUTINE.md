# Robinhood live options routine (live-when-armed)

**Status:** implemented as pure gates + proposal builder. Production mode is **live when armed**. Paper (Floor Alpaca `room/exec`, desk `auto-paper`) stays for testing.

Keaton confirmed in writing in chat **2026-10-06** that he wants live RH options when Floor + PATH + Stand agree, for the next NY morning session. `RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING` is **true** in code. Env arms stay **off until ~09:30 ET** — flip them then; do **not** place overnight.

## ⛔ Accuracy Review: NO-GO — stay disarmed (2026-10-06)

Accuracy Review is **NO-GO** until **both**:

1. the **hard BP gate** (`evaluateRhBuyingPower`) passes on a **fresh** `get_portfolio` read of the trade account, **and**
2. the trade account is **accessible** to the agent (`agentic_allowed=true`, option level ≥ 2) and funded so BP ≥ $150.

Until then `RH_OPTIONS_AUTOFIRE_ENABLED` and `RH_LIVE_ARMED` stay **false** (repo, `.env.example`, host). Do not arm. Do not place. `RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING` is unchanged.

**Trade account (revised 2026-10-06):** **Agentic ••6158** — `account_number` **`995386158`** (`RH_PREFERRED_ACCOUNT_NUMBER`), option_level_2, limited_margin, `agentic_allowed=true`. **$0 until Keaton funds ~$1000 at ~08:30 ET.** `DEFAULT_MANAGER_ROOM_ACCOUNT` is the Agentic $0 snapshot (`isSnapshot=true` → can never authorize). **Individual ••7477** (`415577477`) is **display-only** — every BP / place gate refuses it (`bp_wrong_account`).

## Triple agreement (all required)

1. **Floor desk** — options card `verdict === "ARMED"` and `deskContracts >= 1` (Floor characters cite SMC research + live PATH scanner).
2. **Live PATH scanner** — actionable, PATH band A+/A/A−, confluence ≥ **0.65**.
3. **Trading Stand (agent)** — `agentAgree === true` for this cycle (explicit; absence refuses).

Plus: options session open, no news blackout, no risk halt, one-book clear.

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
| `RH_OPTIONS_AUTOFIRE_ENABLED=true` | env | off until morning arm |
| `RH_LIVE_ARMED=true` | env | off until morning arm — **required before any place** |
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
| `options_level` | options level < 2 or unknown |
| `bp_floor` | spendable < **$150** — nothing in the $150–$550 envelope can place |
| `bp_ticket` | spendable < this ticket's debit |

Spendable = `buying_power.buying_power` (and options BP when reported) — **never `cash`**: on a cash account unsettled proceeds sit in cash but are not spendable.

**Manager block side:** `mayPlaceAfterReview` now **requires** `account` (`ManagerRoomState.account`) — omitting it refuses (was fail-open). `accountPlaceGate` refuses: no block · not account 995386158 · not agent-accessible · level < 2 · static snapshot (`bp_snapshot`) · BP unknown · BP < $150 (recomputed, `canFillEnvelope` not trusted) · BP < ticket debit.

### Floor rules on the RH path (`evaluateRhFloorRules`, fail closed)

Run after risk/session/one-book, before Floor/PATH/Stand, on `flags.nowMs`:

| gate | rule (mandate.ts) |
|------|------|
| `after_11` | no new entries at/after **11:00 ET** |
| `aplus_after_10` | after **10:00 ET** PATH band must be **A+** |
| `dte` | **DTE 0 or 1**; missing → refuse |
| `tape_unknown` / `tape_stale` | desk tape age **≤ 30 s**; missing → refuse |
| `ce_touch` | CE touch must be confirmed (`ceTouch === true`) |

**TODO(floor):** wire `ceTouch` / `tapeAgeSec` / `dte` from the live Floor card into `candidateFromFloorPathStand`. Until wired, autofire refuses by design.

**Desk today (screenshot + read-only get_portfolio 01:46 UTC):** Individual ••7477, cash account, $984.12 cash, $972.56 unsettled, **$11.56 buying power**, options level 2, −$179.84 (−15.45%) today. → `bp_floor` blocks every ticket. The Individual account is also not tradable by this agent (`account_access`), and the Agentic ••6158 trade account (option_level_2, limited_margin) has $0 until funded → `bp_floor`. The Floor seats quote this (`rhAccountNote` / `rhArmedPathNote`).

### 09:08 ET prep → ~09:30 ET arm checklist

**Host flip required tomorrow** — both env arms stay `false` in repo / `.env.example`. Release Watch / host must set them at open; this commit does not arm live.

**09:08 ET (prep — do not place yet)**

1. Confirm desk + Floor are up; PATH scanner live; Trading Stand Manager `agentAgree` path wired.
2. Confirm `agentic_allowed` and options level ≥ 2 on **Agentic 995386158** (`get_accounts`); `get_portfolio(account_number=995386158)` → BP ≥ $150 after funding.
3. Confirm envelope still: **$150–$550**, **1–4** contracts, **ATM / OTM_1** only; review then place.
4. Confirm both env flags still **false** until you are ready to arm.

**~09:30 ET (arm — host only)**

5. Set in the runtime env (Release Watch / host — **not** this commit, **not** Netlify from this agent):
   - `RH_OPTIONS_AUTOFIRE_ENABLED=true`
   - `RH_LIVE_ARMED=true`
6. Agent loop: `get_portfolio` → Floor ARMED + PATH A+/A/A− + Stand `agentAgree` + BP ≥ $150 → `proposeRhLiveOption` → **`review_option_order`** → `mayPlaceAfterReview` → only then **`place_option_order`**.
7. Disarm after the session or on any doubt: unset / set both env flags false.

## Agent send path (user-Robinhood-xai)

There is **no** `preview_option_order` tool. Use **`review_option_order`** as the preview.

1. Build candidate + ticket (ATM/OTM_1, 1–4 ct, $150–$550); set `agentAgree` only when Stand agrees.
2. `proposeRhLiveOption(...)` — if `mode !== "live_when_armed"`, stop.
3. `get_accounts` — require `agentic_allowed` and option level ≥ 2.
4. `get_option_chains` → `get_option_instruments` — fill `option_id`.
5. **`review_option_order`** with limit from quote (prefer ask + $0.02). Surface alerts verbatim.
6. Re-run gates + `mayPlaceAfterReview(...)`. If not ok, **do not place**.
7. **`place_option_order`** only if still armed; same params; fresh `ref_id` UUID (reuse on transport retry only).

Options only. No equities, no Tradovate, no Apex autofire. **Do not place tonight.**

## Code

| File | Role |
|------|------|
| `src/lib/execution/rh-autofire-gates.ts` | Pure triple + risk + envelope gates |
| `src/lib/execution/rh-autofire.ts` | Env flags, proposal, `mayPlaceAfterReview`, `candidateFromFloorPathStand` |
| `src/lib/execution/manager-agree.ts` | Manager → Stand `agentAgree` adapter (feed.getState when Design lands) |
| `src/lib/execution/manager-account.ts` | `ManagerRoomState.account` (Agentic default snapshot, Individual display-only), `accountPlaceGate` |
| `src/lib/execution/rh-account.ts` | get_portfolio → `RhAccountSnapshot`; desk snapshot (context only) |
| `scripts/verify-rh-autofire-gates.mjs` | Pins refusals + envelope + BP gate |
| `scripts/verify-floor-rh-account.mjs` | Pins Floor RH account awareness |
| `scripts/verify-manager-agree.mjs` | Pins Manager agentAgree companion |

## Do not

- Deploy Netlify (Release Watch owns that).
- Call `place_option_order` without env arms + confirmation + clean review.
- Place overnight / before the NY open checklist above.
