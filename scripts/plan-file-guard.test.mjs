// Plan-file guard + restore finder (2026-10-26). Run: node --test scripts/plan-file-guard.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planFileProblems, weekFileProblems, PLAN_FILES } from "./plan-file-guard.mjs";

const WEEK = "src/lib/trading/week-ahead.ts";
const MONTH = "src/lib/trading/month-ahead.ts";
const PRINTS = "src/data/week-prints.json";
// The exact bytes 1c1abc4 (2026-10-25 "Sunday restamp") left in both TS plan files.
const GARBAGE = "FULL_CONTENT_FROM_FILE";
const healthyTs = (n) => ["export interface Plan { id: string }", "export const ROWS: Plan[] = [",
  ...Array.from({ length: n }, (_, i) => `  { id: "row-${i}" },`), "];", "export function resolvePlan(): Plan | null {", "  return ROWS[0] ?? null;", "}", ""].join("\n");
const healthyPrints = JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ date: "2026-10-01", name: `Print ${i}`, actual: "1", vs: "1", note: "src" })), null, 1);

test("both TS plan files reject the 22-byte 1c1abc4 literal", () => {
  for (const p of [WEEK, MONTH]) {
    const probs = planFileProblems(p, GARBAGE);
    assert.ok(probs.some((x) => x.includes("FULL_CONTENT_FROM_FILE")), p);
    assert.ok(probs.some((x) => /lines \(floor/.test(x)), p);
  }
});

test("month-ahead now has the tight checks (floor 300, shape), week keeps floor 500", () => {
  assert.equal(planFileProblems(MONTH, healthyTs(400)).length, 0);
  assert.ok(planFileProblems(MONTH, healthyTs(200)).some((x) => x.includes("floor 300")));
  assert.ok(planFileProblems(WEEK, healthyTs(400)).some((x) => x.includes("floor 500")));
  assert.equal(planFileProblems(WEEK, healthyTs(700)).length, 0);
  const cut = healthyTs(700);
  assert.ok(planFileProblems(WEEK, cut.slice(0, Math.floor(cut.length * 0.9))).length > 0, "truncated write caught");
});

test("week-prints JSON rules unchanged; back-compat alias", () => {
  assert.equal(planFileProblems(PRINTS, healthyPrints).length, 0);
  assert.ok(planFileProblems(PRINTS, '[{"date":"PLACEHOLDER"}]').length > 0);
  assert.equal(weekFileProblems, planFileProblems);
  assert.deepEqual(PLAN_FILES, [WEEK, MONTH, PRINTS]);
});

test("find-last-good-plan finds the last passing commit per file in a scratch repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "plan-guard-"));
  try {
    const g = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
    g("init", "-q");
    g("config", "user.email", "t@example.invalid"); g("config", "user.name", "t");
    mkdirSync(join(dir, "src/lib/trading"), { recursive: true }); mkdirSync(join(dir, "src/data"), { recursive: true });
    writeFileSync(join(dir, WEEK), healthyTs(700)); writeFileSync(join(dir, MONTH), healthyTs(400)); writeFileSync(join(dir, PRINTS), healthyPrints);
    g("add", "-A"); g("commit", "-qm", "good");
    const good = g("rev-parse", "HEAD");
    writeFileSync(join(dir, WEEK), healthyTs(12)); g("commit", "-qam", "stub");          // the d3d84be-style short placeholder
    writeFileSync(join(dir, WEEK), GARBAGE); writeFileSync(join(dir, MONTH), GARBAGE); g("commit", "-qam", "garbage"); // 1c1abc4-style
    const script = fileURLToPath(new URL("./find-last-good-plan.mjs", import.meta.url));
    const run = (...a) => spawnSync(process.execPath, [script, ...a], { env: { ...process.env, PLAN_ROOT: dir }, encoding: "utf8" });
    const r = run("--json");
    assert.equal(r.status, 1, "exit 1 = broken now, restore found");
    const by = Object.fromEntries(JSON.parse(r.stdout).map((x) => [x.path, x]));
    assert.equal(by[WEEK].ok, false); assert.equal(by[WEEK].lastGood.sha, good); assert.equal(by[WEEK].lastGood.scanned, 3);
    assert.equal(by[MONTH].lastGood.sha, good);
    assert.equal(by[PRINTS].ok, true);
    // --apply restores the working tree only; HEAD does not move
    assert.equal(run("--apply").status, 1);
    assert.equal(planFileProblems(WEEK, readFileSync(join(dir, WEEK), "utf8")).length, 0, "week restored in working tree");
    assert.equal(planFileProblems(MONTH, readFileSync(join(dir, MONTH), "utf8")).length, 0, "month restored in working tree");
    assert.match(g("log", "-1", "--format=%s"), /garbage/, "no commit made");
    assert.ok(g("status", "--porcelain").includes(WEEK), "restore is an uncommitted change");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
