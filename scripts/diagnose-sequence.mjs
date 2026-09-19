/**
 * Where does the SMC sequence stall on real tape?
 *
 * build-learn-cases found ZERO TAKEs across a month on both books. Before
 * anything is built on that, it has to be explained: is the gate genuinely
 * that strict, or is one layer structurally unable to pass on closed 15m
 * bars? This samples the trade window and histograms the FIRST failing
 * must-layer, plus how many must-layers pass.
 *
 * Run: npx tsx scripts/diagnose-sequence.mjs [stride]
 */
import { readFileSync } from "node:fs";

const stride = Number(process.argv[2] ?? 3);
const history = JSON.parse(readFileSync("src/data/learn-history.json", "utf8"));

const { getSessionClock, isJudasWindow } = await import("../src/lib/trading/sessions.ts");
const { analyzeStructure, smtDivergenceStack } = await import("../src/lib/trading/structure.ts");
const { buildSmcTape } = await import("../src/lib/trading/smc-board.ts");
const { scanSetups } = await import("../src/lib/trading/scanner.ts");
const { summarizeDetectors } = await import("../src/lib/trading/detectors.ts");
const { buildMarketNarrative } = await import("../src/lib/trading/market-narrative.ts");
const { drawOnLiquidity } = await import("../src/lib/trading/draw.ts");
const { newsRead } = await import("../src/lib/trading/news.ts");
const { gradeSmcMaster } = await import("../src/lib/trading/smc-master.ts");

function dayChangePct(slice) {
  const last = slice[slice.length - 1];
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(last.t));
  for (const b of slice) {
    if (new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(b.t)) === key)
      return b.o > 0 ? ((last.c - b.o) / b.o) * 100 : 0;
  }
  return 0;
}

for (const [symbol, peer] of [["MNQ", "ES"], ["ES", "MNQ"]]) {
  const bars = history.bars[symbol];
  const peerBars = history.bars[peer];
  const firstFail = new Map();
  const passHist = new Map();
  const words = { TAKE: 0, WAIT: 0, STAND: 0 };
  const layerFail = new Map();
  let sampled = 0;
  let peerIdx = 0;
  const t0 = Date.now();
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
    const detL = summarizeDetectors(slice);
    const detR = summarizeDetectors(peerSlice);
    const narrL = buildMarketNarrative(biasL, detL, clock, biasL.topDown === "bear" ? "bear" : "bull", slice);
    const narrR = buildMarketNarrative(biasR, detR, clock, biasR.topDown === "bear" ? "bear" : "bull", peerSlice);
    const master = gradeSmcMaster({
      clock, bias: { left: biasL, right: biasR }, scan,
      draws: { left: drawOnLiquidity(biasL, slice), right: drawOnLiquidity(biasR, peerSlice) },
      narrative: { left: narrL, right: narrR }, news: newsRead(new Date(now.t)), smtStack, smc,
      quotes: { left: { price: now.c }, right: { price: peerSlice[peerSlice.length - 1].c } }, shockFloorMs: null,
    });
    const b = master.left;
    sampled++;
    words[b.word]++;
    passHist.set(`${b.mustPass}/${b.mustNeed}`, (passHist.get(`${b.mustPass}/${b.mustNeed}`) ?? 0) + 1);
    const musts = b.layers.filter((l) => l.must);
    const ff = musts.find((l) => l.state !== "pass");
    firstFail.set(ff ? `${ff.label} [${ff.state}]` : "(all pass)", (firstFail.get(ff ? `${ff.label} [${ff.state}]` : "(all pass)") ?? 0) + 1);
    for (const l of musts) if (l.state !== "pass") layerFail.set(l.label, (layerFail.get(l.label) ?? 0) + 1);
  }
  console.log(`\n=== ${symbol} · ${sampled} trade-window bars sampled (stride ${stride}) · ${((Date.now() - t0) / 1000).toFixed(0)}s ===`);
  console.log("words:", JSON.stringify(words));
  console.log("must-layers passing:", [...passHist.entries()].sort().map(([k, v]) => `${k}=${v}`).join("  "));
  console.log("FIRST failing must-layer:");
  for (const [k, v] of [...firstFail.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
  console.log("each must-layer's fail count (any position):");
  for (const [k, v] of [...layerFail.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
  const sample = bars[bars.length - 1];
  void sample;
}
