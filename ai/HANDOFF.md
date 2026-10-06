# HANDOFF — Desk implementation plan owner assignments
**Date:** 2026-10-06  
**Repo:** keatrng-cpu/ledger-desk  
**Source plan:** `ai/research/2026-10-06-desk-implementation-plan.md` on branch `research/2026-10-06-desk-implementation-plan` @ SHA `09aad4b`  
**Supporting research:** `research/2026-10-06-smc-deep-dive` @ `a278500`; on main: `ai/research/2026-10-06-ny-am-session-brief.md`, `ai/research/2026-10-06-pm-signal.md`  
**Coord branch:** `coord/2026-10-06-desk-assignments` (this file)

---

## Goal

Fold the Research Desk implementation plan into ledger-desk with one clear owner per workstream, one task in flight per repo, and the merge path: branch → Accuracy Review + Release Watch → Design Atelier merges. No push to main from this packet; no Netlify/Robinhood deploy from coordination.

---

## Status — 2026-10-06

**Accuracy Review passed** WS-KG0 @ `8ced8f4` (notes: `reviews/2026-10-06-ws-kg0-8ced8f4.md`).

**Graph Keeper** is applying should-fixes **S1–S4** on the same branch `graph/2026-10-06-ws-kg0-knowledge-spine`. **Release Watch** follows, then Design Atelier merges.

| | |
|---|---|
| **Branch** | `graph/2026-10-06-ws-kg0-knowledge-spine` |
| **Reviewed commit** | `8ced8f4` (cut from main @ `008cbec`) |
| **Adds** | `ai/NOW.md`, `ai/DECISIONS.md`, `ai/research/INDEX.md`, `graphify-out/GRAPH_REPORT.md` (hand-built seed; no `graph.json` yet) |
| **Next owner** | Graph Keeper (S1–S4) → **Release Watch** → **Design Atelier** merges |
| **After merge** | Queue resumes at **WS-P1** (Trading Stand) |

**Confluence floor (AR correction):** ledger-desk `src/lib/aplus/config.ts:22` sets **`confluenceFloor` 0.65**. Bands: **A+ ≥0.75**, **A ≥0.68**, **A− ≥0.65**, **B+ ≥0.60**. **B+ is a live gate** (fit 0.60, 1 contract — `config.ts:85-90`, `rh-autofire-gates.ts:36,65`, added in `33cfb8a`). The **0.75** figure is **not** this repo’s floor; it comes from Trading-Automation `knowledge/confluence.json:7`. Do not lower the **0.65** floor to manufacture clears.

---

## Inventory (read 2026-10-06)

### Main top-level (non-recursive)
`.claude/` · `.env.example` · `.gitignore` · `.grok/` · `.node_modules.lock` · `.prettierrc` · `AGENTS.md` · `CLAUDE.md` · `INTEGRATION-A.md`…`INTEGRATION-E.md` · `INTEGRATION-P0.md`…`INTEGRATION-P4.md` · `PROGRAM.md` · `README.md` · `ROADMAP.md` · `ai/` · `attachments/` · `docs/` · `eslint.config.mjs` · `gateway/` · `migrations/` · `netlify.toml` · `netlify/` · `package-lock.json` · `package.json` · `public/` · `scripts/` · `server/` · `src/` · `startup.sh` · `tsconfig.json` · `vercel.json` · `vite.config.ts`

### Canon / spine on main
| Path | Status |
|---|---|
| `ai/NOW.md` | **Missing on main** — present on `graph/2026-10-06-ws-kg0-knowledge-spine` @ `8ced8f4` (AR passed; S1–S4 in flight) |
| `ai/DECISIONS.md` | **Missing on main** — present on KG0 branch @ `8ced8f4` (AR passed; S1–S4 in flight) |
| `ai/HANDOFF.md` | **Missing on main** (lives on this coord branch) |
| `ai/research/INDEX.md` | **Missing on main** — present on KG0 branch @ `8ced8f4` (AR passed; S1–S4 in flight) |
| `graphify-out/GRAPH_REPORT.md` | **Missing on main** — seed on KG0 branch @ `8ced8f4` (no `graph.json` yet) |
| `ai/research/` on main | Present: `2026-10-06-ny-am-session-brief.md`, `2026-10-06-pm-signal.md` |

Plan note (WS-KG0): NOW/DECISIONS gap tracked; AR passed `8ced8f4`; Graph Keeper applying S1–S4.

### Verified paths cited by plan (exist on main)
`docs/RH_LIVE_ROUTINE.md` · `docs/FLOOR_BACKLOG.md` · `docs/ENGINE_BRIDGE.md` · `ROADMAP.md` · `src/lib/trading/smc-canon.ts` · `src/lib/trading/judas-window.ts` · `src/lib/trading/profit-path.ts` · `src/lib/trading/detectors.ts` · `src/lib/trading/engine-weights.ts` · `src/lib/trading/fib.ts` · `src/lib/aplus/confluence.ts` · `src/lib/room/research.ts` · `src/routes/api/engine/journal.ts` · `src/data/news-calendar.md` · `src/data/news-calendar.json` · `src/lib/news/`

---

## Files touched (per workstream)

Paths below are from the plan Accept/Build sections and verified where noted. New files marked *(create)*.

| WS | Files |
|---|---|
| **WS-KG0** | *(create)* `ai/NOW.md`, `ai/DECISIONS.md`, `ai/research/INDEX.md`; Graph Keeper canon: term→file index; rebuild `graphify-out/` / `GRAPH_REPORT.md` when Graphify hooks land |
| **WS-P1** | `src/lib/trading/profit-path.ts` (`buildProfitPath`, `PROFIT_MIN_SAMPLE`); `src/routes/api/engine/journal.ts`; journal schema / setup-memory; dashboard by-grade/by-strategy slices |
| **WS-BP** | `src/lib/room/research.ts` (`rhAccountNote`, `rhArmedPathNote`); `docs/RH_LIVE_ROUTINE.md`; desk readiness card (no live orders) |
| **WS-PRE** | Checklist UI/API from plan §WS-PRE + `docs/RH_LIVE_ROUTINE.md` 09:08 prep; consumes WS-CAL brief |
| **WS-CAL** | `src/data/news-calendar.md` / `src/data/news-calendar.json`; `src/lib/news/`; recurring `ai/research/YYYY-MM-DD-ny-am-session-brief.md` |
| **WS-D1** | *(create)* `docs/DETECTOR_CONTRACTS.md`; later: `src/lib/trading/detectors.ts`, `src/lib/trading/fib.ts`, `src/lib/trading/engine-weights.ts`; cold ports under `src/lib/trading/` |
| **WS-C1** | `src/lib/aplus/confluence.ts`; ablation report under `ai/research/` *(create)*; FDR / walk-forward harness (Claude) |
| **WS-J1** | `src/lib/trading/judas-window.ts`; A/B research note under `ai/research/` *(create)*; DECISIONS keep/kill |
| **WS-DASH** | Calibration surface (PATH WR/E[R], confluence fire%, ablation, calendar strata; later PM); Floor Goal/R&D patterns per `docs/FLOOR_BACKLOG.md` |
| **WS-FLOOR** | `src/lib/room/research.ts` shelves; pack-backed notes only; verifiers |
| **WS-PM** | *(create)* `src/lib/pm/` (or offline research tree); FLB/Brier/Murphy/fees/WF; no autofire |

---

## Owner table

One primary owner per workstream (desk map; no role duplication). Accuracy Review gates every ship; Release Watch watches builds/Actions; Design Atelier merges after both approve.

| Phase | Workstream | Owner | Files (primary) | Done-when (from plan) |
|---|---|---|---|---|
| **1** | **WS-KG0** Knowledge spine | **Graph Keeper** | `ai/NOW.md`, `ai/DECISIONS.md`, `ai/research/INDEX.md` *(create)*; graph/canon | Agents load NOW each session; DECISIONS lists open locks (CBDR, flout, sponsored rename); INDEX has commit SHAs · plan §WS-KG0 |
| **1** | **WS-P1** PATH journal → n≥100 | **Trading Stand** | `profit-path.ts`, `journal.ts`, journal schema | `pathTradeCount` progressing with verifier; by-grade/by-strategy tables; incomplete→C enforced · §WS-P1 |
| **1** | **WS-BP** Options BP readiness | **Trading Stand** | `research.ts` RH notes, `RH_LIVE_ROUTINE.md`, readiness card | Pre-arm checklist shows blocking bucket; fail-closed if portfolio stale; no auto-place · §WS-BP |
| **1** | **WS-PRE** Pre-session checklist | **Prototype Lab** | Checklist UI/API | Completable before 09:30; incomplete blocks ready flag (env arms remain human) · §WS-PRE |
| **1** | **WS-CAL** Calendar + brief feed | **Research Desk** | `news-calendar.*`, `src/lib/news/`, recurring NY AM briefs | Blackout fail-closed when calendar unknown; brief by 08:00 ET template; metrics stratified · §WS-CAL |
| **1** | **WS-D1** Detector contracts only | **Trading Stand** | `docs/DETECTOR_CONTRACTS.md` *(create)* | Each detector contract: tick tol, body-close vs wick, ET clocks; no weight changes yet · §WS-D1 / Phase 1 |
| **2** | **WS-D1** Cold/missing detectors (code) | **Claude** | `detectors.ts`, `fib.ts`, ports under `src/lib/trading/` | Unit tests + no-look-ahead; fire% on same NQ window; cold → fire>0 or DECISIONS “scarce” · §WS-D1 |
| **2** | **WS-C1** Confluence ablation + WF + FDR | **Claude** | `confluence.ts`, harness, `ai/research/` report | Per-factor ΔE[R]+CI; keep/kill/needs-n table; do not lower **0.65** floor (A+ ≥0.75; B+ live gate ≥0.60) · §WS-C1 |
| **2** | **WS-J1** Judas Window A/B | **Trading Stand** | `judas-window.ts`, research note | Committed note with n and CI; DECISION keep/kill release · §WS-J1 |
| **2** | **WS-DASH** Calibration dashboard (PATH slice) | **Prototype Lab** | Dashboard surface | Every digit from code; PATH+confluence slice shippable · §WS-DASH |
| **2** | **WS-FLOOR** Smarter Floor characters | **Site Copy** | `research.ts` shelves / lines | Each character cites source id; verify-* covers new notes; no verdict/order language · §WS-FLOOR |
| **3** | **WS-PM** Prediction-market signal engine | **Claude** | `src/lib/pm/` *(create)* | FLB, MAE/Brier, Murphy, fee calc, WF runnable offline; no autofire until AR · §WS-PM |
| **3** | **WS-DASH** PM panels | **Prototype Lab** | Dashboard PM panels | PM Brier/FLB digits registered from code · §WS-DASH / Phase 3 |
| **3** | **WS-FLOOR** PM + brief shelves | **Site Copy** | `research.ts` | Pack-only PM + brief one-liners · §WS-FLOOR / Phase 3 |
| — | Merge gate | **Accuracy Review** | Any shippable PR | Verifiers + no invented numbers · plan §4 Merge path |
| — | Build/deploy watch | **Release Watch** | Actions / build health | Approve after AR; no research-branch product merge · §4 |
| — | Merge to main | **Design Atelier** | main | Merges after AR+RW · §4 |
| — | Brand/visual systems | **Design Atelier** | DASH/FLOOR visuals as needed | Layout/brand consistency · §WS-DASH/FLOOR suggestions |

Grok-side bots: research, graph queries, briefs, routines (support Graph Keeper / Research Desk). Claude (Keaton’s coding agent, outside this bot system): deep code — detectors, ablation/WF, signal engine, Graphify hooks.

---

## Sequencing queue

**One task in flight per repo.**

1. **▶ IN FLIGHT — WS-KG0** — AR **passed** `8ced8f4`; Graph Keeper applying **S1–S4** on `graph/2026-10-06-ws-kg0-knowledge-spine`; then **Release Watch** → **Design Atelier** merges
2. WS-P1 PATH journal — Trading Stand *(after KG0 merges)*
3. WS-BP Buying-power readiness — Trading Stand
4. WS-PRE Pre-session checklist — Prototype Lab
5. WS-CAL Calendar + brief feed — Research Desk
6. WS-D1 Detector contracts only — Trading Stand
7. WS-D1 Cold/missing detector code — Claude
8. WS-C1 Ablation + walk-forward + FDR — Claude
9. WS-J1 Judas A/B — Trading Stand
10. WS-DASH PATH+confluence slice — Prototype Lab
11. WS-FLOOR Pack-backed characters — Site Copy
12. WS-PM Minimal PM engine — Claude
13. WS-DASH PM panels — Prototype Lab
14. WS-FLOOR PM + brief shelves — Site Copy
15. Size-up / RH autonomy — **blocked** until PATH n≥100 and E[R] gate; separate AR ticket (plan Phase 3 / ROADMAP)

Critical path (plan §4): KG0 → P1 → (journal accruing) while D1 contracts + CAL can prepare in parallel only after the single in-flight slot frees.

---

## Decisions

1. **Git is the bus** — assignments and research land on branches; this packet on `coord/2026-10-06-desk-assignments`.
2. **Graphify stays the code map** — Graph Keeper rebuilds graph/canon; seed `GRAPH_REPORT.md` on KG0 branch (no `graph.json` yet).
3. **One task in flight per repo** — queue above; do not start #2 until #1 is done or explicitly parked by Dual Desk.
4. **Merge path:** feature/research branch → **Accuracy Review** → **Release Watch** → **Design Atelier** merges to main.
5. **No size-ups** until PATH n≥100 and expected-R gates (`profit-path.ts` `PROFIT_MIN_SAMPLE` / `PROFIT_TARGET_EXPECTANCY_R`; ROADMAP).
6. **No live orders** from BP/PRE workstreams; RH env arms remain human.
7. **Do not lower** ledger-desk **`confluenceFloor` 0.65** (`src/lib/aplus/config.ts:22`) to manufacture clears. Bands: A+ ≥0.75, A ≥0.68, A− ≥0.65, B+ ≥0.60 (B+ live gate: fit 0.60 / 1 contract — `config.ts:85-90`, `rh-autofire-gates.ts:36,65`, `33cfb8a`). The 0.75 in Trading-Automation `knowledge/confluence.json:7` is a different repo’s number, not this floor. **AR closed OQ 11.**

---

## Open questions

Carried from plan §5 (briefs + plan):

1. CBDR clock for NQ/ES — which timestamp does Keaton lock?
2. What is **flout** on this desk?
3. Rename desk `sponsored` to avoid ICT collision?
4. Current PATH graded n toward 100?
5. Judas release vs hard-block — keep pending J1?
6. Kalshi FLB post-2025 persistence?
7. QQQ/SPY options vs NQ/ES PD-array transfer / basis?
8. Should NOW/DECISIONS live under `ai/` or `.grok`/PROGRAM — Dual Desk pick. **Proposed answer (Graph Keeper / DECISIONS): `ai/`.**
9. PM data vendor / API for Kalshi historical bins?
10. Server-side runner (`FLOOR_BACKLOG` #44) vs PATH journal priority?

Flagged by Graph Keeper / AR (2026-10-06):

11. ~~**Confluence floor mismatch**~~ — **RESOLVED by AR:** floor is **0.65** in this repo (`config.ts:22`); A+ ≥0.75 is a band, not the floor; 0.75 in plan/#7 was mis-cited from Trading-Automation `confluence.json`.
12. **NOW/DECISIONS location:** confirm proposed **`ai/`** (vs `.grok`/PROGRAM) as locked DECISION.
13. **Agent load path:** `CLAUDE.md` still says push to main (conflicts with branch→AR→RW→DA); `NOW.md` won't auto-load until `AGENTS.md`/`CLAUDE.md` point to it — out of scope for WS-KG0; who owns the doc fix?

---

## Next owner

**Graph Keeper** — apply should-fixes **S1–S4** on `graph/2026-10-06-ws-kg0-knowledge-spine` (AR passed `8ced8f4`; notes `reviews/2026-10-06-ws-kg0-8ced8f4.md`).

Then **Release Watch** (build/Actions health) → **Design Atelier** merges to main.

After KG0 lands on main → **Trading Stand** starts **WS-P1**.

---

*Dual Desk assignments 2026-10-06; status: AR passed KG0 `8ced8f4`, floor corrected to 0.65, S1–S4 then RW. No product code in this commit. No PR opened from this branch.*
