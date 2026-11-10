# NOW — ledger-desk current truth
**As of:** 2026-11-10 (UTC) · **Maintainer:** Graph Keeper · **Repo:** `keatrng-cpu/ledger-desk`
**Branch of this file:** `main` HEAD is `cc3786d`.
**Tracking:** issue #7 · plan `ai/research/2026-10-06-desk-implementation-plan.md` @ `09aad4b` · HANDOFF `ai/HANDOFF.md` @ `ceb62b7`
> Current truth only. History is `ai/DECISIONS.md`. Keep under 150 lines.
## Current patch (2026-11-10, merged)
- Grok (`cc3786d`) updated `week-ahead.ts`: Dec hike odds ~84% pre-CPI (CME FedWatch, up from ~68% Nov 8), noted BLS will not publish YoY for Oct CPI (prior shutdown). This-week NQ range so far ~26.75k–28.13k under PWL.
- Refused as always: touching `src/lib/aplus/config.ts`, inventing CWH/CWL/fills, padding files to clear guard floors.
- `scripts/verify-repo-guards.mjs` still fails two floors that were already red on `main`: `week-ahead.ts` line count and `week-prints.json` entry count. Not padded to go green.
## Canary
Latest session-partner read (2026-11-10 10:06 ET mid-session): `week-ahead.ts` 605 lines, `month-ahead.ts` 655 lines — no truncation/fabrication signature, unchanged since 09:06 ET. Bookmark moved `1dc50d1` → `fae1b12` (that one commit was the prior run's own agent-sync bookmark; nothing further to read). Today (Tue Nov 10) is CPI day: CPI (Oct) 08:30 ET high-impact, confirmed in `news-calendar.json`; no YoY printed this cycle.
## Live constraints
- If copy and `src/lib/aplus/config.ts` disagree, code wins. Agents do not change those numbers.
- Do not lower the confluence floor. A+ is the 0.75 edge. B+ live stays behind `evaluateRhBplusGate`.
- This patch places no order. Robinhood env arms stay human.
- No invented fills or future actuals.
## Open questions (not decided here)
CBDR clock, flout, `sponsored` rename, PATH graded n toward 100, Judas release vs hard-block, Kalshi FLB persistence, QQQ/SPY options vs NQ/ES transfer, NOW/DECISIONS location, PM data vendor, server-side runner vs PATH journal. Detail stays in `ai/DECISIONS.md` and HANDOFF `ceb62b7`.
Floor wording still split: some plan text says 0.75; ledger-desk execute floor in config is 0.65 and A+ is 0.75. Do not lower either. State which number a workstream means.
## Owners
Unchanged from HANDOFF `ceb62b7` / issue #7: Keaton locks questions; Graph Keeper owns this canon; Dual Desk assigns; Trading Stand owns the routine; Accuracy Review then Release Watch then Design Atelier merge to `main`.
## Where things are
- Numbers: `src/lib/aplus/config.ts` · protocol: `CLAUDE.md`
- Week plan: `src/lib/trading/week-ahead.ts` · prints: `src/data/week-prints.json`
- Decisions: `ai/DECISIONS.md` · research index: `ai/research/INDEX.md`
