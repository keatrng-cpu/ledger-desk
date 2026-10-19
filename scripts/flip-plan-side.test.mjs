// 2026-10-19: iFVG-flip / LTF-arm plans were built without side/symbol → readEntry & cardFreshness read a long as a
// short (plan.side === "long" false), and restableFromCard saved a paper order with no side/symbol that never fills.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();

test("flip + LTF-arm plans carry the card's symbol and side", () => {
  const bd = readFileSync(new URL("../src/lib/trading/build-desk.ts", import.meta.url), "utf8");
  const arm = bd.split("\n").find((l) => l.includes("entrySrc: `${a.tf} ${a.gap.kind}`"));
  const flip = bd.split("\n").find((l) => l.includes("entrySrc: `${f.tf} iFVG`"));
  for (const l of [arm, flip]) { assert.ok(l, "plan line present"); assert.ok(l.includes("symbol: c.symbol") && l.includes("side: c.side"), l); }
});

test("PriceLadder fallback: stop missing / equal to entry → null ('—'), never 'short'", async () => {
  const L = await import("../src/components/desk/viz/price-ladder.tsx");
  assert.equal(L.ladderSideFromStop(100, 100), null);
  assert.equal(L.ladderSideFromStop(100, null), null);
  assert.equal(L.ladderSideFromStop(100, NaN), null);
  assert.equal(L.ladderSideFromStop(100, 99), "long");
  assert.equal(L.ladderSideFromStop(100, 101), "short");
  const base = { entry: 100, entryZone: null, stop: 100, t1: 110, t2: null, rr1: null, rr2: null, riskPts: 0 };
  assert.equal(L.ladderFrom(base).plan.side, null);
  assert.equal(L.ladderFrom(base, "long").plan.side, "long");
  assert.equal(L.ladderFrom({ ...base, side: "short" }, "long").plan.side, "short");
});

test("PriceLadder fx: null / NaN stop renders '—' instead of throwing", async () => {
  const L = await import("../src/components/desk/viz/price-ladder.tsx");
  assert.equal(L.fx(null), "—"); assert.equal(L.fx(undefined), "—"); assert.equal(L.fx(NaN), "—"); assert.equal(L.fx(29739), "29739.00");
  assert.equal(L.ladderFrom({ entry: 100, entryZone: null, stop: null, t1: 110, t2: null, rr1: null, rr2: null, riskPts: 0 }).plan.side, null);
});

test("PriceLadder renders with stop null (no throw, no STOP rung, '—')", async () => {
  const L = await import("../src/components/desk/viz/price-ladder.tsx");
  const React = await import("react"); const { renderToString } = await import("react-dom/server");
  const { plan } = L.ladderFrom({ entry: 29739, entryZone: null, stop: null, t1: 29683.5, t2: null, rr1: null, rr2: null, riskPts: null }, "short");
  const html = renderToString(React.createElement(L.PriceLadder, { plan, price: 29700 }));
  assert.ok(html.includes("stop —"), html.slice(0, 300)); assert.ok(!html.includes(">STOP<"));
});
