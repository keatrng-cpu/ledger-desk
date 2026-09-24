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

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPTS = join(ROOT, "scripts");

// This file itself, obviously. `measure-*` are research runs, not assertions:
// they print findings and legitimately have no pass/fail.
const SKIP = new Set(["verify-all.mjs"]);

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

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

  if (ok) {
    console.log(m ? `${m[1]} passed` : "ok");
  } else {
    console.log(m ? `FAILED (${m[2]} failing)` : `FAILED (exit ${r.status})`);
    failed.push({ label, out });
  }
}

console.log(
  `\n${ran - failed.length}/${ran} verifiers passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
);

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
