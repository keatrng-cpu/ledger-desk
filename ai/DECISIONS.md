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
| Judas release vs hard-block | OPEN — pending WS-J1 | Trading Stand → DECISION keep/kill | plan §5 Q5 | `src/lib/trading/judas-window.ts` |
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
