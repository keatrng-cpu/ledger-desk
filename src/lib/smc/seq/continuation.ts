/**
 * Fix 9 — continuation mode (shadow). After an AMD setup ENTERED and the distribution leg is running,
 * while structure holds (NOT both the last closed 5m AND 15m bar closing back beyond the last 5m swing
 * against the trade), the desk:
 *   - rolls T1 to the next REAL mapped pool/level beyond the one already printed (labelled, never synthetic);
 *   - re-anchors the entry to the newest unmitigated same-side gap (1m–30m) formed after the last BOS;
 *   - tags the regime "trend" only after 2 consecutive closed 15m bars close beyond the session open in
 *     the trade direction (hysteresis), and arms a continuation only in trend;
 *   - never counts a continuation as a "second entry" (it has its own maxPerSide).
 * Stops are real structure: beyond the last 5m swing (+ buffer). Closed bars by feed time only.
 */
import type { OhlcBar } from "@/lib/market/types";
import { detectFvgs, fractalSwings } from "@/lib/trading/detectors";
import { closedBuckets, mappedTargets, type PremarketMap } from "./premarket-map";
import type { AmdRead } from "./amd-state";
import { etOf, r2, seqMode, seqNum, type Mode, type Side } from "./rules";

export interface ContSetup {
  side: Side; stage: "ARMED" | "ENTERED" | "EXPIRED" | "MISSED";
  parentT: number; entry: number; entryWhy: string; stop: number;
  t1: { name: string; price: number; r: number }; armedT: number; enteredT: number | null;
  rolledFrom: string | null; regime: "trend" | "range"; log: string[];
}
export interface ContRead { mode: Mode; symbol: string; regime: "trend" | "range" | "unknown"; setups: ContSetup[]; rolledT1: Record<Side, { name: string; price: number } | null> }

const TFS: [string, number][] = [["1m", 1], ["2m", 2], ["3m", 3], ["5m", 5], ["15m", 15], ["30m", 30]];

export function regimeAt(closed: OhlcBar[], open: number, side: Side, tEnd: number): "trend" | "range" {
  const b15 = closedBuckets(closed, 900_000, tEnd).filter((b) => etOf(b.t).hm >= 570 && etOf(b.t).day === etOf(tEnd - 60_000).day);
  const last2 = b15.slice(-2);
  if (last2.length < 2) return "range";
  return last2.every((b) => (side === "short" ? b.c < open : b.c > open)) ? "trend" : "range";
}

export function continuationRead(symbol: string, map: PremarketMap | null, bars: OhlcBar[], nowMs: number, amd: AmdRead | null): ContRead {
  const out: ContRead = { mode: seqMode("continuation"), symbol, regime: "unknown", setups: [], rolledT1: { long: null, short: null } };
  if (!map || !amd) return out;
  const closed = bars.filter((b) => b.t + 60_000 <= nowMs);
  if (closed.length < 60) return out;
  const day = etOf(closed.at(-1)!.t).day;
  const s0 = closed.findIndex((b) => etOf(b.t).day === day && etOf(b.t).hm >= 570);
  if (s0 < 30) return out;
  const open = closed[s0]!.o, atr15 = map.atr15 ?? 0;
  const endEt = seqNum("continuation", "endEtMin", 690), minR = seqNum("continuation", "minR", 1.0);
  const fillMin = seqNum("continuation", "fillMin", 20), maxPer = seqNum("continuation", "maxPerSide", 2), buf = seqNum("continuation", "stopBufAtr15", 0.15);
  const used = new Set<string>(); // a gap anchors one continuation per side, across parents
  for (const parent of amd.setups.filter((s) => s.stage === "ENTERED" && s.enteredT && s.t1)) {
    const side = parent.side, up = side === "short", sgn = up ? 1 : -1;
    let printed = parent.t1!; // the T1 already in play
    let arm: ContSetup | null = null; let n = 0;
    const i0 = closed.findIndex((b) => b.t + 60_000 >= parent.enteredT!);
    for (let i = i0 + 1; i < closed.length; i++) {
      const b = closed[i]!, tEnd = b.t + 60_000, hm = etOf(b.t).hm;
      if (hm > endEt) break;
      const win = closed.slice(Math.max(0, i - 400), i + 1);
      // structure: the last 5m swing against the trade since the parent fill
      const b5 = closedBuckets(win, 300_000, tEnd);
      const sw = fractalSwings(b5.filter((x) => x.t >= parent.raid!.t), 1).filter((p) => p.kind === (up ? "high" : "low"));
      const lh = sw.length ? sw.at(-1)!.price : parent.ext!;
      const l5 = b5.at(-1), l15 = closedBuckets(win, 900_000, tEnd).at(-1);
      const broken = !!(l5 && l15 && (up ? l5.c > lh && l15.c > lh : l5.c < lh && l15.c < lh));
      if (broken) { if (arm?.stage === "ARMED") { arm.stage = "EXPIRED"; arm.log.push("structure broke (5m and 15m closed beyond the last swing)"); } break; }
      // T1 printed → roll to the next real pool beyond it
      if (up ? b.l <= printed.price : b.h >= printed.price) {
        const nxt = mappedTargets(map, side, printed.price - sgn * 0.01).find((x) => (up ? x.price < printed.price : x.price > printed.price));
        if (!nxt) break;
        out.rolledT1[side] = { name: nxt.name, price: nxt.price };
        printed = { ...nxt, r: 0 };
      }
      const regime = regimeAt(win, open, side, tEnd); out.regime = regime;
      if (arm?.stage === "ARMED") {
        if (up ? b.h >= arm.stop : b.l <= arm.stop) { arm.stage = "EXPIRED"; arm.log.push("stop before fill"); arm = null; continue; }
        if (up ? b.h >= arm.entry : b.l <= arm.entry) { arm.stage = "ENTERED"; arm.enteredT = tEnd; arm.log.push(`filled ${arm.entry}`); n++; arm = null; continue; }
        if (up ? b.l <= arm.t1.price : b.h >= arm.t1.price) { arm.stage = "MISSED"; arm.log.push("T1 before fill"); arm = null; continue; }
        if ((tEnd - arm.armedT) / 60_000 > fillMin) { arm.stage = "EXPIRED"; arm.log.push("no fill in time"); arm = null; continue; }
      }
      if (n >= maxPer || regime !== "trend" || !out.rolledT1[side]) continue;
      // re-anchor: newest unmitigated same-side gap after the last BOS (newest 5m swing in the trade direction broken)
      let best: { ce: number; why: string; t: number; far: number; key: string } | null = null;
      for (const [tf, mins] of TFS) {
        for (const g of detectFvgs(closedBuckets(win, mins * 60_000, tEnd))) {
          if (g.kind !== (up ? "bear" : "bull") || g.fill !== "none" || g.inverted || g.createdT < parent.enteredT!) continue;
          const ce = (g.top + g.bottom) / 2;
          if (up ? ce <= b.c : ce >= b.c) continue;
          if (used.has(`${side}:${tf}:${g.createdT}`)) continue;
          if (!best || g.createdT > best.t) best = { ce: r2(ce), why: `${tf} ${g.kind} FVG ${r2(g.bottom)}–${r2(g.top)} CE`, t: g.createdT, far: up ? g.top : g.bottom, key: `${side}:${tf}:${g.createdT}` };
        }
      }
      if (!best || (arm && arm.entry === best.ce)) continue;
      const stop = r2(lh + sgn * Math.max(atr15 * buf, 0.25));
      const risk = sgn * (stop - best.ce); // the stop must sit beyond the entry (real structure)
      if (!(risk > 0) || risk < atr15 * 0.15) continue;
      const t1 = mappedTargets(map, side, best.ce).filter((x) => (up ? x.price <= out.rolledT1[side]!.price : x.price >= out.rolledT1[side]!.price))
        .map((x) => ({ ...x, r: +(Math.abs(best!.ce - x.price) / risk).toFixed(2) })).find((x) => x.r >= minR);
      if (!t1) continue;
      const why = `armed ${best.ce} (${best.why}) stop ${stop} beyond 5m swing ${r2(lh)}, T1 ${t1.name} ${t1.price} (${t1.r}R)`;
      if (arm?.stage === "ARMED") { used.add(best.key); Object.assign(arm, { entry: best.ce, entryWhy: best.why, stop, t1 }); arm.log.push("re-anchor → " + why); continue; }
      used.add(best.key);
      arm = { side, stage: "ARMED", parentT: parent.enteredT!, entry: best.ce, entryWhy: best.why, stop, t1, armedT: tEnd, enteredT: null, rolledFrom: parent.t1!.name, regime, log: [why] };
      out.setups.push(arm);
    }
  }
  return out;
}
