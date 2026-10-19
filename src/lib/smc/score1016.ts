/**
 * score1016 — event-driven five-layer score (audits/week1016-review/README.md, tested in audits/score-rebuild/).
 *
 *   S = (1.0·L1 HTF + 1.5·L2 Liquidity + 1.5·L3 Displacement + 1.0·L4 Entry array + 0.5·L5 Timing) / 5.5 × 100
 *
 * Grades come from S through a probability table fit in-sample (2010–2018) and checked out-of-sample (2019–2026-10-09):
 * there is NO band ceiling, so S ≥ 85 is reachable when the evidence stacks. Only hard vetoes (risk geometry, stale
 * data, invalidation) can stop a card. Every item ships `mode: "shadow"`: the read is published on card.score1016 and
 * the watcher logs `shadow:score1016:*` would-fire rows; nothing moves q, band, plan or a fire until a flag says live.
 *
 * Pure functions only (no I/O). The Python twin is audits/score-rebuild/impl/h.py `score()` (parity test in scripts/score1016.test.mjs).
 */
import RULES from "../../../shared/desk-rules.json";

export type Side = "long" | "short";
export type Mode = "live" | "shadow";
type Item = { mode?: string; [k: string]: unknown };
const BLK = (((RULES as unknown) as { score1016?: Record<string, Item> }).score1016 ?? {}) as Record<string, Item>;
let OVR: Record<string, Record<string, unknown>> = {};
/** Backtest/test-only overrides; the rules file stays the source of truth. */
export function setScoreOverrides(o: Record<string, Record<string, unknown>> | null): void { OVR = o ?? {}; }
export const scoreMode = (k: string): Mode => ((OVR[k]?.mode ?? BLK[k]?.mode) === "live" ? "live" : "shadow");
const num = (k: string, f: string, d: number): number => { const v = OVR[k]?.[f] ?? BLK[k]?.[f]; return typeof v === "number" && Number.isFinite(v) ? v : d; };
const itm = <T>(k: string, f: string): T | undefined => (OVR[k]?.[f] ?? BLK[k]?.[f]) as T | undefined;
const cl = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Pool tiers (L2) — exactly the backtested weights (audits/week1016-review cands `wt`): PDH/PDL/ONH/ONL (desk: Prior RTH,
 * Overnight) 1.0; Asia/London 0.8; 1h/4h/5m array tap 0.9; inside a 1h/4h array 0.8; 15m array tap 0.7; inside a 5m/15m
 * array or a 15m swing 0.6; lower high / higher low 0.5. Unknown names 0.6.
 */
export function poolTier(name: string | null | undefined): number {
  const n = String(name ?? "").trim();
  if (/^(PDH|PDL|ONH|ONL|PWH|PWL)\b|^(prior rth|overnight|prev(ious)? day|pd) (high|low)/i.test(n)) return 1.0;
  if (/^(AsiaH|AsiaL|LonH|LonL)\b|^(asia|london) (high|low)/i.test(n)) return 0.8;
  if (/^tap(1h|4h|5min|5m)$/i.test(n)) return 0.9;
  if (/^in(1h|4h)$/i.test(n)) return 0.8;
  if (/^tap15(min|m)$/i.test(n)) return 0.7;
  if (/^(in5min|in15min|in5m|in15m|sw15)$|^15m swing/i.test(n)) return 0.6;
  if (/^(lh|hl)$|lower high|higher low/i.test(n)) return 0.5;
  return 0.6;
}

export interface Score1016Input {
  side: Side;
  /** 1h / 4h EMA20 bias: +1 with the side, -1 against, 0 unknown. */
  bias1h: number; bias4h: number;
  /** Position in the dealing range [min(PDL,ONL), max(PDH,ONH)] measured for the side (short: 1 = top/premium; long: 1 = bottom/discount). */
  pd: number | null;
  /** Pools raided by this event (names); the best tier counts, +0.1 per extra pool. */
  pools: string[];
  smt: boolean;
  /** Max 1m body / ATR14(1m) within 15 bars of the event. */
  dispAtr: number; mss: boolean; ifvg: boolean;
  /** Newest entry array. */
  arrayKind: "ifvg" | "fvg" | null; arrayAtLegEq: boolean; nArrays: number;
  /** Minutes since midnight CT of the decision bar. */
  minuteCt: number;
}
export interface Score1016Layers { L1: number; L2: number; L3: number; L4: number; L5: number }
export interface Score1016 { mode: Mode; S: number; layers: Score1016Layers; p: number; grade: string; fire: boolean; thr: number; why: string[] }

export const W_DEFAULT = { L1: 1.0, L2: 1.5, L3: 1.5, L4: 1.0, L5: 0.5 };
/** S → p(win at T1 1R / BE / 2R), isotonic, fit IS 2010–2018 (audits/score-rebuild/impl/exp.log). OOS 2019–2026 matched within 0.04. */
export const P_TABLE: [number, number][] = [[0, 0.44], [50, 0.47], [60, 0.47], [70, 0.48], [75, 0.5], [80, 0.54], [83, 0.57], [86, 0.57], [90, 0.63]];
/** Grade by S (0–100). No ceiling: A+ is reachable at S ≥ 90. Fire is A- and above (S ≥ thr, default 83). */
export const GRADE_TABLE: [number, string][] = [[90, "A+"], [86, "A"], [83, "A-"], [80, "B+"], [75, "B"], [0, "C"]];

export function layers(i: Score1016Input): Score1016Layers {
  const L1 = 0.25 * (i.bias1h > 0 ? 1 : 0) + 0.25 * (i.bias4h > 0 ? 1 : 0) + 0.5 * cl(((i.pd ?? 0.5) - 0.3) / 0.4);
  const best = i.pools.length ? Math.max(...i.pools.map(poolTier)) : 0;
  const smtBonus = itm<boolean>("score", "smtBonus") === false ? 0 : 0.25;
  const L2 = cl(best + (i.smt ? smtBonus : 0) + 0.1 * Math.max(0, new Set(i.pools).size - 1));
  const L3 = 0.5 * cl(i.dispAtr / 2) + 0.25 * (i.mss ? 1 : 0) + 0.25 * (i.ifvg ? 1 : 0);
  const L4 = 0.4 * (i.arrayKind === "ifvg" ? 1 : 0) + 0.3 * (i.arrayAtLegEq ? 1 : 0) + 0.3 * cl(i.nArrays / 3);
  const m = i.minuteCt;
  const L5 = m >= 500 && m < 660 ? 1.0 : m >= 780 && m < 870 ? 0.7 : 0.4;
  return { L1, L2, L3, L4, L5 };
}
export function pOf(S: number): number { let p = P_TABLE[0]![1]; for (const [s, v] of P_TABLE) if (S >= s) p = v; return p; }
export function gradeOf(S: number): string { for (const [s, g] of GRADE_TABLE) if (S >= s) return g; return "C"; }

export function score1016(i: Score1016Input, veto: HardVeto | null = null): Score1016 {
  const L = layers(i);
  const w = itm<Record<string, number>>("score", "weights") ?? W_DEFAULT;
  const ws = (w.L1 ?? 0) + (w.L2 ?? 0) + (w.L3 ?? 0) + (w.L4 ?? 0) + (w.L5 ?? 0) || 1;
  const S = (100 * ((w.L1 ?? 0) * L.L1 + (w.L2 ?? 0) * L.L2 + (w.L3 ?? 0) * L.L3 + (w.L4 ?? 0) * L.L4 + (w.L5 ?? 0) * L.L5)) / ws;
  const thr = num("score", "fireAt", 83);
  const why = [`L1 ${r3(L.L1)} L2 ${r3(L.L2)} L3 ${r3(L.L3)} L4 ${r3(L.L4)} L5 ${r3(L.L5)}`];
  if (veto?.vetoed) why.push(`hard veto: ${veto.why.join(", ")}`);
  const Sr = Math.round(S * 10) / 10;
  return { mode: scoreMode("score"), S: Sr, layers: Object.fromEntries(Object.entries(L).map(([k, v]) => [k, r3(v)])) as unknown as Score1016Layers,
    p: pOf(Sr), grade: veto?.vetoed ? "skip" : gradeOf(Sr), fire: !veto?.vetoed && Sr >= thr, thr, why };
}

// ---------------------------------------------------------------- hard vetoes (the only things that stop a card)
export interface HardVeto { vetoed: boolean; why: string[] }
export function hardVetoes(i: { riskPts: number | null; atr1m: number | null; staleData: boolean; invalidated: boolean }): HardVeto {
  const why: string[] = [];
  if (i.staleData) why.push("stale data");
  if (i.invalidated) why.push("invalidated");
  if (i.riskPts == null || !(i.riskPts > 0)) why.push("no risk geometry");
  else if (i.atr1m && i.atr1m > 0) {
    const r = i.riskPts / i.atr1m;
    if (r < num("veto", "minRiskAtr1m", 0.5) || r > num("veto", "maxRiskAtr1m", 12)) why.push(`risk ${r.toFixed(2)}×ATR1m out of band`);
  }
  return { vetoed: why.length > 0, why };
}

// ---------------------------------------------------------------- entry: market within 1R of the newest array edge, else a resting limit at the edge
export interface EntryDecision { mode: Mode; kind: "market" | "limit"; entry: number; stop: number; risk: number; chaseR: number; why: string }
export function entryDecision(i: { side: Side; price: number; edge: number; stop: number }): EntryDecision | null {
  const S = i.side === "short";
  const riskEdge = Math.abs(i.stop - i.edge);
  if (!(riskEdge > 0) || (S ? i.stop <= i.price : i.stop >= i.price)) return null;
  const chaseR = Math.max(0, S ? i.edge - i.price : i.price - i.edge) / riskEdge;
  const within = chaseR <= num("entry", "marketWithinR", 1.0);
  const entry = within ? i.price : i.edge;
  return { mode: scoreMode("entry"), kind: within ? "market" : "limit", entry, stop: i.stop, risk: Math.abs(i.stop - entry), chaseR: r3(chaseR),
    why: within ? `market: ${r3(chaseR)}R past the newest array edge ${i.edge} (≤ ${num("entry", "marketWithinR", 1.0)}R)` : `limit at the newest array edge ${i.edge} (${r3(chaseR)}R away)` };
}

// ---------------------------------------------------------------- exits: T1 1R for 50%, stop to BE, runner to 2R
export interface ExitPlan { mode: Mode; t1: number; t2: number; partialFrac: number; beAfterT1: boolean }
export function exitPlan(side: Side, entry: number, stop: number): ExitPlan {
  const r = Math.abs(entry - stop), d = side === "short" ? -1 : 1;
  return { mode: scoreMode("exit"), t1: entry + d * num("exit", "t1R", 1) * r, t2: entry + d * num("exit", "t2R", 2) * r,
    partialFrac: num("exit", "t1PartialFrac", 0.5), beAfterT1: itm<boolean>("exit", "beAfterT1") !== false };
}

// ---------------------------------------------------------------- caps: 2 fills/day, 1 per symbol (re-arm per event, no new-extreme rule)
export function capsOk(fillsToday: { symbol: string }[], symbol: string): { ok: boolean; why: string } {
  const day = num("caps", "perDay", 2), sym = num("caps", "perSymbol", 1);
  const n = fillsToday.length, ns = fillsToday.filter((f) => f.symbol === symbol).length;
  if (n >= day) return { ok: false, why: `day cap ${n}/${day}` };
  if (ns >= sym) return { ok: false, why: `${symbol} cap ${ns}/${sym}` };
  return { ok: true, why: `fills ${n}/${day}, ${symbol} ${ns}/${sym}` };
}

// ---------------------------------------------------------------- Brain "POI in correct half" at ENTRY via pdLeg (narrow), own flag
/** Narrow version: pass only when pdLeg graded the ENTRY (POI) — premium for a short, discount for a long; EQ / no leg = null (no opinion). */
export function poiHalfAtEntry(pd: { atPoi: { zone: string } | null; side: Side } | null | undefined): { mode: Mode; pass: boolean | null; why: string } {
  const mode = scoreMode("poiHalf");
  if (!pd || !pd.atPoi) return { mode, pass: null, why: "no pdLeg read at the POI" };
  const want = pd.side === "short" ? "premium" : "discount";
  if (pd.atPoi.zone === "equilibrium") return { mode, pass: null, why: "POI at leg EQ" };
  return { mode, pass: pd.atPoi.zone === want, why: `POI ${pd.atPoi.zone} of the dealing leg (${want} wanted)` };
}

/** Item modes published on the card so the watcher, Floor and Brain show what is live. */
export function scoreModes(): Record<string, Mode> {
  return Object.fromEntries(["score", "entry", "exit", "caps", "poiHalf", "altEntryIfvgCe", "setupPerSweep", "scopeCaps"].map((k) => [k, scoreMode(k)]));
}

// ---------------------------------------------------------------- desk adapter (build-desk → Score1016Input)
export interface ArmLike { sweep: { pool: string; level: number }; disp: { atrMult: number }; gap: { kind: "ifvg" | "fvg"; lo: number; hi: number; ce: number }; mss: boolean; entryEdge: number; stop: number }
/**
 * Map a desk card to the score inputs. The event is the card's LTF arm (sweep → displacement → gap); with no arm the
 * card has no liquidity/displacement event and scores on context alone (it cannot reach the fire line).
 */
export function inputFromCard(i: {
  side: Side; bias1h: string | null; bias4h: string | null; levels: { name: string; price: number }[]; ref: number | null;
  arm: ArmLike | null | undefined; components: string[]; minuteCt: number; nArrays: number; legEq: number | null;
}): Score1016Input {
  const S = i.side === "short";
  const want = S ? "bear" : "bull";
  const b = (x: string | null) => (x == null ? 0 : x === want ? 1 : -1);
  const lv = (re: RegExp) => i.levels.filter((l) => re.test(l.name)).map((l) => l.price);
  const hi = Math.max(...lv(/^(PDH|ONH)\b/i)), lo = Math.min(...lv(/^(PDL|ONL)\b/i));
  let pd: number | null = null;
  if (i.ref != null && Number.isFinite(hi) && Number.isFinite(lo) && hi > lo) { const r = (i.ref - lo) / (hi - lo); pd = S ? r : 1 - r; }
  const a = i.arm ?? null;
  const pools = a ? [a.sweep.pool, ...i.levels.filter((l) => l.name !== a.sweep.pool && Math.abs(l.price - a.sweep.level) <= Math.abs(a.stop - a.entryEdge) * 0.25).map((l) => l.name)] : [];
  const has = (k: string) => i.components.includes(k);
  return {
    side: i.side, bias1h: b(i.bias1h), bias4h: b(i.bias4h), pd, pools, smt: has("smt"),
    dispAtr: a?.disp.atrMult ?? 0, mss: Boolean(a?.mss) || has("mss"), ifvg: a?.gap.kind === "ifvg" || has("ifvg"),
    arrayKind: a?.gap.kind ?? null, arrayAtLegEq: a != null && i.legEq != null && i.legEq >= a.gap.lo && i.legEq <= a.gap.hi,
    nArrays: i.nArrays, minuteCt: i.minuteCt,
  };
}
