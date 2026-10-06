/** One state vocabulary (src/lib/ui/state-words.ts): engine values → entry-state words. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { displayWord, wordTitle } = await import("../src/lib/ui/state-words.ts");

test("STAND family reads WAIT", () => {
  for (const v of ["STAND", "STAND_DOWN", "stand aside", "SKIP", "FLAT", "HOLD", "", null, "whatever"])
    assert.equal(displayWord(v), "WAIT", String(v));
});
test("the rest map onto the hero's words", () => {
  assert.equal(displayWord("WATCH"), "STALKING");
  assert.equal(displayWord("REDUCE"), "STALKING");
  assert.equal(displayWord("ARMED_CALL"), "ARMED");
  assert.equal(displayWord("ARMED_PUT"), "ARMED");
  assert.equal(displayWord("TAKE"), "ENTER");
  assert.equal(displayWord("MANAGE"), "MANAGING");
  assert.equal(displayWord("OPEN"), "IN TRADE");
});
test("the raw value survives in the tooltip", () => {
  assert.equal(wordTitle("STAND_DOWN"), "WAIT — engine value: STAND_DOWN");
  assert.equal(wordTitle("WAIT"), "WAIT");
});
