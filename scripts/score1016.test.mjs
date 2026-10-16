/** score1016 — event-driven five-layer score (src/lib/smc/score1016.ts). Parity with the Python backtest proxy + shadow guards. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const RULES = (await import("../shared/desk-rules.json", { with: { type: "json" } })).default;
const S = await import("../src/lib/smc/score1016.ts");
const FIX = JSON.parse(readFileSync(new URL("./fixtures/score1016-parity.json", import.meta.url)));

test("rules: score1016 block ships every item shadow; weights 1/1.5/1.5/1/0.5; fire at 83", () => {
  const b = RULES.score1016;
  for (const k of Object.keys(S.scoreModes())) assert.equal(S.scoreMode(k), "shadow", k);
  assert.deepEqual(b.score.weights, { L1: 1, L2: 1.5, L3: 1.5, L4: 1, L5: 0.5 });
  assert.equal(b.score.fireAt, 83);
});

test("parity: TS score == Python proxy S on 553 candidates (all 153 of the 10/12–10/16 week + 400 random 2010–2026)", () => {
  let worst = 0;
  for (const r of FIX) {
    const out = S.score1016({ side: r.side, bias1h: r.b1, bias4h: r.b4, pd: r.pd, pools: r.pools, smt: r.smt, dispAtr: r.disp, mss: r.mss, ifvg: r.ifvg,
      arrayKind: r.arr, arrayAtLegEq: r.eqhit, nArrays: r.narr, minuteCt: r.tmin });
    worst = Math.max(worst, Math.abs(out.S - r.S));
    assert.ok(Math.abs(out.S - r.S) <= 0.051, `${r.t} ${r.sym} ${r.side}: TS ${out.S} vs py ${r.S}`);
    assert.equal(out.fire, Math.round(r.S * 10) / 10 >= 83, `${r.t} fire`);
  }
  assert.ok(worst <= 0.051);
});

test("grading: no band ceiling — S 92 grades A+ with p 0.63; 83 A- fires; 80 B+ does not", () => {
  const base = { side: "short", bias1h: 1, bias4h: 1, pd: 0.9, pools: ["PDH"], smt: true, dispAtr: 2.4, mss: true, ifvg: true, arrayKind: "ifvg", arrayAtLegEq: true, nArrays: 3, minuteCt: 520 };
  const top = S.score1016(base);
  assert.equal(top.S, 100); assert.equal(top.grade, "A+"); assert.ok(top.S / 100 >= 0.85); assert.equal(top.fire, true);
  assert.equal(S.gradeOf(83), "A-"); assert.equal(S.gradeOf(80), "B+"); assert.equal(S.pOf(92), 0.63);
});

test("hard vetoes are the only stop: stale / invalidated / bad risk → skip, no fire", () => {
  const base = { side: "long", bias1h: 1, bias4h: 1, pd: 0.9, pools: ["ONL"], smt: false, dispAtr: 2.4, mss: true, ifvg: true, arrayKind: "ifvg", arrayAtLegEq: true, nArrays: 3, minuteCt: 520 };
  for (const v of [{ staleData: true }, { invalidated: true }, { riskPts: 0 }]) {
    const veto = S.hardVetoes({ riskPts: 4, atr1m: 2, staleData: false, invalidated: false, ...v });
    const o = S.score1016(base, veto); assert.equal(o.fire, false); assert.equal(o.grade, "skip");
  }
  assert.equal(S.hardVetoes({ riskPts: 4, atr1m: 2, staleData: false, invalidated: false }).vetoed, false);
});

test("entry: market within 1.0R of the newest edge, else a limit at the edge; exits T1 1R 50% → BE → 2R; caps 2/day 1/symbol", () => {
  const m = S.entryDecision({ side: "short", price: 29925, edge: 29930.63, stop: 29944.25 });
  assert.equal(m.kind, "market"); assert.equal(m.entry, 29925);
  const l = S.entryDecision({ side: "short", price: 29900, edge: 29930.63, stop: 29944.25 });
  assert.equal(l.kind, "limit"); assert.equal(l.entry, 29930.63);
  assert.equal(S.entryDecision({ side: "short", price: 29950, edge: 29930.63, stop: 29944.25 }), null);   // through the stop
  const x = S.exitPlan("short", 100, 102); assert.equal(x.t1, 98); assert.equal(x.t2, 96); assert.equal(x.partialFrac, 0.5); assert.equal(x.beAfterT1, true);
  assert.equal(S.capsOk([], "MNQ").ok, true); assert.equal(S.capsOk([{ symbol: "MNQ" }], "MNQ").ok, false);
  assert.equal(S.capsOk([{ symbol: "MNQ" }], "MES").ok, true); assert.equal(S.capsOk([{ symbol: "MNQ" }, { symbol: "MES" }], "MES").ok, false);
});

test("poiHalf (narrow): graded at the POI only; EQ / no leg = no opinion", () => {
  assert.equal(S.poiHalfAtEntry({ side: "short", atPoi: { zone: "premium" } }).pass, true);
  assert.equal(S.poiHalfAtEntry({ side: "short", atPoi: { zone: "discount" } }).pass, false);
  assert.equal(S.poiHalfAtEntry({ side: "long", atPoi: { zone: "equilibrium" } }).pass, null);
  assert.equal(S.poiHalfAtEntry(null).pass, null);
});

test("source guard: build-desk never writes q/band/plan from score1016 (shadow read only)", () => {
  const src = readFileSync(new URL("../src/lib/trading/build-desk.ts", import.meta.url), "utf8");
  const a = src.indexOf("// score1016 (shadow)"); const b = src.indexOf("} catch (e) { (c as { score1016?: unknown }).score1016");
  assert.ok(a > 0 && b > a);
  const blk = src.slice(a, b);
  assert.ok(!/qWrite|sealBand|pathBand\s*=|c\.plan\s*=|entryPx\s*=|confluence\s*=/.test(blk), "no live writes in the score1016 block");
});
