// Plan-file guard + restore finder (2026-10-26). Run: node --test scripts/plan-file-guard.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planFileProblems, weekFileProblems, PLAN_FILES, importedNamesFor, exportedNames, TINY_BYTES } from "./plan-file-guard.mjs";

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

// ── Accuracy Review 2026-10-26 ─────────────────────────────────────────────────────────────────
const withLines = (src, ...extra) => src.replace("export interface Plan", [...extra, "export interface Plan"].join("\n"));

test("normal comments that mention a marker word are NOT stubs (false positives fixed)", () => {
  const big = healthyTs(700);
  assert.ok(Buffer.byteLength(big) > TINY_BYTES);
  const comments = [
    "// placeholder until the Thursday print lands",
    "// PLACEHOLDER values below are replaced by the Sunday restamp",
    "// a truncated range (holiday week) still gets a plan",
    "// keep this in step with the existing code in build-desk.ts",
    "// same shape as the rest of the file: one row per day",
    "/* remaining content of the week is filled by overlayWeekAhead */",
    " * see-file notes in docs/agent-sync.md",
    "const NOTE = 1; // ... existing code",
    "// ... and the range keeps extending into Friday",
    "//",
    "/**",
    " */",
  ];
  for (const c of comments) assert.deepEqual(planFileProblems(WEEK, withLines(big, c)), [], c);
  const prints = JSON.parse(healthyPrints);
  prints[0].note = "placeholder consensus; truncated session; see-file";
  assert.deepEqual(planFileProblems(PRINTS, JSON.stringify(prints, null, 1)), []);
});

test("a marker that is a whole line by itself still fails, even in a full-size file", () => {
  const big = healthyTs(700);
  const stubs = {
    "// ... existing code ...": "existing code",
    "// rest of the file": "rest of the file",
    "  // ... rest of file unchanged ...": "rest of file",
    "// ...": "// ...",
    "/* ... */": "/* ... */",
    "PLACEHOLDER": "PLACEHOLDER",
    "FULL_CONTENT_HERE": "FULL_CONTENT_HERE",
    "// TODO: restore": "TODO: restore",
    "// ... (truncated for brevity in this call; full content from local file will be used in practice)": "TRUNCATED",
    "// ... truncated for this call; full content would be inserted here in a real run": "TRUNCATED",
  };
  for (const [line, marker] of Object.entries(stubs)) {
    const probs = planFileProblems(WEEK, withLines(big, line));
    assert.ok(probs.some((x) => x.includes(`stub marker "${marker}"`)), `${line} -> ${probs.join("; ")}`);
  }
});

test("in a tiny file a marker anywhere still fails (whole-file stubs)", () => {
  for (const src of ["FULL_CONTENT_FROM_FILE", "// RESTORED PLACEHOLDER - full content to follow in next call\nexport const W = 1;\n",
    "PLACEHOLDERPLACEHOLDER", "see-file", "PLACEHOLDER_FIXFULL_CONTENT_HERE"]) {
    for (const p of [WEEK, MONTH, PRINTS]) assert.ok(planFileProblems(p, src).some((x) => x.includes("stub marker")), `${p}: ${src}`);
  }
});

test("partial loss: an imported function that disappears fails; a WEEK_* rollover does not", () => {
  const full = healthyTs(700).replace("export function resolvePlan", "export const WEEK_OCT19_OCT23 = 1;\nexport function weekDayFor(): null { return null; }\nexport function resolvePlan");
  const req = new Map([["resolvePlan", ["a.ts"]], ["weekDayFor", ["b.ts"]], ["Plan", ["c.tsx"]]]);
  assert.deepEqual(planFileProblems(WEEK, full, { requiredExports: req }), []);
  // the 01a7c5a6 shape: ~30 lines shorter, still over the floor, braces balanced, but weekDayFor is gone
  const lost = full.replace("export function weekDayFor(): null { return null; }\n", "");
  const probs = planFileProblems(WEEK, lost, { requiredExports: req });
  assert.equal(probs.length, 1, probs.join("; "));
  assert.match(probs[0], /no longer exports "weekDayFor" \(imported by b\.ts\) — partial loss/);
  // a legitimate restamp: last week's constant rolls over to this week's, file shrinks — no flag
  const rolled = full.replace("WEEK_OCT19_OCT23", "WEEK_OCT26_OCT30").replace(/ {2}\{ id: "row-6\d\d" \},\n/g, "");
  assert.ok(rolled.split("\n").length < full.split("\n").length - 50);
  assert.deepEqual(planFileProblems(WEEK, rolled, { requiredExports: req }), []);
  // without requiredExports the check is off (pure callers keep the old behaviour)
  assert.deepEqual(planFileProblems(WEEK, lost), []);
  assert.deepEqual([...exportedNames("export { a, b as c };\nexport type { T } from './x';\nexport async function f() {}\n")].sort(), ["T", "a", "c", "f"]);
});

/** Scratch repo: healthy plan files + importers, then commits on top. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "plan-guard-"));
  const g = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
  g("init", "-q");
  g("config", "user.email", "t@example.invalid"); g("config", "user.name", "t");
  mkdirSync(join(dir, "src/lib/trading"), { recursive: true }); mkdirSync(join(dir, "src/data"), { recursive: true });
  mkdirSync(join(dir, "src/components"), { recursive: true });
  return { dir, g };
}
const findScript = fileURLToPath(new URL("./find-last-good-plan.mjs", import.meta.url));
const runFinder = (dir, ...a) => spawnSync(process.execPath, [findScript, ...a], { env: { ...process.env, PLAN_ROOT: dir }, encoding: "utf8" });

test("importedNamesFor reads real import shapes and ignores look-alike modules", () => {
  const { dir, g } = scratch();
  try {
    writeFileSync(join(dir, WEEK), healthyTs(700));
    writeFileSync(join(dir, "src/lib/trading/a.ts"), 'import { resolvePlan, type Plan as P } from "./week-ahead";\n');
    writeFileSync(join(dir, "src/components/b.tsx"), 'import {\n  resolvePlan,\n  ROWS,\n} from "@/lib/trading/week-ahead";\nimport { Nope } from "@/lib/trading/week-ahead-panel";\n');
    writeFileSync(join(dir, "src/lib/trading/c.ts"), 'const { resolvePlan: r } = await import("./week-ahead.ts");\n');
    g("add", "-A"); g("commit", "-qm", "x");
    const m = importedNamesFor(dir, WEEK);
    assert.deepEqual([...m.keys()].sort(), ["Plan", "ROWS", "resolvePlan"]);
    assert.deepEqual(m.get("resolvePlan").sort(), ["src/components/b.tsx", "src/lib/trading/a.ts", "src/lib/trading/c.ts"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("finder skips a partial-loss version (01a7c5a6 shape) and returns the last whole one", () => {
  const { dir, g } = scratch();
  try {
    const full = healthyTs(700).replace("export function resolvePlan", "export function weekDayFor(): null { return null; }\nexport function resolvePlan");
    writeFileSync(join(dir, WEEK), full); writeFileSync(join(dir, MONTH), healthyTs(400)); writeFileSync(join(dir, PRINTS), healthyPrints);
    writeFileSync(join(dir, "src/lib/trading/auto-paper.ts"), 'import { weekDayFor } from "./week-ahead";\n');
    g("add", "-A"); g("commit", "-qm", "good");
    const good = g("rev-parse", "HEAD");
    writeFileSync(join(dir, WEEK), full.replace("export function weekDayFor(): null { return null; }\n", "")); g("commit", "-qam", "partial");
    writeFileSync(join(dir, WEEK), GARBAGE); g("commit", "-qam", "garbage");
    const r = runFinder(dir, "--json");
    assert.equal(r.status, 1, r.stderr);
    const week = JSON.parse(r.stdout).find((x) => x.path === WEEK);
    assert.equal(week.lastGood.sha, good);
    assert.equal(week.lastGood.scanned, 3, "partial version scanned and rejected");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("finder in a shallow clone says to run git fetch --unshallow and restores nothing", () => {
  const { dir, g } = scratch();
  const shallow = mkdtempSync(join(tmpdir(), "plan-guard-shallow-"));
  try {
    writeFileSync(join(dir, WEEK), healthyTs(700)); writeFileSync(join(dir, MONTH), healthyTs(400)); writeFileSync(join(dir, PRINTS), healthyPrints);
    g("add", "-A"); g("commit", "-qm", "good");
    writeFileSync(join(dir, WEEK), GARBAGE); g("commit", "-qam", "garbage");
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${dir}`, shallow]);
    const r = runFinder(shallow, "--apply");
    assert.equal(r.status, 3);
    assert.match(r.stderr, /shallow/i);
    assert.match(r.stderr, /git fetch --unshallow/);
    assert.equal(readFileSync(join(shallow, WEEK), "utf8"), GARBAGE, "--apply did nothing");
    // all plan files healthy -> no history needed -> a shallow clone is fine
    writeFileSync(join(shallow, WEEK), healthyTs(700));
    assert.equal(runFinder(shallow).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(shallow, { recursive: true, force: true }); }
});

// Every recorded wipe of the three plan files, and known-good versions, against this repo's history.
// Skipped in a shallow clone (CI checks out depth 1); run locally after `git fetch --unshallow`.
const HISTORY = {
  [WEEK]: {
    bad: ["1c1abc4d", "d3d84be2", "8f68b34b", "4a51a712", "688b663c", "ec2a1ec3", "025f5b3b", "aed6d593", "d3eb1269", "0467fc58",
      "f8505bf5", "bc42d469", "01a7c5a6", "0c84958c", "f150a0f2", "f214a725", "4f111cea", "4655138d", "3c0f39b5", "3edf611a",
      "d2bbeb9d", "29d7cbca", "c6171104", "f967bdd8", "e47a2b65", "4b71ee14", "ceb3f6df", "6e3e4f9a", "2b229cf4", "3b86de13",
      "ecd62190", "4989b23f", "f0147646", "091cd4e9", "25de2764", "79cdbc61", "d7a31b54", "a2e7f634", "c2a6afed", "43b83dd9"],
    good: ["b319c843", "d8d25048", "25db1a07", "24583962"],
  },
  [MONTH]: { bad: ["1c1abc4d", "8f68b34b"], good: ["9a29165f"] },
  [PRINTS]: { bad: ["2a2f9764", "aed6d593", "d3eb1269", "e4a89783", "3c0f39b5", "5aafe4d6", "f967bdd8", "a0df0e31"], good: ["b319c843", "3305aa18"] },
};
const REPO = fileURLToPath(new URL("..", import.meta.url));
const repoGit = (...a) => spawnSync("git", a, { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 });
const haveHistory = repoGit("rev-parse", "--is-shallow-repository").stdout.trim() === "false" && repoGit("cat-file", "-e", "43b83dd9^{commit}").status === 0;

test("every historical wipe still fails and real versions still pass", { skip: haveHistory ? false : "shallow clone / history missing" }, () => {
  for (const [path, { bad, good }] of Object.entries(HISTORY)) {
    const requiredExports = importedNamesFor(REPO, path);
    const at = (sha) => repoGit("show", `${sha}:${path}`).stdout;
    for (const sha of bad) assert.ok(planFileProblems(path, at(sha), { requiredExports }).length > 0, `${sha}:${path} should fail`);
    for (const sha of good) assert.deepEqual(planFileProblems(path, at(sha), { requiredExports }), [], `${sha}:${path} should pass`);
  }
});
