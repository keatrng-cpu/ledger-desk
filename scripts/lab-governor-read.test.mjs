/** Lab card: null = sign in; catch/error = unknown (never sign in). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { labGovernorFromState, labGovernorFromError } = await import("../src/lib/ui/lab-governor-read.ts");

test("null RiskState → offline + sign in", () => {
  const c = labGovernorFromState(null);
  assert.equal(c.status, "offline");
  assert.match(c.primary, /sign in/i);
  assert.doesNotMatch(c.primary, /unknown/i);
});

test("risk read error → unknown, never sign in", () => {
  const c = labGovernorFromError(null, Date.now());
  assert.equal(c.status, "unknown");
  assert.match(c.primary, /Governor unknown — risk read failed/);
  assert.doesNotMatch(c.primary, /sign in/i);
});

test("risk read error includes time since last good when known", () => {
  const now = Date.parse("2026-10-06T12:00:00.000Z");
  const last = now - 45_000;
  const c = labGovernorFromError(last, now);
  assert.equal(c.status, "unknown");
  assert.match(c.primary, /last good 45s ago/);
  assert.doesNotMatch(c.primary, /sign in/i);
});

test("live RiskState maps to live/stale, not sign-in", () => {
  const r = {
    dayPnl: 10,
    dailyLimit: 200,
    weekPnl: 20,
    weeklyLimit: 500,
    killzoneLabel: "AM",
    entriesThisKillzone: 0,
    killzoneCap: 2,
    openTrades: 0,
    dailyHaltHit: false,
    weeklyHaltHit: false,
    killzoneCapHit: false,
  };
  const c = labGovernorFromState(/** @type {any} */ (r));
  assert.equal(c.status, "live");
  assert.doesNotMatch(c.primary, /sign in/i);
});
