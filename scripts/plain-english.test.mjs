/**
 * Plain English (src/lib/ui/plain-english.ts): one pass, one short gloss per
 * term, never a gloss nested inside a gloss.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { GLOSSARY, plainify } = await import("../src/lib/ui/plain-english.ts");

test("no gloss carries a bracket (so nothing can nest)", () => {
  for (const [k, v] of Object.entries(GLOSSARY)) assert.doesNotMatch(v.plain, /[()]/, k);
});

test("the review's sentence reads flat", () => {
  const out = plainify("PDH (external BSL) +2 31,371");
  assert.equal(out, "yesterday's high (external buy stops above highs) +2 31,371");
  assert.doesNotMatch(out, /\([^)]*\(/);
});

test("single pass: a gloss is never re-scanned, numbers untouched", () => {
  assert.equal(plainify("CE 31344.25 · T1 31390 · SMT"), "middle of the entry zone 31344.25 · first target 31390 · NQ/ES divergence");
  assert.equal(plainify(plainify("BSL")), plainify("BSL"));
});
