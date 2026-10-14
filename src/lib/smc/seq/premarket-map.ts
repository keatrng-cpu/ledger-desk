/**
 * Fix 1 — the premarket MAP: one object per book, frozen at 09:25 ET from bars CLOSED by then (the
 * session's own bars, 18:00 ET roll). It is Keaton's step 1: every important array on every rung, the key
 * levels, the liquidity pools, the dealing-range EQ, the AMD phase and the bias per rung — in one place, so
 * the brain, the Floor and the watcher read the same picture instead of recomputing three.
 *
 * Rungs: 1m 2m 3m 4m 5m 15m 30m 1h 4h 1D. 30s is listed as MISSING (the desk feed carries 1m bars; it is
 * never synthesized from 1m). Arrays = FVG / IFVG / sponsored (mtf-arrays.ts, failed inversions marked) plus
 * OB / breaker / rejection blocks on 5m–4h and 1D. Each array carries CE and both edges. Body closes decide
 * respect; wicks decide sweeps (fix 10 reads them live).
 */
import type { OhlcBar } from "@/lib/market/types";
import { detectFvgs, fractalSwings, rollingAtr } from "@/lib/trading/detectors";
import { mtfArrays, type ArrayRow } from "../mtf-arrays";
import { sessionKeyOf } from "../smc-unity";
import { etOf, r2, seqMode, seqNum, type Mode, type Side } from "./rules";

export type MapTf = "1m" | "2m" | "3m" | "4m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1D";
export interface MapArray { tf: MapTf; kind: "fvg" | "ifvg" | "sponsored" | "ob" | "breaker" | "rejection"; dir: "bull" | "bear"; lo: number; hi: number; ce: number; live: boolean; failed?: boolean; t: number }
export interface MapLevel { name: string; price: number; kind: "pdh" | "pdl" | "pwh" | "pwl" | "session" | "open" | "pool" }
export interface MapPool { side: "buyside" | "sellside"; price: number; touches: number; tf: string }
export type AmdPhase = "accumulation" | "manipulation" | "distribution" | "unknown";
export interface PremarketMap {
  mode: Mode;
  symbol: string;
  session: string;
  asOfT: number | null;
  frozen: boolean;
  missing: string[];
  arrays: MapArray[];
  levels: MapLevel[];
  pools: MapPool[];
  range: { name: string; hi: number; lo: number; eq: number } | null;
  zone: "premium" | "discount" | "equilibrium" | null;
  price: number | null;
  bias: Record<string, "bull" | "bear" | "none">;
  biasStack: { htf: "bull" | "bear" | "mixed"; mtf: "bull" | "bear" | "mixed"; ltf: "bull" | "bear" | "mixed" };
  amd: { phase: AmdPhase; asia: { hi: number; lo: number } | null; londonSwept: "high" | "low" | "both" | null; expectManip: "high" | "low" | null; why: string[] };
  atr15: number | null;
}

const MIN: Record<string, number> = { "1m": 1, "2m": 2, "3m": 3, "4m": 4, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240 };
export function resample(bars: OhlcBar[], ms: number): OhlcBar[] {
  const out: OhlcBar[] = [];
  for (const b of bars) {
    const k = Math.floor(b.t / ms) * ms;
    const L = out[out.length - 1];
    if (L && L.t === k) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; } else out.push({ ...b, t: k });
  }
  return out;
}
/** Closed buckets only: a bucket counts once its whole span has closed at cutT. */
export function closedBuckets(bars: OhlcBar[], ms: number, cutT: number): OhlcBar[] {
  return resample(bars, ms).filter((b) => b.t + ms <= cutT);
}
/** Session bars (18:00 ET roll) → one daily bar per session (the desk's "1D"). */
export function sessionDaily(bars: OhlcBar[]): (OhlcBar & { key: string })[] {
  const out: (OhlcBar & { key: string })[] = [];
  for (const b of bars) {
    const key = sessionKeyOf(b.t);
    const L = out[out.length - 1];
    if (L && L.key === key) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; } else out.push({ ...b, key });
  }
  return out;
}

/** OB / breaker / rejection blocks on CLOSED bars. OB = last opposite candle before a displacement close beyond the prior swing; breaker = OB closed through (polarity flips); rejection = swing candle whose wick is ≥ 2× its body. */
export function blocksOf(bars: OhlcBar[], tf: MapTf): MapArray[] {
  if (bars.length < 12) return [];
  const atr = rollingAtr(bars);
  const sw = fractalSwings(bars, 2);
  const out: MapArray[] = [];
  const last = bars[bars.length - 1]!;
  for (let i = 3; i < bars.length; i++) {
    const b = bars[i]!, a = atr[i] ?? null;
    if (!a) continue;
    const body = Math.abs(b.c - b.o);
    if (body < 1.2 * a) continue;
    const bull = b.c > b.o;
    // prior swing broken by this close
    const prior = sw.filter((s) => s.index < i - 1 && s.kind === (bull ? "high" : "low")).pop();
    if (!prior || (bull ? b.c <= prior.price : b.c >= prior.price)) continue;
    let j = i - 1;
    while (j > 0 && (bull ? bars[j]!.c >= bars[j]!.o : bars[j]!.c <= bars[j]!.o)) j--;
    const ob = bars[j]!;
    const lo = Math.min(ob.o, ob.c, ob.l), hi = Math.max(ob.o, ob.c, ob.h);
    const after = bars.slice(i + 1);
    const broken = after.some((x) => (bull ? x.c < lo : x.c > hi));
    out.push({ tf, kind: broken ? "breaker" : "ob", dir: broken ? (bull ? "bear" : "bull") : bull ? "bull" : "bear", lo: r2(lo), hi: r2(hi), ce: r2((lo + hi) / 2), live: broken ? !after.slice(after.findIndex((x) => (bull ? x.c < lo : x.c > hi)) + 1).some((x) => (bull ? x.c > hi : x.c < lo)) : !broken, t: ob.t });
  }
  for (const s of sw) {
    const b = bars[s.index]!;
    const body = Math.max(Math.abs(b.c - b.o), 1e-9);
    const wick = s.kind === "high" ? b.h - Math.max(b.o, b.c) : Math.min(b.o, b.c) - b.l;
    if (wick < 2 * body) continue;
    const lo = s.kind === "high" ? Math.max(b.o, b.c) : b.l, hi = s.kind === "high" ? b.h : Math.min(b.o, b.c);
    const after = bars.slice(s.index + 1);
    const live = !after.some((x) => (s.kind === "high" ? x.c > hi : x.c < lo));
    out.push({ tf, kind: "rejection", dir: s.kind === "high" ? "bear" : "bull", lo: r2(lo), hi: r2(hi), ce: r2((lo + hi) / 2), live, t: b.t });
  }
  void last;
  return out;
}

/** Bias of one rung on closed bars: the last close beyond the last confirmed swing high (bull) or low (bear). */
export function rungBias(bars: OhlcBar[]): "bull" | "bear" | "none" {
  if (bars.length < 8) return "none";
  const sw = fractalSwings(bars, 2);
  let state: "bull" | "bear" | "none" = "none";
  let hi: number | null = null, lo: number | null = null;
  let si = 0;
  for (let i = 0; i < bars.length; i++) {
    while (si < sw.length && sw[si]!.index + 2 < i) { const s = sw[si++]!; if (s.kind === "high") hi = s.price; else lo = s.price; }
    const c = bars[i]!.c;
    if (hi != null && c > hi) { state = "bull"; hi = null; }
    else if (lo != null && c < lo) { state = "bear"; lo = null; }
  }
  return state;
}

/** Equal highs / lows: ≥ 2 confirmed swing extremes within tol of each other, not yet traded through. */
export function equalPools(bars: OhlcBar[], tf: string, tol: number): MapPool[] {
  const sw = fractalSwings(bars, 2).filter((s) => s.index + 2 < bars.length);
  const out: MapPool[] = [];
  for (const kind of ["high", "low"] as const) {
    const xs = sw.filter((s) => s.kind === kind);
    const used = new Set<number>();
    for (let a = xs.length - 1; a >= 0; a--) {
      if (used.has(a)) continue;
      const grp = [a];
      for (let b = a - 1; b >= 0; b--) if (!used.has(b) && Math.abs(xs[b]!.price - xs[a]!.price) <= tol) grp.push(b);
      if (grp.length < 2) continue;
      grp.forEach((g) => used.add(g));
      const px = kind === "high" ? Math.max(...grp.map((g) => xs[g]!.price)) : Math.min(...grp.map((g) => xs[g]!.price));
      const since = bars.slice(Math.max(...grp.map((g) => xs[g]!.index)) + 1);
      if (since.some((x) => (kind === "high" ? x.h > px : x.l < px))) continue; // swept
      out.push({ side: kind === "high" ? "buyside" : "sellside", price: r2(px), touches: grp.length, tf });
    }
  }
  return out;
}

const stackOf = (xs: ("bull" | "bear" | "none")[]): "bull" | "bear" | "mixed" => {
  const b = xs.filter((x) => x === "bull").length, s = xs.filter((x) => x === "bear").length;
  return b > s ? "bull" : s > b ? "bear" : "mixed";
};

export interface MapInput {
  symbol: string;
  /** CLOSED 1m bars (by feed time), several sessions back. */
  minute: OhlcBar[];
  /** Optional higher-history 15m bars; when absent, 15m is built from `minute`. */
  bars15?: OhlcBar[] | null;
  /** Session daily bars (18:00 roll) for 1D arrays and PWH/PWL; when absent, built from `minute`. */
  daily?: OhlcBar[] | null;
  /** Desk reference levels (PDH/PDL/PWH/PWL …) — preferred over computed ones when present. */
  deskLevels?: { name: string; price: number }[] | null;
  /** Feed time now (ms). The map freezes at freezeEt (default 09:25 ET) of the current session. */
  nowMs: number;
}

const freezeHm = (): number => {
  const v = seqNum("premarketMap", "freezeEtMin", 9 * 60 + 25);
  return v;
};

/** The cut time: the current session's 09:25 ET if it has passed, else now (a live pre-09:25 draft). */
export function mapCut(nowMs: number): { cutT: number; frozen: boolean } {
  const e = etOf(nowMs);
  const fz = freezeHm();
  if (e.hm >= fz && e.hm < 18 * 60) return { cutT: nowMs - (e.hm - fz) * 60_000 - (nowMs % 60_000), frozen: true };
  return { cutT: nowMs, frozen: false };
}

export function premarketMap(i: MapInput): PremarketMap {
  const { cutT, frozen } = mapCut(i.nowMs);
  const m1 = i.minute.filter((b) => b.t + 60_000 <= cutT);
  const missing: string[] = ["30s: the desk feed carries 1m bars; 30s is not synthesized"];
  const empty = (why: string): PremarketMap => ({ mode: seqMode("premarketMap"), symbol: i.symbol, session: "", asOfT: null, frozen, missing: [...missing, why], arrays: [], levels: [], pools: [], range: null, zone: null, price: null, bias: {}, biasStack: { htf: "mixed", mtf: "mixed", ltf: "mixed" }, amd: { phase: "unknown", asia: null, londonSwept: null, expectManip: null, why: [] }, atr15: null });
  if (m1.length < 60) return empty("fewer than 60 closed 1m bars before the cut");
  const last = m1[m1.length - 1]!;
  const session = sessionKeyOf(last.t);
  const b15 = (i.bars15?.length ? i.bars15.filter((b) => b.t + 900_000 <= cutT) : closedBuckets(m1, 900_000, cutT));
  const a15 = rollingAtr(b15); const atr15 = a15[a15.length - 1] ?? null;
  // arrays 1m–4h (desk's own detector), live and failed flags
  const rows: ArrayRow[] = mtfArrays(`${i.symbol}:map`, m1.slice(-3000), b15.slice(-400));
  const arrays: MapArray[] = rows.map((r) => ({ tf: r.tf as MapTf, kind: r.kind, dir: r.dir, lo: r.lo, hi: r.hi, ce: r.ce, live: !r.mitigated, failed: r.failed, t: r.createdT }));
  const series: Record<string, OhlcBar[]> = {};
  for (const tf of ["1m", "5m", "15m", "30m", "1h", "4h"]) {
    const ms = MIN[tf]! * 60_000;
    series[tf] = tf === "1m" ? m1.slice(-600) : tf === "15m" || tf === "30m" || tf === "1h" || tf === "4h" ? closedBuckets(b15, ms, cutT) : closedBuckets(m1.slice(-3000), ms, cutT);
  }
  // 1D = sessions (18:00 roll); the current session is forming → excluded
  const daily = (i.daily?.length ? i.daily : sessionDaily(m1)).filter((d) => sessionKeyOf(d.t + 60_000) < session || (i.daily?.length ? d.t + 86_400_000 <= cutT : false));
  series["1D"] = daily;
  if (daily.length >= 5) {
    for (const g of detectFvgs(daily)) {
      const inv = g.inverted;
      arrays.push({ tf: "1D", kind: inv ? "ifvg" : "fvg", dir: inv ? (g.kind === "bull" ? "bear" : "bull") : g.kind, lo: r2(g.bottom), hi: r2(g.top), ce: r2((g.top + g.bottom) / 2), live: inv ? !g.inversionFailed : g.fill !== "full", failed: inv ? g.inversionFailed === true : undefined, t: g.createdT });
    }
  } else missing.push(`1D: ${daily.length} prior sessions (need 5)`);
  for (const tf of ["5m", "15m", "30m", "1h", "4h", "1D"] as const) arrays.push(...blocksOf(series[tf] ?? [], tf));
  // levels
  const levels: MapLevel[] = [];
  const px0 = last.c;
  const dl = (n: RegExp) => i.deskLevels?.find((x) => n.test(x.name))?.price ?? null;
  const prevKey = [...new Set(m1.map((b) => sessionKeyOf(b.t)))].filter((k) => k < session).pop() ?? null;
  const ps = prevKey ? m1.filter((b) => sessionKeyOf(b.t) === prevKey) : [];
  const pdh = dl(/^PDH\b/) ?? (ps.length ? Math.max(...ps.map((b) => b.h)) : null);
  const pdl = dl(/^PDL\b/) ?? (ps.length ? Math.min(...ps.map((b) => b.l)) : null);
  if (pdh != null) levels.push({ name: "PDH", price: pdh, kind: "pdh" });
  if (pdl != null) levels.push({ name: "PDL", price: pdl, kind: "pdl" });
  // prior week: sessions of the previous ET week (Mon–Fri session keys)
  const wkOf = (key: string) => { const d = new Date(key + "T12:00:00Z"); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return d.toISOString().slice(0, 10); };
  const dlist = (i.daily?.length ? i.daily.map((d) => ({ ...d, key: sessionKeyOf(d.t + 60_000) })) : sessionDaily(m1));
  const curWk = wkOf(session);
  const prevWk = [...new Set(dlist.map((d) => wkOf(d.key)))].filter((w) => w < curWk).pop() ?? null;
  const pw = prevWk ? dlist.filter((d) => wkOf(d.key) === prevWk) : [];
  const pwh = dl(/^PWH\b/) ?? (pw.length ? Math.max(...pw.map((d) => d.h)) : null);
  const pwl = dl(/^PWL\b/) ?? (pw.length ? Math.min(...pw.map((d) => d.l)) : null);
  if (pwh != null) levels.push({ name: "PWH", price: pwh, kind: "pwh" }); else missing.push("PWH: no prior-week sessions in the tape");
  if (pwl != null) levels.push({ name: "PWL", price: pwl, kind: "pwl" });
  // older session extremes (D-2 … D-5): external liquidity resting at prior daily highs/lows
  const olderD = dlist.filter((d) => d.key < (prevKey ?? session)).slice(-seqNum("premarketMap", "olderSessions", 10));
  olderD.forEach((d, k) => { const n = olderD.length - k + 1; levels.push({ name: `D-${n} high`, price: d.h, kind: "session" }, { name: `D-${n} low`, price: d.l, kind: "session" }); });
  const cur = m1.filter((b) => sessionKeyOf(b.t) === session);
  const win = (a: number, z: number) => cur.filter((b) => { const hm = etOf(b.t).hm; return a <= z ? hm >= a && hm < z : hm >= a || hm < z; });
  const named: [string, number, number][] = [["Asia", 20 * 60, 24 * 60], ["London", 2 * 60, 5 * 60], ["Premarket", 7 * 60, 9 * 60 + 30], ["Overnight", 18 * 60, 9 * 60 + 30]];
  const ranges: Record<string, { hi: number; lo: number }> = {};
  for (const [n, a, z] of named) {
    const xs = win(a, z);
    if (!xs.length) continue;
    const hi = Math.max(...xs.map((b) => b.h)), lo = Math.min(...xs.map((b) => b.l));
    ranges[n] = { hi, lo };
    levels.push({ name: `${n} high`, price: hi, kind: "session" }, { name: `${n} low`, price: lo, kind: "session" });
  }
  const mid = cur.find((b) => etOf(b.t).hm === 0);
  if (mid) levels.push({ name: "Midnight open", price: mid.o, kind: "open" });
  if (cur[0]) levels.push({ name: "Session open (18:00)", price: cur[0].o, kind: "open" });
  // pools
  const tol = (atr15 ?? 0) * seqNum("premarketMap", "eqTolAtr", 0.1);
  const win0 = Math.max((atr15 ?? 0) * seqNum("premarketMap", "windowAtr", 8), 1e-9);
  const near = (p: number) => Math.abs(p - px0) <= win0;
  const poolsAll = tol > 0 ? [...equalPools(series["5m"]!.slice(-300), "5m", tol), ...equalPools(series["15m"]!.slice(-200), "15m", tol)] : [];
  const byDist = (a: MapPool, b: MapPool) => Math.abs(a.price - px0) - Math.abs(b.price - px0);
  const perSide = Math.max(1, Math.floor(seqNum("premarketMap", "maxPools", 8) / 2));
  const pools = [...poolsAll.filter((p) => near(p.price) && p.side === "buyside").sort(byDist).slice(0, perSide), ...poolsAll.filter((p) => near(p.price) && p.side === "sellside").sort(byDist).slice(0, perSide)];
  for (const p of pools) levels.push({ name: `EQ${p.side === "buyside" ? "H" : "L"} ${p.tf} ×${p.touches}`, price: p.price, kind: "pool" });
  // dealing range: prior session + overnight (one session each)
  const on = ranges["Overnight"];
  const range = pdh != null && pdl != null ? { name: "PD range + overnight", hi: Math.max(pdh, on?.hi ?? -Infinity), lo: Math.min(pdl, on?.lo ?? Infinity), eq: 0 } : null;
  if (range) range.eq = r2((range.hi + range.lo) / 2);
  const price = last.c;
  const rr = range && range.hi > range.lo ? (price - range.lo) / (range.hi - range.lo) : null;
  const zone = rr == null ? null : rr > 0.55 ? "premium" : rr < 0.45 ? "discount" : "equilibrium";
  // bias per rung
  const bias: PremarketMap["bias"] = {};
  for (const tf of ["1m", "5m", "15m", "30m", "1h", "4h", "1D"]) bias[tf] = rungBias(series[tf] ?? []);
  const biasStack = { htf: stackOf([bias["4h"]!, bias["1D"]!]), mtf: stackOf([bias["15m"]!, bias["30m"]!, bias["1h"]!]), ltf: stackOf([bias["1m"]!, bias["5m"]!]) };
  // AMD at the cut
  const why: string[] = [];
  const asia = ranges["Asia"] ?? null;
  const lon = win(2 * 60, 5 * 60);
  let londonSwept: PremarketMap["amd"]["londonSwept"] = null;
  if (asia && lon.length) {
    const h = lon.some((b) => b.h > asia.hi), l = lon.some((b) => b.l < asia.lo);
    londonSwept = h && l ? "both" : h ? "high" : l ? "low" : null;
    if (londonSwept) why.push(`London swept the Asia ${londonSwept}`);
  }
  const htfDir = biasStack.htf === "mixed" ? (bias["1h"] === "none" ? null : bias["1h"]) : biasStack.htf;
  let expectManip: "high" | "low" | null = null;
  if (htfDir === "bear" || (zone === "premium" && htfDir !== "bull")) expectManip = "high";
  else if (htfDir === "bull" || (zone === "discount" && htfDir !== "bear")) expectManip = "low";
  if (expectManip) why.push(`${htfDir ?? "no"} HTF, price in ${zone ?? "?"} → expect the open to raid the ${expectManip} side first, then distribute ${expectManip === "high" ? "down" : "up"}`);
  const phase: AmdPhase = etOf(cutT).hm < 9 * 60 + 30 ? "accumulation" : "unknown";
  // keep the live arrays that matter: within the window, nearest maxPerTf per (tf, kind, dir); failed inversions kept as evidence
  const keep: MapArray[] = [];
  const per = seqNum("premarketMap", "maxPerTf", 3);
  const groups = new Map<string, MapArray[]>();
  const seenA = new Set<string>();
  for (const a of arrays) {
    const id = `${a.tf}:${a.kind}:${a.dir}:${a.lo}:${a.hi}`;
    if (seenA.has(id)) continue;
    seenA.add(id);
    if (!(a.live || a.failed) || !(near(a.lo) || near(a.hi))) continue;
    const k = `${a.tf}:${a.kind}:${a.dir}:${a.failed ? "f" : ""}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(a);
  }
  for (const g of groups.values()) keep.push(...g.sort((a, b) => Math.abs(a.ce - px0) - Math.abs(b.ce - px0)).slice(0, per));
  return { mode: seqMode("premarketMap"), symbol: i.symbol, session, asOfT: last.t + 60_000, frozen, missing, arrays: keep, levels, pools, range, zone, price, bias, biasStack, amd: { phase, asia, londonSwept, expectManip, why }, atr15: atr15 != null ? r2(atr15) : null };
}

/** Mapped targets beyond `px` on the trade side, nearest first (real levels, pools and array edges only). */
export function mappedTargets(map: PremarketMap, side: Side, px: number): { name: string; price: number }[] {
  const lv = map.levels.map((l) => ({ name: l.name, price: l.price }));
  const arr = map.arrays.filter((a) => a.live && ["15m", "30m", "1h", "4h", "1D"].includes(a.tf)).map((a) => ({ name: `${a.tf} ${a.kind} ${side === "short" ? "top" : "bottom"}`, price: side === "short" ? a.hi : a.lo }));
  return [...lv, ...arr].filter((x) => (side === "short" ? x.price < px : x.price > px)).sort((a, b) => Math.abs(a.price - px) - Math.abs(b.price - px));
}

const MAP_CACHE = new Map<string, PremarketMap>();
/** Cached by symbol + cut minute + last closed bar: the frozen map is computed once per session. */
export function premarketMapCached(i: MapInput): PremarketMap {
  const { cutT } = mapCut(i.nowMs);
  const lastClosed = [...i.minute].reverse().find((b) => b.t + 60_000 <= cutT);
  const key = `${i.symbol}:${Math.floor(cutT / 60_000)}:${lastClosed?.t ?? 0}:${i.minute.length > 0}`;
  const hit = MAP_CACHE.get(key);
  if (hit) return hit;
  const m = premarketMap(i);
  if (MAP_CACHE.size > 16) MAP_CACHE.delete(MAP_CACHE.keys().next().value!);
  MAP_CACHE.set(key, m);
  return m;
}
