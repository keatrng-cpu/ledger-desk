/**
 * Fix 6 — premium/discount judged at the POI inside the DEALING LEG (the latest impulse: manipulation
 * extreme → the extreme since), plus an EQ stack (prior session, this session, Asia, London, NY OR,
 * overnight — one session each, 18:00 ET roll). The legacy pd_half grades CURRENT price in an 80×15m
 * window, so after a displacement every continuation short is "in discount" and fails (brief §B, audit F2c).
 * Shadow: published next to the legacy must; it never flips it.
 */
import type { OhlcBar } from "@/lib/market/types";
import { sessionKeyOf, sessionRanges } from "../smc-unity";
import { r2, seqMode, seqNum, type Mode, type Side } from "./rules";

export type Zone = "premium" | "discount" | "equilibrium";
export interface Leg { hi: number; lo: number; eq: number; hiT: number; loT: number }
export interface EqRow { name: string; hi: number; lo: number; eq: number; zone: Zone | null; ratio: number | null }
export interface PdLegRead {
  mode: Mode;
  side: Side;
  poi: number | null;
  leg: Leg | null;
  atPoi: { ratio: number; zone: Zone } | null;
  atPrice: { ratio: number; zone: Zone } | null;
  /** The leg must: a short's POI in the leg's premium, a long's in its discount (outside the EQ band). */
  pass: boolean | null;
  /** POI within the EQ band of the leg: no edge. */
  noEdge: boolean;
  eqStack: EqRow[];
  /** The legacy pd_half failed and the leg read passes. */
  flipsLegacy: boolean;
}

export function zoneOf(px: number, hi: number, lo: number, band = seqNum("pdLeg", "eqBand", 0.05)): { ratio: number; zone: Zone } | null {
  if (!(hi > lo) || !Number.isFinite(px)) return null;
  const ratio = (px - lo) / (hi - lo);
  const zone: Zone = ratio > 0.5 + band ? "premium" : ratio < 0.5 - band ? "discount" : "equilibrium";
  return { ratio: +ratio.toFixed(3), zone };
}

/** Closed 5m buckets from closed 1m (a bucket counts only once its 5 minutes have closed). */
export function closed5m(closed1m: OhlcBar[]): OhlcBar[] {
  const out: OhlcBar[] = [];
  for (const b of closed1m) {
    const k = Math.floor(b.t / 300_000) * 300_000;
    const L = out[out.length - 1];
    if (L && L.t === k) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; } else out.push({ ...b, t: k });
  }
  const last = closed1m[closed1m.length - 1];
  if (out.length && last && out[out.length - 1]!.t + 300_000 > last.t + 60_000) out.pop();
  return out;
}

/**
 * The dealing leg on CLOSED bars: for a short, the most recent CONFIRMED 5m swing high (2 lower highs each
 * side) above the reference price → the lowest 1m low since (mirror for a long). Falls back to the lookback
 * extreme when no confirmed swing exists.
 */
export function legOf(closed1m: OhlcBar[], side: Side, ref: number | null = null, lookbackMin = seqNum("pdLeg", "lookbackMin", 120)): Leg | null {
  const w = closed1m.slice(-lookbackMin);
  if (w.length < 5) return null;
  const b5 = closed5m(w);
  const k = 2;
  let ext: { px: number; t: number } | null = null;
  for (let i = b5.length - 1 - k; i >= k && !ext; i--) {
    const x = b5[i]!;
    const nb = [...b5.slice(i - k, i), ...b5.slice(i + 1, i + 1 + k)];
    const isSw = side === "short" ? nb.every((y) => y.h < x.h) : nb.every((y) => y.l > x.l);
    const px = side === "short" ? x.h : x.l;
    if (isSw && (ref == null || (side === "short" ? px > ref : px < ref))) ext = { px, t: x.t };
  }
  if (!ext) {
    let j = 0;
    for (let i = 1; i < w.length; i++) if (side === "short" ? w[i]!.h >= w[j]!.h : w[i]!.l <= w[j]!.l) j = i;
    ext = { px: side === "short" ? w[j]!.h : w[j]!.l, t: w[j]!.t };
  }
  const after = w.filter((b) => b.t >= ext!.t);
  if (after.length < 3) return null;
  const far = side === "short" ? after.reduce((a, b) => (b.l < a.l ? b : a)) : after.reduce((a, b) => (b.h > a.h ? b : a));
  // the bucket's own extreme: the 1m bar inside the 5m swing bucket
  const inB = after.filter((b) => b.t < ext!.t + 300_000);
  const xb = side === "short" ? inB.reduce((a, b) => (b.h > a.h ? b : a)) : inB.reduce((a, b) => (b.l < a.l ? b : a));
  const hi = side === "short" ? ext.px : far.h, lo = side === "short" ? far.l : ext.px;
  if (!(hi > lo)) return null;
  return { hi, lo, eq: r2((hi + lo) / 2), hiT: side === "short" ? xb.t : far.t, loT: side === "short" ? far.t : xb.t };
}

/** Prior session (PDH/PDL, 18:00 ET roll) + this session so far + the named session ranges, each one session only. */
export function eqStack(closed1m: OhlcBar[], px: number | null, feedNowMs: number | null): EqRow[] {
  if (!closed1m.length) return [];
  const cur = sessionKeyOf(closed1m[closed1m.length - 1]!.t);
  const curBars = closed1m.filter((b) => sessionKeyOf(b.t) === cur);
  const prev = closed1m.filter((b) => sessionKeyOf(b.t) < cur);
  const pk = prev.length ? sessionKeyOf(prev[prev.length - 1]!.t) : null;
  const ps = pk ? prev.filter((b) => sessionKeyOf(b.t) === pk) : [];
  const rows: { name: string; hi: number; lo: number }[] = [];
  if (ps.length) rows.push({ name: "Prior session (PDH/PDL)", hi: Math.max(...ps.map((b) => b.h)), lo: Math.min(...ps.map((b) => b.l)) });
  if (curBars.length) rows.push({ name: "This session", hi: Math.max(...curBars.map((b) => b.h)), lo: Math.min(...curBars.map((b) => b.l)) });
  rows.push(...sessionRanges(closed1m, feedNowMs));
  return rows.map((r) => {
    const z = px != null ? zoneOf(px, r.hi, r.lo) : null;
    return { name: r.name, hi: r.hi, lo: r.lo, eq: r2((r.hi + r.lo) / 2), zone: z?.zone ?? null, ratio: z?.ratio ?? null };
  });
}

export function pdLegRead(i: { side: Side; poi: number | null; price: number | null; closed1m: OhlcBar[]; feedNowMs: number | null; legacyFail: boolean }): PdLegRead {
  const leg = legOf(i.closed1m, i.side, i.poi ?? i.price);
  const atPoi = leg && i.poi != null ? zoneOf(i.poi, leg.hi, leg.lo) : null;
  const atPrice = leg && i.price != null ? zoneOf(i.price, leg.hi, leg.lo) : null;
  const want: Zone = i.side === "short" ? "premium" : "discount";
  const pass = atPoi ? atPoi.zone === want : null;
  return {
    mode: seqMode("pdLeg"),
    side: i.side,
    poi: i.poi,
    leg,
    atPoi,
    atPrice,
    pass,
    noEdge: atPoi?.zone === "equilibrium",
    eqStack: eqStack(i.closed1m, i.poi ?? i.price, i.feedNowMs),
    flipsLegacy: i.legacyFail && pass === true,
  };
}
