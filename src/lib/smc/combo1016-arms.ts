/**
 * combo1016 arms: SMC pnl-push finalists (audits/smc-research/pnl-push/report.md + tables_core.md, params_*.json), SHADOW ONLY.
 * They sit beside the unchanged combo1016 arm and share its S2 (score1016.v2) and gbmP (exported IS LightGBM) reads.
 *
 *   fire     S2 >= arm.fireS2 (70; 65 for config3_e75_s65) AND gbmP >= combo1016.gbm.thr (p90 of the fit window) AND no hard veto.
 *            Research refits every 26 weeks (rules combo1016Arms.gbm.refitWeeks): documented, no live refit.
 *   entry    market if chaseR <= 1, else a limit at the newest array edge valid 20 min, cancelled if price reaches +0.75R first.
 *   exits    TR  (config1_trail): 50% at 1R → stop to BE → runner trailed at MFE − 1R.
 *            E75 (config2_e75, config3_e75_s65, config2_e75_tier200_400): 50% at 0.75R → BE → 2R.  Flat by 14:55 CT.
 *   caps     5/day, 3/symbol, 1 open per symbol, halt after the first daily loss, re-arm only on a new setup id.
 *   sizing   fixed $/R (A+ = S2 >= 85 → arm.aPlusUsdPerR), never a percent of the account.
 *
 * Pure functions (no I/O). Python twins: pnl-push pp2.py (exits), pp3.py run() (selection), pp4.py opt_trade (option $),
 * and watcher/combo1016_arms.py. Nothing here writes q, band, plan, fire or size.
 */
import RULES from "../../../shared/desk-rules.json";
import { v2Subfactors, V2_LAYERS, type Side, type V2Raw } from "./combo1016";
import AGBM from "../../../shared/combo1016-arms-gbm.json";

type Exit = { mode: "TR" | "E75"; t1R: number; t1PartialFrac: number; beAfterT1: boolean; t2R?: number; trailR?: number };
export interface Arm { name: string; params: string; fireS2: number; exit: Exit; sizing: { baseUsdPerR: number; aPlusUsdPerR: number } }
type Blk = { mode: string; gbm: { refitWeeks: number; liveRefit: boolean; thr: number; sha256_16: string; window: string }; s2: { coef: Record<string, number>; intercept: number; lo: number; hi: number; medians: Record<string, number>; window: string }; entry: { marketWithinR: number; limitValidMin: number; cancelAtR: number };
  caps: { perDay: number; perSymbol: number; openPerSymbol: number; haltAfterLosses: number; flatByCt: string }; aPlusS2: number; costTicks: number;
  option: { etf: Record<string, string>; mult: Record<string, number>; spread: Record<string, number>; feePerContract: number; sigmaFloor: number; sigmaCap: number; sigmaAdj: number };
  arms: Record<string, Arm> };
export const AB: Blk = (RULES as unknown as { combo1016Arms: Blk }).combo1016Arms;
export const ARMS = AB.arms;
export const ARM_KEYS = Object.keys(ARMS);
export const ARMS_THR = AB.gbm.thr;
// ---------------------------------------------------------------- arms models: SMC walk-forward S2 + LightGBM (integration bundle window)
type Node = { v: number } | { f: number; t: number; d: 0 | 1; m: 0 | 1 | 2; l: Node; r: Node };
const AG = AGBM as unknown as { features: string[]; trees: Node[]; thr_q90: number };
export const ARMS_GBM_FEATURES = AG.features;
function leafA(n: Node, x: (number | null)[]): number {
  while (!("v" in n)) {
    const raw = x[n.f]; const isNan = raw == null || !Number.isFinite(raw); let left: boolean;
    if (n.m === 2 && isNan) left = n.d === 1; else if (n.m === 1 && (isNan || raw === 0)) left = n.d === 1; else left = (isNan ? 0 : raw!) <= n.t;
    n = left ? n.l : n.r;
  }
  return n.v;
}
export function armsGbmP(feat: Record<string, number | null | undefined>): number {
  const x = AG.features.map((k) => { const v = feat[k]; return v == null ? null : Number(v); }); let z = 0; for (const t of AG.trees) z += leafA(t, x); return 1 / (1 + Math.exp(-z));
}
export function armsS2(x: V2Raw): { S2: number; z: number; filled: string[] } {
  const P = AB.s2; const sf = v2Subfactors(x); const filled: string[] = []; let z = P.intercept;
  for (const k of Object.values(V2_LAYERS).flat()) { let v = sf[k]; if (k === "ctx_htf4" && x.tr4h_with == null) { v = 0; filled.push(k); } else if (v == null || !Number.isFinite(v)) { v = P.medians[k]!; filled.push(k); } z += P.coef[k]! * v; }   // research: (NaN > 0) = False → ctx_htf4 0
  return { S2: 100 * Math.max(0, Math.min(1, (z - P.lo) / (P.hi - P.lo))), z, filled };
}
export const armsMode = (): "live" | "shadow" => (AB.mode === "live" ? "live" : "shadow");
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r2 = (x: number) => Math.round(x * 100) / 100;
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
export const flatByMin = (): number => { const [h, m] = AB.caps.flatByCt.split(":").map(Number); return h! * 60 + m!; };

// ---------------------------------------------------------------- fire + sizing
export interface ArmFire { arm: string; fire: boolean; aPlus: boolean; usdPerR: number; why: string }
export function armFire(key: string, S2: number, gbmP: number, vetoed = false): ArmFire {
  const a = ARMS[key]!; const okS = S2 >= a.fireS2, okG = gbmP >= ARMS_THR;
  const fire = !vetoed && okS && okG, aPlus = fire && S2 >= AB.aPlusS2;
  return { arm: key, fire, aPlus, usdPerR: aPlus ? a.sizing.aPlusUsdPerR : a.sizing.baseUsdPerR,
    why: `S2 ${S2.toFixed(1)} ${okS ? "≥" : "<"} ${a.fireS2} · gbmP ${gbmP.toFixed(3)} ${okG ? "≥" : "<"} ${ARMS_THR.toFixed(3)}${aPlus ? ` · A+ $${a.sizing.aPlusUsdPerR}/R` : ""}${vetoed ? " · hard veto" : ""}` };
}

// ---------------------------------------------------------------- plan
export interface ArmLeg { frac: number; R: number; px: number }
export interface ArmPlan { arm: string; mode: "TR" | "E75"; kind: "market" | "limit"; entry: number; stop: number; risk: number; chaseR: number; legs: ArmLeg[];
  beAfterT1: boolean; trailR: number | null; limitValidMin: number | null; cancelPx: number | null; flatByCt: string }
export function armPlan(key: string, i: { side: Side; price: number; edge: number; stop: number }): ArmPlan | null {
  const a = ARMS[key]!; const S = i.side === "short", d = S ? -1 : 1;
  // research (eng.py / SMC hybridEntry): chaseR = |next open − newest near edge| / risk of the MARKET anchor (|price − stop|), not riskEdge
  const riskMkt = Math.abs(i.stop - i.price);
  if (!(riskMkt > 0) || (S ? i.stop <= i.price : i.stop >= i.price) || (S ? i.stop <= i.edge : i.stop >= i.edge)) return null;
  const chaseR = Math.abs(i.price - i.edge) / riskMkt;
  const market = chaseR <= AB.entry.marketWithinR;
  const entry = market ? i.price : i.edge, r = Math.abs(i.stop - entry);
  const legs: ArmLeg[] = [{ frac: a.exit.t1PartialFrac, R: a.exit.t1R, px: entry + d * a.exit.t1R * r }];
  if (a.exit.mode === "E75") legs.push({ frac: 1 - a.exit.t1PartialFrac, R: a.exit.t2R!, px: entry + d * a.exit.t2R! * r });
  return { arm: key, mode: a.exit.mode, kind: market ? "market" : "limit", entry, stop: i.stop, risk: r, chaseR: r3(chaseR), legs, beAfterT1: a.exit.beAfterT1,
    trailR: a.exit.mode === "TR" ? a.exit.trailR ?? 1 : null, limitValidMin: market ? null : AB.entry.limitValidMin,
    cancelPx: market ? null : entry + d * AB.entry.cancelAtR * r, flatByCt: AB.caps.flatByCt };
}

// ---------------------------------------------------------------- exit simulation on closed 1m bars (pp2.py, stop-first)
export interface Bar { h: number; l: number; c: number }
export interface SimLeg { frac: number; px: number; k: number }
/** Bars from the fill bar through the last bar at/before the flat time. Returns R net of costTicks (2 ticks / risk), legs with bar offsets. */
export function armExitSim(key: string, bars: Bar[], side: Side, entry: number, risk: number, tick = 0.25): { R: number; legs: SimLeg[]; exitK: number } {
  const ex = ARMS[key]!.exit; const s = side === "long" ? 1 : -1; let st = entry - s * risk, rem = 1, R = 0; const legs: SimLeg[] = []; let done = false, k = 0;
  const last = bars.length - 1;
  if (ex.mode === "TR") {
    let t1 = false, hw = 0; const tr = ex.trailR ?? 1;
    for (k = 0; k <= last; k++) {
      const b = bars[k]!; const adv = s === 1 ? b.h - entry : entry - b.l;
      if (s === 1 ? b.l <= st : b.h >= st) { R += (rem * (st - entry) * s) / risk; legs.push({ frac: rem, px: st, k }); done = true; break; }
      if (!t1 && adv >= ex.t1R * risk) { t1 = true; R += ex.t1PartialFrac * ex.t1R; rem = 1 - ex.t1PartialFrac; legs.push({ frac: ex.t1PartialFrac, px: entry + s * ex.t1R * risk, k }); st = entry; }
      if (t1) { hw = Math.max(hw, adv / risk); st = entry + s * Math.max(0, hw - tr) * risk; }
    }
  } else {
    const tg = [{ f: ex.t1PartialFrac, x: ex.t1R }, { f: 1 - ex.t1PartialFrac, x: ex.t2R! }].map((t) => ({ ...t, px: entry + s * t.x * risk }));
    let j = 0;
    for (k = 0; k <= last; k++) {
      const b = bars[k]!;
      if (s === 1 ? b.l <= st : b.h >= st) { R += (rem * (st - entry) * s) / risk; legs.push({ frac: rem, px: st, k }); done = true; break; }
      while (j < tg.length && (s === 1 ? b.h >= tg[j]!.px : b.l <= tg[j]!.px)) {
        const t = tg[j]!; R += t.f * t.x; rem -= t.f; legs.push({ frac: t.f, px: t.px, k }); j++;
        st = j === 1 ? (ex.beAfterT1 ? entry : st) : entry + s * tg[j - 2]!.x * risk;
      }
      if (j >= tg.length || rem <= 1e-9) { done = true; break; }
    }
  }
  if (!done) { k = last; R += (rem * (bars[last]!.c - entry) * s) / risk; legs.push({ frac: rem, px: bars[last]!.c, k: last }); }
  return { R: R - (AB.costTicks * tick) / risk, legs, exitK: Math.min(k, last) };
}
/** pp2 limit fill: first bar (within limitValidMin) that trades the entry, unless +cancelAtR trades first. null = no fill. */
export function armLimitFill(bars: Bar[], side: Side, entry: number, risk: number): number | null {
  const s = side === "long" ? 1 : -1;
  for (let k = 0; k < Math.min(AB.entry.limitValidMin, bars.length - 1); k++) {
    const b = bars[k]!;
    if (s === 1 ? b.l <= entry : b.h >= entry) return k;
    if (s === 1 ? b.h >= entry + s * risk * AB.entry.cancelAtR : b.l <= entry + s * risk * AB.entry.cancelAtR) return null;
  }
  return null;
}

// ---------------------------------------------------------------- selection over a candidate stream (pp3.py run(): caps, open per symbol, day-loss halt)
export interface ArmCand { day: string; sym: string; fillT: number; exitT: number; R: number; S2: number; pgr: number }
export function armSelect(key: string, rows: ArmCand[]): number[] {
  const a = ARMS[key]!; const out: number[] = []; const dayn = new Map<string, number>(), symn = new Map<string, number>(), dls = new Map<string, number>(), busy = new Map<string, number>();
  rows.forEach((r, i) => {
    if (!(r.S2 >= a.fireS2 && r.pgr >= 1)) return;
    if ((dayn.get(r.day) ?? 0) >= AB.caps.perDay || (symn.get(`${r.day}|${r.sym}`) ?? 0) >= AB.caps.perSymbol || (dls.get(r.day) ?? 0) >= AB.caps.haltAfterLosses) return;
    const b = busy.get(r.sym); if (b != null && b >= r.fillT) return;
    busy.set(r.sym, r.exitT); dayn.set(r.day, (dayn.get(r.day) ?? 0) + 1); symn.set(`${r.day}|${r.sym}`, (symn.get(`${r.day}|${r.sym}`) ?? 0) + 1);
    if (r.R < 0) dls.set(r.day, (dls.get(r.day) ?? 0) + 1);
    out.push(i);
  });
  return out;
}

// ---------------------------------------------------------------- live day ledger
export interface ArmEntry { setupId: string; symbol: string; side: Side; kind: "market" | "limit"; entry: number; stop: number; risk: number; legs: ArmLeg[]; usdPerR: number; sealedAt: number;
  open: boolean; result?: "win" | "loss" | "be" | "cancel" | "expired" | "flat" | null }
export interface ArmDay { day: string; entries: ArmEntry[] }
export type ArmVerdict = { ok: true; why: string; sealed: ArmEntry } | { ok: false; why: string; sealed: ArmEntry | null };
const nonTrade = (e: ArmEntry) => e.result === "cancel" || e.result === "expired";
export function armAdmit(key: string, day: ArmDay, symbol: string, setupId: string, plan: ArmPlan, side: Side, usdPerR: number, now: number): ArmVerdict {
  const prev = day.entries.find((e) => e.setupId === setupId);
  if (prev) return { ok: false, why: `${key}: setup ${setupId} already sealed at ${prev.entry} (re-arm needs a new setup id)`, sealed: prev };
  const ents = day.entries.filter((e) => !nonTrade(e));
  const losses = ents.filter((e) => e.result === "loss").length;
  if (losses >= AB.caps.haltAfterLosses) return { ok: false, why: `${key}: halted for the day after ${losses} loss`, sealed: null };
  const n = ents.length, ns = ents.filter((e) => e.symbol === symbol).length, open = ents.filter((e) => e.symbol === symbol && e.open).length;
  if (n >= AB.caps.perDay) return { ok: false, why: `${key}: day cap ${n}/${AB.caps.perDay}`, sealed: null };
  if (ns >= AB.caps.perSymbol) return { ok: false, why: `${key}: ${symbol} cap ${ns}/${AB.caps.perSymbol}`, sealed: null };
  if (open >= AB.caps.openPerSymbol) return { ok: false, why: `${key}: ${symbol} already has ${open} open`, sealed: null };
  const sealed: ArmEntry = { setupId, symbol, side, kind: plan.kind, entry: plan.entry, stop: plan.stop, risk: plan.risk, legs: plan.legs, usdPerR, sealedAt: now, open: true, result: null };
  return { ok: true, why: `${key}: slot ${n + 1}/${AB.caps.perDay}, ${symbol} ${ns + 1}/${AB.caps.perSymbol}`, sealed };
}

// ---------------------------------------------------------------- 0DTE option $ estimate (pp4.py opt_trade)
function ncdf(x: number): number { // Abramowitz-Stegun 7.1.26 is too coarse for parity; use erf via high-precision series
  return 0.5 * (1 + erf(x / Math.SQRT2));
}
function erf(x: number): number {
  const s = Math.sign(x), a = Math.abs(x);
  if (a < 3) { let sum = a, term = a; for (let n = 1; n < 200; n++) { term *= (-a * a) / n; const t = term / (2 * n + 1); sum += t; if (Math.abs(t) < 1e-17) break; } return s * (2 / Math.sqrt(Math.PI)) * sum; }
  // continued fraction for erfc at large |x|
  let f = 0; for (let n = 60; n >= 1; n--) f = n / 2 / (a + f);
  return s * (1 - Math.exp(-a * a) / Math.sqrt(Math.PI) / (a + f));
}
function bs(S: number, K: number, tau: number, sig: number, cp: number): number {
  if (tau <= 1e-6) return Math.max(0, (S - K) * cp);
  const d1 = (Math.log(S / K) + 0.5 * sig * sig * tau) / (sig * Math.sqrt(tau)), d2 = d1 - sig * Math.sqrt(tau);
  return cp * (S * ncdf(cp * d1) - K * ncdf(cp * d2));
}
const pyRound = (x: number) => { const f = Math.floor(x), d = x - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1; };
export interface OptEst { etf: string; strike: number; contracts: number; premium: number; lossPerContract: number; pnl: number; legs: { frac: number; usd: number }[] }
/** legs: (frac, futures px, minutes after fill). fillMinCt = minute-of-day CT of the fill. Returns null when the model refuses (loss per contract ≤ 0). */
export function optEstimate(i: { sym: string; side: Side; entry: number; risk: number; a5: number; fillMinCt: number; legs: { frac: number; px: number; dm: number }[]; riskUsd: number }): OptEst | null {
  const O = AB.option; const etf = O.etf[i.sym] ?? (i.sym.includes("NQ") ? "QQQ" : "SPY"); const m = O.mult[etf]!, sp = O.spread[etf]!, fee = O.feePerContract;
  const s = i.side === "long" ? 1 : -1; const S0 = i.entry / m; const K = pyRound(S0);
  const sig = Math.max(O.sigmaFloor, Math.min(O.sigmaCap, (i.a5 / i.entry) * Math.sqrt(78 * 252) * O.sigmaAdj));
  const minsLeft = Math.max(5, 15 * 60 - i.fillMinCt); const Y = 525600;
  const V0 = bs(S0, K, minsLeft / Y, sig, s) + sp;
  const Vst = bs((i.entry - s * i.risk) / m, K, minsLeft / Y, sig, s) - sp;
  const lossc = (V0 - Vst) * 100 + 2 * fee;
  if (!(lossc > 0)) return null;
  const n = Math.max(1, Math.floor(i.riskUsd / lossc)); let pnl = -2 * fee * n; const legs: { frac: number; usd: number }[] = [];
  for (const L of i.legs) { const V = bs(L.px / m, K, Math.max(0, minsLeft - L.dm) / Y, sig, s) - sp; const u = L.frac * n * (Math.max(V, 0) - V0) * 100; pnl += u; legs.push({ frac: L.frac, usd: r2(u) }); }
  return { etf, strike: K, contracts: n, premium: r2(V0), lossPerContract: r2(lossc), pnl, legs };
}

// ---------------------------------------------------------------- premium/discount coding (pp2.py): +0.5 aligned, -0.25 EQ, -0.5 opposed
export type PdZone = "premium" | "discount" | "equilibrium";
export function pdScore(zone: PdZone | null | undefined, side: Side): number | null {
  if (!zone) return null; const want = side === "short" ? "premium" : "discount";
  return zone === want ? 0.5 : zone === "equilibrium" ? -0.25 : -0.5;
}

// ---------------------------------------------------------------- card read (all arms)
export interface ArmCardRead { S2: number; gbmP: number; label: "would_fire" | "would_fire_partial" | "read"; arm: string; name: string; fire: boolean; wouldFire: boolean; aPlus: boolean; usdPerR: number; plan: ArmPlan | null; opt: OptEst | null; why: string; row: string; partial: string | null }
export function armsCardRead(i: { v2: V2Raw; gbm: Record<string, number | null | undefined>; vetoed: boolean; partial: string | null; side: Side; symbol: string; price: number | null; edge: number | null; stop: number | null; a5: number | null; minuteCt: number }): ArmCardRead[] {
  const s2r = armsS2(i.v2), S2 = s2r.S2, gp = armsGbmP(i.gbm);
  // fail closed to partial: any defaulted S2 subfactor or null GBM input. atrpct needs ≥20 days of 24h 5m bars (5760; SMC warmup) which the
  // desk does not keep yet, so every arms row is labelled partial until that feed exists (fire decision unchanged; shadow only).
  const miss = Object.entries(i.gbm).filter(([, v]) => v == null || !Number.isFinite(v as number)).map(([k]) => k);
  const own = [...(miss.includes("atrpct") ? ["warmup<20d 5m"] : []), ...(s2r.filled.length ? [`S2 defaulted: ${s2r.filled.join(",")}`] : []), ...(miss.length ? [`gbm null: ${miss.join(",")}`] : [])];
  i = { ...i, partial: own.length ? own.join("; ") : i.partial };
  return ARM_KEYS.map((k) => {
    const f = armFire(k, S2, gp, i.vetoed);
    const plan = fin(i.price) && fin(i.edge) && fin(i.stop) ? armPlan(k, { side: i.side, price: i.price, edge: i.edge, stop: i.stop }) : null;
    const opt = plan && fin(i.a5) && i.a5 > 0 ? optEstimate({ sym: i.symbol, side: i.side, entry: plan.entry, risk: plan.risk, a5: i.a5, fillMinCt: i.minuteCt, legs: plan.legs.map((l) => ({ frac: l.frac, px: l.px, dm: 0 })), riskUsd: f.usdPerR }) : null;
    const wf = f.fire && plan != null;
    // SMC integration log schema: tag shadow:combo1016:<config>; the label keeps the partial labelling (never a clean would_fire while partial)
    const label = wf ? (i.partial ? "would_fire_partial" : "would_fire") : "read";
    return { S2: Math.round(S2 * 10) / 10, gbmP: Math.round(gp * 1e4) / 1e4, arm: k, name: ARMS[k]!.name, fire: f.fire, wouldFire: wf, aPlus: f.aPlus, usdPerR: f.usdPerR, plan, opt, why: f.why, label,
      row: `shadow:combo1016:${k} ${label}` + (i.partial ? ` (${i.partial})` : ""), partial: i.partial };
  });
}

/** SMC DayBook.setupId: `${dayKey}:${sym}:${side}:${sweepExtreme}` — a re-arm needs a NEW sweep extreme (book symbol ES/NQ, CT session day). */
export function armSetupId(symbol: string, side: Side, sweepExtreme: number | null | undefined, nowMs: number): string | null {
  if (sweepExtreme == null || !Number.isFinite(sweepExtreme)) return null;
  const day = new Date(nowMs).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const book = /NQ/.test(symbol) ? "NQ" : /ES/.test(symbol) ? "ES" : symbol;
  return `${day}:${book}:${side}:${sweepExtreme}`;
}
