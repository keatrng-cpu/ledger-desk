/**
 * The News tab's parser and tags, the schedule's implications, and the IPO
 * rule — against hand-built cases.
 *
 *   1. RSS and Atom parse, CDATA and entities decode, junk items are skipped.
 *   2. Tags come from word lists: a QQQ heavyweight is tier 1 with its weight,
 *      a kill-rule word on a researched name is flagged, a personal-finance
 *      story is tier 3. Short tickers never match as bare letters.
 *   3. The schedule: blackout windows, heavyweight earnings with index weight,
 *      event density, and the calendar's own coverage line.
 *   4. IPOs: fund share classes are not companies; a new listing is in
 *      lock-up, then short of a year of quarters, then only researchable.
 *
 * Run: npx tsx scripts/verify-news-ipo.mjs
 */

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => check(name, !!cond, true);

const F = await import("../src/lib/news/feed.ts");
const S = await import("../src/lib/news/schedule.ts");
const I = await import("../src/lib/invest/ipo.ts");

console.log("\nparsing");
const rss = `<?xml version="1.0"?><rss><channel><title>X</title>
<item><title><![CDATA[Nvidia&#x2019;s export controls hit China sales]]></title><link>https://ex.com/a</link><pubDate>Sun, 27 Sep 2026 11:00:01 GMT</pubDate></item>
<item><title>No link here</title><pubDate>Sun, 27 Sep 2026 11:00:01 GMT</pubDate></item>
<item><title>I&apos;m 77 and live off Social Security</title><link>https://ex.com/b</link><pubDate>garbage</pubDate></item>
</channel></rss>`;
const src = { id: "t", name: "Test", url: "https://ex.com", primary: false };
const items = F.parseFeed(rss, src);
check("an item without a link is skipped", items.length, 2);
check("CDATA and hex entities decode", items[0].title, "Nvidia’s export controls hit China sales");
check("the date is ISO", items[0].published, "2026-09-27T11:00:01.000Z");
check("an unparseable date is null, not a guess", items[1].published, null);
const atom = `<feed><entry><title>Fed holds rates</title><link href="https://fed.example/x"/><updated>2026-09-25T20:30:00Z</updated></entry></feed>`;
check("Atom entries parse, link from href", F.parseFeed(atom, src)[0].link, "https://fed.example/x");
check("garbage in, nothing out", F.parseFeed("not xml", src), []);

console.log("\ntags");
const w = (t) => ({ NVDA: 0.0851, AAPL: 0.0741, MU: 0.0475 })[t] ?? 0;
const dossiers = new Set(["NVDA", "AAPL", "V", "MA"]);
const t1 = F.tagItem(items[0], w, dossiers);
check("Nvidia is matched by name", t1.tickers, ["NVDA"]);
check("a heavyweight mention is tier 1", t1.tier, 1);
check("export controls + China touch NVDA's kill rule", t1.killRule, ["NVDA"]);
ok("the why names the index weight", /8\.5% of QQQ/.test(t1.why));
const pf = F.tagItem(items[1], w, dossiers);
check("a personal-finance story is tier 3", pf.tier, 3);
const visa = F.tagItem({ ...items[0], title: "V is for victory: markets rally" }, w, dossiers);
check("a bare 'V' is not Visa", visa.tickers, []);
const visa2 = F.tagItem({ ...items[0], title: "Visa faces new interchange fee cap bill" }, w, dossiers);
check("'Visa' is Visa", visa2.tickers, ["V"]);
check("and interchange touches its kill rule", visa2.killRule, ["V"]);
const cpi = F.tagItem({ ...items[0], title: "CPI preview: inflation seen cooling" }, w, dossiers);
check("a scheduled-macro topic is tier 1", cpi.tier, 1);
ok("and it belongs to the futures clock", cpi.horizons.includes("day"));
const dup = F.dedupe([t1, { ...t1, id: "z", source: "Other", published: "2026-09-27T12:00:00.000Z" }]);
check("the same story from two outlets is one row", dup.length, 1);
check("ordering puts tier 1 first", F.orderItems([pf, t1])[0].tier, 1);

console.log("\nschedule");
const cpiEv = { date: "2026-10-14", timeEt: "08:30", name: "CPI (Sep)", impact: "high" };
ok("a high-impact print carries its ±15m blackout", S.macroImplication(cpiEv).day.includes("08:15–08:45 ET"));
ok("and says the option premium carries it", /premium/.test(S.macroImplication(cpiEv).swing));
ok("and gives the book nothing to do", /Nothing to do/.test(S.macroImplication(cpiEv).invest));
const fomc = S.macroImplication({ date: "2026-10-28", timeEt: "14:00", name: "FOMC Rate Decision", impact: "high" });
ok("Fed day names both shocks", /14:00/.test(fomc.day) && /14:30/.test(fomc.day));
const tl = S.timeline("2026-10-28", "2026-10-29");
ok("the calendar's Oct 28 FOMC is on the timeline", tl.some((e) => e.kind === "fomc"));
ok("heavyweight earnings carry their QQQ weight", S.timeline("2026-10-29", "2026-10-29").some((e) => e.ticker === "AAPL" && e.qqqWeight > 0.07));
check("Alphabet appears once, not per share class", S.timeline("2026-11-04", "2026-11-04").filter((e) => e.ticker === "GOOG").length, 0);
ok("density counts shocks in a window", S.eventDensity("2026-10-26", "2026-10-30").high >= 3);
ok("the coverage line names the end date", S.coverageLine("2026-09-27").includes("2026-11-25"));
ok("a calendar ending within a week warns", /blind/.test(S.coverageLine("2026-11-22")));

console.log("\nIPOs");
check("an ETF share class is not a company", I.isOperatingCompany("DFA Investment Dimensions Group Inc."), false);
check("a SPAC is not a company", I.isOperatingCompany("Example Acquisition Corp"), false);
check("an operating company is", I.isOperatingCompany("Oura Inc."), true);
const ipo = { company: "Example Co", ticker: "EXM", exchange: "NASDAQ", pricedOn: "2026-06-01", offerPrice: 20, firstDayClose: 30, lockupExpires: null, url: null };
const r1 = I.ipoRead(ipo, "2026-09-27");
check("inside 180 days it is in lock-up", r1.stage, "lockup");
check("the default lock-up ends 180 days after pricing", r1.lockupEnds, "2026-11-28");
check("researchable only after a year of quarters", r1.eligibleFrom, "2027-06-01");
ok("the pop is priced against the offer and attributed to the allocation", /\+50% vs the \$20 offer/.test(r1.line));
check("after the lock-up but inside a year: no record yet", I.ipoRead(ipo, "2027-01-15").stage, "track-record");
check("after a year: researchable, never a buy by itself", I.ipoRead(ipo, "2027-06-02").stage, "research");
check("a prospectus lock-up date wins over the default", I.ipoRead({ ...ipo, lockupExpires: "2026-09-01" }, "2026-09-27").stage, "track-record");
ok("the captured calendar lists operating companies only", I.upcomingIpos("2026-09-27").every((u) => I.isOperatingCompany(u.company)));

console.log("\nsummaries, NFL tags, impact lines, the thesis parser");
const T = await import("../src/lib/news/thesis.ts");
const rssNfl = `<rss><channel><title>x</title><description>channel</description>
<item><title>Chiefs QB Patrick Mahomes questionable vs Dolphins</title><link>https://example.com/a</link><pubDate>Sun, 27 Sep 2026 15:00:00 GMT</pubDate><description><![CDATA[<p>Kansas City's quarterback is <b>questionable</b> with an ankle injury ahead of Sunday's game.</p>]]></description></item>
<item><title>Same words</title><link>https://example.com/b</link><description>Same words</description></item>
</channel></rss>`;
const nflSrc = F.FEEDS.find((f) => f.sport === "nfl");
ok("an NFL feed is wired", nflSrc);
const parsed = F.parseFeed(rssNfl, nflSrc);
check("the feed's description becomes the summary, tags stripped", parsed[0].summary, "Kansas City's quarterback is questionable with an ankle injury ahead of Sunday's game.");
check("a description that repeats the title is dropped", parsed[1].summary, null);
ok("summaries are clipped at a word", F.clip("one two three four five six", 12).endsWith("…") && F.clip("one two three four five six", 12).length <= 13);
const noW = () => 0;
const nfl = F.tagItem(parsed[0], noW, new Set());
check("NFL nickname → the Predict code", nfl.teams, ["KC", "MIA"]);
check("injury news for a team is tier 1", nfl.tier, 1);
ok("and it lands under Predict", nfl.horizons.includes("predict"));
ok("its impact line points at the moneyline", /^Predict: KC\/MIA injury/.test(F.impactOf(nfl, noW)));
const bears = F.tagItem({ id: "b", title: "Bears take control as stocks slide", link: "https://example.com/c", published: null, source: "CNBC", primary: false, summary: null }, noW, new Set());
check("'Bears' in a market headline is not an NFL team", bears.teams, []);
const nv = F.tagItem({ id: "n", title: "Nvidia earnings beat as data center revenue jumps", link: "https://example.com/d", published: null, source: "CNBC", primary: false, summary: null }, (t) => (t === "NVDA" ? 0.09 : 0), new Set());
ok("a QQQ heavyweight gets the index arithmetic", /NVDA is 9\.0% of QQQ — a 5% move in NVDA is ~0\.45% on QQQ/.test(F.impactOf(nv, (t) => (t === "NVDA" ? 0.09 : 0))));
const fed = F.tagItem({ id: "f", title: "Powell signals a rate cut is on the table", link: "https://example.com/e", published: null, source: "Fed", primary: true, summary: null }, noW, new Set());
ok("a Fed headline reads through rates", /^Rates:/.test(F.impactOf(fed, noW)));
check("a headline about nothing here has no impact line", F.impactOf(F.tagItem({ id: "z", title: "Celebrity chef opens a restaurant", link: "https://example.com/z", published: null, source: "Yahoo", primary: false, summary: null }, noW, new Set()), noW), null);
const good = T.parseThesis('```json\n{"headline":"Quiet tape into CPI","summary":["a","b"],"analysis":["c"],"impacts":{"futures":"f","options":"o","investing":"i","predictions":"p"},"watch":["w"],"confidence":"Medium"}\n```');
check("the thesis JSON parses out of a fenced reply", [good.headline, good.summary.length, good.impacts.predictions, good.confidence], ["Quiet tape into CPI", 2, "p", "medium"]);
check("prose instead of JSON is not a thesis", T.parseThesis("The market is quiet today."), null);
check("a thesis with no summary is not a thesis", T.parseThesis('{"headline":"x","summary":[]}'), null);
const input = T.buildThesisInput({ nowEt: "Sun 2:40 PM ET", headlines: [{ source: "CNBC", title: "T", summary: "S", tags: "fed", ago: "5m ago" }], failed: ["ESPN"], pulse: ["VIX 15.00"], calendar: ["2026-09-30 08:30 — X"], games: ["BAL @ DAL"] });
ok("the material names failed feeds so the model searches around them", /did not load.*ESPN/.test(input) && /Headlines \(1/.test(input));
ok("the instructions forbid calls and sizes", /Never tell the reader to buy or sell, never size a position/.test(T.THESIS_INSTRUCTIONS));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
