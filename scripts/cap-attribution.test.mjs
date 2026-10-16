import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const a = await import("../src/lib/trading/cap-attribution.ts");
const { capBand } = await import("../src/lib/smc/discipline.ts");

test("every cap/penalty is logged with band before/after and its own reason; q_raw pre-seal", () => {
  const c = a.trackCard({ confluence: 0.77, pathBand: "A+", reasons: [] });
  a.capStage("mtf");
  c.pathBand = capBand(c.pathBand, "B"); c.reasons.push("15m SMT fight: capped at B");
  a.capStage("velocity");
  c.confluence = 0.72; c.reasons.push("velocity -0.05");
  c.confluence = 0.74; // nudge
  a.preSeal(c);
  assert.equal(c.q_scan, 0.77); assert.equal(c.q_raw, 0.74);
  const [cap, pen, nud] = c.capReasons;
  assert.deepEqual([cap.stage, cap.kind, cap.before, cap.after, cap.bandBefore, cap.bandAfter, cap.why], ["mtf", "cap", "A+", "B", "A+", "B", "15m SMT fight: capped at B"]);
  assert.deepEqual([pen.kind, pen.before, pen.after, pen.why], ["penalty", 0.77, 0.72, "velocity -0.05"]);
  assert.equal(nud.kind, "nudge");
  const j = JSON.parse(JSON.stringify(c)); assert.equal(j.capReasons.length, 3); assert.equal(j.confluence, 0.74); assert.equal(j._ri, undefined);
});
test("build-desk tracks every card and records q_raw before sealBand", async () => {
  const src = (await import("node:fs")).readFileSync("src/lib/trading/build-desk.ts", "utf8");
  assert.match(src, /trackCard\(c as never\)/); assert.match(src, /preSeal\(c as never\); capStage\("seal"\); sealBand/);
});
test("the served card (desk-listen scanner rows) carries q_raw, q_scan and capReasons", async () => {
  const src = (await import("node:fs")).readFileSync("src/lib/trading/desk-listen.ts", "utf8");
  assert.match(src, /q_raw: \(c as/); assert.match(src, /capReasons: \(\(c as/);
});

test("10/16 9:31 ET regression: a discipline penalty is labelled by its own rule, never by the MTF align line pushed next", async () => {
  const { applyDiscipline } = await import("../src/lib/smc/discipline.ts");
  const c = a.trackCard({ symbol: "MNQ", side: "short", confluence: 0.9213, pathBand: "A+", reasons: [], entryPx: 30089.25, htfOk: true, gapSide: null, plan: null });
  a.capStage("discipline+mtf");
  // price 1.333×ATR15 past the short CE → R3 chase (timing.mode shadow) q ×0.3333
  applyDiscipline(c, { price: 30089.25 - 1.3333 * 30, atr15: 30, closed15: [], minute: [], nowMs: Date.now(), levels: [] });
  c.reasons.push("MTF align 1 (HTF ✓ MTF ✓ LTF ✓)");
  a.preSeal(c);
  const pen = c.capReasons.find((r) => r.field === "confluence" && r.kind === "penalty");
  const cap = c.capReasons.find((r) => r.field === "pathBand");
  for (const r of [pen, cap]) { assert.ok(r); assert.doesNotMatch(String(r.why), /MTF align/); }
  if (c.chase?.applied) { assert.match(pen.why, /R3 chase 1\.33×ATR15/); assert.match(pen.source, /R3 chase/); }
  assert.match(cap.why, /Chase 1\.33×ATR past CE — 2 band steps down/);
});
test("served scanner rows carry the writer label (source)", async () => {
  const src = (await import("node:fs")).readFileSync("src/lib/trading/desk-listen.ts", "utf8");
  assert.match(src, /why: why \?\? null, source: source \?\? null/);
});
