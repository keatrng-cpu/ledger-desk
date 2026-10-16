/** combo1016 arms (SMC pnl-push finalists, shadow). Parity per arm vs research output (scripts/fixtures/build_combo1016_arms.py). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const RULES = (await import("../shared/desk-rules.json", { with: { type: "json" } })).default;
const A = await import("../src/lib/smc/combo1016-arms.ts");
const FX = JSON.parse(readFileSync(new URL("./fixtures/combo1016-arms-parity.json", import.meta.url)));
const MODE = { config1_trail: "TR", config2_e75: "E75", config3_e75_s65: "E75", config2_e75_tier200_400: "E75" };

test("rules: arms shadow; S2 70/70/65/70; caps 5/3/1 open, halt 1, flat 14:55; A+ 85; sizing fixed $/R; refit 26w doc only; existing combo1016 untouched", () => {
  const b = RULES.combo1016Arms;
  assert.equal(b.mode, "shadow"); assert.equal(b.gbm.refitWeeks, 26); assert.equal(b.gbm.liveRefit, false);
  assert.deepEqual(Object.keys(b.arms), ["config1_trail", "config2_e75", "config3_e75_s65", "config2_e75_tier200_400"]);
  assert.deepEqual(Object.values(b.arms).map((a) => a.fireS2), [70, 70, 65, 70]);
  assert.deepEqual([b.caps.perDay, b.caps.perSymbol, b.caps.openPerSymbol, b.caps.haltAfterLosses, b.caps.flatByCt], [5, 3, 1, 1, "14:55"]);
  assert.deepEqual([b.entry.marketWithinR, b.entry.limitValidMin, b.entry.cancelAtR], [1, 20, 0.75]); assert.equal(b.aPlusS2, 85);
  assert.deepEqual(Object.values(b.arms).map((a) => [a.sizing.baseUsdPerR, a.sizing.aPlusUsdPerR]), [[250, 500], [300, 300], [250, 500], [200, 400]]);
  assert.equal(RULES.combo1016.fireS2, 75); assert.deepEqual([RULES.combo1016.caps.perDay, RULES.combo1016.caps.perSymbol], [3, 2]);
  assert.equal(RULES.brainPd.mode, "shadow"); assert.ok(RULES.brainPd.nudgeMax <= 0.1);
  for (const k of ["hours", "s2Variants", "gbmTop20", "dayLoss2", "openingDrive"]) assert.ok(!(k in b), k);
  assert.ok(!JSON.stringify(b).match(/percent|pctOfAccount/i) || /never a percent/.test(b._doc));
});

for (const k of ["config1_trail", "config2_e75", "config3_e75_s65", "config2_e75_tier200_400"]) test(`parity ${k}: VAL selection + R + $/wk == research`, () => {
  const S = FX.select, m = MODE[k];
  const rows = S.day.map((d, i) => ({ day: d, sym: S.sym[i], fillT: S.fillT[i], exitT: S["exitT_" + m][i], R: S["R_" + m][i], S2: S.S2[i], pgr: S.pgr[i] }));
  const pick = A.armSelect(k, rows); const ref = FX.ref[k];
  assert.deepEqual(pick.map((i) => S.idx2[i]), ref.idx2);
  const R = pick.map((i) => rows[i].R); const a = A.ARMS[k].sizing;
  const usd = pick.reduce((s, i) => s + rows[i].R * (rows[i].S2 >= 85 ? a.aPlusUsdPerR : a.baseUsdPerR), 0) / ref.nweeks;
  assert.ok(Math.abs(R.reduce((s, x) => s + x, 0) - ref.sumR) < 1e-6); assert.ok(Math.abs(usd - ref.usdwk) < 1e-6);
  console.log(`arms parity ${k}: n ${pick.length}/${ref.n}, WR ${(R.filter((x) => x > 0).length / R.length).toFixed(3)}, $/wk ${usd.toFixed(0)} (research ${ref.usdwk.toFixed(0)})`);
});

test("parity exits: TS armExitSim R == research pp2 R (TR for config1_trail, E75 for config2_e75/config3_e75_s65/config2_e75_tier200_400) on 400 sampled bar paths", () => {
  let wT = 0, wE = 0;
  for (const e of FX.exits) {
    const bars = e.h.map((h, i) => ({ h, l: e.l[i], c: e.c[i] }));
    wT = Math.max(wT, Math.abs(A.armExitSim("config1_trail", bars, e.side, e.entry, e.risk).R - e.R_TR));
    wE = Math.max(wE, Math.abs(A.armExitSim("config2_e75", bars, e.side, e.entry, e.risk).R - e.R_E75));
  }
  console.log(`arms exit parity: max|dR| TR ${wT.toExponential(2)} E75 ${wE.toExponential(2)} (n ${FX.exits.length})`);
  assert.ok(wT < 1e-9 && wE < 1e-9);
});

test("parity option-$: TS optEstimate == research pp4.opt_trade on 150 trades", () => {
  let w = 0, nc = 0;
  for (const o of FX.opt) { const r = A.optEstimate({ ...o, riskUsd: 1000 }); w = Math.max(w, Math.abs(r.pnl / 1000 - o.optR)); nc += r.contracts === o.ncon; }
  console.log(`arms option parity: max|d optR| ${w.toExponential(2)}, contracts ${nc}/${FX.opt.length}`);
  assert.ok(w < 1e-6); assert.equal(nc, FX.opt.length);
});

test("plan: market/limit hybrid, limit 20 min + cancel at +0.75R, legs per arm", () => {
  const m = A.armPlan("config1_trail", { side: "long", price: 100.5, edge: 100, stop: 98 });
  assert.equal(m.kind, "market"); assert.deepEqual(m.legs.map((l) => [l.frac, l.R]), [[0.5, 1]]); assert.equal(m.trailR, 1);
  // research chaseR = |price − edge| / |price − stop| (market-anchor risk): 1.2/0.8 = 1.5 > 1 → limit at the edge
  assert.equal(A.armPlan("config2_e75", { side: "long", price: 103, edge: 100, stop: 98 }).kind, "market");
  const l = A.armPlan("config2_e75", { side: "long", price: 98.8, edge: 100, stop: 98 }); assert.equal(l.chaseR, 1.5);
  assert.equal(l.kind, "limit"); assert.equal(l.limitValidMin, 20); assert.equal(l.cancelPx, 101.5); assert.deepEqual(l.legs.map((x) => [x.frac, x.R, x.px]), [[0.5, 0.75, 101.5], [0.5, 2, 104]]);
  assert.equal(A.armFire("config3_e75_s65", 66, 0.7).fire, true); assert.equal(A.armFire("config2_e75", 66, 0.7).fire, false);
  assert.equal(A.armFire("config1_trail", 90, 0.7).usdPerR, 500); assert.equal(A.armFire("config2_e75", 90, 0.7).usdPerR, 300); assert.equal(A.armFire("config1_trail", 90, 0.7, true).fire, false);
});

test("ledger: caps 5/3, 1 open per symbol, halt after first loss, new setup id only", () => {
  const p = (e) => A.armPlan("config2_e75", { side: "long", price: e, edge: e, stop: e - 2 });
  const d = { day: "x", entries: [] };
  const a = A.armAdmit("config2_e75", d, "MNQ", "A", p(100), "long", 300, 1); assert.ok(a.ok); d.entries.push(a.sealed);
  assert.match(A.armAdmit("config2_e75", d, "MNQ", "B", p(101), "long", 300, 2).why, /already has 1 open/);
  assert.match(A.armAdmit("config2_e75", d, "MNQ", "A", p(101), "long", 300, 2).why, /already sealed/);
  a.sealed.open = false; a.sealed.result = "win";
  for (const id of ["B", "C"]) { const v = A.armAdmit("config2_e75", d, "MNQ", id, p(100), "long", 300, 3); assert.ok(v.ok); v.sealed.open = false; v.sealed.result = "be"; d.entries.push(v.sealed); }
  assert.match(A.armAdmit("config2_e75", d, "MNQ", "D", p(100), "long", 300, 4).why, /MNQ cap 3\/3/);
  for (const id of ["E", "F"]) { const v = A.armAdmit("config2_e75", d, "ES", id, p(50), "long", 300, 5); assert.ok(v.ok); v.sealed.open = false; v.sealed.result = "win"; d.entries.push(v.sealed); }
  assert.match(A.armAdmit("config2_e75", d, "ES", "G", p(50), "long", 300, 6).why, /day cap 5\/5/);
  assert.match(A.armAdmit("config2_e75", { day: "y", entries: [{ ...a.sealed, result: "loss" }] }, "ES", "H", p(50), "long", 300, 7).why, /halted/);
});

test("card + seats: rows shadow:combo1016:<arm>, partial label kept, existing combo1016 line unchanged, read-only block", async () => {
  const G = JSON.parse(readFileSync(new URL("./fixtures/combo1016-arms-golden.json", import.meta.url)));
  const gf = G.fixtures.find((f) => f.configs.config1_trail.fires && f.configs.config3_e75_s65.fires && f.S2 >= 85) ?? G.fixtures.find((f) => f.configs.config1_trail.fires);
  const x = gf.features, nb = (v) => (v == null ? null : Boolean(v));
  const v2 = { tr4h_with: x.tr4h_with, atrpct: x.atrpct, pd: x.pd, wtmax: x.wtmax, nk: x.nk, smt: nb(x.smt), disp: x.disp, mss: nb(x.mss), ifvg: nb(x.ifvg), risk_atr: x.risk_atr, chaseR: x.chaseR, arr_ifvg: x.arr_ifvg, tmin: x.tmin, rng30: x.rng30 };
  const r = A.armsCardRead({ v2, gbm: x, vetoed: false, partial: "partial: 3/14 S2 filled, 11/27 GBM missing", side: "long", symbol: "MNQ", price: 20000, edge: 19999, stop: 19990, a5: 12, minuteCt: 600 });
  assert.deepEqual(r.map((x) => x.row.split(" ").slice(0, 2).join(" ")), ["config1_trail", "config2_e75", "config3_e75_s65", "config2_e75_tier200_400"].map((k) => `${k === "config1_trail" ? "live" : "shadow"}:combo1016:${k} would_fire_partial`));
  assert.equal(A.armSetupId("MNQ", "short", 30100.25, Date.UTC(2026, 9, 16, 15)), "2026-10-16:NQ:short:30100.25");
  assert.ok(r.every((x) => x.opt && x.opt.etf === "QQQ" && x.plan.legs.length >= 1));
  const D = await import("../src/lib/trading/desk-listen.ts");
  const s = D.combo1016ArmsSeatNote({ arms: { mode: "shadow", reads: r, pd: { pd_cur: -0.5, pd_ent: 0.5 } } });
  assert.match(s, new RegExp(`live:combo1016:config1_trail would_fire_partial market 20000 \\$${gf.S2 >= 85 ? 500 : 250}/R`));
  assert.ok(Math.abs(r[0].S2 - Math.round(gf.S2 * 10) / 10) < 1e-9); assert.match(s, /pd_cur -0.5 pd_ent 0.5 \(shadow\)/);
  const src = readFileSync(new URL("../src/lib/trading/build-desk.ts", import.meta.url), "utf8");
  const a = src.indexOf("// combo1016 arms (shadow)"); const b = src.indexOf("cb.arms = { error");
  assert.ok(a > 0 && b > a); assert.ok(!/qWrite|sealBand|pathBand\s*=|c\.plan\s*=|entryPx\s*=|confluence\s*=|sizeMult\s*=/.test(src.slice(a, b)));
  assert.equal((readFileSync(new URL("../src/lib/trading/desk-listen.ts", import.meta.url), "utf8").match(/combo1016ArmsSeat: combo1016ArmsSeatNote/g) ?? []).length, 2);
});

test("brainPd: shadow-only and non-gating (legacy step 8 kept, nudge ≤ +0.1, never negative, never a reason)", async () => {
  const B = await import("../src/lib/smc/seq/brain-pd.ts");
  assert.equal(B.brainPdLive(), false);
  for (const v of [0.5, -0.25, -0.5, null]) { const n = B.brainPdNudge(v); assert.equal(n.applied, 0); assert.ok(n.nudge >= 0 && n.nudge <= 0.1); }
  assert.equal(B.brainPdNudge(0.5, "live").applied, 0.1); assert.equal(B.brainPdNudge(-0.5, "live").applied, 0);
  const src = readFileSync(new URL("../src/lib/trading/veteran-brain.ts", import.meta.url), "utf8");
  assert.ok(src.includes("if (rawBest && bias.left.dealing && !brainPdLive()) {"));
  assert.ok(src.includes("if (brainPdLive() && pdGrade) score += pdGrade.applied;"));
  const blk = src.slice(src.indexOf("// 8') brainPd"), src.indexOf("// 8b) Canon stack"));
  assert.ok(!/yellow\.push|green\.push|vetoes\.push|verdict\s*=/.test(blk));
  assert.ok(src.includes("own = rawBest.symbol === bias.right.symbol ? \"right\" : \"left\""));
});

test("config1 LIVE contracts: desk optEstimate == SMC pp4 opt_trade on all 1177 config1 VAL trades ($250 base / $500 A+ per R), strike and $", async () => {
  const { readFileSync } = await import("node:fs");
  const T = JSON.parse(readFileSync(new URL("./fixtures/combo1016-live-ref.json", import.meta.url))).trades;
  let n = 0, nc = 0, nk = 0, w = 0;
  for (const t of T) {
    if (t.n == null) continue; n++;
    const r = A.optEstimate({ sym: t.sym, side: t.side, entry: t.entry, risk: t.risk, a5: t.a5, fillMinCt: t.fill_tod, legs: t.legs.map(([frac, px, dm]) => ({ frac, px, dm })), riskUsd: A.armFire("config1_trail", t.S2, 0.99).usdPerR });
    nc += r.contracts === t.n; nk += r.strike === t.K; w = Math.max(w, Math.abs(r.pnl - t.pnl));
  }
  console.log(`# config1 trades ${n}: contracts ${nc}/${n}, strike ${nk}/${n}, max |d option $| ${w.toExponential(2)}`);
  assert.equal(n, 1177); assert.equal(nc, n); assert.equal(nk, n); assert.ok(w < 1e-6);
  assert.equal(A.ARMS_LIVE.mode, "live"); assert.equal(A.ARMS_LIVE.arm, "config1_trail"); assert.ok(A.isLiveArm("config1_trail") && !A.isLiveArm("config2_e75"));
});
