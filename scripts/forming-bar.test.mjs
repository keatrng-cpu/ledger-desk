/**
 * Session ρ / alignedReturnPairs: drop the last bar only while forming.
 * When the market is closed the last bar is kept.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

register();
const { alignedReturnPairs } = await import("../src/lib/market/yahoo.ts");

const T0 = 1_700_000_000_000;
const barMs = 60_000;
function bars(n) {
  return Array.from({ length: n }, (_, i) => ({
    t: T0 + i * barMs,
    o: 100,
    h: 101,
    l: 99,
    c: 100 + i,
    v: 1,
  }));
}

test("drops last bar while it is still forming", () => {
  const left = bars(5);
  const right = bars(5);
  // Midway through the last bar.
  const nowMs = left[4].t + barMs / 2;
  const open = alignedReturnPairs(left, right, { nowMs, barMs });
  const closed = alignedReturnPairs(left, right, { nowMs: left[4].t + barMs, barMs });
  // 5 paired closes → 4 returns if last kept; 4 paired → 3 returns if last dropped.
  assert.equal(open.left.length, 3, "forming: last dropped");
  assert.equal(closed.left.length, 4, "closed: last kept");
});

test("when nowMs/barMs omitted, last bar is kept (closed-session safe)", () => {
  const left = bars(4);
  const right = bars(4);
  const pairs = alignedReturnPairs(left, right);
  assert.equal(pairs.left.length, 3);
});

test("Charts rolling ρ matches forming-aware rule (source)", () => {
  const ROOT = fileURLToPath(new URL("..", import.meta.url));
  const src = readFileSync(join(ROOT, "src/components/dashboard/dual-index-charts.tsx"), "utf8");
  assert.match(src, /nowMs < rows\[rows\.length - 1\]!\.t \+ barMs/);
  assert.doesNotMatch(
    src,
    /const closed = rows\.length > 1 \? rows\.slice\(0, -1\) : \[\]/,
    "must not always drop the last bar",
  );
});
