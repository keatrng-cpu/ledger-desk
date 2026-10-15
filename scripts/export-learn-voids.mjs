// Read-only export of desk_learn_annotation voids for ops/charts learn.py (same source as annotations.ts snapNotVoided).
// Usage: node scripts/export-learn-voids.mjs <out.json>. Uses DATABASE_URL from the environment (never printed);
// the session is READ ONLY. Exit 1 (and no file) on any failure, so learn.py refuses to run on a stale/missing export.
import pg from "pg";
import { writeFileSync, renameSync } from "node:fs";

export const VOIDS_SQL = `select a.src, a.row_id, coalesce(j.day_key, s.day_key) as day_key, coalesce(j.symbol, s.symbol) as symbol,
  coalesce(j.side, s.side) as side, coalesce(j.entry, s.entry)::float8 as entry
  from desk_learn_annotation a
  left join desk_card_journal j on a.src = 'desk_card_journal' and j.id = a.row_id
  left join desk_card_snap s on a.src = 'desk_card_snap' and s.id = a.row_id
  where a.exclude_from_learning`;

async function main(out) {
  const url = process.env.DATABASE_URL;
  if (!out || !url) throw new Error(!out ? "usage: export-learn-voids.mjs <out.json>" : "DATABASE_URL not set");
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000, ssl: /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query("begin transaction read only");
    const { rows } = await c.query(VOIDS_SQL);
    await c.query("rollback");
    const doc = { ok: true, source: "desk_learn_annotation", exported_at: new Date().toISOString(), n: rows.length, voids: rows };
    writeFileSync(out + ".tmp", JSON.stringify(doc)); renameSync(out + ".tmp", out);
    console.log(JSON.stringify({ ok: true, n: rows.length, out }));
  } finally { await c.end(); }
}
if (import.meta.url === `file://${process.argv[1]}`) main(process.argv[2]).catch((e) => { console.error(`export-learn-voids: ${e.message}`); process.exit(1); });
