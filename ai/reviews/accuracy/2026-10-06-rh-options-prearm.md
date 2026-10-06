# Pre-arm review: Robinhood live options (Tue Oct 6 2026 NY AM)

**Commit reviewed:** `86e592f` (`origin/main` tip after `git fetch`; message: *research: add 2026-10-06 NY AM session brief for Keaton desk*).  
**Scope:** read-only. No push, deploy, env flip, arm, preview, or place.  
**Claim under test:** Trading Stand plans live RH Individual options tomorrow morning via Floor + PATH + Manager; envelope **$150–$550** debit, **1–4** contracts, **ATM / OTM_1**. Reported **options buying power ≈ $11.56**.

**Docs checked:**
| Path | Present? |
|------|----------|
| `ai/NOW.md` | **No** |
| `ai/DECISIONS.md` | **No** |
| `ai/research/2026-10-06-ny-am-session-brief.md` | Yes (macro/levels; no BP / arm numbers) |
| `docs/RH_LIVE_ROUTINE.md` | Yes — primary RH live SOP |
| `CLAUDE.md`, `AGENTS.md`, `src/lib/aplus/config.ts` | Yes |
| `graphify-out/GRAPH_REPORT.md` | **No** |

---

## Overall verdict: **NO-GO**

Hard blockers: (A) envelope floor **$150** > reported options BP **~$11.56** with **no RH buying-power gate** that fails closed; (B) RH path is agent-MCP only and omits several Floor hard gates (CE touch, fresh tape, A+ after 10:00, DTE, BP); (C) docs still cite **$1,000** max debit vs live envelope **$550**. Env arms are correctly off in `.env.example`, but that alone does not make tomorrow safe to arm.

---

## 1. Is there a Robinhood live execution path? vs Alpaca?

| Item | Result | Citation |
|------|--------|----------|
| RH live path in repo | **PASS (exists, agent-driven)** | Pure gates + proposal builder: `src/lib/execution/rh-autofire-gates.ts`, `rh-autofire.ts`, `manager-agree.ts`. SOP: `docs/RH_LIVE_ROUTINE.md:1-64`. Explicit: **Node never places**; agent calls MCP `review_option_order` then `place_option_order` (`.env.example:88-89`, `RH_LIVE_ROUTINE.md:52-62`). |
| Automated in-app RH placer | **FAIL / absent** | No `CallDynamicTool` / `place_option_order` in `src/lib/execution/*`. `proposeRhLiveOption` only builds a shape (`rh-autofire.ts:130-167`). |
| Floor broker path | **Alpaca only** | `src/lib/room/exec/*` — paper/shadow/live via Alpaca. `EXEC_FLAGS` all **false**: `OPTIONS_LIVE_CONFIRMED_IN_WRITING`, `SERVER_RUNNER_BUILT`, `EXIT_ESCALATION_VERIFIED_ON_PAPER` (`exec/limits.ts:45-55`). `maxTicketUsd: 1000` (`:12-13`). |
| Flags that must flip for RH live | Env (default **false**): `RH_OPTIONS_AUTOFIRE_ENABLED`, `RH_LIVE_ARMED` (`.env.example:94-96`). Code constant already **true**: `RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING = true` (`rh-autofire-gates.ts:24`). Place also needs `mayPlaceAfterReview`: agentic_allowed, options level ≥ 2, no blocking review alert (`rh-autofire.ts:169-187`). |

**Summary:** There *is* an RH live *proposal* path for the Trading Stand agent. It is **not** the Floor Alpaca executor. Alpaca live remains fully disarmed. Repo env defaults keep RH arms off; written confirmation is already flipped on in code.

---

## 2. Envelope $150–$550 / 1–4 / ATM·OTM_1 vs code

| Rule | Code | Match? |
|------|------|--------|
| Min debit $150 | `RH_MIN_DEBIT_TOTAL = 150` (`rh-autofire-gates.ts:10`) | **PASS** |
| Max debit $550 | `RH_MAX_DEBIT_TOTAL = 550` (`:11`) | **PASS** |
| Contracts 1–4 | `RH_MIN_CONTRACTS = 1`, `RH_MAX_CONTRACTS = 4` (`:12-13`) | **PASS** |
| ATM / OTM_1 only | `RH_ALLOWED_OFFSETS = ["ATM","OTM_1"]` (`:15-16`); envelope gate (`:88-91`) | **PASS** |
| Enforced before place shape | `proposeRhLiveOption` → `evaluateRhTicketEnvelope` (`rh-autofire.ts:151-158`) | **PASS** |
| Verifier pins envelope | `scripts/verify-rh-autofire-gates.mjs` (min/max/contracts/OTM_2) | **PASS** |

**Conflicts with older desk sizing (not the RH envelope file):**
- `MAX_DEBIT_USD = 1_000` (`sleeve-sizing.ts:56`) — CLAUDE.md RH sleeve row still **$1,000 max DEBIT**.
- Floor `evaluateEntry` caps with `Math.min(capFrac * cash, MAX_DEBIT_USD)` (`orchestrator.ts:664`) → **$1,000**, not $550.
- Alpaca `EXEC_LIMITS.maxTicketUsd: 1000` (`exec/limits.ts:12-13`).

So the **agent RH envelope matches the Stand plan numbers**, but **house options sizing / CLAUDE.md / Floor / Alpaca still say $1,000**. Arming RH on $550 without updating those is a policy fork, not a silent code alignment.

---

## 3. Doc / code mismatches on gates (ARMED, CE, fresh tape, DTE, A+ after 10, cooldown, halts, exits)

### What RH autofire gates *do* check
`evaluateRhAutofireGates` (`rh-autofire-gates.ts:95-138`):
autofire on · live armed · confirmed · riskHalt · newsBlackout · optionsSessionOpen · oneBookBlocked · Floor `ARMED` · deskContracts ≥ 1 · pathActionable · PATH band A+/A/A− · confluence ≥ **0.65** · `agentAgree === true`.

### What Floor `evaluateEntry` checks that RH gates **omit**

| Gate | Floor | RH autofire | Verdict |
|------|-------|-------------|---------|
| ARMED + deskContracts ≥ 1 | Yes | Yes (`:118-122`) | Align |
| PATH A+/A/A− + actionable | Via options desk | Yes (`:124-129`) | Align (RH also requires confluence ≥ 0.65) |
| **CE touch** (`tier === "live"`) | Hard: waiting until touch (`orchestrator.ts:802-812`) | **Not in RH gates** | **Mismatch / gap** |
| **fresh_tape ≤ 30s**, non-synthetic | `EXEC_LIMITS.maxFeedLagSec` (`orchestrator.ts:540-557`; `exec/limits.ts:29`) | **Absent** | **Mismatch / gap** |
| **DTE ∈ {0,1}** | `ROOM_MANDATE.dteAllowed` (`mandate.ts:16`; orchestrator gate) | Ticket has `dteTarget` field only; **envelope does not validate DTE** | **Gap** |
| **A+ after 10:00 ET** | `ROOM_CLOCK.aPlusOnlyAfterMin` (`mandate.ts:32`; `orchestrator.ts:643-647`) | **Absent** | **Mismatch** |
| Cool-down after 2 losses | `MAX_CONSEC_LOSSES` (`orchestrator.ts:593+`) | Only if caller sets `riskHalt` | **Soft / unknown wiring** |
| Daily 2% / weekly 5% halt | Floor ledger vs `APLUS_RULES` (`config.ts:43-44`) | `riskHalt` boolean only — **who sets it on RH path is unspecified in code** | **Unknown / gap** |
| Month PATH cap → A+ only | Floor (`orchestrator.ts:649-655`) | **Absent** | **Mismatch** |
| Killzone max 2 | Floor (`orchestrator.ts` killzone gate) | **Absent** | **Mismatch** |
| 11:00 day flat / no new entries | `before_flat` (`orchestrator.ts` ~636-641); `dayFlatMin` (`mandate.ts:25`) | Session open 09:30–16:00 only (`:112-113`) — **allows entries after 11:00** | **Mismatch** |
| 15:30 flatten | Floor exits / cron exec-flatten (Alpaca) | **No RH flatten automation in this path** | **Gap** |

`docs/RH_LIVE_ROUTINE.md` claims triple Floor+PATH+Stand and envelope; it does **not** claim CE / fresh tape / A+ after 10 are re-checked inside `evaluateRhAutofireGates`. Relying on “Floor already ARMED” is insufficient: Floor ARMED can exist while price is still ARMED/FORMING (limit not touched); Floor refuses BUY until CE live (`orchestrator.ts:802-812`), but RH proposal can pass without that bit.

---

## 4. Option pricing: model BS vs live chain

| Layer | Pricing | Live-safe? |
|-------|---------|------------|
| Floor paper / quant / meetings | Black-Scholes r=0, VIX-scaled IV (`option-math.ts`; CLAUDE.md); fills at **model** ask/bid (`paper-book.ts:9-11`) | Paper only |
| RH `buildRhReviewPlaceShape` | `priceHint = estDebitEach + 0.02` (`rh-autofire.ts:110-118`); `optionId: null` until agent fills | Hint only |
| Intended live price | SOP: `get_option_chains` → instruments → **`review_option_order`** with limit from **quote (prefer ask + $0.02)** (`RH_LIVE_ROUTINE.md:59-61`) | **Agent discipline**, not enforced in TypeScript gates |
| Alpaca live | Real broker quote age/spread/model-divergence gates (`exec/gates.ts`); live needs OPRA (`:143`) | Separate path; still disarmed |

**Blocker for unattended live:** no TypeScript gate requires a fresh chain mid/ask, max spread, or model-vs-chain divergence on the RH path (contrast Alpaca `maxQuoteAgeSec` 15, `maxSpreadFrac` 0.15, `maxModelDivergence` 0.35 in `exec/limits.ts:17-22`). If the agent places off `priceHint` / model `estDebitEach` without a clean `review_option_order`, that is live risk. Marked **conditional blocker** (process), not a missing file.

---

## 5. Buying power vs $150 minimum (Stand report ≈ $11.56) — **BLOCKER**

| Question | Finding | Cite |
|----------|---------|------|
| Does RH autofire hard-block when BP < min debit or < order cost? | **NO** | `evaluateRhTicketEnvelope` only checks contracts/debit/strike (`rh-autofire-gates.ts:76-93`). `evaluateRhAutofireGates` has no BP field (`:95-138`). `mayPlaceAfterReview` checks agentic_allowed + options level only — **not BP** (`rh-autofire.ts:169-187`). |
| Where is BP read for RH? | **Nowhere in RH modules** | Checklist tells the **agent** to call `get_accounts` for agentic_allowed / level ≥ 2 (`RH_LIVE_ROUTINE.md:40,58`) — not for options buying power vs debit. |
| Fail closed when BP unknown? | **NO on RH path** | Unknown BP does not refuse. Contrast Alpaca: unreadable account → `no_account` (`exec/gates.ts:115`); cost > `optionsBuyingPower ?? buyingPower` → `buying_power` (`:154-155`). |
| Arithmetic | Envelope **refuses debit &lt; $150** (`:82-83`) while reported BP **~$11.56** → any qualifying envelope ticket is **unfundable**. Broker would reject; code would still propose `mode: "live_when_armed"` if arms flip. | |

**PASS as a finding / FAIL as readiness:** With ~$11.56 options BP, live RH under this envelope is **impossible**. Absence of a BP gate means the system does **not** fail closed — it can still emit a placeable proposal after env arm. **This alone is enough for NO-GO.**

Unknowns: exact RH MCP field name for options buying power on Individual; whether $11.56 is day-trade vs options BP; whether funding lands before 09:30 ET. None of those change the missing-gate finding.

---

## 6. Paper vs live book separation / audit

| Book | Storage | Notes |
|------|---------|-------|
| Floor options paper | `ledger-room-book-v1` + `room_snapshot` | Separate from futures paper (`paper-book.ts:4-7`) |
| Alpaca shadow/paper/live | `room_orders` / exec audit | Only if Execution card phase armed — currently live flags false |
| RH live fills | **Not written by desk TS** | Placement is MCP agent-side. No `room_orders` row from `rh-autofire.ts`. Audit = agent/RH history — **not verified here** |

**Gap:** live RH P&amp;L will not automatically land in Floor paper or Alpaca audit. Risk of double-counting or “ghost” live fills vs desk stats if Stand places while Floor also papers.

---

## 7. Confluence floor 0.65 on the live RH path

| Check | Result | Cite |
|-------|--------|------|
| `APLUS_RULES.confluenceFloor` | **0.65** | `config.ts:21-23` |
| RH path | `RH_PATH_FLOOR = 0.65`; refuse if `confluence < RH_PATH_FLOOR` | `rh-autofire-gates.ts:9,131-133` |
| Also requires PATH band A+/A/A− | Yes | `:127-129` |

**PASS** — live RH proposal path respects 0.65 (duplicated constant, not imported from `config.ts`, but same number). Drift risk if one is edited without the other — minor.

---

## 8. Other blockers / CLAUDE.md mismatches

1. **BP ≪ envelope floor** — §5 (**hard NO-GO**).
2. **CLAUDE.md RH sleeve still $1,000 max debit / size-from-stop** vs RH live envelope $150–$550 / 1–4 / ATM·OTM_1 (`CLAUDE.md` hard-rules RH row; `sleeve-sizing.ts:56`). Policy fork.
3. **RH omits CE touch, fresh tape, A+ after 10:00, DTE validation, 11:00 no-new, month/cooldown** — §3.
4. **`RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING = true` already** while env arms false — reduces one safety layer; env alone must hold (`rh-autofire-gates.ts:24`, `.env.example:94-96`).
5. **Manager `agentAgree`** is duck-typed; absent Manager → false (`manager-agree.ts:6-7,48-49`). Safe default, but Stand must actually supply `manager` / `managerCall` or explicit agree — wiring quality outside this review’s runtime.
6. **No RH exit automation** for 11:00 / 15:30 / −20% / level — CLAUDE/Floor mandate exits won’t auto-fire on RH MCP fills.
7. **Halt room “$2000”**: daily halt is **2% of equity** (`config.ts:43`; Floor uses `dayStartEquity`). On $100k paper desk → $2,000 room; on Floor $10k start → $200; on RH Individual with ~$11.56 options BP the 2% figure is **not** what constrains size — **cash/BP does**. Do not treat “halt room $2000” as RH buying power.
8. **ai/NOW.md / DECISIONS.md / graphify-out** missing — no conflicting GO recorded there; session brief does not authorize arming.

---

## Pass/fail scoreboard

| # | Question | Verdict |
|---|----------|---------|
| 1 | RH live path exists; Alpaca separate; flags | **PASS** (path exists) / Alpaca live **DISARMED** / RH env **DISARMED** / confirm const **ARMED in code** |
| 2 | $150–$550 / 1–4 / ATM·OTM_1 | **PASS** vs `rh-autofire-gates.ts`; **FAIL** vs CLAUDE/$1000 sleeve |
| 3 | Gate alignment (CE, fresh tape, DTE, A+@10, exits) | **FAIL** (multiple omissions) |
| 4 | Live chain pricing enforced in TS | **FAIL / conditional** (SOP only) |
| 5 | Paper/live separation & RH audit | **PARTIAL** (books separate; RH audit not in desk DB) |
| 6 | Other blockers | **FAIL** — BP **$11.56 ≪ $150**; confirm-in-writing already true |
| BP gate | Hard-block / fail-closed when BP &lt; debit | **FAIL — BLOCKER** |
| 0.65 floor on RH live path | | **PASS** (`RH_PATH_FLOOR`) |

---

## Conditions that would be required before any future GO (not met)

1. Options buying power **≥ $150** (ideally ≥ planned debit), with a **code gate** that refuses when `optionsBuyingPower < debit` or BP unknown (mirror `exec/gates.ts:115,154-155`).
2. Env arms only after checklist; prefer leaving written confirmation as an independent human flip until BP/gates are solid.
3. Wire or re-check **CE touch + fresh_tape ≤30s + DTE 0/1 + A+ after 10:00** on the RH candidate builder, not only Floor ARMED.
4. Reconcile CLAUDE.md / `MAX_DEBIT_USD` with the $550 envelope.
5. Define RH live exit / flatten procedure (11:00 / 15:30 / level) and logging destination.
6. Chain quote from `review_option_order` mandatory before `place_option_order` (already in SOP; keep as hard agent rule).

Until (1) at minimum, **do not set `RH_OPTIONS_AUTOFIRE_ENABLED` or `RH_LIVE_ARMED`.**

---

*Reviewer: Grok Bot executor subagent. Commit `86e592f`. Date context: Tue Oct 6 2026.*

---

## Re-review b8e76f4

**Commit:** `b8e76f468bf1c9487c5f6d38f88d15d47e2e14f0` (detached HEAD; message: *rh: Agentic 995386158 trade account + BP gate fail-closed on unknown/wrong account + Floor rules*).  
**Diff base:** `86e592f` → `b8e76f4` (RH gates/account/manager + verify scripts + `docs/RH_LIVE_ROUTINE.md`).  
**Scope:** read-only. No push, deploy, env flip, arm, preview, or place.  
**Tests run:** `npx tsx scripts/verify-rh-autofire-gates.mjs` → **152 passed, 0 failed**; `npx tsx scripts/verify-floor-rh-account.mjs` → **21 passed, 0 failed**. (`node_modules` already present; `npm ci` not required.)

### Trading Stand claims

| Claim | Verdict | Citation / evidence |
|-------|---------|---------------------|
| (a) RH options BP gate fails closed when BP < $150 or BP unknown | **PASS** | `evaluateRhBuyingPower` `rh-autofire-gates.ts:115-162`: no account → `bp_unknown`; non-`get_portfolio` → `bp_source`; wrong account # → `bp_wrong_account`; non-finite BP → `bp_unknown`; stale >5m → `bp_stale`; spendable < $150 → `bp_floor`; debit > BP → `bp_ticket`. Wired into `evaluateRhAutofireGates` (`:283`) and `mayPlaceAfterReview`. |
| (b) Preferred account = Agentic ••••6158, not Individual | **PASS** | `RH_PREFERRED_ACCOUNT_NUMBER = "995386158"` (`rh-autofire-gates.ts:40-42`); Individual `415577477` display-only (`rh-account.ts:61`, `manager-account.ts:11-14,31`). Wrong account refused at BP gate (`:126-130`). |
| (c) 152 gate tests pass | **PASS (measured)** | `verify-rh-autofire-gates.mjs` output: **`152 passed, 0 failed`**. (Floor RH account script separately: 21/21.) |
| (d) 11:00 no-new-entries in `evaluateRhFloorRules`; fail-closed if signals missing | **PASS (code)** | `evaluateRhFloorRules` `rh-autofire-gates.ts:244-268`: `after_11` when `min >= ROOM_CLOCK.dayFlatMin`; missing `dte` / `tapeAgeSec` / `ceTouch !== true` → `dte` / `tape_unknown` / `ce_touch` refuse. **Caveat:** TODO(floor) (`:241-243`) — `candidateFromFloorPathStand` does not yet auto-feed `ceTouch`/`tapeAgeSec`/`dte` from the live Floor card → autofire stays refused until wired or agent supplies them. |
| (e) Env arm flags still false | **PASS** | `.env.example:94-96` — `RH_OPTIONS_AUTOFIRE_ENABLED=false`, `RH_LIVE_ARMED=false`. SOP still says host flip only (`RH_LIVE_ROUTINE.md` arm checklist). |

### Earlier FAIL items at this commit

| Item | At `86e592f` | At `b8e76f4` | Notes |
|------|--------------|--------------|-------|
| Fresh tape ≤30s | FAIL (absent) | **PASS (gate) / CONDITIONAL (wiring)** | `tape_unknown` / `tape_stale` in `evaluateRhFloorRules` (`:260-263`); `RH_MAX_TAPE_AGE_SEC`. Not auto-fed from Floor card yet. |
| CE touch | FAIL | **PASS (gate) / CONDITIONAL (wiring)** | `ce_touch` refuse if `ceTouch !== true` (`:266-267`). Same wiring TODO. |
| DTE 0/1 | FAIL | **PASS (gate) / CONDITIONAL (wiring)** | `dte` gate vs `ROOM_MANDATE.dteAllowed` (`:256-257`). Same wiring TODO. |
| A+ after 10:00 | FAIL | **PASS** | `aplus_after_10` (`:254-255`). |
| Cool-down / month PATH cap | FAIL | **FAIL (still absent)** | Not in `rh-autofire-gates.ts` (only Floor `evaluateEntry` / Apex path). |
| Live-chain price vs model `priceHint` | FAIL / SOP | **FAIL / SOP only** | `priceHint = estDebitEach + $0.02` (`rh-autofire.ts:139-146`); TS does not re-check live chain vs model like Alpaca quote gates. SOP still requires `review_option_order` before place. |
| $1,000 sleeve vs CLAUDE.md | FAIL (fork) | **FAIL (fork remains)** | RH envelope still $150–$550 (`RH_MAX_DEBIT_TOTAL = 550`); CLAUDE.md options sleeve / `MAX_DEBIT_USD` / Floor / Alpaca still **$1,000**. |
| `room_orders` audit for RH fills | FAIL | **FAIL** | RH place remains agent-MCP; no desk `room_orders` write on RH path. |
| 15:30 flatten | Gap (manual) | **Gap (still manual on RH)** | Alpaca has cron `exec-flatten`; RH path has no automated 15:30 flatten in this commit. SOP/agent must flatten manually. |

### B+ / PATH-fire concern (in-flight push risk)

| Check | Result |
|-------|--------|
| What is B+? | `config.ts:88`: score in `[confluenceFloor−0.05, confluenceFloor)` → **0.60–0.65**. Below `confluenceFloor` **0.65** (`config.ts:20-23`). |
| CLAUDE.md on B+ | Execute grades = **A+ · A · A−**; **B+ paper 0.5% only** (`CLAUDE.md:18,22`). |
| `config.ts` risk | `riskByGrade["B+"]=0.005`; `onlyExecuteGrades` still lists `"B+"` (`config.ts:32,75`) — paper/PATH config fork vs CLAUDE, **not** an RH live allow. |
| RH live at `b8e76f4` | **Does not let B+ (or anything <0.65) fire.** `HIGH_PROB` = A+/A/A− only (`rh-autofire-gates.ts:207`); else `path_band` (`:309-310`). Confluence < `RH_PATH_FLOOR` (0.65) → `path_floor` (`:29,313-314`). Verifier: `"B+ PATH refuses"` → `[false, "path_band"]` (`verify-rh-autofire-gates.mjs:124-125`). |
| Verdict on B+ live | **PASS — blocked at this commit.** Any live “B+/PATH-fire” would be **outside** these gates (agent bug, wrong path, or post-commit change). Do not arm until any in-flight push is re-reviewed. |

### Updated scoreboard (delta from first review)

| # | Question | `86e592f` | `b8e76f4` |
|---|----------|-----------|-----------|
| BP gate fail-closed | **FAIL — BLOCKER** | **PASS (code)** — still needs funded Agentic BP ≥ $150 at arm time |
| Preferred account Agentic 6158 | n/a (Individual-centric) | **PASS** |
| 11:00 / A+@10 / DTE / tape / CE on RH | **FAIL** | **PASS in gates**; CE/tape/DTE **unwired** → fail-closed until fed |
| Cool-down / month cap | **FAIL** | **FAIL** |
| Chain vs `priceHint` | **FAIL/SOP** | **FAIL/SOP** |
| $550 vs $1000 | **FAIL fork** | **FAIL fork** |
| RH → `room_orders` | **FAIL** | **FAIL** |
| 15:30 RH flatten | **Gap** | **Gap** |
| Env arms false | **PASS** | **PASS** |
| 0.65 / A+/A/A− on RH | **PASS** | **PASS** (B+ cannot live-fire) |
| Gate suite | not run | **152/152** |

### Updated overall verdict: **NO-GO** (conditional path improving; do not arm)

Hard reasons to stay disarmed at `b8e76f4`:

1. **Agentic ••6158 default snapshot is $0** until funded (~08:30 ET per SOP) — `bp_floor` / snapshot source correctly blocks; Individual remains non-trade. Arming before a fresh funded `get_portfolio` is still a hard no.
2. **CE / tape age / DTE not auto-wired** into the RH candidate — gates fail closed (safe), but the live loop cannot clear them until wiring or explicit agent fields; treat as incomplete integration.
3. **Still open:** month/cooldown on RH path, live-chain TS enforce, $1000 vs $550 policy, no RH `room_orders`, no RH 15:30 flatten.
4. Env arms correctly **false**; keep them false. Written confirmation remains **true** in code (unchanged risk surface).
5. **B+ live fire is refused** at this commit; re-check any subsequent “B+/PATH-fire” push before arm.

**Minimum for a later GO-with-conditions:** funded Agentic BP ≥ $150 on fresh `get_portfolio` + CE/tape/DTE actually supplied on the candidate + env host checklist + no post-commit change that lowers the 0.65 / A+/A/A− band. Prefer also reconciling sleeve docs and documenting RH exit/flatten + audit.

*Re-reviewer: Grok Bot executor. Commit `b8e76f4`. Date: Tue Oct 6 2026. Read-only.*

---

## Re-review 7dd63cd

**Commit:** `7dd63cdbdb7e4352b50442885e3f190199eea967` (detached; *stand: Manager feed backed by REAL room state + wired into the RH live loop*).  
**Diff base:** `b8e76f4` → `7dd63cd` (~65 files; RH gates/autofire, `rh-floor-signals.ts`, path-alarm B+, manager-feed/live-loop/room-feed, CLAUDE/`config.ts`/`RH_LIVE_ROUTINE.md`, new `verify-rh-path-fire.mjs` / `verify-manager-live-loop.mjs`).  
**Scope:** read-only. No push, deploy, env flip, arm, preview, or place.

### Tests / typecheck (measured)

| Suite | Result |
|-------|--------|
| `verify-rh-autofire-gates.mjs` | **214 passed, 0 failed** (was 152 at b8e76f4) |
| `verify-rh-path-fire.mjs` | **106 passed, 0 failed** |
| `verify-manager-live-loop.mjs` | **58 passed, 0 failed** |
| `verify-floor-rh-account.mjs` | **21 passed, 0 failed** |
| `npm run typecheck` (`tsc --noEmit`) | **PASS** (exit 0) |
| Full `npm run build` | not run (typecheck sufficient for this pass) |

---

### 1. B+ live gate

| Check | Verdict | Citation |
|-------|---------|----------|
| fit ≥ 0.60 · SEQ TAKE · no veto | **PASS** | `evaluateRhBplusGate` `rh-autofire-gates.ts:76-99`; `APLUS_RULES.profitPath.bPlusLive` `config.ts:85-90` (`fitFloor: 0.6`, `requireSeqTake`, `requireNoVeto`) |
| Unknown seq / veto refuse | **PASS** | `seqTake !== true` → `bplus_seq` (`:85-90`); `vetoed !== false` → `bplus_veto` (`:92-97`) |
| `RH_PATH_FLOOR` stays 0.65 for A+/A/A− | **PASS** | `RH_PATH_FLOOR = 0.65` (`:36`); `RH_PATH_FLOOR_BY_BAND` A+/A/A− = 0.65, B+ = 0.60 (`:51-56`); A− @0.62 still `path_floor` (path-fire tests) |
| B− / B / anything &lt; 0.60 refuse | **PASS** | `rhPathFloorForBand` null → `path_band` (`:400-402`); B+ conf &lt; floor → `path_floor` (`:405-406`); `isPathFire` B+ needs ≥ 0.60 (`path-alarm.ts:41-46`) |
| B+ size exactly 1ct; debit $150–$550; 2ct refuses | **PASS** | `evaluateRhBandSize` (`:103-109`); `RH_BPLUS_MAX_CONTRACTS` from `bPlusLive.maxContracts` (`:64-65`); envelope still `RH_MIN/MAX_DEBIT_TOTAL` 150/550 (`:114-115`); propose 2ct → `bplus_size` |
| Other gates still bind B+ (BP, CE, tape, DTE, 11:00, A+ after 10) | **PASS** | Shared path: BP before floor rules (`evaluateRhAutofireGates` `:374-389`); `evaluateRhFloorRules` after_11 / aplus_after_10 (non-A+ incl. B+) / dte / tape / ce (`:341-358`). Tests: B+ after 10:00 → `aplus_after_10`; B+ @11:05 → `after_11`; missing CE/tape/DTE/BP refuse |
| Not widened to B/C; fire not on non-ARMED / vetoed | **PASS** | `RH_PATH_GRADES` = A+/A/A−/B+ only (`:42`); Floor `verdict !== "ARMED"` → `floor` (`:390-391`); Manager `managerAgreeFromRoom` blocks non-ARMED, non-BUY_OPEN, veto/hold, synthetic (`manager-room-feed.ts:116-133`). `isHighProbPath` unchanged A+/A/A− ≥ 0.65 (`path-alarm.ts:178-184`) |

**Note:** B+ live window is effectively **09:30–10:00 ET** (A+ only after 10:00). Futures paper B+ risk 0.5% unchanged (`config.ts:32`).

---

### 2. CE / tape / DTE wired (real sources, fail-closed)

| Verdict | **PASS** |
|---------|----------|
| Module | `src/lib/execution/rh-floor-signals.ts` |
| CE | `rhCeTouchFromDesk`: smc-master book same symbol+side; live desk quote; `readEntry(plan, price).inZone` and not `behind` (`:51-77`). Missing desk/plan/quote → **null** (not true). |
| Tape | `rhTapeAgeSec(desk.fetchedAt, nowMs)` (`:41-48`); future stamp → null |
| DTE | Floor card `dteTarget` rounded (`:90`) |
| Wired into RH path | `candidateFromFloorPathStand` / `proposeRhFromPathFire` call `rhFloorSignals` when `desk` supplied (`rh-autofire.ts` ~402+); Manager loop prefers desk CE else room `signals.ceTouch` (`manager-live-loop.ts:83-88`); **synthetic → `tapeAgeSec: null`** (`:85`) → `tape_unknown` |
| Missing → refuse | Unchanged `evaluateRhFloorRules` (`:347-357`) |

Not stubs that default to pass.

---

### 3. Live quote preferred for pricing

| Aspect | Verdict | Detail |
|--------|---------|--------|
| Prefer live | **PASS** | `evaluateRhLiveQuote` / `buildRhReviewPlaceShape` (`rh-autofire.ts:149-221`): `priceHint = ask + $0.02`, `priceSource: "live_quote"` when source `get_option_quotes`, ask &gt; 0, not crossed, age ≤ 30s |
| Fallback | **PASS (labelled)** | No/bad quote → `priceSource: "model"` = `estDebitEach + $0.02` (`:202-211`). Comment: model **cannot place** |
| Refuse vs model at place | **CONDITIONAL** | `mayPlaceAfterReview`: if `liveQuote !== undefined`, bad/null/stale → refuse (`:316-318`). Tests pin `liveQuote: null` refuses. **Gap:** if agent **omits** `liveQuote` key, place check skips quote (`:316`); `proposeRhLiveOption` can still return `mode: "live_when_armed"` with `priceSource: "model"` (B+ 1ct test without quote). SOP requires `get_option_quotes` before place (`RH_LIVE_ROUTINE.md` ~148) — **agent discipline, not hard-required at propose** |

---

### 4. Manager real feed + PATH fire trigger

| Aspect | Verdict | Detail |
|--------|---------|--------|
| What fires | **PASS** | Browser: `considerPathAlarm` → `isPathFire` (A+/A/A− ≥ 0.65 or B+ ≥ 0.60, actionable) + SMC seq **TAKE** same side + not news blackout + Judas release (`path-alarm.ts:260-321`). RH: `proposeRhFromPathFire` / `proposeRhFromManagerFeed` |
| Data | **PASS** | Fire grade/confluence from scanner fire; Floor ARMED + ticket; Manager `agentAgree` only on real room **BUY_OPEN fill** + chair rules (`manager-room-feed.ts:11-17,96-159`); signals from room cycle / desk |
| Stale / synthetic | **PASS** | Fire age &gt; 30s → `path_fire_stale` (`rh-autofire.ts:497-498`); synthetic blocks agree + nulls tape (`manager-live-loop.ts:85`; `manager-room-feed.ts:116`) |
| Double-fire / dedupe | **PARTIAL PASS** | Alarm: `lastKey` per `day:id:side:band` — same key does not re-beep (`path-alarm.ts:321-348`). Propose: fresh fire ≤30s + full gates. **No** RH `room_orders` / client-order idempotency — agent could re-call place on a new fabricated fire key; SOP/agent must not. Stub Manager → `managerStateForAgree` null → agentAgree false |

---

### 5. BP fail-closed + env arms

| | Verdict | Citation |
|-|---------|----------|
| Agentic BP gate intact | **PASS** | Unchanged `evaluateRhBuyingPower` (`:199-245`); preferred `995386158` (`:124-126`) |
| Env arms false | **PASS** | `.env.example` `RH_OPTIONS_AUTOFIRE_ENABLED=false`, `RH_LIVE_ARMED=false`; helpers default off (path-fire / manager-loop tests) |

---

### 6. Docs parity (B+ live 1ct vs old paper-only)

| Doc | Verdict |
|-----|---------|
| `CLAUDE.md` Execute grades | **PASS** — B+ **LIVE on RH path** behind `evaluateRhBplusGate`, 1ct, fit ≥ 0.60, SEQ TAKE, no veto; B/C never fire; futures paper B+ stays 0.5% (`CLAUDE.md:18`) |
| `config.ts` `bPlusLive` | **PASS** (`:77-90`) |
| `docs/RH_LIVE_ROUTINE.md` | **PASS** — grades, B+ gate, PATH fire trigger, live quote SOP |
| RH sleeve $1,000 vs $550 envelope | **FAIL (fork remains)** — CLAUDE RH sleeve / Floor / Alpaca still **$1,000**; RH live envelope still **$150–$550** |

---

### 7. Still-open from prior reviews

| Item | At `7dd63cd` |
|------|----------------|
| Cooldown / month PATH cap on RH | **FAIL / open** — SOP follow-ups (`RH_LIVE_ROUTINE.md:176-177`); not in `rh-autofire-gates.ts` |
| $1,000 sleeve vs $550 | **FAIL (fork)** |
| `room_orders` audit for RH fills | **FAIL / open** |
| 15:30 flatten on RH | **Gap / manual** (Alpaca cron only) |

---

### Scoreboard vs Stand claims

| # | Claim | Verdict |
|---|-------|---------|
| 1 | B+ live gate (fit/SEQ/veto/floors/size/other gates/no widen) | **PASS** |
| 2 | CE/tape/DTE wired, fail-closed | **PASS** |
| 3 | Live quote preferred | **PASS prefer** / **CONDITIONAL refuse** (omit `liveQuote` at mayPlace = gap) |
| 4 | Manager feed + PATH fire; dedupe | **PASS** trigger/data/stale/synthetic; **PARTIAL** place idempotency |
| 5 | BP + env false | **PASS** |
| 6 | Docs B+ live 1ct | **PASS** (sleeve $1k fork remains) |
| 7 | Still-open list | **Still open** |

### Overall verdict: **GO-with-conditions** (do **not** arm until conditions met)

Code at `7dd63cd` implements the Stand’s B+ / wiring / Manager-loop claims and the gate suites are green (**214** + **106** + **58** + **21**). Arming remains blocked until:

1. **Fresh `get_portfolio(995386158)`** with spendable **≥ $150** (Agentic still $0 until funded — `bp_floor`).
2. Host sets env arms **only** after the 09:08/09:30 checklist; repo defaults stay **false**.
3. Agent **always** passes a fresh `liveQuote` into `propose` **and** `mayPlaceAfterReview` (treat omit as forbidden — code gap).
4. B+ only **09:30–10:00 ET**, **1 contract**, SEQ TAKE, `vetoed === false`, CE/tape/DTE clear.
5. Accept residual risk: no RH cooldown/month cap, no RH `room_orders`, **manual** 15:30 flatten, **$550 vs $1,000** policy fork.
6. Never place on synthetic feed / stub Manager / Individual ••7477.

Until (1)–(3) are true in the live session, treat as **operational NO-GO** even though the gate code is **GO-with-conditions**.

*Re-reviewer: Grok Bot executor. Commit `7dd63cd`. Date: Tue Oct 6 2026. Read-only.*

---

## Re-review 232d3ab

**Commit:** `232d3ab0d9f3641ca9f02f4d48891ff0d5a9c54b` (*rh: missing liveQuote refuses propose + mayPlaceAfterReview (fail closed)*).  
**Includes intermediate:** `8d95eda` (*smc-master: PATH bar = isPathFire so a B+ sequence can print TAKE…*).  
**Diff base:** `7dd63cd` → `232d3ab` (6 files: `rh-autofire.ts`, `smc-master.ts`, RH routine + verify scripts).  
**Scope:** read-only. No push, deploy, env, arm, or orders.

### Tests (measured)

| Suite | Result |
|-------|--------|
| `verify-rh-autofire-gates.mjs` | **218 passed, 0 failed** (expect 218) |
| `verify-rh-path-fire.mjs` | **111 passed, 0 failed** (expect 111) |
| `verify-manager-live-loop.mjs` | **58 passed, 0 failed** |
| `verify-floor-rh-account.mjs` | **21 passed, 0 failed** |
| `npm run typecheck` | **PASS** |
| SMC/scanner-adjacent | No dedicated `verify-smc-master`. Ran: `verify-repo-guards` **59/59**; `verify-setup-anticipation` **142/142**; `verify-entry-alarm` **29 passed, 1 failed** (`found the quote poll` — same known flake noted in `8d95eda` message vs `origin/main`, not introduced by these two commits’ RH/smc PATH-bar change) |

---

### (1) liveQuote required on propose + mayPlace — no model-only `live_when_armed`

| Check | Verdict | Citation |
|-------|---------|----------|
| Missing/null/stale/crossed refuse at **propose** | **PASS** | `proposeRhLiveOption` calls `evaluateRhLiveQuote` before shape; fail → `gate: "live_quote"`, `mode: "refused"` (`rh-autofire.ts:267-276`). `evaluateRhLiveQuote` (`:149-163`): no quote, bad source, ask≤0, crossed bid>ask, unknown/stale >30s → ok false |
| Same at **mayPlaceAfterReview** | **PASS** | Always runs `evaluateRhLiveQuote(args.liveQuote, …)` — no `!== undefined` skip (`:323-338` area). Omit/null/stale refuse |
| No model-only path to `live_when_armed` | **PASS** | Propose returns `live_when_armed` only after live quote clears + live envelope/BP re-check (`:278-293`). `buildRhReviewPlaceShape` may still label `priceSource: "model"` for display/tests — **cannot arm** |
| Other callers / bypass | **PASS (no bypass in src)** | Production call chain: `proposeRhFromManagerFeed` → `proposeRhFromPathFire` → `proposeRhLiveOption` (all pass `liveQuote` through). Grep: no other `src/` callers of propose/mayPlace. Tests updated to require quote. SOP: `RH_LIVE_ROUTINE.md` step 5 now says missing/omitted refuses both |

Closes the **7dd63cd condition (3)** live-quote omit gap.

---

### (2) `8d95eda` — B+ sequence can print TAKE

| Check | Verdict | Detail |
|-------|---------|--------|
| What changed | **PASS (as claimed)** | `smc-master.ts` `gradeBook`: `pathOk = isPathFire(cand)` was `isHighProbPath` (~`:605-609`). `pickCandidate`: after A+/A/A− (`isHighProbPath`), also consider `isPathFire` (B+) (`:168-172`, `:195-198`) |
| Why needed | | PATH alarm + options card require smc word **TAKE**; TAKE required `pathOk`; old `isHighProbPath` excluded B+ → B+ fire unreachable |
| Must-layers loosened? | **PASS — not loosened** | `musts` / `mustFail` / `mustWait` / armed-retrace logic unchanged (`:600-630`). Only the PATH score predicate widened to `isPathFire` |
| Non-B+ / sub-0.60 / B band reach TAKE via this? | **PASS — no** | `isPathFire` (`path-alarm.ts:41-46`): `isHighProbPath` OR (actionable **and** band === `B+` **and** conf ≥ 0.60). B / B− / C / B+ @0.59 → false |
| Vetoed cards | **PASS (unchanged layering)** | SMC TAKE still does not encode room/Stand/Owner veto; RH `evaluateRhBplusGate` + Manager `managerAgreeFromRoom` still refuse veto / unknown veto. Sequence TAKE ≠ auto place |
| Now tab A-band TAKE meaning | **PASS — unchanged** | A+/A/A− still enter via `isHighProbPath` (≥0.65, actionable) inside `isPathFire`. Same must-layer + pathOk → TAKE. Pick still **prefers** `isHighProbPath` before B+ |

---

### (3) Prior gates still intact

| Gate | Verdict | Citation |
|------|---------|----------|
| B+ explicit gate | **PASS** | `evaluateRhBplusGate` / `RH_PATH_FLOOR` 0.65 / B+ 0.60 / 1ct (`rh-autofire-gates.ts` unchanged in this diff) |
| BP fail-closed Agentic | **PASS** | `evaluateRhBuyingPower` + `995386158`; Individual refused |
| CE / tape / DTE | **PASS** | `evaluateRhFloorRules` + `rh-floor-signals.ts` unchanged |
| 11:00 no-new | **PASS** | `after_11` via `ROOM_CLOCK.dayFlatMin` |
| Env arms false | **PASS** | `.env.example` `RH_OPTIONS_AUTOFIRE_ENABLED=false`, `RH_LIVE_ARMED=false` |

Still open (unchanged): cooldown/month on RH, $1k vs $550 sleeve fork, RH `room_orders`, manual 15:30 flatten; Agentic funding operational.

---

### 7dd63cd conditions — status at `232d3ab`

| # | Condition from 7dd63cd GO-with-conditions | Met in code? |
|---|------------------------------------------|--------------|
| 1 | Funded Agentic BP ≥ $150 (fresh `get_portfolio`) | **Operational — NOT met** (account still $0 until fund; gate intact) |
| 2 | Host checklist then env flip; defaults false | **PASS** (defaults false; arm is host-only) |
| 3 | Always pass fresh `liveQuote` at propose **and** mayPlace | **PASS (now enforced in code)** |
| 4 | B+ only 09:30–10:00, 1ct, SEQ TAKE, no veto | **PASS** (gates + `8d95eda` makes SEQ TAKE reachable for B+) |
| 5 | Accept residual: no RH cooldown/month/`room_orders`, manual 15:30, $550 vs $1k | Still accepted / open |
| 6 | No synthetic / stub / Individual | **PASS** |

### Overall verdict: **GO-with-conditions** (same as 7dd63cd, **live-quote condition closed**)

**Are the 7dd63cd conditions met apart from funded BP?** **Yes** — code-side conditions (2)–(4) and (6) hold; (3) is now hard-fail-closed rather than agent-SOP-only. Remaining arm blocker is **operational**: Agentic BP ≥ $150 on a fresh live `get_portfolio`, plus host env arm after checklist. Residual policy/ops gaps (cooldown/month, `$1k`/`$550`, `room_orders`, 15:30) unchanged.

*Re-reviewer: Grok Bot executor. Commit `232d3ab` (via `8d95eda`). Date: Tue Oct 6 2026. Read-only.*
