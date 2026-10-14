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
