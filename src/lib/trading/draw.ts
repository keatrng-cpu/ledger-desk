/**
 * Draw on liquidity — WHICH level is price actually going to?
 *
 * Session high/low is ONE class of liquidity — not the whole map.
 * External SSL/BSL (PDH/PDL, PWH/PWL, swings outside dealing range) and
 * internal EQH/EQL clusters are the primary magnets.
 */

import type { OhlcBar } from "@/lib/market/types";
import { etSessionKey, type Bias, type HtfBiasRead } from "./structure";

export const MIN_SESSIONS_FOR_BASE_RATE = 4;

export type DrawSide = "above" | "below";

export interface LiquidityTarget {
  name: string;
  price: number;
  kind: string;
  side: DrawSide;
  distancePoints: number;
  distanceAtr: number;
  liquidityWeight: number;
  swept: boolean;
  reachProbability: number;
  score: number;
  why: string[];
}

export interface DrawRead {
  symbol: string;
  primary: LiquidityTarget | null;
  above: LiquidityTarget | null;
  below: LiquidityTarget | null;
  alternates: LiquidityTarget[];
  atr: number;
  medianSessionRange: number;
  sessionRangeUsedPct: number;
  sessionsSampled: number;
  baseRateReliable: boolean;
  note: string;
}

export interface SessionSlice {
  key: string;
  bars: OhlcBar[];
}

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

export function remainingExcursions(
  sessions: SessionSlice[],
  elapsedFraction: number,
): { up: number[]; down: number[] } {
  const up: number[] = [];
  const down: number[] = [];
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

export function empiricalReachRate(samples: number[], distance: number): number {
  if (!samples.length) return 0;
  if (distance <= 0) return 1;
  return samples.filter((s) => s >= distance).length / samples.length;
}

const KIND_WEIGHT: Record<string, number> = {
  weekly: 0.95,
  prior: 0.9,
  external: 0.92,
  pool: 0.85,
  session: 0.55,
  range: 0.5,
  open: 0.35,
};

function poolTouchBoost(label: string): number {
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
    const isSession = /session/i.test(pool.label);
    const kind = isSession
      ? "session"
      : pool.scope === "external"
        ? "external"
        : "pool";
    const scale =
      kind === "pool"
        ? poolTouchBoost(pool.label)
        : kind === "external"
          ? Math.min(1.15, 0.9 + pool.strength * 0.04)
          : 1;
    push(pool.label, pool.price, kind, pool.swept, scale);
  }
  return out;
}

export function mergeCoincident(levels: RawLevel[], atr: number): RawLevel[] {
  if (!levels.length) return [];
  const tol = Math.max(atr * 0.08, 0.25);
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const out: RawLevel[] = [];
  let group: RawLevel[] = [sorted[0]!];

  const flush = () => {
    if (group.length === 1) {
      out.push(group[0]!);
      return;
    }
    const ranked = [...group].sort((a, b) => b.weight - a.weight);
    const lead = ranked[0]!;
    const extras = ranked.slice(1).map((g) => g.name);
    const confluenceBoost = Math.min(1, 1 + 0.12 * extras.length);
    out.push({
      name: `${lead.name} +${extras.length}`,
      price: group.reduce((a, g) => a + g.price, 0) / group.length,
      kind: lead.kind,
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

function biasAlignment(side: DrawSide, bias: Bias): number {
  if (bias === "neutral") return 0.85;
  if (bias === "bull") return side === "above" ? 1 : 0.6;
  return side === "below" ? 1 : 0.6;
}

export function drawOnLiquidity(read: HtfBiasRead, bars: OhlcBar[]): DrawRead {
  const atr = atrOf(bars, 14);
  const sessions = groupSessions(bars);
  const current = sessions[sessions.length - 1];
  const priorSessions = sessions.slice(0, -1);

  const elapsed =
    current && current.bars.length
      ? Math.min(
          0.95,
          current.bars.length /
            Math.max(
              current.bars.length,
              median(priorSessions.map((s) => s.bars.length)) ||
                current.bars.length,
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

  for (const lvl of mergeCoincident(candidateLevels(read), atr)) {
    const distancePoints = Math.abs(lvl.price - last);
    if (distancePoints < atr * 0.1) continue;
    const side: DrawSide = lvl.price > last ? "above" : "below";
    const distanceAtr = atr > 0 ? distancePoints / atr : 0;
    const samples = side === "above" ? up : down;
    const reachProbability = empiricalReachRate(samples, distancePoints);
    const align = biasAlignment(side, read.topDown);
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
    if (lvl.kind === "pool") why.push("internal equal-high/low stop cluster");
    if (lvl.kind === "external") why.push("external SSL/BSL beyond dealing range");
    if (lvl.kind === "weekly") why.push("prior-week extreme — widest audience");
    if (lvl.kind === "prior") why.push("prior-session extreme (external)");
    if (lvl.kind === "session") why.push("session extreme — not the only liquidity");
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
    ? `${read.symbol}: likely draw is ${primary.name} @ ${primary.price.toFixed(2)} (${primary.side}, ${(primary.reachProbability * 100).toFixed(0)}% base rate, ${primary.distanceAtr.toFixed(2)} ATR).`
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
