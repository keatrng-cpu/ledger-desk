/**
 * Fix 4 — the AMD phase state machine (Keaton's step 2), per book, 09:30–11:00 ET, on CLOSED bars only.
 *
 *   WATCH ─ manipulation: a closed 1m bar's WICK takes a mapped liquidity level or trades into a mapped
 *   │       opposing array (above the open for a bear script, below for a bull one)
 *   MANIP ─ confirm: a BODY close on any closed rung 1m/2m/3m/5m/15m back through the structure that fed the
 *   │       raid (CHoCH: close beyond the last 1m swing before the extreme) or through a gap of the raid's own
 *   │       direction (inversion / failed inversion), with a displacement body ≥ dispAtr × ATR1m
 *   CONFIRM ─ arm: the newest unfilled displacement gap (1m–5m FVG) formed after the extreme, else the
 *   │         displacement OB; entry = its CE, stop = beyond the manipulation extreme (+ buffer), T1 = the
 *   │         nearest REAL mapped level / pool / array edge beyond entry that clears minR
 *   ARMED ─ enter: a later closed 1m bar trades through the entry before the stop or T1
 *   ENTERED ─ (the backtest resolves the outcome; live, the watcher's existing gates and locks decide)
 *   invalid: a body close beyond the manipulation extreme (it was a run, not a Judas) → WATCH again;
 *            T1 printed before the fill → missed; armed longer than fillMin → expired.
 *
 * A state does not decay while price runs toward the target: "late" is a transition (missed), never a
 * falling score. Shadow: wire.deskSeq.amd + shadow:seq:amd rows; never moves q/band/fire.
 */
import type { OhlcBar } from "@/lib/market/types";
import { detectFvgs, fractalSwings, rollingAtr } from "@/lib/trading/detectors";
import { closedBuckets, mappedTargets, type PremarketMap } from "./premarket-map";
import { etOf, r2, seqMode, seqNum, type Mode, type Side } from "./rules";

export type AmdStage = "WATCH" | "MANIP" | "CONFIRM" | "ARMED" | "ENTERED" | "MISSED" | "EXPIRED" | "DONE";
export interface AmdSetup {
  side: Side;
  stage: AmdStage;
  /** What the manipulation took (map level / array) and its extreme. */
  raid: { name: string; price: number; t: number } | null;
  ext: number | null;
  confirm: { tf: string; why: string; t: number } | null;
  entry: number | null;
  entryWhy: string | null;
  stop: number | null;
  t1: { name: string; price: number; r: number } | null;
  t2: { name: string; price: number; r: number } | null;
  armedT: number | null;
  enteredT: number | null;
  log: { t: number; stage: AmdStage; why: string }[];
}
export interface AmdRead {
  mode: Mode;
  symbol: string;
  inWindow: boolean;
  /** AMD phase of the session: accumulation pre-open, manipulation once a raid printed, distribution once confirmed. */
  phase: "accumulation" | "manipulation" | "distribution" | "unknown";
  setups: AmdSetup[];
  /** The live setup (furthest along, newest). */
  live: AmdSetup | null;
}

const P = {
  startEt: () => seqNum("amd", "startEtMin", 570),
  endEt: () => seqNum("amd", "endEtMin", 660),
  dispAtr: () => seqNum("amd", "dispAtr", 1.0),
  stopBufAtr15: () => seqNum("amd", "stopBufAtr15", 0.05),
  minR: () => seqNum("amd", "minR", 1.0),
  fillMin: () => seqNum("amd", "fillMin", 30),
  confirmMin: () => seqNum("amd", "confirmMin", 30),
  maxPerSide: () => seqNum("amd", "maxPerSide", 2),
};
const RAID_TFS = ["15m", "30m", "1h", "4h", "1D"];
const RUNGS: [string, number][] = [["1m", 1], ["2m", 2], ["3m", 3], ["5m", 5], ["15m", 15]];

function fresh(side: Side): AmdSetup {
  return { side, stage: "WATCH", raid: null, ext: null, confirm: null, entry: null, entryWhy: null, stop: null, t1: null, t2: null, armedT: null, enteredT: null, log: [] };
}

/** Liquidity a raid can take for a side: a SHORT script raids buyside (levels/pools/bear-array edges above the open). */
function raidables(map: PremarketMap, side: Side, open: number) {
  const up = side === "short";
  const lv = map.levels.filter((l) => l.kind !== "open").map((l) => ({ name: l.name, price: l.price }));
  const arr = map.arrays.filter((a) => a.live && a.dir === (up ? "bear" : "bull") && RAID_TFS.includes(a.tf)).map((a) => ({ name: `${a.tf} ${a.kind} ${a.lo}–${a.hi}`, price: up ? a.lo : a.hi }));
  return [...lv, ...arr].filter((x) => (up ? x.price > open : x.price < open));
}

/**
 * Replay the machine over CLOSED 1m bars from the window start to `nowMs` (deterministic; reads no bar that
 * closes after nowMs). `bars` must include pre-open history (≥ 30 bars) for ATR and swings.
 */
export function amdRead(symbol: string, map: PremarketMap | null, bars: OhlcBar[], nowMs: number): AmdRead {
  const mode = seqMode("amd");
  const closed = bars.filter((b) => b.t + 60_000 <= nowMs);
  const nowEt = etOf(nowMs).hm;
  const inWindow = nowEt >= P.startEt() && nowEt <= P.endEt() + 60;
  const out: AmdRead = { mode, symbol, inWindow, phase: nowEt < P.startEt() ? "accumulation" : "unknown", setups: [], live: null };
  if (!map || !map.levels.length || closed.length < 40) return out;
  const day = etOf(closed[closed.length - 1]!.t).day;
  const startIdx = closed.findIndex((b) => etOf(b.t).day === day && etOf(b.t).hm >= P.startEt());
  if (startIdx < 30) return out;
  const open = closed[startIdx]!.o;
  const atr15 = map.atr15 ?? 0;
  const done: AmdSetup[] = [];
  const cur: Record<Side, AmdSetup> = { long: fresh("long"), short: fresh("short") };
  const count: Record<Side, number> = { long: 0, short: 0 };
  const lastExt: Record<Side, number | null> = { long: null, short: null };
  const close = (side: Side, s: AmdSetup) => { done.push(s); if (s.stage === "ENTERED") count[side]++; lastExt[side] = s.ext; cur[side] = fresh(side); };
  const targetsAll = (side: Side) => {
    // real liquidity only: the map's levels/pools/array edges + this session's RTH extremes printed so far
    return (px: number, i: number) => {
      const rth = closed.slice(startIdx, i + 1).filter((x) => x.t < (cur[side].raid?.t ?? Infinity));
      const extra = rth.length ? [side === "short" ? { name: "RTH low so far", price: Math.min(...rth.map((b) => b.l)) } : { name: "RTH high so far", price: Math.max(...rth.map((b) => b.h)) }] : [];
      return [...mappedTargets(map, side, px), ...extra.filter((x) => (side === "short" ? x.price < px : x.price > px))].sort((a, b) => Math.abs(a.price - px) - Math.abs(b.price - px));
    };
  };
  const go = (s: AmdSetup, stage: AmdStage, t: number, why: string) => { s.stage = stage; s.log.push({ t, stage, why }); };
  for (let i = startIdx; i < closed.length; i++) {
    const b = closed[i]!;
    const hm = etOf(b.t).hm;
    const tEnd = b.t + 60_000;
    const win = closed.slice(Math.max(0, i - 240), i + 1);
    const atr1 = rollingAtr(win.slice(-60)).at(-1) ?? 0;
    for (const side of ["short", "long"] as const) {
      const s = cur[side];
      const up = side === "short";
      const sgn = up ? 1 : -1;
      // ---- WATCH → MANIP: wick takes a mapped buyside (short) / sellside (long) target above/below the open
      if (s.stage === "WATCH") {
        if (hm > P.endEt() || count[side] >= P.maxPerSide()) continue;
        if (lastExt[side] != null && !(up ? b.h > lastExt[side]! : b.l < lastExt[side]!)) continue; // a new raid needs a new extreme
        const rs = raidables(map, side, open).filter((x) => (up ? b.h >= x.price : b.l <= x.price));
        const prevExt = i > startIdx ? (up ? Math.max(...closed.slice(startIdx, i).map((x) => x.h)) : Math.min(...closed.slice(startIdx, i).map((x) => x.l))) : open;
        const newExt = up ? b.h > prevExt : b.l < prevExt;
        if (rs.length && newExt) {
          const r = rs.sort((a, z) => (up ? z.price - a.price : a.price - z.price))[0]!;
          s.raid = { name: r.name, price: r.price, t: b.t };
          s.ext = up ? b.h : b.l;
          go(s, "MANIP", tEnd, `wick ${up ? "above" : "below"} ${r.name} ${r.price}`);
        }
        continue;
      }
      if (s.stage === "MANIP" || s.stage === "CONFIRM") {
        // extend the extreme while the raid runs (wick); a BODY close beyond the extreme's raid level = a run
        if (up ? b.h > s.ext! : b.l < s.ext!) s.ext = up ? b.h : b.l;
      }
      if (s.stage === "MANIP") {
        const sinceRaid = closed.slice(0, i + 1).filter((x) => x.t >= s.raid!.t);
        if ((tEnd - s.raid!.t) / 60_000 > P.confirmMin()) { go(s, "EXPIRED", tEnd, "no confirmation in time"); close(side, s); continue; }
        // confirm on any rung whose bucket closed at this bar
        let conf: AmdSetup["confirm"] = null;
        const minConf = seqNum("amd", "confirmMinTfMin", 1);
        for (const [tf, mins] of RUNGS) {
          const ms = mins * 60_000;
          if (mins < minConf || tEnd % ms !== 0) continue;
          const rb = closedBuckets(win, ms, tEnd);
          const x = rb[rb.length - 1];
          if (!x || x.t + ms !== tEnd || rb.length < 8) continue;
          const bodyDisp = Math.abs(x.c - x.o) >= P.dispAtr() * atr1 * Math.sqrt(mins) && (up ? x.c < x.o : x.c > x.o);
          // CHoCH: close beyond the last confirmed swing (this rung) printed before the extreme
          const sw = fractalSwings(rb.slice(0, -1), mins >= 5 ? 1 : 2).filter((p) => p.t < s.raid!.t + ms && p.kind === (up ? "low" : "high"));
          const lvl = sw.length ? sw[sw.length - 1]!.price : null;
          const choch = lvl != null && (up ? x.c < lvl : x.c > lvl);
          // inversion: close through a gap of the raid's own direction formed in the run-up
          const gaps = detectFvgs(rb).filter((g) => g.kind === (up ? "bull" : "bear") && g.createdT >= s.raid!.t - 20 * ms && g.createdT < x.t);
          // failed inversion: an IFVG of the raid's direction (a bear gap inverted bull, for a short) closed back through its far side
          const ifv = detectFvgs(rb).filter((g) => g.inverted && g.kind === (up ? "bear" : "bull") && (g.invertedT ?? 0) >= s.raid!.t - 20 * ms && (g.invertedT ?? 0) < x.t);
          const inv = gaps.find((g) => (up ? x.c < g.bottom : x.c > g.top)) ?? ifv.find((g) => (up ? x.c < g.bottom : x.c > g.top));
          if (bodyDisp && (choch || inv)) { conf = { tf, why: choch ? `${tf} body close ${up ? "below" : "above"} swing ${lvl}` : `${tf} body close through the ${up ? "bull" : "bear"} gap ${r2(inv!.bottom)}–${r2(inv!.top)} (inversion)`, t: tEnd }; break; }
        }
        if (conf) { s.confirm = conf; go(s, "CONFIRM", tEnd, conf.why); }
        else if (sinceRaid.length && (up ? b.c > s.raid!.price + atr15 * 0.5 && b.c >= s.ext! - 1e-9 : b.c < s.raid!.price - atr15 * 0.5 && b.c <= s.ext! + 1e-9)) {
          // accepted beyond the raided level: a run, not a manipulation → back to watch (new extreme may raid the next level)
          go(s, "WATCH", tEnd, `body close accepted beyond ${s.raid!.name} — a run, not a Judas`); s.raid = null; s.ext = null;
        }
        if ((s.stage as string) !== "CONFIRM") continue;
      }
      if (s.stage === "CONFIRM" || s.stage === "ARMED") {
        // arm (and, while unfilled, re-anchor) on the unfilled displacement gap (1m–5m) formed after the extreme
        // whose CE a retrace meets first (nearest price, between price and the extreme); else the displacement OB
        let best: { ce: number; why: string; t: number } | null = null;
        for (const [tf, mins] of RUNGS.slice(0, 4)) {
          const ms = mins * 60_000;
          const rb = closedBuckets(win, ms, tEnd);
          for (const g of detectFvgs(rb)) {
            if (g.kind !== (up ? "bear" : "bull") || g.createdT < s.raid!.t || g.fill === "full" || g.inverted) continue;
            const ce = (g.top + g.bottom) / 2;
            if (up ? ce <= b.c || ce >= s.ext! : ce >= b.c || ce <= s.ext!) continue;
            if (!best || Math.abs(ce - b.c) < Math.abs(best.ce - b.c)) best = { ce: r2(ce), why: `${tf} ${up ? "bear" : "bull"} FVG ${r2(g.bottom)}–${r2(g.top)} CE`, t: g.createdT };
          }
        }
        if (!best && s.stage === "CONFIRM") {
          const seg = closed.slice(0, i + 1).filter((x) => x.t >= s.raid!.t);
          const ob = [...seg].reverse().find((x) => (up ? x.c > x.o : x.c < x.o));
          if (ob) best = { ce: r2((Math.max(ob.o, ob.c) + Math.min(ob.o, ob.c)) / 2), why: `1m ${up ? "bear" : "bull"} OB ${r2(Math.min(ob.o, ob.c))}–${r2(Math.max(ob.o, ob.c))} CE`, t: ob.t };
        }
        const rearm = s.stage === "ARMED" && best && best.ce !== s.entry && Math.abs(best.ce - b.c) < Math.abs(s.entry! - b.c);
        if (s.stage === "CONFIRM" || rearm) {
          if (!best) continue;
          const stop = r2(s.ext! + sgn * Math.max(atr15 * P.stopBufAtr15(), 0.25));
          const risk = Math.abs(stop - best.ce);
          if (!(risk > 0) || risk < atr15 * seqNum("amd", "minRiskAtr15", 0.15)) { if (s.stage === "CONFIRM") continue; }
          else {
            const tg = targetsAll(side)(best.ce, i).map((x) => ({ ...x, r: +((Math.abs(best!.ce - x.price)) / risk).toFixed(2) }));
            const t1 = tg.find((x) => x.r >= P.minR()) ?? null;
            if (!t1) { if (s.stage === "CONFIRM") { go(s, "EXPIRED", tEnd, `no real target ≥ ${P.minR()}R beyond ${best.ce}`); close(side, s); } continue; }
            const was = s.stage;
            s.entry = best.ce; s.entryWhy = best.why; s.stop = stop; s.t1 = t1; s.t2 = tg.find((x) => x.r > t1.r + 0.5) ?? null; if (was === "CONFIRM") s.armedT = tEnd;
            go(s, "ARMED", tEnd, `${was === "ARMED" ? "re-anchor → " : ""}entry ${best.ce} (${best.why}), stop ${stop}, T1 ${t1.name} ${t1.price} (${t1.r}R)`);
            continue; // a fill needs a LATER bar
          }
        }
      }
      if (s.stage === "ARMED") {
        const stopHit = up ? b.h >= s.stop! : b.l <= s.stop!;
        const filled = up ? b.h >= s.entry! : b.l <= s.entry!;
        const t1Hit = up ? b.l <= s.t1!.price : b.h >= s.t1!.price;
        if (filled) { s.enteredT = tEnd; go(s, "ENTERED", tEnd, `filled ${s.entry}${stopHit ? " (stop printed in the fill bar)" : ""}`); close(side, s); continue; }
        if (stopHit) { go(s, "EXPIRED", tEnd, "stop printed before the fill"); close(side, s); continue; }
        if (t1Hit) { go(s, "MISSED", tEnd, `T1 ${s.t1!.price} printed before the fill`); close(side, s); continue; }
        if ((tEnd - s.armedT!) / 60_000 > P.fillMin()) { go(s, "EXPIRED", tEnd, "no fill in time"); close(side, s); continue; }
      }
    }
  }
  const all = [...done, ...(["short", "long"] as const).map((k) => cur[k]).filter((s) => s.stage !== "WATCH")];
  out.setups = all;
  const rank: Record<AmdStage, number> = { WATCH: 0, MANIP: 1, CONFIRM: 2, ARMED: 3, ENTERED: 4, MISSED: -1, EXPIRED: -1, DONE: -1 };
  out.live = all.filter((s) => rank[s.stage] > 0).sort((a, b) => rank[b.stage] - rank[a.stage] || (b.log.at(-1)?.t ?? 0) - (a.log.at(-1)?.t ?? 0))[0] ?? null;
  out.phase = nowEt < P.startEt() ? "accumulation" : all.some((s) => ["CONFIRM", "ARMED", "ENTERED"].includes(s.stage)) ? "distribution" : all.length ? "manipulation" : "accumulation";
  return out;
}
