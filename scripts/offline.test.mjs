import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const { isConfigGap, scrubEnv } = await import("../src/lib/ui/offline.ts");
test("config gaps are recognised; env names never survive scrubbing", () => {
  assert.equal(isConfigGap("XAI_API_KEY is not visible to this function"), true);
  assert.equal(isConfigGap("timeout after 25s"), false);
  assert.equal(isConfigGap("set up the feed"), false);
  assert.equal(isConfigGap("invalid api key from the exchange"), false);
  assert.equal(isConfigGap("Set SEC_USER_AGENT on the deploy"), true);
  assert.doesNotMatch(scrubEnv("Set SEC_USER_AGENT on the deploy"), /SEC_USER_AGENT/);
  assert.equal(scrubEnv("CPI 08:30 ET"), "CPI 08:30 ET");
});
