/**
 * What is known about trading event contracts — printed above the board.
 *
 * Only facts with a source, or arithmetic anyone can check. The point is the
 * same as the Invest tab's base rates: the most useful number for someone
 * about to trade is how the activity usually goes.
 */

export interface PredictFact {
  id: string;
  headline: string;
  detail: string;
  url: string | null;
}

export const PREDICT_EVIDENCE: PredictFact[] = [
  {
    id: "martingale",
    headline: "Selling into a rise is not an edge.",
    detail:
      "If a contract's price is a fair probability, its expected price at any later moment equals today's price, so no rule for WHEN to sell changes the expected result — it trades many small wins for occasional full losses and pays fees twice. The only thing that makes a round trip profitable on average is buying below fair value.",
    url: null,
  },
  {
    id: "longshot",
    headline: "Cheap underdogs are the most overpriced contracts, on average.",
    detail:
      "The favorite–longshot bias is one of the most replicated findings in betting markets: bettors overpay for longshots, so low-priced contracts return less per dollar than favorites. Buying underdogs is the side the evidence says to be most careful with.",
    url: "https://www.journals.uchicago.edu/doi/10.1086/655844",
  },
  {
    id: "costs",
    headline: "Every trade pays the spread and a fee.",
    detail:
      "Buying at the ask and selling at the bid gives up the spread, and each side pays the exchange fee plus Robinhood's commission. The calculator below prices a round trip before you place it.",
    url: "https://kalshi.com/docs/kalshi-fee-schedule.pdf",
  },
  {
    id: "reference",
    headline: "The board compares, it does not predict.",
    detail:
      "Before kickoff the reference is DraftKings' moneyline with the bookmaker's margin removed; during the game it is ESPN's live win probability. When Kalshi's ask sits below the reference after fees, that is a gap IF the reference is right — log the trade and let your own record show whether gaps like it pay.",
    url: null,
  },
];
