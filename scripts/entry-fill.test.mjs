import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("entryFill calibration decays with distance (near fills > far fills)", () => {
  const ef = JSON.parse(readFileSync("src/lib/smc/seq/ladder-calibration.json","utf8")).entryFill;
  const rate = (k) => ef[k].hit / ef[k].n;
  assert.ok(rate("array|<0.5") > rate("array|2-4"), "near entries must fill more than far");
  assert.ok(rate("sweep|<0.5") > rate("sweep|2-4"));
});
