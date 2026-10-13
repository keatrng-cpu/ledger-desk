import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const RULES = JSON.parse(readFileSync(new URL("../shared/desk-rules.json", import.meta.url)));
test("kzDisp: items 1-50 present, all shadow, no score effect, band cutoffs unchanged", async () => {
  const k = await import("../src/lib/desk/kz-disp.ts");
  assert.deepEqual(Object.keys(RULES.kzDisp.items).map(Number).sort((a, b) => a - b), Array.from({ length: 50 }, (_, i) => i + 1));
  assert.deepEqual(k.kzLiveItems(), []);
  assert.equal(k.kzScoreDelta(), 0);
  assert.deepEqual(RULES.bandEdges, { "A+": 0.75, A: 0.68, "A-": 0.65, "B+": 0.6, B: 0.5 });
});
test("Accuracy: ticketManageLines prints the time-stop cut only when optExec.timeStop.mode is live", async () => {
  const o = await import("../src/lib/execution/opt-exec.ts");
  const has = o.ticketManageLines().some((l) => /min: cut/.test(l));
  assert.equal(has, RULES.optExec.timeStop.mode === "live");
});
