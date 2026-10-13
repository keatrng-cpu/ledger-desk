# PM Intraday Research Pack — Tue Oct 13, 2026 (QQQ/SPY options sleeve)
**Window:** 1:06 PM → ~4:06 PM CT. RTH cash close is 3:00 PM CT. All times are CT (America/Chicago, UTC−5).
**Rules:** research only. Not a trade recommendation and not an order instruction. Trading Stand owns all trades. Robinhood was read for **market data only** (quotes, historicals, option chains and quotes). No account, position, or order data was read.
**Data stamp:** Equity quotes at ~1:07 PM CT, option quotes at ~1:08 PM CT, 5m bars through the 12:55–1:00 PM CT bar (Robinhood `get_equity_quotes`, `get_equity_historicals`, `get_option_instruments`, `get_option_quotes`).

---

## 1. Session so far: levels as SMC liquidity references

### SPY
| Ref | Level | Source / method |
|---|---|---|
| Last (~1:07 PM CT) | **778.05** (bid 778.02 / ask 778.04) | RH quote |
| Prior close (Oct 12, official) | 778.10 | RH quote `close` |
| **PDH / PDL** (Oct 12 RTH) | **779.397 / 777.05** | RH daily bars |
| Today open (RTH) | 777.34 | RH 5m |
| **Session high** | **778.75** (8:40 CT bar) | RH 5m RTH |
| **Session low** | **775.95** (10:35 CT bar) | RH 5m RTH |
| 30-min opening range (8:30–9:00 CT) | 778.75 / 777.17 | RH 5m |
| Extended-hours range (Oct 12 post-market + Oct 13 pre-market, 30m bars) | 778.82 / 776.55 | RH `bounds=extended` |
| Recent swing high / low (daily) | 781.62 (Oct 6 H) / 770.435 (Oct 8 L) | RH daily |
| Equal highs (morning) | 777.87 (9:25) / 777.86 (9:40). Price has since traded above them (taken). | 5m fractal swings |
| Morning swings (5m, 2-bar fractal) | SH 778.75 (8:40), 777.87 (9:25), 777.96 (11:40), 777.60 (12:40) · SL 777.19 (9:05), 775.95 (10:35), 776.91 (12:25), 776.57 (12:50) | computed |

**SMC read (descriptive):** SPY's low of 775.95 ran **below PDL 777.05** (a sell-side sweep) and price is back above PDL. The PDH buy-side at 779.40 and the Oct 6 high at 781.62 are untouched. These are reference levels, not a bias call.

### QQQ
| Ref | Level | Source / method |
|---|---|---|
| Last (~1:07 PM CT) | **743.28** (bid 743.29 / ask 743.32) | RH quote |
| Prior close (Oct 12, official) | 746.04 | RH quote |
| **PDH / PDL** | **749.79 / 744.845** | RH daily |
| Today open (RTH) | 739.53 (gap **below** PDL) | RH 5m |
| **Session high** | **744.20** (9:00 CT bar) | RH 5m |
| **Session low** | **738.84** (8:30 CT, opening bar) | RH 5m |
| 30-min opening range | 743.97 / 738.84 | RH 5m |
| Extended-hours range | 746.21 / 739.56 | RH extended |
| Recent swing high / low (daily) | 762.86 (Oct 6 H) / 743.23 (Oct 8 L) | RH daily |
| Relative equal highs | 744.20 (9:00) / 744.01 (11:30), still **untaken**. This buy-side cluster sits just under PDL 744.845. | 5m swings |
| Morning swings | SH 744.20, 743.64 (9:40), 742.47 (11:00), 744.01 (11:30), 742.62 (12:40) · SL 742.10 (9:35), 741.22 (9:55), 739.83 (10:35), 741.32 (12:30), 741.16 (12:50) | computed |

**SMC read (descriptive):** QQQ is trading inside a gap-down day and is still **below PDL 744.845**. The nearest untaken buy-side is the 744.0–744.85 band (relative EQH plus PDL), and the extended-hours high is 746.21. The sell-side reference is the 738.84 open low.

### Untested 5m FVGs (method stated)
**Method:** 5m RTH bars only. A bullish FVG at bar *i* means `low[i] > high[i-2]`; a bearish FVG means `high[i] < low[i-2]`. A gap counts as "untested" when **no later bar traded into it**, checked through the 12:55 CT bar. The timestamp shown is the middle candle. FVGs were not computed on 15m.

| Symbol | Type | Zone | Formed | Status note |
|---|---|---|---|---|
| SPY | bullish | 776.31–776.49 | ~10:50 CT | untested as of 1:00 CT |
| SPY | bearish | 777.165–777.43 | ~12:45 CT | live 778.05 is **above** it, so it was most likely traded through after 1:00. Verify on the chart. |
| QQQ | bullish | 740.60–741.01 | ~10:50 CT | untested as of 1:00 CT |
| QQQ | bearish | 742.09–742.26 | ~12:45 CT | live 743.28 is **above** it, so it was most likely traded through after 1:00. Verify on the chart. |

**NQ/ES:** futures data was not pulled because Robinhood's read-only tools here cover equities and options. At midday, MT Newswires had the S&P 500 at 7,805.1 (little changed) and the Nasdaq Composite at 27,225.2 (−0.1%) ([Bigdata/MT Newswires](https://app.bigdata.com/documents/7B22B61B53EB73611517E89A51786D03?cnum=1)).

---

## 2. Catalysts for the rest of today and tonight
Sources: Bigdata.com economic calendar (FXStreet feed) and corporate calendar (Quartr). UTC times were converted to CT.

| Time (CT) | Event | Notes |
|---|---|---|
| **1:00 PM** | Monthly Budget Statement (Sep) | Consensus −$29.0B, prior −$166.8B (FXStreet). Medium impact. |
| Done 10:30 AM | 3-mo / 6-mo bill auctions | 4.08% / 4.20% (FXStreet) |
| Done 9:00 AM | Existing Home Sales (Sep) | 3.99M vs 3.95M consensus (FXStreet) |
| Today (times not verified) | Fed speakers: Waller, Barkin, Collins | Named in the [AOL/Capital.com note](https://app.bigdata.com/documents/8039F13DAD90525F40D36B15C61B4C61?cnum=2). The calendar lists Waller and Goolsbee at UTC times that are **already past**. No verified post-1 PM CT speaker slot was found. |
| After-hours | No mega-cap or index-mover earnings found | Quartr lists only small caps tonight (EONR call 3:00 PM CT; WDAY Analyst Day 4:00 PM CT). |

**Today's drivers:**
- **Bank earnings:** WFC beat on EPS but missed on revenue/NII. JPM missed on securities losses. C and GS beat ([MT Newswires](https://app.bigdata.com/documents/7B22B61B53EB73611517E89A51786D03?cnum=1)). GS reported $17.01 EPS vs $13.08 consensus ([Benzinga](https://app.bigdata.com/documents/622AA69CEA71D8F3CD5AEEB11115B6AF?cnum=1)).
- **Chips:** tech is weak on reports that China's CXMT has advanced its proprietary chip ([AOL/Capital.com](https://app.bigdata.com/documents/8039F13DAD90525F40D36B15C61B4C61?cnum=2)).
- **Geopolitics and oil:** Middle East/Iran tension is keeping upward pressure on oil (same source).
- **Sectors:** healthcare is leading laggards and energy is leading gainers (MT Newswires). Communication services was +1.5% early (Benzinga).

---

## 3. Wed Oct 14: overnight risk on any hold
| Time (CT) | Event | Consensus / prior (FXStreet via Bigdata) |
|---|---|---|
| ~4:40 AM | Fed Bowman speech | — |
| 6:00 AM | MBA mortgage apps | prior −4.2% |
| **7:30 AM** | **CPI (Sep), tier-1** | Headline MoM **0.6%** (prior 0.4%), YoY **3.6%** (prior 3.4%). Core MoM **0.2%** (prior 0.3%), core YoY **2.5%** (prior 2.4%). The headline/core gap is as published by the feed and should be cross-checked. |
| ~9:55 AM | Fed Bowman speech | — |
| 1:00 PM | Fed Beige Book | — |
| Pre-market / AM calls | BLK (call 6:30), BAC (7:30), MS (8:30), FAST (9:00), STT (10:00) | Quartr call times. Releases are usually pre-market. |
| AM | Accenture Investor Day (7:30 CT) | Quartr |

**Implication (fact):** any position held past today's close carries CPI at 7:30 AM CT tomorrow. Next-expiry implied vol is well above 0DTE (see §4), which is consistent with an event premium.

---

## 4. Options context for a $1,000 account
Robinhood option quotes at ~1:08 PM CT. One contract = 100 shares.

| Contract | Bid / Ask | Mark | IV | Δ | Θ/day | Vol / OI | ≈ Cost for 1 contract at ask |
|---|---|---|---|---|---|---|---|
| SPY 778C 10/13 (0DTE) | 0.41 / 0.42 | 0.415 | 9.9% | 0.46 | −0.42 | 883k / 12.0k | $42 |
| SPY 778P 10/13 | 0.58 / 0.59 | 0.585 | 10.9% | −0.54 | −0.46 | 411k / 8.2k | $59 |
| SPY 780C 10/13 | 0.06 / 0.07 | 0.065 | 13.3% | 0.09 | −0.07 | 314k / 15.3k | $7 |
| SPY 776P 10/13 | 0.07 / 0.08 | 0.075 | 12.6% | −0.11 | −0.08 | 622k / 6.6k | $8 |
| SPY 778C 10/14 | 2.07 / 2.08 | 2.075 | 12.4% | 0.50 | −1.01 | 72k / 5.1k | $208 |
| SPY 778P 10/14 | 2.16 / 2.17 | 2.165 | 12.7% | −0.50 | −0.95 | 33k / 5.1k | $217 |
| SPY 780C 10/14 | 1.18 / 1.19 | 1.185 | 12.1% | 0.35 | −0.90 | 35k / 6.9k | $119 |
| SPY 776P 10/14 | 1.36 / 1.37 | 1.365 | 13.1% | −0.36 | −0.92 | 50k / 3.1k | $137 |
| QQQ 743C 10/13 (0DTE) | 0.65 / 0.66 | 0.655 | 16.0% | 0.47 | −0.66 | 499k / 568 | $66 |
| QQQ 743P 10/13 | 0.79 / 0.80 | 0.795 | 15.5% | −0.54 | −0.63 | 329k / 3.2k | $80 |
| QQQ 745C 10/13 | 0.18 / 0.19 | 0.185 | 19.1% | 0.16 | −0.19 | 239k / 3.2k | $19 |
| QQQ 741P 10/13 | 0.14 / 0.15 | 0.145 | 15.8% | −0.16 | −0.15 | 432k / 1.7k | $15 |
| QQQ 743C 10/14 | 3.36 / 3.37 | 3.365 | 21.1% | 0.50 | −1.61 | 24k / 119 | $337 |
| QQQ 743P 10/14 | 3.44 / 3.45 | 3.445 | 21.1% | −0.50 | −1.52 | 26k / 1.3k | $345 |
| QQQ 745C 10/14 | 2.42 / 2.43 | 2.425 | 20.8% | 0.40 | −1.53 | 23k / 862 | $243 |
| QQQ 741P 10/14 | 2.57 / 2.58 | 2.575 | 21.4% | −0.41 | −1.51 | 20k / 714 | $258 |

**Derived from the quotes above (my arithmetic, approximate):**
- **Implied moves from ATM straddles:**
  - 0DTE (rest of today): SPY ≈ $1.00 (≈0.13%), QQQ ≈ $1.45 (≈0.20%).
  - 10/14 expiry (includes CPI): SPY ≈ $4.24 (≈0.55%), QQQ ≈ $6.81 (≈0.92%).
- **Event premium:** 10/14 ATM IV is above 0DTE ATM IV (QQQ ≈21% vs ≈16%; SPY ≈12.5% vs ≈10–11%).
- **Liquidity:** every quoted strike is $0.01 wide, and 0DTE volume is in the hundreds of thousands.
- **Desk envelope:** `docs/RH_LIVE_ROUTINE.md` sets $150–$550 debit and 1–4 contracts. One 0DTE ATM contract ($42–$80) is **below the $150 floor**. One 10/14 ATM contract fits SPY ($208–$217) and QQQ ($337–$345).

**0DTE reality into the last 2 hours (cited):**
- **Theta:** 0DTE decay is non-linear and speeds up in the afternoon, with the sharpest drop around **3:30 PM ET = 2:30 PM CT** ([Option Alpha](https://optionalpha.com/blog/0dte-options-time-decay)). All time value must decay to zero by the close, and a 0.5–1% move can swing ATM delta by tens of points in minutes ([Numerix white paper](https://www.blog.numerix.com/sites/default/files/file/2026-01/Numerix_White_Paper_Gamma_Hedging_of_ODTE_Options.pdf)).
- **Market impact:** Cboe found **no increase** in last-hour SPX gap moves attributable to 0DTE ([Cboe](https://www.cboe.com/insights/posts/volatility-insights-evaluating-the-market-impact-of-spx-0-dte-options/)).
- **Robinhood cutoffs (from its help center):** same-day-expiring ETF options can be **opened until 3:30 PM ET = 2:30 PM CT**. Robinhood starts closing at-risk expiring positions at 3:30 PM ET, or **3:45 PM ET for late-close options** ([Options trading hours](https://robinhood.com/us/en/support/articles/options-trading-hours/)). It can act earlier depending on conditions ([Expiration, exercise, and assignment](https://robinhood.com/us/en/support/articles/expiration-exercise-and-assignment/)). The SPY and QQQ 10/13 contracts above show `sellout_datetime` **2:45 PM CT** (19:45 UTC) in Robinhood's instrument data.

**Buying power caveat (account not checked):**
- In a **cash account**, unsettled sale proceeds cannot fund trades until T+1 settlement ([Robinhood: Settlement and buying power](https://robinhood.com/us/en/support/articles/settlement-and-buying-power/)).
- Instant Deposit funds may be restricted for options until the deposit is available ([Instant Deposits and Options](https://robinhood.com/us/en/support/articles/instant-deposits-and-options/)).
- The Oct 6 desk note said Keaton planned to convert to margin. Whether that happened is **unverified** here.
- `RH_LIVE_ROUTINE.md` gates on live BP ≥ $150 on Agentic ••6158, not on the cash balance.

---

## 5. Bias evidence (no recommendation)
| Leans bullish | Source | Leans bearish | Source |
|---|---|---|---|
| SPY swept PDL 777.05 (low 775.95) and reclaimed it (last 778.05) | RH bars and quote | QQQ opened **below** PDL 744.845 and is still below it (−0.37% vs 746.04) | RH |
| QQQ recovered from 738.84 to ~743.3 (≈ +0.6% off the low) | RH | Chip weakness on China CXMT reports | AOL/Capital.com via Bigdata |
| GS and C beat; GS EPS $17.01 vs $13.08 consensus | MT Newswires, Benzinga | JPM missed on securities losses; WFC missed on revenue/NII | MT Newswires |
| Energy leading, communication services +1.5% early | MT Newswires, Benzinga | Healthcare leading laggards; Nasdaq Composite −0.1% midday | MT Newswires |
| Cboe: no evidence of disruptive last-hour 0DTE gamma moves | Cboe | Middle East/Iran risk keeping pressure on oil | AOL/Capital.com |
| — | — | CPI tomorrow: headline consensus 3.6% YoY vs 3.4% prior; 10/14 IV elevated | FXStreet via Bigdata; RH quotes |

---

## Open questions
1. Did the 12:45 bearish FVGs fill or invert after 1:00 CT? This needs a fresh 1m/5m pull.
2. What are the exact times of any Fed remarks after 1 PM CT (Barkin, Collins)? They were not verified.
3. Why is the CPI headline (3.6%) so far above core YoY (2.5%)? Cross-check against BLS or another calendar.
4. Has the account been converted to margin, and what is settled BP on Agentic ••6158? Not checked by rule.
5. NQ/ES levels were not pulled (no futures feed in these tools).

## Sources
- Robinhood market data: equity quotes, daily/5m/30m-extended historicals, option chains/instruments/quotes.
- Bigdata.com economic calendar (FXStreet), corporate calendar (Quartr), news search: MT Newswires, Benzinga, AOL/Capital.com.
- Cboe 0DTE insight; Option Alpha 0DTE decay; Numerix 0DTE gamma white paper.
- Robinhood Help: Options trading hours; Expiration, exercise, and assignment; Settlement and buying power; Instant Deposits and Options.
- Desk: `docs/RH_LIVE_ROUTINE.md` (envelope and BP gate).
