#!/usr/bin/env node
// Review 2026-10-15 #5 — STAGED, NOT RUN AGAINST PROD. Voids today's 4 gap-settled 'ES long -1R Master said TAKE'
// journal rows (opened 07:32–08:09 CT, closed around the 09:12 ET feed reconnect) by APPENDING annotation rows.
// The original rows are never updated or deleted.
//   dry run (default):  npx tsx scripts/void-gap-settled-1015.mjs
//   apply (approved):    VOID_APPLY=1 npx tsx scripts/void-gap-settled-1015.mjs --apply
// Refuses unless exactly 4 rows match.
import { register } from "tsx/esm/api";
register();
export const SPEC = {
  day: "2026-10-15", symbol: "ES", side: "long", r: -1, reviewLike: "%Master said TAKE%",
  openedFromMs: Date.parse("2026-10-15T12:32:00Z"), openedToMs: Date.parse("2026-10-15T13:09:59Z"),   // 07:32–08:09 CT
  closedFromMs: Date.parse("2026-10-15T13:05:00Z"), closedToMs: Date.parse("2026-10-15T13:20:00Z"),   // ~09:12 ET reconnect ±
  reason: "gap-settled: stop 'hit' on the 09:12 ET feed-reconnect gap, not traded price (review 2026-10-15)",
  expect: 4,
};
export async function findRows(sql) {
  return sql.query(
    `select id, opened_ms, closed_ms, r, review from desk_card_journal where day_key = $1 and symbol = $2 and side = $3 and r = $4
       and review like $5 and opened_ms between $6 and $7 and closed_ms between $8 and $9 order by opened_ms`,
    [SPEC.day, SPEC.symbol, SPEC.side, SPEC.r, SPEC.reviewLike, SPEC.openedFromMs, SPEC.openedToMs, SPEC.closedFromMs, SPEC.closedToMs]);
}
export async function run(sql, { apply = false, nowMs = Date.now() } = {}) {
  const { appendVoid, ensureAnnotations } = await import("../src/lib/desk/annotations.ts");
  await ensureAnnotations(sql);
  const rows = await findRows(sql);
  if (rows.length !== SPEC.expect) return { ok: false, why: `matched ${rows.length}, expected ${SPEC.expect} — refusing`, rows };
  const done = await sql.query(`select row_id from desk_learn_annotation where src = 'desk_card_journal' and annotation = 'void' and row_id = any($1)`, [rows.map((r) => r.id)]);
  const todo = rows.filter((r) => !done.some((d) => d.row_id === r.id));
  if (apply) for (const r of todo) await appendVoid(sql, { src: "desk_card_journal", row_id: r.id, void_reason: SPEC.reason, exclude_from_learning: true, created_ms: nowMs, by: "review-1015" });
  return { ok: true, applied: apply, rows: rows.map((r) => r.id), appended: apply ? todo.length : 0 };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const apply = process.argv.includes("--apply");
  if (apply && process.env.VOID_APPLY !== "1") { console.error("refusing --apply without VOID_APPLY=1 (approval step)"); process.exit(2); }
  const { getSql } = await import("../src/lib/db.ts");
  const out = await run(await getSql(), { apply });
  console.log(JSON.stringify(out, null, 2)); process.exit(out.ok ? 0 : 1);
}
