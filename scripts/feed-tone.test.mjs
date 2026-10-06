/**
 * feedTone honesty: unknown lag must never paint green (Accuracy Review).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { feedTone } = await import("../src/lib/ui/feed-tone.ts");

test("unknown lag on Databento / live_gateway is red, not green", () => {
  for (const src of ["databento", "live_gateway"]) {
    for (const lag of [null, undefined]) {
      const t = feedTone([src], lag);
      assert.equal(t.tone, "not-live", `${src} lag=${lag}`);
      assert.match(t.className, /down/);
      assert.match(t.chip, /unknown|not live/i);
    }
  }
});

test("known live lag ≤15s is still green", () => {
  const t = feedTone(["databento"], 8);
  assert.equal(t.tone, "live");
  assert.match(t.className, /up/);
});

test("lag 0 is live only when explicitly known (not coerced from null)", () => {
  assert.equal(feedTone(["live_gateway"], 0).tone, "live");
  assert.equal(feedTone(["live_gateway"], null).tone, "not-live");
});

test("yahoo stays amber even with null lag; synthetic stays red", () => {
  assert.equal(feedTone(["yahoo"], null).tone, "delayed");
  assert.equal(feedTone(["synthetic"], null).tone, "not-live");
  assert.equal(feedTone(["synthetic"], 0).tone, "not-live");
});
