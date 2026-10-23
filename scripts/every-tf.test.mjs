// Every-TF closes live + LTF inversion (2026-10-17): closed-bar reads on 1m..1D with body AND wick features,
// ltfArm validatedOnly (arms refused unless a validated setup fires), and the paired rules (one RULES_HASH).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const RULES = JSON.parse(readFileSync(new URL("../shared/desk-rules.json", import.meta.url)));
const E = await import("../src/lib/smc/every-tf.ts");
const A = await import("../src/lib/smc/ltf-arm.ts");
const H = await import("../src/lib/desk/rules-hash.ts");

const T0 = Date.UTC(2026, 9, 14, 13, 30);   // 09:30 ET
const bar = (t, o, h, l, c) => ({ t, o, h, l, c, v: 1 });
const tape = (n, t0 = T0, px = 100) => Array.from({ length: n }, (_, i) => bar(t0 + i * 60_000, px + (i % 3), px + (i % 3) + 1, px + (i % 3) - 1, px + ((i + 1) % 3)));

test("rules: every rung 1m..1D, live, Part A validated list empty", () => {
  assert.deepEqual(RULES.everyTf.tfs, ["1m", "2m", "3m", "4m", "5m", "15m", "30m", "1h", "4h", "1D"]);
  assert.equal(RULES.everyTf.mode, "live");
  assert.deepEqual(RULES.mtfInversion.validated, []);
  assert.equal(RULES.fix1016.reviewQuoteRetry.mode, "shadow");   // pending Keaton; live = strict 1 s on desk and watcher
  assert.equal(RULES.fix1016.reviewQuoteRetry.softMaxAgeS, 3);
  assert.equal(RULES.fire.orderReviewMaxAgeS, 1);   // strict threshold unchanged
});

test("barShape: body, both wicks, body/range and close location", () => {
  const s = E.barShape({ o: 10, h: 14, l: 8, c: 12 });
  assert.equal(s.body, 2); assert.equal(s.upperWick, 2); assert.equal(s.lowerWick, 2); assert.equal(s.range, 6);
  assert.equal(s.bodyPct, 0.333); assert.equal(s.closeLoc, 0.667); assert.equal(s.dir, "up");
  const d = E.barShape({ o: 5, h: 5, l: 5, c: 5 });
  assert.equal(d.bodyPct, 0); assert.equal(d.closeLoc, 0.5); assert.equal(d.dir, "doji");
});

test("closed bars only: a forming bucket is never read, on any rung", () => {
  const m = tape(17);                     // 09:30..09:46 bars; now = 09:47 -> 1m bar 09:46 just closed
  const now = T0 + 17 * 60_000;
  const b5 = E.rungBars("5m", { minute: m, nowMs: now });
  assert.equal(b5.at(-1).t, T0 + 10 * 60_000);          // 09:40-09:45 closed; 09:45-09:50 forming -> dropped
  const b2 = E.rungBars("2m", { minute: m, nowMs: now });
  assert.equal(b2.at(-1).t + 120_000 <= now, true);
  const b1 = E.rungBars("1m", { minute: [...m, bar(now, 1, 999, 0, 1)], nowMs: now });   // the forming 1m bar
  assert.equal(b1.at(-1).t, now - 60_000);
});

test("truncation: the read at time t is identical whether or not later bars exist (no lookahead)", () => {
  const m = tape(240);
  for (const k of [37, 61, 119, 181]) {
    const now = T0 + k * 60_000;
    const a = E.everyTfRead({ minute: m.filter((b) => b.t < now), nowMs: now });
    const b = E.everyTfRead({ minute: m, nowMs: now });
    assert.deepEqual(a, b, `cut ${k}`);
  }
});

test("4h and 1D buckets anchor to the 18:00 ET Globex open (DST-aware)", () => {
  const t = Date.UTC(2026, 9, 14, 14, 7);  // 10:07 EDT
  assert.equal(E.sessionBucketStart(t, 14_400_000), Date.UTC(2026, 9, 14, 14, 0));    // 10:00 ET bucket
  assert.equal(E.sessionBucketStart(t, 86_400_000), Date.UTC(2026, 9, 13, 22, 0));    // 18:00 ET prior day
  const w = Date.UTC(2026, 11, 14, 15, 7); // 10:07 EST
  assert.equal(E.sessionBucketStart(w, 14_400_000), Date.UTC(2026, 11, 14, 15, 0));
});

test("sweep: wick-through-and-close-back vs body close beyond, rejection wick share", () => {
  const base = tape(20);
  const lvl = Math.max(...base.map((b) => b.h));
  const wick = [...base, bar(T0 + 20 * 60_000, lvl - 0.5, lvl + 3, lvl - 1, lvl - 0.75)];
  const r = E.readClose("1m", wick, [{ name: "PDH", price: lvl }]);
  const s = r.sweep.find((x) => x.pool === "PDH");
  assert.equal(s.side, "BSL"); assert.equal(s.mode, "wick"); assert.ok(s.rejectWick > 0.7);
  const body = [...base, bar(T0 + 20 * 60_000, lvl - 0.5, lvl + 3, lvl - 1, lvl + 2.5)];
  assert.equal(E.readClose("1m", body, [{ name: "PDH", price: lvl }]).sweep.find((x) => x.pool === "PDH").mode, "body");
});

test("inversion: body close through vs wick through the far edge; wick and body FVG definitions", () => {
  // bull FVG at bars 1..3 (bar3.l 106 > bar1.h 102), then a bar closing below 102 (body) or only wicking below (wick)
  const b = [bar(0, 100, 101, 99, 100.5), bar(60_000, 100.5, 102, 100, 101.8), bar(120_000, 102, 107, 101.9, 106.5), bar(180_000, 106.5, 108, 106, 107), bar(240_000, 107, 107.5, 105, 106)];
  const close = E.readClose("1m", [...b, bar(300_000, 106, 106.2, 100.5, 101)], []);
  assert.ok(close.inversion.some((v) => v.dir === "bear" && v.edge === "body" && v.fvgDef === "wick"));
  const wk = E.readClose("1m", [...b, bar(300_000, 106, 106.2, 101.5, 103)], []);
  assert.ok(wk.inversion.some((v) => v.dir === "bear" && v.edge === "wick" && v.fvgDef === "wick"));
  assert.ok(!wk.inversion.some((v) => v.edge === "body" && v.fvgDef === "wick"));
});

test("card view: every closed rung carries upper/lower wick, body/range, close location", () => {
  const m = tape(300, T0 - 120 * 60_000);
  const now = T0 + 180 * 60_000;
  const w = E.wireEveryTf(E.everyTfRead({ minute: m, nowMs: now }), "long");
  assert.ok(w.closes.length >= 5);
  for (const x of w.closes) for (const k of ["upperWick", "lowerWick", "upperPct", "lowerPct", "bodyPct", "closeLoc", "body", "range"]) assert.ok(k in x, `${x.tf}.${k}`);
  assert.ok(typeof w.sig === "string" && w.sig.includes("1m@"));
  assert.match(E.everyTfSeatNote(E.everyTfRead({ minute: m, nowMs: now }), "short"), /^Every-TF closes \(live\)/);
});

test("ltfArm validatedOnly: an LTF-armed card is refused unless its setup id is validated; empty list refuses all", () => {
  assert.equal(A.ltfArmFireGate({ ltfArmed: false }).ok, true);
  const g = A.ltfArmFireGate({ ltfArmed: true, mtfSetupId: null });
  assert.equal(g.ok, false); assert.match(g.why, /validated empty/);
  assert.equal(A.ltfArmFireGate({ ltfArmed: true, mtfSetupId: "x" }, ["x"]).ok, true);
  assert.equal(A.ltfArmFireGate({ ltfArmed: true, mtfSetupId: "y" }, ["x"]).ok, false);
});

test("scanner: an unvalidated arm never mutates the card (no components, no entry, no extension release)", () => {
  const src = readFileSync(new URL("../src/lib/trading/scanner.ts", import.meta.url), "utf8");
  assert.match(src, /if \(armApplies\(c\) && add\.length\)/);
  assert.match(src, /extensionAllows\(bars, c\.side, armApplies\(c\) \?/);
  const bd = readFileSync(new URL("../src/lib/trading/build-desk.ts", import.meta.url), "utf8");
  assert.match(bd, /t1FallbackNextPool && c\.ltfArmed === true/);
  assert.match(bd, /ltfArmFireGate\(c as/);
});

test("RULES_HASH: desk, Brain, Floor and watcher share one hash", () => {
  assert.equal(H.RULES_HASH, "63ec3d05ca3f9995");   // 9eeed9b4083700cb -> 0a692dc19944a8df (everyTf, mtfInversion, ltfArm shadow+allTfKills shadow+validatedOnly+1D, reviewQuoteRetry shadow+softMaxAgeS)
  // 0a692dc19944a8df -> eeb84801a0b5c5b2 (2026-10-22 chatSweep live) -> 63ec3d05ca3f9995 (2026-10-23 chatSweep shadow + manageLive false)
  const w = readFileSync(new URL("../docs/desk-trades-like-chat-1022/watcher-chat-sweep.patch", import.meta.url), "utf8");
  assert.match(w, /63ec3d05ca3f9995/);   // the paired watcher patch pins the same hash
});

test("Accuracy #52: the all-rung kill read only ADDS kills — re-arm never easier, both-sides kill never dropped", async () => {
  const M = await import("../src/lib/smc/mtf-context.ts");
  const k = (against, rearmed, t = 1, why = ["5m"]) => ({ against, why, killT: t, level: 100, rearmed: rearmed ? { t: t + 1, why: "re-arm" } : null, killCleared: null });
  // 5m live kill stays exactly as it was, even when the all-rung read says re-armed (newest-kill clock)
  let u = M.strictKillUnion([k("long", false, 1)], [k("long", true, 5, ["1m"])]);
  assert.equal(u.length, 1); assert.equal(u[0].rearmed, null); assert.deepEqual(u[0].why, ["5m"]);
  // 5m re-armed but the all-rung read still live -> killed
  u = M.strictKillUnion([k("long", true, 1)], [k("long", false, 5, ["1m"])]);
  assert.equal(u[0].rearmed, null);
  // both sides killed on the all-rung read: both kills survive (never dropped), 5m-only sides untouched
  u = M.strictKillUnion([], [k("long", false, 2), k("short", false, 3)]);
  assert.equal(u.filter((r) => !r.rearmed).length, 2);
  // free only if free in both reads
  u = M.strictKillUnion([k("short", true, 1)], [k("short", true, 2)]);
  assert.ok(u[0].rearmed);
  const src = readFileSync(new URL("../src/lib/smc/mtf-context.ts", import.meta.url), "utf8");
  assert.match(src, /const rev = ltfReversalOf\(rows, b\.minute, false\);/);   // governing read (alignment flip, both-sides rule) = the 5m read, unchanged
});

test("Accuracy #52: desk order review enforces the strict 1 s live (no soft path on the desk)", async () => {
  const a = await import("../src/lib/execution/rh-autofire.ts");
  assert.equal(a.RH_ORDER_REVIEW_MAX_AGE_MS, 1000);
  assert.equal(RULES.fire.orderReviewMaxAgeS, 1);
  const src = readFileSync(new URL("../src/lib/execution/rh-autofire.ts", import.meta.url), "utf8");
  assert.ok(!/softMaxAgeS|reviewQuoteRetry/.test(src));
});

test("Release Watch #52: ltfArm shadow; all-rung kills behind ltfArm.allTfKills (shadow), never ltfArm.mode", () => {
  assert.equal(RULES.ltfArm.mode, "shadow");
  assert.equal(RULES.ltfArm.allTfKills.mode, "shadow");
  assert.equal(RULES.ltfArm.validatedOnly, true);
  const src = readFileSync(new URL("../src/lib/smc/mtf-context.ts", import.meta.url), "utf8");
  assert.match(src, /const allTf = .*ltfArm\?\.allTfKills\?\.mode === "live";/);
  assert.ok(!/ltfArm\?\.mode === "live"/.test(src));
});
