import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { register } from "tsx/esm/api";
register();
const R = await import("../src/lib/grok-reader/reader.ts");
const h = await import("../src/lib/desk/rules-hash.ts");
const _log = console.log; console.log = (...a) => { if (!String(a[0]).startsWith('{"tag":"grok-reader"')) _log(...a); };
const CFG = JSON.parse(readFileSync("shared/grok-reader.json", "utf8"));
const MNQ = JSON.parse(readFileSync("tests/fixtures/bars-1m-2026-10-16.json", "utf8")).MNQ;
const B15 = R.resample(MNQ, 15);
const at = (hh, mm) => Date.UTC(2026, 9, 16, hh + 5, mm); // CT (UTC-5) on 2026-10-16
const ON = { GROK_READER: "1", XAI_API_KEY: "test-not-a-key" };
const card = (o = {}) => ({ id: "c1", symbol: "MNQ", side: "short", pathBand: "B+", actionable: true, entryPx: 30010, plan: { entry: 30010, stop: 30090, t1: 29900, t2: 29800 }, reasons: ["r"], ...o });
const okFetch = (text = "SETUP: x\nENTRY ARRAY: y\nTARGET POOL: z\nSTALE: yes\nNOTE: re-anchor to newest gap") => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 3000, completion_tokens: 200 } }) });
const flagsAt = (hh, mm) => R.missedScan({ symbol: "MNQ", minute: MNQ, bars15: B15 }, at(hh, mm));

test("hash unchanged; reader config lives outside shared/desk-rules.json and is shadow", () => {
  assert.equal(h.RULES_HASH, "63ec3d05ca3f9995");
  assert.equal(readFileSync("shared/desk-rules.json", "utf8").includes("grok-reader"), false);
  assert.equal(CFG.live, false); assert.equal(CFG.mode, "shadow");
});

test("flag defaults off: nothing scheduled, no reads", async () => {
  R.resetGrokReader(); let calls = 0;
  R.kickGrokReader({ cards: [card()], books: [], nowMs: at(9, 0), env: { XAI_API_KEY: "k" }, fetchImpl: async () => { calls++; throw new Error("x"); } });
  await new Promise((r) => setTimeout(r, 10)); await R.drainGrokReader();
  assert.equal(calls, 0); assert.equal(R.grokReadsSnapshot().length, 0); assert.equal(R.readerEnabled({}), false);
});

test("no gate / score / fire / hash module imports the reader (only build-desk's shadow block + the display line)", () => {
  const files = []; const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx|mjs|mts)$/.test(f)) files.push(p); } };
  walk("src"); walk("netlify"); walk("shared");
  const users = files.filter((f) => !f.includes("grok-reader/") && /grok-reader\/reader|grok-reader\.json/.test(readFileSync(f, "utf8"))).sort();
  for (const f of users) assert.match(f, /grok-read-line\.tsx$|build-desk\.ts$|desk-listen\.ts$|master-seat\.ts$/);
  const bd = readFileSync("src/lib/trading/build-desk.ts", "utf8");
  // grokReads is spread FIRST into the returned payload (so it can never overwrite a desk field) and is the only use
  assert.equal((bd.match(/grokReadsSnapshot\(/g) ?? []).length, 1);
  assert.match(bd, /\.\.\.\(grokOn \? \{ grokReads: grokReadsSnapshot\(\), grokSuggest: grokSuggestSnapshot\(\), grokProposals: grokProposalsSnapshot\(\) \} : \{\}\),\n\s+\.\.\.payload,/);
  assert.equal(/grokReads/.test(readFileSync("src/lib/desk/rules-hash.ts", "utf8")), false);
});

test("gate/fire inputs identical with the flag on vs off (cards are never mutated, nothing is read back)", async () => {
  R.resetGrokReader();
  const cards = [card(), card({ id: "c2", side: "long", pathBand: "C", actionable: false })];
  const before = structuredClone(cards);
  const book = { symbol: "MNQ", minute: MNQ, bars15: B15 };
  R.kickGrokReader({ cards: R.cardsLite(cards), books: [book], nowMs: at(9, 55), env: {}, fetchImpl: okFetch() });     // off
  const offState = structuredClone(cards);
  R.kickGrokReader({ cards: R.cardsLite(cards), books: [book], nowMs: at(9, 55), env: ON, fetchImpl: okFetch() });    // on
  await new Promise((r) => setTimeout(r, 10)); await R.drainGrokReader();
  assert.deepEqual(cards, before); assert.deepEqual(offState, before);
  assert.ok(R.grokReadsSnapshot().length > 0);
});

test("timeout and errors never throw into the desk path; sync cost of kick ~0", async () => {
  R.resetGrokReader();
  const hang = (_u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(new Error("aborted"))));
  const r1 = await R.callXai("x", { env: ON, fetchImpl: hang, timeoutMs: 50 });
  assert.equal(r1.status, "timeout");
  const r2 = await R.callXai("x", { env: ON, fetchImpl: async () => { throw new Error("boom"); } });
  assert.equal(r2.status, "error");
  const r3 = await R.callXai("x", { env: ON, fetchImpl: async () => ({ ok: false, status: 500 }) });
  assert.equal(r3.status, "error");
  // kick with a throwing fetch and garbage books: returns void synchronously, never throws
  const t0 = performance.now(); let ret;
  for (let i = 0; i < 1000; i++) ret = R.kickGrokReader({ cards: [card({ id: `k${i}` })], books: [{ symbol: "MNQ", minute: null, bars15: null }], nowMs: at(9, 0), env: ON, fetchImpl: async () => { throw new Error("x"); } });
  const perCallMs = (performance.now() - t0) / 1000;
  assert.equal(ret, undefined);
  assert.ok(perCallMs < 0.5, `kick sync cost ${perCallMs}ms`);
  console.log(`# grok-reader kick sync cost: ${(perCallMs * 1000).toFixed(1)}µs/call`);
  await new Promise((r) => setTimeout(r, 20)); await R.drainGrokReader();
});

test("reads B+ cards only, flags stale entry vs newest array, re-anchor makes a new read", async () => {
  R.resetGrokReader();
  const arrays = [{ tf: "15m", kind: "fvg", dir: "bear", lo: 29948.75, hi: 30023.5, ce: 29986.1, ageBars: 4 }, { tf: "5m", kind: "fvg", dir: "bear", lo: 29856, hi: 29880, ce: 29868, ageBars: 1 }];
  const books = [{ symbol: "MNQ", minute: MNQ, bars15: B15, arrays }];
  const jobs = R.planJobs({ cards: [card(), card({ id: "lo", pathBand: "B" })], books, nowMs: at(9, 58) });
  const cj = jobs.filter((j) => j.kind === "card");
  assert.equal(cj.length, 1); assert.equal(cj[0].cardId, "c1"); assert.equal(cj[0].staleEntry, true);
  assert.match(cj[0].prompt, /1m: .*\n5m: .*\n15m: .*\n1h: .*\n4h: /s);
  R.kickGrokReader({ cards: [card()], books, nowMs: at(9, 58), env: ON, fetchImpl: okFetch() });
  await new Promise((r) => setTimeout(r, 10)); await R.drainGrokReader();
  const n1 = R.grokReadsSnapshot().filter((r) => r.kind === "card").length;
  R.kickGrokReader({ cards: [card({ entryPx: 29868, plan: { entry: 29868, stop: 29950, t1: 29800, t2: null } })], books, nowMs: at(9, 59), env: ON, fetchImpl: okFetch("STALE: no") });
  await new Promise((r) => setTimeout(r, 10)); await R.drainGrokReader();
  const cr = R.grokReadsSnapshot().filter((r) => r.kind === "card");
  assert.equal(cr.length, n1 + 1); assert.equal(cr[0].staleEntry, false);
});

test("replay 10/16 MNQ missed shorts: 08:33 off ~30,085, 09:40 + 09:51 15m bear gap taps, 09:55 lower high", () => {
  const f835 = flagsAt(8, 35).find((f) => f.side === "short" && f.kind === "mss");
  assert.ok(f835); assert.ok(Math.abs(f835.level - 30085) <= 2, `anchor ${f835.level}`);
  assert.ok(flagsAt(9, 45).some((f) => f.side === "short" && f.kind === "htfGapTap" && f.level === 29948.75));
  assert.ok(flagsAt(9, 55).some((f) => f.side === "short" && f.kind === "htfGapTap"));
  assert.ok(flagsAt(10, 0).some((f) => f.side === "short" && f.kind === "lowerHigh"));
  // quiet, mid-range window: nothing flagged
  assert.equal(flagsAt(9, 25).length + flagsAt(9, 30).length, 0);
});

test("missed check: suppressed when the desk HAD an actionable B+ short; once per closed 5m bar; logged with a suggestion", async () => {
  const fl = flagsAt(9, 55);
  assert.equal(R.missedVsDesk(fl, [card()]).length, 0);
  assert.ok(R.missedVsDesk(fl, [card({ actionable: false })]).length > 0);
  R.resetGrokReader();
  const book = { symbol: "MNQ", minute: MNQ, bars15: B15, arrays: [] };
  R.kickGrokReader({ cards: [], books: [book], nowMs: at(9, 55), env: ON, fetchImpl: okFetch() });
  R.kickGrokReader({ cards: [], books: [book], nowMs: at(9, 56), env: ON, fetchImpl: okFetch() }); // same 5m bucket
  await new Promise((r) => setTimeout(r, 10)); await R.drainGrokReader();
  const m = R.grokReadsSnapshot().filter((r) => r.kind === "missed");
  assert.equal(m.length, 1); assert.match(m[0].suggestions[0], /no actionable short card/);
});

test("daily call cap + spend cap", async () => {
  R.resetGrokReader();
  const cards = Array.from({ length: CFG.dailyCallCap + 5 }, (_, i) => card({ id: `cap${i}` }));
  R.kickGrokReader({ cards, books: [], nowMs: at(7, 0), env: ON, fetchImpl: okFetch() });
  await new Promise((r) => setTimeout(r, 10)); await R.drainGrokReader();
  const s = R.grokReadsSnapshot(); const b = R.budgetRead();
  assert.ok(b.calls <= CFG.dailyCallCap); assert.ok(b.spendUsd <= CFG.dailySpendCapUsd + 1e-9);
  assert.ok(s.some((r) => r.status === "capped"));
  assert.ok(Math.abs(R.estCostUsd(3000, 200) - 0.00425) < 1e-9);
});

test("prompt arrays: nearest unmitigated per timeframe, not the oldest rows (grok-vs-desk-1016 §6)", () => {
  const old = Array.from({ length: 20 }, (_, i) => ({ tf: "1m", kind: "ifvg", dir: "bear", lo: 30880 + i, hi: 30881 + i, ce: 30880.5 + i, mitigated: false, ageBars: 3000 }));
  const near = [{ tf: "15m", kind: "fvg", dir: "bear", lo: 29948.75, hi: 30023.5, ce: 29986.1, mitigated: false, ageBars: 4 }, { tf: "1h", kind: "fvg", dir: "bear", lo: 29960, hi: 30000, ce: 29980, mitigated: false, ageBars: 2 }, { tf: "5m", kind: "fvg", dir: "bear", lo: 29900, hi: 29910, ce: 29905, mitigated: true, ageBars: 1 }];
  const txt = R.mtfSummary({ symbol: "MNQ", minute: MNQ, bars15: B15, arrays: [...old, ...near] }, at(9, 55));
  const line = txt.split("\n").find((l) => l.startsWith("arrays:"));
  assert.match(line, /^arrays: 15m bear fvg|^arrays: 1h bear fvg/);
  assert.ok(line.includes("15m bear fvg") && line.includes("1h bear fvg"));
  assert.equal((line.match(/1m bear ifvg/g) ?? []).length, 2);
  assert.equal(line.includes("29900-29910"), false);
});
