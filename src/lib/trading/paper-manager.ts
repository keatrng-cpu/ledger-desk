/**
 * One-click paper trading + auto management from live desk prices.
 * No auth required — localStorage book. Optional server journal when logged in.
 *
 * System rules:
 * - Entry at the plan's CE when the sequence priced one, else the zone mid
 * - Stop from the plan (card-plan.ts), else a structural invalidation on the
 *   correct side; out-of-band geometry is refused, not clamped
 * - Target ≥ 1R (prefer structure target if valid)
 * - Size from grade × paper equity (micros)
 * - Scale-out: 50% at TP1 (the plan's draw) → BE, runner to TP2
 * - Exit when live print hits stop / targets
 * - Time / context stops + dynamic targets from the draw (trading/management.ts)
 * - One book per day — MNQ or ES, never both (profit-rules.ts rule 1)
 */

import {
  APLUS_RULES,
  CONTRACTS,
  sizeContracts,
  type ContractKey,
  type RiskGrade,
} from "@/lib/aplus/config";
import { tradingDayStart } from "@/lib/journal/risk";
import type { SetupCandidate } from "./scanner";
import { getPaperAccount, PAPER_START_EQUITY } from "./paper-account";
import {
  ingestPaperFill,
  rememberPaperOpen,
  setOpenPaperCount,
} from "./desk-memory";
import { MAX_RISK_PTS } from "./simulate-path-trade";
import {
  emptyBookCounters,
  monthKeyFromMs,
  resolveRiskGradeForTake,
  type BookCounters,
} from "./profit-rules";
import { QUOTE_EXECUTION_MAX_LAG_SEC } from "@/lib/market/types";
import type { DrawRead } from "./draw";
import type { NewsEvent } from "./news";
import { getSessionClock, isJudasWindow } from "./sessions";
import { readJudas } from "./judas-window";
import { cardSizeRefusal } from "./card-plan";
import { PROGRESS_R, retarget, shouldFlatten } from "./management";
import { debriefPaper, pushDebrief, type TradeDebrief } from "./trade-debrief";


const STORAGE_KEY = "ledger-paper-trades-v1";

/**
 * The BOOK a symbol belongs to. MNQ and NQ are one book, MES and ES another —
 * the micro is the same instrument at 1/10th the multiplier, so holding both
 * is not diversification. Used by the one-book-per-day rule.
 */
export function bookRoot(symbol: string): string {
  return symbol.replace(/^M(?=NQ$|ES$)/, "");
}

export type PaperStatus = "open" | "closed";

export interface PaperTrade {
  id: string;
  symbol: ContractKey;
  displaySymbol: string;
  side: "long" | "short";
  status: PaperStatus;
  entry: number;
  stop: number;
  /** Working stop (moves to BE after TP1) */
  workingStop: number;
  tp1: number;
  tp2: number;
  contracts: number;
  contractsOpen: number;
  riskPts: number;
  riskPct: number;
  riskDollars: number;
  grade: string;
  score: number;
  strategy: string;
  openedAt: number;
  closedAt?: number;
  exit?: number;
  exitReason?: string;
  rMultiple?: number;
  pnlUsd?: number;
  scaleLegs: { at: string; price: number; contracts: number; r: number; note: string }[];
  reason: string;
  pathBand?: string;
  /**
   * The band the CARD carried, before rule 5's A+ probe demotion touched
   * `grade`. `grade` is the sizing grade — the A+ probe rewrites it to "A" —
   * so it can no longer answer "was this an A+ setup", and that question is
   * what the n>=20 unlock counts. `pathBand` answers it whenever the candidate
   * supplied one; this is the fallback for the cards that do not, which before
   * the probe existed were identifiable from `grade` alone.
   *
   * Absent on every record written before 2026-09-23 — those are read through
   * `pathBand` / `grade`, which for them still carry the card's own band.
   */
  cardBand?: string;
  /** Already pushed into desk-memory brain rates */
  ingested?: boolean;
  /**
   * Killzone id at entry — read by the time stop (management.ts) to know when
   * the window the idea was taken in has closed. Optional: records written
   * before Phase B simply skip that rule.
   */
  killzone?: string;
  /**
   * Discretion multiplier actually applied to size at open (journal/discretion.ts).
   * 1.0 (or absent, for records logged before this existed) means neutral —
   * no measured-history adjustment. Recorded for audit: "why was this sized
   * at 0.75x" should always be answerable from the trade itself.
   */
  discretionFactor?: number;
  /**
   * Max favourable excursion so far, in R. A PRICE ratio used only by the
   * no-progress time stop — NOT the booked R, which is net of commission
   * (see finalizeClose).
   */
  mfeR?: number;
  /**
   * Latest management note — a re-target or the time/context stop that closed
   * the trade. Kept off `reason` (which is the entry thesis as mirrored to
   * desk_trades) so neither field grows without bound.
   */
  manageNote?: string;
  /** Post-trade analysis — written on close, read by brain + Trade tab. */
  debrief?: TradeDebrief;
}

function parseNums(text: string | undefined | null): number[] {
  if (!text) return [];
  return [...text.matchAll(/(\d{3,7}(?:\.\d+)?)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function zoneMid(entryZone: string): number | null {
  const nums = parseNums(entryZone);
  if (nums.length >= 2) return (nums[0]! + nums[1]!) / 2;
  if (nums.length === 1) return nums[0]!;
  return null;
}

function firstPrice(s: string | undefined): number | null {
  const n = parseNums(s)[0];
  return n ?? null;
}

function tickRound(symbol: string, px: number): number {
  const key = (symbol in CONTRACTS ? symbol : "MNQ") as ContractKey;
  const tick = CONTRACTS[key]?.tick ?? 0.25;
  return Math.round(px / tick) * tick;
}

function resolveContractSymbol(symbol: string): ContractKey {
  const key = (symbol in CONTRACTS ? symbol : "MNQ") as ContractKey;
  if (APLUS_RULES.useMicros) {
    const micro = CONTRACTS[key].micro as ContractKey;
    if (micro in CONTRACTS) return micro;
  }
  return key;
}

export interface BuiltPaperLevels {
  symbol: ContractKey;
  displaySymbol: string;
  side: "long" | "short";
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  riskPts: number;
  contracts: number;
  riskPct: number;
  riskDollars: number;
  /**
   * The grade the SIZE came from. For an A+ card this is "A" until the book
   * earns full size (rule 5), which is why it is reported separately from
   * `cardGrade` — a ticket that printed "A+" beside a 2% risk figure would
   * read as a bug rather than as the probe.
   */
  grade: RiskGrade | string;
  /** The band the card was graded at, untouched by the A+ probe demotion. */
  cardGrade: RiskGrade | string;
  /** Discretion multiplier actually applied to size (journal/discretion.ts). 1.0 = neutral / none supplied. */
  discretionFactor: number;
  /**
   * Why nothing should be SIZED from these levels, or null (card-plan.ts
   * cardSizeRefusal — the same words the entry ticket prints). The levels are
   * still returned so a dialog can show them; `contracts` is still >= 1 for
   * callers that predate the field. Anything that opens a position must check
   * this first.
   */
  refusal: string | null;
  /** Where the stop came from: the priced plan, a structural level, or a pad. */
  stopSource: "plan" | "structure" | "fallback";
}

/**
 * The A+ sample, counted off the paper book, for rule 5's probe check.
 *
 * Rule 5 (profit-rules.ts) sizes an A+ card at the A probe until the book has
 * earned full size — n>=20 closed A+ trades at WR>=65%. The paper book is that
 * sample, so it is also the only thing that can answer the question, and it
 * has to answer synchronously: levels are built during a click, with no await
 * to spend on a round trip.
 *
 * ONLY the two A+ fields are real. The rest keep their empty values because
 * nothing on rule 5's path reads them, and a half-guessed `pathThisMonth`
 * here is exactly the kind of number a later caller would mistake for the
 * month cap. A caller that needs the whole set passes its own (the server
 * reads all of it from `desk_trades` — journal/server.ts readBookCounters).
 *
 * Counted the way the backtest counts (session-backtest.ts registerTake):
 * resolved trades only, keyed on the CARD's band and never on the sizing
 * grade. Keying on the sizing grade would let the demotion delete the sample
 * that lifts it — an A+ card booked as "A" would never count toward the 20.
 *
 * Off the browser (SSR, replay harness, scripts) the book reads empty and the
 * probe therefore holds. An unknown history is not an unlock.
 */
export function paperAPlusCounters(now = Date.now()): BookCounters {
  const counters = emptyBookCounters(monthKeyFromMs(now));
  for (const t of loadPaperTrades()) {
    if (t.status !== "closed" || t.rMultiple == null) continue;
    if ((t.pathBand || t.cardBand || t.grade) !== "A+") continue;
    counters.aPlusTaken += 1;
    if (t.rMultiple > 0) counters.aPlusWins += 1;
  }
  return counters;
}

/**
 * Build correct key-area levels + contract size from a scanner setup.
 *
 * `discretionMult` — real measured-edge sizing multiplier from
 * journal/discretion.ts, keyed by the caller to this candidate's strategy
 * and fetched server-side (getDiscretionState). Optional and defaults to
 * neutral (1.0) so every existing caller keeps its current behavior until
 * it is explicitly wired up.
 *
 * `counters` — the book the A+ probe is judged against. Defaults to the paper
 * book (`paperAPlusCounters`), which is the sample the unlock is written
 * against. A caller holding authoritative counters — the server, which reads
 * them from `desk_trades`, or a replay driving its own book — passes them
 * rather than letting a ticket be sized off whatever happens to be in this
 * browser's localStorage.
 */
export function buildPaperLevels(
  c: SetupCandidate,
  equity?: number,
  lastPrice?: number,
  discretionMult?: number,
  counters?: BookCounters,
): BuiltPaperLevels {
  const displaySymbol = c.symbol;
  const symbol = resolveContractSymbol(c.symbol);
  const side = c.side;
  const eq = equity ?? getPaperAccount().equity ?? PAPER_START_EQUITY;

  const refusal = cardSizeRefusal(c);
  const plan = c.plan ?? null;

  let entry =
    plan?.entry ??
    zoneMid(c.entryZone) ??
    firstPrice(c.entryZone) ??
    lastPrice ??
    0;

  // Prefer live mid if zone is far from last print (stale array). Never for
  // a priced plan: its entry is a resting limit at CE, and moving it to the
  // print is the chase the entry rule forbids.
  if (!plan && lastPrice != null && entry > 0) {
    const dist = Math.abs(entry - lastPrice);
    const maxRisk = MAX_RISK_PTS[c.symbol] ?? MAX_RISK_PTS[symbol] ?? 48;
    if (dist > maxRisk * 1.5) {
      entry = lastPrice; // enter at market / key print near array
    }
  }

  const inv = plan ? plan.stop : c.stopSource === "none" ? null : firstPrice(c.invalidation);
  const maxRisk =
    MAX_RISK_PTS[c.symbol] ?? MAX_RISK_PTS[symbol] ?? DEFAULT_MAX(symbol);

  let stop: number;
  const stopSource: BuiltPaperLevels["stopSource"] = plan
    ? "plan"
    : inv != null && (side === "long" ? inv < entry : inv > entry)
      ? "structure"
      : "fallback";
  if (plan) {
    stop = plan.stop;
  } else if (inv != null) {
    stop =
      side === "long"
        ? Math.min(inv, entry - entry * 0.0004)
        : Math.max(inv, entry + entry * 0.0004);
  } else {
    const pad = Math.min(maxRisk * 0.5, entry * 0.001);
    stop = side === "long" ? entry - pad : entry + pad;
  }

  let riskPts = Math.abs(entry - stop);
  if (!plan && riskPts < entry * 0.0004) {
    riskPts = Math.max(maxRisk * 0.25, entry * 0.0006);
    stop = side === "long" ? entry - riskPts : entry + riskPts;
  }
  if (!plan && riskPts > maxRisk) {
    riskPts = maxRisk;
    stop = side === "long" ? entry - riskPts : entry + riskPts;
  }

  // Targets: ALWAYS honor structure TP when on correct side of entry.
  // Old 0.9R gate dropped user TPs like 7770 (~0.8R) and left synthetic 7767 —
  // so live never "took" the planned target.
  const allTps = (c.targets || [])
    .flatMap((s) => parseNums(s))
    .filter((n) => Number.isFinite(n) && n > 0);
  const below = allTps.filter((n) => n < entry).sort((a, b) => b - a); // near → deep
  const above = allTps.filter((n) => n > entry).sort((a, b) => a - b);
  // Short: TP1 = nearest target below entry; TP2 = deepest (session low)
  // Long: TP1 = nearest above; TP2 = highest
  const t1raw =
    side === "short"
      ? (below[0] ?? firstPrice(c.targets[0]))
      : (above[0] ?? firstPrice(c.targets[0]));
  const t2raw =
    side === "short"
      ? (below[below.length - 1] ?? firstPrice(c.targets[1]))
      : (above[above.length - 1] ?? firstPrice(c.targets[1]));
  let tp1 = side === "long" ? entry + riskPts : entry - riskPts;
  let tp2 = side === "long" ? entry + riskPts * 2 : entry - riskPts * 2;
  const planT1 = plan?.t1 ?? null;
  const planT2 = plan?.t2 ?? null;

  if (planT1 != null && (side === "long" ? planT1 > entry : planT1 < entry)) {
    // The plan's T1 is the draw the target layer graded — it wins outright.
    tp1 = planT1;
  } else if (t1raw != null) {
    const ok = side === "long" ? t1raw > entry : t1raw < entry;
    const r = Math.abs(t1raw - entry) / Math.max(riskPts, 1e-6);
    // Accept any correct-side target from 0.35R up to tpMaxR (user plan wins)
    if (ok && r >= 0.35 && r <= APLUS_RULES.tpMaxR + 0.25) {
      tp1 = t1raw;
    }
  }
  if (planT2 != null && (side === "long" ? planT2 > tp1 : planT2 < tp1)) {
    tp2 = planT2;
  } else if (t2raw != null) {
    const ok = side === "long" ? t2raw > entry : t2raw < entry;
    const r = Math.abs(t2raw - entry) / Math.max(riskPts, 1e-6);
    if (
      ok &&
      r > Math.abs(tp1 - entry) / Math.max(riskPts, 1e-6) * 0.95 &&
      r <= APLUS_RULES.tpMaxR + 0.5
    ) {
      tp2 = t2raw;
    }
  }

  // Geometry guard (never invert)
  if (side === "short" && tp1 >= entry) tp1 = entry - riskPts;
  if (side === "long" && tp1 <= entry) tp1 = entry + riskPts;
  if (side === "short" && tp2 >= tp1) tp2 = Math.min(tp1 - riskPts * 0.5, entry - riskPts * 2);
  if (side === "long" && tp2 <= tp1) tp2 = Math.max(tp1 + riskPts * 0.5, entry + riskPts * 2);

  entry = tickRound(symbol, entry);
  stop = tickRound(symbol, stop);
  tp1 = tickRound(symbol, tp1);
  tp2 = tickRound(symbol, tp2);
  riskPts = Math.abs(entry - stop);

  /**
   * RULE 5 — an A+ card is sized at the A probe until the book earns full size.
   *
   * This line used to size straight off the card's band, and `riskByGrade`
   * prices A+ at 3%. So every A+ paper fill risked $3,000 of the $100,000 book
   * where the hard rule says $2,000 — a 50% oversize, on the one card type
   * whose win rate is what earns the 3% in the first place. The unlock needs
   * n>=20 A+ at WR>=65% and the book has 4, so full size was being spent
   * before it was earned, and every A+ R in the sample was measured at a size
   * nobody was entitled to trade.
   *
   * The backtest has always routed through `resolveRiskGradeForTake`
   * (session-backtest.ts) and the shadow book through `APLUS_PROBE_RISK`
   * (shadow-book.ts). The paper book was the only one sizing off the raw band,
   * which meant the three books were not measuring the same system. Rule 5
   * lives in ONE function so that when the unlock flips, all of them follow it
   * on the same tick.
   *
   * Guarded on A+ rather than applied to every card: `resolveRiskGradeForTake`
   * re-resolves the band itself and answers "skip" to anything it does not
   * recognise, which would re-size the unbanded cards this function has always
   * defaulted to A-. The probe is the only rule being imported here.
   *
   * `cardGrade` stays the card's own band. The demotion is a SIZING decision —
   * it does not re-grade the setup, and the A+ sample must still be able to
   * find this trade.
   */
  const cardGrade = (c.riskGrade || c.pathBand || c.grade || "A-") as RiskGrade;
  const grade: RiskGrade =
    cardGrade === "A+"
      ? resolveRiskGradeForTake(c, counters ?? paperAPlusCounters())
      : cardGrade;
  const sizing = sizeContracts({
    symbol,
    riskPts,
    equity: eq,
    gradeOrScore: grade === "skip" ? "B+" : grade,
    discretionMult,
  });

  return {
    symbol,
    displaySymbol,
    side,
    entry,
    stop,
    tp1,
    tp2,
    riskPts,
    contracts: Math.max(1, sizing.contracts),
    riskPct: sizing.riskPct,
    riskDollars: sizing.riskDollars,
    grade,
    cardGrade,
    discretionFactor: discretionMult ?? 1.0,
    refusal,
    stopSource,
  };
}

function DEFAULT_MAX(symbol: string): number {
  if (symbol.includes("ES") || symbol === "MES") return 18;
  return 48;
}

export function loadPaperTrades(): PaperTrade[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PaperTrade[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePaperTrades(trades: PaperTrade[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trades.slice(0, 200)));
  window.dispatchEvent(new Event("ledger-paper"));
  window.dispatchEvent(new Event("ledger-memory"));
}

export function listOpenPaperTrades(): PaperTrade[] {
  return loadPaperTrades().filter((t) => t.status === "open");
}

/**
 * Rule 1 of profit-rules.ts — ONE BOOK PER DAY.
 *
 * Returns the book already taken this trading day (18:00 ET roll, same
 * boundary as the live risk governor), or null when the day is still open.
 * Open OR closed counts: the rule caps how many correlated ideas the day
 * gets, not how many are running at once.
 *
 * WHY PAPER ENFORCES THIS AND NOT THE REST OF THE GATE
 * Paper exists to build the sample, so it is deliberately exempt from the
 * halt, the ~9/month PATH cap and the loss-streak cool-down — those cap the
 * RATE at which evidence accumulates, and Phase C needs n≥30 before any of it
 * can be read. One-book-per-day is a different kind of rule: NQ and ES are
 * ~0.9 correlated, so taking both is one idea at double risk. A paper record
 * that quietly allowed it would overstate diversification and understate
 * drawdown — it would be evidence for a book nobody would actually run. The
 * cap on the sample RATE is a cost; a cap on its HONESTY is not acceptable.
 * (Live enforces the whole gate — see journal/server.ts openTrade.)
 */
export function bookTakenToday(now = Date.now()): {
  book: string;
  symbol: string;
  /** The side already taken. Needed because the rule is about BIAS, not book. */
  side: "long" | "short" | null;
  at: number;
} | null {
  const dayStart = tradingDayStart(new Date(now)).getTime();
  for (const t of loadPaperTrades()) {
    if (t.openedAt < dayStart || t.openedAt > now) continue;
    const side = t.side === "short" || t.side === "long" ? t.side : null;
    return { book: bookRoot(t.displaySymbol), symbol: t.displaySymbol, side, at: t.openedAt };
  }
  return null;
}

/**
 * One-click open paper trade from setup — no dialog.
 */
export function openPaperTradeInstant(
  c: SetupCandidate,
  opts?: {
    lastPrice?: number;
    killzone?: string;
    discretionMult?: number;
    /** Age of `lastPrice`. Required for a fill to be honest; omitted = unknown = refused. */
    lagSec?: number;
    /** Wall-clock ET at the click; Judas is a no-entry window for paper too. */
    et?: { hour: number; minute: number };
    newsVerdict?: "blackout" | "caution" | "clear" | string;
    /**
     * The timeframe bundle for THIS book (allSeries(m15, m1)).
     *
     * Only the Judas release reads it, and only the sub-15m rungs. Omit it
     * and the window refuses exactly as it always did — the fill path fails
     * closed, which is the right default for the one place that writes a
     * position into the book.
     */
    rungs?: Parameters<typeof readJudas>[0];
  },
): { ok: true; trade: PaperTrade } | { ok: false; error: string } {
  try {
    // The paper book is the ONLY sample behind the n>=20 A+ unlock, the brain
    // rates and every scoreboard. Until 2026-09-16 this button bypassed every
    // hard gate but one-book: a click during Judas, in a news blackout, on a
    // C-grade counter-HTF card, at a 600s-old Yahoo print wrote a fill that
    // stats treated as a rule-compliant PATH trade. A sample that can be
    // corrupted on demand says nothing about edge, so the gates live HERE,
    // not only in the UI.
    const band = String(c.pathBand || c.grade || "");
    if (!c.actionable && !["A+", "A", "A-", "A−", "B+"].includes(band)) {
      return {
        ok: false,
        error: `${c.symbol} ${c.side} is ${band || "ungraded"} and not actionable — journal it as a skip, it is not a paper trade.`,
      };
    }
    if (opts?.lagSec == null || !Number.isFinite(opts.lagSec)) {
      return { ok: false, error: "No quote age on this fill — refusing to book at an unknown lag." };
    }
    if (opts.lagSec > QUOTE_EXECUTION_MAX_LAG_SEC) {
      return {
        ok: false,
        error: `Quote ${Math.round(opts.lagSec)}s old (> ${QUOTE_EXECUTION_MAX_LAG_SEC}s) — a fill on a stale print is an invented fill.`,
      };
    }
    if (opts.et && isJudasWindow(opts.et.hour, opts.et.minute)) {
      // Blocked until the open's manipulation has demonstrably failed on a
      // sub-15m rung, then released for the side the failed raid points at
      // (judas-window.ts). Without `rungs` this cannot resolve and refuses,
      // which is the same answer this line has always given.
      const j = readJudas(
        opts.rungs,
        { etHour: opts.et.hour, etMinute: opts.et.minute },
        c.side === "short" ? "short" : "long",
      );
      if (j.blocked) {
        return { ok: false, error: `${j.reason} (paper included).` };
      }
    }
    if (opts.newsVerdict === "blackout") {
      return { ok: false, error: "News blackout — the impulse is the release, not the model." };
    }
    // Rule 1 — one book per day. Checked BEFORE any level math so the message
    // names the conflict rather than a downstream geometry failure.
    // Rule 1 — one book per day, and the rule is about BIAS.
    //
    // CLAUDE.md: "MNQ or ES, never both SAME BIAS." This used to refuse any
    // second book regardless of side, which contradicted the written rule and
    // — more to the point — contradicted the reason given in its own error
    // message. MNQ long + ES long is genuinely one idea at double risk. MNQ
    // long + ES SHORT is the opposite: it is the SMT divergence trade the
    // desk grades for, and it carries less directional risk than either leg
    // alone, not more.
    //
    // Measured over four years: 10 refusals, 8 same-bias (correctly refused)
    // and 2 opposite-bias (refused by accident). Worth +0.02R pooled and
    // nothing out-of-sample — this is a correctness fix, not a money one, and
    // it is made because code and doc disagreeing is how a desk stops being
    // able to trust either.
    const taken = bookTakenToday();
    const sameBias = taken?.side != null && taken.side === c.side;
    if (taken && taken.book !== bookRoot(c.symbol) && sameBias) {
      return {
        ok: false,
        error: `One book per day: already took ${taken.symbol} ${taken.side} this session (since 18:00 ET). ${c.symbol} ${c.side} is a second correlated book on the SAME bias — that is one idea at double risk, not two trades.`,
      };
    }
    const levels = buildPaperLevels(
      c,
      getPaperAccount().equity,
      opts?.lastPrice,
      opts?.discretionMult,
    );
    if (!levels.entry || !levels.stop) {
      return { ok: false, error: "Could not resolve entry/stop from setup" };
    }
    // Validate geometry
    if (levels.side === "long" && levels.stop >= levels.entry) {
      return { ok: false, error: "Stop not below entry for long" };
    }
    if (levels.side === "short" && levels.stop <= levels.entry) {
      return { ok: false, error: "Stop not above entry for short" };
    }
    if (levels.side === "long" && levels.tp1 <= levels.entry) {
      return { ok: false, error: "Target not above entry for long" };
    }
    if (levels.side === "short" && levels.tp1 >= levels.entry) {
      return { ok: false, error: "Target not below entry for short" };
    }
    // Same refusal the entry ticket prints. The paper book is the record of
    // what the desk would actually trade; a geometry the ticket will not size
    // is not that, and the shadow book already paper-trades refusals as
    // evidence, where they cannot be mistaken for the system.
    if (levels.refusal) {
      return {
        ok: false,
        error: `DO NOT SIZE — ${levels.refusal}. Not booked to paper either: the shadow book records refusals.`,
      };
    }

    const trade: PaperTrade = {
      id: `paper-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      symbol: levels.symbol,
      displaySymbol: levels.displaySymbol,
      side: levels.side,
      status: "open",
      entry: levels.entry,
      stop: levels.stop,
      workingStop: levels.stop,
      tp1: levels.tp1,
      tp2: levels.tp2,
      contracts: levels.contracts,
      contractsOpen: levels.contracts,
      riskPts: levels.riskPts,
      riskPct: levels.riskPct,
      riskDollars: levels.riskDollars,
      grade: String(levels.grade),
      score: c.confluence,
      strategy: c.completeStrategy || c.strategyPrimary || "—",
      openedAt: Date.now(),
      scaleLegs: [],
      reason: [
        c.title,
        `strategy:${c.completeStrategy || c.strategyPrimary || "—"}`,
        `band:${c.pathBand || c.grade}`,
        opts?.killzone ? `kz:${opts.killzone}` : null,
        // Why an A+ card was sized as an A. Recorded for the same reason the
        // discretion multiplier is: "why was this sized like that" has to be
        // answerable from the trade alone, without re-deriving the counters.
        levels.cardGrade === "A+" && levels.grade !== "A+"
          ? `A+ probe: sized ${levels.grade} (rule 5, unlock not earned)`
          : null,
        levels.discretionFactor !== 1.0
          ? `discretion:${levels.discretionFactor.toFixed(2)}x`
          : null,
        `stop:${levels.stopSource}`,
        "mode:paper auto",
      ]
        .filter(Boolean)
        .join(" · "),
      pathBand: c.pathBand,
      cardBand: String(levels.cardGrade),
      killzone: opts?.killzone,
      discretionFactor: levels.discretionFactor,
    };

    const all = loadPaperTrades();
    all.unshift(trade);
    savePaperTrades(all);

    rememberPaperOpen({
      symbol: trade.displaySymbol,
      side: trade.side,
      strategy: trade.strategy,
      grade: trade.grade,
      band: trade.pathBand,
      score: trade.score,
      entry: trade.entry,
      stop: trade.stop,
      tp1: trade.tp1,
      tp2: trade.tp2,
      contracts: trade.contracts,
      riskPts: trade.riskPts,
    });
    setOpenPaperCount(listOpenPaperTrades().length + 0); // will recount
    setOpenPaperCount(
      loadPaperTrades().filter((x) => x.status === "open").length,
    );
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("ledger-memory"));
    }

    return { ok: true, trade };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Paper open failed",
    };
  }
}

function pointValue(symbol: ContractKey): number {
  return CONTRACTS[symbol]?.pointValue ?? 2;
}

function commission(symbol: ContractKey): number {
  return CONTRACTS[symbol]?.commission ?? 1;
}

/**
 * Price feed for management — last + optional bar range for proper hit detection.
 * Short: stop if high >= stop; TP if low <= target.
 * Long: stop if low <= stop; TP if high >= target.
 */
export type ManagePrice = {
  last: number;
  high?: number;
  low?: number;
  /**
   * Age of this print in seconds (the desk payload's `LiveQuote.lagSec`).
   *
   * Omitted means UNKNOWN, which is treated as unfit to price a fill — see
   * the freshness gate in `managePaperTradesAgainstPrice`. A caller that has
   * the number must pass it; a caller that genuinely has no concept of lag
   * (replay/backtest, where every bar is its own present) passes
   * `enableFreshnessGate: false` instead of faking a zero.
   */
  lagSec?: number;
};

/** Every key a caller might have used for this trade's instrument. */
function symbolKeys(t: PaperTrade): string[] {
  return [
    t.displaySymbol,
    t.symbol,
    t.displaySymbol.replace(/^M/, ""),
    t.symbol.replace(/^M/, ""),
  ];
}

function resolvePrice(
  t: PaperTrade,
  prices: Partial<Record<string, number | ManagePrice>>,
): ManagePrice | null {
  const keys = symbolKeys(t);
  for (const k of keys) {
    const v = prices[k];
    if (v == null) continue;
    if (typeof v === "number" && Number.isFinite(v)) {
      // A bare number carries no age. Left undefined on purpose so the
      // freshness gate treats it as unknown rather than as fresh.
      return { last: v, high: v, low: v };
    }
    if (typeof v === "object" && Number.isFinite(v.last)) {
      return {
        last: v.last,
        high: v.high ?? v.last,
        low: v.low ?? v.last,
        lagSec: v.lagSec,
      };
    }
  }
  return null;
}

function finalizeClose(
  t: PaperTrade,
  sign: number,
): void {
  const totalR = t.scaleLegs.reduce(
    (s, l) => s + l.r * (l.contracts / t.contracts),
    0,
  );
  const totalUsd = t.scaleLegs.reduce((s, l) => {
    const u =
      sign * (l.price - t.entry) * pointValue(t.symbol) * l.contracts;
    return s + u - commission(t.symbol) * l.contracts;
  }, 0);
  // R must be NET of commission, matching live (@/lib/journal/pnl.ts). The
  // leg-weighted `totalR` above is a raw PRICE ratio, so a full stop-out
  // booked exactly -1.00R while the same live trade booked -1.03R. A paper
  // record that is systematically ~2-3% kinder than live is not evidence for
  // unlocking live. Derive R from the net dollars instead.
  const riskUsd =
    t.riskDollars > 0
      ? t.riskDollars
      : t.riskPts * pointValue(t.symbol) * t.contracts;
  const netR = riskUsd > 0 ? totalUsd / riskUsd : totalR;
  t.rMultiple = +netR.toFixed(3);
  t.pnlUsd = +totalUsd.toFixed(2);
  if (!t.ingested) {
    ingestPaperFill({
      symbol: t.displaySymbol,
      side: t.side,
      strategy: t.strategy,
      band: t.pathBand || t.grade,
      grade: t.grade,
      score: t.score,
      r: t.rMultiple!,
      usd: t.pnlUsd!,
      exit: t.exitReason || "close",
      entry: t.entry,
      exitPx: t.exit,
      reason: t.exitReason,
      applyEquity: true,
      tradeId: t.id,
    });
    t.ingested = true;
  }
  t.debrief = debriefPaper(t);
  pushDebrief(t.debrief);
  setOpenPaperCount(
    loadPaperTrades().filter((x) => x.status === "open" && x.id !== t.id).length,
  );
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("ledger-memory"));
  }
}


function resolveDraw(
  t: PaperTrade,
  draws: Partial<Record<string, DrawRead | null>>,
): DrawRead | null {
  for (const k of symbolKeys(t)) {
    const v = draws[k];
    if (v) return v;
  }
  return null;
}

/**
 * Optional context for the management tick.
 *
 * Everything here is opt-in EXCEPT the time/context stops, which default ON:
 * they need only the clock and the bundled news calendar, both deterministic,
 * so requiring the caller to pass anything would mean shipping B2 switched off.
 * Dynamic targets are opt-in — with no `draws`, targets behave exactly as they
 * did before Phase B.
 */
export interface ManageContext {
  /** Evaluation instant. Defaults to Date.now(). */
  now?: number;
  /**
   * Draw read per instrument (the desk payload's `draws`, keyed "NQ"/"ES" or
   * "MNQ"/"MES"). Omit and targets are never re-ranked.
   */
  draws?: Partial<Record<string, DrawRead | null>>;
  /** News calendar override — tests and replay only. */
  calendar?: NewsEvent[];
  /** Set false to suppress time/context stops (replay harnesses). Default true. */
  enableTimeStops?: boolean;
  /**
   * Set false ONLY where "how old is this price" is meaningless — replay and
   * backtest, where each bar IS the present. Live callers must leave this on;
   * turning it off in the live desk re-opens the invented-fill bug it exists
   * to close. Default true.
   */
  enableFreshnessGate?: boolean;
  /** Override the shared fill-freshness budget. Defaults to QUOTE_EXECUTION_MAX_LAG_SEC. */
  maxLagSec?: number;
}

/** One position skipped this tick because its quote was too old to fill against. */
export interface DeferredExit {
  id: string;
  displaySymbol: string;
  /** Undefined when the caller passed no age at all (unknown = unfit). */
  lagSec: number | undefined;
  reason: string;
}

/**
 * Manage open paper trades against live prints (and bar H/L when available).
 * Scale-out 50% @ TP1 → BE, runner @ TP2; stop on working stop.
 *
 * Per tick, per open position, in this order:
 *   1. record max favourable excursion (feeds the no-progress time stop)
 *   2. re-rank targets against the draw           (B3, only when `draws` given)
 *   3. stop  → 4. TP1 → 5. TP2                    (unchanged price events)
 *   6. time / context stops                       (B2)
 * Price events are evaluated before time stops on purpose: a stop or target
 * that actually printed on this tick is a fact, a time stop is a decision.
 */
export function managePaperTradesAgainstPrice(
  prices: Partial<Record<string, number | ManagePrice>>,
  ctx?: ManageContext,
): { closed: PaperTrade[]; updated: PaperTrade[]; deferred: DeferredExit[] } {
  const all = loadPaperTrades();
  const closed: PaperTrade[] = [];
  const updated: PaperTrade[] = [];
  const deferred: DeferredExit[] = [];
  const so = APLUS_RULES.scaleOut;
  const now = ctx?.now ?? Date.now();
  const timeStopsOn = ctx?.enableTimeStops !== false;
  const freshnessOn = ctx?.enableFreshnessGate !== false;
  const maxLagSec = ctx?.maxLagSec ?? QUOTE_EXECUTION_MAX_LAG_SEC;
  const clock = getSessionClock(new Date(now));

  for (const t of all) {
    if (t.status !== "open" || t.contractsOpen <= 0) continue;
    const feed = resolvePrice(t, prices);
    if (!feed) continue;

    /**
     * FRESHNESS — the exit half of the desk's execution-freshness rule.
     *
     * DELIBERATELY NOT A BLANKET SKIP. The four exit paths below are not
     * equally corrupted by a stale quote, and treating them as if they were
     * would freeze the paper book on any Yahoo-fed desk (~600s lag) — no
     * fills, no sample, and the whole ROADMAP measurement loop stalls. Each
     * path is handled by what it actually books:
     *
     *   STOP (`fill = t.workingStop`) — books the PRE-COMMITTED stop level,
     *     not the market print. A stale quote delays *detection*; it does not
     *     change the price written. Allowed to fire. (It is if anything
     *     optimistic — it ignores gap-through slippage — but that is a
     *     separate, pre-existing modelling choice, not staleness.)
     *
     *   TP1 / TP2 (`Math.max(target, feed.last)`) — "target or better", where
     *     `better` comes from the print. A stale print can book a fill ABOVE
     *     the target that never traded, inflating R directly into the sample.
     *     When stale, the fill is CLAMPED to the target exactly: the level was
     *     reached, so the target fill is real; the bonus is not.
     *
     *   TIME / CONTEXT STOP (`fill = feed.last`) — books the print itself, so
     *     a stale quote is a wholly fictional price. Refused when stale; the
     *     position stays open and flattens on the next fresh tick.
     *
     *   DRAW RE-RANK — rewrites tp1/tp2 from the print, so a stale read
     *     silently moves future fills. Skipped when stale.
     *
     * `lagSec == null` (unknown age) counts as stale. A caller that cannot say
     * how old its price is has not established that it is fresh, and this is a
     * measurement instrument: unknown is not a pass.
     */
    const lag = feed.lagSec;
    const staleForFill =
      freshnessOn && (lag == null || !Number.isFinite(lag) || lag > maxLagSec);
    if (staleForFill) {
      deferred.push({
        id: t.id,
        displaySymbol: t.displaySymbol,
        lagSec: lag == null || !Number.isFinite(lag) ? undefined : lag,
        reason:
          lag == null || !Number.isFinite(lag)
            ? "quote age unknown — target fills clamped, time stops held"
            : `quote ${Math.round(lag)}s old (> ${maxLagSec}s) — target fills clamped, time stops held`,
      });
    }

    // Only trust last print for exit decisions.
    // Bar H/L from HTF/desk series often spans the whole candle and can
    // "stop out" a brand-new trade on the same bar it was opened.
    // Optional wicks only if they are tighter than 1.5R from last (micro noise).
    let high = feed.last;
    let low = feed.last;
    if (feed.high != null && feed.low != null) {
      const span = feed.high - feed.low;
      const maxWick = Math.max(t.riskPts * 0.35, t.entry * 0.0003);
      if (span <= maxWick) {
        high = feed.high;
        low = feed.low;
      }
    }
    // Grace: for 15s after open, only use last print (avoid open-bar ghost fills)
    if (now - t.openedAt < 15_000) {
      high = feed.last;
      low = feed.last;
    }
    const sign = t.side === "long" ? 1 : -1;
    const rPts = (price: number) => (sign * (price - t.entry)) / t.riskPts;

    let dirty = false;

    // 0a) Max favourable excursion — the only durable evidence the no-progress
    // time stop can read. Persisted ONLY on the first crossing of the progress
    // floor: writing every new tick high would hit localStorage (and fire two
    // window events) on every poll of a winning trade.
    const prevMfe = t.mfeR ?? -Infinity;
    const curR = rPts(t.side === "long" ? high : low);
    if (Number.isFinite(curR) && curR > prevMfe) {
      t.mfeR = +curR.toFixed(3);
      if (prevMfe < PROGRESS_R && t.mfeR >= PROGRESS_R) dirty = true;
    }

    // 0b) Dynamic targets from the draw (B3). No draw supplied → untouched,
    // so a caller that passes no context behaves exactly as it did before.
    // `!staleForFill`: retarget rewrites tp1/tp2 from the print, so a stale
    // read silently relocates future fills. Skipped rather than deferred —
    // the next fresh tick re-ranks against the same draw anyway.
    const draw = ctx?.draws && !staleForFill ? resolveDraw(t, ctx.draws) : null;
    if (draw) {
      const rt = retarget(t, draw, { last: feed.last });
      if (rt.changed) {
        const nextTp1 = tickRound(t.symbol, rt.tp1);
        const nextTp2 = tickRound(t.symbol, rt.tp2);
        // Re-assert the invariant AFTER tick rounding: rounding can nudge a
        // level by half a tick, and half a tick the wrong way is still the
        // wrong way. If it does, keep the targets we already had.
        const dist = (px: number) => sign * (px - t.entry);
        const safe =
          dist(nextTp1) > 0 &&
          dist(nextTp2) >= dist(nextTp1) &&
          dist(nextTp1) <= dist(t.tp1) &&
          dist(nextTp2) >= dist(t.tp2) &&
          sign * (nextTp1 - feed.last) > 0;
        if (safe) {
          t.tp1 = nextTp1;
          t.tp2 = nextTp2;
          t.manageNote = rt.notes.join(" · ");
          dirty = true;
        }
      }
    }

    // 1) STOP first (conservative — if stop and target same bar, stop wins)
    const stopHit =
      t.side === "long" ? low <= t.workingStop : high >= t.workingStop;
    if (stopHit) {
      const fill = t.workingStop;
      const r = rPts(fill);
      t.scaleLegs.push({
        at: new Date().toISOString(),
        price: fill,
        contracts: t.contractsOpen,
        r,
        note:
          Math.abs(fill - t.entry) < 0.01 || fill === t.entry
            ? "BE stop"
            : "stop",
      });
      t.contractsOpen = 0;
      t.status = "closed";
      t.closedAt = Date.now();
      t.exit = fill;
      t.exitReason =
        Math.abs(r) < 0.05 ? "be_stop" : r < 0 ? "stop" : "trail_stop";
      finalizeClose(t, sign);
      closed.push(t);
      continue;
    }

    // 2) TP1 scale-out — hit if print reaches OR trades through target
    const tp1Hit = t.side === "long" ? high >= t.tp1 : low <= t.tp1;
    // "Target or better" only when the print is fresh enough to be believed.
    // Stale -> clamp to the target: the level was reached (that is what
    // tp1Hit established), but the improvement is an artefact of an old quote.
    const tp1Fill = staleForFill
      ? t.tp1
      : t.side === "long"
        ? Math.max(t.tp1, feed.last) // long: fill at least target
        : Math.min(t.tp1, feed.last); // short: fill at target or better
    const alreadyTp1 = t.scaleLegs.some((l) => l.note.toLowerCase().includes("tp1"));
    if (so.enabled && tp1Hit && !alreadyTp1) {
      if (t.contractsOpen >= 2) {
        const closeN = Math.max(1, Math.floor(t.contractsOpen * so.tp1Fraction));
        const r = rPts(tp1Fill);
        t.scaleLegs.push({
          at: new Date().toISOString(),
          price: tp1Fill,
          contracts: closeN,
          r,
          note: "TP1 scale-out → BE",
        });
        t.contractsOpen -= closeN;
        if (so.moveStopToBeAfterTp1) {
          t.workingStop = tickRound(
            t.symbol,
            t.entry + sign * (so.beBufferR * t.riskPts),
          );
        }
        dirty = true;
      } else if (t.contractsOpen === 1) {
        // Single micro: full close at TP1 (can't split meaningfully)
        const r = rPts(tp1Fill);
        t.scaleLegs.push({
          at: new Date().toISOString(),
          price: tp1Fill,
          contracts: 1,
          r,
          note: "TP1 full (1ct)",
        });
        t.contractsOpen = 0;
        t.status = "closed";
        t.closedAt = Date.now();
        t.exit = tp1Fill;
        t.exitReason = "tp1";
        finalizeClose(t, sign);
        closed.push(t);
        continue;
      }
    }

    // 3) TP2 runner (or full if no scale)
    const tp2Hit = t.side === "long" ? high >= t.tp2 : low <= t.tp2;
    // Same clamp as TP1 — see the freshness block above.
    const tp2Fill = staleForFill
      ? t.tp2
      : t.side === "long"
        ? Math.max(t.tp2, feed.last)
        : Math.min(t.tp2, feed.last);
    if (tp2Hit && t.contractsOpen > 0) {
      const r = rPts(tp2Fill);
      t.scaleLegs.push({
        at: new Date().toISOString(),
        price: tp2Fill,
        contracts: t.contractsOpen,
        r,
        note: "TP2 runner",
      });
      t.contractsOpen = 0;
      t.status = "closed";
      t.closedAt = Date.now();
      t.exit = tp2Fill;
      t.exitReason = alreadyTp1 || t.scaleLegs.some((l) => l.note.includes("TP1"))
        ? "tp1_tp2"
        : "tp2";
      finalizeClose(t, sign);
      closed.push(t);
      continue;
    }

    // 4) TIME / CONTEXT STOPS (B2) — killzone ended, session end, news
    // blackout imminent, N bars with no progress. Evaluated last: anything
    // above this line was a real price event on this tick and outranks a
    // decision. Fills at the last print (a market-out), and books through the
    // same finalizeClose, so R stays NET of commission.
    // `!staleForFill`: a time stop books `feed.last` as the fill price, so a
    // stale print here is a price that never traded. Held, not cancelled —
    // the decision re-evaluates and flattens on the next fresh tick.
    if (timeStopsOn && !staleForFill) {
      const decision = shouldFlatten(t, {
        now,
        clock,
        last: feed.last,
        calendar: ctx?.calendar,
      });
      if (decision.flatten && decision.reason) {
        const fill = feed.last;
        t.scaleLegs.push({
          at: new Date(now).toISOString(),
          price: fill,
          contracts: t.contractsOpen,
          r: rPts(fill),
          note: `flat: ${decision.reason}`,
        });
        t.contractsOpen = 0;
        t.status = "closed";
        t.closedAt = now;
        t.exit = fill;
        t.exitReason = `flat_${decision.reason}`;
        t.manageNote = decision.detail;
        finalizeClose(t, sign);
        closed.push(t);
        continue;
      }
    }

    if (dirty) updated.push(t);
  }

  if (closed.length || updated.length) {
    savePaperTrades(all);
  }
  return { closed, updated, deferred };
}


/**
 * Manually / structure-close an open paper trade at a fill price.
 * Used for "close at the 7763 low" style structure TPs.
 */
export function closePaperTrade(
  id: string,
  exitPrice: number,
  reason: string = "structure_tp",
): PaperTrade | null {
  const all = loadPaperTrades();
  const t = all.find((x) => x.id === id && x.status === "open");
  if (!t) return null;
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) return null;

  const sign = t.side === "long" ? 1 : -1;
  const r = (sign * (exitPrice - t.entry)) / Math.max(t.riskPts, 1e-6);
  const openCt = t.contractsOpen;

  t.scaleLegs.push({
    at: new Date().toISOString(),
    price: exitPrice,
    contracts: openCt,
    r,
    note: reason === "structure_tp" ? `structure TP @ ${exitPrice}` : reason,
  });
  t.contractsOpen = 0;
  t.status = "closed";
  t.closedAt = Date.now();
  t.exit = exitPrice;
  t.exitReason = reason;

  // Booked through the SAME finalizeClose as every automatic exit. This path
  // used to compute its own `rMultiple` from the leg-weighted PRICE ratio,
  // which is gross — a structure-TP close was reported ~2-3% kinder than the
  // identical live trade, the exact defect finalizeClose was fixed for.
  finalizeClose(t, sign);
  savePaperTrades(all);
  setOpenPaperCount(listOpenPaperTrades().filter((x) => x.id !== id).length);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("ledger-memory"));
  }
  return t;
}

/** Close every open paper position (optional per-symbol or single fill). */
export function closeAllOpenPaper(
  exitPrice: number,
  reason: string = "structure_tp",
): PaperTrade[] {
  const closed: PaperTrade[] = [];
  for (const t of listOpenPaperTrades()) {
    const c = closePaperTrade(t.id, exitPrice, reason);
    if (c) closed.push(c);
  }
  return closed;
}

/**
 * If short and mark is at/through structure low (or long through high),
 * close remaining size at that structure level.
 */
/**
 * Close positions on ONE book when price tags a structural level on THAT book.
 *
 * WHAT THIS USED TO DO, AND WHAT IT COST
 * The previous signature took a bare price and a map of marks for every
 * symbol, matched a position to whichever mark shared its name, and — this is
 * the part that did the damage — accepted a LONG whenever `mark >= level`.
 * The live poll loop called it with a hardcoded ES level of 7763 and marks
 * for both books, so an MNQ long at 30,800 satisfied `30800 >= 7762.75` and
 * was force-closed at its own mark on the first tick after it opened, tagged
 * as a structure take-profit.
 *
 * Every long paper trade on both books was therefore flattened instantly.
 * That killed the runner the measured +0.50R/trade scale rule depends on, and
 * wrote fabricated "structure TP" exits into the very sample that gates the
 * A+ full-size unlock. Paper statistics recorded before 2026-09-23 should be
 * treated as contaminated for longs.
 *
 * WHY THE LONG BRANCH WAS WRONG IN PRINCIPLE, not just in scope
 * A structure LOW is a short's objective. For a long it is the opposite — a
 * level price falls THROUGH, which is a stop, not a take-profit. Closing a
 * long at a structure low and labelling it `structure_tp` mislabels a loss
 * as a target. So the level now carries the side it belongs to, and there is
 * no branch that can close the other one.
 */
export function closeOpenAtStructureLevel(
  /** The book this level belongs to. A level from one book never touches another. */
  symbol: string,
  /** Which positions this level is an objective FOR. */
  side: "long" | "short",
  structurePx: number,
  /** Live mark for that symbol only. */
  mark: number,
): PaperTrade[] {
  const closed: PaperTrade[] = [];
  if (!Number.isFinite(structurePx) || !Number.isFinite(mark) || mark <= 0) return closed;

  const want = symbol.toUpperCase();
  for (const t of listOpenPaperTrades()) {
    if (t.side !== side) continue;
    // Match the book explicitly. The old name-fuzzing (stripping a leading M)
    // is what let an ES level reach an MNQ position.
    const names = [t.displaySymbol, t.symbol].map((x) => x?.toUpperCase());
    if (!names.includes(want)) continue;

    // The mark must actually REACH the level, not merely sit on the correct
    // side of it — "on the correct side" is true from the moment the trade
    // opens and is what made this fire instantly.
    const tagged = side === "short" ? mark <= structurePx + 0.25 : mark >= structurePx - 0.25;
    if (!tagged) continue;

    const fill = side === "short" ? Math.min(structurePx, mark) : Math.max(structurePx, mark);
    const c = closePaperTrade(t.id, fill, "structure_tp");
    if (c) closed.push(c);
  }
  return closed;
}

/**
 * Sync all closed paper trades into desk-memory (equity + rates + brain).
 * Idempotent via trade.ingested / tradeId in memory.
 * Call on app load and after any paper event so the whole UI stays connected.
 */
let _reconciling = false;

/**
 * Sync closed paper trades into desk-memory. Idempotent.
 * Does NOT dispatch window events (avoids sync↔reconcile infinite loop).
 * Callers should publishMemory / setEquity after.
 */
export function reconcilePaperBookToMemory(): {
  synced: number;
  equity: number;
  open: number;
} {
  if (typeof window === "undefined") {
    return { synced: 0, equity: PAPER_START_EQUITY, open: 0 };
  }
  if (_reconciling) {
    const acc = getPaperAccount();
    return {
      synced: 0,
      equity: acc.equity,
      open: listOpenPaperTrades().length,
    };
  }
  _reconciling = true;
  try {
    const all = loadPaperTrades();
    let synced = 0;
    for (const tr of all) {
      if (tr.status !== "closed") continue;
      if (tr.ingested) continue;
      if (tr.rMultiple == null || tr.pnlUsd == null) {
        const sign = tr.side === "long" ? 1 : -1;
        if (tr.exit != null && tr.riskPts > 0) {
          tr.rMultiple =
            Math.round(
              ((sign * (tr.exit - tr.entry)) / tr.riskPts) * 1000,
            ) / 1000;
          tr.pnlUsd =
            Math.round(
              (sign *
                (tr.exit - tr.entry) *
                pointValue(tr.symbol) *
                tr.contracts -
                commission(tr.symbol) * tr.contracts) *
                100,
            ) / 100;
        } else continue;
      }
      ingestPaperFill({
        symbol: tr.displaySymbol,
        side: tr.side,
        strategy: tr.strategy,
        band: tr.pathBand || tr.grade,
        grade: tr.grade,
        score: tr.score,
        r: tr.rMultiple,
        usd: tr.pnlUsd,
        exit: tr.exitReason || "reconcile",
        entry: tr.entry,
        exitPx: tr.exit,
        reason: tr.exitReason || "reconcile",
        applyEquity: true,
        tradeId: tr.id,
      });
      tr.ingested = true;
      synced += 1;
    }
    if (synced) savePaperTrades(all);
    // update open count without nested event storms
    const open = all.filter((x) => x.status === "open").length;
    // setOpenPaperCount saves memory — only if changed
    try {
      setOpenPaperCount(open);
    } catch {
      /* */
    }
    const acc = getPaperAccount();
    return { synced, equity: acc.equity, open };
  } finally {
    _reconciling = false;
  }
}

export function paperTradeHistory(limit = 20): PaperTrade[] {
  return loadPaperTrades().slice(0, limit);
}

export function formatPaperTradeLine(t: PaperTrade): string {
  if (t.status === "open") {
    return `${t.displaySymbol} ${t.side.toUpperCase()} ${t.contractsOpen}/${t.contracts}ct @ ${t.entry} · SL ${t.workingStop} · TP1 ${t.tp1} · ${t.grade}`;
  }
  return `${t.displaySymbol} ${t.side} CLOSED ${t.exitReason} R ${t.rMultiple?.toFixed(2) ?? "—"} $${t.pnlUsd?.toFixed(0) ?? "—"}`;
}
