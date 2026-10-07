/**
 * Dump the desk's own fair value gaps for a stretch of its stored 15m bars, so the lab can check them against an independent implementation.
 *
 *   npx tsx scripts/dump-desk-fvgs.mjs MNQ 800 > .cache/desk-fvgs-MNQ.json
 *   brainlab/.venv/Scripts/python brainlab/smc_ref.py .cache/desk-fvgs-MNQ.json
 *
 * Read-only: it reads src/data/history-4y.json and runs `detectFvgs` (src/lib/trading/detectors.ts). Nothing is written but stdout.
 * Indices are positions inside the dumped slice; `createdIndex` is the THIRD candle of the gap, as the desk defines it.
 */
import { readFileSync } from "node:fs";

const symbol = (process.argv[2] ?? "MNQ").toUpperCase();
const n = Math.max(50, Number(process.argv[3] ?? 800));
const { detectFvgs } = await import("../src/lib/trading/detectors.ts");

const hist = JSON.parse(readFileSync(new URL("../src/data/history-4y.json", import.meta.url), "utf8"));
const all = hist?.bars?.[symbol];
if (!Array.isArray(all) || !all.length) {
  console.error(`no stored bars for ${symbol}`);
  process.exit(1);
}
const bars = all.slice(-n);
const fvgs = detectFvgs(bars).map((g) => ({
  kind: g.kind,
  createdIndex: g.createdIndex,
  createdT: g.createdT,
  top: g.top,
  bottom: g.bottom,
  middleBodyAtrRatio: g.middleBodyAtrRatio,
}));
process.stdout.write(JSON.stringify({ symbol, n: bars.length, bars: bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c })), fvgs }));
