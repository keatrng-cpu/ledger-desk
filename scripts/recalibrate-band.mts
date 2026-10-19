/**
 * Band recalibration — recut the grade edges to the ACHIEVABLE fit distribution.
 *
 * Why: the grade comes from `fit = structureQ·0.4 + modelQ·0.55 + bonuses`
 * (strategy-grade.ts). A+ is `fit >= PROFIT_A_PLUS` (0.75) on a COMPLETE template.
 * But real fit tops out far below 0.75 (the confluence snapshot's best was 0.635),
 * so A+ is unreachable by construction and has fired 0/843. This script measures
 * the achievable fit distribution and recommends edges at sensible percentiles so
 * A+ becomes the genuinely-best cards, not an empty band.
 *
 * It drives the REAL scoring function (gradeStrategyAgainstMarket) — no re-derived
 * math — over a candidate distribution:
 *   default: Monte-Carlo from the committed component fire rates
 *            (CONFLUENCE_KNOWLEDGE.componentFirePct). Runs now, no data. Assumes
 *            component independence, so it is a FIRST-CUT estimate.
 *   --from <candidates.json>: an array of { strategyId, components:string[],
 *            htfOk?, kzOk?, condOk? } from a real scorer/backtest run — the precise
 *            version; co-firing is then real, not assumed.
 *
 * Output: the fit distribution, current-edge band occupancy (shows A+ ≈ 0), and a
 * recommended { aPlusThreshold, confluenceFloor } at the chosen percentiles, with a
 * diff vs current. It APPLIES NOTHING — changing APLUS_RULES is a gated, your-call
 * decision (Release-Watch + Trading-Stand). Usage:
 *   npx tsx scripts/recalibrate-band.mts [--n 40000] [--seed 7] [--from file.json]
 *     [--aplus-pct 95] [--a-pct 85] [--amin-pct 70] [--bplus-pct 55]
 *     [--default-fire 12] [--drop-below 8] [--md out.md]
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  gradeStrategyAgainstMarket, STRATEGY_TEMPLATES, SMC_STRUCTURE_KEYS,
} from "../src/lib/trading/strategy-grade";
import { CONFLUENCE_KNOWLEDGE } from "../src/lib/aplus/confluence";
import { APLUS_RULES } from "../src/lib/aplus/config";
import { COMPONENT_KEYS } from "../src/lib/trading/engine-weights";

const args = process.argv.slice(2);
const argN = (flag: string, d: number) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? Number(args[i + 1]) : d; };
const N = argN("--n", 40000);
const DEFAULT_FIRE = argN("--default-fire", 12); // fire % for keys absent from the snapshot
const PCT = { "A+": argN("--aplus-pct", 95), A: argN("--a-pct", 85), "A-": argN("--amin-pct", 70), "B+": argN("--bplus-pct", 55) };
const fromFile = args.includes("--from") ? args[args.indexOf("--from") + 1] : null;
const mdPath = args.includes("--md") ? args[args.indexOf("--md") + 1] : null;

// small deterministic PRNG so runs are reproducible
let seed = argN("--seed", 7) >>> 0;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const fireRate: Record<string, number> = {};
for (const k of COMPONENT_KEYS) fireRate[k] = CONFLUENCE_KNOWLEDGE.componentFirePct[k] ?? DEFAULT_FIRE;

interface Cand { strategyId?: string; components: string[]; htfOk?: boolean; kzOk?: boolean; condOk?: boolean }

/** Best fit across templates for one component set (the desk grades the best-fitting strategy). */
function bestFit(c: Cand): { fit: number; band: string; complete: boolean } {
  const ids = c.strategyId ? [c.strategyId] : STRATEGY_TEMPLATES.map((t) => t.id);
  let best = { fit: -1, band: "skip", complete: false };
  for (const id of ids) {
    const g = gradeStrategyAgainstMarket(id, c.components, { htfOk: c.htfOk ?? true, killzoneOk: c.kzOk ?? true, conditionsOk: c.condOk ?? true });
    if (g.fit > best.fit) best = { fit: g.fit, band: g.band, complete: g.complete };
  }
  return best;
}

function sampleComponents(): string[] {
  const out: string[] = [];
  for (const k of COMPONENT_KEYS) if (rand() * 100 < fireRate[k]!) out.push(k);
  return out;
}

const fits: number[] = [];
const bandCount: Record<string, number> = {};
let completeN = 0;
const keyFires: Record<string, number> = {};

const cands: Cand[] = fromFile
  ? (JSON.parse(readFileSync(fromFile, "utf8")) as Cand[])
  : Array.from({ length: N }, () => ({ components: sampleComponents() }));

for (const c of cands) {
  for (const k of c.components) if (SMC_STRUCTURE_KEYS.includes(k as never)) keyFires[k] = (keyFires[k] ?? 0) + 1;
  const b = bestFit(c);
  fits.push(b.fit);
  bandCount[b.band] = (bandCount[b.band] ?? 0) + 1;
  if (b.complete) completeN++;
}

fits.sort((a, b) => a - b);
const pct = (p: number) => fits[Math.min(fits.length - 1, Math.floor((p / 100) * fits.length))]!;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

const dist = { n: fits.length, min: r3(fits[0]!), p50: r3(pct(50)), p75: r3(pct(75)), p85: r3(pct(85)), p90: r3(pct(90)), p95: r3(pct(95)), p99: r3(pct(99)), max: r3(fits[fits.length - 1]!) };
const current = { aPlusThreshold: APLUS_RULES.aPlusThreshold, confluenceFloor: APLUS_RULES.confluenceFloor };
const recommend = {
  aPlusThreshold: r3(pct(PCT["A+"])),
  A_edge: r3(pct(PCT.A)),
  confluenceFloor: r3(pct(PCT["A-"])),
  bPlus_edge: r3(pct(PCT["B+"])),
};
const structureFire = Object.fromEntries(
  SMC_STRUCTURE_KEYS.map((k) => [k, { firePct: +(100 * (keyFires[k] ?? 0) / fits.length).toFixed(1), snapshot: CONFLUENCE_KNOWLEDGE.componentFirePct[k] ?? null }]),
);
const dropBelow = argN("--drop-below", 8);
const rarelyFire = SMC_STRUCTURE_KEYS.filter((k) => (CONFLUENCE_KNOWLEDGE.componentFirePct[k] ?? 100) < dropBelow);

const report = {
  source: fromFile ?? `monte-carlo n=${N} (independence approximation — a first-cut estimate)`,
  fitDistribution: dist,
  completeShare: +(100 * completeN / fits.length).toFixed(1),
  currentEdges: current,
  currentBandOccupancyPct: Object.fromEntries(Object.entries(bandCount).map(([b, n]) => [b, +(100 * n / fits.length).toFixed(2)])),
  recommendedEdges: recommend,
  recommendedPercentiles: PCT,
  structureKeyFire: structureFire,
  rarelyFiringStructureKeys: rarelyFire,
  note: "Recommendation only. Applying it means editing APLUS_RULES (aPlusThreshold, confluenceFloor) — gated (Release-Watch + Trading-Stand). Re-run with --from a backtest's scored candidates for the precise (co-firing) distribution before any AR GO.",
};

writeFileSync("ai/band-recalibration.json", JSON.stringify(report, null, 2));
const md = [
  `### Band recalibration (${report.source})`, "",
  `fit distribution: p50 ${dist.p50} · p75 ${dist.p75} · p90 ${dist.p90} · p95 ${dist.p95} · max ${dist.max}`,
  `complete setups: ${report.completeShare}%`,
  "",
  `current edges → A+ ${current.aPlusThreshold}, A- floor ${current.confluenceFloor}`,
  `current A+ occupancy: ${report.currentBandOccupancyPct["A+"] ?? 0}%  (the problem)`,
  "",
  `**recommended** (A+ = p${PCT["A+"]}, A = p${PCT.A}, A- = p${PCT["A-"]}, B+ = p${PCT["B+"]}):`,
  `- aPlusThreshold: ${current.aPlusThreshold} → **${recommend.aPlusThreshold}**`,
  `- A edge: ${(current.confluenceFloor + 0.03).toFixed(2)} → **${recommend.A_edge}**`,
  `- confluenceFloor (A-): ${current.confluenceFloor} → **${recommend.confluenceFloor}**`,
  `- B+ edge: ${(current.confluenceFloor - 0.05).toFixed(2)} → **${recommend.bPlus_edge}**`,
  "",
  rarelyFire.length ? `rarely-firing structure keys (<${dropBelow}%): ${rarelyFire.join(", ")} — review for removal from SMC_STRUCTURE_KEYS` : `no structure key fires below ${dropBelow}%`,
  "",
  `_Recommendation only — APLUS_RULES edit is gated. Re-run with --from backtest candidates before AR GO._`,
].join("\n");
if (mdPath) writeFileSync(mdPath, md);
console.log(md);
