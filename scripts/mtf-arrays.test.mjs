/**
 * Multi-timeframe arrays + continuation array (src/lib/smc/mtf-arrays.ts).
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const m = await import("../src/lib/smc/mtf-arrays.ts");

const T0 = Date.UTC(2026, 9, 13, 13, 0);
function minuteTape() {
  const out = [];
  let p = 100;
  for (let i = 0; i < 120; i++) {
    const w = Math.sin(i / 3) * 0.6;
    out.push({ t: T0 + i * 60_000, o: p + w, h: p + w + 0.5, l: p + w - 0.5, c: p + w + 0.1, v: 1 });
  }
  // the raid at i=120, then a clean bullish staircase: every 3 bars leave a 1m bull gap
  out.push({ t: T0 + 120 * 60_000, o: 100, h: 100.2, l: 97, c: 99.8, v: 1 });
  for (let k = 1; k <= 8; k++) {
    const l = 100 + 2 * k;
    out.push({ t: T0 + (120 + k) * 60_000, o: l + 0.1, h: l + 1, l, c: l + 0.9, v: 1 });
  }
  return { tape: out.map((b, i) => ({ ...b, t: T0 + i * 60_000 })), raidT: T0 + 120 * 60_000 };
}
const bars15 = Array.from({ length: 80 }, (_, i) => {
  const p = 100 + Math.sin(i / 2) * 3;
  return { t: T0 - (80 - i) * 900_000, o: p, h: p + 2, l: p - 2, c: p + 0.5, v: 1 };
});

test("every rung 1m..4h is read, rows carry tf/kind/dir/lo/hi/ce/mitigated/ageBars", () => {
  const { tape } = minuteTape();
  const rows = m.mtfArrays("MNQ", tape, bars15);
  assert.ok(rows.some((r) => r.tf === "1m"));
  for (const r of rows) {
    assert.ok(["fvg", "ifvg", "sponsored"].includes(r.kind));
    assert.ok(r.lo <= r.hi && Math.abs(r.ce - (r.lo + r.hi) / 2) < 0.011);
    assert.ok(r.ageBars >= 0);
  }
});

test("wire list is capped at 30, live gaps first", () => {
  const { tape } = minuteTape();
  const rows = m.mtfArrays("MNQ", tape, bars15);
  const w = m.wireArrays([...rows, ...rows, ...rows]);
  assert.ok(w.length <= 30);
  const firstMit = w.findIndex((r) => r.mitigated);
  if (firstMit >= 0) assert.ok(w.slice(firstMit).every((r) => r.mitigated));
});

test("continuation: ≥2 stacked bull 1m gaps after the raid; entry at the latest CE; stop ≥ 0.5×ATR15 (shared rules)", () => {
  const { tape, raidT } = minuteTape();
  const c = m.continuationArray("MNQ-c", tape, "bull", raidT, 16); // 0.5×16 = 8 < origin distance
  assert.ok(c, "expected a stack");
  assert.ok(c.count >= 2);
  assert.ok(m.LTF_RUNGS.includes(c.tf));
  assert.ok(c.entry - c.stop >= 0.5 * 16 - 1e-9, `stop distance ${c.entry - c.stop}`);
  assert.equal(c.stop, 97); // beyond the stack's origin (the raid bar's low)
  const wide = m.continuationArray("MNQ-c", tape, "bull", raidT, 50); // 0.5×50 = 25 > origin distance
  assert.equal(wide.minStopApplied, true);
  assert.ok(Math.abs(wide.entry - wide.stop - 25) < 0.011);
  assert.equal(m.continuationArray("MNQ-c", tape, "bear", raidT, 40), null);
  assert.equal(m.continuationArray("MNQ-c", tape, "bull", null, 40), null);
});

test("resamples are cached and stay inside the load budget", () => {
  const big = Array.from({ length: 2400 }, (_, i) => {
    const p = 100 + Math.sin(i / 7) * 5 + (i % 11) * 0.1;
    return { t: T0 + i * 60_000, o: p, h: p + 1, l: p - 1, c: p + 0.3, v: 1 };
  });
  const b15 = Array.from({ length: 600 }, (_, i) => ({ ...bars15[i % 80], t: T0 - (600 - i) * 900_000 }));
  const t0 = performance.now();
  m.mtfArrays("PERF", big, b15);
  const cold = performance.now() - t0;
  const t1 = performance.now();
  m.mtfArrays("PERF", big, b15);
  const warm = performance.now() - t1;
  assert.ok(cold < 400, `cold ${cold}ms`);
  assert.ok(warm < cold / 2 || warm < 5, `warm ${warm}ms vs cold ${cold}ms`);
});
