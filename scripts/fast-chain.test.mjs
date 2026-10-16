import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { register } from "tsx/esm/api";
import { resolveWatcherDir } from "./lib/watcher-dir.mjs";
register();
const RULES = JSON.parse(readFileSync(new URL("../shared/desk-rules.json", import.meta.url)));
const fc = await import("../src/lib/execution/fast-chain.ts");
const BASE = { band: "B+", symbol: "ES", side: "short", entry: 7851.75, stop_px: 7856.25, first_target: 7846.3, px: 7852, atr: 8, brain_symbol: "ES", brain_side: "short", bias1h: "bear", bias4h: "bear", expMin: 20.6, etMin: 600 };
const CASES = [{}, { band: "B" }, { band: "A+" }, { stop_px: 7840 }, { first_target: 7849 }, { px: 7860 }, { brain_side: "long" }, { bias1h: "bull", bias4h: "bull" }, { expMin: 31 }, { expMin: null }, { side: "long", stop_px: 7840, first_target: 7870 }, { side: "long", stop_px: 7856.25, first_target: 7846.3 }, { t2: 7850 }, { t2: 7840 }, { desk_ticket_side: "call" }, { desk_ticket_side: "put", desk_ticket_underlier: "QQQ" }, { desk_ticket_side: "put", desk_ticket_underlier: "SPY" },
  // post-mortem 13:02 + Keaton 13:26 CT: q penalties (htf / B+ after 13:00 ET), htf evidence, 1m-close-through, read-priority, 13:15 ES short A-
  { q: 0.63, bias1h: "bull" }, { q: 0.63, bias1h: "bull", displacement: true }, { q: 0.70, bias1h: "bull", brain_word: "TAKE" }, { q: 0.63, etMin: 785 }, { band: "A-", q: 0.6749, etMin: 785 },
  { side: "long", stop_px: 7840, first_target: 7870, arrays: [{ tf: "5m", kind: "fvg", dir: "bull", lo: 7853, hi: 7854, ageBars: 2, formedAgeBars: 2, through1mAgeMin: 1, reclaimed1m: false }] },
  { side: "long", band: "A", stop_px: 7840, first_target: 7870, arrays: [{ tf: "5m", kind: "fvg", dir: "bull", lo: 7853, hi: 7854, ageBars: 2, formedAgeBars: 2, through1mAgeMin: 1, reclaimed1m: false }] },
  { side: "long", band: "A+", stop_px: 7840, first_target: 7870, arrays: [{ tf: "5m", kind: "fvg", dir: "bull", lo: 7853, hi: 7854, ageBars: 2, formedAgeBars: 2, through1mAgeMin: 1 }, { tf: "5m", kind: "fvg", dir: "bull", lo: 7855, hi: 7856, ageBars: 3, formedAgeBars: 3, through1mAgeMin: 2 }] },
  { band: "A-", q: 0.6749, entry: 7771.38, stop_px: 7780, first_target: 7760.25, px: 7766.25, atr: 10.98, bias1h: "bull", bias4h: "bear", displacement: true, sweep: true, etMin: 855, brain_word: "WAIT" },
  // unblock-2 10/15: HTF both oppose with / without LTF reversal; grade smoothing (2 of 3; edge + rising; edge + falling)
  { side: "long", stop_px: 7840, first_target: 7870, bias1h: "bear", bias4h: "bear", sweep: true, displacement: true },
  { side: "long", stop_px: 7840, first_target: 7870, bias1h: "bear", bias4h: "bear", sweep: true, choch: true },
  { side: "long", stop_px: 7840, first_target: 7870, bias1h: "bear", bias4h: "bear", sweep: false, displacement: true },
  { band: "B", q: 0.59, bandHist: [["a", 0.62, "B+"], ["b", 0.61, "B+"], ["c", 0.59, "B"]] },
  { band: "B", q: 0.5999, bandHist: [["a", 0.55, "B"], ["b", 0.58, "B"], ["c", 0.5999, "B"]] },
  { band: "B", q: 0.595, bandHist: [["a", 0.55, "B"], ["b", 0.5999, "B"], ["c", 0.595, "B"]] },
  // live lesson 10/15 13:02 CT: one opposing HTF without reversal; iFVG closed / forming inversion against the side
  { bias1h: "bull" }, { bias1h: "bull", sweep: true, displacement: true },
  { arrays: [{ tf: "5m", kind: "ifvg", dir: "bull", lo: 7850, hi: 7851, ageBars: 1, failed: false }] },
  { arrays: [{ tf: "5m", kind: "fvg", dir: "bear", lo: 7850, hi: 7851.5, ageBars: 1, formedAgeBars: 1 }] },
  { arrays: [{ tf: "1m", kind: "ifvg", dir: "bull", lo: 7850, hi: 7851, ageBars: 1 }] }];
test("fastChain from shared rules: B+ / no hold timer: 2 consecutive polls, 90 s max age / T1 <= 30 m / first target 0.85R", () => {
  assert.deepEqual(fc.FC, RULES.fastChain);
  assert.equal(RULES.fastChain.mode, "live"); assert.equal(RULES.fastChain.confirmPolls, 2); assert.equal(RULES.fastChain.maxActionableAgeS, 90); assert.equal(RULES.fastChain.minHoldS, undefined); assert.equal(RULES.fastChain.minBand, "B+");
  assert.equal(RULES.fastChain.maxMinutesToT1, 30); assert.equal(RULES.fastChain.firstTargetR, 0.85); assert.equal(RULES.fastChain.spreadFallback, false);
  assert.ok(fc.fastSetupRows(BASE).every(([, ok]) => ok));
});
test("watcher (Python) fastchain.setup_rows matches the TS chain on the same cases", () => {
  const dir = resolveWatcherDir({ files: ["watcher/fastchain.py"] });
  if (!dir) return;
  const snaps = CASES.map((c) => ({ ...BASE, ...c }));
  const py = `import json,sys\nsys.path.insert(0, ${JSON.stringify(dir)})\nfrom watcher import fastchain as f\nout=[]\nfor s in json.loads(${JSON.stringify(JSON.stringify(snaps))}):\n  s=dict(s); s["tape_prices"]={s["symbol"]:s.pop("px")}; s["htf_bias"]=[("1h",s.pop("bias1h")),("4h",s.pop("bias4h"))]; s["loss"]={"velocity":{"expMin":s.pop("expMin")}}; s["band_hist"]=s.pop("bandHist",[]); s["wire_arrays"]=s.pop("arrays",[]); s["et_min"]=s.pop("etMin",None)\n  out.append([[n,ok] for n,ok,_ in f.setup_rows(s)])\nprint(json.dumps({"rows":out,"rules":f.FC}))`;
  const r = JSON.parse(execFileSync("python3", ["-c", py]).toString());
  assert.deepEqual(r.rules, RULES.fastChain);
  snaps.forEach((s, i) => assert.deepEqual(r.rows[i], fc.fastSetupRows(s).map(([n, ok]) => [n, ok]), JSON.stringify(CASES[i])));
});

const EV = { band: "A-", sweep: true }; // 10/15 PM persist fix: A-+ with a fresh sweep fires on the next poll
const SIB = { at: "sib", entry: 7851.25, px: 7856 }; // sibling on the same symbol:side failing fast:entry
test("persist: fires on the 2nd consecutive real poll of the same setup id, no timer", () => {
  let st = fc.streakNext(null, { ...BASE, at: "a1" }, 0); assert.ok(!fc.persistOk(st, 0));
  assert.ok(!fc.persistOk(fc.streakNext(st, { ...BASE, at: "a1" }, 1_000), 1_000)); // re-read of the same card
  st = fc.streakNext(st, { ...BASE, at: "a2" }, 4_000); assert.ok(!fc.persistOk(st, 4_000)); // 10/15 PM: B+ needs the 20 s hold
  assert.ok(fc.persistOk(st, 4_000, EV)); // A-+ with fresh sweep: next poll
  st = fc.streakNext(st, { ...BASE, at: "a2b" }, 20_000); assert.ok(fc.persistOk(st, 20_000));
});
test("persist: a sibling/failing poll breaks the consecutive count but keeps the setup age; stale after 90 s", () => {
  let st = fc.streakNext(null, { ...BASE, at: "a1" }, 0);
  st = fc.streakNext(st, { ...BASE, ...SIB }, 4_000);
  st = fc.streakNext(st, { ...BASE, at: "a3" }, 8_000); assert.equal(st.polls, 1); assert.equal(st.firstMs, 0); assert.ok(!fc.persistOk(st, 8_000));
  st = fc.streakNext(st, { ...BASE, at: "a4" }, 90_000); assert.ok(fc.persistOk(st, 90_000));
  st = fc.streakNext(st, { ...BASE, at: "a5" }, 90_001); assert.ok(!fc.persistOk(st, 90_001)); // stale, never fired
});
test("persist: invalidation and side change reset the setup", () => {
  const st = fc.streakNext(fc.streakNext(null, { ...BASE, at: "a1" }, 0), { ...BASE, at: "a2" }, 4_000);
  assert.equal(fc.streakNext(st, { ...BASE, at: "x", px: 7857 }, 5_000).firstMs, null);
  assert.equal(fc.streakNext(st, { ...BASE, at: "x", px: 7846 }, 5_000).firstMs, null);
  assert.equal(fc.streakNext(st, { ...BASE, at: "x", strategy_invalidated: true }, 5_000).firstMs, null);
  const fl = fc.streakNext(st, { ...BASE, at: "l", side: "long", stop_px: 7840, first_target: 7870 }, 5_000);
  assert.equal(fc.streakNext(fl, { ...BASE, at: "a3" }, 200_000).firstMs, 200_000);
});
test("persist: watcher streak_next agrees with the TS twin on a poll sequence", () => {
  const dir = resolveWatcherDir({ files: ["watcher/fastchain.py"] });
  if (!dir) return;
  const seq = [[{ at: "a1" }, 0], [SIB, 4000], [{ at: "a3" }, 8000], [{ at: "a3" }, 9000], [{ at: "a4" }, 12000], [{ at: "a5", band: "B" }, 16000], [{ at: "a6" }, 20000], [{ at: "a7" }, 95000], [{ at: "c1", px: 7847 }, 96000], [{ at: "p1" }, 100000], [{ at: "p2" }, 104000]].map(([c, t]) => [{ ...BASE, ...c }, t]);
  const py = `import json,sys\nsys.path.insert(0, ${JSON.stringify(dir)})\nfrom watcher import fastchain as f\nst=None;out=[]\nfor s,t in json.loads(${JSON.stringify(JSON.stringify(seq))}):\n  s=dict(s); s["tape_prices"]={s["symbol"]:s.pop("px")}; s["htf_bias"]=[("1h",s.pop("bias1h")),("4h",s.pop("bias4h"))]; s["loss"]={"velocity":{"expMin":s.pop("expMin")}}; s["band_hist"]=s.pop("bandHist",[]); s["wire_arrays"]=s.pop("arrays",[]); s["et_min"]=s.pop("etMin",None)\n  st=f.streak_next(st,s,t); out.append(f.persist_check(st,t)[0])\nprint(json.dumps(out))`;
  const py_out = JSON.parse(execFileSync("python3", ["-c", py]).toString());
  let st = null; const ts_out = seq.map(([s, t]) => { st = fc.streakNext(st, s, t); return fc.persistOk(st, t); });
  assert.deepEqual(py_out, ts_out); assert.ok(ts_out.includes(true));
});
test("velocity: soft row + size cut (half over the cap, minimum over 2x or unknown)", () => {
  for (const expMin of [31, null]) { const r = Object.fromEntries(fc.fastSetupRows({ ...BASE, expMin })); assert.equal(r["fast:velocity"], undefined); assert.equal(r["soft:fast:velocity"], true); }
  assert.ok(!RULES.fastChain.hard.includes("fast:velocity"));
  assert.equal(fc.velocitySize(4, 30), 4); assert.equal(fc.velocitySize(4, 31), 2); assert.equal(fc.velocitySize(3, 45), 1);
  assert.equal(fc.velocitySize(4, 61), 1); assert.equal(fc.velocitySize(4, null), 1); assert.equal(fc.velocitySize(null, 10), null);
});
test("entry re-arm: chase keeps the setup; pullback restarts the 90 s clock and confirmPolls", () => {
  let st = fc.streakNext(null, { ...BASE, at: "a1" }, 0);
  st = fc.streakNext(st, { ...BASE, at: "c1", px: 7847 }, 4_000); assert.equal(st.firstMs, 0); assert.ok(st.outOfZone);
  st = fc.streakNext(st, { ...BASE, at: "p1" }, 125_000); assert.equal(st.firstMs, 125_000); assert.ok(!fc.persistOk(st, 125_000));
  st = fc.streakNext(st, { ...BASE, at: "p2" }, 145_000); assert.ok(fc.persistOk(st, 145_000));
  const b = fc.streakNext(fc.streakNext(fc.streakNext(null, { ...BASE, at: "a1" }, 0), { ...BASE, at: "c1", px: 7847 }, 4_000), { ...BASE, at: "p1", band: "B" }, 8_000);
  assert.ok(!fc.persistOk(b, 8_000));
});
test("geometry: Floor ticket on another underlying/direction ignored; malformed T2 = no T2", () => {
  const geo = (c) => Object.fromEntries(fc.fastSetupRows({ ...BASE, ...c }))["fast:geometry"];
  assert.equal(geo({ symbol: "MNQ", entry: 30540, stop_px: 30560, first_target: 30500, px: 30541, atr: 40, brain_symbol: "MNQ", desk_ticket_side: "call", desk_ticket_underlier: "QQQ" }), true);
  assert.equal(geo({ side: "long", stop_px: 7840, first_target: 7870, desk_ticket_side: "put", desk_ticket_underlier: "QQQ" }), true);
  assert.equal(geo({ desk_ticket_side: "call", desk_ticket_underlier: "QQQ" }), true);
  assert.equal(fc.deskTicketApplies({ ...BASE, desk_ticket_side: "put", desk_ticket_underlier: "QQQ" }), false);
  assert.equal(fc.deskTicketApplies({ ...BASE, desk_ticket_side: "put", desk_ticket_underlier: "SPY" }), true);
  assert.equal(geo({ t2: 7850 }), true); assert.equal(fc.effectiveT2({ ...BASE, t2: 7850 }), null); assert.equal(fc.effectiveT2({ ...BASE, t2: 7840 }), 7840);
  assert.equal(geo({ stop_px: 7850 }), false); // real geometry still refuses
});

// Accuracy CHANGES 10/15: a setup that fired, hit its stop or touched T1 is spent for the session.
const arm = (st, t0) => fc.streakNext(fc.streakNext(st, { ...BASE, at: `r${t0}` }, t0), { ...BASE, at: `s${t0}` }, t0 + 4_000);
test("spent: no re-fire after a stop", () => {
  let st = arm(null, 0); assert.ok(fc.persistOk(st, 4_000, EV));
  st = fc.streakNext(st, { ...BASE, at: "stop", px: 7857 }, 5_000);
  assert.equal(st.spent[fc.setupId(BASE)].why, "invalidated");
  st = arm(st, 10_000); assert.ok(!fc.persistOk(st, 14_000)); assert.equal(st.key, null);
});
test("spent: no re-fire after a T1 touch", () => {
  let st = arm(null, 0);
  st = fc.streakNext(st, { ...BASE, at: "t1", px: 7846 }, 5_000);
  st = arm(st, 10_000); assert.ok(!fc.persistOk(st, 14_000));
});
test("spent: no re-fire after fire then re-arm (chase out, pull back)", () => {
  let st = arm(null, 0); assert.ok(fc.persistOk(st, 4_000, EV));
  st = fc.markSpent(st, fc.setupId(BASE), "fired", 4_000);
  st = fc.streakNext(st, { ...BASE, at: "out", px: 7848 }, 6_000);   // > 0.5xATR from entry, stop/T1 untouched
  st = arm(st, 10_000); assert.ok(!fc.persistOk(st, 14_000));
  // another entry on the same symbol/side is another setup and can still fire
  const other = { ...BASE, entry: 7852.25 };
  st = fc.streakNext(fc.streakNext(st, { ...other, at: "o1" }, 20_000), { ...other, at: "o2" }, 24_000); assert.ok(fc.persistOk(st, 24_000, EV));
});
test("spent: clears on the next session", () => {
  let st = fc.streakNext(arm(null, 0), { ...BASE, at: "stop", px: 7857 }, 5_000);
  const next = 5_000 + 86_400_000; st = arm(st, next); assert.ok(fc.persistOk(st, next + 4_000, EV));
});
test("default-ATR fallback in chased() matches the watcher", () => {
  assert.equal(fc.chased({ ...BASE, atr: null, px: 7851.75 + 2.1 }), true);   // ES default ATR 4 -> 0.5x = 2
  assert.equal(fc.chased({ ...BASE, atr: null, px: 7851.75 + 1.9 }), false);
});
test("velocity cut is applied BEFORE sizing: $ cap and min_debit still hold, minimum 1ct", () => {
  assert.equal(fc.velocitySizedContracts(1.5, 4, 4, 650, 50, 20), 4);      // within cap: full
  assert.equal(fc.velocitySizedContracts(1.5, 4, 4, 650, 50, 40), 2);      // over 30m: half
  assert.equal(fc.velocitySizedContracts(1.5, 4, 4, 650, 50, null), 1);    // unknown: 1ct
  assert.equal(fc.velocitySizedContracts(2.0, 6, 6, 650, 50, 40), 1);      // half of 6 = 3ct, but the $ cap is halved to $325: 1ct $200
  assert.equal(fc.velocitySizedContracts(1.0, 6, 6, 650, 50, 40), 3);      // 3ct x $100 = $300 <= $325
  assert.equal(fc.velocitySizedContracts(1.2, 6, 6, 650, 50, 40), 2);      // 3ct $360 > $325 -> 2ct $240
  assert.equal(fc.velocitySizedContracts(4.0, 4, 4, 650, 50, 40), null);   // 1ct $400 <= $650 but > halved $325: refuse
  assert.equal(fc.velocitySizedContracts(4.0, 4, 4, 650, 50, 20), 1);      // within ETA cap: full $650 cap, 1ct $400
  assert.equal(fc.velocitySizedContracts(3.5, 1, 4, 650, 50, null), null); // unknown ETA: min size and $325 cap, 1ct $350 refuses
  assert.equal(fc.velocityDebitMult(), 0.5);
  assert.equal(fc.velocitySizedContracts(0.3, 4, 4, 650, 50, null), null); // 1ct = $30 < $50 floor and ceiling is 1: refuse
  assert.equal(fc.velocitySizedContracts(7.0, 1, 4, 650, 50, 40), null);   // 1ct $700 > $650 cap
});
test("spent: watcher streak_next/mark_spent agree with the TS twin (stop, T1, fire+re-arm)", () => {
  const dir = resolveWatcherDir({ files: ["watcher/fastchain.py"] });
  if (!dir) return;
  const seq = [[{ at: "a1" }, 0], [{ at: "a2" }, 4000], ["FIRE", 4000], [{ at: "o", px: 7848 }, 6000], [{ at: "b1" }, 10000], [{ at: "b2" }, 14000],
    [{ at: "e1", entry: 7852.25 }, 20000], [{ at: "e2", entry: 7852.25 }, 24000], [{ at: "e3", entry: 7852.25, px: 7857 }, 25000], [{ at: "e4", entry: 7852.25 }, 30000], [{ at: "e5", entry: 7852.25 }, 34000]]
    .map(([c, t]) => [c === "FIRE" ? c : { ...BASE, ...EV, ...c }, t]);
  const py = `import json,sys\nsys.path.insert(0, ${JSON.stringify(dir)})\nfrom watcher import fastchain as f\nst=None;out=[];last=None\nfor s,t in json.loads(${JSON.stringify(JSON.stringify(seq))}):\n  if s=="FIRE":\n    st=f.mark_spent(st,f.setup_id(last),"fired",t); out.append(f.persist_check(st,t,last)[0]); continue\n  s=dict(s); s["tape_prices"]={s["symbol"]:s.pop("px")}; s["htf_bias"]=[("1h",s.pop("bias1h")),("4h",s.pop("bias4h"))]; s["loss"]={"velocity":{"expMin":s.pop("expMin")}}; last=s\n  st=f.streak_next(st,s,t); out.append(f.persist_check(st,t,s)[0])\nprint(json.dumps(out))`;
  const py_out = JSON.parse(execFileSync("python3", ["-c", py]).toString());
  let st = null; let last = null;
  const ts_out = seq.map(([s, t]) => { if (s === "FIRE") { st = fc.markSpent(st, fc.setupId(last), "fired", t); return fc.persistOk(st, t, last); } last = s; st = fc.streakNext(st, s, t); return fc.persistOk(st, t, s); });
  assert.deepEqual(py_out, ts_out);
  assert.deepEqual(ts_out, [false, true, false, false, false, false, false, true, false, false, false]);
});

test("unblock-2 10/15: 2-trade cap gone (re-fire handled by #22 spent-for-session), smoothing never lowers edges, HTF reversal half size", () => {
  assert.deepEqual(RULES.bandEdges, { "A+": 0.75, A: 0.68, "A-": 0.65, "B+": 0.6, B: 0.5 });
  assert.ok(!RULES.fastChain.hard.includes("entries_day")); assert.equal(RULES.fastChain.refireGuard, undefined);
  assert.equal(RULES.weekly.lossLock, -300); assert.equal(RULES.fireFix.dayLoss.usd, 150); assert.equal(RULES.fireFix.envelope.maxDebit, 650);
  const h = { ...BASE, side: "long", stop_px: 7840, first_target: 7870, bias1h: "bear", bias4h: "bear", sweep: true, displacement: true };
  // post-mortem 13:02: htfReversal half size replaced by fastChain.qPenalty.htf (htfReversal mode off -> htfSize is a no-op)
  assert.equal(RULES.fastChain.htfReversal.mode, "off"); assert.equal(fc.htfSize(4, h), 4);
  assert.equal(fc.smoothedBand({ band: "A-", q: 0.66, bandHist: [] }), false);
});

test("live lesson 10/15 13:02-13:05 CT: ES long blocked (5m bull FVG being inverted + 4h against without displacement); the inversion arms a short", async () => {
  const L = { ...BASE, symbol: "ES", side: "long", band: "B+", q: 0.6499, entry: 7782.63, stop_px: 7775, first_target: 7792.25, px: 7784, atr: 10.34, brain_side: "long", bias1h: "bull", bias4h: "bear", sweep: true, displacement: false,
    arrays: [{ tf: "5m", kind: "fvg", dir: "bull", lo: 7785.25, hi: 7786.25, ageBars: 2, formedAgeBars: 2, through1mAgeMin: 1, reclaimed1m: false }, { tf: "15m", kind: "fvg", dir: "bull", lo: 7779.75, hi: 7785.5, ageBars: 0, formedAgeBars: 0 }] };
  const r = Object.fromEntries(fc.fastSetupRows(L));
  // post-mortem 13:02: the 1m close 7784.75 (13:00:59) through 7785.25 blocks the B+ long; sweep is now htf evidence (agree passes), the -0.05 q keeps it B
  assert.equal(r["fast:ifvg"], false); assert.equal(r.band, false);
  const f = await import("../src/lib/smc/ifvg-flip.ts");
  // synthetic 1m tape: a 5m bull FVG forms, then a 5m bar closes below its bottom -> bearish iFVG arms the short
  const t0 = Date.UTC(2026, 9, 15, 17, 0); const bars = []; let p = 7780;
  const push = (o, h, l, c) => bars.push({ t: t0 + bars.length * 60_000, o, h, l, c, v: 100 });
  for (let i = 0; i < 200; i++) { push(p, p + 1, p - 1, p + 0.25); p += 0.25; }       // drift up (enough 5m bars for the detector)
  for (let i = 0; i < 5; i++) push(p, p + 1, p - 0.5, p + 0.5);                       // 5m bar A (high ~p+1.5)
  const aHigh = Math.max(...bars.slice(-5).map((b) => b.h)); p = bars.at(-1).c;
  for (let i = 0; i < 5; i++) { push(p, p + 2.5, p - 0.25, p + 2.25); p += 2.25; }     // 5m bar B: strong up body
  for (let i = 0; i < 5; i++) push(p, p + 1, p - 0.5, p + 0.5);                       // 5m bar C: low above A's high -> bull FVG
  p = bars.at(-1).c;
  for (let i = 0; i < 5; i++) { push(p, p + 0.25, p - 3, p - 2.75); p -= 2.75; }       // 5m bar D: closes far below the gap -> inverted
  for (let i = 0; i < 5; i++) push(p, p + 0.5, p - 0.5, p);                           // 5m bar E (closed)
  const now = bars.at(-1).t + 120_000;
  const short = f.ifvgFlipOf({ symbol: "TEST:flip", side: "short", minute: bars, closed15: [], targets: [{ name: "PDL", price: p - 60 }, { name: "ONL", price: p - 90 }], nowMs: now });
  assert.ok(short, "bull FVG inversion arms a short"); assert.equal(short.side, "short"); assert.ok(short.stop > short.gap.hi && short.entry === short.gap.ce && short.gap.lo >= aHigh - 1e-9);
  assert.equal(short.t1.name, "PDL"); assert.ok(short.rr1 >= 1);
  assert.equal(f.ifvgFlipOf({ symbol: "TEST:flip", side: "long", minute: bars, closed15: [], targets: [{ name: "PDH", price: p + 90 }], nowMs: now }), null);
  assert.equal(f.ifvgFlipOf({ symbol: "TEST:flip2", side: "short", minute: bars, closed15: [], targets: [], nowMs: now })?.t1 ?? null, null);   // no pool -> no T1, no plan
});

test("post-mortem 13:02 / 13:26 CT: 10/15 13:15 CT ES short A- passes every setup row; 13:02 long blocked by the 1m-close read", () => {
  const short = { ...BASE, band: "A-", q: 0.6749, entry: 7771.38, stop_px: 7780, first_target: 7760.25, px: 7766.25, atr: 10.98, bias1h: "bull", bias4h: "bear", displacement: true, sweep: true, etMin: 855, brain_word: "WAIT" };
  assert.ok(fc.fastSetupRows(short).every(([, ok]) => ok), JSON.stringify(fc.fastSetupRows(short)));
  const long = { ...BASE, side: "long", band: "B+", q: 0.6499, entry: 7782.63, stop_px: 7775, first_target: 7792.25, px: 7784, atr: 10.34, brain_side: "long", bias1h: "bull", bias4h: "bear", sweep: true, etMin: 842,
    arrays: [{ tf: "5m", kind: "fvg", dir: "bull", lo: 7785.25, hi: 7786.25, ageBars: 2, formedAgeBars: 2, through1mAgeMin: 1, reclaimed1m: false }] };
  const r = Object.fromEntries(fc.fastSetupRows(long));
  assert.equal(r["fast:ifvg"], false); assert.equal(r.band, false);
});

test("post-mortem 13:02 F1: through1m reads the first closed 1m close through a 5m gap and a reclaim", async () => {
  const m = await import("../src/lib/smc/mtf-arrays.ts");
  const t0 = Date.UTC(2026, 9, 15, 18, 0); const bar = (i, c) => ({ t: t0 + i * 60_000, o: c, h: c + 0.5, l: c - 0.5, c, v: 1 });
  const g = { tf: "5m", dir: "bull", lo: 7785.25, hi: 7786.25, createdT: t0 - 10 * 60_000 };
  const r = m.through1m([bar(0, 7786), bar(1, 7784.75), bar(2, 7782.75)], g, t0 + 3 * 60_000);
  assert.deepEqual(r, { through1mAgeMin: 1, reclaimed1m: false });
  assert.equal(m.through1m([bar(0, 7784.75), bar(1, 7787)], g, t0 + 2 * 60_000).reclaimed1m, true);
  assert.equal(m.through1m([bar(0, 7786)], g, t0 + 60_000).through1mAgeMin, null);
});

test("10/15 PM persist: clock from the first qualifying card; B+ 2 polls + 20 s; A-+ fresh sweep/disp on the next poll; never 'Nones'", () => {
  let st = fc.streakNext(null, { ...BASE, at: "q1" }, 0); assert.equal(st.firstMs, 0); assert.ok(!/None/.test(fc.persistWhy(st, 0, BASE)));
  st = fc.streakNext(st, { ...BASE, at: "q2" }, 4_000);
  assert.ok(!fc.persistOk(st, 4_000, BASE)); assert.ok(fc.persistOk(st, 4_000, { ...BASE, band: "A-", displacement: true }));
  assert.ok(!fc.persistOk(st, 4_000, { ...BASE, band: "A-" })); assert.ok(fc.persistOk(st, 20_000, BASE));
  assert.ok(!fc.persistOk(st, 91_000, { ...BASE, band: "A", sweep: true }));
  assert.equal(fc.persistWhy(null, 0), "no qualifying card yet (clock starts at the first card that passes every fast row)");
});
test("10/15 PM: brain STAND is a q weight (-STAND_Q), not a veto; STAND + iFVG flip against the side blocks", () => {
  const s = { ...BASE, brain_word: "STAND", brain_side: "long", q: 0.70, band: "A-" };
  assert.ok(Object.fromEntries(fc.fastSetupRows(s))["fast:agree"]);
  assert.ok(fc.qPenalty(s)[0] >= fc.STAND_Q);
  const flip = { ...s, arrays: [{ tf: "5m", kind: "ifvg", dir: "bull", lo: 7850, hi: 7851, ageBars: 1, failed: false }] };
  assert.equal(Object.fromEntries(fc.fastSetupRows(flip))["fast:agree"], false);
  assert.equal(Object.fromEntries(fc.fastSetupRows({ ...BASE, brain_side: "long", brain_word: "WAIT" }))["fast:agree"], false); // a non-STAND brain on the other side still blocks
});
