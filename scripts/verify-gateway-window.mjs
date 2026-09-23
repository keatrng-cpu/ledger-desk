/**
 * The gateway window, in two languages, must agree.
 *
 * `gateway/databento_live_gateway.py` decides when the Live socket is open.
 * `src/lib/trading/sessions.ts` decides when the DESK BELIEVES it is open —
 * and therefore when it stops labelling quotes as lagged and starts letting
 * the 1m gateway bars replace the closed Yahoo ones.
 *
 * If those two drift apart the failure is silent and it is the worst kind:
 * the desk claims sub-second freshness during minutes when no socket exists,
 * so a stale print gets treated as executable. Nothing throws. Nothing looks
 * wrong. You just trade a ten-minute-old price believing it is live.
 *
 * Both files carry a comment saying they must match. Comments do not run.
 * This does.
 *
 * Run: npx tsx scripts/verify-gateway-window.mjs
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => check(name, !!cond, true);

const py = readFileSync("gateway/databento_live_gateway.py", "utf8");
const ts = readFileSync("src/lib/trading/sessions.ts", "utf8");
const ps1 = readFileSync("gateway/install-task.ps1", "utf8");
const readme = readFileSync("gateway/README.md", "utf8");

const pair = (re, src) => {
  const m = re.exec(src);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

const pyStart = pair(/NY_AM_START = \((\d+), (\d+)\)/, py);
const pyEnd = pair(/NY_AM_END = \((\d+), (\d+)\)/, py);

const tsStartRaw = /NY_AM_LIVE_START_MIN = ([^;]+);/.exec(ts)?.[1] ?? "";
const tsEndRaw = /NY_AM_LIVE_END_MIN = ([^;]+);/.exec(ts)?.[1] ?? "";
// Both are simple arithmetic over integers, e.g. "8 * 60 + 15".
const evalMin = (s) => (/^[\d\s*+]+$/.test(s.trim()) ? Function(`"use strict";return (${s})`)() : null);
const tsStart = evalMin(tsStartRaw);
const tsEnd = evalMin(tsEndRaw);

console.log("\nthe window exists in both languages");
ok("python declares a start", pyStart != null);
ok("python declares an end", pyEnd != null);
ok("typescript declares a start", tsStart != null);
ok("typescript declares an end", tsEnd != null);

console.log("\nand they agree — the whole point of this file");
check("start matches", tsStart, pyStart);
check("end matches", tsEnd, pyEnd);
ok("the window is non-empty", pyEnd > pyStart);

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
console.log(`      window is ${hhmm(pyStart)}–${hhmm(pyEnd)} ET in both`);

console.log("\nthe label a trader reads must be the truth");
const label = /NY_AM_LIVE_LABEL = "([^"]+)"/.exec(ts)?.[1] ?? "";
ok("a label exists", label.length > 0);
ok(`label names the real start (${hhmm(pyStart)})`, label.includes(hhmm(pyStart)));
ok(`label names the real end (${hhmm(pyEnd)})`, label.includes(hhmm(pyEnd)));

console.log("\nthe socket must be up before the 08:30 release, not after it");
// The reason the window moved on 2026-09-23. BLS/BEA/Census print at 08:30 ET;
// a socket opened later marks the shock from a ten-minute-old Yahoo bar.
const RELEASE_MIN = 8 * 60 + 30;
ok("gateway connects before 08:30 ET", pyStart <= RELEASE_MIN);
ok("and is still up well after it", pyEnd > RELEASE_MIN + 60);

console.log("\nthe scheduled task must fire before the window opens");
// The PC runs America/Chicago; CT and ET shift DST together, so ET = CT + 1.
const at = /-At (\d{2}):(\d{2})/.exec(ps1);
ok("the task declares a trigger time", at != null);
const taskEtMin = Number(at[1]) * 60 + Number(at[2]) + 60;
ok(`task fires (${at[1]}:${at[2]} CT = ${hhmm(taskEtMin)} ET) before the window opens`, taskEtMin <= pyStart);
ok("and not absurdly early", pyStart - taskEtMin <= 90);
// A missed trigger must still run — the PC is not always awake at that hour.
ok("task starts when available", /-StartWhenAvailable/.test(ps1));
ok("task can wake the machine", /-WakeToRun/.test(ps1));

console.log("\nthe README must not describe a window that no longer exists");
ok("README names the real window", readme.includes(`${hhmm(pyStart)}–${hhmm(pyEnd)} ET`));
ok(
  "README does not still claim the 08:30 candle is uncovered",
  !/The 08:30 news candle is \*not\* covered live/.test(readme),
);
// The distinction that keeps someone from trading the print.
ok("README separates watching the release from trading it", /do not trade it/i.test(readme));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
