// fireFix (Keaton 2026-10-13 evening): wire band never above pathBand; envelope $650; quote time from RH updated_at.
import { test } from "node:test";
import assert from "node:assert/strict";
import RULES from "../shared/desk-rules.json" with { type: "json" };

test("rules: fireFix block present, envelope $650, band edges unchanged (rise-only)", () => {
  assert.equal(RULES.fireFix.envelope.maxDebit, 650);
  assert.deepEqual(RULES.bandEdges, { "A+": 0.75, A: 0.68, "A-": 0.65, "B+": 0.6, B: 0.5 });
  for (const k of ["deadZone", "rulesPin", "soleBlocker", "dayLoss", "oneLotT1", "gateHand"]) assert.equal(RULES.fireFix[k].mode, "live", k);
});
