/**
 * Rule 1 SHADOW Δ0.70 0DTE ticket (audits/overnight-1016/report.md item 1). Pure and read-only.
 * Same signal as rule1.ts; only the option leg differs: strike at |Δ| = 0.70 instead of ATM (Δ0.5), always 0DTE, at most
 * maxContracts with debit ≤ debitCap. A ticket whose ONE contract costs more than the cap is a no-trade (capBlocked, 0 contracts),
 * exactly as the study counted it. Config: shared/rule1-d70.json (outside the rules hash). live is false: nothing sizes,
 * stages or places an order from this; the current ticket and the live order path are unchanged.
 */
import CFG from "../../../shared/rule1-d70.json";
import R1 from "../../../shared/rule1.json";

export type D70Leg = {
  delta: number; underlier: string; right: "call" | "put"; strike: number; premium: number;
  contracts: number; debit: number; capBlocked: boolean; dte: 0;
};
export type Rule1D70 = { mode: "shadow"; live: false; version: number; d70: D70Leg | null; atm: D70Leg | null };

const ncdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
function erf(x: number): number { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
function ninv(p: number): number { let lo = -8, hi = 8; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (ncdf(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; }
function bsCall(S: number, K: number, tau: number, sig: number): number {
  const v = sig * Math.sqrt(Math.max(tau, 1e-7)); const d1 = (Math.log(S / K) + 0.5 * v * v) / v; return S * ncdf(d1) - K * ncdf(d1 - v);
}

/** One 0DTE leg at |delta| (same flat-IV model as rule1.ts pickOption, so the two tickets are comparable). */
export function legAt(delta: number, symbol: string, side: "long" | "short", px: number, atr5: number, minCT: number, underPx?: number | null): D70Leg | null {
  const o = R1.option; const root = symbol.replace(/[^A-Z]/g, "");
  const ratio = (o.ratio as Record<string, number>)[root]; const und = (o.underlier as Record<string, string>)[root];
  if (!ratio || !und || !(px > 0) || !(atr5 > 0)) return null;
  const S = underPx ?? px * ratio;
  const tau = Math.max(1, 900 - minCT) / (252 * 390);                   // 0DTE: minutes to the 15:00 CT close
  const sig = o.ivOverRealized * (atr5 / (1.6 * px)) * Math.sqrt(78 * 252);
  const z = ninv(delta); const v = sig * Math.sqrt(tau);
  const K = side === "long" ? S * Math.exp(-z * v + 0.5 * v * v) : S * Math.exp(z * v + 0.5 * v * v);
  const strike = Math.round(K);
  const prem = side === "long" ? bsCall(S, strike, tau, sig) : bsCall(S, strike, tau, sig) - S + strike;
  const n = prem > 0 ? Math.min(CFG.maxContracts, Math.floor(CFG.debitCap / (prem * 100))) : 0;
  const capBlocked = n < 1;
  const contracts = capBlocked ? 0 : n;
  return { delta, underlier: und, right: side === "long" ? "call" : "put", strike, premium: +prem.toFixed(2), contracts, debit: +(prem * 100 * contracts).toFixed(2), capBlocked, dte: 0 };
}

export function rule1D70(symbol: string, side: "long" | "short", px: number, atr5: number, minCT: number, underPx?: number | null): Rule1D70 {
  return { mode: "shadow", live: false, version: CFG.version, d70: legAt(CFG.delta, symbol, side, px, atr5, minCT, underPx), atm: legAt(CFG.compareDelta, symbol, side, px, atr5, minCT, underPx) };
}

const legTxt = (l: D70Leg | null) => (!l ? "—" : l.capBlocked ? `${l.underlier} ${l.strike}${l.right[0]!.toUpperCase()} over the $${CFG.debitCap} cap (no trade)` : `${l.contracts}× ${l.underlier} ${l.strike}${l.right[0]!.toUpperCase()} ~$${l.premium} ($${l.debit})`);
/** One line for the brain seat / Floor: the shadow Δ0.7 ticket next to the current Rule 1 ticket and ATM. */
export function rule1D70Line(t: { symbol: string; side: string; option?: { underlier: string; strike: number | null; right: string; delta: number; contracts: number; premium: number | null } | null; ticketD70?: Rule1D70 | null }): string {
  const cur = t.option ? `${t.option.contracts}× ${t.option.underlier} ${t.option.strike ?? "?"}${t.option.right[0]!.toUpperCase()} Δ${t.option.delta}` : "—";
  return `Rule1 shadow ${t.symbol} ${t.side}: Δ0.7 0DTE ${legTxt(t.ticketD70?.d70 ?? null)} · ATM ${legTxt(t.ticketD70?.atm ?? null)} · current ${cur} (shadow, no order)`;
}
