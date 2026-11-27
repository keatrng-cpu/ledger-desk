# NOW — ledger-desk current truth
**As of:** 2026-11-27 08:06 ET · **Maintainer:** Claude (session-partner) · **Repo:** `keatrng-cpu/ledger-desk`
**Tree:** `main` is `0fda0b9` (agent-sync bookmark). No open branch or Dual Desk issue tracked at this writing.
> Current truth only. History is `ai/DECISIONS.md`. Keep under 150 lines.

## Current week — Nov 23–27, Thanksgiving short week
- Mon 23 (printed): Flash PMI Composite 54.6. NQ ~25,427–27,137, ES ~6,992–7,313 — under seed PWL.
- Tue 24 (printed): Consumer Confidence 103.3 (exp ~92.2) — hot beat. NQ ~25,998–27,036, ES ~7,145–7,298 — under seed PWL.
- Wed 25 (printed): PCE core 3.3% y/y hot, GDP Q3 2nd est +4.3%, Durable Goods +0.2%, Claims 189k, Beige Book 14:00. NQ ~25,027–27,137, ES ~6,982–7,313 — still under seed PWL.
- Thu 26: Markets closed — Thanksgiving. No cash session, confirmed no trade.
- **Fri 27 (today): Selective, early close 13:00 ET. Advance Goods Trade Balance (Oct) 08:30 ET medium — blackout 08:15–08:45 ET. No NFP/CPI this week. Flatten by 12:45 ET.**
- HTF: prior week (Nov 16–20) extended under the Oct 26–30 seed PWL (NQ Fri high ~26,603.50/low ~25,241.50; ES high ~7,216.75/low ~6,938). Dec hike odds ~98% 25bp (CME FedWatch Nov 25-26), 50bp erased. Sunday post-breakdown under-PWL story holds through Wed's prints.

## Canary
`week-ahead.ts` 836 lines, `month-ahead.ts` 675 lines at `0fda0b9` — no truncation signature (failure mode is <200 lines, docblock + imports only, body missing). Checked 2026-11-27 08:06 ET: clean.

## Live constraints
- If copy and `src/lib/aplus/config.ts` disagree, code wins. Agents never change those numbers.
- No invented fills or prices. This session has no live gateway/market data — narration only.
- `scripts/plan-file-guard.mjs` still refuses a stub token and a >50% shrink on the four plan files (`week-ahead.ts`, `month-ahead.ts`, `week-prints.json`, `news-calendar.json`).

## Owners
No open Dual Desk issue tracked right now. Since the last run: nothing new from Grok (agent-sync showed only this session's own prior bookmark commit). Next restamp: Sunday night (week-ahead/month-ahead for the week of Nov 30), or Fri Nov 27 cash close if Advance Goods Trade warrants a note.
