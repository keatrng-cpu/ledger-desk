/**
 * The Mead Hall, as the Floor's talk can see it. Pure: no DOM, no storage, no fetch, no model.
 *
 * The prediction signal engine (`signal-engine.ts`) already prices every Kalshi market: the fee-adjusted chance YES has to beat,
 * the spread, the depth, the move since the open and its velocity, the time to settle, how fresh the read is, an edge ONLY when a real
 * model input exists (otherwise "no edge read" and no letter), and the hall's own order (jumbotron first, then the Rune Board's five).
 * The sports scanner (`scanner.ts`) adds eight must-layers per game. This file carries a small, JSON-sized slice of all of that into
 * the talk world, and it carries it by COPYING the engine's fields (rounded for speech). It computes nothing the engine has not:
 * the one subtraction it does (`costPts`, the fee-adjusted need minus the mid) is on the engine's own two numbers, and the fee curve
 * is read by calling the engine's own fee function. The voice never recomputes.
 *
 * Narration only. Nothing here picks a winner, sizes, grades a price move, or sends: there is no order path in this file, and no
 * broker is imported. The labels follow `components/mead/mead-screens.ts` (`categoryLabel`, `eventLabel`); they are copied here
 * because that module is a canvas module and this one has to stay pure. `verify-mead-talk.mjs` proves the copy agrees with it.
 */

import {
  MAX_MODEL_AGE_MS,
  VELOCITY_WINDOW_MS,
  hallLayout,
  type MarketSignal,
  type SignalBoard,
} from "@/lib/predict/signal-engine";
import { KALSHI_MAKER_RATE, KALSHI_TAKER_RATE, VENUES, feePerContract } from "@/lib/predict/math";
import { FLB_SOURCE, MAKER_TAKER, MIN_SAMPLE_OVERALL, PRICE_BINS, TOO_FEW } from "@/lib/predict/signal-evidence";
import { PREDICTION_STALE_MS, isNflMarket } from "@/lib/predict/prediction-market-feed";
import { SCAN, type ScanRow } from "@/lib/predict/scanner";
import type { GoStats } from "@/lib/predict/go-ledger";
import type { JournalRead } from "@/lib/predict/journal";
import type { PaperScore } from "@/lib/predict/paper-scorer";
import type { HallLite, HallRecordLite, HallRowLite, HallSpan, PredictLite } from "./live-types";

/** A read older than this is not talked from at all (the poll is every ten minutes; the Floor tab's own feed is faster). */
export const HALL_TALK_MAX_SEC = 20 * 60;
/** How many markets the hall shows: the jumbotron and the Rune Board's five. */
export const HALL_ROWS = 6;

/* ── Making the engine's words speakable ───────────────────────────────── */

/**
 * Plain words for a speech engine and the spoken-form guard: no degree sign, no comparison sign, no ampersand, no dash used as a
 * pause, no slash between numbers, no abbreviation of a unit. It never changes a digit.
 */
export function sayable(s: string): string {
  let t = String(s);
  const swap = (re: RegExp, to: (m: RegExpMatchArray) => string) => {
    t = t.replace(re, (...a) => to(a as unknown as RegExpMatchArray));
  };
  t = t.replace(/°\s*F\b/g, " degrees").replace(/°/g, " degrees");
  t = t.replace(/≥\s*/g, "at least ").replace(/≤\s*/g, "at most ");
  t = t.replace(/&/g, " and ").replace(/@/g, " at ");
  t = t.replace(/(\p{L})[–—-](\p{L})/gu, "$1 $2");
  swap(/(\d+(?:\.\d+)?)\s*¢/g, (m) => `${m[1]} cents`);
  swap(/(\d)\s*[–—-]\s*(\d)/g, (m) => `${m[1]} to ${m[2]}`);
  swap(/(\d+)\s*\/\s*(\d+)/g, (m) => `${m[1]} out of ${m[2]}`);
  swap(/(\d+(?:\.\d+)?)\s*h\b/g, (m) => `${m[1]} hours`);
  swap(/(\d+(?:\.\d+)?)\s*min\b/g, (m) => `${m[1]} minutes`);
  t = t.replace(/\s+\+\s+/g, " and ");
  t = t.replace(/\s*[—–]\s*/g, ", ");
  t = t.replace(/\s*·\s*/g, ", ");
  t = t.replace(/\bYES\b/g, "yes").replace(/\bNO\b/g, "no");
  t = t.replace(/\s+/g, " ").replace(/\s+,/g, ",").replace(/,\s*,/g, ",").trim();
  return t;
}

/** Cut at a word and close with a full stop. Never leaves a half number (the cut is at a space). */
export function shorten(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  const base = (sp > n * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—]+$/, "");
  return `${base}.`;
}

/* ── The hall's labels (copied from components/mead/mead-screens.ts) ───── */

const SERIES: [RegExp, string, string][] = [
  [/^KXNFL/i, "NFL", "NFL game"],
  [/^KXNBA/i, "NBA", "NBA game"],
  [/^KXMLB/i, "MLB", "MLB game"],
  [/^KXNHL/i, "NHL", "NHL game"],
  [/^KXNCAAF/i, "NCAAF", "College football"],
  [/^KXGDP/i, "ECON", "GDP"],
  [/^KXCPI/i, "ECON", "CPI"],
  [/^KXFED|^FED/i, "ECON", "Fed decision"],
  [/^KXPAYROLL|^KXJOBS/i, "ECON", "Jobs report"],
  [/^KXBTC/i, "CRYPTO", "Bitcoin"],
  [/^KXETH/i, "CRYPTO", "Ether"],
  [/^KXHIGH(NY)?/i, "WEATHER", "NYC high temp"],
  [/^KX(SENATE|HOUSE|PRES|GOV|ELECT)|^(SENATE|HOUSE|PRES)/i, "POLITICS", "Election"],
];

/** The family tag a hall screen shows for a market (mead-screens `categoryLabel`). */
export function familyTag(id: string, event: string): string {
  for (const [re, tag] of SERIES) if (re.test(id) || re.test(event)) return tag;
  return isNflMarket({ id, event }) ? "NFL" : "MARKET";
}

const MONTH_ABBR = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ");
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const QUARTER = ["first", "second", "third", "fourth"];

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, a: string, b: string) => `${a}${b.toUpperCase()}`);

/**
 * The event as a person would say it: the family ("NFL game") and, when the event ticker carries a date, when ("on October 5").
 * A human event ("GB @ MIN") passes through as words. The raw ticker is never returned (mead-screens `eventLabel` keeps team
 * codes in it; the outcome already names the side).
 */
export function eventWords(event: string): { famSay: string; when: string | null } {
  const e = event.trim();
  if (/\s/.test(e) || !/^[A-Z0-9]+(-[A-Z0-9.]+)+$/i.test(e)) return { famSay: sayable(shorten(e, 60)), when: null };
  const [series, rest = ""] = e.split("-");
  const named = SERIES.find(([re]) => re.test(series ?? ""))?.[2];
  const famSay = named ?? titleCase((series ?? "").replace(/^KX/i, "")).replace(/(\p{L})(\d)/gu, "$1 $2");
  const d = /^(\d{2})([A-Z]{3})(\d{2})/i.exec(rest);
  if (d) {
    const mi = MONTH_ABBR.indexOf(d[2]!.toUpperCase());
    if (mi >= 0) return { famSay, when: `on ${MONTH_FULL[mi]} ${Number(d[3])}` };
  }
  const my = /^(\d{2})([A-Z]{3})$/i.exec(rest);
  if (my) {
    const mi = MONTH_ABBR.indexOf(my[2]!.toUpperCase());
    if (mi >= 0) return { famSay, when: `in ${MONTH_FULL[mi]} 20${my[1]}` };
  }
  const q = /^(\d{2})Q([1-4])/i.exec(rest);
  if (q) return { famSay, when: `for the ${QUARTER[Number(q[2]) - 1]} quarter of 20${q[1]}` };
  const y = /^(\d{2})$/.exec(rest);
  if (y) return { famSay, when: `in 20${y[1]}` };
  return { famSay, when: null };
}

/* ── Spans, bins, layers ───────────────────────────────────────────────── */

/** The same cut-offs as the engine's `durationWords`, as a number and a unit instead of a string. */
export function spanOf(ms: number | null): HallSpan | null {
  if (ms == null || !(ms > 0)) return null;
  const m = ms / 60_000;
  if (m < 60) {
    const n = Math.max(1, Math.round(m));
    return { n, unit: n === 1 ? "minute" : "minutes" };
  }
  const h = m / 60;
  if (h < 48) {
    const n = Number(h.toFixed(h < 10 ? 1 : 0));
    return { n, unit: n === 1 ? "hour" : "hours" };
  }
  const n = Math.round(h / 24);
  return { n, unit: n === 1 ? "day" : "days" };
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const cents = (x: number | null | undefined): number | null => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100));
const cents1 = (x: number | null | undefined): number | null => (x == null || !Number.isFinite(x) ? null : r1(x * 100));

/** The sports scanner's layer ids, said as a person would. */
export const LAYER_SAY: Record<string, string> = {
  reference: "the reference price",
  price: "the price",
  longshot: "the longshot floor",
  late: "the late game rule",
  liquidity: "liquidity",
  second: "the second market",
  qb: "the quarterback news",
  held: "holding for a second look",
};

function scanOf(row: ScanRow | undefined): HallRowLite["scan"] {
  if (!row) return null;
  const failing = row.layers.filter((l) => !l.ok);
  return {
    passed: row.layers.length - failing.length,
    total: row.layers.length,
    clears: failing.length === 0,
    miss: failing[0]?.id ?? null,
    limitC: cents(row.limit),
    askC: cents(row.ask),
    gapC: cents1(row.gap),
    ref: row.refName ? sayable(shorten(row.refName, 50)) : null,
    live: row.phase === "in",
  };
}

/* ── One row ───────────────────────────────────────────────────────────── */

function rowOf(s: MarketSignal, slot: number, ageSec: number, scan: ScanRow | undefined): HallRowLite {
  const { famSay, when } = eventWords(s.event);
  const needsYes = s.implied.feeAdjustedYes == null ? null : r1(s.implied.feeAdjustedYes * 100);
  const needsNo = s.implied.feeAdjustedNo == null ? null : r1(s.implied.feeAdjustedNo * 100);
  const midC = cents1(s.implied.mid);
  const bin = s.priceBin ? PRICE_BINS.find((b) => b.id === s.priceBin) : undefined;
  const e = s.edge;
  const why = s.reasons
    .filter((r) => (r.effect === "cap" || r.effect === "down") && !/^No edge read/i.test(r.text))
    .slice(0, 2)
    .map((r) => shorten(sayable(r.text), 110));
  const askSize = s.liquidity.askSize;
  const spreadC = s.spread.cents;
  const conds = {
    model: e.status === "edge",
    edge: e.status === "edge" && e.netPerContract > 0,
    fresh: !s.freshness.stale && ageSec <= PREDICTION_STALE_MS / 1000,
    depth: askSize != null && askSize >= SCAN.minDepth && spreadC != null && spreadC <= Math.round(SCAN.maxSpread * 100),
  };
  return {
    id: s.id,
    slot,
    fam: familyTag(s.id, s.event),
    famSay,
    when,
    outcome: sayable(shorten(s.outcome, 48)),
    nfl: s.nfl,
    yesAskC: cents(s.prices.yesAsk),
    yesBidC: cents(s.prices.yesBid),
    noAskC: cents(s.prices.noAsk),
    midC,
    needsYesPct: needsYes,
    needsNoPct: needsNo,
    costPts: needsYes != null && midC != null ? r1(needsYes - midC) : null,
    feeYesC: s.implied.feeYes == null ? null : r2(s.implied.feeYes * 100),
    spreadC,
    liq: s.liquidity.word,
    liqScore: s.liquidity.score,
    askSize: askSize == null ? null : Math.round(askSize),
    moveC: cents1(s.move.sinceOpen),
    moveBasis: s.move.basis,
    velCph: s.move.velocityCentsPerHour == null ? null : r1(s.move.velocityCentsPerHour),
    velHours: s.move.velocityWindowHours,
    velPoints: s.move.points,
    settle: spanOf(s.settlement.msToSettle),
    phase: s.settlement.phase,
    fresh: s.freshness.word,
    stale: s.freshness.stale,
    staleReason: s.freshness.staleReason,
    basis: s.freshness.priceBasis,
    edgeStatus: e.status === "edge" ? "edge" : "no edge read",
    edge:
      e.status === "edge"
        ? { side: e.side, netC: r1(e.netPerContract * 100), modelPct: r1((e.side === "yes" ? e.modelProb : 1 - e.modelProb) * 100), needPct: e.side === "yes" ? needsYes : needsNo, modelSrc: sayable(shorten(e.modelSource, 60)) }
        : null,
    noEdgeWhy: e.status === "edge" ? null : sayable(shorten(e.reason, 120)),
    grade: s.grade,
    score: s.score,
    gradedSide: s.gradedSide,
    gradedAskC: cents(s.gradedSide === "yes" ? s.prices.yesAsk : s.prices.noAsk),
    bin: bin ? { id: bin.id, loC: Math.round(bin.lo * 100), hiC: Math.round(Math.min(bin.hi, 1) * 100), points: bin.gradePoints, cap: bin.cap } : null,
    why,
    scan: scanOf(scan),
    conds,
    condsMet: Object.values(conds).filter(Boolean).length,
  };
}

/* ── The crowd (copied from components/mead/mead-signal-feed.ts `reactionForCrowd`) ── */

export function crowdReaction(energy: number | null, basedOn: number, mood: string): "cheer" | "groan" | "hail" | null {
  if (energy == null || basedOn === 0) return null;
  if (mood === "surging") return energy >= 0.6 ? "hail" : "cheer";
  if (mood === "sliding") return "groan";
  return null;
}

/* ── The paper side ────────────────────────────────────────────────────── */

/** The Predict tab's go ledger, the trader's journal and the analyzer's paper book, in one small record. Pure over the three reads. */
export function recordLiteFrom(go: GoStats, journal: JournalRead, paper: PaperScore): HallRecordLite {
  const ok = paper.overall.read === "ok" ? paper.overall : null;
  return {
    goN: go.n,
    goSettled: go.settled,
    goWins: go.wins,
    goNet: go.net,
    jOpen: journal.open.length,
    jClosed: journal.closed,
    jNet: journal.net,
    paperTickets: paper.tickets,
    paperOpen: paper.open,
    paperSettled: paper.settled,
    paperRead: ok ? "ok" : TOO_FEW,
    paperHitPct: ok ? Math.round(ok.hitRate * 100) : null,
    minSettled: paper.minSample.overall || MIN_SAMPLE_OVERALL,
  };
}

/* ── The board ─────────────────────────────────────────────────────────── */

export interface HallLiteInput {
  board: SignalBoard;
  nowMs: number;
  /** The sports scanner's rows from the same poll, with when they were read (ISO). Older than the engine's model window → ignored. */
  scan?: ScanRow[] | null;
  scanAsOf?: string | null;
  /** A failed pull kept this board. */
  held?: boolean;
  record?: HallRecordLite | null;
}

const sourceName = (board: SignalBoard): string => (board.source === "kalshi" ? "Kalshi" : sayable(shorten(board.label, 40)));

/** Authors and year out of the engine's citation ("Bürgi, Deng & Whelan (2025) …"). */
function flbCitation(): { authors: string; year: number } {
  const m = /^(.+?)\s*\((\d{4})\)/.exec(FLB_SOURCE);
  return { authors: sayable(m?.[1] ?? "the cited paper"), year: Number(m?.[2] ?? 0) };
}

/**
 * The hall's board, as the talk sees it. Order, crowd and ranking are the engine's own `hallLayout`; the six rows are the
 * jumbotron and the Rune Board. `ageSec` is measured at `nowMs`, so the same board gets older as the Floor keeps it.
 */
export function hallLiteFrom(i: HallLiteInput): HallLite {
  const { board, nowMs } = i;
  const layout = hallLayout(board);
  const head = [layout.jumbotron, ...layout.runeBoard].filter((s): s is MarketSignal => s != null).slice(0, HALL_ROWS);
  const asOfMs = Date.parse(board.asOf);
  const ageSec = Number.isFinite(asOfMs) ? Math.max(0, Math.round((nowMs - asOfMs) / 1000)) : Number.POSITIVE_INFINITY;
  const scanMs = i.scanAsOf ? Date.parse(i.scanAsOf) : NaN;
  const scanAge = Number.isFinite(scanMs) ? Math.max(0, Math.round((nowMs - scanMs) / 1000)) : null;
  const scanUsable = i.scan && i.scan.length && scanAge != null && scanAge * 1000 <= MAX_MODEL_AGE_MS;
  const byKey = new Map<string, ScanRow>();
  if (scanUsable) for (const r of i.scan!) byKey.set(r.key, r);
  const fees = VENUES[board.feeModel] ?? VENUES.kalshi;
  const isKalshi = fees.id === "kalshi";
  const cite = flbCitation();
  const c = layout.crowd;
  return {
    asOf: board.asOf,
    ageSec: Number.isFinite(ageSec) ? ageSec : 24 * 3600,
    source: sourceName(board),
    label: sayable(shorten(board.label, 80)),
    staleSec: PREDICTION_STALE_MS / 1000,
    talkMaxSec: HALL_TALK_MAX_SEC,
    stale: board.stale || !(ageSec <= PREDICTION_STALE_MS / 1000),
    old: !(ageSec <= HALL_TALK_MAX_SEC),
    held: Boolean(i.held),
    partial: Boolean(board.deadlineExceeded),
    skipped: board.skipped?.length ?? 0,
    reason: board.reason ? sayable(shorten(board.reason, 120)) : null,
    total: board.signals.length,
    counts: { ...board.counts },
    ungraded: board.ungraded,
    noEdge: board.noEdgeCount,
    modeled: board.signals.length - board.noEdgeCount,
    crowd: { mood: c.mood, energyPct: c.energy == null ? null : Math.round(c.energy * 100), basedOn: c.basedOn, reaction: crowdReaction(c.energy, c.basedOn, c.mood), reason: sayable(shorten(c.reason, 110)) },
    fee: {
      takerPct: isKalshi ? r2(KALSHI_TAKER_RATE * 100) : 0,
      makerPct: isKalshi ? r2(KALSHI_MAKER_RATE * 100) : 0,
      peakPriceC: 50,
      peakC: r2(feePerContract(0.5, 100, fees) * 100),
      lowPriceC: 10,
      lowC: r2(feePerContract(0.1, 100, fees) * 100),
      slipC: Math.round(board.slippage * 100),
    },
    flb: {
      authors: cite.authors,
      year: cite.year,
      takerLossPct: Math.round(-MAKER_TAKER.takerPostFee * 100),
      makerLossPct: Math.round(-MAKER_TAKER.makerPostFee * 100),
    },
    rules: {
      modelMaxMin: Math.round(MAX_MODEL_AGE_MS / 60_000),
      staleSec: PREDICTION_STALE_MS / 1000,
      minDepth: SCAN.minDepth,
      maxSpreadC: Math.round(SCAN.maxSpread * 100),
      velWindowH: VELOCITY_WINDOW_MS / 3_600_000,
      minSettled: MIN_SAMPLE_OVERALL,
    },
    rows: head.map((s, k) => rowOf(s, k, ageSec, byKey.get(s.id))),
    scanned: scanUsable ? i.scan!.length : 0,
    scanAgeSec: scanUsable ? scanAge : null,
    record: i.record ?? null,
  };
}

/** The study pass's prediction rows, from the same board: a readable event, the YES ask in cents, and the engine's letter or null. */
export function predictLiteFromBoard(board: SignalBoard, nowMs = Date.now()): PredictLite {
  const hall = hallLiteFrom({ board, nowMs });
  return {
    asOf: board.asOf,
    source: hall.source,
    reason: hall.rows.length ? (board.reason ? hall.reason : null) : (hall.reason ?? "The prediction feed returned no priced markets."),
    rows: hall.rows.map((r) => ({ event: `${r.famSay}${r.when ? ` ${r.when}` : ""}`, outcome: r.outcome, yesCents: r.yesAskC, grade: r.grade })),
  };
}

/** How a row is named aloud: "NFL game on October 5, Minnesota". */
export function subjectOf(r: Pick<HallRowLite, "famSay" | "when" | "outcome">): string {
  return `${r.famSay}${r.when ? ` ${r.when}` : ""}, ${r.outcome}`;
}
