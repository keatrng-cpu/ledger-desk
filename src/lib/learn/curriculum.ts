/**
 * The curriculum.
 *
 * ONE RULE GOVERNS THIS FILE: every threshold is IMPORTED, never typed.
 *
 * Documentation that restates a number is documentation that will eventually
 * contradict the engine, and a lesson that contradicts the gate it is teaching
 * is worse than no lesson — it trains the trader to expect behaviour the desk
 * will refuse. CLAUDE.md already settles the tie ("if copy and code disagree,
 * code wins"); importing makes the tie impossible instead of settling it. If
 * the confluence floor moves, every sentence below moves with it.
 *
 * Structure of a module follows how a rule is actually usable:
 *   mechanism  — how it works, in tape terms
 *   rule       — what you DO about it
 *   trigger    — the threshold: do X when Y crosses Z
 *   error      — the specific way this one is usually got wrong
 *   desk       — what this desk does mechanically, so the gate stops being
 *                arbitrary and starts being a thing you understand
 */

import { APLUS_RULES } from "@/lib/aplus/config";
import {
  PATH_MONTH_CAP,
  MAX_CONSEC_LOSSES,
  MAX_SAME_SIDE_WEEK,
  APLUS_FULL_SIZE_MIN_N,
  APLUS_FULL_SIZE_MIN_WR,
  APLUS_PROBE_RISK,
  APLUS_FULL_RISK,
} from "@/lib/trading/profit-rules";
import { HIGH_CONFLUENCE_THRESHOLD } from "@/lib/trading/scanner";
import { RECENT_SWEEP_BARS, RECENT_DISPLACEMENT_BARS } from "@/lib/trading/detectors";
import { SHOCK_RANGE_MULT, SHOCK_LOCK_MS } from "@/lib/trading/shock";

export interface LearnModule {
  id: string;
  /** Position in the sequence a trade is actually read in. */
  step: number;
  title: string;
  /** One line, for the index. */
  oneLine: string;
  mechanism: string;
  rule: string;
  trigger: string;
  error: string;
  desk: string;
  /** Figure ids from `learn/figures.ts`. */
  figures: string[];
  /**
   * What a PAIR of figures is doing, when there are two.
   *
   * "contrast" is the teaching device: the same tape, two decisions, one
   * marked right and one wrong. "compare" is two panels of one phenomenon —
   * NQ beside ES — where neither panel is a mistake. They look identical in
   * the layout and mean opposite things, so the intent is declared rather
   * than inferred from whether a verdict happens to be set.
   */
  pairing?: "contrast" | "compare";
  /** Asks the trader to apply the rule to the tape in front of them. */
  check: string;
}

const pct = (n: number) => `${(n * 100).toFixed(n * 100 % 1 === 0 ? 0 : 1)}%`;

export const MODULES: LearnModule[] = [
  {
    id: "sequence",
    step: 1,
    title: "The sequence",
    oneLine: "Five layers, in order. Miss one and there is no trade.",
    mechanism:
      "Every trade this desk takes is the same five-step read: where price is drawn to, a raid of the opposite liquidity, the correct half of the dealing range, a lower-timeframe shift, and a retrace into a fresh array. They are ordered because each one only means something if the one before it happened. A gap that formed before the raid is the leg INTO the sweep, not a place to enter after it.",
    rule:
      "Read them in order and stop at the first one missing. The missing layer is the answer to 'why not', and it is the only thing worth saying out loud.",
    trigger: `All five must pass AND the PATH band must be A+/A/A− before the word is TAKE. Any must-layer failing makes it STAND, regardless of how good the rest looks.`,
    error:
      "Collecting confluences instead of sequencing them. Four strong signals in the wrong order is not a better trade than three in the right one — it is a different trade that has not happened yet.",
    desk: `smc-master.ts grades the layers and will only print TAKE when every must-layer passes and the PATH band clears the floor of ${APLUS_RULES.confluenceFloor}. The 'missing' line on the Now tab is literally the first failing layer.`,
    figures: [],
    check:
      "Open the Now tab. Which layer is the desk naming as missing right now, and can you see why on the chart before reading the text?",
  },
  {
    id: "dol",
    step: 2,
    title: "Draw on liquidity",
    oneLine: "Price is always going somewhere specific. Name it with a price.",
    mechanism:
      "Markets move between pools of resting orders. Above old highs sit buy stops; below old lows sit sell stops. Price is drawn toward whichever pool is large, close and unprotected — not toward an indicator, and not toward 'up'. The draw is a destination with a number.",
    rule:
      "Before anything else, say where price is going and at what price. If you cannot name the level, you do not have a directional read, you have a feeling.",
    trigger:
      "A draw is tradable when it sits in the direction of the higher-timeframe bias and has a measured reach rate from past sessions. A draw behind price is where it came from, not a target.",
    error:
      "Naming a direction instead of a level. 'Bearish' is not a draw; 'PDL at 24,020, reached 68% of sessions' is.",
    desk: "draw.ts scores every pool by distance, liquidity weight and how often that class of level has actually been reached, then prices the primary draw. The Now tab shows it with its reach rate — that percentage is measured, not assumed.",
    figures: ["liquidity"],
    check: "What is the desk's current primary draw, and how far is it in points?",
  },
  {
    id: "liquidity",
    step: 3,
    title: "Internal vs external liquidity",
    oneLine: "ERL is the edges. IRL is everything between.",
    mechanism:
      "External liquidity (ERL) is the session's own high and low — the obvious pools everybody can see. Internal liquidity (IRL) is the smaller highs and lows inside the range, plus unfilled gaps. Price characteristically runs from internal to external, and from external back to internal.",
    rule:
      "Take the first target at the nearest internal level and the runner at the external one. That is why the desk prints two targets rather than one.",
    trigger:
      "When price has just taken ERL, the next draw is usually IRL in the opposite direction. When it has filled IRL, the next draw is usually ERL.",
    error:
      "Targeting the far edge from the start and giving back a completed move because the near pool was never banked.",
    desk: `The desk's T1 is the nearest internal draw and T2 the external one, and the scale-out rule bank ${pct(APLUS_RULES.scaleOut.tp1Fraction)} at +1R with the stop to break-even — so the runner to ERL is carried at zero risk.`,
    figures: ["liquidity"],
    check: "Is price currently closer to internal or external liquidity, and which way does that point the next leg?",
  },
  {
    id: "range",
    step: 4,
    title: "The dealing range",
    oneLine: "Sell the upper half, buy the lower half. Not the other way round.",
    mechanism:
      "Take the swing high and swing low that define the current leg. The midpoint is equilibrium. Above it price is at a premium — expensive, and the better place to be a seller. Below it price is at a discount — cheap, and the better place to be a buyer. This is the whole of 'buy low, sell high', made mechanical.",
    rule:
      "Shorts are only taken in premium, longs only in discount. A short taken in discount is selling something already cheap into the pool that is about to be bid.",
    trigger: "Above EQ (the 50% of the range) = premium. Below = discount. There is no third option.",
    error:
      "Shorting a market that has already fallen to the bottom of its range because it 'looks weak'. It looks weak because it is where buyers are waiting.",
    desk: "structure.ts computes the dealing range and labels the zone; the dealing-range layer in smc-master.ts is a must-layer, so being in the wrong half is enough on its own to make the answer STAND.",
    figures: ["dealing-range"],
    check: "Which half of the range is price in right now, and does that permit the side you were leaning toward?",
  },
  {
    id: "sweep",
    step: 5,
    title: "The raid — and why a breakout is not one",
    oneLine: "A wick through that closes back inside. Anything else is acceptance.",
    mechanism:
      "A raid takes the stops resting beyond a pool and then rejects: price trades through the level, triggers the orders, and closes back on the original side. That close is the entire signal — it says the move beyond the level found no acceptance and the liquidity has been collected. A candle that closes beyond the level and stays there is the opposite event: acceptance, continuation, and the start of a new leg away from you.",
    rule:
      "Demand a wick through the pool AND a close back inside. If the close is beyond the level, the level broke — do not fade it.",
    trigger: `Wick pierces the level, body closes back inside, and the raid must be RECENT — this desk only counts one inside the last ${RECENT_SWEEP_BARS} bars (${(RECENT_SWEEP_BARS / 4).toFixed(0)} hours on 15m). A raid from yesterday is history, not a trigger.`,
    error:
      "Treating any touch of a level as a sweep. This is the single most expensive error in the model, because it inverts the trade: you fade a breakout and the stop is on the correct side of a move that is still accelerating.",
    desk: "market-narrative.ts takes the last sweep ONLY from a real detector raid — a wick through with a close back inside — and requires the polarity to match the direction: a short needs a buyside raid, a long needs a sellside one. It used to fall back to a pool's 'swept' flag, which scored a breakout as a raid; that fallback was removed.",
    figures: ["sweep-real", "sweep-fake"],
    pairing: "contrast",
    check: "Find the most recent level price traded through. Did it close back inside, or beyond?",
  },
  {
    id: "shift",
    step: 6,
    title: "Displacement and the shift",
    oneLine: "A wide body that CLOSES through structure. Drifting through it does not count.",
    mechanism:
      "After the raid, the move that matters is displacement: an unusually large body relative to recent range, travelling away from the swept level. When that displacement closes through the last protected swing point, structure has shifted (MSS). The size is the evidence — it says the move was participation, not drift.",
    rule:
      "Wait for a body that closes through the protected level. A wick through, or a slow grind through on small bodies, is not a shift.",
    trigger: `A body large relative to the trailing average range, closing beyond the protected swing, and formed AFTER the raid — this desk only counts displacement inside the last ${RECENT_DISPLACEMENT_BARS} bars and only when it prints later than the raid it belongs to.`,
    error:
      "Taking the shift from a candle that formed before the sweep. That candle is the leg into the raid and points the wrong way.",
    desk: "detectors.ts bounds both sweep and displacement by recency and smc-master.ts requires the displacement index to be greater than the raid index, so a pre-raid shift can never satisfy the layer.",
    figures: ["mss"],
    check: "Has a body closed through structure since the last raid, or is price still drifting?",
  },
  {
    id: "arrays",
    step: 7,
    title: "PD arrays — where the entry lives",
    oneLine: "Fast moves leave gaps. Price comes back to them.",
    mechanism:
      "When price moves fast it leaves inefficiency: a band that one side of the market never got to trade. On three bars, if the first bar's high never meets the third bar's low, that untouched band is a fair value gap. An order block is the last opposing candle before such a move. An inverted FVG is a gap that failed and now acts as resistance from the other side. All of them are the same idea — unfinished business at a known price.",
    rule:
      "Enter from inside an array, not from open space. The array gives you a defined boundary, which is what makes the stop small.",
    trigger:
      "The array must be on the side you are trading, unmitigated, and formed AFTER the raid. Consequent encroachment — the array's midpoint — is where the limit rests.",
    error:
      "Using an array that has already been filled once. A mitigated gap has done its job; expecting a second reaction from it is expecting the same order flow twice.",
    desk: "smc-board.ts tracks every array with a state (fresh / partial / inverted / mitigated / breaker), and the retrace layer only accepts a fresh same-side array timestamped after the raid. The chart on the Now tab shades at most four so the picture stays readable.",
    figures: ["fvg"],
    check: "Is there a fresh, unmitigated array on your side that formed after the raid? If not, there is no entry yet.",
  },
  {
    id: "retrace",
    step: 8,
    title: "The retrace — do not chase",
    oneLine: "Price has to come back to you. If it has not, you do not have a trade yet.",
    mechanism:
      "The entry is the retest, not the impulse. After displacement, price typically returns into the array it left behind before continuing. Entering on the retrace puts your stop just beyond the array — a small, defined distance. Entering on the impulse puts your stop in exactly the same place, but your entry is far from it, so the identical idea costs several times the risk and the ordinary retrace takes you out before the trade works.",
    rule:
      "Place a limit inside the array and let price come. If price is not inside the array, the answer is WAIT, not a market order.",
    trigger:
      "Price must be inside the array, within a quarter of its height as tolerance. Outside that, the desk names the distance and says wait.",
    error:
      "Chasing because the move looks like it is leaving. The cost is not the missed trade — it is the same trade taken at four times the risk.",
    desk: "The retrace layer requires price INSIDE a fresh same-side array, using a pad of 25% of the array height. When price is outside, it prints the distance and the instruction not to chase, rather than a generic wait.",
    figures: ["retrace-right", "retrace-chase"],
    pairing: "contrast",
    check: "Is price inside the array right now, or is the desk telling you how many points away it is?",
  },
  {
    id: "smt",
    step: 9,
    title: "SMT divergence",
    oneLine: "When NQ and ES disagree, one of them is lying.",
    mechanism:
      "The two index futures normally move together. When one makes a higher high and the other fails to — or one makes a lower low and the other holds — the disagreement says the move lacks broad participation. The index that failed to confirm is showing you where the real order flow is. NQ usually leads.",
    rule:
      "Use SMT as confirmation of a raid you already have, never as a signal by itself. A divergence with no sweep is an observation.",
    trigger:
      "Higher high on one index against a lower high on the other (or the low-side mirror), in the same window, on the same timeframe.",
    error:
      "Trading the divergence on its own. Indices diverge constantly in chop; without the raid it carries no information about where the stops were.",
    desk: "structure.ts builds a 15m/1H/4H SMT stack and the scanner treats it as a confluence component, never as a gate. The Charts tab shows both books side by side so the disagreement is visible rather than described.",
    figures: ["smt-nq", "smt-es"],
    pairing: "compare",
    check: "Are the two books agreeing on their most recent high or low right now?",
  },
  {
    id: "time",
    step: 10,
    title: "Time — killzones and the Judas swing",
    oneLine: "The first fifteen minutes of the New York session are designed to take your money.",
    mechanism:
      "Liquidity arrives in windows. The open produces an initial move that frequently reverses — the Judas swing — because it exists to trip the stops of everyone positioned before the session. After that raid, the actual session direction develops. The same setup is worth far more at 10:00 than at 09:32.",
    rule:
      "Name the raid during the open, take nothing. Trade the leg that follows it.",
    trigger:
      "No entries 09:30–09:45 ET. After 10:00 ET, A+ only unless already in a trade.",
    error:
      "Taking the open's first impulse as the day's direction. It is more often the trap than the trend.",
    desk: `sessions.ts exposes isJudasWindow() for 09:30–09:45 ET and the desk refuses entries inside it; auto-paper is A+ only in that window. High-impact news carries a ±15 minute blackout, and an unscheduled shock — a bar ${SHOCK_RANGE_MULT}× the trailing range — locks the desk for ${SHOCK_LOCK_MS / 60000} minutes from the tape alone, with no news feed involved.`,
    figures: [],
    check: "What window is the clock in right now, and does it permit an entry at all?",
  },
  {
    id: "risk",
    step: 11,
    title: "Risk — R is the only unit",
    oneLine: "Stop beyond the raid. Everything else is measured in multiples of that distance.",
    mechanism:
      "R is the distance from entry to stop. Expressing everything in R makes trades comparable across instruments and sizes: a 30-point MNQ trade and a 6-point ES trade are the same trade if both are 1R risked for 2R. Position size is then a division, not a judgement — risk dollars divided by R in dollars.",
    rule:
      "The stop goes beyond the raid wick, because that is the price the market has already proved it rejects. The target must be at least as far away as the stop, or there is no trade to take.",
    trigger: `Minimum ${APLUS_RULES.minRr.toFixed(1)}:1 reward-to-risk, targets clamped to ${APLUS_RULES.tpMaxR.toFixed(0)}R. Risk by grade: A+ ${pct(APLUS_RULES.riskByGrade["A+"])} · A ${pct(APLUS_RULES.riskByGrade.A)} · A− ${pct(APLUS_RULES.riskByGrade["A-"])} · B+ ${pct(APLUS_RULES.riskByGrade["B+"])}. A+ trades at the ${pct(APLUS_PROBE_RISK)} probe until n≥${APLUS_FULL_SIZE_MIN_N} A+ trades at ≥${pct(APLUS_FULL_SIZE_MIN_WR)} win rate, then ${pct(APLUS_FULL_RISK)}.`,
    error:
      "Sizing off a stop you have not placed yet, or widening the stop after entry so the loss is 'not real'. Both convert a known 1R into an unknown one.",
    desk: `At +1R the desk banks ${pct(APLUS_RULES.scaleOut.tp1Fraction)} and moves the stop to break-even, so open risk after T1 is approximately zero. Daily halt at ${pct(APLUS_RULES.dailyLossLimitPct)}, weekly at ${pct(APLUS_RULES.weeklyLossLimitPct)}.`,
    figures: ["risk"],
    check: "For the current plan: how many points is 1R, and does T1 clear it?",
  },
  {
    id: "gates",
    step: 12,
    title: "The gates — why the desk refuses",
    oneLine: "Frequency is the enemy. Most of the rules exist to stop you trading.",
    mechanism:
      "An edge that is real on nine trades a month becomes noise on ninety, because the marginal trade is always the worst one available. Caps on frequency are not conservatism — they are what keeps the average trade near the top of your distribution instead of the middle of it.",
    rule:
      "One book per day. Take the best setup, not the first. When the month's allocation is spent, the bar rises to A+ or you stand.",
    trigger: `Confluence floor ${APLUS_RULES.confluenceFloor} to execute · A+ tag at ${APLUS_RULES.aPlusThreshold} · ${PATH_MONTH_CAP} PATH per month, then A+ only · max ${APLUS_RULES.maxSetupsPerSession} per killzone · ${MAX_CONSEC_LOSSES} consecutive losses stops the day · max ${MAX_SAME_SIDE_WEEK} same-side trades per week · daily ${pct(APLUS_RULES.dailyLossLimitPct)} / weekly ${pct(APLUS_RULES.weeklyLossLimitPct)} halt.`,
    error:
      "Treating a skipped day as a wasted one. On a dirty week the skip IS the edge, and it is the only part of the process with a guaranteed positive expectancy.",
    desk: "profit-rules.ts enforces every one of these mechanically and the counters come from real fills, not from intent. The desk will refuse an entry it has already allowed twice in the same killzone.",
    figures: [],
    check: "How many PATH trades has this month used, and what does that make the current bar?",
  },
  {
    id: "discretion",
    step: 13,
    title: "Discretion — what the rules cannot decide",
    oneLine: "The gates tell you when you may. Discretion is everything after that.",
    mechanism:
      "A mechanical system can verify that a sequence completed; it cannot tell you that today's tape is thin, that the same level has already rejected twice, or that you are trading to recover a loss. Those are judgements, and they are where the remaining edge lives once the gates are respected. The discipline is to make them BEFORE the trade and record them, so they can be scored later rather than remembered flatteringly.",
    rule:
      "Write the reason at entry, in tape terms, and write the invalidation. A trade whose reason you cannot state in one sentence is not a trade you understand.",
    trigger: `A setup at or above ${HIGH_CONFLUENCE_THRESHOLD.toFixed(2)} confluence flashes on the desk. That is an instruction to LOOK, not to take — the sweep-polarity gate can still be refusing it, and it should be obeyed when it does.`,
    error:
      "Reading 'failed' as 'the direction was wrong'. A failed setup means a confluence was disrespected or liquidity and bias stopped agreeing — often while the direction was still correct. Those are different failures and they have different fixes.",
    desk: "ghost-book.ts scores the setups you did NOT take against what the tape then did, so discipline becomes measurable instead of anecdotal. Most journals only record what you did; the ones that record what you skipped are the ones that show whether the gates are helping.",
    figures: [],
    check: "Look at your last stand-down. Did the tape prove the skip right? If it did not, was the gate wrong or was the read wrong?",
  },
];

export function moduleById(id: string): LearnModule | null {
  return MODULES.find((m) => m.id === id) ?? null;
}
