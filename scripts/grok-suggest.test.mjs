import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const _log = console.log; const lines = [];
console.log = (...a) => { const s = String(a[0]); if (s.startsWith('{"tag":"grok')) lines.push(JSON.parse(s)); else _log(...a); };
const R = await import("../src/lib/grok-reader/reader.ts");
const S = await import("../src/lib/grok-reader/suggest.ts");
const h = await import("../src/lib/desk/rules-hash.ts");
const dl = await import("../src/lib/trading/desk-listen.ts");
const MNQ = JSON.parse(readFileSync("tests/fixtures/bars-1m-2026-10-16.json", "utf8")).MNQ;
const B15 = R.resample(MNQ, 15);
const at = (hh, mm) => Date.UTC(2026, 9, 16, hh + 5, mm);
const ON = { GROK_READER: "1", XAI_API_KEY: "test-not-a-key" };
const GOOD = { symbol: "MNQ", side: "short", entry: 29935, stop: 29990, t1: 29840, setup: "15m bear gap tap", confidence: 0.7 };
const reply = (o) => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: typeof o === "string" ? o : JSON.stringify(o) } }], usage: { prompt_tokens: 3200, completion_tokens: 220 } }) });
const TAKE = { word: "TAKE", symbol: "MNQ", side: "short", q: 0.62, vetoed: false };
const drain = async () => { await new Promise((r) => setTimeout(r, 10)); await R.drainGrokReader(); };

test("strict JSON: valid parses; malformed / missing / inconsistent / prose-wrapped is dropped", () => {
  assert.deepEqual(S.parseGrokJson(JSON.stringify({ suggestion: GOOD })).suggestion, GOOD);
  assert.ok(S.parseGrokJson("```json\n" + JSON.stringify({ suggestion: GOOD }) + "\n```").suggestion);
  for (const bad of [
    "Sure! " + JSON.stringify({ suggestion: GOOD }), "{not json", "[]", null,
  ]) assert.equal(S.parseGrokJson(bad), null);
  for (const s of [{ ...GOOD, t1: undefined }, { ...GOOD, side: "sell" }, { ...GOOD, symbol: "SPY" }, { ...GOOD, stop: 29900 }, { ...GOOD, confidence: 1.4 }, { ...GOOD, entry: "29935" }, { ...GOOD, setup: "" }])
    assert.equal(S.parseGrokJson(JSON.stringify({ suggestion: s })).suggestion, null);
});

test("review: B+ fires only with Brain TAKE same symbol/side q>=0.60 no veto; A- or better via desk card → normal gates", () => {
  const f = R.missedScan({ symbol: "MNQ", minute: MNQ, bars15: B15 }, at(9, 45)).find((x) => x.kind === "htfGapTap");
  const ctx = (o) => ({ minute: MNQ, bars15: B15, nowMs: at(9, 45) + 3000, readAt: at(9, 45) + 3000, flag: f, deskCards: [], brain: null, ...o });
  const s = { ...GOOD, entry: 29912, stop: 29960, t1: 29700 };
  assert.equal(S.reviewSuggestion(s, ctx({})).decision, "no-fire");
  assert.equal(S.reviewSuggestion(s, ctx({ brain: TAKE })).decision, "would-fire");
  for (const b of [{ ...TAKE, q: 0.59 }, { ...TAKE, vetoed: true }, { ...TAKE, side: "long" }, { ...TAKE, symbol: "ES" }, { ...TAKE, word: "WAIT" }])
    assert.equal(S.reviewSuggestion(s, ctx({ brain: b })).decision, "no-fire");
  const a = S.reviewSuggestion(s, ctx({ deskCards: [{ symbol: "MNQ", side: "short", pathBand: "A-" }] }));
  assert.equal(a.band, "A-"); assert.equal(a.route, "normal-gates"); assert.equal(a.decision, "would-fire");
  assert.ok(a.reviewUs < 50_000);
});

test("review: stop/T1 from structure, closed-bar re-check (stale entry / stop or T1 traded → no fire)", () => {
  const f = { symbol: "MNQ", side: "short", kind: "htfGapTap", at: at(9, 55), level: 29948.75, detail: "x" };
  const base = { minute: MNQ, bars15: B15, flag: f, deskCards: [], brain: TAKE };
  const r = S.reviewSuggestion({ ...GOOD, entry: 29839.75, stop: 29900, t1: 29700 }, { ...base, nowMs: at(9, 55), readAt: at(9, 55) });
  assert.ok(r.stop >= 29949, `stop moved to structure ${r.stop}`);
  const far = S.reviewSuggestion({ ...GOOD, entry: 30050, stop: 30100, t1: 29900 }, { ...base, nowMs: at(9, 55), readAt: at(9, 55) });
  assert.equal(far.checks.find((c) => c.id === "closedBar:atEntry").pass, false);
  const late = S.reviewSuggestion({ ...GOOD, entry: 29839.75, stop: 29990, t1: 29790 }, { ...base, nowMs: at(10, 20), readAt: at(9, 56) });
  assert.equal(late.checks.find((c) => c.id === "closedBar:t1").pass, false);
});

test("lane end to end: missed check → strict JSON suggestion → reviewed card, proposals logged, Trading Stand line; malformed dropped", async () => {
  R.resetGrokReader(); lines.length = 0;
  const book = { symbol: "MNQ", minute: MNQ, bars15: B15, arrays: [] };
  const body = { read: { setup: "15m bear gap tap", entryArray: "15m bear FVG", targetPool: "day low", stale: true, note: "re-anchor" }, suggestion: { ...GOOD, entry: 29912, stop: 29960, t1: 29700 }, proposals: [{ title: "re-anchor to newest gap", hypothesis: "h", backtest: "b" }] };
  const t0 = performance.now();
  R.kickGrokReader({ brain: TAKE, cards: [], books: [book], nowMs: at(9, 45), clock: () => at(9, 45) + 3000, env: ON, fetchImpl: reply(body) });
  await drain();
  const sg = R.grokSuggestSnapshot();
  assert.equal(sg.length, 1); assert.equal(sg[0].mode, "shadow"); assert.equal(sg[0].review.decision, "would-fire");
  assert.ok(performance.now() - t0 < 1000, "kick → read → desk decision < 1 s (fetch mocked)");
  assert.ok(sg[0].review.reviewUs < 50_000);
  assert.ok(R.grokProposalsSnapshot().some((p) => p.source === "grok" && p.status === "proposed"));
  assert.ok(R.grokProposalsSnapshot().some((p) => p.source === "detector"));
  assert.ok(lines.some((l) => l.tag === "grok-suggest-stand" && /Trading Stand/.test(l.line)));
  // malformed reply → no suggestion card
  R.resetGrokReader();
  R.kickGrokReader({ brain: TAKE, cards: [], books: [book], nowMs: at(9, 45), clock: () => at(9, 45) + 3000, env: ON, fetchImpl: reply("SETUP: prose, not JSON") });
  await drain();
  assert.equal(R.grokSuggestSnapshot().length, 0);
  assert.ok(R.grokReadsSnapshot().some((r) => r.status === "malformed"));
  // GROK_SUGGEST_FIRE marks the card live (the watcher decides); default shadow
  R.resetGrokReader();
  R.kickGrokReader({ brain: TAKE, cards: [], books: [book], nowMs: at(9, 45), clock: () => at(9, 45) + 3000, env: { ...ON, GROK_SUGGEST_FIRE: "1" }, fetchImpl: reply(body) });
  await drain();
  assert.equal(R.grokSuggestSnapshot()[0].mode, "live");
});

test("wire + brain seat carry suggestions (display only); RULES_HASH unchanged", () => {
  const card = { id: "grok:x", symbol: "MNQ", side: "short", entry: 1, stop: 2, t1: 0, setup: "s", confidence: 0.5, at: 0, readAt: 0, source: "grok", mode: "shadow", review: { decision: "no-fire", route: "none", band: "B+", stop: 2, t1: 0, rr1: 1, checks: [], reviewUs: 1 }, standReview: "pending" };
  const mi = dl.masterInputOf({ rule1: [], grokSuggest: [card], brain: { word: "WAIT" }, floor: { verdict: "WATCH" }, strategy: null }, null, "normal");
  assert.equal(mi.grokSuggest[0].id, "grok:x");
  assert.equal(h.RULES_HASH, "eeb84801a0b5c5b2");
  assert.equal(readFileSync("shared/desk-rules.json", "utf8").includes("grokSuggest"), false);
});

test("replay helper: proxy suggestion is strict-valid for the 10/16 09:55 tap", () => {
  return import("./grok-suggest-replay.mts").then((m) => {
    const f = R.missedScan({ symbol: "MNQ", minute: MNQ, bars15: B15 }, at(9, 55)).find((x) => x.kind === "htfGapTap");
    const s = m.proxySuggestion("MNQ", f, MNQ, at(9, 55));
    assert.ok(s && s.side === "short" && s.stop > s.entry && s.t1 < s.entry);
  });
});
