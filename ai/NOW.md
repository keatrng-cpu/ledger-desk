# NOW — ledger-desk current truth
**As of:** 2026-11-18 · **Maintainer:** Cursor agent · **Repo:** `keatrng-cpu/ledger-desk`
**Tree:** `main` is `ea0b6d78` (PR #94 merged, prod live). Follow-up branch `cursor/accuracy-nov18-followup-ae23` is Accuracy Review's non-blocking fixes. Not merged. Issue #7.
> Current truth only. History is `ai/DECISIONS.md`. Keep under 150 lines.

## Nov 18 prints, after Accuracy Review
- Housing Starts (Oct) actual stays `1.309M +9.9%`. `vs` is `prior Sep rev 1.191M`. Note cites Census CB26-187. NQ session `~26.92k-27.33k` and the under-PWL line stay.
- FOMC Minutes (Oct meeting): almost all participants see further hikes as likely, and a couple are open to more than 25bp in December. The earlier "nearly all expect Dec hike" overstated the minutes.
- Dec hike odds on the Nov 16–20 in-line outcome and on the November `fed` line are `~95%` for 25bp (FedWatch), matching the week plan. The old `~87%` / `~87-88%` plus `~11-12%` 50bp pair is the stale one. The Nov 9–13 week's own `~87%` line was left as that week's text.

## Guard
`scripts/plan-file-guard.mjs` still refuses a stub token and a shrink of more than half. A `git push --delete` sends an all-zero local sha. That is a branch deletion, not a new blob, and pre-push lets it through. A content push still runs the stub guard.

## Live constraints
- If copy and `src/lib/aplus/config.ts` disagree, code wins. Agents do not change those numbers.
- Do not lower the confluence floor. This patch places no order.
- No invented fills. The 1.191M prior and the minutes sentence are Accuracy Review's correction, cited as Census CB26-187 and the minutes wording they supplied.

## Owners
Issue #7: Accuracy Review then Release Watch then Design Atelier merge to `main`. This follow-up does not merge itself.
