/**
 * q_v2 — SHADOW quality score (audits/qv2-1015/report.md). Computed beside live q; it never gates, fires or
 * changes the live card (confluence / pathBand / actionable / rules hash). Every delta carries its source.
 *
 * Order (data-ranked, report §a):
 *   1 base       anchored walk-forward formula (q0 + slope·pts/denom; smt/pd/OB/FVG-tap 0, iFVG 3, HTF half), chase NOT applied
 *   2 keySweep   ON/PD high-low swept ≤60 min ago: +0.06 08:30–10:00 CT, linear to 0 at 11:00
 *   3 regime     trend day +0.02, high/mid volatility −0.01 (walk-forward fit, train only)
 *   4 caps       live band caps/penalties except R3 chase, SMT cap and seal clamps; kills stay vetoes
 *   5 option     spread %, premium vs expected move, late-day 0DTE theta
 * Each factor is clamped to ±factorCap (one grade band). Edges are raise-only vs the live edges.
 */
import CFG from "../../../shared/q-v2.json";
import { BAND_EDGES } from "@/lib/smc/discipline";
import type { OhlcBar } from "@/lib/market/types";

export type QDelta = { source: string; delta: number; note?: string };
export type QV2 = { q: number; band: string; deltas: QDelta[]; mode: string; version: number; vetoed: boolean };

const clampF = (x: number) => Math.max(-CFG.factorCap, Math.min(CFG.factorCap, x));
const r4 = (x: number) => +x.toFixed(4);

export function edgesV2(): Record<string, number> {
  const e = CFG.bandEdges as Record<string, number>;
  const live = BAND_EDGES as unknown as Record<string, number>;
  return Object.fromEntries(Object.keys(e).map((k) => [k, Math.max(e[k]!, live[k] ?? 0)]));
}
export function bandV2(q: number): string {
  const e = edgesV2();
  return q >= e["A+"]! ? "A+" : q >= e.A! ? "A" : q >= e["A-"]! ? "A-" : q >= e["B+"]! ? "B+" : q >= e.B! ? "B" : "C";
}

/** CT minute of day for a ms timestamp. */
export function ctMinute(ms: number): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  return Number(p.find((x) => x.type === "hour")!.value) * 60 + Number(p.find((x) => x.type === "minute")!.value);
}
export function keySweepRamp(min: number): number {
  const k = CFG.keySweep;
  if (min < k.fullFromMin || min >= k.zeroAtMin) return 0;
  if (min <= k.fullToMin) return 1;
  return (k.zeroAtMin - min) / (k.zeroAtMin - k.fullToMin);
}
/** Key level (ON/PD high-low) taken on the card's side within lookbackMin: long ← a low swept, short ← a high swept. */
export function keySwept(side: "long" | "short", minute: OhlcBar[] | null | undefined, levels: { pdh?: number | null; pdl?: number | null; onh?: number | null; onl?: number | null }, nowMs: number): boolean {
  if (!minute?.length) return false;
  const from = nowMs - CFG.keySweep.lookbackMin * 60_000;
  const win = minute.filter((b) => b.t >= from && b.t <= nowMs);
  if (!win.length) return false;
  const lows = [levels.pdl, levels.onl].filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const highs = [levels.pdh, levels.onh].filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return side === "long" ? lows.some((l) => win.some((b) => b.l < l)) : highs.some((h) => win.some((b) => b.h > h));
}
/** Trend day (causal): |px − RTH open| / RTH range so far > trendness. */
export function trendDay(sessionBars: OhlcBar[] | null | undefined): boolean | null {
  if (!sessionBars?.length) return null;
  const o = sessionBars[0]!.o, px = sessionBars[sessionBars.length - 1]!.c;
  const hi = Math.max(...sessionBars.map((b) => b.h)), lo = Math.min(...sessionBars.map((b) => b.l));
  return hi > lo ? Math.abs(px - o) / (hi - lo) > CFG.regime.trendness : null;
}

export interface QV2Input {
  side: "long" | "short";
  qScan: number;
  components: string[];
  htfOk: boolean;
  nowMs: number;
  keySwept: boolean;
  trendDay: boolean | null;
  volPct?: number | null;
  capReasons?: { field: string; kind: string; before: unknown; after: unknown; why?: string | null; source?: string | null }[];
  vetoed?: boolean;
  option?: { spreadPct?: number | null; premiumVsMove?: number | null; dte?: number | null } | null;
}

/** Live-only sources q_v2 does NOT carry: R3 chase (timing → entry gates), SMT band cap (SMT weight 0), seal clamps. */
export const DROPPED_SOURCES = /chase|R3|SMT|seal|shadow:timing|MTF align/i;

export function computeQV2(i: QV2Input): QV2 {
  const deltas: QDelta[] = [];
  const set = new Set(i.components);
  // 1 base (anchored): the walk-forward formula itself, NOT qScan + delta. qScan carries the live layers
  //   (template modelQ, plan raises) that the fit never saw and pushed q_v2 to the 0.99 clamp on every card.
  const A = CFG.anchor;
  let pts = 0;
  for (const [k, w] of Object.entries(A.pts)) if (set.has(k)) pts += w as number;
  if (i.htfOk) pts += A.htfPts;
  const kz = ctMinute(i.nowMs) < A.killzoneBeforeMin ? A.killzoneBonus : 0;
  let q = A.q0 + (A.slope * pts) / A.denom + (i.htfOk ? CFG.htfBonus : 0) + kz;
  deltas.push({ source: "base:anchored", delta: r4(q), note: `pts ${pts}/${A.denom}${i.htfOk ? " +htf" : ""}${kz ? " +killzone" : ""} (scanner q ${i.qScan} not used)` });
  // 2 key sweep × time
  const ramp = keySweepRamp(ctMinute(i.nowMs));
  const dKey = i.keySwept ? clampF(CFG.keySweep.boost * ramp) : 0;
  deltas.push({ source: "keySweep", delta: r4(dKey), note: i.keySwept ? `ramp ${ramp.toFixed(2)}` : "no ON/PD sweep ≤60m" });
  q += dKey;
  // 3 regime
  const dTrend = i.trendDay ? CFG.regime.trendDay : 0;
  const dVol = i.volPct != null && i.volPct > CFG.regime.highVolPct ? CFG.regime.highVol : 0;
  deltas.push({ source: "regime:trendDay", delta: r4(clampF(dTrend)) });
  deltas.push({ source: "regime:vol", delta: r4(clampF(dVol)) });
  q += clampF(dTrend) + clampF(dVol);
  // 4 live caps/penalties, minus the dropped sources; each capped at one band.
  for (const c of i.capReasons ?? []) {
    if (c.field !== "confluence") continue;
    const label = c.source ?? c.why ?? "unlabelled";
    if (DROPPED_SOURCES.test(label)) continue;
    const d = Number(c.after) - Number(c.before);
    if (!Number.isFinite(d) || d === 0) continue;
    deltas.push({ source: `live:${label}`.slice(0, 80), delta: r4(clampF(d)) });
    q += clampF(d);
  }
  // 5 option quality
  const o = CFG.option, op = i.option ?? null;
  let dOpt = 0;
  if (op?.spreadPct != null && op.spreadPct > o.spreadPctFree) dOpt -= Math.min(o.spreadMax, (op.spreadPct - o.spreadPctFree) * o.spreadPctPerPt);
  if (op?.premiumVsMove != null && op.premiumVsMove > o.premiumVsMoveFree) dOpt -= Math.min(o.premiumMax, (op.premiumVsMove - o.premiumVsMoveFree) * o.premiumVsMovePer * 10);
  const m = ctMinute(i.nowMs);
  if (op?.dte === 0 && m >= o.thetaFromMin) dOpt -= Math.min(o.thetaMax, Math.ceil((m - o.thetaFromMin + 1) / 30) * o.thetaPer30m);
  dOpt = Math.max(-o.totalMax, dOpt);
  deltas.push({ source: "option", delta: r4(dOpt) });
  q += dOpt;
  q = r4(Math.min(0.99, Math.max(0, q)));
  const vetoed = i.vetoed === true;
  return { q, band: vetoed ? "C" : bandV2(q), deltas, mode: CFG.mode, version: CFG.version, vetoed };
}

/** RTH session bars (≥ 08:30 CT today) and the overnight high/low (the 15.5h before 08:30 CT). */
export function sessionSplit(minute: OhlcBar[] | null | undefined, nowMs: number): { session: OhlcBar[]; onh: number | null; onl: number | null } {
  const m = ctMinute(nowMs);
  if (!minute?.length || m < 510) return { session: [], onh: null, onl: null };
  const start = Math.floor((nowMs - (m - 510) * 60_000) / 60_000) * 60_000;
  const session = minute.filter((b) => b.t >= start && b.t <= nowMs);
  const on = minute.filter((b) => b.t < start && b.t >= start - 15.5 * 3_600_000);
  return { session, onh: on.length ? Math.max(...on.map((b) => b.h)) : null, onl: on.length ? Math.min(...on.map((b) => b.l)) : null };
}
