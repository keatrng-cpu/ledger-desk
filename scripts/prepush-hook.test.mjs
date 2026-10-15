import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
test("pre-push is executable on disk and in git (mode 100755)", () => {
  assert.ok(statSync("scripts/hooks/pre-push").mode & 0o111);
  assert.match(execFileSync("git", ["ls-files", "-s", "scripts/hooks/pre-push"], { encoding: "utf8" }), /^100755 /);
});
test("verify-all bounds every verifier; smc-master samples ~160 bars unless SMC_MASTER_FULL=1", () => {
  assert.match(readFileSync("scripts/verify-all.mjs", "utf8"), /timeout: Number\(process\.env\.VERIFY_TIMEOUT_MS \?\? 240_000\)/);
  const s = readFileSync("scripts/verify-smc-master.mjs", "utf8");
  assert.match(s, /SMC_MASTER_SAMPLES \?\? 160/); assert.match(s, /SMC_MASTER_FULL === "1" \? 97/);
});
