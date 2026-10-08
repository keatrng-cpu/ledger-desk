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

const {
  newsRead,
  NEWS_CALENDAR,
  COVERAGE_MIN_DAYS,
  RELEASE_SLOTS_ET,
  SLOT_MIN_SIGHTINGS,
  releaseSlots,
  releaseSlotNow,
  calendarExhausted,
  etDateOf,
  setLiveCalendar,
  clearLiveCalendar,
  liveCalendarState,
  effectiveCalendar,
  LIVE_CALENDAR_MAX_AGE_MIN,
} = await import("../src/lib/trading/news.ts");

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

// ------------------------------------------------------------------
// ITEM 20 — the file goes blind, so the book stands down in the slots.
// ------------------------------------------------------------------

console.log("\nthe release slots are counted off the file, not typed in");
{
  check("the committed file's high-impact slots", RELEASE_SLOTS_ET, ["08:15", "08:30", "10:00", "14:00", "14:30"]);
  check("a slot needs more than one sighting", SLOT_MIN_SIGHTINGS, 2);
  check(
    "one sighting is not a slot",
    releaseSlots([ev("2026-01-02", "07:07"), ev("2026-01-03", "09:09"), ev("2026-01-04", "09:09")]),
    ["09:09"],
  );
  check("a medium-impact time is not a slot", releaseSlots([ev("2026-01-02", "11:00", "medium"), ev("2026-01-03", "11:00", "medium")]), []);
}

console.log("\nthe slot is an ET minute on a weekday");
{
  check("09:46 ET Monday is inside the 10:00 slot", releaseSlotNow(new Date(Date.UTC(2026, 8, 28, 13, 46))), "10:00");
  check("10:16 ET Monday has left it", releaseSlotNow(new Date(Date.UTC(2026, 8, 28, 14, 16))), null);
  check("08:30 ET Friday is a slot", releaseSlotNow(new Date(Date.UTC(2026, 9, 2, 12, 30))), "08:30");
  check("10:00 ET Saturday is not", releaseSlotNow(new Date(Date.UTC(2026, 9, 3, 14, 0))), null);
  check("12:30 ET Monday is not a slot", releaseSlotNow(new Date(Date.UTC(2026, 8, 28, 16, 30))), null);
}

console.log("\nexhausted means past the last row — not before the first");
{
  check("the day after the last row is exhausted", calendarExhausted([ev("2026-09-29", "10:00")], "2026-09-30"), true);
  check("the last row's own day is not", calendarExhausted([ev("2026-09-29", "10:00")], "2026-09-29"), false);
  check("an empty file is exhausted", calendarExhausted([], "2026-09-29"), true);
  // A replay bar from 2023 must NOT fail closed: capture-signals.mjs and the
  // four-year measurement scripts read newsRead at historical timestamps, and
  // blacking those out would rewrite measured evidence that never had it.
  check("a date before the first row is NOT exhausted (that is a replay)", calendarExhausted([ev("2026-09-29", "10:00")], "2023-04-11"), false);
  check("the ET date of 00:30 UTC is the previous day", etDateOf(new Date(Date.UTC(2026, 8, 29, 0, 30))), "2026-09-28");
}

console.log("\na minute that is a known release slot, with the file run out, stands the book down");
{
  const past = new Date(Date.UTC(2026, 8, 30, 14, 0)); // Wed 10:00 ET, one day past the file below
  const r = newsRead(past, [ev("2026-09-29", "10:00")]);
  check("the verdict is a blackout, not clear", r.verdict, "blackout");
  check("it says the calendar is blind", r.calendarBlind, true);
  check("and which slot it is", r.releaseSlotEt, "10:00");
  check("the reason names the date and the slot", /CALENDAR BLIND for 2026-09-30.*10:00 ET/.test(r.reason), true);

  const outside = newsRead(new Date(Date.UTC(2026, 8, 30, 16, 30)), [ev("2026-09-29", "10:00")]); // Wed 12:30 ET
  check("outside every slot a blind file is still clear (it is not a curfew)", outside.verdict, "clear");
  check("but it is reported blind", outside.calendarBlind, true);

  const empty = newsRead(past, []);
  check("an empty calendar in a slot stands down too", empty.verdict, "blackout");

  const covered = newsRead(new Date(Date.UTC(2026, 8, 28, 14, 0)), [ev("2026-09-29", "10:00")]); // Mon 10:00 ET
  check("a file that still covers the day keeps its silence", covered.verdict, "clear");
  check("and is not blind", covered.calendarBlind, false);

  const real = newsRead(new Date(Date.UTC(2026, 8, 30, 14, 2)), [ev("2026-09-30", "10:00")]);
  check("a stamped release still blacks out on its own row", real.verdict, "blackout");
  check("and that reason is the event's, not the blind one", /CALENDAR BLIND/.test(real.reason), false);
}

console.log("\na live calendar is used while it is fresh, and ignored when it is not");
{
  clearLiveCalendar();
  check("with nothing handed over the file is the calendar", effectiveCalendar(Date.UTC(2026, 8, 30)).source, "bundled");
  const atMs = Date.UTC(2026, 8, 30, 12, 0);
  const kept = setLiveCalendar([ev("2026-09-30", "10:00"), { date: "bad", timeEt: "99:99", name: "", impact: "x" }], atMs);
  check("only valid rows are kept", kept.length, 1);
  check("a fresh live calendar is the one read", effectiveCalendar(atMs + 60_000).source, "live");
  const r = newsRead(new Date(Date.UTC(2026, 8, 30, 14, 2)));
  check("and it answers the read", r.calendarSource, "live");
  check("a live row blacks out its own minute", r.verdict, "blackout");
  const staleMs = atMs + (LIVE_CALENDAR_MAX_AGE_MIN + 1) * 60_000;
  check("a day-old live calendar is not fresh", liveCalendarState(staleMs).fresh, false);
  check("and the file takes over again", effectiveCalendar(staleMs).source, "bundled");
  check("rubbish alone does not blank the live rows", setLiveCalendar([{ nope: true }], atMs).length, 1);
  clearLiveCalendar();
  check("cleared", liveCalendarState(atMs).rows.length, 0);
}

const live = newsRead(new Date(), NEWS_CALENDAR);
console.log(
  `\n  bundled calendar ends ${live.calendarEnds ?? "—"} (${live.coverageDays ?? "?"} days ahead)` +
    (live.calendarThin ? "  <-- THIN: restamp src/data/news-calendar.json from official schedules" : ""),
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
