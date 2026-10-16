/** combo1016 card inputs from closed desk bars (combo1016-feat.ts) — minute-by-minute parity with SMC's research proxy (score-rebuild/ev/feat.py),
 *  end-to-end S2/gbmP on research candidates, and the arms models vs SMC's integration golden decisions. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const F = await import("../src/lib/smc/combo1016-feat.ts");
const C = await import("../src/lib/smc/combo1016.ts");
const A = await import("../src/lib/smc/combo1016-arms.ts");
const FX = JSON.parse(readFileSync(new URL("./fixtures/combo1016-feat-parity.json", import.meta.url)));
const G = JSON.parse(readFileSync(new URL("./fixtures/combo1016-arms-golden.json", import.meta.url)));
const toB = (x) => x.t.map((t, i) => ({ t, o: x.o[i], h: x.h[i], l: x.l[i], c: x.c[i] }));
const K = ["sw_with", "smt_with", "fail3_with", "mss5_with", "tr1h_with", "tr4h_with", "pdpos_with", "compress", "rng30", "since_disp", "atrpct"];
const KEEP = 480 * 60000;   // the desk keeps 480 1m bars
const deskView = (d, t) => ({ own1m: d.own.filter((b) => b.t < t && b.t >= t - KEEP), other1m: d.oth.filter((b) => b.t < t && b.t >= t - KEEP), own15m: d.b15.filter((b) => b.t + 900000 <= t) });
const DAYS = FX.map((d) => ({ ...d, own: toB(d.own1m), oth: toB(d.oth1m), b15: toB(d.own15m) }));
const near = (a, b) => a != null && b != null && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

test("feature parity, minute by minute 08:30-14:59 CT on 10 historical days x ES/NQ x both sides (incl. 3 DST-switch days)", () => {
  const st = Object.fromEntries(K.map((k) => [k, { n: 0, ok: 0, nul: 0, wrong: 0 }]));
  for (const d of DAYS) {
    const idx = new Map(d.rows.t.map((t, i) => [t, i]));
    for (let t = d.rows.t[0]; t < d.rows.t.at(-1) + 300000; t += 60000) {
      const i = idx.get(Math.floor(t / 300000) * 300000); if (i == null) continue;
      for (const side of ["short", "long"]) {
        const f = F.barFeatures({ ...deskView(d, t), tMs: t, side });
        for (const k of K) { const s = st[k]; s.n++; const v = f[k], r = d.rows[side][k][i]; if (v == null) s.nul++; else if (near(v, r)) s.ok++; else s.wrong++; }
      }
    }
  }
  console.log("feature | minutes | exact | missing (null) | WRONG");
  for (const k of K) console.log(`${k} | ${st[k].n} | ${st[k].ok} (${(100 * st[k].ok / st[k].n).toFixed(2)}%) | ${st[k].nul} | ${st[k].wrong}`);
  for (const k of K) assert.equal(st[k].wrong, 0, `${k}: a value was produced that differs from research`);
  for (const k of K.filter((k) => !["since_disp", "atrpct"].includes(k))) assert.equal(st[k].ok, st[k].n, k);
  assert.ok(st.since_disp.ok / st.since_disp.n > 0.95); assert.equal(st.atrpct.nul, st.atrpct.n);
});

test("no lookahead: features at t are unchanged when every bar at/after floor(t,5m) is perturbed", () => {
  const d = DAYS[3]; let n = 0;
  for (let t = d.rows.t[10]; t < d.rows.t[60]; t += 7 * 60000) {
    const v = deskView(d, t), t5 = Math.floor(t / 300000) * 300000;
    const bump = (bs) => bs.map((b) => (b.t >= t5 ? { ...b, h: b.h + 50, l: b.l - 50, c: b.c + 7 } : b));
    for (const side of ["short", "long"]) {
      const a = F.barFeatures({ ...v, tMs: t, side }), b = F.barFeatures({ own1m: bump(v.own1m), other1m: bump(v.other1m), own15m: bump(v.own15m), tMs: t, side });
      for (const k of K) assert.equal(a[k], b[k], `${k} @${t}`); n++;
    }
  }
  assert.ok(n > 10);
});

test("end to end: research candidates on the same days — S2 (v2 IS) and gbmP (IS GBM) with desk-computed bar features == research", () => {
  let n = 0, wS = 0, wG = 0, fireOk = 0, fires = 0;
  for (const d of DAYS) for (const c of d.cands) {
    const bf = F.barFeatures({ ...deskView(d, c.t), tMs: c.t, side: c.side });
    if (bf.since_disp == null) continue;   // censored since_disp is reported, not compared
    const x = { ...c.x }; for (const k of K) if (k !== "atrpct") x[k] = bf[k];
    const raw = { ...c.raw, tr4h_with: bf.tr4h_with, rng30: bf.rng30 };
    for (const k of K) if (k !== "atrpct") assert.ok(near(bf[k], c.x[k]), `${d.day} ${d.sym} ${c.t} ${k} ${bf[k]} vs ${c.x[k]}`);
    const gp = C.gbmP(x), S = C.scoreV2(raw).S2, Sr = C.scoreV2(c.raw).S2;
    wG = Math.max(wG, Math.abs(gp - c.pg)); wS = Math.max(wS, Math.abs(S - Sr));
    const f1 = S >= 75 && gp >= C.GBM_THR, f0 = Sr >= 75 && c.pg >= C.GBM_THR; fireOk += f1 === f0; fires += f0; n++;
  }
  console.log(`end-to-end: ${n} candidates, max|dS2| ${wS.toExponential(2)}, max|dgbmP| ${wG.toExponential(2)}, combo1016 fire match ${fireOk}/${n} (${fires} fires)`);
  assert.ok(n > 50); assert.ok(wS < 1e-9 && wG < 1e-9); assert.equal(fireOk, n);
});

test("arms models == SMC integration golden decisions (walk-forward S2 + GBM, q90, per-config fire)", () => {
  let wS = 0, wG = 0, ok = 0, n = 0;
  assert.equal(A.ARMS_THR, G.fixtures[0].gbm_q90);
  for (const f of G.fixtures) {
    const x = f.features, nb = (v) => (v == null ? null : Boolean(v));
    const v2 = { tr4h_with: x.tr4h_with, atrpct: x.atrpct, pd: x.pd, wtmax: x.wtmax, nk: x.nk, smt: nb(x.smt), disp: x.disp, mss: nb(x.mss), ifvg: nb(x.ifvg), risk_atr: x.risk_atr, chaseR: x.chaseR, arr_ifvg: x.arr_ifvg, tmin: x.tmin, rng30: x.rng30 };
    const s = A.armsS2(v2).S2, g = A.armsGbmP(x); wS = Math.max(wS, Math.abs(s - f.S2)); wG = Math.max(wG, Math.abs(g - f.gbm_p));
    for (const [k, cfg] of [["config1_trail", "config1_trail"], ["config2_e75", "config2_e75"], ["config3_e75_s65", "config3_e75_s65"]]) { n++; ok += A.armFire(k, s, g).fire === f.configs[cfg].fires; }
    assert.equal(A.armFire("config1_trail", s, g).usdPerR === 500, f.tier === "A+" && A.armFire("config1_trail", s, g).fire);
  }
  console.log(`arms golden: ${G.fixtures.length} decisions, max|dS2| ${wS.toExponential(2)}, max|dgbmP| ${wG.toExponential(2)}, config fire match ${ok}/${n}`);
  assert.ok(wS < 1e-9 && wG < 1e-12); assert.equal(ok, n);
});

test("SMC integration minutes_*.json (source of truth): every 1m bar 08:00-14:55 CT, 7 days x ES/NQ — per-feature match table", () => {
  const S = JSON.parse(readFileSync(new URL("./fixtures/combo1016-feat-smc.json", import.meta.url)));
  const KS = ["sw_with", "smt_with", "fail3_with", "mss5_with", "tr1h_with", "tr4h_with", "pdpos_with"], KC = ["rng30", "compress", "since_disp", "atrpct", "atr5", "dow"];
  const st = Object.fromEntries([...KS, ...KC].map((k) => [k, { n: 0, ok: 0, nul: 0, wrong: 0, ex: [] }]));
  const dowOf = (t) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(new Date(t).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short" }));
  for (const f of S) {
    const d = { own: toB(f.own1m), oth: toB(f.oth1m), b15: toB(f.own15m) };
    for (const r of f.minutes) {
      const fs = { short: F.barFeatures({ ...deskView(d, r.t), tMs: r.t, side: "short" }), long: F.barFeatures({ ...deskView(d, r.t), tMs: r.t, side: "long" }) };
      const ctMin = (() => { const [h, m] = new Date(r.t).toLocaleString("en-US", { timeZone: "America/Chicago", hour12: false, hour: "2-digit", minute: "2-digit" }).split(":").map(Number); return (h % 24) * 60 + m; })();
      const cmp = (k, v, e) => { const s = st[k]; s.n++; if (v == null) s.nul++; else if (near(v, e)) s.ok++; else if (ctMin < 510 && (k === "sw_with" || k === "pdpos_with")) { s.pre830 = (s.pre830 ?? 0) + 1; } else { s.wrong++; if (s.ex.length < 3) s.ex.push(`${f.src} ${new Date(r.t).toISOString()} ts ${v} smc ${e}`); } };
      for (const side of ["short", "long"]) for (const k of KS) cmp(k, fs[side][k], r[side][k]);
      for (const k of ["rng30", "compress", "since_disp", "atrpct"]) cmp(k, fs.short[k], r[k]);
      cmp("atr5", fs.short.atr5, r.atr5); cmp("dow", dowOf(r.t), r.dow);
    }
  }
  // research onh/onl take the WHOLE overnight of the session day (bars up to 08:29 CT) at every row: before 08:30 that is lookahead in the research proxy;
  // the desk uses closed bars only, so sw_with/pdpos_with can differ 08:00-08:29 CT (counted as pre0830, never accepted after 08:30)
  console.log("SMC minutes | feature | compared | exact | missing (null) | differs 08:00-08:29 (research lookahead) | WRONG");
  for (const [k, s] of Object.entries(st)) console.log(`SMC minutes | ${k} | ${s.n} | ${s.ok} (${(100 * s.ok / s.n).toFixed(2)}%) | ${s.nul} | ${s.pre830 ?? 0} | ${s.wrong} ${s.ex.join(" | ")}`);
  for (const [k, s] of Object.entries(st)) if (!["atrpct"].includes(k)) assert.equal(s.wrong, 0, `${k}: ${s.ex.join(" | ")}`);
  for (const k of [...KS, "rng30", "compress", "atr5", "dow"]) assert.equal(st[k].ok + (st[k].pre830 ?? 0), st[k].n, k);
});

test("candidate-level parity (eng.py/score.py): b1, b4, pd, smt, chaseR, tmin on every research candidate of the 10 days, from the desk's bar view", () => {
  const CP = JSON.parse(readFileSync(new URL("./fixtures/combo1016-cand-parity.json", import.meta.url)));
  const byDay = new Map(DAYS.map((d) => [`${d.day}:${d.sym}`, d]));
  const st = Object.fromEntries(["b1", "b4", "pd", "smt", "chaseR", "tmin"].map((k) => [k, { n: 0, ok: 0, nul: 0, wrong: 0, ex: [] }]));
  for (const c of CP) {
    const d = byDay.get(`${c.day}:${c.sym}`); const v = deskView(d, c.t + 60000);
    const f = F.candFeatures({ ...v, tMs: c.t, side: c.side, tRaidMs: c.traid, price: c.price, edge: c.edge, stop: c.stop });
    for (const k of Object.keys(st)) {
      const r = c.ref[k], x = f[k]; const s = st[k]; if (r == null) continue; s.n++;
      if (x == null) { s.nul++; continue; }
      const ok = typeof r === "boolean" ? x === r : near(x, r);
      if (ok) s.ok++; else { s.wrong++; if (s.ex.length < 3) s.ex.push(`${c.sym} ${new Date(c.t).toISOString()} ${c.side} desk=${x} ref=${r}`); }
    }
  }
  console.log("# feature | n | match | null | wrong");
  for (const [k, s] of Object.entries(st)) console.log(`# ${k} | ${s.n} | ${s.ok} (${((100 * s.ok) / s.n).toFixed(2)}%) | ${s.nul} | ${s.wrong}${s.ex.length ? " e.g. " + s.ex.join(" ; ") : ""}`);
  for (const [k, s] of Object.entries(st)) assert.equal(s.wrong, 0, `${k} wrong ${s.wrong}: ${s.ex.join(" ; ")}`);
});
