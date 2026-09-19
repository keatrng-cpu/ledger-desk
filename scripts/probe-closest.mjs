/**
 * Print every layer, with its detail, at the moments the sequence came
 * closest to completing. This is the "why" behind zero TAKEs in a month.
 *
 * Run: npx tsx scripts/probe-closest.mjs [symbol] [top]
 */
import { readFileSync } from "node:fs";

const symbol = process.argv[2] ?? "MNQ";
const top = Number(process.argv[3] ?? 4);
const peer = symbol === "MNQ" ? "ES" : "MNQ";
const history = JSON.parse(readFileSync("src/data/learn-history.json", "utf8"));
const bars = history.bars[symbol];
const peerBars = history.bars[peer];

const { getSessionClock, isJudasWindow } = await import("../src/lib/trading/sessions.ts");
const { analyzeStructure, smtDivergenceStack } = await import("../src/lib/trading/structure.ts");
const { buildSmcTape } = await import("../src/lib/trading/smc-board.ts");
const { scanSetups } = await import("../src/lib/trading/scanner.ts");
const { summarizeDetectors } = await import("../src/lib/trading/detectors.ts");
const { buildMarketNarrative } = await import("../src/lib/trading/market-narrative.ts");
const { drawOnLiquidity } = await import("../src/lib/trading/draw.ts");
const { newsRead } = await import("../src/lib/trading/news.ts");
const { gradeSmcMaster } = await import("../src/lib/trading/smc-master.ts");
const { etStamp } = await import("../src/lib/learn/cases.ts");

const dayKey = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(t));
function dayChangePct(slice) {
  const last = slice[slice.length - 1];
  const key = dayKey(last.t);
  for (const b of slice) if (dayKey(b.t) === key) return b.o > 0 ? ((last.c - b.o) / b.o) * 100 : 0;
  return 0;
}

const HORIZON = 800;
const rows = [];
let peerIdx = 0;
for (let i = 160; i < bars.length - 1; i += 2) {
  const now = bars[i];
  while (peerIdx < peerBars.length && peerBars[peerIdx].t <= now.t) peerIdx++;
  const clock = getSessionClock(new Date(now.t));
  // NY AM only — the window the desk actually trades.
  const m = clock.etHour * 60 + clock.etMinute;
  if (m < 9 * 60 + 45 || m > 11 * 60) continue;
  const slice = bars.slice(Math.max(0, i + 1 - HORIZON), i + 1);
  const ps = peerBars.slice(Math.max(0, peerIdx - HORIZON), peerIdx);
  if (ps.length < 160) continue;
  const biasL = analyzeStructure(symbol, slice, dayChangePct(slice));
  const biasR = analyzeStructure(peer, ps, dayChangePct(ps));
  const smtStack = smtDivergenceStack(slice, ps);
  const smc = { left: buildSmcTape(slice), right: buildSmcTape(ps) };
  const scan = scanSetups(biasL, biasR, clock, smtStack.primary, slice, ps, smc);
  const detL = summarizeDetectors(slice);
  const detR = summarizeDetectors(ps);
  const narrL = buildMarketNarrative(biasL, detL, clock, biasL.topDown === "bear" ? "bear" : "bull", slice);
  const narrR = buildMarketNarrative(biasR, detR, clock, biasR.topDown === "bear" ? "bear" : "bull", ps);
  const master = gradeSmcMaster({
    clock, bias: { left: biasL, right: biasR }, scan,
    draws: { left: drawOnLiquidity(biasL, slice), right: drawOnLiquidity(biasR, ps) },
    narrative: { left: narrL, right: narrR }, news: newsRead(new Date(now.t)), smtStack, smc,
    quotes: { left: { price: now.c }, right: { price: ps[ps.length - 1].c } }, shockFloorMs: null,
  });
  const b = master.left;
  const cand = scan.candidates.find((c) => c.symbol === symbol);
  rows.push({ i, t: now.t, b, q: cand?.confluence ?? 0, band: cand ? String(cand.pathBand ?? cand.grade) : "—", det: detL, arrays: smc.left.arrays.length, alerts: smc.left.alerts.length, price: now.c });
}

rows.sort((a, b) => b.b.mustPass - a.b.mustPass || b.q - a.q);
console.log(`${symbol}: ${rows.length} NY-AM bars probed. Top ${top} by must-layers passing:\n`);
for (const r of rows.slice(0, top)) {
  console.log(`━━ ${etStamp(r.t)} · ${r.b.word} · ${r.b.side ?? "no side"} · must ${r.b.mustPass}/${r.b.mustNeed} · Q${r.q.toFixed(2)} ${r.band} · price ${r.price}`);
  for (const l of r.b.layers) console.log(`   ${l.must ? "MUST" : "    "} ${l.state.padEnd(4)} ${l.label.padEnd(26)} ${l.detail}`);
  const sw = r.det.sweep.latest, swAny = r.det.sweep.lastEver, di = r.det.displacement.latest, diAny = r.det.displacement.lastEver;
  console.log(`   detectors: sweep.latest=${sw ? `${sw.side}@${sw.index}` : "none"} lastEver=${swAny ? `${swAny.side}@${swAny.index} (${r.i - swAny.index}b ago)` : "none"} · disp.latest=${di ? `${di.direction}@${di.index}` : "none"} lastEver=${diAny ? `${diAny.direction}@${diAny.index}` : "none"} · arrays=${r.arrays} alerts=${r.alerts} · plan=${r.b.plan ? "yes" : "null"}`);
  console.log();
}
