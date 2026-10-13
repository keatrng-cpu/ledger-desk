/** Card-read glue for the learning loop: apply the calibration, snapshot, grade, calibrate weekly. */
import type { Sql } from "@/lib/db";
import type { DeskPayload } from "@/lib/trading/build-desk";
import type { DeskListenCard } from "@/lib/trading/desk-listen";
import { applyWeightScales } from "@/lib/trading/engine-weights";
import { setKillBoostScale } from "@/lib/trading/config";
import { BAND_EDGES_BASE, setBandEdges } from "@/lib/smc/discipline";
import { atr15Of } from "@/lib/smc/mtf-arrays";
import * as L from "./learning";
import backfill from "./learning-backfill-2026-10-13.json";

let appliedAt = 0;
let appliedVersion = 0;
const APPLY_TTL_MS = 60_000;

/** Load the applied calibration (cached 60s) into the live weights/edges. Baseline on any failure. */
export async function applyCalibration(sql: Sql, nowMs: number): Promise<number> {
  if (nowMs - appliedAt < APPLY_TTL_MS) return appliedVersion;
  appliedAt = nowMs;
  try {
    const a = await L.appliedCalibration(sql);
    applyWeightScales(a.weightScales as never);
    setKillBoostScale((a.weightScales as Record<string, number>).killBoost ?? null);
    setBandEdges(a.bandEdges as never);
    appliedVersion = a.version;
  } catch (err) {
    console.error("[learning] calibration load failed — baseline:", err);
    applyWeightScales(null); setBandEdges(null); setKillBoostScale(null); appliedVersion = 0;
  }
  return appliedVersion;
}

let seeded = false;
async function seedBackfill(sql: Sql) {
  if (seeded) return;
  seeded = true;
  const rows = (backfill as { rows: (L.SnapCard & { openedMs: number; grade: L.Grade | null })[] }).rows;
  for (const r of rows) {
    await L.snapshotCards(sql, [r], r.openedMs, "backfill");
    if (r.grade && r.grade.status !== "open") {
      const id = `${new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(r.openedMs))}:${r.symbol}:${r.side}:${r.setup}`;
      await sql.query(`update desk_card_snap set status = $2, grade = $3::jsonb, failure_mode = $4, hows = $5, missed = $6, graded_ms = $7 where id = $1 and status = 'open'`,
        [id, r.grade.status, JSON.stringify(r.grade), L.failureMode(r, r.grade), L.howsWhys(r, r.grade), L.missedTrade(r, r.grade), r.openedMs]);
    }
  }
}

export function snapCardsOf(desk: DeskPayload, card: DeskListenCard): L.SnapCard[] {
  const w = card.wire;
  const atrL = atr15Of(desk.left.bars ?? null);
  const atrR = atr15Of(desk.right.bars ?? null);
  return desk.scan.candidates.map((c) => {
    const isL = c.symbol === desk.left.symbol;
    const book = desk.mtfContext?.books.find((b) => b.symbol === c.symbol);
    const top = w.strategy && w.strategy.symbol === c.symbol && w.strategy.side === c.side;
    const plan = c.plan as { entry?: number; stop?: number; t1?: number | null } | null | undefined;
    const x = c as unknown as Record<string, unknown>;
    return {
      symbol: c.symbol, side: c.side as "long" | "short",
      setup: `${c.strategyPrimary || "none"}/${(x.regimeLabel as string) ?? c.setupRegime ?? "?"}`,
      band: c.pathBand ?? null, q: c.confluence, qRaw: (x.qRaw as number) ?? null,
      price: (isL ? desk.quotes.left : desk.quotes.right)?.price ?? null, atr: isL ? atrL : atrR,
      entry: plan?.entry ?? c.entryPx ?? null, stop: plan?.stop ?? null, target: plan?.t1 ?? null,
      // "killBoost" is a learnable factor: its scale recalibrates TUNABLES.killBoost (n ≥ 30).
      present: [...(c.components ?? []), ...(((x.setups as string[]) ?? []).map((s) => `setup:${s.split(" ")[0]}`)), ...(x.killBoosted ? ["killBoost"] : [])],
      missing: c.missing ?? [],
      checklist: top && w.master ? w.master.checks.map((k) => ({ name: k.name, ok: k.ok })) : [
        { name: "actionable", ok: c.actionable }, { name: "killzone", ok: c.killzoneOk }, { name: "HTF ok", ok: c.htfOk },
        { name: "conditions", ok: c.conditionsOk }, { name: "not chop", ok: !c.chop }, { name: "no LTF kill", ok: !x.ltfKilled },
      ],
      ctx: {
        regime: x.regimeLabel ?? null, chop: c.chop ?? null, legs: x.legs ?? null, setups: x.setups ?? [], entryResting: c.entryResting ?? null,
        displacement: (x.dispStrength as { score?: number } | undefined)?.score ?? null, ltfKilled: x.ltfKilled ?? null, htfReleased: c.htfDisrespected ?? false,
        bias1h: top ? w.strategy!.bias1h : null, bias4h: top ? w.strategy!.bias4h : null,
        mtf: book ? { align: book.align[c.side as "long" | "short"], rungs: book.rungs.map((r) => ({ tf: r.tf, bias: r.bias, structure: r.structure, sweep: r.sweep })) } : null,
        smt: desk.mtfContext ? { lead: desk.mtfContext.smtLead, vote: desk.mtfContext.smtVote } : null,
        smtOpposes: desk.mtfContext?.smtLead ? (desk.mtfContext.smtLead.kind === "bullish") !== (c.side === "long") : null,
        draws: (desk.rankedDraws?.[isL ? "left" : "right"] ?? []).slice(0, 4),
        brain: w.brain ? { word: w.brain.word, book: w.brain.book } : null,
        floor: w.floor ? { verdict: w.floor.verdict, blocks: w.floor.blocks } : null,
        master: top ? w.master?.verdict ?? null : null,
        reasons: c.reasons.slice(-12),
        capReasons: c.reasons.filter((r) => /cap|chop|kill|HTF|veto|skip|Discipline|R[1-9]/i.test(r)).slice(-6),
      },
    };
  });
}

/** One card read: seed, snapshot, grade, weekly calibrate. Never throws. */
export async function learnOnRead(sql: Sql, desk: DeskPayload, card: DeskListenCard, nowMs: number): Promise<void> {
  try {
    await seedBackfill(sql);
    await L.snapshotCards(sql, snapCardsOf(desk, card), nowMs);
    await L.gradeSnapshots(sql, { [desk.left.symbol]: desk.mtf.left.minute, [desk.right.symbol]: desk.mtf.right.minute }, nowMs);
    const v = await L.maybeCalibrate(sql, nowMs, { ...BAND_EDGES_BASE });
    if (v?.changed) appliedAt = 0;
  } catch (err) {
    console.error("[learning] read pass failed:", err);
  }
}
