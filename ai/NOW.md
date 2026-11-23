# NOW — ledger-desk current truth
**As of:** 2026-11-23 · **Maintainer:** Claude (session-partner) · **Repo:** `keatrng-cpu/ledger-desk`
**Tree:** `main` is `78acde1` (Restamp Nov 22: Nov 23–27 Thanksgiving week plan added). PRs #94 and #95 (Nov 18 restore + Accuracy Review follow-up) both merged. No open branch or Dual Desk issue tracked at this writing.
> Current truth only. History is `ai/DECISIONS.md`. Keep under 150 lines.

## Current week — Nov 23–27, Thanksgiving short week
- Mon 23: Range-build/selective. Flash PMIs 09:45 ET medium. Stand unless clean raid after PMIs.
- Tue 24: Two-way/selective. Consumer Confidence 10:00 ET medium.
- Wed 25: A+ only into prints — PCE/GDP/Durable/Claims 08:30 ET (PCE high), Beige Book 14:00 ET. Blackout 08:00–08:45. Flatten before holiday.
- Thu 26: Markets closed (Thanksgiving). No trade.
- Fri 27: Selective, early close 13:00 ET. Advance Goods Trade 08:30 ET medium.
- HTF: prior week (Nov 16–20) extended under the Oct 26–30 seed PWL. Dec hike odds ~90–95% 25bp (CME FedWatch as of Nov 22). Sunday post-breakdown under-PWL story holds.

## Canary
`week-ahead.ts` 845 lines, `month-ahead.ts` 675 lines at `78acde1` — no truncation signature (failure mode is <200 lines, docblock + imports only, body missing). Checked 2026-11-23 08:06 ET premarket run: clean.

## Live constraints
- If copy and `src/lib/aplus/config.ts` disagree, code wins. Agents never change those numbers.
- No invented fills or prices. This session has no live gateway/market data — narration only.
- `scripts/plan-file-guard.mjs` still refuses a stub token and a >50% shrink on the four plan files (`week-ahead.ts`, `month-ahead.ts`, `week-prints.json`, `news-calendar.json`).

## Owners
No open Dual Desk issue tracked right now. Next restamp: Sunday night (week-ahead/month-ahead) or the Wed Nov 25 cash close (PCE/GDP/Durable/Claims + Beige Book prints).
