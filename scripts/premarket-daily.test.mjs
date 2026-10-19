/**
 * Accuracy 10/19: premarketMap's 1D read uses i.daily, but neither caller (seq/wire.ts, ladder-wire.ts) passed it;
 * the fallback sessionDaily(m1) finds too few prior sessions, so the 1D read was never built. Both callers now pass
 * desk.mtf[side].daily, and the map cache keys on it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
import { readFileSync } from "node:fs";
register();
const pm = await import("../src/lib/smc/seq/premarket-map.ts");

const now = Date.UTC(2026, 9, 19, 13, 40); // 09:40 ET, map frozen at 09:25
const minute = [];
for (let k = -900; k < 15; k++) { const p = 29800 + Math.sin(k / 40) * 20; minute.push({ t: Date.UTC(2026, 9, 19, 13, 25) + k * 60e3, o: p, h: p + 2, l: p - 2, c: p, v: 0 }); }
const closed = minute.filter((b) => b.t + 60e3 <= now);
const daily = [];
for (let k = 12; k >= 1; k--) { const p = 29000 + (12 - k) * 60; daily.push({ t: Date.UTC(2026, 9, 19 - k), o: p, h: p + 120, l: p - 120, c: p + 40, v: 0 }); }

test("premarketMap: without daily the 1D read is missing; with desk daily bars it is built", () => {
  const without = pm.premarketMap({ symbol: "MNQ", minute: closed, nowMs: now });
  assert.ok(without.missing.some((m) => /^1D: \d+ prior sessions \(need 5\)/.test(m)), "the old path never builds 1D");
  const withD = pm.premarketMap({ symbol: "MNQ", minute: closed, nowMs: now, daily });
  assert.ok(!withD.missing.some((m) => m.startsWith("1D:")), withD.missing.join(" | "));
  // the cache never serves the no-daily map to a caller that passes daily
  const c0 = pm.premarketMapCached({ symbol: "MNQ", minute: closed, nowMs: now });
  const c1 = pm.premarketMapCached({ symbol: "MNQ", minute: closed, nowMs: now, daily });
  assert.notEqual(c0, c1);
  assert.ok(!c1.missing.some((m) => m.startsWith("1D:")));
});

test("both premarketMap callers pass the desk's daily bars", () => {
  const w = readFileSync(new URL("../src/lib/smc/seq/wire.ts", import.meta.url), "utf8");
  const l = readFileSync(new URL("../src/lib/smc/seq/ladder-wire.ts", import.meta.url), "utf8");
  assert.ok(w.includes("nowMs: b.feedNowMs,") && w.includes("daily: ((i.desk.mtf?.[side] as { daily?: OhlcBar[] } | undefined)?.daily ?? null)"));
  assert.ok(l.includes("deskLevels, nowMs, daily })"));
});
