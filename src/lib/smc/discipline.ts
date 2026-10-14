/**
 * Card discipline (Keaton 2026-10-13, CHECKLIST_AUDIT addendum R1–R9).
 * Applied once per desk build, after the scanner, before the news/shock bar.
 * Every rule here only ever LOWERS a band or clears `actionable` — except the
 * rejection-wick vote, a ±0.01 q nudge. Each rule names itself in `reasons`.
 *
 *   R1 entry null            → band ≤ B+, actionable false
 *   R2 stop < 0.5×ATR15      → widen to 0.5×ATR15, re-price R; T1 < 1R → band ≤ B
 *   R3 chase                 → one band step per 0.5×ATR15 past the entry CE (q × max(0, 1−0.5·d))
 *   R4 HTF conflict          → band ≤ B+ unless htfDisrespected (one HTF read: gap-direction.ts, closed, 18:00 ET buckets)
 *   R5 fast invalidation     → a closed 5m body ≥ 1.25×ATR5 closing through the entry zone kills the card
 *   R7 chop                  → band ≤ B+ (median 15m overlap > 60% or 8-bar range < 3×ATR15)
 *   R8 rejection wick        → ±0.01 q at a key level (wick ≥ 60% of range, close in the other half)
 */
import RULES from "../../../shared/desk-rules.json";
import type { OhlcBar } from "@/lib/market/types";
import { rollingAtr } from "@/lib/trading/detectors";
import { resampleMs } from "@/lib/trading/tf-ladder";

export const BANDS = ["A+", "A", "A-", "B+", "B", "C", "skip"] as const;
export type Band = (typeof BANDS)[number];
export const MIN_STOP_ATR = RULES.minStopAtr; // shared/desk-rules.json
export const CHASE_STEP_ATR = 0.5;
/** Fix B flag (shared rules timing.mode): live = q/band are setup quality only. */
export const TIMING_MODE = String((RULES as { timing?: { mode?: string } }).timing?.mode ?? "shadow");
export const FAST_INVALID_BODY_ATR5 = 1.25;
export const CHOP_OVERLAP = 0.6;
export const CHOP_RANGE_ATR = 3;
export const WICK_SHARE = 0.6;
export const WICK_NUDGE = 0.01;

const idx = (b: string | undefined | null) => {
  const n = BANDS.indexOf(String(b ?? "skip").replace("−", "-") as Band);
  return n < 0 ? BANDS.length - 1 : n;
};
/** The lower of two bands. */
export const capBand = (b: string | undefined | null, cap: Band): Band => BANDS[Math.max(idx(b), idx(cap))]!;
export const stepDown = (b: string | undefined | null, steps: number): Band =>
  BANDS[Math.min(BANDS.length - 1, idx(b) + Math.max(0, steps))]!;

export interface DisciplineCard {
  side: "long" | "short";
  confluence: number;
  pathBand?: string;
  actionable: boolean;
  htfOk: boolean;
  htfDisrespected?: boolean;
  gapSide?: "long" | "short" | null;
  entryPx?: number | null;
  plan?: { entry: number; stop: number; riskPts: number; t1: number | null; rr1: number | null; entryZone?: { top: number; bottom: number } | null } | null;
  reasons: string[];
  vetoes?: string[];
}

export interface DisciplineCtx {
  price: number | null;
  atr15: number | null;
  closed15: OhlcBar[];
  minute: OhlcBar[] | null | undefined;
  nowMs: number;
  /** PDH/PDL/PWH/PWL/session H/L and array edges. */
  levels: number[];
}

export function isChop(closed15: OhlcBar[], atr15: number | null): { chop: boolean; overlap: number | null; rangeAtr: number | null } {
  const last = closed15.slice(-8);
  if (last.length < 8 || atr15 == null || !(atr15 > 0)) return { chop: false, overlap: null, rangeAtr: null };
  const ov: number[] = [];
  for (let i = 1; i < last.length; i++) {
    const a = last[i - 1]!, b = last[i]!;
    const inter = Math.max(0, Math.min(a.h, b.h) - Math.max(a.l, b.l));
    const span = Math.max(1e-9, Math.min(a.h - a.l, b.h - b.l));
    ov.push(inter / span);
  }
  ov.sort((x, y) => x - y);
  const overlap = ov[Math.floor(ov.length / 2)]!;
  const rangeAtr = (Math.max(...last.map((b) => b.h)) - Math.min(...last.map((b) => b.l))) / atr15;
  return { chop: overlap > CHOP_OVERLAP || rangeAtr < CHOP_RANGE_ATR, overlap: +overlap.toFixed(2), rangeAtr: +rangeAtr.toFixed(2) };
}

/** Closed 5m bars from the 1m tape (cached by caller-independent key). */
const fiveCache = new Map<string, OhlcBar[]>();
export function closed5m(minute: OhlcBar[] | null | undefined, nowMs: number): OhlcBar[] {
  if (!minute?.length) return [];
  const k = `${minute[0]!.t}:${minute[minute.length - 1]!.t}:${minute.length}:${Math.floor(nowMs / 60_000)}`;
  const hit = fiveCache.get(k);
  if (hit) return hit;
  const five = resampleMs(minute, 5 * 60_000).filter((b) => b.t + 5 * 60_000 <= nowMs);
  if (fiveCache.size > 16) fiveCache.clear();
  fiveCache.set(k, five);
  return five;
}

/** R5: the latest closed 5m body ≥ 1.25×ATR5 closing through the zone against the card. */
export function fastInvalidation(side: "long" | "short", zone: { top: number; bottom: number } | null, five: OhlcBar[]): boolean {
  if (!zone || five.length < 16) return false;
  const atr = rollingAtr(five);
  const b = five[five.length - 1]!;
  const a5 = atr[atr.length - 2];
  if (a5 == null || !(a5 > 0)) return false;
  const body = Math.abs(b.c - b.o);
  if (body < FAST_INVALID_BODY_ATR5 * a5) return false;
  return side === "long" ? b.c < b.o && b.c < zone.bottom && b.o >= zone.bottom : b.c > b.o && b.c > zone.top && b.o <= zone.top;
}

/** R8: +1 vote for the card's side, −1 against, 0 none. Last closed 15m bar at a key level. */
export function rejectionVote(side: "long" | "short", closed15: OhlcBar[], levels: number[], atr15: number | null): -1 | 0 | 1 {
  const b = closed15[closed15.length - 1];
  if (!b || atr15 == null || !(atr15 > 0)) return 0;
  const range = b.h - b.l;
  if (!(range > 0)) return 0;
  const upper = b.h - Math.max(b.o, b.c);
  const lower = Math.min(b.o, b.c) - b.l;
  const near = (px: number) => levels.some((l) => Math.abs(l - px) <= 0.5 * atr15);
  const mid = b.l + range / 2;
  let lean: "long" | "short" | null = null;
  if (lower / range >= WICK_SHARE && b.c > mid && near(b.l)) lean = "long";
  else if (upper / range >= WICK_SHARE && b.c < mid && near(b.h)) lean = "short";
  if (!lean) return 0;
  return lean === side ? 1 : -1;
}

export function applyDiscipline<C extends DisciplineCard>(c: C, ctx: DisciplineCtx): C {
  const note = (s: string) => c.reasons.push(s);
  let band: Band = capBand(c.pathBand, "A+");
  let q = c.confluence;
  const atr = ctx.atr15;
  const entry = c.entryPx ?? c.plan?.entry ?? null;

  // R1
  if (entry == null || !Number.isFinite(entry)) {
    if (idx(band) < idx("B+")) note(`No entry — band capped at B+ (was ${band})`);
    band = capBand(band, "B+");
    c.actionable = false;
  }
  // R2
  if (c.plan && atr != null && atr > 0) {
    const p = c.plan;
    const min = MIN_STOP_ATR * atr;
    if (p.riskPts < min) {
      const stop = c.side === "long" ? p.entry - min : p.entry + min;
      const rr1 = p.t1 != null ? Math.abs(p.t1 - p.entry) / min : null;
      note(`Stop ${p.riskPts.toFixed(2)}pt < ${MIN_STOP_ATR}×ATR — widened to ${stop.toFixed(2)}, T1 ${rr1 != null ? rr1.toFixed(2) + "R" : "—"}`);
      c.plan = { ...p, stop: Math.round(stop * 100) / 100, riskPts: Math.round(min * 100) / 100, rr1: rr1 != null ? Math.round(rr1 * 100) / 100 : null };
      if (rr1 == null || rr1 < 1) {
        band = capBand(band, "B");
        c.actionable = false;
        note("T1 under 1R at the minimum stop — band ≤ B");
      }
    }
  }
  // R3
  if (entry != null && Number.isFinite(entry) && ctx.price != null && atr != null && atr > 0) {
    const past = c.side === "long" ? ctx.price - entry : entry - ctx.price;
    const d = Math.max(0, past) / atr;
    if (d > 0) {
      const steps = Math.floor(d / CHASE_STEP_ATR);
      const factor = Math.max(0, 1 - 0.5 * d);
      // Fix B (Keaton 10/14): chase is TIMING, not setup quality. timing.mode live → no q/band hit here;
      // entryState (smc/entry-state.ts) carries it and the execution gates (late guard, late_pnl,
      // watcher entry_distance) still refuse. shadow → applied as before, the would-be quality read is kept.
      (c as { chase?: unknown }).chase = { distAtr: +d.toFixed(2), qFactor: +factor.toFixed(4), bandSteps: steps, qBefore: q, bandBefore: band, applied: TIMING_MODE !== "live" };
      if (TIMING_MODE !== "live") {
        q = +(q * factor).toFixed(4);
        if (steps > 0) {
          band = stepDown(band, steps);
          note(`Chase ${d.toFixed(2)}×ATR past CE — ${steps} band step${steps > 1 ? "s" : ""} down`);
        }
      } else note(`Timing: ${d.toFixed(2)}×ATR past CE — quality unchanged, entryState carries it`);
    }
  }
  // R4
  const htfAgainst = (c.gapSide != null && c.gapSide !== c.side) || (c.gapSide == null && !c.htfOk);
  if (htfAgainst && !c.htfDisrespected) {
    if (idx(band) < idx("B+")) note("HTF conflict — band capped at B+");
    band = capBand(band, "B+");
  }
  // R5
  const zone = c.plan?.entryZone ?? null;
  if (fastInvalidation(c.side, zone, closed5m(ctx.minute, ctx.nowMs))) {
    band = capBand(band, "C");
    c.actionable = false;
    c.vetoes = [...(c.vetoes ?? []), "fast invalidation — 5m displacement closed through the entry zone"];
    note("Fast invalidation: a 5m body ≥1.25×ATR5 closed through the entry zone");
  }
  // R7
  const ch = isChop(ctx.closed15, atr);
  (c as { chop?: boolean }).chop = ch.chop;
  if (ch.chop) {
    if (idx(band) < idx("B+")) note(`Chop (overlap ${ch.overlap}, range ${ch.rangeAtr}×ATR) — band capped at B+`);
    band = capBand(band, "B+");
  }
  // R8
  const vote = rejectionVote(c.side, ctx.closed15, ctx.levels, atr);
  if (vote !== 0) {
    q = +Math.min(0.99, Math.max(0, q + vote * WICK_NUDGE)).toFixed(4);
    note(`Rejection wick at a level ${vote > 0 ? "for" : "against"} this side (${vote > 0 ? "+" : "−"}${WICK_NUDGE})`);
  }
  if (idx(band) > idx("B+")) c.actionable = false;
  c.pathBand = band;
  c.confluence = q;
  return c;
}

/** R9: the shock lean clears after a 1×ATR15 counter-move from the shock close, or 30 minutes. */
export const SHOCK_LEAN_MAX_MS = 30 * 60_000;
export function shockLeanLive(
  lean: "long" | "short" | null,
  shockAt: number | null,
  shockRefPx: number | null,
  price: number | null,
  atr15: number | null,
  nowMs: number,
): "long" | "short" | null {
  if (!lean || shockAt == null) return null;
  if (nowMs - shockAt > SHOCK_LEAN_MAX_MS) return null;
  if (shockRefPx != null && price != null && atr15 != null && atr15 > 0) {
    const counter = lean === "long" ? shockRefPx - price : price - shockRefPx;
    if (counter >= atr15) return null;
  }
  return lean;
}

/**
 * PATH bands from q. Baseline A+ ≥0.75, A ≥0.68, A- ≥0.65, B+ ≥0.60, B ≥0.50,
 * else C. The learning loop (desk/learning.ts) may move an edge — versioned,
 * raise-only (never below baseline), +20% max, n ≥ 30 — through setBandEdges; BAND_EDGES_BASE never changes.
 */
export const BAND_EDGES_BASE = { "A+": RULES.bandEdges["A+"], A: RULES.bandEdges.A, "A-": RULES.bandEdges["A-"], "B+": RULES.bandEdges["B+"], B: RULES.bandEdges.B } as const; // shared/desk-rules.json
export type BandEdges = { "A+": number; A: number; "A-": number; "B+": number; B: number };
export const BAND_EDGES: BandEdges = { ...BAND_EDGES_BASE };
const BAND_CEIL: Record<Band, number> = { "A+": 0.99, A: 0.7499, "A-": 0.6799, "B+": 0.6499, B: 0.5999, C: 0.4999, skip: 0 };
export function setBandEdges(e: Partial<BandEdges> | null): void {
  Object.assign(BAND_EDGES, BAND_EDGES_BASE, e ?? {});
  // Keaton 2026-10-13: a calibration may only RAISE an edge.
  for (const k of Object.keys(BAND_EDGES_BASE) as (keyof BandEdges)[]) BAND_EDGES[k] = Math.max(BAND_EDGES_BASE[k], BAND_EDGES[k]);
  BAND_CEIL.A = +(BAND_EDGES["A+"] - 0.0001).toFixed(4);
  BAND_CEIL["A-"] = +(BAND_EDGES.A - 0.0001).toFixed(4);
  BAND_CEIL["B+"] = +(BAND_EDGES["A-"] - 0.0001).toFixed(4);
  BAND_CEIL.B = +(BAND_EDGES["B+"] - 0.0001).toFixed(4);
  BAND_CEIL.C = +(BAND_EDGES.B - 0.0001).toFixed(4);
}
export function bandFromQ(q: number | null | undefined): Band | null {
  if (q == null || !Number.isFinite(q)) return null;
  const e = BAND_EDGES;
  return q >= e["A+"] ? "A+" : q >= e.A ? "A" : q >= e["A-"] ? "A-" : q >= e["B+"] ? "B+" : q >= e.B ? "B" : "C";
}

/**
 * One band per card, everywhere: after every cap (path, vetoes, discipline,
 * SMT, news), the band IS bandFromQ(q). A cap that lowered the band below
 * what q reads clamps q to that band's ceiling (the pre-clamp value stays on
 * `qRaw`), and a path label above q is lowered to q's band. `skip` stays skip.
 * Below B+ is never actionable (PATH floor).
 */
export function sealBand<T extends { confluence: number; pathBand?: string | null; grade?: string; actionable: boolean; qRaw?: number; scannerSkip?: boolean }>(c: T): T {
  // Accuracy 1: the scanner's own skip (grade or path) exports as C, never
  // actionable — the exported band can no longer read B over a skip.
  if (c.pathBand === "skip" || c.grade === "skip") {
    c.scannerSkip = true;
    c.actionable = false;
    if (c.confluence > BAND_CEIL.C) {
      c.qRaw = c.confluence;
      c.confluence = BAND_CEIL.C;
    }
    c.pathBand = "C";
    return c;
  }
  const cap = (BANDS as readonly string[]).includes(String(c.pathBand)) ? (c.pathBand as Band) : null;
  const qb = bandFromQ(c.confluence);
  if (!qb) return c;
  if (cap && idx(cap) > idx(qb)) {
    c.qRaw = c.confluence;
    c.confluence = Math.min(c.confluence, BAND_CEIL[cap]);
  }
  c.pathBand = bandFromQ(c.confluence)!;
  if (idx(c.pathBand as Band) > idx("B+")) c.actionable = false;
  return c;
}
