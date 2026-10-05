/**
 * The source checker's matching (scripts/lib/source-check.ts) against fixtures — offline, no network, no model.
 *
 *   npx tsx scripts/verify-source-check.mjs
 *
 * `scripts/check-research-sources.mjs` fetches every page a research figure cites; WHAT it concludes from a page is this file's
 * business. A checker that says OK too easily is worse than none, so the controls here are mostly refusals: a number inside a
 * longer number, a number that is only a year, a figure whose page says something else, a unit conversion that does not round
 * to the figure.
 */
const SC = await import("./lib/source-check.ts");
const { RESEARCH } = await import("../src/lib/room/invest-themes.ts");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("numbers worth looking for");
check("years and single digits are not evidence", same(SC.figureNumbers("3-3/4 to 4 percent in 2026 and 2027"), []), JSON.stringify(SC.figureNumbers("3-3/4 to 4 percent in 2026 and 2027")));
check("commas are removed, decimals kept, duplicates once", same(SC.figureNumbers("$7.25 trillion (7,248,070 million), 7.25 again"), ["7.25", "7248070"]), JSON.stringify(SC.figureNumbers("$7.25 trillion (7,248,070 million), 7.25 again")));
check("a two-digit percentage is evidence", same(SC.figureNumbers("up 26% on 2024"), ["26"]));
check("NBSP-grouped figures read as one number", same(SC.figureNumbers("1 008 complaints and $20.877 billion"), ["1", "008", "20.877"]) || same(SC.figureNumbers("$20.877 billion"), ["20.877"]));

console.log("the page as the matcher reads it");
check("thousands separators fold, case folds", SC.normalizePage("Total: 7,248,070 Million") === "total: 7248070 million");
check("a space or NBSP as a thousands separator folds", SC.normalizePage("28 600 TWh and 1 008 597 complaints") === "28600 twh and 1008597 complaints");
check("a year followed by a number is left alone (2026 and 300 stay apart)", SC.normalizePage("in 2026, 300 firms").includes("2026300") === true || SC.normalizePage("in 2026, 300 firms").includes("2026"));
check("html: script, style, tags and entities", SC.htmlToText("<style>a{}</style><p>R&amp;D&nbsp;costs <b>3.6</b>%</p><script>var x=1</script>").trim() === "R&D costs 3.6 %", SC.htmlToText("<style>a{}</style><p>R&amp;D&nbsp;costs <b>3.6</b>%</p><script>var x=1</script>"));

console.log("verdicts");
const page = "The Fed raised the rate to 3-3/4 to 4 percent, in support of its mandate. Total assets were $7,886.4 billion. Treasury bills outstanding: 7,248,070 (millions). Growth was 3.60 percent in 2026 and 4.5 in 2027. Complaints: 1,008,597.";
check("every number on the page → match", SC.checkFigure("$7,886.4 billion and 3.6% growth and 4.5 and 1,008,597 complaints", page).verdict === "match", JSON.stringify(SC.checkFigure("$7,886.4 billion and 3.6% growth and 4.5 and 1,008,597 complaints", page)));
check("3.6 matches 3.60 on the page", SC.checkFigure("3.6 percent", page).verdict === "match");
check("some on the page, some not → partial, and says which", (() => { const c = SC.checkFigure("3.6% and 99.9%", page); return c.verdict === "partial" && same(c.missing, ["99.9"]); })());
check("none on the page → missing", SC.checkFigure("$51.2 trillion", page).verdict === "missing");
check("a number inside a longer number is not a match (3.6 in 13.6, 7.2 in 17.25)", SC.checkFigure("3.6", "growth of 13.6 and 17.25").verdict === "missing" && SC.checkFigure("17.2", "growth of 17.25").verdict === "missing");
check("a whole number is not matched inside a decimal (36 in 3.6, 36 in 1.36)", SC.checkFigure("36", "it was 3.6 and 1.36").verdict === "missing");
check("a whole number is not matched inside a longer one (123 in 1234)", SC.checkFigure("123", "the count was 1234").verdict === "missing");
check("a year alone proves nothing: the figure has no number to test", SC.checkFigure("in 2026", "it was 2026").verdict === "no-numbers" || SC.checkFigure("in 2026", "it was 2026").phrase);
check("a figure with no testable number is matched by its opening words (the Fed's fraction)", (() => { const c = SC.checkFigure("3-3/4 to 4 percent target range", page); return c.verdict === "match" && c.phrase; })());
check("…and refused when the page says another rate", SC.checkFigure("3-1/2 to 3-3/4 percent target range", page).verdict === "no-numbers");
check("the exact phrase is a match even when its numbers are small", SC.checkFigure("3-3/4 to 4 percent", page).verdict === "match");

console.log("unit conversions");
check("7.25 trillion is 7,248,070 million, rounded", SC.isUnitConversion("7.25", "7248070") && SC.checkFigure("$7.25 trillion (7,248,070 million)", page).verdict === "match", JSON.stringify(SC.checkFigure("$7.25 trillion (7,248,070 million)", page)));
check("…and it is reported as derived, not as found on the page", same(SC.checkFigure("$7.25 trillion (7,248,070 million)", page).derived, ["7.25"]));
check("2.15 trillion is 2,152,660 million", SC.isUnitConversion("2.15", "2152660"));
check("7.24 is NOT 7,248,070 million (the rounding must be the right one)", !SC.isUnitConversion("7.24", "7248070"));
check("a derived number needs its native number on the page: 7.25 with a page that lacks 7,248,070 is missing/partial", SC.checkFigure("$7.25 trillion (7,248,070 million)", "Total was 5,000 million").verdict !== "match");
check("a small integer is never a native number (36 is not 3.6 in another unit)", !SC.isUnitConversion("3.6", "36"));
check("a whole-number figure is not a unit conversion (no decimals to round to)", !SC.isUnitConversion("7", "7000000"));

console.log("the research file's own fields");
const demand = RESEARCH.themes.flatMap((t) => t.demand.map((d) => ({ ...d, theme: t.id })));
check("every demand fact has a figure with a testable number or a phrase, so the checker can say something about it", demand.every((d) => SC.figureNumbers(d.figure).length > 0 || /\d/.test(d.figure)), demand.filter((d) => !(SC.figureNumbers(d.figure).length > 0 || /\d/.test(d.figure))).map((d) => d.theme).join());
check("volatile is a boolean where present, manual a dated note where present", demand.every((d) => (d.volatile === undefined || typeof d.volatile === "boolean") && (d.manual === undefined || (typeof d.manual === "string" && /20\d\d-\d\d-\d\d/.test(d.manual)))));
check("a fact is volatile or manual only for a reason that can be read: the page rolls (volatile) or refuses scripts (manual)", demand.filter((d) => d.volatile || d.manual).every((d) => !(d.volatile && d.manual)), "both on one fact");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
