// Regression: 2026-10-16 08:52 CT the Now tab white-screened with
// "Cannot read properties of undefined (reading 'toUpperCase')" after a fast
// MNQ leg (~-192 pts to ~29840). A card/array field arrived undefined and a
// bare .toUpperCase() in one Now panel took the whole tab down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();

const NOW_TREE = [
  "four-facts-board", "entry-hero", "two-sided-ladder-panel", "price-path-board",
  "overnight-board", "setup-scanner", "setup-chart-panel", "setup-chart",
  "paper-book-panel", "tf-ladder-panel", "shadow-book-panel", "trade-debrief-panel",
  "htf-bias-board", "live-says-panel", "premarket-panel", "live-session-card",
  "propfirm-panel", "market-narrative-panel",
].map((f) => `src/components/desk/${f}.tsx`);

test("no unguarded .toUpperCase() in the Now tree", () => {
  const bad = [];
  for (const f of NOW_TREE) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      for (const m of line.matchAll(/([\w$.\]\)]+)\.toUpperCase\(\)/g)) {
        const recv = m[1];
        // Allowed: literal-fallback parens like (x ?? "QQQ"), or a receiver
        // guarded by a ternary on the same identifier earlier in the line.
        if (recv.endsWith(")") && /\?\?\s*"[^"]*"\)$/.test(line.slice(0, m.index + recv.length))) continue;
        if (new RegExp(`${recv.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\?`).test(line.slice(0, m.index))) continue;
        bad.push(`${f}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(bad, []);
});

test("every Now panel sits inside a PanelBoundary", () => {
  const src = readFileSync("src/routes/index.tsx", "utf8");
  const start = src.indexOf('cat === "trade" && (');
  const block = src.slice(start, src.indexOf('cat === "swing" && (', start));
  for (const name of ["FourFactsBoard", "EntryHero", "PricePathBoard", "SetupScanner", "SetupChartPanel", "MarketNarrativePanel", "PropFirmPanel"]) {
    assert.match(block, new RegExp(`<PanelBoundary name="${name}">\\s*<${name}\\b`), name);
  }
});

test("chart array label never throws on a real SmcArray with fields missing at runtime", async () => {
  const { groupName } = await import("../src/components/desk/setup-chart.tsx");
  // Real SmcArray shape (smc-board.ts SmcArray): breaker kind is "bb".
  const bb = { kind: "bb", tf: "5m", side: "bear", top: 29849.25, bottom: 29829, mid: 29839.13, t: 1792155360000, at: "2026-10-16T13:52:00Z", state: "fresh", label: "5m BB" };
  assert.equal(groupName({ outer: bb, inner: [] }, null), "5M BRK");
  // Same object as it would arrive if a feed dropped fields the type promises.
  const noTf = { ...bb, tf: undefined };
  const noKind = { ...bb, kind: undefined };
  assert.doesNotThrow(() => groupName({ outer: noTf, inner: [] }, null));
  assert.doesNotThrow(() => groupName({ outer: noKind, inner: [] }, null));
  assert.doesNotThrow(() => groupName({ outer: bb, inner: [bb, noTf] }, noTf));
});
