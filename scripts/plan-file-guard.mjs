/**
 * Refuse the restamp failure that has emptied the week plan on main.
 *
 * Cash-close and Sunday restamps keep replacing whole files with a token
 * (READ_FROM_FILE_AHEAD, READ_FROM_FILE_PRINTS, PLACEHOLDER_AHEAD,
 * PLACEHOLDER, FULL_CONTENT_FROM_FILE, an unexpanded $(cat /tmp/...) ).
 * The commit message carries the real figures. The file body does not.
 * Typecheck then dies, and the line-floor guard never runs because CI
 * stops on the parse error.
 *
 *   node scripts/plan-file-guard.mjs --worktree
 *   node scripts/plan-file-guard.mjs --staged
 *   node scripts/plan-file-guard.mjs --range <baseSha> <tipSha>
 *
 * --worktree scans the four plan files for a stub token and for the
 * week-ahead / week-prints size floors. CI runs this before typecheck.
 * --staged and --range also refuse a shrink of more than half versus the
 * previous blob. stamp-actuals.mjs calls assertSafePlanWrite before it
 * writes week-prints.json.
 *
 * Exit 0 when clean, 1 when a file would land as a stub.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PLAN_FILES = [
  "src/lib/trading/week-ahead.ts",
  "src/lib/trading/month-ahead.ts",
  "src/data/week-prints.json",
  "src/data/news-calendar.json",
];

/** Strictly more than half the previous bytes removed. Exactly half is allowed. */
export function shrankByMoreThanHalf(before, after) {
  if (before == null || before.length === 0) return false;
  const b = Buffer.byteLength(before);
  const a = Buffer.byteLength(after ?? "");
  return a * 2 < b;
}

/**
 * Tokens a restamp has committed as the entire file. Matching is on the
 * plan files only, so a comment elsewhere that names the bug does not fire.
 */
export function stubHits(text) {
  if (text == null) return ["missing"];
  const hits = [];
  const trimmed = String(text).trim();
  if (/^READ_FROM_FILE_[A-Z0-9_]+$/.test(trimmed) || /READ_FROM_FILE_[A-Z0-9_]+/.test(text)) {
    hits.push("contains a READ_FROM_FILE_* stub");
  }
  if (/^PLACEHOLDER(_[A-Z0-9_]+)?$/.test(trimmed)) hits.push(`file is the stub token ${trimmed}`);
  if (/FULL_CONTENT_FROM_FILE|FULL_CONTENT_HERE/.test(text)) hits.push("contains a FULL_CONTENT_* stub");
  if (/\$\(cat\s+\/tmp\//.test(text)) hits.push("contains an unexpanded $(cat /tmp/...)");
  return hits;
}

/** Size floors for the two files that get replaced. A one-line file fails here even when the token changes. */
export function floorProblems(rel, text) {
  if (text == null) return [`${rel} missing`];
  if (rel === "src/lib/trading/week-ahead.ts") {
    const n = String(text).split("\n").length;
    if (n < 500) return [`${rel} has ${n} lines (floor 500)`];
  }
  if (rel === "src/data/week-prints.json") {
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      return [`${rel} does not parse`];
    }
    if (!Array.isArray(j)) return [`${rel} is not an array`];
    if (j.length < 30) return [`${rel} has ${j.length} entries (floor 30)`];
  }
  return [];
}

export function planWriteProblems(rel, before, after) {
  if (!PLAN_FILES.includes(rel)) return [];
  const problems = [];
  if (after == null) {
    if (before != null) problems.push(`${rel}: deleted`);
    return problems;
  }
  for (const h of stubHits(after)) problems.push(`${rel}: ${h}`);
  if (shrankByMoreThanHalf(before, after)) {
    const b = Buffer.byteLength(before);
    const a = Buffer.byteLength(after);
    problems.push(`${rel}: shrank from ${b} bytes to ${a} bytes (more than half)`);
  }
  return problems;
}

export function assertSafePlanWrite(rel, before, after) {
  const problems = planWriteProblems(rel, before, after);
  if (problems.length) {
    const err = new Error(problems.join("; "));
    err.code = "PLAN_FILE_GUARD";
    throw err;
  }
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function gitShow(rev, rel) {
  try {
    return git(["show", `${rev}:${rel}`]);
  } catch {
    return null;
  }
}

function isZero(sha) {
  return !sha || /^0+$/.test(sha);
}

export function problemsForBlob(rel, before, after) {
  const problems = planWriteProblems(rel, before, after);
  if (after != null) {
    for (const f of floorProblems(rel, after)) problems.push(f);
  }
  return problems;
}

function worktreeProblems() {
  const problems = [];
  for (const rel of PLAN_FILES) {
    let text;
    try {
      text = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      problems.push(`${rel} missing`);
      continue;
    }
    for (const h of stubHits(text)) problems.push(`${rel}: ${h}`);
    problems.push(...floorProblems(rel, text));
  }
  return problems;
}

function stagedProblems() {
  const problems = [];
  let names = "";
  try {
    names = git(["diff", "--cached", "--name-only", "-z"]);
  } catch {
    return ["plan-file-guard: git diff --cached failed"];
  }
  for (const rel of names.split("\0")) {
    if (!rel || !PLAN_FILES.includes(rel)) continue;
    let after = null;
    try {
      after = git(["show", `:${rel}`]);
    } catch {
      after = null;
    }
    const before = gitShow("HEAD", rel);
    problems.push(...problemsForBlob(rel, before, after));
  }
  return problems;
}

function rangeProblems(base, tip) {
  if (!tip) return ["plan-file-guard: --range needs <baseSha> <tipSha>"];
  const problems = [];
  for (const rel of PLAN_FILES) {
    const after = gitShow(tip, rel);
    const before = isZero(base) ? null : gitShow(base, rel);
    problems.push(...problemsForBlob(rel, before, after));
  }
  return problems;
}

function report(problems) {
  if (!problems.length) {
    console.log("plan-file-guard: clean");
    return 0;
  }
  console.error("plan-file-guard BLOCKED:");
  for (const p of problems) console.error("  " + p);
  console.error("Patch the plan file. Do not replace it with a stub token, and do not cut it in half.");
  return 1;
}

function main(argv) {
  if (argv.includes("--worktree")) return report(worktreeProblems());
  if (argv.includes("--staged")) return report(stagedProblems());
  const rangeAt = argv.indexOf("--range");
  if (rangeAt >= 0) return report(rangeProblems(argv[rangeAt + 1], argv[rangeAt + 2]));
  console.error("usage: node scripts/plan-file-guard.mjs --worktree | --staged | --range <baseSha> <tipSha>");
  return 2;
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invoked) process.exit(main(process.argv.slice(2)));
