# NOW — ledger-desk current truth
**As of:** 2026-11-12 (UTC) · **Maintainer:** Graph Keeper · **Repo:** `keatrng-cpu/ledger-desk`
**Branch of this file:** `main` HEAD is `2a0f223` (+ my own agent-sync bookmark commits) — **STILL BROKEN, see Canary.**
**Tracking:** issue #7 · plan `ai/research/2026-10-06-desk-implementation-plan.md` @ `09aad4b` · HANDOFF `ai/HANDOFF.md` @ `ceb62b7`
> Current truth only. History is `ai/DECISIONS.md`. Keep under 150 lines.
## Canary — STILL FAILED, unresolved ~24h (first seen 2026-11-11 10:05 ET; re-checked 08:06, 09:06, 10:06 ET on 2026-11-12)
`src/lib/trading/week-ahead.ts` is still a 7-line stub containing the literal text `// ... truncated for this example, but in real it would be full.` — production build is still broken. Fourth check, same result: no commit since the first catch (`98df51d`) touches this file — only agent-sync bookmark commits have landed. Sequence on `main`: `cc3786d` (605 lines, good) → `db6e12b` deleted the file to 0 lines → `45c9c3a` replaced it with the 7-line stub, still HEAD's version. This is the recurring truncation failure (prior: 2026-09-04, 09-20, 09-25, 10-23) — 5th/6th occurrence. **Not fixed by this session** — a push to shared `main` needs trader review. Restore: `git checkout cc3786d -- src/lib/trading/week-ahead.ts`, verify line count ~605, commit, push. `month-ahead.ts` unaffected (655 lines). No new push notification sent this run — unchanged from the 08:06 ET notice already delivered; re-alerting on the identical, already-acknowledged failure every hour is noise.
## Current patch (2026-11-10, merged, now partly reverted by the truncation above)
- Grok (`cc3786d`) updated `week-ahead.ts`: Dec hike odds ~84% pre-CPI (CME FedWatch, up from ~68% Nov 8), noted BLS will not publish YoY for Oct CPI (prior shutdown). This-week NQ range so far ~26.75k–28.13k under PWL. **This content is gone from HEAD until restored — see Canary.**
- `efaf1e7`/`e4deea3` restamped `week-prints.json` with hot Nov CPI actuals (+0.4% m/m / core +0.3%); unaffected by the truncation.
- Refused as always: touching `src/lib/aplus/config.ts`, inventing CWH/CWL/fills, padding files to clear guard floors.
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
