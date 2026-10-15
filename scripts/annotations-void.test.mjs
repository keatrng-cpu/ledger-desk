import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const { PGlite } = await import("@electric-sql/pglite");
const ann = await import("../src/lib/desk/annotations.ts");
const cj = await import("../src/lib/desk/card-journal.ts");
const voidScript = await import("./void-gap-settled-1015.mjs");
const mkSql = async () => { const db = new PGlite(); const sql = { query: async (q, p = []) => (await db.query(q, p)).rows }; await sql.query(cj.DDL); await sql.query(ann.ANN_DDL); return sql; };
const ms = (iso) => Date.parse(iso);

async function seed(sql) {
  const ins = (id, opened, closed, r, review, band = "A") => sql.query(
    `insert into desk_card_journal (id, day_key, symbol, side, band, q, entry, stop, target, rr, opened_ms, filled, status, r, closed_ms, review)
     values ($1,'2026-10-15','ES','long',$5,0.7,6700,6690,6720,2,$2,true,$6,$4,$3,$7)`, [id, opened, closed, r, band, r > 0 ? "win" : "loss", review]);
  for (const [i, t] of ["12:32", "12:45", "12:58", "13:09"].entries()) await ins(`gap${i}`, ms(`2026-10-15T${t}:00Z`), ms("2026-10-15T13:12:30Z"), -1, "LOSS -1R · Master said TAKE");
  await ins("real-loss", ms("2026-10-15T14:40:00Z"), ms("2026-10-15T14:55:00Z"), -1, "LOSS -1R · Master said TAKE");
  await ins("win", ms("2026-10-15T14:41:00Z"), ms("2026-10-15T15:20:00Z"), 2, "WIN +2R");
}

test("staged void: dry run touches nothing, apply appends 4 annotations, originals unchanged", async () => {
  const sql = await mkSql(); await seed(sql);
  const dry = await voidScript.run(sql); assert.equal(dry.ok, true); assert.deepEqual(dry.rows, ["gap0", "gap1", "gap2", "gap3"]);
  assert.equal((await sql.query("select count(*)::int n from desk_learn_annotation"))[0].n, 0);
  const before = await sql.query("select * from desk_card_journal order by id");
  const ap = await voidScript.run(sql, { apply: true }); assert.equal(ap.appended, 4);
  assert.equal((await voidScript.run(sql, { apply: true })).appended, 0);     // idempotent
  assert.deepEqual(await sql.query("select * from desk_card_journal order by id"), before);   // append-only
  const a = await sql.query("select * from desk_learn_annotation"); assert.ok(a.every((x) => x.annotation === "void" && x.exclude_from_learning && x.void_reason));
});
test("a voided row is excluded from the Floor/band stats reader", async () => {
  const sql = await mkSql(); await seed(sql);
  const pre = await cj.journalReport(sql, ms("2026-10-15T20:00:00Z"));
  await voidScript.run(sql, { apply: true });
  const post = await cj.journalReport(sql, ms("2026-10-15T20:00:00Z"));
  const A = (r) => r.bands.find((b) => b.band === "A");
  assert.equal(A(pre).n, 6); assert.equal(A(post).n, 2); assert.equal(post.rToday, 1);
});
test("refuses unless exactly 4 rows match", async () => {
  const sql = await mkSql();
  assert.equal((await voidScript.run(sql, { apply: true })).ok, false);
});
test("in-memory filter + every SQL learner reader carries the predicate", () => {
  const rows = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(ann.excludeVoided(rows, [{ src: "desk_card_snap", row_id: "a", exclude_from_learning: true }], "desk_card_snap"), [{ id: "b" }]);
  const L = readFileSync("src/lib/desk/learning.ts", "utf8");
  assert.match(L, /from desk_card_snap s where status in \([^)]*\) and \$\{notExcluded\("desk_card_snap", "s"\)\}/);
  assert.match(readFileSync("src/lib/desk/card-journal.ts", "utf8"), /notExcluded\("desk_card_journal", "j"\)/);
});
