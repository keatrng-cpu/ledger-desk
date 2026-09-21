/**
 * Why did every gate-tuning variant print ZERO TAKEs (scripts/sweep-gates.mjs,
 * 2026-09-21)? The knobs threaded through gate-tuning.ts loosen the retrace
 * and shift layers. This tallies EVERY must-layer's state on trade-window
 * bars under the loosest variant, plus the PATH gate, so the binding layer
 * is named from data rather than assumed. It also asks two structural
 * questions the knobs cannot: which single layer, if ignored, would arm the
 * most bars (leave-one-out), and how often the last raid's polarity implies
 * the OPPOSITE side to the scanner's candidate (the sequence then fails the
 * sweep layer instead of grading the side the raid actually armed).
 *
 * Run: npx tsx scripts/diagnose-path.mjs [stride] [window|impulse]
 */
import { readFileSync } from "node:fs";

const stride = Number(process.argv[2] ?? 4);
const history = JSON.parse(readFileSync("src/data/learn-history.json", "utf8"));
const { setGate } = await import("../src/lib/trading/gate-tuning.ts");
const { getSessionClock, isJudasWindow } = await import("../src/lib/trading/sessions.ts");
const { analyzeStructure, smtDivergenceStack } = await import("../src/lib/trading/structure.ts");
const { buildSmcTape } = await import("../src/lib/trading/smc-board.ts");
const { scanSetups } = await import("../src/lib/trading/scanner.ts");
const { summarizeDetectors } = await import("../src/lib/trading/detectors.ts");
const { buildMarketNarrative } = await import("../src/lib/trading/market-narrative.ts");
const { drawOnLiquidity } = await import("../src/lib/trading/draw.ts");
const { newsRead } = await import("../src/lib/trading/news.ts");
const { gradeSmcMaster } = await import("../src/lib/trading/smc-master.ts");
const { isHighProbPath } = await import("../src/lib/alerts/path-alarm.ts");

const MODE = process.argv[3] ?? "window";
setGate({ sameBarDisplacement: true, armedIsTake: true, retracePad: 0.5, recentSweepBars: 32, recentDisplacementBars: 16, displacementK: 1.25, dealingRange: MODE });
console.log("gate: v8 +", MODE);

function dayChangePct(slice) {
  const last = slice[slice.length - 1];
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
  const key = f.format(new Date(last.t));
  for (const b of slice) if (f.format(new Date(b.t)) === key) return b.o > 0 ? ((last.c - b.o) / b.o) * 100 : 0;
  return 0;
}
const inc = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const top = (m, n = 12) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${String(v).padStart(4)}  ${k}`).join("\n");

for (const [symbol, peer] of [["MNQ", "ES"], ["ES", "MNQ"]]) {
  const bars = history.bars[symbol];
  const peerBars = history.bars[peer];
  const t0 = Date.now();
  let sampled = 0, peerIdx = 0;
  const words = new Map(), blockers = new Map(), layerState = new Map(), combos = new Map(), loo = new Map(), raid = new Map();
  let pathOkN = 0, armedN = 0;
  for (let i = 160; i < bars.length - 1; i += stride) {
    const now = bars[i];
    while (peerIdx < peerBars.length && peerBars[peerIdx].t <= now.t) peerIdx++;
    const peerSlice = peerBars.slice(0, peerIdx);
    if (peerSlice.length < 160) continue;
    const clock = getSessionClock(new Date(now.t));
    if (!clock.inTradeWindow || isJudasWindow(clock.etHour, clock.etMinute)) continue;
    const slice = bars.slice(0, i + 1);
    const biasL = analyzeStructure(symbol, slice, dayChangePct(slice));
    const biasR = analyzeStructure(peer, peerSlice, dayChangePct(peerSlice));
    const smtStack = smtDivergenceStack(slice, peerSlice);
    const smc = { left: buildSmcTape(slice), right: buildSmcTape(peerSlice) };
    const scan = scanSetups(biasL, biasR, clock, smtStack.primary, slice, peerSlice, smc);
    const detL = summarizeDetectors(slice), detR = summarizeDetectors(peerSlice);
    const narrL = buildMarketNarrative(biasL, detL, clock, biasL.topDown === "bear" ? "bear" : "bull", slice);
    const narrR = buildMarketNarrative(biasR, detR, clock, biasR.topDown === "bear" ? "bear" : "bull", peerSlice);
    const master = gradeSmcMaster({
      clock, bias: { left: biasL, right: biasR }, scan,
      draws: { left: drawOnLiquidity(biasL, slice), right: drawOnLiquidity(biasR, peerSlice) },
      narrative: { left: narrL, right: narrR }, news: newsRead(new Date(now.t)), smtStack, smc,
      quotes: { left: { price: now.c }, right: { price: peerSlice[peerSlice.length - 1].c } }, shockFloorMs: null,
      left: { bars: slice }, right: { bars: peerSlice },
    });
    const b = master.left;
    sampled++;
    inc(words, b.word);
    const book = scan.candidates.filter((c) => c.symbol === symbol);
    const anyPath = book.some((c) => isHighProbPath(c));
    if (anyPath) pathOkN++;
    const musts = b.layers.filter((l) => l.must);
    for (const l of musts) inc(layerState, `${l.id}:${l.state}`);
    const mustFail = musts.find((l) => l.state === "fail");
    const notPass = musts.filter((l) => l.state !== "pass" && l.id !== "retrace").map((l) => `${l.id}${l.state === "fail" ? "!" : "?"}`);
    inc(combos, notPass.length ? notPass.join(" ") : "(armed)");
    const seqOk = !mustFail && musts.every((l) => l.id === "retrace" || l.state === "pass");
    if (seqOk) armedN++;
    // Leave-one-out: ignoring layer X alone, would the sequence be armed?
    for (const l of musts) {
      if (l.id === "retrace") continue;
      const rest = musts.filter((m) => m.id !== l.id && m.id !== "retrace");
      if (rest.every((m) => m.state === "pass")) inc(loo, l.id);
    }
    inc(blockers, mustFail ? `fail:${mustFail.id}` : !anyPath ? "no-path" : musts.find((l) => l.state === "wait") ? `wait:${musts.find((l) => l.state === "wait").id}` : "TAKE");
    // Raid polarity vs the side being graded.
    const swept = narrL.liquidity.lastSweep;
    const raidSide = swept === "ssl" ? "long" : swept === "bsl" ? "short" : null;
    if (raidSide) {
      const same = b.side === raidSide;
      const htfOk = biasL.topDown === "neutral" || (biasL.topDown === "bull") === (raidSide === "long");
      const cand = book.find((c) => c.side === raidSide);
      const zone = biasL.dealing?.zone ?? "none";
      const halfOk = zone === "equilibrium" || (raidSide === "long" ? zone === "discount" : zone === "premium");
      inc(raid, `${same ? "graded=raid side" : "graded≠raid side"} · HTF ${htfOk ? "ok" : "against"} · half ${halfOk ? "ok" : "wrong"} · cand ${cand ? (isHighProbPath(cand) ? "PATH" : String(cand.pathBand || cand.grade)) : "none"}`);
    } else inc(raid, "no raid");
  }
  console.log(`\n=== ${symbol} · ${sampled} trade-window bars · stride ${stride} · ${((Date.now() - t0) / 1000).toFixed(0)}s ===`);
  console.log("words:", [...words].map(([k, v]) => `${k} ${v}`).join(" · "));
  console.log(`PATH ok on ${pathOkN} bars · sequence armed-or-complete on ${armedN}`);
  console.log("must-layer states:");
  console.log([...layerState].sort().map(([k, v]) => `  ${String(v).padStart(4)}  ${k}`).join("\n"));
  console.log("first blocker:");
  console.log(top(blockers));
  console.log("non-passing must-layer combos (! fail, ? wait), retrace excluded:");
  console.log(top(combos));
  console.log("leave-one-out: bars armed if ONLY this layer were ignored:");
  console.log(top(loo));
  console.log("raid polarity vs graded side:");
  console.log(top(raid, 16));
}
