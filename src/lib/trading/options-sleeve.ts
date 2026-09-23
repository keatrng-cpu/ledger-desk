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
 * LEGACY MODEL. $1,000 is treated as the account and 15% of it ($150) as the
 * maximum debit per ticket.
 *
 * The trader replaced this on 2026-09-23: the sleeve now risks up to a
 * $1,000 DEBIT per trade with the loss capped at 15% OF THE DEBIT. Under the
 * old model those two were the same $150 number and could safely be
 * conflated; under the new one they are $1,000 and 15%-of-what-you-paid, and
 * conflating them would overstate size by up to 6.7x or understate risk by
 * the same factor.
 *
 * `src/lib/trading/sleeve-sizing.ts` is the authority now. This function is
 * kept because four modules still call it — options-desk.ts:855,
 * options-swing.ts:263, overnight-swing.ts:303 and entry-trigger-panel.tsx:72
 * — and repointing all four in one edit would change live risk numbers in
 * several places at once, which is the specific thing trading.md forbids.
 * Each call site needs deciding INDIVIDUALLY: some of them want the debit
 * ceiling (MAX_DEBIT_USD) and some want the loss cap, and today they cannot
 * tell because one number answered both.
 */
export function rhMaxDebit(s: RhSleeve = RH_SLEEVE_DEFAULT): number {
  return Math.round(s.equity * s.riskPct);
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
