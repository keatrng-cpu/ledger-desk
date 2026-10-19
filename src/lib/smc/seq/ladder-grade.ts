/**
 * wire.deskSeq.ladderGrade — SHADOW / DISPLAY-ONLY measured probability + EV per ladder entry.
 *
 * The ladder (ladder.ts) already reads, from 2 years of 1h bars with no lookahead
 * (ladder-calibration.json), two calibrated rates on every candidate entry:
 *   pFill  — how often price actually traded back to this entry (entryFill tab);
 *   pWin   — how often T1 printed before the stop once filled (entryWin tab, by R bucket).
 * Until now those numbers were surfaced but never turned into a grade. This module
 * folds them into the one figure a 0DTE option trader should rank on:
 *
 *   pReachT1 = pFill · pWin                      (unconditional: will this card pay T1?)
 *   evR      = pWin · t1R − (1 − pWin) · 1       (R expectancy GIVEN a fill; lose = −1R)
 *
 * and a shadow band whose A+ cut is ANCHORED to the desk's own target win rate
 * (APLUS_RULES.profitPath.targetWinRate = 0.70), not an invented number. The A/A-/B+
 * cuts and the EV floor are documented shadow starting points for Accuracy Review to
 * tune against the live journal — they are NOT fitted here.
 *
 * SHADOW: nothing here is read by q, band, actionable, the brain word, the Floor
 * verdict, the rulesHash or a fire. It reads only ladder output + config; it never
 * reads or writes shared/desk-rules.json. Promotion into the live grade is an
 * Accuracy Review decision.
 */
import { APLUS_RULES } from "@/lib/aplus/config";
import type { LadderEntry, LadderSide, LadderBook } from "./ladder";

export type LadderBand = "A+" | "A" | "A-" | "B+" | "WATCH" | "STAND";
export type LadderWord = "GO" | "WATCH" | "STAND";

/**
 * Shadow cut points. A+ = the desk's published target win rate; the rest are
 * conservative, documented defaults (above a coin flip) for Accuracy Review to
 * calibrate. evFloorR keeps a GO positive-expectancy even when pWin clears a cut.
 */
export const LADDER_GRADE = {
  bandCuts: {
    "A+": APLUS_RULES.profitPath.targetWinRate, // 0.70, anchored to config
    A: 0.62,
    "A-": 0.55,
    "B+": 0.5,
  } as Record<"A+" | "A" | "A-" | "B+", number>,
  /** Minimum conditional expectancy (R) for a GO. Shadow default. */
  evFloorR: 0.1,
} as const;

export interface LadderGrade {
  kind: string;
  tf: string;
  entry: number;
  stop: number;
  t1R: number | null;
  /** P(price returns to the entry), from the entryFill calibration. */
  pFill: number | null;
  /** P(T1 before stop | filled), from the entryWin calibration. */
  pWinGivenFill: number | null;
  /** pFill · pWin — the unconditional chance the card pays T1. */
  pReachT1: number | null;
  /** pWin · t1R − (1 − pWin), conditional on a fill. R units. */
  evR: number | null;
  /** Calibration sample sizes behind the two rates (for honesty about n). */
  n: { fill: number; win: number };
  word: LadderWord;
  band: LadderBand;
  /** True when either rate came from a proxy bucket (not this exact setup). */
  proxy: boolean;
  why: string;
  shadow: true;
}

/** Band from the measured win rate, gated by a positive EV floor. */
export function bandFor(pWin: number | null, evR: number | null): LadderBand {
  if (pWin == null || evR == null) return "WATCH";
  if (evR < LADDER_GRADE.evFloorR) return pWin > 0 ? "WATCH" : "STAND";
  const cuts = LADDER_GRADE.bandCuts;
  if (pWin >= cuts["A+"]) return "A+";
  if (pWin >= cuts.A) return "A";
  if (pWin >= cuts["A-"]) return "A-";
  if (pWin >= cuts["B+"]) return "B+";
  return "WATCH";
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Grade one ladder entry from its already-calibrated pFill / pWin. */
export function gradeEntry(e: LadderEntry): LadderGrade {
  const pFill = e.pFill?.p ?? null;
  const pWin = e.pWin?.p ?? null;
  const t1R = e.t1R;
  const pReachT1 = pFill != null && pWin != null ? r3(pFill * pWin) : null;
  const evR = pWin != null && t1R != null ? r3(pWin * t1R - (1 - pWin)) : null;
  const band = bandFor(pWin, evR);
  // A card the plan already invalidated (price through the stop) can never be a GO.
  const word: LadderWord =
    !e.valid || band === "STAND"
      ? "STAND"
      : band === "WATCH"
        ? "WATCH"
        : "GO";
  const proxy = Boolean(e.pFill?.proxy || e.pWin?.proxy);
  const whyBits: string[] = [];
  if (pWin != null && t1R != null) whyBits.push(`pWin ${(pWin * 100).toFixed(0)}% × ${t1R}R ⇒ EV ${evR}R`);
  else whyBits.push(e.pWin?.note ?? "no calibrated win rate");
  if (pFill != null) whyBits.push(`fill ${(pFill * 100).toFixed(0)}%`);
  if (!e.valid) whyBits.push(`invalid: ${e.invalidWhy ?? "plan crossed"}`);
  if (proxy) whyBits.push("proxy calibration");
  return {
    kind: e.kind, tf: e.tf, entry: e.entry, stop: e.stop, t1R,
    pFill, pWinGivenFill: pWin, pReachT1, evR,
    n: { fill: e.pFill?.n ?? 0, win: e.pWin?.n ?? 0 },
    word, band, proxy, why: whyBits.join(" · "), shadow: true,
  };
}

/** Grade a side's entries, ranked by EV then fill (nulls last). `best` is the top GO/WATCH. */
export function gradeSide(s: LadderSide): { best: LadderGrade | null; graded: LadderGrade[] } {
  const graded = s.entries.map(gradeEntry).sort((a, b) => {
    const ea = a.evR ?? -Infinity, eb = b.evR ?? -Infinity;
    if (ea !== eb) return eb - ea;
    return (b.pFill ?? -1) - (a.pFill ?? -1);
  });
  const best = graded.find((g) => g.word === "GO") ?? graded.find((g) => g.word === "WATCH") ?? null;
  return { best, graded };
}

export interface LadderBookGrade {
  symbol: string;
  long: { best: LadderGrade | null; graded: LadderGrade[] };
  short: { best: LadderGrade | null; graded: LadderGrade[] };
  /** The single best measured card across both sides (highest EV GO), or null. */
  best: LadderGrade | null;
  shadow: true;
}

/** Grade a whole ladder book (both sides). Shadow. */
export function gradeBook(b: LadderBook): LadderBookGrade {
  const long = gradeSide(b.bull);
  const short = gradeSide(b.bear);
  const gos = [long.best, short.best].filter((g): g is LadderGrade => g != null && g.word === "GO");
  const best = gos.sort((a, z) => (z.evR ?? -Infinity) - (a.evR ?? -Infinity))[0] ?? null;
  return { symbol: b.symbol, long, short, best, shadow: true };
}
