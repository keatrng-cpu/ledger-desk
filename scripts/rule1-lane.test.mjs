import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const r = await import("../src/lib/trading/rule1.ts");
const L = await import("../src/lib/trading/rule1-lane.ts");
const h = await import("../src/lib/desk/rules-hash.ts");
const dl = await import("../src/lib/trading/desk-listen.ts");
const bars = JSON.parse(readFileSync("tests/fixtures/bars-1m-2026-10-13.json", "utf8"));
const first = () => { for (const b of bars.MNQ) { const { min, day } = r.ctParts(b.t); if (day !== "2026-10-13" || min < 510 || min > 545) continue; const tk = r.rule1Ticket("MNQ", bars.MNQ, b.t + 60_000); if (tk) return tk; } return null; };
test("lane: closed-bar Rule 1 ticket would fire on first sight, persist-exempt, shadow only", () => {
  const tk = first(); const l = L.rule1Lane(tk, tk.at + 3_000);
  assert.equal(l.lane, "rule1"); assert.equal(l.mode, "shadow"); assert.equal(l.live, false); assert.equal(l.persistExempt, true);
  assert.equal(l.closedBar, true); assert.equal(l.wouldFire, true); assert.equal(l.ageS, 3); assert.equal(l.barCloseAt, tk.at);
});
test("lane: stale after maxAgeS and never before the bar closes", () => {
  const tk = first();
  assert.equal(L.rule1Lane(tk, tk.at + 301_000).wouldFire, false);
  assert.equal(L.rule1Lane(tk, tk.at - 1).wouldFire, false);
});
test("withLane does not mutate the ticket and the lane rides the wire to brain/Floor (MasterInput.rule1)", () => {
  const tk = first(); const [w] = L.withLane([tk], tk.at + 5_000);
  assert.equal(tk.lane, undefined); assert.equal(w.lane.wouldFire, true); assert.equal(w.entry, tk.entry);
  const mi = dl.masterInputOf({ rule1: [w], brain: { word: "WAIT" }, floor: { verdict: "WATCH" }, strategy: null }, null, "normal");
  assert.equal(mi.rule1[0].lane.lane, "rule1");
});
test("rules hash unchanged: the lane config is outside shared/desk-rules.json", () => {
  assert.equal(readFileSync("shared/desk-rules.json", "utf8").includes("rule1-lane"), false);
  assert.equal(h.RULES_HASH, "a4bfcb65c88badcd");
  assert.equal(JSON.parse(readFileSync("shared/rule1-lane.json", "utf8")).live, false);
});
