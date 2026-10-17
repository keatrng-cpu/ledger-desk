/** Short post-mortem 2026-10-16 — Keaton-approved fixes 1–8 (src/lib/smc/fix1016.ts, rules block fix1016). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fsmod, { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const RULES = (await import("../shared/desk-rules.json", { with: { type: "json" } })).default;
const F = await import("../src/lib/smc/fix1016.ts");
const T0 = Date.UTC(2026, 9, 16, 14, 0);

test("rules: fix1016 block — every strategy item ships shadow; watcher window 09:25 / fire not before 09:30", () => {
  const b = RULES.fix1016;
  for (const k of ["reanchor", "amdRetest", "ltfPromote", "score5", "chaseFromAnchor", "reviewQuoteRetry", "runner"]) assert.equal(b[k].mode, "shadow", k);   // reviewQuoteRetry: shadow pending Keaton (Accuracy Review #52)
  assert.equal(b.watcherWindow.fastStartEt, "09:25"); assert.equal(b.watcherWindow.fireNotBeforeEt, "09:30");
  const w = b.score5.weights; assert.ok(Math.abs(Object.values(w).reduce((a, c) => a + c, 0) - 1) < 1e-9);
  for (const k of Object.keys(F.fixModes())) assert.equal(F.fixMode(k), "shadow", k);
});

// ---- fix 1: re-anchor (10-16 MNQ: card pinned at 30089 while the AMD/LTF plan was 30018.75 / 30052.5)
const arm = { src: "ltfArm 1m ifvg", entry: 30018.75, stop: 30052.5, t1: 29958.75, t: T0 - 60_000 };
test("fix 1: |px-entry| > 1×ATR re-anchors to the newest same-side array", () => {
  const d = F.reanchorDecision({ side: "short", price: 30000, entry: 30089.25, stop: 30112.25, atr15: 47.36, nowMs: T0, anchors: [arm, { ...arm, entry: 30030, stop: 30060, t: T0 - 600_000 }] });
  assert.equal(d.trigger, "distance"); assert.equal(d.to.entry, 30018.75); assert.equal(d.mode, "shadow"); assert.equal(d.applied, false);
});
test("fix 1: within 1×ATR keeps the entry; invalidated (through stop) re-anchors; stale/behind-price anchors refused", () => {
  assert.equal(F.reanchorDecision({ side: "short", price: 30070, entry: 30089.25, stop: 30112, atr15: 47, nowMs: T0, anchors: [arm] }).trigger, null);
  const inv = F.reanchorDecision({ side: "short", price: 29930, entry: 29892.75, stop: 29926.5, atr15: 47, nowMs: T0, anchors: [{ src: "iFVG flip 5m", entry: 29940, stop: 29962, t1: 29840, t: T0 }] });
  assert.equal(inv.trigger, "invalidated"); assert.equal(inv.to.entry, 29940);
  const none = F.reanchorDecision({ side: "short", price: 30000, entry: 30089, stop: 30112, atr15: 40, nowMs: T0, anchors: [{ ...arm, entry: 29990 }, { ...arm, t: T0 - 3 * 3600e3 }] });
  assert.equal(none.to, null); assert.match(none.why, /dead plan released/);
  const long = F.reanchorDecision({ side: "long", price: 7800, entry: 7770, stop: 7760, atr15: 10, nowMs: T0, anchors: [{ src: "x", entry: 7795, stop: 7785, t1: 7820, t: T0 }] });
  assert.equal(long.to.entry, 7795);
});
test("fix 1: build-desk writes only under reanchor live; first-plan-wins writers then see no plan", () => {
  const src = readFileSync("src/lib/trading/build-desk.ts", "utf8");
  const i = src.indexOf('if (fx16.fixMode("reanchor") === "live")'); const j = src.indexOf("// Fix 33/36");
  assert.ok(i > 0 && i < j, "live re-anchor pass runs before fix 33/34 so they can replace a dead plan");
  assert.match(src.slice(i, j), /c\.plan = null as never; c\.entryPx = null as never;/);
  assert.match(src.slice(i, j), /smcMaster\.left, smcMaster\.right/, "brain book follows the re-anchored plan");
});

// ---- fix 2: AMD LH/HL retest
const gap = { tf: "5m", dir: "bear", lo: 29940, hi: 29962.5, live: true };
test("fix 2: a lower high into a bear gap that closes back through CE re-arms; caps at maxPerSide", () => {
  const r = F.amdRetest({ side: "short", bar: { h: 29948.75, l: 29930, c: 29935 }, lastExt: 30079, gaps: [gap], used: 0 });
  assert.equal(r.ok, true); assert.match(r.why, /lower high 29948.75/);
  assert.equal(F.amdRetest({ side: "short", bar: { h: 29948.75, l: 29930, c: 29935 }, lastExt: 30079, gaps: [gap], used: 2 }).ok, false);
  assert.equal(F.amdRetest({ side: "short", bar: { h: 30090, l: 29930, c: 29935 }, lastExt: 30079, gaps: [gap], used: 0 }).ok, false, "a new extreme is the normal raid path");
  assert.equal(F.amdRetest({ side: "short", bar: { h: 29948, l: 29940, c: 29955 }, lastExt: 30079, gaps: [gap], used: 0 }).ok, false, "no close back through CE");
  assert.equal(F.amdRetest({ side: "short", bar: { h: 29948, l: 29930, c: 29935 }, lastExt: 30079, gaps: [{ ...gap, dir: "bull" }], used: 0 }).ok, false);
  F.setFixOverrides({ amdRetest: { zone: "gapHalf" } });
  assert.equal(F.amdRetest({ side: "short", bar: { h: 29948.75, l: 29930, c: 29935 }, lastExt: 30079, gaps: [gap], used: 0 }).ok, false, "gapHalf needs the premium half (>= CE 29951.25)");
  F.setFixOverrides(null);
  assert.equal(F.amdRetest({ side: "long", bar: { h: 7790, l: 7779, c: 7785 }, lastExt: 7774.75, gaps: [{ tf: "15m", dir: "bull", lo: 7774.75, hi: 7781, live: true }], used: 0 }).ok, true);
});
const amdm = await import("../src/lib/smc/seq/amd-state.ts");
const pm = await import("../src/lib/smc/seq/premarket-map.ts");
const NQ16 = "/workspace/audits/pm1016/NQ-1m-1016.json";
test("fix 2 replay 10-16 NQ: shadow logs the 08:46 CT lower-high retest (N3) and leaves the AMD setups unchanged; live re-arms", { skip: !fsmod.existsSync(NQ16) }, () => {
  const m = JSON.parse(readFileSync(NQ16, "utf8"));
  const cut = Date.UTC(2026, 9, 16, 13, 25);
  const map = pm.premarketMap({ symbol: "MNQ", minute: m.filter((b) => b.t + 60e3 <= cut && b.t > cut - 12 * 864e5), nowMs: cut });
  const bars = m.filter((b) => b.t > cut - 6 * 36e5); const T = Date.UTC(2026, 9, 16, 14, 59);
  F.setFixOverrides({ amdRetest: { maxPerSide: 0 } }); const off = amdm.amdRead("MNQ", map, bars, T);      // = pre-fix behaviour
  F.setFixOverrides(null); const sh = amdm.amdRead("MNQ", map, bars, T);
  assert.deepEqual(sh.setups, off.setups, "shadow changes no AMD state");
  assert.ok(sh.retest.some((r) => r.side === "short" && r.t === Date.UTC(2026, 9, 16, 13, 46) && !r.applied));
  F.setFixOverrides({ amdRetest: { mode: "live" } }); const lv = amdm.amdRead("MNQ", map, bars, T); F.setFixOverrides(null);
  assert.ok(lv.setups.length > off.setups.length && lv.setups.some((s) => /retest/.test(s.raid?.name ?? "")));
});

// ---- fix 3: ltfArm promotion
const A = { entry: 29930.63, stop: 29944.25, t1: { price: 29823.5 }, gap: { lo: 29930.25, hi: 29931 }, tf: "1m", sweep: { t: T0 } };
test("fix 3: promotion needs band >= B+, 1h/4h agree and (watcher) Brain TAKE same side", () => {
  const ok = F.ltfPromote({ side: "short", band: "B+", htf: { "1h": "bear", "4h": "bear" }, arm: A });
  assert.equal(ok.deskOk, true); assert.equal(ok.mode, "shadow"); assert.equal(ok.plan.entry, 29930.63);
  assert.equal(F.ltfPromote({ side: "short", band: "B", htf: { "1h": "bear", "4h": "bear" }, arm: A }).deskOk, false);
  assert.equal(F.ltfPromote({ side: "short", band: "A", htf: { "1h": "bull", "4h": "bear" }, arm: A }).deskOk, false);
  assert.equal(F.ltfPromote({ side: "short", band: "A", htf: {}, arm: { ...A, t1: null } }).deskOk, false);
  assert.equal(F.ltfPromote({ side: "short", band: "A", htf: { "1h": "bear" }, arm: A, brainWord: "STAND", brainSide: "short" }).eligible, false);
  assert.equal(F.ltfPromote({ side: "short", band: "A", htf: { "1h": "bear" }, arm: A, brainWord: "TAKE", brainSide: "short" }).eligible, true);
  const src = readFileSync("src/lib/trading/build-desk.ts", "utf8");
  assert.match(src, /!c\.ltfArmed && a && a\.t1 && fx16\.fixMode\("ltfPromote"\) === "live"/);
});

// ---- fix 4: five layers
test("fix 4: score5 has five layers + sub-factors, keeps the old q, and is shadow by default", () => {
  const s = F.score5({ side: "short", confluence: 0.6499, components: ["sweep_significant", "ifvg", "displacement", "mss", "smt"], htfOk: true, gapSide: "short", rr1: 3, chaseAtr: 0 , t1IsPool: true });
  assert.deepEqual(Object.keys(s.layers), ["htf", "liquidity", "displacement", "entry", "risk"]);
  assert.equal(s.old, 0.6499); assert.equal(s.mode, "shadow"); assert.ok(s.total > 0.8 && s.total <= 0.99);
  const weak = F.score5({ side: "short", confluence: 0.7, components: [], htfOk: false, gapSide: "long", rr1: 1, chaseAtr: 2 });
  assert.ok(weak.total < 0.3 && weak.delta < 0);
  const src = readFileSync("src/lib/trading/build-desk.ts", "utf8");
  assert.match(src, /if \(sc\.mode === "live" && !deadNow\)/, "q replaced only when score5 is live");
});

// ---- fix 5: chase from the current anchor
test("fix 5: chase measured from the re-anchored entry only when chaseFromAnchor is live", () => {
  assert.deepEqual(F.chaseFrom("short", 29990, 30089.25, 47.36), { distAtr: 2.1, qFactor: 0 });
  assert.deepEqual(F.chaseFrom("short", 29990, 30018.75, 47.36), { distAtr: 0.61, qFactor: 0.6965 });
  const c = { entryPx: 30089.25, fix1016: { reanchor: { to: { entry: 30018.75 } } } };
  assert.equal(F.chaseEntry(c), 30089.25, "shadow: R3 unchanged");
  F.setFixOverrides({ chaseFromAnchor: { mode: "live" } }); assert.equal(F.chaseEntry(c), 30018.75); F.setFixOverrides(null);
  assert.match(readFileSync("src/lib/smc/discipline.ts", "utf8"), /const chaseFromE = chaseEntry\(c as never\) \?\? entry;/);
});

// ---- fix 8: runner
test("fix 8: T1 partial, BE stop, runner to the next pool beyond T1 at >= minRunnerR", () => {
  const r = F.runnerPlan({ side: "short", entry: 30043.5, stop: 30054, t1: 29959.25, pools: [29786.75, 29900, null, 30100] });
  assert.equal(r.partialFrac, 0.5); assert.equal(r.beStop, 30043.5); assert.equal(r.runnerTarget, 29900); assert.equal(r.mode, "shadow");
  assert.equal(F.runnerPlan({ side: "long", entry: 100, stop: 99, t1: 101, pools: [101.5] }).runnerTarget, null);
  assert.equal(F.runnerPlan({ side: "long", entry: 100, stop: 100, t1: 101, pools: [] }), null);
});

// ---- wire / Floor / Brain
test("wire carries strategy.fix1016; Floor and Brain carry the same note (never a vote)", async () => {
  const L = await import("../src/lib/trading/desk-listen.ts");
  assert.equal(L.fix1016SeatNote(null), null);
  const n = L.fix1016SeatNote({ reanchor: { trigger: "distance", to: { src: "ltfArm 1m", entry: 30018.75 }, applied: false }, score5: { total: 0.81, old: 0.65, mode: "shadow" }, runner: { runnerTarget: 29786.75, mode: "shadow" }, ltfPromote: { deskOk: true } });
  assert.match(n, /would re-anchor → ltfArm 1m 30018.75/); assert.match(n, /score5 0.81 vs q 0.65 \(shadow\)/); assert.match(n, /would promote/);
  const src = readFileSync("src/lib/trading/desk-listen.ts", "utf8");
  assert.equal((src.match(/fix1016Seat: fix1016SeatNote/g) || []).length, 2, "brain + floor");
  assert.match(src, /fix1016: \(top as \{ fix1016\?: unknown \}\)\.fix1016 \?\? null/);
});
test("shadow invariant: no fix1016 code path writes q/band/plan/entry unless its item is live", () => {
  const src = readFileSync("src/lib/trading/build-desk.ts", "utf8");
  const blk = src.slice(src.indexOf("// fix1016 (post-mortem 10/16) — every card carries"), src.indexOf("// A dead lead must not keep the brain's book alive"));
  const writes = blk.split("\n").filter((l) => /c\.(confluence|pathBand|plan|entryPx)\s*=|qWrite\(/.test(l));
  assert.ok(writes.length > 0);
  const liveIdx = blk.indexOf('if (sc.mode === "live" && !deadNow) {');
  for (const l of writes) assert.ok(blk.indexOf(l) > liveIdx, `write outside the live branch: ${l.trim()}`);
});

test("watcher patch: same rules (fix1016 block), market_open gate, replay reports clean", () => {
  const p = readFileSync("docs/fix1016/watcher-fix1016.patch", "utf8");
  for (const s of ['"fix1016": {', "def market_open_row", "_review_quote_retry", "def runner_manage", "fix1016:ltf_promote_brain", '"fastStartEt": "09:25"']) assert.ok(p.includes(s), s);
  for (const f of ["replay-shadow-default.json", "replay-shadow-injected.json"]) {
    const r = JSON.parse(readFileSync(`docs/fix1016/${f}`, "utf8"));
    assert.equal(r.n_fire_changed, 0); assert.equal(r.v5_rows_changed, 0); assert.equal(r.dry_would_fire_v5, r.dry_would_fire_new); assert.ok(r.cards > 7000);
  }
});
