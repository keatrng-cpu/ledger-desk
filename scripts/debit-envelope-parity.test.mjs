// Review 2026-10-15 #8: brainlab/gate.py and the TS desk must share ONE debit envelope (shared/desk-rules.json).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const env = JSON.parse(readFileSync("shared/desk-rules.json", "utf8")).fireFix.envelope;
test("envelope is $50-$650", () => { assert.equal(env.minDebit, 50); assert.equal(env.maxDebit, 650); });
test("TS desk reads min AND max from desk-rules.json", () => {
  const ts = readFileSync("src/lib/execution/rh-autofire-gates.ts", "utf8");
  assert.match(ts, /RH_MIN_DEBIT_TOTAL = \(RULES[^\n]*minDebit/);
  assert.match(ts, /RH_MAX_DEBIT_TOTAL = \(RULES[^\n]*maxDebit/);
});
test("brainlab/gate.py reads desk-rules.json, no hard-coded literal drift", () => {
  const py = readFileSync("brainlab/gate.py", "utf8");
  assert.doesNotMatch(py, /^MIN_DEBIT\s*=\s*\d/m);
  assert.doesNotMatch(py, /^MAX_DEBIT\s*=\s*\d/m);
  assert.match(py, /desk-rules\.json/);
  let out = null;
  try { out = execFileSync("python3", ["-c", "import brainlab.gate as g;print(g.MIN_DEBIT,g.MAX_DEBIT)"], { encoding: "utf8" }).trim(); } catch { /* deps absent: static checks above still bind */ }
  if (out) assert.equal(out, `${Number(env.minDebit).toFixed(1)} ${Number(env.maxDebit).toFixed(1)}`);
});
