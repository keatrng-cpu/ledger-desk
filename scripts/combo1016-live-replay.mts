/**
 * config1 LIVE replay on real 1m bars (SMC integration bars1m ES/NQ 2026-08-17..10-16), desk-view inputs only:
 * at every decision close 08:01..14:51 CT the desk sees the last 480 closed 1m bars (own + other), 1 month of closed 15m and 1 month of closed 5m
 * (the new 5m feed). Candidates = combo1016-cand.ts researchCandidates; features = cand + barFeatures (atrpct incl.) + candFeatures (b1/b4/smt);
 * S2/gbmP = arms models; fire = config1 rule. Read-only: no network, no orders.
 * usage: npx tsx scripts/combo1016-live-replay.mts [outJson]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { researchCandidates, candInputs } from "../src/lib/smc/combo1016-cand";
import { barFeatures, candFeatures, type B } from "../src/lib/smc/combo1016-feat";
import { armsS2, armsGbmP, armFire, ARMS_GBM_FEATURES } from "../src/lib/smc/combo1016-arms";
const DIR = "/workspace/audits/smc-research/integration/fixtures";
const load = (s: string): B[] => (JSON.parse(readFileSync(`${DIR}/bars1m_${s}_2026-08-17_2026-10-16.json`, "utf8")) as number[][]).map(([t, o, h, l, c]) => ({ t: t!, o: o!, h: h!, l: l!, c: c! }));
const BARS: Record<string, B[]> = { ES: load("ES"), NQ: load("NQ") };
const agg = (b: B[], ms: number) => { const o: B[] = []; for (const x of b) { const k = Math.floor(x.t / ms) * ms; const L = o[o.length - 1]; if (L && L.t === k) { L.h = Math.max(L.h, x.h); L.l = Math.min(L.l, x.l); L.c = x.c; } else o.push({ ...x, t: k }); } return o; };
const B15: Record<string, B[]> = { ES: agg(BARS.ES!, 900_000), NQ: agg(BARS.NQ!, 900_000) };
const B5: Record<string, B[]> = { ES: agg(BARS.ES!, 300_000), NQ: agg(BARS.NQ!, 300_000) };
const ub = (a: B[], t: number) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m]!.t < t) lo = m + 1; else hi = m; } return lo; };
const MONTH = 31 * 86_400_000;
const MODE = (process.env.C16_MODE === "jend" ? "jend" : "jm") as "jm" | "jend";
function view(sym: string, closeT: number) {   // bars CLOSED by closeT
  const o = BARS[sym]!, oth = BARS[sym === "ES" ? "NQ" : "ES"]!;
  const k = ub(o, closeT - 60_000 + 1), ko = ub(oth, closeT - 60_000 + 1);
  const b15 = B15[sym]!, b5 = B5[sym]!;
  return { own1m: o.slice(Math.max(0, k - 480), k), other1m: oth.slice(Math.max(0, ko - 480), ko),
    own15m: b15.slice(ub(b15, closeT - MONTH), ub(b15, closeT - 900_000 + 1)), own5m: b5.slice(ub(b5, closeT - MONTH), ub(b5, closeT - 300_000 + 1)) };
}
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
const todF = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour12: false, hour: "2-digit", minute: "2-digit" });
const tod = (ms: number) => { const [h, m] = todF.format(ms).split(":").map(Number); return (h! % 24) * 60 + m!; };
export interface LiveRead { t: number; tDecide: number; sym: string; side: "long" | "short"; S2: number; gbmP: number; fire: boolean; feat: Record<string, number | null>; plan: { entry: number; stop: number; edge: number }; missing: string[]; setupId: string }
export function liveReadsAt(sym: string, closeT: number): LiveRead[] {
  const v = view(sym, closeT); const out: LiveRead[] = [];
  const cands = researchCandidates({ own1m: v.own1m, own15m: v.own15m, own5m: v.own5m, sym, mode: MODE });
  for (const c of cands) {
    const nxt = BARS[sym]![ub(BARS[sym]!, c.tDecide + 60_000)]; const price = nxt && nxt.t === c.tDecide + 60_000 ? nxt.o : c.px;   // live price = open of the bar after the decision close
    const ci = candInputs(c, price);
    const bf = barFeatures({ own1m: v.own1m, other1m: v.other1m, own15m: v.own15m, own5m: v.own5m, tMs: c.t, side: c.side });
    const cf = candFeatures({ own1m: v.own1m, other1m: v.other1m, own15m: v.own15m, tMs: c.t, side: c.side, tRaidMs: c.tRaid, price, edge: c.edge, stop: c.stop });
    const g: Record<string, number | null> = { b1: cf.b1, b4: cf.b4, pd: c.pd, wtmax: c.wtmax, smt: cf.smt == null ? null : cf.smt ? 1 : 0, nk: c.nk, disp: c.disp, mss: c.mss ? 1 : 0, ifvg: c.ifvg ? 1 : 0,
      arr_ifvg: c.arr_ifvg, eqhit: c.eqhit, n_arr: c.n_arr, tmin: c.tmin, chaseR: ci.chaseR, risk_atr: ci.risk_atr, sw_with: bf.sw_with, smt_with: bf.smt_with, fail3_with: bf.fail3_with,
      mss5_with: bf.mss5_with, tr1h_with: bf.tr1h_with, tr4h_with: bf.tr4h_with, pdpos_with: bf.pdpos_with, compress: bf.compress, rng30: bf.rng30, since_disp: bf.since_disp, atrpct: bf.atrpct, dow: c.dow };
    const v2 = { tr4h_with: bf.tr4h_with, atrpct: bf.atrpct, pd: c.pd, wtmax: c.wtmax, nk: c.nk, smt: cf.smt, disp: c.disp, mss: c.mss, ifvg: c.ifvg, risk_atr: ci.risk_atr, chaseR: ci.chaseR, arr_ifvg: c.arr_ifvg, tmin: c.tmin, rng30: bf.rng30 };
    const S2 = armsS2(v2 as never).S2, gp = armsGbmP(g);
    const f = armFire("config1_trail", S2, gp, false);
    const missing = ARMS_GBM_FEATURES.filter((k) => g[k] == null || !Number.isFinite(g[k] as number));
    out.push({ t: c.t, tDecide: c.tDecide, sym, side: c.side, S2, gbmP: gp, fire: f.fire, feat: g, plan: { entry: price, stop: c.stop, edge: c.edge }, missing, setupId: `${fmt.format(c.t)}:${sym}:${c.side}:${c.lv}:${c.tRaid}` });
  }
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const outP = process.argv[2] ?? "docs/combo1016/live_replay_config1.json";
  const days = [...new Set(BARS.ES!.map((b) => fmt.format(b.t)))].filter((d) => d >= "2026-08-18");
  const reads: LiveRead[] = [];
  for (const sym of ["ES", "NQ"]) for (const b of BARS[sym]!) {
    const m = tod(b.t); if (m < 480 || m > 890) continue; if (fmt.format(b.t) < "2026-08-18") continue;
    reads.push(...liveReadsAt(sym, b.t + 60_000));
  }
  writeFileSync(outP, JSON.stringify({ days, reads }, null, 0));
  const fires = reads.filter((r) => r.fire);
  console.log(`candidates ${reads.length}, config1 fires ${fires.length}, reads with any missing GBM input ${reads.filter((r) => r.missing.length).length}`);
}
