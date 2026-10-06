# SMC/ICT Taxonomy Deep Dive — ledger-desk / Trading Stand
**Date:** 2026-10-06  
**Audience:** Trading Stand (signal engine + routine) · Keaton desk  
**Repos:** `keatrng-cpu/ledger-desk` · `keatrng-cpu/Trading-Automation`  
**Rules:** every claim cited or flagged unverified · no trade/order instructions · no invented numbers · branch-only commit

---

## Table of contents
1. [Purpose and method](#1-purpose-and-method)
2. [Step 1 — Desk inventory](#2-step-1--desk-inventory)
3. [Market structure](#3-market-structure)
4. [Liquidity](#4-liquidity)
5. [PD arrays](#5-pd-arrays)
6. [Time and sessions](#6-time-and-sessions)
7. [Confluences](#7-confluences)
8. [Entry models and risk](#8-entry-models-and-risk)
9. [Niche and advanced terms](#9-niche-and-advanced-terms)
10. [Confluence-scoring framework](#10-confluence-scoring-framework)
11. [Step 3 — Measurable improvements](#11-step-3--measurable-improvements)
12. [Evidence map (academic vs ICT)](#12-evidence-map-academic-vs-ict)
13. [Open questions](#13-open-questions)
14. [Sources](#14-sources)
15. [Connectors used](#15-connectors-used)

---

## 1. Purpose and method

This brief is a **full SMC/ICT taxonomy** grounded first in what the desk already encodes, then deepened with precise testable definitions, session/calendar filters, instruments, microstructure rationale, and evidence status.

**Evidence labels (used on every term):**
- **Supported** — peer-reviewed or high-quality empirical work backs the *underlying mechanism* (not the ICT brand name).
- **Plausible but untested** — coherent microstructure story; no desk-grade backtest or peer review for the *named rule*.
- **Unsupported** — ICT/SMC claim without credible verification; treat as hypothesis only.
- **Unverified (flagged)** — term appears in secondary glossaries or repo slang; primary ICT definition not confirmed here → do not invent.

**Primary desk sources (read-only):**
- `Trading-Automation/CLAUDE.md`, `aplus/strategy/{scanner,sessions,fvg,liquidity,order_blocks,structure,smt}.py`, `knowledge/confluence.json`
- `ledger-desk/src/lib/trading/{smc-canon,judas-window,profit-path,smc-master,strategy-grade}.ts`, `src/lib/aplus/confluence.ts`, `docs/RH_LIVE_ROUTINE.md`

**External glossaries (secondary; not peer-reviewed):** ICTKillzone.com concepts list (2026), Strefa Tradingu ICT glossary, FXNX ICT/SMC glossary, InnerCircleTrader.net tutorials, LuxAlgo NWOG/NDOG/EHPDA docs. Where sources disagree, variants are shown.

---

## 2. Step 1 — Desk inventory

### 2.1 Trading-Automation (`aplus`) — mechanical SMC engine

| Concept / stand | How the repo defines it | Path |
|---|---|---|
| A+ confluence floor 0.75 | Hard floor; config cannot lower | `CLAUDE.md` §3; `config.py` |
| HTF absolute gate | Weekly+Daily `top_down_bias`; neutral = aside | `strategy/htf.py` |
| Model sequence | HTF → killzone → significant sweep → displacement/MSS → retrace FVG/OB/propulsion/OTE → LTF confirm | `CLAUDE.md` §4 |
| Killzones | London 02:00–05:00; NY AM **08:30–11:00**; Silver Bullet AM 10:00–11:00; NY PM 13:30–16:00 ET | `strategy/sessions.py` `KILLZONES` |
| PO3 / Judas (DailyPO3) | Asia range accumulation; first wick beyond Asia H/L that closes back inside = manipulation; sweep high → BEAR bias, sweep low → BULL | `sessions.py` `DailyPO3` |
| FVG / iFVG | 3-candle gap; inversion on body close through; `sponsored` = displacement vol ≥ 1.3× lookback avg | `strategy/fvg.py` |
| Liquidity pools | BSL/SSL, EQH/EQL (tick tolerance), PDH/PDL, PWH/PWL + sweeps | `strategy/liquidity.py` |
| Order / breaker / mitigation / propulsion / rejection | Fresh-only retest; mitigated OBs do not score | `strategy/order_blocks.py`, `structure.py` |
| Scanner weights (19 components) | mechanical_model, structure, mid_bias, ifvg, smt, sweep_significant, … sponsored, breaker, mitigation, rejection, propulsion, daily_bias | `strategy/scanner.py` `_RAW_WEIGHTS` |
| Explicit gaps | OTE, BPR, void/vacuum, ICT macro windows **not implemented** | `CLAUDE.md` §8 scanner note |
| Confluence knowledge | NQ Jan 2026 window: 843 candidates, best 0.635 vs floor 0.75, **cleared 0**; cold: mechanical_model, OB, breaker, mitigation, propulsion | `knowledge/confluence.json` |

### 2.2 ledger-desk — PATH, Judas Window, canon, RH sleeve

| Concept / stand | How the repo defines it | Path |
|---|---|---|
| **PATH** | Strategy-complete + quality band A+/A/A−/B+ toward ≥0.70 WR · ~9 PATH/mo · min sample 100; incomplete patterns → C | `profit-path.ts`, `strategy-grade.ts` |
| Incomplete patterns | iFVG+structure without mechanical/MSS/displacement; iFVG without sweep/displacement | `profit-path.ts` `INCOMPLETE_PATTERNS` |
| **Judas Window** | 09:30–09:45 ET: blocked until 1m/2m/3m shows raid + **later** opposing displacement + close-back-inside; fail-closed without tape | `judas-window.ts` |
| SMC canon schools | ICT, SMC, TJR, Blake Mech/PDI, Patty, Ronan — sequences + honesty notes on unverified claims | `smc-canon.ts` `SCHOOLS` |
| Canon must-stack | HTF+DOL, sweep for side, PD half, LTF shift+disp, killzone; optional SMT, FVG/OB+OTE | `smc-canon.ts` `CONFLUENCE_STACK` |
| Liquidity / PD ranks | EQH/EQL densest; then PDH/PDL; PD array strength matrix | `smc-canon.ts` `LIQUIDITY_RANK`, `PD_ARRAY_RANK` |
| CE touch (RH path) | Live desk quote in smc-master plan zone (`inZone` and not `behind`) | `docs/RH_LIVE_ROUTINE.md`, `rh-floor-signals.ts` |
| RH live PATH fire | Grades A+/A/A− (≥0.65) or B+ (≥0.60 + seq TAKE + no veto); Floor + PATH + Stand triple agree | `RH_LIVE_ROUTINE.md` |
| Floor mandate | After 10:00 ET A+ only; no new entries ≥11:00 ET; DTE 0\|1; tape ≤30s | `mandate.ts` / RH routine |

### 2.3 Inventory gaps (repo knowledge holes)
- No journaled expectancy by stand with CIs; PATH min sample (100) not yet filled in the cited confluence snapshot.
- Detectors cold for OB/breaker/mitigation/propulsion (0% fire in knowledge window) — detection gap vs true scarcity unknown.
- OTE/BPR/void/macros missing in Trading-Automation scanner; ledger-desk has fib/OTE path but needs walk-forward proof.
- Niche terms (CBDR, IPDA lookbacks, EHPDA, LRLR/HRLR, vacuum, IOFED, etc.) appear in canon prose / glossaries more than as coded detectors.

---

## 3. Market structure

*Format for each term: **HOW** · **WHEN** · **WHERE** · **WHY** · **Desk use** · **Testable rule** · **Evidence***

### 3.1 Swing high / swing low (STH/STL, ITH/ITL, LTH/LTL)
- **HOW:** Local extremum: e.g. swing high = bar high with N lower highs on each side (desk typically fractal N≥1 on LTF; ICT hierarchy promotes STH→ITH→LTH by flanking). Variants: 3-candle fractal vs multi-bar. (ICTKillzone swing hierarchy; desk `structure.py`.)
- **WHEN:** Continuous; classify on closed bars only (no forming HTF candle — Trading-Automation defect #1 fix).
- **WHERE:** NQ/ES (and QQQ/SPY sleeve as cash proxy); HTF for bias, LTF for entry swings.
- **WHY:** Discrete structure for breaks; retail stops cluster beyond recent swings (related to Osler stop clustering at round/salient levels — *Journal of Finance* 2003).
- **Desk:** `strategy/structure.py`; canon TOP_DOWN.
- **Testable:** On closed bars, label swings with fixed N; measure forward return after first break of swing in/against trend.
- **Evidence:** **Plausible but untested** as ICT hierarchy; swing breaks as continuation/reversal filters are standard TA, mixed out-of-sample.

### 3.2 BOS (Break of Structure)
- **HOW:** Break of swing in *trend direction* (bull: new HH through prior swing high; bear: new LL). Body-close preferred in ICT; wick-only = weaker. (ICTKillzone; smc-canon.)
- **WHEN:** After impulse; not during news blackout if desk calendar gates.
- **WHERE:** Dealing-range internal swings (continuation).
- **WHY:** Confirms auction acceptance beyond prior extreme.
- **Desk:** `StructureEvent`; scanner `structure` weight.
- **Testable:** `BOS := close beyond swing with ATR-normalized range ≥ k`; event study ±R.
- **Evidence:** **Plausible but untested** for ICT naming; trend continuation after breaks is classical, sample-dependent.

### 3.3 CHoCH (Change of Character)
- **HOW:** Break of *opposing* structure (bull trend: break of HL; bear: break of LH). Warning, not entry alone. (SMC dialect; ICT often CISD/MSS instead.)
- **WHEN:** After liquidity sweep preferred.
- **WHERE:** ITH/ITL level carries more weight than STH/STL (glossary claim).
- **WHY:** First evidence of failed continuation.
- **Desk:** Structure events; SMC school sequence in `smc-canon.ts`.
- **Testable:** CHoCH without displacement vs with — compare false-positive rate.
- **Evidence:** **Unsupported** as standalone edge; **plausible** as filter.

### 3.4 MSS (Market Structure Shift)
- **HOW (ICT-strict):** Liquidity sweep → displacement (large body, leaves FVG) → break of opposing swing. Entry at resulting FVG. Without sweep = CHoCH only. (ICTKillzone MSS; CLAUDE.md §4.)
- **WHEN:** Killzones; after significant pool sweep.
- **WHERE:** Against the swept side (SSL sweep → bullish MSS).
- **WHY:** Labels the “real” move after stop run.
- **Desk:** `ev.is_mss`; scanner weight `mss`; PATH incomplete without mss/displacement/mechanical.
- **Testable:** Require sweep within M bars + displacement ratio ≥ r×ATR + structure break; measure expectancy vs CHoCH-only.
- **Evidence:** **Plausible but untested** as packaged rule; stop-run + reversal has microstructure analogues (Osler cascades).

### 3.5 Internal vs external structure / IRL vs ERL
- **HOW:** Internal = swings/arrays *inside* dealing range; external = range extremes / prior major H/L. IRL = internal liquidity (FVGs/OBs inside); ERL = external draw. (smc-canon CANON_RULES; ICTKillzone.)
- **WHEN:** Always frame DOL before session.
- **WHERE:** Partials at IRL; runners at ERL.
- **WHY:** Separates scale of objectives.
- **Desk:** Canon rules; PATH targets “next liquidity.”
- **Testable:** Tag TP1=IRL vs TP2=ERL hit rates and MAE.
- **Evidence:** **Plausible but untested** naming; multi-horizon targeting is standard risk practice (**supported** as process, not as ICT edge).

### 3.6 Displacement
- **HOW:** Energetic one-way candle(s): large body/range vs ATR (desk `is_displacement`); often leaves FVG. ICT glossaries cite body ≥~65% of range — treat as one parameterization, not sacred.
- **WHEN:** Confirming MSS / mechanical model.
- **WHERE:** Post-sweep.
- **WHY:** Proxy for aggressive aggressive flow / thin opposing liquidity.
- **Desk:** `structure.is_displacement`; weight `displacement`; mechanical_model requires displace on invert bar.
- **Testable:** Define ratio ≥ r; calibration sweep on r ∈ [1.2, 2.5].
- **Evidence:** **Plausible**; large-range bars predict short-horizon continuation in some HF literature, but **not** validated for this ICT threshold.

### 3.7 CISD (Change in State of Delivery)
- **HOW:** Body close beyond short-term H/L after sweep — mechanical “delivery state” flip; often used like early CHoCH. (ICTKillzone; scanner `detect_cisd`.)
- **WHEN:** Immediately post-sweep.
- **WHERE:** LTF entry charts.
- **WHY:** Earlier trigger than full MSS; higher false starts (glossary).
- **Desk:** weight `cisd`.
- **Testable:** CISD-only vs MSS entries — precision/recall and expectancy.
- **Evidence:** **Unsupported** as named edge; early structure breaks are noisy.

---

## 4. Liquidity

### 4.1 Buy-side / sell-side liquidity (BSL / SSL)
- **HOW:** BSL = resting buys/stops above highs; SSL = sells/stops below lows. Sweep BSL arms shorts; SSL arms longs (desk polarity).
- **WHEN:** Session opens / Judas / macros.
- **WHERE:** Above EQH/PDH/session H; below EQL/PDL/session L.
- **WHY:** Stops are convex flow once triggered (Osler 2002/2003 cascades).
- **Desk:** `liquidity.py`; canon sweepForSide.
- **Testable:** Time-to-reversal and displacement rate after first touch beyond pool ± tol.
- **Evidence:** **Supported** mechanism (stop clustering/cascades in FX — Osler); ICT *labels* **plausible**.

### 4.2 Equal highs / lows (EQH / EQL) and relative equal
- **HOW:** ≥2 swings within tolerance (desk: **ticks**, not absolute points — defect #5 fix; e.g. `eq_tol_ticks=4`). “Relative equal” = visually similar but not tick-equal — **flag:** definitions vary; prefer tick rule.
- **WHEN:** Prefers pre-session marking.
- **WHERE:** Densest magnet per `LIQUIDITY_RANK`.
- **WHY:** Double tops/bottoms concentrate stops.
- **Desk:** EQH/EQL kinds = `sweep_significant`.
- **Testable:** Sweep frequency of EQ vs non-EQ swings matched on age/ATR.
- **Evidence:** **Plausible**; salience clustering related to Osler round numbers (**supported** analogue).

### 4.3 Trendline liquidity
- **HOW:** Stops along rising/falling trendline; raid of trendline = liquidity event. (TJR sequence in smc-canon lists trendline with HTF sweep.)
- **WHEN:** After multi-touch trendlines.
- **WHERE:** LTF/HTF trendlines into session.
- **WHY:** Crowded technical levels.
- **Desk:** Mentioned in TJR school sequence; **no dedicated detector found**.
- **Testable:** Fit trendline to ≥3 touches; event study on first decisive break + close-back.
- **Evidence:** **Plausible but untested** in repo; classical trendline literature mixed.

### 4.4 Session highs/lows · PDH/PDL · PWH/PWL · PMH/PML
- **HOW:** Confirmed prior period extremes (promote only after period rolls — SessionTracker no-look-ahead).
- **WHEN:** Always on desk map before open.
- **WHERE:** Futures ET day; weekly ISO week; calendar month.
- **WHY:** Widely watched → stop density.
- **Desk:** `sessions.SessionTracker`; `liquidity.session_extremes`; significant sweep kinds.
- **Testable:** Hit rate of PDH/PDL as first reversal vs continuation by session.
- **Evidence:** **Plausible**; prior-day H/L are standard reference levels; ORB literature uses related opens/ranges (Holmberg et al. 2013).

### 4.5 Inducement
- **HOW:** Minor liquidity engineered *before* true POI; early longs/shorts get stopped into deeper array. (ICTKillzone.)
- **WHEN:** Ahead of HTF FVG/OB.
- **WHERE:** Between price and true draw.
- **WHY:** Behavioral trap narrative.
- **Desk:** Narrative only; **not coded**.
- **Testable:** Define inducement = swing between price and HTF POI; measure premature-entry loss rate.
- **Evidence:** **Unsupported** as predictive label without definition lock.

### 4.6 Sweeps / raids / stop runs
- **HOW:** Wick beyond pool + close back inside (desk Judas/PO3 and sweep detectors). Raid = manipulation, **never entry** (CANON_RULES).
- **WHEN:** Killzones; Judas window release needs later displacement.
- **WHERE:** Significant pools only (not any wick).
- **WHY:** Stop triggering + inventory transfer.
- **Desk:** Core of scanner + Judas Window.
- **Testable:** `sweep := high>pool & close<pool` (bear raid); require pool kind ∈ significant; max age M bars.
- **Evidence:** **Supported** mechanism (Osler); ICT timing claims **plausible but untested**.

### 4.7 Liquidity voids
- **HOW:** Large one-way run with little two-way trade — “oversized FVG.” Price may revisit. Distinct from 3-candle FVG by *scale*. (ICTKillzone.)
- **WHEN:** News spikes common.
- **WHERE:** Between impulse extremes.
- **WHY:** Inefficiency / thin book narrative.
- **Desk:** Explicitly **not implemented** (scanner gaps).
- **Testable:** Define void as consecutive bars with body/ATR ≥ r and opposing volume below q-quantile; measure revisit probability.
- **Evidence:** **Plausible** (gap fill literature exists in equities); ICT void rules **untested**.

### 4.8 Low-resistance vs high-resistance liquidity runs (LRLR / HRLR)
- **HOW:** LRLR = path to DOL with few fresh opposing arrays (fast); HRLR = path dense with unmitigated OBs/FVGs (choppy). (ICTKillzone.)
- **WHEN:** After bias+DOL set — choose speed expectations.
- **WHERE:** Between entry and ERL.
- **WHY:** Microstructure congestion.
- **Desk:** TJR “low-resistance draw” language in canon; **no LRLR detector**.
- **Testable:** Count unmitigated opposing PD arrays on path; correlate with time-to-target and MAE.
- **Evidence:** **Plausible but untested**.

### 4.9 Run on stops vs run on liquidity
- **HOW (glossary distinction):** “Run on stops” emphasizes clearing resting stops; “run on liquidity” emphasizes seeking pool to fill institutional size. Operationally often the same wick event. Prefer one coded definition (sweep) to avoid synonym inflation.
- **Evidence:** **Unverified** as distinct predictive regimes — flag.

---

## 5. PD arrays

### 5.1 Order blocks (bullish / bearish)
- **HOW:** Last opposing candle before displacement (bull OB = last down candle before up impulse). Entry often at mean threshold (50% of **body**). Mitigated if body closes through. (ICTKillzone; `order_blocks.py`.)
- **WHEN:** Post-sweep, correct premium/discount.
- **WHERE:** Discount for longs / premium for shorts.
- **WHY:** Alleged institutional footprint — **narrative**.
- **Desk:** Fresh-only retest; cold component (0% in knowledge window).
- **Testable:** Label OB; require unmitigated; entry on first touch of body mid; stop beyond OB extreme.
- **Evidence:** **Unsupported** as unique edge; last-candle-before-impulse is discretionary TA.

### 5.2 Breaker blocks
- **HOW:** Failed OB that flips polarity after body close through; trade first retest as opposite. (ICTKillzone; desk breakers.)
- **Desk:** weight `breaker`; cold/0% fire in snapshot.
- **Evidence:** **Unsupported** without locked definition + sample.

### 5.3 Mitigation blocks
- **HOW:** Return to OB to *exit* losing inventory rather than continue — hard to distinguish ex ante. Desk implements a “defensible reading, not verified transcript” (`CLAUDE.md` §8).
- **Evidence:** **Unsupported** / **flagged** definitional ambiguity.

### 5.4 Rejection blocks
- **HOW:** Extended wick rejection as array (wick structure vs body OB). Desk `detect_rejection_block`.
- **Evidence:** **Plausible but untested**.

### 5.5 Propulsion blocks
- **HOW:** Accelerating same-direction sequence used as re-entry zone. Desk propulsions; cold (1.4% fire).
- **Evidence:** **Unsupported** branding; momentum continuation **plausible**.

### 5.6 FVG / imbalance · BISI / SIBI
- **HOW:** 3-candle: bull FVG if `low[i] > high[i-2]` (gap `[high[i-2], low[i]]`); bear mirror. BISI = bullish imbalance; SIBI = bearish. (`fvg.py`; ICTKillzone.)
- **WHEN:** After displacement; killzone.
- **WHERE:** CE (50%) common entry; IOFED = near edge (niche).
- **Desk:** Core entry zone; `ifvg` hottest component (100% fire — low information alone).
- **Testable:** Fill-to-CE vs full-fill frequencies by TF; reaction forward returns.
- **Evidence:** **Plausible** (imbalance/gap revisit); ICT fill-rate claims in blogs **not peer-reviewed** — treat numerical blog claims as **unverified**.

### 5.7 Inverse FVG (iFVG)
- **HOW:** Body close through FVG flips effective direction; trade retest. Desk keeps original `direction` immutable; `effective_direction` derived (defect #6).
- **Desk:** Mechanical model: sweep → displace → invert → retest.
- **Evidence:** **Plausible but untested** as edge; polarity flip after failure is coherent.

### 5.8 Volume imbalance
- **HOW:** Variants: (a) ICT “implied FVG” when wicks overlap but midpoints leave zone; (b) volume-based sponsorship (desk). Do not conflate.
- **Desk:** `sponsored` uses volume mult 1.3×20-bar — **desk operationalization**, not proven ICT transcript.
- **Evidence:** Desk rule **testable**; ICT “implied FVG” **plausible but untested**.

### 5.9 Opening gaps — NWOG / NDOG
- **HOW:** NDOG = 17:00–18:00 ET futures pause gap (Mon–Thu); NWOG = Fri close → Sun open. Mark edges + CE. (InnerCircleTrader.net; LuxAlgo.)
- **WHEN:** Standing multi-day references.
- **WHERE:** Index futures / FX per source; desk instruments NQ/ES.
- **Desk:** Not a first-class detector in scanner gaps list; session opens tracked separately.
- **Testable:** Distance-to-gap vs reaction within T sessions.
- **Evidence:** Gap-fill literature mixed (**plausible**); ICT multi-day magnet claims **untested**.

### 5.10 Consequent encroachment (CE)
- **HOW:** 50% of FVG/void/rejection **wick range** (high–low of zone). Distinct from mean threshold. (FXNX; Strefa; ICTKillzone.) Applied to FVG, wicks, sometimes OBs (variant — prefer: CE for gaps/wicks, MT for OB bodies).
- **Desk:** RH “CE touch” = price in plan zone; canon entry “FVG at CE (50%).”
- **Testable:** Touch CE vs open of FVG vs full fill — hit rate of continuation.
- **Evidence:** Midpoint attraction **plausible**; sacred 50% **untested**.

### 5.11 Mean threshold (MT)
- **HOW:** 50% of OB/breaker **body** (open–close); body close beyond MT often = invalidation in glossaries.
- **Evidence:** **Plausible but untested**.

### 5.12 Premium / discount / equilibrium
- **HOW:** Dealing range H–L; EQ = 50%; above = premium (shorts preferred if bearish bias); below = discount. Desk `DealingRange.favors`.
- **Evidence:** Range-relative positioning is standard; edge from ICT PD filter alone **untested**.

### 5.13 OTE (Optimal Trade Entry)
- **HOW:** Fib retracement 61.8–79% of impulse (70.5 “sweet spot”). Anchor sweep extreme → displacement extreme. (ICT; smc-canon; Trading-Automation notes OTE **not in scanner** yet; ledger-desk fib path exists.)
- **Evidence:** Fib levels **unsupported** as universal; may proxy deep value area — **plausible filter**.

---

## 6. Time and sessions

### 6.1 Asia / London / NY killzones
- **HOW (desk coded):** London 02–05; NY AM **08:30–11:00** (futures data anchor); NY PM 13:30–16:00 ET. Broad session_name: Asia hour<2 or ≥18; London 2–8; NY 8–16.
- **Variants:** ICTKillzone lists NY Open 07:00–09:00 and London Close 10:00–12:00 — **differs from desk**. Desk documents ICT variance in `smc-canon.ts` comments.
- **Evidence:** Intraday U-shape volatility (**supported** — Andersen/Bollerslev intradaily periodicity); ICT window *edges* **plausible but untested**.

### 6.2 Silver Bullet windows
- **HOW:** Timed 1-hour models: commonly 03–04, 10–11, 14–15 ET (canon / ICT 2023 cite in smc-canon). Desk codes Silver Bullet AM 10–11.
- **Evidence:** **Unsupported** as uniquely edged hours without desk backtest; overlaps high-volume NY morning (**plausible**).

### 6.3 Macros
- **HOW:** Clock pivots (e.g. 08:50, 09:50, 10:50…) alleged algo windows. **Not implemented** in Trading-Automation scanner.
- **Evidence:** **Unsupported** without tick-rule study; some times coincide with economic releases (**supported** news effects — Andersen et al.).

### 6.4 Judas swing
- **HOW:** Manipulation leg of PO3 — false break of Asia/session pool then reverse. Desk DailyPO3 + Judas Window 09:30–09:45 release logic.
- **Stop hunt vs Judas:** Stop hunt = generic sweep; Judas = *timed* false move at session open / London / cash open in AMD narrative.
- **Evidence:** Open reversal / false break patterns **plausible**; named Judas **untested** academically.

### 6.5 Power of Three / AMD
- **HOW:** Accumulate → Manipulate → Distribute. Desk DailyPO3 implements Asia accum + first confirmed sweep.
- **Evidence:** Narrative frame **plausible**; not a falsifiable edge alone.

### 6.6 Midnight open / true day open / NY 08:30 open
- **HOW:** Desk tracks `day_open` (first bar of day) and `ny_open` (≥08:30). ICT “true day open” often 00:00 ET — **variant**.
- **Evidence:** Opening reference prices matter for ORB (**supported** literature); which clock is “true” is convention.

### 6.7 Weekly profiles / TGIF
- **HOW:** Templates for which weekday prints weekly H/L; TGIF profit-taking fade. (ICTKillzone.)
- **Desk:** weekly_pd_bias from prior week EQ.
- **Evidence:** Calendar seasonality exists in markets broadly (**supported** at coarse scale); ICT weekday templates **untested** here.

### 6.8 London close
- **HOW:** ~10:00–12:00 ET book-squaring window; reversal or continuation pullback. (ICTKillzone.)
- **Desk:** Not a separate coded killzone (NY AM ends 11:00).
- **Evidence:** **Plausible** session overlap effects; **untested** as ICT rule.

---

## 7. Confluences

### 7.1 HTF bias → LTF entry
- **HOW:** Weekly+Daily gate absolute (Trading-Automation rule 2); LTF only for trigger. Exception: `htfDisrespected` release in ledger-desk canon.
- **Evidence:** Trend filter reduces trades — common quant practice (**plausible**); ICT narrative stack **untested** as optimal.

### 7.2 SMT divergence
- **HOW:** Correlated pair disagreement (e.g. NQ vs ES new extreme). Desk `strategy/smt.py`; optional canon factor.
- **Evidence:** Relative strength / lead-lag **plausible**; ICT SMT package **untested**.

### 7.3 Draw on liquidity (DOL)
- **HOW:** Pre-chosen BSL/SSL target aligning bias. Canon must.
- **Evidence:** Target discipline **supported** as risk process; magnet claims **plausible**.

### 7.4 Narrative / calendar filters
- **HOW:** News blackout hard gate; CAUTION allowed. Red-folder days override patterns (glossary). Seek-and-destroy Fridays (NFP-style both-sides sweeps).
- **Evidence:** Announcement volatility jumps **supported** (Andersen/Bollerslev/Diebold/Vega lines of work); ICT seek-and-destroy label **plausible**.

### 7.5 PATH as desk confluence product
- **HOW:** Not an ICT term — desk construct: strategy-complete template × fit band × gates (HTF, conditions, killzone) → actionable PATH fire.
- **Evidence:** Process design; profitability pending sample (knowledge cleared 0 at 0.75 floor).

---

## 8. Entry models and risk

### 8.1 Desk mechanical skeleton (shared)
1. HTF bias + DOL  
2. Significant sweep (setup, not entry)  
3. Displacement + MSS/CISD  
4. Retrace FVG CE / iFVG / OB / OTE  
5. Stop beyond sweep + buffer (never round-number fixed ticks alone)  
6. TP1 ~1R / IRL; TP2 next pool clamped 1:1–1:3  

### 8.2 Named entry styles
| Model | HOW (short) | Desk |
|---|---|---|
| FVG CE entry | Limit/confirm at 50% gap | Canon + RH CE touch |
| IOFED | Earliest tap of FVG edge | Glossary; **not coded** |
| OB mean threshold | 50% body | Partial |
| Turtle soup | Fade false break of EQH/EQL / 20-day extreme (classic → ICT rename) | Narrative; sweep fade |
| Unicorn | MSS + FVG + OB overlap | Glossaries; PATH multi-component |
| Silver Bullet | Timed FVG after sweep in SB hour | Session key |
| Blake Mech / PDI | Sweep + IFVG body close | School canon |
| Judas fade | Post-raid displacement opposite | `judas-window.ts` |

### 8.3 Risk (desk)
- Trading-Automation: 0.5% risk (1% cap); 1 setup/session; 2% daily / 5% weekly halt.
- RH options sleeve: $150–$550 debit, 1–4 ct (B+ = 1), ATM/OTM_1, BP gates — **process**, not SMC edge.
- PATH sizing bands by grade (A+ heavier than B+) in profit-path reasons.

**Evidence:** Fixed fractional risk **supported** as survival math; SMC stop placement rules **plausible**.

---

## 9. Niche and advanced terms

*Each: definition · chart read · data needed · testable rule · evidence · desk · variants/flags*

### 9.1 CE on FVGs, wicks, and order blocks
- See §5.10. **Chart:** horizontal at mid of zone. **Data:** zone high/low. **Rule:** `ce = 0.5*(top+bottom)`; reaction if wick trades through ce then closes in trade direction within N bars. **Evidence:** midpoint **plausible**. **Desk:** CE touch live. **Variant:** some apply CE to OB full range vs MT on body — keep separate.

### 9.2 Sponsored gaps / sponsored
- **Desk definition (coded):** FVG whose confirming candle volume ≥ 1.3× average of prior 20 bars (`fvg.is_sponsored`). Weight `sponsored`.
- **ICT glossaries searched:** do not consistently define “sponsored gap” as a formal ICT term; sponsorship here is **desk/PB-volume filter**.
- **Flag:** Do not equate desk `sponsored` with an official ICT trademarked concept without primary mentorship cite.
- **Testable:** Compare expectancy sponsored vs unsponsored FVGs same TF.
- **Evidence:** Volume confirmation **plausible**; ICT-official status **unverified**.

### 9.3 Mean threshold — see §5.11

### 9.4 Balanced price range (BPR)
- **Def:** Overlap of bullish and bearish FVGs; trade mid of overlap. (FXNX, ICTKillzone.)
- **Data:** two FVG intervals; intersection nonempty.
- **Rule:** `bpr = intersect(fvg_bull, fvg_bear)`; first revisit.
- **Desk:** **Not implemented** (explicit gap).
- **Evidence:** **Plausible but untested**.

### 9.5 Liquidity void vs FVG
- FVG = 3-candle microscopic imbalance; void = multi-bar macroscopic inefficiency. Same revisit intuition, different detectors.
- **Evidence:** distinction **plausible**; both **untested** as desk edge.

### 9.6 Vacuum block
- Glossary: extreme thin displacement / huge FVG-like void (often news). (ICTKillzone.)
- **Desk:** not coded.
- **Evidence:** **Unverified** precise rule; treat as void subtype.

### 9.7 Reclaimed order block
- OB broken then reclaimed (close back through) — behaves like breaker/reclaim. Definitions vary.
- **Flag:** pin one rule before testing.
- **Evidence:** **Unverified** unified definition.

### 9.8 Breakaway gap
- Classical TA gap starting a trend; ICT may treat as void/NDOG family. Mixed vocab.
- **Evidence:** classical gap studies exist (**supported** mixed results); ICT mapping **unverified**.

### 9.9 IOFED
- **Variants:** (A) InnerCircleTrader.net — earliest entry at FVG near-edge, pyramid CE then far edge; (B) ICTKillzone — “mechanical FVG entry model after sweep+CISD” (broader). **Show both.**
- **Data:** FVG bounds + entry ladder.
- **Evidence:** **Unsupported** edge claims; definition **unstable across sources**.

### 9.10 Turtle soup
- Fade false breakout beyond prior high/low (classic Linda Bradford Raschke/Connors name) / ICT equal-high raid fade.
- **Evidence:** False-break fades **plausible**; profitability regime-dependent (**ORB/false-break literature mixed**).

### 9.11 Stop hunt vs Judas — see §6.4

### 9.12 LRLR / HRLR — see §4.8

### 9.13 Dealing range & quadrants
- Dealing range = governing swing H–L; quadrants = 25/50/75% partitions (ORG/opening-range-gap materials also use Q1–Q4).
- **Desk:** premium/discount/EQ; quadrants not emphasized in code.
- **Evidence:** range geometry **plausible**.

### 9.14 IPDA data ranges (20 / 40 / 60-day)
- Rolling highs/lows over 20/40/60 **trading days** as nested liquidity targets; EQ of each range for bias. (ICTKillzone IPDA guide.)
- **Data:** daily OHLC lookbacks.
- **Rule:** mark HH/LL of last 20/40/60 sessions; event study on first touch.
- **Desk:** not coded as IPDA module (weekly/daily structure instead).
- **Evidence:** Lookback extrema as magnets **plausible**; “algorithm” ontology **unsupported**.

### 9.15 Time-based liquidity
- Liquidity said to “expire” or pool at session boundaries / macros. Vague without clock+price rule.
- **Flag:** **unverified** as operational detector — require explicit definition before coding.

### 9.16 First presented FVG
- First FVG after cash open (~09:30) claimed high-probability. (ICTKillzone.)
- **Testable:** tag first FVG after 09:30; measure.
- **Evidence:** **Unsupported** until tested; open volatility **supported**.

### 9.17 Event horizon (EHPDA) between NWOG/NDOG
- Midpoint between adjacent opening gaps; alleged funnel/barrier. (LuxAlgo EHPDA docs citing ICT framing.)
- **Data:** consecutive gap midpoints.
- **Evidence:** **Plausible but untested**; secondary source.

### 9.18 Seek-and-destroy days
- Both-sides liquidity cleanup, especially news Fridays. Wait for dual sweeps before entry (glossary).
- **Evidence:** news days both-tails volatility **supported**; named pattern **plausible**.

### 9.19 CBDR (Central Bank Dealers Range)
- **Variants on clock:** ICTKillzone CBDR pages disagree across summaries (one narrative 14:00–20:00 ET range for SD projections; another 02:00–07:00 as NY accum). **Flag conflict — do not code until primary timestamp locked.**
- SD projections of CBDR width as next-session H/L forecasts.
- **Evidence:** range projection techniques classical (**plausible**); CBDR brand **unverified** pending clock lock.

### 9.20 Asian range & flout
- Asian range H/L as Judas targets (desk implements). **Flout:** term appeared in steering list — **no stable definition verified** in sources fetched → **FLAG unverified, do not guess**.

### 9.21 Standard deviation projections
- Project ±1/2/4× reference range (CBDR/Asia) for targets. (ICTKillzone.)
- **Evidence:** volatility cones **plausible**; ICT multiples **untested**.

### 9.22 Algo / IPDA references
- ICT ontology: price delivered by “Interbank Price Delivery Algorithm.” Not an exchange-documented matching engine.
- **Evidence:** **Unsupported** as literal claim; useful only as metaphor for systematic liquidity seeking.

### 9.23 Other glossary terms (brief)
| Term | One-line | Status |
|---|---|---|
| Suspension block (2025) | Hover then resolve POI | Secondary glossary — **unverified** primary |
| Hidden OB | Non-candle algorithmic OB | **Unverified** |
| Venom model (2025) | Named session model | Secondary — treat as unverified package |
| RDRB | Redelivered rebalanced range | Secondary |
| Reaper IFVG | IFVG stacked with breaker | Secondary 2026 claim |
| CRT (candle range theory) | Prior candle H/L as AMD | Community adjacent |
| SMR / Terminus | Market Maker Model turns | Narrative |
| Bread & Butter | Daily AMD routine | Narrative |
| One Shot One Kill | Weekly single sniper | Narrative |
| ORG (opening range gap) | RTH settlement→09:30 gap | Testable; **plausible** |

---

## 10. Confluence-scoring framework

### 10.1 What the desk already scores
Normalized weights from `scanner.py` (raw → fraction of 91): mechanical_model & structure & mid_bias & ifvg (8 each); smt (6); sweep_significant, htf2, weekly_pd, OB, cisd, displacement, mss, opening_bias (4); pd, sponsored, breaker, mitigation, rejection, propulsion, daily_bias (3). Floor 0.75. PATH adds strategy-completeness veto.

**Empirical caution from `confluence.json`:** best score 0.635 < 0.75 over 843 candidates — floor held; hot components alone are traps; mechanical sequence rare.

### 10.2 Proposed measurable checklist (binary factors → logistic / ablation)

Must (fail-closed):
1. `htf_aligned` (or documented disrespect release)
2. `killzone_or_released_judas`
3. `sweep_significant_for_side`
4. `displacement_or_mss`
5. `poi_in_correct_pd_half`
6. `news != BLACKOUT`

Optional (score / ablation):
7. `smt` 8. `ote_overlap` 9. `ce_touch` 10. `sponsored` 11. `bpr` 12. `eq_pool` 13. `session_extreme_pool` 14. `silver_bullet_hour` 15. `lrlr_path` 16. `ipda_20d_align`

### 10.3 How to test which confluences add edge
- **Label:** each factor 0/1 at decision time (no look-ahead).
- **Primary metrics:** fee/slippage-adjusted expectancy in R; win rate with Wilson CI; MAE/MFE; Brier on “win” probability if model outputs probs (see pm-signal brief).
- **Ablation:** drop one optional factor at a time; require Δ expectancy CI excluding 0 on walk-forward folds.
- **Multiple testing:** pre-register factor list; control FDR or use holdout.
- **Minimum n:** PATH targets 100 graded path trades before trusting live size; per-stand buckets need ≥30 before ranking (prefer ≥50). Per confluence ablation, treat n<30 as **noise** (Trading-Automation CLAUDE.md §7).
- **Hot/cold handling:** do not up-weight hot components; fix cold detectors or prove scarcity offline before changing weights (`confluence.json` lessons).

### 10.4 Calendar interaction
Stratify metrics by: no-news / CAUTION / post-print 30m / NFP-Friday / FOMC. Expect variance states to dominate ORB-like edges (Holmberg/Lundström volatility-state ORB results).

---

## 11. Step 3 — Measurable improvements

1. **Lock definitions** in a `detectors.md` contract (tick tolerances, body-close vs wick, ET clocks) — CBDR/flout/IOFED especially.
2. **Implement missing detectors** only after contract: OTE, BPR, void/vacuum, macros, NDOG/NWOG+EHPDA, IPDA 20/40/60, LRLR count.
3. **Fix cold components:** offline review OB/breaker/mitigation/propulsion — bug vs rarity (knowledge lessons).
4. **Judas Window A/B:** compare blocked-always vs release-on-1m resolution — expectancy & false release rate.
5. **PATH journal schema:** stand id, factors[], session, event_day, MAE/MFE, R, fees — feed `buildProfitPath`.
6. **Walk-forward + Monte-Carlo median** (already doctrine in Trading-Automation); never optimize on cleared=0 month by lowering floor.
7. **Pre-session checklist (productivity):**
   - Weekly/Daily bias + DOL written
   - PDH/PDL/PWH/PWL/Asia H/L marked
   - NDOG/NWOG ladder if using gaps
   - Calendar blackout windows loaded (fail closed)
   - Killzone plan (NY AM default) + Judas release criteria
   - One instrument book
   - Risk budget & max setups
   - CE/OT levels for planned POIs only (no hunting)
8. **Do not** treat ICT “algo” ontology as empirically established.

---

## 12. Evidence map (academic vs ICT)

| Mechanism | Academic / credible | ICT packaging |
|---|---|---|
| Stop clustering at salient/round levels | Osler JF 2003; NY Fed SR 125; stop cascades note | EQH, PDH, raids, Judas |
| Intraday volatility U-shape / open–close | Andersen & Bollerslev intradaily periodicity | Killzones, opening range |
| Macro announcement jumps | Andersen, Bollerslev, Diebold, Vega (AER/JIE lines); volume-volatility around news (RESTUD 2018) | Red folder, seek-and-destroy, blackouts |
| Opening range breakout profitability state-dependent | Holmberg, Lönnbark, Lundström FRL 2013; Lundström volatility-state ORB | Opening range / first FVG / Judas open |
| Gap fill / inefficiency revisit | Mixed equity gap literature | FVG, void, NDOG/NWOG |
| Literal IPDA / sacred fibs / named hour magic | — | **Unsupported** as stated |

---

## 13. Open questions
1. Are OB/breaker/mitigation cold because detectors are blind or because A+ tape rarely reprints them on NQ 1m–15m?
2. Which CBDR clock does Keaton want locked for NQ/ES?
3. Should desk `sponsored` stay volume-based or be renamed to avoid ICT-term collision?
4. What is the intended definition of **flout** on this desk?
5. PATH live sample size toward 100 — current graded path n=?
6. Does Judas 09:30–09:45 release improve expectancy vs hard block on out-of-sample months?
7. SMT NQ–ES: lead/lag seconds vs bar-based — which resolution matches fills?
8. For QQQ/SPY options sleeve, which futures PD arrays transfer (NQ→QQQ basis risk)?

---

## 14. Sources

**Repo (primary):**  
Trading-Automation `CLAUDE.md`; `aplus/strategy/scanner.py`, `sessions.py`, `fvg.py`, `liquidity.py`, `order_blocks.py`, `structure.py`, `smt.py`; `knowledge/confluence.json`.  
ledger-desk `smc-canon.ts`, `judas-window.ts`, `profit-path.ts`, `src/lib/aplus/confluence.ts`, `docs/RH_LIVE_ROUTINE.md`.

**Glossaries / tutorials (secondary):**  
https://www.ictkillzone.com/ict-concepts · Asian Range / CBDR / IPDA pages on same site · https://strefatradingu.pl/en/blog/ict-glossary/ · https://fxnx.com/en/blog/ict-smc-glossary-80-trading-terms-defined/ · https://innercircletrader.net/tutorials/ict-institutional-order-flow-entry-drill/ · NDOG tutorial on innercircletrader.net · https://www.luxalgo.com/library/indicator/ict-nwog-ndog-ehpda/

**Academic / institutional:**  
Osler, C. (2003), *Journal of Finance* — currency stop/take-profit clustering; NY Fed Staff Report 125; Osler stop-loss cascades note.  
Holmberg, Lönnbark, Lundström (2013), *Finance Research Letters* — ORB.  
Lundström et al. — ORB across volatility states.  
Andersen, Bollerslev, Diebold, Vega — macro news / real-time price discovery; Andersen & Bollerslev intradaily volatility; Bollerslev et al. RESTUD 2018 volume-volatility around announcements.

---

## 15. Connectors used
- `user-GitHub-xai` (get_file_contents, repo trees via `gh api`)
- WebSearch / WebFetch (glossaries + academic discovery)
- Local write: `/workspace/research/2026-10-06-smc-deep-dive.md`
- Commit target: branch `research/2026-10-06-smc-deep-dive` only (not main)

---

*End of brief. No trade recommendations. Flagged unverified terms rather than inventing definitions.*
