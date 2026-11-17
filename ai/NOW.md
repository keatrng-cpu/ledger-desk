# NOW — ledger-desk current truth
**As of:** 2026-11-17 08:06 ET · **Maintainer:** Graph Keeper · **Repo:** `keatrng-cpu/ledger-desk`
**Tree:** HEAD `22a2dce` — `week-ahead.ts` **BROKEN (1-line PLACEHOLDER)**, `week-prints.json` **BROKEN (8 lines, was ~430)**. `month-ahead.ts` 635 lines, healthy.
**Tracking:** issue #7 · plan `ai/research/2026-10-06-desk-implementation-plan.md` @ `09aad4b` · HANDOFF `ai/HANDOFF.md` @ `ceb62b7`
> Current truth only. History is `ai/DECISIONS.md`. Keep under 150 lines.
## Canary — LIVE FAILURE, not self-healed
2026-11-16 15:51:13 CT commit `f056566` ("Restamp Nov 16 cash close…") gutted BOTH `week-ahead.ts` (672→1 line, `PLACEHOLDER`) and `src/data/week-prints.json` (430→~9 lines) in the same commit: `-1100/+2` diff. Same signature as 09-04/09-20/09-25/`c6c6bc76`/the Nov 13 `d54ce4d` near-miss — but unlike Nov 13 (self-corrected in 1 minute via `f9a6797`), the two commits stacked on top (`669a852`, `22a2dce`, same Nov 16 15:51 minute) only patched `week-prints.json` with a few lines each and never touched `week-ahead.ts`. Still broken as of this check (2026-11-17 08:06 ET), ~15h later. **Last good commit: `28b393a`** (`week-ahead.ts` 671 lines, `week-prints.json` 429 lines). Restore: `git checkout 28b393a -- src/lib/trading/week-ahead.ts src/data/week-prints.json`, then reapply the legitimate Nov 16 Empire-7.8 restamp lines `669a852`/`22a2dce` added to `week-prints.json` on top, so that content isn't lost. Flagged via push notification; not restored by this session (narration-only). Older fallback if `28b393a` is ever suspect: `046b087`.
## Claims actual (sourced)
DOL Unemployment Insurance Weekly Claims, week ending November 7, released Thursday November 12, 2026, 8:30 a.m. ET. Archive: https://oui.doleta.gov/press/2026/111226.pdf . Same paragraph on https://www.dol.gov/newsroom/releases/eta and https://www.dol.gov/ui/data.pdf .
Seasonally adjusted initial claims **200,000**, an increase of **9,000**. Previous week revised up by **2,000** from **189,000** to **191,000**. 4-week moving average **195,250**, unchanged. Insured unemployment (week ending October 31) **1,697,000**, IUR **1.1%**.
Second look: FRED ICSA https://fred.stlouisfed.org/series/ICSA observation **2026-11-07 = 200000** (and **2026-10-31 = 191000**, the revised prior week).
## Refused
- An "exp ~195k" consensus. AP reported economists at 195,000. That figure is not on the DOL release. The 195,250 in the stamp is the DOL 4-week average, labeled as that.
- Post-print FedWatch odds. Not on the DOL release. Pre-CPI ~84% sentence left as `046b0872` wrote it.
- A new NQ/ES range. The ~26.75k–28.13k figure stays, labeled as the range into the CPI print.
- Any HTF trend change. Sunday post-breakdown under-PWL story holds.
- `src/lib/aplus/config.ts`. No orders. PPI Friday is not stamped.
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
