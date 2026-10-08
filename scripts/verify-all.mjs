/**
 * Every verifier in the repo, discovered rather than listed.
 *
 *   npm run verify:all
 *
 * WHY DISCOVERY AND NOT A HARDCODED CHAIN
 * package.json already carried a dozen `verify:*` entries and no way to run
 * them together, so in practice each one ran when somebody remembered it.
 * That is the same failure as a dark module: the check exists, passes, and
 * changes nothing. A hardcoded chain has the same rot — a verifier added next
 * week is not in it, and nobody notices for a month.
 *
 * So this globs `scripts/verify-*.mjs` and runs all of them. A new verifier is
 * included the moment it is written, which is the only version of this that
 * stays true.
 *
 * It is also what the pre-push hook runs, so the guards actually bite.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPTS = join(ROOT, "scripts");

// This file itself, obviously. `measure-*` are research runs, not assertions:
// they print findings and legitimately have no pass/fail.
const SKIP = new Set(["verify-all.mjs"]);

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
/**
 * --baseline: fail only on a NEW break.
 *
 * WHY: a gate nobody can pass is a gate nobody runs. Eight verifiers were red on main at once, so every push needed
 * --no-verify, so nothing was checked at all — which is how two typecheck errors and a changed constant with stale tests
 * reached main and deployed. The baseline records what is ALREADY red, with the reason and the date. A verifier that is
 * red and known, with no MORE failures than recorded, is reported and does not block. Anything worse, or anything new,
 * blocks. A known-red verifier that now passes is reported as fixed so the entry gets removed rather than rotting.
 * --update-baseline rewrites the file from this run; it is deliberately explicit, never automatic.
 */
const useBaseline = process.argv.includes("--baseline") || process.argv.includes("--update-baseline");
const writeBaseline = process.argv.includes("--update-baseline");
const BASELINE = new URL("./verify-baseline.json", import.meta.url);
let baseline = { capturedAt: null, onCommit: null, known: {} };
if (useBaseline && existsSync(BASELINE)) {
  try { baseline = JSON.parse(readFileSync(BASELINE, "utf8")); } catch { /* a corrupt baseline must not hide a break: known stays empty */ }
}
const knownOf = (label) => (useBaseline ? baseline.known?.[label] ?? null : null);

const files = readdirSync(SCRIPTS)
  .filter((f) => /^verify-.*\.mjs$/.test(f) && !SKIP.has(f))
  .filter((f) => (only.length ? only.some((o) => f.includes(o)) : true))
  .sort();

if (!files.length) {
  console.error("no verifiers matched");
  process.exit(1);
}

const t0 = Date.now();
const failed = [];
const knownRed = [];
const fixed = [];
const seen = {};
let ran = 0;

for (const f of files) {
  const label = f.replace(/^verify-|\.mjs$/g, "");
  process.stdout.write(`  ${label.padEnd(26)}`);
  // A RELATIVE path, deliberately. The repo lives under "New folder (6)", and
  // Windows needs shell:true to resolve `npx` — which then splits the absolute
  // path on its space and reports every verifier as "Cannot find module
  // C:\Users\Luxef\New". Relative + cwd has no space in it to split.
  const r = spawnSync("npx", ["tsx", `scripts/${f}`], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  ran++;

  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  // The verifiers do not share a reporter; they share a habit of printing
  // "N passed, M failed". Read that when it is there, and fall back to the
  // exit code — which is the thing that actually decides.
  const m = out.match(/(\d+)\s+passed,\s*(\d+)\s+failed/);
  const ok = r.status === 0;

  const failing = m ? Number(m[2]) : ok ? 0 : 1;
  const known = knownOf(label);
  if (!ok) seen[label] = { failing, why: known?.why ?? "NOT YET EXPLAINED — say what is red and why, or fix it", since: known?.since ?? new Date().toISOString().slice(0, 10) };

  if (ok) {
    console.log(m ? `${m[1]} passed` : "ok");
    if (known) fixed.push(label);
  } else if (known && failing <= known.failing) {
    // Red before this change, and no worse. Reported, not a block.
    console.log(m ? `known red (${m[2]} failing, baseline ${known.failing})` : `known red (exit ${r.status})`);
    knownRed.push({ label, failing, known });
  } else {
    console.log(m ? `FAILED (${m[2]} failing${known ? `, baseline ${known.failing}` : ""})` : `FAILED (exit ${r.status})`);
    failed.push({ label, out, failing, known });
  }
}

console.log(
  `\n${ran - failed.length - knownRed.length}/${ran} verifiers passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
);

if (knownRed.length) {
  console.log(`\n${knownRed.length} already red before this change (reported, not a block):`);
  for (const k of knownRed) console.log(`  ${k.label.padEnd(20)} ${k.failing} failing — ${k.known.why}`);
}
if (fixed.length) {
  console.log(`\nFIXED — green again, delete from scripts/verify-baseline.json: ${fixed.join(", ")}`);
}
if (writeBaseline) {
  const next = {
    capturedAt: new Date().toISOString().slice(0, 10),
    onCommit: process.env.GIT_SHA ?? null,
    note: "Verifiers already red when this was captured. `--baseline` blocks only on a NEW break or a WORSE count. Shrink this list; never grow it to make a push go green.",
    known: seen,
  };
  writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`\nbaseline written: ${Object.keys(seen).length} known-red verifier(s) -> scripts/verify-baseline.json`);
}

if (failed.length) {
  for (const f of failed) {
    console.log(`\n───── ${f.label} ─────`);
    // Only the failing lines plus the tail, so a broken push is readable.
    const lines = f.out.split("\n");
    const interesting = lines.filter((l) => /FAIL|✗|Error|error/i.test(l));
    for (const l of interesting.slice(0, 20)) console.log(l);
    if (!interesting.length) console.log(lines.slice(-15).join("\n"));
  }
  console.log(`\n${failed.length} verifier(s) failed: ${failed.map((f) => f.label).join(", ")}`);
}

process.exit(failed.length ? 1 : 0);
