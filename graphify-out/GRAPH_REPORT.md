# GRAPH_REPORT — ledger-desk (hand-built seed)

**Status: HAND-BUILT SEED — Graphify has NOT been run in this repo.** No `graphify-out/` (and no `graphify-out/graph.json`) existed on `main` @ `008cbec` when this was written (2026-10-06). This report is a placeholder map built by Graph Keeper from the actual repo tree, `CLAUDE.md` code map, the plan `09aad4b`, and HANDOFF `defa9e0`. **Replace it with a real Graphify run (with the SHA256 file cache) when Graphify hooks land** (HANDOFF: "rebuild `graphify-out/` / `GRAPH_REPORT.md` when Graphify hooks land"; Claude owns Graphify hooks).

**Edge labels:** `EXTRACTED` = seen directly in the repo (tree, import statements, file text) or in the plan/HANDOFF/issue text. `INFERRED` = Graph Keeper's reading, not stated anywhere; verify before relying on it.

**Snapshot:** `main` @ `008cbecf9254dd667ebecd3ef0d9047af28c2400` · 687 files in tree · 400 `.ts/.tsx` files under `src/`.

---

## 1. God nodes (highest connectivity)

In-degree = number of `import … from` statements under `src/` that resolve to the module (relative and `@/` imports; counted by Graph Keeper with a one-off script, not Graphify). `EXTRACTED`.

| Rank | Module | Imported by (count) | Role (from `CLAUDE.md` code map unless noted) |
|---|---|---|---|
| 1 | `src/lib/trading/sessions.ts` | 69 | Killzones + `isJudasWindow` |
| 2 | `src/lib/aplus/config.ts` | 52 | Non-negotiable numbers (`confluenceFloor: 0.65`); **code wins** over docs |
| 3 | `src/lib/utils.ts` | 48 | Shared utilities (INFERRED from name) |
| 4 | `src/lib/market/types.ts` | 46 | Market data types (INFERRED from name) |
| 5 | `src/lib/trading/build-desk.ts` | 46 | Assembles the desk payload (freshest quotes) |
| 6 | `src/lib/trading/scanner.ts` | 36 | Per-strategy grade + candidate; vetoes as flags |
| 7 | `src/lib/room/orchestrator.ts` | 32 | Trading floor cycle (paper only) |
| 8 | `src/lib/db.ts` | 28 | Database access (INFERRED from name) |
| 9 | `src/lib/room/option-math.ts` | 27 | Room option math |
| 10 | `src/lib/auth/middleware.ts` | 22 | Auth middleware (INFERRED from name) |

Next tier (13–19 imports): `invest/universe`, `trading/trade-plan`, `trading/structure`, `trading/smc-master`, `room/mandate`, `room/live-types`, `trading/profit-rules`, `trading/draw`. `EXTRACTED`.

**Canon god node (non-code):** `CLAUDE.md` — referenced by `AGENTS.md` as the full protocol + code map (`EXTRACTED`); after merge, `ai/NOW.md` becomes the session entry point (`INFERRED`/proposed).

## 2. Communities (directory clusters)

| Community | Path(s) | Size | Notes |
|---|---|---|---|
| **Trading engine** | `src/lib/trading/` | 88 files | PATH (`profit-path.ts`, `profit-rules.ts`), SMC (`smc-board.ts`, `smc-canon.ts`, `smc-master.ts`), Judas (`judas-window.ts`), detectors (`detectors.ts`, `fib.ts`, `engine-weights.ts`), RH sleeve (`options-desk.ts`, `rh-income.ts`, `sleeve-sizing.ts`) · `EXTRACTED` |
| **Scoring rules** | `src/lib/aplus/` | 4 files | `config.ts`, `confluence.ts`, `analytics.ts`, `sample-run.ts` · `EXTRACTED` |
| **Trading floor ("room")** | `src/lib/room/` (+ `exec/`, 11 files) | 55 files | Orchestrator, agents/meeting/research shelves, paper book, execution layer (shadow→paper→live, live shut by flags) · `EXTRACTED` |
| **Execution** | `src/lib/execution/` | 13 files | Autofire gates, RH/Apex/Tradovate adapters, shadow · `EXTRACTED` |
| **Journal + attestation** | `src/lib/journal/`, `src/routes/api/engine/journal.ts` | 15 + 1 | Journal, risk, attestation hash chain (`attest.ts`) · `EXTRACTED` |
| **Market data** | `src/lib/market/`, `gateway/` | 9 + 9 | Yahoo / Databento / live gateway (Python) · `EXTRACTED` |
| **News / calendar** | `src/lib/news/`, `src/data/news-calendar.{md,json}` | 5 + 2 | Feed, schedule, thesis; blackout timing · `EXTRACTED` |
| **Prediction markets** | `src/lib/predict/` | 11 files | Kalshi/Polymarket parse, devig, sizing, scanner · `EXTRACTED` |
| **Investments** | `src/lib/invest/` | 19 files | Sweep policy, universe/dossiers, ledger · `EXTRACTED` |
| **Learn / coach** | `src/lib/learn/`, `src/lib/coach/` | 8 + 3 | Cases; in-app Grok+Claude narration only · `EXTRACTED` |
| **UI** | `src/components/` (desk 56, room 13, invest 11, …), `src/routes/` | 112 + routes | `routes/index.tsx` shell; `routes/api/*` (cron, engine, room, desk handoff) · `EXTRACTED` |
| **Verifiers / measurement** | `scripts/` | 76 `verify-*`, 12 `measure-*` | `verify-all.mjs`, `verify-repo-guards.mjs`, pre-push hook `scripts/hooks/pre-push` · `EXTRACTED` |
| **Data packs** | `src/data/`, `public/data/` | 27 + 2 | Committed JSON packs the Floor may cite · `EXTRACTED` |
| **DB schema** | `migrations/` | 19 SQL | `0001_auth` … `0019_room_exec_net` · `EXTRACTED` |
| **Deploy** | `netlify/`, `netlify.toml`, `vercel.json`, `server/middleware/` | — | Release Watch watches build health · `EXTRACTED` (owner link from HANDOFF) |
| **Agent config** | `.claude/skills/desk-accuracy/`, `.grok/skills/*`, `.grok/status` | 1 + 10 + 1 | Tool skill packs + runtime status; **not canon** · `EXTRACTED` |
| **Canon (markdown)** | `ai/NOW.md`, `ai/DECISIONS.md`, `ai/research/`, `ai/HANDOFF.md` (coord branch), `graphify-out/` | — | Added on branch `graph/2026-10-06-ws-kg0-knowledge-spine` · `EXTRACTED` |
| **Program / docs** | `PROGRAM.md`, `ROADMAP.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `INTEGRATION-*.md`, `docs/` | — | `PROGRAM.md` = unsigned program-definition draft (sealed separately) · `EXTRACTED` |

## 3. Owner → artifact edges

| Owner | Edge | Target | Label |
|---|---|---|---|
| Graph Keeper | maintains | `ai/NOW.md`, `ai/DECISIONS.md`, `ai/research/INDEX.md`, `graphify-out/` | EXTRACTED (HANDOFF, issue #7) |
| Dual Desk | owns | `ai/HANDOFF.md`; coordinates **Claude** and **Grok**; assigns workstreams | EXTRACTED (HANDOFF) |
| Trading Stand | owns | the trading routine for ledger-desk; WS-P1 (`profit-path.ts`, `journal.ts`), WS-BP (`room/research.ts` RH notes, `docs/RH_LIVE_ROUTINE.md`), WS-D1 contracts (`docs/DETECTOR_CONTRACTS.md`, not yet created), WS-J1 (`judas-window.ts`) | EXTRACTED (HANDOFF) |
| Research Desk | owns | `ai/research/*` briefs; WS-CAL (`src/lib/news/`, `news-calendar.*`) | EXTRACTED (HANDOFF) |
| Claude | owns | WS-D1 code (`detectors.ts`, `fib.ts`, `engine-weights.ts`), WS-C1 (`confluence.ts`), WS-PM (`src/lib/pm/`, not yet created), Graphify hooks | EXTRACTED (HANDOFF) |
| Prototype Lab | owns | WS-PRE checklist, WS-DASH | EXTRACTED (HANDOFF) |
| Site Copy | owns | WS-FLOOR lines (`src/lib/room/research.ts` shelves) | EXTRACTED (HANDOFF) |
| Accuracy Review | reviews | every shippable branch (verifiers, no invented numbers); `.claude/skills/desk-accuracy/` | EXTRACTED (HANDOFF) / INFERRED (skill↔role link) |
| Release Watch | reviews | Actions/build health, deploy (`netlify/`, `vercel.json`) | EXTRACTED (HANDOFF) / INFERRED (file link) |
| Design Atelier | merges | branch → `main` after AR + RW | EXTRACTED (HANDOFF, plan §4) |

## 4. Term → file index (seed for SMC taxonomy)

| Term | Files | Label |
|---|---|---|
| PATH band / min sample 100 / target E[R] | `src/lib/trading/profit-path.ts` (`PROFIT_MIN_SAMPLE`, `PROFIT_TARGET_EXPECTANCY_R`), `profit-rules.ts` | EXTRACTED |
| Confluence floor | `src/lib/aplus/config.ts` (`confluenceFloor`), `src/lib/aplus/confluence.ts` | EXTRACTED |
| Judas window | `src/lib/trading/judas-window.ts`, `sessions.ts` (`isJudasWindow`), `scripts/measure-judas.mjs`, `scripts/verify-judas-window.mjs` | EXTRACTED |
| FVG / IFVG / OB / BB / MSS / BOS / displacement | `src/lib/trading/smc-board.ts` | EXTRACTED (code map) |
| Named ICT/TJR models | `src/lib/trading/smc-canon.ts` | EXTRACTED (code map) |
| Sequence (DOL → sweep → dealing range → LTF → target → retrace) | `src/lib/trading/smc-master.ts` | EXTRACTED (code map) |
| SMT at a level, PDH/PDL, PWH/PWL | `src/lib/trading/smt-level.ts`, `structure.ts` | EXTRACTED (code map) |
| OTE / fib | `src/lib/trading/fib.ts` | EXTRACTED (term present in file) |
| `sponsored` | `engine-weights.ts`, `aplus/confluence.ts`, `scanner.ts`, `smc-master.ts`, `score-drivers.ts`, `tradezella-analyze.ts`, desk chart components | EXTRACTED (text search) |
| CBDR, flout | **no file** — open locks | EXTRACTED (absence on `main` @ `008cbec`) |
| News blackout | `src/lib/news/schedule.ts`, `src/data/news-calendar.{md,json}` | EXTRACTED |
| Journal / attestation seal | `src/lib/journal/*`, `src/routes/api/engine/journal.ts`, `scripts/seal-chain.mjs` | EXTRACTED |
| Floor research shelves | `src/lib/room/research.ts` (`rhAccountNote`, `rhArmedPathNote` per HANDOFF) | EXTRACTED |
| Prediction-market math | `src/lib/predict/*` (existing); `src/lib/pm/` proposed by plan | EXTRACTED / INFERRED (relation of the two trees not stated) |

## 5. Questions this graph can answer (seed level)

- Where is rule X defined, and what does code say vs docs? → `config.ts` (god node #2), `CLAUDE.md` precedence.
- Which owner touches which files for a workstream? → §3.
- Where does an SMC term live in code, or is it undefined? → §4 (CBDR/flout: undefined).
- What breaks most widely if a module changes? → §1 in-degree (e.g. `sessions.ts`, `config.ts`).
- Which research doc feeds which workstream, at which commit? → `ai/research/INDEX.md`.

Questions it **cannot** answer yet (need a real Graphify run): call-level edges, cross-file symbol references, dead/dark modules, change impact beyond import in-degree, anything about live performance or trade results (never in scope of this map).
