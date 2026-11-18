/**
 * CI and verify-all both pick this up: verify-all globs verify-*.mjs, and
 * .github/workflows/ci.yml runs the same check before typecheck so a
 * READ_FROM_FILE_* body fails by name instead of as TS1005.
 *
 *   npx tsx scripts/verify-plan-stubs.mjs
 *
 * The worktree scan is the check. The assertions under it are the mutation
 * test: the guard must reject the tokens that have actually landed on main.
 */
import { spawnSync } from "node:child_process";
import { planWriteProblems, stubHits } from "./plan-file-guard.mjs";

let fail = 0;
const bad = [];
const ok = (c, l) => (c ? null : (fail++, bad.push(l)));

const scanned = spawnSync("node", ["scripts/plan-file-guard.mjs", "--worktree"], { encoding: "utf8" });
ok(scanned.status === 0, scanned.stderr || scanned.stdout || "worktree plan-file guard failed");

ok(stubHits("READ_FROM_FILE_AHEAD").length > 0, "READ_FROM_FILE_AHEAD must be a stub");
ok(stubHits("READ_FROM_FILE_PRINTS").length > 0, "READ_FROM_FILE_PRINTS must be a stub");
ok(
  planWriteProblems("src/lib/trading/week-ahead.ts", "x".repeat(1000), "READ_FROM_FILE_AHEAD").length > 0,
  "writing READ_FROM_FILE_AHEAD over week-ahead.ts must be refused",
);
ok(
  planWriteProblems("src/data/week-prints.json", "x".repeat(1000), "x".repeat(100)).length > 0,
  "a week-prints write that keeps less than half the bytes must be refused",
);

if (fail) {
  console.error(`verify-plan-stubs: ${fail} failed`);
  for (const l of bad) console.error("  " + l);
  process.exit(1);
}
console.log("verify-plan-stubs: clean");
