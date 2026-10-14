/** F2 scenarios, F3 respect, F7 odds, F8 calibration — walk-forward on the Yahoo tape (first 75% train, last 25% holdout). */
import { readFileSync, writeFileSync } from "node:fs";
import { premarketMap } from "../src/lib/smc/seq/premarket-map";
import { sessionKeyOf } from "../src/lib/smc/smc-unity";
import { etOf, setSeqOverrides } from "../src/lib/smc/seq/rules";
import { scenarios, realised, features, fitLr, SCRIPTS } from "../src/lib/smc/seq/scenarios";
import { respectRead } from "../src/lib/smc/seq/respect";
import { isotonic, pOf, edgeR } from "../src/lib/smc/seq/calibrate";
type B = { t: number; o: number; h: number; l: number; c: number; v: number };
const load = (s: string): B[] => (JSON.parse(readFileSync(`/workspace/audits/seq-data/yahoo-1m-${s}.json`, "utf8")) as B[]).filter((b) => b.t % 60_000 === 0);
const TAPE: Record<string, B[]> = { MNQ: load("MNQ"), ES: load("ES") };
const at = (k: string, hm: number) => { const g = Date.parse(`${k}T00:00:00Z`) + (hm + 240) * 60_000; return g - (etOf(g).hm - hm) * 60_000; };
const days = (() => { const ks = new Map<string, number>(); for (const b of TAPE.MNQ!) { const e = etOf(b.t); if (e.hm >= 570 && e.hm < 660 && e.wd >= 1 && e.wd <= 5) ks.set(sessionKeyOf(b.t), (ks.get(sessionKeyOf(b.t)) ?? 0) + 1); } return [...ks].filter(([, n]) => n >= 80).map(([k]) => k).sort().slice(1); })();
const cutI = Math.floor(days.length * 0.75); const train = new Set(days.slice(0, cutI));
const rows: { sym: string; day: string; feats: string[]; y: string | null; top2: string[]; priors: Record<string, number>; resp: { t: string; net: number; stronger: string | null; next30: "up" | "down" }[] }[] = [];
for (const sym of ["MNQ", "ES"]) for (const day of days) {
  const m = TAPE[sym]!; const cut = at(day, 9 * 60 + 26);
  const map = premarketMap({ symbol: sym, minute: m.filter((b) => b.t + 60_000 <= cut && b.t > cut - 12 * 86_400_000), nowMs: cut });
  const rth = m.filter((b) => b.t >= at(day, 570) && b.t < at(day, 660));
  if (rth.length < 60 || !map.levels.length) continue;
  const sc = scenarios(map);
  const resp: (typeof rows)[number]["resp"] = [];
  for (const hm of [600, 630, 660, 690]) {
    const T = at(day, hm); const bars = m.filter((b) => b.t > cut - 6 * 3_600_000 && b.t < T);
    const r = respectRead(sym, map, bars, T); const now = bars.at(-1); const later = m.filter((b) => b.t >= T && b.t < T + 30 * 60_000).at(-1);
    if (now && later) resp.push({ t: `${Math.floor(hm / 60)}:${String(hm % 60).padStart(2, "0")}`, net: r.tiers.all.net, stronger: r.tiers.all.stronger, next30: later.c >= now.c ? "up" : "down" });
  }
  rows.push({ sym, day, feats: features(map), y: realised(rth), top2: sc.ranked.slice(0, 2).map((s) => s.id), priors: Object.fromEntries(sc.ranked.map((s) => [s.id, s.prior])), resp });
}
const R: Record<string, unknown> = { source: "yahoo 1m NQ=F/ES=F", sessions: days.length, train: [...train], holdout: days.slice(cutI) };
// F2
const f2 = (xs: typeof rows) => ({ n: xs.length, top2Hit: +(xs.filter((r) => r.y && r.top2.includes(r.y)).length / Math.max(1, xs.length)).toFixed(3), top1Hit: +(xs.filter((r) => r.y === r.top2[0]).length / Math.max(1, xs.length)).toFixed(3) });
R.F2 = { all: f2(rows), holdout: f2(rows.filter((r) => !train.has(r.day))), realisedMix: Object.fromEntries(SCRIPTS.map((s) => [s, rows.filter((r) => r.y === s).length])) };
// F3
const ev = rows.flatMap((r) => r.resp.filter((x) => x.stronger).map((x) => ({ ...x, day: r.day, ok: (x.stronger === "bull") === (x.next30 === "up") })));
R.F3 = { signals: ev.length, hit: +(ev.filter((e) => e.ok).length / Math.max(1, ev.length)).toFixed(3), holdoutSignals: ev.filter((e) => !train.has(e.day)).length, holdoutHit: +(ev.filter((e) => !train.has(e.day) && e.ok).length / Math.max(1, ev.filter((e) => !train.has(e.day)).length)).toFixed(3) };
// F7: fit LRs on train, Brier on holdout vs the heuristic prior and vs the train base rate
const tr = rows.filter((r) => train.has(r.day) && r.y) as { feats: string[]; y: (typeof SCRIPTS)[number] }[];
const lr = fitLr(tr);
const base = Object.fromEntries(SCRIPTS.map((s) => [s, (tr.filter((r) => r.y === s).length + 1) / (tr.length + 4)]));
const brier = (p: Record<string, number>, y: string) => SCRIPTS.reduce((a, s) => a + (p[s]! - (s === y ? 1 : 0)) ** 2, 0);
const post = (feats: string[]) => { const w = Object.fromEntries(SCRIPTS.map((s) => [s, base[s]! * feats.reduce((a, f) => a * (lr[f]?.[s] ?? 1), 1)])); const t = SCRIPTS.reduce((a, s) => a + w[s]!, 0); return Object.fromEntries(SCRIPTS.map((s) => [s, w[s]! / t])); };
const ho = rows.filter((r) => !train.has(r.day) && r.y);
const avg = (f: (r: (typeof rows)[number]) => number) => +(ho.reduce((a, r) => a + f(r), 0) / Math.max(1, ho.length)).toFixed(3);
R.F7 = { holdoutN: ho.length, brierOdds: avg((r) => brier(post(r.feats), r.y!)), brierHeuristicPrior: avg((r) => brier(r.priors, r.y!)), brierBaseRate: avg((r) => brier(base, r.y!)), brierUniform: avg((r) => brier(Object.fromEntries(SCRIPTS.map((s) => [s, 0.25])), r.y!)) };
// F8: calibrate AMD trades (score = T1 R:R) on train, check holdout: P≥0.65 bucket realised + minEdgeR gate
const bt = JSON.parse(readFileSync(process.argv[2] ?? "/workspace/audits/seq-data/bt-final.json", "utf8")) as { amdTrades: { day: string; r: number | null; target: number; entry: number; stop: number; "opt$": number | null }[] };
const tt = bt.amdTrades.filter((t) => t.r != null).map((t) => ({ ...t, rr: Math.abs(t.target - t.entry) / Math.abs(t.entry - t.stop), win: t.r! > 0 ? 1 : 0 }));
const tab = isotonic(tt.filter((t) => train.has(t.day)).map((t) => ({ x: t.rr, y: t.win })));
const hoT = tt.filter((t) => !train.has(t.day)).map((t) => ({ ...t, p: pOf(tab, t.rr)! })).map((t) => ({ ...t, e: edgeR(t.p, t.rr) }));
const kept = hoT.filter((t) => t.e >= 0.1);
const k = (xs: typeof hoT) => ({ n: xs.length, win: +(xs.filter((t) => t.win).length / Math.max(1, xs.length)).toFixed(3), avgR: +(xs.reduce((a, t) => a + t.r!, 0) / Math.max(1, xs.length)).toFixed(3), dollars: xs.reduce((a, t) => a + (t["opt$"] ?? 0), 0) });
R.F8 = { table: tab, holdoutAll: k(hoT), holdoutKeptByMinEdge0_1: k(kept), holdoutP65: k(hoT.filter((t) => t.p >= 0.65)), weeksHoldout: +(days.slice(cutI).length / 5).toFixed(1) };
console.log(JSON.stringify(R, (key, v) => (key === "train" || key === "holdout" && Array.isArray(v) ? undefined : v), 1));
writeFileSync("/workspace/audits/seq-data/eval-f2378.json", JSON.stringify(R, null, 1));
setSeqOverrides(null);
