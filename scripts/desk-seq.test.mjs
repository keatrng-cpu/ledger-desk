import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const RULES = (await import("../shared/desk-rules.json", { with: { type: "json" } })).default;
const bb = await import("../src/lib/smc/seq/brain-books.ts");

test("deskSeq: every item ships shadow; band edges unchanged", () => {
  for (const [k, v] of Object.entries(RULES.deskSeq)) if (v && typeof v === "object" && "mode" in v) assert.equal(v.mode, "shadow", k);
  assert.deepEqual(RULES.bandEdges, { "A+": 0.75, A: 0.68, "A-": 0.65, "B+": 0.6, B: 0.5 });
});

test("F5 brainBooks: today's 09:52 — legacy STAND ES long, MNQ book TAKE short → caution not block", () => {
  const books = bb.brainBooks([{ symbol: "MNQ", side: "short", word: "TAKE" }, { symbol: "ES", side: "long", word: "STAND", missing: "POI in correct half" }]);
  assert.equal(books.words.MNQ.short, "TAKE");
  assert.equal(books.words.MNQ.long, "UNGRADED");
  const t = bb.ticketWord(books, { symbol: "MNQ", side: "short" }, { symbol: "ES", side: "long", word: "STAND" });
  assert.equal(t.otherBookBlock, true);
  assert.equal(t.wouldUnblock, true);
  assert.equal(t.wouldBlock, false);
});

test("F5 brainBooks: same symbol opposite side is never weakened (Accuracy #2)", () => {
  const books = bb.brainBooks([{ symbol: "MNQ", side: "short", word: "TAKE" }]);
  const t = bb.ticketWord(books, { symbol: "MNQ", side: "short" }, { symbol: "MNQ", side: "long", word: "STAND" });
  assert.equal(t.otherBookBlock, false);
  assert.equal(t.wouldUnblock, false);
});

test("F5 brainBooks: legacy agreement via another book while this book refuses → wouldBlock", () => {
  const books = bb.brainBooks([{ symbol: "MNQ", side: "short", word: "STAND" }]);
  const t = bb.ticketWord(books, { symbol: "MNQ", side: "short" }, { symbol: "ES", side: "short", word: "TAKE" });
  assert.equal(t.wouldBlock, true);
});

test("F5 brainBooks: ungraded book never unblocks", () => {
  const books = bb.brainBooks([{ symbol: "ES", side: "long", word: "STAND" }]);
  const t = bb.ticketWord(books, { symbol: "MNQ", side: "short" }, { symbol: "ES", side: "long", word: "STAND" });
  assert.equal(t.word, "UNGRADED");
  assert.equal(t.wouldUnblock, false);
});

const pd = await import("../src/lib/smc/seq/pd-leg.ts");
const T = Date.UTC(2026, 9, 14, 13, 30); // 09:30 ET
const mk = (xs) => xs.map(([o, h, l, c], k) => ({ t: T + k * 60e3, o, h, l, c }));

test("F6 pdLeg: continuation short POI in the leg's premium passes while current price is in discount", () => {
  // rally to 30656 (manipulation high), displacement to 30472
  const xs = [];
  let p = 30560;
  for (let k = 0; k < 10; k++) { xs.push([p, p + 12, p - 2, p + 10]); p += 10; }    // up to ~30660
  xs.push([30650, 30656, 30640, 30645]);
  for (let k = 0; k < 9; k++) { xs.push([p, p + 2, p - 22, p - 20]); p -= 20; }       // down
  const bars = mk(xs);
  const leg = pd.legOf(bars, "short");
  assert.equal(leg.hi, Math.max(...bars.map((b) => b.h)));
  const r = pd.pdLegRead({ side: "short", poi: 30600, price: leg.lo + 5, closed1m: bars, feedNowMs: bars.at(-1).t + 60e3, legacyFail: true });
  assert.equal(r.atPoi.zone, "premium");
  assert.equal(r.atPrice.zone, "discount");
  assert.equal(r.pass, true);
  assert.equal(r.flipsLegacy, true);
});

test("F6 pdLeg: a long mirrors; POI on the leg EQ is no edge", () => {
  const xs = [];
  let p = 100;
  for (let k = 0; k < 8; k++) { xs.push([p, p + 0.5, p - 2, p - 1.8]); p -= 2; }
  for (let k = 0; k < 8; k++) { xs.push([p, p + 2.2, p - 0.3, p + 2]); p += 2; }
  const bars = mk(xs);
  const leg = pd.legOf(bars, "long");
  const eq = (leg.hi + leg.lo) / 2;
  const r = pd.pdLegRead({ side: "long", poi: eq, price: leg.hi, closed1m: bars, feedNowMs: null, legacyFail: false });
  assert.equal(r.noEdge, true);
  assert.equal(r.pass, false);
  assert.equal(pd.pdLegRead({ side: "long", poi: leg.lo + 0.1 * (leg.hi - leg.lo), price: leg.hi, closed1m: bars, feedNowMs: null, legacyFail: false }).pass, true);
});

test("F6 eqStack: prior session uses one session with the 18:00 ET roll", () => {
  const d1 = Date.UTC(2026, 9, 13, 21, 0); // 17:00 ET 10/13 (session 10/13)
  const d2 = Date.UTC(2026, 9, 13, 22, 30); // 18:30 ET (session 10/14)
  const bars = [{ t: d1, o: 1, h: 10, l: 5, c: 6 }, { t: d2, o: 6, h: 8, l: 6, c: 7 }, { t: d2 + 60e3, o: 7, h: 7.5, l: 6.5, c: 7 }];
  const st = pd.eqStack(bars, 7, d2 + 120e3);
  const prior = st.find((r) => r.name.startsWith("Prior"));
  assert.deepEqual([prior.hi, prior.lo], [10, 5]);
  const cur = st.find((r) => r.name === "This session");
  assert.deepEqual([cur.hi, cur.lo], [8, 6]);
});
