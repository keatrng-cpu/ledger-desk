/** Fail-closed feedDotTone: unknown source/lag red; SYN/Y! never green. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { feedDotTone } = await import("../src/lib/ui/feed-dot.ts");

const DOWN = "bg-[var(--color-down)]";
const WARN = "bg-[var(--color-warn)]";
const UP = "bg-[var(--color-up)]";

test("unknown source with lag ≤15s is red (never green)", () => {
  const t = feedDotTone(["mystery_feed"], 5);
  assert.equal(t.tone, "not-live");
  assert.equal(t.className, DOWN);
  assert.match(t.label, /unrecognized source/i);
});

test("empty sources → red", () => {
  const t = feedDotTone([], 0);
  assert.equal(t.tone, "not-live");
  assert.equal(t.className, DOWN);
});

test("unknown lag (NaN) on live_gateway → red", () => {
  const t = feedDotTone(["live_gateway"], Number.NaN);
  assert.equal(t.tone, "not-live");
  assert.equal(t.className, DOWN);
  assert.match(t.label, /lag unknown/i);
});

test("SYN with lag 0 → red, never green", () => {
  const t = feedDotTone(["synthetic"], 0);
  assert.equal(t.tone, "not-live");
  assert.equal(t.className, DOWN);
  assert.notEqual(t.className, UP);
});

test("Y! with lag 0 → amber, never green", () => {
  const t = feedDotTone(["yahoo"], 0);
  assert.equal(t.tone, "delayed");
  assert.equal(t.className, WARN);
  assert.notEqual(t.className, UP);
});

test("live_gateway lag 5s → green", () => {
  const t = feedDotTone(["live_gateway"], 5);
  assert.equal(t.tone, "live");
  assert.equal(t.className, UP);
});
