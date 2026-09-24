/**
 * Robinhood options sleeve — separate from the $100k futures paper book.
 * User plan: buy ~$1,000 of QQQ/SPY contracts, risk 15% ($150) per thesis.
 *
 * Defined risk = debit paid. A 15% stop on a $1,000 0DTE pile can gap
 * through; capping the debit at $150 is the only honest $150.
 */

export const RH_SLEEVE_STORAGE = "ledger-rh-sleeve-v1";
export const RH_SLEEVE_EVENT = "ledger-rh-sleeve";

export interface RhSleeve {
  equity: number;
  riskPct: number;
}

export const RH_SLEEVE_DEFAULT: RhSleeve = {
  equity: 1_000,
  riskPct: 0.15,
};

/**
 * THE TICKET CEILING — the most this trade may COST.
 *
 * Under the model the trader set on 2026-09-23 the sleeve's $1,000 is the
 * per-trade debit cap, not an account balance to take a percentage of.
 *
 * This replaces the old conflated accessor, which returned `equity × riskPct`
 * = $150 and was used by four call sites that meant two different things by
 * it. Under the OLD model ("$1,000 account, 15% = $150 max debit") the ceiling and the
 * loss cap were the same $150 and could be conflated safely. Under the new
 * one they are $1,000 and 15%-of-what-you-paid, so one number cannot answer
 * both: reading the ceiling as the loss overstates risk 6.7x, and reading the
 * loss as the ceiling sized every ticket at a sixth of the intended size —
 * which is what the desk was actually doing.
 *
 * The old function is DELETED rather than deprecated, so the compiler names
 * every site instead of leaving a silently-wrong default in place.
 */
export function rhTicketCapUsd(s: RhSleeve = RH_SLEEVE_DEFAULT): number {
  return Math.round(s.equity);
}

/**
 * THE LOSS BUDGET — the most this trade may LOSE.
 *
 * 15% of the ceiling by default. `riskPct` overrides it for graded sizing
 * (a probe risks less than an A), which is how the swing book already
 * grades and has never applied.
 *
 * Note this is the budget a ticket is SIZED against, not a stop that fires:
 * `sleeve-sizing.ts` puts this many dollars at the futures plan's
 * invalidation, and the premium brake is a backstop behind it.
 */
export function rhRiskBudgetUsd(
  s: RhSleeve = RH_SLEEVE_DEFAULT,
  riskPct?: number,
): number {
  return Math.round(s.equity * (riskPct ?? s.riskPct));
}

function clampSleeve(p: Partial<RhSleeve>): RhSleeve {
  const equity = Number(p.equity);
  const riskPct = Number(p.riskPct);
  return {
    equity: Number.isFinite(equity) ? Math.min(25_000, Math.max(200, Math.round(equity))) : 1_000,
    riskPct: Number.isFinite(riskPct) ? Math.min(0.25, Math.max(0.05, riskPct)) : 0.15,
  };
}

export function loadRhSleeve(): RhSleeve {
  if (typeof window === "undefined") return { ...RH_SLEEVE_DEFAULT };
  try {
    const raw = localStorage.getItem(RH_SLEEVE_STORAGE);
    if (!raw) return { ...RH_SLEEVE_DEFAULT };
    return clampSleeve(JSON.parse(raw) as Partial<RhSleeve>);
  } catch {
    return { ...RH_SLEEVE_DEFAULT };
  }
}

export function saveRhSleeve(next: Partial<RhSleeve>): RhSleeve {
  const s = clampSleeve({ ...loadRhSleeve(), ...next });
  if (typeof window !== "undefined") {
    localStorage.setItem(RH_SLEEVE_STORAGE, JSON.stringify(s));
    window.dispatchEvent(new Event(RH_SLEEVE_EVENT));
  }
  return s;
}

export function subscribeRhSleeve(fn: (s: RhSleeve) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const on = () => fn(loadRhSleeve());
  window.addEventListener(RH_SLEEVE_EVENT, on);
  window.addEventListener("storage", on);
  return () => {
    window.removeEventListener(RH_SLEEVE_EVENT, on);
    window.removeEventListener("storage", on);
  };
}
