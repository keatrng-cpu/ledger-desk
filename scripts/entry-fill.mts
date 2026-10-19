/**
 * Entry-fill measurement (#22) — how often does price actually return to the
 * entry, by distance? The ladder already calibrates this (entryFill tab, 2y, no
 * lookahead): fill rate per entry kind (array / sweep retest) × distance-from-price
 * bucket (ATR1h). This surfaces the curve, finds the distance where fill drops
 * below target, and recommends entry-zone guidance vs the current `entryZoneAtr`.
 *
 * Runs on committed data (ladder-calibration.json + desk-rules.json) — no fetch.
 * Usage: npx tsx scripts/entry-fill.mts [--min-fill 0.6] [--md out.md]
 */
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const argN = (f: string, d: number) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? Number(args[i + 1]) : d; };
const MIN_FILL = argN("--min-fill", 0.6);
const MIN_N = 30;
const mdPath = args.includes("--md") ? args[args.indexOf("--md") + 1]! : null;

const cal = JSON.parse(readFileSync("src/lib/smc/seq/ladder-calibration.json", "utf8")) as { entryFill?: Record<string, { hit: number; n: number }> };
const rules = JSON.parse(readFileSync("shared/desk-rules.json", "utf8")) as { entryZoneAtr?: Record<string, number> };
const ef = cal.entryFill ?? {};

const DIST_ORDER = ["<0.5", "0.5-1", "1-2", "2-4", "4-8", "8-16", "16-inf"];
const distMid: Record<string, number> = { "<0.5": 0.35, "0.5-1": 0.75, "1-2": 1.5, "2-4": 3, "4-8": 6, "8-16": 12, "16-inf": 20 };

interface Row { kind: string; dist: string; distMid: number; fill: number | null; n: number }
const rows: Row[] = [];
for (const [key, v] of Object.entries(ef)) {
  const [kind, dist] = key.split("|");
  rows.push({ kind: kind!, dist: dist!, distMid: distMid[dist!] ?? 99, fill: v.n >= MIN_N ? +(v.hit / v.n).toFixed(3) : null, n: v.n });
}
rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.distMid - b.distMid);

/** For a kind, the largest distance (ATR) at which measured fill is still >= target. */
function fillCeiling(kind: string, target: number): { maxAtr: number | null; curve: Row[] } {
  const curve = rows.filter((r) => r.kind === kind && r.fill != null).sort((a, b) => a.distMid - b.distMid);
  let maxAtr: number | null = null;
  for (const r of curve) { if ((r.fill as number) >= target) maxAtr = r.distMid; else break; }
  return { maxAtr, curve };
}

const kinds = [...new Set(rows.map((r) => r.kind))];
const ceilings = Object.fromEntries(kinds.map((k) => [k, fillCeiling(k, MIN_FILL)]));

// recommend entry-zone ATR per grade: tighter grades should rest no further than
// where fill >= MIN_FILL; the array curve is the general case.
const arrayCeil = ceilings["array"]?.maxAtr ?? null;
const sweepCeil = ceilings["sweep"]?.maxAtr ?? null;
const current = rules.entryZoneAtr ?? {};
const overReach = Object.entries(current).filter(([, atr]) => arrayCeil != null && atr > arrayCeil);

const report = {
  minFill: MIN_FILL,
  curve: Object.fromEntries(kinds.map((k) => [k, rows.filter((r) => r.kind === k).map((r) => ({ dist: r.dist, fill: r.fill, n: r.n }))])),
  fillCeilingAtr: { array: arrayCeil, sweep: sweepCeil, note: `the furthest distance (ATR1h) where fill still clears ${MIN_FILL}` },
  currentEntryZoneAtr: current,
  overReachingGrades: overReach.map(([g, atr]) => ({ grade: g, entryZoneAtr: atr, fillAtThatDistance: "< " + MIN_FILL })),
  recommendation: `Rest entries within ~${arrayCeil ?? "?"}×ATR of price; beyond that, fill is a coin-flip — prefer the sweep-retest (fills higher at distance) or wait for price to come in. Any grade whose entryZoneAtr exceeds the ceiling rests orders that mostly do not fill.`,
};
writeFileSync("ai/entry-fill.json", JSON.stringify(report, null, 2));

const line = (k: string) => rows.filter((r) => r.kind === k).map((r) => `${r.dist} ${r.fill == null ? "n/a" : (r.fill * 100).toFixed(0) + "%"}(${r.n})`).join(" · ");
const md = [
  `### Entry fill by distance (2y calibration)`, "",
  `array: ${line("array")}`,
  `sweep: ${line("sweep")}`,
  "",
  `fill ceiling (>= ${MIN_FILL}): array ${arrayCeil}×ATR · sweep ${sweepCeil}×ATR`,
  `current entryZoneAtr: ${JSON.stringify(current)}`,
  overReach.length ? `**over-reaching grades** (rest beyond the fill ceiling): ${overReach.map(([g, a]) => `${g}=${a}`).join(", ")}` : `no grade rests beyond the fill ceiling`,
  "",
  report.recommendation,
].join("\n");
if (mdPath) writeFileSync(mdPath, md);
console.log(md);
