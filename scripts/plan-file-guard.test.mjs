import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import {
  assertSafePlanWrite,
  floorProblems,
  planWriteProblems,
  rangeProblems,
  shrankByMoreThanHalf,
  stubHits,
} from "./plan-file-guard.mjs";

const WEEK = "src/lib/trading/week-ahead.ts";
const PRINTS = "src/data/week-prints.json";

test("the Nov 18 stub tokens are refused, including inside a larger body", () => {
  for (const token of ["READ_FROM_FILE_AHEAD", "READ_FROM_FILE_PRINTS", "PLACEHOLDER_AHEAD", "PLACEHOLDER_PRINTS", "PLACEHOLDER"]) {
    assert.ok(stubHits(token).length > 0, token);
    assert.ok(stubHits(`${token}\n`).length > 0, token);
  }
  assert.ok(stubHits("export const x = 1;\n// READ_FROM_FILE_AHEAD\n").length > 0);
  assert.ok(stubHits("$(cat /tmp/week-ahead.ts)").length > 0);
  assert.ok(stubHits("FULL_CONTENT_FROM_FILE").length > 0);
  assert.equal(stubHits("Housing Starts printed 1.309M +9.9%.").length, 0);
});

test("a shrink of more than half is refused and exactly half is allowed", () => {
  const before = "x".repeat(1000);
  assert.equal(shrankByMoreThanHalf(before, "x".repeat(500)), false);
  assert.equal(shrankByMoreThanHalf(before, "x".repeat(499)), true);
  const kept = planWriteProblems(WEEK, before, "x".repeat(600) + "\nexport function weekDayFor(){return null;}\n");
  assert.equal(kept.length, 0);
  const cut = planWriteProblems(WEEK, before, "x".repeat(400));
  assert.equal(cut.length, 1);
  assert.match(cut[0], /more than half/);
});

test("deleting a plan file is refused and an unrelated path is ignored", () => {
  assert.match(planWriteProblems(PRINTS, "[]\n", null)[0], /deleted/);
  assert.deepEqual(planWriteProblems("src/lib/trading/scanner.ts", "a".repeat(100), ""), []);
});

test("assertSafePlanWrite throws before a stub can be written", () => {
  assert.throws(() => assertSafePlanWrite(PRINTS, "[]\n", "READ_FROM_FILE_PRINTS"), /READ_FROM_FILE_/);
});

test("week-prints must parse and stay above the entry floor", () => {
  assert.ok(floorProblems(PRINTS, "READ_FROM_FILE_PRINTS").some((p) => /does not parse/.test(p)));
  assert.ok(floorProblems(PRINTS, "[]").some((p) => /floor 30/.test(p)));
  assert.deepEqual(floorProblems(PRINTS, JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ date: "2026-01-01", name: "x", actual: "1", vs: "—", note: String(i) })))), []);
});

test("the worktree copies are not stubs", () => {
  const out = execFileSync("node", ["scripts/plan-file-guard.mjs", "--worktree"], { encoding: "utf8" });
  assert.match(out, /clean/);
});

test("a remote branch deletion is not a plan-file deletion, and a stub tip is still refused", () => {
  const zero = "0".repeat(40);
  assert.deepEqual(rangeProblems("ea0b6d7886155d1dbdadf64f26d8ccddb892f957", zero), []);
  const stub = planWriteProblems(WEEK, "x".repeat(2000), "READ_FROM_FILE_AHEAD\n");
  assert.ok(stub.some((p) => p.includes("READ_FROM_FILE_")));
  assert.ok(stub.some((p) => p.includes("more than half")));
  const hook = readFileSync("scripts/hooks/pre-push", "utf8");
  assert.match(hook, /0000000000000000000000000000000000000000/);
  assert.match(hook, /plan-file-guard\.mjs --range/);
  assert.match(hook, /plan-file-guard\.mjs --worktree/);
  const deleted = spawnSync("sh", ["scripts/hooks/pre-push"], {
    input: `refs/heads/gone ${zero} refs/heads/gone ea0b6d7886155d1dbdadf64f26d8ccddb892f957\n`,
    encoding: "utf8",
  });
  assert.equal(deleted.status, 0, deleted.stdout + deleted.stderr);
  assert.match(deleted.stdout, /deletion only/);
});

test("pre-commit hook runs the plan-file guard and is executable", () => {
  const hook = readFileSync("scripts/hooks/pre-commit", "utf8");
  assert.match(hook, /plan-file-guard\.mjs --staged/);
  assert.ok(statSync("scripts/hooks/pre-commit").mode & 0o111);
  assert.match(execFileSync("git", ["ls-files", "-s", "scripts/hooks/pre-commit"], { encoding: "utf8" }), /^100755 /);
});
