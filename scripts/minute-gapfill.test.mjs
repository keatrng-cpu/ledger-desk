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

// ── PR #16 review (Accuracy Review CHANGES) ──────────────────────────────
test("fill bars are snapped to the 0.25 tick (off-tick Yahoo prints never reach the series)", () => {
  const { gw, yahoo } = esCase();
  const off = yahoo.map((b) => ({ ...b, o: b.o + 0.07, h: b.h + 0.11, l: b.l - 0.13, c: b.c + 0.02 }));
  const f = mg.fillMinuteSeries(gw, off, 2000);
  for (const b of f.bars.filter((x) => x.v !== 999)) for (const k of ["o", "h", "l", "c"]) assert.equal(b[k] % 0.25, 0, `${k} ${b[k]} @ ${new Date(b.t).toISOString()}`);
  assert.equal(mg.snapTick(7755.87), 7755.75);
  assert.equal(mg.snapTick(29703.13), 29703.25);
});

test("Yahoo stamps are floored to the minute — no duplicate minute next to a gateway bar", () => {
  const { gw, yahoo } = esCase();
  // Yahoo stamps 30 s late (and one minute split into two prints).
  const late = yahoo.map((b) => ({ ...b, t: b.t + 30_000 }));
  late.push({ ...late[100], t: late[100].t + 15_000, h: late[100].h + 1, v: 5 });
  const f = mg.fillMinuteSeries(gw, late, 5000);
  assert.ok(f.bars.every((b) => b.t % 60_000 === 0), "every stamp minute-aligned");
  assert.equal(new Set(f.bars.map((b) => b.t)).size, f.bars.length, "no duplicate minute");
  // Gateway bar still wins on a minute both have.
  assert.equal(f.bars.find((b) => b.t === et(15, 0, 5)).v, 999);
  assert.deepEqual(f.gaps, []);
  const split = mg.normalizeFillBars([{ t: 90_000, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 }, { t: 100_000, o: 1.5, h: 3, l: 1, c: 2.5, v: 2 }]);
  assert.deepEqual(split, [{ t: 60_000, o: 1, h: 3, l: 0.5, c: 2.5, v: 3 }]);
});

test("live-end hole: gateway stalled while Yahoo continues → trailing gap, Yahoo not stitched on", () => {
  const { gw, yahoo } = esCase();
  const stalled = gw.filter((b) => b.t <= et(15, 9, 20));
  const now = et(15, 9, 29) + 20_000;
  const raw = mg.findMinuteGaps(stalled, undefined, now);
  assert.equal(raw.length, 2);
  assert.equal(raw.at(-1).trailing, true);
  assert.equal(raw.at(-1).fromMs, et(15, 9, 20));
  assert.equal(raw.at(-1).toMs, et(15, 9, 29));
  const f = mg.fillMinuteSeries(stalled, yahoo, 2000, now);
  assert.equal(f.gaps.length, 1);
  assert.equal(f.gaps[0].trailing, true);
  assert.equal(f.bars.at(-1).t, et(15, 9, 20));
  // A live gateway (forming minute present) has no trailing gap; the halt is not a stall.
  assert.deepEqual(mg.findMinuteGaps(gw, undefined, et(15, 9, 30) + 5_000), mg.findMinuteGaps(gw));
  assert.deepEqual(mg.findMinuteGaps([bar(et(15, 16, 59), 1, 1)], undefined, et(15, 17, 45)), []);
});

test("AMD read surfaces gapped (desk flag, or a >5 min Globex hole) instead of building on the hole", async () => {
  const amd = await import("../src/lib/smc/seq/amd-state.ts");
  const { gw, yahoo } = esCase();
  const map = { levels: [{ name: "PMH", price: 7755.75, kind: "pm" }], arrays: [], atr15: 4 };
  const now = et(15, 9, 30);
  const holed = amd.amdRead("ES", map, gw, now);
  assert.equal(holed.gapped, true);
  assert.match(holed.gapReason, /1m hole .*541m/);
  assert.equal(holed.live, null);
  const flagged = amd.amdRead("ES", map, mg.fillMinuteSeries(gw, yahoo, 2000).bars, now, { gapped: true });
  assert.equal(flagged.gapped, true);
  const clean = amd.amdRead("ES", map, mg.fillMinuteSeries(gw, yahoo, 2000).bars, now);
  assert.notEqual(clean.gapped, true);
});

// ── preview-16 blocker: which residual holes block ───────────────────────
const Z = (hh, mm) => Date.UTC(2026, 9, 15, hh, mm);
test("today's 4-minute 06:14–06:19Z (01:14 CT) thin-overnight hole does NOT block at 09:15 CT", () => {
  const bars = [bar(Z(6, 13), 1, 1), bar(Z(6, 14), 1, 1), bar(Z(6, 19), 1, 1), bar(Z(6, 20), 1, 1)];
  const gaps = mg.findMinuteGaps(bars);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].missing, 4);
  const c = mg.classifyGap(gaps[0], Z(14, 15)); // 09:15 CT
  assert.equal(c.blocking, false);
  assert.equal(c.why, "minor-overnight");
  assert.deepEqual(mg.blockingGaps(gaps, Z(14, 15)), []);
});

test("a 4-minute hole 10 minutes ago blocks (inside the active lookback)", () => {
  const now = Z(14, 15);
  const g = { fromMs: Z(14, 0), toMs: Z(14, 5), missing: 4 };
  const c = mg.classifyGap(g, now);
  assert.equal(c.blocking, true);
  assert.match(c.why, /active 240m lookback/);
});

test("large holes block: today's 00:10–09:12 ET (unfilled), a ≥15m overnight hole, and premarket/RTH overlap", () => {
  const { gw } = esCase();
  const [g] = mg.findMinuteGaps(gw);
  assert.equal(mg.classifyGap(g, Z(14, 15)).blocking, true);
  const night = mg.classifyGap({ fromMs: Z(5, 0), toMs: Z(5, 16), missing: 15 }, Z(14, 15)); // 01:00 ET, 15m
  assert.equal(night.blocking, true);
  assert.match(night.why, /large/);
  // 4-min hole at 07:30 ET (premarket), checked late in the day (outside the 240m lookback).
  const pre = mg.classifyGap({ fromMs: Z(11, 30), toMs: Z(11, 35), missing: 4 }, Z(19, 45));
  assert.equal(pre.blocking, true);
  assert.match(pre.why, /premarket/);
  // Trailing live-end hole always blocks.
  assert.equal(mg.classifyGap({ fromMs: Z(3, 0), toMs: Z(3, 4), missing: 3, trailing: true }, Z(14, 15)).blocking, true);
});
