/**
 * combo1016: the SMC research best combo (audits/smc-research/s2-combo.md), SHADOW ONLY.
 *
 *   score1016.v2  S2 = distilled 5-layer logistic (audits/score-rebuild/ev/distill.json, fit IS 2010–18), rescaled 0–100, no ceiling,
 *                 p = isotonic(z). Signs as fit: L1 premium/discount enters as ctx_pd = 1 − pd, L4 rewards a plain FVG over an iFVG.
 *   gbmP          the IS LightGBM (score-rebuild/ev/gbm.py params) exported tree by tree to shared/combo1016-gbm.json.
 *   fire          S2 ≥ 75 AND gbmP ≥ thr (90th pct of IS gbmP). A+ = fire AND S2 ≥ 90: logged only, no sizing change.
 *   plan          hybrid entry (market if chaseR ≤ 1 else a limit at the newest array edge), T1 1R 50% → BE → 2R.
 *   ledger        caps 3/day, 2/symbol; halt the day after the first loss; re-arm only with a NEW setup id; a sealed entry is never re-priced.
 *
 * Pure functions (no I/O). Python twins: audits/smc-research/export/export_combo.py (research) and watcher/combo1016.py.
 * Nothing here writes q, band, plan, fire or size: card.combo1016 is a read, and the watcher logs shadow:combo1016:* rows.
 */
import RULES from "../../../shared/desk-rules.json";
import GBM from "../../../shared/combo1016-gbm.json";

export type Side = "long" | "short";
export type Mode = "live" | "shadow";
type V2 = { mode?: string; coef: Record<string, number>; intercept: number; lo: number; hi: number; medians: Record<string, number>; isoX: number[]; isoY: number[]; grades: [number, string][] };
type Blk = { mode?: string; fireS2?: number; aPlusS2?: number; gbm?: { thr?: number; sha256_16?: string }; entry?: { mode?: string; marketWithinR?: number };
  exit?: { mode?: string; t1R?: number; t1PartialFrac?: number; beAfterT1?: boolean; t2R?: number }; caps?: { mode?: string; perDay?: number; perSymbol?: number; haltAfterLosses?: number } };
const R0 = RULES as unknown as { score1016?: { v2?: V2 }; combo1016?: Blk };
export const V2P: V2 = R0.score1016!.v2!;
export const CB: Blk = R0.combo1016 ?? {};
export const comboMode = (): Mode => (CB.mode === "live" ? "live" : "shadow");
export const FIRE_S2 = CB.fireS2 ?? 75, APLUS_S2 = CB.aPlusS2 ?? 90;
const cl = (x: number) => Math.max(0, Math.min(1, x));
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------- score1016.v2 (S2)
/** Raw candidate fields in the research units (score-rebuild/ev m.pkl). null = unknown → that subfactor takes the IS median. */
export interface V2Raw {
  tr4h_with: number | null; atrpct: number | null; pd: number | null; wtmax: number | null; nk: number | null; smt: boolean | null;
  disp: number | null; mss: boolean | null; ifvg: boolean | null; risk_atr: number | null; chaseR: number | null; arr_ifvg: number | null;
  tmin: number | null; rng30: number | null;
}
export const V2_LAYERS: Record<string, string[]> = {
  context: ["ctx_htf4", "ctx_lowvol", "ctx_pd"], liquidity: ["liq_tier", "liq_n", "liq_smt"], displacement: ["disp", "mss", "ifvg"],
  entry: ["ent_tight", "ent_nochase", "ent_arr_fvg"], timing: ["tim_early", "tim_rng30"],
};
/** Subfactors exactly as distill.py builds them (0..1). NaN → null here, median fill happens in scoreV2. */
export function v2Subfactors(x: V2Raw): Record<string, number | null> {
  const b = (v: boolean | null) => (v == null ? null : v ? 1 : 0);
  const n = (v: number | null, f: (v: number) => number) => (fin(v) ? f(v) : null);
  return {
    ctx_htf4: x.tr4h_with == null ? null : x.tr4h_with > 0 ? 1 : 0,   // NaN > 0 is False in pandas → 0
    ctx_lowvol: 1 - (fin(x.atrpct) ? x.atrpct : 0.5),
    ctx_pd: n(x.pd, (v) => 1 - cl(v)),
    liq_tier: n(x.wtmax, (v) => v), liq_n: n(x.nk, (v) => cl((v - 1) / 3)), liq_smt: b(x.smt),
    disp: n(x.disp, (v) => cl(v / 3)), mss: b(x.mss), ifvg: b(x.ifvg),
    ent_tight: n(x.risk_atr, (v) => 1 - cl(v / 3)), ent_nochase: 1 - cl(fin(x.chaseR) ? x.chaseR : 1), ent_arr_fvg: n(x.arr_ifvg, (v) => 1 - v),
    tim_early: n(x.tmin, (v) => 1 - cl((v - 510) / 360)), tim_rng30: n(x.rng30, (v) => cl(v / 8)),
  };
}
export function isoP(z: number): number {
  const X = V2P.isoX, Y = V2P.isoY;
  if (z <= X[0]!) return Y[0]!;
  if (z >= X[X.length - 1]!) return Y[Y.length - 1]!;
  let lo = 0, hi = X.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (X[m]! <= z) lo = m; else hi = m; }
  const x0 = X[lo]!, x1 = X[hi]!; return x1 === x0 ? Y[hi]! : Y[lo]! + ((Y[hi]! - Y[lo]!) * (z - x0)) / (x1 - x0);   // np.interp
}
export function gradeV2(S: number): string { for (const [s, g] of V2P.grades) if (S >= s) return g; return "C"; }
export interface ScoreV2 { mode: Mode; S2: number; z: number; p: number; grade: string; layers: Record<string, number>; filled: string[] }
export function scoreV2(x: V2Raw): ScoreV2 {
  const sf = v2Subfactors(x); const filled: string[] = [];
  // v2Subfactors substitutes the research defaults for these two (atrpct → 0.5, chaseR → 1): same numbers, but they are defaulted inputs and are listed.
  const defaulted = new Set<string>([...(fin(x.atrpct) ? [] : ["ctx_lowvol"]), ...(fin(x.chaseR) ? [] : ["ent_nochase"])]);
  let z = V2P.intercept; const layers: Record<string, number> = {};
  for (const [L, ks] of Object.entries(V2_LAYERS)) {
    let s = 0;
    for (const k of ks) { let v = sf[k]; if (v == null || !Number.isFinite(v)) { v = V2P.medians[k]!; filled.push(k); } else if (defaulted.has(k)) filled.push(k); s += V2P.coef[k]! * v; }
    layers[L] = r3(s); z += s;
  }
  const S2 = 100 * cl((z - V2P.lo) / (V2P.hi - V2P.lo));
  return { mode: V2P.mode === "live" ? "live" : "shadow", S2, z, p: isoP(z), grade: gradeV2(S2), layers, filled };
}

// ---------------------------------------------------------------- gbmP (exported LightGBM)
type Node = { v: number } | { f: number; t: number; d: 0 | 1; m: 0 | 1 | 2; l: Node; r: Node };
const G = GBM as unknown as { features: string[]; trees: Node[]; thr_is_p90: number };
export const GBM_FEATURES = G.features;
export const GBM_THR = CB.gbm?.thr ?? G.thr_is_p90;
/** LightGBM numerical split semantics: missing_type NaN → default side for NaN; Zero → default side for 0/NaN; None → NaN treated as 0. */
function leaf(n: Node, x: (number | null)[]): number {
  while (!("v" in n)) {
    const raw = x[n.f]; const nan = raw == null || !Number.isFinite(raw);
    let left: boolean;
    if (n.m === 2 && nan) left = n.d === 1;
    else if (n.m === 1 && (nan || raw === 0)) left = n.d === 1;
    else left = (nan ? 0 : raw!) <= n.t;
    n = left ? n.l : n.r;
  }
  return n.v;
}
export function gbmP(feat: Record<string, number | null | undefined>): number {
  const x = G.features.map((k) => { const v = feat[k]; return v == null ? null : Number(v); });
  let z = 0; for (const t of G.trees) z += leaf(t, x);
  return 1 / (1 + Math.exp(-z));
}

// ---------------------------------------------------------------- fire rule
export interface ComboRead { mode: Mode; S2: number; p: number; grade: string; gbmP: number; thr: number; fire: boolean; aPlus: boolean; layers: Record<string, number>; filled: string[]; gbmMissing: string[]; partial: string | null; why: string }
export const V2_N = Object.values(V2_LAYERS).flat().length;
/** "partial: N/14 S2 filled, M/27 GBM missing" when any S2 input was defaulted/median-filled or any GBM feature is missing; null only when every input is real. */
export function partialLabel(filled: string[], gbmMissing: string[]): string | null {
  return filled.length || gbmMissing.length ? `partial: ${filled.length}/${V2_N} S2 filled, ${gbmMissing.length}/${G.features.length} GBM missing` : null;
}
export function comboRead(v2: V2Raw, gbmFeat: Record<string, number | null | undefined>, vetoed = false): ComboRead {
  const s = scoreV2(v2); const g = gbmP(gbmFeat);
  const fire = !vetoed && s.S2 >= FIRE_S2 && g >= GBM_THR;
  const aPlus = fire && s.S2 >= APLUS_S2;
  const gbmMissing = G.features.filter((k) => !fin(gbmFeat[k] as number));
  return { mode: comboMode(), S2: Math.round(s.S2 * 10) / 10, p: r3(s.p), grade: vetoed ? "skip" : s.grade, gbmP: Math.round(g * 1e4) / 1e4, thr: r3(GBM_THR), fire, aPlus,
    layers: s.layers, filled: s.filled, gbmMissing, partial: partialLabel(s.filled, gbmMissing),
    why: `S2 ${s.S2.toFixed(1)} ${s.S2 >= FIRE_S2 ? "≥" : "<"} ${FIRE_S2} · gbmP ${g.toFixed(3)} ${g >= GBM_THR ? "≥" : "<"} ${GBM_THR.toFixed(3)}${aPlus ? " · A+ (logged only)" : ""}${vetoed ? " · hard veto" : ""}` };
}

// ---------------------------------------------------------------- plan: hybrid entry + T1 1R 50% → BE → 2R
export interface ComboPlan { kind: "market" | "limit"; entry: number; stop: number; risk: number; chaseR: number; t1: number; t2: number; partialFrac: number; beAfterT1: boolean }
export function comboPlan(i: { side: Side; price: number; edge: number; stop: number }): ComboPlan | null {
  const S = i.side === "short", d = S ? -1 : 1;
  const riskEdge = Math.abs(i.stop - i.edge);
  if (!(riskEdge > 0) || (S ? i.stop <= i.price : i.stop >= i.price)) return null;
  const chaseR = Math.max(0, S ? i.edge - i.price : i.price - i.edge) / riskEdge;
  const market = chaseR <= (CB.entry?.marketWithinR ?? 1.0);
  const entry = market ? i.price : i.edge, r = Math.abs(i.stop - entry);
  return { kind: market ? "market" : "limit", entry, stop: i.stop, risk: r, chaseR: r3(chaseR), t1: entry + d * (CB.exit?.t1R ?? 1) * r, t2: entry + d * (CB.exit?.t2R ?? 2) * r,
    partialFrac: CB.exit?.t1PartialFrac ?? 0.5, beAfterT1: CB.exit?.beAfterT1 !== false };
}

// ---------------------------------------------------------------- day ledger: caps 3/2, halt after first loss, re-arm by new setup id, seal
export interface SealedEntry { setupId: string; symbol: string; side: Side; kind: "market" | "limit"; entry: number; stop: number; t1: number; t2: number; sealedAt: number; result?: "win" | "loss" | "be" | null }
export interface ComboDay { day: string; entries: SealedEntry[] }
export type LedgerVerdict = { ok: true; why: string; sealed: SealedEntry } | { ok: false; why: string; sealed: SealedEntry | null };
/** Decide whether a would-fire may take a (shadow) slot. Never re-prices: the same setup id returns its sealed entry untouched. */
export function comboAdmit(day: ComboDay, symbol: string, setupId: string, plan: ComboPlan, side: Side, now: number): LedgerVerdict {
  const prev = day.entries.find((e) => e.setupId === setupId);
  if (prev) return { ok: false, why: `setup ${setupId} already sealed at ${prev.entry} (no re-price; re-arm needs a new setup id)`, sealed: prev };
  const losses = day.entries.filter((e) => e.result === "loss").length, halt = CB.caps?.haltAfterLosses ?? 1;
  if (losses >= halt) return { ok: false, why: `halted for the day after ${losses} loss`, sealed: null };
  const perDay = CB.caps?.perDay ?? 3, perSym = CB.caps?.perSymbol ?? 2;
  const n = day.entries.length, ns = day.entries.filter((e) => e.symbol === symbol).length;
  if (n >= perDay) return { ok: false, why: `day cap ${n}/${perDay}`, sealed: null };
  if (ns >= perSym) return { ok: false, why: `${symbol} cap ${ns}/${perSym}`, sealed: null };
  const sealed: SealedEntry = { setupId, symbol, side, kind: plan.kind, entry: plan.entry, stop: plan.stop, t1: plan.t1, t2: plan.t2, sealedAt: now, result: null };
  return { ok: true, why: `slot ${n + 1}/${perDay}, ${symbol} ${ns + 1}/${perSym}`, sealed };
}
/** Setup id = symbol|side|sweep extreme|sweep time: a new sweep extreme after played-out is a NEW id (re-arm); the same event keeps its id. */
export function setupIdOf(symbol: string, side: Side, sweepLevel: number | null | undefined, sweepT: number | string | null | undefined): string {
  return `${symbol}|${side}|${sweepLevel ?? "?"}|${sweepT ?? "?"}`;
}

/** Desk adapter: the card-level fields we can compute live. Everything else stays null (S2 → IS median, GBM → its missing-value branch) and is listed. */
export function featuresFromScore1016(i: {
  side: Side; bias1h: number; bias4h: number; pd: number | null; pools: string[]; poolTier: (n: string) => number; smt: boolean; dispAtr: number; mss: boolean; ifvg: boolean;
  arrayKind: "ifvg" | "fvg" | null; arrayAtLegEq: boolean; nArrays: number; minuteCt: number; chaseR: number | null; riskPts: number | null; atr5: number | null; dow: number;
  /** closed-bar research features (combo1016-feat.ts barFeatures); absent → those inputs stay null and are listed */
  bar?: Partial<Record<"sw_with" | "smt_with" | "fail3_with" | "mss5_with" | "tr1h_with" | "tr4h_with" | "pdpos_with" | "compress" | "rng30" | "since_disp" | "atrpct", number | null>> | null;
}): { v2: V2Raw; gbm: Record<string, number | null> } {
  const wt = i.pools.length ? Math.max(...i.pools.map(i.poolTier)) : null;
  const nk = i.pools.length ? new Set(i.pools).size : null;
  const risk_atr = fin(i.riskPts) && fin(i.atr5) && i.atr5 > 0 ? i.riskPts / i.atr5 : null;
  const arr_ifvg = i.arrayKind == null ? null : i.arrayKind === "ifvg" ? 1 : 0;
  const v2: V2Raw = { tr4h_with: null, atrpct: null, pd: i.pd, wtmax: wt, nk, smt: i.smt, disp: i.dispAtr, mss: i.mss, ifvg: i.ifvg, risk_atr, chaseR: i.chaseR, arr_ifvg, tmin: i.minuteCt, rng30: null };
  const gbm: Record<string, number | null> = Object.fromEntries(G.features.map((k) => [k, null]));
  Object.assign(gbm, { b1: i.bias1h, b4: i.bias4h, pd: i.pd, wtmax: wt, smt: i.smt ? 1 : 0, nk, disp: i.dispAtr, mss: i.mss ? 1 : 0, ifvg: i.ifvg ? 1 : 0, arr_ifvg,
    eqhit: i.arrayAtLegEq ? 1 : 0, n_arr: i.nArrays, tmin: i.minuteCt, chaseR: i.chaseR, risk_atr, dow: i.dow });
  if (i.bar) {
    for (const k of ["sw_with", "smt_with", "fail3_with", "mss5_with", "tr1h_with", "tr4h_with", "pdpos_with", "compress", "rng30", "since_disp", "atrpct"] as const) { const v = i.bar[k]; if (fin(v)) gbm[k] = v; }
    if (fin(i.bar.tr4h_with)) v2.tr4h_with = i.bar.tr4h_with; if (fin(i.bar.rng30)) v2.rng30 = i.bar.rng30; if (fin(i.bar.atrpct)) v2.atrpct = i.bar.atrpct;
  }
  return { v2, gbm };
}
