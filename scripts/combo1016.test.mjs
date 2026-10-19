/** combo1016 — SMC research best combo (shadow). Parity with the Python research on the same 553 candidates as the v1 parity test. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const RULES = (await import("../shared/desk-rules.json", { with: { type: "json" } })).default;
const C = await import("../src/lib/smc/combo1016.ts");
const FIX = JSON.parse(readFileSync(new URL("./fixtures/combo1016-parity.json", import.meta.url)));
const V1 = JSON.parse(readFileSync(new URL("./fixtures/score1016-parity.json", import.meta.url)));
const rawOf = (r) => ({ ...r.raw });

test("rules: combo1016 + score1016.v2 ship shadow; fire S2>=75, A+ 90 no sizing; caps 3/2 halt 1; gbm sha matches the shipped model", async () => {
  const b = RULES.combo1016;
  assert.equal(b.mode, "shadow"); assert.equal(RULES.score1016.v2.mode, "shadow");
  for (const k of ["entry", "exit", "caps", "rearm"]) assert.equal(b[k].mode, "shadow", k);
  assert.equal(b.fireS2, 75); assert.equal(b.aPlusS2, 90); assert.equal(b.aPlusSizing, false);
  assert.deepEqual([b.caps.perDay, b.caps.perSymbol, b.caps.haltAfterLosses], [3, 2, 1]);
  assert.equal(b.rearm.repriceSealed, false);
  const { createHash } = await import("node:crypto");
  assert.equal(createHash("sha256").update(readFileSync(new URL("../shared/combo1016-gbm.json", import.meta.url))).digest("hex").slice(0, 16), b.gbm.sha256_16);
  assert.equal(C.GBM_THR, FIX.thr);
  assert.ok(RULES.score1016.v2.coef.ctx_pd > 0 && RULES.score1016.v2.coef.ifvg > 0);   // L1 PD (as 1-pd) and L3 iFVG signs as fit
});

test("parity: the 553 candidates are exactly the v1 parity set", () => {
  assert.equal(FIX.rows.length, 553); assert.equal(V1.length, 553);
  for (let k = 0; k < 553; k++) assert.deepEqual([FIX.rows[k].t, FIX.rows[k].sym, FIX.rows[k].side], [V1[k].t, V1[k].sym, V1[k].side]);
});

test("parity: TS S2 / p / gbmP == Python research on 553 candidates; fire decision matches on all", () => {
  let wS = 0, wP = 0, wG = 0, fires = 0, aplus = 0;
  for (const r of FIX.rows) {
    const s = C.scoreV2(rawOf(r)); const g = C.gbmP(r.x);
    wS = Math.max(wS, Math.abs(s.S2 - r.S2)); wP = Math.max(wP, Math.abs(s.p - r.p)); wG = Math.max(wG, Math.abs(g - r.gbmP));
    const fire = s.S2 >= 75 && g >= C.GBM_THR;
    assert.equal(fire, r.fire, `${r.t} ${r.sym} ${r.side}: S2 ${s.S2}/${r.S2} gbmP ${g}/${r.gbmP}`);
    assert.equal(fire && s.S2 >= 90, r.aplus, `${r.t} A+`);
    const rd = C.comboRead(rawOf(r), r.x);
    assert.equal(rd.fire, r.fire); assert.equal(rd.aPlus, r.aplus);
    fires += fire; aplus += fire && s.S2 >= 90;
  }
  assert.ok(wS < 1e-6, `S2 ${wS}`); assert.ok(wP < 1e-6, `p ${wP}`); assert.ok(wG < 1e-9, `gbmP ${wG}`);
  assert.equal(fires, FIX.rows.filter((r) => r.fire).length); assert.equal(aplus, FIX.rows.filter((r) => r.aplus).length);
  console.log(`combo1016 parity: max|dS2| ${wS.toExponential(2)} max|dp| ${wP.toExponential(2)} max|dgbmP| ${wG.toExponential(2)}; fires ${fires}/553, A+ ${aplus}`);
});

test("plan: hybrid entry (market ≤1R else newest edge limit), T1 1R 50% → BE → 2R", () => {
  const m = C.comboPlan({ side: "short", price: 29925, edge: 29930.63, stop: 29944.25 });
  assert.equal(m.kind, "market"); assert.equal(m.entry, 29925); assert.equal(m.partialFrac, 0.5); assert.equal(m.beAfterT1, true);
  assert.ok(Math.abs(m.t1 - (29925 - 19.25)) < 1e-9 && Math.abs(m.t2 - (29925 - 38.5)) < 1e-9);
  const l = C.comboPlan({ side: "short", price: 29900, edge: 29930.63, stop: 29944.25 }); assert.equal(l.kind, "limit"); assert.equal(l.entry, 29930.63);
  assert.equal(C.comboPlan({ side: "long", price: 99, edge: 100, stop: 99.5 }), null);
});

test("ledger: caps 3/day 2/symbol, halt after the first loss, re-arm only with a new setup id, sealed entry never re-priced", () => {
  const p = (e) => C.comboPlan({ side: "long", price: e, edge: e, stop: e - 2 });
  const day = { day: "2026-10-16", entries: [] };
  const a = C.comboAdmit(day, "MNQ", "A", p(100), "long", 1); assert.equal(a.ok, true); day.entries.push(a.sealed);
  const again = C.comboAdmit(day, "MNQ", "A", p(105), "long", 2); assert.equal(again.ok, false); assert.equal(again.sealed.entry, 100);   // no re-price
  const b = C.comboAdmit(day, "MNQ", "B", p(103), "long", 3); assert.equal(b.ok, true); day.entries.push(b.sealed);
  assert.match(C.comboAdmit(day, "MNQ", "C", p(104), "long", 4).why, /MNQ cap 2\/2/);
  const d = C.comboAdmit(day, "MES", "D", p(50), "long", 5); assert.equal(d.ok, true); day.entries.push(d.sealed);
  assert.match(C.comboAdmit(day, "MES", "E", p(51), "long", 6).why, /day cap 3\/3/);
  const d2 = { day: "x", entries: [{ ...a.sealed, result: "loss" }] };
  assert.match(C.comboAdmit(d2, "MES", "F", p(50), "long", 7).why, /halted/);
  assert.notEqual(C.setupIdOf("MNQ", "short", 30100, 1), C.setupIdOf("MNQ", "short", 30112, 2));
});

test("source guard: build-desk combo1016 block is read-only (no q/band/plan/size writes)", () => {
  const src = readFileSync(new URL("../src/lib/trading/build-desk.ts", import.meta.url), "utf8");
  const a = src.indexOf("// combo1016 (shadow)"); const b = src.indexOf("} catch (e) { (c as { combo1016?: unknown }).combo1016");
  assert.ok(a > 0 && b > a);
  assert.ok(!/qWrite|sealBand|pathBand\s*=|c\.plan\s*=|entryPx\s*=|confluence\s*=|sizeMult\s*=/.test(src.slice(a, b)));
  const dl = readFileSync(new URL("../src/lib/trading/desk-listen.ts", import.meta.url), "utf8");
  assert.equal((dl.match(/combo1016Seat: combo1016SeatNote/g) ?? []).length, 2);   // Brain + Floor seats
});

test("seat line: shadow:combo1016:* tag, A+ logged only", async () => {
  const D = await import("../src/lib/trading/desk-listen.ts");
  const s = D.combo1016SeatNote({ S2: 92, gbmP: 0.65, thr: 0.604, grade: "A+", wouldFire: true, aPlus: true, mode: "shadow", plan: { kind: "market", entry: 1 }, src: "ltfArm 1m PDH" });
  assert.match(s, /^shadow:combo1016:would_fire S2 92/); assert.match(s, /A\+ \(logged only, no size change\)/);
  assert.equal(D.combo1016SeatNote(null), null);
});

test("partial: defaulted inputs are listed, never a clean would_fire; S2/fire unchanged", async () => {
  const D = await import("../src/lib/trading/desk-listen.ts");
  const r = FIX.rows[0];
  const full = C.scoreV2(rawOf(r));
  const v2 = { ...rawOf(r), atrpct: null, chaseR: null };
  const s = C.scoreV2(v2);
  assert.ok(s.filled.includes("ctx_lowvol") && s.filled.includes("ent_nochase"));
  // numbers still use the research defaults (atrpct 0.5, chaseR 1): only the label changes
  const sf = C.v2Subfactors(v2); assert.equal(sf.ctx_lowvol, 0.5); assert.equal(sf.ent_nochase, 0);
  const ft = C.featuresFromScore1016({ side: "short", bias1h: 1, bias4h: 1, pd: 0.8, pools: ["PDH"], poolTier: () => 3, smt: true, dispAtr: 2, mss: true, ifvg: false,
    arrayKind: "fvg", arrayAtLegEq: false, nArrays: 1, minuteCt: 560, chaseR: 0.2, riskPts: 5, atr5: 10, dow: 2 });
  const rd = C.comboRead(ft.v2, ft.gbm);
  for (const k of ["ctx_htf4", "ctx_lowvol", "tim_rng30"]) assert.ok(rd.filled.includes(k), k);
  assert.ok(rd.gbmMissing.length > 0);
  assert.equal(rd.partial, `partial: ${rd.filled.length}/14 S2 filled, ${rd.gbmMissing.length}/27 GBM missing`);
  assert.ok(full.S2 >= 0);
  const seat = D.combo1016SeatNote({ S2: 92, gbmP: 0.65, thr: 0.604, grade: "A+", wouldFire: true, mode: "shadow", plan: { kind: "market", entry: 1 }, partial: rd.partial, src: "x" });
  assert.match(seat, /^shadow:combo1016:would_fire_partial S2 92 .* partial: \d+\/14 S2 filled, \d+\/27 GBM missing/); assert.match(seat, /would fire \(partial\)/);
  const old = D.combo1016SeatNote({ S2: 92, wouldFire: true, mode: "shadow", filled: ["ctx_lowvol"], gbmMissing: [] });
  assert.match(old, /^shadow:combo1016:would_fire_partial .*partial: 1\/14 S2 filled, 0\/27 GBM missing/);
  const src = readFileSync(new URL("../src/lib/trading/build-desk.ts", import.meta.url), "utf8");
  assert.ok(src.includes('"shadow:combo1016:would_fire_partial"') && src.includes("rd.partial ? ` (${rd.partial})`"));
});
