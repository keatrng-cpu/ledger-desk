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

/* ── The expected path — what a card like this usually does ───────────── */

export interface PathStats {
  scope: string;
  /** Limit leg: cards, fills, decided. */
  cards: number;
  fills: number;
  decided: number;
  fillRate: number | null;
  medianBarsToFill: number | null;
  /** Median / p90 adverse excursion before the exit, in R (decided fills). */
  maeP50: number | null;
  maeP90: number | null;
  mfeP50: number | null;
  /** Share of decided fills that ended at the stop. */
  stopFirst: number | null;
  t1Rate: number | null;
  medianBarsHeld: number | null;
  expPerFill: number | null;
  /** ΣR over every card, unfilled counted as 0 — what waiting is worth. */
  evPerCard: number | null;
  /** The chase, for contrast. */
  chaseExp: number | null;
  chaseN: number;
}

function pct(arr: number[], p: number): number | null {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))] ?? null;
}

/**
 * The distribution a trader should expect after the fill, from the shadows
 * most like the card in front of them. Narrows scope only while the sample
 * stays ≥ MIN_PATH_N decided fills: symbol+side+layer → side+layer → layer →
 * everything. The scope is returned so the card can say which one it used.
 */
export const MIN_PATH_N = 20;
export function pathStats(
  shadows: ShadowTrade[],
  like: { symbol?: string; side?: "long" | "short"; reasonId?: string },
): PathStats | null {
  const limits = shadows.filter((s) => s.leg === "limit");
  if (!limits.length) return null;
  const scopes: { name: string; f: (s: ShadowTrade) => boolean }[] = [
    { name: `${like.symbol ?? ""} ${like.side ?? ""} · ${like.reasonId ?? ""}`.trim(), f: (s) => (!like.symbol || s.symbol === like.symbol) && (!like.side || s.side === like.side) && (!like.reasonId || s.reasonId === like.reasonId) },
    { name: `${like.side ?? ""} · ${like.reasonId ?? ""}`.trim(), f: (s) => (!like.side || s.side === like.side) && (!like.reasonId || s.reasonId === like.reasonId) },
    { name: like.reasonId ?? "all", f: (s) => !like.reasonId || s.reasonId === like.reasonId },
    { name: "all refusals", f: () => true },
  ];
  let chosen = scopes[scopes.length - 1]!;
  for (const sc of scopes) {
    const dec = limits.filter((s) => sc.f(s) && isDecided(s)).length;
    if (dec >= MIN_PATH_N) {
      chosen = sc;
      break;
    }
  }
  const set = limits.filter(chosen.f);
  const filled = set.filter((s) => s.fillAt != null);
  const decided = set.filter(isDecided);
  const barsToFill = filled.map((s) => Math.max(0, Math.round(((s.fillAt ?? 0) - s.openedAt) / (15 * 60_000))));
  const maes = decided.map((s) => s.mae).filter((x): x is number => x != null);
  const mfes = decided.map((s) => s.mfe).filter((x): x is number => x != null);
  const held = decided.map((s) => s.barsSinceFill);
  const sumR = decided.reduce((a, s) => a + (s.r ?? 0), 0);
  const chase = shadows.filter((s) => s.leg === "chase" && chosen.f(s) && isDecided(s));
  const chaseSum = chase.reduce((a, s) => a + (s.r ?? 0), 0);
  const cards = set.filter((s) => s.status !== "resting" && s.status !== "open").length;
  return {
    scope: chosen.name,
    cards,
    fills: filled.length,
    decided: decided.length,
    fillRate: cards ? filled.filter((s) => isDecided(s)).length / cards : null,
    medianBarsToFill: pct(barsToFill, 0.5),
    maeP50: pct(maes, 0.5),
    maeP90: pct(maes, 0.9),
    mfeP50: pct(mfes, 0.5),
    stopFirst: decided.length ? decided.filter((s) => s.status === "lost").length / decided.length : null,
    t1Rate: decided.length ? decided.filter((s) => s.t1Hit).length / decided.length : null,
    medianBarsHeld: pct(held, 0.5),
    expPerFill: decided.length ? sumR / decided.length : null,
    evPerCard: cards ? sumR / cards : null,
    chaseExp: chase.length ? chaseSum / chase.length : null,
    chaseN: chase.length,
  };
}

/**
 * What touching an open trade costs — measured, not felt.
 *
 * Re-simulated 2026-09-21 over the 122 filled plans with a priced T1 in the
 * replay seed (scripts in the session log; the rules below vs the desk's
 * own: 50% at the DOL, stop to break-even, runner to the range). Every
 * "protect early" variant lost expectancy on that tape. Shown on open
 * positions so the itch meets its price. Rebuild when the seed rebuilds.
 */
export const MANAGEMENT_EVIDENCE = {
  measuredOn: "2026-09-21",
  n: 122,
  baseline: 0.5,
  rows: [
    { itch: "Move stop to break-even once +1R shows", costR: -0.07, wr: "40→35%" },
    { itch: "Lock +0.5R once halfway to T1", costR: -0.07, wr: "40→42%" },
    { itch: "Trail the runner under a 3-bar swing", costR: -0.3, wr: "40→42%" },
    { itch: "Bank 50% at +1R instead of the draw", costR: -0.42, wr: "40→48%" },
    { itch: "Cap T1 at 3R (the TP clamp)", costR: -0.12, wr: "40→46%" },
    { itch: "Take it all at +1R, no runner", costR: -0.54, wr: "40→48%" },
  ],
} as const;

/**
 * What the shadow book says about the ENTRY, adversarially verified
 * 2026-09-22 (387 shadows, 194 limit cards / 193 chase, day-clustered
 * bootstrap, ~90 single-tag tests + ~1,000 two-way combos).
 *
 * Every row here was re-derived by an independent pass that tried to refute
 * it. The ones that survived are shown; the ones that did not are shown too,
 * as `shipped: false`, because a rule this desk ALMOST adopted is worth
 * remembering. Nothing here is a gate — the verification's own conclusion
 * was that no single tag clears the bar for one, given the test count.
 */
export const ENTRY_EVIDENCE = {
  verifiedOn: "2026-09-22",
  killzoneWarning:
    "Every per-card number below is POOLED unless it says otherwise, and 58% of the shadow population is the London killzone. See the killzone-split row before quoting any of them.",
  baseline: { limitPerCard: 0.213, chasePerCard: 0.007, limitCI: "[-0.095, +0.553]", n: 194 },
  rows: [
    {
      id: "proximity",
      finding: "An array more than 1 ATR from price is the losing bucket: limit −0.027R/card (n=95, fills only 43%) vs +0.444R/card for everything closer. The middle band (0.5–1 ATR) is the limit's best (+0.763R/fill) and the chase's worst — a mid-distance array is a good place to REST an order and a bad place to pay the print.",
      shipped: true,
      as: "shadow-book slice + a proximity note on the plan; NOT a gate — the retrace layer already requires price inside the array, so a far card can never be a TAKE.",
    },
    {
      id: "fill-window",
      finding: "REFUTED. Shortening the 12-bar limit window looked free and is not: late fills are BETTER (bars 7–12 +0.972R vs bars 0–6 +0.253R). Cutting to 6 bars costs 38% of expectancy; extending to 24 adds 13 fills at 15% WR. Leave it at 12.",
      shipped: false,
      as: "no change",
    },
    {
      id: "armed-entry",
      finding: "The narrative state `armed_entry` is the genuinely bad one: the limit fills only 32% of the time and loses −0.570R when it does (n=22). `sweep_only` is second worst (−0.317R, 38% fill). `confirmed` INVERTS by leg — the chase loses −0.110R paying an extension that already printed while the limit makes +0.723R buying the retrace into it.",
      shipped: false,
      as: "provisional — n=22 and n=16 are under the untradeable line",
    },
    {
      id: "one-book",
      finding: "Confirms the existing hard rule rather than adding edge: refusals on the book that was NOT the one-book pick ran −0.291R on the chase (n=19) and −0.099R on the limit (n=20). Sign correct, sample too small to be new information.",
      shipped: true,
      as: "existing one-book gate",
    },
    {
      id: "killzone-split",
      finding:
        "THE CORRECTION THAT MATTERS. The headline '+0.35R/card resting at CE' is pooled, and 58% of the shadow book opens in the LONDON killzone. Split on 38,000 1m Databento bars: London refusals returned +0.396R/card resting; NY AM refusals returned −0.181R/card resting and −0.040R/card chasing (n=53 cards, 32 fills). In the window the trader actually sits, the cards the sequence refused lose money whichever way they are entered — which is what a working gate looks like, not a missing edge. Every entry number quoted anywhere must say which killzone it came from.",
      shipped: true,
      as: "corrected in entry-trigger.ts, pending-order.ts, path-alarm.ts, the panel copy and CLAUDE.md; the entry trigger no longer claims a measured edge",
    },
    {
      id: "micro-timing",
      finding:
        "1m entry timing MEASURED AND REJECTED (scripts/measure-micro-entry.mjs over src/data/learn-history-1m.json). Harness validated: pooled baseline +0.299R/fill at 33% WR against the 15m book's +0.35R at 34%. Neither variant helps the window that counts — in NY AM, a 1m confirmation entry ran −0.162R/fill (vs −0.299 baseline, and it pays a 44% wider stop) and a micro stop at the 1m swing ran −0.826R/fill at a 4% win rate. In London the micro stop looked spectacular (+1.421R/fill) at a 13% win rate, which is a lottery ticket rather than a method. No change shipped.",
      shipped: false,
      as: "no change — the 1m capture and the harness are committed so the question stays answerable",
    },
    {
      id: "ladder-direction",
      finding:
        "IDEA 7 ANSWERED, and it is direction rather than degree. With the ladder now stamped on every shadow, NY AM limit cards split hard on whether the ladder AGREED with the trade: tf_dir=with ran +0.08R/card (n=30) while tf_dir=against ran −0.69R/card (n=13). The graded alignment percentage did NOT separate the same way (>=75% ran −0.12R/card, 50–75% +0.16R) — so what matters is the binary disagreement, not how many rungs agree. Note what tf_dir=against means: the engine's HTF gate PERMITTED the trade while the ladder, read from the year down, disagreed. That is the disagreement tf-ladder.ts already narrates in its summary.",
      shipped: false,
      as: "not a gate — n=13 in the losing bucket, one in-sample pass. It argues for making the ladder-vs-engine disagreement louder, which the ladder summary already states, and for sizing DOWN on disagreement rather than refusing.",
    },
    {
      id: "rr-bands",
      finding: "No R:R band to exclude on the limit leg — per-card expectancy is positive in every band from 1–2R to >5R and win rate decays with distance exactly as it should. On the chase, 73% of legs realise below 1:1 at the print, which the minRr gate already bans; the surviving 27% have no edge.",
      shipped: true,
      as: "the Target-priced ≥1:1 layer shipped 2026-09-21 is the whole fix",
    },
  ],
  caveat:
    "~90 single-tag tests and ~1,000 two-way combos over 41 trading days: roughly 4–5 buckets should clear |t|>2 on noise alone. Treat every row as a hypothesis for the live shadow book to confirm, not as a rule.",
} as const;

export function entryEvidenceLine(): string {
  const shipped = ENTRY_EVIDENCE.rows.filter((r) => r.shipped).length;
  return `Entry evidence (${ENTRY_EVIDENCE.verifiedOn}, n=${ENTRY_EVIDENCE.baseline.n} cards, limit ${fmtR(ENTRY_EVIDENCE.baseline.limitPerCard)}/card CI ${ENTRY_EVIDENCE.baseline.limitCI}): ${shipped} of ${ENTRY_EVIDENCE.rows.length} candidates survived verification. ${ENTRY_EVIDENCE.caveat}`;
}

export function managementLine(): string {
  const r = MANAGEMENT_EVIDENCE.rows;
  return `Touching it costs (n=${MANAGEMENT_EVIDENCE.n}, ${MANAGEMENT_EVIDENCE.measuredOn}): ${r.map((x) => `${x.itch} ${fmtR(x.costR)}/t`).join(" · ")}. The plan as priced: ${fmtR(MANAGEMENT_EVIDENCE.baseline)}/t. Sit.`;
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
