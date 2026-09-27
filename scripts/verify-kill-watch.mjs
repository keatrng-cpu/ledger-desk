/**
 * The kill-rule monitor, after the 2026-09-26 fix.
 *
 * The monitor called xAI's Live Search, which xAI removed on 2026-01-12
 * (HTTP 410). The refusals held — every check read NO INFORMATION rather
 * than all-clear — but it had never returned a source. Pinned here:
 *   1. The Responses-API parser reads sources from BOTH places xAI puts
 *      them (url_citation annotations and top-level `citations`, strings or
 *      objects), de-duplicates, drops non-http, and caps.
 *   2. No sources → NO INFORMATION, with any prose labelled unsourced.
 *   3. The weekly floor and the look-back window.
 *   4. Judgements are a person's, append-only, and only a LATEST tripped
 *      judgement counts.
 *   5. The server calls the live endpoint and the live tool, and never the
 *      retired one.
 *
 * Run: npx tsx scripts/verify-kill-watch.mjs
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => check(name, !!cond, true);

const mem = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
  dispatchEvent() {},
  addEventListener() {},
  removeEventListener() {},
};

const K = await import("../src/lib/invest/kill-watch.ts");
const KS = await import("../src/lib/invest/kill-store.ts");

console.log("\nparser — both places xAI puts sources");
const annotated = {
  output: [
    { type: "reasoning", summary: [] },
    { type: "web_search_call", status: "completed" },
    {
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: "No evidence found that this condition is satisfied.",
          annotations: [
            { type: "url_citation", url: "https://www.sec.gov/a.htm", title: "10-Q" },
            { type: "url_citation", url: "https://www.sec.gov/a.htm", title: "dup" },
            { type: "url_citation", url: "javascript:alert(1)", title: "bad" },
          ],
        },
      ],
    },
  ],
};
const p1 = K.parseXaiResponse(annotated);
check("annotation URLs are read", p1.citations.map((c) => c.url), ["https://www.sec.gov/a.htm"]);
check("the first title seen is kept", p1.citations[0].title, "10-Q");
const numbered = K.parseXaiResponse({ output: [{ type: "message", content: [{ type: "output_text", text: "x", annotations: [{ type: "url_citation", url: "https://www.sec.gov/c.htm", title: "1" }, { type: "url_citation", url: "https://www.sec.gov/d.htm", title: "[2]" }] }] }] });
check("a footnote number is not a title — the link falls back to its host", numbered.citations.map((c) => c.title), [null, null]);
check("nor is the URL repeated as a title", K.parseXaiResponse({ citations: [{ url: "https://www.sec.gov/e.htm", title: "https://www.sec.gov/e.htm" }] }).citations[0].title, null);
check("the text is the output_text", p1.text, "No evidence found that this condition is satisfied.");
const p2 = K.parseXaiResponse({ output: [], citations: ["https://ir.example.com/x", "ftp://nope", 7] });
check("top-level string citations are read, non-http dropped", p2.citations.map((c) => c.url), ["https://ir.example.com/x"]);
const p3 = K.parseXaiResponse({ citations: [{ url: "https://www.nrc.gov/y", title: "NRC" }] });
check("top-level object citations are read", p3.citations, [{ url: "https://www.nrc.gov/y", title: "NRC" }]);
const many = { citations: Array.from({ length: 12 }, (_, i) => `https://s${i}.example.com/`) };
check("capped", K.parseXaiResponse(many).citations.length, K.MAX_CITATIONS);
check("malformed payloads yield nothing, never throw", K.parseXaiResponse(null), { text: "", citations: [] });
check("a string payload yields nothing", K.parseXaiResponse("410 Gone"), { text: "", citations: [] });
const both = K.parseXaiResponse({ ...annotated, citations: ["https://www.sec.gov/a.htm", "https://other.example.org/z"] });
check("both sources merge without duplicates", both.citations.map((c) => c.url), ["https://www.sec.gov/a.htm", "https://other.example.org/z"]);

console.log("\nno sources is no information");
const bare = K.summaryFor({ text: "Nothing happened, all clear.", citations: [] });
ok("an unsourced answer says NO INFORMATION", /NO INFORMATION/.test(bare));
ok("and labels the prose as not evidence", /unsourced and therefore not evidence/.test(bare));
check("a sourced answer shows the prose", K.summaryFor({ text: "found it", citations: [{ url: "https://a.b", title: null }] }), "found it");

console.log("\nthe weekly floor and the window");
const now = Date.parse("2026-09-26T12:00:00Z");
check("first run looks back 30 days", K.sinceDaysFor(null, now), 30);
check("a run 3 days ago still looks back the 7-day floor", K.sinceDaysFor("2026-09-23T12:00:00Z", now), 7);
check("a run 20 days ago looks back 20 — no gap between checks", K.sinceDaysFor("2026-09-06T12:00:00Z", now), 20);
check("never more than 90", K.sinceDaysFor("2026-01-01T00:00:00Z", now), 90);
check("inside the floor the check is refused", K.isDue({ lastCheckedAt: "2026-09-23T12:00:00Z" }, now).due, false);
check("after it, allowed", K.isDue({ lastCheckedAt: "2026-09-18T12:00:00Z" }, now).due, true);
ok("the query carries the date window in its own words", K.killQueries(now, 7).every((q) => q.query.includes("on or after 2026-09-19")));

console.log("\njudgements — a person's, append-only, latest wins");
check("nothing judged yet", KS.trippedTickers().size, 0);
KS.judgeKill({ ticker: "MSFT", tripped: true, note: "Azure growth 8% for four quarters per 10-Q", killRule: "r", sources: ["https://www.sec.gov/m"] });
check("a TRIPPED judgement counts", KS.trippedTickers().has("MSFT"), true);
KS.judgeKill({ ticker: "MSFT", tripped: false, note: "misread — that was segment growth", killRule: "r", sources: [] });
check("a later not-tripped supersedes it", KS.trippedTickers().has("MSFT"), false);
check("and nothing was deleted", KS.loadKillJudgements().filter((j) => j.ticker === "MSFT").length, 2);
check("latest judgement reads the newest", KS.latestJudgement("MSFT")?.tripped, false);
KS.saveRun({ ranAt: "2026-09-26T12:00:00Z", sinceDays: 30, results: [] });
check("the last run survives a reload", KS.loadLastRun()?.ranAt, "2026-09-26T12:00:00Z");

console.log("\nthe server calls the live API");
const srv = readFileSync(new URL("../src/lib/invest/kill-watch-server.ts", import.meta.url), "utf8");
ok("it posts to /v1/responses", srv.includes("https://api.x.ai/v1/responses"));
ok("with the web_search tool", srv.includes('tools: [{ type: "web_search" }]'));
ok("and never the retired Live Search parameters", !/search_parameters\s*:/.test(srv));
ok("it never returns a tripped verdict from the model", /tripped: null/.test(srv) && !/tripped: true/.test(srv));
ok("each call is budgeted under the ~30s cut", /CHECK_TIMEOUT_MS = 2[0-6]_000/.test(srv));
ok("and the agentic loop is capped", /max_turns: MAX_TURNS/.test(srv) && /const MAX_TURNS = [1-3];/.test(srv));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
