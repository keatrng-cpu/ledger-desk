/**
 * SMT counts only where it happens — at a major level or a higher-timeframe
 * array.
 *
 * THE TRADER'S RULE (2026-10-02): SMT is a bias tool. It helps form the
 * timeframe bias; it carries real weight only when the divergence prints AT a
 * major level or array. An NQ lower low against an ES higher low in the
 * middle of nowhere says one index is a little stronger today, which the bias
 * read already knows. The same divergence at the prior day's low says the
 * level was raided on one index and defended on the other.
 *
 * Until 2026-10-02 the scanner credited ANY active divergence as the `smt`
 * component, and `smt` was also a standalone strategy (SMT + any array =
 * "complete"), so a mid-range divergence could title and grade a card on its
 * own ("ES long — SMT"). This module is the one definition of "at a level"
 * used by the scanner (live) and by scripts/build-hit-odds.mjs (four-year
 * measurement), so the score and its evidence cannot disagree on it.
 *
 * MAJOR LEVELS, from closed 15m bars only (no lookahead):
 *   PDH / PDL     prior CME trade date (rolls 18:00 ET)
 *   PWH / PWL     prior trade week (Monday-keyed)
 *   Asia H / L    today's 20:00–00:00 ET session, once it has ended
 *   London H / L  today's 02:00–05:00 ET session, once it has ended
 * HTF ARRAY: a 1h or 4h FVG / OB / breaker on the trade's side (smc-board).
 * "At" = within SMT_LEVEL_TOL_ATR × ATR of the level, or inside the array
 * widened by the same tolerance.
 */

import type { OhlcBar } from "@/lib/market/types";
import { etWallParts } from "./sessions";
import type { SmtDivergenceRead } from "./structure";
import type { SmcArray } from "./smc-board";
import { tradeDateOf } from "./tf-ladder";

export const SMT_LEVEL_TOL_ATR = 0.5;

export interface MajorLevel {
  name: string;
  price: number;
}

function weekKey(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}

/** Simple ATR(14) over closed bars — the fallback when the caller has none. */
export function atr14(bars: readonly OhlcBar[]): number | null {
  if (bars.length < 15) return null;
  let sum = 0;
  for (let i = bars.length - 14; i < bars.length; i++) {
    const b = bars[i]!;
    const pc = bars[i - 1]!.c;
    sum += Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  }
  return sum / 14;
}

/**
 * The named levels visible at the last bar of `bars`. Sessions count only
 * once they have ENDED — a London high that is still being made is not a
 * level yet.
 */
export function majorLevels(bars: readonly OhlcBar[]): MajorLevel[] {
  if (!bars.length) return [];
  const days: { date: string; week: string; h: number; l: number; start: number; end: number }[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    const td = tradeDateOf(b.t);
    const last = days[days.length - 1];
    if (!last || last.date !== td) days.push({ date: td, week: weekKey(td), h: b.h, l: b.l, start: i, end: i });
    else {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.end = i;
    }
  }
  const out: MajorLevel[] = [];
  const today = days[days.length - 1]!;
  const prev = days[days.length - 2];
  if (prev) {
    out.push({ name: "PDH", price: prev.h }, { name: "PDL", price: prev.l });
  }
  // Prior week: every complete day keyed to the week before today's.
  const priorWeekDays = days.filter((d) => d.week < today.week);
  if (priorWeekDays.length) {
    const wk = priorWeekDays[priorWeekDays.length - 1]!.week;
    const inWk = priorWeekDays.filter((d) => d.week === wk);
    out.push(
      { name: "PWH", price: Math.max(...inWk.map((d) => d.h)) },
      { name: "PWL", price: Math.min(...inWk.map((d) => d.l)) },
    );
  }
  // Today's sessions, by bar OPEN time in ET minutes.
  const asia = { h: -Infinity, l: Infinity, n: 0 };
  const london = { h: -Infinity, l: Infinity, n: 0 };
  let afterAsia = false;
  let afterLondon = false;
  for (let i = today.start; i <= today.end; i++) {
    const b = bars[i]!;
    const p = etWallParts(b.t);
    const m = p.hour * 60 + p.minute;
    if (m >= 20 * 60) {
      asia.h = Math.max(asia.h, b.h);
      asia.l = Math.min(asia.l, b.l);
      asia.n++;
    } else if (m < 18 * 60) {
      afterAsia = true;
      if (m >= 2 * 60 && m < 5 * 60) {
        london.h = Math.max(london.h, b.h);
        london.l = Math.min(london.l, b.l);
        london.n++;
      } else if (m >= 5 * 60) afterLondon = true;
    }
  }
  if (asia.n && afterAsia) out.push({ name: "Asia H", price: asia.h }, { name: "Asia L", price: asia.l });
  if (london.n && afterLondon) out.push({ name: "London H", price: london.h }, { name: "London L", price: london.l });
  return out.filter((l) => Number.isFinite(l.price));
}

export interface SmtLevelRead {
  /** An active swing divergence that points this trade's way. */
  present: boolean;
  /** ...and its extreme on THIS book sits at a major level or HTF array. */
  atLevel: boolean;
  /** What it was at, e.g. "PDL" or "1h fvg". */
  level: string | null;
  /** This book's extreme in the divergence (its swept or its held price). */
  extreme: number | null;
  timeframe: string | null;
  /**
   * ITEM 11 — did THIS book lead the divergence?
   *
   * True when this symbol made the new extreme (it is `d.leader`), false when
   * it is the laggard that held, null when there is no active divergence to
   * lead. `thisLed` has been computed below since the file was written and was
   * thrown away; the laggard is not a second setup on the same divergence, so
   * the optional SMT factor is now only earned by the leader (smc-canon.ts).
   *
   * null is NOT a refusal: no divergence read behaves exactly as it does today.
   */
  led: boolean | null;
}

const NONE: SmtLevelRead = {
  present: false,
  atLevel: false,
  level: null,
  extreme: null,
  timeframe: null,
  led: null,
};

/**
 * Read one book's side of a divergence. `isLeft` says whether this book is
 * the divergence's LEFT symbol: the leader made the new extreme (sweepPrice),
 * the other held (holdPrice).
 */
export function smtAtLevel(input: {
  divergence: SmtDivergenceRead | null | undefined;
  isLeft: boolean;
  side: "long" | "short";
  bars: readonly OhlcBar[];
  arrays?: readonly SmcArray[];
  atr?: number | null;
}): SmtLevelRead {
  const d = input.divergence;
  if (!d?.active || !d.kind || !d.leader) return NONE;
  const pointsLong = d.kind === "bullish";
  if (pointsLong !== (input.side === "long")) return NONE;
  const thisLed = d.leader === (input.isLeft ? "left" : "right");
  const extreme = thisLed ? (d.sweepPrice ?? null) : (d.holdPrice ?? null);
  const base = { present: true, extreme, timeframe: d.timeframe ?? null, led: thisLed };
  if (extreme == null || !Number.isFinite(extreme)) return { ...base, atLevel: false, level: null };
  const atr = input.atr != null && input.atr > 0 ? input.atr : atr14(input.bars);
  if (atr == null || !(atr > 0)) return { ...base, atLevel: false, level: null };
  const tol = SMT_LEVEL_TOL_ATR * atr;

  let best: { name: string; dist: number } | null = null;
  for (const lv of majorLevels(input.bars)) {
    const dist = Math.abs(extreme - lv.price);
    if (dist <= tol && (!best || dist < best.dist)) best = { name: lv.name, dist };
  }
  if (best) return { ...base, atLevel: true, level: best.name };

  const want = input.side === "long" ? "bull" : "bear";
  const arr = (input.arrays ?? []).find(
    (a) => (a.tf === "1h" || a.tf === "4h") && a.side === want && extreme >= a.bottom - tol && extreme <= a.top + tol,
  );
  if (arr) return { ...base, atLevel: true, level: `${arr.tf} ${arr.kind}` };
  return { ...base, atLevel: false, level: null };
}
