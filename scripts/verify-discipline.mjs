/**
 * The discipline scorecard — pure arithmetic, pinned.
 *
 * A trade is "rules followed" only with NO mistake tag AND no override. The
 * split, the per-mistake prices and the per-word prices must add up to the
 * rows that went in, and nothing may be invented for an empty book.
 *
 * Run: npx tsx scripts/verify-discipline.mjs
 */

const { disciplineScorecard, MISTAKE_TAGS, EXIT_REASONS, STATE_SCALE, MIN_READ } = await import(
  "../src/lib/journal/discipline.ts"
);

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log("an empty book says so, and invents nothing");
{
  const c = disciplineScorecard([]);
  check("zero closed", c.closed, 0);
  check("no adherence rate at n=0", c.adherence, null);
  check("one honest line", c.lines.length, 1);
  check("which asks for the overrides", /against the desk/.test(c.lines[0]), true);
  check("open trades are not scored", disciplineScorecard([{ status: "open", pnl: null, r: null }]).closed, 0);
}

console.log("\nthe split");
{
  const rows = [
    { status: "closed", pnl: 300, r: 1.5, mistakes: [], override: false, deskWord: "TAKE", stateRating: 2 },
    { status: "closed", pnl: -200, r: -1, mistakes: ["chased"], override: false, deskWord: "TAKE", stateRating: 4 },
    { status: "closed", pnl: 112, r: 0.6, mistakes: [], override: true, deskWord: "STAND", stateRating: 3 },
    { status: "closed", pnl: -250, r: -1.1, mistakes: ["moved_stop", "chased"], override: true, deskWord: "WAIT", stateRating: 5 },
    { status: "open", pnl: null, r: null },
  ];
  const c = disciplineScorecard(rows);
  check("four closed", c.closed, 4);
  check("followed = no mistake AND no override", c.followed.n, 1);
  check("followed money", c.followed.pnl, 300);
  check("an override with no mistake is still 'broken'", c.broken.n, 3);
  check("broken money adds up", c.broken.pnl, 112 - 200 - 250);
  check("adherence 1 of 4", c.adherence, 0.25);
  const chased = c.byMistake.find((m) => m.id === "chased");
  check("a trade with two tags counts under both", chased?.n, 2);
  check("and prices both", chased?.pnl, -450);
  check("costliest habit leads the list", c.byMistake[0]?.id, "chased");
  check("the costliest habit is named in a line", c.lines.some((l) => /chased the print/i.test(l)), true);
  check("by word: STAND counted", c.byWord.find((w) => w.word === "STAND")?.n, 1);
  check("by word sums to closed", c.byWord.reduce((s, w) => s + w.n, 0), 4);
  check("state split is present when both ends exist", c.lines.some((l) => /Impatient\/tilted/.test(l)), true);
  check("small samples say so", /a direction, not a rate/.test(c.lines[0]), true);
}

console.log("\nthe vocabulary is fixed and self-describing");
{
  check("every mistake names the rule it breaks", MISTAKE_TAGS.every((m) => m.rule.length > 10), true);
  check("ids are unique", new Set(MISTAKE_TAGS.map((m) => m.id)).size, MISTAKE_TAGS.length);
  check("the exit vocabulary includes the rule itself", EXIT_REASONS.some((e) => e.id === "t1_runner"), true);
  check("state scale is 1..5", STATE_SCALE.map((s) => s.v), [1, 2, 3, 4, 5]);
  check("read floor matches the override log", MIN_READ, 12);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
