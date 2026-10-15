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
  // Gap-blind geometry (the pre-fix detector) sees the phantom; the gap-aware detector no longer prints it even unfilled.
  const i = gw.findIndex((b) => b.t === et(15, 9, 12));
  assert.ok(gw[i - 1].h === 7732 && gw[i + 1].l === 7744 && gw[i - 1].h < gw[i + 1].l, "repro: 3-candle gap 7732–7744 across the hole");
  assert.ok(!hasGap(detectFvgs(gw), "bull", 7732, 7744), "detectFvgs skips a pattern spanning the hole");
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
  const i = gw.findIndex((b) => b.t === et(15, 9, 12));
  assert.ok(gw[i - 1].l === 29837 && gw[i + 1].h === 29803, "repro: 3-candle gap 29803–29837 across the hole");
  assert.ok(!hasGap(detectFvgs(gw), "bear", 29803, 29837), "detectFvgs skips a pattern spanning the hole");
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

// ── Gap-aware detectors (Accuracy Review on 4e112f2a) ────────────────────
const flat = (t0, n, p = 100) => Array.from({ length: n }, (_, k) => bar(t0 + k * MIN, p, p + 0.25, 0.25));
test("no FVG across a hole (1m, and in a resampled 5m rung), normal FVG unchanged", async () => {
  const { rung } = await import("../src/lib/smc/mtf-arrays.ts");
  const t0 = et(15, 1, 0);
  // Normal case: contiguous bars, a real bull FVG 100.5 → 103 is found.
  const base = flat(t0, 40);
  const norm = [...base, { t: t0 + 40 * MIN, o: 100.5, c: 103.5, h: 104, l: 100.25, v: 1 }, { t: t0 + 41 * MIN, o: 103.5, c: 104, h: 104.5, l: 103, v: 1 }, ...flat(t0 + 42 * MIN, 5, 104)];
  assert.ok(hasGap(detectFvgs(norm), "bull", 100.5, 103), "normal FVG still detected");
  // Same geometry, but 5 minutes missing between candle 1 and candle 2 → skipped.
  const holed = norm.map((b, k) => (k >= 40 ? { ...b, t: b.t + 5 * MIN } : b));
  assert.ok(!hasGap(detectFvgs(holed), "bull", 100.5, 103), "no FVG across a 5-minute hole");
  // Over the halt (16:59 → 18:00 ET) is NOT a hole.
  const h0 = et(15, 16, 20);
  const halt = [...flat(h0, 40), { t: et(15, 18, 0), o: 100.5, c: 103.5, h: 104, l: 100.25, v: 1 }, { t: et(15, 18, 1), o: 103.5, c: 104, h: 104.5, l: 103, v: 1 }];
  assert.ok(hasGap(detectFvgs(halt), "bull", 100.5, 103), "halt is not a gap");
  // 5m rung: a bucket missing 3+ minutes is dropped, a complete one kept.
  const m = flat(et(15, 2, 0), 60).filter((b) => !(b.t >= et(15, 2, 21) && b.t <= et(15, 2, 23)));
  const r5 = rung("TEST", m, "5m", et(15, 4, 0)).bars.map((b) => b.t);
  assert.ok(!r5.includes(et(15, 2, 20)), "partial 5m bucket 02:20 dropped");
  assert.ok(r5.includes(et(15, 2, 15)) && r5.includes(et(15, 2, 25)), "complete neighbours kept");
  const thin = mg.completeBuckets(flat(et(15, 2, 0), 10).filter((b) => b.t !== et(15, 2, 2)), 5 * MIN, MIN).map((b) => b.t);
  assert.deepEqual(thin, [et(15, 2, 0), et(15, 2, 5)], "1 thin minute does not drop a bucket");
});

test("premarket-map: London H/L flagged incomplete (small hole) / withheld (>= 6m), normal case unchanged", async () => {
  const pmm = await import("../src/lib/smc/seq/premarket-map.ts");
  const { yahoo } = esCase();
  const now = et(15, 9, 0);
  const minute = yahoo.filter((b) => b.t + MIN <= now);
  const lvl = (map, n) => map.levels.filter((l) => l.name.startsWith(n));
  const clean = pmm.premarketMap({ symbol: "ES", minute, nowMs: now });
  assert.equal(clean.incomplete, undefined);
  assert.equal(lvl(clean, "London high")[0].price, 7755.75);
  assert.equal(lvl(clean, "London high")[0].incomplete, undefined);
  assert.equal(lvl(clean, "London high")[0].name, "London high");
  // 4-minute hole at 02:14–02:19 ET (today's thin-overnight shape): flagged, still shown.
  const small = minute.filter((b) => !(b.t > et(15, 2, 14) && b.t < et(15, 2, 19)));
  const s = pmm.premarketMap({ symbol: "ES", minute: small, nowMs: now });
  assert.deepEqual(s.incomplete.London, { missingMin: 4, withheld: false });
  assert.equal(lvl(s, "London high")[0].incomplete, true);
  assert.match(lvl(s, "London high")[0].name, /\(incomplete\)/);
  // 14-minute hole over the real London high (03:20–03:34 ET): withheld, never presented as the London high.
  const big = minute.filter((b) => !(b.t > et(15, 3, 20) && b.t < et(15, 3, 35)));
  const g = pmm.premarketMap({ symbol: "ES", minute: big, nowMs: now });
  assert.deepEqual(g.incomplete.London, { missingMin: 14, withheld: true });
  assert.equal(lvl(g, "London").length, 0);
  assert.ok(g.missing.some((x) => /London H\/L incomplete: 14m.*withheld/.test(x)));
  // And classifyGap: a 14-minute London hole now blocks; the 4-minute one stays minor.
  assert.equal(mg.classifyGap({ fromMs: et(15, 3, 20), toMs: et(15, 3, 35), missing: 14 }, et(15, 10, 15)).blocking, true);
  assert.equal(mg.classifyGap({ fromMs: et(15, 2, 14), toMs: et(15, 2, 19), missing: 4 }, et(15, 10, 15)).blocking, false);
});
