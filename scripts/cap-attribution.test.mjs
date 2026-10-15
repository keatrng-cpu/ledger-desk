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
