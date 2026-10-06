/**
 * PM analyzer seams (Mead Hall + Predict merged):
 *   - mead-signal-feed: SignalBoard → hall state via hallLayout (jumbotron #1,
 *     rune board next 5), every hall number copied from MarketSignal fields
 *   - crowd reactions only from CrowdRead (real velocity), never random
 *   - a bad poll keeps the last live board (stale), never blanks / mocks
 *   - pm-paper-store: paperTicketFromSignal tickets, de-duped, scored by scorePaper
 *
 * Run: npm test  (node --test, TypeScript via tsx's loader)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";

register();
const F = await import("../src/components/mead/mead-signal-feed.ts");
const E = await import("../src/lib/predict/signals.ts");
const P = await import("../src/lib/predict/pm-paper-store.ts");

const fixture = JSON.parse(readFileSync(new URL("../src/lib/predict/fixtures/kalshi-markets.sample.json", import.meta.url), "utf8"));
const now = Date.parse(fixture.asOf) + 5_000;
const board = E.buildSignalBoard({ raw: fixture.markets, asOf: fixture.asOf }, { now });

test("hall = hallLayout: jumbotron is #1, rune board is the next 5", () => {
  const { hall, layout, ordered } = F.hallStateFromBoard(board);
  const ranked = E.rankSignals(board.signals);
  assert.equal(hall.featuredId, ranked[0].id);
  assert.equal(layout.jumbotron?.id, ranked[0].id);
  assert.deepEqual(hall.topIds, ranked.slice(1, 6).map((s) => s.id));
  assert.ok(hall.topIds.length <= 5);
  assert.equal(ordered.length, board.signals.length);
  // The jumbotron's "other markets" (markets minus featured, first 5) are the rune board.
  assert.deepEqual(hall.markets.filter((m) => m.id !== hall.featuredId).slice(0, 5).map((m) => m.id), hall.topIds);
  assert.equal(hall.status, "live");
});

test("hall rows copy MarketSignal fields — nothing invented", () => {
  const { hall, ordered } = F.hallStateFromBoard(board);
  for (const s of ordered) {
    const m = hall.markets.find((x) => x.id === s.id);
    assert.ok(m);
    assert.equal(m.yesPrice, s.prices.yesAsk);
    assert.equal(m.noPrice, s.prices.noAsk);
    assert.equal(m.winChance, s.implied.mid);
    assert.equal(m.hall?.grade ?? null, s.grade); // omitted hall.grade when ungraded (null)
    assert.equal(m.edge, s.edge.status === "edge" ? s.edge.netPerContract : null);
    // No model input → never a GO/LIMIT mood word.
    if (s.edge.status !== "edge") assert.equal(m.gates.word, "STAND");
  }
});

test("crowd reacts only to real velocity", () => {
  assert.equal(F.reactionForCrowd({ energy: null, mood: "quiet", basedOn: 0, reason: "" }), null);
  assert.equal(F.reactionForCrowd({ energy: 0.3, mood: "restless", basedOn: 3, reason: "" }), null);
  assert.equal(F.reactionForCrowd({ energy: 0.3, mood: "surging", basedOn: 3, reason: "" }), "cheer");
  assert.equal(F.reactionForCrowd({ energy: 0.8, mood: "surging", basedOn: 3, reason: "" }), "hail");
  assert.equal(F.reactionForCrowd({ energy: 0.4, mood: "sliding", basedOn: 3, reason: "" }), "groan");
  // Fixture board has no candles → no velocity → quiet crowd.
  const { layout } = F.hallStateFromBoard(board);
  assert.equal(F.reactionForCrowd(layout.crowd), null);
});

test("a failed / empty poll keeps the last live board, marked stale", () => {
  const live = F.nextHallState(F.EMPTY_FEED, board);
  assert.equal(live.status, "live");
  const failed = F.nextHallState(live, null, "HTTP 429");
  assert.equal(failed.held, true);
  assert.equal(failed.board, live.board);
  assert.match(failed.hall.note, /STALE/);
  const empty = F.nextHallState(live, { ...board, signals: [] });
  assert.equal(empty.held, true);
  const cold = F.nextHallState(F.EMPTY_FEED, null, "HTTP 503");
  assert.equal(cold.status, "error");
  assert.equal(cold.hall.markets.length, 0);
});

test("paper book: tickets from paperTicketFromSignal, de-duped, read too-few until settled", () => {
  const s = board.signals[0];
  const t = E.paperTicketFromSignal(s, { side: "yes" });
  assert.ok(t);
  assert.equal(t.entryPrice, s.prices.yesAsk);
  let r = P.withTicket([], t);
  assert.equal(r.added, true);
  r = P.withTicket(r.book, t);
  assert.equal(r.added, false);
  assert.equal(r.book.length, 1);
  assert.deepEqual(P.parsePaperBook(JSON.stringify([t, { junk: 1 }])), [t]);
  assert.deepEqual(P.parsePaperBook("not json"), []);
  const score = E.scorePaper(r.book);
  assert.equal(score.open, 1);
  assert.equal(score.overall.read, E.TOO_FEW);
});

test("Accuracy should-fix copy in pm-analyzer (unsettled + Murphy REL + ok buckets)", () => {
  const src = readFileSync(new URL("../src/components/predict/pm-analyzer.tsx", import.meta.url), "utf8");
  assert.match(src, /settled === 0 \? "unsettled"/);
  assert.match(src, /unsettled — no settlements yet/);
  assert.match(src, /Calibration \(1−Murphy REL\)/);
  assert.match(src, /b\.read !== "ok"/);
  // Do not invent grades in the analyzer UI layer from this follow-up (Stand owns signals.ts).
  assert.match(src, /gradeLabel/);
  assert.match(src, /NO_GRADE_LABEL/);
  assert.doesNotMatch(src, /signals\.ts/);
});
