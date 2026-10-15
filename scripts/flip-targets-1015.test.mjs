// 10/15 post-mortem items 1+2: read-priority flip gets T1 from the scanner's full pool list; desk T1 freeze.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const F = await import("../src/lib/smc/ifvg-flip.ts");
const M = await import("../src/lib/smc/mtf-arrays.ts");
const A = await import("../src/lib/smc/ltf-arm.ts");
const Z = await import("../src/lib/trading/t1-freeze.ts");
const fc = await import("../src/lib/execution/fast-chain.ts");

const flipAt = (bars, now, side) => {
  const upto = bars.filter((b) => b.t + 60_000 <= now);
  const arr = M.mtfArrays("ES:rp", upto, []).map((r) => ({ ...r, ...M.through1m(upto, r, now) })).filter((r) => r.tf === "5m" || r.tf === "15m");
  const sess = A.sessionPools(upto, now, 60_000);
  const targets = F.flipTargets(sess, F.scannerPools({ symbol: "ES:rp", side, minute: upto, nowMs: now, arrays: arr }));
  return { f: F.ifvgFlipOf({ symbol: "ES:rp", side, minute: upto, closed15: [], targets, nowMs: now, arrays: arr }), arr, px: upto.at(-1).c, sessOnly: F.ifvgFlipOf({ symbol: "ES:rp", side, minute: upto, closed15: [], targets: sess, nowMs: now, arrays: arr }) };
};

test("10/15 13:03 CT ES read-priority short: entry 7781.75 stop 7786.76, T1 = the 7775.25 EQL (>= 1R), fireable", { skip: !existsSync("/tmp/es1m_1015.json") }, () => {
  const bars = JSON.parse(readFileSync("/tmp/es1m_1015.json", "utf8"));
  const now = Date.UTC(2026, 9, 15, 18, 3, 5);
  const { f, arr, px, sessOnly } = flipAt(bars, now, "short");
  assert.equal(sessOnly.t1, null);                       // the bug: session pools only -> no T1
  assert.equal(f.entry, 7781.75); assert.equal(f.stop, 7786.76);
  assert.ok(f.t1 && f.t1.price <= 7775.25 && f.t1.price < f.entry, JSON.stringify(f.t1));
  assert.equal(f.t1.name, "EQL"); assert.equal(f.t1.price, 7775.25); assert.ok(f.rr1 >= 1);
  // fireable on the fast chain: plan/geometry ok, no iFVG against the short, A- band
  const rows = Object.fromEntries(fc.fastSetupRows({ band: "A-", q: 0.68, symbol: "ES", side: "short", entry: f.entry, stop_px: f.stop, first_target: f.t1.price, px: f.entry, atr: 6, brain_symbol: "ES", brain_side: "short", bias1h: "bear", bias4h: "bear", expMin: 10, etMin: 843, arrays: arr }));
  for (const k of ["fast:plan", "fast:geometry", "fast:ifvg", "fast:agree", "fast:entry"]) assert.ok(rows[k], k);
  assert.ok(px > f.t1.price);                            // T1 not yet traded at the arm
});

const mk = (t, o, h, l, c) => ({ t, o, h, l, c, v: 1 });
test("scannerPools: EQL/EQH from unswept pivots, swing lows for shorts only, opposite FVG tops; swept pivots dropped; mirrored for longs", () => {
  const t0 = Date.UTC(2026, 9, 15, 15, 0); const m = (k) => t0 + k * 60_000;
  const xs = [mk(m(0), 10, 11, 9, 10), mk(m(1), 10, 10.5, 5, 6), mk(m(2), 6, 8, 6, 7.5), mk(m(3), 7.5, 9, 7, 8), mk(m(4), 8, 8.5, 5.25, 6),
    mk(m(5), 6, 9, 6, 8.75), mk(m(6), 8.75, 15, 8.5, 14.5), mk(m(7), 14.5, 15.25, 13, 13.5), mk(m(8), 13.5, 14, 12, 13), mk(m(9), 13, 15, 12.5, 14), mk(m(10), 14, 14.5, 13, 13.5)];
  const now = m(11);
  const sh = F.scannerPools({ symbol: "T", side: "short", minute: xs, nowMs: now, arrays: [{ tf: "5m", kind: "fvg", dir: "bull", lo: 9, hi: 11, ageBars: 1 }, { tf: "5m", kind: "fvg", dir: "bull", lo: 3, hi: 4, ageBars: 1, through1mAgeMin: 2 }] });
  assert.deepEqual(sh.find((p) => p.name === "EQL"), { name: "EQL", price: 5 });
  assert.ok(sh.some((p) => p.name === "5m bull FVG top" && p.price === 11));
  assert.ok(!sh.some((p) => p.price === 4));               // closed-through gap is not a target
  assert.ok(sh.every((p) => /low|EQL|bull FVG/.test(p.name)));
  const lg = F.scannerPools({ symbol: "T", side: "long", minute: xs, nowMs: now, arrays: [] });
  assert.deepEqual(lg.find((p) => p.name === "EQH"), { name: "EQH", price: 15.25 });
  assert.ok(lg.every((p) => /high|EQH|bear FVG/.test(p.name)));
  // sweep the lows -> no EQL
  const sw = F.scannerPools({ symbol: "T", side: "short", minute: [...xs, mk(m(11), 13.5, 13.5, 4, 4.5)], nowMs: m(12), arrays: [] });
  assert.ok(!sw.some((p) => p.name === "EQL"));
  assert.deepEqual(F.scannerPools({ symbol: "T", minute: xs.slice(0, 3), nowMs: now }), []);
});
test("flip long mirrors the short: bear gaps closed through -> long, T1 from EQH/swing high pools", () => {
  const ce = 100, targets = F.flipTargets([], [{ name: "EQH", price: 106 }, { name: "1m swing high", price: 101 }]);
  const ahead = targets.filter((p) => p.price > ce && (p.price - ce) / 5 >= 1).sort((a, b) => a.price - b.price);
  assert.equal(ahead[0].name, "EQH");
  assert.equal(F.flipTargets([{ name: "Asia low", price: 5 }], [{ name: "EQL", price: 5 }])[0].name, "EQL");
});

test("desk T1 freeze: armed freezes, later re-selection can't move it, unarmed un-fired releases, fired holds; per session day", () => {
  const S = new Map(); const now = Date.UTC(2026, 9, 15, 18, 3);
  const base = { symbol: "ES", side: "short", entry: 7781.75, stop: 7786.76 };
  assert.equal(Z.t1Freeze(S, { ...base, t1: 7775.25, state: null }, now).frozen, null);
  let r = Z.t1Freeze(S, { ...base, t1: 7775.25, t1Name: "EQL", state: "armed" }, now); assert.equal(r.t1, 7775.25); assert.equal(r.rr1, 1.3); assert.match(r.note, /frozen/);
  r = Z.t1Freeze(S, { ...base, t1: 7772, state: "armed" }, now + 60_000); assert.equal(r.t1, 7775.25); assert.match(r.note, /held at frozen 7775.25/);
  r = Z.t1Freeze(S, { ...base, t1: null, state: "armed" }, now + 90_000); assert.equal(r.t1, 7775.25);
  r = Z.t1Freeze(S, { ...base, t1: 7772, state: null }, now + 120_000); assert.equal(r.frozen, null); assert.equal(r.t1, 7772);
  Z.t1Freeze(S, { ...base, t1: 7775.25, state: "armed" }, now); Z.markT1Fired(S, Z.freezeSid("ES", "short", 7781.75));
  r = Z.t1Freeze(S, { ...base, t1: 7760, state: null }, now + 200_000); assert.equal(r.t1, 7775.25); assert.equal(r.frozen.state, "fired");
  r = Z.t1Freeze(S, { ...base, t1: 7760, state: null }, now + 86_400_000); assert.equal(r.frozen, null);
});
