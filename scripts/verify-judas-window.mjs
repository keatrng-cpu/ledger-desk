/**
 * The Judas release, pinned.
 *
 * This is the gate that changed from "never" to "sometimes", which makes it
 * the most dangerous edit on the desk: every other change today could only
 * refuse a trade the desk used to take, and this one can permit a trade the
 * desk used to refuse. So almost every assertion here is a REFUSAL, and the
 * two that permit both demand the full resolution.
 *
 * The test that matters most is `same bar is not a resolution`. On the 15m
 * series the engine grades, 09:30-09:45 is one candle, so the raid and the
 * reaction to the raid are ALWAYS the same bar. If that case ever released,
 * the window would be open every single day on no evidence at all — and it
 * would look like it was working, because a raid and a displacement really
 * did both happen.
 *
 * Run: npx tsx scripts/verify-judas-window.mjs
 */

const { readJudas, JUDAS_MIN_CONFLUENCE, JUDAS_TFS, RAID_MAX_AGE_MS } = await import(
  "../src/lib/trading/judas-window.ts"
);
const { allSeries } = await import("../src/lib/trading/chart-timeframes.ts");
const { isJudasWindow } = await import("../src/lib/trading/sessions.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

const MIN = 60_000;

/**
 * A 1m tape that: ranges, sets a low, raids it, closes back inside, then
 * displaces UP on a later bar. That is a textbook sellside Judas swing and
 * the only shape that should ever release a long.
 */
function judasTape({ displaceAfter = true, sameBar = false, px = 20000 } = {}) {
  const bars = [];
  let t = 0;
  const push = (o, h, l, c, v = 1000) => {
    bars.push({ t, o, h, l, c, v });
    t += MIN;
  };
  // A DISTINCT pivot low, then a clear ascent away from it.
  //
  // `fractalSwings` wants a local extreme with strictly higher bars either
  // side. A monotonic V whose ascent starts at the same price as the low
  // produces no swing at all — which means no sweep, which means the test
  // passes for the wrong reason and proves only that the detector found
  // nothing. That is exactly how this fixture was wrong the first time.
  for (let i = 0; i < 12; i++) {
    const c = px - i * 2;
    push(c + 1, c + 3, c - 3, c);
  }
  push(px - 22, px - 20, px - 34, px - 24, 1500); // the pivot low bar
  const low = px - 34;
  for (let i = 0; i < 14; i++) {
    const c = px - 18 + i * 2;
    push(c - 1, c + 3, c - 3, c);
  }
  for (let i = 0; i < 8; i++) push(px + 12, px + 15, px + 9, px + 12);

  if (sameBar) {
    // One candle that raids the low AND delivers back up through it — the
    // shape every 15m Judas candle has, and not a resolution.
    push(px + 9, px + 40, low - 8, px + 37, 6000);
    return bars;
  }
  push(px + 9, px + 10, low - 8, low + 10, 3000); // the raid, closed back inside
  if (displaceAfter) {
    push(low + 10, px + 40, low + 8, px + 37, 6000); // the reaction, a LATER bar
    push(px + 37, px + 44, px + 34, px + 41, 3000);
  } else {
    for (let i = 0; i < 3; i++) push(low + 10, low + 13, low + 7, low + 11, 900);
  }
  return bars;
}

const inWin = { etHour: 9, etMinute: 38 };
const outWin = { etHour: 10, etMinute: 30 };
const r1 = (bars) => allSeries([], bars);

console.log("the window boundary");
{
  check("09:38 is inside", isJudasWindow(9, 38), true);
  check("09:29 is not", isJudasWindow(9, 29), false);
  check("09:45 is not", isJudasWindow(9, 45), false);
  const j = readJudas(r1(judasTape()), outWin, "long");
  check("outside the window nothing is blocked", j.blocked, false);
  check("and it says so", j.stage, "outside");
}

console.log("\nit fails closed");
{
  check("no rungs at all: blocked", readJudas(null, inWin, "long").blocked, true);
  check("and it names the reason", readJudas(null, inWin, "long").stage, "no-tape");
  check("empty rungs: blocked", readJudas({}, inWin, "long").blocked, true);
  check("a too-short tape: blocked", readJudas(r1(judasTape().slice(0, 20)), inWin, "long").blocked, true);

  // THE ONE THAT MATTERS. 15m cannot resolve a 15m window, so a rung bundle
  // built with no minute series must never release, no matter what the 15m
  // candle looks like.
  const m15 = [];
  for (let i = 0; i < 60; i++)
    m15.push({ t: i * 900_000, o: 20000, h: 20040, l: 19960, c: 20030, v: 5000 });
  const only15 = allSeries(m15, []);
  const j15 = readJudas(only15, inWin, "long");
  check("15m-only rungs can never release the window", j15.blocked, true);
  check("because there is no sub-15m tape to resolve with", j15.stage, "no-tape");
}

console.log("\nwhat counts as a resolution");
{
  const noDisp = readJudas(r1(judasTape({ displaceAfter: false })), inWin, "long");
  check("a raid with no reaction is blocked", noDisp.blocked, true);
  check("and it is the raid that is named", noDisp.stage, "raid-unresolved");
  check("the raid's extreme is reported even while blocked", typeof noDisp.raid?.extreme, "number");

  // The critical case: raid and displacement on ONE bar. This is what every
  // 15m Judas candle looks like, and it is not a resolution.
  const same = readJudas(r1(judasTape({ sameBar: true })), inWin, "long");
  check("same bar is not a resolution", same.blocked, true);
  check(
    "and the reason says the displacement IS the raid",
    /displacement is the raid itself/.test(same.reason),
    true,
  );

  const good = readJudas(r1(judasTape()), inWin, "long");
  check("raid + close back inside + LATER displacement releases", good.blocked, false);
  check("the stage is released", good.stage, "released");
  check("it resolved on the finest rung available", good.tf, "1m");
  check("and it names the side the failed raid points at", good.releasedSide, "long");
  check("the reason is a sentence a trader can check", /Judas swing confirmed/.test(good.reason), true);
}

console.log("\nit only ever releases AGAINST the manipulation");
{
  const wrong = readJudas(r1(judasTape()), inWin, "short");
  check("a sellside raid does not release a short", wrong.blocked, true);
  check("the stage names it", wrong.stage, "wrong-side");
  check("and it still reports which way it WOULD release", wrong.releasedSide, "long");
  check(
    "the reason explains the refusal in the model's own terms",
    /Entering WITH the manipulation/.test(wrong.reason),
    true,
  );
  check("asking with no side still resolves", readJudas(r1(judasTape()), inWin, null).blocked, false);
}

console.log("\nstaleness");
{
  // A raid from 40 minutes ago is not this open's manipulation leg.
  const bars = judasTape();
  const stale = bars.map((b, i) => ({ ...b, t: b.t - (i < 41 ? 0 : 0) }));
  // Push 40 quiet minutes after the displacement so the raid ages out.
  const px = 20032;
  for (let i = 0; i < 40; i++)
    stale.push({ t: stale[stale.length - 1].t + MIN, o: px, h: px + 2, l: px - 2, c: px, v: 800 });
  const j = readJudas(r1(stale), inWin, "long");
  check(`a raid older than ${RAID_MAX_AGE_MS / 60000}m no longer counts`, j.blocked, true);
  check("and it reads as no raid rather than a stale release", j.stage, "no-raid");
}

console.log("\nthe grade the window additionally demands");
{
  check("the floor is the A+ tag, not the action floor", JUDAS_MIN_CONFLUENCE, 0.75);
  check("and it is above the confluence floor", JUDAS_MIN_CONFLUENCE > 0.65, true);
  check("the rungs it will try are minute-derived only", JUDAS_TFS, ["1m", "2m", "3m"]);
}

console.log("\nthe engine — a released window still needs the whole sequence");
{
  const { gradeSmcMaster } = await import("../src/lib/trading/smc-master.ts");
  const { analyzeStructure, smtDivergenceStack } = await import("../src/lib/trading/structure.ts");
  const { buildSmcTape } = await import("../src/lib/trading/smc-board.ts");
  const { scanSetups } = await import("../src/lib/trading/scanner.ts");
  const { summarizeDetectors } = await import("../src/lib/trading/detectors.ts");
  const { buildMarketNarrative } = await import("../src/lib/trading/market-narrative.ts");
  const { drawOnLiquidity } = await import("../src/lib/trading/draw.ts");
  const { newsRead } = await import("../src/lib/trading/news.ts");
  const { getSessionClock } = await import("../src/lib/trading/sessions.ts");
  const { readFileSync, existsSync } = await import("node:fs");

  if (!existsSync("src/data/learn-history-1m.json")) {
    console.log("  skip — src/data/learn-history-1m.json missing");
  } else {
    const H = JSON.parse(readFileSync("src/data/learn-history-1m.json", "utf8"));
    const m1 = H.bars?.MNQ ?? [];
    const p1 = H.bars?.ES ?? [];

    // Build 15m from the 1m so both series are real and time-aligned.
    const to15 = (b) => {
      const out = [];
      for (const x of b) {
        const k = Math.floor(x.t / 900_000) * 900_000;
        const last = out[out.length - 1];
        if (last && last.t === k) {
          last.h = Math.max(last.h, x.h);
          last.l = Math.min(last.l, x.l);
          last.c = x.c;
          last.v += x.v ?? 0;
        } else out.push({ t: k, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v ?? 0 });
      }
      return out;
    };
    const m15 = to15(m1);
    const p15 = to15(p1);

    function gradeAt(i, withMinute) {
      const slice = m15.slice(Math.max(0, i - 400), i + 1);
      let pi = 0;
      while (pi < p15.length && p15[pi].t <= m15[i].t) pi++;
      const peer = p15.slice(Math.max(0, pi - 400), pi);
      if (slice.length < 200 || peer.length < 200) return null;
      const clock = getSessionClock(new Date(m15[i].t));
      const biasL = analyzeStructure("MNQ", slice, 0);
      const biasR = analyzeStructure("ES", peer, 0);
      const smtStack = smtDivergenceStack(slice, peer);
      const smc = { left: buildSmcTape(slice), right: buildSmcTape(peer) };
      const scan = scanSetups(biasL, biasR, clock, smtStack.primary, slice, peer, smc);
      const narrL = buildMarketNarrative(biasL, summarizeDetectors(slice), clock, biasL.topDown === "bear" ? "bear" : "bull", slice);
      const narrR = buildMarketNarrative(biasR, summarizeDetectors(peer), clock, biasR.topDown === "bear" ? "bear" : "bull", peer);
      const cut = m1.filter((b) => b.t <= m15[i].t + 899_999);
      return gradeSmcMaster({
        clock,
        bias: { left: biasL, right: biasR },
        scan,
        draws: { left: drawOnLiquidity(biasL, slice), right: drawOnLiquidity(biasR, peer) },
        narrative: { left: narrL, right: narrR },
        news: newsRead(new Date(m15[i].t)),
        smtStack,
        smc,
        quotes: { left: { price: slice[slice.length - 1].c }, right: { price: peer[peer.length - 1].c } },
        shockFloorMs: null,
        left: { bars: slice, minute: withMinute ? cut.slice(-600) : [] },
        right: { bars: peer, minute: [] },
      });
    }

    let judasBars = 0;
    let takesNoMinute = 0;
    for (let i = 420; i < m15.length && judasBars < 60; i++) {
      const c = getSessionClock(new Date(m15[i].t));
      if (!isJudasWindow(c.etHour, c.etMinute)) continue;
      judasBars++;
      const g = gradeAt(i, false);
      if (g && (g.left.word === "TAKE" || g.right.word === "TAKE")) takesNoMinute++;
    }
    check(`without minute tape, no TAKE across ${judasBars} Judas bars`, takesNoMinute, 0);
    check("and there were Judas bars to test", judasBars > 10, true);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
