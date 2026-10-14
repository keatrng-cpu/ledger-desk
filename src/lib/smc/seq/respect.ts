/**
 * Fix 3 — respect ledger (shadow). Per book, from 09:30 ET to now on CLOSED bars: every live mapped array
 * (map + intraday 1m–1h FVG/IFVG) that price touched is scored on the touching bar's BODY close:
 * held (wick in, body closes back on the array's side) vs failed (body closes through / failed inversion).
 * Output per tier (LTF 1m–5m, MTF 15m–1h, HTF 4h–1D): bull/bear held − failed, net (bull − bear) and the
 * stronger side when |net| ≥ minNet.
 */
import type { OhlcBar } from "@/lib/market/types";
import { detectFvgs } from "@/lib/trading/detectors";
import { closedBuckets, type MapArray, type PremarketMap } from "./premarket-map";
import { etOf, seqMode, seqNum, type Mode } from "./rules";

export interface RespectTier { bull: number; bear: number; net: number; stronger: "bull" | "bear" | null }
export interface RespectRead { mode: Mode; symbol: string; tiers: Record<"ltf" | "mtf" | "htf" | "all", RespectTier>; events: { t: number; array: string; dir: "bull" | "bear"; held: boolean }[] }
const TIER = (tf: string): "ltf" | "mtf" | "htf" => (["1m", "2m", "3m", "4m", "5m"].includes(tf) ? "ltf" : ["15m", "30m", "1h"].includes(tf) ? "mtf" : "htf");

export function respectRead(symbol: string, map: PremarketMap | null, bars: OhlcBar[], nowMs: number): RespectRead {
  const z = (): RespectTier => ({ bull: 0, bear: 0, net: 0, stronger: null });
  const out: RespectRead = { mode: seqMode("respect"), symbol, tiers: { ltf: z(), mtf: z(), htf: z(), all: z() }, events: [] };
  const closed = bars.filter((b) => b.t + 60_000 <= nowMs);
  if (!map || closed.length < 30) return out;
  const day = etOf(closed.at(-1)!.t).day;
  const rth = closed.filter((b) => etOf(b.t).day === day && etOf(b.t).hm >= 570);
  if (!rth.length) return out;
  const arrays: MapArray[] = map.arrays.filter((a) => a.live && (a.kind === "fvg" || a.kind === "ifvg" || a.kind === "sponsored" || a.kind === "ob" || a.kind === "breaker"));
  for (const [tf, mins] of [["5m", 5], ["15m", 15], ["1h", 60]] as const) {
    for (const g of detectFvgs(closedBuckets(closed.slice(-1500), mins * 60_000, rth[0]!.t))) {
      if (g.fill === "full") continue;
      const inv = g.inverted; const dir = inv ? (g.kind === "bull" ? "bear" : "bull") : g.kind;
      arrays.push({ tf, kind: inv ? "ifvg" : "fvg", dir, lo: g.bottom, hi: g.top, ce: (g.top + g.bottom) / 2, live: true, t: g.createdT });
    }
  }
  for (const a of arrays) {
    for (const b of rth) {
      const touch = a.dir === "bull" ? b.l <= a.hi : b.h >= a.lo;
      if (!touch) continue;
      const held = a.dir === "bull" ? b.c >= a.lo : b.c <= a.hi;
      out.events.push({ t: b.t, array: `${a.tf} ${a.dir} ${a.kind} ${a.lo}–${a.hi}`, dir: a.dir, held });
      const w = held ? 1 : -1;
      for (const k of [TIER(a.tf), "all"] as const) out.tiers[k][a.dir] += w;
      break; // first touch decides (later touches are a different event: the array is spent)
    }
  }
  const minNet = seqNum("respect", "minNet", 2);
  for (const t of Object.values(out.tiers)) { t.net = t.bull - t.bear; t.stronger = t.net >= minNet ? "bull" : t.net <= -minNet ? "bear" : null; }
  return out;
}
