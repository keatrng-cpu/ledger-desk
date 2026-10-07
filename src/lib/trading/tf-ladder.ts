/**
 * The timeframe ladder — the trader's twelve frames, read from CLOSED candles
 * only, in four tiers, top-down.
 *
 * THE TIERS (trader's call 2026-10-01 — "read top down, execute bottom up";
 * "if the frames conflict, the higher one wins")
 *   Tier 1 · bias       Q · M · W · D   which side is the draw, what must not
 *                                       break, today's bias. Also the 20/40/60-
 *                                       day IPDA range (ICT 2016 M5, verified in
 *                                       learn/canon.ts): where price sits in the
 *                                       last ~three trading months.
 *   Tier 2 · range      4H · 1H · 30m   the dealing range the session respects.
 *   Tier 3 · confirm    15m · 5m        structure agrees; where the impulse is.
 *   Tier 4 · trigger    3m · 2m · 1m    the exact sweep and candle. NEVER sets
 *                                       direction: it is excluded from DIRECTION
 *                                       and from ALIGNMENT, and only appears as
 *                                       the timing band.
 *
 * CLOSED CANDLES ONLY — no repaint
 * Until 2026-10-01 every rung read its FORMING bucket as "last" and the
 * `nowMs` this function was given was discarded (`void nowMs`), so all
 * fourteen rungs moved tick by tick. Now:
 *   - STRUCTURE (HH/HL vs LH/LL, pivot 2) is read only from that rung's own
 *     closed candles, so a rung's structure changes exactly when that rung
 *     closes — the 1m every minute, the 4H every four hours, the Q quarterly.
 *   - LOCATION is the last CLOSED 1-minute price (else the last closed 15m,
 *     else the last closed day) against the current period's open. The open
 *     is fixed once the period starts, and the price is a closed print, so
 *     location moves once a minute at most and never mid-candle.
 * The daily rung's open is ICT's true-day open — midnight ET ("Every day at
 * 12am midnight New York time begins the true day", 2016 M8, verified) — once
 * midnight has passed in the current Globex session; before that, the 18:00
 * ET session open.
 *
 * HOW A RUNG BECOMES A BIAS
 * Structure wins when it is clean; location breaks a mixed structure; a rung
 * with too few closed candles reads from location alone and says so.
 *
 * HOW THE TIERS ARE CONJOINED
 * DIRECTION is the highest Tier-1 rung with a read (Q, then M, then W, then
 * D). The tiers below are read RELATIVE to it — range (Tier 2), confirm
 * (Tier 3), trigger (Tier 4) — and the PHASE is what they say against it:
 *   all with                                 → expansion (continuations only)
 *   range with · confirm with · trigger against → pullback starting (do not chase)
 *   range with · confirm against · trigger against → pullback (wait for the turn)
 *   range with · confirm against · trigger with → reversal forming — the
 *       with-trend entry window, in the discount/premium of the range
 *   range against · confirm with · trigger with → HTF retrace ending
 *   range against · rest against             → deep retrace
 *   direction unreadable                     → range / conflict
 * ALIGNMENT is the tier-weighted share of Tier 1–3 rungs agreeing with the
 * direction (Tier 1 counts most). Degree of alignment has NOT separated
 * outcomes when measured (ladder-conflict.ts) — the binary disagreement did.
 *
 * GATE STATUS
 * structure.ts `topDown` is still the absolute HTF gate. The ladder is the
 * trader's own top-down read; when it disagrees with the engine the card
 * says so (ladder-conflict.ts). Whether it earns more than that is decided by
 * scripts/measure-tf-tiers.mjs on the four-year tape, not by this file.
 */

import type { OhlcBar } from "@/lib/market/types";
import { etWallParts, etWallToEpochMs } from "./sessions";

export type Tf = "3M" | "1M" | "1w" | "1d" | "4h" | "1h" | "30m" | "15m" | "5m" | "3m" | "2m" | "1m";
export type LadderBias = "bull" | "bear" | "neutral";
export type LadderTier = 1 | 2 | 3 | 4;
export type LadderPhase =
  | "expansion"
  | "pullback-starting"
  | "pullback"
  | "reversal-forming"
  | "htf-retrace-ending"
  | "retrace-turning"
  | "deep-retrace"
  | "range"
  | "conflict";

export const TF_ORDER: Tf[] = ["3M", "1M", "1w", "1d", "4h", "1h", "30m", "15m", "5m", "3m", "2m", "1m"];
export const TF_LABEL: Record<Tf, string> = {
  "3M": "Q",
  "1M": "M",
  "1w": "W",
  "1d": "D",
  "4h": "4H",
  "1h": "1H",
  "30m": "30",
  "15m": "15",
  "5m": "5",
  "3m": "3",
  "2m": "2",
  "1m": "1",
};
export const TF_TIER: Record<Tf, LadderTier> = {
  "3M": 1,
  "1M": 1,
  "1w": 1,
  "1d": 1,
  "4h": 2,
  "1h": 2,
  "30m": 2,
  "15m": 3,
  "5m": 3,
  "3m": 4,
  "2m": 4,
  "1m": 4,
};
export const TIER_LABEL: Record<LadderTier, string> = {
  1: "Bias",
  2: "Range",
  3: "Confirm",
  4: "Trigger",
};

export interface TfRead {
  tf: Tf;
  tier: LadderTier;
  bias: LadderBias;
  structure: "HH/HL" | "LH/LL" | "mixed" | "n/a";
  /** The current period's open, and the last CLOSED price against it. */
  open: number | null;
  last: number | null;
  vsOpenPct: number | null;
  /** Closed candles the structure was read from. */
  bars: number;
  why: string;
  source: "daily" | "15m" | "1m" | "none";
}

/** ICT's IPDA data ranges: the last 20/40/60 closed trading days. */
export interface IpdaRange {
  high20: number;
  low20: number;
  high40: number;
  low40: number;
  high60: number;
  low60: number;
  /** Where the last closed price sits in the 60-day range, 0 = low, 1 = high. */
  pct60: number;
  zone: "premium" | "discount" | "equilibrium";
  days: number;
}

export interface TfLadder {
  symbol: string;
  reads: TfRead[];
  /** From the top of Tier 1: the highest rung with a read. */
  direction: LadderBias;
  /** Which rung decided the direction. */
  decidedBy: Tf | null;
  tier1: LadderBias;
  tier2: LadderBias;
  tier3: LadderBias;
  tier4: LadderBias;
  /** Kept for existing callers: swing = Tier 2, intraday = Tier 3, micro = Tier 4. */
  swing: LadderBias;
  intraday: LadderBias;
  micro: LadderBias;
  /** Group majorities kept for display: Tier 1 / Tier 2 / Tiers 3+4. */
  htf: LadderBias;
  mtf: LadderBias;
  ltf: LadderBias;
  ipda: IpdaRange | null;
  phase: LadderPhase;
  /** 0–1, tier-weighted share of Tier 1–3 rungs agreeing with the direction. */
  alignment: number;
  /** "Q M W D | 4H 1H 30 | 15 5 | 3 2 1" with ▲▼· glyphs. */
  strip: string;
  /** The closed print every rung was read against. */
  asOfMs: number | null;
  summary: string;
  forLongs: string;
  forShorts: string;
}

export interface LadderInput {
  symbol: string;
  daily: OhlcBar[];
  m15: OhlcBar[];
  m1: OhlcBar[];
  nowMs: number;
  /** The engine's HTF gate, so the summary can name a disagreement. */
  engineTopDown?: LadderBias;
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const INTRADAY_MS: Partial<Record<Tf, number>> = {
  "4h": 240 * MIN,
  "1h": 60 * MIN,
  "30m": 30 * MIN,
  "15m": 15 * MIN,
  "5m": 5 * MIN,
  "3m": 3 * MIN,
  "2m": 2 * MIN,
  "1m": MIN,
};

/** Beyond this % from the period open, location alone leans a rung. */
const OPEN_THRESHOLD_PCT: Record<Tf, number> = {
  "3M": 1.5,
  "1M": 1,
  "1w": 0.5,
  "1d": 0.3,
  "4h": 0.3,
  "1h": 0.2,
  "30m": 0.15,
  "15m": 0.1,
  "5m": 0.05,
  "3m": 0.04,
  "2m": 0.03,
  "1m": 0.02,
};

/** Closed candles kept per rung — enough for swings, few enough to be recent. */
const KEEP = 60;
/** Swings need this many closed candles before structure is read. */
const MIN_STRUCTURE_BARS = 8;
/** Tier weight in ALIGNMENT. Tier 4 is timing only and carries no weight. */
const TIER_WEIGHT: Record<LadderTier, number> = { 1: 2, 2: 1.5, 3: 1, 4: 0 };

/* ── Time ────────────────────────────────────────────────────────────────── */

const isoOf = (tMs: number) => {
  const p = etWallParts(tMs);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};

/**
 * The CME trade date a moment belongs to: a Globex session opens at 18:00 ET
 * and trades the NEXT calendar date, so 19:00 ET Wednesday is Thursday.
 */
export function tradeDateOf(tMs: number): string {
  const p = etWallParts(tMs);
  if (p.hour >= 18) return isoOf(etWallToEpochMs(isoOf(tMs), "12:00") + DAY);
  return isoOf(tMs);
}

type CalTf = "3M" | "1M" | "1w" | "1d";

/** Calendar bucket key for an ET trade date: the week starts Monday. */
function periodKey(dateIso: string, tf: CalTf): string {
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  if (tf === "1d") return dateIso;
  if (tf === "1M") return `${y}-${String(m).padStart(2, "0")}`;
  if (tf === "3M") return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // Mon = 0
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

/* ── Resampling ──────────────────────────────────────────────────────────── */

export function resampleMs(bars: OhlcBar[], ms: number): OhlcBar[] {
  const out: OhlcBar[] = [];
  for (const b of bars) {
    const t = Math.floor(b.t / ms) * ms;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
      last.v = (last.v ?? 0) + (b.v ?? 0);
    } else out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0 });
  }
  return out;
}

/**
 * Daily bars (one per trade date, stamped at that date's 00:00 ET, as Yahoo
 * stamps futures) into weekly / monthly / quarterly candles.
 */
export function resampleCalendar(daily: OhlcBar[], tf: "1w" | "1M" | "3M"): OhlcBar[] {
  const out: OhlcBar[] = [];
  let key = "";
  for (const b of daily) {
    const k = periodKey(isoOf(b.t), tf);
    const last = out[out.length - 1];
    if (last && k === key) {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
      last.v = (last.v ?? 0) + (b.v ?? 0);
    } else {
      out.push({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0 });
      key = k;
    }
  }
  return out;
}

/**
 * Trade-date daily candles from intraday bars — for callers (the four-year
 * measurement) that have no daily series. Same 00:00 ET stamp as Yahoo's.
 */
export function dailyFromIntraday(bars: OhlcBar[]): OhlcBar[] {
  const out: OhlcBar[] = [];
  let key = "";
  for (const b of bars) {
    const k = tradeDateOf(b.t);
    const last = out[out.length - 1];
    if (last && k === key) {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
      last.v = (last.v ?? 0) + (b.v ?? 0);
    } else {
      out.push({ t: etWallToEpochMs(k, "00:00"), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0 });
      key = k;
    }
  }
  return out;
}

/* ── One rung ────────────────────────────────────────────────────────────── */

function swings(bars: OhlcBar[], k = 2): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = k; i < bars.length - k; i++) {
    let isH = true;
    let isL = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (bars[j]!.h >= bars[i]!.h) isH = false;
      if (bars[j]!.l <= bars[i]!.l) isL = false;
    }
    if (isH) highs.push(bars[i]!.h);
    if (isL) lows.push(bars[i]!.l);
  }
  return { highs, lows };
}

function structureOf(bars: OhlcBar[]): TfRead["structure"] {
  if (bars.length < MIN_STRUCTURE_BARS) return "n/a";
  const { highs, lows } = swings(bars);
  if (highs.length < 2 || lows.length < 2) return "n/a";
  const hh = highs[highs.length - 1]! > highs[highs.length - 2]!;
  const hl = lows[lows.length - 1]! > lows[lows.length - 2]!;
  const lh = highs[highs.length - 1]! < highs[highs.length - 2]!;
  const ll = lows[lows.length - 1]! < lows[lows.length - 2]!;
  if (hh && hl) return "HH/HL";
  if (lh && ll) return "LH/LL";
  return "mixed";
}

const NONE = (tf: Tf): TfRead => ({
  tf,
  tier: TF_TIER[tf],
  bias: "neutral",
  structure: "n/a",
  open: null,
  last: null,
  vsOpenPct: null,
  bars: 0,
  why: "no data",
  source: "none",
});

function readRung(
  tf: Tf,
  closed: OhlcBar[],
  periodOpen: number | null,
  last: number | null,
  source: TfRead["source"],
  openNote = "",
): TfRead {
  if (!closed.length && periodOpen == null) return NONE(tf);
  const kept = closed.slice(-KEEP);
  const vsOpenPct = periodOpen != null && last != null && periodOpen > 0 ? ((last - periodOpen) / periodOpen) * 100 : null;
  const structure = structureOf(kept);
  const thr = OPEN_THRESHOLD_PCT[tf];
  const location: LadderBias = vsOpenPct == null ? "neutral" : vsOpenPct > thr ? "bull" : vsOpenPct < -thr ? "bear" : "neutral";
  let bias: LadderBias;
  if (structure === "HH/HL") bias = "bull";
  else if (structure === "LH/LL") bias = "bear";
  else bias = location;
  const locTxt =
    vsOpenPct == null ? "" : `${vsOpenPct >= 0 ? "+" : ""}${vsOpenPct.toFixed(Math.abs(vsOpenPct) < 0.1 ? 3 : 2)}% vs ${openNote || "open"}`;
  const why =
    structure === "n/a"
      ? `${locTxt || "no open"} (${kept.length} closed — location only)`
      : `${structure} on ${kept.length} closed · ${locTxt}`;
  return { tf, tier: TF_TIER[tf], bias, structure, open: periodOpen, last, vsOpenPct, bars: kept.length, why, source };
}

/* ── The ladder ──────────────────────────────────────────────────────────── */

const byTier = (reads: TfRead[], tier: LadderTier) => reads.filter((r) => r.tier === tier);

function majority(reads: TfRead[], tie: Tf | null): LadderBias {
  let bull = 0;
  let bear = 0;
  for (const r of reads) {
    if (r.source === "none") continue;
    if (r.bias === "bull") bull += 1;
    else if (r.bias === "bear") bear += 1;
  }
  if (bull > bear) return "bull";
  if (bear > bull) return "bear";
  const t = tie ? reads.find((r) => r.tf === tie) : null;
  return t && t.source !== "none" ? t.bias : "neutral";
}

/**
 * The bias a continuation is taken off.
 *
 * The quarter open is not that bias. Price can sit above the quarter open for
 * months while the 4H, 1H, and 30m are a bearish leg. The dealing range is the
 * structure. The day breaks a tie. The quarter is context, not the side.
 */
export function sessionBias(ladder: {
  tier2: LadderBias;
  htf: LadderBias;
  reads: readonly { tf: Tf; bias: LadderBias; source: TfRead["source"] }[];
}): LadderBias {
  if (ladder.tier2 !== "neutral") return ladder.tier2;
  const day = ladder.reads.find((r) => r.tf === "1d" && r.source !== "none");
  if (day && day.bias !== "neutral") return day.bias;
  return ladder.htf;
}

const glyph = (b: LadderBias) => (b === "bull" ? "▲" : b === "bear" ? "▼" : "·");
const word = (b: LadderBias) => (b === "bull" ? "bull" : b === "bear" ? "bear" : "flat");

function ipdaOf(closedDaily: OhlcBar[], price: number | null): IpdaRange | null {
  if (closedDaily.length < 20 || price == null) return null;
  const span = (n: number) => {
    const w = closedDaily.slice(-n);
    return { hi: Math.max(...w.map((b) => b.h)), lo: Math.min(...w.map((b) => b.l)) };
  };
  const d20 = span(20);
  const d40 = span(40);
  const d60 = span(60);
  const width = d60.hi - d60.lo;
  const pct60 = width > 0 ? (price - d60.lo) / width : 0.5;
  const zone = pct60 > 0.55 ? "premium" : pct60 < 0.45 ? "discount" : "equilibrium";
  return {
    high20: d20.hi,
    low20: d20.lo,
    high40: d40.hi,
    low40: d40.lo,
    high60: d60.hi,
    low60: d60.lo,
    pct60: +pct60.toFixed(3),
    zone,
    days: Math.min(60, closedDaily.length),
  };
}

export function buildTfLadder(input: LadderInput): TfLadder {
  const { symbol, daily, m15, m1, nowMs } = input;

  // Closed only. A bucket is closed when its end is at or before now.
  const closedMs = (bars: OhlcBar[], ms: number) => bars.filter((b) => b.t + ms <= nowMs);
  const m1Closed = closedMs(m1, MIN);
  const m15Closed = closedMs(m15, 15 * MIN);

  // The closed print every rung is read against: newest closed 1m, else 15m.
  const lastM1 = m1Closed[m1Closed.length - 1];
  const lastM15 = m15Closed[m15Closed.length - 1];
  const refBar = lastM1 && (!lastM15 || lastM1.t >= lastM15.t) ? lastM1 : lastM15;
  const refMs = refBar ? refBar.t + (refBar === lastM1 ? MIN : 15 * MIN) : null;
  const intradayRef = refBar ? refBar.c : null;

  // Daily: one bar per trade date. A daily candle is closed once its trade
  // date is behind the current Globex session's. With no daily series, they
  // are built from the 15m bars.
  const dailyAll = daily.length ? daily : dailyFromIntraday(m15);
  const dailySrc: TfRead["source"] = daily.length ? "daily" : m15.length ? "15m" : "none";
  const nowTd = tradeDateOf(nowMs);
  const dailyClosed = dailyAll.filter((b) => isoOf(b.t) < nowTd);
  const lastDailyClose = dailyClosed[dailyClosed.length - 1]?.c ?? null;
  const ref = intradayRef ?? lastDailyClose;

  const reads: TfRead[] = [];

  // Tier 1 — Q, M, W, D.
  for (const tf of ["3M", "1M", "1w", "1d"] as CalTf[]) {
    if (!dailyAll.length) {
      reads.push(NONE(tf));
      continue;
    }
    const nowKey = periodKey(nowTd, tf);
    const all = tf === "1d" ? dailyAll : resampleCalendar(dailyAll, tf);
    const closed = all.filter((b) => periodKey(isoOf(b.t), tf) < nowKey);
    const current = all.find((b) => periodKey(isoOf(b.t), tf) === nowKey) ?? null;
    let periodOpen = current?.o ?? null;
    let note = tf === "3M" ? "quarter open" : tf === "1M" ? "month open" : tf === "1w" ? "week open" : "session open";
    if (tf === "1d") {
      // ICT's true day: the midnight ET open, once midnight has passed in
      // this session; until then the 18:00 ET session open.
      const midnight = etWallToEpochMs(nowTd, "00:00");
      if (nowMs >= midnight) {
        const first = m15.find((b) => b.t >= midnight) ?? m1.find((b) => b.t >= midnight);
        if (first) {
          periodOpen = first.o;
          note = "midnight open";
        }
      }
    }
    reads.push(readRung(tf, closed, periodOpen, ref, dailySrc, note));
  }

  // Tier 2 and Tier 3's 15m — from the 15m series.
  for (const tf of ["4h", "1h", "30m", "15m"] as Tf[]) {
    if (!m15.length) {
      reads.push(NONE(tf));
      continue;
    }
    const ms = INTRADAY_MS[tf]!;
    const buckets = resampleMs(m15, ms);
    const closed = buckets.filter((b) => b.t + ms <= nowMs);
    const cur = refMs != null ? buckets.find((b) => b.t <= refMs - 1 && refMs - 1 < b.t + ms) ?? null : null;
    reads.push(readRung(tf, closed, cur ? cur.o : null, ref, "15m"));
  }

  // Tier 3's 5m and Tier 4 — from the 1m series.
  for (const tf of ["5m", "3m", "2m", "1m"] as Tf[]) {
    if (!m1.length) {
      reads.push(NONE(tf));
      continue;
    }
    const ms = INTRADAY_MS[tf]!;
    const buckets = resampleMs(m1, ms);
    const closed = buckets.filter((b) => b.t + ms <= nowMs);
    const cur = refMs != null ? buckets.find((b) => b.t <= refMs - 1 && refMs - 1 < b.t + ms) ?? null : null;
    reads.push(readRung(tf, closed, cur ? cur.o : null, ref, "1m"));
  }

  const t1 = byTier(reads, 1);
  const t2 = byTier(reads, 2);
  const t3 = byTier(reads, 3);
  const t4 = byTier(reads, 4);
  const tier1 = majority(t1, "1d");
  const tier2 = majority(t2, "1h");
  const tier3 = majority(t3, "15m");
  const tier4 = majority(t4, "1m");

  // Direction from the top of Tier 1.
  let direction: LadderBias = "neutral";
  let decidedBy: Tf | null = null;
  for (const r of t1) {
    if (r.source === "none" || r.bias === "neutral") continue;
    direction = r.bias;
    decidedBy = r.tf;
    break;
  }

  const w = (b: LadderBias) => direction !== "neutral" && b === direction;
  const a = (b: LadderBias) => direction !== "neutral" && b !== "neutral" && b !== direction;
  let phase: LadderPhase;
  if (direction === "neutral") phase = tier3 === tier4 && tier3 !== "neutral" ? "range" : "conflict";
  else if (w(tier2) && w(tier3) && w(tier4)) phase = "expansion";
  else if (w(tier2) && w(tier3) && a(tier4)) phase = "pullback-starting";
  else if (w(tier2) && a(tier3) && w(tier4)) phase = "reversal-forming";
  else if (w(tier2) && a(tier3)) phase = "pullback";
  else if (a(tier2) && w(tier3) && w(tier4)) phase = "htf-retrace-ending";
  else if (a(tier2) && (w(tier3) || w(tier4))) phase = "retrace-turning";
  else if (a(tier2)) phase = "deep-retrace";
  else if (w(tier2)) phase = tier3 === "neutral" ? "pullback" : "expansion";
  else phase = "conflict";

  let agree = 0;
  let total = 0;
  for (const r of reads) {
    const wt = TIER_WEIGHT[r.tier];
    if (r.source === "none" || wt === 0) continue;
    total += wt;
    if (direction !== "neutral" && r.bias === direction) agree += wt;
  }
  const alignment = total > 0 ? agree / total : 0;

  const ipda = ipdaOf(dailyClosed, ref);

  const strip = ([1, 2, 3, 4] as LadderTier[])
    .map((tier) => byTier(reads, tier).map((r) => `${TF_LABEL[r.tf]}${glyph(r.bias)}`).join(" "))
    .join(" | ");

  const rungTxt = (r: TfRead) => `${TF_LABEL[r.tf]} ${word(r.bias)}${r.structure !== "n/a" && r.structure !== "mixed" ? ` (${r.structure})` : ""}`;
  const line = (rs: TfRead[], sep: string) => rs.filter((r) => r.source !== "none").map(rungTxt).join(sep);
  const zoneWord = direction === "bull" ? "discount" : "premium";

  const phaseTxt: Record<LadderPhase, string> = {
    expansion: `Range, confirm and trigger all run with the ${word(direction)} — expansion. Continuations only; a counter-${word(direction)} card is fading every tier.`,
    "pullback-starting": `4H/1H and 15m/5m still with the ${word(direction)}, the 1m–3m have turned — a pullback is starting. Do not chase; let it reach the ${zoneWord}.`,
    pullback: `4H/1H with the ${word(direction)}, 15m/5m against — today's leg is the pullback. Wait for the trigger tier to turn back ${word(direction)} inside the ${zoneWord}.`,
    "reversal-forming": `4H/1H with the ${word(direction)}, 15m/5m against, 1m–3m turning back — the pullback is ending. The with-trend window, in the ${zoneWord}; rest the limit at the array, do not chase the 1m.`,
    "htf-retrace-ending": `The 4H/1H pulled back against the ${word(direction)} bias and the 15m/5m and trigger tier have turned back — the bigger with-trend window, if the ${zoneWord} holds.`,
    "retrace-turning": `The 4H/1H are against the ${word(direction)} bias and only ${w(tier4) && !w(tier3) ? "the trigger tier has" : "the 15m/5m have"} turned back — early. Wait for ${w(tier4) && !w(tier3) ? "the 15m/5m to confirm" : "the 1H to agree"}.`,
    "deep-retrace": `4H/1H, 15m/5m and trigger all against the ${word(direction)} bias — a deep retrace. Wait; the higher tier may be about to flip.`,
    range: "No direction from Tier 1; the lower tiers agree with each other — a range: trade the edges, not the middle.",
    conflict: "The tiers disagree from the top down — no read. Stand until the day or the week resolves.",
  };
  const engineNote =
    input.engineTopDown && input.engineTopDown !== "neutral" && direction !== "neutral" && input.engineTopDown !== direction
      ? ` Engine HTF gate reads ${input.engineTopDown} while the ladder's ${decidedBy ? TF_LABEL[decidedBy] : "Tier 1"} reads ${word(direction)} — the gate rules; the card shows the disagreement.`
      : "";
  const ipdaTxt = ipda
    ? ` IPDA 60-day: ${(ipda.pct60 * 100).toFixed(0)}% of ${ipda.low60.toFixed(2)}–${ipda.high60.toFixed(2)} (${ipda.zone}).`
    : "";
  const summary = `${symbol} top-down (closed candles): Tier 1 ${word(direction)}${decidedBy ? ` from ${TF_LABEL[decidedBy]}` : ""} (${line(t1, " → ") || "n/a"}).${ipdaTxt} Range ${word(tier2)}: ${line(t2, " · ") || "n/a"}. Confirm ${word(tier3)}: ${line(t3, " · ") || "n/a"}. Trigger ${word(tier4)}: ${line(t4, " · ") || "n/a"}. ${phaseTxt[phase]} Alignment ${(alignment * 100).toFixed(0)}% (Tiers 1–3).${engineNote}`;

  const windowOpen = phase === "reversal-forming" || phase === "htf-retrace-ending" || phase === "expansion";
  const withText = windowOpen
    ? `With Tier 1 — the window is open (${phase.replace(/-/g, " ")}); rest the limit at the 15m/5m array.`
    : phase === "pullback-starting"
      ? "With Tier 1 but early — the trigger tier has turned; wait for the pullback to reach the zone."
      : phase === "pullback" || phase === "deep-retrace" || phase === "retrace-turning"
        ? `With Tier 1, in a ${phase.replace(/-/g, " ")} — wait for the lower tiers to confirm.`
        : "With Tier 1 — but the tiers are unresolved.";
  const againstText = "Against Tier 1 — the higher frame wins.";
  const noneText = "No direction from Tier 1 — range rules only.";
  const forLongs = direction === "bull" ? withText : direction === "bear" ? againstText : noneText;
  const forShorts = direction === "bear" ? withText : direction === "bull" ? againstText : noneText;

  return {
    symbol,
    reads,
    direction,
    decidedBy,
    tier1,
    tier2,
    tier3,
    tier4,
    swing: tier2,
    intraday: tier3,
    micro: tier4,
    htf: tier1,
    mtf: tier2,
    ltf: majority([...t3, ...t4], "15m"),
    ipda,
    phase,
    alignment,
    strip,
    asOfMs: refMs,
    summary,
    forLongs,
    forShorts,
  };
}

/** Tags for the shadow book and the measurement: each rung and tier vs the trade's side. */
export function ladderTags(ladder: TfLadder | null | undefined, side: "long" | "short"): Record<string, string> {
  if (!ladder) return {};
  const want: LadderBias = side === "long" ? "bull" : "bear";
  const rel = (b: LadderBias, src: TfRead["source"] | "tier") => (src === "none" ? "n/a" : b === want ? "with" : b === "neutral" ? "flat" : "against");
  const out: Record<string, string> = {};
  for (const r of ladder.reads) out[`tf_${r.tf}`] = rel(r.bias, r.source);
  out.tf_tier1 = rel(ladder.tier1, "tier");
  out.tf_tier2 = rel(ladder.tier2, "tier");
  out.tf_tier3 = rel(ladder.tier3, "tier");
  out.tf_tier4 = rel(ladder.tier4, "tier");
  // Kept so older shadow rows stay comparable.
  out.tf_swing = out.tf_tier2;
  out.tf_intraday = out.tf_tier3;
  out.tf_micro = out.tf_tier4;
  out.tf_phase = ladder.phase;
  out.tf_align = ladder.alignment >= 0.75 ? ">=75%" : ladder.alignment >= 0.5 ? "50–75%" : "<50%";
  out.tf_dir = ladder.direction === want ? "with" : ladder.direction === "neutral" ? "flat" : "against";
  if (ladder.ipda) {
    const good = side === "long" ? "discount" : "premium";
    out.tf_ipda = ladder.ipda.zone === "equilibrium" ? "eq" : ladder.ipda.zone === good ? "with" : "against";
  }
  return out;
}
