/**
 * Multi-TF SMC tape for the liquidity board: FVG / IFVG / sponsored gap,
 * order block, breaker, rejection block, plus MSS / BOS / manipulation /
 * displacement / distribution alerts. Deterministic on OHLC.
 */

import type { OhlcBar } from "@/lib/market/types";
import { etWallParts } from "./sessions";
import { resampleSessionBars } from "./structure";
import {
  detectDisplacements,
  detectFvgs,
  detectOrderBlocks,
  detectSweeps,
  fractalSwings,
  rollingAtr,
  type FvgResult,
  type OrderBlock,
} from "./detectors";

export type SmcTf = "15m" | "1h" | "4h";
export type SmcKind =
  | "fvg"
  | "ifvg"
  | "sponsored"
  | "ob"
  | "bb"
  | "rb";
export type SmcAlertKind =
  | "displacement"
  | "distribution"
  | "accumulation"
  | "manipulation"
  | "mss"
  | "bos";

export interface SmcArray {
  kind: SmcKind;
  tf: SmcTf;
  side: "bull" | "bear";
  top: number;
  bottom: number;
  mid: number;
  t: number;
  at: string;
  state: "fresh" | "partial" | "inverted" | "mitigated" | "breaker";
  label: string;
}

export interface SmcAlert {
  id: string;
  kind: SmcAlertKind;
  tf: SmcTf;
  side: "bull" | "bear";
  at: string;
  price: number;
  label: string;
  urgent: boolean;
}

export interface SmcTape {
  arrays: SmcArray[];
  alerts: SmcAlert[];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function stampEt(t: number): string {
  const p = etWallParts(t);
  return `${pad2(p.hour)}:${pad2(p.minute)} ET`;
}

function mid(a: number, b: number): number {
  return (a + b) / 2;
}

function fvgState(g: FvgResult): SmcArray["state"] {
  if (g.inverted) return "inverted";
  if (g.fill === "full") return "mitigated";
  if (g.fill === "partial") return "partial";
  return "fresh";
}

function arraysFromFvg(g: FvgResult, tf: SmcTf): SmcArray[] {
  const sponsored = g.middleBodyAtrRatio >= 1.5;
  const base: SmcArray = {
    kind: sponsored ? "sponsored" : "fvg",
    tf,
    side: g.kind,
    top: g.top,
    bottom: g.bottom,
    mid: mid(g.top, g.bottom),
    t: g.createdT,
    at: stampEt(g.createdT),
    state: fvgState(g),
    label: sponsored
      ? `${g.kind} sponsored FVG ${g.middleBodyAtrRatio.toFixed(1)}×ATR`
      : `${g.kind} FVG`,
  };
  const out = [base];
  if (g.inverted) {
    out.push({
      ...base,
      kind: "ifvg",
      side: g.kind === "bull" ? "bear" : "bull",
      t: g.invertedT ?? g.createdT,
      at: stampEt(g.invertedT ?? g.createdT),
      state: g.inversionRetested ? "partial" : "inverted",
      label: `${g.kind === "bull" ? "bear" : "bull"} iFVG${g.inversionRetested ? " · retested" : ""}`,
    });
  }
  return out;
}

function arraysFromOb(ob: OrderBlock, bars: OhlcBar[], tf: SmcTf): SmcArray[] {
  const out: SmcArray[] = [
    {
      kind: "ob",
      tf,
      side: ob.kind,
      top: ob.bodyTop,
      bottom: ob.bodyBottom,
      mid: mid(ob.bodyTop, ob.bodyBottom),
      t: ob.t,
      at: stampEt(ob.t),
      state: ob.mitigated ? "mitigated" : "fresh",
      label: `${ob.kind} OB`,
    },
  ];
  if (ob.mitigated && ob.mitigatedIndex != null) {
    const after = bars.slice(ob.mitigatedIndex);
    const broke =
      ob.kind === "bull"
        ? after.some((b) => b.c < ob.bodyBottom)
        : after.some((b) => b.c > ob.bodyTop);
    if (broke) {
      out.push({
        kind: "bb",
        tf,
        side: ob.kind === "bull" ? "bear" : "bull",
        top: ob.bodyTop,
        bottom: ob.bodyBottom,
        mid: mid(ob.bodyTop, ob.bodyBottom),
        t: ob.mitigatedT ?? ob.t,
        at: stampEt(ob.mitigatedT ?? ob.t),
        state: "breaker",
        label: `${ob.kind === "bull" ? "bear" : "bull"} breaker`,
      });
    }
  }
  return out;
}

function rejectionBlocks(bars: OhlcBar[], tf: SmcTf): SmcArray[] {
  if (bars.length < 8) return [];
  const atr = rollingAtr(bars);
  const out: SmcArray[] = [];
  const start = Math.max(2, bars.length - 16);
  for (let i = start; i < bars.length; i++) {
    const b = bars[i]!;
    const a = atr[i];
    if (!a || a <= 0) continue;
    const body = Math.abs(b.c - b.o) || a * 0.05;
    const upWick = b.h - Math.max(b.o, b.c);
    const dnWick = Math.min(b.o, b.c) - b.l;
    if (upWick >= body * 1.6 && upWick >= a * 0.45) {
      out.push({
        kind: "rb",
        tf,
        side: "bear",
        top: b.h,
        bottom: Math.max(b.o, b.c),
        mid: mid(b.h, Math.max(b.o, b.c)),
        t: b.t,
        at: stampEt(b.t),
        state: "fresh",
        label: "bear rejection block",
      });
    }
    if (dnWick >= body * 1.6 && dnWick >= a * 0.45) {
      out.push({
        kind: "rb",
        tf,
        side: "bull",
        top: Math.min(b.o, b.c),
        bottom: b.l,
        mid: mid(Math.min(b.o, b.c), b.l),
        t: b.t,
        at: stampEt(b.t),
        state: "fresh",
        label: "bull rejection block",
      });
    }
  }
  return out;
}

function tapeOn(bars: OhlcBar[], tf: SmcTf): { arrays: SmcArray[]; alerts: SmcAlert[] } {
  const arrays: SmcArray[] = [];
  const alerts: SmcAlert[] = [];
  if (bars.length < 20) return { arrays, alerts };

  const fvgs = detectFvgs(bars);
  const obs = detectOrderBlocks(bars);
  const disp = detectDisplacements(bars);
  const sweeps = detectSweeps(bars);

  for (const g of fvgs.slice(-10)) arrays.push(...arraysFromFvg(g, tf));
  for (const ob of obs.slice(-8)) arrays.push(...arraysFromOb(ob, bars, tf));
  arrays.push(...rejectionBlocks(bars, tf));

  const last = bars[bars.length - 1]!;
  const recentCut =
    last.t -
    (tf === "4h" ? 36 : tf === "1h" ? 18 : 6) *
      (tf === "4h" ? 4 : tf === "1h" ? 1 : 0.25) *
      3600_000;

  const d = disp[disp.length - 1];
  if (d && d.t >= recentCut) {
    alerts.push({
      id: `${tf}-disp-${d.t}`,
      kind: "displacement",
      tf,
      side: d.direction,
      at: stampEt(d.t),
      price: d.close,
      label: `${d.direction} displacement ${d.ratio.toFixed(1)}×ATR @ ${d.close.toFixed(2)}`,
      urgent: tf === "15m" || d.ratio >= 2,
    });
  }

  const swings = fractalSwings(bars, tf === "4h" ? 1 : 2);
  const highs = swings.filter((s) => s.kind === "high");
  const lows = swings.filter((s) => s.kind === "low");
  if (highs.length >= 2) {
    const a = highs[highs.length - 2]!;
    const b = highs[highs.length - 1]!;
    if (b.price > a.price && b.t >= recentCut) {
      alerts.push({
        id: `${tf}-bos-bull-${b.t}`,
        kind: "bos",
        tf,
        side: "bull",
        at: stampEt(b.t),
        price: a.price,
        label: `BOS bull through ${a.price.toFixed(2)}`,
        urgent: false,
      });
    }
  }
  if (lows.length >= 2) {
    const a = lows[lows.length - 2]!;
    const b = lows[lows.length - 1]!;
    if (b.price < a.price && b.t >= recentCut) {
      alerts.push({
        id: `${tf}-bos-bear-${b.t}`,
        kind: "bos",
        tf,
        side: "bear",
        at: stampEt(b.t),
        price: a.price,
        label: `BOS bear through ${a.price.toFixed(2)}`,
        urgent: false,
      });
    }
  }

  const sweep = sweeps[sweeps.length - 1];
  if (sweep && sweep.t >= recentCut) {
    const raidSide = sweep.side === "buyside" ? "bear" : "bull";
    alerts.push({
      id: `${tf}-manip-${sweep.t}`,
      kind: "manipulation",
      tf,
      side: raidSide,
      at: stampEt(sweep.t),
      price: sweep.sweptLevel,
      label: `${sweep.side === "buyside" ? "BSL" : "SSL"} raid ${sweep.sweptLevel.toFixed(2)}`,
      urgent: true,
    });

    if (d && Math.abs(d.index - sweep.index) <= 8) {
      alerts.push({
        id: `${tf}-mss-${d.t}`,
        kind: "mss",
        tf,
        side: d.direction,
        at: stampEt(d.t),
        price: d.close,
        label: `MSS ${d.direction} after ${sweep.side} raid`,
        urgent: true,
      });
      if (sweep.side === "buyside" && d.direction === "bear") {
        alerts.push({
          id: `${tf}-dist-${d.t}`,
          kind: "distribution",
          tf,
          side: "bear",
          at: stampEt(d.t),
          price: d.close,
          label: `Distribution — BSL raid then ${tf} sell displacement`,
          urgent: tf !== "4h",
        });
      }
      if (sweep.side === "sellside" && d.direction === "bull") {
        alerts.push({
          id: `${tf}-dist-${d.t}`,
          kind: "accumulation",
          tf,
          side: "bull",
          at: stampEt(d.t),
          price: d.close,
          label: `Accumulation — SSL raid then ${tf} buy displacement`,
          urgent: tf !== "4h",
        });
      }
    }
  }

  return { arrays, alerts };
}

function dedupeArrays(list: SmcArray[]): SmcArray[] {
  const seen = new Set<string>();
  return list
    .sort((a, b) => b.t - a.t)
    .filter((a) => {
      const k = `${a.kind}:${a.tf}:${a.side}:${a.mid.toFixed(1)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .filter((a) => a.state !== "mitigated")
    .slice(0, 12);
}

function dedupeAlerts(list: SmcAlert[]): SmcAlert[] {
  const seen = new Set<string>();
  return list
    .sort((a, b) => Number(b.urgent) - Number(a.urgent))
    .filter((a) => {
      const k = `${a.kind}:${a.tf}:${a.side}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 8);
}

export function buildSmcTape(bars: OhlcBar[]): SmcTape {
  const ltf = tapeOn(bars.slice(-160), "15m");
  const h1 = tapeOn(resampleSessionBars(bars, 1).slice(-72), "1h");
  const h4 = tapeOn(resampleSessionBars(bars, 4).slice(-40), "4h");
  return {
    arrays: dedupeArrays([...h4.arrays, ...h1.arrays, ...ltf.arrays]),
    alerts: dedupeAlerts([...h4.alerts, ...h1.alerts, ...ltf.alerts]),
  };
}

export function tapeHitsForSide(
  tape: SmcTape | undefined,
  direction: "bull" | "bear",
): {
  breaker: boolean;
  rejection: boolean;
  sponsored: boolean;
  ifvg: boolean;
  fvg: boolean;
  ob: boolean;
  mss: boolean;
  displacement: boolean;
  distribution: boolean;
  manipulation: boolean;
  fights: boolean;
  supports: boolean;
  notes: string[];
} {
  const empty = {
    breaker: false,
    rejection: false,
    sponsored: false,
    ifvg: false,
    fvg: false,
    ob: false,
    mss: false,
    displacement: false,
    distribution: false,
    manipulation: false,
    fights: false,
    supports: false,
    notes: [] as string[],
  };
  if (!tape) return empty;
  const live = tape.arrays.filter((a) => a.state !== "mitigated");
  const has = (kind: SmcKind, side: "bull" | "bear") =>
    live.some((a) => a.kind === kind && a.side === side);
  const pick = (kind: SmcKind, side: "bull" | "bear") =>
    live.find((a) => a.kind === kind && a.side === side);
  const alert = (kind: SmcAlertKind, side?: "bull" | "bear") =>
    tape.alerts.find((a) => a.kind === kind && (side ? a.side === side : true));
  const opp = direction === "bull" ? "bear" : "bull";
  const notes: string[] = [];
  const bb = pick("bb", direction);
  if (bb) notes.push(`${bb.tf} breaker ${bb.at}`);
  const rb = pick("rb", direction);
  if (rb) notes.push(`${rb.tf} rejection ${rb.at}`);
  const sp = pick("sponsored", direction);
  if (sp) notes.push(`${sp.label} ${sp.at}`);
  const iv = pick("ifvg", direction);
  if (iv) notes.push(`${iv.tf} iFVG ${iv.at}`);
  const mss = alert("mss", direction);
  if (mss) notes.push(mss.label);
  const dist =
    alert("distribution", direction) || alert("accumulation", direction);
  if (dist) notes.push(dist.label);
  const fight =
    Boolean(alert("distribution", opp)) || Boolean(alert("accumulation", opp));
  if (fight) notes.push("tape delivering the other way");
  return {
    breaker: Boolean(bb),
    rejection: Boolean(rb),
    sponsored: Boolean(sp),
    ifvg: Boolean(iv),
    fvg: has("fvg", direction) || Boolean(sp),
    ob: has("ob", direction),
    mss: Boolean(mss),
    displacement: Boolean(alert("displacement", direction)),
    distribution: Boolean(dist),
    manipulation: Boolean(alert("manipulation")),
    fights: fight,
    supports: Boolean(mss || dist || sp || bb),
    notes,
  };
}
