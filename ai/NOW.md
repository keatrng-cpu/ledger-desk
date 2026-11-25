# NOW — ledger-desk current truth
**As of:** 2026-11-25 08:06 ET · **Maintainer:** Claude (session-partner) · **Repo:** `keatrng-cpu/ledger-desk`
**Tree:** `main` is `602ed4f` (restamp Nov 24: Confidence 103.3 surge; NQ/ES still under seed PWL). No open branch or Dual Desk issue tracked at this writing.
> Current truth only. History is `ai/DECISIONS.md`. Keep under 150 lines.

## Current week — Nov 23–27, Thanksgiving short week
- Mon 23 (printed): Flash PMI Composite 54.6 (from 55.9, Mfg 54.5/Svc 54.7). NQ session ~25,427–27,137, ES ~6,992–7,313 — both under seed PWL. Bounce inside post-breakdown range.
- Tue 24 (printed): Consumer Confidence 103.3 (exp ~92.2, prev 91.9) — hot beat. NQ session ~25,998–27,036, ES ~7,145–7,298 — still under seed PWL.
- Wed 25 (today): A+ only into prints — PCE/Personal Income (Oct, HIGH) + GDP Q3 2nd est + Durable Goods + Initial Claims, all 08:30 ET; Beige Book 14:00 ET. Blackout 08:00–08:45. A+ only after 10:00. Flatten before Thursday's holiday close. Skip-if: anything open into holiday, no MSS after print.
- Thu 26: Markets closed (Thanksgiving). No trade.
- Fri 27: Selective, early close 13:00 ET. Advance Goods Trade 08:30 ET medium.
- HTF: prior week (Nov 16–20) extended under the Oct 26–30 seed PWL (NQ Fri high ~26,603.50/low ~25,241.50; ES high ~7,216.75/low ~6,938). Dec hike odds ~96% 25bp, 50bp erased (CME FedWatch Nov 23-24). Sunday post-breakdown under-PWL story holds through Tue's hot Confidence print.

## Canary
`week-ahead.ts` 848 lines, `month-ahead.ts` 675 lines at `602ed4f` — no truncation signature (failure mode is <200 lines, docblock + imports only, body missing). Checked 2026-11-25 08:06 ET premarket run: clean.

## Live constraints
- If copy and `src/lib/aplus/config.ts` disagree, code wins. Agents never change those numbers.
- No invented fills or prices. This session has no live gateway/market data — narration only.
- `scripts/plan-file-guard.mjs` still refuses a stub token and a >50% shrink on the four plan files (`week-ahead.ts`, `month-ahead.ts`, `week-prints.json`, `news-calendar.json`).

## Owners
No open Dual Desk issue tracked right now. Since the last run: a merged PR (#96, flaky-test fixes) and a restamp for Tue's Confidence print — both read via agent-sync, nothing to redo. Next restamp: Wed Nov 25 cash close (PCE/GDP/Durable/Claims + Beige Book prints), or Sunday night (week-ahead/month-ahead).
