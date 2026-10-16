/**
 * Rule 1 SHADOW ticket (audits/entry-target-1015). Pure: 1m bars in, at most one ticket per symbol per day out.
 *   setup  08:30–09:00 CT: a 5m bar sweeps the ON or prior-day high/low (untouched in the 2h before the 60-min sweep
 *          window), then a 5m displacement (body ≥ 1.5× mean 12-bar range) the other way; bonus when body ≥ 3×.
 *   entry  market at the displacement close · stop 15-min 1m structure low/high (± 0.02×range) · target 3R ·
 *          runner = nearest ON high/low ≥ 0.5R beyond entry.
 * Never gates or fires anything; config in shared/rule1.json (outside the rules hash). Python mirror: scripts/rule1.py.
 */
import CFG from "../../../shared/rule1.json";
import type { OhlcBar } from "@/lib/market/types";
import { rule1D70, type Rule1D70 } from "./rule1-d70";

export type Rule1Ticket = {
  mode: "shadow"; version: number; symbol: string; side: "long" | "short"; at: number; dispAt: number;
  swept: "ONL" | "PDL" | "ONH" | "PDH"; level: number; bodyAtr: number; bonus: boolean;
  entry: number; stop: number; riskPts: number; target: number; runner: number | null; runnerR: number | null;
  option: { underlier: string; right: "call" | "put"; delta: number; strike: number | null; premium: number | null; contracts: number; dte: 0 | 1 } | null;
  /** SHADOW Δ0.70 0DTE ticket next to `option` (shared/rule1-d70.json, overnight-1016 item 1). Display/log only; never sizes or fires. */
  ticketD70?: Rule1D70 | null;
};

const MIN = 60_000;
export function ctParts(ms: number): { min: number; day: string } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { min: Number(g("hour")) * 60 + Number(g("minute")), day: `${g("year")}-${g("month")}-${g("day")}` };
}
/** 5m bars (left-labelled, CT-aligned since CT offsets are whole hours) from 1m. */
export function to5m(m1: OhlcBar[]): OhlcBar[] {
  const out: OhlcBar[] = [];
  for (const b of m1) {
    const t = Math.floor(b.t / (5 * MIN)) * 5 * MIN;
    const last = out[out.length - 1];
    if (last && last.t === t) { last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.c = b.c; }
    else out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c } as OhlcBar);
  }
  return out;
}
/** ON = 17:00 prior day → 08:30 CT; PD = prior RTH 08:30–15:00 CT. From 1m bars. */
export function keyLevels(m1: OhlcBar[], day: string): { onh: number | null; onl: number | null; pdh: number | null; pdl: number | null } {
  let onh = -Infinity, onl = Infinity, pdh = -Infinity, pdl = Infinity, pday: string | null = null;
  const days = [...new Set(m1.map((b) => ctParts(b.t).day))].sort();
  const i = days.indexOf(day); pday = i > 0 ? days[i - 1]! : null;
  for (const b of m1) {
    const { min, day: d } = ctParts(b.t);
    if ((d === day && min < 510) || (d === pday && min >= 1020)) { onh = Math.max(onh, b.h); onl = Math.min(onl, b.l); }
    if (d === pday && min >= 510 && min < 900) { pdh = Math.max(pdh, b.h); pdl = Math.min(pdl, b.l); }
  }
  const f = (x: number) => (Number.isFinite(x) ? x : null);
  return { onh: f(onh), onl: f(onl), pdh: f(pdh), pdl: f(pdl) };
}
const ncdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
function erf(x: number): number { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
function ninv(p: number): number { let lo = -8, hi = 8; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (ncdf(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; }
export function bsCall(S: number, K: number, tau: number, sig: number): number {
  const v = sig * Math.sqrt(Math.max(tau, 1e-7)); const d1 = (Math.log(S / K) + 0.5 * v * v) / v; return S * ncdf(d1) - K * ncdf(d1 - v);
}
/** Strike at the target delta (model, flat IV); premium per share; contracts under the debit cap. */
export function pickOption(symbol: string, side: "long" | "short", px: number, atr5: number, minCT: number, underPx?: number | null): Rule1Ticket["option"] {
  const o = CFG.option; const root = symbol.replace(/[^A-Z]/g, "").replace(/^M(?=NQ|ES)/, "M");
  const ratio = (o.ratio as Record<string, number>)[root] ?? null; const und = (o.underlier as Record<string, string>)[root] ?? null;
  if (!ratio || !und) return null;
  const S = underPx ?? px * ratio;
  const dte: 0 | 1 = minCT < 810 ? 0 : 1;
  const tau = ((900 - minCT) + dte * 390) / (252 * 390);
  const sig = o.ivOverRealized * (atr5 / (1.6 * px)) * Math.sqrt(78 * 252);
  const z = ninv(o.delta); const v = sig * Math.sqrt(tau);
  // call delta N(d1)=δ → K = S·exp(−z·v + v²/2); put mirrors with the same |δ|
  const K = side === "long" ? S * Math.exp(-z * v + 0.5 * v * v) : S * Math.exp(z * v + 0.5 * v * v);
  const strike = Math.round(K);
  const prem = side === "long" ? bsCall(S, strike, tau, sig) : bsCall(S, strike, tau, sig) - S + strike;
  const contracts = prem > 0 ? Math.max(1, Math.min(o.maxContracts, Math.floor(o.debitCap / (prem * 100)))) : 1;
  return { underlier: und, right: side === "long" ? "call" : "put", delta: o.delta, strike, premium: +prem.toFixed(2), contracts, dte };
}

export function rule1Ticket(symbol: string, m1: OhlcBar[], nowMs: number, underPx?: number | null): Rule1Ticket | null {
  if (!m1?.length) return null;
  const closed1 = m1.filter((b) => b.t + MIN <= nowMs);
  const { day } = ctParts(nowMs);
  const lv = keyLevels(closed1, day);
  const b5 = to5m(closed1).filter((b) => b.t + 5 * MIN <= nowMs);
  for (let k = CFG.sweepCleanBars5 + CFG.sweepLookbackBars5; k < b5.length; k++) {
    const b = b5[k]!; const { min, day: d } = ctParts(b.t);
    if (d !== day || min < CFG.window.fromMin || min >= CFG.window.toMin) continue;
    const rng = b5.slice(k - CFG.atrBars5, k).reduce((a, x) => a + (x.h - x.l), 0) / CFG.atrBars5;
    if (!(rng > 0)) continue;
    const body = b.c - b.o;
    if (Math.abs(body) < CFG.dispBodyAtr * rng) continue;
    const side: "long" | "short" = body > 0 ? "long" : "short";
    const win = b5.slice(k - CFG.sweepLookbackBars5, k + 1);
    const pre = b5.slice(k - CFG.sweepLookbackBars5 - CFG.sweepCleanBars5, k - CFG.sweepLookbackBars5);
    const cands: [Rule1Ticket["swept"], number | null][] = side === "long" ? [["ONL", lv.onl], ["PDL", lv.pdl]] : [["ONH", lv.onh], ["PDH", lv.pdh]];
    const hit = cands.find(([, L]) => L != null && (side === "long"
      ? Math.min(...win.map((x) => x.l)) < L && Math.min(...pre.map((x) => x.l)) >= L
      : Math.max(...win.map((x) => x.h)) > L && Math.max(...pre.map((x) => x.h)) <= L));
    if (!hit) continue;
    const entry = b.c; const at = b.t + 5 * MIN;
    const look = closed1.filter((x) => x.t >= at - CFG.stopLookbackMin * MIN && x.t < at);
    if (!look.length) continue;
    const stop = side === "long" ? Math.min(...look.map((x) => x.l)) - CFG.stopBufferAtr * rng : Math.max(...look.map((x) => x.h)) + CFG.stopBufferAtr * rng;
    const risk = side === "long" ? entry - stop : stop - entry;
    if (!(risk > 0.05 * rng)) continue;
    const s = side === "long" ? 1 : -1;
    const on = side === "long" ? lv.onh : lv.onl;
    const runner = on != null && s * (on - entry) >= CFG.runnerMinR * risk ? on : null;
    const r2 = (x: number) => Math.round(x * 100) / 100;
    return {
      mode: "shadow", version: CFG.version, symbol, side, at, dispAt: b.t, swept: hit[0], level: hit[1]!, bodyAtr: +(Math.abs(body) / rng).toFixed(2),
      bonus: Math.abs(body) >= CFG.bonusBodyAtr * rng, entry: r2(entry), stop: r2(stop), riskPts: r2(risk), target: r2(entry + s * CFG.targetR * risk),
      runner, runnerR: runner != null ? +((s * (runner - entry)) / risk).toFixed(2) : null,
      option: pickOption(symbol, side, entry, rng, ctParts(at).min, underPx),
      ticketD70: rule1D70(symbol, side, entry, rng, ctParts(at).min, underPx),
    };
  }
  return null;
}
