/**
 * The canon — what the named educators actually say, attributed and graded.
 *
 * WHY A SEPARATE LAYER
 * The curriculum teaches what THIS DESK does, with every threshold imported
 * from the engine. That is the right thing to train on, but it is not the
 * same as what ICT, TJR or PB Trading teach, and a trader who cannot tell the
 * two apart will one day "correct" the desk toward a half-remembered video.
 * So the sources sit beside the rule, not inside it: each claim names who
 * said it, where, and how well that could be verified.
 *
 * STATUS IS THE POINT
 *   verified    — the source's own words were read (video, post, course page)
 *   paraphrase  — a faithful secondary write-up, or a consensus of students
 *   unverified  — widely repeated, could not be traced to the source
 *   contested   — the source says different things in different places
 *
 * A claim marked unverified is still worth showing, because the trader will
 * meet it in the wild — but it must never be shown as if it were the first
 * kind. Grading is done once, by research, and recorded here; it is not
 * re-derived at render time.
 *
 * EVIDENCE IS REQUIRED
 * Every block carries an `evidence` line stating what is validated and what
 * is asserted. The 2026-09-19 research pass found NO peer-reviewed test of
 * fair value gaps, order blocks or liquidity sweeps as the lineage defines
 * them; the two credible independent tests (StatOasis, daily bars, SPY
 * 1993–2026; MPM Markets, 1-minute-resolved ES/NQ 2019–2026, ~40,000 FVGs)
 * agree on a small real reaction at these levels that does not survive
 * execution costs as a mechanical entry, with 5–15m the worst timeframe.
 * What rests on real ground is narrower: stop-loss clustering and the
 * cascade through it (Osler 2003, 2005), intraday volume and volatility
 * concentrating at the open (Admati & Pfleiderer 1988; Heston, Korajczyk &
 * Sadka 2010), order-flow imbalance producing the displacement candle (Cont,
 * Kukanov & Stoikov 2014), and short-horizon reversal as the price of
 * liquidity provision (Nagel 2012). None of those establish that a sweep
 * reverses more often than it continues. That sentence belongs in the tab.
 *
 * Nothing in this file changes a gate.
 */

export type CanonSource = "ICT" | "TJR" | "PB" | "SMC" | "Evidence";
export type CanonStatus = "verified" | "paraphrase" | "unverified" | "contested";

export interface CanonClaim {
  who: CanonSource;
  /** The claim, as close to the source's own framing as the research allowed. */
  says: string;
  /** Where — a video/lesson title, a post, a course page. Short. */
  ref?: string;
  status: CanonStatus;
}

export interface CanonBlock {
  /** Module id this block attaches to. */
  moduleId: string;
  claims: CanonClaim[];
  /** Where the sources agree — one or two sentences. */
  consensus?: string;
  /** Where they disagree, and which side the desk takes and why. */
  conflict?: string;
  /**
   * What is actually validated versus asserted. This is the sentence most
   * courses leave out, so it is required on every block.
   */
  evidence: string;
}

/* Shared evidence sentences — the same finding cited from several modules
   must read identically, or the tab contradicts itself. */

const EV_NO_PEER_REVIEW =
  "No peer-reviewed test of FVGs, order blocks or sweeps as the lineage defines them exists (arXiv, SSRN, RePEc searched 2024–2026).";
const EV_TWO_TESTS =
  "Two credible independent tests agree: StatOasis (daily SPY 1993–2026, 648 backtests) found OB +0.12% five-day edge at t≈1.2 — not significant — and FVG t≈−0.08, with 0 of 648 variants beating buy-and-hold; MPM Markets (ES/NQ/GC/SI, ~40,000 FVGs, exits resolved on 1-minute bars) found a real ~5-point reaction above random levels at FVGs in 34 of 36 cells, but ~50% win rate and profit factor ≈1.0 once exits are priced at 1-minute resolution, with 5–15m the worst-performing timeframe.";
const EV_FILL_CLAIMS =
  "The 80–90% 'fill rate' figures that circulate are contradicted by every counted sample retrieved: 37–63% same-session or eventual fills (Edgeful YM 30m; Quant Trading Discoveries EUR/USD 1,247 setups, 63.7% never fill).";

export const CANON: CanonBlock[] = [
  {
    moduleId: "sequence",
    claims: [
      { who: "ICT", says: "Run on liquidity — buy stops or sell stops. If you're bearish you're looking for buy stops to be run, then a break in market structure lower; when it trades up into the fair value gap you can go short.", ref: "2022 Mentorship Ep 2, 43:17–44:02", status: "verified" },
      { who: "ICT", says: "If there is no fair value gap in here, guess what — you don't have a trade. You wait or go to another market.", ref: "2022 Mentorship Ep 6, 22:03", status: "verified" },
      { who: "ICT", says: "15-minute is the bellwether; drop down to five minute, then the one, two or three minute chart for the entry.", ref: "2022 Ep 5 00:07:15 / Ep 2 29:23", status: "verified" },
      { who: "ICT", says: "It will repeat in the future more times than it fails.", ref: "2022 Ep 41, 00:49:56 — no win rate ever stated", status: "verified" },
      { who: "SMC", says: "'BOS' and 'CHoCH' do not occur in any ICT transcript retrieved; they are community/indicator terms. His words are 'market structure shift' and 'break in market structure'.", ref: "2022 Ep 2 28:05, Ep 3 02:23, Ep 12 31:23", status: "verified" },
      { who: "TJR", says: "If a setup isn't obvious, skip it. Every step of his model requires a discretionary judgment call — it is not mechanical, whatever it is called downstream.", ref: "jointjrtrades.com philosophy page; Snappchart bootcamp breakdown", status: "paraphrase" },
      { who: "TJR", says: "5-minute is CONTEXT — BOS/CHoCH, IFVG, SMT as a filter — and the 1-minute is the TRIGGER: an inverse FVG, a break of structure, or a '79% extension closure'. A five-minute retrace must occur after confirming a one-minute break.", ref: "Two independent student docs of the course; his 2026 'Updated Day Trading Strategy' (transcript summary)", status: "paraphrase" },
      { who: "PB", says: "Blake's Mech Model: HTF bias and draw → price at a key level (HTF PD array, FVG, CISD, PDH/PDL, session pool) → swing low, swing high, then a LOWER LOW that sweeps liquidity → an inversion on the highest timeframe inside the manipulation leg, confirmed by a body close through the gap → T1 at 1:1, stop to break-even → target an unfilled 5m or 15m FVG.", ref: "Leaked re-uploads of the paid Mech Model videos (transcript summaries); EZ$ PB Blake indicator", status: "paraphrase" },
      { who: "PB", says: "PB checklist, ten items: inside/rejecting an HTF PD array? swept prominent HTF liquidity? time aligned? high-impact news? session objective already met? risk accepted? equal highs/lows where your stop would sit? a liquidity target or unfilled 5m/15m FVG? SMT aligning with bias? above/below equilibrium? — near-identical to this desk's gates.", ref: "PB TRADING CHECKLIST (student upload)", status: "paraphrase" },
    ],
    consensus:
      "Every educator in the lineage orders the read the same way — a draw, a sweep of the opposite pool, a shift, an entry on the return — and every one of them treats the sweep and the displacement as visual. Nobody publishes a depth threshold for the sweep or a size threshold for the displacement; only tool-builders do (BuildAlpha: sweep depth ≥0.25×ATR14, FVG ≥0.35×ATR14; LuxAlgo: equal highs within 0.1×ATR).",
    conflict:
      "The one genuine methodological split is the shift itself: MSS (a swing high/low broken by a close — ICT, JadeCap, TJR, CutlerTrades) versus CISD (a body close through the OPEN of the opposing delivery leg, wicks ignored — TTrades, PB Blake, TradingFinder). The desk grades an MSS/displacement layer and lists CISD alongside it; it does not require both.",
    evidence: `${EV_NO_PEER_REVIEW} The sequence's two strongest layers map onto real microstructure — stop clustering and the cascade through it (Osler, NY Fed / JIMF 2005), and order-flow imbalance producing the displacement candle (Cont, Kukanov & Stoikov 2014). The retrace-entry layer has zero published support of its own. This desk's own month replay: 0 completed sequences on closed 15m bars.`,
  },
  {
    moduleId: "bias-structure",
    claims: [
      { who: "ICT", says: "A swing high is a high with a lower high to the left of it and a lower high to the right of it — a three-candle pattern. Swing low mirrored.", ref: "2016 Core Content Month 5, Defining Institutional Swing Points, 00:00:35", status: "verified" },
      { who: "ICT", says: "Use the daily chart to determine whether the next candle is likely bullish or bearish; where is price going to draw — an old high or an old low.", ref: "2022 Ep 7 Daily Bias, 00:42–00:49", status: "verified" },
      { who: "ICT", says: "In consolidation it can be very difficult to get a true reading on bias — rely on the smaller-timeframe charts and simply look for liquidity pools.", ref: "2022 Ep 7, 01:10", status: "verified" },
      { who: "ICT", says: "The bias can be reduced to just the session you are trading — it can be reduced down to that hour. Trading without a daily bias, I am never trading with my highest leverage.", ref: "2024 Mentorship L05 19:06; 2024-04-29 Day 1, 01:03:36", status: "verified" },
      { who: "SMC", says: "TTrades' closure rule: a close above the previous day high is bullish (target the next high); a wick below the previous day low with a close back inside is bullish; an inside bar inherits the prior day's bias. Two public implementations disagree on whether 'back inside' means the level or the prior day's body.", ref: "TTrades Daily Bias [TFO] 2024; joshuuu 2023 — TradingView", status: "contested" },
      { who: "SMC", says: "LuxAlgo codes structure as a CLOSE crossing the swing: swing length 50 for structure, 5 for internal.", ref: "Smart Money Concepts [LuxAlgo], open source, 2022", status: "verified" },
      { who: "TJR", says: "Daily bias is one of three profiles: prior-session consolidation → new-session manipulation then reversal; prior manipulation → new reversal; prior manipulation-and-reversal → continuation. Always wait for manipulation to occur before entering; never enter blindly at session opens.", ref: "TJR Daily Bias Guide (student notes); 'The ONLY Liquidity Sweeps Video'", status: "paraphrase" },
      { who: "TJR", says: "A third-party quant coded his daily-bias workflow: 71.4% state-transition accuracy over 227 E-mini sessions, 49.3% on the 'manipulation + reversal' subset. Not his numbers, n=227.", ref: "@deltatrendtrading, 2025-10-20", status: "paraphrase" },
      { who: "PB", says: "Blake reads bias from HTF fair value gaps being respected or disrespected — Daily, 4H, 1H, 15m.", ref: "Mech Model (leaked transcript summary)", status: "paraphrase" },
    ],
    consensus:
      "Swing-structure bias — higher highs with higher lows, lower highs with lower lows — is the community-SMC and LuxAlgo definition, coded as a CLOSE crossing the swing (swing length 50 for structure, 5 for internal, in LuxAlgo's open script).",
    conflict:
      "Four incompatible derivations of bias exist in the lineage: swing structure (LuxAlgo, TradingHub, this desk); previous-day closure rules (TTrades: close above PDH → bullish, wick below PDL then close back → bullish, inside bar inherits); HTF FVG direction (PB Ronan); and a time-open reference (ICT midnight open, Daye's 07:30 'True Open', Casper's 07:30). TTrades' closure rule is the only one scorable with no discretion and the only one with a stated invalidation (target reached → neutral).",
    evidence:
      "Structure-based bias has no published validation as a directional predictor. What is validated is that intraday returns show continuation at half-hour multiples of a day (Heston, Korajczyk & Sadka, JF 2010) and that the first half-hour's return predicts the last half-hour's on SPY (Gao, Han, Li & Zhou, JFE 2018) — both time effects, neither a structure rule.",
  },
  {
    moduleId: "bias-conflict",
    claims: [
      { who: "ICT", says: "You want the daily bias, and you want to be able to buy below the open and hold for the whole entire day.", ref: "2024 Mentorship L01, 00:59:44", status: "verified" },
      { who: "ICT", says: "I give myself permission to not have to worry about daily bias — you're going to trade without a bias — but never with my highest leverage.", ref: "2024-04-29 How To Read Price With Or Without A Bias, 01:02:26–01:03:36", status: "verified" },
      { who: "ICT", says: "SMT gives you a long-term perspective for bias; it is used to confirm trades but he does not necessarily need it.", ref: "2016 M3 00:19:31; 2024 L04 02:08:23", status: "paraphrase" },
      { who: "TJR", says: "ES/NQ alignment is critical; discrepancies indicate indecision.", ref: "2026 'Updated Day Trading Strategy' (transcript summary)", status: "paraphrase" },
      { who: "PB", says: "No counter-bias SMT: a divergence against the bias is a filter that removes the trade.", ref: "Mech Model filters (leaked transcript summary)", status: "paraphrase" },
    ],
    consensus:
      "Everyone reads the higher timeframe first. Nobody in the lineage publishes a rule for what to do when timeframes DISAGREE — the premium/discount override this desk applies to a split vote is its own construction.",
    conflict:
      "ICT resolves conflict narratively (the higher timeframe's draw governs); PB Ronan requires multi-timeframe agreement before an entry; TTrades sidesteps it by deriving bias from one timeframe's closure. The desk votes daily / mid / last-BOS and lets location overrule the vote, on the argument that the slowest timeframe is the most wrong at a turn.",
    evidence:
      "No published test of any timeframe-conflict rule. The override's premise — that a majority vote can point at the top of a distribution — is an assertion consistent with the short-horizon reversal literature (Nagel, RFS 2012: reversal returns are compensation for liquidity provision, largest in turmoil), not a tested rule.",
  },
  {
    moduleId: "bias-against",
    claims: [
      { who: "ICT", says: "Every day at 12am midnight New York time begins the true day. If I'm bullish, I expect the opening price to be near the low, it trades lower making an important low, then rallies and closes near the high.", ref: "2016 M8 Defining The Daily Range 00:05:29; 2022 Ep 9 00:03:13", status: "verified" },
      { who: "ICT", says: "The Judas swing is the false move — in London and in New York there are fake runs that start off a move. Sized one to two standard deviations of the central bank dealers' range (forex).", ref: "2022 Ep 9 00:03:41; 2016 M8 Intraday Profiles", status: "verified" },
      { who: "ICT", says: "A breaker is the last up-close candle before an old low is violated; it becomes support only after buy stops are taken and price reprices lower. A mitigation block is the failure swing — price fails to make the new extreme, then breaks structure.", ref: "2016 M4 Breaker Block 00:02:21–00:05:20; Mitigation Blocks 00:02:59", status: "verified" },
      { who: "PB", says: "Conditions theory: set if-then-execute scenarios tied to 5m or 15m fair value gaps; if price respects a level and inverts it, a long follows; if it fails, wait for a new condition or shift to the opposing scenario. React, don't predict.", ref: "'How To Set CONDITIONS: PB Theory', 'REACT, Don't PREDICT Market: PB Theory' (Jan 2026, own channel)", status: "verified" },
    ],
    consensus:
      "The lineage agrees a bias does not end because price bounced. The reversal signature everyone names is the same three-part one — sweep, displacement the other way, continued delivery — and every one of them calls the first part alone 'manipulation'.",
    conflict:
      "Whether a counter-bias trade is ever permitted differs: ICT's model trades WITH the daily draw and treats counter-trend as a lower-probability variant; PB Patty's one-trade-a-day is direction-agnostic once the 09:30 manipulation is read; this desk gates the counter-bias side behind the full signature plus a recency window and documents the trade as counter-bias so sizing and review can tell.",
    evidence:
      "Osler (JIMF 2005) documents that price CASCADES through stop clusters — the run, not the reversal — and that the effect lasts hours. That is evidence that the manipulation leg is real order flow; it is not evidence that a reversal follows. The 'distribution' requirement is the desk's guard against exactly that gap.",
  },
  {
    moduleId: "dol",
    claims: [
      { who: "ICT", says: "Above old highs, buy stops; below old lows, sell stops.", ref: "2022 Ep 2, 17:40", status: "verified" },
      { who: "ICT", says: "Look back 20 days, 40 days and 60 days: where are the sell stops in the last 60 days? In the last 40 days, what was the last highest high and lowest low? Price will be drawn to one of those two points. If everything above and below has been wiped out, identify the next high and low outside that 60-day range.", ref: "2016 M5 Using IPDA Data Ranges 15:58, 28:00, 32:25, 40:40", status: "verified" },
      { who: "ICT", says: "The algorithm reaches back about three trading months' worth of data; a market structure shift takes place every three to four months.", ref: "2016 M5 Quarterly Shifts & IPDA Data Ranges 23:03, 5:23", status: "verified" },
      { who: "ICT", says: "Relatively equal highs: this high right before a drop is basically the same high here — retail sees it as resistance. No tolerance in ticks or points is ever given.", ref: "2022 Ep 2 24:21; Ep 11 25:04", status: "verified" },
      { who: "SMC", says: "LuxAlgo codes equal highs/lows as within 0.1 × ATR; BuildAlpha publishes sweep depth ≥ 0.25 × ATR14. These are tool-builders' numbers, not the lineage's.", ref: "LuxAlgo SMC script; BuildAlpha, Jul 2026", status: "verified" },
      { who: "TJR", says: "Three liquidity types: session highs and lows, relative equal highs and lows, and trendline liquidity. A liquidity sweep occurs when pending orders are filled, causing price movement in the opposite direction.", ref: "'The ONLY Liquidity Sweeps Video You'll Ever Need', Jun 2025 (transcript summary)", status: "paraphrase" },
      { who: "TJR", says: "Exit by targeting other draws on liquidity — low-resistance draws as take-profit targets.", ref: "Sweeps video ~39:24–40:08", status: "paraphrase" },
      { who: "PB", says: "Sweep targets: PDH/PDL, session highs and lows, equal highs and lows, prominent swing points. Structural target: an unfilled or unmitigated 5m or 15m FVG.", ref: "Mech Model (leaked transcript summary)", status: "paraphrase" },
    ],
    consensus:
      "Every educator prices the target as a liquidity pool — old highs/lows, equal highs/lows, previous day and session extremes — and every one of them says internal delivers to external and back. None publishes a reach-rate; this desk measures one from past sessions.",
    evidence:
      "Osler (NY Fed SR125 / JF 2003) shows stop-loss and take-profit orders cluster at round numbers in one major bank's FX book, with the asymmetry explaining reversals at and breakouts through them. That is the only peer-reviewed support for 'liquidity sits at salient levels' — FX, one dealer, 25 years old, and it says nothing about equal highs on a 15m index-futures chart.",
  },
  {
    moduleId: "liquidity",
    claims: [
      { who: "ICT", says: "Internal range liquidity is short-term lows or highs inside a price leg we are retracing into. 50% is your equilibrium — that is internal range. The stops below these lows are external range liquidity. Partials internal range, external range, close your trade.", ref: "2022 Ep 3 35:09; Ep 6 ~00:45:18", status: "verified" },
      { who: "ICT", says: "A liquidity void is a range where one side of the market is shown in wide, one-sided candles; that entire range will be covered back over at some future time. A fair value gap is the three-candle pocket, typically confirmed by a liquidity void on the lower timeframe in the same range.", ref: "2016 M4 Liquidity Voids 00:01:04, 00:06:49; FVG lecture 00:00:36", status: "verified" },
      { who: "SMC", says: "The slogan 'ERL to IRL, IRL to ERL' was not retrieved from ICT as a sentence; the idea is in his Dealing Ranges study and the Ep 6 target sequence. Treat the slogan as community phrasing.", ref: "2022 Topical Study Dealing Ranges 46:30", status: "paraphrase" },
    ],
    consensus:
      "Internal-to-external and external-to-internal delivery is ICT's framing and the whole lineage repeats it. Where they differ is which pools count as 'external' on an intraday chart: session extremes (JadeCap, TradingHub), previous day (TTrades, TJR), or the dealing-range edges (this desk).",
    evidence:
      "See draw on liquidity — Osler is the only peer-reviewed support, and it is about round numbers in FX. No published test of IRL/ERL delivery as a sequence.",
  },
  {
    moduleId: "range",
    claims: [
      { who: "ICT", says: "A dealing range is where price has taken out buyside, then reversed and taken out sellside. Equilibrium is 50%. If we're bearish we need price to get to equilibrium or preferably higher to go short.", ref: "2022 Topical Study Dealing Ranges, 00:01:52, 42:08", status: "verified" },
      { who: "ICT", says: "Fibs go on the bodies — the highest and lowest open/close. Do not use the wicks.", ref: "Dealing Ranges 45:22; 2016 M4 Orderblocks 00:10:08", status: "verified" },
      { who: "ICT", says: "Optimal trade entry: 62%, 70.5% and 79% of the impulse. 70.5% is the ideal; deeper is better but you risk not filling; 62% is acceptable with smaller profit and a larger stop. Stop below the 100 level; targets 0, −0.27, −0.62, −1.0.", ref: "OTE Pattern Recognition notes (student transcription of his series); 2017 Primer London Killzone 00:01:38", status: "paraphrase" },
      { who: "SMC", says: "LuxAlgo codes premium as the top 5% of the trailing range, discount as the bottom 5%, and an equilibrium band from 47.5% to 52.5% — the desk treats EQ as one line.", ref: "Smart Money Concepts [LuxAlgo]", status: "verified" },
      { who: "PB", says: "Checklist item 10: is price above or below the equilibrium of the range?", ref: "PB TRADING CHECKLIST (student upload)", status: "paraphrase" },
    ],
    consensus:
      "Premium above equilibrium, discount below, and the instruction to sell the one and buy the other, is universal. Only ICT names the fib levels inside the range; only LuxAlgo codes the zones (premium = top 5% of the trailing range, discount = bottom 5%, an equilibrium band from 47.5% to 52.5%).",
    conflict:
      "What defines the range differs: ICT anchors the fib on the most recent impulse leg; LuxAlgo uses the trailing swing range; this desk uses the current leg's swing high and low and treats EQ as a hard line. MPM tested midpoint-vs-edge entries inside a gap and found neither survives costs, which suggests the exact anchor may matter less than the lineage implies.",
    evidence: "No published test of premium/discount as an entry filter. The concept is a restatement of buy-low-sell-high with a defined midpoint; its value is as a filter against chasing, not as a predictor.",
  },
  {
    moduleId: "sweep",
    claims: [
      { who: "ICT", says: "The Judas swing is the false move. Typically in London and in New York there are fake runs that start off a move.", ref: "2022 Ep 9, 00:03:41", status: "verified" },
      { who: "ICT", says: "A rejection block forms when price reaches above the body of the candle to run the buyside out before price declines; sell at the body top with the stop above the wick.", ref: "2016 M4 Rejection Block 00:25:15, 00:11:11", status: "verified" },
      { who: "ICT", says: "The 'wick through and close back inside' shape is how the Venom opening-range description and every downstream encoding state it. ICT gives no depth threshold and no bar-count limit for a valid sweep.", ref: "ictkillzone.com Venom (secondary); primaries contain no threshold", status: "paraphrase" },
      { who: "SMC", says: "TradingHub 3.0: on the grab side the wick is enough; on the break side a full candle close is required. A wick-only move through structure is a sweep, not a break.", ref: "Trading Hub 3.0 handbook (mirror)", status: "paraphrase" },
      { who: "SMC", says: "Turtle Soup (the original, Connors/Raschke): a new 20-session extreme at least four sessions old is violated and price returns; the ICT variant swaps the 20-day rule for a swing with stop concentration.", ref: "LuxAlgo library, Turtle Soup", status: "paraphrase" },
      { who: "TJR", says: "The HTF sweep comes first and is non-negotiable: 1H/4H swings, previous-day levels, session highs and lows, equal highs and lows. Whether the candle must CLOSE back inside is not in his own words — only in third-party renderings of his model.", ref: "Sweeps video; ds82385 indicator; Snappchart", status: "contested" },
      { who: "PB", says: "A valid setup requires a swing low, a swing high, and a lower low that sweeps liquidity — the sweep is REQUIRED, and the inversion after it is the trigger.", ref: "Mech Model 2.0 (re-upload, Jan 2026, transcript summary)", status: "paraphrase" },
    ],
    consensus:
      "The SHAPE is unanimous: wick through the level, body closes back inside. ICT's Venom description, TTrades, TradingHub ('grab side: the wick is enough; break side: a full candle close'), Turtle Soup, and every backtester who encoded it agree. Nobody in the lineage publishes a depth threshold or a bar-count limit.",
    conflict:
      "Inside the TTrades camp two implementations disagree on the close: 'closes back above the level' (TFO) versus 'closes back inside the PRIOR DAY'S BODY' (joshuuu) — the second is materially stricter. Photon and TradingHub reframe the sweep as an inducement grab, which is a different object (the first pullback, not the external extreme). This desk requires the wick-and-close on the correct pool for the direction (a short needs a buyside raid), inside a recency window of 24 bars.",
    evidence: `Osler (JIMF 2005) shows the cascade THROUGH a stop cluster is real, larger than the take-profit response, and lasts hours — the sweep is genuine order flow. It does not show that the reversal after it is more likely than continuation. ${EV_NO_PEER_REVIEW}`,
  },
  {
    moduleId: "shift",
    claims: [
      { who: "ICT", says: "The significance I place on 'quick' is linked directly to displacement. It has to be energetic — it can't be a lethargic little move. Preferably close below that level; a big, beefy bearish candle that closes low below it.", ref: "2022 Ep 6, 19:22–21:41", status: "verified" },
      { who: "ICT", says: "Intraday market structure shifts — not necessarily a break in market structure that leads to prolonged multi-day movement. Market structure SHIFT, not market structure BREAK.", ref: "2022 Ep 3, 02:23", status: "verified" },
      { who: "ICT", says: "The opening price of the order block is not a random level but a specific price that changes the state of delivery.", ref: "2024-04-29 Day 1, 03:09:23 — the exact CISD rule (body close through the open of the last opposing run) is stated only in secondaries", status: "contested" },
      { who: "ICT", says: "No numeric size criterion for displacement exists anywhere in his lectures — it is visual. The desk's body-to-ATR ratio is a mechanisation.", ref: "2022 Ep 6 19:22; Ep 13 15:22", status: "verified" },
      { who: "SMC", says: "LuxAlgo's FVG requires the gap to exceed twice the cumulative mean |%Δ|; MPM's test used 1.5× the median 20-bar range; StatOasis a multiple of ATR20. Quantification exists only in code.", ref: "LuxAlgo script; MPM Markets Jul 2026; StatOasis Sep 2026", status: "verified" },
      { who: "TJR", says: "The '79% extension' is his vocabulary — a closure or extension confluence on the trigger candle — and is NOT ICT's 62–79% OTE retracement. One third-party indicator reads it as 'the BOS impulse candle closed beyond 79% of its own range'. No primary definition retrieved; do not encode a formula.", ref: "Fan clips 'The 79% extension #tjrtrades'; student posts; TJR Strategy Indicator", status: "unverified" },
      { who: "PB", says: "Blake's trigger is CISD/inversion: 'a 5m CISD mech model to an unfilled 15m' is how a PDI trade is noted.", ref: "PDI course index (Scribd / College Sidekick)", status: "paraphrase" },
    ],
    consensus:
      "Displacement is visual for every educator, with the existence of a fair value gap serving as the de facto proof that it happened. Quantification exists only in code: LuxAlgo's FVG requires the gap to exceed twice the cumulative mean of |%Δ| (auto), MPM used 1.5× the median 20-bar range, StatOasis a multiple of ATR20. This desk uses a body-to-ATR ratio and a recency window.",
    conflict:
      "MSS versus CISD is the real split — see the sequence module. And confirmation timeframe: 1m (TradingHub, CutlerTrades), 5m (TJR, JadeCap, ICT's usual), 15m (JadeCap alternate). LuxAlgo and TradingHub are explicit that a structure break is close-based; ICT sources say 'decisive close' without defining it.",
    evidence:
      "Order-flow imbalance producing a price change is established (Cont, Kukanov & Stoikov 2014: a linear relation with slope inverse to depth, explaining square-root impact) — that is WHY a displacement candle exists. Nothing published establishes that it predicts continuation.",
  },
  {
    moduleId: "arrays",
    claims: [
      { who: "ICT", says: "A bearish FVG is a three-candle formation: the first candle's low is traded below on the next candle, which extends lower but never trades back up to candle one's low — one candle only traded from candle one's low to candle three's high. Boundaries are wick to wick.", ref: "2022 Ep 6, ~00:12:14; 2016 M4 FVG 00:04:36", status: "verified" },
      { who: "ICT", says: "Consequent encroachment is the midpoint of any gap or inefficiency — your 50% level. If price can't even touch the midpoint of the gap, it is decidedly weak.", ref: "2024 L03 31:07; L04 14:14; L05 16:56", status: "verified" },
      { who: "ICT", says: "A bullish order block is the lowest candle with a down close that has the most range open-to-close, near support. Its mean threshold is the 50% of the body — do not use the wicks; the best blocks never see price below the midway point of the body. The low of the block is a relatively safe stop.", ref: "2016 M4 Orderblocks 00:01:12–00:10:50", status: "verified" },
      { who: "ICT", says: "2024 version: all the consecutive up-close candles before the drop make the bearish order block, keyed on the opening price of the lowest one; validated by whether it displaces lower. Do not use a down-close candle above a high that has already been broken.", ref: "2024-04-18 Lecture On ICT Order Blocks 00:25:34–00:57:27", status: "verified" },
      { who: "ICT", says: "When a fair value gap fails it is not discarded — treat it as inversion: it goes above it, comes back down and uses it as a discount array. Risk right below that low — a very small stop.", ref: "2023-10-15 Market Review 01:05:35; 2023-11-01 34:48; 2024-01-23 livestream 01:16:52", status: "verified" },
      { who: "SMC", says: "The rule that the candle BODY must close through the gap to invert it is stated by every secondary (LuxAlgo, TradingFinder, fan sites) and not retrieved from ICT; his closest wording is 'passed through'. Label it community mechanisation.", ref: "2023-10-15, 01:10:46", status: "contested" },
      { who: "SMC", says: "'Unicorn' (breaker + FVG overlap) is community-named. ICT: 'if you have a breaker and a fair value gap in there, that's the one you want to focus on' — the concept without the name.", ref: "2024 L04, 31:47", status: "paraphrase" },
      { who: "PB", says: "PDI stands for Pre Distribution Inversion. The trigger is an inversion (IFVG) on the highest timeframe available inside the manipulation leg, searched 1m to 5m, confirmed by a body close through the gap. A one-minute inversion gives good R:R without additional confirmation.", ref: "'UNDERSTANDING PDI MODEL'; Mech Model (leaked transcript summaries)", status: "paraphrase" },
      { who: "PB", says: "PB Theory IFVG method: at an HTF (1H/4H) FVG, do not trade immediately; wait for a 5m FVG or structure, stop at the swing low of the 5m FVG, break-even at the previous internal high, target the nearest significant liquidity.", ref: "PB P notes on the PB Theory IFVG videos (Knowt)", status: "paraphrase" },
      { who: "TJR", says: "Wait for a fair value gap to be filled before entering; avoid premature entries that lead to poor risk-to-reward.", ref: "Sweeps video ~39:02; 2026 video", status: "paraphrase" },
    ],
    consensus:
      "The three-candle FVG definition is universal (bull: bar 1 high below bar 3 low, the untouched band between). The order block as the last opposing-close candle before the move is ICT's and everyone downstream repeats it. The inversion FVG — a gap that price closes through, then acts as the other side's array on the return — is ICT's, and CutlerTrades' whole model is built on it.",
    conflict:
      "Entry location inside the array: ICT is the only source that names the midpoint (consequent encroachment) and the OTE fib; everyone downstream says 'inside the array' (JadeCap, CutlerTrades, Unicorn) or enters at the CISD level (TTrades). This desk rests a limit at the midpoint because a limit needs one number.",
    evidence: `${EV_TWO_TESTS} ${EV_FILL_CLAIMS} The desk grades arrays as places the sequence may complete, not as signals — which is the only reading the evidence supports.`,
  },
  {
    moduleId: "retrace",
    claims: [
      { who: "ICT", says: "We expect price to eventually want to trade back up INTO that little gap area — into, not through. The operative test is whether consequent encroachment is reached, not a full fill.", ref: "2016 M4 FVG 00:06:24; 2024 L05 16:56", status: "verified" },
      { who: "ICT", says: "If you miss it, you want to try to get long real close to where the opening price is.", ref: "2022 Ep 9, 00:06:20", status: "verified" },
      { who: "ICT", says: "On the inversion: I'm going to treat this as a foothold — I'm going to wait for it to trade up above it.", ref: "2024-01-23 Tape Reading Livestream, 01:08:48", status: "verified" },
      { who: "TJR", says: "Enter on the shift or the first clean retrace — never chase.", ref: "Sweeps video; 2026 video (transcript summaries)", status: "paraphrase" },
      { who: "PB", says: "Blake enters on the inversion body-close (the edge of the array), not at the 50%. Patty's 'patty swing' is a real 2026 model name traded with a 1m IFVG for a 1:1 — but no PB-authored definition of its rules was retrieved.", ref: "Mech Model; community videos 'patty swing' (Mar 2026)", status: "unverified" },
    ],
    consensus:
      "'Do not chase; let price come back to the array' is said by every educator in the lineage in almost the same words.",
    conflict:
      "Where in the array to enter — midpoint, edge, OTE — is unresolved (see arrays). CutlerTrades and JadeCap accept market entry on the return; ICT and this desk rest a limit.",
    evidence:
      "Zero published support for the retrace entry specifically. MPM tested midpoint versus near-edge entries inside a fair value gap and found neither survives execution costs. On this desk's own month of tape, the retrace layer was the binding gate (failing on ~98% of trade-window bars) and the sixteen highest-confluence refusals, taken at the close instead of on the retrace, went 5W/10L/1S for −6.07R.",
  },
  {
    moduleId: "smt",
    claims: [
      { who: "ICT", says: "SMT stands for Smart Money Tool or Smart Money Technique — divergence between closely correlated or inversely correlated assets. It gives you a long-term perspective.", ref: "2016 M3 Institutional Market Structure 00:02:21, 00:19:31", status: "verified" },
      { who: "ICT", says: "One asset fails and the other succeeds; he uses SMT to confirm trades but doesn't necessarily need it.", ref: "2024 L04, 02:08:23 (archive paraphrase)", status: "paraphrase" },
      { who: "SMC", says: "ES/NQ/YM as the index triad appears throughout his livestreams, but a verbatim index-pair definition was not captured; the desk's NQ-vs-ES pairing is standard practice, not a quoted rule.", ref: "—", status: "paraphrase" },
      { who: "TJR", says: "ES/NQ alignment is critical. He is the only educator who accepts SMT as a stand-alone confirmation; a 2025 livestream trade was described as a one-minute SMT divergence.", ref: "2026 video (transcript summary); livestream description", status: "paraphrase" },
      { who: "PB", says: "Checklist item 9: SMT aligning with bias. Counter-bias SMT removes the trade.", ref: "PB TRADING CHECKLIST; Mech Model filters", status: "paraphrase" },
    ],
    consensus:
      "SMT — one correlated index making a new extreme while the other fails to — is ICT's, and every educator who uses it uses it as CONFIRMATION of a sweep already in hand. TJR is the only one who accepts it as a stand-alone 5-minute confirmation.",
    evidence: "No published test of SMT divergence as a signal or a filter. It is a correlation-breakdown heuristic with no stated threshold for 'failed to confirm'.",
  },
  {
    moduleId: "time",
    claims: [
      { who: "ICT", says: "For indices: 8:30 to 11 o'clock, New York local time — there's usually a setup in here. Noon to one o'clock is a no-trade time period.", ref: "2022 Ep 2 42:41; Ep 17 00:10:34–00:10:54; Ep 5 00:59:40", status: "verified" },
      { who: "ICT", says: "Silver Bullet: 3am to 4am, 10am to 11am, and 2pm to 3pm, always New York local time; a classic ICT fair value gap forms inside the window; minimum objective 10 handles on indices, 15 pips forex.", ref: "2023-05-15 ICT Silver Bullet lecture", status: "verified" },
      { who: "ICT", says: "London kill zone is 2am to 5am New York time (2017, 2024) — or 1am to 5am (2016). Asian: 8pm to midnight (2016) or 7pm to 9pm (2024). The desk's London figure is neither.", ref: "2017 Market Maker Primer 05, 00:54:40; 2016 M8 00:08:21; 2024 L05", status: "contested" },
      { who: "ICT", says: "The opening range for indices is 9:30 to 10:00 NY. A '9:30 to 9:45 no entries' rule was NOT found in his words — it is this desk's rule. He does say 'I like 9:30' as the open and anticipates the move 'between 8:30 and 9:30'.", ref: "2023 One Trading Setup For Life; 2022 Ep 9 00:06:28; 2024-04-29", status: "verified" },
      { who: "ICT", says: "A macro is a shortlist of directives the algorithm runs to seek liquidity and inefficiencies; 9:50–10:10 and 10:50–11:10 NY are named in the intro. If the macros do not provide that timing and the market doesn't budge, close your charts.", ref: "2023-07-10 Time Macros Intro 24:29, 31:03", status: "verified" },
      { who: "SMC", says: "The full macro list (2:33–3:00, 4:03–4:30, 8:50–9:10, 11:50–12:10, 1:10–1:40, 3:15–3:45) is repeated by LuxAlgo, TradingFinder and fan sites and was not verified from ICT this run.", ref: "LuxAlgo library, ICT Macros", status: "unverified" },
      { who: "SMC", says: "Daye's Quarterly Theory: daily quarters at 18/00/06/12 ET; NY AM 90-minute quarters 6:00–7:30, 7:30–9:00, 9:00–10:30, 10:30–12:00 with the 'True Open' at 7:30. Casper SMC also anchors on the 7:30 open. Neither restricts 9:30–9:45.", ref: "toodegrees QT script 2023; Casper SMC checklist", status: "paraphrase" },
      { who: "TJR", says: "Trade the session opens where new money enters: Asia 6 PM ET, London 3 AM ET, New York 9:30 AM ET. Never enter blindly at the open — wait for the manipulation.", ref: "Sweeps video ~34:11; Daily Bias Guide", status: "paraphrase" },
      { who: "PB", says: "Blake: 9:30–11:00 and 13:00–15:00 ET, avoid the lunch hour; the indicator default is a 'Golden Hour' 9:30–11:00 with a maximum of two signals per session.", ref: "Mech Model; EZ$ PB Blake indicator", status: "paraphrase" },
      { who: "PB", says: "The PB checklist's time window is 10 AM–2 PM ET plus the macros 9:45–10:15 and 13:45–14:30. The desk's earlier '9:30–11:00 only' attribution to Patty was wrong.", ref: "PB TRADING CHECKLIST (student upload)", status: "paraphrase" },
    ],
    consensus:
      "Everyone trades the New York morning. The Silver Bullet windows (03:00–04:00, 10:00–11:00, 14:00–15:00 ET) are ICT's and widely repeated. Lunch (12:00–14:00 ET) is called low quality by ICT-derived sources and avoided by JadeCap (exit by ~12:15).",
    conflict:
      "Three camps on the first fifteen minutes. Stand through the open: ICT's Venom description (opening range built 09:30–10:00, act 10:00–10:30 — no entry in the first thirty minutes by construction), TradingFinder (09:30–09:45 is the Judas window), PB Patty (09:30 is the manipulation), and this desk (no entries 09:30–09:45 until the raid resolves — then only the fade, A+, paper-first). Allowed: JadeCap (09:30–11:30, no restriction), CutlerTrades (09:30 onward). Daye's Quarterly Theory places 09:30 inside a 09:00–10:30 quarter. The desk sits in the first camp.",
    evidence:
      "Volume and volatility concentrating at the open is established theory and data (Admati & Pfleiderer, RFS 1988; Heston, Korajczyk & Sadka, JF 2010). But the peer-reviewed intraday result on index ETFs cuts AGAINST a default reversal read: the first half-hour's return PREDICTS the last half-hour's on SPY, 1993–2013 (Gao, Han, Li & Zhou, JFE 2018) — continuation, not a Judas swing. The only peer-reviewed open-reversal finding is for retail-attention single stocks (Berkman, Koch, Tuttle & Zhang, JFQA 2012). The opening-range work nearest to index futures (Zarattini & Aziz 2023, 5-minute ORB on QQQ) breaks even at about 2.2 cents/share slippage in an independent replication, with 76% of its profit from one year.",
  },
  {
    moduleId: "risk",
    claims: [
      { who: "ICT", says: "The low of the bullish order block is a relatively safe stop; just below the 50% of the block is a good place to raise the stop after price runs away. Not using a stop loss is guaranteeing that you're going to fail.", ref: "2016 M4 Orderblocks 00:10:50; 2024 L04 01:03:03", status: "verified" },
      { who: "ICT", says: "For the structure-shift trade the stop goes above the high that was swept, or above the creating candle's high. Targets: an old low or an imbalance; partials at internal range, then external range, then close.", ref: "2022 Ep 2 32:45, 48:03; Ep 6", status: "verified" },
      { who: "ICT", says: "Risk 1% per trade for students; after losses your next trade can only risk 1%. His own competitive demo: three and a quarter percent, maximum four and a half. 2016 example: 2%, 3:1 baseline, bank the first portion at 3R — the second portion will always make more than the first.", ref: "2022 Ep 41 00:22:25; Ep 3; 2016 M2", status: "verified" },
      { who: "ICT", says: "Optimal trade entry stop: below the 100 level of the fib. Silver Bullet: 10 handles minimum on indices.", ref: "OTE notes; 2023-05-15", status: "paraphrase" },
      { who: "TJR", says: "Never risk more than 1–2% per trade; position sizing is non-negotiable. Pre-trade checklist demands R:R of at least 2:1. Stop 'below recent lows'; partials at 1R and 2R appear only in student notes.", ref: "jointjrtrades.com philosophy page (affiliate-hosted); student notes", status: "paraphrase" },
      { who: "PB", says: "Blake: stop below the low of the inversion candle (or the nearby OB / swing low) — tighter than beyond the sweep wick. T1 at 1:1, then stop to break-even so there is no more risk on the table. By design the model needs a ~70% win rate to be positive expectancy at that R:R.", ref: "Mech Model (leaked transcript summary); Medium student write-up Dec 2025", status: "paraphrase" },
      { who: "PB", says: "Claimed win rates: 'over 80%' (leak), '80% WR strategy that works every single day' (own TikTok), 70% (own YouTube titles), '71%+' (Whop copy). No sample size published for any of them. Risk per trade and a journaling template were not found anywhere.", ref: "PB Blake channels; Whop", status: "unverified" },
    ],
    consensus:
      "Stop beyond the sweep wick plus a buffer is near-universal (ICT-derived pages quantify the buffer: 10–20 pips FX, 3–5 NQ points; JadeCap's script uses behind candle 1 of the FVG; CutlerTrades just beyond the IFVG). First target at opposing liquidity is universal.",
    conflict:
      "Fixed R:R claims range from 2R (JadeCap script) to 3R (Casper, ICT) to '1:5–1:10 are very excellent' (TradingHub). No educator publishes scale-out fractions — banking half at T1 (the draw), moving the stop to break-even and running the rest to T2 is this desk's own rule, measured at +0.50R/t on 122 filled plans; banking at +1R instead measured −0.42R/t.",
    evidence:
      "Position sizing by fixed fractional risk has decades of support in the risk-of-ruin literature; the specific R:R and scale-out numbers do not. Every 60%+ win-rate claim retrieved in the lineage was marketing, in-sample filtered, or resolved on bars too coarse to price the stop.",
  },
  {
    moduleId: "gates",
    claims: [
      { who: "ICT", says: "Noon to one o'clock in the afternoon, New York time, is a no-trade period. If the macros do not provide timing and the market doesn't budge, close your charts.", ref: "2022 Ep 5 00:59:40; 2023-07-10 31:03", status: "verified" },
      { who: "SMC", says: "Casper SMC stops for the day after two losses or one win, with entries 7:30–10:30 only; JadeCap exits by ~12:15.", ref: "Casper checklist (partial); JadeCap TradeZella playbook", status: "paraphrase" },
      { who: "PB", says: "No-trade conditions on the checklist: high-impact news; session objective already met ('OBJECTIVES ALREADY MET'); no HTF liquidity swept; time not aligned. Blake's indicator caps signals at two per session.", ref: "PB TRADING CHECKLIST; EZ$ PB Blake indicator", status: "paraphrase" },
      { who: "TJR", says: "Journal every trade with screenshots and notes. The field list and weekly-review cadence in the desk canon were not found in his material.", ref: "philosophy page; TradeZella affiliate", status: "paraphrase" },
    ],
    consensus:
      "Frequency caps and daily stops are common to the mechanical schools: Casper stops for the day after two losses or one win; PB Patty's day is done after one trade; this desk caps the month at nine PATH trades and the day at two consecutive losses.",
    evidence:
      "The case for caps is statistical, not ICT-specific: with a small real edge the marginal trade is the worst one available, and the two independent backtests above found the edge disappears into costs precisely when the concept is traded mechanically at high frequency on 5–15m bars.",
  },
  {
    moduleId: "discretion",
    claims: [
      { who: "ICT", says: "Journal: observations, minute markers, what the algorithm did, positive framing. The models flex once liquidity engineering is internalised.", ref: "2016 Core Content journaling guidance (desk canon paraphrase)", status: "paraphrase" },
      { who: "ICT", says: "'Highly, highly consistent', 'extremely high probability', 'it will repeat more times than it fails' — no published track record and no percentage accompanies any of these.", ref: "2023-05-15; 2022 Ep 41 00:49:56", status: "verified" },
      { who: "TJR", says: "Background: multiple blown accounts 2017–19, a −$2,000 bank balance, DoorDash at night — from his own marketing timeline. No verified broker statements exist. A March 2026 exposé alleges livestream P&L came from a manually-entered journaling app; his own podcast admission traces early capital to a $100,000 loan into Solana in 2021. His site: 'Day trading is risky, and most day traders lose.'", ref: "jointjrtrades.com about; ImanTrading (X, 2026-03-15); beststockstrategy", status: "paraphrase" },
      { who: "PB", says: "PB Trading is Patrick 'Patty' Lovelace and Blake (surname not found), Whop bootcamp 81,000+ members. 'By age 19 Blake had earned 107k in payouts', 'helped over 1,000 traders earn their first payout' — marketing copy, zero published statements. 'Built while in school' belongs to Patrick, not Blake.", ref: "pbtrading.io; Whop; TSL Time Podcast description", status: "unverified" },
      { who: "PB", says: "Ronan: the ONLY trace found is a student review calling 'blake, ronan, patty' helpful in the Discord. No channel, bio, model, '10k months' or student-to-coach story exists anywhere. The desk's Ronan entry is unverifiable and reads as generic PB Theory.", ref: "Grokipedia / search, single mention", status: "unverified" },
    ],
    consensus:
      "ICT says the models flex once liquidity engineering is internalised; PB says start mechanical and recognise A+ narratives inside the model; TJR keeps discretion low on the core and filters from journal data. All three journal every trade with the confluences named.",
    evidence:
      "Journaling what was NOT taken has no published validation in trading, but the underlying idea — that a decision rule's quality is measured by the counterfactuals it declines — is the whole basis of the desk's ghost book and of the walkthroughs' chase counterfactuals.",
  },
];

export function canonFor(moduleId: string): CanonBlock | null {
  return CANON.find((c) => c.moduleId === moduleId) ?? null;
}

/** Sources referenced anywhere, for the tab's footer. */
export function canonSources(): { who: CanonSource; label: string }[] {
  return [
    { who: "ICT", label: "Michael J. Huddleston — Inner Circle Trader (YouTube mentorship series, X)" },
    { who: "TJR", label: "Tyler Riches — TJR Trades (YouTube, X)" },
    { who: "PB", label: "PB Trading — Patty, Blake, Ronan (YouTube, course material)" },
    { who: "SMC", label: "Community SMC — TTrades, JadeCap, CutlerTrades, Photon, TradingHub, LuxAlgo, Daye, Casper" },
    { who: "Evidence", label: "Osler 2003/2005 · Admati & Pfleiderer 1988 · Heston et al. 2010 · Gao et al. 2018 · Berkman et al. 2012 · Nagel 2012 · Cont et al. 2014 · StatOasis 2026 · MPM Markets 2026 · Brusco ORB replication" },
  ];
}
