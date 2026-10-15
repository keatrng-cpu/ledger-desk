// Accuracy CHANGES #24: read-priority kill is a labelled, attributed band write (cap:readPriority) and demotes A+/A/A- grades.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const R = await import("../src/lib/trading/read-priority.ts");
const CA = await import("../src/lib/trading/cap-attribution.ts");

const card = (o = {}) => ({ symbol: "ES", side: "short", confluence: 0.7, pathBand: "A-", grade: "A", actionable: true, reasons: [], ...o });

test("readPriorityKill: C band via qWrite, attributed cap:readPriority on a tracked card, A grade -> B", () => {
  const c = R.readPriorityKill(card());
  assert.equal(c.pathBand, "C"); assert.equal(c.actionable, false); assert.equal(c.grade, "B"); assert.equal(c.readFlippedAgainst, true);
  const caps = c.capReasons.filter((r) => r.field === "pathBand");
  assert.equal(caps.length, 1);
  assert.equal(caps[0].source, "cap:readPriority"); assert.equal(caps[0].kind, "cap");
  assert.equal(caps[0].before, "A-"); assert.equal(caps[0].after, "C"); assert.equal(caps[0].stage, "scan:readPriority");
  CA.resolveWhy(c); assert.match(caps[0].why, /readPriority/);
  // build-desk's later trackCard is a no-op: the attribution survives
  CA.trackCard(c); assert.equal(c.capReasons.filter((r) => r.source === "cap:readPriority").length, 1);
});

test("readPriorityKill: already C -> no cap row (no-op write), label does not leak onto the next write", () => {
  const c = R.readPriorityKill(card({ pathBand: "C", grade: "B" }));
  assert.equal(c.capReasons.length, 0);
  c.pathBand = "skip";
  assert.equal(c.capReasons.at(-1).source, null);
});

test("demoteGrade: A+ / A / A- -> B, others unchanged", () => {
  for (const [g, want] of [["A+", "B"], ["A", "B"], ["A-", "B"], ["B+", "B+"], ["B", "B"], ["C", "C"]]) {
    const c = { grade: g }; R.demoteGrade(c); assert.equal(c.grade, want, g);
  }
});
