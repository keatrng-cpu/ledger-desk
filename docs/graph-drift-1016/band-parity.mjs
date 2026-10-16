/** graph-drift-1016: q→band PARITY TABLE ONLY (no unification). Run: npx tsx docs/graph-drift-1016/band-parity.mjs
 *  Watcher twins are re-implemented from shared/desk-rules.json exactly as watcher/gates.py q_band / fastchain.py band_of_q read it. */
import { bandFromQ } from "../../src/lib/smc/discipline.ts";
import { bandV2 } from "../../src/lib/trading/q-v2.ts";
import { bandOfQ } from "../../src/lib/execution/fast-chain.ts";
import { pathBand } from "../../src/lib/trading/strategy-grade.ts";
import { profitGrade } from "../../src/lib/trading/profit-path.ts";
import RULES from "../../shared/desk-rules.json" with { type: "json" };
const E = RULES.bandEdges;
const qBand = (q) => { if (q == null || !(q >= 0 && q <= 1)) return null; for (const b of ["A+", "A", "A-", "B+"]) if (q >= E[b] - 1e-12) return b; return "B"; };
const bandOfQPy = (q) => (["A+", "A", "A-", "B+", "B"].find((b) => q >= E[b] - 1e-9) ?? "C");
const qs = [0.3, 0.46, 0.47, 0.4999, 0.5, 0.5499, 0.55, 0.5999, 0.6, 0.62, 0.6499, 0.65, 0.67, 0.6799, 0.68, 0.7, 0.7499, 0.75, 0.9];
const cols = {
  "bandFromQ (smc/discipline.ts)": bandFromQ,
  "bandV2 (q-v2.ts)": bandV2,
  "bandOfQ (fast-chain.ts)": bandOfQ,
  "pathBand complete+htfOk (strategy-grade.ts)": (q) => pathBand({ quality: q, complete: true, htfOk: true }),
  "profitGrade (profit-path.ts)": (q) => profitGrade(q, false),
  "watcher q_band (gates.py)": qBand,
  "watcher band_of_q (fastchain.py)": bandOfQPy,
};
const names = Object.keys(cols);
console.log(`| q | ${names.join(" | ")} | all equal? |`);
console.log(`|---|${names.map(() => "---").join("|")}|---|`);
for (const q of qs) {
  const v = names.map((n) => String(cols[n](q)));
  const core = v.slice(0, 3).concat(v[6]);
  console.log(`| ${q} | ${v.join(" | ")} | ${new Set(v).size === 1 ? "yes" : new Set(core).size === 1 ? "core 4 yes" : "NO"} |`);
}
