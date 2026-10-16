import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const RULES = JSON.parse(readFileSync(new URL("../shared/desk-rules.json", import.meta.url)));
const g = await import("../src/lib/execution/bplus-brain.ts");
const base = { symbol: "QQQ", side: "long", brainSymbol: "MNQ", brainSide: "long", q: 0.62, floorBlocks: [] };
test("rule lives in shared/desk-rules.json fire.bplusBrainTake (live, B+, A- htf-capped, TAKE, exact match)", () => {
  const r = RULES.fire.bplusBrainTake;
  assert.equal(r.mode, "live"); assert.deepEqual(r.bands, ["B+"]); assert.deepEqual(r.htfCappedFrom, ["A-"]);
  assert.equal(r.word, "TAKE"); assert.equal(r.matchSymbolSide, true);
});
test("B+ without Brain TAKE is not fireable", () => {
  for (const w of ["STAND", "WAIT", "LONG", null, ""]) {
    const r = g.bplusBrainGate({ ...base, band: "B+", brainWord: w });
    assert.equal(r.fireable, false); assert.match(r.reason, /^B\+ needs Brain TAKE/);
  }
});
test("B+ TAKE on matching symbol/side fires; wrong side or book refused", () => {
  assert.equal(g.bplusBrainGate({ ...base, band: "B+", brainWord: "TAKE" }).fireable, true);
  assert.equal(g.bplusBrainGate({ ...base, band: "B+", brainWord: "TAKE", brainSide: "short" }).fireable, false);
  assert.equal(g.bplusBrainGate({ ...base, band: "B+", brainWord: "TAKE", brainSymbol: "MES" }).fireable, false);
  assert.equal(g.bplusBrainGate({ ...base, band: "B+", brainWord: "TAKE", brainSymbol: null }).fireable, false);
});
test("A- downsized to B+ by the HTF cap needs TAKE too; A- uncapped and A/A+ unchanged", () => {
  assert.equal(g.bplusBrainGate({ ...base, band: "A-", htfCapped: true, brainWord: "STAND" }).fireable, false);
  assert.match(g.bplusBrainGate({ ...base, band: "A−", htfCapped: true, brainWord: "WAIT" }).reason, /capped to B\+ size/);
  assert.equal(g.bplusBrainGate({ ...base, band: "A-", htfCapped: true, brainWord: "TAKE" }).fireable, true);
  for (const band of ["A-", "A", "A+"]) assert.equal(g.bplusBrainGate({ ...base, band, brainWord: "STAND" }).fireable, true);
  for (const band of ["A", "A+"]) assert.equal(g.bplusBrainGate({ ...base, band, htfCapped: true, brainWord: "STAND" }).fireable, true);
});
test("Floor stamps bplus_brain_agree as BRAIN", async () => {
  const f = await import("../src/lib/room/floor-cues.ts");
  assert.equal(f.stampOf("bplus_brain_agree", null), "BRAIN");
});
test("09:43 hard list for B+-sized cards: q >= 0.60, no Floor blocks, bplus_caution, no Brain veto", () => {
  const h = RULES.fire.bplusBrainTake.hard;
  assert.equal(h.minQ, 0.6); assert.ok(h.noFloorBlocks && h.bplusCaution && h.noBrainVeto && h.brainTake);
  assert.ok(RULES.fastChain.hard.includes("bplus_brain_agree"));
  const ok = { ...base, band: "B+", brainWord: "TAKE" };
  assert.match(g.bplusBrainGate({ ...ok, q: 0.59 }).reason, /fit q 0\.59 < 0\.60/);
  assert.equal(g.bplusBrainGate({ ...ok, q: null }).fireable, false);
  assert.match(g.bplusBrainGate({ ...ok, floorBlocks: ["News blackout"] }).reason, /Floor block/);
  assert.match(g.bplusBrainGate({ ...ok, bplusCautionOk: false }).reason, /bplus_caution/);
  assert.equal(g.bplusBrainGate({ ...ok, bplusCautionOk: true }).fireable, true);
  assert.match(g.bplusBrainGate({ ...ok, brainSide: "short" }).reason, /Brain veto/);
  assert.equal(g.bplusBrainGate({ ...ok, band: "B", nearMissPromoted: true, brainWord: "WAIT" }).fireable, false);
  assert.equal(g.bplusBrainGate({ ...ok, band: "A", q: 0.5, floorBlocks: ["x"], brainWord: "STAND" }).fireable, true);
});
test("09:48 day limits: 1 B+-sized entry/day, none after a loss, unknown fails closed (watcher v5 parity)", () => {
  const h = RULES.fire.bplusBrainTake.hard;
  assert.equal(h.maxPerDay, 1); assert.equal(h.noneAfterLoss, true); assert.equal(h.dayUnknownFailsClosed, true);
  const ok = { ...base, band: "B+", brainWord: "TAKE" };
  assert.equal(g.bplusBrainGate({ ...ok, bplusEntriesToday: 0, lostToday: false }).fireable, true);
  assert.match(g.bplusBrainGate({ ...ok, bplusEntriesToday: 1, lostToday: false }).reason, /B\+ entries today 1\/1/);
  assert.match(g.bplusBrainGate({ ...ok, bplusEntriesToday: 0, lostToday: true }).reason, /lost today/);
  assert.match(g.bplusBrainGate({ ...ok, bplusEntriesToday: null, lostToday: false }).reason, /fail closed/);
  assert.equal(g.bplusBrainGate({ ...ok, band: "A-", htfCapped: true, bplusEntriesToday: 1, lostToday: false }).fireable, false);
  assert.equal(g.bplusBrainGate({ ...ok, band: "A", bplusEntriesToday: 3, lostToday: true }).fireable, true);
});
