/**
 * What is known about trading event contracts — printed above the board.
 *
 * Only facts with a source, or arithmetic anyone can check. Researched
 * 2026-09-27; several sources are working papers or preprints and say so.
 * The point is the same as the Invest tab's base rates: the most useful
 * number for someone about to trade is how the activity usually goes.
 */

export interface PredictFact {
  id: string;
  headline: string;
  detail: string;
  url: string | null;
}

export const PREDICT_EVIDENCE: PredictFact[] = [
  {
    id: "venue",
    headline: "Robinhood's NFL price is not Kalshi's order book.",
    detail:
      "On 2026-09-27 Robinhood's NFL moneylines were listed on Rothera (the Robinhood–Susquehanna exchange); Robinhood also routes football to OG.com and Kalshi. Kalshi's public book is the closest public proxy — Robinhood's displayed prices summed to 101–103¢ per game that morning, Kalshi's to 101¢ — so read the board as within a cent or two of what you will be filled at, and check the contract-terms link on the Robinhood event page for the listing exchange.",
    url: "https://robinhood.com/us/en/support/articles/event-contracts-overview/",
  },
  {
    id: "martingale",
    headline: "Selling into a rise is not an edge.",
    detail:
      "If prices are fair probabilities, the chance of ever touching a sell target q from an entry p is p/q (less with scoring jumps), and the expected value of 'sell at q, else hold' is exactly p before costs (Aldous 2013, optional stopping). Worked: 100 contracts at 25¢ with a 40¢ target via Robinhood→Rothera expect $2.30 of fees — about −9.2% of the stake before the spread. Only a mispriced ENTRY pays.",
    url: "https://pi.math.cornell.edu/~levine/4740/2013/aldous-prediction-markets.pdf",
  },
  {
    id: "longshot",
    headline: "The cheapest contracts lose the most.",
    detail:
      "Kalshi 2021–2025: contracts costing 10¢ or less lost more than 60% of the money put in after taker fees, while contracts above 70¢ earned small positive returns (Bürgi, Deng & Whelan 2026, working paper). Horse racing 1992–2001: 100/1 longshots returned about −61% vs −5.5% for favorites (Snowberg & Wolfers 2010). For NFL underdogs at 15–45¢ the measured bias is small next to the fees.",
    url: "https://www.karlwhelan.com/Papers/Kalshi.pdf",
  },
  {
    id: "late-game",
    headline: "Do not buy a trailing underdog in the final minutes.",
    detail:
      "Near the end of games, low-priced contracts win less often than their price says (Kalshi NBA/MLB/NHL, final 10 minutes — Moshrefi 2026 preprint; InTrade sports — Page 2012). The board flags a live side under 30¢ in the fourth quarter.",
    url: "https://arxiv.org/abs/2607.14430",
  },
  {
    id: "takers",
    headline: "Takers pay, makers get paid.",
    detail:
      "Across 72 million Kalshi trades, takers averaged −1.12% per trade and makers +1.12% (Becker 2026, working paper); Kalshi takers lost an estimated $583.5M net since launch, $371.6M of it on sports (Roosevelt Institute, 2026). Rest a limit at the bid instead of paying the ask when you can — the spread is a cost every round trip pays twice.",
    url: "https://jbecker.dev/research/prediction-market-microstructure",
  },
  {
    id: "live-lag",
    headline: "Live prices lag the model — but not by enough to trade.",
    detail:
      "In live Kalshi NBA markets, a one-minute change in public win probability moved the price only 0.64-for-one and the gap predicted drift, yet buying at the ask and selling at the bid still lost money over 5 minutes before fees (arXiv 2606.07811 preprint). A board 'gap' in a live game is often ESPN's model not having caught up, or the spread you would pay.",
    url: "https://arxiv.org/abs/2606.07811",
  },
];
