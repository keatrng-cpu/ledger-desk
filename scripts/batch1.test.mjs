import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const j = await import("../src/lib/desk/card-journal.ts");
const ms = await import("../src/lib/smc/master-seat.ts");
const ex = await import("../src/lib/smc/exec-context.ts");
const dl = await import("../src/lib/trading/desk-listen.ts");
test("journal resolveRow: fill, stop, target, flat, unfilled", () => {
  const r = { side: "long", entry: 100, stop: 98, target: 104, filled: false };
  assert.deepEqual(j.resolveRow(r, 101, false), { filled: false, status: "open", r: null });
  assert.deepEqual(j.resolveRow(r, 101, true), { filled: false, status: "unfilled", r: null });
  assert.equal(j.resolveRow({ ...r, filled: true }, 97.5, false).status, "loss");
  assert.deepEqual(j.resolveRow({ ...r, filled: true }, 104, false), { filled: true, status: "win", r: 2 });
  assert.deepEqual(j.resolveRow({ ...r, filled: true }, 101, true), { filled: true, status: "flat", r: 0.5 });
});
test("bandReport: insufficient n never suggests a change", () => {
  const rep = j.bandReport([{ band: "A", status: "win", r: 2 }, { band: "A", status: "loss", r: -1 }]);
  const a = rep.find((x) => x.band === "A");
  assert.equal(a.n, 2); assert.equal(a.avgR, 0.5); assert.match(a.suggestion, /insufficient n/);
});
test("governor: ±2R → A+ only; no data → normal", () => {
  assert.equal(j.governorOf(2.1), "A+ only"); assert.equal(j.governorOf(-2), "A+ only");
  assert.equal(j.governorOf(1.5), "normal"); assert.equal(j.governorOf(null), "normal");
});
test("review line carries the context", () => {
  assert.match(j.reviewOf("loss", -1, { mtfAlign: 0.33, chop: true }), /LOSS -1R.*MTF align 0.33.*chop.*lesson/);
});
const card = { symbol: "ES", side: "long", band: "A", q: 0.7, actionable: true, entry: 100, entryResting: false, stopPx: 98, target: 104, rr: 2, chop: false, bias1h: "bull", bias4h: "bull", dispScore: 0.75, ltfKilled: false, reversal: null };
const base = { card, brainWord: "TAKE", brainBook: { symbol: "ES", side: "long" }, floorVerdict: "ARMED", align: 1, smtLead: null, shockActive: false, topDraw: null, governor: "normal" };
test("Master TAKE only when every check passes", () => {
  assert.equal(ms.masterSeat(base).verdict, "TAKE");
  const p = ms.masterSeat({ ...base, card: { ...card, chop: true } });
  assert.equal(p.verdict, "PASS"); assert.ok(p.failed.includes("not chop"));
  assert.equal(ms.masterSeat({ ...base, governor: "A+ only" }).verdict, "PASS");
  assert.equal(ms.masterSeat({ ...base, card: null }).verdict, "PASS");
});
test("exit plan: kill flag, time stop, null trail without tape", () => {
  const e = ex.exitPlanOf([], "long", 100, { why: ["x"] });
  assert.equal(e.killExit, true); assert.equal(e.trailPx, null); assert.equal(e.timeStopBars, ex.TIME_STOP_BARS);
});
test("displacement strength is null without tape", () => {
  assert.equal(ex.displacementStrength([], "long"), null);
});
test("rankDraws: equal-high touches rank up", () => {
  const t = (name, price, score) => ({ name, price, kind: "x", side: "above", distancePoints: 1, distanceAtr: 1, liquidityWeight: 1, swept: false, reachProbability: 0.5, score, why: [] });
  const draw = { primary: t("PDH (external BSL)", 110, 0.5), above: null, below: null, alternates: [t("EQH ×2", 105, 0.45)], atr: 1 };
  const bars = [{ h: 105, l: 100 }, { h: 105.05, l: 101 }, { h: 104, l: 100 }].map((b, i) => ({ t: i, o: 0, c: 0, v: 0, ...b }));
  const r = ex.rankDraws(draw, bars);
  assert.equal(r[0].name, "EQH ×2"); assert.equal(r[0].touches, 2); assert.equal(r[1].scope, "external");
});
test("poolLabel: side follows price", () => {
  assert.equal(dl.poolLabel("Swing low (external SSL)", 110, 100), "Swing low (external BSL)");
  assert.equal(dl.poolLabel("PDH (external BSL)", 90, 100), "PDH (external SSL)");
  assert.equal(dl.poolLabel("PDL", 110, 100), "PDL (above price — BSL)");
  assert.equal(dl.poolLabel("PDL", 90, null), "PDL");
});
