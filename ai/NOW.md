# NOW — ledger-desk current truth
**As of:** 2026-11-27 09:06 ET · **Maintainer:** Claude (session-partner) · **Repo:** `keatrng-cpu/ledger-desk`
**Tree:** `main` is `5d55d66` (already pushed to origin). **BROKEN — see Canary.**
> Current truth only. History is `ai/DECISIONS.md`. Keep under 150 lines.

## CANARY TRIPPED — fix before anything else
`src/lib/trading/week-ahead.ts` and `src/data/news-calendar.json` are **0 lines** at HEAD (`5d55d66`, pushed to `origin/main`). Worse than the known truncation signature (docblock+imports left) — these are fully empty. Commit message claims additions; actual diff is pure deletion (week-ahead.ts 836→0, news-calendar.json 476→0). `scripts/plan-file-guard.mjs` (meant to refuse >50% shrink) did not block it. Trader notified via push at 09:06 ET; **not yet restored** — restoring is the trader's call, not done here.
Restore commands:
```
git checkout c19891a -- src/lib/trading/week-ahead.ts
git checkout 78acde1 -- src/data/news-calendar.json
```
`month-ahead.ts` still intact, 675 lines.

## Current week — Nov 23–27, Thanksgiving short week (from last-known-good content, NOT re-read from the now-empty files)
- Mon 23 (printed): Flash PMI Composite 54.6. NQ ~25,427–27,137, ES ~6,992–7,313 — under seed PWL.
- Tue 24 (printed): Consumer Confidence 103.3 (exp ~92.2) — hot beat. NQ ~25,998–27,036, ES ~7,145–7,298 — under seed PWL.
- Wed 25 (printed): PCE core 3.3% y/y hot, GDP Q3 2nd est +4.3%, Durable Goods +0.2%, Claims 189k, Beige Book 14:00. NQ ~25,027–27,137, ES ~6,982–7,313 — still under seed PWL.
- Thu 26: Markets closed — Thanksgiving. No cash session, confirmed no trade.
- Fri 27 (today): Selective, early close 13:00 ET. Advance Goods Trade Balance (Oct) 08:30 ET medium — blackout 08:15–08:45 ET already passed by this run. Flatten by 12:45 ET.
- HTF: prior week (Nov 16–20) extended under the Oct 26–30 seed PWL (NQ Fri high ~26,603.50/low ~25,241.50; ES high ~7,216.75/low ~6,938). Dec hike odds ~98% 25bp (CME FedWatch Nov 25-26), 50bp erased.
- **Could not produce today's premarket brief this run** — week-ahead.ts and news-calendar.json, the required sources, are empty. Did not guess from memory. Next session-partner run should re-check the canary before narrating anything from those two files.

## Live constraints
- If copy and `src/lib/aplus/config.ts` disagree, code wins. Agents never change those numbers.
- No invented fills or prices. This session has no live gateway/market data — narration only.
- `scripts/plan-file-guard.mjs` still refuses a stub token and a >50% shrink on the four plan files — but did NOT catch this full-deletion commit; its guard logic needs review.

## Owners
No open Dual Desk issue tracked right now. Since the last run: nothing new from Grok (agent-sync showed only this session's own prior bookmark commits). The 5d55d66 author is the trader (keatrng-cpu), not Grok. Next restamp: Sunday night (week-ahead/month-ahead for the week of Nov 30) — blocked until week-ahead.ts is restored first.
