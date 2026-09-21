/**
 * Discretion memory — what the shadow book has learned about the gates.
 *
 * WHAT IT ANSWERS
 * For each refusing layer ("POI in correct half", "Liquidity sweep", …):
 * when the desk refused a PATH-grade card on that layer, what did the card
 * go on to do? Two answers per layer — the chase (the trade the desk says
 * never to take) and the limit (the desk's own plan, had it been allowed) —
 * each with n, win rate, expectancy and the dollar total at paper sizing.
 * From those, one verdict per layer:
 *
 *   gate earning its keep — chasing the refusals loses money (exp ≤ −0.15R,
 *                           n ≥ MIN_VERDICT_N). The layer is doing its job.
 *   gate costing money    — the refusals would have paid (exp ≥ +0.25R,
 *                           n ≥ MIN_VERDICT_N). The layer is the one to
 *                           sweep next (scripts/sweep-gates.mjs), not to
 *                           delete: this is evidence, not permission.
 *   neutral               — n is there and the chase sits between the two
 *                           thresholds: refusing costs nothing, chasing pays
 *                           nothing. The gate is free to keep.
 *   too early             — below the sample floor. The honest state for
 *                           the first weeks.
 *
 * THE LITTLE THINGS
 * Every shadow carries the context tags shadow-book.ts stamped at the
 * moment of refusal. `featureLifts` slices the chase outcomes by every tag
 * value and reports the ones whose expectancy departs most from the
 * baseline with a sample behind them — "refusals with SMT present paid
 * +0.6R vs −0.2R without", "10:30–11:00 refusals lost". Those are the
 * patterns a trader develops by feel over years; here they are counted.
 *
 * WHAT IT NEVER DOES
 * It never changes a gate, a size or a grade. It informs the Trade Now
 * evidence line, the veteran brain and the handoff; the trader and the
 * sweep decide. Pure, deterministic, no I/O — same discipline as
 * analytics.ts.
 */

import type { ShadowTrade } from "./shadow-book";

/** Decided shadows (won/lost/scratch) a layer needs before a verdict. */
export const MIN_VERDICT_N = 8;
/** Decided shadows a feature value needs before it is reported as a lift. */
export const MIN_FEATURE_N = 6;
/** Expectancy thresholds for the two verdicts, in R per decided shadow. */
export const GATE_RIGHT_EXP = -0.15;
export const GATE_COST_EXP = 0.25;

export interface Bucket {
  n: number;
  wins: number;
  losses: number;
  scratch: number;
  unfilled: number;
  open: number;
  sumR: number;
  sumPnl: number;
}

export interface LegScore extends Bucket {
  /** wins / decided. Null below n=1. */
  wr: number | null;
  /** sumR / decided. Null below n=1. */
  exp: number | null;
}

export type GateVerdict = "earning" | "costing" | "neutral" | "early";

export interface ReasonScore {
  reasonId: string;
  reason: string;
  chase: LegScore;
  limit: LegScore;
  verdict: GateVerdict;
  /** One line for the Trade Now board. */
  line: string;
}

export interface FeatureLift {
  tag: string;
  value: string;
  n: number;
  exp: number;
  /** exp − baseline exp, in R. */
  lift: number;
  wr: number;
}

export interface Scorecard {
  total: { chase: LegScore; limit: LegScore };
  byReason: ReasonScore[];
  lifts: FeatureLift[];
  /** Live and replay counted separately, so the trader can see the split. */
  live: number;
  replay: number;
  /** The layer whose refusals cost the most, if any — the next sweep. */
  sweepNext: ReasonScore | null;
}

const emptyBucket = (): Bucket => ({ n: 0, wins: 0, losses: 0, scratch: 0, unfilled: 0, open: 0, sumR: 0, sumPnl: 0 });

function add(b: Bucket, s: ShadowTrade): void {
  b.n++;
  if (s.status === "won") b.wins++;
  else if (s.status === "lost") b.losses++;
  else if (s.status === "scratch") b.scratch++;
  else if (s.status === "unfilled" || s.status === "expired") b.unfilled++;
  else b.open++;
  if (s.r != null && isDecided(s)) b.sumR += s.r;
  if (s.pnl != null && isDecided(s)) b.sumPnl += s.pnl;
}

export function isDecided(s: ShadowTrade): boolean {
  return s.status === "won" || s.status === "lost" || s.status === "scratch";
}

function score(b: Bucket): LegScore {
  const decided = b.wins + b.losses + b.scratch;
  return {
    ...b,
    wr: decided ? b.wins / decided : null,
    exp: decided ? b.sumR / decided : null,
  };
}

function decidedN(l: LegScore): number {
  return l.wins + l.losses + l.scratch;
}

export function fmtR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

export function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−" : n > 0 ? "+" : "";
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
}

function verdictFor(chase: LegScore): GateVerdict {
  if (decidedN(chase) < MIN_VERDICT_N || chase.exp == null) return "early";
  if (chase.exp <= GATE_RIGHT_EXP) return "earning";
  if (chase.exp >= GATE_COST_EXP) return "costing";
  return "neutral";
}

function legLine(l: LegScore): string {
  const d = decidedN(l);
  if (!d) return l.unfilled ? `${l.unfilled} unfilled` : "n=0";
  return `n=${d} · WR ${((l.wr ?? 0) * 100).toFixed(0)}% · ${fmtR(l.exp)}/t · ${fmtUsd(l.sumPnl)}${l.unfilled ? ` · ${l.unfilled} unfilled` : ""}`;
}

export function reasonLine(r: ReasonScore): string {
  const head =
    r.verdict === "earning"
      ? "gate earning its keep"
      : r.verdict === "costing"
        ? "gate costing money — sweep it"
        : r.verdict === "neutral"
          ? "no edge either way — chasing these does not pay, refusing them costs nothing"
          : `too early (${decidedN(r.chase)}/${MIN_VERDICT_N} chased)`;
  return `${r.reason}: ${head} · chase ${legLine(r.chase)} · limit ${legLine(r.limit)}`;
}

/** The whole scorecard from a set of shadows (live + replay). */
export function buildScorecard(shadows: ShadowTrade[]): Scorecard {
  const totalChase = emptyBucket();
  const totalLimit = emptyBucket();
  const byReason = new Map<string, { reason: string; chase: Bucket; limit: Bucket }>();
  let live = 0;
  let replay = 0;
  for (const s of shadows) {
    if (s.source === "replay") replay++;
    else live++;
    const tot = s.leg === "chase" ? totalChase : totalLimit;
    add(tot, s);
    let r = byReason.get(s.reasonId);
    if (!r) {
      r = { reason: s.reason, chase: emptyBucket(), limit: emptyBucket() };
      byReason.set(s.reasonId, r);
    }
    add(s.leg === "chase" ? r.chase : r.limit, s);
  }
  const reasons: ReasonScore[] = [...byReason.entries()]
    .map(([reasonId, r]) => {
      const chase = score(r.chase);
      const limit = score(r.limit);
      const verdict = verdictFor(chase);
      const rs: ReasonScore = { reasonId, reason: r.reason, chase, limit, verdict, line: "" };
      rs.line = reasonLine(rs);
      return rs;
    })
    .sort((a, b) => decidedN(b.chase) + b.chase.unfilled - (decidedN(a.chase) + a.chase.unfilled));
  const sweepNext =
    reasons
      .filter((r) => r.verdict === "costing")
      .sort((a, b) => (b.chase.exp ?? 0) * decidedN(b.chase) - (a.chase.exp ?? 0) * decidedN(a.chase))[0] ?? null;
  return {
    total: { chase: score(totalChase), limit: score(totalLimit) },
    byReason: reasons,
    lifts: featureLifts(shadows, "chase"),
    live,
    replay,
    sweepNext,
  };
}

/**
 * Which context tags separate the refusals that paid from the ones that
 * did not. Chase leg by default: it is the leg that always fills, so it is
 * the fair comparison across contexts.
 */
export function featureLifts(shadows: ShadowTrade[], leg: "chase" | "limit" = "chase", top = 10): FeatureLift[] {
  const pool = shadows.filter((s) => s.leg === leg && isDecided(s) && s.r != null);
  if (pool.length < MIN_FEATURE_N * 2) return [];
  const baseline = pool.reduce((a, s) => a + (s.r ?? 0), 0) / pool.length;
  const groups = new Map<string, { tag: string; value: string; rs: number[]; wins: number }>();
  for (const s of pool) {
    for (const [tag, value] of Object.entries(s.tags ?? {})) {
      if (tag === "strategy" || tag === "grade") continue; // reported elsewhere
      const key = `${tag}=${value}`;
      let g = groups.get(key);
      if (!g) {
        g = { tag, value, rs: [], wins: 0 };
        groups.set(key, g);
      }
      g.rs.push(s.r ?? 0);
      if (s.status === "won") g.wins++;
    }
  }
  const out: FeatureLift[] = [];
  for (const g of groups.values()) {
    if (g.rs.length < MIN_FEATURE_N || g.rs.length === pool.length) continue;
    const exp = g.rs.reduce((a, b) => a + b, 0) / g.rs.length;
    out.push({ tag: g.tag, value: g.value, n: g.rs.length, exp, lift: exp - baseline, wr: g.wins / g.rs.length });
  }
  // Rank by |lift| × sqrt(n): a big lift on a thin sample and a small lift on
  // a deep one are both worth less than a real lift with real n behind it.
  return out.sort((a, b) => Math.abs(b.lift) * Math.sqrt(b.n) - Math.abs(a.lift) * Math.sqrt(a.n)).slice(0, top);
}

/** The evidence line for one refusing layer, for the Trade Now board. */
export function evidenceFor(reasonId: string, shadows: ShadowTrade[]): ReasonScore | null {
  const card = buildScorecard(shadows.filter((s) => s.reasonId === reasonId));
  return card.byReason[0] ?? null;
}

/** A compact text digest for the veteran brain and the Claude/Grok handoff. */
export function discretionDigest(shadows: ShadowTrade[], maxReasons = 5): string {
  if (!shadows.length) return "Shadow book empty — no refusals measured yet.";
  const c = buildScorecard(shadows);
  const lines: string[] = [];
  lines.push(
    `Shadow book (${c.live} live · ${c.replay} replay): chase ${legLine(c.total.chase)} · limit ${legLine(c.total.limit)}.`,
  );
  for (const r of c.byReason.slice(0, maxReasons)) lines.push(`• ${r.line}`);
  if (c.sweepNext) lines.push(`→ Next sweep candidate: "${c.sweepNext.reason}" (refusals paid ${fmtR(c.sweepNext.chase.exp)}/t over ${decidedN(c.sweepNext.chase)}).`);
  if (c.lifts.length) {
    lines.push(
      `Little things (chase, vs baseline): ${c.lifts
        .slice(0, 5)
        .map((l) => `${l.tag}=${l.value} ${fmtR(l.lift)} (n=${l.n})`)
        .join(" · ")}.`,
    );
  }
  return lines.join("\n");
}
