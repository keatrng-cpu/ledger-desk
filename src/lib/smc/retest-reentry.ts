/**
 * Retest re-entry (SHADOW ONLY — never gates, never fires; 10/16 MNQ post-mortem).
 * The desk refused the 10/16 MNQ short: the move swept buy-side near 30,085, broke the level and ran ~260 pts while
 * the card was late (R3 chase ×0.33 at ~1.33×ATR15 under timing.mode shadow) and the watcher refused >0.5×ATR from
 * entry. There was no path back in. This module arms one:
 *   1. sweep   — a CLOSED 1m bar takes the prior 20-bar extreme (the liquidity) on the side opposite the trade;
 *   2. break   — within 5 bars a displacement candle (body ≥ dispMin×ATR1m) CLOSES through the last opposite-close
 *                candle (OB) before it; an iFVG/OB row on any rung 1m–4h that the break closed through also counts;
 *   3. arm     — entry = the broken level's near edge (or CE), stop = sweep extreme ± 0.25×ATR1m, target = the next
 *                untaken liquidity pool beyond the post-break extreme; refused under minRR (0.85R);
 *   4. state   — armed → triggered on the first pullback touch; void when a CLOSED bar reclaims the level's far edge,
 *                the stop prints, the session cutoff passes or maxAgeBars elapse.
 * Closed bars only (the caller passes closed 1m bars). Python twin: docs/audits/retest-reentry-1016/bt.py (same
 * rules; walk-forward there). Constants live here, NOT in shared/desk-rules.json, so the rules hash is unchanged
 * while it is shadow. Promotion = a separate PR that adds a desk-rules block (hash change) after the replay proves it.
 */
import type { OhlcBar } from "@/lib/market/types";

export const RETEST = { mode: "shadow" as const, sweepLookback: 20, dispBars: 5, dispMinAtr1m: 1.0, stopPadAtr1m: 0.25, minRR: 0.85, maxAgeBars: 90, entry: "ce" as "edge" | "ce" };

export interface RetestLevel { tf: string; kind: string; lo: number; hi: number }
export interface RetestRead {
  mode: "shadow";
  state: "armed" | "triggered" | "void";
  side: "long" | "short";
  sweepPx: number;
  level: RetestLevel;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  ageBars: number;
  why: string;
  label: string;
}

function atr14(b: OhlcBar[], end: number): number | null {
  if (end < 14) return null;
  let s = 0;
  for (let i = end - 14; i < end; i++) s += b[i]!.h - b[i]!.l;
  return s / 14;
}

/** Pure. `minute` = CLOSED 1m bars oldest→newest. `pools` = known liquidity (PDH/PDL, session H/L, chart levels). */
export function retestReentryOf(o: {
  side: "long" | "short";
  minute: OhlcBar[] | null | undefined;
  pools?: number[];
  rows?: { tf: string; kind: string; dir: "bull" | "bear"; lo?: number; hi?: number; mitigated?: boolean }[];
  cfg?: Partial<typeof RETEST>;
}): RetestRead | null {
  const cfg = { ...RETEST, ...(o.cfg ?? {}) };
  const b = o.minute ?? [];
  const n = b.length;
  if (n < cfg.sweepLookback + 20) return null;
  const sg = o.side === "long" ? 1 : -1;
  const from = Math.max(cfg.sweepLookback + 14, n - cfg.maxAgeBars - cfg.dispBars - 1);
  // newest qualifying sweep → displacement → broken level
  for (let i = n - 2; i >= from; i--) {
    let prior = sg > 0 ? Infinity : -Infinity;
    for (let j = i - cfg.sweepLookback; j < i; j++) prior = sg > 0 ? Math.min(prior, b[j]!.l) : Math.max(prior, b[j]!.h);
    const swept = sg > 0 ? b[i]!.l < prior : b[i]!.h > prior;
    if (!swept) continue;
    const a1 = atr14(b, i);
    if (!(a1! > 0)) continue;
    let ext = sg > 0 ? b[i]!.l : b[i]!.h;
    for (let k = i; k < Math.min(i + cfg.dispBars + 1, n); k++) {
      ext = sg > 0 ? Math.min(ext, b[k]!.l) : Math.max(ext, b[k]!.h);
      const body = (b[k]!.c - b[k]!.o) * sg;
      if (body < cfg.dispMinAtr1m * a1! || sg * (b[k]!.c - (sg > 0 ? b[i]!.h : b[i]!.l)) <= 0) continue;
      // broken level: last opposite-close candle before k that k closed through; else a rung row k closed through
      let level: RetestLevel | null = null;
      for (let j = k - 1; j > Math.max(k - 8, 0); j--) {
        if ((b[j]!.c - b[j]!.o) * sg < 0) {
          if (sg < 0 && b[k]!.c < b[j]!.l) level = { tf: "1m", kind: "ob", lo: b[j]!.l, hi: Math.min(b[j]!.h, ext) };
          if (sg > 0 && b[k]!.c > b[j]!.h) level = { tf: "1m", kind: "ob", lo: Math.max(b[j]!.l, ext), hi: b[j]!.h };
          break;
        }
      }
      if (!level) {
        const r = (o.rows ?? []).find((x) => x.lo != null && x.hi != null && !x.mitigated && (sg < 0 ? b[k]!.c < x.lo! && x.hi! <= ext : b[k]!.c > x.hi! && x.lo! >= ext));
        if (r) level = { tf: r.tf, kind: r.kind, lo: r.lo!, hi: r.hi! };
      }
      if (!level) break;
      const entry = cfg.entry === "ce" ? (level.lo + level.hi) / 2 : sg < 0 ? level.lo : level.hi;
      const far = sg < 0 ? level.hi : level.lo;
      const stop = ext - sg * cfg.stopPadAtr1m * a1!;
      const risk = Math.abs(stop - entry);
      if (!(risk > 0) || sg * (entry - stop) <= 0) return null;
      let post = sg > 0 ? b[k]!.h : b[k]!.l;
      let state: RetestRead["state"] = "armed";
      let why = "waiting for the pullback into the broken level";
      for (let x = k + 1; x < n; x++) {
        const touched = sg < 0 ? b[x]!.h >= entry : b[x]!.l <= entry;
        if (sg * ((sg > 0 ? b[x]!.l : b[x]!.h) - stop) <= 0) { state = "void"; why = "stop printed"; break; }
        if (touched && x > k + 1) { state = "triggered"; why = "pullback touched the broken level"; break; }
        post = sg > 0 ? Math.max(post, b[x]!.h) : Math.min(post, b[x]!.l);
        if (sg * (b[x]!.c - far) < 0) { state = "void"; why = "closed back through the broken level"; break; }
      }
      if (n - 1 - k > cfg.maxAgeBars && state === "armed") { state = "void"; why = "expired"; }
      const lb = b.slice(Math.max(0, i - 90), Math.max(1, i - 25));
      const swing = sg > 0 ? Math.max(...lb.map((x) => x.h)) : Math.min(...lb.map((x) => x.l));
      const cands = [...(o.pools ?? []), swing].filter((p) => Number.isFinite(p) && sg * (p - post) > 0 && sg * (p - entry) > 0);
      if (!cands.length) return null;
      const target = cands.reduce((m, p) => (Math.abs(p - entry) < Math.abs(m - entry) ? p : m));
      const rr = Math.abs(target - entry) / risk;
      if (rr < cfg.minRR) return null;
      const r2 = (v: number) => +v.toFixed(2);
      return {
        mode: "shadow", state, side: o.side, sweepPx: r2(ext), level, entry: r2(entry), stop: r2(stop), target: r2(target), rr: +rr.toFixed(2),
        ageBars: n - 1 - k, why,
        label: `shadow:retest ${o.side} ${state} @ ${r2(entry)} (${level.tf} ${level.kind.toUpperCase()} ${r2(level.lo)}–${r2(level.hi)}), stop ${r2(stop)} beyond sweep ${r2(ext)}, target ${r2(target)} (${rr.toFixed(2)}R)`,
      };
    }
  }
  return null;
}
