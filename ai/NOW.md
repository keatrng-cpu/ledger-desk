# NOW — ledger-desk current truth

**As of:** 2026-10-06 (UTC) · **Maintainer:** Graph Keeper · **Repo:** `keatrng-cpu/ledger-desk`
**Branch of this file:** `graph/2026-10-06-ws-kg0-knowledge-spine` (not on `main` until Accuracy Review + Release Watch approve and Design Atelier merges)
**Tracking:** issue #7 · plan `ai/research/2026-10-06-desk-implementation-plan.md` @ `09aad4b` · HANDOFF `ai/HANDOFF.md` @ `ceb62b7` (branch `coord/2026-10-06-desk-assignments`; assignments first committed at `defa9e0`)

> Keep this file under 150 lines. It states what is true now, not history. History goes in `ai/DECISIONS.md`.

---

## Read order (every session)

1. `ai/NOW.md` — this file
2. `graphify-out/GRAPH_REPORT.md` — code map from a real Graphify run (`graphify extract . --code-only`, 2026-10-07). Open `graphify-out/obsidian/` as a vault. The trading book is `graphify-out/obsidian/brain/`. The older import ranking is `graphify-out/SEED_REPORT.md`.
3. `ai/DECISIONS.md` — append-only decision log + open locks
4. `ai/HANDOFF.md` — Dual Desk's current packet (today only on branch `coord/2026-10-06-desk-assignments` @ `ceb62b7`)
5. Then file search (`CLAUDE.md` code map, `ai/research/INDEX.md`, source)

Precedence already set by the repo: `AGENTS.md` defers to `CLAUDE.md`; if `CLAUDE.md` conflicts with `src/lib/aplus/config.ts`, **code wins**. This canon does not override either.

---

## Goal

Fold the Research Desk implementation plan (`09aad4b`) into ledger-desk with one owner per workstream and **one task in flight**. Plan §1 goals: profitability, probability (honest calibrated odds), productivity, intelligence. Binding constraint per plan/ROADMAP: **sample before size-up** — the PATH journal must reach n ≥ 100 before any size-up or autonomy expansion.

## In flight (one task per repo)

| Slot | Workstream | Owner | State |
|---|---|---|---|
| ▶ 1 | **WS-KG0 Knowledge spine** | Graph Keeper | This branch: `ai/NOW.md`, `ai/DECISIONS.md`, `ai/research/INDEX.md`, `graphify-out/GRAPH_REPORT.md` — Accuracy Review passed @ `8ced8f4`, nothing blocking (per Dual Desk; review note `reviews/2026-10-06-ws-kg0-8ced8f4.md` not found on any branch at 06:15 UTC); Dual Desk fixes S1–S4 on top; next Release Watch → Design Atelier |
| next | WS-P1 PATH journal → n ≥ 100 | Trading Stand | Queued; starts when KG0 is accepted or parked by Dual Desk |

Full queue (15 items) lives in issue #7 and `ai/HANDOFF.md`; not duplicated here.

## Live constraints

- **Git is the bus.** Work, research, and assignments land on branches; that is how desks see each other.
- **Brain lab** (`brainlab/`, 2026-10-07). Yahoo, swing legs, and a local note store for audit. Streamlit: `streamlit run brainlab/app.py`. Not an order path. CodeRabbit reads `.coderabbit.yaml`. PR-Agent runs on a `/review` comment once `OPENAI_KEY` is set.
- **Uncommitted work is invisible.** If it is not committed and pushed, no other desk, agent, or session can see it — treat it as not done.
- **One task in flight per repo.** Do not start the next queue item until the current one is done or explicitly parked by Dual Desk.
- **Merge path:** branch → Accuracy Review → Release Watch → **Design Atelier merges** to `main`. No direct commits to `main` from desk work.
- **No size-ups** until PATH n ≥ 100 and the expected-R gate pass (`src/lib/trading/profit-path.ts`; ROADMAP). Separate Accuracy Review ticket.
- **No live orders** from WS-BP / WS-PRE; Robinhood env arms remain human.
- **Do not lower the confluence floor** to manufacture clears (see ambiguity note in Open questions).
  - Grade bands in code (`riskGradeFromScore`, `src/lib/aplus/config.ts:99-107`; same edges for complete sequences in `pathBand`, `src/lib/trading/strategy-grade.ts:422-429`): **A+ ≥ 0.75** (`aPlusThreshold`, config.ts:20) · **A ≥ 0.68** (`confluenceFloor + 0.03`, config.ts:101) · **A− ≥ 0.65** (`confluenceFloor`, config.ts:22, :102) · **B+ ≥ 0.60** (`confluenceFloor − 0.05`, config.ts:103). Verified identical at `33cfb8a` and `main` @ `008cbec`.
  - **B+ live gate** (Robinhood path, from `33cfb8a`; Accuracy + Keaton 2026-10-06): `APLUS_RULES.profitPath.bPlusLive` (config.ts:85-90) = `fitFloor: 0.6` (:86), `requireSeqTake: true` (:87), `requireNoVeto: true` (:88), `maxContracts: 1` (:89). Enforced in `src/lib/execution/rh-autofire-gates.ts`: `evaluateRhBplusGate` (:76-100 — fit < 0.60 refuses :82; SMC sequence TAKE required, unknown fails closed :85-91; veto unknown refuses :92-98) and `evaluateRhBandSize` (:103-110 — exactly 1 contract). A+/A/A− keep `RH_PATH_FLOOR = 0.65` (:36); B+ never lowers it. B+ debit stays inside `RH_MIN_DEBIT_TOTAL`/`RH_MAX_DEBIT_TOTAL` = 150/550 (:114-115).
- **No invented numbers.** Floor/dashboard digits come from code or committed packs only (plan WS-DASH / WS-FLOOR; existing verifiers).
- Canon files never place, suggest, or size trades.

## Last decision

- **Adopted 2026-10-06 (Dual Desk, HANDOFF `ceb62b7`; first committed at `defa9e0`):** owner assignments for Phase 1–3; WS-KG0 in flight; Graph Keeper next owner.
- **Proposed 2026-10-06 (Graph Keeper; still pending Keaton's acceptance — Accuracy Review's pass of WS-KG0 does not lock it):** NOW/DECISIONS live under `ai/` (not `.grok/` or `PROGRAM.md`). Reasoning in `ai/DECISIONS.md` (2026-10-06 entry).

## Open questions (from plan §5 / HANDOFF; Keaton or named owner decides)

1. **CBDR clock** for NQ/ES — which timestamp does Keaton lock? *(open lock; no CBDR code found in repo)*
2. What is **flout** on this desk? *(open lock; term not found in repo)*
3. Rename desk **`sponsored`** to avoid ICT collision? *(open lock; term used in `engine-weights.ts`, `confluence.ts`, `scanner.ts`, `smc-master.ts`, others)*
4. Current PATH graded n toward 100? *(unknown from canon — read from journal code/data, never estimate)*
5. Judas release vs hard-block — keep pending WS-J1?
6. Kalshi FLB post-2025 persistence?
7. QQQ/SPY options vs NQ/ES PD-array transfer / basis?
8. NOW/DECISIONS location — **proposed: `ai/`** (pending Keaton's acceptance)
9. PM data vendor / API for Kalshi historical bins?
10. Server-side runner (`FLOOR_BACKLOG` #44) vs PATH journal priority?

Ambiguities Graph Keeper found while building canon (for Accuracy Review):
- **Floor value wording.** Plan/issue say "do not lower 0.75 floor" citing Trading-Automation `knowledge/confluence.json`; ledger-desk `src/lib/aplus/config.ts` has `confluenceFloor: 0.65` and `CLAUDE.md`/README call 0.65 the PATH floor with A+ at ≥ 0.75. Both rules say "do not lower"; which number a given workstream means should be stated explicitly. Code bands (config.ts:99-107): A+ ≥ 0.75 · A ≥ 0.68 · A− ≥ 0.65 · B+ ≥ 0.60 (B+ live only via the explicit gate above, config.ts:85-90). So in ledger-desk 0.75 is the A+ edge and 0.65 the execute floor.
- **Push-to-main wording.** `CLAUDE.md` "When coding" says "Push to **main** so Grok and Claude share one tree"; the 2026-10-06 desk merge path is branch → AR → RW → Design Atelier. Keaton/Dual Desk should reconcile.

## Owners (desk map, from HANDOFF `ceb62b7` / issue #7)

| Role | Owns in ledger-desk |
|---|---|
| **Keaton** | Repo owner; locks open questions (CBDR, flout, sponsored, etc.) |
| **Graph Keeper** | Canon (`ai/NOW.md`, `ai/DECISIONS.md`, `ai/research/INDEX.md`) + code map (`graphify-out/`); WS-KG0 |
| **Dual Desk** | Coordinates Claude and Grok; assigns owners; owns `ai/HANDOFF.md` |
| **Trading Stand** | The trading routine for ledger-desk; WS-P1, WS-BP, WS-D1 contracts, WS-J1 |
| **Research Desk** | Research briefs under `ai/research/`; WS-CAL; co-maintains INDEX |
| **Prototype Lab** | WS-PRE, WS-DASH |
| **Site Copy** | WS-FLOOR copy/lines |
| **Claude** | Deep code: WS-D1 detector code, WS-C1, WS-PM, Graphify hooks |
| **Accuracy Review** | Merge gate: verifiers, no invented numbers |
| **Release Watch** | Actions/build health; approves after AR |
| **Design Atelier** | Merges to `main` after AR + RW; brand/visual systems |

## Where things are (pointers, not copies)

- Hard numbers: `src/lib/aplus/config.ts` (code wins) · protocol + code map: `CLAUDE.md`
- Research: `ai/research/INDEX.md`
- Program/track-record definition (unsigned draft, sealed separately): `PROGRAM.md` — **not** session canon
- Live routine: `docs/RH_LIVE_ROUTINE.md` · backlog: `docs/FLOOR_BACKLOG.md` · roadmap: `ROADMAP.md`
