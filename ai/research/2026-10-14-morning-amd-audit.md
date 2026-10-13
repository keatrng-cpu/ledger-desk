# Morning AMD / Power-of-Three Audit (NQ/ES): Wed Oct 14, 2026
Joint audit with Accuracy Review. Research only: read-only, no code or watcher edits, no orders. Recommendations are for Trading Stand to implement.
Written Tue Oct 13, 2026, ~5:30 PM CT. Code was read at ledger-desk `main` 915e5ead and Trading-Automation 5787f86. Watcher files are under `/workspace/desk-watcher` (live copy).

> **Timing factor tomorrow:** September CPI prints at **7:30 AM CT (8:30 ET)** (BLS schedule). The 8:30 ET data candle IS the manipulation candidate tomorrow. The Robinhood 1DTE ATM straddle implied ±0.52% for SPY and ±0.87% for QQQ (evening pack, SHA ae88446a). Premiums will be elevated into the 8:30 CT cash open, which makes the size-cap blocker below worse.

---
## 1. Testable definition of the morning sequence (all times ET / CT)

Evidence labels used below:
- **[ICT]**: practitioner canon (ICT/Huddleston 2016–2022 mentorship; SMC community), *not peer-reviewed*.
- **[ACAD]**: peer-reviewed or working-paper evidence. Academic citations are from the literature and were not re-fetched in this session; verify them before quoting externally.
- **[DESK]**: the desk's own data.

### 1a. Reference ranges (computed from 1m bars on the Globex day that starts at 18:00 ET)

| Ref | ET | CT | Source | Desk today |
|---|---|---|---|---|
| CBDR (Central Bank Dealers Range) | 14:00–20:00 prev | 13:00–19:00 | [ICT] | **Not implemented.** 0 references in `src/`; only `cbdrAsia` shadow item 19 in desk-rules |
| Asia range | 20:00–00:00 | 19:00–23:00 | [ICT] | `day-context.ts:21-28` uses 20:00–00:00 ✔. `sessions.ts:181` labels 19:00–02:00 as "asia"; TA `sessions.py:131` uses 18:00–02:00. **3 different definitions** |
| Midnight open (true day open) | 00:00 | 23:00 prev | [ICT] | `structure.ts:558` `openAt(0,0)` ✔ |
| London range | 02:00–05:00 | 01:00–04:00 | [ICT] | `day-context.ts:29` ✔ |
| Overnight / Globex H/L | 18:00–09:30 | 17:00–08:30 | std | `day-context.ts` `overnight` ✔ |
| 8:30 data candle | 08:30–08:31 (1m) / 08:30–08:35 (5m) | 07:30 | [ICT]; ABDV 2003/2007 [ACAD] | No named level. **Not detected as a reference** |
| 9:30 RTH open | 09:30 | 08:30 | std | used by OR |
| Opening range | 09:30–09:45 | 08:30–08:45 | Crabel 1990; desk Fix 6 | `day-context.ts:88-110` `openingRange()` ✔ (15 one-minute bars) |
| PDH/PDL | prior RTH | | std | ✔ |

### 1b. Steps

| Step | Testable rule (proposed) | Evidence |
|---|---|---|
| **A: Accumulation** | Asia range ≤ `maxAsiaAtr15` × ATR15 (desk-rules item 19 uses 6), or OR/pre-open compression: ≥8 bars inside ≤2.5 ATR (`ACCUM_*` in detectors.ts:1154-1165) | [ICT]; no academic validation |
| **M: Manipulation sweep** | A 1m or 5m bar whose wick trades **beyond a named reference level** (Asia H/L, London H/L, ON H/L, PDH/PDL, 8:30-candle H/L, EQH/EQL within 0.1 ATR15) by ≥1 tick, **with a close back inside within 1–3 bars** (kzblock items 1–2). Tolerance: NQ 0.25 pt per tick, ES 0.25 pt; equal-highs tolerance 0.1×ATR15. Depth beyond the level is optional; desk data says depth >0.5 ATR does *not* help (n=40, hit 27.5%, −0.09R) | [ICT]; stop clustering beyond round numbers and highs/lows: Osler 2003 (JF 58(5)); Osler 2005 cascades (JIMF 24) [ACAD] |
| **T: Tap of a PD array** | After the sweep, price retraces into the displacement leg's FVG (body-to-wick gap), its CE (50%), an OB (last opposite candle), or IFVG. A touch is ≥1 tick into the zone | [ICT]. [DESK] says `tap!=none` n=33 hit 24%, *no lift* |
| **D: Displacement** | Body ≥1.5×ATR(14) on the trigger TF (`DISPLACEMENT_K=1.5`, detectors.ts:32), body fraction ≥0.7, leaves an FVG, and breaks the last opposing swing (MSS/CHoCH on 1m or 5m) within 30 min of the sweep (`MM_DISPLACE_WITHIN_MINUTES=30`) | [ICT] |
| **Distribution** | Move from the tap toward the opposite pool. T1 ≈ 0.85–1R, T2 = external liquidity | [ICT] |
| **Timing** | 8:30 ET data candle → manipulation typically **8:30–9:45 ET (7:30–8:45 CT)**, often completing within the first 15 min of cash (09:30–09:45 ET = 08:30–08:45 CT). Distribution **09:45–11:00 ET (08:45–10:00 CT)**. Silver Bullet 10:00–11:00 ET | [ICT]. U-shaped intraday volatility (Wood, McInish & Ord 1985 JF; Harris 1986 JFE; Andersen & Bollerslev 1997 JEF). Price discovery on 8:30 macro news is concentrated in minutes (Andersen, Bollerslev, Diebold & Vega 2003 AER; 2007 JIE; Fleming & Remolona 1999 JF) [ACAD] |

**Evidence status**
- The academic literature supports two ingredients: stops cluster beyond salient levels (Osler), and volatility and news impact are concentrated at the open and 8:30.
- It does **not** validate AMD/PO3 as a strategy. Opening-range studies give mixed or weak evidence: Holmberg, Lönnbark & Lundström 2013 (FRL) found ORB profitable in crude-oil futures; Zarattini/Aziz SSRN 2023–24 report QQQ 5-min ORB results, which are a working paper.
- CPI-day reaction: the 2026 Applied Economics Letters study found a significant +0.88% AR on cool surprises and a non-significant negative on hot ones.

### 1c. Today's (Oct 13) real example, using RH QQQ/SPY 5m as an NQ/ES proxy
1. **Manipulation:** QQQ opened 739.53 and wicked to **738.84** in the 8:30 CT bar.
2. **Displacement:** the 8:35 bar ran 740.20 → 742.84 (+0.36%).
3. **Distribution:** price reached **744.20 by 9:00 CT** (+0.73% from the low).
4. **SPY** was the mirror image: 777.17 low at 8:30 CT, then 778.75 high at 8:40 CT.

This was a textbook down-raid-then-up open.

---
## 2. Our own data

**Data coverage**
- `gates.log` has 1,333 rows, but **only 12:50–14:50 CT Oct 13**, so it contains no morning rows.
- `cards.log` covers 12:29–13:50 CT.
- Morning evidence therefore comes from `watcher.log` (`alert` / `fire_refused_desk`, 8:30 CT onward).
- **Only one morning (Oct 13) is available.** Recent-days AMD analysis is not possible from these logs.

**Rules hash.** `shared/desk-rules.json` at 915e5ead and `desk-watcher/watcher/desk-rules.json` both hash to **42224ca008a64275** using the watcher's canonical method (gates.py:17-19: canon floats → sorted, compact JSON → sha256[:16]). ✔ Verified. Note that the raw-file sha256 is 42e680e1…, a different number, so always use the canonical method.

**Oct 13 morning signals vs what happened** (watcher.log; times converted to CT):

| CT | Card | Was it AMD-correct? | Refused by |
|---|---|---|---|
| 8:30:22 | MNQ short A q0.7229, "stop beyond the raid" | **Wrong side**: entered *with* the down-raid (price then +0.7%) | band A (need A+); verdict WATCH; phase look |
| 8:31–8:36 | MNQ short A/A q0.6881–0.7229 | Wrong side; ticket was a **SPY call** on a short | band, actionable, blocks, verdict, **ticket_side**, phase |
| 8:37:38 | **ES long A- q0.6794** "Below PDL 7846.25 / sweep" | **Right side**, inside distribution (SPY 778.57 → 778.75 high at 8:40) | band A- (need A+), blocks "1h/4h gaps not this side", verdict WATCH, phase look |
| 8:45–8:50 | ES long A- actionable, SPY call 1DTE ~$275 | Right side, late | (alert only) |
| 8:53:25 | **ES long A+ q0.8069**, SPY call 1DTE 2ct ~$550 | Late: the SPY high was already in at 8:40, and SPY then fell to 777.19 by 9:05 | **only** verdict WATCH + phase look |
| 9:00 | MNQ long A+ q0.7708 | Late, at the top (QQQ 744.20 was the high) | ticket None, verdict STAND, phase |

Read of the table:
- The fire-band setting at the open was **A+ only**. `FIRE_ALLOW_A_MINUS` / `B_PLUS` were turned on at 9:12/9:14 CT per the `config.py:22-23` comments, so the A- right-side card was band-blocked by config at the time.
- The detector's first card faded the wrong way (it treated the sweep as the entry). That directly contradicts smc-canon.ts:290 "Sweep / raid / Judas = manipulation. Never the entry."

**Afternoon gate funnel** (gates.log, 1,333 rows; **0 rows passed all gates**):

| Gate | Failed | Reason (top) |
|---|---|---|
| verdict | **1333/1333** | STAND 916, WATCH 417 |
| phase | **1333/1333** | "execution.phase look (need hand)" |
| actionable | 1333/1333 | actionable=False |
| account/live_quote/sizing/buying_power/no_position/no_working_order | 1333/1333 each | "unverified — no RH session (dry-run)" (expected in dry-run) |
| band_truth | 1210 | persistence "held None (need ≥6s)" |
| band / q | 1177 / 1177 | q 0.5999: 596; q 0.4999: 382 |
| ticket / dte | 916 / 916 | "ticket None None" → "dte None" |
| ticket_side | 1118 | short with no ticket: 510; long/none: 406; **long vs put: 202** |
| entry_distance | 423 | B denied late path |
| blocks | 397 | "Brain is standing. SMT…" 159 |
| ltf_kill | 386 | |
| stop_width | 171 | "wire.strategy.stop is on the wrong side for a short": 151 |
| bplus_caution | 130/130 | needs brain word TAKE/GO |
| grok_agree | 152/156 | brain WAIT disagrees |
| entry_cutoff | 109 | after 15:40 ET |
| rules_parity | 16/883 | hash mismatches (4 hash changes) |

**Kill-zone backtest** (`desk-watcher/tools/kz_backtest_report.json`, 20 days, 2026-09-16 → 10-13, NQ/ES). 95% intervals are Wilson for hit rate and normal for mean R:

| Slice | n | Hit | Hit 95% CI | avgR |
|---|---|---|---|---|
| earlyBonus (first 15 min) | **14** | 42.9% | **21%–67%** | +0.14 (totR 1.99) |
| core with BOS | 43 | 30.2% | 19%–45% | −0.06 |
| raw sweeps + displacement | 95 | 31.6% | 23%–42% | −0.00 |
| kz_trades.json: NY + early (my cut) | 44 | 30% | 18%–44% | +0.18 (mean-R CI +0.05 to +0.32) |

- **n=14 cannot distinguish 43% from 30%** (the intervals overlap heavily).
- The only slice whose mean-R CI excludes 0 is NY-early in kz_trades (n=44), and that is still 20 days, in-sample.
- Filters that did *not* help: tap!=none (24%), sweep depth >0.5 ATR, SMT, Silver Bullet. Outcome mix: 59 of 127 ended `reversal_ifvg` and 32 `expired`.

---
## 3. Mapping: AMD step → detector → wiring → wrong blockers

| AMD step | Detector (file:function) | Wired correctly? | Gates that would wrongly block |
|---|---|---|---|
| Ref ranges (Asia/London/ON/midnight/OR) | `smc/day-context.ts:sessions()`, `sessionSequence()`, `openingRange()`; `structure.ts` midnightOpen | Partly. ET via Intl ✔. **Asia defined 3 ways** (day-context 20–00, sessions.ts 19–02, TA 18–02). **No CBDR. No 8:30-candle level.** `sessionSequence` returns null until the London bars exist | none directly |
| Accumulation | `detectors.ts` ACCUM_* (1154–1165); kz item 19 `cbdrAsia` **shadow** | Detector exists; Asia-range check is shadow only | none |
| Manipulation sweep | `detectors.ts:735 detectSweeps()`, which `judas-window.ts:readJudas()` uses | **Mis-specified for AMD.** Sweeps only *fractal swing points* (MM_SWING_WIDTH=3), not the named session levels. Zero tolerance. Close back inside the *same bar* only (no 1–3 bar allowance). Session-pool sweeps live only in kzblock items 1–2, which are **shadow** | Desk emitted a short *with* the raid at 8:30 CT. No gate catches "trading the raid" |
| Tap (FVG/OB/CE) | smc-canon `pd_fvg`/`ifvg`; kz items 3,4,8 (shadow) | CE entry is shadow. `entry_distance` (0.5×ATR) denies late entries for B/B+ | entry_distance 423 fails; `entry` None on many cards |
| Displacement + MSS | `detectors.ts` DISPLACEMENT_K=1.5, body rule; kz item 5/7 shadow | ✔ thresholds sane; MSS is via smc-canon `mss` | `disp_vs_rr` (38) duplicates the R:R check |
| Judas 09:30–09:45 | `judas-window.ts:113 JUDAS_BLOCKS=false`, `isJudasWindow` (sessions.ts:246) | **Soft** ✔ (blocks only if flag true; auto-paper/path-alarm/paper-manager all gate on the flag). `JUDAS_MIN_CONFLUENCE=0.75` (line 59) is documented as an "escape" but unused while soft. **Fails closed without 1m/2m/3m tape** (smc-master.ts:441-445, judas-window.ts:143) | No hard clock at 9:45. Only the label |
| Distribution / direction | brain (`smcMaster.oneBook`), Floor `options-desk.ts:evaluateOptionsDesk` | Card side vs ticket side can disagree | ticket_side (202 long-vs-put); blocks "1h/4h gaps not this side"; brain STAND/WAIT |
| Execute | `desk-listen.ts:227` `phase = handed ? "hand" : "look"`, with `handed = armed.verdict==="ARMED" && ticket` | **Never true:** any non-model hold demotes ARMED→WATCH (`options-desk.ts:2209 gateHand`). The fix comment admits "19 replay days + today: 0 ARMED / 0 hand" | **verdict + phase = 100% fail; the root blocker** |

**Known blockers: confirm or refine**

1. **Floor never armed (100%) — CONFIRMED.**
   - `gates.log` shows verdict 1333/1333 and phase 1333/1333 failing.
   - Root cause: `gateHand` (options-desk.ts:2203-2210) passes ARMED only when the *sole* hold is `MODEL_TICKET_HOLD`. Any other hold (Brain standing, SMT, direction) makes it WATCH.
   - `phase` then requires ARMED plus a ticket (desk-listen.ts:226-227).
   - Whether the gateHand fix was deployed during the 12:50–14:50 window is unknown; it fails in all logged rows either way.
2. **916/1333 no ticket — CONFIRMED.**
   - "ticket None None" 916 times, which cascades into `dte None` (916) and `ticket_side` (916 of 1118).
   - That is **one cause counted 3 times**.
3. **q pinned at 0.5999 — REFINED.**
   - It is **not** a scoring dead zone. It is the **band clamp**: `discipline.ts:223-232 BAND_CEIL.B = bandEdges["B+"] − 0.0001 = 0.5999`. `sealBand()` (≈line 248) clamps q to the ceiling of whatever cap lowered the band, keeping the original value in `qRaw`.
   - All 596 rows at 0.5999 are band B, so some cap (path/veto/discipline) lowered them to B.
   - The watcher then tests `q >= q_min=0.60` (config.py:30; gates.py:526) and the band edge B+ 0.60 (desk-rules `bandEdges`). The **0.65 `confluenceFloor`** (config.ts:22) equals the A- edge, not the gate.
   - So the q gate **double-counts the cap**: band and q fail for the same reason (1177 = 1177).
   - **Fix:** log `qRaw` and the cap reason. Do not move thresholds.
   - Separately, `config.ts` bPlus `fitFloor 0.6` and TA `confluence.json:7 floor 0.75` (best 0.6353, cleared 0/843) are inconsistent across repos.
4. **Size cap below the option price — CONFIRMED.**
   - The watcher `BAND_SIZE` (gates.py:342-343) is B+ 1 contract ≤$150, A- 1 ≤$250, A 2 ≤$450, A+ 4 ≤$650. `MAX_DEBIT` is 650 (config.py:39), while the desk envelope is $50–$550 (RH_LIVE_ROUTINE.md:53,138). **That mismatch is itself a gap.**
   - Evening ATM 1DTE quotes:

     | Contract | Mark | Fits within |
     |---|---|---|
     | SPY 778C | $213.5 | **> B+ $150** |
     | SPY 778P | $188.5 | **> B+ $150** |
     | QQQ 743C | $368 | **> A- $250** |
     | QQQ 743P | $281.5 | **> A- $250** |

   - B+ can never buy an ATM SPY/QQQ contract, and A- cannot buy ATM QQQ.
   - Pre-CPI premiums will be higher at the open.
5. **Gates repeat each other — CONFIRMED.** Redundant pairs:
   - band ↔ q ↔ band_truth (same q edge, 3 rows)
   - ticket ↔ dte ↔ ticket_side (no-ticket counted 3×)
   - verdict ↔ phase ↔ actionable (all derive from Floor ARMED)
   - brain appears in `blocks` ("Brain is standing"), `grok_agree`, `bplus_caution` and the `brain` gate; the brain is **required twice for B+** (grok_agree AND bplus_caution)
   - disp_vs_rr ↔ rr_sane ↔ t1_rr
   - htf_bias size cut ↔ blocks "1h/4h gaps not this side"
6. **Fail-closed on missing data at the open — CONFIRMED.**
   - account/live_quote/sizing/BP fail in dry-run by design.
   - Judas fails closed without 1m tape.
   - `band_truth` needs ≥6 s persistence plus streak ≥2 (gates.py:519-525): 1,210 fails, including "held None" when the first poll has no history.
   - `stop_width` "cannot check" when the stop parse fails (151 were wrong-side stop parses for shorts). That is a **wiring bug**.
   - `sessionSequence` returns null before the London bars load.
   - The Judas clock is **soft** (no hard 9:45 lock) ✔.

---
## 4. Prioritized fix list (recommendations only; Trading Stand implements)

Per the shared rule, **any scoring, setup or direction change must ship to desk, brain, Floor and RH watcher together**, with a pinned rules hash for the session.

| P | Fix | Why / evidence |
|---|---|---|
| P0 | Make Floor ARMED reachable: in `gateHand` (options-desk.ts:2203), treat brain-STAND/SMT/direction holds as **size/caution notes** for A+/A, not WATCH demotions; log every demotion reason | 0 ARMED / 0 hand ever. Nothing can fire |
| P0 | Collapse duplicates into one gate each: {band, q, band_truth} → `band_truth`; {ticket, dte, ticket_side} → `ticket`; {verdict, phase, actionable} → `armed`; brain used **once** | Same cause counted 3×; brain needed twice for B+ |
| P0 | Fix `stop_width` stop parsing for shorts ("wrong side" 151) and ticket direction (long card with put ticket 202; short with call at 8:31 CT) | Wiring bugs, not risk controls |
| P0 | Align size caps with the CPI-day price: either let B+/A- use a $150–$250 **debit spread** or 1 contract OTM_1 that fits, or raise B+ to ≥$250. Reconcile watcher MAX_DEBIT 650 vs desk envelope 550 | ATM premium exceeds the cap by construction |
| P0 | Pin one rules hash per session (verified 42224ca008a64275 now) | 16 parity fails from 4 hash changes |
| P1 | Add an **AMD-specific sweep**: session-level pools (Asia 20–00 ET, London 02–05, ON, PDH/PDL, 8:30 candle H/L, EQH ±0.1 ATR) with close back inside within 1–3 bars. Promote kzblock items 1–2 out of shadow **together** across all 4 components. Add a guard: **never enter in the direction of an unresolved sweep** (the 8:30 CT MNQ short) | detectSweeps only sees fractal swings |
| P1 | Unify the Asia definition (day-context, sessions.ts, TA) and add CBDR (14:00–20:00 ET) as a reference, shadow first | 3 definitions; CBDR missing |
| P1 | Seed `band_truth` persistence at the open (count the first poll; 6 s is 2–3 polls) | "held None" fails at signal birth |
| P1 | Log `qRaw` and the capping reason with every clamped q | 0.5999 is opaque |
| P2 | Keep Judas soft (JUDAS_BLOCKS=false); when the 1m tape is missing, warn but do not fail | Fail-closed at the open |
| P2 | Do not promote earlyBonus on n=14 (CI 21–67%); collect ≥30 NY-AM early samples | Small sample |

**CPI tomorrow:**
- The print at **7:30 CT** sets the 8:30-candle reference an hour before the cash open. Expect the manipulation to complete roughly 8:30–8:45 CT and distribution to run roughly 8:45–10:00 CT.
- News gates: desk-rules `newsGate` (item 21, 15 min) is **shadow**, and `news` passed 1333/1333, so confirm a ±15 min CPI blackout is actually enforced at 7:15–7:45 CT.
- Premiums will be inflated, which tightens the size-cap blocker.

## Open questions
1. Was the `gateHand` model-hold fix live during the logged rows? Need a deploy timestamp vs 12:50 CT.
2. Which cap lowered the 596 rows to B? `qRaw` is not in gates.log; cards.log `card` objects should be checked.
3. Do we have morning gates.log or cards.log for prior days (Sep 16–Oct 12)? Only Oct 13 PM exists locally.
4. Is the CPI news blackout live or shadow in the watcher for 7:30 CT?
5. What did ES/NQ actually do after the 8:53 CT A+ ES long (stop 7838.75)? The outcome cannot be judged from the SPY proxy.
6. Should B+ fire at all on CPI day given the $150 cap vs ATM premium?
