# B+ needs Brain TAKE — paired desk + watcher deploy (2026-10-16)

- Rules hash: a4bfcb65c88badcd → 178851ff55b729bc (adds fire.bplusBrainTake incl. hard minQ 0.60 / no-veto / 1 per day / none after loss; fastChain.hard += bplus_brain_agree).
- watcher-rules.patch: copies shared/desk-rules.json to desk-watcher/watcher/desk-rules.json (`patch -p1` in the watcher checkout). NOT applied.
- Deploy paired: the watcher fails closed on a rules-hash mismatch, so desk and watcher must ship together.
- Watcher code: v2 through v5 patches in /workspace/wfix. Notes:
  1. its test_threshold_still_1s_and_hash_unchanged asserts RULES_HASH == a4bfcb65c88badcd; must become 178851ff55b729bc.
  2. v5 has the HTF-cut A-, q/no-veto and day limits, with BPLUS_Q_MIN and 1/day hard-coded. See the follow-up below.

## Follow-up for watcher v5 (paired re-gate)
- watcher-v5-followup.patch (`patch -p1` on top of /workspace/wfix/order-review-quote-refetch-v5-bplus-brain.patch, i.e. /workspace/wfix/dw2):
  BPLUS_Q_MIN, BPLUS_MAX_PER_DAY and BPLUS_NONE_AFTER_LOSS come from `gates.RULES["fire"]["bplusBrainTake"]["hard"]` instead of
  constants; the hash pin in tests/test_review_quote_refetch.py moves to 178851ff55b729bc; adds tests/test_bplus_q_from_rules.py; carries the
  same watcher/desk-rules.json change as watcher-rules.patch.
- Checked on a scratch copy of dw2: it applies; 582 passed, 2 skipped, 2 failed. The failures are test_gates_log_parity (already failing,
  it replays live logs) and test_rules_parity::test_copy_matches_desk_source (expected: it compares against the desk source, which only
  matches once this PR merges).
