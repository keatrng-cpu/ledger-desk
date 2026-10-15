/**
 * Review 2026-10-15 #5: append-only annotation rows. A row is never edited or deleted to void it; an annotation
 * row keyed to (src, row_id) says annotation:'void', void_reason, exclude_from_learning. Every learner / calibration
 * / stats reader filters through NOT_EXCLUDED (SQL) or excludeVoided (in memory).
 */
import type { Sql } from "@/lib/db";

export type AnnSrc = "desk_card_journal" | "desk_card_snap";
export interface Annotation { src: AnnSrc; row_id: string; annotation: "void"; void_reason: string; exclude_from_learning: boolean; created_ms: number; by?: string }

export const ANN_DDL = `create table if not exists desk_learn_annotation (
  seq bigserial primary key, src text not null, row_id text not null, annotation text not null,
  void_reason text, exclude_from_learning boolean not null default false, created_ms bigint not null, by text)`;
let ready = false;
export async function ensureAnnotations(sql: Sql) { if (ready) return; await sql.query(ANN_DDL); ready = true; }

/** SQL predicate for a reader aliased `alias` over table `src`. */
export const notExcluded = (src: AnnSrc, alias: string) =>
  `not exists (select 1 from desk_learn_annotation a where a.src = '${src}' and a.row_id = ${alias}.id and a.exclude_from_learning)`;

/** desk_card_snap reader (calibration / learning): excludes a snap that is voided itself OR whose journal twin is voided.
 * The void script annotates desk_card_journal rows; the matching snap (same day, symbol, side, entry to the cent —
 * journal id is day:symbol:side:entry, snap id is day:symbol:side:setup) carries the same bad outcome. */
export const snapNotVoided = (alias: string) =>
  `${notExcluded("desk_card_snap", alias)} and not exists (select 1 from desk_learn_annotation a join desk_card_journal jj on a.row_id = jj.id
    where a.src = 'desk_card_journal' and a.exclude_from_learning and jj.day_key = ${alias}.day_key and jj.symbol = ${alias}.symbol
    and jj.side = ${alias}.side and ${alias}.entry is not null and round(jj.entry::numeric, 2) = round(${alias}.entry::numeric, 2))`;

export function excludedIds(anns: Pick<Annotation, "src" | "row_id" | "exclude_from_learning">[], src: AnnSrc): Set<string> {
  return new Set(anns.filter((a) => a.src === src && a.exclude_from_learning).map((a) => a.row_id));
}
export function excludeVoided<T extends { id: string }>(rows: T[], anns: Pick<Annotation, "src" | "row_id" | "exclude_from_learning">[], src: AnnSrc): T[] {
  const x = excludedIds(anns, src); return rows.filter((r) => !x.has(r.id));
}

/** Append only: INSERT, never UPDATE/DELETE of the original row. */
export async function appendVoid(sql: Sql, a: Omit<Annotation, "annotation">) {
  await ensureAnnotations(sql);
  await sql.query(`insert into desk_learn_annotation (src, row_id, annotation, void_reason, exclude_from_learning, created_ms, by) values ($1,$2,'void',$3,$4,$5,$6)`,
    [a.src, a.row_id, a.void_reason, a.exclude_from_learning, a.created_ms, a.by ?? null]);
}
