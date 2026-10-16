# capReasons "MTF align" mislabel (10/16 9:31 ET MNQ short), root cause and fix

Branch `fix/cap-why-attribution-1016` from main 2aa01be6. RULES_HASH a4bfcb65c88badcd is **unchanged** (shared/desk-rules.json not touched). q, band, actionable and firing are unchanged; only labels change.

## Root cause
- `applyDiscipline` (src/lib/smc/discipline.ts:126-212 on main) pushes all of its R1–R8 notes first, then writes `c.pathBand` (l.207) and `c.confluence` (l.209) once, at the end.
- The tracker (src/lib/trading/cap-attribution.ts:42) stores `_ri = c.reasons.length` at the write, and `resolveWhy` (l.64) uses `c.reasons[_ri]`, which is the **next** line pushed after the write.
- In build-desk.ts:1265-1270 the next line pushed is `MTF align …`. So every discipline cap or penalty gets the MTF line as its `why`, whatever the alignment is. The 7:38 CT card.json shows it for ES short with align 0.33 as well as MNQ with align 1.
- The `source` label that names the real writer (`R3 chase …`) was dropped by desk-listen.ts:539-540, so the scanner showed only the wrong `why`.
- MTF alignment does not penalize anywhere. mtf-context.ts:159-175 scores higher when aligned. master-seat.ts:80 (brain/Floor) needs ≥0.66. smc-master.ts:1017-1063 prefers the higher score. The watcher reads q/band/q_raw only (gates.py:74, firefix.py:17) and never reads capReasons.
- The actual cut 0.9213→0.3072 is ×0.3334. That is the R3 chase factor `1−0.5·d` with d≈1.33×ATR15 past CE, applied because `timing.mode` is `"shadow"` (desk-rules.json). floor(1.33/0.5)=2 band steps plus an R4/R7 cap gives B+. So the card was graded on distance from entry, not setup quality: the Fix B (10/14) behaviour that is still in shadow.

## Fix
- `setQSource(label, why)` lets a writer name its own `why`. The tracker uses it before falling back to the next line.
- `applyDiscipline` collects its band notes and q notes (including a chase line even when steps=0) and passes them with its writes.
- desk-listen scanner rows now serve `source`.
- Regression test in scripts/cap-attribution.test.mjs. It fails on main (2 tests) and passes on the branch.

## Watcher, brain, Floor
- None of them reimplements the attribution, so there is no watcher patch. /workspace/desk-watcher was not touched.

## Not in this PR
- Flipping `timing.mode` to `live`, which would stop the chase penalty, is a rules change (new hash). It needs its own walk-forward backtest. Even then, the watcher entry_distance 0.5×ATR gate would still refuse a 1.33×ATR-late entry at 9:31.
