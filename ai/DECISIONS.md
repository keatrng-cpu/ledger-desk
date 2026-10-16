# DECISIONS — ledger-desk (append-only)

**Maintainer:** Graph Keeper · **Rule:** append only. Never edit or delete a past entry; supersede it with a new dated entry that names the one it replaces.
**Status values:** `ADOPTED` · `PROPOSED` (pending review) · `OPEN LOCK` (needs Keaton/owner decision) · `SUPERSEDED`

Entry format:
```
### YYYY-MM-DD — <title>
- Status · Decided by · Source
- Decision
- Why
- Supersedes (if any)
```

Scope: desk/process/canon decisions. Trading rule numbers live in `src/lib/aplus/config.ts` (code wins) and dated trader's calls in `CLAUDE.md` hard rules; they are pointed to, not copied, here.

---

## Open locks (current)

| Lock | Status | Owner to decide | Source | Repo evidence |
|---|---|---|---|---|
| **CBDR clock** for NQ/ES — which timestamp is locked | OPEN LOCK | Keaton | plan §5 Q1; SMC deep dive §9.19 / §13 (`a278500`) | No `CBDR` in repo code/docs (search of `main` @ `008cbec`). Plan WS-D1: "Lock CBDR clock before coding." |
| **Flout** — what it means on this desk | OPEN LOCK | Keaton | plan §5 Q2; SMC deep dive §9.20 | Term not found on `main` @ `008cbec` |
| **`sponsored` rename** to avoid ICT collision | OPEN LOCK | Keaton (Trading Stand defines) | plan §5 Q3; SMC deep dive §9.2 | Used in `src/lib/trading/engine-weights.ts`, `src/lib/aplus/confluence.ts`, `src/lib/trading/scanner.ts`, `src/lib/trading/smc-master.ts`, `src/lib/trading/score-drivers.ts`, others |
| Judas release vs hard-block | DECIDED — Keaton chat 2026-10-15 11:42 CT ('Yes, trade through it'); code had been warning-only since a63bf6ca/430d18cf (2026-10-13) | Keaton | plan §5 Q5 | `src/lib/trading/judas-window.ts` |
| NOW/DECISIONS location | PROPOSED (see 2026-10-06) | Keaton (acceptance) · Dual Desk pick | plan §5 Q8 | — |

Other plan §5 questions (PATH n, Kalshi FLB, QQQ/SPY basis, PM vendor, server runner vs PATH) are tracked in `ai/NOW.md` → Open questions.

---

## Log

### 2026-10-05 — Keep Graphify as the code map; markdown canon beside it
- **Status:** ADOPTED · **Decided by:** Keaton (workspace-wide canon convention) · **Source:** Keaton standing instruction relayed to Graph Keeper; restated in issue #7 ("Git is the bus; Graphify stays the code map") and HANDOFF `defa9e0` Decision 2.
- **Decision:** Graphify output (`graphify-out/`, incl. `GRAPH_REPORT.md`) is the code map. Human-readable canon (`ai/NOW.md`, `ai/DECISIONS.md`, `ai/HANDOFF.md`, `ai/research/INDEX.md`) sits beside it as markdown. Neither replaces the other.
- **Why:** The graph answers "where/what connects"; canon answers "what is true now and why". Keeping them separate stops narrative from drifting into the code map and vice versa.
- **Note:** As of 2026-10-06 Graphify has not been run in this repo (`graphify-out/` absent on `main`). The `GRAPH_REPORT.md` on branch `graph/2026-10-06-ws-kg0-knowledge-spine` is a hand-built seed.
- **Provenance (annotation 2026-10-06, post-Accuracy Review):** relayed from Keaton (chat instruction to Graph Keeper, 2026-10-06); date as given by Keaton. Keaton gave this to his Graph Keeper assistant in chat on 2026-10-06 ~00:08 UTC ("Include 2026-10-05 keep Graphify, git is the bus, one task in flight per repo"), dating the decision 2026-10-05 himself. No repo commit records it before issue #7 and HANDOFF `defa9e0` (both 2026-10-06).

### 2026-10-05 — Git is the bus
- **Status:** ADOPTED · **Decided by:** Keaton · **Source:** Keaton standing instruction; issue #7 Decisions; HANDOFF `defa9e0` Decision 1.
- **Decision:** Desks and agents communicate through commits on branches. Uncommitted work is invisible and counts as not done.
- **Why:** Multiple agents (Grok-side desks, Claude) work the same repo; the commit history is the only shared, durable, reviewable record.
- **Provenance (annotation 2026-10-06, post-Accuracy Review):** relayed from Keaton (chat instruction to Graph Keeper, 2026-10-06); date as given by Keaton. Keaton gave this to his Graph Keeper assistant in chat on 2026-10-06 ~00:08 UTC ("Include 2026-10-05 keep Graphify, git is the bus, one task in flight per repo"), dating the decision 2026-10-05 himself. No repo commit records it before issue #7 and HANDOFF `defa9e0` (both 2026-10-06).

### 2026-10-05 — One task in flight per repo
- **Status:** ADOPTED · **Decided by:** Keaton · **Source:** Keaton standing instruction; issue #7 ("In flight (one task per repo)"); HANDOFF `defa9e0` Decision 3.
- **Decision:** Exactly one workstream is in flight per repo. The next queue item starts only when the current one is done or explicitly parked by Dual Desk.
- **Why:** Prevents parallel half-finished branches and conflicting canon; makes "what is happening" answerable from one line.
- **Provenance (annotation 2026-10-06, post-Accuracy Review):** relayed from Keaton (chat instruction to Graph Keeper, 2026-10-06); date as given by Keaton. Keaton gave this to his Graph Keeper assistant in chat on 2026-10-06 ~00:08 UTC ("Include 2026-10-05 keep Graphify, git is the bus, one task in flight per repo"), dating the decision 2026-10-05 himself. No repo commit records it before issue #7 and HANDOFF `defa9e0` (both 2026-10-06).

### 2026-10-06 — Phase 1–3 owner assignments; WS-KG0 in flight
- **Status:** ADOPTED · **Decided by:** Dual Desk · **Source:** HANDOFF `defa9e0` (branch `coord/2026-10-06-desk-assignments`); issue #7.
- **Decision:** One primary owner per workstream per the HANDOFF owner table; queue order KG0 → P1 → BP → PRE → CAL → D1 contracts → D1 code → C1 → J1 → DASH → FLOOR → PM → DASH PM → FLOOR PM → size-ups (blocked).
- **Why:** Plan `09aad4b` owner labels were suggestions; Dual Desk assigns.

### 2026-10-06 — Merge path and standing guards
- **Status:** ADOPTED · **Decided by:** Dual Desk · **Source:** HANDOFF `defa9e0` Decisions 4–7; plan §4 Merge path; issue #7.
- **Decision:** (a) feature/research branch → Accuracy Review → Release Watch → Design Atelier merges to `main`. (b) No size-ups until PATH n ≥ 100 and expected-R gates (`profit-path.ts` `PROFIT_MIN_SAMPLE` / `PROFIT_TARGET_EXPECTANCY_R`; ROADMAP). (c) No live orders from WS-BP / WS-PRE; RH env arms remain human. (d) Do not lower the confluence floor to manufacture clears.
- **Why:** Sample before size-up; no unverified numbers reach `main`.
- **Open note for Accuracy Review:** plan cites a 0.75 floor (Trading-Automation `knowledge/confluence.json`); ledger-desk `src/lib/aplus/config.ts` sets `confluenceFloor: 0.65` (A+ ≥ 0.75 per `CLAUDE.md`). Guard (d) applies to both; workstreams should name which one they mean. Also `CLAUDE.md` "When coding" still says "Push to main" — conflicts with (a); needs Keaton/Dual Desk reconciliation.
- **Annotation 2026-10-06 (post-Accuracy Review) — grade bands and B+ live gate, from code:** verified at `33cfb8a` (on `main`; files identical at `008cbec`). Bands (`riskGradeFromScore`, `src/lib/aplus/config.ts:99-107`): A+ ≥ 0.75 (`aPlusThreshold`, :20) · A ≥ 0.68 (`confluenceFloor + 0.03`, :101) · A− ≥ 0.65 (`confluenceFloor`, :22, :102) · B+ ≥ 0.60 (`confluenceFloor − 0.05`, :103); `pathBand` in `src/lib/trading/strategy-grade.ts:422-429` uses the same edges for complete sequences. B+ live gate: `APLUS_RULES.profitPath.bPlusLive` (config.ts:85-90: `fitFloor: 0.6`, `requireSeqTake`, `requireNoVeto`, `maxContracts: 1`), enforced by `evaluateRhBplusGate` (`src/lib/execution/rh-autofire-gates.ts:76-100`, fail closed on unknown sequence/veto) and `evaluateRhBandSize` (:103-110, exactly 1 contract); A+/A/A− keep `RH_PATH_FLOOR = 0.65` (:36). Guard (d) therefore means: never lower the 0.65 execute floor (or the 0.60 B+ fit floor) in ledger-desk; 0.75 is the A+ edge here and the Trading-Automation floor in the plan.

### 2026-10-06 — Canon location: `ai/` (not `.grok/` or `PROGRAM.md`)
- **Status:** PROPOSED — pending Keaton's acceptance, not just Accuracy Review (Accuracy Review passed WS-KG0 @ `8ced8f4` with nothing blocking, per Dual Desk; that pass does not lock this decision). Plan §5 Q8 marks it a Dual Desk pick; HANDOFF `defa9e0` already places the files under `ai/`; Graph Keeper concurs.
- **Decided by:** Graph Keeper (proposal) · **Source:** repo tree on `main` @ `008cbec`; plan `09aad4b` §WS-KG0 and §5 Q8; HANDOFF `defa9e0` Open question 8.
- **Decision:** `NOW.md` and `DECISIONS.md` live at `ai/NOW.md` and `ai/DECISIONS.md`, beside `ai/HANDOFF.md` and `ai/research/`. Code map stays in `graphify-out/`. No pointer file added elsewhere.
- **Why:**
  1. `ai/` already exists on `main` (`ai/research/` with two briefs); the plan's WS-KG0 Build and the HANDOFF both name `ai/` paths. Matches Keaton's workspace-wide convention (`ai/NOW.md`, `ai/DECISIONS.md`, `ai/HANDOFF.md`, `graphify-out/`).
  2. There is **no `.grok/PROGRAM`** in the repo. `.grok/` holds only `skills/` (tool skill packs) and `status` (a workspace-server runtime JSON) — tool config, not canon.
  3. Root **`PROGRAM.md` is a different document**: an unsigned regulatory program/track-record definition with `DECIDE:` blocks, meant to be sealed (`npm run seal`) and pinned to a public timestamp. Mixing living session state into it, or editing it to add a pointer before it is sealed, would muddy its dated-evidence purpose. So no pointer line was added there.
  4. Tool-neutral: Claude and Grok both read `ai/`; putting canon under `.grok/` would make it Grok-specific (Claude has its own `.claude/`).
- **Follow-up (not done here):** for "agents load NOW each session" to be automatic, `AGENTS.md` / `CLAUDE.md` need a one-line pointer to `ai/NOW.md` after merge — owner/approval: Keaton or Dual Desk.

### 2026-10-07 — Graphify has been run; the vault holds the code graph and the book
- **Status:** ADOPTED · **Decided by:** Keaton (asked to implement Obsidian and Graphify) · **Source:** this session, on `main` after `295bd7f`.
- **Decision:** `graphify extract . --code-only` is the code map (local tree-sitter, no model). `graphify-out/obsidian/` is that graph as a vault. The trading book is written beside it by `scripts/export-brain-vault.mjs` into `graphify-out/obsidian/brain/` and is not merged into `graph.json`. The 2026-10-06 hand-built import ranking stays at `graphify-out/SEED_REPORT.md`. Community names stay "Community N" until a labeling pass is asked for. Rebuild with `graphify update .`, then `graphify cluster-only . --no-label --no-viz`, then `graphify export obsidian`, then `npx tsx scripts/export-brain-vault.mjs`.
- **Why:** The graph answers where the code connects. The book answers what the floor recalls. Putting the book inside `graph.json` would make a trading line look like a function.
- **Supersedes:** the note in the 2026-10-05 Graphify entry that Graphify had not been run. Does not replace that entry's decision that Graphify stays the code map and markdown canon sits beside it.
- **Annotation 2026-10-13 (Forge Atlas Wave 1 H1):** the generated vault notes are no longer tracked. `.gitignore:47-50` ignores `graphify-out/obsidian/*` (9,210 top-level `obsidian/*.md` notes plus `obsidian/.graphify_obsidian_manifest.json` and `obsidian/.obsidian/graph.json` were removed from the index) and re-includes what scripts and `brainlab/` read. The 96 files kept are the 6 top-level `graphify-out/` files (`graph.json`, `GRAPH_REPORT.md`, `SEED_REPORT.md`, `manifest.json`, `.graphify_analysis.json`, `.graphify_root`), `graphify-out/obsidian/graph.canvas`, and the 89 notes under `graphify-out/obsidian/brain/`. Readers: `scripts/verify-brain-vault.mjs`, `brainlab/memory.py`, `brainlab/retain.py`. Writer: `scripts/export-brain-vault.mjs`. `graphify export obsidian` still regenerates the full vault locally, and the rebuild steps above are unchanged. The decision above still stands. Only what git tracks changed.

### 2026-10-07 — Lab tools sit beside the desk, not on the order path
- **Status:** ADOPTED · **Decided by:** Keaton (asked to use yfinance, MetaTrader 5, pandas-ta, Chroma or Marqo, Probot, PR-Agent, Streamlit, and CodeRabbit) · **Source:** this session.
- **Decision:** `brainlab/` is the audit lab. Yahoo bars use the same MNQ/ES/NQ symbols as `src/lib/market/yahoo.ts`. MetaTrader 5 is the same bar shape and fails closed when the Windows terminal is absent. Swing legs are confirmed pivots; ATR comes from `pandas-ta-classic` (the pandas-ta build that still installs; the upstream name has no 3.10 wheel). Chroma stores notes on disk; Marqo is used only if a server URL is set. Issue intake is `.github/workflows/brain-intake.yml` (and a Probot app of the same comment, run one of them). PR-Agent runs when someone comments `/review` and `OPENAI_KEY` exists. CodeRabbit reads `.coderabbit.yaml` after the GitHub App is installed. None of these write the room cycle, a gate, or an order.
- **Why:** The desk already has a live price. A second feed that can place is how a lab becomes a second broker.

### 2026-10-07 — Robinhood is the only execution path
- **Status:** ADOPTED · **Decided by:** Keaton · **Source:** this session.
- **Decision:** `brainlab/` may read a Robinhood chain, greeks, bid, ask, and buying power. It may judge a quote against the desk's spread, age, debit, and noise cuts, and it may log a fill the desk already got. It must not send, cancel, or replace an order. The book takes print age and last-minute noise as `now:precision`, and speaks one line as `now:read` from the lines it already holds. Neither line is a gate.
- **Why:** A second sender double-fires. A book that repeats five versions of the same card is not a book.

### 2026-10-07 — The floor's faces follow the line. The other engines do not run here
- **Status:** ADOPTED · **Decided by:** Keaton (asked for ACE, Spline, ComfyUI, Tripo, Godot, and Blender on the floor) · **Source:** this session.
- **Decision:** Mouth shape, brow, blink, look, and the hand gesture come from the words the person is saying (`src/lib/room/floor-presence.ts`). The office stays the Blender GLB from `scripts/blender/build_floor.py`. ACE, Spline, ComfyUI, Tripo, and Godot are not installed on this host, and `bpy` needs Python 3.11, so none of them were faked. A gesture does not change a ticket.
- **Why:** A cloud avatar engine that is not connected still has to be drawn by something. The something that is already on the floor is the five people.





## 2026-10-13 — Learning loop (journal → calibration), Keaton
- Every card with q or qRaw ≥ 0.65 is snapshotted once per (ET day, symbol, side, setup), plan or not, with checklist, components, MTF, SMT, regime, displacement, draws, brain, Floor and Master (`desk_card_snap`, migration 0024).
- Graded on each card read against the desk's own 1m feed: plan → T1/stop first (same bar = loss), MFE/MAE in R, minutes; no plan → signed move at +30/+60/+120 min in ATR (right/wrong at ±0.25 ATR). No bars → `ungradable`; outcomes are never invented.
- Weekly calibration: per-factor hit-rate lift → weight scale only at n ≥ 30, shrunk n/(n+50), step capped ±20%, total scale bounded ×0.8–×1.2; band edges move ±0.01 at n ≥ 30 per band, within ±20% of baseline. Each run is a version in `desk_calibration` with its prior state; `scripts/calibration.mts revert <v>` reverts it. Applied version + report at GET /api/desk/journal (`learning`).
- Runtime cannot write this file: each version's entry is produced with `npx tsx scripts/calibration.mts decisions` and appended here when it is applied. v0 = baseline (RAW_WEIGHTS, bands 0.75/0.68/0.65/0.60/0.50).
- Backfill: today's desk-watcher log snaps + saved card snapshots (5 unique cards ≥ 0.65), graded on Yahoo 1m (MNQ=F/ES=F): 3 wrong, 2 open (graded live once their +120 m closes). Fix 40 missed trades are the same rows: < A- that ran ≥ 2R / ≥ 1 ATR at +120 m.

## 2026-10-13 — LTF kill thresholds tuned on 5 sessions (Yahoo 1m, MNQ+ES, RTH)
- Replay `scripts/kill-tune.mts` (results `scripts/fixtures/kill-tune-2026-10-13.json`): a kill is right if price runs ≥0.5×ATR15 against the killed side before ≥0.5×ATR15 for it, within 60 min. 27-cell grid (IFVG age 4/6/8 × wick 0.4/0.5/0.6 × disp 1.0/1.25/1.5×ATR1m).
- Every cell sits at 0.41–0.51 precision (n ≈ 100–170): the kill is roughly a coin flip at that horizon. Best: wick 0.5, disp 1.0 → 0.503 (n 149) vs old 1.25 → 0.481. DISP1_ATR 1.25 → 1.0. IFVG5_MAX_AGE stays 6 (4 is equal within noise and misses the 10:33 ES replay).
- Journal failure modes: 3 graded losses so far, all "unclassified" (backfill rows lack chop/HTF fields); "LTF kill ignored" = 0. Too small to inform the thresholds; revisit at n ≥ 30.
- Implication, not acted on: with ~50% precision the kill is a valid CAP but weak evidence for the opposite side; the fix-29 opposite boost (0.05–0.08, Keaton's spec) is kept, flagged for review once the journal has n.

## 2026-10-13 — Kill boost 0.05–0.08 → 0.02 (Keaton)
- Fix 29's opposite-side boost is now `TUNABLES.killBoost` in `src/lib/trading/config.ts`, base 0.02 (flat), bounded 0–0.04. Reason: the 5-session replay put LTF-kill precision at ≈0.50.
- Learnable: snapshots that received the boost carry the factor `killBoost`; at n ≥ 30 graded the weekly calibration scales it (shrunk, ±20%/step), versioned and reversible like the weights.
- Same batch: DXY (Yahoo DX-Y.NYB) and 10y (Yahoo ^TNX, ZN=F fallback) feed a ±0.01 macro risk flag inside the ±0.06 day-context cap; overnight 5m (Yahoo 5d/5m, cached per ET day) feeds the Asia/London read; OR ±2/±2.5 SD are external draws beyond T1; fix 12's OB/FVG +0.02 also applies to late plans (33/34).

## 2026-10-13 — Complete plans or watch rows; ring counts what q counts; raise-only band edges (Keaton) — branch feat/full-plan-cards
- Every displayed card carries entry, stop and target. Fallback chain (exec-context `completePlan`): entry = nearest unfilled same-direction 1m–15m array (FVG/IFVG/sponsored CE, OB/breaker CE) on the pullback side → 5m BOS retest → OR edge; stop = beyond the origin swing, ≥ 0.5×ATR15; target = ranked draw → OR SD projection → session high/low. No level → `watchOnly` row (`scanner[].kind = "watch"`, `watchWhy`), never the wire card, never a Floor card.
- Brain ring: displacement (≥ 0.5) and the live PD array are musts; premium/discount-for-side is a must again (no note demotion).
- Learning loop may only RAISE band edges; never below 0.75 / 0.68 / 0.65 / 0.60 / 0.50.
- (feat/full-plan-cards) The brain's "Draw on liquidity" layer reads the same ranked list as wire.draws and completePlan (`brainDrawPick`: best-ranked unswept draw beyond price on the side). Consequence: a ranked pool ahead of price can now pass the layer (and open the item-1 target gate) where `draw.primary` pointed the other way — a deliberate loosening for agreement, Keaton 2026-10-13.

## 2026-10-13 — No fake stops/targets/R:R; one rules file (Keaton)
- `sanePlan`: stop ≥ 0.5×ATR15 (widened to the nearest real 5m/15m swing beyond entry, else the floor; R:R recomputed); T1 must be a real level (ranked draw / OR SD / session H/L); rr1 < 1.0 or unreal T1 → watch row; displayed rr capped at 6 (`rrRaw`, `rrFlag`). The brain's book plan takes the same stop/R:R. Live case 12:33 CT MNQ short 30735.13 / 30738.75 / rr 13.12 → stop 30771.25, rr 1.32.
- `shared/desk-rules.json` is the one source for band edges, ATR stop floor, entry zones, R:R rules, late entry, kill rules and fire timings. Desk TS imports it; desk-watcher carries a byte-identical copy; parity tests on both sides fail on drift. Drift found and fixed: continuation-array stop floor was 0.25×ATR15 (now 0.5); watcher stop_width used fixed points only (now also 0.5×ATR15).

## 2026-10-13 13:07 CT — LTF kills void on reclaim / age (both sides scored every poll)
Found: during the bull surge, ES long and MNQ long sat at C (q 0.4999) because 12:56 CT 5m bear-IFVG kills never re-armed — Keaton's strict re-arm needs sweep → displacement → inversion, and a straight surge has no sweep — though price had already closed back above the kill levels (ES 7854 > 7849.25, MNQ 30762 > 30733.75). MNQ also carried a 12:41 CT kill on the short. The lead picker was not side-biased; both sides were built and scored, the longs were just capped.
Fix: `killVoided` — a kill is void (treated like a re-arm, capped A-) after `kill.voidCloses5m` (2) closed 5m bars beyond its level in the killed side's favour, or after `kill.maxAgeMin` (60). Shared rules; watcher reads `ltfKilled` off the card.
0DTE (watcher): from `session.zeroDteCutoffEt` 15:25 ET only dte ≥ 1; 0DTE flattened by 15:40 ET; flat_by capped at 15:50 ET, no overnight holds.

## 2026-10-13 13:45 CT — Loss-pattern guards: per-rule mode, only late + breakeven live (Keaton)
- `shared/desk-rules.json` `loss.*` has 8 guards (src/lib/smc/loss-guards.ts, watcher twin). Each one has a `mode`: "live" acts, and anything else is shadow. Shadow is recorded on `wire.strategy.guards.shadow` and in the watcher `gates.log` as `shadow:*` / `shadow:desk:*` rows that are always ok. It changes nothing in q, band, size, stop, watch row, brain word or fire.
- Live: `late` (entry > `late.maxAtr` 0.5×ATR15 past the trigger is blocked unless the full lateEntry rule passes) and `target.beMode` (stop to breakeven at `beFrac` 75% of the way to T1). In-sample, these were the only two that improved R (late +3.36R, breakeven +1.39R).
- Shadow: htf, early, velocity, stop, chop, ranked T1, option. htf on the watcher reverts to the legacy gate. When 1h and 4h both oppose, the watcher cuts size rather than blocking (the backtest showed blocking was more harmful). The stop reverts to the 0.5×ATR15 floor.
- The full late rule is split: the desk checks band A+/A/A- and RR from price (`lateEntry.rrMin`). The Floor checks the option half, `lateEntry.pnlMinPct` (`latePnlCheck`: |delta| × |T1−px| × spot/px × 100 ≥ 75% of the ask, per contract; missing inputs fail closed), and stays ARMED only if it passes. The watcher makes both checks again (`entry_distance_check`, needs floor ARMED). Accuracy 7cc00057 note 1.
- A live htf block (sizeMult ≤ 0) means no Floor ticket, never a 1-contract floor. `sealBand` re-runs only when a live chop/velocity guard changed q/band, so shadow cannot touch the band.

## 2026-10-13 — Chain window 10s; order-review age runs from a post-review quote re-read (Accuracy a10a66a7 / 7cc00057)
- `fire.chainMaxAgeS` 10 → `CHAIN_MAX_AGE_MS` (was a hard-coded 30s in options-desk.ts), with a parity test. The quote window `fire.quoteMaxAgeS` stays 3s and the order-review window `fire.orderReviewMaxAgeS` stays 1s.
- The RH dispatcher re-reads `get_option_quotes` after `review_option_order` and the account read, and stamps `readAtMs`. `mayPlaceAfterReview` (requireReviewQuote) refuses a quote with no review-time read or one older than 1s. The age is measured again right before `place_option_order`, after `ledger.claim`, so the 1s bound covers re-read → send. Propose time does not count: an MCP propose→review round trip is seconds long.

## 2026-10-13 — auto-memory protocol adopted
Agents (Claude Code via hooks, Grok/Codex via AGENTS.md / .grok/GROK.md) read `ai/NOW.md` + a graph slice at task start and update NOW/DECISIONS at task end; graph refresh by post-commit hook and the `graphify-refresh` Action (writes only to the `graph` branch). Why: shared memory without being asked, low token use (graph query, not GRAPH_REPORT).

### 2026-10-13 — fireFix live set, fixed $650 debit on every grade, spreads off, gateHand desk parity, fast:geometry
- ADOPTED · Keaton (caps, spreads) + Accuracy Review (gateHand parity, geometry) · chat 2026-10-13; shared/desk-rules.json rulesHash e9662c550a50f449
- Decision:
  - **fireFix** (shared/desk-rules.json `fireFix`): items are live only when the fidelity replay (tools/replay_full.py, 19 days) shows fires up with no hit-rate/R drop; the rest stay shadow. Live: deadZone, rulesPin, soleBlocker, dayLoss ($150 / 15%), oneLotT1, gateHand, envelope.
  - **Debit cap: a fixed $650 for EVERY grade** (`fireFix.envelope.maxDebit`, `fireFix.ladder` A+ 4 / A 2 / A- 1 / B+ 1 contracts, all $650). Replaces the per-band caps and the $550 envelope. $50 floor, $150/15% daily loss cap, −$300 weekly lock, BP gate and stop logic unchanged.
  - **Spreads off:** `fastChain.spreadFallback=false`, `sizeToFit.spread=false` — single options only.
  - **gateHand (live):** A+/A cards whose only holds are soft (brain standing / waiting / no book, 1h/4h against, SMT, direction, same-side ticket in the other book, model-estimate ticket) stay ARMED, handed to the watcher at a one-step size cut (see the 5211b6e0 fix entry below). A ticket on the brain's OPPOSITE side is never soft (card goes WATCH). The cut (`rhSizeCutContracts`, loss.htf.sizeMult 0.5, min 1) is applied to desk-read `deskContracts`, so the desk dispatcher (room-step → runRhDesk) sizes the same as the watcher.
  - **fast:geometry (hard):** refuse unless long stop<entry<T1(<T2) / short reversed, and the ticket's call/put matches the card side. Desk `cardEntry` takes the side from the plan's own geometry and blocks a side clash (Floor card 19:28 ET read "MNQ LONG" with short levels).
- Why: replay showed per-band caps / spreads did not raise accurate fires; the geometry and gateHand gaps were wrong-side and full-size risks found in review.
- Supersedes: the $50–$550 envelope and per-band debit caps.

### 2026-10-13 — gateHand cut: one trigger set, debit cap halved, watcher honors the desk sizeCut (Accuracy BLOCK on 5211b6e0)
- ADOPTED · Accuracy Review (re-review of 5211b6e0) · Keaton allows fire-fix work on main; rulesHash unchanged (e9662c550a50f449)
- **One cut-trigger set, both sides (union):** brain STAND, brain WAIT, brain no book, 1h/4h bias against (either one; both against still blocks below A per loss.htf), SMT / direction (hold text anchored `^(SMT|Direction)\b`), a same-side ticket in the other book, a model-estimate ticket. Desk: `GATE_HAND_CUT_TRIGGERS` / `gateHandCutTrigger` (options-desk.ts); ticketHolds now raises "Brain is waiting." and "1h/4h bias against the ticket". Watcher: `GATE_HAND_CUT_TRIGGERS` / `GATE_HAND_BRAIN_CUT` (gates.py) cuts on STAND/WAIT/no book + htf, and the desk-only triggers reach it as wire `floor.sizeCut`.
- **The cut halves the debit cap too:** `rhSizeCutDebit` (rh-autofire-gates.ts) used at manager-room-feed's envelope walk, same as firefix.effective_caps legacy (maxc×0.5, maxd×0.5). A cut A+ is 2 contracts at most $325; at a $3.00 ask that is 1 contract ($300); a single cut contract over $325 refuses `debit_cap`.
- **Watcher honors the desk's sizeCut:** gates.py reads `floor.sizeCut` into `desk_size_cut`; the stricter of desk and watcher wins (either one cuts). It no longer just overwrites with its own htf result.
- Opposite-side brain is still never soft (WATCH / fast:agree refuse).
- Verify: verify-rh-autofire-gates (cut A+ $3.00 → 1ct ≤ $325, WAIT cuts on the desk, trigger parity vs watcher gates.py); watcher tests/test_firefix.py.

### 2026-10-13 — gateHand cut held on the live ask; brain whitelist; htf parity (Accuracy BLOCK on ac6c36ee)
- ADOPTED · Accuracy Review (re-review of ac6c36ee) · rulesHash unchanged (e9662c550a50f449)
- **Cut cap on the live ask:** the Floor card's `sizeCut` rides ManagerRoomState.floor → `RhAutofireCandidate.sizeCut` / `maxDebitTotal` (= `rhSizeCutDebit`, $325 on A+). `proposeRhLiveOption` walks a cut ticket down on the LIVE ask to fit $325 and refuses `debit_cap` if one contract is over; `mayPlaceAfterReview` (dispatcher passes `sizeCut`) refuses a review-time debit over the cut cap. options-desk `cutCapHold` holds a cut card (WATCH) when one cut contract is over $325. Model $1.60×2 at a live $3.00 ask → 1ct ($300).
- **Brain whitelist:** only TAKE is full size. STAND, WAIT, null / empty and any unknown word are cut triggers on both sides (desk hold "Brain is not TAKE", trigger `brain_not_take`; watcher `GATE_HAND_BRAIN_FULL = ("TAKE",)`).
- **1h/4h parity:** the desk reads bias1h/bias4h off the candidate matching the ticket (book + side), not candidates[0]. Both 1h and 4h against is a CUT on every unblocked band on both sides — the A+ sweep+displacement full-size exception is removed from `htfGuard` (loss-guards.ts) and `loss_htf` (gates.py); below loss.htf.minBand still blocks.
- **Parity verify does not skip:** the trigger list is vendored at scripts/fixtures/gate-hand-triggers.json (identical copy in the watcher's tests/fixtures). The desk list is checked against it everywhere (CI included); a watcher checkout, when present, is checked too.
- **Known gaps:** (1) the server never has a live chain, so every handed server A+/A carries the model-ticket trigger and is always cut; the cut cap is now enforced on the live ask at propose/review. (2) The desk does not produce bias1h/bias4h yet, so the desk-side htf trigger is dead code until those keys exist; the watcher still cuts on htf.

### 2026-10-15 — restamp agents edit, never rewrite; every clone sets core.hooksPath
- ADOPTED · after the 5aafe4d6 break
- The restamp stub emptied `src/lib/trading/week-ahead.ts` at `5aafe4d6` and broke main; fixed in `cebd9c4d` (Accuracy APPROVE); the later restamp `78aef9fe` passed.
- **Decision:** restamp agents make targeted edits, never whole-file rewrites; every clone runs `git config core.hooksPath scripts/hooks` so typecheck + `verify-all --baseline` run before push.
- Why: the whole-file rewrite produced a stub, and a clone without the hook pushed it clean.

### 2026-10-15: intraday option tickets are 0DTE ATM; 1DTE+ is swing-only; late day blocks
- ADOPTED · Keaton (owner rule, chat 2026-10-15) · PR #19 · rulesHash 47c62fe3d2355d3d → 7d151e5fed7fe3eb (main e7338987cbc7eea5)
- Intraday tickets (path/continuation, Judas/killzone) on QQQ/SPY are 0DTE ATM, with 1 OTM only when the cap needs it, and never a spread. 1DTE+ only for swing-classified cards (SMT lead, event, swing spans).
- From `optExec.intradayTicket.lateBlockEt` (15:25 ET) intraday is BLOCKED, never silently rolled to 1DTE (desk, Floor ticketCheck, watcher picker).
- Supersedes the edge-research-1015 1DTE pick made earlier the same day.

### 2026-10-16 — SHADOW PR #37: Rule 1 Δ0.7 0DTE ticket (overnight-1016 #1)
- **Status:** PROPOSED · **Decided by:** Keaton (approved shadow build 2026-10-16, chat) · **Source:** `audits/overnight-1016/report.md` item 1 / Top-10 #1 (line 156); validation in `docs/shadow-1016/d70/`
- **Decision:** Shadow-only. Desk computes `wire.rule1[].ticketD70` (Δ0.7 0DTE next to the current ticket and ATM). Brain/Floor show a narrative line; watcher patch logs `d70`/`atm` with `d70_live:false`. **No live sizing, staging, or orders.** `shared/desk-rules.json` untouched; **RULES_HASH stays `a4bfcb65c88badcd`**. Config lives in `shared/rule1-d70.json`.
- **Accuracy Review fixes (this entry):** (1) `_doc` matches validation — d0.7 beats ATM only under the study's cost model (+$42.7/trade paired, t 6.10, n 716; both negative −$40.9 vs −$116.1/wk); under the desk model both are positive (+$35.6 vs +$42.8/wk), d0.7 −$4.1/trade vs ATM (t −0.55). (2) README/PR body no longer imply both lose money unconditionally. (3) Over $650: validation counted no-trade; overnight line 156 steps down Δ0.6→ATM — shadow ticket logic now steps down (shadow only), with a test.
- **Why:** overnight-1016 ticket change; the Δ0.7-over-ATM ordering replicates only under the study cost model (not the desk model). Kept off the live path until a later promote decision.
- **File scope:** does not overlap lane (#38) or push (#39) feature files.

### 2026-10-16 — SHADOW PR #38: Rule 1 persist-exempt fire lane (overnight-1016 #2)
- **Status:** PROPOSED · **Decided by:** Dual Desk / overnight-1016 build queue · **Source:** `audits/overnight-1016/report.md` items 2–3 (fire lane + latency c); validation in `docs/shadow-1016/lane/`
- **Decision:** Shadow-only. Desk stamps `wire.rule1[].lane = {lane:"rule1", mode:"shadow", live:false, persistExempt, … wouldFire}`. Watcher patch logs would-fire + latency to `rule1_lane_shadow.jsonl` with `broker:false`, `orders:0`, `live:false`. **Nothing fires.** Live fast chain, gates, and RH order path unchanged. Config in `shared/rule1-lane.json` outside `shared/desk-rules.json`; **RULES_HASH stays `a4bfcb65c88badcd`**.
- **Why:** Measure the persist-exemption latency benefit (~+0.015R/trade on the desk Rule 1 set) without arming a live lane.
- **File scope:** does not overlap Δ0.7 (#37) or push (#39) feature files.

## 2026-10-16 — SHADOW: xAI Grok reader (GROK_READER, default off)
Keaton approved a Grok "shadow reader" only if it adds no blocking layer, latency or strictness. `src/lib/grok-reader/` + `shared/grok-reader.json` (outside shared/desk-rules.json; RULES_HASH a4bfcb65c88badcd unchanged). With GROK_READER=1 and XAI_API_KEY set, build-desk fires-and-forgets (setTimeout 0, 4s abort, never awaited) a read of B+ or better cards (re-read when entry or newest array changes) and a once-per-closed-5m RTH missed-setup check (MSS / 15m gap tap / LH-HL with no actionable desk card). Prompt = SMC/ICT + desk knowledge pack + 1m/5m/15m/1h/4h OHLC, levels and arrays. Output → `payload.grokReads` (display line in Brain/Floor) + `[grok-reader]` log. Daily call cap 150, spend cap $1. Model grok-4.20-0309-non-reasoning ($1.25/$2.50 per MTok, docs.x.ai/docs/models). No gate, score, fire path or hash reads it (scripts/grok-reader.test.mjs).
