// Narration + context (2026-10-16): WS-CAL live calendar, actuals, shock explainer, pulse regime, weekly cost.
// Pure — no network: every fetch and every Grok call is injected. Covers the fallbacks and the hard rules
// (flag OFF by default, models never write rows or unregistered digits, RULES_HASH unchanged).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const CL = await import("../src/lib/news/calendar-live.ts");
const N = await import("../src/lib/trading/news.ts");
const A = await import("../src/lib/news/actuals.ts");
const SX = await import("../src/lib/news/shock-explain.ts");
const PR = await import("../src/lib/news/pulse-regime.ts");
const WC = await import("../src/lib/journal/weekly-cost.ts");
const D = await import("../src/lib/journal/discipline.ts");
const V = await import("../src/lib/room/live-voices.ts");
const T = await import("../src/lib/room/live-types.ts");
const H = await import("../src/lib/desk/rules-hash.ts");

/* ── fixtures ── */
// BEA: copied from https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics (fetched 2026-10-16).
const BEA_ICS = `BEGIN:VCALENDAR
VERSION:2.0
TZID:America/New_York
BEGIN:VEVENT
SUMMARY:GDP (Advance Estimate)\\, 3rd Quarter 2026
DTSTART:20261029T123000Z
DURATION:PT30M
END:VEVENT
BEGIN:VEVENT
SUMMARY:Personal Income and Outlays\\, September 2026
DTSTART:20261029T123000Z
END:VEVENT
BEGIN:VEVENT
SUMMARY:U.S. International Trade in Goods and Services\\, Septem
 ber 2026
DTSTART;VALUE=DATE-TIME:20261104T133000Z
END:VEVENT
BEGIN:VEVENT
SUMMARY:Activities of U.S. Affiliates of Foreign Multinational Enterprises
DTSTART:20261120T150000Z
END:VEVENT
END:VCALENDAR`;
// BLS: SYNTHETIC in the documented ICS shape (BLS answered this box 403 even with an identifying UA, so no live copy).
const BLS_ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;TZID=US-Eastern:20261106T083000
SUMMARY:Employment Situation for October 2026
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=US-Eastern:20261110T083000
SUMMARY:Consumer Price Index for October 2026
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=US-Eastern:20261113T083000
SUMMARY:Producer Price Index for October 2026
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261112
SUMMARY:Consumer Price Index (all-day, no minute)
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=US-Eastern:20261103T100000
SUMMARY:Job Openings and Labor Turnover Survey for September 2026
END:VEVENT
END:VCALENDAR`;
// Fed: trimmed from https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm (fetched 2026-10-16), plus a 30-1 case.
const FED_HTML = `<div class="panel panel-default"><div class="panel-heading"><h4><a id="42828">2026 FOMC Meetings</a></h4></div>
<div class="fomc-meeting__month col-xs-5 col-sm-3 col-md-2"><strong>October</strong></div>
<div class="fomc-meeting__date col-xs-4 col-sm-9 col-md-10 col-lg-1">27-28</div>
<div class="fomc-meeting--shaded fomc-meeting__month col-xs-5 col-sm-3 col-md-2"><strong>December</strong></div>
<div class="fomc-meeting__date col-xs-4 col-sm-9 col-md-10 col-lg-1">8-9*</div>
<div class="panel-heading"><h4><a id="42829">2027 FOMC Meetings</a></h4></div>
<div class="fomc-meeting__month col-xs-5"><strong>April/May</strong></div>
<div class="fomc-meeting__date col-xs-4">30-1</div>
<div class="fomc-meeting__month col-xs-5"><strong>August</strong></div>
<div class="fomc-meeting__date col-xs-4">22 (notation vote)</div>`;

const NOW = Date.UTC(2026, 9, 16, 12, 0); // Fri 2026-10-16 08:00 ET
const okRes = (text) => ({ ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) });
const fetchOf = (map) => async (url) => {
  const v = map[url];
  if (v instanceof Error) throw v;
  if (typeof v === "number") return { ok: false, status: v, text: async () => "" };
  return okRes(v);
};
const ALL_OK = { [CL.BLS_ICS_URL]: BLS_ICS, [CL.BEA_ICS_URL]: BEA_ICS, [CL.FED_FOMC_URL]: FED_HTML };
const noCross = async () => ({ ok: false, checked: [], disagreements: [], sources: [], error: "skipped in test" });

/* ── WS-CAL ── */
test("ics: UTC Z instants become ET wall times; folded lines unfold; all-day rows skipped", () => {
  const bea = CL.rowsFromIcs(BEA_ICS, "bea");
  assert.deepEqual(bea.find((r) => r.name.startsWith("GDP")), { date: "2026-10-29", timeEt: "08:30", name: "GDP Q3 (adv)", impact: "high" });
  assert.ok(bea.find((r) => r.name === "PCE / Personal Income (Sep)" && r.timeEt === "08:30"));
  assert.ok(bea.find((r) => r.name === "International Trade (Sep)" && r.date === "2026-11-04" && r.timeEt === "08:30"));
  assert.equal(bea.length, 3, "non-desk BEA releases are not rows");
  const bls = CL.rowsFromIcs(BLS_ICS, "bls");
  assert.deepEqual(bls.map((r) => `${r.date} ${r.timeEt} ${r.name}`).sort(), [
    "2026-11-03 10:00 JOLTS Job Openings (Sep)",
    "2026-11-06 08:30 NFP / Employment Situation (Oct)",
    "2026-11-10 08:30 CPI (Oct)",
    "2026-11-13 08:30 PPI (Oct)",
  ]);
});

test("fed page: decision on the last meeting day, 14:00 + 14:30; month-spanning meeting; notation votes skipped", () => {
  const rows = CL.rowsFromFomcHtml(FED_HTML);
  assert.ok(rows.find((r) => r.date === "2026-10-28" && r.timeEt === "14:00" && r.name === "FOMC Rate Decision"));
  assert.ok(rows.find((r) => r.date === "2026-10-28" && r.timeEt === "14:30" && r.name === "FOMC Press Conference"));
  assert.ok(rows.find((r) => r.date === "2026-12-09"));
  assert.ok(rows.find((r) => r.date === "2027-05-01"), "April/May 30-1 decides on May 1");
  assert.ok(!rows.find((r) => r.date.startsWith("2027-08")), "notation vote skipped");
});

test("flag defaults OFF", () => {
  assert.equal(CL.liveCalendarFlagOn({}), false);
  assert.equal(CL.liveCalendarFlagOn({ NEWS_LIVE_CALENDAR: "0" }), false);
  assert.equal(CL.liveCalendarFlagOn({ NEWS_LIVE_CALENDAR: "1" }), true);
});

test("flag OFF + all sources good: validated, logged, NOT handed to the blackout; newsRead stays bundled", async () => {
  let applied = 0;
  const run = await CL.runLiveCalendar({ fetchImpl: fetchOf(ALL_OK), nowMs: NOW, env: {}, apply: () => applied++, crossCheck: noCross });
  assert.equal(run.ok, true, run.problems.join("; "));
  assert.equal(run.applied, false);
  assert.equal(run.inCharge, "bundled");
  assert.equal(applied, 0);
  assert.equal(N.newsRead(new Date(NOW)).calendarSource, "bundled");
});

test("flag ON + all sources good: rows (validated by the bundled-file validator) go to setLiveCalendar", async () => {
  let got = null;
  const run = await CL.runLiveCalendar({ fetchImpl: fetchOf(ALL_OK), nowMs: NOW, env: { NEWS_LIVE_CALENDAR: "on" }, apply: (r) => (got = r), crossCheck: noCross });
  assert.equal(run.applied, true);
  assert.equal(run.inCharge, "live");
  assert.ok(got.length >= CL.MIN_ROWS_AHEAD && got.every(N.isNewsEvent));
});

test("fallback: BLS 403 → bundled stays in charge even with the flag ON", async () => {
  let applied = 0;
  const run = await CL.runLiveCalendar({ fetchImpl: fetchOf({ ...ALL_OK, [CL.BLS_ICS_URL]: 403 }), nowMs: NOW, env: { NEWS_LIVE_CALENDAR: "1" }, apply: () => applied++, crossCheck: noCross });
  assert.equal(run.ok, false);
  assert.equal(run.inCharge, "bundled");
  assert.equal(applied, 0);
  assert.match(run.problems[0], /BLS: HTTP 403/);
});

test("fallback: network error, empty parse and parser drift all leave the bundled file in charge", async () => {
  for (const bad of [{ [CL.FED_FOMC_URL]: new Error("ECONNRESET") }, { [CL.BEA_ICS_URL]: "BEGIN:VCALENDAR\nEND:VCALENDAR" }, { [CL.FED_FOMC_URL]: "<html>redesigned</html>" }]) {
    let applied = 0;
    const run = await CL.runLiveCalendar({ fetchImpl: fetchOf({ ...ALL_OK, ...bad }), nowMs: NOW, env: { NEWS_LIVE_CALENDAR: "1" }, apply: () => applied++, crossCheck: noCross });
    assert.equal(run.inCharge, "bundled");
    assert.equal(applied, 0);
  }
  const v = CL.validateLiveRows([{ date: "2026-10-20", timeEt: "08:30", name: "CPI", impact: "high" }, { date: "2026-10-21", timeEt: "03:00", name: "X", impact: "high" }, { junk: 1 }], "2026-10-16", []);
  assert.ok(v.problems.some((p) => /parser drift/.test(p)));
  assert.ok(v.problems.some((p) => /no FOMC/.test(p)));
  assert.ok(v.problems.some((p) => /failed the bundled-file validator/.test(p)));
});

test("live rows adopt the bundled name at the same date+minute (no double rows in the merge)", () => {
  const v = CL.validateLiveRows([{ date: "2026-10-28", timeEt: "14:00", name: "FOMC Rate Decision", impact: "high" }], "2026-10-16", [{ date: "2026-10-28", timeEt: "14:00", name: "FOMC Rate Decision (Oct)", impact: "high" }]);
  assert.equal(v.rows[0].name, "FOMC Rate Decision (Oct)");
});

test("Grok cross-check is log-only: a disagreement or a throw never changes the rows", async () => {
  const say = async () => ({ ok: true, text: '{"rows":[{"i":0,"agree":false}]}', citations: [{ url: "https://www.bls.gov/schedule/", title: null }], error: null });
  const run = await CL.runLiveCalendar({ fetchImpl: fetchOf(ALL_OK), nowMs: NOW, env: {}, crossCheck: (rows, d) => CL.grokCrossCheck(rows, d, say) });
  const base = await CL.runLiveCalendar({ fetchImpl: fetchOf(ALL_OK), nowMs: NOW, env: {}, crossCheck: noCross });
  assert.deepEqual(run.rows, base.rows);
  assert.equal(run.crossCheck.disagreements.length, 1);
  const thrown = await CL.runLiveCalendar({ fetchImpl: fetchOf(ALL_OK), nowMs: NOW, env: {}, crossCheck: async () => { throw new Error("boom"); } });
  assert.equal(thrown.ok, true);
  assert.equal(thrown.crossCheck.ok, false);
});

/* ── Actuals ── */
const obs = (id, pairs) => ({ seriesID: id, data: pairs.map(([y, m, v]) => ({ year: String(y), period: `M${String(m).padStart(2, "0")}`, value: String(v) })) });
const CPI_JSON = { Results: { series: [
  obs("CUSR0000SA0", [[2026, 9, 336.298], [2026, 8, 334.29], [2026, 7, 332.96]]),
  obs("CUUR0000SA0", [[2026, 9, 336.0], [2026, 8, 334.0], [2025, 9, 324.0], [2025, 8, 323.0]]),
]}};

test("actuals: CPI computed from BLS series values (m/m SA, y/y NSA, prior period as vs)", () => {
  const c = A.computeInflation("cpi", A.parseBls(CPI_JSON));
  assert.equal(c.actual, "+0.6% MoM / +3.7% YoY");
  assert.equal(c.vs, "prev +0.4% / +3.4%");
  assert.equal(A.refMatches("CPI (Sep)", c), true);
  assert.equal(A.refMatches("CPI (Oct)", c), false, "a stale API month is refused");
});

test("actuals: Grok note with a number the code did not compute is rejected for the deterministic note", async () => {
  const c = A.computeInflation("cpi", A.parseBls(CPI_JSON));
  const liar = async () => ({ ok: true, text: "Hot print; consensus was 0.4% and core hit 2.9%.", citations: [], error: null });
  const r = await A.noteFor("cpi", "CPI (Sep)", c, liar);
  assert.equal(r.byModel, false);
  assert.match(r.rejected, /ungrounded/);
  assert.equal(r.note, A.deterministicNote("cpi"));
  const prose = async () => ({ ok: true, text: "Headline hotter than the prior month; energy did the work.", citations: [], error: null });
  const ok = await A.noteFor("cpi", "CPI (Sep)", c, prose);
  assert.equal(ok.byModel, true);
  const down = await A.noteFor("cpi", "CPI (Sep)", c, async () => ({ ok: false, text: "", citations: [], error: "timed out after 15s" }));
  assert.equal(down.note, A.deterministicNote("cpi"));
});

test("actuals: a stamp never overwrites an existing row for that release", () => {
  const prints = [{ date: "2026-10-02", name: "Nonfarm Payrolls (Sep)", actual: "+29k", vs: "x", note: "hand" }];
  assert.equal(A.alreadyStamped(prints, "2026-10-02", "NFP / Employment Situation (Sep)"), true);
  assert.equal(A.mergePrint(prints, { date: "2026-10-02", name: "NFP / Employment Situation (Sep)", actual: "+1k", vs: "", note: "" }), prints);
  assert.equal(A.mergePrint(prints, { date: "2026-11-06", name: "NFP / Employment Situation (Oct)", actual: "+1k", vs: "", note: "" }).length, 2);
});

test("actuals: BEA without BEA_API_KEY fails loudly (skipped, never guessed)", async () => {
  await assert.rejects(() => A.computeActual("gdp", 2026, { env: {}, fetchImpl: async () => { throw new Error("should not fetch"); } }), /BEA_API_KEY not set/);
});

/* ── Shock explainer ── */
const SHOCK = { at: Date.UTC(2026, 9, 16, 15, 7), symbol: "NQ", side: "down", pts: 180, atrMult: 3.4, kind: "macro" };

test("shock: no explain when a calendar row is within ±15m, or the candle is under 3×ATR", () => {
  assert.equal(SX.shouldExplain(SHOCK, [{ date: "2026-10-16", timeEt: "10:30", name: "X", impact: "high" }]), true);
  assert.equal(SX.shouldExplain(SHOCK, [{ date: "2026-10-16", timeEt: "11:00", name: "X", impact: "high" }, { date: "2026-10-16", timeEt: "11:10", name: "Y", impact: "medium" }]), false);
  assert.equal(SX.shouldExplain({ ...SHOCK, atrMult: 2.9 }, []), false);
});

test("shock fallback: search failure, no citations, or an invented number → tape line only", async () => {
  const fail = await SX.explainShock(SHOCK, async () => ({ ok: false, text: "", citations: [], error: "timed out after 20s" }));
  assert.equal(fail.headline, null);
  assert.equal(fail.tape, "NQ down 180 pts, 3.4× ATR");
  const nocite = await SX.explainShock(SHOCK, async () => ({ ok: true, text: '{"headline":"Fed leak on balance sheet"}', citations: [], error: null }));
  assert.equal(nocite.headline, null);
  const madeup = await SX.explainShock(SHOCK, async () => ({ ok: true, text: '{"headline":"Tariff of 45% announced"}', citations: [{ url: "https://x.com/a", title: "Tariff announced" }], error: null }));
  assert.equal(madeup.headline, null);
  assert.match(madeup.fallback, /ungrounded/);
  const good = await SX.explainShock(SHOCK, async () => ({ ok: true, text: '{"headline":"Report: Fed weighs emergency 50bp move"}', citations: [{ url: "https://www.reuters.com/x", title: "Fed weighs emergency 50bp move - Reuters" }], error: null }));
  assert.equal(good.headline, "Report: Fed weighs emergency 50bp move");
});

/* ── Floor talk: every digit registered with Facts ── */
function ctx() {
  return { st: T.freshTalkState(), f: new T.Facts(), key: "k", now: NOW };
}
const digitsOk = (ex, f) => ex.lines.every((l) => (l.text.match(/\d[\d,]*\.?\d*/g) ?? []).map((t) => t.replace(/[.,]+$/, "")).every((t) => f.list.includes(t)));

test("floor: shock headline and term-structure lines only speak registered digits", () => {
  const c = ctx();
  const ex = V.exShockExplain(c, { symbol: "NQ", tape: { side: "down", pts: 180, atrX: 3.4 }, headline: "Report: Fed weighs emergency 50bp move", sourceHost: "reuters.com" });
  assert.ok(ex && ex.lines.length >= 2);
  assert.ok(digitsOk(ex, c.f), JSON.stringify(ex.lines));
  const c2 = ctx();
  const px = V.exPulse(c2, { vix: { from: 17.2, to: 18.4 }, tenYear: { from: 4.1, to: 4.15 }, term: { ivts: 0.9123, vvix: 95, t10y2y: 0.33, gdpNow: 3.6 } });
  assert.ok(px.lines.some((l) => /contango/.test(l.text)));
  assert.ok(px.lines.some((l) => /Twos-tens/.test(l.text)));
  assert.ok(digitsOk(px, c2.f), JSON.stringify(px.lines));
  // Without term data the pulse talk is exactly what it was.
  const c3 = ctx();
  assert.equal(V.exPulse(c3, { vix: { from: 17.2, to: 18.4 }, tenYear: null }).lines.length, 2);
});

/* ── Pulse regime ── */
test("pulse regime: IVTS, contango/backwardation, FRED parsing", () => {
  const g = PR.pulseRegime([{ label: "VIX", last: 16.46 }, { label: "VIX3M", last: 18.49 }, { label: "VVIX", last: 90 }, { label: "VIX9D", last: null }], { gdpNow: null, t10y2y: null });
  assert.equal(g.ivts, 0.8902);
  assert.equal(g.structure, "contango");
  assert.equal(PR.volStructure(1.05), "backwardation");
  assert.equal(PR.volStructure(null), null);
  assert.deepEqual(PR.parseFredCsv("T10Y2Y", "observation_date,T10Y2Y\n2026-10-14,0.31\n2026-10-15,0.33\n2026-10-16,."), { series: "T10Y2Y", date: "2026-10-15", value: 0.33 });
  assert.deepEqual(PR.parseFredJson("GDPNOW", { observations: [{ date: "2026-10-15", value: "3.64" }] }), { series: "GDPNOW", date: "2026-10-15", value: 3.64 });
});

/* ── Weekly cost ── */
test("weekly cost: priced from discipline.ts; narration with an invented number falls back; no badges/streaks", async () => {
  const card = D.disciplineScorecard([
    { status: "closed", pnl: -120, r: -1, mistakes: ["chased"], deskWord: "WAIT", stateRating: 4 },
    { status: "closed", pnl: -80, r: -0.7, mistakes: ["chased"], deskWord: "TAKE", stateRating: 5 },
    { status: "closed", pnl: 150, r: 1.2, mistakes: [], deskWord: "TAKE", stateRating: 2 },
  ]);
  const w = WC.buildWeeklyCost("2026-10-11", card, null);
  assert.ok(w.lines.some((l) => /Costliest mistake: chased the print, 2×, −\$200/.test(l)), w.lines.join(" | "));
  assert.ok(w.thin);
  assert.ok(!/badge|streak|score/i.test(w.lines.join(" ")));
  const liar = await WC.narrateWeeklyCost(w, async () => ({ ok: true, text: "You lost $350 chasing.", citations: [], error: null }));
  assert.equal(liar.byModel, false);
  assert.equal(liar.text, w.lines.join(" "));
  const honest = await WC.narrateWeeklyCost(w, async () => ({ ok: true, text: "Chasing the print was the leak: 2×, −$200. Small sample.", citations: [], error: null }));
  assert.equal(honest.byModel, true);
});

/* ── Hard rules ── */
test("rules: RULES_HASH and shared/desk-rules.json bytes pinned (2026-10-17 every-TF + LTF inversion change)", () => {
  assert.equal(H.RULES_HASH, "32d32bc808ccc4f4");
  const sha = createHash("sha256").update(readFileSync(new URL("../shared/desk-rules.json", import.meta.url))).digest("hex");
  assert.equal(sha, "59a0298821a53a352062f52b4b77502adaafb6cfed0c2d02258c8d3a17b1e7db");
});

/* ── Follow-ups (PR #50 review) ── */
test("calendar UA carries a contact address; CALENDAR_USER_AGENT / CALENDAR_CONTACT_EMAIL override", async () => {
  assert.match(CL.DEFAULT_UA, /contact: [^\s@]+@[^\s@)]+/);
  assert.equal(CL.calendarUserAgent({ CALENDAR_USER_AGENT: "X/1 (me@a.b)" }).ua, "X/1 (me@a.b)");
  assert.match(CL.calendarUserAgent({ CALENDAR_CONTACT_EMAIL: "k@x.io" }).ua, /contact: k@x\.io/);
  const seen = [];
  await CL.runLiveCalendar({ fetchImpl: async (u, init) => (seen.push(init.headers), fetchOf(ALL_OK)(u)), nowMs: NOW, env: {}, crossCheck: noCross });
  assert.ok(seen.every((h) => /@/.test(h["User-Agent"]) && /@/.test(h.From)));
});

test("NFP actual is marked preliminary", () => {
  const J = { Results: { series: [obs("CES0000000001", [[2026, 9, 160029], [2026, 8, 160000], [2026, 7, 159867]]), obs("LNS14000000", [[2026, 9, 4.2]])] } };
  const c = A.computeNfp(A.parseBls(J));
  assert.match(c.actual, /^\+29k \(prelim\); U-rate 4\.2%/);
  assert.match(A.deterministicNote("nfp"), /preliminary/);
});

test("BLS API v2: BLS_API_KEY goes in as registrationkey (never logged)", async () => {
  let body = null;
  await A.fetchBls(["X"], 2025, 2026, { env: { BLS_API_KEY: "k-123" }, fetchImpl: async (_u, init) => ((body = JSON.parse(init.body)), okRes('{"status":"REQUEST_SUCCEEDED","Results":{"series":[]}}')) });
  assert.equal(body.registrationkey, "k-123");
  await A.fetchBls(["X"], 2025, 2026, { env: {}, fetchImpl: async (_u, init) => ((body = JSON.parse(init.body)), okRes('{"status":"REQUEST_SUCCEEDED","Results":{"series":[]}}')) });
  assert.equal(body.registrationkey, undefined);
});

test("chip sources: BLS falls back → 'BLS: file', others live only if the whole run validated", async () => {
  const { toSources } = await import("../src/lib/news/calendar-sources-server.ts");
  const bad = await CL.runLiveCalendar({ fetchImpl: fetchOf({ ...ALL_OK, [CL.BLS_ICS_URL]: 403 }), nowMs: NOW, env: {}, crossCheck: noCross });
  const s = toSources(bad, false);
  assert.deepEqual(s.sources.map((x) => `${x.id}: ${x.status}`), ["BLS: file", "BEA: file", "Fed: file"]);
  assert.match(s.sources[0].why, /403/);
  const good = await CL.runLiveCalendar({ fetchImpl: fetchOf(ALL_OK), nowMs: NOW, env: {}, crossCheck: noCross });
  assert.deepEqual(toSources(good, false).sources.map((x) => x.status), ["live", "live", "live"]);
  assert.equal(toSources(good, false).inCharge, "file", "flag off: the bundled file still answers the blackout");
});
