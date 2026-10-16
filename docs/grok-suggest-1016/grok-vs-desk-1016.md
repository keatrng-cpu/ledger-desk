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

## 6. Why Grok turned setups down: logged replies joined to outcomes (added 12:55 CT, $0 new spend)

Source: `grok_real.jsonl` (`read.note`, `read.setup`, suggestion and confidence) joined to the scan's replay outcome R. Grok's own levels match the scan entry in nearly every accept (median |Δentry| = 0), so R is the setup's outcome. Categories are keyword buckets on Grok's stated note, multi-label, regexes in this section's script. Coverage: 116/122 valid replies; 5 malformed + 1 timeout = no reason logged (UNPROVEN). Grok gave no reason category for its accepts beyond 'valid …', so the accepted columns count the words it used.

| reason category | rejected winner | rejected loser | accepted winner | accepted loser | rejected WR | rejected net R |
|---|---|---|---|---|---|---|
| late / post-killzone / time | 42 | 18 | 3 | 3 | 70% | +12.36 |
| no fresh displacement / MSS | 23 | 13 | 0 | 0 | 64% | +6.86 |
| premium/discount wrong half | 19 | 10 | 19 | 13 | 66% | +3.75 |
| HTF bias against | 18 | 3 | 1 | 0 | 86% | +7.52 |
| chop | 6 | 3 | 0 | 0 | 67% | +3.18 |
| stale anchor / arrays stale or far | 13 | 4 | 1 | 0 | 76% | +6.76 |
| price already past entry / at T1 | 11 | 4 | 0 | 0 | 73% | +3.31 |
| no LTF arm / no array at entry | 10 | 4 | 0 | 0 | 71% | +4.67 |
| other/none stated | 0 | 0 | 12 | 7 | - | +0.00 |

Totals (116 valid): accepted n 54, 33W/21L, WR 61%, +4.14R; rejected n 62, 44W/18L, WR 71%, +12.91R. Base rate of the scan on these: n 116, 77W/39L, WR 66%, +17.05R.

- accepts at confidence 0.55: n 1, 0W/1L, WR 0%, -1.00R
- accepts at confidence 0.65: n 37, 24W/13L, WR 65%, +6.93R
- accepts at confidence 0.68: n 1, 1W/0L, WR 100%, +0.13R
- accepts at confidence 0.72: n 9, 4W/5L, WR 44%, -2.86R
- accepts at confidence 0.75: n 6, 4W/2L, WR 67%, +0.94R

- 08:30–11:00 CT: accepted n 33, 22W/11L, WR 67%, +7.05R | rejected n 21, 16W/5L, WR 76%, +4.72R
- after 11:00 CT: accepted n 21, 11W/10L, WR 52%, -2.91R | rejected n 41, 28W/13L, WR 68%, +8.19R

**What Grok saw (rebuilt exactly from the replay prompt, $0):** knowledge pack + `mtfSummary` (1m/5m/15m last 12 bars, 1h 8, 4h 6, day and pre-RTH hi/lo, last price, and up to 14 arrays) + the scan flag with entry/stop/T1. **Not sent:** prior-day/overnight levels (PDH/PDL/ONH/ONL), the other index (no SMT data, even though the pack lists SMT), desk card/brain state, volume, news.
- **Proven prompt bug:** the reader sends `arrays.slice(0, 14)` in `mtfArrays` order, i.e. the oldest 1m rows. In **110/116** prompts, *none* of the 14 arrays was within 1×ATR15 of price (median nearest 7.77×ATR15). Every prompt carried 1m arrays only (no 15m/1h/4h). Example #52 MNQ 10/15 14:10: last 30093, every array 30878–30902 (3-day-old 1m iFVGs). Grok's note: *'levels mismatch; price ~30080 vs arrays ~30880'*.
- Rejections that cite stale/far arrays or a stale anchor: n 17, 13W/4L, WR 76%, +6.76R. Those reasons describe the broken prompt, so they don't count as evidence against the setup.
- **Pack-induced 'late' rule:** the pack says 'NY AM 08:30–11:00 CT is the desk's main window'. Grok treated that as a hard filter. It also called entries at 09:00–09:15, inside the window, 'late' (#2, #3, #4, #92, #93); the pack has no such rule.
- **Misread data (proven from the prompt):** #118 ES 10/16 10:00, Grok wrote *'price at 7784 far from 7844 entry'*, but the scan entry it was given was 7784.5.

**Does any reason separate losers from winners? No (proven on 116 replies).** Every rejection category has a win rate of 64–86%, all at or above the accepted set's 61% and the scan's 66% base. The 'HTF bias against' rejects were the *best* group: 18W/3L, 86% WR, +7.52R. Accept confidence doesn't rank either: 0.72 → 44% WR, −2.86R vs 0.65 → 65% WR, +6.93R. The only proven split is time. Grok's after-11:00 accepts lost (52% WR, −2.91R), but it rejected 41 post-11:00 setups that won 68% (+8.19R), so the time rule cut more winners than losers too.

**Top findings:**
1. **Prompt bug (proven):** 110/116 prompts had no array within 1×ATR15 of price, and all were 1m only (oldest rows). Grok then rejected setups as 'stale/far arrays' (17 rejects, 76% WR). **Fixed on the branch:** nearest unmitigated arrays, at most 3 per timeframe, with a test. Its effect on Grok's verdicts is **UNPROVEN** until re-run (about $0.50 for 122; not spent).
2. **The knowledge pack's 'NY AM window' became a hard 'late' filter:** 'late/post-killzone' appears in 60 rejects (42W/18L, 70% WR, +12.36R). It's the biggest single source of rejected winners.
3. **No stated reason has predictive value.** HTF-against, no-displacement, premium/discount and chop rejects all won more often than Grok's accepts. Grok's rejections are not a usable loser filter on this sample (122 moments, one week; the 16-year verdict in §2 still stands).

Also missing from the prompt (proven by construction): PDH/PDL/ONH/ONL, the other index for SMT, desk card/Brain state, volume. Whether adding them changes verdicts is UNPROVEN.

### Per-moment log (★ = in the 50 shared with Claude)
| # | sym | side | day time CT | R | Grok | conf | Grok's stated reason |
|---|---|---|---|---|---|---|---|
| 0 ★ | MNQ | short | 10-12 8:35 | +0.12 | reject |  | late entry post 08:30 killzone, price already at 30952 far from scan entry 30952.25 with no retest of newest array |
| 1 ★ | MNQ | short | 10-12 8:45 | +0.54 | reject |  | post-sweep displacement already filled; entry now stale vs newer arrays |
| 2 ★ | MNQ | short | 10-12 9:00 | +0.51 | reject |  | late NY killzone, no recent MSS displacement, inside premium, against 4h bull bias |
| 3 ★ | MNQ | short | 10-12 9:10 | -0.08 | reject |  | late entry post 09:00 killzone, price already at extreme low with no retest |
| 4 ★ | MNQ | short | 10-12 9:15 | -1.00 | reject |  | late entry past 09:11, no fresh displacement after lower high, against 15m/1h bullish bias |
| 5 ★ | MNQ | short | 10-12 9:40 | -1.00 | ACCEPT | 0.75 | Valid: post-AMD manip, displacement lower, in discount below 50% range, near entry at 09:40. |
| 6 ★ | MNQ | long | 10-12 11:05 | +0.37 | reject |  | late post-killzone, no recent MSS/disp after 10:55, price in premium vs 4h range, arrays outdated |
| 7 ★ | MNQ | long | 10-12 11:20 | -1.00 | reject |  | late post-killzone, no recent MSS/disp after 11:05 high, price in premium vs 4h, chop on 1m/5m |
| 8 ★ | MNQ | short | 10-12 11:25 | +0.86 | reject |  | late post-killzone, no fresh 1m/5m bear array at entry, price already displaced past scan entry, against premium half |
| 9 ★ | MNQ | short | 10-12 11:30 | +1.69 | reject |  | late entry 11:30 CT, no fresh displacement, against higher-timeframe discount bias |
| 10 ★ | MNQ | short | 10-12 12:15 | +0.70 | reject |  | late post-killzone, no recent MSS, inside chop range, stale anchor |
| 11 | MNQ | long | 10-12 14:35 | +0.01 | reject |  | late entry post-NY AM killzone, against higher-timeframe bearish structure |
| 12 ★ | MNQ | long | 10-12 14:40 | -1.00 | ACCEPT | 0.65 | valid long near entry, HTF discount, post-killzone but displacement present |
| 13 | MNQ | long | 10-12 15:00 | -0.21 | reject |  | late post-killzone, no recent MSS, arrays stale at 311xx far from price |
| 14 | MNQ | short | 10-13 8:30 | +0.01 | ACCEPT | 0.75 | Valid NY killzone short; near entry with displacement. |
| 15 | MNQ | long | 10-13 8:40 | +0.01 | ACCEPT | 0.72 | Valid NY AM killzone long; near entry at 30757.25 close, OTE discount to premium transition. |
| 16 | MNQ | long | 10-13 8:45 | +0.58 | ACCEPT | 0.65 | Valid NY AM long in discount, displacement present, near entry. |
| 17 | MNQ | long | 10-13 9:25 | -1.00 | ACCEPT | 0.72 | Valid long: AMD manipulation sweep done, displacement up, premium half avoided, still near entry in NY killzone. |
| 18 | MNQ | short | 10-13 12:00 | +0.57 | ACCEPT | 0.65 | valid missed short; near entry at 12:00 CT with displacement |
| 19 ★ | MNQ | long | 10-13 12:05 | -1.00 | reject |  | post-11:30 NY killzone, no recent MSS/disp after 11:55 break, in premium vs 4h, late entry |
| 20 | MNQ | short | 10-13 12:15 | +0.21 | reject |  | late entry after NY killzone, price in discount but chop on 1m/5m with no displacement since 12:05; against higher-timeframe bullish 4h bias |
| 21 ★ | MNQ | long | 10-13 12:35 | +3.23 | reject |  | post-NY killzone, no recent MSS/disp, inside premium after sweep, arrays stale high |
| 22 ★ | MNQ | long | 10-13 12:45 | -1.00 | reject |  | late entry post-killzone, premium pricing, no fresh displacement on 1m/5m retest |
| 23 | MNQ | long | 10-13 13:10 | +0.14 | reject |  | late entry, already distributed past OTE, against 4h bear bias |
| 24 | MNQ | long | 10-13 13:15 | -1.00 | ACCEPT | 0.72 | Valid long in NY PM; near entry with displacement and HTF discount alignment. |
| 25 ★ | MNQ | short | 10-13 14:00 | -1.00 | ACCEPT | 0.65 | Valid: displacement lower, in discount below day 50%, post-NY killzone but mechanical tap. |
| 26 ★ | MNQ | long | 10-13 14:45 | +1.16 | ACCEPT | 0.65 | Valid displacement into gap, still near entry in NY PM, premium but HTF discount. |
| 27 ★ | MNQ | short | 10-14 8:45 | -1.00 | reject |  | No MSS displacement; late post 08:30; in discount half; arrays outdated |
| 28 | MNQ | short | 10-14 9:00 | +0.05 | ACCEPT | 0.65 | valid NY killzone short with displacement and pool raid; arrays shown are stale/old irrelevant levels |
| 29 | MNQ | short | 10-14 9:00 | +0.09 | ACCEPT | 0.65 | Valid short in NY killzone; displacement present, premium rejection, near entry. |
| 30 | MNQ | short | 10-14 11:00 | +0.42 | reject |  | late post-killzone, no recent displacement, price in discount not premium, arrays stale/high |
| 31 | MNQ | short | 10-14 11:15 | +0.03 | reject |  | late entry after 11:00 killzone, displacement already distributed, price at extremes |
| 32 | MNQ | short | 10-14 11:20 | +0.69 | reject |  | chop after 11:10 displacement, late entry, against higher-timeframe bullish bias |
| 33 ★ | MNQ | short | 10-14 11:50 | +1.89 | reject |  | late post-killzone, no recent displacement, price already below entry in chop range |
| 34 | MNQ | short | 10-14 12:30 | +0.08 | reject |  | late post-killzone, no fresh displacement, against 4h/1h bullish bias |
| 35 | MNQ | short | 10-14 12:30 | +0.15 | reject |  | late post-killzone, price already at T1, no displacement after sweep, stale anchor |
| 36 | MNQ | short | 10-14 12:50 | +0.48 | malformed |  |  |
| 37 | MNQ | long | 10-14 14:20 | +0.18 | ACCEPT | 0.65 | Valid long setup still near entry; not late, has displacement, in discount below day 50% |
| 38 | MNQ | long | 10-14 14:25 | +0.26 | reject |  | post-killzone, premium half, no fresh displacement on retest, against 15m/1h bear bias |
| 39 ★ | MNQ | long | 10-14 14:45 | -1.00 | reject |  | post-14:30 displ down, now in premium, late after NY killzone |
| 40 ★ | MNQ | short | 10-14 14:45 | -0.81 | reject |  | valid short but lateEntry after 11:00 killzone; no suggestion |
| 41 | MNQ | long | 10-15 8:40 | +0.13 | ACCEPT | 0.68 | Valid NY killzone long; displacement present; near entry at 29829.75; premium but early session AMD distribution leg. |
| 42 | MNQ | long | 10-15 8:45 | -1.00 | ACCEPT | 0.72 | Valid long setup still near entry in NY killzone; displacement present, no major HTF conflict. |
| 43 | MNQ | short | 10-15 8:55 | +0.00 | ACCEPT | 0.65 | Valid NY killzone short; near entry with displacement. |
| 44 ★ | MNQ | short | 10-15 9:00 | -1.00 | ACCEPT | 0.65 | valid NY killzone short; displacement present; near entry at 29687 |
| 45 ★ | MNQ | short | 10-15 9:50 | -1.00 | ACCEPT | 0.72 | Valid near entry; displacement present, premium sell zone, killzone active. |
| 46 | MNQ | long | 10-15 10:00 | +0.08 | ACCEPT | 0.65 | Valid AMD distro leg; displacement present; still near entry at 10:00 CT killzone. |
| 47 ★ | MNQ | long | 10-15 10:30 | -1.00 | ACCEPT | 0.65 | Valid long: NY killzone, displacement through gap, premium but OTE retest, SMT ok. |
| 48 | MNQ | short | 10-15 13:05 | +0.28 | ACCEPT | 0.65 | Valid short: MSS + displacement, near entry at 13:05, in NY killzone. |
| 49 | MNQ | short | 10-15 13:10 | +0.57 | reject |  | late post-killzone, no MSS, against HTF bull bias |
| 50 ★ | MNQ | short | 10-15 13:40 | -1.00 | ACCEPT | 0.72 | Valid short: displacement through 13:00 low, premium rejection, near entry at 13:40. |
| 51 | MNQ | long | 10-15 14:05 | +0.03 | malformed |  |  |
| 52 | MNQ | long | 10-15 14:10 | +0.06 | reject |  | levels mismatch; price ~30080 vs arrays ~30880; no recent displacement on 5m/15m; late post-killzone |
| 53 | MNQ | long | 10-15 14:20 | +0.36 | reject |  | valid long but lateEntry after 11:00 killzone; premium above daily 50% |
| 54 ★ | MNQ | long | 10-15 14:35 | +1.46 | ACCEPT | 0.65 | valid long setup still near entry; displacement present, in discount to day range, killzone passed but HTF aligned |
| 55 | MNQ | short | 10-16 8:30 | +0.03 | ACCEPT | 0.65 | Valid AMD manip short; displacement present; near entry at 08:30 killzone open. |
| 56 | MNQ | short | 10-16 8:35 | +0.06 | reject |  | late NY open, no HTF bearish structure, premium half, stale anchor |
| 57 | MNQ | short | 10-16 8:40 | +0.29 | ACCEPT | 0.72 | Valid NY killzone short; displacement present; near entry. |
| 58 ★ | MNQ | short | 10-16 9:45 | +3.26 | ACCEPT | 0.65 | Valid NY killzone short: displacement lower, premium sell, no opposing HTF. |
| 59 ★ | MNQ | short | 10-16 10:00 | +1.83 | ACCEPT | 0.75 | Valid NY killzone short; displacement on 09:51 1m, lower high retest at 29862.25. |
| 60 | MNQ | short | 10-16 10:10 | +0.00 | reject |  | late post-10am, no fresh displacement after 09:58 low, against 4h/1h bullish bias, stale entry anchor |
| 61 | MNQ | short | 10-16 10:15 | +0.78 | ACCEPT | 0.65 | valid NY killzone short; near entry after LH retest |
| 62 ★ | MNQ | short | 10-16 10:45 | +1.56 | ACCEPT | 0.65 | Valid near entry in NY killzone; displacement present. |
| 63 | ES | short | 10-12 8:35 | +0.93 | ACCEPT | 0.72 | Valid AMD manipulation sweep at 08:30; displacement lower on 08:31-08:34; near entry in NY killzone. |
| 64 ★ | ES | short | 10-12 8:35 | -1.00 | ACCEPT | 0.65 | valid AMD manip short into NY open; displacement present; still near entry |
| 65 | ES | short | 10-12 8:50 | +0.15 | reject |  | late entry post 08:45 displacement; price already 4pts below scan entry at 08:50; against premium half |
| 66 | ES | short | 10-12 9:10 | +0.01 | reject |  | valid short after MSS, near entry, in NY killzone, discount but with displacement |
| 67 | ES | short | 10-12 9:15 | -1.00 | ACCEPT | 0.65 | valid NY killzone short; near entry; displacement present; premium to discount |
| 68 | ES | short | 10-12 9:35 | +0.75 | reject |  | late post-killzone, no clear AMD distro, price in discount-to-premium transition without displacement confirmation |
| 69 ★ | ES | long | 10-12 11:20 | -1.00 | reject |  | late entry, no LTF arm, against recent 1m arrays and chop tape |
| 70 | ES | short | 10-12 11:25 | +0.18 | timeout |  |  |
| 71 | ES | short | 10-12 11:30 | -1.00 | ACCEPT | 0.65 | Valid short on displacement & array; still actionable near 7856.5 close |
| 72 | ES | short | 10-12 11:45 | +0.44 | malformed |  |  |
| 73 ★ | ES | short | 10-12 12:15 | +1.46 | ACCEPT | 0.65 | valid near entry; displacement present; killzone late but HTF bear bias |
| 74 | ES | short | 10-12 13:30 | -1.00 | ACCEPT | 0.65 | Valid short: recent MSS down, price at premium retest of broken 15m gap with displacement; still near entry. |
| 75 | ES | long | 10-12 14:35 | +0.04 | ACCEPT | 0.65 | Valid post-AMD distro long; near entry at 14:35 with displacement present. |
| 76 | ES | long | 10-12 14:40 | +0.56 | reject |  | late entry post-displacement; no killzone; against 1h bear bias from 11:00 |
| 77 | ES | long | 10-12 15:00 | -0.07 | reject |  | post-15:00 CT, chop in 5m/15m, against higher-timeframe bearish structure from 4h/1h |
| 78 ★ | ES | long | 10-13 8:30 | +2.80 | reject |  | no displacement, late entry into Asia range, against recent 1m bear iFVGs |
| 79 | ES | long | 10-13 8:35 | +0.56 | ACCEPT | 0.65 | Valid NY killzone AMD manip low sweep + MSS displ; near entry in discount. |
| 80 ★ | ES | short | 10-13 8:45 | +4.33 | ACCEPT | 0.65 | Valid: post-AMD manip sweep high, displacement down on 08:35 5m, in NY killzone, at premium but tapping unmit HTF gap. |
| 81 ★ | ES | long | 10-13 8:45 | -1.00 | ACCEPT | 0.65 | valid long setup still actionable |
| 82 | ES | short | 10-13 10:30 | +0.09 | reject |  | late entry post 10:25 displacement, price already 1pt below scan entry at 10:30, no fresh array below current price |
| 83 ★ | ES | long | 10-13 11:15 | +1.07 | reject |  | lateEntry after 11:00 CT, chop on 5m/1m, against recent bear arrays |
| 84 ★ | ES | long | 10-13 12:25 | -1.00 | reject |  | no displacement, post-killzone, premium |
| 85 | ES | long | 10-13 13:10 | +0.10 | reject |  | late entry after 11:00 killzone, no HTF alignment, premium zone |
| 86 | ES | long | 10-13 13:15 | -1.00 | ACCEPT | 0.55 | valid long but post-killzone and late vs NY AM; near entry |
| 87 | ES | long | 10-13 14:10 | +0.17 | malformed |  |  |
| 88 | ES | long | 10-13 14:15 | +0.08 | reject |  | valid long but lateEntry post-11:00 killzone; no card due to timing gate |
| 89 | ES | long | 10-13 14:30 | +0.69 | reject |  | late post-killzone, no sponsored FVG or AMD structure, chop on 1m/5m |
| 90 | ES | short | 10-14 8:45 | +0.75 | ACCEPT | 0.75 | Valid: post-AMD manip sweep low, displacement down, in NY killzone, at premium rejection into HTF gap. |
| 91 | ES | short | 10-14 9:00 | +0.04 | malformed |  |  |
| 92 | ES | short | 10-14 9:00 | +0.08 | reject |  | late entry past 08:57 displacement; price already at 7807.75 below T1; against HTF bull bias on 4h/1h |
| 93 | ES | short | 10-14 9:05 | +0.42 | reject |  | late NY killzone entry, no fresh displacement, against 15m/1h/4h bullish structure, premium half |
| 94 | ES | short | 10-14 9:40 | +0.08 | ACCEPT | 0.65 | valid displacement on 5m/15m, NY killzone, discount half, near entry |
| 95 | ES | short | 10-14 11:00 | +0.58 | ACCEPT | 0.65 | Valid displacement lower into discount, near entry at 11:00 killzone close |
| 96 ★ | ES | short | 10-14 11:15 | -0.15 | ACCEPT | 0.65 | Valid short: MSS+displacement into discount, still near entry at 11:15. |
| 97 | ES | short | 10-14 11:20 | +0.64 | reject |  | Valid short but lateEntry after 11:00; against premium half and no fresh HTF MSS. |
| 98 ★ | ES | short | 10-14 11:45 | +1.70 | reject |  | late post-killzone, no recent MSS displacement, price in discount half, arrays stale from overnight |
| 99 | ES | short | 10-14 12:30 | +0.07 | ACCEPT | 0.65 | Valid short: MSS + displacement, near entry, in NY killzone tail, premium to discount. |
| 100 ★ | ES | long | 10-14 13:20 | -1.00 | reject |  | valid long but lateEntry post-NY AM; no displacement on 5m close |
| 101 ★ | ES | short | 10-14 13:25 | -1.00 | reject |  | late post-13:00 NY, no fresh displacement, price already 10pts below scan entry in discount half |
| 102 ★ | ES | long | 10-14 14:20 | +0.59 | reject |  | late entry after 11:00 killzone, against HTF bear structure |
| 103 ★ | ES | short | 10-14 14:40 | -1.00 | ACCEPT | 0.65 | Valid displacement lower on 14:35 5m, near entry at 14:40 with price ~7760 |
| 104 ★ | ES | long | 10-14 14:45 | +1.08 | reject |  | late post-killzone, no recent MSS, in premium vs 4h, stale anchor |
| 105 ★ | ES | long | 10-15 8:45 | -1.00 | ACCEPT | 0.75 | Valid NY AM long in discount; near entry, has MSS + FVG. |
| 106 | ES | short | 10-15 8:55 | +0.01 | reject |  | Valid AMD manipulation sweep of low; near entry at 08:55 in NY killzone; displacement present but late vs ideal 08:30-09:00. |
| 107 | ES | long | 10-15 9:10 | +0.26 | reject |  | stale entry anchor; no recent displacement or sweep at 7746; price in premium half; late for NY AM killzone |
| 108 | ES | long | 10-15 10:00 | +0.06 | ACCEPT | 0.65 | Valid long: AMD distro phase, MSS up through PDH, sponsored FVG, in NY killzone, premium half but gap sponsored. |
| 109 ★ | ES | long | 10-15 10:30 | -1.00 | reject |  | late entry post 10:25 low; no fresh displacement; inside premium; stale anchor |
| 110 | ES | short | 10-15 13:05 | +0.20 | ACCEPT | 0.65 | Valid short: MSS + displacement, near entry, in NY killzone extension, discount to day high. |
| 111 | ES | short | 10-15 13:10 | +0.38 | reject |  | late post-killzone, no recent displacement on 5m/15m, price already through entry, arrays stale & far from price |
| 112 ★ | ES | short | 10-15 13:40 | -1.00 | ACCEPT | 0.65 | Valid short: displacement lower, premium sell zone, near entry at 13:40. |
| 113 | ES | long | 10-15 14:20 | +0.24 | ACCEPT | 0.65 | Valid long: post-AMD distro, discount to day high, MSS up through 14:00 high, near entry at 14:20. |
| 114 ★ | ES | long | 10-15 14:35 | -1.00 | reject |  | late post-killzone, displacement weak, price already swept high and in premium; no LTF arm |
| 115 | ES | short | 10-16 8:35 | +0.02 | reject |  | late NY killzone entry, no fresh displacement, stale high arrays, price already 0.5pt below scan entry |
| 116 | ES | short | 10-16 8:40 | +0.35 | ACCEPT | 0.75 | valid NY killzone short; near entry with displacement |
| 117 | ES | short | 10-16 9:00 | +0.38 | ACCEPT | 0.65 | Valid displacement at 08:30-08:35, near entry at 09:00, premium sell zone. |
| 118 ★ | ES | short | 10-16 10:00 | +1.95 | reject |  | price at 7784 far from 7844 entry; late post-killzone; against 15m/1h/4h bullish bias |
| 119 | ES | short | 10-16 10:10 | +0.03 | reject |  | late entry post 10:05 displacement, price already 10pts below scan entry, no displacement after sweep, against 15m/1h bullish bias |
| 120 | ES | short | 10-16 10:15 | +0.91 | ACCEPT | 0.72 | Valid NY killzone short; displacement present; near entry; HTF discount. |
| 121 ★ | ES | short | 10-16 11:20 | -0.33 | reject |  | late post-killzone, no recent MSS/displacement, price already 10pts below scan entry in discount half |
