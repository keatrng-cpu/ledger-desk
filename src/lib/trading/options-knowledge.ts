/**
 * What the options book grades a contract on. The same rules are applied in
 * pickLiveContract. A paragraph here that the scorer does not use is a lie.
 */

export interface OptionLesson {
  id: string;
  title: string;
  /** What the ticket actually checks. */
  grade: string;
  body: string;
}

export const OPTION_LESSONS: OptionLesson[] = [
  {
    id: "expected-move",
    title: "Expected move",
    grade: "Target distance against the at-the-money ask times two. A target under about a third of that move is penalized. It is not refused.",
    body: "The chain's ordinary range for an expiration is about the at-the-money straddle, which is roughly twice one at-the-money option when that option is all extrinsic. A draw inside that range is a move the premium already expects. The return then comes from being early and from gamma, not from buying volatility cheap. A draw outside it is a bet that the session beats the volatility you paid. The scorer reads the nearest at-the-money ask on the same side as half of that range.",
  },
  {
    id: "delta",
    title: "Delta",
    grade: "Delta is the share of each underlying point the contract keeps. It is not the probability of the setup. The band that can win is 0.30 to 0.65.",
    body: "Call delta is N(d1). The chance of expiring in the money is closer to N(d2), a little lower. Neither number is the chance the pool trades, and neither is the chance the trade pays, because paying requires the underlying to clear the debit as well as the strike. Under 0.30 the contract is a lottery: the percent return looks large and the usual result is zero. Over 0.65 you are buying intrinsic, the percent return collapses, and the $550 cap often cannot hold it. Those strikes are not scored.",
  },
  {
    id: "touch",
    title: "Touch, not the close",
    grade: "The target is a pool. The exit is that pool, not the 16:00 expiration. A strike the target never reaches scores zero.",
    body: "With little drift, price tags a barrier about twice as often as it finishes beyond it. A long option closed at a draw is a touch trade. Grading it on the chance it expires in the money makes a fair strike look worse than the exit the desk uses. The reach is linear: full credit at or in the money, none when the target finishes short of the strike, and a straight line between.",
  },
  {
    id: "gamma",
    title: "Gamma",
    grade: "At-the-money and near expiration is where a real move pays more than the straight delta line. A one-tick target does not get that credit.",
    body: "Gamma is the change in delta, largest at the money, and it rises as time runs out. A long contract gains delta as the move goes its way, so the payoff beats delta times the points when the move is a real fraction of the expected range. The same fact cuts the other way. A 0DTE contract can go from a half delta to a fifth or to four fifths on one push. The scorer stays on the delta line because the chain quote does not carry gamma. It refuses the strikes where that line is a fantasy.",
  },
  {
    id: "theta",
    title: "Theta and the clock",
    grade: "After 14:00 ET a same-day contract under 0.40 delta has its win cut. After 15:00 a same-day contract under 0.45 is not taken.",
    body: "Theta eats only extrinsic value, and on a 0DTE that value is zero at the close. The decay is shallow while hours remain and steep in the last hour, which is also when gamma is most violent. A contract that is not moving into that hour is the base case of a total loss even if the wick has not broken. One extra day of expiration wins only when its ask still returns more per dollar than the same-day contract.",
  },
  {
    id: "breakeven",
    title: "What the target has to pay",
    grade: "Delta times the target, times how much of the move reaches the strike, has to cover the ask. If it does not, the contract is not a candidate.",
    body: "Premium is intrinsic plus extrinsic. Deep in the money barely decays and barely returns a percent, because you paid for the intrinsic. Out of the money is all extrinsic. At expiration a call breaks even at the strike plus the debit. On an intraday sale the bar is the debit divided by the delta: that many points of the underlying have to print, in the direction of the trade, before the contract has earned back what you paid. A pool closer than that is not a take-profit. It is a target the option cannot reach in dollars.",
  },
  {
    id: "iv",
    title: "The volatility you pay",
    grade: "A news spike that has not been retested is still a stand. The expected-move penalty is the quiet version of the same rule.",
    body: "A long contract is long volatility. If the move that prints is smaller than the volatility in the ask, direction can be right and the contract still loses. Into a scheduled print the implied volatility is the event, and it collapses after the number. Buying the wide quote before the retest is paying for a move that is about to be marked down. After the crush, the same delta is cheaper and the return on the structural trade is the one worth scoring.",
  },
  {
    id: "spread",
    title: "The spread is a certain loss",
    grade: "A book wider than 8 percent of the ask is not scored. Wider than 15 percent of the mid was already unusable.",
    body: "You pay the spread on the way in. On SPY and QQQ the at-the-money book is often one or two cents. One strike away, ten cents on a dollar option is a tenth of the debit gone before the idea works. A tighter book at a slightly worse delta beats a wide book with a prettier theoretical return, because the theoretical return is not the fill. The ticket still rests a limit at the array until price is inside it, and a marketable limit is the live ask only then.",
  },
  {
    id: "charm",
    title: "Delta does not sit still",
    grade: "The afternoon cut on a low delta is the charm rule. The delta on the quote is not the delta you will have at the pool.",
    body: "Charm is delta changing as time passes with the underlying unchanged. An out-of-the-money 0DTE delta bleeds toward zero. A 0.35 delta at 10:00 that is still out of the money at 15:00 will not pay the target at 0.35. The grade that matters is the delta likely to be left when the pool trades. A target that lives in the last hour has to be close enough to the money that time cannot take the delta first.",
  },
  {
    id: "ev",
    title: "Return per dollar",
    grade: "The winner is the highest expected return inside $50–$550, after the spread. Two contracts are used only to clear $50, never to inflate a worse strike.",
    body: "The number is the probability the target prints before the stop, times what the contract gains on that path, minus the probability of the stop, times what it loses, divided by the debit. The loss cannot exceed the debit. A higher dollar win on a contract that costs twice as much is a worse trade when the ratio is lower. Adding a second contract does not change the ratio. It changes how many dollars you can lose.",
  },
  {
    id: "pin",
    title: "The pin in the last hour",
    grade: "After 15:00 the book will not buy a same-day strike the move has not already reached. A pool beyond a heavy strike is a morning target.",
    body: "Into the last ninety minutes a strike with a large share of the day's open interest can pull price toward it. Dealers short that strike buy below it and sell above it. A pool just beyond that strike is a worse target at 15:10 than the same pool at 10:30. The chain the desk reads does not carry open interest, so the rule is the clock and the distance to the strike, not a pin score the quote does not have.",
  },
  {
    id: "liquidity",
    title: "Size on the ask",
    grade: "SPY and QQQ, same day or next day, at the money and the strikes the move reaches. A model price is not a market.",
    body: "A one-lot quote can be a penny wide and still not be a fill. The book that fills is SPY and QQQ, zero to two days, near the money. QQQ's higher volatility pays more on the same percent move, and the at-the-money spread is still usually a few cents, so QQQ is the contract when both indexes tell the same story. Far wings are left out by the delta band and by the spread rule together.",
  },
  {
    id: "defined",
    title: "The loss is the debit",
    grade: "Long premium only, $50 to $550, no average, no naked short. The 25 percent premium cut is the disaster stop. The plan is still the wick and the pool.",
    body: "A long call or put cannot lose more than what was paid. The unsafe versions are more contracts on a cheap strike, adding to a loser, and holding a 0DTE that is not moving because the wick has not broken. The option can be worth nothing while the underlying is still short of the stop. Exit at the pool when the pool clears the debit. If the option is already up and the pool has not printed, the old trim still applies. It is not a reason to invent a closer target.",
  },
  {
    id: "session",
    title: "The same strike is a different trade later",
    grade: "Open to 14:00 is the book. 14:00 cuts the far delta. 15:00 does not open a new same-day lottery.",
    body: "From the open until about 14:00 there is enough time for a 0.30 to 0.65 delta to pay a target inside the expected move. After 14:00 a same-day contract under 0.40 delta is charged for the time. After 15:00 a same-day contract under 0.45 is not taken at all. A next-day contract is still in the race if its ask earns the extra premium. The clock is checked in New York time off the quote, not off the machine.",
  },
];
