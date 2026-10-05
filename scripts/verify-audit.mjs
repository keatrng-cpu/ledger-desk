/**
 * The desk audit (src/lib/room/audit.ts) against its contract.
 *
 *   npx tsx scripts/verify-audit.mjs
 *
 * WHY: the trader wants the five "analyzing the ledger desk and looking for fixes it needs". The honest form is a ranked list
 * of findings that each rest on a number the desk already holds, with an owner, the evidence line and a proposal addressed
 * to the TRADER — and nothing that can change a rule. This pins that down:
 *
 *   - every finding has a fixed trigger (a synthetic feed, a late Yahoo tape, a goal collision the trader owns, a refusing
 *     gate that cost money on a sample worth quoting, an odds gap over ten points on thirty plans, an idle seat, ...);
 *   - below its sample or threshold it says nothing; when the evidence goes the finding goes;
 *   - the list is ranked high → low and is a pure function of its input (no clock, no model, no randomness);
 *   - the module imports no config, no gate and no size: it cannot write a rule.
 */
const A = await import("../src/lib/room/audit.ts");
const fs = await import("node:fs");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};
const ids = (xs) => xs.map((x) => x.id);

const feed = (kind, lagSec = 0.5) => ({ kind, lagSec });
const goal = (over = {}) => ({
  status: "running",
  pTarget: 0.3,
  pNoCard: 0.1,
  needed: { pStar: 0.5, pWin: null, lambdaMultiple: null, winPct: null },
  collisions: [],
  ...over,
});
const lab = (over = {}) => ({ refusals: [], calibration: null, twins: { n: 0 }, ...over });
const empty = { feed: feed("live_gateway"), goal: null, lab: null, rnd: null, seats: null };

console.log("The feed");
check("a real-time feed raises nothing about data", !ids(A.deskAudit(empty)).some((i) => i.startsWith("feed")));
{
  const out = A.deskAudit({ ...empty, feed: feed("synthetic", null) });
  const it = out.find((x) => x.id === "feed_dark");
  check("a synthetic feed is the one finding that matters first", out[0]?.id === "feed_dark" && it?.severity === "high" && it.owner === "Vince" && it.area === "data");
  check("…and a missing feed says the same", A.deskAudit({ ...empty, feed: feed("none", null) }).some((x) => x.id === "feed_dark"));
  check("the finding goes when the feed becomes real", !ids(A.deskAudit(empty)).includes("feed_dark"));
}
{
  const late = A.deskAudit({ ...empty, feed: feed("yahoo", 600) }).find((x) => x.id === "feed_late");
  check("a Yahoo tape ten minutes late is named, with the lag in the evidence", late && /10 min/.test(late.evidence) && late.severity === "med", JSON.stringify(late));
  check("a Yahoo tape under five minutes is not a finding", !A.deskAudit({ ...empty, feed: feed("yahoo", 120) }).some((x) => x.id === "feed_late"));
}

console.log("The goal");
{
  const col = (id, severity, ask, decision = "A number the trader owns.") => ({ id, severity, title: id, detail: `${id} detail`, decision, ask });
  const out = A.deskAudit({
    ...empty,
    goal: goal({ collisions: [col("cap_vs_contract", "blocker", true), col("frequency", "warn", true), col("floor", "info", true), col("edge", "warn", false)] }),
  });
  check("a collision the trader owns becomes a finding, one each", ids(out).includes("goal_cap_vs_contract") && ids(out).includes("goal_frequency"), JSON.stringify(ids(out)));
  check("information-only and not-the-trader's collisions do not", !ids(out).includes("goal_floor") && !ids(out).includes("goal_edge"));
  check("a blocker is high, a warning medium; Sterling owns them", out.find((x) => x.id === "goal_cap_vs_contract")?.severity === "high" && out.find((x) => x.id === "goal_frequency")?.severity === "med" && out.find((x) => x.id === "goal_frequency")?.owner === "Sterling");
  check("the proposal is the collision's own decision text", out.find((x) => x.id === "goal_frequency")?.proposal === "A number the trader owns.");
}
{
  const hopeless = A.deskAudit({ ...empty, goal: goal({ pTarget: 0.0000003, pNoCard: 0.14, needed: { pStar: 0.6, pWin: 0.62, lambdaMultiple: 7.5, winPct: 40 } }) }).find((x) => x.id === "goal_odds");
  check("odds under 0.1% are called out, with what it would take", hopeless && /under 0.001%/.test(hopeless.evidence) && /62%/.test(hopeless.proposal) && /7\.5×/.test(hopeless.proposal) && /not the gates/.test(hopeless.proposal), JSON.stringify(hopeless));
  check("…and say the chance that nothing prints at all", /14%/.test(hopeless?.evidence ?? ""));
  const impossible = A.deskAudit({ ...empty, goal: goal({ pTarget: 0, winsNeed: 16, tradeBudget: 9 }) }).find((x) => x.id === "goal_odds");
  check("odds of exactly zero say so, with the straight-line arithmetic (16 winners needed, 9 tickets allowed)", /exact odds zero/.test(impossible?.evidence ?? "") && /16 winners in a row/.test(impossible?.evidence ?? "") && /9 tickets/.test(impossible?.evidence ?? ""), JSON.stringify(impossible));
  check("…and when the budget is enough the straight-line clause is left out", !/winners in a row/.test(A.deskAudit({ ...empty, goal: goal({ pTarget: 0.0001, winsNeed: 5, tradeBudget: 9 }) }).find((x) => x.id === "goal_odds")?.evidence ?? ""));
  check("odds of 5% are not a finding", !A.deskAudit({ ...empty, goal: goal({ pTarget: 0.05 }) }).some((x) => x.id === "goal_odds"));
  check("a goal that is over (hit, floor, expired) is not audited for odds", !A.deskAudit({ ...empty, goal: goal({ status: "hit", pTarget: 0 }) }).some((x) => x.id === "goal_odds"));
}

console.log("The ghost room and the card's odds");
{
  const gate = (n, pnlUsd) => ({ gate: "ev", n, wins: 1, pnlUsd });
  check("a gate whose refusals would have made money on 5+ tickets is a low finding", A.deskAudit({ ...empty, lab: lab({ refusals: [gate(5, 120)] }) }).find((x) => x.id === "gate_ev")?.severity === "low");
  check("four tickets, or a refusal that saved money, is not", !A.deskAudit({ ...empty, lab: lab({ refusals: [gate(4, 300), gate(9, -50)] }) }).some((x) => x.id.startsWith("gate_")));
  const odds = (n, meanP, hitRate) => lab({ calibration: { n, meanP, hitRate } });
  check("odds said 40% and printed 22% over 30 plans is a finding for Nova", A.deskAudit({ ...empty, lab: odds(30, 0.4, 0.22) }).find((x) => x.id === "odds_gap")?.owner === "Nova");
  check("a gap of exactly ten points is not (the bar is over ten)", !A.deskAudit({ ...empty, lab: odds(40, 0.4, 0.3) }).some((x) => x.id === "odds_gap"));
  check("29 plans is not enough however large the gap", !A.deskAudit({ ...empty, lab: odds(29, 0.5, 0.1) }).some((x) => x.id === "odds_gap"));
}

console.log("Execution, the R&D board and the seats");
check("the missing server runner is named while the flag is false", A.deskAudit(empty).some((x) => x.id === "runner" && x.owner === "Vince" && x.area === "execution"));
{
  const exp = (status, n = 3, nNeeded = 10) => ({ id: `e${n}${status}`, owner: "Nova", title: "t", status, n, nNeeded, read: "r", proposal: null });
  check("no experiment decided yet is a low note about the window, not about a rule", A.deskAudit({ ...empty, rnd: { experiments: [exp("collecting", 3), exp("collecting", 5)] } }).find((x) => x.id === "rnd_empty")?.severity === "low");
  check("once one has decided the note goes", !A.deskAudit({ ...empty, rnd: { experiments: [exp("collecting", 3), exp("supported", 12)] } }).some((x) => x.id === "rnd_empty"));
  const row = (id, took, declined) => ({ id, name: id, taken: { n: took }, declined: { n: declined } });
  const seats = (touches, rows) => ({ touches, rows });
  check("two seats that never took or declined anything, after 3 touches, are named", A.deskAudit({ ...empty, seats: seats(3, [row("protect", 0, 0), row("press", 0, 0), row("edge", 2, 0), row("room", 0, 0)]) }).find((x) => x.id === "idle_seats")?.evidence.includes("protect and press"));
  check("The Room is never counted idle", !/room/.test(A.deskAudit({ ...empty, seats: seats(5, [row("protect", 0, 0), row("press", 0, 0), row("room", 0, 0)]) }).find((x) => x.id === "idle_seats")?.evidence ?? ""));
  check("two touches is too early to call a seat idle", !A.deskAudit({ ...empty, seats: seats(2, [row("protect", 0, 0), row("press", 0, 0)]) }).some((x) => x.id === "idle_seats"));
}

console.log("The committed data's own age");
{
  const TODAY = "2026-10-05";
  const ago = (n) => new Date(Date.parse(`${TODAY}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  const ahead = (n) => ago(-n);
  const base = { today: TODAY, earningsAsOf: ago(8), researchAsOf: TODAY, macroCalendarEnds: ahead(51), sourceCheck: { checkedAt: TODAY, facts: 35, findings: 0, researchAsOf: TODAY } };
  const FRESH = /^(earnings|research|sources|macro)_/;
  const run = (over = {}) => A.deskAudit({ ...empty, fresh: { ...base, ...over } }).filter((x) => FRESH.test(x.id));
  const one = (over, id) => run(over).find((x) => x.id === id);

  check("data that is current raises nothing", run().length === 0, JSON.stringify(ids(run())));
  check("a world built without a freshness read raises nothing about data either", A.deskAudit({ ...empty }).filter((x) => FRESH.test(x.id)).length === 0 && A.deskAudit({ ...empty, fresh: null }).filter((x) => FRESH.test(x.id)).length === 0);

  check("earnings calendar: 14 days is fine, 15 is ageing (low)", run({ earningsAsOf: ago(14) }).length === 0 && one({ earningsAsOf: ago(15) }, "earnings_ageing")?.severity === "low");
  check("…21 days is still ageing; 22 is out of date (medium), the day the office stops quoting from it", one({ earningsAsOf: ago(21) }, "earnings_ageing") && !one({ earningsAsOf: ago(21) }, "earnings_stale") && one({ earningsAsOf: ago(22) }, "earnings_stale")?.severity === "med" && !one({ earningsAsOf: ago(22) }, "earnings_ageing"));
  const es = one({ earningsAsOf: ago(30) }, "earnings_stale");
  check("it quotes the capture date and the count of days, and who owns it", es && es.evidence.includes(ago(30)) && /30 days ago/.test(es.evidence) && es.owner === "Gemma" && es.area === "data", JSON.stringify(es));

  const aged = (n) => ({ researchAsOf: ago(n), sourceCheck: { ...base.sourceCheck, researchAsOf: ago(n) } }); // a file and the check of that same file
  check("research file: 60 days is fine, 61 is old (low), 91 is stale (medium)", run(aged(60)).length === 0 && one(aged(61), "research_old")?.severity === "low" && one(aged(91), "research_old")?.severity === "med" && /91 days ago/.test(one(aged(91), "research_old").evidence));

  check("no source check on record is a finding, and a report that exists is not", one({ sourceCheck: null }, "sources_unchecked")?.severity === "low" && !one({}, "sources_unchecked"));
  const um = one({ sourceCheck: { ...base.sourceCheck, findings: 2 } }, "sources_unmatched");
  check("figures not found on their pages are a medium finding that quotes the count and the check date", um && um.severity === "med" && /2 of 35/.test(um.evidence) && um.evidence.includes(TODAY), JSON.stringify(um));
  check("a clean check is silent", !one({}, "sources_unmatched"));
  check("a check 35 days old is fine, 36 is a month old", run({ sourceCheck: { ...base.sourceCheck, checkedAt: ago(35) } }).length === 0 && one({ sourceCheck: { ...base.sourceCheck, checkedAt: ago(36) } }, "sources_old")?.severity === "low");
  check("a research file refreshed after its check says the check is of the older file", one({ researchAsOf: ago(1) }, "sources_behind") && /file is now/.test(one({ researchAsOf: ago(1) }, "sources_behind").evidence) && !one({}, "sources_behind"));
  check("a report that predates the dates it was not told about is not a finding (researchAsOf null)", !one({ sourceCheck: { ...base.sourceCheck, researchAsOf: null } }, "sources_behind"));

  check("macro calendar: no events at all is high", one({ macroCalendarEnds: null }, "macro_empty")?.severity === "high");
  check("…it ended yesterday is high and says how long ago, in the singular", /1 day ago/.test(one({ macroCalendarEnds: ago(1) }, "macro_ended")?.evidence ?? "") && one({ macroCalendarEnds: ago(1) }, "macro_ended")?.severity === "high" && /3 days ago/.test(one({ macroCalendarEnds: ago(3) }, "macro_ended")?.evidence ?? ""));
  check("…a week of runway is fine, six days is medium, the last day says today", run({ macroCalendarEnds: ahead(7) }).length === 0 && one({ macroCalendarEnds: ahead(6) }, "macro_ending")?.severity === "med" && /6 days from now/.test(one({ macroCalendarEnds: ahead(6) }, "macro_ending").evidence) && /1 day from now/.test(one({ macroCalendarEnds: ahead(1) }, "macro_ending").evidence) && /, today;/.test(one({ macroCalendarEnds: ahead(0) }, "macro_ending").evidence));

  const bad = A.deskAudit({ ...empty, fresh: { today: "garbage", earningsAsOf: "x", researchAsOf: "", macroCalendarEnds: "nope", sourceCheck: { checkedAt: "??", facts: 1, findings: 0, researchAsOf: null } } }).filter((x) => FRESH.test(x.id));
  check("a date it cannot read raises nothing and never throws", bad.length === 0, JSON.stringify(ids(bad)));

  const worst = A.deskAudit({ ...empty, fresh: { ...base, macroCalendarEnds: ago(2), earningsAsOf: ago(40), sourceCheck: null } });
  check("a macro calendar that ran out ranks above the medium and low data findings", worst[0].id === "macro_ended" && ids(worst).includes("earnings_stale") && ids(worst).includes("sources_unchecked"), JSON.stringify(ids(worst)));
  check("every data finding is owned by one of the five, in the data area, with evidence and a proposal addressed to the trader", worst.filter((x) => FRESH.test(x.id)).every((x) => ["Jax", "Nova", "Gemma", "Sterling", "Vince"].includes(x.owner) && x.area === "data" && x.evidence.length > 10 && x.proposal.length > 10));
  check("a pure function: the same input, the same findings", JSON.stringify(A.deskAudit({ ...empty, fresh: { ...base, earningsAsOf: ago(30) } })) === JSON.stringify(A.deskAudit({ ...empty, fresh: { ...base, earningsAsOf: ago(30) } })));
  check("each finding says what to do and never that anything was changed", worst.filter((x) => FRESH.test(x.id)).every((x) => !/\b(changed|updated|fixed|rewrote|stamped it)\b/i.test(x.evidence + x.proposal)));

  // Spoken: the audit voice reads them, every digit registered, no line over the cap.
  const { exAudit } = await import("../src/lib/room/live-voices-race.ts");
  const { Facts, freshTalkState } = await import("../src/lib/room/live-types.ts");
  const spoken = [];
  for (const it of A.deskAudit({ ...empty, fresh: { ...base, macroCalendarEnds: ahead(2), earningsAsOf: ago(30), researchAsOf: ago(100), sourceCheck: { checkedAt: ago(40), facts: 35, findings: 3, researchAsOf: ago(100) } } }).filter((x) => FRESH.test(x.id))) {
    const f = new Facts();
    const ex = exAudit({ st: freshTalkState(), f, key: `audit|${it.id}`, now: Date.parse(`${TODAY}T17:00:00Z`) }, { item: it });
    if (!ex) { spoken.push(`${it.id}: no exchange`); continue; }
    const text = ex.lines.map((l) => l.text).join(" ");
    const nums = (text.match(/\d[\d,]*\.?\d*/g) ?? []).map((n) => n.replace(/[.,]+$/, ""));
    const unreg = nums.filter((n) => !f.list.includes(n));
    if (unreg.length) spoken.push(`${it.id}: unregistered ${unreg.join()}`);
    const long = ex.lines.filter((l) => l.text.split(/\s+/).length > 42);
    if (long.length) spoken.push(`${it.id}: a line of ${long[0].text.split(/\s+/).length} words`);
    if (/\b(TAKE|STAND|MANAGE|PATH)\b/.test(text)) spoken.push(`${it.id}: a desk verdict word`);
  }
  check("the audit voice reads every data finding: digits registered, no line over the word cap, no verdict word", spoken.length === 0, spoken.join(" | "));
}

console.log("Binding the files (data-fresh.ts)");
{
  const DF = await import("../src/lib/room/data-fresh.ts");
  const read = (p) => JSON.parse(fs.readFileSync(new URL(`../src/data/${p}`, import.meta.url), "utf8"));
  const f = DF.freshnessOf("2026-10-05");
  const ends = read("news-calendar.json").map((e) => e.date).sort().at(-1);
  check("the earnings date is the committed file's capturedAt, the research date its asOf, the macro end its last event (read independently)", f.earningsAsOf === read("earnings-calendar.json").capturedAt && f.researchAsOf === read("invest-themes.json").asOf && f.macroCalendarEnds === ends, JSON.stringify(f));
  check("it carries the day it was asked about", f.today === "2026-10-05");
  const rep = read("source-check-report.json");
  check("the committed source-check report is read as it is (date, fact count, number of findings)", f.sourceCheck && f.sourceCheck.checkedAt === rep.checkedAt && f.sourceCheck.facts === rep.facts && f.sourceCheck.findings === rep.findings.length && f.sourceCheck.researchAsOf === rep.researchAsOf, JSON.stringify(f.sourceCheck));
  check("a report with the wrong shape reads as none, and never throws", DF.readSourceReport(null) === null && DF.readSourceReport(undefined) === null && DF.readSourceReport("x") === null && DF.readSourceReport({}) === null && DF.readSourceReport({ checkedAt: "yesterday", facts: 3, findings: [] }) === null && DF.readSourceReport({ checkedAt: "2026-10-05", facts: -1, findings: [] }) === null && DF.readSourceReport({ checkedAt: "2026-10-05", facts: 3, findings: "none" }) === null);
  check("…a good one reads, and a bad researchAsOf is dropped, not trusted", DF.readSourceReport({ checkedAt: "2026-10-05", facts: 3, findings: [1, 2], researchAsOf: "soon" })?.researchAsOf === null && DF.readSourceReport({ checkedAt: "2026-10-05", facts: 3, findings: [1, 2], researchAsOf: "2026-10-01" })?.findings === 2);
  const src = fs.readFileSync(new URL("../src/lib/room/data-fresh.ts", import.meta.url), "utf8");
  check("the binder reads no clock and no network", !/Date\.now|new Date\s*\(|fetch\s*\(|Math\.random/.test(src));
}

console.log("Ranking and purity");
{
  const full = {
    feed: feed("synthetic", null),
    goal: goal({ pTarget: 0.00001, collisions: [{ id: "x", severity: "warn", title: "A collision", detail: "A detail line.", decision: "A number the trader owns.", ask: true }] }),
    lab: lab({ refusals: [{ gate: "ev", n: 6, wins: 3, pnlUsd: 80 }] }),
    rnd: { experiments: [{ id: "a", owner: "Nova", title: "t", status: "collecting", n: 1, nNeeded: 5, read: "r", proposal: null }] },
    seats: null,
  };
  const out = A.deskAudit(full);
  const rank = { high: 0, med: 1, low: 2 };
  check("ranked high → medium → low", out.every((x, i) => i === 0 || rank[out[i - 1].severity] <= rank[x.severity]), JSON.stringify(out.map((x) => `${x.severity}:${x.id}`)));
  check("a pure function: the same input, the same list", JSON.stringify(A.deskAudit(full)) === JSON.stringify(out));
  check("every finding has an owner among the five, an evidence line and a proposal", out.every((x) => ["Jax", "Nova", "Gemma", "Sterling", "Vince"].includes(x.owner) && x.evidence.length > 3 && x.proposal.length > 3));
  check("ids are unique (a finding is raised once)", new Set(ids(out)).size === out.length);
}

console.log("It cannot write a rule");
{
  const src = fs.readFileSync(new URL("../src/lib/room/audit.ts", import.meta.url), "utf8");
  const imports = [...src.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]);
  check("it imports only the exec flags, two type modules and nothing that sets a number", imports.every((i) => ["./exec/limits", "./orchestrator", "./live-types"].includes(i)), JSON.stringify(imports));
  check("and no config.ts, no gate, no size anywhere in it", !/aplus\/config|sleeve|mandate|setGoal|saveGoal|writeFile|fetch\(|Math\.random|Date\.now/.test(src));
}

console.log(`\naudit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
