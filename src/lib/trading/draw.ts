/**
 * Draw on liquidity — WHICH level is price actually going to?
 *
 * The scanner used to emit generic targets ("EQ", "PDH", "external pool")
 * read straight off current price action. That answers "what levels exist",
 * not "which one is the magnet", and those are different questions: a pool
 * 4 ATR away with one touch is not the same target as a triple-equal-high
 * 0.8 ATR away with an hour of session left.
 *
 * This module answers the second question by combining:
 *
 *   PAST DATA (empirical, from the bar history itself — not assumed):
 *     - Typical session range for this instrument, by session (18:00 ET roll).
 *     - The distribution of REMAINING favorable excursion from this point in
 *       the session to its close, measured across every prior session in the
 *       window. That yields a real base rate: "from 11:40 ET, price travelled
 *       at least 0.9 ATR further up in 62% of past sessions."
 *
 *   CURRENT DATA:
 *     - Distance to each candidate level, normalized in ATR.
 *     - Liquidity magnitude — how many stops plausibly rest there (equal-high
 *       cluster count, level class, whether it is already swept).
 *     - HTF bias alignment (the absolute gate — a draw against HTF is
 *       downgraded, never promoted).
 *     - How much of a typical session's range is already spent.
 *
 * Everything is deterministic TypeScript math (CLAUDE.md: structure is
 * deterministic; the LLM narrates, it never scores).
 */

import type { OhlcBar } from "@/lib/market/types";
import { etSessionKey, type Bias, type HtfBiasRead } from "./structure";

/** Minimum prior sessions before an empirical base rate is trustworthy. */
export const MIN_SESSIONS_FOR_BASE_RATE = 4;

export type DrawSide = "above" | "below";

export interface LiquidityTarget {
  name: string;
  price: number;
  /** prior | weekly | pool | range | open | session */
  kind: string;
  side: DrawSide;
  distancePoints: number;
  /** Distance normalized by ATR — the only cross-instrument comparable unit. */
  distanceAtr: number;
  /** 0-1 proxy for resting stop volume (cluster size + level class). */
  liquidityWeight: number;
  /** Already traded through — the stops there are gone. */
  swept: boolean;
  /** Empirical P(price travels at least this far, from this time of session). */
  reachProbability: number;
  /** Composite rank. Higher = more likely to be THE draw. */
  score: number;
  why: string[];
}

export interface DrawRead {
  symbol: string;
  /** Most likely magnet overall (either direction). */
  primary: LiquidityTarget | null;
  /** Best draw above and below — the two-sided picture. */
  above: LiquidityTarget | null;
  below: LiquidityTarget | null;
  alternates: LiquidityTarget[];
  atr: number;
  /** Median session range (points) across the sampled sessions. */
  medianSessionRange: number;
  /** How much of a typical session's range this session has already covered. */
  sessionRangeUsedPct: number;
  /** Sessions available for the base rate. Below MIN_ → probabilities are weak. */
  sessionsSampled: number;
  baseRateReliable: boolean;
  note: string;
}

/* ------------------------------------------------------------------ */
/* Session statistics from past bars                                   */
/* ------------------------------------------------------------------ */

export interface SessionSlice {
  key: string;
  bars: OhlcBar[];
}

/** Group bars into CME sessions (18:00 ET roll) — same boundary as structure.ts. */
export function groupSessions(bars: OhlcBar[]): SessionSlice[] {
  const map = new Map<string, OhlcBar[]>();
  for (const b of bars) {
    const k = etSessionKey(b.t);
    const arr = map.get(k) ?? [];
    arr.push(b);
    map.set(k, arr);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => ({ key, bars: list }));
}

/** Average true range over the last `period` bars (excluding gaps). */
export function atrOf(bars: OhlcBar[], period = 14): number {
  if (bars.length < 2) return 0;
  const slice = bars.slice(-Math.min(bars.length, period + 1));
  let sum = 0;
  let n = 0;
  for (let i = 1; i < slice.length; i++) {
    const cur = slice[i]!;
    const prev = slice[i - 1]!;
    const tr = Math.max(
      cur.h - cur.l,
      Math.abs(cur.h - prev.c),
      Math.abs(cur.l - prev.c),
    );
    sum += tr;
    n++;
  }
  return n ? sum / n : 0;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Empirical remaining-excursion samples.
 *
 * For every COMPLETED prior session, find the bar at (roughly) the same
 * elapsed position as now, then measure how much further price travelled up
 * and down between there and the session close. That is the honest base rate
 * for "can it still reach a level X points away today" — measured, not
 * assumed from a formula.
 */
export function remainingExcursions(
  sessions: SessionSlice[],
  elapsedFraction: number,
): { up: number[]; down: number[] } {
  const up: number[] = [];
  const down: number[] = [];
  // Drop the last session: it is the in-progress one, so its "remaining"
  // excursion is truncated by now, not by the session end — including it
  // would bias every probability downward.
  for (const s of sessions.slice(0, -1)) {
    if (s.bars.length < 6) continue;
    const idx = Math.min(
      s.bars.length - 2,
      Math.max(0, Math.floor(s.bars.length * elapsedFraction)),
    );
    const ref = s.bars[idx]!.c;
    let maxH = -Infinity;
    let minL = Infinity;
    for (let i = idx + 1; i < s.bars.length; i++) {
      maxH = Math.max(maxH, s.bars[i]!.h);
      minL = Math.min(minL, s.bars[i]!.l);
    }
    if (Number.isFinite(maxH)) up.push(Math.max(0, maxH - ref));
    if (Number.isFinite(minL)) down.push(Math.max(0, ref - minL));
  }
  return { up, down };
}

/** Fraction of samples that travelled at least `distance`. */
export function empiricalReachRate(samples: number[], distance: number): number {
  if (!samples.length) return 0;
  if (distance <= 0) return 1;
  const hits = samples.filter((s) => s >= distance).length;
  return hits / samples.length;
}

/* ------------------------------------------------------------------ */
/* Candidate levels                                                    */
/* ------------------------------------------------------------------ */

/**
 * Liquidity weight by level class — a proxy for how many stops rest there.
 * Equal highs/lows are where retail stops cluster, so a multi-touch pool
 * outranks a single structural print. Prior-day and prior-week extremes are
 * the reference levels the most participants watch.
 */
const KIND_WEIGHT: Record<string, number> = {
  weekly: 0.95, // PWH/PWL — widest audience
  prior: 0.9, // PDH/PDL
  pool: 0.85, // EQH/EQL clusters (scaled further by touch count)
  session: 0.6, // session high/low
  range: 0.45, // dealing-range extremes / EQ
  open: 0.35, // midnight / 8:30 / 9:30 opens — magnets, but thin stops
};

function poolTouchBoost(label: string): number {
  // "EQH ×3" -> 3 touches. More equal touches = more stops stacked.
  const m = /×(\d+)/.exec(label);
  const touches = m ? Number(m[1]) : 2;
  return Math.min(1, 0.7 + (touches - 2) * 0.12);
}

export interface RawLevel {
  name: string;
  price: number;
  kind: string;
  swept: boolean;
  weight: number;
}

/** Every level worth considering as a draw, from the structure read. */
export function candidateLevels(read: HtfBiasRead): RawLevel[] {
  const out: RawLevel[] = [];
  const push = (
    name: string,
    price: number | null | undefined,
    kind: string,
    swept = false,
    weightScale = 1,
  ) => {
    if (price == null || !Number.isFinite(price)) return;
    out.push({
      name,
      price,
      kind,
      swept,
      weight: (KIND_WEIGHT[kind] ?? 0.4) * weightScale,
    });
  };

  push("PDH", read.pdh, "prior");
  push("PDL", read.pdl, "prior");
  push("PWH", read.pwh, "weekly");
  push("PWL", read.pwl, "weekly");
  push("Midnight open", read.midnightOpen, "open");
  push("NY 8:30 open", read.nyOpen830, "open");
  push("NY 9:30 open", read.nyOpen930, "open");
  if (read.dealing) {
    push("Range high", read.dealing.high, "range");
    push("Range low", read.dealing.low, "range");
    push("EQ", read.dealing.eq, "range");
  }
  for (const pool of read.liquidity) {
    const kind = pool.label.startsWith("Session") ? "session" : "pool";
    push(
      pool.label,
      pool.price,
      kind,
      pool.swept,
      kind === "pool" ? poolTouchBoost(pool.label) : 1,
    );
  }
  return out;
}

/**
 * Collapse levels sitting within a tolerance of each other into a single
 * magnet. The merged level keeps the strongest class's weight plus a
 * confluence bonus per extra level stacked there — PDL AND session low AND
 * range low on one price is a materially heavier draw than a lone range low.
 *
 * Tolerance is ATR-scaled so it works across MNQ (~35pt ATR) and ES (~9pt).
 */
export function mergeCoincident(levels: RawLevel[], atr: number): RawLevel[] {
  if (!levels.length) return [];
  const tol = Math.max(atr * 0.08, 0.25); // never tighter than one tick
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const out: RawLevel[] = [];
  let group: RawLevel[] = [sorted[0]!];

  const flush = () => {
    if (group.length === 1) {
      out.push(group[0]!);
      return;
    }
    // Strongest member leads the name; the rest are listed as confluence.
    const ranked = [...group].sort((a, b) => b.weight - a.weight);
    const lead = ranked[0]!;
    const extras = ranked.slice(1).map((g) => g.name);
    const confluenceBoost = Math.min(1, 1 + 0.12 * extras.length);
    out.push({
      name: `${lead.name} +${extras.length}`,
      price: group.reduce((a, g) => a + g.price, 0) / group.length,
      kind: lead.kind,
      // Swept only if EVERY level there has been taken — one untouched level
      // in the stack means resting liquidity remains.
      swept: group.every((g) => g.swept),
      weight: Math.min(1, lead.weight * confluenceBoost),
    });
  };

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    if (Math.abs(cur.price - group[group.length - 1]!.price) <= tol) {
      group.push(cur);
    } else {
      flush();
      group = [cur];
    }
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------ */
/* The draw read                                                       */
/* ------------------------------------------------------------------ */

function biasAlignment(side: DrawSide, bias: Bias): number {
  if (bias === "neutral") return 0.85;
  if (bias === "bull") return side === "above" ? 1 : 0.6;
  return side === "below" ? 1 : 0.6;
}

/**
 * Rank the liquidity levels price is most likely drawn to.
 *
 * @param read  structure read for the symbol (levels + HTF bias)
 * @param bars  full bar history (past sessions drive the base rates)
 */
export function drawOnLiquidity(read: HtfBiasRead, bars: OhlcBar[]): DrawRead {
  const atr = atrOf(bars, 14);
  const sessions = groupSessions(bars);
  const current = sessions[sessions.length - 1];
  const priorSessions = sessions.slice(0, -1);

  // Where are we in the session? Drives which base-rate slice applies.
  const elapsed =
    current && current.bars.length
      ? Math.min(
          0.95,
          current.bars.length /
            Math.max(
              current.bars.length,
              median(priorSessions.map((s) => s.bars.length)) || current.bars.length,
            ),
        )
      : 0.5;

  const { up, down } = remainingExcursions(sessions, elapsed);
  const sessionsSampled = Math.min(up.length, down.length);
  const baseRateReliable = sessionsSampled >= MIN_SESSIONS_FOR_BASE_RATE;

  const ranges = priorSessions
    .filter((s) => s.bars.length >= 6)
    .map((s) => {
      let hi = -Infinity;
      let lo = Infinity;
      for (const b of s.bars) {
        hi = Math.max(hi, b.h);
        lo = Math.min(lo, b.l);
      }
      return hi - lo;
    })
    .filter((r) => Number.isFinite(r) && r > 0);
  const medianSessionRange = median(ranges);

  let usedPct = 0;
  if (current && medianSessionRange > 0) {
    let hi = -Infinity;
    let lo = Infinity;
    for (const b of current.bars) {
      hi = Math.max(hi, b.h);
      lo = Math.min(lo, b.l);
    }
    if (Number.isFinite(hi) && Number.isFinite(lo)) {
      usedPct = (hi - lo) / medianSessionRange;
    }
  }

  const last = read.last;
  const targets: LiquidityTarget[] = [];

  // Levels that sit at (nearly) the same price are ONE magnet, not three.
  // Real data routinely stacks PDL + session low + range low on the same
  // print; listing them separately both spams the card and hides the fact
  // that a confluence of level types is a STRONGER draw than any one alone.
  for (const lvl of mergeCoincident(candidateLevels(read), atr)) {
    const distancePoints = Math.abs(lvl.price - last);
    // Skip levels essentially at price — they are not a draw, they're here.
    if (distancePoints < atr * 0.1) continue;
    const side: DrawSide = lvl.price > last ? "above" : "below";
    const distanceAtr = atr > 0 ? distancePoints / atr : 0;
    const samples = side === "above" ? up : down;
    const reachProbability = empiricalReachRate(samples, distancePoints);

    const align = biasAlignment(side, read.topDown);
    // A swept pool has already had its stops taken — much weaker magnet.
    const sweptFactor = lvl.swept ? 0.4 : 1;

    const score =
      reachProbability * 0.5 +
      lvl.weight * sweptFactor * 0.3 +
      align * 0.2;

    const why: string[] = [];
    why.push(
      baseRateReliable
        ? `${(reachProbability * 100).toFixed(0)}% of the last ${samples.length} sessions travelled ${distancePoints.toFixed(2)}+ pts further from here`
        : `base rate weak (${samples.length} prior sessions)`,
    );
    why.push(`${distanceAtr.toFixed(2)} ATR away`);
    if (lvl.kind === "pool") why.push("equal-high/low stop cluster");
    if (lvl.kind === "weekly") why.push("prior-week extreme — widest audience");
    if (lvl.kind === "prior") why.push("prior-session extreme");
    if (lvl.swept) why.push("already swept — stops likely gone");
    if (read.topDown !== "neutral") {
      why.push(
        align >= 1
          ? `with HTF ${read.topDown}`
          : `against HTF ${read.topDown} — downgraded`,
      );
    }

    targets.push({
      name: lvl.name,
      price: lvl.price,
      kind: lvl.kind,
      side,
      distancePoints: round2(distancePoints),
      distanceAtr: round2(distanceAtr),
      liquidityWeight: round2(lvl.weight * sweptFactor),
      swept: lvl.swept,
      reachProbability: round2(reachProbability),
      score: round2(score),
      why,
    });
  }

  targets.sort((a, b) => b.score - a.score);
  const above = targets.find((t) => t.side === "above") ?? null;
  const below = targets.find((t) => t.side === "below") ?? null;
  const primary = targets[0] ?? null;

  const note = primary
    ? `${read.symbol}: likely draw is ${primary.name} @ ${primary.price.toFixed(2)} (${primary.side}, ${(primary.reachProbability * 100).toFixed(0)}% base rate, ${primary.distanceAtr.toFixed(2)} ATR).${
        baseRateReliable
          ? ""
          : ` Base rate from only ${sessionsSampled} sessions — treat as weak.`
      }${
        usedPct > 1
          ? ` Session has already covered ${(usedPct * 100).toFixed(0)}% of a typical range — expansion beyond here is less common.`
          : ""
      }`
    : `${read.symbol}: no level far enough from price to be a draw.`;

  return {
    symbol: read.symbol,
    primary,
    above,
    below,
    alternates: targets.slice(1, 6),
    atr: round2(atr),
    medianSessionRange: round2(medianSessionRange),
    sessionRangeUsedPct: round2(usedPct),
    sessionsSampled,
    baseRateReliable,
    note,
  };
}

/**
 * Targets for one side of a trade, ordered nearest-first — what the scanner
 * should actually show instead of generic level names. Only levels in the
 * trade's favor, and only ones price can plausibly still reach today.
 */
export function drawTargetsForSide(
  draw: DrawRead,
  side: "long" | "short",
): LiquidityTarget[] {
  const want: DrawSide = side === "long" ? "above" : "below";
  const all = [draw.primary, ...draw.alternates].filter(
    (t): t is LiquidityTarget => !!t && t.side === want,
  );
  const seen = new Set<string>();
  return all
    .filter((t) => {
      const k = `${t.name}@${t.price}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.distancePoints - b.distancePoints);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
