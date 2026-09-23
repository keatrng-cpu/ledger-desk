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
 *   gate earning its keep — chasing the refusals loses money. The layer is
 *                           doing its job.
 *   gate costing money    — the refusals would have paid. The layer is the
 *                           one to sweep next (scripts/sweep-gates.mjs), not
 *                           to delete: this is evidence, not permission.
 *   neutral               — refusing costs nothing, chasing pays nothing.
 *                           The gate is free to keep.
 *   too early             — the sample cannot separate the question yet. The
 *                           honest state, and the default.
 *
 * TWO THINGS A VERDICT REFUSES TO DO
 * 1. It never pools killzones. 58% of this book's population is London and
 *    the desk trades NY AM; a pooled "+0.40R, sweep it" can be nine London
 *    rows hiding five NY-AM rows at −0.15R, which is exactly the error that
 *    retracted the "+0.35R resting at CE" headline (see ENTRY_EVIDENCE
 *    killzone-split). Every verdict is computed inside ONE killzone, and the
 *    one it is reported from is PRIMARY_KILLZONE — the window the desk sits.
 * 2. It never fires on a point estimate crossing a threshold. Per-trade R
 *    here has sd ≈ 1.0–1.2R, so at n=8 the standard error of the mean is
 *    ≈0.40R and a gate with true expectancy of exactly zero would clear the
 *    "costing" line on noise about a quarter of the time — and then be named
 *    as the next sweep candidate. A verdict requires the whole 95% interval
 *    to sit on one side of the threshold, with the interval widened for the
 *    fact that refusals cluster by day. Until it separates: too early.
 *
 * THE LITTLE THINGS
 * Every shadow carries the context tags shadow-book.ts stamped at the
 * moment of refusal. `featureLifts` slices the chase outcomes by every tag
 * value — "refusals with SMT present paid +0.6R vs −0.2R without",
 * "10:30–11:00 refusals lost". Those are the patterns a trader develops by
 * feel over years; here they are counted, and then priced for the fact that
 * counting ~90 of them and reporting the extreme is a search, not a
 * finding. Each row carries its Welch t against the rest of the pool, the
 * number of tests it beat, the number of SESSIONS behind it, and how much
 * of it is the window the desk trades. `discretionDigest` prints only the
 * rows that clear the Bonferroni threshold, which on today's seed is none
 * of them.
 *
 * WHAT IT NEVER DOES
 * It never changes a gate, a size or a grade. It informs the Trade Now
 * evidence line, the veteran brain and the handoff; the trader and the
 * sweep decide. Pure, deterministic, no I/O — same discipline as
 * analytics.ts.
 */

import type { ShadowTrade } from "./shadow-book";

/**
 * The killzone the desk actually acts in. sessions.ts puts `ny_am` at
 * 08:30–11:00 ET, which is where CLAUDE.md's whole live loop sits: brief at
 * 09:20, Judas 09:30–09:45, pulses to 10:00, A+ only after. Evidence from
 * London, lunch and the PM is counted and shown, never promoted to a
 * verdict — a gate that costs money in a window the trader is asleep for is
 * not a reason to open that gate in the window he trades.
 */
export const PRIMARY_KILLZONE = "ny_am";

/**
 * Decided shadows (won/lost/scratch) a layer needs IN ONE KILLZONE before a
 * verdict is even attempted. This is a floor, not the test — the interval
 * below is the test, and at sd ≈ 1.1R it will not separate until n is
 * several times this. A gate that sits at "too early" for months is the
 * measurement being honest, not the measurement being broken.
 */
export const MIN_VERDICT_N = 8;
/**
 * Distinct ET sessions a layer needs before a verdict is attempted, on top
 * of the row count. Refusals arrive in clumps — one morning's tape can throw
 * eight cards off the same swing — so eight rows from two mornings is two
 * draws wearing an n of eight. A week of separate sessions is the floor, and
 * it also stops a run of identical outcomes (twenty stops at exactly −1R)
 * from collapsing the interval to zero width and calling a gate on one day.
 */
export const MIN_VERDICT_DAYS = 5;
/** Decided shadows a feature value needs before it is reported as a lift. */
export const MIN_FEATURE_N = 6;
/** Expectancy thresholds for the two verdicts, in R per decided shadow. */
export const GATE_RIGHT_EXP = -0.15;
export const GATE_COST_EXP = 0.25;
/** Two-sided confidence level every interval in this file is built at. */
export const CI_ALPHA = 0.05;

/* ── Intervals ───────────────────────────────────────────────────────────── */

/**
 * Two-sided 95% Student-t critical values. A lookup, not an approximation,
 * so the same sample always produces the same verdict on any machine. Between
 * table rows the SMALLER df is used, which gives the LARGER t — the interval
 * errs wide, and a verdict errs toward "too early".
 */
const T95: readonly (readonly [number, number])[] = [
  [1, 12.706], [2, 4.303], [3, 3.182], [4, 2.776], [5, 2.571], [6, 2.447], [7, 2.365], [8, 2.306],
  [9, 2.262], [10, 2.228], [11, 2.201], [12, 2.179], [13, 2.16], [14, 2.145], [15, 2.131],
  [16, 2.12], [17, 2.11], [18, 2.101], [19, 2.093], [20, 2.086], [21, 2.08], [22, 2.074],
  [23, 2.069], [24, 2.064], [25, 2.06], [26, 2.056], [27, 2.052], [28, 2.048], [29, 2.045],
  [30, 2.042], [40, 2.021], [50, 2.009], [60, 2.0], [80, 1.99], [100, 1.984], [120, 1.98],
];
function tCrit95(df: number): number | null {
  if (!Number.isFinite(df) || df < 1) return null;
  let t = T95[0]![1];
  for (const [d, v] of T95) if (df >= d) t = v;
  return t;
}

/**
 * The standard normal quantile (Acklam's rational approximation, |ε| < 1.2e-9).
 * Used only for the multiple-comparison threshold, where α is small enough
 * that the t table runs out. Deterministic, no dependency.
 */
function invNormal(p: number): number {
  if (!(p > 0 && p < 1)) return Number.NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - pLow) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}
/** |z| a two-sided test at this α must clear. */
function zTwoSided(alpha: number): number {
  return Math.abs(invNormal(Math.max(1e-12, alpha / 2)));
}

export interface MeanInterval {
  n: number;
  /** Distinct ET days the sample came from — the real number of draws. */
  days: number;
  mean: number | null;
  sd: number | null;
  /** The wider of the iid and day-clustered standard errors. */
  se: number | null;
  df: number | null;
  lo: number | null;
  hi: number | null;
}

/**
 * Mean with an interval that is honest about how the sample was generated.
 *
 * Refusals are not independent draws: a single morning's tape produces
 * several cards off the same swing, so the iid standard error understates
 * the spread. Both are computed — the textbook sd/√n on n−1 df, and the
 * cluster-robust (CR1) form on days−1 df — and the WIDER interval is the one
 * returned. With one day of data no interval exists at all, which is the
 * correct answer to "what does this gate do" after one session.
 */
export function meanInterval(rows: readonly { r: number; dayKey: string }[]): MeanInterval {
  const n = rows.length;
  if (!n) return { n: 0, days: 0, mean: null, sd: null, se: null, df: null, lo: null, hi: null };
  const byDay = new Map<string, number>();
  let sum = 0;
  for (const row of rows) sum += row.r;
  const mean = sum / n;
  let ss = 0;
  for (const row of rows) {
    ss += (row.r - mean) ** 2;
    byDay.set(row.dayKey, (byDay.get(row.dayKey) ?? 0) + (row.r - mean));
  }
  const days = byDay.size;
  const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : null;
  const seIid = sd != null ? sd / Math.sqrt(n) : null;
  let seDay: number | null = null;
  if (days > 1) {
    let meat = 0;
    for (const g of byDay.values()) meat += g * g;
    seDay = Math.sqrt((days / (days - 1)) * meat) / n;
  }
  // Half-width from each, then keep the wider interval and the df that built it.
  const half = (se: number | null, df: number): { half: number; df: number } | null => {
    const t = tCrit95(df);
    return se == null || t == null || !Number.isFinite(se) ? null : { half: t * se, df };
  };
  const cands = [half(seIid, n - 1), half(seDay, days - 1)].filter((x): x is { half: number; df: number } => x != null);
  if (!cands.length) return { n, days, mean, sd, se: seIid, df: null, lo: null, hi: null };
  const widest = cands.reduce((a, b) => (b.half > a.half ? b : a));
  const se = widest.df === days - 1 ? seDay : seIid;
  return { n, days, mean, sd, se, df: widest.df, lo: mean - widest.half, hi: mean + widest.half };
}

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
  /** Distinct ET days behind the decided rows — the real number of draws. */
  days: number;
  /** Sample sd of R over the decided rows. Null below n=2. */
  sd: number | null;
  /** 95% interval on `exp`, day-clustered when there is more than one day. */
  ciLo: number | null;
  ciHi: number | null;
}

export type GateVerdict = "earning" | "costing" | "neutral" | "early";

/**
 * One killzone's answer for one gate. This is the ONLY object in the file a
 * verdict is ever computed on: nothing above it pools windows.
 */
export interface KillzoneScore {
  killzone: string;
  chase: LegScore;
  limit: LegScore;
  verdict: GateVerdict;
  /** n=… · WR · exp · CI, for the window named above. */
  line: string;
}

export interface ReasonScore {
  reasonId: string;
  reason: string;
  /**
   * Counts across every killzone. Descriptive only — the totals a ledger owes
   * the trader. No verdict is derived from these, by design.
   */
  chase: LegScore;
  limit: LegScore;
  /** Every window this gate has refused a card in, busiest first. */
  byKillzone: KillzoneScore[];
  /** PRIMARY_KILLZONE's row — the one the verdict comes from. */
  primary: KillzoneScore | null;
  /** = primary?.verdict, else "early". Never a pooled number. */
  verdict: GateVerdict;
  /** One line for the Trade Now board. Names the window it speaks for. */
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
  /** Distinct days behind the bucket — 20 cards over 2 days is 2 draws. */
  days: number;
  /** Tags that re-read the same series share one family (all tf_* → "tf"). */
  family: string;
  /** Share of the bucket that opened in PRIMARY_KILLZONE (0–1). */
  primaryShare: number;
  /** Welch t of this bucket against everything else, day-clustered both sides. */
  t: number | null;
  /** True only if |t| clears the Bonferroni threshold for `tests` tests. */
  survives: boolean;
  /** How many buckets were tested to find this one. */
  tests: number;
}

export interface Scorecard {
  total: { chase: LegScore; limit: LegScore };
  /** The same totals, split by window. The pooled pair above is not a finding. */
  totalByKillzone: KillzoneScore[];
  byReason: ReasonScore[];
  lifts: FeatureLift[];
  /** What the lift search cost in tests, and what noise alone would produce. */
  liftsCaveat: string;
  /** Live and replay counted separately, so the trader can see the split. */
  live: number;
  replay: number;
  /**
   * The layer whose refusals cost money IN PRIMARY_KILLZONE with an interval
   * clear of the threshold — the next sweep. Null is the normal state.
   */
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

/**
 * Score a set of shadows. Takes the rows rather than a running bucket
 * because the interval needs the individual R values and the day each one
 * came from; a sum cannot be un-summed.
 */
function scoreOf(trades: readonly ShadowTrade[]): LegScore {
  const b = emptyBucket();
  const rows: { r: number; dayKey: string }[] = [];
  for (const s of trades) {
    add(b, s);
    if (isDecided(s) && s.r != null) rows.push({ r: s.r, dayKey: s.dayKey });
  }
  const decided = b.wins + b.losses + b.scratch;
  const ci = meanInterval(rows);
  return {
    ...b,
    wr: decided ? b.wins / decided : null,
    exp: decided ? b.sumR / decided : null,
    days: ci.days,
    sd: ci.sd,
    ciLo: ci.lo,
    ciHi: ci.hi,
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

/**
 * The verdict for ONE killzone's chase leg.
 *
 * The test is the interval, not the mean: the whole 95% band has to sit on
 * one side of the threshold. A mean of +0.30R on n=8 with a band of
 * [−0.62, +1.22] says nothing about whether the gate costs money, and the
 * old point test called that "costing" and printed it as the next sweep.
 * "Neutral" has to earn its name too — the band must fit INSIDE both
 * thresholds, which is a stronger claim than the mean landing between them.
 */
function verdictFor(chase: LegScore): GateVerdict {
  if (decidedN(chase) < MIN_VERDICT_N || chase.exp == null) return "early";
  if (chase.days < MIN_VERDICT_DAYS) return "early";
  if (chase.ciLo == null || chase.ciHi == null) return "early";
  if (chase.ciHi < GATE_RIGHT_EXP) return "earning";
  if (chase.ciLo > GATE_COST_EXP) return "costing";
  if (chase.ciLo > GATE_RIGHT_EXP && chase.ciHi < GATE_COST_EXP) return "neutral";
  return "early";
}

function ciText(l: LegScore): string {
  if (l.ciLo == null || l.ciHi == null) return "CI n/a";
  return `95% CI [${fmtR(l.ciLo)}, ${fmtR(l.ciHi)}]`;
}

function legLine(l: LegScore): string {
  const d = decidedN(l);
  if (!d) return l.unfilled ? `${l.unfilled} unfilled` : "n=0";
  return `n=${d} over ${l.days}d · WR ${((l.wr ?? 0) * 100).toFixed(0)}% · ${fmtR(l.exp)}/t · ${ciText(l)} · ${fmtUsd(l.sumPnl)}${l.unfilled ? ` · ${l.unfilled} unfilled` : ""}`;
}

export function killzoneLine(k: KillzoneScore): string {
  return `${k.killzone}: chase ${legLine(k.chase)} · limit ${legLine(k.limit)}`;
}

/**
 * The gate's line. It always says which window it speaks for, and what the
 * other windows did is appended as counts — never as a verdict, because the
 * trader cannot act in them.
 */
export function reasonLine(r: ReasonScore): string {
  const p = r.primary;
  const head =
    r.verdict === "earning"
      ? `gate earning its keep in ${PRIMARY_KILLZONE}`
      : r.verdict === "costing"
        ? `gate costing money in ${PRIMARY_KILLZONE} — sweep it`
        : r.verdict === "neutral"
          ? `no edge either way in ${PRIMARY_KILLZONE} — chasing these does not pay, refusing them costs nothing`
          : p == null
            ? `too early — no ${PRIMARY_KILLZONE} sample yet (0/${MIN_VERDICT_N} chased)`
            : decidedN(p.chase) < MIN_VERDICT_N
              ? `too early (${decidedN(p.chase)}/${MIN_VERDICT_N} chased in ${PRIMARY_KILLZONE})`
              : p.chase.days < MIN_VERDICT_DAYS
                ? `too early (${decidedN(p.chase)} chased, but from only ${p.chase.days}/${MIN_VERDICT_DAYS} sessions — that is ${p.chase.days} draws)`
                : `too early — ${PRIMARY_KILLZONE} interval ${ciText(p.chase)} still straddles a threshold`;
  const body = p ? `chase ${legLine(p.chase)} · limit ${legLine(p.limit)}` : "no rows in the window the desk trades";
  const others = r.byKillzone.filter((k) => k.killzone !== PRIMARY_KILLZONE && decidedN(k.chase) > 0);
  const tail = others.length
    ? ` · other windows (not a verdict): ${others.map((k) => `${k.killzone} n=${decidedN(k.chase)} ${fmtR(k.chase.exp)}/t`).join(", ")}`
    : "";
  return `${r.reason} [${PRIMARY_KILLZONE}]: ${head} · ${body}${tail}`;
}

/** A killzone's own two legs, scored and judged inside that window only. */
function killzoneScore(killzone: string, rows: readonly ShadowTrade[]): KillzoneScore {
  const chase = scoreOf(rows.filter((s) => s.leg === "chase"));
  const limit = scoreOf(rows.filter((s) => s.leg === "limit"));
  const k: KillzoneScore = { killzone, chase, limit, verdict: verdictFor(chase), line: "" };
  k.line = killzoneLine(k);
  return k;
}

/** Busiest window first, so a thin PM row never leads the list. */
function splitByKillzone(rows: readonly ShadowTrade[]): KillzoneScore[] {
  const by = new Map<string, ShadowTrade[]>();
  for (const s of rows) {
    const kz = s.killzone || "unknown";
    const arr = by.get(kz);
    if (arr) arr.push(s);
    else by.set(kz, [s]);
  }
  return [...by.entries()]
    .map(([kz, r]) => killzoneScore(kz, r))
    .sort((a, b) => decidedN(b.chase) + decidedN(b.limit) - (decidedN(a.chase) + decidedN(a.limit)));
}

/** The whole scorecard from a set of shadows (live + replay). */
export function buildScorecard(shadows: ShadowTrade[]): Scorecard {
  const byReason = new Map<string, { reason: string; rows: ShadowTrade[] }>();
  let live = 0;
  let replay = 0;
  for (const s of shadows) {
    if (s.source === "replay") replay++;
    else live++;
    const r = byReason.get(s.reasonId);
    if (r) r.rows.push(s);
    else byReason.set(s.reasonId, { reason: s.reason, rows: [s] });
  }
  const reasons: ReasonScore[] = [...byReason.entries()]
    .map(([reasonId, r]) => {
      const byKillzone = splitByKillzone(r.rows);
      const primary = byKillzone.find((k) => k.killzone === PRIMARY_KILLZONE) ?? null;
      const rs: ReasonScore = {
        reasonId,
        reason: r.reason,
        chase: scoreOf(r.rows.filter((s) => s.leg === "chase")),
        limit: scoreOf(r.rows.filter((s) => s.leg === "limit")),
        byKillzone,
        primary,
        // The pooled legs above are counts. The verdict comes from one window.
        verdict: primary ? primary.verdict : "early",
        line: "",
      };
      rs.line = reasonLine(rs);
      return rs;
    })
    .sort((a, b) => decidedN(b.chase) + b.chase.unfilled - (decidedN(a.chase) + a.chase.unfilled));
  // The next sweep is ranked by the CONSERVATIVE end of the interval — the
  // part of the cost the sample can actually defend — times the days behind
  // it. Ranking by the mean would put the noisiest gate first, which is how
  // a sweep candidate gets picked on a sample that never separated.
  const sweepNext =
    reasons
      .filter((r) => r.verdict === "costing" && r.primary != null)
      .sort((a, b) => (b.primary!.chase.ciLo ?? 0) * b.primary!.chase.days - (a.primary!.chase.ciLo ?? 0) * a.primary!.chase.days)[0] ?? null;
  const lifts = featureLifts(shadows, "chase");
  return {
    total: { chase: scoreOf(shadows.filter((s) => s.leg === "chase")), limit: scoreOf(shadows.filter((s) => s.leg === "limit")) },
    totalByKillzone: splitByKillzone(shadows),
    byReason: reasons,
    lifts,
    liftsCaveat: liftsCaveat(lifts),
    live,
    replay,
    sweepNext,
  };
}

/** Tags that re-read one price series collapse to one family. */
function tagFamily(tag: string): string {
  return tag.startsWith("tf_") ? "tf" : tag;
}

/**
 * Which context tags separate the refusals that paid from the ones that
 * did not. Chase leg by default: it is the leg that always fills, so it is
 * the fair comparison across contexts.
 *
 * THIS IS A SEARCH, AND IT IS PRICED AS ONE
 * Every tag value is a test, and the list is then sorted by the very
 * quantity being tested, so the top row is the extreme of ~150 correlated
 * draws rather than a finding. Three things keep that honest:
 *   · `t` is a Welch statistic against the rest of the pool, with both
 *     standard errors day-clustered — twenty cards from two mornings is two
 *     draws, not twenty.
 *   · `survives` requires |t| to clear the Bonferroni threshold for the
 *     number of buckets actually tested, which at ~150 tests is |t| ≈ 3.6.
 *     Rows are still returned when they fail it, because the panel is an
 *     exploratory view; `discretionDigest` prints only survivors, because
 *     the digest is read by the brain and the handoff.
 *   · one row per FAMILY. The fourteen tf_ rungs are re-reads of one series
 *     and would otherwise report the same effect fourteen times; kz=london
 *     and kz=ny_am are the same split twice. The family's strongest |t| is
 *     the one shown, and all of its buckets still count toward `tests`.
 *
 * The pool is NOT killzone-split — splitting it would leave nothing to
 * search — so every row carries `primaryShare`, and a "finding" that is 0%
 * NY AM is a finding about London.
 */
export function featureLifts(shadows: ShadowTrade[], leg: "chase" | "limit" = "chase", top = 10): FeatureLift[] {
  const pool = shadows.filter((s) => s.leg === leg && isDecided(s) && s.r != null);
  if (pool.length < MIN_FEATURE_N * 2) return [];
  const baseline = pool.reduce((a, s) => a + (s.r ?? 0), 0) / pool.length;
  const groups = new Map<string, { tag: string; value: string; rows: ShadowTrade[] }>();
  for (const s of pool) {
    for (const [tag, value] of Object.entries(s.tags ?? {})) {
      if (tag === "strategy" || tag === "grade") continue; // reported elsewhere
      const key = `${tag}=${value}`;
      const g = groups.get(key);
      if (g) g.rows.push(s);
      else groups.set(key, { tag, value, rows: [s] });
    }
  }
  const asRows = (rs: readonly ShadowTrade[]) => rs.map((s) => ({ r: s.r ?? 0, dayKey: s.dayKey }));
  const tested: FeatureLift[] = [];
  for (const g of groups.values()) {
    if (g.rows.length < MIN_FEATURE_N || g.rows.length === pool.length) continue;
    const ids = new Set(g.rows.map((s) => s.id));
    const rest = pool.filter((s) => !ids.has(s.id));
    if (rest.length < MIN_FEATURE_N) continue;
    const mine = meanInterval(asRows(g.rows));
    const theirs = meanInterval(asRows(rest));
    const se =
      mine.se != null && theirs.se != null ? Math.sqrt(mine.se ** 2 + theirs.se ** 2) : null;
    const t = se != null && se > 0 && mine.mean != null && theirs.mean != null ? (mine.mean - theirs.mean) / se : null;
    tested.push({
      tag: g.tag,
      value: g.value,
      n: g.rows.length,
      exp: mine.mean ?? 0,
      lift: (mine.mean ?? 0) - baseline,
      wr: g.rows.filter((s) => s.status === "won").length / g.rows.length,
      days: mine.days,
      family: tagFamily(g.tag),
      primaryShare: g.rows.filter((s) => s.killzone === PRIMARY_KILLZONE).length / g.rows.length,
      t,
      survives: false,
      tests: 0,
    });
  }
  if (!tested.length) return [];
  const zCrit = zTwoSided(CI_ALPHA / tested.length);
  const priced = tested.map((f) => ({ ...f, tests: tested.length, survives: f.t != null && Math.abs(f.t) >= zCrit }));
  // One row per family — the strongest |t| — then ranked by |t|.
  const best = new Map<string, FeatureLift>();
  for (const f of priced) {
    const cur = best.get(f.family);
    if (!cur || Math.abs(f.t ?? 0) > Math.abs(cur.t ?? 0)) best.set(f.family, f);
  }
  return [...best.values()].sort((a, b) => Math.abs(b.t ?? 0) - Math.abs(a.t ?? 0)).slice(0, top);
}

/** What the lift search cost in tests, in one line, for anything that prints it. */
export function liftsCaveat(lifts: readonly FeatureLift[]): string {
  const tests = lifts[0]?.tests ?? 0;
  if (!tests) return "No feature lift tested — the pool is below the sample floor.";
  const survivors = lifts.filter((l) => l.survives).length;
  const noise = (tests * CI_ALPHA).toFixed(1);
  return `${tests} buckets tested at α=${CI_ALPHA}: ≈${noise} of them clear |t|>2 on noise alone, so a row is only called real at |t|≥${zTwoSided(CI_ALPHA / tests).toFixed(2)} (Bonferroni). ${survivors} of ${lifts.length} shown rows clear it. Pooled across killzones — read primaryShare before quoting one.`;
}

/* ── The expected path — what a card like this usually does ───────────── */

export interface PathStats {
  scope: string;
  /** The killzone the sample was restricted to, or null when it is pooled. */
  killzone: string | null;
  /** True when the rows span more than one window — every figure is a blend. */
  pooled: boolean;
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
 *
 * Pass `like.killzone` to restrict the sample to the window the card is in —
 * without it the figures blend London and NY AM, which is the pooling this
 * file's own ENTRY_EVIDENCE warns about, and the returned `scope` says so
 * out loud rather than letting the number pass as the card's own history.
 */
export const MIN_PATH_N = 20;
export function pathStats(
  shadows: ShadowTrade[],
  like: { symbol?: string; side?: "long" | "short"; reasonId?: string; killzone?: string },
): PathStats | null {
  const inWindow = like.killzone ? shadows.filter((s) => s.killzone === like.killzone) : shadows;
  const limits = inWindow.filter((s) => s.leg === "limit");
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
  const chase = inWindow.filter((s) => s.leg === "chase" && chosen.f(s) && isDecided(s));
  const chaseSum = chase.reduce((a, s) => a + (s.r ?? 0), 0);
  const cards = set.filter((s) => s.status !== "resting" && s.status !== "open").length;
  const windows = new Set(set.map((s) => s.killzone || "unknown"));
  const pooled = windows.size > 1;
  return {
    scope: `${chosen.name}${like.killzone ? ` · ${like.killzone}` : pooled ? ` · ${windows.size} killzones pooled` : windows.size === 1 ? ` · ${[...windows][0]}` : ""}`,
    killzone: like.killzone ?? (windows.size === 1 ? ([...windows][0] ?? null) : null),
    pooled,
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
  /**
   * The baseline above was measured on a resolver that credited a target
   * reached on the very bar that filled the limit. It is therefore HIGH by
   * an amount the seed can bound but not price — see the same-bar-target row
   * below. Do not quote it again until src/data/shadow-replay.json has been
   * rebuilt by scripts/build-shadow-replay.mjs against the fixed resolver.
   */
  baselineStale: true,
  rows: [
    {
      id: "same-bar-target",
      finding:
        "THE LIMIT LEG WAS PARTLY AN ARTEFACT. 9 of the 118 decided limit fills in the seed (7.6%) banked T1 on the SAME closed bar that filled them, and those 9 average +2.657R — a fifteenth of the sample carrying most of its expectancy. One 15m OHLC cannot order its own touches, so each of those bars is equally consistent with the target printing BEFORE price came back to CE, which is not a trade at all. Dropping them outright takes the seed's limit leg from +0.350R/fill (n=118) to +0.160R/fill (n=109): a 54% cut to the number the resting-at-CE case was built on. The chase leg is unaffected (+0.007R/t, n=193) because it fills at the print.",
      shipped: true,
      as: "shadow-book.ts applyRange now refuses a same-bar T1 exactly as it already refused a same-bar T2, and does not credit the fill bar's favourable excursion either. The 0.160R figure is the drop-them-entirely BOUND, not the corrected value — those cards now keep running and resolve later, so only a seed rebuild gives the real number.",
    },
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
  const baseline = ENTRY_EVIDENCE.baselineStale
    ? `baseline WITHDRAWN (measured on the pre-fix resolver — rebuild the replay seed before quoting it)`
    : `limit ${fmtR(ENTRY_EVIDENCE.baseline.limitPerCard)}/card CI ${ENTRY_EVIDENCE.baseline.limitCI}`;
  return `Entry evidence (${ENTRY_EVIDENCE.verifiedOn}, n=${ENTRY_EVIDENCE.baseline.n} cards, ${baseline}): ${shipped} of ${ENTRY_EVIDENCE.rows.length} candidates survived verification. ${ENTRY_EVIDENCE.caveat}`;
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

/**
 * A compact text digest for the veteran brain and the Claude/Grok handoff.
 *
 * This is the decision channel, so it is the strict one: totals are split by
 * window, every number carries its n and its days, and the only "little
 * things" printed are the ones that survived the multiple-comparison
 * threshold. When nothing survives it says so — an empty finding is a
 * finding, and it is the one this book usually has.
 */
export function discretionDigest(shadows: ShadowTrade[], maxReasons = 5): string {
  if (!shadows.length) return "Shadow book empty — no refusals measured yet.";
  const c = buildScorecard(shadows);
  const lines: string[] = [];
  lines.push(`Shadow book (${c.live} live · ${c.replay} replay) — split by killzone, because pooling them is how the +0.35R headline broke:`);
  for (const k of c.totalByKillzone) lines.push(`  ${k.killzone === PRIMARY_KILLZONE ? "▶" : " "} ${k.line}`);
  lines.push(`Verdicts below are ${PRIMARY_KILLZONE} only. Other windows are counted, never acted on.`);
  for (const r of c.byReason.slice(0, maxReasons)) lines.push(`• ${r.line}`);
  if (c.sweepNext?.primary) {
    const p = c.sweepNext.primary.chase;
    lines.push(
      `→ Next sweep candidate: "${c.sweepNext.reason}" — in ${PRIMARY_KILLZONE} its refusals paid ${fmtR(p.exp)}/t over n=${decidedN(p)} on ${p.days} days, ${ciText(p)} entirely above +${GATE_COST_EXP}R. Measure it with scripts/sweep-gates.mjs; evidence, not permission.`,
    );
  } else {
    lines.push(`→ No sweep candidate: no gate's ${PRIMARY_KILLZONE} interval clears +${GATE_COST_EXP}R. Nothing here argues for opening a gate.`);
  }
  const survivors = c.lifts.filter((l) => l.survives);
  if (survivors.length) {
    lines.push(
      `Little things that survived the correction (chase, vs the rest of the pool): ${survivors
        .slice(0, 5)
        .map((l) => `${l.tag}=${l.value} ${fmtR(l.lift)} (n=${l.n} over ${l.days}d, t=${l.t?.toFixed(2)}, ${(l.primaryShare * 100).toFixed(0)}% ${PRIMARY_KILLZONE})`)
        .join(" · ")}.`,
    );
  } else if (c.lifts.length) {
    lines.push(`Little things: none survive the correction. Top unadjusted row ${c.lifts[0]!.tag}=${c.lifts[0]!.value} ${fmtR(c.lifts[0]!.lift)} (n=${c.lifts[0]!.n} over ${c.lifts[0]!.days}d) is inside what noise produces.`);
  }
  if (c.lifts.length) lines.push(c.liftsCaveat);
  return lines.join("\n");
}
