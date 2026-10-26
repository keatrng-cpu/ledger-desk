#!/usr/bin/env node
/**
 * Find the last commit where each plan file passed the plan-file guard, and print the restore.
 *
 *   node scripts/find-last-good-plan.mjs            # report only (exit 1 if any plan file is broken now)
 *   node scripts/find-last-good-plan.mjs --apply    # also `git checkout <sha> -- <file>` (working tree only; never commits)
 *   node scripts/find-last-good-plan.mjs --json     # machine-readable report
 *
 * Why: week-ahead.ts has been gutted and restored by hand at least six times (09-04, 09-20, 09-25,
 * 10-22, 10-23, 10-25). Each restore began with someone walking `git log` to find the last real
 * version. This does that walk with the same checks CI runs (plan-file-guard.mjs), so the answer is
 * the version CI would have accepted, not the newest one that merely looks long.
 *
 * Read-only unless --apply. It restores LAST GOOD content, which may be last week's plan: the new
 * week still has to be written. It never touches desk-rules.json, RULES_HASH, scoring or orders.
 *
 * "Good" includes the partial-loss check: every name another file in THIS checkout imports from the
 * plan file must be exported, so a version like 01a7c5a6 (lost resolveWeekAhead / weekDayFor /
 * weekAheadFocusLine, 30 lines short, still over the floor) is skipped rather than restored.
 *
 * Needs full history. In a shallow clone (CI's actions/checkout defaults to depth 1) the walk would
 * stop at the graft and report "no passing version" or an older-than-real answer, so when a plan file
 * is broken and the clone is shallow it prints `git fetch --unshallow` and exits 3 without guessing.
 *
 * Exit: 0 all ok · 1 broken, restore found · 2 broken, no passing version · 3 shallow clone.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLAN_FILES, planFileProblems, importedNamesFor } from "./plan-file-guard.mjs";

// PLAN_ROOT lets the test point it at a scratch repo; default is this checkout.
const ROOT = process.env.PLAN_ROOT || fileURLToPath(new URL("..", import.meta.url));
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
const args = new Set(process.argv.slice(2));
const MAX = 400;

function readNow(path) {
  try { return readFileSync(join(ROOT, path), "utf8"); } catch { return null; }
}

/** Walk history newest → oldest for one file; first version with zero problems wins. */
export function lastGood(path, { max = MAX, requiredExports } = {}) {
  const log = git("log", `-n${max}`, "--format=%H%x09%cI%x09%s", "--", path).trim();
  let scanned = 0;
  for (const line of log ? log.split("\n") : []) {
    const [sha, when, subject] = line.split("\t");
    scanned++;
    let src;
    try { src = git("show", `${sha}:${path}`); } catch { continue; } // deleted in this commit
    if (planFileProblems(path, src, { requiredExports }).length === 0) {
      const blob = git("rev-parse", `${sha}:${path}`).trim();
      return { sha, blob, when, subject, lines: src.split("\n").length, bytes: Buffer.byteLength(src), scanned };
    }
  }
  return { sha: null, scanned };
}

function isShallow() {
  try { return git("rev-parse", "--is-shallow-repository").trim() === "true"; } catch { return false; }
}

const report = [];
for (const path of PLAN_FILES) {
  const now = readNow(path);
  const requiredExports = importedNamesFor(ROOT, path);
  const problems = planFileProblems(path, now, { requiredExports });
  report.push({ path, ok: problems.length === 0, problems, nowBytes: now == null ? null : Buffer.byteLength(now), requiredExports });
}

if (report.some((r) => !r.ok) && isShallow()) {
  for (const r of report) if (!r.ok) console.error(`BROKEN  ${r.path}: ${r.problems.slice(0, 3).join("; ")}`);
  console.error(
    "\nfind-last-good-plan: this clone is SHALLOW, so the history it would search is cut off and any\n" +
      "\"last good\" answer could be wrong or missing. Run:\n\n    git fetch --unshallow\n\nthen re-run this script. Nothing was restored.",
  );
  process.exit(3);
}

for (const r of report) {
  if (!r.ok) r.lastGood = lastGood(r.path, { requiredExports: r.requiredExports });
  delete r.requiredExports;
}

if (args.has("--apply")) {
  for (const r of report) if (!r.ok && r.lastGood?.sha) { git("checkout", r.lastGood.sha, "--", r.path); r.applied = true; }
}

if (args.has("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const r of report) {
    if (r.ok) { console.log(`ok      ${r.path}`); continue; }
    console.log(`BROKEN  ${r.path} (${r.nowBytes ?? "missing"} B): ${r.problems.slice(0, 3).join("; ")}`);
    const g = r.lastGood;
    if (g?.sha) {
      console.log(`  last good: ${g.sha.slice(0, 8)} ${g.when} (${g.lines} lines, ${g.bytes} B, blob ${g.blob.slice(0, 8)}; ${g.scanned} commits scanned) "${g.subject}"`);
      console.log(`  restore:   git checkout ${g.sha.slice(0, 8)} -- ${r.path}${r.applied ? "   [applied to working tree]" : ""}`);
    } else {
      console.log(`  no passing version in the last ${g?.scanned ?? 0} commits`);
    }
  }
  if (report.some((r) => !r.ok)) console.log("\nRestores last GOOD content (may be last week's plan). The new week still has to be written; commit it yourself.");
}
const broken = report.filter((r) => !r.ok);
process.exit(broken.length === 0 ? 0 : broken.every((r) => r.lastGood?.sha) ? 1 : 2);
