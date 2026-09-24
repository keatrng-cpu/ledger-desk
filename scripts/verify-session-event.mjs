/**
 * The session gate, pinned.
 *
 * This module decides whether the desk may treat a moment as tradable. It
 * replaced a clock comparison, which means it can fail in a way the clock
 * never could: by opening a window that should be shut. The tests below are
 * weighted accordingly — most of them assert a REFUSAL, and the two that
 * assert an opening both demand a measured reason for it.
 *
 * The last block is the one that matters most. It runs the real
 * `gradeSmcMaster` rather than this module alone, because the question the
 * trader actually has is not "does readSession return false at 09:35" but
 * "can anything I just changed let a TAKE print inside Judas". A unit test on
 * the helper cannot answer that; only the engine can.
 *
 * Run: npx tsx scripts/verify-session-event.mjs
 */

const {
  readSession,
  applySession,
  shockScore,
  volumeRatio,
  EVENT_SCORE_MIN,
  EVENT_VOL_MIN,
  SHOCK_WARMUP,
} = await import("../src/lib/trading/session-event.ts");
const { getSessionClock, resolveKillzone, sessionLive, isJudasWindow, etWallToEpochMs } =
  await import("../src/lib/trading/sessions.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

/* ── Tape builders ───────────────────────────────────────────────────────── */

/** A quiet series: every bar 10 points of range, flat, constant volume. */
function quiet(n = 60, px = 20000, vol = 1000) {
  const out = [];
  for (let i = 0; i < n; i++)
    out.push({ t: i * 900_000, o: px, h: px + 5, l: px - 5, c: px, v: vol });
  return out;
}

/** Append one bar that delivers: `mult` x the quiet range, `volX` the volume. */
function withShock(bars, mult, volX, dir = 1) {
  const last = bars[bars.length - 1];
  const atr = 10; // the quiet tape's true range
  const h = mult * atr;
  const px = last.c;
  return [
    ...bars,
    {
      t: last.t + 900_000,
      o: px,
      h: dir > 0 ? px + h : px + 1,
      l: dir > 0 ? px - 1 : px - h,
      c: dir > 0 ? px + h * 0.9 : px - h * 0.9,
      v: Math.round(1000 * volX),
    },
  ];
}

const clockAt = (hour, minute, weekday = 3) => {
  const kz = resolveKillzone(hour, minute);
  return {
    etHour: hour,
    etMinute: minute,
    weekday,
    inTradeWindow: kz.inTradeWindow && weekday >= 1 && weekday <= 5,
    killzone: kz.id,
    killzoneLabel: kz.label,
    isWeekday: weekday >= 1 && weekday <= 5,
  };
};

/* ── The scorer ──────────────────────────────────────────────────────────── */

console.log("the shock scorer");
{
  const q = quiet();
  check("a flat tape scores about 1x its own range", shockScore(q) <= 1.05, true);
  check("a 3x bar scores at least 3", shockScore(withShock(q, 3, 1)) >= 3, true);
  check("a 1x bar does not clear the event bar", shockScore(withShock(q, 1, 1)) < EVENT_SCORE_MIN, true);

  // Scale invariance is the property that lets ONE threshold serve ES at
  // 6,600 and MNQ at 24,000. If this breaks, every threshold in the file is
  // silently instrument-specific and the measurement behind it is void.
  // Scale invariance, tested as the property itself: take one series and
  // multiply every price by k. ATR scales by k, the bar's range scales by k,
  // and the ratio between them must not move at all. Building two tapes by
  // hand would only have tested the builder.
  const base = withShock(quiet(60, 6000), 3, 1);
  const scaled = base.map((b) => ({ ...b, o: b.o * 4, h: b.h * 4, l: b.l * 4, c: b.c * 4 }));
  check(
    "score is scale-invariant — one threshold serves ES at 6,600 and MNQ at 24,000",
    Math.abs(shockScore(base) - shockScore(scaled)) < 1e-9,
    true,
  );

  check("volume ratio reads 1 on a constant tape", Math.abs(volumeRatio(quiet()) - 1) < 0.01, true);
  check("volume ratio reads 3 on a 3x bar", Math.abs(volumeRatio(withShock(quiet(), 1, 3)) - 3) < 0.01, true);
  check("no volume data cannot manufacture participation", volumeRatio(quiet(60, 20000, 0)), 0);
  check("too few bars scores 0 rather than guessing", shockScore(quiet(1)), 0);
}

/* ── The gate ────────────────────────────────────────────────────────────── */

console.log("\ninside a killzone the clock still decides");
{
  const q = quiet();
  const r = readSession(q, clockAt(10, 0));
  check("NY AM is live", r.live, true);
  check("and it says so because of the window, not an event", r.source, "killzone");
  // The important half: a dead bar INSIDE the window is still live. This gate
  // only ever adds a way in; it never takes the killzone away.
  check("a quiet 10:00 bar is still a live session", readSession(q, clockAt(10, 0)).live, true);
}

console.log("\noutside a killzone the tape decides");
{
  const q = quiet();
  check("quiet lunch is refused", readSession(q, clockAt(12, 0)).live, false);
  check("quiet post-close is refused", readSession(q, clockAt(17, 0)).live, false);
  check("quiet overnight is refused", readSession(q, clockAt(21, 0)).live, false);
  check(
    "and the refusal names the two numbers it wanted",
    /ATR.*volume|volume.*ATR/.test(readSession(q, clockAt(12, 0)).reason),
    true,
  );

  const big = withShock(q, 3, 3);
  const r = readSession(big, clockAt(12, 0));
  check("a 3x bar on 3x volume at lunch IS a session", r.live, true);
  check("and it is labelled an event, not a killzone", r.source, "event");
  check("the reason carries both measurements", /× ATR on .*× median volume/.test(r.reason), true);

  // Each half alone is not enough — this is the whole point of requiring both.
  check(
    "range without participation is refused",
    readSession(withShock(q, 3, 1), clockAt(12, 0)).live,
    false,
  );
  check(
    "participation without range is refused",
    readSession(withShock(q, 1, 4), clockAt(12, 0)).live,
    false,
  );
  check(
    "the near-miss names which half was short",
    /only .*ATR/.test(readSession(withShock(q, 1, 4), clockAt(12, 0)).reason),
    true,
  );
}

console.log("\nwhat no event can ever unlock");
{
  const violent = withShock(quiet(), 6, 8);
  check("Saturday stays shut", readSession(violent, clockAt(12, 0, 6)).live, false);
  check("Sunday stays shut", readSession(violent, clockAt(21, 0, 0)).live, false);
  check("and the weekend says why", /Weekend/.test(readSession(violent, clockAt(12, 0, 6)).reason), true);
  check(
    "a tape shorter than the warmup cannot claim an event",
    readSession(quiet(SHOCK_WARMUP - 1), clockAt(12, 0)).live,
    false,
  );
}

/* ── The clock stamp ─────────────────────────────────────────────────────── */

console.log("\nthe stamp, and the fallback that protects every old caller");
{
  const q = quiet();
  const loud = withShock(q, 4, 4);
  const c = clockAt(12, 0);
  check("an unstamped clock falls back to the raw window", sessionLive(c), false);
  check("an unstamped in-window clock is live", sessionLive(clockAt(10, 0)), true);

  const stamped = applySession(c, loud, q);
  check("either book's event wakes the shared clock", sessionLive(stamped), true);
  check("and the source is recorded", stamped.sessionSource, "event");
  const both = applySession(c, q, q);
  check("two quiet books leave it shut", sessionLive(both), false);
  check("the raw window flag is never overwritten", both.inTradeWindow, false);
  check("applySession with no bars is the old behaviour", sessionLive(applySession(c)), false);
}

/* ── The differential: the engine, not the helper ────────────────────────── */

console.log("\nthe engine — Judas is still absolute after all of this");
{
  const { gradeSmcMaster } = await import("../src/lib/trading/smc-master.ts");
  const { analyzeStructure, smtDivergenceStack } = await import("../src/lib/trading/structure.ts");
  const { buildSmcTape } = await import("../src/lib/trading/smc-board.ts");
  const { scanSetups } = await import("../src/lib/trading/scanner.ts");
  const { summarizeDetectors } = await import("../src/lib/trading/detectors.ts");
  const { buildMarketNarrative } = await import("../src/lib/trading/market-narrative.ts");
  const { drawOnLiquidity } = await import("../src/lib/trading/draw.ts");
  const { newsRead } = await import("../src/lib/trading/news.ts");
  const { readFileSync } = await import("node:fs");

  const H = JSON.parse(readFileSync("src/data/history-4y.json", "utf8"));
  const MNQ = H.bars.MNQ ?? [];
  const ES = H.bars.ES ?? [];

  function gradeAt(i, clockOverride) {
    const slice = MNQ.slice(Math.max(0, i - 799), i + 1);
    let pi = 0;
    while (pi < ES.length && ES[pi].t <= MNQ[i].t) pi++;
    const peer = ES.slice(Math.max(0, pi - 800), pi);
    if (slice.length < 200 || peer.length < 200) return null;
    const clock = clockOverride ?? getSessionClock(new Date(MNQ[i].t));
    const biasL = analyzeStructure("MNQ", slice, 0);
    const biasR = analyzeStructure("ES", peer, 0);
    const smtStack = smtDivergenceStack(slice, peer);
    const smc = { left: buildSmcTape(slice), right: buildSmcTape(peer) };
    const scan = scanSetups(biasL, biasR, clock, smtStack.primary, slice, peer, smc);
    const narrL = buildMarketNarrative(biasL, summarizeDetectors(slice), clock, biasL.topDown === "bear" ? "bear" : "bull", slice);
    const narrR = buildMarketNarrative(biasR, summarizeDetectors(peer), clock, biasR.topDown === "bear" ? "bear" : "bull", peer);
    return gradeSmcMaster({
      clock,
      bias: { left: biasL, right: biasR },
      scan,
      draws: { left: drawOnLiquidity(biasL, slice), right: drawOnLiquidity(biasR, peer) },
      narrative: { left: narrL, right: narrR },
      news: newsRead(new Date(MNQ[i].t)),
      smtStack,
      smc,
      quotes: { left: { price: slice[slice.length - 1].c }, right: { price: peer[peer.length - 1].c } },
      shockFloorMs: null,
      left: { bars: slice },
      right: { bars: peer },
    });
  }

  if (MNQ.length < 5000) {
    console.log("  skip — src/data/history-4y.json missing; run capture-history.mjs");
  } else {
    // Walk real Judas bars. Not one of them may print TAKE, on either book,
    // no matter how violent the 09:30-09:45 candle was — and those candles are
    // among the most violent of the week, which is exactly why this is the
    // test that matters.
    let judasBars = 0;
    let judasTakes = 0;
    let judasShockLive = 0;
    for (let i = 900; i < MNQ.length && judasBars < 400; i += 7) {
      const w = getSessionClock(new Date(MNQ[i].t));
      if (!isJudasWindow(w.etHour, w.etMinute)) continue;
      judasBars++;
      const g = gradeAt(i);
      if (!g) continue;
      if (g.left.word === "TAKE" || g.right.word === "TAKE") judasTakes++;
      const slice = MNQ.slice(Math.max(0, i - 799), i + 1);
      if (readSession(slice, w).live) judasShockLive++;
    }
    check(`no TAKE inside Judas across ${judasBars} real Judas bars`, judasTakes, 0);
    check("Judas bars ARE inside the NY AM window, so this was a real test", judasShockLive > 0, true);

    // And the other direction: an out-of-window bar with a genuine event must
    // now be able to reach a live session, or the change did nothing.
    let evented = 0;
    let quietOut = 0;
    for (let i = 900; i < MNQ.length && evented < 5; i += 3) {
      const w = getSessionClock(new Date(MNQ[i].t));
      if (w.inTradeWindow || !w.isWeekday) continue;
      const slice = MNQ.slice(Math.max(0, i - 799), i + 1);
      if (readSession(slice, w).live) evented++;
      else quietOut++;
    }
    check("out-of-window session events do occur on the real tape", evented > 0, true);
    check("and they are the exception, not the rule", quietOut > evented * 5, true);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
