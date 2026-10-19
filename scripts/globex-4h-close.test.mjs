/** 4h Globex anchor (PR #55, Accuracy review 2026-10-19): killClearedOf + premarket closedBuckets use bucketStart/bucketEnd. Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const mc = await import("../src/lib/smc/mtf-context.ts");
const pm = await import("../src/lib/smc/seq/premarket-map.ts");
const H = 3_600_000;
const T14 = Date.UTC(2026, 9, 14, 18, 0); // 14:00 EDT
const bars = (n, step, c) => Array.from({ length: n }, (_, i) => ({ t: T14 + i * step, o: c, h: c + 0.25, l: c - 0.25, c, v: 1 }));

test("killClearedOf: the 14:00 ET 4h bucket is a closed rung at the 17:00 ET halt (Globex anchor, not epoch)", () => {
  const m = bars(180, 60_000, 30548); // 14:00–16:59 ET, all below the level
  const r = mc.killClearedOf(m, "short", [{ side: "short", t: T14, level: 30568.5, why: "x" }]);
  assert.ok(r, "cleared");
  assert.match(r.why, /\/4h closed/);
  assert.equal(r.t, T14 + 3 * H); // 4h close time = 17:00 ET, not 18:00
});

test("killClearedOf: 4h bucket still open before the halt does not count", () => {
  const m = bars(179, 60_000, 30548);
  const r = mc.killClearedOf(m, "short", [{ side: "short", t: T14, level: 30568.5, why: "x" }]);
  assert.ok(!r || !/4h/.test(r.why));
});

test("premarket closedBuckets: 14:00 ET 4h bucket closes at 17:00 ET", () => {
  const b15 = bars(12, 900_000, 100);
  assert.ok(pm.closedBuckets(b15, 4 * H, T14 + 3 * H).some((b) => b.t === T14));
  assert.ok(!pm.closedBuckets(b15, 4 * H, T14 + 3 * H - 1).some((b) => b.t === T14));
});
