/**
 * EVERY-TF CLOSES (Keaton 2026-10-17, shared rules `everyTf`).
 *
 * The desk used to grade the CLOSED 15m series only. This reads the newest CLOSED bar on every rung —
 * 1m 2m 3m 4m 5m (from the 1m tape), 15m 30m 1h 4h (from the closed 15m series) and 1D (the daily series,
 * Globex session) — and, for each, both the body AND the wicks:
 *
 *   shape      body, upper/lower wick (points and share of range), body/range, close location (0 = low, 1 = high)
 *   disp       body / ATR14 of the bars before it, and body/range — the two displacement measures
 *   sweep      a pool taken by this bar: `wick` = wick through and close back (rejection), `body` = close beyond
 *   inversion  an opposite FVG (wick-to-wick AND body-to-body definitions) closed through its far edge
 *              (`body`) or only wicked through it (`wick`)
 *   mss        the last confirmed fractal swing broken by a close (`body`) or by a wick only (`wick`)
 *
 * Nothing here reads a forming bar: a bucket counts only once its full span has elapsed by `nowMs`.
 * 4h and 1D buckets are anchored to the 18:00 ET Globex open (DST-aware), not to UTC epoch.
 * This module computes facts; it does not gate. The desk, Brain, Floor and watcher all read the same object
 * (`card.everyTf`, `wire.strategy.everyTf`, the Brain/Floor `everyTfSeat` note).
 */
import RULES from "../../../shared/desk-rules.json";
import type { OhlcBar } from "@/lib/market/types";
import { rollingAtr } from "@/lib/trading/detectors";
import { completeBuckets } from "@/lib/market/minute-gaps";

export type EveryTf = "1m" | "2m" | "3m" | "4m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1D";
export interface EveryTfRules {
  mode: "live" | "shadow";
  tfs: EveryTf[];
  dispAtr: number;
  bodyRangeMin: number;
  rejectWickMin: number;
  fvgFreshBars: number;
  swingWidth: number;
}
export const EVERY_TF = (RULES as unknown as { everyTf: EveryTfRules }).everyTf;
export const TF_MS: Record<EveryTf, number> = { "1m": 60_000, "2m": 120_000, "3m": 180_000, "4m": 240_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "4h": 14_400_000, "1D": 86_400_000 };
const LTF = new Set<EveryTf>(["1m", "2m", "3m", "4m", "5m"]);
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
/** Minutes since the 18:00 ET Globex open for an epoch ms (DST-aware). */
export function minutesSinceGlobexOpen(t: number): number {
  const p = ET.formatToParts(new Date(t));
  const h = Number(p.find((x) => x.type === "hour")!.value) % 24, m = Number(p.find((x) => x.type === "minute")!.value);
  return (((h * 60 + m) - 18 * 60) % 1440 + 1440) % 1440;
}
/** Bucket start for a session-anchored bucket of `ms` (4h -> 18:00, 22:00, 02:00, 06:00, 10:00, 14:00 ET; 1D -> 18:00 ET). */
export function sessionBucketStart(t: number, ms: number): number {
  const since = minutesSinceGlobexOpen(t), span = ms / 60_000;
  return t - (t % 60_000) - (since % span) * 60_000;
}
/** Session length of a bucket: a 1D bucket ends at 17:00 ET (23h), the last 4h bucket at 17:00 ET (3h). */
function bucketEnd(start: number, ms: number): number {
  const since = minutesSinceGlobexOpen(start);
  return start + Math.min(ms, (23 * 60 - since) * 60_000);
}

/** Resample to `ms` from CLOSED source bars; keep only buckets whose whole span has elapsed by nowMs. */
export function closedBuckets(src: OhlcBar[], ms: number, srcMs: number, nowMs: number, anchored: boolean): OhlcBar[] {
  const done = src.filter((b) => b.t + srcMs <= nowMs);
  if (!anchored) {
    // same hole rule as the desk's mtf-arrays rung(): a bucket missing a run of Globex-open source bars is dropped (#19)
    const out = ms === srcMs ? done.map((b) => ({ ...b })) : completeBuckets(done, ms, srcMs);
    const last = out[out.length - 1];
    if (last && last.t + ms > nowMs) out.pop();
    return out;
  }
  const out: OhlcBar[] = [];
  for (const b of done) {
    const k = anchored ? sessionBucketStart(b.t, ms) : Math.floor(b.t / ms) * ms;
    const L = out[out.length - 1];
    if (L && L.t === k) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; L.v = (L.v ?? 0) + (b.v ?? 0); }
    else out.push({ t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0 });
  }
  const last = out[out.length - 1];
  if (last && bucketEnd(last.t, ms) > nowMs) out.pop();
  return out;
}

export interface BarShape { body: number; range: number; upperWick: number; lowerWick: number; bodyPct: number; upperPct: number; lowerPct: number; closeLoc: number; dir: "up" | "down" | "doji" }
export function barShape(b: Pick<OhlcBar, "o" | "h" | "l" | "c">): BarShape {
  const range = Math.max(b.h - b.l, 0), top = Math.max(b.o, b.c), bot = Math.min(b.o, b.c), body = top - bot;
  const pct = (x: number) => (range > 0 ? r3(x / range) : 0);
  return { body: r2(body), range: r2(range), upperWick: r2(b.h - top), lowerWick: r2(bot - b.l), bodyPct: pct(body), upperPct: pct(b.h - top), lowerPct: pct(bot - b.l), closeLoc: range > 0 ? r3((b.c - b.l) / range) : 0.5, dir: b.c > b.o ? "up" : b.c < b.o ? "down" : "doji" };
}

export interface Pool { name: string; price: number }
export interface TfClose {
  tf: EveryTf;
  t: number;
  closeMs: number;
  o: number; h: number; l: number; c: number;
  shape: BarShape;
  dispAtr: number | null;
  displacement: { up: boolean; down: boolean };
  sweep: { side: "BSL" | "SSL"; pool: string; level: number; mode: "wick" | "body"; rejectWick: number }[];
  inversion: { dir: "bull" | "bear"; lo: number; hi: number; edge: "body" | "wick"; fvgDef: "wick" | "body" }[];
  mss: { dir: "bull" | "bear"; level: number; edge: "body" | "wick" }[];
}
export interface EveryTfRead {
  mode: string;
  closes: TfClose[];
  /** "tf@closeMs" for every rung — changes whenever ANY rung closes a bar (the regrade trigger). */
  sig: string;
  newest: { tf: EveryTf; closeMs: number } | null;
}

function swingsOf(bars: OhlcBar[], w: number, upTo: number): { hi: number | null; lo: number | null } {
  // confirmed by bar upTo-1 (a fractal at j needs j+w <= upTo-1)
  let hi: number | null = null, lo: number | null = null;
  for (let j = upTo - 1 - w; j >= w && (hi == null || lo == null); j--) {
    const b = bars[j]!;
    let isH = true, isL = true;
    for (let k = j - w; k <= j + w; k++) { if (k === j) continue; if (bars[k]!.h >= b.h) isH = false; if (bars[k]!.l <= b.l) isL = false; }
    if (isH && hi == null) hi = b.h;
    if (isL && lo == null) lo = b.l;
  }
  return { hi, lo };
}

/** Facts for the newest closed bar of one rung. `bars` = CLOSED bars of that rung, oldest first. */
export function readClose(tf: EveryTf, bars: OhlcBar[], pools: Pool[], rules: EveryTfRules = EVERY_TF): TfClose | null {
  const n = bars.length;
  if (n < 3) return null;
  const i = n - 1, b = bars[i]!, prev = bars[i - 1]!;
  const atr = rollingAtr(bars);
  const a = atr[i - 1];
  const shape = barShape(b);
  const dispAtr = a != null && Number.isFinite(a) && a > 0 ? r2(shape.body / a) : null;
  const strong = dispAtr != null && dispAtr >= rules.dispAtr && shape.bodyPct >= rules.bodyRangeMin;
  const sw = swingsOf(bars, rules.swingWidth, i);
  const cand: Pool[] = [...pools.filter((p) => Number.isFinite(p.price)), ...(sw.hi != null ? [{ name: `${tf} swing high`, price: sw.hi }] : []), ...(sw.lo != null ? [{ name: `${tf} swing low`, price: sw.lo }] : [])];
  const sweep: TfClose["sweep"] = [];
  for (const p of cand) {
    if (b.h > p.price && prev.h <= p.price && b.o <= p.price) sweep.push({ side: "BSL", pool: p.name, level: r2(p.price), mode: b.c < p.price ? "wick" : "body", rejectWick: shape.upperPct });
    if (b.l < p.price && prev.l >= p.price && b.o >= p.price) sweep.push({ side: "SSL", pool: p.name, level: r2(p.price), mode: b.c > p.price ? "wick" : "body", rejectWick: shape.lowerPct });
  }
  const inversion: TfClose["inversion"] = [];
  for (let j = Math.max(2, i - rules.fvgFreshBars); j < i; j++) {
    const x = bars[j - 2]!, z = bars[j]!;
    for (const def of ["wick", "body"] as const) {
      const xt = def === "wick" ? x.h : Math.max(x.o, x.c), xb = def === "wick" ? x.l : Math.min(x.o, x.c);
      const zt = def === "wick" ? z.h : Math.max(z.o, z.c), zb = def === "wick" ? z.l : Math.min(z.o, z.c);
      // bull gap [xt, zb] -> bearish inversion through its far (lower) edge; bear gap [zt, xb] -> bullish inversion through xb
      if (zb > xt) {
        const lo = xt, hi = zb, mid = bars.slice(j + 1, i);
        if (!mid.some((m) => m.c < lo)) {
          if (b.c < lo) inversion.push({ dir: "bear", lo: r2(lo), hi: r2(hi), edge: "body", fvgDef: def });
          else if (b.l < lo) inversion.push({ dir: "bear", lo: r2(lo), hi: r2(hi), edge: "wick", fvgDef: def });
        }
      }
      if (zt < xb) {
        const lo = zt, hi = xb, mid = bars.slice(j + 1, i);
        if (!mid.some((m) => m.c > hi)) {
          if (b.c > hi) inversion.push({ dir: "bull", lo: r2(lo), hi: r2(hi), edge: "body", fvgDef: def });
          else if (b.h > hi) inversion.push({ dir: "bull", lo: r2(lo), hi: r2(hi), edge: "wick", fvgDef: def });
        }
      }
    }
  }
  const mss: TfClose["mss"] = [];
  if (sw.lo != null && prev.l >= sw.lo) { if (b.c < sw.lo) mss.push({ dir: "bear", level: r2(sw.lo), edge: "body" }); else if (b.l < sw.lo) mss.push({ dir: "bear", level: r2(sw.lo), edge: "wick" }); }
  if (sw.hi != null && prev.h <= sw.hi) { if (b.c > sw.hi) mss.push({ dir: "bull", level: r2(sw.hi), edge: "body" }); else if (b.h > sw.hi) mss.push({ dir: "bull", level: r2(sw.hi), edge: "wick" }); }
  return {
    tf, t: b.t, closeMs: b.t + TF_MS[tf], o: b.o, h: b.h, l: b.l, c: b.c, shape, dispAtr,
    displacement: { up: strong && shape.dir === "up", down: strong && shape.dir === "down" },
    sweep, inversion, mss,
  };
}

/** Closed bars for each rung. minute = 1m tape, closed15 = closed 15m series, daily = daily series (any stamping). */
export function rungBars(tf: EveryTf, i: { minute?: OhlcBar[] | null; closed15?: OhlcBar[] | null; daily?: OhlcBar[] | null; nowMs: number }): OhlcBar[] {
  const ms = TF_MS[tf];
  if (LTF.has(tf)) return closedBuckets(i.minute ?? [], ms, 60_000, i.nowMs, false);
  if (tf === "1D") {
    // the daily series from the feed (already one bar per session): keep only sessions that have ended
    const d = (i.daily ?? []).filter((b) => b.t + ms <= i.nowMs);
    if (d.length >= 3) return d;
    return closedBuckets(i.closed15 ?? [], ms, 900_000, i.nowMs, true);
  }
  return closedBuckets(i.closed15 ?? [], ms, 900_000, i.nowMs, tf === "4h");
}

export function everyTfRead(i: { minute?: OhlcBar[] | null; closed15?: OhlcBar[] | null; daily?: OhlcBar[] | null; pools?: Pool[]; nowMs: number; rules?: EveryTfRules }): EveryTfRead {
  const rules = i.rules ?? EVERY_TF;
  const closes: TfClose[] = [];
  for (const tf of rules.tfs) {
    const r = readClose(tf, rungBars(tf, i), i.pools ?? [], rules);
    if (r) closes.push(r);
  }
  const newest = closes.reduce<TfClose | null>((m, x) => (!m || x.closeMs > m.closeMs || (x.closeMs === m.closeMs && TF_MS[x.tf] > TF_MS[m.tf]) ? x : m), null);
  return { mode: rules.mode, closes, sig: closes.map((x) => `${x.tf}@${x.closeMs}`).join(","), newest: newest ? { tf: newest.tf, closeMs: newest.closeMs } : null };
}

/** Side view: which rungs' newest closes carry evidence FOR this side (sweep of the opposite pool, displacement, inversion, MSS). */
export function sideEvidence(r: EveryTfRead | null | undefined, side: "long" | "short", rules: EveryTfRules = EVERY_TF): { tf: EveryTf; parts: string[] }[] {
  if (!r) return [];
  const bull = side === "long";
  return r.closes.map((x) => {
    const parts: string[] = [];
    for (const s of x.sweep) if ((bull ? s.side === "SSL" : s.side === "BSL")) parts.push(`sweep:${s.mode}${s.mode === "wick" && s.rejectWick >= rules.rejectWickMin ? "+reject" : ""}`);
    if (bull ? x.displacement.up : x.displacement.down) parts.push("disp");
    for (const v of x.inversion) if (v.dir === (bull ? "bull" : "bear")) parts.push(`ifvg:${v.edge}/${v.fvgDef}`);
    for (const m of x.mss) if (m.dir === (bull ? "bull" : "bear")) parts.push(`mss:${m.edge}`);
    return { tf: x.tf, parts: [...new Set(parts)] };
  }).filter((x) => x.parts.length);
}

/** Compact form for the wire (watcher) and the Brain/Floor note. */
export function wireEveryTf(r: EveryTfRead | null | undefined, side: "long" | "short" | null) {
  if (!r) return null;
  return {
    mode: r.mode, sig: r.sig, newest: r.newest,
    closes: r.closes.map((x) => ({ tf: x.tf, closeMs: x.closeMs, o: x.o, h: x.h, l: x.l, c: x.c, ...x.shape, dispAtr: x.dispAtr, dispUp: x.displacement.up, dispDown: x.displacement.down,
      sweep: x.sweep.map((s) => `${s.side}:${s.pool}:${s.mode}`), inversion: x.inversion.map((v) => `${v.dir}:${v.edge}/${v.fvgDef}`), mss: x.mss.map((m) => `${m.dir}:${m.edge}`) })),
    evidence: side ? sideEvidence(r, side) : [],
  };
}
export function everyTfSeatNote(r: EveryTfRead | null | undefined, side: "long" | "short" | null): string | null {
  if (!r || !r.closes.length) return null;
  const ev = side ? sideEvidence(r, side) : [];
  const nw = r.newest ? `${r.newest.tf} closed` : "no rung closed";
  return `Every-TF closes (${r.mode}): ${nw}; ${ev.length ? ev.map((e) => `${e.tf} ${e.parts.join("+")}`).join(" · ") : `no ${side ?? ""} evidence on any rung`}`.replace(/\s+/g, " ").trim();
}
