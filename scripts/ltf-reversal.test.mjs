import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const m = await import("../src/lib/smc/mtf-context.ts");
// Live card Keaton flagged (2026-10-13 ~10:33 ET): desk on ES long while the
// 5m inverted bullish→bearish and the 1m displaced down after a spike-and-fade.
const card = JSON.parse(readFileSync(new URL("./fixtures/card-2026-10-13-1033et.json", import.meta.url)));
test("fixture is the ES-long card", () => {
  assert.equal(card.wire.strategy.symbol, "ES");
  assert.equal(card.wire.strategy.side, "long");
});
const T0 = Date.UTC(2026, 9, 13, 14, 0);
function spikeAndFade() {
  const out = [];
  let p = 7850;
  for (let i = 0; i < 40; i++) { p += i % 2 ? 0.5 : -0.25; out.push({ t: T0 + i * 60e3, o: p, h: p + 1, l: p - 1, c: p + 0.25, v: 1 }); }
  const last = out[out.length - 1].c;
  out.push({ t: T0 + 40 * 60e3, o: last, h: last + 8, l: last - 0.5, c: last + 0.5, v: 1 });
  out.push({ t: T0 + 41 * 60e3, o: last + 0.25, h: last + 0.5, l: last - 6, c: last - 5.5, v: 1 });
  out.push({ t: T0 + 42 * 60e3, o: last - 5.5, h: last - 5, l: last - 6, c: last - 5.75, v: 1 });
  return out;
}
test("1m rejection wick at the high then down displacement kills the long", () => {
  const r = m.ltfReversalOf([], spikeAndFade());
  assert.equal(r?.against, "long");
  assert.match(r.why[0], /rejection wick at the high/);
});
test("fresh 5m bearish IFVG (bull FVG inverted) is against the long", () => {
  assert.equal(m.ltfReversalOf([{ tf: "5m", kind: "ifvg", dir: "bear", ageBars: 2, mitigated: false, lo: 1, hi: 2 }], [])?.against, "long");
});
test("old or mitigated 5m IFVG does not count; balanced evidence is no read", () => {
  assert.equal(m.ltfReversalOf([{ tf: "5m", kind: "ifvg", dir: "bear", ageBars: 20, mitigated: false }], []), null);
  assert.equal(m.ltfReversalOf([{ tf: "5m", kind: "ifvg", dir: "bear", ageBars: 1, mitigated: true }], []), null);
  assert.equal(m.ltfReversalOf([{ tf: "5m", kind: "ifvg", dir: "bear", ageBars: 1, mitigated: false }, { tf: "5m", kind: "ifvg", dir: "bull", ageBars: 1, mitigated: false }], []), null);
});

const d = await import("../src/lib/smc/discipline.ts");
function rebuild(bars) {
  const out = bars.slice(0, -1); // drop the old forming bar
  let t = out[out.length - 1].t;
  const kill = out[out.length - 1]; // the down-displacement bar
  const low = kill.l;
  const push = (o, h, l, c) => out.push({ t: (t += 60e3), o, h, l, c, v: 1 });
  push(kill.c, kill.c + 0.5, low - 0.25, low + 0.5); // drift
  push(low + 0.5, low + 1, low - 2, low + 0.75); // SSL sweep: takes the low, closes back above
  push(low + 0.75, kill.o + 2, low + 0.5, kill.o + 1.5); // up displacement, closes back through the kill bar's open
  push(kill.o + 1.5, kill.o + 2, kill.o + 1, kill.o + 1.25); // forming (dropped)
  return out;
}
test("kill → rebuild (SSL sweep → displacement → inversion back) re-arms the long", () => {
  const killed = m.ltfReversalOf([], spikeAndFade());
  assert.equal(killed.rearmed, null, "killed side is dead until the sequence prints");
  const r = m.ltfReversalsOf([], rebuild(spikeAndFade())).find((x) => x.against === "long");
  assert.ok(r.rearmed, "re-armed");
  assert.match(r.rearmed.why, /SSL sweep → .*up displacement → closed back through/);
});
test("displacement without the sweep first does not re-arm", () => {
  const b = spikeAndFade().slice(0, -1);
  const k = b[b.length - 1];
  let t = k.t;
  b.push({ t: (t += 60e3), o: k.c, h: k.o + 2, l: k.c - 0.1, c: k.o + 1.5, v: 1 });
  b.push({ t: (t += 60e3), o: 0, h: 0, l: 0, c: 0, v: 1 });
  assert.equal(m.ltfReversalsOf([], b).find((x) => x.against === "long")?.rearmed ?? null, null);
});
test("re-armed card is capped at A- (A+ q reads A- after seal)", () => {
  const c = { confluence: 0.82, pathBand: d.capBand("A+", "A-"), actionable: true };
  d.sealBand(c);
  assert.equal(c.pathBand, "A-");
  assert.equal(d.bandFromQ(c.confluence), "A-");
});
test("killed card is C and not actionable", () => {
  const c = { confluence: 0.82, pathBand: d.capBand("A", "C"), actionable: true };
  d.sealBand(c);
  assert.equal(c.pathBand, "C"); assert.equal(c.actionable, false);
});
