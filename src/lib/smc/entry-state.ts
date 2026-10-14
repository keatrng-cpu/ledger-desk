/**
 * Fix B (Keaton 2026-10-14): TIMING, separate from setup quality.
 * entryState = where price is versus the card's entry right now:
 *   at     — inside the entry zone, or within timing.atAtr × ATR15 of the entry
 *   near   — not reached yet, or past it by ≤ timing.nearAtr × ATR15 (= the watcher entry_distance 0.5×ATR)
 *   late   — past by ≤ timing.lateAtr × ATR15
 *   missed — past by more, or T1 already traded
 * Every rung 1m–4h is read (standing rule: no single-timeframe rule): `byTf` is the distance in that
 * rung's own ATR, and `stateMtf` is the state from the MEDIAN of those distances scaled to the 15m
 * horizon (ATR_tf × √(15/tfMin)). `state` stays on ATR15 for parity with the execution gates.
 * Late/missed propose a re-entry ONLY at a real POI already on the wire: an unmitigated FVG/IFVG/sponsored
 * row of the side's direction on any rung (its CE), or the retest of the broken entry zone. No invented levels.
 * Shown on the card as e.g. "A, waiting for retest".
 */
import RULES from "../../../shared/desk-rules.json";
import type { OhlcBar } from "@/lib/market/types";
import { rollingAtr } from "@/lib/trading/detectors";
import { resampleMs } from "@/lib/trading/tf-ladder";

export type EntryStateKind = "at" | "near" | "late" | "missed";
const T = (RULES as { timing?: { atAtr?: number; nearAtr?: number; lateAtr?: number; rungs?: string[] } }).timing ?? {};
const AT = T.atAtr ?? 0.1, NEAR = T.nearAtr ?? 0.5, LATE = T.lateAtr ?? 1.0;
const TF_MIN: Record<string, number> = { "1m": 1, "2m": 2, "3m": 3, "4m": 4, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240 };

export interface PoiRow { tf: string; kind: string; dir: "bull" | "bear"; lo?: number; hi?: number; ce?: number; mitigated: boolean }
export interface EntryState {
  state: EntryStateKind;
  /** Signed: + = price past the entry in the trade's direction (chasing), − = not reached. ATR15. */
  distAtr: number | null;
  byTf: Record<string, number | null>;
  stateMtf: EntryStateKind | null;
  reentry: { px: number; why: string } | null;
  label: string;
}

const classify = (d: number, inZone: boolean, t1Hit: boolean): EntryStateKind =>
  t1Hit ? "missed" : inZone || Math.abs(d) <= AT ? "at" : d <= NEAR ? "near" : d <= LATE ? "late" : "missed";

export function entryStateOf(o: {
  side: "long" | "short";
  band: string | null | undefined;
  price: number | null;
  entry: number | null;
  t1?: number | null;
  zone?: { top: number; bottom: number } | null;
  atr15: number | null;
  minute?: OhlcBar[] | null;
  bars15?: OhlcBar[] | null;
  rows?: PoiRow[];
  /** 1m bars since the card's entry first printed — T1 traded in them = missed. */
  sinceEntry?: OhlcBar[] | null;
}): EntryState | null {
  const { side, price, entry, atr15 } = o;
  if (price == null || entry == null || !(atr15! > 0)) return null;
  const long = side === "long";
  const past = long ? price - entry : entry - price;
  const d = past / atr15!;
  const inZone = o.zone ? price >= o.zone.bottom && price <= o.zone.top : false;
  const t1Hit = o.t1 != null && (o.sinceEntry ?? []).some((b) => (long ? b.h >= o.t1! : b.l <= o.t1!));
  const byTf: Record<string, number | null> = {};
  const scaled: number[] = [];
  for (const tf of T.rungs ?? Object.keys(TF_MIN)) {
    const mins = TF_MIN[tf];
    if (!mins) continue;
    const src = mins < 15 ? o.minute : o.bars15;
    const bars = src?.length ? (mins === 1 || mins === 15 ? src : resampleMs(src, mins * 60_000)) : [];
    const a = bars.length > 15 ? rollingAtr(bars as never) : [];
    const atr = a[a.length - 1];
    byTf[tf] = atr > 0 ? +(past / atr).toFixed(2) : null;
    if (atr > 0) scaled.push(past / (atr * Math.sqrt(15 / mins)));
  }
  scaled.sort((x, y) => x - y);
  const med = scaled.length ? scaled[Math.floor(scaled.length / 2)]! : null;
  const state = classify(d, inZone, t1Hit);
  const stateMtf = med == null ? null : classify(med, inZone, t1Hit);
  let reentry: EntryState["reentry"] = null;
  if (state === "late" || state === "missed") {
    const want = long ? "bull" : "bear";
    const cands: { px: number; why: string }[] = [];
    for (const r of o.rows ?? []) {
      if (r.mitigated || r.dir !== want || r.ce == null) continue;
      if (long ? r.ce < price : r.ce > price) cands.push({ px: r.ce, why: `${r.tf} ${r.kind.toUpperCase()} ${r.lo}–${r.hi} CE` });
    }
    if (o.zone) {
      const edge = long ? o.zone.top : o.zone.bottom;
      if (long ? edge < price : edge > price) cands.push({ px: edge, why: `retest of the broken entry zone ${o.zone.bottom}–${o.zone.top}` });
    }
    cands.sort((x, y) => Math.abs(price - x.px) - Math.abs(price - y.px));
    reentry = cands[0] ?? null;
  }
  const word = state === "at" ? "at entry" : state === "near" ? (d < 0 ? "waiting for entry" : "near entry") : state === "late" ? "late, waiting for retest" : "missed, waiting for retest";
  const label = `${o.band ?? "—"}, ${word}${reentry ? ` @ ${reentry.px} (${reentry.why})` : state === "late" || state === "missed" ? " (no real POI yet)" : ""}`;
  return { state, distAtr: +d.toFixed(2), byTf, stateMtf, reentry, label };
}
