import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const et = await import("../src/lib/smc/every-tf.ts");
const arrays = await import("../src/lib/smc/mtf-arrays.ts");

const B = (t, o, h, l, c, v = 1) => ({ t, o, h, l, c, v });
// 30 one-minute bars starting at epoch 0
const m1 = Array.from({ length: 30 }, (_, i) => B(i * 60_000, 100 + i, 101 + i, 99 + i, 100 + i));
const lastClosedEnd = m1[m1.length - 1].t + 60_000; // nowMs: the last 1m bar has just closed

test("closedBuckets: a forming source bar never changes the closed read (every-close contract)", () => {
  const base = et.closedBuckets(m1, 300_000, 60_000, lastClosedEnd, false); // 5m buckets
  // append a FORMING 1m bar (its span has not elapsed by nowMs)
  const withForming = [...m1, B(lastClosedEnd, 200, 260, 40, 50)];
  const after = et.closedBuckets(withForming, 300_000, 60_000, lastClosedEnd, false);
  assert.deepEqual(after, base, "appending a forming bar must not change the closed buckets");
  assert.ok(base.length > 0);
});

test("closedBuckets: once a bar's span elapses it DOES enter the read (not just ignored)", () => {
  const base = et.closedBuckets(m1, 60_000, 60_000, lastClosedEnd, false);
  const next = B(lastClosedEnd, 50, 51, 49, 50);
  // advance nowMs so the new 1m bar has fully closed
  const after = et.closedBuckets([...m1, next], 60_000, 60_000, lastClosedEnd + 60_000, false);
  assert.equal(after.length, base.length + 1, "an elapsed bar must appear");
  assert.equal(after[after.length - 1].c, 50);
});

test("mtfArrays: the forming 1m bar does not change the array read", () => {
  const now = lastClosedEnd;
  const a = arrays.mtfArrays("MNQ", m1, [], now);
  const b = arrays.mtfArrays("MNQ", [...m1, B(now, 300, 400, 10, 20)], [], now);
  assert.deepEqual(b, a, "a forming bar must not change mtfArrays");
});
