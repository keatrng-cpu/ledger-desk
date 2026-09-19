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
  /**
   * Position in the sequence a trade is actually read in.
   *
   * DERIVED from array order at export, never written by hand — inserting a
   * module in the middle otherwise means renumbering every literal below it,
   * and the one that gets missed is silent.
   */
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
  /**
   * Self-explanation prompt on the figure pair (Chi). Optional — modules
   * without a drawing skip Ring 1 and go straight to the live call.
   */
  why?: string;
  /** The desk's why, shown only after the trader writes one. */
  whyAnswer?: string;
}

const pct = (n: number) => `${(n * 100).toFixed(n * 100 % 1 === 0 ? 0 : 1)}%`;

const MODULE_ORDER: Omit<LearnModule, "step">[] = [
  {
    id: "sequence",
    title: "The sequence",
    oneLine: "DOL → sweep polarity → dealing-range → LTF shift → retrace. Miss one = no trade.",
    mechanism: "Each layer only means something if the one before it happened. A gap from before the raid is the leg into the sweep, not an entry.",
    rule: "Read in order. Stop at the first miss. That miss is the only 'why not' worth saying.",
    trigger: `TAKE iff all musts pass AND PATH A+/A/A− (floor ${APLUS_RULES.confluenceFloor}). Any must-fail → STAND.`,
    error: "Stacking four signals in the wrong order. That's a different trade that hasn't happened yet.",
    desk: `smc-master.ts. Now tab 'missing' = first failing must-layer.`,
    figures: [],
    check: "Which must-layer is missing on the live book?",
  },
  {
    id: "bias-structure",
    title: "Setting bias — reading structure",
    oneLine: "HH+HL = bull. LH+LL = bear. One of the two = nothing.",
    mechanism: "Last two swing highs and last two swing lows. Mixed (HH+LL or LH+HL) is expansion/compression → NEUTRAL.",
    rule: "Demand both. A new high into a lower low is not a bull trend.",
    trigger: "HH+HL bull · LH+LL bear · else NEUTRAL · no book.",
    error: "Calling HH 'bullish' without checking the low.",
    desk: "structure.ts — last four swings each side, no smoother.",
    figures: ["bias-bull", "bias-expansion"],
    pairing: "contrast",
    check: "Last two highs and lows: do BOTH conditions hold?",
    why: "Why is the left one a trend and the right one not?",
    whyAnswer:
      "Trend needs both conditions. A higher high into a lower low is expansion — the range widened. There is no direction to lean on. That is the shape most often taken as a breakout.",
  },
  {
    id: "bias-conflict",
    title: "Which bias to lean toward",
    oneLine: "D / mid / last BOS vote. Location can veto the majority.",
    mechanism: "Majority sets top-down. Premium + bull vote + mid bear → forced NEUTRAL (mirror for discount + bear + mid bull).",
    rule: "Lean only if vote AND location survive. Override = no book, not 'pick a side'.",
    trigger: "Conf starts 0.4, +0.15 per aligned TF, cap 0.95. Neutral sits 0.35.",
    error: "Always taking the higher TF. In a turn it is the most wrong.",
    desk: "structure.ts votes then applies the two premium/discount overrides. Session stance is last ~12 bars, separate.",
    figures: [],
    check: "Live confidence, and how many TFs actually agree?",
  },
  {
    id: "bias-against",
    title: "Trading against the bias",
    oneLine: "HTF is absolute until sweep + displacement + distribution, recently.",
    mechanism: "A bounce is not a reversal. Only manipulation plus continued delivery the other way, inside recency, releases the gate.",
    rule: "No counter-bias on a sweep alone. Document it when you take it.",
    trigger: "Sweep AND counter displacement AND continued delivery, all recent. Miss one → gate shut.",
    error: "First strong bounce as the reversal. Early counter-bias = bad entry + fighting HTF.",
    desk: "htf-invalidation.ts only returns true for the OPPOSING side, with pass/fail per requirement.",
    figures: [],
    check: "Against today's HTF: which of the three can you actually point at?",
  },
  {
    id: "dol",
    title: "Draw on liquidity",
    oneLine: "A destination with a price. Not 'up'.",
    mechanism: "BSL above old highs, SSL below old lows. Drawn to the pool that is large, close, unprotected.",
    rule: "Name the level first. No price = no directional read.",
    trigger: "Tradable draw = HTF direction + measured reach from past sessions. A draw behind you is history.",
    error: "'Bearish' is not a draw. 'PDL 24020, reached 68% of sessions' is.",
    desk: "draw.ts scores distance × weight × reach rate. Now tab prints the priced draw.",
    figures: ["liquidity"],
    check: "Primary draw, price, points away?",
  },
  {
    id: "liquidity",
    title: "Internal vs external liquidity",
    oneLine: "ERL = session H/L. IRL = everything between.",
    mechanism: "Runs IRL→ERL then ERL→IRL. T1 is the near pool, T2 the far edge.",
    rule: "Bank T1 at nearest IRL. Carry T2 to ERL at zero risk after BE.",
    trigger: "Took ERL → next draw is usually IRL the other way. Filled IRL → next is ERL.",
    error: "Targeting the far edge from the start and giving the completed move back.",
    desk: `T1 nearest IRL, T2 ERL. Scale ${pct(APLUS_RULES.scaleOut.tp1Fraction)} at +1R, stop → BE.`,
    figures: ["liquidity"],
    check: "Closer to IRL or ERL, and which way is the next leg?",
  },
  {
    id: "range",
    title: "The dealing range",
    oneLine: "Short premium. Long discount. No third option.",
    mechanism: "Swing high/low of the current leg. Midpoint = EQ. Above = expensive. Below = cheap.",
    rule: "A short in discount is selling cheap into the bid.",
    trigger: "Above EQ = premium. Below = discount.",
    error: "Shorting the range low because it 'looks weak'. That's where buyers wait.",
    desk: "structure.ts labels the zone. Dealing-range is a must-layer — wrong half = STAND.",
    figures: ["range-premium-short", "range-discount-short"],
    pairing: "contrast",
    check: "Which half is live price in, and does it permit your side?",
    why: "Why may a short live on the left and not the right?",
    whyAnswer:
      "Left last print is premium of EQ — expensive. Right is discount — selling cheap into the bid. Dealing-range is a must-layer. No third option.",
  },
  {
    id: "sweep",
    title: "The raid — vs a breakout",
    oneLine: "Wick through, close back inside. Close beyond = acceptance.",
    mechanism: "Raid collects stops then rejects. Close beyond the level is continuation — do not fade it.",
    rule: "Wick + close back. Close beyond → the level broke.",
    trigger: `Recent only: last ${RECENT_SWEEP_BARS} bars (${(RECENT_SWEEP_BARS / 4).toFixed(0)}h on 15m). Yesterday is history.`,
    error: "Any touch counted as a sweep. That's fading a breakout with the stop on the wrong side of acceleration.",
    desk: "market-narrative.ts: real detector raid only. Short needs BSL raid, long needs SSL. Breakout flag is not a raid.",
    figures: ["sweep-clean", "sweep-breakout"],
    pairing: "contrast",
    check: "Last level traded through — closed inside or beyond?",
    why: "Why is the left one a raid and the right one acceptance?",
    whyAnswer:
      "Left wicked through and closed back inside — stops collected, then rejected. Right closed through and held. Fade the first. Do not fade the second.",
  },
  {
    id: "shift",
    title: "Displacement and the shift",
    oneLine: "Wide body that CLOSES through structure. Drift doesn't count.",
    mechanism: "After the raid: large body vs trailing range, away from the sweep, through the protected swing (MSS).",
    rule: "Wait for the close through. Wick-through or grind is not a shift.",
    trigger: `Displacement in last ${RECENT_DISPLACEMENT_BARS} bars AND index > raid index. Pre-raid body is the leg into the sweep.`,
    error: "Taking a shift from a candle that printed before the sweep.",
    desk: "detectors.ts recency-bounds both. smc-master.ts requires displacement after the raid.",
    figures: [],
    check: "Has a body closed through structure since the last raid?",
  },
  {
    id: "arrays",
    title: "PD arrays — where the entry lives",
    oneLine: "FVG / IFVG / OB. Enter from the array, not open space.",
    mechanism: "3-bar inefficiency: bar1 high never meets bar3 low. OB = last opposing candle before the move. IFVG = failed gap, now the other side.",
    rule: "Unmitigated, same side, formed AFTER the raid. Limit at CE (mid).",
    trigger: "Fresh or partial. Mitigated = done. Don't expect the same orders twice.",
    error: "Using a gap that's already filled.",
    desk: "smc-board.ts states: fresh/partial/inverted/mitigated/breaker. Retrace layer only accepts post-raid same-side.",
    figures: ["fvg"],
    check: "Fresh unmitigated array on your side, after the raid?",
  },
  {
    id: "retrace",
    title: "The retrace — do not chase",
    oneLine: "Limit in the array. If price isn't there, WAIT.",
    mechanism: "Impulse leaves the array; entry is the retest. Chase = same stop, several times the R.",
    rule: "No market order into the impulse.",
    trigger: "Inside the array ±25% of height. Outside → desk prints the distance.",
    error: "Chasing because 'it's leaving'. The miss isn't the cost — 4× risk on the same idea is.",
    desk: "Retrace must-layer: price IN a fresh same-side array, pad 25%. Else names points away.",
    figures: ["retrace-into"],
    check: "Inside the array, or how many points away?",
    why: "Is the marked close inside the array, or did it only tag it?",
    whyAnswer:
      "Entry is a close inside the gap. A wick that tagged it and closed out is not in the array. Chase is the same stop with several times the R.",
  },
  {
    id: "smt",
    title: "SMT divergence",
    oneLine: "NQ vs ES: HH vs LH (or LL vs HL) in the same window.",
    mechanism: "One book takes the extreme, the other refuses. The one that failed is the real order flow. NQ usually leads.",
    rule: "Confirms a raid you already have. Divergence with no sweep is an observation.",
    trigger: "HH vs LH (or LL vs HL), same TF, same window.",
    error: "Trading SMT alone. Indices diverge in chop constantly.",
    desk: "structure.ts 15m/1H/4H stack. Scanner confluence, never a gate. Charts tab is the picture.",
    figures: ["smt-nq", "smt-es"],
    pairing: "compare",
    check: "Do the two books agree on the most recent high or low?",
    why: "What did NQ do that ES refused?",
    whyAnswer:
      "NQ printed the higher high. ES printed a lower high in the same window. The book that failed the extreme is the real order flow. SMT without a sweep is an observation, not a trade.",
  },
  {
    id: "time",
    title: "Time — killzones and Judas",
    oneLine: "09:30–09:45 ET: name the raid, take nothing.",
    mechanism: "Open often exists to trip pre-session stops. Real direction develops after.",
    rule: "Trade the leg that follows Judas, not the first impulse.",
    trigger: "No entries 09:30–09:45 ET. After 10:00 ET, A+ only unless already in.",
    error: "Taking 09:32 as the day's direction. More often the trap.",
    desk: `sessions.ts isJudasWindow(). News ±15m. Shock ${SHOCK_RANGE_MULT}× trailing range locks ${SHOCK_LOCK_MS / 60000}m from tape alone.`,
    figures: [],
    check: "What window is the clock in, and does it permit an entry?",
  },
  {
    id: "risk",
    title: "Risk — R is the only unit",
    oneLine: "Stop beyond the raid wick. T1 ≥ 1R or there is no trade.",
    mechanism: "R = entry→stop. Size = risk $ / R $. MNQ 30pt and ES 6pt are the same trade if both are 1R for 2R.",
    rule: "Don't size a stop you haven't placed. Don't widen after entry.",
    trigger: `Min ${APLUS_RULES.minRr.toFixed(1)}:1 · TP clamp ${APLUS_RULES.tpMaxR.toFixed(0)}R · A+ ${pct(APLUS_RULES.riskByGrade["A+"])} · A ${pct(APLUS_RULES.riskByGrade.A)} · A− ${pct(APLUS_RULES.riskByGrade["A-"])} · B+ ${pct(APLUS_RULES.riskByGrade["B+"])}. A+ probe ${pct(APLUS_PROBE_RISK)} until n≥${APLUS_FULL_SIZE_MIN_N} A+ WR≥${pct(APLUS_FULL_SIZE_MIN_WR)}, then ${pct(APLUS_FULL_RISK)}.`,
    error: "Sizing off a mental stop, or widening so the loss 'isn't real'.",
    desk: `+1R banks ${pct(APLUS_RULES.scaleOut.tp1Fraction)}, stop → BE. Daily halt ${pct(APLUS_RULES.dailyLossLimitPct)} · weekly ${pct(APLUS_RULES.weeklyLossLimitPct)}.`,
    figures: ["risk"],
    check: "This plan: points in 1R, and does T1 clear it?",
  },
  {
    id: "gates",
    title: "The gates — why the desk refuses",
    oneLine: "Nine trades a month stay an edge. Ninety become the middle of the distribution.",
    mechanism: "Caps keep the average trade at the top of your set, not the first thing that prints.",
    rule: "One book/day. Best setup, not first. After the month cap: A+ only or stand.",
    trigger: `Floor ${APLUS_RULES.confluenceFloor} · A+ ${APLUS_RULES.aPlusThreshold} · ${PATH_MONTH_CAP}/mo then A+ · max ${APLUS_RULES.maxSetupsPerSession}/KZ · ${MAX_CONSEC_LOSSES} consec losses = day stop · max ${MAX_SAME_SIDE_WEEK} same-side/week · ${pct(APLUS_RULES.dailyLossLimitPct)}/${pct(APLUS_RULES.weeklyLossLimitPct)} halt.`,
    error: "Treating a skip as a wasted day. On a dirty week the skip IS the edge.",
    desk: "profit-rules.ts from real fills, not intent. Second fill in the same killzone is refused.",
    figures: [],
    check: "PATH used this month, and what does that make the current bar?",
  },
  {
    id: "discretion",
    title: "Discretion — after the gates",
    oneLine: "Gates say you may. Discretion is everything after that, written before the click.",
    mechanism: "The engine can't see thin tape, a level that already rejected twice, or revenge. Those judgements get scored only if you recorded them.",
    rule: "One-sentence reason + invalidation at entry. Can't state it → you don't understand it.",
    trigger: `≥${HIGH_CONFLUENCE_THRESHOLD.toFixed(2)} confluence = LOOK, not take. Sweep-polarity can still refuse.`,
    error: "Reading 'failed' as 'direction was wrong'. Failed = a confluence broke. Direction can still have been right.",
    desk: "ghost-book.ts scores the skips against what the tape then did.",
    figures: [],
    check: "Last stand-down: did the skip print right, and was that the gate or the read?",
  },
];

/**
 * The walkthroughs module. Its body is rendered by <Walkthroughs/> from real
 * cases rather than from these fields, which exist so it has a place in the
 * sequence and an honest description.
 */
MODULE_ORDER.push({
  id: "walkthroughs",
  title: "Walkthroughs — real tape",
  oneLine: "Jul–Aug 2026 15m ESU6/NQU6. Engine: 0 TAKE · PATH-grade refusals · chase R shown.",
  mechanism: "Causal replay of src/data/learn-history.json. Decision bar first; future hidden until reveal.",
  rule: "Decide before the divider. Outcome-first is hindsight.",
  trigger: "Real bars. Ties resolve against the trade. Pool tally is the whole month, not the pretty subset.",
  error: "Reading the result then the setup. Pays nothing.",
  desk: "scripts/build-learn-cases.mjs → learn-cases.json. Rebuild when the capture should move forward.",
  figures: [],
  check: "Would you have taken it before reveal? Count how often STAND was the right word.",
});

/** Steps numbered from position, so the order in the array is the truth. */
export const MODULES: LearnModule[] = MODULE_ORDER.map((m, i) => ({ ...m, step: i + 1 }));

export function moduleById(id: string): LearnModule | null {
  return MODULES.find((m) => m.id === id) ?? null;
}
