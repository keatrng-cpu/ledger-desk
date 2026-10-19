import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const f = await import("../src/lib/free-data/features.ts");
const ms = await import("../src/lib/smc/master-seat.ts");
const ON = { DESK_FREE_DATA: "1" };
const FF = JSON.parse(readFileSync("feeds/free_data/tests/fixtures/ff_thisweek_20261018.json", "utf8"));
const ct = (y, mo, d, h, mi) => Date.parse(`${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00-05:00`);

test("parseNum + raw surprise sign (same cases as the Python twin)", () => {
  assert.equal(f.parseNum("1.30M"), 1_300_000); assert.equal(f.parseNum("200K"), 200_000); assert.equal(f.parseNum("-0.4%"), -0.4);
  assert.equal(f.parseNum(""), null); assert.equal(f.parseNum("n/a"), null);
  assert.equal(f.surpriseSign("1.35M", "1.30M"), 1); assert.equal(f.surpriseSign("1.25M", "1.30M"), -1);
  assert.equal(f.surpriseSign("1.30M", "1.30M"), 0); assert.equal(f.surpriseSign(null, "1.30M"), null);
});

test("FF normalize: 10/20 Housing Starts is 07:30 CT, forecast 1.30M, Low impact (outside USD high/medium scope)", () => {
  const rows = f.normalizeFf(FF);
  const hs = rows.find((r) => r.title === "Housing Starts");
  assert.equal(hs.dateCt, "2026-10-20"); assert.equal(hs.timeCt, "07:30"); assert.equal(hs.forecast, "1.30M"); assert.equal(hs.previous, "1.28M");
  assert.equal(hs.forecastNum, 1_300_000); assert.equal(hs.surpriseSign, null); assert.equal(hs.inScope, false);
  assert.ok(rows.filter((r) => r.inScope).every((r) => r.country === "USD" && ["High", "Medium"].includes(r.impact)));
  assert.equal(f.nextPrint(rows, ct(2026, 10, 18, 23, 0)).title, "Unemployment Claims");
});

test("print window: 07:25–07:45 CT around 07:30 CT USD prints, shadow only", () => {
  const rows = f.normalizeFf(FF);
  assert.equal(f.printWindow(rows, ct(2026, 10, 20, 7, 24)).flag, false);
  assert.deepEqual(f.printWindow(rows, ct(2026, 10, 20, 7, 25)).events.sort(), ["Building Permits", "Housing Starts"]);
  assert.equal(f.printWindow(rows, ct(2026, 10, 20, 7, 45)).flag, true);
  assert.equal(f.printWindow(rows, ct(2026, 10, 20, 7, 46)).flag, false);
});

test("VIX ratios, regimes and closed-days-only term structure", () => {
  const r = f.vixRatios(19.99, 20.12, 20.5);
  assert.equal(r.vix9dVix, 1.0065); assert.equal(r.vixVix3m, 0.9751); assert.equal(r.regime, "flat"); assert.equal(r.frontInverted, true);
  assert.equal(f.vixRatios(15, 13, 18).regime, "contango"); assert.equal(f.vixRatios(30, 33, 28).regime, "backwardation");
  const csv = (a, b, c) => `DATE,OPEN,HIGH,LOW,CLOSE\n10/15/2026,1,1,1,${a}\n10/16/2026,1,1,1,${b}\n10/19/2026,1,1,1,${c}\n`;
  const s = { VIX: f.parseCboeCsv(csv(16.46, 19.99, 25)), VIX9D: f.parseCboeCsv(csv(13.97, 20.12, 30)), VIX3M: f.parseCboeCsv(csv(18.49, 20.5, 22)) };
  assert.equal(f.termStructure(s, ct(2026, 10, 19, 10, 0)).date, "2026-10-16");
  assert.equal(f.termStructure(s, ct(2026, 10, 19, 15, 30)).regime, "backwardation");
});

test("freeDataRead (enabled): polite cache (FF ≤ 1 req / 15 min), 429 back-off, never throws", async () => {
  f._resetFreeDataCache();
  const calls = [];
  let ffStatus = 200;
  const vixCsv = "DATE,OPEN,HIGH,LOW,CLOSE\n10/16/2026,1,1,1,20\n";
  const fake = async (url) => {
    calls.push(url);
    if (url.includes("faireconomy")) return ffStatus === 429 ? new Response("", { status: 429, headers: { "retry-after": "3600" } }) : new Response(JSON.stringify(FF), { status: 200 });
    return new Response(vixCsv, { status: 200 });
  };
  const t0 = ct(2026, 10, 18, 23, 0);
  const r1 = await f.freeDataRead(t0, fake, 2000, ON);
  assert.equal(r1.mode, "shadow"); assert.equal(r1.live, false); assert.equal(r1.ff.nextPrint.title, "Unemployment Claims"); assert.equal(r1.vix.date, "2026-10-16");
  const ffCalls = () => calls.filter((u) => u.includes("faireconomy")).length;
  await f.freeDataRead(t0 + 14 * 60_000, fake, 2000, ON); await new Promise((r) => setTimeout(r, 10));
  assert.equal(ffCalls(), 1);
  ffStatus = 429;
  await f.freeDataRead(t0 + 16 * 60_000, fake, 2000, ON); await new Promise((r) => setTimeout(r, 10));
  assert.equal(ffCalls(), 2);
  await f.freeDataRead(t0 + 40 * 60_000, fake, 2000, ON); await new Promise((r) => setTimeout(r, 10));
  assert.equal(ffCalls(), 2);                                   // backing off after 429 (Retry-After 3600)
  const r2 = await f.freeDataRead(t0 + 40 * 60_000, fake, 2000, ON);
  assert.equal(r2.ff.nextPrint.title, "Unemployment Claims");  // last good read kept
  f._resetFreeDataCache();
  const boom = async () => { throw new Error("down"); };
  const r3 = await f.freeDataRead(t0, boom, 50, ON);
  assert.equal(r3.ff, null); assert.equal(r3.vix, null);
  f._resetFreeDataCache();
});

test("free data is OFF by default: unset / \"0\" / anything but \"1\"|\"true\" → null and zero FF/Cboe fetches", async () => {
  f._resetFreeDataCache();
  let calls = 0;
  const spy = async () => { calls++; throw new Error("must not fetch"); };
  for (const env of [{}, { DESK_FREE_DATA: "" }, { DESK_FREE_DATA: "0" }, { DESK_FREE_DATA: "false" }, { DESK_FREE_DATA: "TRUE" }, { DESK_FREE_DATA: "yes" }, { DESK_FREE_DATA: " 1" }]) {
    assert.equal(f.freeDataEnabled(env), false, JSON.stringify(env));
    assert.equal(await f.freeDataRead(Date.now(), spy, 10, env), null);
  }
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 0);
  const fd = { mode: "shadow", live: false, asOf: "x", ff: null, vix: { date: "2026-10-16", ...f.vixRatios(19.99, 20.12, 20.5) } };
  assert.equal(f.freeDataSeatLine(fd, {}), null);            // Floor/Brain line off by default
  assert.match(f.freeDataSeatLine(fd, ON), /^Free data/);
  f._resetFreeDataCache();
});

test("free data enabled only by DESK_FREE_DATA exactly \"1\" or \"true\"", async () => {
  assert.equal(f.freeDataEnabled({ DESK_FREE_DATA: "1" }), true);
  assert.equal(f.freeDataEnabled({ DESK_FREE_DATA: "true" }), true);
  f._resetFreeDataCache();
  let calls = 0;
  const boom = async () => { calls++; throw new Error("down"); };
  const r = await f.freeDataRead(Date.now(), boom, 50, { DESK_FREE_DATA: "true" });
  assert.notEqual(r, null); assert.ok(calls > 0);
  f._resetFreeDataCache();
});

test("Brain seat: freeData adds one narrative line and never changes verdict or checks", () => {
  const base = { card: { symbol: "ES", side: "long", band: "A", q: 0.7, actionable: true, entry: 7780, entryResting: false, stopPx: 7770, target: 7800, rr: 2, chop: false, bias1h: "bull", bias4h: "bull", dispScore: 1, ltfKilled: false, reversal: null },
    rule1: [], brainWord: "LONG", brainBook: { symbol: "ES", side: "long" }, floorVerdict: "TAKE", align: 0.8, smtLead: null, shockActive: false, topDraw: null, governor: "normal" };
  const fd = { mode: "shadow", live: false, asOf: "x", ff: { source: "cache", usdScoped: [], nextPrint: null, printWindow: { flag: true, events: ["Housing Starts"] }, actualsAvailable: false },
    vix: { date: "2026-10-16", ...f.vixRatios(19.99, 20.12, 20.5) } };
  const prev = process.env.DESK_FREE_DATA;
  delete process.env.DESK_FREE_DATA;
  const off = ms.masterSeat({ ...base, freeData: fd });
  assert.equal(off.narrative.some((l) => l.startsWith("Free data")), false);   // default OFF: no Brain line
  process.env.DESK_FREE_DATA = "1";
  let a, b;
  try { a = ms.masterSeat(base); b = ms.masterSeat({ ...base, freeData: fd }); }
  finally { if (prev === undefined) delete process.env.DESK_FREE_DATA; else process.env.DESK_FREE_DATA = prev; }
  assert.equal(b.verdict, a.verdict); assert.deepEqual(b.checks, a.checks); assert.deepEqual(b.failed, a.failed); assert.deepEqual(b.cautions, a.cautions);
  assert.equal(b.narrative.length, a.narrative.length + 1);
  assert.match(b.narrative.find((l) => l.startsWith("Free data")), /shadow, no gate.*print window ON.*VIX 19.99.*flat, front inverted/);
});

test("rules hash unaffected: free-data config is outside shared/desk-rules.json and is shadow", () => {
  const rules = readFileSync("shared/desk-rules.json", "utf8");
  assert.equal(rules.includes("free-data"), false); assert.equal(rules.includes("freeData"), false);
  const cfg = JSON.parse(readFileSync("shared/free-data.json", "utf8"));
  assert.equal(cfg.mode, "shadow"); assert.equal(cfg.live, false);
  for (const p of ["src/lib/trading/news.ts", "src/lib/desk/rules-hash.ts"]) assert.equal(readFileSync(p, "utf8").includes("free-data"), false);
});
