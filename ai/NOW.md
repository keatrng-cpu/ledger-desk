# NOW — ledger-desk current truth
**As of:** 2026-11-12 (UTC) · **Maintainer:** Graph Keeper · **Repo:** `keatrng-cpu/ledger-desk`
**Branch of this file:** restore branch off `main` @ `6f2d6132`. **`main` is still RED until this lands.**
**Tracking:** issue #7 · plan `ai/research/2026-10-06-desk-implementation-plan.md` @ `09aad4b` · HANDOFF `ai/HANDOFF.md` @ `ceb62b7`
> Current truth only. History is `ai/DECISIONS.md`. Keep under 150 lines.
## Canary — fix is on the restore branch, not on main yet
`main` @ `6f2d6132` fails `ci` Typecheck (run 43244537522). Cause, confirmed from that log:
- `src/lib/trading/week-ahead.ts` is the 7-line stub from `45c9c3af` (`db6e12b8` deleted the 605-line file). It is not a module. The implicit-`any` errors in `week-ahead-panel.tsx`, `desk-read.ts`, and `live-world.ts` are that failure cascading.
- `src/lib/trading/month-ahead.ts` has not exported `monthAheadFocusLine` or `monthPhaseFor` since `1f5ddb1c` dropped them (`b5cbe26f` had already emptied the file). Callers: `session-hud.tsx`, `session-brief.ts`, `veteran-brain.ts`.
- Lint, Test, and Repo guards did not run. Once typecheck is fixed, repo guards still fail on `week-prints.json`: 15 entries, floor 30. Last full file on `main` was `227abe75` (45 entries), gutted by `de68d47c`.

This branch puts the file back from `cc3786de` (605 lines) and stamps the Nov 10 CPI actuals into the Tue plan. It puts the two month functions back, looping `MONTH_PLANS`. It puts the 45 historical print rows back and keeps the 14 later stamps. Local `tsc`, `npm test` (629 pass, 0 fail), and `verify-repo-guards.mjs` (65 pass) are green. GitHub `ci` on the PR is the check that counts.
## CPI actuals (sourced)
BLS USDL-26-1685, https://www.bls.gov/news.release/archives/cpi_11102026.htm : CPI-U **+0.4%** m/m SA in October after **+0.6%** in September; core (all items less food and energy) **+0.3%** m/m, same as September and August; **no 12-month change** because October 2025 was not collected.
`week-prints.json` `actual` and `vs` for 2026-11-10 CPI are unchanged from `efaf1e7f`: `+0.4% m/m / core +0.3% m/m` and `exp 0.3%/0.2% / prev 0.6%/0.3%`. Consensus is not on the BLS page. Dow Jones via CNBC expected 0.3% / 0.2% core; Reuters economists expected 0.3% headline.
## Refused
- Post-print FedWatch odds. The gutted note said ~100% (25bp ~85%, 50bp ~15%). That sentence is not on the BLS release and was not copied into `week-ahead.ts`. It was removed from the CPI `note` when the prints file was rebuilt. `actual` and `vs` were not changed.
- A new NQ/ES range after the print. The ~26.75k–28.13k figure stays, labeled as the range into the print.
- Thursday Nov 12 claims. Not stamped.
- `src/lib/aplus/config.ts`. No orders.
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
- Month plan: `src/lib/trading/month-ahead.ts` (`monthPhaseFor`, `monthAheadFocusLine`)
- Decisions: `ai/DECISIONS.md` · research index: `ai/research/INDEX.md`
