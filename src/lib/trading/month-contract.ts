/**
 * The month ticket. Size, stop, and target are rules. The win rate is a result.
 *
 * A contract is about $150. The account funds one ticket. The stop is 30% of
 * the debit. The winner is a double. A count does not stand a ticket down.
 * Nine closes is the sample that raises size. A win does not.
 */

export const CONTRACT_USD = 150;
export const STOP_FRAC = 0.3;
export const CLOSES_PER_MONTH = 9;
export const SAMPLE = 9;

export interface MonthTicket {
  equity: number;
  contracts: number;
  debit: number;
  stop: number;
  winner: number;
  ratio: number;
  winRateFor2k: number;
  winRateFor3k: number;
}

export interface MonthClose {
  win: boolean;
  /** Dollars gained on a win, or lost on a loss. Both positive. */
  dollars: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Starting size. Half the account is the cap, so a missed stop is not the account. */
export function contractsForEquity(equity: number): number {
  if (!(equity > 0)) return 1;
  const cap = Math.max(1, Math.floor((equity * 0.5) / CONTRACT_USD));
  const start = equity >= 1600 ? 4 : equity >= 900 ? 3 : 2;
  return clamp(start, 1, cap);
}

export function ticketForEquity(equity: number, contracts = contractsForEquity(equity)): MonthTicket {
  const n = clamp(Math.floor(contracts), 1, Math.max(1, Math.floor((equity * 0.5) / CONTRACT_USD)));
  const debit = n * CONTRACT_USD;
  const stop = Math.round(debit * STOP_FRAC);
  const winner = debit;
  return {
    equity,
    contracts: n,
    debit,
    stop,
    winner,
    ratio: stop > 0 ? winner / stop : 0,
    winRateFor2k: winRateFor(2000, winner, stop),
    winRateFor3k: winRateFor(3000, winner, stop),
  };
}

/** Win rate that nets `target` over nine tickets at this payoff. Above 1 means the payoff cannot. */
export function winRateFor(target: number, winner: number, stop: number): number {
  const need = target / CLOSES_PER_MONTH;
  return (need + stop) / (winner + stop);
}

export function monthDollars(winRate: number, ticket: MonthTicket): number {
  const p = clamp(winRate, 0, 1);
  return CLOSES_PER_MONTH * (p * ticket.winner - (1 - p) * ticket.stop);
}

export function sampleOf(closes: MonthClose[]) {
  const n = closes.length;
  const wins = closes.filter((c) => c.win);
  const losses = closes.filter((c) => !c.win);
  const wr = n > 0 ? wins.length / n : 0;
  const avgWin = wins.length ? wins.reduce((s, c) => s + c.dollars, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, c) => s + c.dollars, 0) / losses.length : 0;
  return { n, wins: wins.length, wr, avgWin, avgLoss };
}

/**
 * One contract up, and only after a full sample. A single win does not size.
 * The average winner has to be the double, and the average loser has to be at or under the stop.
 */
export function nextContracts(equity: number, closes: MonthClose[]): { contracts: number; cleared: boolean; why: string } {
  const now = ticketForEquity(equity);
  const cap = Math.max(1, Math.floor((equity * 0.5) / CONTRACT_USD));
  const s = sampleOf(closes);
  if (s.n < SAMPLE) {
    return { contracts: now.contracts, cleared: false, why: `${s.n} of ${SAMPLE} closes. Size stays ${now.contracts}.` };
  }
  const last = closes.slice(-SAMPLE);
  const tail = sampleOf(last);
  const wrOk = tail.wr + 1e-9 >= now.winRateFor2k;
  const winOk = tail.avgWin + 1e-9 >= now.winner;
  const lossOk = tail.avgLoss <= now.stop + 1e-9;
  if (wrOk && winOk && lossOk) {
    const next = Math.min(cap, now.contracts + 1);
    return {
      contracts: next,
      cleared: true,
      why: next === now.contracts
        ? `Sample cleared. Already at the half-account cap, ${now.contracts} contracts.`
        : `Sample cleared. Size is ${next} contracts, one up. Not a raise on the last win.`,
    };
  }
  return {
    contracts: now.contracts,
    cleared: false,
    why: `Sample missed. ${Math.round(tail.wr * 100)}% versus ${Math.round(now.winRateFor2k * 100)}% for $2,000. Size stays ${now.contracts}.`,
  };
}

export function monthContractLine(equity: number): string {
  const t = ticketForEquity(equity);
  const at40 = Math.round(monthDollars(0.4, t));
  return `Month ticket. ${t.contracts} contracts at $${CONTRACT_USD}, debit $${t.debit}. Stop $${t.stop}, a double pays $${t.winner}, ${t.ratio.toFixed(1)} to 1. No count stands a ticket down. $${2000} needs ${Math.round(t.winRateFor2k * 100)}%. $${3000} needs ${Math.round(t.winRateFor3k * 100)}%. At the measured 40% nine of these net about $${at40} if every stop fills. Size rises one contract after nine closes clear, not on a win.`;
}

/** What the card and the floor say. Armed is anticipation. Live is the entry. */
export function entryCall(tier: string | null, entry: number | null): { label: string; act: string } {
  const px = entry != null ? entry.toFixed(2) : "the array";
  if (tier === "live") return { label: "ENTER", act: `Price is in the array. Rest the limit at ${px}. This is the fill, and the month ticket.` };
  if (tier === "armed") return { label: "ANTICIPATION", act: `Ready, not filled. Wait for price to come into ${px}. Do not enter on the arm.` };
  if (tier === "forming") return { label: "ANTICIPATION", act: `Early. The entry is ${px} when price returns. Look away until the touch.` };
  if (tier === "gone") return { label: "ENTRY GONE", act: `Price left ${px}. Do not chase. The next entry is a new pullback into the array.` };
  return { label: "ANTICIPATION", act: `The sequence is not complete. ${px} is the entry only after the array prints and price is in it.` };
}
