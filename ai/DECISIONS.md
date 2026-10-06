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
| NOW/DECISIONS location | PROPOSED (see 2026-10-06) | Dual Desk pick · Accuracy Review | plan §5 Q8 | — |

Other plan §5 questions (PATH n, Kalshi FLB, QQQ/SPY basis, PM vendor, server runner vs PATH) are tracked in `ai/NOW.md` → Open questions.

---

## Log

### 2026-10-05 — Keep Graphify as the code map; markdown canon beside it
- **Status:** ADOPTED · **Decided by:** Keaton (workspace-wide canon convention) · **Source:** Keaton standing instruction relayed to Graph Keeper; restated in issue #7 ("Git is the bus; Graphify stays the code map") and HANDOFF `defa9e0` Decision 2.
- **Decision:** Graphify output (`graphify-out/`, incl. `GRAPH_REPORT.md`) is the code map. Human-readable canon (`ai/NOW.md`, `ai/DECISIONS.md`, `ai/HANDOFF.md`, `ai/research/INDEX.md`) sits beside it as markdown. Neither replaces the other.
- **Why:** The graph answers "where/what connects"; canon answers "what is true now and why". Keeping them separate stops narrative from drifting into the code map and vice versa.
- **Note:** As of 2026-10-06 Graphify has not been run in this repo (`graphify-out/` absent on `main`). The `GRAPH_REPORT.md` on branch `graph/2026-10-06-ws-kg0-knowledge-spine` is a hand-built seed.

### 2026-10-05 — Git is the bus
- **Status:** ADOPTED · **Decided by:** Keaton · **Source:** Keaton standing instruction; issue #7 Decisions; HANDOFF `defa9e0` Decision 1.
- **Decision:** Desks and agents communicate through commits on branches. Uncommitted work is invisible and counts as not done.
- **Why:** Multiple agents (Grok-side desks, Claude) work the same repo; the commit history is the only shared, durable, reviewable record.

### 2026-10-05 — One task in flight per repo
- **Status:** ADOPTED · **Decided by:** Keaton · **Source:** Keaton standing instruction; issue #7 ("In flight (one task per repo)"); HANDOFF `defa9e0` Decision 3.
- **Decision:** Exactly one workstream is in flight per repo. The next queue item starts only when the current one is done or explicitly parked by Dual Desk.
- **Why:** Prevents parallel half-finished branches and conflicting canon; makes "what is happening" answerable from one line.

### 2026-10-06 — Phase 1–3 owner assignments; WS-KG0 in flight
- **Status:** ADOPTED · **Decided by:** Dual Desk · **Source:** HANDOFF `defa9e0` (branch `coord/2026-10-06-desk-assignments`); issue #7.
- **Decision:** One primary owner per workstream per the HANDOFF owner table; queue order KG0 → P1 → BP → PRE → CAL → D1 contracts → D1 code → C1 → J1 → DASH → FLOOR → PM → DASH PM → FLOOR PM → size-ups (blocked).
- **Why:** Plan `09aad4b` owner labels were suggestions; Dual Desk assigns.

### 2026-10-06 — Merge path and standing guards
- **Status:** ADOPTED · **Decided by:** Dual Desk · **Source:** HANDOFF `defa9e0` Decisions 4–7; plan §4 Merge path; issue #7.
- **Decision:** (a) feature/research branch → Accuracy Review → Release Watch → Design Atelier merges to `main`. (b) No size-ups until PATH n ≥ 100 and expected-R gates (`profit-path.ts` `PROFIT_MIN_SAMPLE` / `PROFIT_TARGET_EXPECTANCY_R`; ROADMAP). (c) No live orders from WS-BP / WS-PRE; RH env arms remain human. (d) Do not lower the confluence floor to manufacture clears.
- **Why:** Sample before size-up; no unverified numbers reach `main`.
- **Open note for Accuracy Review:** plan cites a 0.75 floor (Trading-Automation `knowledge/confluence.json`); ledger-desk `src/lib/aplus/config.ts` sets `confluenceFloor: 0.65` (A+ ≥ 0.75 per `CLAUDE.md`). Guard (d) applies to both; workstreams should name which one they mean. Also `CLAUDE.md` "When coding" still says "Push to main" — conflicts with (a); needs Keaton/Dual Desk reconciliation.

### 2026-10-06 — Canon location: `ai/` (not `.grok/` or `PROGRAM.md`)
- **Status:** PROPOSED — pending Accuracy Review (plan §5 Q8 marks it a Dual Desk pick; HANDOFF `defa9e0` already places the files under `ai/`; Graph Keeper concurs).
- **Decided by:** Graph Keeper (proposal) · **Source:** repo tree on `main` @ `008cbec`; plan `09aad4b` §WS-KG0 and §5 Q8; HANDOFF `defa9e0` Open question 8.
- **Decision:** `NOW.md` and `DECISIONS.md` live at `ai/NOW.md` and `ai/DECISIONS.md`, beside `ai/HANDOFF.md` and `ai/research/`. Code map stays in `graphify-out/`. No pointer file added elsewhere.
- **Why:**
  1. `ai/` already exists on `main` (`ai/research/` with two briefs); the plan's WS-KG0 Build and the HANDOFF both name `ai/` paths. Matches Keaton's workspace-wide convention (`ai/NOW.md`, `ai/DECISIONS.md`, `ai/HANDOFF.md`, `graphify-out/`).
  2. There is **no `.grok/PROGRAM`** in the repo. `.grok/` holds only `skills/` (tool skill packs) and `status` (a workspace-server runtime JSON) — tool config, not canon.
  3. Root **`PROGRAM.md` is a different document**: an unsigned regulatory program/track-record definition with `DECIDE:` blocks, meant to be sealed (`npm run seal`) and pinned to a public timestamp. Mixing living session state into it, or editing it to add a pointer before it is sealed, would muddy its dated-evidence purpose. So no pointer line was added there.
  4. Tool-neutral: Claude and Grok both read `ai/`; putting canon under `.grok/` would make it Grok-specific (Claude has its own `.claude/`).
- **Follow-up (not done here):** for "agents load NOW each session" to be automatic, `AGENTS.md` / `CLAUDE.md` need a one-line pointer to `ai/NOW.md` after merge — owner/approval: Keaton or Dual Desk.
