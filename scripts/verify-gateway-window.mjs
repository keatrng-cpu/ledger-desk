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
  if (ok) pass++; else fail++;
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

console.log("\nthe scheduled task must be streaming whenever the trader is signed in");
// Trader's call 2026-10-01: the gateway stays on this PC, and if the desk can
// be open here (signed in) it must not lag. Every check below is a way that
// guarantee silently broke before:
//  - 2026-09-30: one weekday trigger + a 9h kill-limit left ~15h/day dark.
//  - 2026-10-01: a 04:27 CT Windows Update reboot killed the instance, the
//    07:10 trigger was skipped at the sign-in screen, and the trader signed
//    in at 08:24 to a desk on Yahoo (lag ~600s) into the NY open.
//  - the old 6d12h ExecutionTimeLimit itself was a scheduled outage: today's
//    08:31 start would have been killed Wed 20:31 CT and stayed dark until
//    Thursday's 07:10 trigger, through the London session.
ok("starts at sign-in (a reboot must not leave it dark until tomorrow)", /New-ScheduledTaskTrigger -AtLogOn/.test(ps1));
const keepAlive = /-RepetitionInterval \(New-TimeSpan -Minutes (\d+)\)/.exec(ps1);
ok("has a repeating keep-alive trigger", keepAlive != null);
if (keepAlive) ok(`keep-alive re-checks at least every 5 minutes (every ${keepAlive[1]})`, Number(keepAlive[1]) <= 5);
ok("keep-alive repeats indefinitely (no -RepetitionDuration cut-off)", !/-RepetitionDuration/.test(ps1));
const registered = /Register-ScheduledTask[^\n]*-Trigger ([^\n]*?) -Settings/.exec(ps1)?.[1] ?? "";
ok("both triggers are actually registered", /\$logonTrigger/.test(registered) && /\$keepAliveTrigger/.test(registered));
// IgnoreNew is what makes a one-minute repeat safe: a live instance swallows
// the trigger, so there is never a second Databento Live session on the key.
ok("a running instance swallows the keep-alive (MultipleInstances IgnoreNew)", /-MultipleInstances IgnoreNew/.test(ps1));
ok("no execution limit kills a healthy stream (ExecutionTimeLimit 0)", /-ExecutionTimeLimit \(New-TimeSpan -Seconds 0\)/.test(ps1));
// A trigger repeating every minute with WakeToRun would wake a sleeping
// laptop every minute.
ok("never wakes the laptop (no -WakeToRun with a one-minute repeat)", !/-WakeToRun/.test(ps1));
ok("still runs on battery (a laptop: AC-only left it Queued on 2026-09-14)", /-AllowStartIfOnBatteries/.test(ps1) && /-DontStopIfGoingOnBatteries/.test(ps1));

console.log("\nthe gateway must heal itself between keep-alive ticks");
// The keep-alive restarts a DEAD process. A live-but-stalled one is the
// gateway's job: it must reconnect its stream and its DB connection itself.
ok("stream errors reconnect instead of exiting (run_forever loop)", /def run_forever/.test(py) && /stream error — reconnecting/.test(py));
ok("a closed/broken Postgres connection is reopened on the next write", /self\._conn is None or self\._conn\.closed/.test(py));

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
