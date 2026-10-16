# Grok vs desk: why the desk missed the scan's setups, score-influence backtest, real Grok (2026-10-16, CT)

Research only. Nothing live was changed. `/workspace/desk-watcher` cards.log and gates.log were read only. Artifacts are in `/workspace/audits/grok-vs-desk-1016/` (extract*.py, classify2.py, diff_evidence.json, bt.py, bt2.py, bt_results.json, grok_real.jsonl, grok_cmp.py). **Caveat carried over:** the 10/12–16 'suggestions' come from the built-in mechanical scan (5m BOS/MSS, 15m gap tap + rejection, LH/HL after a displacement), not from Grok.

## 1. Why the desk had no actionable card (proven only from log rows)

Method: for each of the 122 moments (flag + 3 s), take the first cards.log row ≤120 s later. The proof is `card.scanner[]` for that symbol and side (band, q, actionable, entry, **capReasons**) plus `card.brain`. The nearest gates.log row (≤60 s) is cited too, but it only gates the watcher's top card, so it is context. **No cards.log row → UNPROVEN.** cards.log covers only 10/13 13:29 → 10/16, has gaps (10/16 10:24–10:52 restart, 10/14 12:39–13:01, 13:45–14:33, …), and stops at ~14:50 CT each day.

**All 122**

| count | cause |
|---|---|
| 62 | UNPROVEN: no cards.log row at this moment |
| 30 | PROVEN: graded C by base score |
| 13 | PROVEN: LTF arm/reversal cap (capReasons) |
| 6 | PROVEN: chase cap — entry anchored past (capReasons) |
| 4 | PROVEN: graded B by base score |
| 4 | UNPROVEN: row present, cause not explicit |
| 3 | PROVEN: card sealed C — played out/invalidated on its OLD entry (capReasons) |

**Upper-bound 41 would-fires**

| count | cause |
|---|---|
| 23 | UNPROVEN: no cards.log row at this moment |
| 7 | PROVEN: graded C by base score |
| 4 | PROVEN: LTF arm/reversal cap (capReasons) |
| 3 | PROVEN: graded B by base score |
| 2 | PROVEN: card sealed C — played out/invalidated on its OLD entry (capReasons) |
| 2 | PROVEN: chase cap — entry anchored past (capReasons) |

In every one of the 60 moments with a row, **Brain = STAND** (missing: 'POI in correct half' ×33, 'Draw on liquidity' ×9, 'HTF bias + DOL' ×5, 'LTF shift + displacement' ×4).

**Mechanism in plain terms (proven on today's 09:45 tap and 10:00 lower high, rows 10/16 09:45:06 and 10:00:08 CT):** the desk DID have an MNQ short card (tjr). Its entry was anchored at **29892.75**, the first array, touched earlier. T1 29823.5 had already traded from that old entry, so the ltfArm-cap seal stamped it *'Played out … capped at C, no alert'*. The desk has no step that re-anchors a short to the newer 15m gap / lower high, so the new tap was invisible. Brain was STAND ('POI in correct half'), and the gates row shows the watcher's top card failing band, fast:persist, fast:agree. **10:45 tap: UNPROVEN** (no row; cards.log gap 10:24–10:52 during the restart).

The other proven causes: graded C/B by base score with no cap rows (the side card exists from another strategy and its q is below 0.60), the LTF arm/reversal cap, and the chase cap (entry anchored past CE).

**Scan rule, winners vs losers (10/12–16 replay, R by rule):**

| rule | all n W/L netR | upper-bound would-fire n W/L netR |
|---|---|---|
| mss | 35 31/4 +4.67R | 3 1/2 +0.36R |
| htfGapTap | 52 30/22 +13.46R | 28 12/16 +9.67R |
| lowerHigh | 19 14/5 +5.86R | 5 3/2 +3.66R |
| higherLow | 16 8/8 -5.60R | 5 0/5 -5.00R |

Winners came mostly from 15m gap tap + rejection and LH shorts. HL longs were the losers.

## 2. Score-influence backtest (ES+NQ 1m 2010-07 → 2026-10-16, closed bars, cost 0.5/1.5 pt)

IS 2010-07→2018, OOS 2019→2026-10-09, holdout 10/12–16 (data to 10/16 10:07). Desk = the bt13w mechanical desk proxy (sim.py). Bump: a desk candidate with a scan signal on the same symbol and side in the prior 15 min gets +b to q (q proxy = 0.40 + 0.05×points, so B+ 0.60 = 4 pts and A- 0.65 = 5 pts; '+pts' is the 5-layer equivalent). Seal caps still apply.

| variant | IS n | tr/wk | WR | avgR | PF | DD | OOS n | tr/wk | WR | avgR | PF | DD | hold n/avgR |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| desk bump +0.00 (+0 pts) | 106 | 0.24 | 27.4% | -0.370 | 0.52 | -48.1 | 94 | 0.23 | 41.5% | +0.078 | 1.14 | -8.5 | 0/+0.00 |
| desk bump +0.03 (+0 pts) | 106 | 0.24 | 27.4% | -0.370 | 0.52 | -48.1 | 94 | 0.23 | 41.5% | +0.078 | 1.14 | -8.5 | 0/+0.00 |
| desk bump +0.05 (+1 pts) | 106 | 0.24 | 27.4% | -0.370 | 0.52 | -48.1 | 94 | 0.23 | 41.5% | +0.078 | 1.14 | -8.5 | 0/+0.00 |
| desk bump +0.08 (+1 pts) | 106 | 0.24 | 27.4% | -0.370 | 0.52 | -48.1 | 94 | 0.23 | 41.5% | +0.078 | 1.14 | -8.5 | 0/+0.00 |
| desk bump +0.10 (+2 pts) | 106 | 0.24 | 27.4% | -0.370 | 0.52 | -48.1 | 94 | 0.23 | 41.5% | +0.078 | 1.14 | -8.5 | 0/+0.00 |
| desk bump +0.15 (+3 pts) | 106 | 0.24 | 27.4% | -0.370 | 0.52 | -48.1 | 94 | 0.23 | 41.5% | +0.078 | 1.14 | -8.5 | 0/+0.00 |
| desk bump +0.20 (+4 pts) | 106 | 0.24 | 27.4% | -0.370 | 0.52 | -48.1 | 94 | 0.23 | 41.5% | +0.078 | 1.14 | -8.5 | 0/+0.00 |
| desk bump +0.25 (+5 pts) | 106 | 0.24 | 27.4% | -0.370 | 0.52 | -48.1 | 94 | 0.23 | 41.5% | +0.078 | 1.14 | -8.5 | 0/+0.00 |
| desk bump +0.30 (+6 pts) | 106 | 0.24 | 27.4% | -0.370 | 0.52 | -48.1 | 94 | 0.23 | 41.5% | +0.078 | 1.14 | -8.5 | 0/+0.00 |
| desk bump +0.40 (+8 pts) | 106 | 0.24 | 27.4% | -0.370 | 0.52 | -48.1 | 94 | 0.23 | 41.5% | +0.078 | 1.14 | -8.5 | 0/+0.00 |
| desk bump +0.50 (+10 pts) | 106 | 0.24 | 27.4% | -0.370 | 0.52 | -48.1 | 94 | 0.23 | 41.5% | +0.078 | 1.14 | -8.5 | 0/+0.00 |
| desk bump +0.60 (+12 pts) | 106 | 0.24 | 27.4% | -0.370 | 0.52 | -48.1 | 94 | 0.23 | 41.5% | +0.078 | 1.14 | -8.5 | 0/+0.00 |
| desk+reanchor{2,3,10} bump +0.00 (+0 pts) | 110 | 0.25 | 29.1% | -0.327 | 0.56 | -48.4 | 110 | 0.27 | 41.8% | +0.085 | 1.15 | -8.6 | 0/+0.00 |
| desk+reanchor{2,3,10} bump +0.03 (+0 pts) | 110 | 0.25 | 29.1% | -0.327 | 0.56 | -48.4 | 110 | 0.27 | 41.8% | +0.085 | 1.15 | -8.6 | 0/+0.00 |
| desk+reanchor{2,3,10} bump +0.05 (+1 pts) | 139 | 0.31 | 28.1% | -0.395 | 0.51 | -66.9 | 136 | 0.34 | 37.5% | -0.031 | 0.95 | -14.1 | 0/+0.00 |
| desk+reanchor{2,3,10} bump +0.08 (+1 pts) | 139 | 0.31 | 28.1% | -0.395 | 0.51 | -66.9 | 136 | 0.34 | 37.5% | -0.031 | 0.95 | -14.1 | 0/+0.00 |
| desk+reanchor{2,3,10} bump +0.10 (+2 pts) | 253 | 0.57 | 30.4% | -0.398 | 0.54 | -101.9 | 238 | 0.59 | 36.1% | -0.051 | 0.92 | -21.2 | 0/+0.00 |
| desk+reanchor{2,3,10} bump +0.15 (+3 pts) | 396 | 0.89 | 34.1% | -0.324 | 0.62 | -128.9 | 378 | 0.93 | 33.1% | -0.146 | 0.80 | -56.7 | 0/+0.00 |
| desk+reanchor{2,3,10} bump +0.20 (+4 pts) | 429 | 0.97 | 34.7% | -0.309 | 0.64 | -134.3 | 419 | 1.03 | 33.9% | -0.118 | 0.84 | -51.1 | 0/+0.00 |
| desk+reanchor{2,3,10} bump +0.25 (+5 pts) | 429 | 0.97 | 34.7% | -0.309 | 0.64 | -134.3 | 419 | 1.03 | 33.9% | -0.118 | 0.84 | -51.1 | 0/+0.00 |
| desk+reanchor{2,3,10} bump +0.30 (+6 pts) | 429 | 0.97 | 34.7% | -0.309 | 0.64 | -134.3 | 419 | 1.03 | 33.9% | -0.118 | 0.84 | -51.1 | 0/+0.00 |
| desk+reanchor{2,3,10} bump +0.40 (+8 pts) | 429 | 0.97 | 34.7% | -0.309 | 0.64 | -134.3 | 419 | 1.03 | 33.9% | -0.118 | 0.84 | -51.1 | 0/+0.00 |
| desk+reanchor{2,3,10} bump +0.50 (+10 pts) | 429 | 0.97 | 34.7% | -0.309 | 0.64 | -134.3 | 419 | 1.03 | 33.9% | -0.118 | 0.84 | -51.1 | 0/+0.00 |
| desk+reanchor{2,3,10} bump +0.60 (+12 pts) | 429 | 0.97 | 34.7% | -0.309 | 0.64 | -134.3 | 419 | 1.03 | 33.9% | -0.118 | 0.84 | -51.1 | 0/+0.00 |
| scan cards alone (all rules) | 17931 | 40.41 | 37.1% | -0.298 | 0.60 | -5344.1 | 16649 | 41.05 | 39.6% | -0.063 | 0.90 | -1078.6 | 33/+0.18 |
| scan cards alone: mss | 8171 | 18.42 | 41.0% | -0.120 | 0.78 | -990.6 | 7339 | 18.10 | 44.2% | -0.009 | 0.98 | -178.8 | 15/-0.08 |
| scan cards alone: mss short | 4322 | 9.74 | 39.3% | -0.132 | 0.76 | -589.8 | 4036 | 9.95 | 42.8% | -0.023 | 0.95 | -182.1 | 12/-0.02 |
| scan cards alone: mss long | 3849 | 8.67 | 42.8% | -0.107 | 0.80 | -420.1 | 3303 | 8.14 | 46.0% | +0.008 | 1.02 | -64.9 | 3/-0.33 |
| scan cards alone: gap | 8152 | 18.37 | 32.7% | -0.461 | 0.51 | -3764.4 | 7725 | 19.05 | 35.4% | -0.105 | 0.85 | -837.0 | 14/+0.64 |
| scan cards alone: gap short | 3835 | 8.64 | 31.5% | -0.455 | 0.53 | -1750.3 | 3398 | 8.38 | 33.4% | -0.126 | 0.83 | -455.5 | 8/+0.55 |
| scan cards alone: gap long | 4317 | 9.73 | 33.8% | -0.467 | 0.50 | -2019.0 | 4327 | 10.67 | 36.9% | -0.089 | 0.87 | -391.5 | 6/+0.77 |
| scan cards alone: lhl | 1608 | 3.62 | 39.3% | -0.376 | 0.55 | -625.4 | 1585 | 3.91 | 38.9% | -0.110 | 0.84 | -189.6 | 4/-0.44 |
| scan cards alone: lhl short | 853 | 1.92 | 38.8% | -0.397 | 0.53 | -371.5 | 815 | 2.01 | 37.3% | -0.151 | 0.78 | -128.7 | 1/+1.48 |
| scan cards alone: lhl long | 755 | 1.70 | 39.9% | -0.352 | 0.57 | -271.2 | 770 | 1.90 | 40.6% | -0.066 | 0.90 | -67.3 | 3/-1.08 |
| desk + scan carries own card when desk flat | 17954 | 40.46 | 37.0% | -0.299 | 0.60 | -5362.0 | 16658 | 41.07 | 39.6% | -0.064 | 0.90 | -1083.4 | 33/+0.18 |

Added trades vs the same base (bump > 0, re-anchored desk): OOS
- +0.03: 0 | 0.00 | 0.0% | +0.000 | 0.00 | 0.0 (IS +0.000R)
- +0.05: 26 | 0.06 | 19.2% | -0.526 | 0.41 | -13.7 (IS -0.656R)
- +0.08: 26 | 0.06 | 19.2% | -0.526 | 0.41 | -13.7 (IS -0.656R)
- +0.10: 128 | 0.32 | 31.2% | -0.168 | 0.78 | -25.2 (IS -0.450R)
- +0.15: 268 | 0.66 | 29.5% | -0.240 | 0.70 | -66.1 (IS -0.322R)
- +0.20: 309 | 0.76 | 31.1% | -0.190 | 0.75 | -60.5 (IS -0.302R)
- +0.25: 309 | 0.76 | 31.1% | -0.190 | 0.75 | -60.5 (IS -0.302R)
- +0.30: 309 | 0.76 | 31.1% | -0.190 | 0.75 | -60.5 (IS -0.302R)
- +0.40: 309 | 0.76 | 31.1% | -0.190 | 0.75 | -60.5 (IS -0.302R)
- +0.50: 309 | 0.76 | 31.1% | -0.190 | 0.75 | -60.5 (IS -0.302R)
- +0.60: 309 | 0.76 | 31.1% | -0.190 | 0.75 | -60.5 (IS -0.302R)

**Verdict: REJECT the score bump at every size.**
- On the desk as it is, the bump adds **0 trades** at any size. Bump-promoted cards are 'main' limit cards at the stale array mid, and all of them play out before they fill (2019–20 check: 129 promoted actionable, 0 filled, 126 played out). The bottleneck is the stale entry anchor, not the score.
- With re-anchoring (bt13w fixes 2, 3, 10), the curve **peaks at +0.00–0.03**. Losers start at **+0.05 (+1 pt)**: the added trades run −0.53R OOS / −0.66R IS. It **saturates at +0.20 (+4 pts)**: +309 trades OOS at −0.19R, PF 0.75. OOS goes from +0.085R to −0.118R.
- **Scan cards on their own (suggestion carries its own card): negative over 16 years.** All rules: OOS −0.063R, PF 0.90, 41/wk. IS −0.30R. Best sub-rule, mss long: OOS +0.008R, PF 1.02, IS −0.107R, so no edge. The +0.18R holdout week (33 trades) is the outlier, consistent with the +8.69R single-week figure.

## 3. Real Grok (grok-4.20-0309-non-reasoning, knowledge pack + 1m–4h context, JSON mode) on the 122 moments

- Calls 122, **spent $0.48** (cap $2), $0.0040/call. Latency p50 2789 ms, p90 3640 ms, max 14242 ms. Status: {'ok': 116, 'malformed': 5, 'timeout': 1}.
- Grok **agreed** with the scan side on n 54, 33W/21L, +4.14R. It **rejected** (suggestion null) n 62, 44W/18L, +12.91R. It never took the opposite side.
- On the upper-bound 41: Grok agreed n 19, 7W/12L, +3.91R; it rejected n 22, 9W/13L, +4.78R.
- **Grok does not filter losers.** The set it rejects has a higher win rate (71%) than the set it accepts (61%). Using its own levels, its picks net +1.46R on 54 (29W/25L), worse than the scan's levels on the same moments (+4.14R). On HL longs (the losing rule) it accepted 8 (2W/6L, −5.18R).
- Findings that fed fixes: at max_tokens 220, Grok's JSON was cut off (malformed). Without JSON mode it sometimes dropped the closing brace. p50 latency is 2.8 s and the tail reaches 14 s, so the 4 s timeout dropped reads. **Changed (flags still off): maxOutputTokens 400, timeout 8 s (fully async), `response_format: json_object`, 'strings ≤25 words'.**

## 4. Claude (claude-sonnet-5): BLOCKED
ANTHROPIC_API_KEY is set, but every request returns HTTP 400: *'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header.'* No workspace ID exists on the box. The script now sends `anthropic-workspace-id` from env `ANTHROPIC_WORKSPACE_ID` when it is set. Re-run: `bash -lc 'cd /workspace/ld-grokreader && npx tsx scripts/grok-real-replay.mts --claude --in /tmp/replay.json --out /workspace/audits/grok-vs-desk-1016/claude_real.jsonl --cap-usd 2'`. Estimate: about $0.01/call, about $1.25 for 122. Spend so far: $0 (the 4 refused calls are not billed). **The Grok-only / Claude-only / both-agree recommendation is pending that run.** On Grok's numbers alone, gating on Grok approval would have cut net R (+4.14R kept vs +12.91R rejected).

## Bottom line
1. The desk missed these moves mainly because of a **stale entry anchor plus the played-out seal** (no re-anchor or re-entry onto the newer 15m gap / lower high) and **base-score C on the side card**, with **Brain STAND on 'POI in correct half'** throughout. 62/122 are unproven because no watcher row exists.
2. The **score bump is rejected** at every size from 0.03 to 0.60. The **scan has no 16-year edge** (OOS −0.06R, PF 0.90). The one-week +8.69R is noise.
3. **Real Grok agrees with the scan about 45% of the time and does not filter losers.** As a gate or confirmation it would have lowered R this week. Keep it informational (shadow), as built.

## 5. Claude (claude-sonnet-5) vs Grok vs the scan (added 12:40 CT)

Claude spend: **$1.98 total, at the $2 cap**. The first 122-call run sent `temperature` (rejected with HTTP 400, $0). A second run lost every reply to adaptive thinking that used the whole 400-token budget, returning empty text (billed $1.30). The final run had thinking disabled and max 700 tokens, so the cap only covered **50 moments** (the 41 upper-bound would-fires first, then 9 more). All comparisons below use those 50.

- Claude format compliance: **20/50 valid strict JSON** (26 truncated at 700 tokens, 4 prose before the JSON → dropped). Latency p50 7706 ms, max 9599 ms. Cost about $0.0129/call, vs Grok $0.0039/call, p50 2780 ms, 50/50 valid.
- Scan on these 50 (take all): n 50, 22W/28L, +8.79R, WR 44%.
- **Grok-only** (take when Grok agrees): n 20, 7W/13L, +2.91R, WR 35%. Losers filtered 15/28, winners kept 7/22.
- **Claude-only**: n 0, 0W/0L, +0.00R. Losers filtered 28/28, winners kept 0/22.
- **Both agree**: n 0, 0W/0L, +0.00R. Losers filtered 28/28, winners kept 0/22.
- Either agrees: n 20, 7W/13L, +2.91R, WR 35%.
- Grok-Claude verdict agreement where both returned valid JSON: 8/20. On those 20: Claude says yes n 0, 0W/0L, +0.00R / no n 20, 9W/11L, +2.83R, WR 45%; Grok says yes n 12, 5W/7L, +1.32R, WR 42% / no n 8, 4W/4L, +1.51R, WR 50%.
**Recommendation: NEITHER as a gate or confirmation.** On the same 50 moments the scan alone made +8.79R (22W/28L). Grok-only kept +2.91R (cut 15/28 losers but also 15/22 winners, WR 35% < 44%). Claude-only and both-agree take **0 trades**: Claude rejected all 20 setups it returned valid JSON for (9 of them winners, +2.83R), and 60% of its replies fail the strict-JSON contract. It is also about 3× the cost and 2.8× the latency of Grok. Keep Grok as the informational shadow reader (cheaper, faster, 100% valid JSON in JSON mode). Don't add Claude to the desk path. The edge question is settled by §2: the scan itself has none over 16 years, so no LLM filter on top of it is worth wiring.
