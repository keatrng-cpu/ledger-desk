/**
 * The chart overlay — what an SMC trader marks on the chart, decided
 * automatically, whether or not there is a trade.
 *
 * WHY THIS IS SEPARATE FROM THE PLAN
 * The setup chart used to draw arrays only when a TradePlan existed, so a
 * STAND day showed bare candles. But the analysis exists on every bar: the
 * pools price is drawn toward, the arrays it could react from, the last raid,
 * the structure breaks, the dealing range. A trader marks all of that BEFORE
 * deciding whether to trade, and pre-market before the session starts. The
 * plan — entry, stop, targets — is the last layer on top, not the first.
 *
 * SELECTION IS THE JOB
 * The tape knows about dozens of pools and arrays. Drawing all of them is
 * the clutter this desk was pruned of. Only what is IN FRAME and still LIVE
 * is marked: pools inside the visible price band (plus the primary draw,
 * which the scale is widened to include because it is the destination),
 * unmitigated arrays nearest to price, capped, and structure breaks from the
 * last two hours. Everything else stays in the data.
 *
 * Every element here comes from the same objects the engine grades from
 * (structure.ts pools and range, smc-board.ts arrays and alerts, draw.ts,
 * market-narrative.ts sweep). The overlay cannot disagree with the verdict.
 */

import type { OhlcBar } from "@/lib/market/types";
import type { DeskPayload } from "./build-desk";
import type { SmcArray } from "./smc-board";
import type { SmcLayer } from "./smc-master";

export interface OverlayPool {
  price: number;
  side: "buyside" | "sellside";
  scope: "internal" | "external";
  label: string;
  swept: boolean;
  /** 0–1, from structure.ts. Drives line weight. */
  strength: number;
}

export interface OverlayStructure {
  t: number;
  price: number;
  kind: "mss" | "bos" | "displacement";
  side: "bull" | "bear";
  label: string;
}

export interface ChartOverlay {
  symbol: string;
  arrays: SmcArray[];
  pools: OverlayPool[];
  structure: OverlayStructure[];
  range: { high: number; low: number; eq: number; zone: string } | null;
  draw: { price: number; name: string; reachProbability: number; side: string } | null;
  sweep: { price: number; level: number; t: number; side: "buyside" | "sellside" } | null;
  /** The sequence's must-layers, for the confluence strip. */
  layers: { id: string; label: string; state: SmcLayer["state"]; must: boolean }[];
  word: "TAKE" | "WAIT" | "STAND";
  missing: string;
  /** Green flash: the desk printed TAKE. */
  flashTake: boolean;
  /**
   * Red flash: something a trader must see NOW. The bias flip is detected by
   * the caller (it needs the previous poll); news blackout and tape shock
   * come from the payload.
   */
  warn: { active: boolean; reason: string | null };
  /** HTF read, so the caller can detect a flip between polls. */
  topDown: "bull" | "bear" | "neutral";
}

/** Arrays shown. Past this the chart is noise. */
const MAX_ARRAYS = 6;
/** Pools shown, after the external ones. */
const MAX_INTERNAL_POOLS = 4;
/** Structure breaks: how far back (ms). Two hours on 15m. */
const STRUCTURE_LOOKBACK_MS = 2 * 60 * 60_000;
/** Two pools closer than this fraction of the visible band are one line. */
const POOL_DEDUPE_FRAC = 0.012;

/**
 * Build the overlay for one book from the live payload.
 *
 * `bars` are the bars the chart will show, so "in frame" is decided against
 * what will actually be on screen.
 */
export function buildChartOverlay(desk: DeskPayload, symbol: string, bars: OhlcBar[]): ChartOverlay | null {
  const isLeft = desk.left.symbol === symbol;
  const isRight = desk.right.symbol === symbol;
  if (!isLeft && !isRight) return null;

  const bias = isLeft ? desk.bias.left : desk.bias.right;
  const tape = isLeft ? desk.smc?.left : desk.smc?.right;
  const draw = isLeft ? desk.draws.left : desk.draws.right;
  const narrative = isLeft ? desk.narrative.left : desk.narrative.right;
  const book = isLeft ? desk.smcMaster.left : desk.smcMaster.right;

  if (!bars.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    lo = Math.min(lo, b.l);
    hi = Math.max(hi, b.h);
  }
  const band = hi - lo || 1;
  const price = bars[bars.length - 1]!.c;
  const inFrame = (p: number) => p >= lo - band * 0.15 && p <= hi + band * 0.15;

  // ── Pools: every external pool in frame, then the strongest internals ──
  const dedupe = (ps: OverlayPool[]): OverlayPool[] => {
    const out: OverlayPool[] = [];
    for (const p of ps.sort((a, b) => b.strength - a.strength)) {
      if (out.every((o) => Math.abs(o.price - p.price) > band * POOL_DEDUPE_FRAC)) out.push(p);
    }
    return out;
  };
  const rawPools = (bias.liquidity ?? []).map((p) => ({
    price: p.price,
    side: p.side,
    scope: p.scope,
    label: p.label,
    swept: p.swept,
    strength: p.strength,
  }));
  const external = dedupe(rawPools.filter((p) => p.scope === "external" && inFrame(p.price)));
  const internal = dedupe(rawPools.filter((p) => p.scope === "internal" && inFrame(p.price))).slice(0, MAX_INTERNAL_POOLS);
  // Standing reference levels the engine tracks even when they are not in
  // the pool list — the previous day's extremes are always worth a line.
  const refs: OverlayPool[] = [];
  const pushRef = (price: number | null, side: OverlayPool["side"], label: string) => {
    if (price != null && Number.isFinite(price) && inFrame(price)) {
      refs.push({ price, side, scope: "external", label, swept: false, strength: 0.9 });
    }
  };
  pushRef(bias.pdh, "buyside", "PDH");
  pushRef(bias.pdl, "sellside", "PDL");
  const pools = dedupe([...external, ...refs, ...internal]);

  // ── Arrays: live, both sides, nearest to price, capped ─────────────────
  const arrays = (tape?.arrays ?? [])
    .filter((a) => a.state !== "mitigated" && a.top >= lo - band * 0.15 && a.bottom <= hi + band * 0.15)
    .sort((a, b) => Math.abs(a.mid - price) - Math.abs(b.mid - price))
    .slice(0, MAX_ARRAYS);

  // ── Structure: recent shifts, breaks and displacements ──────────────────
  const since = bars[bars.length - 1]!.t - STRUCTURE_LOOKBACK_MS;
  const structure: OverlayStructure[] = (tape?.alerts ?? [])
    .filter((a) => (a.kind === "mss" || a.kind === "bos" || a.kind === "displacement") && a.t >= since && inFrame(a.price))
    .map((a) => ({ t: a.t, price: a.price, kind: a.kind as OverlayStructure["kind"], side: a.side, label: a.label }))
    .slice(-6);

  const range = bias.dealing
    ? { high: bias.dealing.high, low: bias.dealing.low, eq: bias.dealing.eq, zone: bias.dealing.zone }
    : null;

  const dol = draw.primary;
  const drawOut = dol ? { price: dol.price, name: dol.name, reachProbability: dol.reachProbability, side: dol.side } : null;

  const lq = narrative.liquidity;
  const sweep =
    lq.lastSweepT != null && lq.lastSweepExtreme != null && lq.lastSweepLevel != null
      ? {
          price: lq.lastSweepExtreme,
          level: lq.lastSweepLevel,
          t: lq.lastSweepT,
          side: (lq.lastSweepExtreme > lq.lastSweepLevel ? "buyside" : "sellside") as "buyside" | "sellside",
        }
      : null;

  // ── Warnings from the payload itself ────────────────────────────────────
  let warnReason: string | null = null;
  if (desk.shock?.active) warnReason = desk.shock.line;
  else if (desk.news?.verdict === "blackout") warnReason = `News blackout — ${desk.news.reason}`;

  return {
    symbol,
    arrays,
    pools,
    structure,
    range,
    draw: drawOut,
    sweep,
    layers: book.layers.map((l) => ({ id: l.id, label: l.label, state: l.state, must: l.must })),
    word: book.word,
    missing: book.missing,
    flashTake: book.word === "TAKE",
    warn: { active: warnReason != null, reason: warnReason },
    topDown: bias.topDown,
  };
}
