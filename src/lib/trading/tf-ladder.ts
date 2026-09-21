/**
 * The timeframe ladder — one bias per timeframe from the yearly down to the
 * 30-second, read top-down and conjoined into a direction, a phase and an
 * alignment.
 *
 * WHY
 * The desk's HTF gate (structure.ts `topDown`) is one number distilled from
 * a few resampled series. A trader reads more than that: the year decides
 * what a pullback is, the month and week decide whether this is the
 * pullback or the turn, the day and the 4h/1h decide the phase, and the
 * 15m down to the 1m time the entry. The trader's call (2026-09-21): show
 * every rung, in sync, and read them from the top down for trades and for
 * summaries. This module is that read, deterministic, from bars only.
 *
 * HOW A RUNG IS READ
 * Each timeframe is a resample of the finest series that covers it (daily
 * bars for 1d/1w/1M/1y, 15m bars for 15m–4h, 1m bars for 1m–10m, prints for
 * the 30s). Two facts per rung: STRUCTURE — the last two swing highs and
 * lows of that series (pivot 2): HH+HL is bull, LH+LL is bear, anything else
 * is mixed; and LOCATION — the last close against the current period's open
 * (the yearly open for the 1y rung, the month's open for 1M, …), beyond a
 * per-timeframe threshold. Structure wins when it is clean; location breaks
 * a mixed structure; a rung with too few bars reads from location alone and
 * says so.
 *
 * HOW THE RUNGS ARE CONJOINED — from the top
 * DIRECTION is the highest rung with a read: the year (location vs the
 * yearly open — a year 20% above its open is a bull year whatever the week
 * did), then the month, then the week, then the day. The rungs below the
 * one that decided are read RELATIVE to it, in three bands:
 *   swing    = 1w · 1d · 4h      the pullback-or-continuation of the trend
 *   intraday = 1h · 30m · 15m    today's leg
 *   micro    = 10m … 30s         the timing
 * and the PHASE is what those three say against the direction:
 *   all with                              → expansion (continuations only)
 *   swing with · intraday with · micro against  → pullback starting (do not chase)
 *   swing with · intraday against · micro against → pullback (wait for the turn)
 *   swing with · intraday against · micro with  → reversal forming — the
 *       intraday retrace is ending: the with-trend entry window, in the
 *       swing discount/premium, timed on the 5m/1m
 *   swing against · intraday with · micro with  → HTF retrace ending — the
 *       week/day pulled back inside the year/month trend and the lower rungs
 *       have turned: the bigger with-trend window
 *   swing against · rest against          → deep retrace (wait; the engine's
 *       HTF gate may be about to flip)
 *   direction unreadable                   → range / conflict
 * ALIGNMENT is the weighted share of rungs agreeing with the direction.
 *
 * The engine's HTF gate (structure.ts `topDown`) is a separate read from
 * the 15m/1h/4h/daily resamples. When it disagrees with the ladder's
 * direction the ladder SAYS so and the gate still rules — a ladder is a
 * narrative, the gate is a rule.
 *
 * This is analysis, not a gate. structure.ts `topDown` stays the absolute
 * HTF gate; the ladder feeds the Trade Now board, the shadow book's tags
 * (so the scorecard can say whether alignment mattered), the brain and the
 * handoff. If the evidence says alignment predicts refusals that pay, that
 * is when it earns a place in the sequence — measured first.
 */

import type { OhlcBar } from "@/lib/market/types";
import { etWallParts } from "./sessions";

export type Tf = "1y" | "1M" | "1w" | "1d" | "4h" | "1h" | "30m" | "15m" | "10m" | "5m" | "3m" | "2m" | "1m" | "30s";
export type LadderBias = "bull" | "bear" | "neutral";
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

export const TF_ORDER: Tf[] = ["1y", "1M", "1w", "1d", "4h", "1h", "30m", "15m", "10m", "5m", "3m", "2m", "1m", "30s"];
export const TF_LABEL: Record<Tf, string> = {
  "1y": "Y",
  "1M": "M",
  "1w": "W",
  "1d": "D",
  "4h": "4H",
  "1h": "1H",
  "30m": "30",
  "15m": "15",
  "10m": "10",
  "5m": "5",
  "3m": "3",
  "2m": "2",
  "1m": "1",
  "30s": "30s",
};

export interface TfRead {
  tf: Tf;
  bias: LadderBias;
  structure: "HH/HL" | "LH/LL" | "mixed" | "n/a";
  /** The current period's open, and the last close against it. */
  open: number | null;
  last: number | null;
  vsOpenPct: number | null;
  bars: number;
  why: string;
  source: "daily" | "15m" | "1m" | "prints" | "none";
}

export interface TfLadder {
  symbol: string;
  reads: TfRead[];
  /** From the top: the highest rung with a read. */
  direction: LadderBias;
  /** Which rung decided the direction. */
  decidedBy: Tf | null;
  /** The three bands below it, each a weighted majority. */
  swing: LadderBias;
  intraday: LadderBias;
  micro: LadderBias;
  /** Group majorities kept for display: 1y·1M·1w·1d / 4h·1h·30m / 15m…30s. */
  htf: LadderBias;
  mtf: LadderBias;
  ltf: LadderBias;
  phase: LadderPhase;
  /** 0–1, weighted share of rungs agreeing with the direction. */
  alignment: number;
  /** "Y M W D | 4H 1H 30 | 15 10 5 3 2 1 30s" with ▲▼· glyphs. */
  strip: string;
  /** The top-down read, one paragraph. */
  summary: string;
  /** Where longs and shorts stand given the read. */
  forLongs: string;
  forShorts: string;
}

export interface LadderInput {
  symbol: string;
  daily: OhlcBar[];
  m15: OhlcBar[];
  m1: OhlcBar[];
  /** 30-second bars built from live prints (client only). */
  s30?: OhlcBar[];
  nowMs: number;
  /** The engine's HTF gate, so the summary can name a disagreement. */
  engineTopDown?: LadderBias;
}

const MIN = 60_000;
const INTRADAY_MS: Partial<Record<Tf, number>> = {
  "4h": 240 * MIN,
  "1h": 60 * MIN,
  "30m": 30 * MIN,
  "15m": 15 * MIN,
  "10m": 10 * MIN,
  "5m": 5 * MIN,
  "3m": 3 * MIN,
  "2m": 2 * MIN,
  "1m": MIN,
  "30s": 30_000,
};

/** Beyond this % from the period open, location alone leans a rung. */
const OPEN_THRESHOLD_PCT: Record<Tf, number> = {
  "1y": 2,
  "1M": 1,
  "1w": 0.5,
  "1d": 0.3,
  "4h": 0.3,
  "1h": 0.2,
  "30m": 0.15,
  "15m": 0.1,
  "10m": 0.08,
  "5m": 0.05,
  "3m": 0.04,
  "2m": 0.03,
  "1m": 0.02,
  "30s": 0.02,
};

/** Bars kept per rung after resampling — enough for swings, few enough to be recent. */
const KEEP = 60;
/** Swings need this many bars before structure is read. */
const MIN_STRUCTURE_BARS = 8;

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

/** Calendar buckets in ET: the week starts Monday, the month and year on the 1st. */
function periodKey(ms: number, tf: "1w" | "1M" | "1y"): string {
  const p = etWallParts(ms);
  if (tf === "1y") return String(p.year);
  if (tf === "1M") return `${p.year}-${String(p.month).padStart(2, "0")}`;
  // ISO-ish week key: the Monday's date.
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function resampleCalendar(daily: OhlcBar[], tf: "1w" | "1M" | "1y"): OhlcBar[] {
  const out: OhlcBar[] = [];
  let key = "";
  for (const b of daily) {
    const k = periodKey(b.t, tf);
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

function readRung(tf: Tf, series: OhlcBar[], source: TfRead["source"]): TfRead {
  const bars = series.slice(-KEEP);
  if (!bars.length) {
    return { tf, bias: "neutral", structure: "n/a", open: null, last: null, vsOpenPct: null, bars: 0, why: "no data", source: "none" };
  }
  const cur = bars[bars.length - 1]!;
  const open = cur.o;
  const last = cur.c;
  const vsOpenPct = open > 0 ? ((last - open) / open) * 100 : null;
  const structure = structureOf(bars);
  const thr = OPEN_THRESHOLD_PCT[tf];
  const location: LadderBias = vsOpenPct == null ? "neutral" : vsOpenPct > thr ? "bull" : vsOpenPct < -thr ? "bear" : "neutral";
  let bias: LadderBias;
  if (structure === "HH/HL") bias = "bull";
  else if (structure === "LH/LL") bias = "bear";
  else bias = location;
  const locTxt = vsOpenPct == null ? "" : `${vsOpenPct >= 0 ? "+" : ""}${vsOpenPct.toFixed(Math.abs(vsOpenPct) < 0.1 ? 3 : 2)}% vs open`;
  const why =
    structure === "n/a"
      ? `${locTxt || "no open"} (${bars.length} bar${bars.length === 1 ? "" : "s"} — location only)`
      : `${structure} · ${locTxt}`;
  return { tf, bias, structure, open, last, vsOpenPct, bars: bars.length, why, source };
}

/* ── The ladder ──────────────────────────────────────────────────────────── */

const HTF: Tf[] = ["1y", "1M", "1w", "1d"];
const MTF: Tf[] = ["4h", "1h", "30m"];
const LTF: Tf[] = ["15m", "10m", "5m", "3m", "2m", "1m", "30s"];
const SWING: Tf[] = ["1w", "1d", "4h"];
const INTRADAY: Tf[] = ["1h", "30m", "15m"];
const MICRO: Tf[] = ["10m", "5m", "3m", "2m", "1m", "30s"];
const WEIGHT: Record<Tf, number> = {
  "1y": 1,
  "1M": 1,
  "1w": 1,
  "1d": 1.25,
  "4h": 1,
  "1h": 1,
  "30m": 0.75,
  "15m": 1.5,
  "10m": 0.75,
  "5m": 1.25,
  "3m": 0.5,
  "2m": 0.5,
  "1m": 1,
  "30s": 0.5,
};

function majority(reads: TfRead[], tie: Tf | null): LadderBias {
  let bull = 0;
  let bear = 0;
  for (const r of reads) {
    if (r.source === "none") continue;
    if (r.bias === "bull") bull += WEIGHT[r.tf];
    else if (r.bias === "bear") bear += WEIGHT[r.tf];
  }
  if (bull > bear) return "bull";
  if (bear > bull) return "bear";
  const t = tie ? reads.find((r) => r.tf === tie) : null;
  return t && t.source !== "none" ? t.bias : "neutral";
}

const glyph = (b: LadderBias) => (b === "bull" ? "▲" : b === "bear" ? "▼" : "·");
const word = (b: LadderBias) => (b === "bull" ? "bull" : b === "bear" ? "bear" : "flat");

export function buildTfLadder(input: LadderInput): TfLadder {
  const { symbol, daily, m15, m1, s30 = [], nowMs } = input;
  const reads: TfRead[] = [];
  const dailyOk = daily.length > 0;
  reads.push(readRung("1y", dailyOk ? resampleCalendar(daily, "1y") : [], dailyOk ? "daily" : "none"));
  reads.push(readRung("1M", dailyOk ? resampleCalendar(daily, "1M") : [], dailyOk ? "daily" : "none"));
  reads.push(readRung("1w", dailyOk ? resampleCalendar(daily, "1w") : [], dailyOk ? "daily" : "none"));
  reads.push(readRung("1d", dailyOk ? daily : resampleMs(m15, 24 * 60 * MIN), dailyOk ? "daily" : m15.length ? "15m" : "none"));
  for (const tf of ["4h", "1h", "30m", "15m"] as Tf[]) {
    const ms = INTRADAY_MS[tf]!;
    reads.push(readRung(tf, m15.length ? resampleMs(m15, ms) : [], m15.length ? "15m" : "none"));
  }
  for (const tf of ["10m", "5m", "3m", "2m", "1m"] as Tf[]) {
    const ms = INTRADAY_MS[tf]!;
    reads.push(readRung(tf, m1.length ? resampleMs(m1, ms) : [], m1.length ? "1m" : "none"));
  }
  reads.push(readRung("30s", s30.length ? resampleMs(s30, 30_000) : [], s30.length ? "prints" : "none"));
  void nowMs;

  const by = (tfs: Tf[]) => reads.filter((r) => tfs.includes(r.tf));
  const htf = majority(by(HTF), "1d");
  const mtf = majority(by(MTF), "1h");
  const ltf = majority(by(LTF), "15m");

  // Direction from the top: the first HTF rung that has data and a lean.
  let direction: LadderBias = "neutral";
  let decidedBy: Tf | null = null;
  for (const r of by(HTF)) {
    if (r.source === "none" || r.bias === "neutral") continue;
    direction = r.bias;
    decidedBy = r.tf;
    break;
  }
  const swing = majority(by(SWING), "1d");
  const intraday = majority(by(INTRADAY), "15m");
  const micro = majority(by(MICRO), "5m");

  const w = (b: LadderBias) => direction !== "neutral" && b === direction;
  const a = (b: LadderBias) => direction !== "neutral" && b !== "neutral" && b !== direction;
  let phase: LadderPhase;
  if (direction === "neutral") phase = intraday === micro && intraday !== "neutral" ? "range" : "conflict";
  else if (w(swing) && w(intraday) && w(micro)) phase = "expansion";
  else if (w(swing) && w(intraday) && a(micro)) phase = "pullback-starting";
  else if (w(swing) && a(intraday) && w(micro)) phase = "reversal-forming";
  else if (w(swing) && a(intraday)) phase = "pullback";
  else if (a(swing) && w(intraday) && w(micro)) phase = "htf-retrace-ending";
  else if (a(swing) && (w(intraday) || w(micro))) phase = "retrace-turning";
  else if (a(swing)) phase = "deep-retrace";
  else if (w(swing)) phase = intraday === "neutral" ? "pullback" : "expansion";
  else phase = "conflict";

  let agree = 0;
  let total = 0;
  for (const r of reads) {
    if (r.source === "none") continue;
    total += WEIGHT[r.tf];
    if (direction !== "neutral" && r.bias === direction) agree += WEIGHT[r.tf];
  }
  const alignment = total > 0 ? agree / total : 0;

  const strip = `${by(HTF).map((r) => `${TF_LABEL[r.tf]}${glyph(r.bias)}`).join(" ")} | ${by(MTF).map((r) => `${TF_LABEL[r.tf]}${glyph(r.bias)}`).join(" ")} | ${by(LTF)
    .map((r) => `${TF_LABEL[r.tf]}${glyph(r.bias)}`)
    .join(" ")}`;

  const rungTxt = (r: TfRead) => `${r.tf} ${word(r.bias)}${r.structure !== "n/a" && r.structure !== "mixed" ? ` (${r.structure})` : ""}`;
  const line = (tfs: Tf[], sep: string) =>
    by(tfs)
      .filter((r) => r.source !== "none")
      .map(rungTxt)
      .join(sep);
  const htfLine = line(HTF, " → ");
  const swingLine = line(SWING, " · ");
  const intradayLine = line(INTRADAY, " · ");
  const microLine = line(MICRO, " · ");
  const zoneWord = direction === "bull" ? "discount" : "premium";

  const phaseTxt: Record<LadderPhase, string> = {
    expansion: `Swing, intraday and micro all run with the ${word(direction)} — expansion. Continuations only; a counter-${word(direction)} card is fading every rung.`,
    "pullback-starting": `Swing and intraday still with the ${word(direction)}, the micro has turned — a pullback is starting. Do not chase; let it reach the ${zoneWord}.`,
    pullback: `Swing with the ${word(direction)}, intraday against — today's leg is the pullback. Wait for the micro to turn back ${word(direction)} inside the ${zoneWord}.`,
    "reversal-forming": `Swing with the ${word(direction)}, intraday against, micro turning back — the pullback is ending. This is the with-trend entry window, in the ${zoneWord}, timed on the 5m/1m.`,
    "htf-retrace-ending": `The week/day pulled back against the ${word(direction)} year/month and the intraday and micro have turned back — the bigger with-trend window, if the swing ${zoneWord} holds.`,
    "retrace-turning": `The week/day are against the ${word(direction)} year/month and only ${w(micro) && !w(intraday) ? "the micro has" : "the intraday has"} turned back — early. Wait for ${w(micro) && !w(intraday) ? "the 15m/1h to confirm" : "the micro to agree"} before calling the retrace over.`,
    "deep-retrace": `Swing, intraday and micro all against the ${word(direction)} — a deep retrace against the year/month. Wait for the lower rungs to turn; the engine's HTF gate may be about to flip.`,
    range: "No direction from the top; the lower rungs agree with each other — a range: trade the edges, not the middle.",
    conflict: "The rungs disagree from the top down — no read. Stand until the day or the week resolves.",
  };
  const engineNote =
    input.engineTopDown && input.engineTopDown !== "neutral" && direction !== "neutral" && input.engineTopDown !== direction
      ? ` Engine HTF gate reads ${input.engineTopDown} (its own 15m/1h/4h/daily structure) while the ladder's ${decidedBy} reads ${word(direction)} — the gate rules; treat the disagreement as a ${word(direction)} year/month in a ${input.engineTopDown} swing.`
      : "";
  const summary = `${symbol} top-down: direction ${word(direction)}${decidedBy ? ` from the ${decidedBy}` : ""} (${htfLine || "HTF n/a"}). Swing ${word(swing)}: ${swingLine || "n/a"}. Intraday ${word(intraday)}: ${intradayLine || "n/a"}. Micro ${word(micro)}: ${microLine || "n/a"}. ${phaseTxt[phase]} Alignment ${(alignment * 100).toFixed(0)}%.${engineNote}`;

  const windowOpen = phase === "reversal-forming" || phase === "htf-retrace-ending" || phase === "expansion";
  const withText = windowOpen
    ? `With the trend — the window is open (${phase.replace(/-/g, " ")}); time it on the 5m/1m.`
    : phase === "pullback-starting"
      ? "With the trend but early — the micro has turned; wait for the pullback to reach the zone."
      : phase === "pullback" || phase === "deep-retrace" || phase === "retrace-turning"
        ? `With the trend, in a ${phase.replace(/-/g, " ")} — wait for the lower rungs to confirm.`
        : "With the trend — but the rungs are unresolved.";
  const againstText = "Counter-trend — the HTF gate says no.";
  const noneText = "No direction from the top — range rules only.";
  const forLongs = direction === "bull" ? withText : direction === "bear" ? againstText : noneText;
  const forShorts = direction === "bear" ? withText : direction === "bull" ? againstText : noneText;

  return { symbol, reads, direction, decidedBy, swing, intraday, micro, htf, mtf, ltf, phase, alignment, strip, summary, forLongs, forShorts };
}

/** Tags for the shadow book: each rung vs the trade's side, plus the phase. */
export function ladderTags(ladder: TfLadder | null | undefined, side: "long" | "short"): Record<string, string> {
  if (!ladder) return {};
  const want: LadderBias = side === "long" ? "bull" : "bear";
  const rel = (b: LadderBias, src: TfRead["source"]) => (src === "none" ? "n/a" : b === want ? "with" : b === "neutral" ? "flat" : "against");
  const out: Record<string, string> = {};
  for (const r of ladder.reads) out[`tf_${r.tf}`] = rel(r.bias, r.source);
  out.tf_swing = rel(ladder.swing, "daily");
  out.tf_intraday = rel(ladder.intraday, "15m");
  out.tf_micro = rel(ladder.micro, "1m");
  out.tf_phase = ladder.phase;
  out.tf_align = ladder.alignment >= 0.75 ? ">=75%" : ladder.alignment >= 0.5 ? "50–75%" : "<50%";
  out.tf_dir = ladder.direction === want ? "with" : ladder.direction === "neutral" ? "flat" : "against";
  return out;
}
