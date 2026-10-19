// firing-audit-1019: 4h buckets anchored to the 18:00 ET Globex open (DST-aware), closed buckets only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const mg = await import("../src/lib/market/minute-gaps.ts");
const ma = await import("../src/lib/smc/mtf-arrays.ts");
const tl = await import("../src/lib/trading/tf-ladder.ts");
const H4 = 14_400_000, M15 = 900_000;
const etHm = (t) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));
// 15m bars from Sun 18:00 ET on; the weekday 17:00-18:00 ET halt has no bars
function bars15(startIso, n) {
  const out = []; let t = Date.parse(startIso), px = 100;
  while (out.length < n) {
    const hm = etHm(t);
    if (!(hm >= "17:00" && hm < "18:00")) { out.push({ t, o: px, h: px + 2, l: px - 1, c: px + 1, v: 10 }); px += 1; }
    t += M15;
  }
  return out;
}

test("bucketStart: 4h buckets open at 18/22/02/06/10/14 ET in EDT and EST; other sizes keep the epoch floor", () => {
  for (const [iso, want] of [["2026-10-19T13:37:00Z", "06:00"], ["2026-10-19T14:05:00Z", "10:00"], ["2026-10-19T22:30:00Z", "18:00"], ["2026-10-20T02:10:00Z", "22:00"],
                             ["2026-01-12T15:20:00Z", "10:00"], ["2026-01-12T23:10:00Z", "18:00"], ["2026-01-13T07:59:00Z", "02:00"]]) {
    assert.equal(etHm(mg.bucketStart(Date.parse(iso), H4)), want, iso);
  }
  const t = Date.parse("2026-10-19T13:37:00Z");
  for (const ms of [300_000, 900_000, 1_800_000, 3_600_000]) assert.equal(mg.bucketStart(t, ms), Math.floor(t / ms) * ms);
  assert.equal(etHm(mg.bucketEnd(mg.bucketStart(Date.parse("2026-10-19T19:00:00Z"), H4), H4)), "17:00"); // 14:00 bucket ends at the halt
});

test("mtf-arrays rung 4h: anchored buckets, forming bucket never returned (no lookahead)", () => {
  const src = bars15("2026-10-18T22:00:00Z", 140); // Sun 18:00 ET onward
  const last = src[src.length - 1];
  const nowMs = last.t + M15 + 1000;
  const { bars } = ma.rung("NQ", src, "4h", nowMs);
  assert.ok(bars.length >= 6);
  for (const b of bars) assert.ok(["18:00", "22:00", "02:00", "06:00", "10:00", "14:00"].includes(etHm(b.t)), etHm(b.t));
  for (const b of bars) assert.ok(mg.bucketEnd(b.t, H4) <= nowMs, "only closed 4h buckets");
  const b0 = bars[1]; const inside = src.filter((x) => x.t >= b0.t && x.t < mg.bucketEnd(b0.t, H4));
  assert.equal(b0.o, inside[0].o); assert.equal(b0.c, inside[inside.length - 1].c);
  assert.equal(b0.h, Math.max(...inside.map((x) => x.h))); assert.equal(b0.l, Math.min(...inside.map((x) => x.l)));
  // clock in the middle of the last bucket: that half-built bucket is not a 4h close
  const cut = bars[bars.length - 1].t + 2 * M15;
  const { bars: early } = ma.rung("NQ", src.filter((x) => x.t < cut), "4h", cut + 1000);
  assert.ok(early.every((b) => b.t < bars[bars.length - 1].t));
});

test("tf-ladder resampleMs: 4h anchored, 5m unchanged", () => {
  const r = tl.resampleMs(bars15("2026-10-18T22:00:00Z", 40), H4);
  assert.deepEqual(r.slice(0, 3).map((b) => etHm(b.t)), ["18:00", "22:00", "02:00"]);
  const m1 = Array.from({ length: 30 }, (_, i) => ({ t: Date.parse("2026-10-19T13:30:00Z") + i * 60_000, o: 1, h: 2, l: 0, c: 1, v: 1 }));
  assert.deepEqual(tl.resampleMs(m1, 300_000).map((b) => b.t), m1.filter((_, i) => i % 5 === 0).map((b) => b.t));
});
