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
