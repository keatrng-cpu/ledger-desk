// #19 (Accuracy Review 2026-10-15 run 4): gateway reconnected 09:12 ET with no
// replay, so its 1m rows jumped 00:10 → 09:12. Today's case, rebuilt: the raw
// gateway series shows the phantom FVGs (ES 7732–7744, MNQ 29803–29837) and
// misses the real ES PMH 7755.75 / MNQ low 29703; the filled series must show
// the real levels and not the fake gaps; an unfillable hole must be reported.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const mg = await import("../src/lib/market/minute-gaps.ts");
const { detectFvgs } = await import("../src/lib/trading/detectors.ts");

const MIN = 60_000;
// 2026-10-15 is EDT (UTC-4): 18:00 ET Oct 14 = 22:00Z.
const et = (d, hh, mm) => Date.UTC(2026, 9, d, hh + 4, mm);
const bar = (t, o, c, pad = 0.5) => ({ t, o, c, h: Math.max(o, c) + pad, l: Math.min(o, c) - pad, v: 100 });

/** Smooth walk through waypoints [tMs, price] — each 1m bar moves a small step (no gaps). */
function walk(points) {
  const out = [];
  for (let k = 1; k < points.length; k++) {
    const [t0, p0] = points[k - 1], [t1, p1] = points[k];
    const n = Math.round((t1 - t0) / MIN);
    for (let i = 0; i < n; i++) {
      const o = p0 + ((p1 - p0) * i) / n, c = p0 + ((p1 - p0) * (i + 1)) / n;
      out.push(bar(t0 + i * MIN, +o.toFixed(2), +c.toFixed(2), 0.25));
    }
  }
  return out;
}

function esCase() {
  // Yahoo (complete): overnight ~7730, London rally to PMH 7755.75 at 03:30, drift to 7745 by 09:12, then live.
  const yahoo = walk([[et(14, 18, 0), 7728], [et(15, 0, 10), 7731.5], [et(15, 3, 30), 7755.5], [et(15, 9, 12), 7744.5], [et(15, 9, 30), 7746]]);
  // The real PMH print (wick).
  const iPmh = yahoo.findIndex((b) => b.t === et(15, 3, 29));
  yahoo[iPmh] = { ...yahoo[iPmh], h: 7755.75 };
  // Gateway: same up to 00:10, nothing until 09:12, then a reconnect bar that jumps.
  const pre = yahoo.filter((b) => b.t <= et(15, 0, 10)).map((b) => ({ ...b, v: 999 }));
  pre[pre.length - 1] = { ...pre[pre.length - 1], o: 7731, c: 7731.5, h: 7732, l: 7730.75 };
  const post = [
    { t: et(15, 9, 12), o: 7733, c: 7745.5, h: 7746, l: 7732.75, v: 999 },
    ...walk([[et(15, 9, 13), 7745.5], [et(15, 9, 29), 7747]]).map((b, i) => ({ ...b, l: i === 0 ? 7744 : Math.max(b.l, 7744), v: 999 })),
  ];
  return { gw: [...pre, ...post], yahoo };
}

function mnqCase() {
  const yahoo = walk([[et(14, 18, 0), 29850], [et(15, 0, 10), 29838], [et(15, 4, 0), 29703.5], [et(15, 9, 12), 29801], [et(15, 9, 30), 29795]]);
  const iLow = yahoo.findIndex((b) => b.t === et(15, 3, 59));
  yahoo[iLow] = { ...yahoo[iLow], l: 29703 };
  const pre = yahoo.filter((b) => b.t <= et(15, 0, 10)).map((b) => ({ ...b, v: 999 }));
  pre[pre.length - 1] = { ...pre[pre.length - 1], o: 29839, c: 29838, h: 29840, l: 29837 };
  const post = [
    { t: et(15, 9, 12), o: 29836, c: 29801, h: 29836.5, l: 29784, v: 999 },
    ...walk([[et(15, 9, 13), 29801], [et(15, 9, 29), 29795]]).map((b, i) => ({ ...b, h: i === 0 ? 29803 : Math.min(b.h, 29803), v: 999 })),
  ];
  return { gw: [...pre, ...post], yahoo };
}

const near = (a, b) => Math.abs(a - b) < 0.3;
const hasGap = (fvgs, kind, bottom, top) => fvgs.some((f) => f.kind === kind && near(f.bottom, bottom) && near(f.top, top));
const premarket = (bars) => bars.filter((b) => b.t >= et(15, 0, 0) && b.t < et(15, 9, 30));

test("ES 2026-10-15: raw gateway has the 9h hole, the phantom 7732–7744 FVG and the wrong PMH", () => {
  const { gw } = esCase();
  const gaps = mg.findMinuteGaps(gw);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].fromMs, et(15, 0, 10));
  assert.equal(gaps[0].toMs, et(15, 9, 12));
  assert.ok(hasGap(detectFvgs(gw), "bull", 7732, 7744), "repro: phantom FVG exists on the raw series");
  assert.ok(Math.max(...premarket(gw).map((b) => b.h)) < 7755.75, "repro: PMH missing");
});

test("ES filled: real PMH 7755.75 and London present, phantom FVG gone, no residual gap", () => {
  const { gw, yahoo } = esCase();
  const f = mg.fillMinuteSeries(gw, yahoo, 2000);
  assert.deepEqual(f.gaps, []);
  assert.equal(f.gatewayGaps.length, 1);
  assert.equal(f.filled, true);
  assert.equal(Math.max(...premarket(f.bars).map((b) => b.h)), 7755.75);
  const london = f.bars.filter((b) => b.t >= et(15, 2, 0) && b.t < et(15, 5, 0));
  assert.equal(london.length, 180);
  assert.ok(!hasGap(detectFvgs(f.bars), "bull", 7732, 7744), "phantom ES FVG must not appear");
  // Gateway rows win where both exist; delayed Yahoo past the gateway end is not used.
  assert.equal(f.bars.find((b) => b.t === et(15, 9, 12)).v, 999);
  assert.equal(f.bars.at(-1).t, gw.at(-1).t);
});

test("MNQ filled: real low 29703 present, phantom 29803–29837 FVG gone", () => {
  const { gw, yahoo } = mnqCase();
  assert.ok(hasGap(detectFvgs(gw), "bear", 29803, 29837), "repro: phantom MNQ FVG");
  assert.equal(Math.min(...premarket(gw).map((b) => b.l)), 29784);
  const f = mg.fillMinuteSeries(gw, yahoo, 2000);
  assert.deepEqual(f.gaps, []);
  assert.equal(Math.min(...premarket(f.bars).map((b) => b.l)), 29703);
  assert.ok(!hasGap(detectFvgs(f.bars), "bear", 29803, 29837), "phantom MNQ FVG must not appear");
});

test("unfillable hole (Yahoo missing) stays reported → desk fails closed", () => {
  const { gw } = esCase();
  const f = mg.fillMinuteSeries(gw, [], 2000);
  assert.equal(f.gaps.length, 1);
  assert.equal(f.gaps[0].missing, 541);
  // Partial Yahoo (only London) still leaves holes.
  const { yahoo } = esCase();
  const part = mg.fillMinuteSeries(gw, yahoo.filter((b) => b.t >= et(15, 2, 0) && b.t < et(15, 5, 0)), 2000);
  assert.equal(part.gaps.length, 2);
});

test("daily halt and weekend are not holes; thin 1–2 minute skips are not holes", () => {
  const halt = [bar(et(15, 16, 59), 1, 1), bar(et(15, 18, 0), 1, 1)];
  assert.deepEqual(mg.findMinuteGaps(halt), []);
  // Fri 16:59 ET → Sun 18:00 ET
  const wknd = [bar(et(16, 16, 59), 1, 1), bar(et(18, 18, 0), 1, 1)];
  assert.deepEqual(mg.findMinuteGaps(wknd), []);
  const thin = [bar(et(15, 2, 0), 1, 1), bar(et(15, 2, 3), 1, 1)];
  assert.deepEqual(mg.findMinuteGaps(thin), []);
  const hole = [bar(et(15, 2, 0), 1, 1), bar(et(15, 2, 4), 1, 1)];
  assert.equal(mg.findMinuteGaps(hole).length, 1);
  assert.equal(mg.globexOpenAt(et(17, 12, 0)), false); // Saturday
  assert.equal(mg.globexOpenAt(et(15, 17, 30)), false); // halt
  assert.equal(mg.globexOpenAt(et(15, 3, 0)), true);
});
