/**
 * The day's change is measured from the PRIOR SESSION's close — never from
 * the start of whatever chart window happens to be loaded.
 *
 * Found 2026-10-01: with the gateway live, the HUD printed MNQ +5.58% and
 * ES +1.19% while both were down on the day. quoteFromLiveTick was handed
 * `series.previousClose`, which is Yahoo's `chartPreviousClose` — the close
 * BEFORE THE CHART WINDOW, i.e. a month ago on the desk's 1mo/15m series.
 * That number did not stay on the HUD: structure.smtRead's no-divergence
 * fallback compares the two books' changePct, so a one-month return gap
 * could print `bullish_smt` and score as an SMT confluence hit.
 *
 * This file checks the baseline itself (freshest.ts priorSessionClose) on
 * every session boundary that can trip it, AND checks the two quote paths
 * still route through it — a correct helper that nothing calls is the
 * failure this repo keeps finding.
 *
 * Run: npx tsx scripts/verify-day-change.mjs
 */
import { readFileSync } from "node:fs";

const { priorSessionClose, globexSessionStartMs, rebaseQuote } = await import("../src/lib/market/freshest.ts");
const { etWallToEpochMs, etWallParts } = await import("../src/lib/trading/sessions.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => check(name, !!cond, true);

const bar = (d, t, c) => ({ t: etWallToEpochMs(d, t), o: c, h: c, l: c, c, v: 1 });

console.log("\nthe baseline is the prior Globex session's last print (sessions run 18:00 -> 17:00 ET)");
const week = [
  bar("2026-09-29", "16:45", 100), // Tue close
  bar("2026-09-29", "18:00", 101), // Wed session opens
  bar("2026-09-30", "09:30", 102),
  bar("2026-09-30", "16:45", 103), // Wed close
  bar("2026-09-30", "18:00", 104), // Thu session opens
  bar("2026-10-01", "09:30", 105),
];
check("weekday morning: yesterday's last print", priorSessionClose(week), 103);
check("after the 18:00 open: the new session is measured vs the one that just closed", priorSessionClose(week.slice(0, 5)), 103);
check("in the 17:00 halt: the session that just closed is measured vs the one before", priorSessionClose(week.slice(0, 4)), 100);

const weekend = [
  bar("2026-09-24", "16:45", 200), // Thu close
  bar("2026-09-25", "09:30", 201),
  bar("2026-09-25", "16:45", 202), // Fri close
  bar("2026-09-27", "18:00", 203), // Sunday reopen
];
check("over the weekend: Friday is measured vs Thursday", priorSessionClose(weekend.slice(0, 3)), 200);
check("Sunday reopen: measured vs Friday's close", priorSessionClose(weekend), 202);
check("no prior-session bar: null, never a guess", priorSessionClose([bar("2026-10-01", "09:30", 1)]), null);
check("no bars: null", priorSessionClose([]), null);

// 2026-11-01 is the US fall-back Sunday.
const p = etWallParts(globexSessionStartMs(etWallToEpochMs("2026-11-02", "09:30")));
check("DST week: the session still starts 18:00 ET the prior day", `${p.month}/${p.day} ${p.hour}:${String(p.minute).padStart(2, "0")}`, "11/1 18:00");

console.log("\nthe regression itself: a month-old window start must not become the day's baseline");
const month = [bar("2026-09-07", "09:15", 29125.5), ...week.slice(0, 4), bar("2026-09-30", "18:00", 30855), bar("2026-10-01", "09:30", 30751.5)];
const base = priorSessionClose(month);
ok(`baseline is Wednesday's close (${base}), not the window's first bar (29125.5)`, base === 103);
const q = rebaseQuote({ price: 30751.5, previousClose: 29125.5, change: 1626, changePct: 5.58 }, 30855);
ok(`a live quote rebased onto the session reads ${q.changePct.toFixed(2)}% (down), not +5.58%`, q.changePct < 0 && q.changePct > -1);
check("rebaseQuote leaves an unknown baseline alone", rebaseQuote({ price: 1, changePct: 7 }, null).changePct, 7);

console.log("\nboth quote paths actually use it");
const desk = readFileSync("src/lib/trading/build-desk.ts", "utf8");
const dual = readFileSync("src/lib/market/fetch-dual.ts", "utf8");
ok("build-desk quote() computes priorSessionClose from the series", /priorSessionClose\(series\.bars\)/.test(desk));
ok("build-desk rebases a Yahoo/Databento quote onto it", /rebaseQuote\(picked, sessionPrev\)/.test(desk));
ok("fetch-dual hands loadQuote the session baseline", /loadQuote\(data\.left, priorSessionClose\(left\.bars\)/.test(dual));
ok("fetch-dual rebases a Yahoo quote onto it", /rebaseQuote\(picked, previousClose/.test(dual));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
