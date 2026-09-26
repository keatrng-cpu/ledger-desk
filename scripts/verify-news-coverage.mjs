/**
 * The news gate must say when it has gone blind.
 *
 * `newsRead` returns "clear" whenever no event is in range — which, past the
 * last stamped release, means the ±15m blackout is switched off rather than
 * that nothing is scheduled. The coverage fields make that visible without
 * changing any verdict (every gate keys on the verdict).
 *
 * The bundled calendar's own coverage is REPORTED, not asserted: a verifier
 * that fails as the calendar ages would block every push the day after the
 * last release. The warning line is the nudge; the Sunday restamp is the fix.
 *
 * Run: npx tsx scripts/verify-news-coverage.mjs
 */

const { newsRead, NEWS_CALENDAR, COVERAGE_MIN_DAYS } = await import("../src/lib/trading/news.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

const now = new Date(Date.UTC(2026, 8, 28, 14, 0)); // Mon 10:00 ET
const ev = (date, timeEt, impact = "high") => ({ date, timeEt, name: `X ${date}`, impact });

console.log("a calendar that ends tomorrow is thin, and says so");
{
  const r = newsRead(now, [ev("2026-09-29", "10:00")]);
  check("the verdict is untouched", r.verdict, "clear");
  check("coverage is flagged thin", r.calendarThin, true);
  check("the end date is reported", r.calendarEnds, "2026-09-29");
  check("the reason names the blind spot", /CALENDAR ENDS 2026-09-29/.test(r.reason), true);
}

console.log("\na calendar two weeks deep is not thin");
{
  const r = newsRead(now, [ev("2026-10-12", "08:30")]);
  check("not thin", r.calendarThin, false);
  check("coverage days", r.coverageDays, 14);
  check("and the reason is the ordinary one", /CALENDAR ENDS/.test(r.reason), false);
}

console.log("\nthe gates are exactly what they were");
{
  const r = newsRead(new Date(Date.UTC(2026, 8, 28, 12, 25)), [ev("2026-09-28", "08:30")]);
  check("a release 5 minutes out is still a blackout", r.verdict, "blackout");
  check("an empty calendar is thin, not an error", newsRead(now, []).calendarThin, true);
  check("threshold", COVERAGE_MIN_DAYS, 3);
}

const live = newsRead(new Date(), NEWS_CALENDAR);
console.log(
  `\n  bundled calendar ends ${live.calendarEnds ?? "—"} (${live.coverageDays ?? "?"} days ahead)` +
    (live.calendarThin ? "  <-- THIN: restamp src/data/news-calendar.json from official schedules" : ""),
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
