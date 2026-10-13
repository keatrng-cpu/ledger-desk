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

// REPLAY: the desk's own ES 1m feed (Yahoo hole-fill, fetchYahooBars 1d/1m),
// 2026-10-13 through the 10:33 ET close — Keaton's live case.
const es = JSON.parse(readFileSync(new URL("./fixtures/es-1m-2026-10-13-to-1033et.json", import.meta.url))).bars;
const arr = await import("../src/lib/smc/mtf-arrays.ts");
const viewAt = (hhmm) => {
  const cut = es.findIndex((b) => new Date(b.t - 4 * 3600e3).toISOString().slice(11, 16) === hhmm) + 1;
  const v = es.slice(0, cut);
  return v.concat([{ ...v[v.length - 1], t: v[v.length - 1].t + 60e3 }]);
};
test("REPLAY 10:33 ET: the ES long is killed (5m IFVG aged from inversion + 1m spike-and-fade)", () => {
  const v = viewAt("10:33");
  const rows = arr.mtfArrays("ES", v, []);
  const r = m.ltfReversalOf(rows, v);
  assert.equal(r?.against, "long");
  assert.equal(r.rearmed, null);
  const why = m.ltfReversalsOf(rows, v).find((x) => x.against === "long").why.join(" | ");
  assert.match(why, /5m IFVG bear/);
  const oneMin = m.ltfReversalsOf([], v).find((x) => x.against === "long");
  assert.match(oneMin.why[0], /rejection wick at the high 7853.75/);
});
test("REPLAY: IFVG age is counted from the inversion, not the gap's formation", () => {
  const rows = arr.mtfArrays("ES", viewAt("10:33"), []).filter((r) => r.tf === "5m" && r.kind === "ifvg");
  assert.ok(rows.some((r) => r.formedAgeBars > m.IFVG5_MAX_AGE && r.ageBars <= m.IFVG5_MAX_AGE));
});
test("normal pullback in an uptrend (small wick, 1-bar dip, higher low) does not kill", () => {
  const out = []; let p = 7800;
  for (let i = 0; i < 60; i++) {
    const dip = i % 6 === 5;
    const o = p, c = dip ? p - 1 : p + 1.5;
    out.push({ t: T0 + i * 60e3, o, h: Math.max(o, c) + 0.25, l: Math.min(o, c) - 0.25, c, v: 1 });
    p = c;
  }
  out.push({ ...out[out.length - 1], t: out[out.length - 1].t + 60e3 });
  assert.equal(m.ltfReversalsOf([], out).find((x) => x.against === "long"), undefined);
});

test("13:07 CT: a kill voids after 2 closed 5m bars back beyond its level, or after maxAgeMin", async () => {
  const mc = await import("../src/lib/smc/mtf-context.ts");
  const t0 = Date.UTC(2026, 9, 13, 17, 55);
  const bars = (closes) => closes.map((c, i) => ({ t: t0 + i * 60_000, o: c, h: c + 0.25, l: c - 0.25, c, v: 1 }));
  const flat = bars(Array(16).fill(7845));
  assert.equal(mc.killVoided(flat, "long", t0, 7849.25), null);
  const up = bars([...Array(5).fill(7845), ...Array(11).fill(7852)]);
  const v = mc.killVoided(up, "long", t0, 7849.25); assert.ok(v); assert.match(v.why, /above the kill level/);
  const old = bars(Array(70).fill(7845)); assert.match(mc.killVoided(old, "long", t0, 7849.25).why, /aged out/);
});
