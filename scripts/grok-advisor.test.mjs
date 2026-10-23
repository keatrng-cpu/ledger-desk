import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { register } from "tsx/esm/api";
register();
const A = await import("../src/lib/grok-reader/advisor.ts");
const G = await import("../src/lib/grok-reader/grade.ts");
const X = await import("../src/lib/grok-reader/xpulse.ts");
const R = await import("../src/lib/grok-reader/reader.ts");
const h = await import("../src/lib/desk/rules-hash.ts");
const _log = console.log; console.log = (...a) => { if (!/^\{"tag":"grok-(advisor|advice)"/.test(String(a[0]))) _log(...a); };
const ALL = JSON.parse(readFileSync("tests/fixtures/bars-1m-2026-10-12_16.json", "utf8"));
const at = (d, hh, mm) => Date.UTC(2026, 9, d, hh + 5, mm);
const book = (s, now) => { const m = ALL[s].filter((b) => b.t + 60_000 <= now); return { symbol: s, minute: m, bars15: R.resample(m, 15).filter((b) => b.t + 900_000 <= now) }; };
const card = (o = {}) => ({ id: "c1", symbol: "MNQ", side: "short", pathBand: "C", actionable: false, entryPx: 30010, plan: { entry: 30010, stop: 30090, t1: 29900 }, q: 0.45, missing: ["LTF arm"], vetoes: ["POI in correct half"], caps: [], ...o });

test("hash unchanged; advisor is shadow config outside desk-rules; nothing in gate/score/fire imports it", () => {
  assert.equal(h.RULES_HASH, "eeb84801a0b5c5b2");
  assert.equal(readFileSync("shared/desk-rules.json", "utf8").includes("advisor"), false);
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const allowed = new Set(["src/lib/trading/build-desk.ts", "src/lib/trading/desk-listen.ts", "src/lib/smc/master-seat.ts"]);
  const users = walk("src").filter((p) => /\.(ts|tsx)$/.test(p) && !p.includes("grok-reader/") && /grok-reader\/(advisor|grade|xpulse)/.test(readFileSync(p, "utf8")));
  assert.deepEqual(users.filter((p) => !allowed.has(p)), []);
  for (const p of ["src/lib/desk/rules-hash.ts"]) assert.equal(readFileSync(p, "utf8").includes("grok"), false);
});

test("flag defaults off: no network, no rows", async () => {
  A.resetAdvisor(); let calls = 0;
  A.kickGrokAdvisor({ cards: [card()], books: [book("MNQ", at(13, 9, 30))], nowMs: at(13, 9, 30), brain: null, env: { XAI_API_KEY: "k" }, fetchImpl: async () => { calls++; throw new Error(); } });
  await new Promise((r) => setTimeout(r, 10)); await A.drainAdvisor();
  assert.equal(calls, 0); assert.equal(A.advisorSnapshot().length, 0); assert.equal(A.advisorEnabled({}), false);
});

test("prompt v2: key levels, SMT vs other index, desk card blockers + Brain, no 'late' filter, no confidence", () => {
  const now = at(14, 9, 40);
  const p = A.advisorPrompt({ book: book("MNQ", now), other: book("ES", now), side: "short", nowMs: now, card: card(), brain: { word: "PASS", symbol: "MNQ", side: "short", q: 0.45, vetoed: true } });
  for (const k of ["PDH", "PDL", "ONH", "ONL", "PWH", "PWL", "SMT vs ES", "volume: n/a", '"POI in correct half"', '"LTF arm"', "Brain seat: PASS", "grade C q 0.45"]) assert.ok(p.includes(k), k);
  const lv = A.keyLevels(ALL.MNQ, now);
  assert.ok(lv.pdh > lv.pdl && lv.onh >= lv.onl);
  assert.equal(lv.pwh, null, "fixture has no full prior week → n/a, never a partial week");
  assert.match(A.ADVISOR_PACK, /NOT a filter: never reject or downgrade for time alone/);
  assert.equal(/confidence"\s*:/.test(A.ADVISOR_PACK), false);
});

test("PDH/PDL use the previous session's RTH; overnight is this session before 08:30 CT (closed bars only)", () => {
  const now = at(14, 9, 40); const m = ALL.MNQ;
  const prevRth = m.filter((b) => b.t >= at(13, 8, 30) && b.t < at(13, 15, 0));
  const on = m.filter((b) => b.t >= at(13, 17, 0) && b.t < at(14, 8, 30));
  const lv = A.keyLevels(m, now);
  assert.equal(lv.pdh, Math.max(...prevRth.map((b) => b.h))); assert.equal(lv.onl, Math.min(...on.map((b) => b.l)));
  const later = A.keyLevels(m.filter((b) => b.t < now + 3600_000), now);
  assert.deepEqual(later, lv, "bars after now change nothing");
});

test("strict parse: three types, blocker must be real, NEW_SETUP only without a card, AGREE codes", () => {
  const ctx = { symbol: "MNQ", side: "short", card: card() };
  const j = (o) => JSON.stringify({ symbol: "MNQ", side: "short", entry: 30010, stop: 30090, target: 29900, reasonCode: "HTF_ARRAY_TAP", blocker: null, note: "n", ...o });
  assert.equal(A.parseAdvice(j({ type: "MISGRADED" }), ctx).type, "MISGRADED");
  assert.equal(A.parseAdvice(j({ type: "WRONGLY_BLOCKED", blocker: "POI in correct half" }), ctx).blocker, "POI in correct half");
  assert.equal(A.parseAdvice(j({ type: "WRONGLY_BLOCKED", blocker: "made up" }), ctx), null);
  assert.equal(A.parseAdvice(j({ type: "NEW_SETUP" }), ctx), null);
  assert.equal(A.parseAdvice(j({ type: "NEW_SETUP" }), { ...ctx, card: null }).type, "NEW_SETUP");
  assert.equal(A.parseAdvice(j({ type: "MISGRADED", stop: 29000 }), ctx), null, "geometry");
  assert.equal(A.parseAdvice(j({ type: "MISGRADED", side: "long" }), ctx), null, "side must match the check");
  assert.equal(A.parseAdvice(j({ type: "AGREE", entry: null, stop: null, target: null, reasonCode: "CHOP" }), ctx).reasonCode, "CHOP");
  assert.equal(A.parseAdvice(j({ type: "AGREE", reasonCode: "LATE" }), ctx), null, "'late' is not a pass code");
  assert.equal(A.parseAdvice("not json", ctx), null);
});

test("routing: jsonl + inbox for both bots; AGREE not in inbox; Supabase only behind its flag", async () => {
  const dir = mkdtempSync(join(tmpdir(), "adv-")); let posts = 0;
  const row = { type: "WRONGLY_BLOCKED", symbol: "MNQ", side: "short", entry: 30010, stop: 30090, target: 29900, reasonCode: "HTF_ARRAY_TAP", blocker: "POI in correct half", note: "n", id: "adv:1", at: 1, readAt: 2, promptVersion: "v2", mode: "shadow", cardId: "c1", desk: null, brain: null, news: null, costUsd: 0 };
  const f = async () => { posts++; return { ok: true }; };
  let r = await A.routeAdvice(row, { dir, env: { SUPABASE_URL: "https://x", SUPABASE_SERVICE_ROLE_KEY: "s" }, fetchImpl: f });
  assert.deepEqual(r, { jsonl: true, inbox: true, supabase: "off" }); assert.equal(posts, 0);
  r = await A.routeAdvice({ ...row, id: "adv:2" }, { dir, env: { GROK_ADVISOR_SUPABASE: "1", SUPABASE_URL: "https://x", SUPABASE_SERVICE_ROLE_KEY: "s" }, fetchImpl: f });
  assert.equal(r.supabase, "ok"); assert.equal(posts, 1);
  await A.routeAdvice({ ...row, id: "adv:3", type: "AGREE", blocker: null }, { dir, env: {} });
  const inbox = readFileSync(join(dir, "inbox.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(inbox.length, 2); assert.deepEqual(inbox[0].to, ["trading-stand", "smc-data-analysis"]);
  assert.match(inbox[0].note, /blocker "POI in correct half".*never a fire/);
  assert.equal(readFileSync(join(dir, "suggestions.jsonl"), "utf8").trim().split("\n").length, 3);
});

test("end to end (mock xAI): kick → parsed WRONGLY_BLOCKED row → routed; fire-and-forget returns void", async () => {
  A.resetAdvisor(); R.resetGrokReader(); const dir = mkdtempSync(join(tmpdir(), "adv-")); const now = at(14, 9, 40);
  const reply = JSON.stringify({ type: "WRONGLY_BLOCKED", symbol: "MNQ", side: "short", entry: 30010, stop: 30090, target: 29900, reasonCode: "MSS_DISPLACEMENT", blocker: "POI in correct half", note: "bear MSS" });
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 3000, completion_tokens: 120 } }) });
  const ret = A.kickGrokAdvisor({ cards: [card()], books: [book("MNQ", now), book("ES", now)], nowMs: now, brain: null, env: { GROK_ADVISOR: "1", XAI_API_KEY: "test-not-a-key" }, fetchImpl, dir });
  assert.equal(ret, undefined);
  await new Promise((r) => setTimeout(r, 10)); await A.drainAdvisor();
  const s = A.advisorSnapshot(); assert.ok(s.length >= 1); assert.equal(s[0].blocker, "POI in correct half"); assert.equal(s[0].mode, "shadow");
  assert.equal(A.gradeRing([book("MNQ", now)], now), 0, "no bars after the decision yet → nothing graded");
  const later = at(14, 15, 5); const n = A.gradeRing([book("MNQ", later)], later);
  assert.ok(n >= 1); assert.ok(["TARGET", "STOP", "EOD", "NOFILL"].includes(A.advisorSnapshot()[0].grade.outcome));
});

test("grading: closed bars after decision; same-bar stop wins; NOFILL if the setup leaves first; tallies + promotion gate", () => {
  const t0 = at(14, 9, 0); const B = (i, o, hh, l, c) => ({ t: t0 + i * 60_000, o, h: hh, l, c });
  const s = { id: "a", type: "WRONGLY_BLOCKED", reasonCode: "HTF_ARRAY_TAP", blocker: "X", at: t0, side: "short", entry: 100, stop: 110, target: 80 };
  assert.equal(G.gradeAdvice(s, [B(-5, 0, 999, -999, 0), B(0, 98, 101, 97, 99), B(1, 99, 100, 79, 80)]).outcome, "TARGET", "pre-decision bar ignored");
  assert.equal(G.gradeAdvice(s, [B(0, 98, 101, 97, 99), B(1, 99, 111, 79, 80)]).outcome, "STOP");
  assert.equal(G.gradeAdvice(s, [B(0, 95, 98, 79, 80)]).outcome, "NOFILL");
  assert.equal(G.gradeAdvice(s, [B(0, 98, 101, 97, 99), B(1, 99, 100, 95, 95)]).r, 0.5);
  const gs = Array.from({ length: 14 }, (_, i) => ({ id: `${i}`, type: "WRONGLY_BLOCKED", reasonCode: "HTF_ARRAY_TAP", blocker: "X", at: t0, outcome: "TARGET", r: 2, filledAt: t0 }));
  assert.equal(G.promotable("X", gs, { oosFromMs: 0, deskR: 0, deskWr: 0.5 }).promotable, false, "14 < 15");
  const g15 = [...gs, { ...gs[0], id: "15" }];
  assert.equal(G.promotable("X", g15, { oosFromMs: 0, deskR: 0, deskWr: 0.5 }).promotable, true);
  assert.equal(G.promotable("X", g15, { oosFromMs: t0 + 1, deskR: 0, deskWr: 0.5 }).promotable, false, "in-sample cases don't count");
  assert.equal(G.promotable("X", g15, { oosFromMs: 0, deskR: 40, deskWr: 0.5 }).promotable, false, "must beat desk R");
  assert.equal(G.promotable("X", g15, { oosFromMs: 0, deskR: 0, deskWr: null }).promotable, false);
  assert.equal(G.tallies(g15).byBlocker.X.filled, 15);
});

test("X pulse: stub off by default; impact classifier; news tag within ±15 min", async () => {
  assert.deepEqual(await X.pollXPulse({ env: {}, fetchImpl: async () => { throw new Error("no"); } }), []);
  assert.equal(X.classifyImpact("US CPI 3.1% vs 2.9% est").impact, "high");
  const p = [{ id: "1", at: 1_000_000, author: "a", text: "FOMC holds", impact: "high", keywords: ["FOMC"] }];
  assert.equal(X.newsTag(1_000_000 + 10 * 60_000, p).minutesFrom, -10);
  assert.equal(X.newsTag(1_000_000 + 20 * 60_000, p), null);
  assert.match(X.searchQuery(), /from:FirstSquawk/);
});
