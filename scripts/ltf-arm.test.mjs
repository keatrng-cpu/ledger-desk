import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const RULES = JSON.parse(readFileSync(new URL("../shared/desk-rules.json", import.meta.url)));
const FIX = JSON.parse(readFileSync(new URL("./fixtures/ltf-arm-2026-10-14.json", import.meta.url)));
const KZ0 = Date.UTC(2026, 9, 14, 13, 30); // 09:30 ET

test("ltfArm rules: shadow first, every rung 1m-4h, capped B+, band edges untouched", () => {
  assert.equal(RULES.ltfArm.mode, "shadow");
  assert.deepEqual(RULES.ltfArm.tfs, ["1m", "2m", "3m", "4m", "5m", "15m", "30m", "1h", "4h"]);
  assert.equal(RULES.ltfArm.capBand, "B+");
  assert.deepEqual(RULES.bandEdges, { "A+": 0.75, A: 0.68, "A-": 0.65, "B+": 0.6, B: 0.5 });
});

test("capBandAt only ever lowers", async () => {
  const { capBandAt } = await import("../src/lib/smc/ltf-arm.ts");
  assert.equal(capBandAt("A+", "B+"), "B+");
  assert.equal(capBandAt("A-", "B+"), "B+");
  assert.equal(capBandAt("B", "B+"), "B");
  assert.equal(capBandAt("C", "B+"), "C");
  assert.equal(capBandAt(null, "B+"), null);
});

const pools = (m) => {
  const pre = m.filter((b) => b.t < KZ0);
  return [{ name: "overnight low", price: Math.min(...pre.map((b) => b.l)) }, { name: "London low", price: Math.min(...m.filter((b) => b.t >= Date.UTC(2026, 9, 14, 6) && b.t < Date.UTC(2026, 9, 14, 9)).map((b) => b.l)) }];
};

test("replay 2026-10-14 NY AM: both books arm the LONG from closed LTF bars by 09:42 ET; entry = gap CE, stop past the wick, T1 a real pool", async () => {
  const { ltfArmOf } = await import("../src/lib/smc/ltf-arm.ts");
  for (const s of ["MNQ", "ES"]) {
    const m = FIX[s]; const P = pools(m);
    const now = KZ0 + 12 * 60_000;
    const a = ltfArmOf({ symbol: s, side: "long", minute: m.filter((b) => b.t < now), closed15: [], pools: P, nowMs: now, inKillzone: true });
    assert.ok(a, `${s} long armed`);
    assert.equal(a.side, "long");
    assert.equal(a.sweep.pool, "overnight low");
    assert.equal(a.entry, Math.round(((a.gap.lo + a.gap.hi) / 2) * 100) / 100);
    assert.ok(a.stop < a.sweep.wick && a.sweep.wick - a.stop <= 0.25 + 1e-9);
    assert.ok(a.t1 && P.some((p) => p.price === a.t1.price) && a.rr1 >= RULES.rrMin);
    assert.ok(a.cisd || a.mss);
  }
});

test("never reads a forming bar: a sweep only inside the forming minute does not arm", async () => {
  const { ltfArmOf } = await import("../src/lib/smc/ltf-arm.ts");
  const m = FIX.ES.filter((b) => b.t < KZ0 + 4 * 60_000);
  // nowMs inside the 09:33 minute: that bar (and every resampled bucket it touches) is forming
  const at = m.at(-1).t + 30_000;
  const a = ltfArmOf({ symbol: "ES-forming", side: "long", minute: m, closed15: [], pools: pools(FIX.ES), nowMs: at, inKillzone: true });
  if (a) for (const t of [a.sweep.t, a.disp.t]) assert.ok(t + 60_000 <= at, "evidence is from closed bars only");
});

test("killzone only, and no pool -> no arm (nothing invented)", async () => {
  const { ltfArmOf } = await import("../src/lib/smc/ltf-arm.ts");
  const now = KZ0 + 12 * 60_000; const m = FIX.MNQ.filter((b) => b.t < now);
  assert.equal(ltfArmOf({ symbol: "MNQ", side: "long", minute: m, closed15: [], pools: pools(FIX.MNQ), nowMs: now, inKillzone: false }), null);
  const a = ltfArmOf({ symbol: "MNQ-np", side: "long", minute: m, closed15: [], pools: [], targets: [], nowMs: now, inKillzone: true });
  if (a) assert.equal(a.t1, null, "no target pool -> T1 null, not a made-up level");
});

test("extension guard: an LTF closed-bar reversal releases it only when passed", async () => {
  const { extensionAllows } = await import("../src/lib/trading/raid-pair.ts");
  const bars = Array.from({ length: 30 }, (_, i) => ({ t: i * 900_000, o: 100 - i * 3, h: 101 - i * 3, l: 97 - i * 3, c: 97.5 - i * 3 }));
  assert.equal(extensionAllows(bars, "long"), false);
  assert.equal(extensionAllows(bars, "long", () => false), false);
  assert.equal(extensionAllows(bars, "long", () => true), true);
  assert.equal(extensionAllows(bars, "short"), true);
});

test("sanePlan: unreal T1 falls back to the next REAL pool >= rrMin only when asked", async () => {
  const { sanePlan } = await import("../src/lib/smc/exec-context.ts");
  const p = { side: "long", entry: 100, stop: 90, t1: null, t2: null };
  assert.equal(sanePlan(p, 10, [], [105, 112, 130]).ok, false);
  const r = sanePlan(p, 10, [], [105, 112, 130], 0.25, true);
  assert.equal(r.ok, true); assert.equal(r.t1, 112); assert.equal(r.t2, 130);
  assert.equal(sanePlan(p, 10, [], [105], 0.25, true).ok, false, "no real pool >= 1R -> still a watch row");
});

test("kills: all-rung read is opt-in; default is today's 5m-only behaviour", async () => {
  const { ltfReversalsOf } = await import("../src/lib/smc/mtf-context.ts");
  const rows = [{ tf: "3m", kind: "ifvg", dir: "bull", ageBars: 2, mitigated: false, lo: 1, hi: 2 }];
  assert.equal(ltfReversalsOf(rows, []).length, 0);
  const k = ltfReversalsOf(rows, [], true);
  assert.equal(k.length, 1); assert.equal(k[0].against, "short"); assert.match(k[0].why[0], /3m IFVG/);
  assert.equal(ltfReversalsOf([{ ...rows[0], tf: "1h", ageBars: 1 }], [], true).length, 0, "1h IFVG 60 min old > 30 min kill window");
});

test("scanner exposes inArmKillzone from shared kzDisp windows", async () => {
  const { inArmKillzone } = await import("../src/lib/trading/scanner.ts");
  assert.equal(inArmKillzone({ etHour: 9, etMinute: 35 }), true);
  assert.equal(inArmKillzone({ etHour: 12, etMinute: 0 }), false);
});
