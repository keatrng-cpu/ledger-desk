/**
 * Learning loop (Keaton 2026-10-13). Extends the fix-23 journal:
 *
 *  1. SNAPSHOT every card with q or qRaw ≥ 0.65 — plan or not — once per
 *     (ET day, symbol, side, setup), with its full checklist and context.
 *  2. GRADE each snapshot against the real 1m bars after it (the desk's own
 *     feed): with a plan, T1-or-stop first, MFE/MAE in R, minutes to resolve;
 *     without, signed move at +30/+60/+120 min in ATR. Hows and whys: checks
 *     present on winners / missing on losers, and a failure mode.
 *  3. LEARN weekly: per-factor hit-rate lift → weight scale, only at n ≥ 30,
 *     shrunk toward the current weight, each change capped at ±20%,
 *     versioned (prior state kept, reversible), never on invented outcomes.
 *
 * Fix 40 (missed trades) is the same data: a snapshot graded below A- that
 * ran ≥ 2R (or ≥ 1 ATR at +120m with no plan) is logged with the reasons it
 * was not A-.
 */
import RULES from "../../../shared/desk-rules.json";
import { isHoldout, checkpoints, statsReport } from "@/lib/desk/learning-stats";
import type { Sql } from "@/lib/db";
import type { OhlcBar } from "@/lib/market/types";
import { etDayKey, DDL as JOURNAL_DDL } from "./card-journal";
import { ensureAnnotations, snapNotVoided } from "./annotations";

export const SNAP_MIN_Q = 0.65;
export const LEARN_MIN_N = 30;
export const LEARN_MAX_STEP = 0.2;
export const LEARN_SHRINK_K = 50;
export const LEARN_EVERY_MS = 7 * 86_400_000;
export const DIR_HORIZONS = [30, 60, 120] as const;
export const DIR_RIGHT_ATR = 0.25;
export const PLAN_MAX_MIN = 240;
const GOOD_BANDS = ["A+", "A", "A-"];

export interface SnapCard {
  symbol: string; side: "long" | "short"; setup: string; band: string | null; q: number; qRaw: number | null;
  price: number | null; atr: number | null; entry: number | null; stop: number | null; target: number | null;
  /** components present (the scanner's confluence keys) */
  present: string[]; missing: string[]; checklist: { name: string; ok: boolean }[];
  ctx: Record<string, unknown>;
}

export interface PlanGrade { kind: "plan"; status: "win" | "loss" | "nofill" | "timeout" | "open"; r: number | null; mfeR: number | null; maeR: number | null; minutes: number | null; filledAt: number | null }
export interface DirGrade { kind: "dir"; status: "right" | "wrong" | "flat" | "open"; moves: Record<string, number | null> }
export type Grade = PlanGrade | DirGrade;

/** Pure. Bars strictly after openedMs, closed only. Same-bar stop+T1 = loss (conservative). */
export function gradePlan(s: { side: string; entry: number; stop: number; target: number; resting?: boolean }, openedMs: number, bars: OhlcBar[], nowMs: number): PlanGrade {
  const long = s.side === "long";
  const risk = Math.abs(s.entry - s.stop);
  const after = bars.filter((b) => b.t >= openedMs && b.t + 60_000 <= nowMs);
  let filled: number | null = s.resting ? null : openedMs;
  let mfe = 0, mae = 0;
  for (const b of after) {
    if (filled == null) {
      if (b.l <= s.entry && b.h >= s.entry) filled = b.t; else {
        if ((b.t - openedMs) / 60_000 > PLAN_MAX_MIN / 2) return { kind: "plan", status: "nofill", r: null, mfeR: null, maeR: null, minutes: Math.round((b.t - openedMs) / 60_000), filledAt: null };
        continue;
      }
    }
    const fav = long ? b.h - s.entry : s.entry - b.l;
    const adv = long ? s.entry - b.l : b.h - s.entry;
    mfe = Math.max(mfe, fav / risk); mae = Math.max(mae, adv / risk);
    const hitStop = long ? b.l <= s.stop : b.h >= s.stop;
    const hitT = long ? b.h >= s.target : b.l <= s.target;
    const mins = Math.round((b.t + 60_000 - openedMs) / 60_000);
    if (hitStop) return { kind: "plan", status: "loss", r: -1, mfeR: +mfe.toFixed(2), maeR: +Math.max(1, mae).toFixed(2), minutes: mins, filledAt: filled };
    if (hitT) return { kind: "plan", status: "win", r: +(Math.abs(s.target - s.entry) / risk).toFixed(2), mfeR: +mfe.toFixed(2), maeR: +mae.toFixed(2), minutes: mins, filledAt: filled };
    if ((b.t - openedMs) / 60_000 >= PLAN_MAX_MIN) {
      const r = (long ? b.c - s.entry : s.entry - b.c) / risk;
      return { kind: "plan", status: "timeout", r: +r.toFixed(2), mfeR: +mfe.toFixed(2), maeR: +mae.toFixed(2), minutes: mins, filledAt: filled };
    }
  }
  return { kind: "plan", status: filled == null && after.length && (after[after.length - 1]!.t - openedMs) / 60_000 > PLAN_MAX_MIN / 2 ? "nofill" : "open", r: null, mfeR: filled != null ? +mfe.toFixed(2) : null, maeR: filled != null ? +mae.toFixed(2) : null, minutes: null, filledAt: filled };
}

/** Pure. Signed move (side's favour) at +30/+60/+120 min, in ATR; null until that bar closes. */
export function gradeDirection(s: { side: string; price: number; atr: number }, openedMs: number, bars: OhlcBar[], nowMs: number): DirGrade {
  const moves: Record<string, number | null> = {};
  for (const h of DIR_HORIZONS) {
    const at = openedMs + h * 60_000;
    const b = at + 60_000 <= nowMs ? bars.filter((x) => x.t <= at && x.t + 60_000 <= nowMs).pop() : undefined;
    moves[`m${h}`] = b && b.t >= at - 5 * 60_000 ? +(((s.side === "long" ? b.c - s.price : s.price - b.c) / s.atr)).toFixed(2) : null;
  }
  const last = moves.m120;
  const status = last == null ? "open" : last >= DIR_RIGHT_ATR ? "right" : last <= -DIR_RIGHT_ATR ? "wrong" : "flat";
  return { kind: "dir", status, moves };
}

export const isWin = (g: Grade) => g.status === "win" || g.status === "right" || (g.status === "timeout" && (g as PlanGrade).r! > 0);
export const isLoss = (g: Grade) => g.status === "loss" || g.status === "wrong" || (g.status === "timeout" && (g as PlanGrade).r! <= 0);

/** Pure: the first failure mode that the snapshot itself shows. */
export function failureMode(c: SnapCard, g: Grade): string | null {
  if (!isLoss(g)) return null;
  const x = c.ctx as Record<string, unknown>;
  const htf = (s: unknown) => (c.side === "long" ? s === "bear" : s === "bull");
  if ((htf(x.bias1h) || htf(x.bias4h)) && !x.htfReleased) return "HTF conflict";
  if (x.chop === true) return "chop";
  if (g.kind === "plan" && (g.mfeR ?? 0) >= 0.5) return "early reversal (ran ≥0.5R then stopped)";
  if (g.kind === "dir" && (g.moves.m30 ?? 0) >= DIR_RIGHT_ATR) return "early reversal (right at +30m, wrong by +120m)";
  if (typeof x.legs === "number" && x.legs >= 3) return "chase (leg 3+)";
  if (c.entry != null && c.price != null && c.atr && Math.abs(c.price - c.entry) > c.atr && x.entryResting === false) return "chase (price far from entry)";
  if (x.ltfKilled === true) return "LTF kill ignored";
  if (x.smtOpposes === true) return "SMT against";
  return "unclassified";
}

/** Pure: the hows/whys line. */
export function howsWhys(c: SnapCard, g: Grade): string {
  if (isWin(g)) return `WIN — present: ${c.present.join(", ") || "none listed"}${c.checklist.filter((k) => !k.ok).length ? `; won despite missing: ${c.checklist.filter((k) => !k.ok).map((k) => k.name).join(", ")}` : ""}`;
  if (isLoss(g)) return `LOSS (${failureMode(c, g)}) — missing: ${[...c.missing, ...c.checklist.filter((k) => !k.ok).map((k) => k.name)].join(", ") || "nothing listed"}; present: ${c.present.join(", ")}`;
  return g.status;
}

/** Pure, fix 40: graded below A- but ran ≥2R (plan) / ≥1 ATR at +120m (no plan). */
export function missedTrade(c: SnapCard, g: Grade): string | null {
  if (c.band && GOOD_BANDS.includes(c.band)) return null;
  const ran = g.kind === "plan" ? (g.mfeR ?? 0) >= 2 : (g.moves.m120 ?? 0) >= 1;
  if (!ran) return null;
  const why = (c.ctx.capReasons as string[] | undefined) ?? [];
  return `MISSED ${c.symbol} ${c.side} graded ${c.band} (q ${c.q}${c.qRaw != null ? `, qRaw ${c.qRaw}` : ""}) — ran ${g.kind === "plan" ? `${g.mfeR}R` : `${g.moves.m120} ATR in 120m`}. Not A- because: ${[...why, ...c.missing].slice(0, 6).join("; ") || "no reason recorded"}`;
}

export interface FactorLift { factor: string; n: number; hitRate: number | null; base: number | null; lift: number | null; scale: number; applied: boolean; note: string }

/** Pure: per-factor lift and its shrunk, capped scale. Scale 1 unless n ≥ 30. */
export function factorLifts(rows: { present: string[]; win: boolean }[], current: Record<string, number> = {}): FactorLift[] {
  const total = rows.length;
  const base = total ? rows.filter((r) => r.win).length / total : null;
  const factors = [...new Set(rows.flatMap((r) => r.present))].sort();
  return factors.map((f) => {
    const with_ = rows.filter((r) => r.present.includes(f));
    const n = with_.length;
    const hr = n ? with_.filter((r) => r.win).length / n : null;
    const cur = current[f] ?? 1;
    if (n < LEARN_MIN_N || hr == null || base == null || base === 0) {
      return { factor: f, n, hitRate: hr == null ? null : +hr.toFixed(3), base: base == null ? null : +base.toFixed(3), lift: hr != null && base ? +(hr / base - 1).toFixed(3) : null, scale: cur, applied: false, note: `n ${n} < ${LEARN_MIN_N}: unchanged` };
    }
    const lift = hr / base - 1;
    const shrunk = lift * (n / (n + LEARN_SHRINK_K));
    const step = Math.max(-LEARN_MAX_STEP, Math.min(LEARN_MAX_STEP, shrunk));
    const scale = +Math.max(0.8, Math.min(1.2, cur * (1 + step))).toFixed(4);
    return { factor: f, n, hitRate: +hr.toFixed(3), base: +base.toFixed(3), lift: +lift.toFixed(3), scale, applied: scale !== cur, note: `lift ${(lift * 100).toFixed(1)}% shrunk to ${(step * 100).toFixed(1)}%` };
  });
}

/** Pure: band edge nudges (±0.01) at n ≥ 30 per band; never below baseline, at most +20%. */
export function bandEdgeMoves(rows: { band: string; win: boolean; r: number | null }[], edges: Record<string, number>, baseline: Record<string, number>) {
  const out: Record<string, { n: number; winRate: number | null; avgR: number | null; from: number; to: number; note: string }> = {};
  for (const band of Object.keys(edges)) {
    const b = rows.filter((r) => r.band === band);
    const n = b.length;
    const wr = n ? b.filter((r) => r.win).length / n : null;
    const rs = b.map((r) => r.r).filter((x): x is number => x != null);
    const avgR = rs.length ? rs.reduce((a, x) => a + x, 0) / rs.length : null;
    let to = edges[band]!;
    let note = `n ${n} < ${LEARN_MIN_N}: unchanged`;
    if (n >= LEARN_MIN_N && wr != null) {
      if (wr < 0.45 && (avgR ?? 0) < 0) { to += 0.01; note = "underperforming: edge up 0.01"; }
      // Keaton 2026-10-13: edges may only RISE — never below the baseline.
      else if (wr > 0.6 && (avgR ?? 0) > 0.5) { to -= 0.01; note = "outperforming: edge down 0.01 (floored at baseline)"; }
      else note = "within tolerance: unchanged";
      const lo = baseline[band]!, hi = Math.min(0.99, baseline[band]! * 1.2);
      to = +Math.max(lo, Math.min(hi, to)).toFixed(4);
    }
    out[band] = { n, winRate: wr == null ? null : +wr.toFixed(3), avgR: avgR == null ? null : +avgR.toFixed(2), from: edges[band]!, to, note };
  }
  return out;
}

// ───────────────────────── DB ─────────────────────────
const DDL = [
  `create table if not exists desk_card_snap (
    id text primary key, day_key text not null, symbol text not null, side text not null, setup text not null,
    band text, q double precision not null, q_raw double precision, opened_ms bigint not null,
    price double precision, atr double precision, entry double precision, stop double precision, target double precision,
    resting boolean, present jsonb not null default '[]'::jsonb, missing jsonb not null default '[]'::jsonb,
    checklist jsonb not null default '[]'::jsonb, ctx jsonb not null default '{}'::jsonb, source text not null default 'live',
    status text not null default 'open', grade jsonb, failure_mode text, hows text, missed text, graded_ms bigint)`,
  `create index if not exists desk_card_snap_status on desk_card_snap (status)`,
  `create table if not exists desk_calibration (
    version integer primary key, created_ms bigint not null, applied boolean not null default false, reverted boolean not null default false,
    weight_scales jsonb not null default '{}'::jsonb, band_edges jsonb not null default '{}'::jsonb,
    prior jsonb, report jsonb not null default '{}'::jsonb, note text)`,
];
let ready = false;
export async function ensureLearning(sql: Sql) {
  if (ready) return;
  for (const d of DDL) await sql.query(d);
  await sql.query(JOURNAL_DDL);   // snapNotVoided joins the journal
  await ensureAnnotations(sql);
  ready = true;
}

export async function snapshotCards(sql: Sql, cards: SnapCard[], nowMs: number, source = "live"): Promise<number> {
  await ensureLearning(sql);
  let n = 0;
  for (const c of cards) {
    if (!(c.q >= SNAP_MIN_Q || (c.qRaw ?? 0) >= SNAP_MIN_Q)) continue;
    const day = etDayKey(nowMs);
    const id = `${day}:${c.symbol}:${c.side}:${c.setup}`;
    const r = await sql.query(
      `insert into desk_card_snap (id, day_key, symbol, side, setup, band, q, q_raw, opened_ms, price, atr, entry, stop, target, resting, present, missing, checklist, ctx, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20) on conflict (id) do nothing returning id`,
      [id, day, c.symbol, c.side, c.setup, c.band, c.q, c.qRaw, nowMs, c.price, c.atr, c.entry, c.stop, c.target, Boolean(c.ctx.entryResting),
        JSON.stringify(c.present), JSON.stringify(c.missing), JSON.stringify(c.checklist), JSON.stringify(c.ctx), source],
    );
    n += r.length;
  }
  return n;
}

type SnapRow = { id: string; symbol: string; side: string; band: string | null; q: number; q_raw: number | null; opened_ms: string | number; price: number | null; atr: number | null; entry: number | null; stop: number | null; target: number | null; resting: boolean | null; present: unknown; missing: unknown; checklist: unknown; ctx: unknown; setup: string };
const j = <T>(v: unknown, d: T): T => (v == null ? d : typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

export function rowToSnap(r: SnapRow): SnapCard {
  return { symbol: r.symbol, side: r.side as "long" | "short", setup: r.setup, band: r.band, q: Number(r.q), qRaw: r.q_raw == null ? null : Number(r.q_raw),
    price: r.price == null ? null : Number(r.price), atr: r.atr == null ? null : Number(r.atr), entry: r.entry == null ? null : Number(r.entry),
    stop: r.stop == null ? null : Number(r.stop), target: r.target == null ? null : Number(r.target),
    present: j(r.present, []), missing: j(r.missing, []), checklist: j(r.checklist, []), ctx: { ...j(r.ctx, {}), entryResting: r.resting } };
}

/** Grade every open snapshot whose bars are in `minute` (the desk's own 1m feed). */
export async function gradeSnapshots(sql: Sql, minute: Record<string, OhlcBar[]>, nowMs: number): Promise<number> {
  await ensureLearning(sql);
  const rows = await sql.query<SnapRow>(`select * from desk_card_snap where status = 'open'`);
  let n = 0;
  for (const r of rows) {
    const bars = minute[r.symbol] ?? [];
    const c = rowToSnap(r);
    const opened = Number(r.opened_ms);
    if (!bars.length || bars[0]!.t > opened) {
      // the feed no longer covers the open: say so after a day, never guess
      if (nowMs - opened > 86_400_000) { await sql.query(`update desk_card_snap set status = 'ungradable', hows = 'no 1m bars cover this snapshot', graded_ms = $2 where id = $1`, [r.id, nowMs]); n++; }
      continue;
    }
    let g: Grade | null = null;
    if (c.entry != null && c.stop != null && c.target != null && c.entry !== c.stop) g = gradePlan({ side: c.side, entry: c.entry, stop: c.stop, target: c.target, resting: Boolean(c.ctx.entryResting) }, opened, bars, nowMs);
    else if (c.price != null && c.atr) g = gradeDirection({ side: c.side, price: c.price, atr: c.atr }, opened, bars, nowMs);
    if (!g) { await sql.query(`update desk_card_snap set status = 'ungradable', hows = 'no plan and no price/ATR at snapshot', graded_ms = $2 where id = $1`, [r.id, nowMs]); n++; continue; }
    if (g.status === "open") continue;
    // item 1: MFE/MAE checkpoints at +15m / +60m / end of day
    (g as Grade & { checkpoints?: unknown }).checkpoints = checkpoints(c, opened, bars, nowMs);
    await sql.query(`update desk_card_snap set status = $2, grade = $3::jsonb, failure_mode = $4, hows = $5, missed = $6, graded_ms = $7 where id = $1`,
      [r.id, g.status, JSON.stringify(g), failureMode(c, g), howsWhys(c, g), missedTrade(c, g), nowMs]);
    n++;
  }
  return n;
}

export async function appliedCalibration(sql: Sql) {
  await ensureLearning(sql);
  const r = await sql.query<{ version: number; weight_scales: unknown; band_edges: unknown; created_ms: string | number }>(
    `select version, weight_scales, band_edges, created_ms from desk_calibration where applied and not reverted order by version desc limit 1`);
  if (!r.length) return { version: 0, weightScales: {} as Record<string, number>, bandEdges: {} as Record<string, number>, createdMs: null as number | null };
  return { version: r[0]!.version, weightScales: j<Record<string, number>>(r[0]!.weight_scales, {}), bandEdges: j<Record<string, number>>(r[0]!.band_edges, {}), createdMs: Number(r[0]!.created_ms) };
}

async function allGraded(sql: Sql) {
  const rows = await sql.query<SnapRow & { status: string; grade: unknown }>(`select * from desk_card_snap s where status in ('win','loss','timeout','right','wrong','flat') and ${snapNotVoided("s")}`);
  return rows.map((r) => { const g = j<Grade>(r.grade, { kind: "dir", status: "flat", moves: {} }); return { id: r.id, c: rowToSnap(r), g, openedMs: Number(r.opened_ms) }; })
    .filter(({ g }) => isWin(g) || isLoss(g));
}
/** Rows the loop LEARNS from: never the holdout (item 25), only the last decayDays (item 20). */
async function gradedRows(sql: Sql, nowMs = Date.now()) {
  return (await allGraded(sql)).filter((r) => !isHoldout(r.id) && nowMs - r.openedMs <= RULES.learning.decayDays * 86_400_000);
}

/** Weekly: compute, and write a new version only if something passed n ≥ 30. */
export async function maybeCalibrate(sql: Sql, nowMs: number, baseline: Record<string, number>, force = false) {
  const cur = await appliedCalibration(sql);
  const last = await sql.query<{ created_ms: string | number }>(`select created_ms from desk_calibration order by version desc limit 1`);
  if (!force && last.length && nowMs - Number(last[0]!.created_ms) < LEARN_EVERY_MS) return null;
  const rows = await gradedRows(sql, nowMs);
  const lifts = factorLifts(rows.map(({ c, g }) => ({ present: c.present, win: isWin(g) })), cur.weightScales);
  const edgesNow = { ...baseline, ...cur.bandEdges };
  const bands = bandEdgeMoves(rows.map(({ c, g }) => ({ band: c.band ?? "?", win: isWin(g), r: g.kind === "plan" ? g.r : null })), edgesNow, baseline);
  const changed = lifts.some((l) => l.applied) || Object.values(bands).some((b) => b.to !== b.from);
  const version = (await sql.query<{ v: number | null }>(`select max(version) as v from desk_calibration`))[0]?.v ?? 0;
  const scales = Object.fromEntries(lifts.map((l) => [l.factor, l.scale]));
  const edges = Object.fromEntries(Object.entries(bands).map(([k, b]) => [k, b.to]));
  await sql.query(
    `insert into desk_calibration (version, created_ms, applied, weight_scales, band_edges, prior, report, note) values ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8)`,
    // item 18: a change is a PROPOSAL (applied=false) until approved after the shadow week (item 19)
    [Number(version) + 1, nowMs, changed && !RULES.learning.requireApproval, JSON.stringify(changed ? scales : cur.weightScales), JSON.stringify(changed ? edges : cur.bandEdges),
      JSON.stringify({ version: cur.version, weightScales: cur.weightScales, bandEdges: cur.bandEdges }), JSON.stringify({ n: rows.length, lifts, bands }),
      changed ? (RULES.learning.requireApproval ? `PROPOSED (shadow ${RULES.learning.shadowDays}d, then approval): factors/bands past n ≥ 30, shrunk, ±20% cap` : "applied: factors/bands past n ≥ 30, shrunk, ±20% cap") : `report only: nothing reached n ≥ ${LEARN_MIN_N} (n graded = ${rows.length})`],
  );
  return { version: Number(version) + 1, changed };
}

/** Item 19: shadow score of a proposal — on rows graded since it was proposed, does it rank winners above losers better than the applied set? */
export async function shadowOf(sql: Sql, version: number, nowMs: number) {
  const p = await sql.query<{ weight_scales: unknown; created_ms: string | number }>(`select weight_scales, created_ms from desk_calibration where version = $1`, [version]);
  if (!p.length) return null;
  const since = Number(p[0]!.created_ms); const cur = await appliedCalibration(sql);
  const prop = j<Record<string, number>>(p[0]!.weight_scales, {});
  const rows = (await gradedRows(sql, nowMs)).filter((r) => r.openedMs >= since);
  const score = (sc: Record<string, number>, present: string[]) => present.reduce((a, f) => a + (sc[f] ?? 1), 0) / Math.max(1, present.length);
  const sep = (sc: Record<string, number>) => {
    const w = rows.filter((r) => isWin(r.g)).map((r) => score(sc, r.c.present)), l = rows.filter((r) => isLoss(r.g)).map((r) => score(sc, r.c.present));
    const m = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    return m(w) != null && m(l) != null ? +(m(w)! - m(l)!).toFixed(4) : null;
  };
  const days = (nowMs - since) / 86_400_000;
  return { version, n: rows.length, days: +days.toFixed(1), shadowDone: days >= RULES.learning.shadowDays, separationProposed: sep(prop), separationApplied: sep(cur.weightScales) };
}
/** Item 18: owner approval — only after the shadow week, and only if the proposal separates at least as well. */
export async function approveCalibration(sql: Sql, version: number, nowMs: number) {
  const sh = await shadowOf(sql, version, nowMs);
  if (!sh) return { ok: false, why: "no such version" };
  if (!sh.shadowDone) return { ok: false, why: `shadow ${sh.days}d < ${RULES.learning.shadowDays}d` };
  if (sh.separationProposed != null && sh.separationApplied != null && sh.separationProposed < sh.separationApplied) return { ok: false, why: "proposal separated winners/losers worse than the applied set in shadow", shadow: sh };
  await sql.query(`update desk_calibration set applied = true, note = note || ' · APPROVED' where version = $1`, [version]);
  return { ok: true, shadow: sh };
}

/** Reversible: mark a version reverted; the next-highest applied version (or baseline) takes over. */
export async function revertCalibration(sql: Sql, version: number) {
  await ensureLearning(sql);
  await sql.query(`update desk_calibration set reverted = true where version = $1`, [version]);
}

export async function learningReport(sql: Sql, nowMs: number, baseline: Record<string, number>) {
  await ensureLearning(sql);
  const applied = await appliedCalibration(sql);
  const versions = await sql.query(`select version, created_ms, applied, reverted, note from desk_calibration order by version desc limit 10`);
  const rows = await gradedRows(sql, nowMs);
  const lifts = factorLifts(rows.map(({ c, g }) => ({ present: c.present, win: isWin(g) })), applied.weightScales);
  const bands = bandEdgeMoves(rows.map(({ c, g }) => ({ band: c.band ?? "?", win: isWin(g), r: g.kind === "plan" ? g.r : null })), { ...baseline, ...applied.bandEdges }, baseline);
  const modes: Record<string, number> = {};
  for (const { c, g } of rows) { const m = failureMode(c, g); if (m) modes[m] = (modes[m] ?? 0) + 1; }
  const counts = await sql.query<{ status: string; n: string | number }>(`select status, count(*) as n from desk_card_snap s where ${snapNotVoided("s")} group by status`);
  const recent = await sql.query(`select id, band, q, q_raw, status, grade, failure_mode, hows, missed, source from desk_card_snap where opened_ms > $1 order by opened_ms desc limit 40`, [nowMs - 7 * 86_400_000]);
  const missed = await sql.query(`select id, missed from desk_card_snap where missed is not null order by opened_ms desc limit 20`);
  return {
    appliedVersion: applied.version, appliedAt: applied.createdMs, weightScales: applied.weightScales, bandEdges: { ...baseline, ...applied.bandEdges },
    versions, counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])), graded: rows.length,
    stats: statsReport(await allGraded(sql), nowMs, etDayKey),
    proposals: await Promise.all(((await sql.query<{ version: number }>(`select version from desk_calibration where not applied and not reverted and note like 'PROPOSED%' order by version desc limit 3`))).map((v) => shadowOf(sql, v.version, nowMs))),
    calibration: { minN: LEARN_MIN_N, maxStep: LEARN_MAX_STEP, shrinkK: LEARN_SHRINK_K, lifts, bands }, failureModes: modes, recent, missed,
  };
}
