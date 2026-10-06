# Research INDEX — ledger-desk

**Maintainers:** Research Desk (adds entries) · Graph Keeper (verifies paths/SHAs) · **Last verified:** 2026-10-06 against `main` @ `008cbec` and the branches listed.
**Rule:** list only documents that exist at the stated path and commit. No placeholders for planned docs. Add a row in the same commit that adds a research doc.

Columns: **Doc** · **Where it lives** (branch @ commit that contains it) · **Added by commit** · **Blob SHA** · **Feeds workstreams** (plan §6 traceability)

---

## On `main`

| Doc | Path | Added by commit(s) | Blob SHA | Feeds |
|---|---|---|---|---|
| NY AM Session Brief — Tue 2026-10-06 | [`ai/research/2026-10-06-ny-am-session-brief.md`](https://github.com/keatrng-cpu/ledger-desk/blob/main/ai/research/2026-10-06-ny-am-session-brief.md) | [`86e592f`](https://github.com/keatrng-cpu/ledger-desk/commit/86e592fdddebc671931f1ba32f951eda5beef107) (initial) · [`7c498de`](https://github.com/keatrng-cpu/ledger-desk/commit/7c498de79bf860b6198a4ca05f80cbaa9d8db2e1) (adds options buying power + open levels) | `72d5887` | WS-CAL, WS-PRE (§§1–4); WS-BP (§5); WS-KG0 (open questions) |
| Prediction-Market Signal Engine — Evidence Base (2026-10-06) | [`ai/research/2026-10-06-pm-signal.md`](https://github.com/keatrng-cpu/ledger-desk/blob/main/ai/research/2026-10-06-pm-signal.md) | [`0f83a1a`](https://github.com/keatrng-cpu/ledger-desk/commit/0f83a1af4fed2dc20f943296f8474ceed64de33f) | `83d37c7` | WS-PM (§4); WS-C1, WS-DASH (§3) |

## On branches (not yet merged)

| Doc | Branch @ commit | Path | Blob SHA | Feeds |
|---|---|---|---|---|
| Desk Implementation Plan — Fold Research into ledger-desk (2026-10-06) | `research/2026-10-06-desk-implementation-plan` @ [`09aad4b`](https://github.com/keatrng-cpu/ledger-desk/commit/09aad4bc7766d76ba321e14a500773549a0480a7) | [`ai/research/2026-10-06-desk-implementation-plan.md`](https://github.com/keatrng-cpu/ledger-desk/blob/09aad4bc7766d76ba321e14a500773549a0480a7/ai/research/2026-10-06-desk-implementation-plan.md) | `f7b7cf5` | All workstreams; source of WS-KG0 scope/accept |
| SMC/ICT Taxonomy Deep Dive — ledger-desk / Trading Stand (2026-10-06) | `research/2026-10-06-smc-deep-dive` @ [`a278500`](https://github.com/keatrng-cpu/ledger-desk/commit/a278500db46c31b48bff0dadb497d1a9aeabbad0) | [`ai/research/2026-10-06-smc-deep-dive.md`](https://github.com/keatrng-cpu/ledger-desk/blob/a278500db46c31b48bff0dadb497d1a9aeabbad0/ai/research/2026-10-06-smc-deep-dive.md) | `0175af2` | WS-D1, WS-KG0 (§2 inventory, §2.3 gaps); WS-C1, WS-P1, WS-PRE, WS-J1 (§§10–11); open locks CBDR §9.19, flout §9.20, sponsored §9.2 |

Both research branches also carry copies of the two `main` briefs (same blob SHAs `72d5887`, `83d37c7`); they are not separate documents.

## Related coordination doc (not research — listed for read order)

| Doc | Branch @ commit | Path | Owner |
|---|---|---|---|
| HANDOFF — Desk implementation plan owner assignments | `coord/2026-10-06-desk-assignments` @ [`ceb62b7`](https://github.com/keatrng-cpu/ledger-desk/commit/ceb62b72f0cdd5985bf1a950d4d0331289b2916d) (first committed at [`defa9e0`](https://github.com/keatrng-cpu/ledger-desk/commit/defa9e083ab61b1df47d812b89aeb781cafad419)) | `ai/HANDOFF.md` (blob `7023398` at `ceb62b7`) | Dual Desk |

## Other repo docs agents commonly need (on `main`, not research)

`CLAUDE.md` (protocol + code map) · `ROADMAP.md` · `PROGRAM.md` (unsigned program-definition draft) · `docs/RH_LIVE_ROUTINE.md` · `docs/FLOOR_BACKLOG.md` · `docs/ENGINE_BRIDGE.md` · `INTEGRATION-A.md`…`INTEGRATION-E.md`, `INTEGRATION-P0.md`…`INTEGRATION-P4.md`

## Not yet present (named by the plan, do not link until they exist)

`docs/DETECTOR_CONTRACTS.md` (WS-D1) · ablation keep/kill/needs-n report (WS-C1) · Judas A/B note (WS-J1) · recurring `ai/research/YYYY-MM-DD-ny-am-session-brief.md` beyond 2026-10-06 (WS-CAL).
