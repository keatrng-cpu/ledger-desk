/**
 * wire.deskSeq.ladder — the TWO-SIDED ladder (Keaton 2026-10-15). SHADOW / DISPLAY-ONLY.
 *
 * Every card shows BOTH conditions (bull and bear). Per side: every candidate entry (FVG/IFVG CE, OB, breaker,
 * sweep retest) with its REAL stop (beyond the array and the real swing that protects it, on the correct side of
 * price; invalidated when price has already crossed it), the full target ladder in distance order, and a calibrated
 * probability on each entry and target. Plus the flip line: the 1h BODY-CLOSE level that switches the bias.
 *
 * HTF levels come from ~6 months of 1h bars (1h + 4h swings, 1h/4h gaps, 1h/4h EQH/EQL) and the 2y daily series
 * (1D + 1W swings, 1D EQH/EQL), plus PDH/PDL/PWH/PWL and the premarket map's own levels/pools/arrays.
 * A level counts only while UNSWEPT (no later bar's wick traded through it). Gaps count while not fully filled.
 *
 * Probabilities are read from ladder-calibration.json, produced by scripts/calibrate-ladder.mts from 2y of Yahoo 60m
 * bars using THIS module's own level builder (no lookahead: levels from bars closed before the 10:00 ET cut, touch
 * judged on later bars). Cells with n < MIN_N print "n too small" and p = null — never a guess.
 *
 * Nothing here is read by q, band, actionable, the brain word, the Floor verdict, the rulesHash or a fire. It does not
 * read or write shared/desk-rules.json (adding a key there would move RULES_HASH under the live watcher).
 */
import type { OhlcBar } from "@/lib/market/types";
import { rollingAtr } from "@/lib/trading/detectors";
import { sessionKeyOf } from "../smc-unity";
import { TICK } from "./eq-pools";
import type { PremarketMap, MapArray } from "./premarket-map";
import type { ScenarioRead } from "./scenarios";
import { r2, type Side } from "./rules";
import CAL from "./ladder-calibration.json";

export type LevelGroup = "swing1W" | "swing1D" | "pdpw" | "swing4h" | "pool" | "gap" | "swing1h" | "session";
export const GROUP_ORDER: LevelGroup[] = ["swing1W", "swing1D", "pdpw", "swing4h", "pool", "gap", "swing1h", "session"];
const GROUP_W: Record<LevelGroup, number> = { swing1W: 4, swing1D: 3, pdpw: 3, swing4h: 2, pool: 2, gap: 1, swing1h: 1, session: 1 };
export const DIST_EDGES = [0.5, 1, 2, 4, 8, 16, Infinity];
export const MIN_N = 30;

export interface RawLevel { price: number; name: string; group: LevelGroup; side: "high" | "low"; t?: number; proxy?: boolean }

// --------------------------------------------------------------------------------------------- tick snapping
/** Nearest tick (levels with no side preference, e.g. a gap CE). */
export const snapTick = (x: number, tick: number) => r2(Math.round(x / tick + 1e-9) * tick);
/** Tradeable price for an order on `side`: a long entry/stop rounds DOWN (deeper fill, wider stop), a short rounds UP. */
export const snapSide = (x: number, tick: number, side: Side) => r2((side === "long" ? Math.floor(x / tick + 1e-9) : Math.ceil(x / tick - 1e-9)) * tick);
export interface Prob { p: number | null; n: number; key: string; note?: string; proxy?: boolean }
export interface LadderLevel { lo: number; hi: number; touch: number; names: string[]; group: LevelGroup; confluence: number; distAtr: number; rank: number; pSession: Prob; p5d: Prob }
export interface LadderEntry {
  kind: string; tf: string; entry: number; stop: number; stopWhy: string; distAtr: number;
  valid: boolean; invalidWhy: string | null; pFill: Prob; pWin: Prob; t1R: number | null; targets: { touch: number; r: number }[];
}
export interface LadderSide { side: Side; bias: string; prior: { p: number | null; method: string; n: number; note?: string }; entries: LadderEntry[]; targets: LadderLevel[] }
export interface LadderBook {
  symbol: string; price: number; atr1h: number; asOfT: number; bars1h: number; spanDays: number;
  bull: LadderSide; bear: LadderSide;
  flip: { level: number; tf: "1h body close"; from: "bull" | "bear" | "mixed"; to: string; why: string } | null;
  cardCheck: CardCheck | null;
  /** Fast LTF bias flip (sweep of a ranked pool → body close back inside → 1m/3m opposing FVG inverted). Shadow. */
  ltfFlip: LtfFlip | null;
  /** Sides whose target pool was just swept: no grade upgrade into it (shadow — logged, never applied). */
  noUpgrade: { side: Side; pool: string; sweptT: number; why: string }[];
  missing: string[];
}
export interface LtfFlip {
  side: Side; demotes: Side; stage: "SWEPT" | "RECLAIMED" | "PROMOTED";
  pool: { lo: number; hi: number; names: string[] }; sweepT: number; wick: number; reclaimT: number | null;
  fvg: { tf: "1m" | "3m"; lo: number; hi: number; ce: number; t: number } | null; inversionT: number | null;
  entry: number | null; stop: number | null; targets: { touch: number; r: number }[]; why: string[];
}
export interface LadderWire {
  mode: "shadow";
  displayOnly: true;
  method: string;
  books: Record<string, LadderBook>;
  rows: string[];
  /** Shadow measured-probability grade per book (ladder-grade.ts). Display-only. */
  grades?: Record<string, import("./ladder-grade").LadderBookGrade>;
}
export interface CardCheck { symbol: string; side: Side; entry: number; stop: number; price: number; valid: boolean; why: string | null }

// --------------------------------------------------------------------------------------------- bar helpers
const H = 3_600_000;
/** 4h buckets anchored to the 18:00 ET futures open (22:00 UTC in EDT → UTC offset 2h; within an hour in EST). */
export function to4h(h1: OhlcBar[]): OhlcBar[] {
  const out: OhlcBar[] = [];
  for (const b of h1) {
    const k = Math.floor((b.t + 2 * H) / (4 * H)) * 4 * H - 2 * H;
    const L = out[out.length - 1];
    if (L && L.t === k) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; } else out.push({ ...b, t: k });
  }
  return out;
}
/** Session (18:00 ET roll) daily bars from 1h. */
export function sessions(h1: OhlcBar[]): (OhlcBar & { key: string })[] {
  const out: (OhlcBar & { key: string })[] = [];
  for (const b of h1) {
    const key = sessionKeyOf(b.t);
    const L = out[out.length - 1];
    if (L && L.key === key) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; } else out.push({ ...b, key });
  }
  return out;
}
const weekKey = (day: string) => { const d = new Date(day + "T12:00:00Z"); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return d.toISOString().slice(0, 10); };
export function weekly(daily: (OhlcBar & { key?: string })[]): OhlcBar[] {
  const out: (OhlcBar & { wk: string })[] = [];
  for (const b of daily) {
    const wk = weekKey(b.key ?? new Date(b.t + 12 * H).toISOString().slice(0, 10));
    const L = out[out.length - 1];
    if (L && L.wk === wk) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; } else out.push({ ...b, wk });
  }
  return out;
}

/**
 * Unswept swings: bar i is a swing low when its low is <= every low within `width` bars each side (NON-strict, so
 * equal lows — the EQL stops Keaton marks — are not erased the way a strict fractal erases them; a run of equal
 * extremes keeps its first bar). Confirmed only once `width` bars closed after it. Unswept = no later bar's wick
 * (incl. `after`) traded beyond it; touching it exactly is not a sweep.
 */
export function unsweptSwings(bars: OhlcBar[], width: number, after: OhlcBar[] = []): { price: number; side: "high" | "low"; t: number }[] {
  const n = bars.length; const sufH = new Array<number>(n + 1).fill(-Infinity), sufL = new Array<number>(n + 1).fill(Infinity);
  let aH = -Infinity, aL = Infinity; for (const b of after) { aH = Math.max(aH, b.h); aL = Math.min(aL, b.l); }
  sufH[n] = aH; sufL[n] = aL;
  for (let i = n - 1; i >= 0; i--) { sufH[i] = Math.max(sufH[i + 1]!, bars[i]!.h); sufL[i] = Math.min(sufL[i + 1]!, bars[i]!.l); }
  const out: { price: number; side: "high" | "low"; t: number }[] = [];
  for (let i = width; i + width < n; i++) {
    const b = bars[i]!;
    let isH = true, isL = true;
    for (let j = i - width; j <= i + width; j++) {
      if (j === i) continue;
      const x = bars[j]!;
      if (x.h > b.h || (j < i && x.h === b.h)) isH = false;
      if (x.l < b.l || (j < i && x.l === b.l)) isL = false;
    }
    if (isH && !(sufH[i + 1]! > b.h)) out.push({ price: b.h, side: "high", t: b.t });
    if (isL && !(sufL[i + 1]! < b.l)) out.push({ price: b.l, side: "low", t: b.t });
  }
  return out;
}
/** Bars whose wick extreme has never been traded through since (suffix records) — the raw unswept touches. */
export function unsweptTouches(bars: OhlcBar[], after: OhlcBar[] = []): { price: number; side: "high" | "low"; t: number }[] {
  let mh = -Infinity, ml = Infinity; for (const b of after) { mh = Math.max(mh, b.h); ml = Math.min(ml, b.l); }
  const out: { price: number; side: "high" | "low"; t: number }[] = [];
  for (let i = bars.length - 1; i >= 0; i--) {
    const b = bars[i]!;
    if (b.h >= mh) out.push({ price: b.h, side: "high", t: b.t });
    if (b.l <= ml) out.push({ price: b.l, side: "low", t: b.t });
    mh = Math.max(mh, b.h); ml = Math.min(ml, b.l);
  }
  return out.reverse();
}
/** EQH/EQL from unswept swings on one rung: >= 2 within max(2 ticks, 0.1 × that rung's ATR); price = the extreme. */
export function eqFromSwings(sw: { price: number; side: "high" | "low"; t: number }[], tf: string, atr: number, tick: number, barMs = H): RawLevel[] {
  const tol = Math.max(2 * tick, 0.1 * atr);
  const out: RawLevel[] = [];
  for (const side of ["high", "low"] as const) {
    const xs = sw.filter((s) => s.side === side).sort((a, b) => a.price - b.price);
    let g: typeof xs = [];
    const flush = () => { if (g.length >= 2) out.push({ price: r2(side === "high" ? g.at(-1)!.price : g[0]!.price), side, group: "pool", name: `EQ${side === "high" ? "H" : "L"} ${tf} ×${g.length}`, t: Math.max(...g.map((x) => x.t)) }); g = []; };
    for (const x of xs) {
      if (g.length && x.price - g[0]!.price > tol) flush();
      // two touches need at least one bar between them (adjacent bars are one swing, not equal highs/lows)
      if (g.some((y) => Math.abs(y.t - x.t) < 2 * barMs)) continue;
      g.push(x);
    }
    flush();
  }
  return out;
}
/** 3-candle gaps not fully filled by any later bar (or by `after`); lo/hi = the part still unfilled. */
export function unfilledGaps(bars: OhlcBar[], after: OhlcBar[] = []): { dir: "bull" | "bear"; lo: number; hi: number; t: number }[] {
  const out: { dir: "bull" | "bear"; lo: number; hi: number; t: number }[] = [];
  const n = bars.length; const sufH = new Array<number>(n + 1).fill(-Infinity), sufL = new Array<number>(n + 1).fill(Infinity);
  let aH = -Infinity, aL = Infinity; for (const b of after) { aH = Math.max(aH, b.h); aL = Math.min(aL, b.l); }
  sufH[n] = aH; sufL[n] = aL;
  for (let i = n - 1; i >= 0; i--) { sufH[i] = Math.max(sufH[i + 1]!, bars[i]!.h); sufL[i] = Math.min(sufL[i + 1]!, bars[i]!.l); }
  for (let i = 2; i < n; i++) {
    const a = bars[i - 2]!, c = bars[i]!;
    // a partly-filled gap keeps only its UNFILLED part (a wick into it has swept the near edge)
    if (c.l > a.h && sufL[i + 1]! > a.h) out.push({ dir: "bull", lo: a.h, hi: Math.min(c.l, sufL[i + 1]!), t: c.t });
    else if (c.h < a.l && sufH[i + 1]! < a.l) out.push({ dir: "bear", lo: Math.max(c.h, sufH[i + 1]!), hi: a.l, t: c.t });
  }
  return out;
}

export interface HtfInput { symbol: string; hourly: OhlcBar[]; daily: OhlcBar[]; cutT: number; after?: OhlcBar[]; lookbackDays?: number }
/** HTF raw levels from bars CLOSED at cutT. `after` = finer closed bars since the last closed hour (sweeps only). */
export function htfLevels(i: HtfInput): { levels: RawLevel[]; gaps: { tf: string; dir: "bull" | "bear"; lo: number; hi: number }[]; h1: OhlcBar[]; atr1h: number } {
  const look = (i.lookbackDays ?? 183) * 86_400_000;
  const h1 = i.hourly.filter((b) => b.t + H <= i.cutT && b.t >= i.cutT - look);
  const h1All = i.hourly.filter((b) => b.t + H <= i.cutT);
  // 1m tail from the START of the last closed hour: overlap is harmless for sweep/fill tests, and it covers a last 1h
  // bar that Yahoo served as a partial snapshot (10-15: the 13:00Z bar ended before the 13:54Z sweep of 29638.75).
  const after = (i.after ?? []).filter((b) => b.t >= (h1.at(-1)?.t ?? 0) && b.t < i.cutT);
  const h4 = to4h(h1).filter((b) => b.t + 4 * H <= i.cutT);
  // closed 1h bars inside the still-open 4h bucket sweep/fill 4h levels too (not just the 1m tail after the last hour)
  const after4 = [...h1.filter((b) => b.t >= (h4.at(-1)?.t ?? 0) + 4 * H), ...after];
  const sess = sessions(h1All);
  const curKey = sessionKeyOf(i.cutT - 1);
  const done = sess.filter((s) => s.key < curKey);
  const dIn = i.daily.filter((d) => d.t + 86_400_000 <= i.cutT);
  // the daily series is the 2y backbone; the 1h sessions fill the latest completed session(s) it may be missing
  const lastD = dIn.length ? new Date(dIn.at(-1)!.t + 12 * H).toISOString().slice(0, 10) : "";
  const d1: (OhlcBar & { key?: string })[] = [...dIn.map((d) => ({ ...d, key: new Date(d.t + 12 * H).toISOString().slice(0, 10) })), ...done.filter((s) => s.key > lastD)];
  const w1 = weekly(d1);
  const curH1 = sess.filter((s) => s.key === curKey);
  const afterAll = [...curH1, ...after];
  const lv: RawLevel[] = [];
  const tick = TICK[i.symbol] ?? 0.25;
  const add = (xs: { price: number; side: "high" | "low"; t: number }[], group: LevelGroup, tf: string) =>
    xs.forEach((s) => lv.push({ price: r2(s.price), side: s.side, t: s.t, group, name: `${tf} swing ${s.side}` }));
  add(unsweptSwings(h1, 2, after), "swing1h", "1h");
  add(unsweptSwings(h4, 2, after4), "swing4h", "4h");
  add(unsweptSwings(d1.slice(-130), 2, afterAll), "swing1D", "1D");
  add(unsweptSwings(w1.slice(-60), 1, afterAll), "swing1W", "1W");
  const pd = done.at(-1);
  if (pd) { lv.push({ price: r2(pd.h), side: "high", group: "pdpw", name: "PDH" }, { price: r2(pd.l), side: "low", group: "pdpw", name: "PDL" }); }
  const curWk = weekKey(curKey);
  const pw = done.filter((s) => weekKey(s.key) < curWk);
  const pwk = pw.length ? weekKey(pw.at(-1)!.key) : null;
  const pwBars = pw.filter((s) => weekKey(s.key) === pwk);
  if (pwBars.length) lv.push({ price: r2(Math.max(...pwBars.map((b) => b.h))), side: "high", group: "pdpw", name: "PWH" }, { price: r2(Math.min(...pwBars.map((b) => b.l))), side: "low", group: "pdpw", name: "PWL" });
  for (const [bars, tf, w, aft, ms] of [[h1, "1h", 2, after, H], [h4, "4h", 2, after4, 4 * H], [d1.slice(-130), "1D", 2, afterAll, 24 * H]] as const) {
    const a = rollingAtr(bars as OhlcBar[]).at(-1) ?? 0;
    const pts = [...unsweptSwings(bars as OhlcBar[], w, aft as OhlcBar[]), ...unsweptTouches(bars as OhlcBar[], aft as OhlcBar[])];
    const uniq = [...new Map(pts.map((p) => [`${p.side}:${p.t}`, p])).values()];
    lv.push(...eqFromSwings(uniq, tf, Number.isFinite(a) ? a : 0, tick, ms));
  }
  const gaps: { tf: string; dir: "bull" | "bear"; lo: number; hi: number }[] = [];
  for (const [bars, tf, aft] of [[h1, "1h", after], [h4, "4h", after4]] as const) {
    for (const g of unfilledGaps(bars, aft)) {
      gaps.push({ tf, dir: g.dir, lo: r2(g.lo), hi: r2(g.hi) });
      // a gap BELOW price is reached at its top first; ABOVE price at its bottom (side resolved in ladderSide)
      lv.push({ price: r2(g.hi), side: "low", group: "gap", name: `${tf} ${g.dir} gap ${r2(g.lo)}–${r2(g.hi)}`, t: g.t });
      lv.push({ price: r2(g.lo), side: "high", group: "gap", name: `${tf} ${g.dir} gap ${r2(g.lo)}–${r2(g.hi)}`, t: g.t });
      // a 4h gap's CE (consequent encroachment) is a level in its own right on both sides
      if (tf === "4h") { const ce = snapTick((g.lo + g.hi) / 2, tick); for (const sd of ["low", "high"] as const) lv.push({ price: ce, side: sd, group: "gap", name: `4h ${g.dir} gap CE ${ce}`, t: g.t }); }
    }
  }
  const atr1h = rollingAtr(h1).at(-1) ?? NaN;
  return { levels: lv, gaps, h1, atr1h: Number.isFinite(atr1h) ? atr1h : 0 };
}

// --------------------------------------------------------------------------------------------- calibration lookup
export const distBucket = (d: number) => { const i = DIST_EDGES.findIndex((e) => d < e); return i === 0 ? "<0.5" : `${DIST_EDGES[i - 1]}-${DIST_EDGES[i] === Infinity ? "inf" : DIST_EDGES[i]}`; };
export const rrBucket = (rr: number) => (rr < 1 ? "<1R" : rr < 2 ? "1-2R" : rr < 3 ? "2-3R" : "3R+");
type Cell = { hit: number; n: number };
type CalT = { method: string; touchSession: Record<string, Cell>; touch5d: Record<string, Cell>; entryFill: Record<string, Cell>; entryWin: Record<string, Cell> };
const C = CAL as unknown as CalT;
export function probOf(tab: Record<string, Cell> | undefined, key: string): Prob {
  const c = tab?.[key];
  if (!c || c.n === 0) return { p: null, n: 0, key, note: "no sample" };
  if (c.n < MIN_N) return { p: null, n: c.n, key, note: `n=${c.n} too small (<${MIN_N})` };
  return { p: +(c.hit / c.n).toFixed(3), n: c.n, key };
}

// --------------------------------------------------------------------------------------------- clustering + sides
export function cluster(levels: RawLevel[], px: number, side: Side, atr: number, tick: number): LadderLevel[] {
  const tol = Math.max(4 * tick, 0.12 * atr);
  const xs = levels.filter((l) => (side === "long" ? l.price > px : l.price < px)).sort((a, b) => Math.abs(a.price - px) - Math.abs(b.price - px));
  const out: (LadderLevel & { _groups: Set<LevelGroup>; _proxy: boolean })[] = [];
  for (const l of xs) {
    const c = out.find((o) => l.price >= o.lo - tol && l.price <= o.hi + tol);
    if (c) {
      c.lo = Math.min(c.lo, l.price); c.hi = Math.max(c.hi, l.price);
      if (!c.names.includes(l.name)) c.names.push(l.name);
      c._groups.add(l.group);
      if (l.proxy && l.group === "pool") c._proxy = true;
      continue;
    }
    out.push({ lo: l.price, hi: l.price, touch: l.price, names: [l.name], group: l.group, confluence: 0, distAtr: 0, rank: 0, pSession: null as unknown as Prob, p5d: null as unknown as Prob, _groups: new Set([l.group]), _proxy: !!(l.proxy && l.group === "pool") });
  }
  for (const c of out) {
    c.touch = side === "long" ? c.lo : c.hi;
    c.group = GROUP_ORDER.find((g) => c._groups.has(g))!;
    c.confluence = [...c._groups].reduce((a, g) => a + GROUP_W[g], 0) + Math.max(0, c.names.length - c._groups.size) * 0.5;
    c.distAtr = atr > 0 ? r2(Math.abs(c.touch - px) / atr) : 0;
    const key = `${c.group}|${distBucket(c.distAtr)}`;
    c.pSession = probOf(C.touchSession, key);
    c.p5d = probOf(C.touch5d, key);
    if (c.group === "session") for (const p of [c.pSession, c.p5d]) p.note = "not calibrated: session/15m map level (the 1h calibration cannot see it)";
    else if (c._proxy && c.group === "pool") for (const p of [c.pSession, c.p5d]) if (p.p != null) { p.proxy = true; p.note = "proxy: 1h-calibrated pool touch rate applied to a 1m/15m map pool"; }
  }
  const sorted = out.sort((a, b) => a.distAtr - b.distAtr);
  const byScore = [...sorted].sort((a, b) => b.confluence / (1 + b.distAtr) - a.confluence / (1 + a.distAtr));
  byScore.forEach((c, k) => (c.rank = k + 1));
  return sorted.map(({ _groups, _proxy, ...c }) => { void _groups; void _proxy; return c; });
}

/** A plan is invalid when its stop is on the wrong side of entry or price has already traded through it. */
export function stopCheck(side: Side, entry: number, stop: number, price: number): { valid: boolean; why: string | null } {
  if (side === "long" ? stop >= entry : stop <= entry) return { valid: false, why: `stop ${stop} is on the wrong side of entry ${entry} for a ${side}` };
  if (side === "long" ? price <= stop : price >= stop) return { valid: false, why: `price ${price} has already crossed the stop ${stop} — plan invalidated` };
  return { valid: true, why: null };
}

const entryOf = (a: MapArray, side: Side) => (a.kind === "fvg" || a.kind === "ifvg" || a.kind === "sponsored" ? a.ce : side === "long" ? a.hi : a.lo);
export function entriesFor(side: Side, px: number, atr: number, tick: number, arrays: MapArray[], swings: RawLevel[], targets: LadderLevel[]): LadderEntry[] {
  const buf = Math.max(2 * tick, 0.05 * atr);
  const long = side === "long";
  const cands: { kind: string; tf: string; entry: number; far: number }[] = [];
  for (const a of arrays) {
    if (!a.live || a.failed || a.dir !== (long ? "bull" : "bear")) continue;
    const e = snapSide(entryOf(a, side), tick, side);
    if (long ? e > px : e < px) continue; // retrace entries only: a long rests at/below price, a short at/above
    if (Math.abs(e - px) > 4 * atr) continue;
    cands.push({ kind: a.kind === "fvg" || a.kind === "ifvg" ? `${a.kind} CE` : a.kind, tf: a.tf, entry: e, far: long ? a.lo : a.hi });
  }
  // sweep retest: the nearest unswept liquidity on the OTHER side of price gets raided, entry back at the level
  for (const s of swings) {
    if (long ? !(s.side === "low" && s.price < px) : !(s.side === "high" && s.price > px)) continue;
    if (Math.abs(s.price - px) > 3 * atr) continue;
    cands.push({ kind: "sweep retest", tf: s.name, entry: snapSide(s.price, tick, side), far: long ? s.price - 0.25 * atr : s.price + 0.25 * atr });
  }
  const seen = new Set<string>();
  const out: LadderEntry[] = [];
  for (const c of cands.sort((a, b) => Math.abs(a.entry - px) - Math.abs(b.entry - px))) {
    const k = `${c.kind}:${c.entry}`; if (seen.has(k)) continue; seen.add(k);
    // the real swing protecting the array: nearest unswept swing beyond the array's far edge within 1 ATR
    const prot = swings.filter((s) => (long ? s.side === "low" && s.price <= c.far && s.price >= c.far - atr : s.side === "high" && s.price >= c.far && s.price <= c.far + atr))
      .sort((a, b) => (long ? b.price - a.price : a.price - b.price))[0];
    const base = prot ? prot.price : c.far;
    const stop = snapSide(long ? base - buf : base + buf, tick, side);
    const chk = stopCheck(side, c.entry, stop, px);
    const risk = Math.abs(c.entry - stop);
    const tg = targets.filter((t) => (long ? t.touch > c.entry : t.touch < c.entry)).map((t) => ({ touch: t.touch, r: r2(Math.abs(t.touch - c.entry) / risk) }));
    const t1 = tg.find((t) => t.r >= 1) ?? null;
    const distAtr = atr > 0 ? r2(Math.abs(c.entry - px) / atr) : 0;
    out.push({
      kind: c.kind, tf: c.tf, entry: c.entry, stop, stopWhy: prot ? `beyond ${prot.name} ${prot.price} (+${r2(buf)} buffer)` : `beyond the array's far edge ${r2(c.far)} (+${r2(buf)} buffer)`,
      distAtr, valid: chk.valid, invalidWhy: chk.why,
      pFill: (() => {
        const p = probOf(C.entryFill, `${c.kind === "sweep retest" ? "sweep" : "array"}|${distBucket(distAtr)}`);
        if (p.p != null && c.kind !== "sweep retest" && c.tf !== "1h" && c.tf !== "4h") { p.proxy = true; p.note = `proxy: 1h/4h gap-CE fill rate applied to a ${c.tf} array`; }
        return p;
      })(),
      pWin: t1 ? (() => { const p = probOf(C.entryWin, rrBucket(t1.r)); if (p.p != null) { p.proxy = true; p.note = "proxy: T1-before-stop rate of 1h-calibrated entries in this R bucket, not this exact setup"; } return p; })() : { p: null, n: 0, key: "no T1 ≥ 1R", note: "no target clears 1R" },
      t1R: t1?.r ?? null, targets: tg,
    });
    if (out.length >= 8) break;
  }
  return out;
}

// --------------------------------------------------------------------------------------------- fast LTF flip
const M = 60_000;
function resampleN(bars: OhlcBar[], ms: number): OhlcBar[] {
  const out: OhlcBar[] = [];
  for (const b of bars) {
    const k = Math.floor(b.t / ms) * ms; const L = out[out.length - 1];
    if (L && L.t === k) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; } else out.push({ ...b, t: k });
  }
  return out;
}
/** Opposing 3-candle gaps (bear gaps for a bull flip) formed at or before `uptoT`, on CLOSED bars. */
function opposingFvgs(bars: OhlcBar[], dir: "bull" | "bear", uptoT: number, tf: "1m" | "3m") {
  const out: { tf: "1m" | "3m"; lo: number; hi: number; ce: number; t: number; idx: number }[] = [];
  for (let k = 2; k < bars.length; k++) {
    const a = bars[k - 2]!, c = bars[k]!;
    if (c.t > uptoT) break;
    if (dir === "bear" && c.h < a.l) out.push({ tf, lo: c.h, hi: a.l, ce: r2((c.h + a.l) / 2), t: c.t, idx: k });
    if (dir === "bull" && c.l > a.h) out.push({ tf, lo: a.h, hi: c.l, ce: r2((a.h + c.l) / 2), t: c.t, idx: k });
  }
  return out;
}
/**
 * Live scenario swap (Keaton 10-15 08:55 CT): a ranked pool on one side is SWEPT (1m wick through), a 1m BODY close
 * comes back inside within `reclaimBars`, then the last opposing 1m/3m FVG (formed into the sweep) is INVERTED by a
 * body close through its far edge (MSS). Then the other side is PROMOTED: entry = that FVG's CE, stop = beyond the
 * sweep wick, targets = that side's ladder; the swept side is DEMOTED. Closed bars only. Shadow / display-only.
 */
export function ltfFlip(m1: OhlcBar[], pools: { side: Side; lo: number; hi: number; names: string[] }[], ladders: { long: LadderLevel[]; short: LadderLevel[] }, atr: number, tick: number, nowMs: number, windowMin = 60, reclaimBars = 10): LtfFlip | null {
  const w = m1.filter((b) => b.t + M <= nowMs && b.t >= nowMs - windowMin * M);
  if (w.length < 5) return null;
  const buf = Math.max(2 * tick, 0.05 * atr);
  let best: LtfFlip | null = null;
  for (const p of pools) {
    // p.side = the side whose TARGET the pool is: a sell-side pool (short target) swept → bull flip
    const bull = p.side === "short";
    const lvl = bull ? p.lo : p.hi;
    const i = w.findIndex((b) => (bull ? b.l < lvl : b.h > lvl));
    if (i < 0) continue;
    const flipSide: Side = bull ? "long" : "short";
    const why = [`${new Date(w[i]!.t).toISOString().slice(11, 16)}Z swept ${p.names.slice(0, 2).join(" · ")} ${lvl}`];
    let j = -1;
    for (let k = i; k < Math.min(w.length, i + reclaimBars + 1); k++) if (bull ? w[k]!.c > lvl : w[k]!.c < lvl) { j = k; break; }
    const upto = j >= 0 ? j : w.length - 1;
    const wick = bull ? Math.min(...w.slice(i, upto + 1).map((b) => b.l)) : Math.max(...w.slice(i, upto + 1).map((b) => b.h));
    const f: LtfFlip = { side: flipSide, demotes: bull ? "short" : "long", stage: "SWEPT", pool: { lo: p.lo, hi: p.hi, names: p.names }, sweepT: w[i]!.t, wick, reclaimT: null, fvg: null, inversionT: null, entry: null, stop: null, targets: [], why };
    if (j >= 0) {
      f.stage = "RECLAIMED"; f.reclaimT = w[j]!.t; why.push(`body close ${w[j]!.c} back ${bull ? "above" : "below"} ${lvl}`);
      // the last opposing FVG formed into the sweep (1m first, then 3m), then the first close through its far edge
      const cands = [...opposingFvgs(w, bull ? "bear" : "bull", w[j]!.t, "1m"), ...opposingFvgs(resampleN(w, 3 * M).filter((b) => b.t + 3 * M <= nowMs), bull ? "bear" : "bull", w[j]!.t, "3m")]
        .filter((g) => g.t >= w[Math.max(0, i - 15)]!.t).sort((a, b) => b.t - a.t);
      for (const g of cands) {
        const inv = w.find((b) => b.t > g.t && (bull ? b.c > g.hi : b.c < g.lo));
        if (!inv) continue;
        f.stage = "PROMOTED"; f.fvg = { tf: g.tf, lo: r2(g.lo), hi: r2(g.hi), ce: g.ce, t: g.t }; f.inversionT = inv.t;
        // the stop sits beyond the WHOLE sweep (every wick from the sweep bar to the inversion), not just the first poke
        const k2 = w.indexOf(inv);
        const fullWick = bull ? Math.min(...w.slice(i, k2 + 1).map((b) => b.l)) : Math.max(...w.slice(i, k2 + 1).map((b) => b.h));
        f.wick = fullWick;
        f.entry = snapSide(g.ce, tick, flipSide); f.stop = snapSide(bull ? fullWick - buf : fullWick + buf, tick, flipSide);
        const risk = Math.abs(f.entry - f.stop);
        f.targets = (bull ? ladders.long : ladders.short).filter((t) => (bull ? t.touch > f.entry! : t.touch < f.entry!)).map((t) => ({ touch: t.touch, r: r2(Math.abs(t.touch - f.entry!) / risk) }));
        why.push(`${g.tf} ${bull ? "bear" : "bull"} FVG ${r2(g.lo)}–${r2(g.hi)} inverted by close ${inv.c} (MSS) → ${flipSide} promoted, entry CE ${f.entry}, stop ${f.stop} beyond wick ${f.wick}; ${bull ? "short" : "long"} demoted`);
        break;
      }
    }
    const rankS = (x: LtfFlip) => ({ SWEPT: 0, RECLAIMED: 1, PROMOTED: 2 })[x.stage];
    // the NEWEST sweep is the live scenario (an older promotion is superseded); same bar → the further-advanced stage
    if (!best || f.sweepT > best.sweepT || (f.sweepT === best.sweepT && rankS(f) > rankS(best))) best = f;
  }
  return best;
}
/** Ranked pools from a ladder: the top-ranked / confluent levels on each side. */
export function rankedPools(bull: LadderLevel[], bear: LadderLevel[], maxRank = 8): { side: Side; lo: number; hi: number; names: string[] }[] {
  // ranked = an HTF liquidity cluster (not a lone session/15m print, not a gap edge) that ranks in the top `maxRank` or carries confluence
  const pick = (xs: LadderLevel[], side: Side) => xs.filter((x) => x.group !== "gap" && x.group !== "session" && (x.rank <= maxRank || x.confluence >= 2)).map((x) => ({ side, lo: x.lo, hi: x.hi, names: x.names }));
  return [...pick(bull, "long"), ...pick(bear, "short")];
}

export interface LadderInput {
  symbol: string; price: number; nowMs: number; hourly: OhlcBar[]; daily: OhlcBar[]; minuteClosed?: OhlcBar[];
  map?: PremarketMap | null; scen?: ScenarioRead | null;
  card?: { side: Side; entry: number | null; stop: number | null } | null;
}
export function ladderBook(i: LadderInput): LadderBook {
  const tick = TICK[i.symbol] ?? 0.25;
  const h = htfLevels({ symbol: i.symbol, hourly: i.hourly, daily: i.daily, cutT: i.nowMs, after: i.minuteClosed });
  const missing: string[] = [];
  if (h.h1.length < 100) missing.push(`1h history short (${h.h1.length} bars)`);
  const atr = h.atr1h || i.map?.atr15 || 0;
  const mapLv: RawLevel[] = (i.map?.levels ?? []).map((l) => ({
    price: l.price, name: l.name, side: /high|PDH|PWH|EQH/i.test(l.name) ? "high" : "low",
    group: l.kind === "pdh" || l.kind === "pdl" || l.kind === "pwh" || l.kind === "pwl" ? "pdpw" : l.kind === "pool" ? "pool" : "session",
  }));
  const poolsRaw = (i.map?.pools ?? []).filter((p) => !p.used);
  const poolOf = (p: (typeof poolsRaw)[number]): RawLevel => ({ price: p.price, name: p.name ?? `EQ ${p.tf}`, side: p.side === "buyside" ? "high" : "low", group: "pool", proxy: true });
  // Swept = a closed 1m bar since the level formed traded strictly through it.
  // Gaps are excluded (they have their own fill test). Applied to map levels, map pools AND the HTF set, so a level
  // swept after the last closed hour (e.g. 29638.75 at 08:54 CT) leaves targets, pools, clusters and stops at once.
  const curKey = sessionKeyOf(i.nowMs - 1);
  const m1Now = (i.minuteClosed ?? []).filter((b) => b.t + M <= i.nowMs);
  const m1Sess = m1Now.filter((b) => sessionKeyOf(b.t) === curKey);
  // A level with no formation time (map Premarket/Asia high, PDH, pools) counts from the LAST session bar that printed
  // it (so a higher overnight bar before a premarket high is not a "sweep" of it); none printed it → the whole session.
  const swept = (l: RawLevel) => {
    if (l.group === "gap") return false;
    const hi = l.side === "high";
    let from = m1Now;
    if (l.t != null) from = m1Now.filter((b) => b.t > l.t!);
    else { let k = -1; m1Sess.forEach((b, j) => { if (Math.abs((hi ? b.h : b.l) - l.price) < 1e-9) k = j; }); from = m1Sess.slice(k + 1); }
    return from.some((b) => (hi ? b.h > l.price : b.l < l.price));
  };
  const mapLvAll = mapLv;
  const pools: RawLevel[] = poolsRaw.filter((p) => p.sweptT == null).map(poolOf).filter((l) => !swept(l));
  const mapLvLive = mapLv.filter((l) => !swept(l));
  const htfLive = h.levels.filter((l) => !swept(l));
  // Map levels below/above price are only real liquidity on their own side (a broken PDL above price is not buyside).
  const all = [...htfLive, ...mapLvLive, ...pools];
  const above = all.filter((l) => l.price > i.price && (l.side === "high" || l.group === "gap"));
  const below = all.filter((l) => l.price < i.price && (l.side === "low" || l.group === "gap"));
  const gapEdge = (l: RawLevel, wantHigh: boolean) => l.group !== "gap" || (wantHigh ? l.side === "high" : l.side === "low");
  const bullT = cluster(above.filter((l) => gapEdge(l, true)), i.price, "long", atr, tick);
  const bearT = cluster(below.filter((l) => gapEdge(l, false)), i.price, "short", atr, tick);
  // the bull ladder runs at least to max(PDH, PWH); the bear ladder to min(PDL, PWL) or 12 ATR, whichever is further
  const cap = (xs: LadderLevel[], must: number | null) => xs.filter((x, k) => k < 12 || x.distAtr <= 12 || (must != null && Math.abs(x.touch - i.price) <= Math.abs(must - i.price) + 1e-9)).slice(0, 40);
  const pdpw = htfLive.filter((l) => l.group === "pdpw");
  const hiMust = Math.max(...pdpw.filter((l) => l.side === "high" && l.price > i.price).map((l) => l.price), -Infinity);
  const loMust = Math.min(...pdpw.filter((l) => l.side === "low" && l.price < i.price).map((l) => l.price), Infinity);
  const bullTargets = cap(bullT, Number.isFinite(hiMust) ? hiMust : null), bearTargets = cap(bearT, Number.isFinite(loMust) ? loMust : null);
  const swings = [...htfLive.filter((l) => l.group !== "gap"), ...mapLvLive.filter((l) => /swing/i.test(l.name)), ...pools];
  const arrays: MapArray[] = [...(i.map?.arrays ?? []), ...h.gaps.map((g) => ({ tf: g.tf as MapArray["tf"], kind: "fvg" as const, dir: g.dir, lo: g.lo, hi: g.hi, ce: (g.lo + g.hi) / 2, live: true, t: 0 }))]; // raw CE; entriesFor snaps it per side
  const sc = i.scen?.ranked ?? [];
  const pUp = sc.length ? r2(sc.filter((s) => s.dist === "up").reduce((a, s) => a + s.prior, 0)) : null;
  const prior = (up: boolean) => ({ p: pUp == null ? null : r2(up ? pUp : 1 - pUp), method: "deskSeq scenario priors (S1/S2 scripts, fitted LR when deskSeq.scenarioOdds.lr exists)", n: 38, note: "scenario top-1 hit 0.474 over n=38 sessions, holdout n=10 — small; read as a lean, not an edge" });
  const stack = i.map?.biasStack;
  const from: "bull" | "bear" | "mixed" = stack ? (stack.htf === stack.mtf && stack.htf !== "mixed" ? stack.htf : stack.mtf !== "mixed" ? stack.mtf : stack.htf) : "mixed";
  const sw1h = htfLive.filter((l) => l.group === "swing1h" || l.group === "swing4h");
  const hiAbove = sw1h.filter((l) => l.side === "high" && l.price > i.price).sort((a, b) => a.price - b.price)[0];
  const loBelow = sw1h.filter((l) => l.side === "low" && l.price < i.price).sort((a, b) => b.price - a.price)[0];
  const flip = from === "bear" && hiAbove ? { level: hiAbove.price, tf: "1h body close" as const, from, to: "bull", why: `a 1h body close above the last unswept lower high (${hiAbove.name}) breaks bear structure` }
    : from === "bull" && loBelow ? { level: loBelow.price, tf: "1h body close" as const, from, to: "bear", why: `a 1h body close below the last unswept higher low (${loBelow.name}) breaks bull structure` }
    : hiAbove || loBelow ? { level: (hiAbove ?? loBelow)!.price, tf: "1h body close" as const, from, to: hiAbove && loBelow ? `bull above ${hiAbove.price} / bear below ${loBelow.price}` : hiAbove ? "bull" : "bear", why: "bias mixed: the range between the nearest unswept 1h swings decides" }
    : null;
  let cardCheck: CardCheck | null = null;
  if (i.card && i.card.entry != null && i.card.stop != null) {
    const c = stopCheck(i.card.side, i.card.entry, i.card.stop, i.price);
    cardCheck = { symbol: i.symbol, side: i.card.side, entry: i.card.entry, stop: i.card.stop, price: i.price, valid: c.valid, why: c.why };
  }
  // Fast LTF flip: pools ranked as of 60 min ago (before any sweep in the window erased them from the live ladder).
  let flip2: LtfFlip | null = null;
  const noUpgrade: LadderBook["noUpgrade"] = [];
  const m1 = i.minuteClosed ?? [];
  if (m1.length) {
    const preT = i.nowMs - 60 * M;
    const pre = htfLevels({ symbol: i.symbol, hourly: i.hourly, daily: i.daily, cutT: preT, after: m1.filter((b) => b.t + M <= preT) });
    const prePx = [...m1].reverse().find((b) => b.t + M <= preT)?.c ?? null;
    if (prePx != null) {
      // pools as of 60 min ago: include ones swept since (that sweep is what the flip reads)
      const prePools = poolsRaw.filter((p) => p.sweptT == null || p.sweptT >= preT).map(poolOf);
      const preAll = [...pre.levels, ...mapLvAll, ...prePools];
      const pBull = cluster(preAll.filter((l) => l.price > prePx && l.side === "high" && l.group !== "gap"), prePx, "long", atr, tick);
      const pBear = cluster(preAll.filter((l) => l.price < prePx && l.side === "low" && l.group !== "gap"), prePx, "short", atr, tick);
      const rp = rankedPools(pBull, pBear);
      flip2 = ltfFlip(m1, rp, { long: bullTargets, short: bearTargets }, atr, tick, i.nowMs);
      const hits = rp.map((p) => {
        const lvl = p.side === "short" ? p.lo : p.hi;
        const sw = m1.find((b) => b.t + M <= i.nowMs && b.t >= preT && (p.side === "short" ? b.l < lvl : b.h > lvl));
        return sw ? { side: p.side, pool: `${p.names[0]} ${lvl}`, sweptT: sw.t, why: `${p.side} target pool ${p.names[0]} ${lvl} was just swept — no grade upgrade on the ${p.side} side into it` } : null;
      }).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.sweptT - a.sweptT);
      for (const h of hits) if (!noUpgrade.some((n) => n.side === h.side)) noUpgrade.push(h);
    }
  }
  const span = h.h1.length ? Math.round((h.h1.at(-1)!.t - h.h1[0]!.t) / 86_400_000) : 0;
  return {
    symbol: i.symbol, price: i.price, atr1h: r2(atr), asOfT: i.nowMs, bars1h: h.h1.length, spanDays: span,
    bull: { side: "long", bias: from === "bull" ? "with bias" : "counter-bias", prior: prior(true), entries: entriesFor("long", i.price, atr, tick, arrays, swings, bullTargets), targets: bullTargets },
    bear: { side: "short", bias: from === "bear" ? "with bias" : "counter-bias", prior: prior(false), entries: entriesFor("short", i.price, atr, tick, arrays, swings, bearTargets), targets: bearTargets },
    flip, cardCheck, ltfFlip: flip2, noUpgrade, missing,
  };
}

const pct = (p: Prob) => (p.p == null ? `n/a (${p.note ?? "n=" + p.n})` : `${p.proxy ? "PROXY " : ""}${Math.round(p.p * 100)}% n=${p.n}${p.note ? " [" + p.note + "]" : ""}`);
export function ladderText(b: LadderBook): string[] {
  const L: string[] = [`${b.symbol} px ${b.price} | ATR1h ${b.atr1h} | 1h history ${b.bars1h} bars / ${b.spanDays}d`];
  if (b.flip) L.push(`FLIP (${b.flip.tf}): ${b.flip.level} — ${b.flip.from} → ${b.flip.to}. ${b.flip.why}`);
  if (b.ltfFlip) L.push(`LTF FLIP ${b.ltfFlip.stage}: ${b.ltfFlip.side} (demotes ${b.ltfFlip.demotes})${b.ltfFlip.entry != null ? ` entry ${b.ltfFlip.entry} stop ${b.ltfFlip.stop} T1 ${b.ltfFlip.targets[0]?.touch ?? "-"}` : ""} — ${b.ltfFlip.why.join("; ")}`);
  for (const n of b.noUpgrade) L.push(`NO UPGRADE: ${n.why}`);
  if (b.cardCheck && !b.cardCheck.valid) L.push(`CARD PLAN INVALID: ${b.cardCheck.side} entry ${b.cardCheck.entry} stop ${b.cardCheck.stop}: ${b.cardCheck.why}`);
  for (const s of [b.bull, b.bear]) {
    L.push(`${s.side === "long" ? "BULL" : "BEAR"} (${s.bias}; side prior ${s.prior.p == null ? "n/a" : Math.round(s.prior.p * 100) + "%"} — ${s.prior.note})`);
    for (const e of s.entries) L.push(`  entry ${e.kind} [${e.tf}] ${e.entry} stop ${e.stop} (${e.stopWhy})${e.valid ? "" : " ✗ " + e.invalidWhy} | fill ${pct(e.pFill)} | T1 ${e.t1R ?? "-"}R win ${pct(e.pWin)}`);
    s.targets.forEach((t, k) => L.push(`  T${k + 1} ${t.lo === t.hi ? t.touch : `${t.lo}–${t.hi}`} (${t.distAtr} ATR, conf ${t.confluence}, rank ${t.rank}) ${t.names.slice(0, 4).join(" · ")} | session ${pct(t.pSession)} | 5d ${pct(t.p5d)}`));
  }
  return L;
}
export const LADDER_METHOD = (CAL as unknown as CalT).method;
