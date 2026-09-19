/**
 * Trace one session bar-by-bar: which must-layers pass, and the two layers
 * that decide entries — shift and retrace — with their details.
 *
 * Run: npx tsx scripts/trace-session.mjs MNQ 2026-08-27 [fromHH:MM] [toHH:MM]
 */
import { readFileSync } from "node:fs";

const symbol = process.argv[2] ?? "MNQ";
const day = process.argv[3];
const from = process.argv[4] ?? "09:30";
const to = process.argv[5] ?? "12:00";
const peer = symbol === "MNQ" ? "ES" : "MNQ";
const history = JSON.parse(readFileSync("src/data/learn-history.json", "utf8"));
const bars = history.bars[symbol];
const peerBars = history.bars[peer];

const { getSessionClock } = await import("../src/lib/trading/sessions.ts");
const { analyzeStructure, smtDivergenceStack } = await import("../src/lib/trading/structure.ts");
const { buildSmcTape } = await import("../src/lib/trading/smc-board.ts");
const { scanSetups } = await import("../src/lib/trading/scanner.ts");
const { summarizeDetectors } = await import("../src/lib/trading/detectors.ts");
const { buildMarketNarrative } = await import("../src/lib/trading/market-narrative.ts");
const { drawOnLiquidity } = await import("../src/lib/trading/draw.ts");
const { newsRead } = await import("../src/lib/trading/news.ts");
const { gradeSmcMaster } = await import("../src/lib/trading/smc-master.ts");

const dayKey = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(t));
const hm = (t) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));
function dayChangePct(slice) {
  const last = slice[slice.length - 1];
  const key = dayKey(last.t);
  for (const b of slice) if (dayKey(b.t) === key) return b.o > 0 ? ((last.c - b.o) / b.o) * 100 : 0;
  return 0;
}
const HORIZON = 800;
let peerIdx = 0;
for (let i = 160; i < bars.length; i++) {
  const now = bars[i];
  while (peerIdx < peerBars.length && peerBars[peerIdx].t <= now.t) peerIdx++;
  if (dayKey(now.t) !== day) continue;
  const t = hm(now.t);
  if (t < from || t > to) continue;
  const slice = bars.slice(Math.max(0, i + 1 - HORIZON), i + 1);
  const ps = peerBars.slice(Math.max(0, peerIdx - HORIZON), peerIdx);
  const clock = getSessionClock(new Date(now.t));
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
  const L = (id) => b.layers.find((l) => new RegExp(id, "i").test(l.label));
  const sw = detL.sweep.latest;
  const di = detL.displacement.latest;
  const rel = (idx) => (idx == null ? "—" : `${slice.length - 1 - idx}b ago`);
  const cand = scan.candidates.find((c) => c.symbol === symbol);
  console.log(
    `${t}  ${String(b.word).padEnd(5)} ${(b.side ?? "—").padEnd(5)} ${b.mustPass}/${b.mustNeed}  Q${(cand?.confluence ?? 0).toFixed(2)}  o${now.o} h${now.h} l${now.l} c${now.c}` +
    `\n        sweep:${L("sweep")?.state.padEnd(4)} ${sw ? `${sw.side} lvl ${sw.sweptLevel} wick ${sw.wickExtreme} ${rel(sw.index)}` : "none"}` +
    `\n        shift:${L("shift")?.state.padEnd(4)} ${di ? `${di.direction} ${di.ratio.toFixed(1)}xATR ${rel(di.index)}` : "none"} · ${L("shift")?.detail}` +
    `\n        retrace:${L("retrace")?.state.padEnd(4)} ${L("retrace")?.detail}` +
    (L("POI")?.state !== "pass" ? `\n        POI:${L("POI")?.state} ${L("POI")?.detail}` : "") +
    (L("Draw")?.state !== "pass" ? `\n        draw:${L("Draw")?.state} ${L("Draw")?.detail}` : ""),
  );
}
