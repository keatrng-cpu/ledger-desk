import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const L = await import("../src/lib/execution/option-ev-live.ts");

test("modelFromGreeks maps the live quote (delta magnitude, spread=ask-bid, premium=ask)", () => {
  const m = L.modelFromGreeks({ delta: -0.48, gamma: 0.06, thetaPerDay: -0.9, bid: 1.18, ask: 1.22 }, 1 / 50);
  assert.equal(m.delta, 0.48);
  assert.equal(m.gamma, 0.06);
  assert.ok(Math.abs(m.spread - 0.04) < 1e-9);
  assert.equal(m.premium, 1.22);
  assert.equal(m.ratio, 1 / 50);
});

test("no ask → cannot price → null model, reason given", () => {
  assert.equal(L.modelFromGreeks({ delta: 0.5, ask: 0 }, 1 / 50), null);
  const r = L.cardOptionEv(
    { symbol: "MNQ", side: "long", entry: 25000, stop: 24960, targets: [{ price: 25080, rr: 2, pWin: 0.6 }] },
    { delta: 0.5, ask: 0 },
  );
  assert.equal(r.model, null);
  assert.equal(r.best, null);
  assert.match(r.reason, /no ask/);
});

test("missing bid falls back to a spread fraction of the ask (still prices)", () => {
  const m = L.modelFromGreeks({ delta: 0.5, ask: 1.0 }, 1 / 50);
  assert.ok(Math.abs(m.spread - L.DEFAULT_SPREAD_PCT_OF_ASK) < 1e-9);
});

test("cardOptionEv ranks real-greek EV and picks the best calibrated target", () => {
  const card = {
    symbol: "MNQ", side: "long", entry: 25000, stop: 24950, // risk 50 pt
    targets: [
      { price: 25020, rr: 0.4, pWin: 0.8 },   // tiny
      { price: 25120, rr: 2.4, pWin: 0.55 },  // real payoff
      { price: 25300, rr: 6.0, pWin: 0.2 },   // lottery
    ],
  };
  const greeks = { delta: 0.5, gamma: 0.05, thetaPerDay: -1.2, bid: 1.18, ask: 1.22, minutesToExpiry: 300, occ: "QQQ..." };
  const r = L.cardOptionEv(card, greeks, { entryTms: Date.parse("2026-10-15T14:00:00.000Z") });
  assert.ok(r.model && r.ranked.length === 3);
  const maxEv = Math.max(...r.ranked.filter((x) => x.evOpt != null).map((x) => x.evOpt));
  assert.equal(r.best.evOpt, maxEv);
  assert.ok(r.best.evR != null); // futures EV reported alongside
});

test("null-pWin targets are priced but never chosen", () => {
  const card = {
    symbol: "ES", side: "short", entry: 5800, stop: 5810,
    targets: [{ price: 5770, rr: 3, pWin: null }, { price: 5785, rr: 1.5, pWin: 0.6 }],
  };
  const r = L.cardOptionEv(card, { delta: 0.5, gamma: 0.04, bid: 1.0, ask: 1.05, minutesToExpiry: 240 });
  assert.equal(r.best.pWin, 0.6);
  assert.equal(r.ranked.find((x) => x.pWin == null).evOpt, null);
});

test("greeksFromRhQuote maps RH fields and rejects a quote with no ask", () => {
  const g = L.greeksFromRhQuote({ delta: "0.47", gamma: "0.05", theta: "-0.8", implied_volatility: "0.2", bid_price: "1.10", ask_price: "1.14", occ_symbol: "QQQ261015C00500000" }, 300);
  assert.equal(g.delta, 0.47);
  assert.equal(g.thetaPerDay, -0.8);
  assert.equal(g.ask, 1.14);
  assert.equal(g.minutesToExpiry, 300);
  assert.equal(L.greeksFromRhQuote({ delta: "0.5", ask_price: null }, 300), null);
});
