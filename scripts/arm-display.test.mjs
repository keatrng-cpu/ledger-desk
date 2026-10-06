/** Snapshot / stale BP → arm blocked (fail-closed display). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { armDisplay, RH_BP_MAX_AGE_MS } = await import("../src/lib/ui/arm-display.ts");

const NOW = Date.parse("2026-10-06T12:00:00.000Z");

function acct(over = {}) {
  return {
    source: "rh_live",
    cashUsd: 1000,
    optionsBuyingPowerUsd: 500,
    envelopeMinUsd: 150,
    envelopeMaxUsd: 550,
    canFillEnvelope: true,
    asOf: new Date(NOW - 30_000).toISOString(),
    accountNumber: "995386158",
    accountMaskLast4: "6158",
    agenticAllowed: true,
    optionLevel: "option_level_2",
    label: "Agentic",
    isSnapshot: false,
    ...over,
  };
}

test("null account → arm blocked · no account", () => {
  const a = armDisplay(null, NOW);
  assert.equal(a.blocked, true);
  assert.equal(a.reason, "no_account");
  assert.match(a.label, /arm blocked/);
});

test("isSnapshot → arm blocked · snapshot (not just a SNAPSHOT chip)", () => {
  const a = armDisplay(acct({ isSnapshot: true, optionsBuyingPowerUsd: 500, canFillEnvelope: true }), NOW);
  assert.equal(a.blocked, true);
  assert.equal(a.reason, "snapshot");
  assert.equal(a.label, "arm blocked · snapshot");
});

test("fresh live BP ≥ envelope → arm ok", () => {
  const a = armDisplay(acct(), NOW);
  assert.equal(a.blocked, false);
  assert.equal(a.reason, null);
});

test("BP older than RH_BP_MAX_AGE_MS → arm blocked · stale", () => {
  const asOf = new Date(NOW - RH_BP_MAX_AGE_MS - 1).toISOString();
  const a = armDisplay(acct({ asOf }), NOW);
  assert.equal(a.blocked, true);
  assert.equal(a.reason, "stale");
  assert.equal(a.label, "arm blocked · stale");
});

test("below envelope → arm blocked · below envelope", () => {
  const a = armDisplay(acct({ optionsBuyingPowerUsd: 11.56, canFillEnvelope: false }), NOW);
  assert.equal(a.blocked, true);
  assert.equal(a.reason, "below_envelope");
});
