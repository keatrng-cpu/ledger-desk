/**
 * combo1016 config1 LIVE candidate source: a closed-bar port of the research candidate generator (week1016-review/work/eng.py day loop +
 * score.py dedupe), so the live config1 path no longer depends on the desk's ltfArm for its raid inputs.
 *
 * Fills, per book and side, at the close of the last closed 1m bar J (decision bar label = J, research `t`):
 *   wtmax, nk      raids on bar i (named pools PDH/PDL/ONH/ONL 1.0, Asia/London 0.8, 15-bar 1m fractal sweep 0.6, HTF FVG tap 0.9/0.7(15m),
 *                  in-array LH/HL 0.8 (1h/4h)/0.6, LH/HL 0.5) whose decision bar jm == J, deduped on (sym, side, t): wtmax = max weight, nk = distinct kinds.
 *   pd             eng.py pdscore at C[jm] on DR = min/max(prior calendar-day RTH 08:30–15:00, ON = prior day ≥15:15 + today <08:00), unclipped.
 *   arr_ifvg       newest entry array (sorted by bar, iFVG last on ties) is an iFVG.
 *   chaseR         |price − newest near edge| / |price − stop| (market anchor; live price stands in for O[sig]).
 *   risk_atr       |newest near edge − stop| / a5 (a5 = ATR14 rolling mean, min_periods 1, of 5m bars available at the decision close).
 *   + disp, mss, ifvg, eqhit, n_arr, tmin, stop (= ext ∓ max(BUF, 0.1·ATR1m)), raid time / level for smt and the setup id.
 *
 * Timing (no lookahead): every input uses bars that closed at or before J's close. jm (first bar with MSS or disp ≥ 1.2 and a same-direction
 * body, pushed to the first entry array) is causal in eng.py, so the DECISION BAR matches research exactly. eng.py keeps scanning up to 5 bars past
 * jm (jend) for disp / mss / ifvg / ext; live cannot, so those four use bars ≤ jm (documented difference; fire-count proof in docs/combo1016/README).
 * History limits: HTF FVGs are rebuilt from the bars the desk holds (5m: 1mo 5m feed + 1m tail; 15m: 1mo; 1h/4h from 15m) vs research 90 days.
 */
import type { B } from "./combo1016-feat";
type Side = "long" | "short";
const M1 = 60_000, M5 = 300_000, M15 = 900_000, HOUR = 3_600_000;
const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const offC = new Map<number, number>();
function ctOff(ms: number): number { const k = Math.floor(ms / HOUR); let v = offC.get(k); if (v == null) { const p = Object.fromEntries(fmt.formatToParts(new Date(k * HOUR)).map((x) => [x.type, x.value])); v = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour! % 24, +p.minute!) - k * HOUR; offC.set(k, v); } return v; }
const wall = (ms: number) => ms + ctOff(ms);
const tod = (ms: number) => Math.floor((wall(ms) % 86_400_000) / 60_000);
const cdate = (ms: number) => Math.floor(wall(ms) / 86_400_000);
const dowOf = (ms: number) => (new Date(cdate(ms) * 86_400_000).getUTCDay() + 6) % 7; // Mon=0

export interface ResearchCand {
  side: Side; t: number; tRaid: number; kind: string; kinds: string[]; lv: number; wtmax: number; nk: number; disp: number; mss: boolean; ifvg: boolean;
  arr_ifvg: 0 | 1; n_arr: number; eqhit: 0 | 1; pd: number; tmin: number; dow: number; stop: number; ext: number; edge: number; a5: number; a1: number; px: number;
  /** label of the bar at whose close the desk decides (jend mode: research jend; jm mode: t) */
  tDecide: number;
}
type Bar = { t: number; o: number; h: number; l: number; c: number };
function agg(bars: Bar[], ms: number, off = 0): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) { const k = Math.floor((b.t - off) / ms) * ms + off; const L = out[out.length - 1]; if (L && L.t === k) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; } else out.push({ t: k, o: b.o, h: b.h, l: b.l, c: b.c }); }
  return out;
}
/** eng.py atr(): TR vs previous close (first bar: own close), rolling(14, min_periods=1).mean() */
function atrRoll(b: Bar[]): number[] {
  const tr = b.map((x, i) => { const pc = i ? b[i - 1]!.c : x.c; return Math.max(x.h - x.l, Math.abs(x.h - pc), Math.abs(x.l - pc)); });
  const out: number[] = []; let s = 0;
  for (let i = 0; i < tr.length; i++) { s += tr[i]!; if (i >= 14) s -= tr[i - 14]!; out.push(s / Math.min(i + 1, 14)); }
  return out;
}
interface Fvg { id: string; tf: string; d: 1 | -1; lo: number; hi: number; avail: number; end: number }
/** eng.py fvgs(): actives invalidated by a close beyond the far edge, list trimmed to the newest 40; only bars available by `asOf`. */
function fvgs(r: Bar[], tf: string, tfMs: number, asOf: number): Fvg[] {
  const out: Fvg[] = []; let act: Fvg[] = [];
  const rr = r.filter((x) => x.t + tfMs <= asOf);
  for (let i = 2; i < rr.length; i++) {
    const av = rr[i]!.t + tfMs, c = rr[i]!.c; const keep: Fvg[] = [];
    for (const z of act) { if ((z.d === 1 && c < z.lo) || (z.d === -1 && c > z.hi)) { out.push({ ...z, end: av }); continue; } keep.push(z); }
    act = keep.slice(-40);
    if (rr[i]!.l > rr[i - 2]!.h) act.push({ id: `${tf}:${rr[i]!.t}:1`, tf, d: 1, lo: rr[i - 2]!.h, hi: rr[i]!.l, avail: av, end: Infinity });
    if (rr[i]!.h < rr[i - 2]!.l) act.push({ id: `${tf}:${rr[i]!.t}:-1`, tf, d: -1, lo: rr[i]!.h, hi: rr[i - 2]!.l, avail: av, end: Infinity });
  }
  return [...out, ...act];
}

/**
 * own1m / other1m: closed 1m bars (oldest first). own15m: closed 15m bars (~1 month). own5m: closed 5m bars (~1 month, 24h) or [].
 * sym: "ES" | "NQ" (stop buffer). Returns the deduped research candidates whose decision bar is the LAST closed own 1m bar.
 */
export function researchCandidates(i: { own1m: B[]; own15m: B[]; own5m?: B[]; sym: string; nowMs?: number; mode?: "jend" | "jm" }): ResearchCand[] {
  const mode = i.mode ?? "jm";
  const bars = i.own1m as Bar[]; if (bars.length < 40) return [];
  const J = bars.length - 1, tJ = bars[J]!.t, closeJ = tJ + M1;
  const TICK = 0.25, BUF = /NQ/.test(i.sym) ? 2.0 : 0.5;
  const today = cdate(tJ), tmJ = tod(tJ);
  if (dowOf(tJ) >= 5 || tmJ < 480 || tmJ >= 890) return [];
  // ---- day pools from 15m (all boundaries on 15m edges) + the 1m tail not yet in a closed 15m bar
  const b15 = (i.own15m as Bar[]).filter((b) => b.t + M15 <= closeJ);
  const tail = bars.filter((b) => b.t >= (b15.length ? b15[b15.length - 1]!.t + M15 : -Infinity));
  const src = [...b15.map((b) => ({ ...b, n: 15 })), ...tail.map((b) => ({ ...b, n: 1 }))];
  const prevDay = today - 1; // eng.py: prev = the previous calendar day's bars (Sunday → Monday is skipped: no prior RTH)
  const prth = src.filter((b) => cdate(b.t) === prevDay && tod(b.t) >= 510 && tod(b.t) < 900);
  if (prth.reduce((s, b) => s + b.n, 0) < 100) return [];
  const PDH = Math.max(...prth.map((b) => b.h)), PDL = Math.min(...prth.map((b) => b.l));
  const on = src.filter((b) => (cdate(b.t) === prevDay && tod(b.t) >= 915) || (cdate(b.t) === today && tod(b.t) < 480));
  if (!on.length) return [];
  const ONH = Math.max(...on.map((b) => b.h)), ONL = Math.min(...on.map((b) => b.l));
  const asia = src.filter((b) => cdate(b.t) === prevDay && tod(b.t) >= 1140), lon = src.filter((b) => cdate(b.t) === today && tod(b.t) >= 60 && tod(b.t) < 240);
  const pools: Record<string, [number, number, 1 | -1]> = { PDH: [PDH, 1, 1], PDL: [PDL, 1, -1], ONH: [ONH, 1, 1], ONL: [ONL, 1, -1] };
  if (asia.length) { pools.AsiaH = [Math.max(...asia.map((b) => b.h)), 0.8, 1]; pools.AsiaL = [Math.min(...asia.map((b) => b.l)), 0.8, -1]; }
  if (lon.length) { pools.LonH = [Math.max(...lon.map((b) => b.h)), 0.8, 1]; pools.LonL = [Math.min(...lon.map((b) => b.l)), 0.8, -1]; }
  const DRlo = Math.min(PDL, ONL), DRhi = Math.max(PDH, ONH);
  // ---- 1m arrays of today (ix[0] = first bar of the calendar day held)
  const d0 = bars.findIndex((b) => cdate(b.t) === today); if (d0 < 0) return [];
  const H = bars.map((b) => b.h), L = bars.map((b) => b.l), C = bars.map((b) => b.c), O = bars.map((b) => b.o), T = bars.map((b) => b.t);
  const A1 = atrRoll(bars);
  // ---- 5m ATR (A5 asof close) and HTF FVGs
  const b5own = agg(bars, M5);
  const h5 = ((i.own5m ?? []) as Bar[]).filter((b) => b.t + M5 <= closeJ && b.t < (b5own[0]?.t ?? Infinity));
  const r5 = [...h5, ...b5own.filter((b) => b.t + M5 <= closeJ)];
  const a5r = atrRoll(r5);
  const A5at = (closeT: number): number => { let lo = 0, hi = r5.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (r5[m]!.t + M5 <= closeT) { k = m; lo = m + 1; } else hi = m - 1; } return k >= 0 ? a5r[k]! : NaN; };
  const r15 = [...b15.map(({ t, o, h, l, c }) => ({ t, o, h, l, c })), ...agg(tail, M15).filter((b) => b.t + M15 <= closeJ)];
  const r1h = agg(r15, HOUR), r4h = agg(r15, 4 * HOUR, 2 * HOUR);
  const HF: Fvg[] = [...fvgs(r5, "5min", M5, closeJ), ...fvgs(r15, "15min", M15, closeJ), ...fvgs(r1h, "1h", HOUR, closeJ), ...fvgs(r4h, "4h", 4 * HOUR, closeJ)];
  const SUB = HF.filter((z) => z.end > T[d0]!);   // eng.py SUB: arrays alive at some point today
  const htfActive = (k: number, dd: 1 | -1) => { const cn = T[k]! + M1; return SUB.filter((z) => z.avail <= cn && z.end > cn && z.d === dd); };
  // ---- raid loop over w = today 08:00 .. J (eng.py: 08:00..14:50; taken flags from 08:00)
  const w: number[] = []; for (let k = d0; k <= J; k++) if (tod(T[k]!) >= 480 && tod(T[k]!) <= 890) w.push(k);
  if (!w.length) return [];
  const taken: Record<string, boolean> = Object.fromEntries(Object.keys(pools).map((k) => [k, false]));
  const swHi: [number, number][] = [], swLo: [number, number][] = [], sw15: [number, number, 1 | -1][] = [];
  const lastarr = new Map<string, number>();
  type Raid = { i: number; side: Side; kind: string; lv: number; wt: number };
  const raids: Raid[] = [];
  for (const k of w) {
    if (k - 4 >= d0) { const j = k - 2; if (H[j]! >= Math.max(...H.slice(j - 2, j + 3))) swHi.push([j, H[j]!]); if (L[j]! <= Math.min(...L.slice(j - 2, j + 3))) swLo.push([j, L[j]!]); }
    if (k - 30 >= d0) { const j = k - 15; if (H[j]! >= Math.max(...H.slice(j - 15, j + 16))) sw15.push([j, H[j]!, 1]); if (L[j]! <= Math.min(...L.slice(j - 15, j + 16))) sw15.push([j, L[j]!, -1]); }
    const evs: Raid[] = [];
    for (const [nm, [lv, wt, dd]] of Object.entries(pools)) {
      if (taken[nm]) continue;
      if (dd === 1 && H[k]! > lv) { taken[nm] = true; evs.push({ i: k, side: "short", kind: nm, lv, wt }); }
      if (dd === -1 && L[k]! < lv) { taken[nm] = true; evs.push({ i: k, side: "long", kind: nm, lv, wt }); }
    }
    for (const [j, lv, dd] of sw15.slice(-6)) {
      if (j >= k - 2) continue;
      if (dd === 1 && H[k]! > lv && H[k - 1]! <= lv) evs.push({ i: k, side: "short", kind: "sw15", lv, wt: 0.6 });
      if (dd === -1 && L[k]! < lv && L[k - 1]! >= lv) evs.push({ i: k, side: "long", kind: "sw15", lv, wt: 0.6 });
    }
    for (const [dd, side] of [[-1, "short"], [1, "long"]] as const) {
      for (const z of htfActive(k, dd)) {
        if (dd === -1 && H[k]! >= z.lo && H[k - 1]! < z.lo && C[k]! < z.hi) { evs.push({ i: k, side, kind: "tap" + z.tf, lv: z.lo, wt: z.tf !== "15min" ? 0.9 : 0.7 }); break; }
        if (dd === 1 && L[k]! <= z.hi && L[k - 1]! > z.hi && C[k]! > z.lo) { evs.push({ i: k, side, kind: "tap" + z.tf, lv: z.hi, wt: z.tf !== "15min" ? 0.9 : 0.7 }); break; }
      }
    }
    if (k - 10 >= d0) {
      for (const [dd, side] of [[-1, "short"], [1, "long"]] as const) {
        if ((dd === -1 && H[k]! >= Math.max(...H.slice(k - 10, k))) || (dd === 1 && L[k]! <= Math.min(...L.slice(k - 10, k)))) {
          for (const z of htfActive(k, dd)) {
            const px = dd === -1 ? H[k]! : L[k]!; const a5k = A5at(T[k]! + M1); const tol = 0.25 * (Number.isFinite(a5k) ? a5k : A1[k]! * 2);
            if (z.lo - tol <= px && px <= z.hi + tol && (lastarr.get(`${z.id}|${side}`) ?? -99) < k - 10) { lastarr.set(`${z.id}|${side}`, k); evs.push({ i: k, side, kind: "in" + z.tf, lv: px, wt: z.tf === "1h" || z.tf === "4h" ? 0.8 : 0.6 }); break; }
          }
        }
      }
    }
    if (k - 30 >= d0) {
      const a5k = A5at(T[k]! + M1); const a5i = Number.isFinite(a5k) ? a5k : A1[k]! * 2;
      const m30 = Math.max(...H.slice(k - 30, k - 3)), n30 = Math.min(...L.slice(k - 30, k - 3));
      if (H[k]! >= Math.max(...H.slice(k - 5, k)) && m30 - H[k]! >= 0 && m30 - H[k]! <= 0.5 * a5i && (lastarr.get("lh") ?? -99) < k - 5) { lastarr.set("lh", k); evs.push({ i: k, side: "short", kind: "lh", lv: H[k]!, wt: 0.5 }); }
      if (L[k]! <= Math.min(...L.slice(k - 5, k)) && L[k]! - n30 >= 0 && L[k]! - n30 <= 0.5 * a5i && (lastarr.get("hl") ?? -99) < k - 5) { lastarr.set("hl", k); evs.push({ i: k, side: "long", kind: "hl", lv: L[k]!, wt: 0.5 }); }
    }
    raids.push(...evs);
  }
  // ---- process raids (causal: bars ≤ J); keep those whose decision bar jm == J
  const rows: (ResearchCand & { wt: number; jend: number })[] = [];
  for (const rd of raids) {
    const ri = rd.i, s = rd.side === "long" ? 1 : -1;
    if (tod(T[ri]!) >= 870) continue;
    let ext = s === 1 ? L[ri]! : H[ri]!;
    const ref = (s === 1 ? swHi : swLo).filter(([j]) => j < ri).map(([, p]) => p); const mssref = ref.length ? ref[ref.length - 1]! : null;
    const arrays: [string, number, number, number, "fvg" | "ifvg"][] = [];
    let dispmax = 0, mss = false, ifvg = false, jm: number | null = null, j = ri, jl = ri;
    for (j = ri; j <= J && j < ri + 15; j++) {
      if (tod(T[j]!) >= 890) break; // eng.py: range(i, min(i+15, last)), last = the 14:50 bar
      jl = j;
      ext = s === 1 ? Math.min(ext, L[j]!) : Math.max(ext, H[j]!);
      const body = (C[j]! - O[j]!) * s;
      if (body > 0) dispmax = Math.max(dispmax, body / Math.max(A1[j - 1]!, 1e-9));
      if (s === -1 && H[j]! < L[j - 2]!) arrays.push(["1m", H[j]!, L[j - 2]!, j, "fvg"]);
      if (s === 1 && L[j]! > H[j - 2]!) arrays.push(["1m", H[j - 2]!, L[j]!, j, "fvg"]);
      if (mssref != null && ((s === -1 && C[j]! < mssref) || (s === 1 && C[j]! > mssref))) mss = true;
      if ((mss || dispmax >= 1.2) && jm == null && body > 0) jm = j;
      if (jm != null && j >= jm + 5) break;
    }
    const jend = jl;
    if (jm == null) continue;
    // the research leg scan is complete at jend when it stopped on its own (jm0+5, raid+14 bars, or the bar before 14:50), not on the data edge
    const complete = jend === jm + 5 || jend === ri + 14 || tod(T[jend]!) >= 889;
    for (let q = Math.max(ri - 10, d0 + 2); q <= jend; q++) {
      for (let jj = Math.max(q + 1, ri); jj <= jend; jj++) {
        if (s === -1 && L[q]! > H[q - 2]! && C[jj]! < H[q - 2]!) { arrays.push(["1m", H[q - 2]!, L[q]!, jj, "ifvg"]); ifvg = true; break; }
        if (s === 1 && H[q]! < L[q - 2]! && C[jj]! > L[q - 2]!) { arrays.push(["1m", H[q]!, L[q - 2]!, jj, "ifvg"]); ifvg = true; break; }
      }
    }
    let arr = arrays.filter((a) => a[3] >= jm! - 2);
    if (!arr.length) continue;
    jm = Math.max(jm, Math.min(...arr.map((a) => a[3])));
    // mode "jend" (live default): decide at the close of jend, when every research input (disp/mss/ifvg/ext scan to jend) is CLOSED → research-exact
    //   features with no lookahead; the live entry is at J+1 instead of jm+1 (0..5 bars later).  mode "jm": decide at jm's close with bars ≤ jm.
    if (mode === "jend" ? !complete : jm !== J) continue;
    arr = arr.filter((a) => a[3] <= jm!);
    if (tod(T[jm]!) >= 889) continue;             // eng.py: sig = jm+1 >= last (14:50 bar) → no candidate
    const stop = ext - s * Math.max(BUF, 0.1 * A1[jm]!);
    const a5v = A5at(T[jm]! + M1); const a5 = Number.isFinite(a5v) ? a5v : A1[jm]! * 2.2;
    const newest = [...arr].sort((x, y) => x[3] - y[3] || Number(x[4] === "ifvg") - Number(y[4] === "ifvg"))[arr.length - 1]!;
    const edge = s === -1 ? newest[1] : newest[2];
    const leglo = s === -1 ? Math.min(...L.slice(ri, jm + 1)) : Math.max(...H.slice(ri, jm + 1));
    const eq = (ext + leglo) / 2;
    const eqhit = arr.some((a) => a[1] - 0.25 * a5 <= eq && eq <= a[2] + 0.25 * a5) ? 1 : 0;
    const pdpos = (C[jm]! - DRlo) / Math.max(DRhi - DRlo, 1e-9);
    rows.push({ side: rd.side, t: T[jm]!, tRaid: T[ri]!, kind: rd.kind, kinds: [rd.kind], lv: rd.lv, wt: rd.wt, wtmax: rd.wt, nk: 1, disp: dispmax, mss, ifvg,
      arr_ifvg: newest[4] === "ifvg" ? 1 : 0, n_arr: arr.length, eqhit: eqhit as 0 | 1, pd: s === -1 ? pdpos : 1 - pdpos, tmin: tod(T[jm]!), dow: dowOf(T[jm]!),
      stop, ext, edge, a5, a1: A1[jm]!, px: C[jm]!, tDecide: T[J]!, jend });
  }
  // score.py dedupe on (sym, side, t): keep the max-weight row; wtmax = max wt, nk = distinct kinds
  const out: ResearchCand[] = [];
  for (const side of ["short", "long"] as const) {
    // group = (side, t = jm). jm mode: t == J. jend mode: the group is decided once its last member's scan completed at J (max jend == J).
    const tKey = mode === "jm" ? T[J]! : rows.filter((r) => r.side === side && r.jend === J).map((r) => r.t).sort((a, b) => b - a)[0];
    if (tKey == null) continue;
    const g = rows.filter((r) => r.side === side && r.t === tKey); if (!g.length || Math.max(...g.map((r) => r.jend)) !== (mode === "jm" ? Math.max(...g.map((r) => r.jend)) : J)) continue;
    const best = [...g].sort((a, b) => b.wt - a.wt)[0]!; const kinds = [...new Set(g.map((r) => r.kind))].sort();
    const { wt: _w, jend: _e, ...rest } = best; void _w; void _e;
    out.push({ ...rest, kinds, wtmax: Math.max(...g.map((r) => r.wt)), nk: kinds.length });
  }
  void TICK; void i.nowMs;
  return out;
}

/** Research GBM/S2 candidate inputs from a ResearchCand at live price `price` (chaseR on the market anchor, risk_atr on the newest edge). */
export function candInputs(c: ResearchCand, price: number | null): { chaseR: number | null; risk_atr: number | null } {
  const TICK = 0.25; const s = c.side === "long" ? 1 : -1;
  const rEdge = Math.abs(c.edge - c.stop); const okEdge = rEdge > 2 * TICK && rEdge <= 3 * c.a5 && (c.edge - c.stop) * s > 0;
  const px = price ?? c.px; const rM = Math.abs(px - c.stop); const okM = rM > 2 * TICK && rM <= 3 * c.a5 && (px - c.stop) * s > 0;
  return { chaseR: okM ? Math.abs(px - c.edge) / rM : null, risk_atr: okEdge ? rEdge / c.a5 : null };
}
