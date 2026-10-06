/**
 * Floor 3D overhaul Chunks A–C: pure props + school + war-room arm lever display.
 *   - session dial segments never disagree with `resolveKillzone`
 *   - VIX weather uses the windows' bands, and a missing VIX draws nothing (no default)
 *   - liquidity lanes come only from the desk's levels; what is absent is listed as missing
 *   - trophies / scars come from closed paper, graded memories and the ghost room, biggest first
 *   - the overhaul's procedural layout keeps the crew off the Owner's balcony and the office reachable
 *
 * Run: npm test  (node --test, TypeScript via tsx's loader)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { sessionSegments, sessionDial, vixWeather, liquidityTrack, trophiesAndScars, propsSignature, feedSourceTag, feedTile } = await import("../src/lib/room/floor-props.ts");
const {
  buildSchoolFloor,
  FLOOR_SCHOOLS,
  DISCIPLE_WHO,
} = await import("../src/lib/room/school-contract.ts");
const {
  FLOOR_SCHOOL_SEAT_IDS,
  FLOOR_SCHOOL_AVATAR,
  floorSchoolSeatBundle,
  allFloorSchoolSeatBundles,
} = await import("../src/lib/room/floor-school-contracts.ts");
const { resolveKillzone } = await import("../src/lib/trading/sessions.ts");
const LAYOUT = (await import("../src/data/floor-layout.json", { with: { type: "json" } })).default;

const inSeg = (s, m) => (s.start < s.end ? m >= s.start && m < s.end : m >= s.start || m < s.end);

test("session segments cover the day and match resolveKillzone minute by minute", () => {
  const segs = sessionSegments();
  for (let m = 0; m < 1440; m++) {
    const hits = segs.filter((s) => inSeg(s, m));
    assert.equal(hits.length, 1, `minute ${m} is in exactly one segment`);
    assert.equal(hits[0].id, resolveKillzone(Math.floor(m / 60), m % 60).id, `minute ${m}`);
  }
  for (const id of ["asia", "london", "ny_am"]) assert.ok(segs.some((s) => s.id === id), `${id} present`);
});

test("session dial: progress in [0,1], next killzone in the future, weekend note from the clock", () => {
  const d = sessionDial(Date.UTC(2026, 9, 6, 14, 0, 0)); // Tue 10:00 ET
  assert.equal(d.current.id, resolveKillzone(10, 0).id);
  assert.ok(d.progress >= 0 && d.progress <= 1);
  assert.ok(d.next.inMin > 0 && d.next.inMin < 1440);
  const w = sessionDial(Date.UTC(2026, 9, 6, 14, 0, 0), { isWeekday: false, holiday: false, globexOpen: false, judas: false, blackout: false, blackoutReason: null });
  assert.ok(w.marketNote, "a weekend clock carries a note");
});

test("VIX weather: windows' bands; null / NaN / 0 is no pulse with zero intensity; always Y!", () => {
  assert.equal(vixWeather(12).band, "clear");
  assert.equal(vixWeather(17).band, "cloud");
  assert.equal(vixWeather(24).band, "overcast");
  assert.equal(vixWeather(35).band, "storm");
  assert.equal(vixWeather(12).source, "Y!");
  assert.match(vixWeather(12, Date.now() - 120_000).sourceLine, /Y!/);
  assert.match(vixWeather(12, Date.now() - 120_000).sourceLine, /DELAYED/);
  for (const v of [null, undefined, NaN, 0]) {
    const w = vixWeather(v);
    assert.equal(w.band, "none");
    assert.equal(w.intensity, 0);
    assert.equal(w.vix, null);
    assert.equal(w.source, "Y!");
  }
});

test("ticker feed tags are short LIVE / Y! / DB / SYN — never paint Y! as LIVE", () => {
  assert.equal(feedSourceTag("live_gateway"), "LIVE");
  assert.equal(feedSourceTag("yahoo"), "Y!");
  assert.equal(feedSourceTag("databento"), "DB");
  assert.equal(feedSourceTag("synthetic"), "SYN");
  assert.equal(feedTile({ kind: "yahoo", lagSec: 600 }).value, "Y!");
  assert.equal(feedTile({ kind: "synthetic", lagSec: null }).value, "SYN");
  assert.notEqual(feedTile({ kind: "yahoo", lagSec: 1 }).value, "LIVE");
});

const book = (over = {}) => ({
  u: "QQQ", say: "NQ", sym: "QQQ", px: 500, prevClose: 498, changePct: 0.4, dayHigh: 503, dayLow: 497,
  levels: [
    { name: "PDH", price: 502, pool: true },
    { name: "PDL", price: 495, pool: true },
    { name: "EQH", price: 504, pool: true },
    { name: "EQH far", price: 510, pool: true },
    { name: "EQL", price: 498, pool: true },
    { name: "VWAP", price: 499.5, pool: false },
  ],
  draw: { name: "EQH", price: 504 },
  ...over,
});

test("liquidity track: PDH/PDL by name, nearest pools as BSL/SSL, taken from day range, sorted high→low", () => {
  const t = liquidityTrack(book());
  const by = Object.fromEntries(t.lanes.map((l) => [l.kind, l]));
  assert.equal(by.PDH.price, 502);
  assert.equal(by.PDL.price, 495);
  assert.equal(by.BSL.price, 504, "nearest pool above, not the far one, not PDH");
  assert.equal(by.SSL.price, 498);
  assert.equal(by.DRAW, undefined, "a draw on an existing lane is not duplicated");
  assert.equal(by.PDH.taken, true, "day high 503 ≥ 502");
  assert.equal(by.BSL.taken, false);
  assert.equal(by.SSL.taken, true, "day low 497 ≤ 498");
  assert.deepEqual(t.missing, []);
  for (let i = 1; i < t.lanes.length; i++) assert.ok(t.lanes[i - 1].price >= t.lanes[i].price);
  for (const l of t.lanes) assert.ok(l.pos > 0 && l.pos < 1);
  assert.ok(t.puck > by.SSL.pos && t.puck < by.PDH.pos);
});

test("liquidity track: absent levels are listed missing, never invented; no price → no track", () => {
  const t = liquidityTrack(book({ levels: [], draw: null }));
  assert.deepEqual(t.missing.sort(), ["BSL", "PDH", "PDL", "SSL"]);
  assert.equal(t.lanes.length, 0);
  assert.equal(liquidityTrack(null), null);
  assert.equal(liquidityTrack(book({ px: NaN })), null);
});

test("trophies and scars: book wins/losses, graded vetoes and calls, ghost room; biggest first; capped", () => {
  const closed = [
    { ticker: "QQQ", strike: 500, type: "call", exp: "2026-10-06", contracts: 2, reason: "target", pnlUsd: 120, closedAt: 10 },
    { ticker: "SPY", strike: 600, type: "put", exp: "2026-10-06", contracts: 1, reason: "stop", pnlUsd: -80, closedAt: 11 },
    { ticker: "QQQ", strike: 505, type: "call", exp: "2026-10-06", contracts: 1, reason: "target", pnlUsd: 40, closedAt: 12 },
    { ticker: "QQQ", strike: 505, type: "call", exp: "2026-10-06", contracts: 1, reason: "flat", pnlUsd: 0, closedAt: 13 },
  ];
  const memories = [
    { kind: "veto", who: "Sterling", clock: "10:01", text: "no chase", outcome: { verdict: "saved", usd: 200, at: 20 } },
    { kind: "chase_call", who: "Jax", clock: "10:05", text: "rip", outcome: { verdict: "wrong", movePct: -0.3, at: 21 } },
    { kind: "fill", who: "Vince", clock: "10:06", text: "filled", outcome: { verdict: "win", usd: 50, at: 22 } },
    { kind: "veto", who: "Nova", clock: "10:07", text: "pending", outcome: null },
  ];
  const lab = { refusals: [{ gate: "spread", n: 3, wins: 1, pnlUsd: -90 }] };
  const { trophies, scars } = trophiesAndScars(closed, memories, lab);
  assert.deepEqual(trophies.map((p) => p.usd), [200, 120, 90, 40]);
  assert.equal(trophies[0].source, "memory");
  assert.equal(trophies[2].source, "ghost");
  assert.deepEqual(scars.map((p) => p.source), ["book", "memory"]);
  assert.match(scars[1].title, /Jax called it wrong/);
  assert.equal(trophiesAndScars(closed, memories, lab, 2).trophies.length, 2);
  const empty = trophiesAndScars([], [], null);
  assert.deepEqual(empty, { trophies: [], scars: [] });
  assert.equal(propsSignature(null), propsSignature(null));
});

test("layout: the overhaul's pieces are procedural and the balcony / stairs are crew obstacles", () => {
  const all = [...LAYOUT.furniture, ...LAYOUT.screens, ...(LAYOUT.walls ?? []), ...(LAYOUT.rooms ?? [])];
  const ids = ["balcony_Owner", "stairs_Owner", "chair_Owner", "desk_Manager", "chair_Manager", "ovh_tickerwall", "ovh_kz_E", "ovh_trophies", "ovh_scars", "plate_Manager", "ovh_mgr_0", "ovh_mgr_1", "ovh_mgr_2", "ovh_mgr_board", "ovh_schools", "ovh_checklist", "ovh_debate", "ovh_briefing", "ovh_ranks"];
  for (const id of ids) {
    const p = all.find((x) => x.id === id);
    assert.ok(p, `${id} in layout`);
    assert.equal(p.procedural, true, `${id} is procedural (Blender skips it)`);
  }
  for (const id of ["balcony_Owner", "stairs_Owner"]) assert.equal(LAYOUT.furniture.find((f) => f.id === id).obstacle, true);
});

test("Trading Stand floor-school-contracts: five seats map avatar→school, no invented hit rates", () => {
  assert.deepEqual([...FLOOR_SCHOOL_SEAT_IDS], ["ict", "tjr", "blake", "patty", "smc"]);
  assert.equal(FLOOR_SCHOOL_AVATAR.ict, "Gemma");
  assert.equal(FLOOR_SCHOOL_AVATAR.tjr, "Jax");
  assert.equal(FLOOR_SCHOOL_AVATAR.blake, "Nova");
  assert.equal(FLOOR_SCHOOL_AVATAR.patty, "Sterling");
  assert.equal(FLOOR_SCHOOL_AVATAR.smc, "Vince");
  const b = floorSchoolSeatBundle("ict");
  assert.equal(b.hitRate.strategyHitBySchool, null, "never invent school WR");
  assert.equal(b.signature.smcThesis, null, "smcThesis stub until gradeSmcMaster");
  assert.ok(b.checklist.schoolSequence.every((s) => s.pass === null), "schoolSequence pass chips stay null");
  assert.equal(allFloorSchoolSeatBundles().length, 5);
});

const worldStub = (over = {}) => ({
  nowMs: Date.UTC(2026, 9, 6, 12, 35, 0), // 08:35 ET
  clock: {
    isWeekday: true, holiday: false, globexOpen: true, judas: false, blackout: false, blackoutReason: null,
    killzone: "ny_am", killzoneLabel: "NY AM", optionsOpen: true,
  },
  books: { QQQ: null, SPY: null },
  card: null,
  week: null,
  feed: { kind: "yahoo", lagSec: 600 },
  lab: null,
  minds: null,
  pulse: { vix: null, tenYear: null, at: null },
  book: { dayPnl: 0, equity: 1000, closedToday: 0, winsToday: 0, consecLosses: 0, monthEntries: 0 },
  ...over,
});

test("Chunk B school floor: Stand bundles, awaiting labels, no invented ranks", () => {
  const school = buildSchoolFloor(worldStub());
  assert.equal(school.disciples.length, 5);
  assert.equal(school.disciples.find((d) => d.school === "ict").who, "Gemma");
  assert.ok(school.checklist.some((c) => c.state === "awaiting-model"));
  assert.ok(school.checklist.filter((c) => c.source === "school_sequence").every((c) => c.state === "awaiting-model"));
  assert.ok(school.ranks.every((r) => r.hitRate == null && r.source === "awaiting-model"));
  assert.ok(school.briefing.phase === "council" || school.briefing.label.includes("08:30"));
  assert.equal(school.hook.source, "trading-stand");
  assert.equal(school.bundles.length, 5);
  assert.ok(school.bundles.every((b) => b.hitRate.strategyHitBySchool === null));
});

test("Chunk B hit ranks: only real lab track rates; null stays awaiting", () => {
  const lab = {
    refusals: [],
    twins: { n: 0, deltaUsd: 0 },
    calibration: { n: 10, meanP: 0.4, hitRate: 0.35, brier: 0.2 },
    track: {
      Gemma: { n: 8, brier: 0.1, meanP: 0.45, hitRate: 0.5 },
      Jax: { n: 0, brier: null, meanP: null, hitRate: null },
      Nova: { n: 5, brier: 0.2, meanP: 0.4, hitRate: 0.2 },
      Sterling: { n: 0, brier: null },
      Vince: { n: 0, brier: null },
    },
  };
  const school = buildSchoolFloor(worldStub({ lab }));
  const gemma = school.ranks.find((r) => r.who === "Gemma");
  const jax = school.ranks.find((r) => r.who === "Jax");
  assert.equal(gemma.hitRate, 0.5);
  assert.equal(gemma.rank, 1);
  assert.equal(jax.hitRate, null);
  assert.match(jax.label, /awaiting model data|no scored plans/);
});

const { armLeverDisplay } = await import("../src/lib/room/arm-lever.ts");

test("Chunk C layout: balcony chair + Manager 3rd monitor + discretion board are procedural", () => {
  const all = [...LAYOUT.furniture, ...LAYOUT.screens];
  for (const id of ["chair_Owner", "ovh_mgr_2", "ovh_mgr_board"]) {
    const p = all.find((x) => x.id === id);
    assert.ok(p, `${id} in layout`);
    assert.equal(p.procedural, true);
  }
  const chair = LAYOUT.furniture.find((f) => f.id === "chair_Owner");
  assert.equal(chair.onTop, 1.2, "chair sits on the balcony deck");
  assert.equal(LAYOUT.screens.filter((s) => /^ovh_mgr_[012]$/.test(s.id)).length, 3, "three Manager monitors");
});

test("Chunk C arm lever: display-only mapping from ArmSnap; never invents live", () => {
  const safe = armLeverDisplay({
    autofireEnabled: false, liveArmed: false, confirmedInWriting: false,
    optionsSessionOpen: true, newsBlackout: false, riskHalt: false, oneBookBlocked: false,
  });
  assert.equal(safe.position, "safe");
  assert.match(safe.note, /not wired to agentAgree/);
  const armed = armLeverDisplay({
    autofireEnabled: true, liveArmed: false, confirmedInWriting: false,
    optionsSessionOpen: true, newsBlackout: false, riskHalt: false, oneBookBlocked: false,
  });
  assert.equal(armed.position, "armed");
  const live = armLeverDisplay({
    autofireEnabled: true, liveArmed: true, confirmedInWriting: true,
    optionsSessionOpen: true, newsBlackout: false, riskHalt: false, oneBookBlocked: false,
  });
  assert.equal(live.position, "live");
  assert.match(live.label, /display/i);
  assert.equal(armLeverDisplay(null).position, "safe");
});
