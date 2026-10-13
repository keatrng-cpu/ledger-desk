/**
 * Learning-loop calibration admin (needs the DB env the site uses).
 *   npx tsx scripts/calibration.mts list
 *   npx tsx scripts/calibration.mts revert <version>     # reversible: marks it reverted
 *   npx tsx scripts/calibration.mts decisions            # prints ai/DECISIONS.md entries for each version
 */
import { getSql } from "../src/lib/db";
import * as L from "../src/lib/desk/learning";
const [cmd, arg] = process.argv.slice(2);
const sql = await getSql();
await L.ensureLearning(sql);
if (cmd === "revert") { await L.revertCalibration(sql, Number(arg)); console.log(`reverted v${arg}`); }
const rows = await sql.query<any>(`select * from desk_calibration order by version`);
if (cmd === "decisions") for (const r of rows) console.log(`- ${new Date(Number(r.created_ms)).toISOString().slice(0, 10)} — calibration v${r.version} ${r.applied ? "APPLIED" : "report only"}${r.reverted ? " (REVERTED)" : ""}: ${r.note}. Scales ${JSON.stringify(r.weight_scales)}; band edges ${JSON.stringify(r.band_edges)}; prior v${r.prior?.version ?? 0}.`);
else console.table(rows.map((r: any) => ({ v: r.version, applied: r.applied, reverted: r.reverted, note: r.note })));
