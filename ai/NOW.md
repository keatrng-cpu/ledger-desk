# NOW — ledger-desk current truth
**As of:** 2026-11-24 09:06 ET · **Maintainer:** Claude (session-partner) · **Repo:** `keatrng-cpu/ledger-desk`
**Tree:** `main` is `b42734d` (Grok: sync Dec hike odds ~96% 25bp, this-week range under seed PWL). No open branch or Dual Desk issue tracked at this writing.
> Current truth only. History is `ai/DECISIONS.md`. Keep under 150 lines.

## Current week — Nov 23–27, Thanksgiving short week
- Mon 23 (printed): Flash PMI Composite 54.6 (from 55.9, Mfg 54.5/Svc 54.7). NQ session ~25,427–27,137, ES ~6,992–7,313 — both under seed PWL. Bounce inside post-breakdown range.
- Tue 24 (today): Two-way/selective. Consumer Confidence (Nov) 10:00 ET medium. A+ only after clear structure. Skip-if: no clear MSS, thin into Wed.
- Wed 25: A+ only into prints — PCE/GDP(2nd)/Durable/Claims 08:30 ET (PCE high), Beige Book 14:00 ET. Blackout 08:00–08:45. Flatten before holiday.
- Thu 26: Markets closed (Thanksgiving). No trade.
- Fri 27: Selective, early close 13:00 ET. Advance Goods Trade 08:30 ET medium.
- HTF: prior week (Nov 16–20) extended under the Oct 26–30 seed PWL (NQ Fri high ~26,603.50/low ~25,241.50; ES high ~7,216.75/low ~6,938). Dec hike odds ~96% 25bp, 50bp erased (CME FedWatch Nov 23-24, updated from Grok's b42734d). Sunday post-breakdown under-PWL story holds.

## Canary
`week-ahead.ts` 847 lines, `month-ahead.ts` 675 lines at `b42734d` — no truncation signature (failure mode is <200 lines, docblock + imports only, body missing). Checked 2026-11-24 09:06 ET premarket run: clean.

## Live constraints
- If copy and `src/lib/aplus/config.ts` disagree, code wins. Agents never change those numbers.
- No invented fills or prices. This session has no live gateway/market data — narration only.
- `scripts/plan-file-guard.mjs` still refuses a stub token and a >50% shrink on the four plan files (`week-ahead.ts`, `month-ahead.ts`, `week-prints.json`, `news-calendar.json`).

## Owners
No open Dual Desk issue tracked right now. Grok pushed a macro sync (b42734d) between the 08:06 and 09:06 runs — read via agent-sync, nothing to redo. Next restamp: Sunday night (week-ahead/month-ahead) or the Wed Nov 25 cash close (PCE/GDP/Durable/Claims + Beige Book prints).
