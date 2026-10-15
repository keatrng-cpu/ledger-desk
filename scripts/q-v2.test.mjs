import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const v = await import("../src/lib/trading/q-v2.ts");
const d = await import("../src/lib/smc/discipline.ts");
const ca = await import("../src/lib/trading/cap-attribution.ts");
const qs = await import("../src/lib/trading/q-source.ts");
const at = (h, m) => Date.UTC(2026, 9, 15, h + 5, m); // CT = UTC-5
const base = { side: "long", qScan: 0.66, components: ["structure", "mss", "displacement"], htfOk: false, keySwept: false, trendDay: false };
test("key sweep ramp: full 08:30–10:00, half at 10:30, 0 at 11:00", () => {
  assert.equal(v.keySweepRamp(510), 1); assert.equal(v.keySweepRamp(600), 1); assert.equal(v.keySweepRamp(630), 0.5); assert.equal(v.keySweepRamp(660), 0); assert.equal(v.keySweepRamp(505), 0);
  const a = v.computeQV2({ ...base, keySwept: true, nowMs: at(9, 0) }), b = v.computeQV2({ ...base, nowMs: at(9, 0) });
  assert.equal(+(a.q - b.q).toFixed(4), 0.06);
});
test("chase / SMT / seal deltas never reach q_v2; other caps are labelled and capped at one band", () => {
  const capReasons = [
    { field: "confluence", kind: "penalty", before: 0.8, after: 0.24, source: "R3 chase (×factor, + R8 wick if any)" },
    { field: "confluence", kind: "penalty", before: 0.7, after: 0.6, source: "seal:band ceiling (B+)" },
    { field: "confluence", kind: "penalty", before: 0.7, after: 0.3, source: "loss:velocity" },
  ];
  const r = v.computeQV2({ ...base, nowMs: at(9, 0), capReasons });
  const live = r.deltas.filter((x) => x.source.startsWith("live:"));
  assert.equal(live.length, 1); assert.equal(live[0].delta, -0.07);
  for (const x of r.deltas) assert.ok(Math.abs(x.delta) <= 0.07 + 1e-9, x.source);
});
test("option-quality penalty: wide spread + late 0DTE theta, capped", () => {
  const r = v.computeQV2({ ...base, nowMs: at(14, 0), option: { spreadPct: 0.2, premiumVsMove: 2, dte: 0 } });
  const o = r.deltas.find((x) => x.source === "option"); assert.ok(o.delta < 0 && o.delta >= -0.07);
});
test("q_v2 edges are raise-only vs live", () => {
  d.setBandEdges({ A: 0.7 }); assert.equal(v.edgesV2().A, 0.7); d.setBandEdges(null); assert.equal(v.edgesV2().A, 0.68);
});
test("live q untouched: applyDiscipline/seal identical with q-source labels", () => {
  const c = ca.trackCard({ side: "long", confluence: 0.8, pathBand: "A+", actionable: true, htfOk: true, entryPx: 100, reasons: [] });
  d.applyDiscipline(c, { price: 101, atr15: 2, closed15: [], minute: [], nowMs: at(9, 0), levels: [] });
  assert.equal(c.confluence, 0.6); // 0.8 × (1 − 0.5·0.5) — unchanged live behaviour (timing.mode shadow)
  const w = c.capReasons.find((r) => r.field === "confluence"); assert.match(w.source, /R3 chase/);
});
test("untracked writes are logged as a residual so q_scan + Σ deltas == q_raw", () => {
  const c = ca.trackCard({ confluence: 0.5, pathBand: "B", reasons: [] });
  qs.setQSource("x"); c.confluence = 0.55;
  const raw = Object.getOwnPropertyDescriptor(c, "confluence"); // simulate a copy write: bypass the setter by redefining
  Object.defineProperty(c, "confluence", { value: 0.6, writable: true, configurable: true, enumerable: true });
  ca.preSeal(c);
  const sum = c.capReasons.filter((r) => r.field === "confluence").reduce((a, r) => a + (r.after - r.before), 0);
  assert.equal(+(0.5 + sum).toFixed(4), 0.6); assert.ok(c.capReasons.some((r) => /untracked/.test(r.source ?? "")));
  assert.ok(raw);
});
