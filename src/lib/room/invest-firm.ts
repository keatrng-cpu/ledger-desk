/**
 * The firm's standing reviews — pure.
 *
 * An investment firm looks at more than a price. It looks at what the funds hold once they are opened, whether one name or one sleeve
 * is carrying the book, what it is not allowed to own, whether the kill rules were read, whether the ledger is clean, which lots turn
 * long-term and when, what the month's waterfall paid, one company at a time on paper, and how old its own data is. The Invest tab holds
 * every one of those as a function. This file calls those functions — it re-implements none of them — on the cost-valued book the
 * Floor already reads, and keeps the answers small enough to ride in `InvestLite.firm`.
 *
 * What is NOT here, on purpose: a price, a mark, a performance figure, an unrealised gain, a drawdown, a trend, a benchmark. The Floor
 * fetches no prices (invest-sources.ts), so a review that would need one says it does not have it; it never fills the gap.
 * What is not here either: a verdict word, a size, an order. The firm narrates the Invest tab's own numbers.
 *
 * Browser-only inputs (the ledger, the RH journal, the kill-rule record) come in as plain values from invest-sources.ts, which calls the
 * tab's own storage readers; nothing in this file touches storage, a clock or the network. A world built without a ledger gets `null` for the
 * three reviews that need one — never a guess.
 */

import { ALL_DOSSIERS, dossierFor, RISK_FREE } from "@/lib/invest/dossiers";
import { durabilityCapturedAt, requiredVsDelivered } from "@/lib/invest/durability";
import { evidenceFor, STALENESS_TRAPS } from "@/lib/invest/evidence";
import { earningsYield, BASE_RATES, HORIZON_EVIDENCE } from "@/lib/invest/factors";
import { effectiveWeight, lookThrough, OVERLAP_WARN, profilesCapturedAt, type ExposureRead } from "@/lib/invest/exposure";
import { FUNNEL, splitSweep } from "@/lib/invest/funnel";
import { ipoCapturedAt, LOCKUP_DAYS_DEFAULT, pricedIpos, TRACK_RECORD_DAYS, upcomingIpos } from "@/lib/invest/ipo";
import { CHECK_INTERVAL_DAYS, isDue, killQueries } from "@/lib/invest/kill-watch";
import { trippedFrom, type KillJudgement, type StoredKillRun } from "@/lib/invest/kill-store";
import { heldPositions, taxYear, WASH_WINDOW_DAYS, type HeldPosition, type LedgerRead } from "@/lib/invest/ledger";
import { CAPTURE_MAX_DAYS, gradeBoard, LEFT_OFF, LONG_NAMES, NAME_CAP, SLEEVE_CAP, sleeveLoad, type LongCard } from "@/lib/invest/long-board";
import {
  DATA_RENT_MONTHLY_USD,
  missedMonths,
  planSweep,
  realizedNeededFor,
  RENT_DRAG_ALARM,
  rentVsSweep,
  SLEEVE_TARGET_USD,
  SWEEP_ESTABLISHED_MIN_MONTHS,
  SWEEP_RATE_ESTABLISHED,
  SWEEP_RATE_FULL,
  type DeployQueue,
  type RateLadder,
} from "@/lib/invest/policy";
import { recentUnderliersFrom, rhMonthFrom, RH_JOURNAL_CAP, WASH_LOOKBACK_DAYS } from "@/lib/invest/rh-bridge";
import { canAdd, completeness, fundamentalsFor, oldestAsOf, snapshotCapturedAt, TRADED_UNDERLIERS, WASH_SALE_BANNED, WASH_SALE_TWINS } from "@/lib/invest/universe";
import type { BookRead } from "@/lib/invest/book";
import type { RhFill } from "@/lib/trading/rh-income";
import { timeline } from "@/lib/news/schedule";
import { daysBetween, firstSentence, plusDays, sentences } from "./invest-read";
import { hash32, type FirmBoard, type FirmCompliance, type FirmDiligence, type FirmFresh, type FirmFunding, type FirmMemo, type FirmOps, type FirmPolicy, type FirmRisk, type FirmTax, type FirmTaxYear, type InvestFirm, type LedgerProblemKind } from "./live-types";
import { etDateOf } from "./option-math";

export interface FirmInputs {
  /** ET date, YYYY-MM-DD. */
  dayKey: string;
  /** The instant the reads are taken for (the wash window, the kill-rule clock and the park date are measured to it). */
  nowMs: number;
  /** The book valued at cost (buildBook with no prices). */
  book: BookRead;
  /** Tickers held, from the ledger. */
  held: string[];
  /** The replayed ledger, or null when it could not be read. */
  ledger: LedgerRead | null;
  queue: DeployQueue;
  ladder: RateLadder;
  /** The RH options journal, or null when it could not be read. */
  rhFills: RhFill[] | null;
  /** The kill-rule record as the Invest tab stores it, or null when storage could not be read. */
  kill: { lastRun: StoredKillRun | null; judgements: KillJudgement[] } | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;


/** A prose field bounded for the wire; cut at a sentence or a word, never mid-number. */
function bound(s: string | null | undefined, n = 220): string | null {
  if (s == null) return null;
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  return `${cut.slice(0, sp > n * 0.6 ? sp : n).replace(/[\s,;:.\-–—]+$/, "")}…`;
}

/** The month before `dayKey`'s month, YYYY-MM. */
export function priorMonthOf(dayKey: string): string {
  const [y, m] = dayKey.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/* ── The Invest tab's committed snapshots and their ages ─────────────────── */

/** The datasets the Invest tab and the long board read, each with the date it carries. (data-fresh.ts binds the same list to the audit.) */
export function investSnapshots(): { id: string; label: string; asOf: string }[] {
  const oldest = oldestAsOf();
  return [
    { id: "universe", label: "fundamentals snapshot", asOf: snapshotCapturedAt() },
    ...(oldest ? [{ id: "oldest-row", label: "oldest fundamentals row", asOf: oldest }] : []),
    { id: "durability", label: "durability record", asOf: durabilityCapturedAt() },
    { id: "fund-profiles", label: "fund profiles", asOf: profilesCapturedAt() },
    { id: "ipo-watch", label: "IPO watch", asOf: ipoCapturedAt() },
  ];
}

function freshOf(dayKey: string): FirmFresh {
  const items = investSnapshots().map((s) => ({ ...s, ageDays: daysBetween(s.asOf, dayKey) }));
  const stalest = items.reduce<FirmFresh["stalest"]>((a, b) => (a == null || b.ageDays > a.ageDays ? b : a), null);
  return { maxDays: CAPTURE_MAX_DAYS, items, stalest, stale: stalest != null && stalest.ageDays > CAPTURE_MAX_DAYS };
}

/* ── The reviews ──────────────────────────────────────────────────────── */

function riskOf(i: FirmInputs, read: ExposureRead, cards: LongCard[]): FirmRisk {
  const names = read.names.slice(0, 3).map((n) => ({ ticker: n.ticker, weight: round4(n.weight), direct: round4(n.direct), viaFunds: round4(n.viaFunds) }));
  const directWeights = i.book.positions.map((p) => ({ ticker: p.ticker, weight: p.weight }));
  const compute = FUNNEL.find((s) => s.sleeve === "compute");
  return {
    preview: read.preview,
    totalUsd: read.totalUsd,
    overlapQQQ: read.overlapQQQ,
    overlapWarn: OVERLAP_WARN,
    overlapPartial: read.overlapPartial,
    techWeight: read.techWeight,
    sectorUnknown: read.sectorUnknown,
    feeUsdYear: read.feeUsdYear,
    feeBlended: round4(read.feeBlended),
    names,
    sectors: read.sectors.slice(0, 3).map((s) => ({ sector: s.sector, weight: round4(s.weight) })),
    directTechWeight: round4(i.book.concentration.techWeight),
    directTechWarn: i.book.concentration.warn,
    nameCap: NAME_CAP,
    sleeveCap: SLEEVE_CAP,
    namesOverCap: read.preview ? [] : read.names.filter((n) => n.weight > NAME_CAP).slice(0, 3).map((n) => ({ ticker: n.ticker, weight: round4(n.weight) })),
    sleeves: sleeveLoad(directWeights).map((s) => ({ sleeve: s.sleeve, weight: round4(s.weight), over: s.over })),
    computeNames: cards.filter((c) => c.overlap === "same bet as the sleeve").map((c) => c.name.ticker),
    computeShare: compute?.weight ?? 0,
    computeDemand: bound(compute?.demand ?? "", 260) ?? "",
    computeWhy: bound(sentences(compute?.demand ?? "")[1] ?? compute?.demand ?? "", 200) ?? "",
  };
}

function complianceOf(i: FirmInputs): FirmCompliance {
  const dynamic = i.rhFills
    ? recentUnderliersFrom(i.rhFills, i.nowMs)
        .filter((u) => !WASH_SALE_BANNED[u.underlier])
        .map((u) => ({ underlier: u.underlier, lastAt: u.lastAt, throughDate: etDateOf(Date.parse(u.lastAt) + WASH_LOOKBACK_DAYS * 86_400_000) }))
        .sort((a, b) => (a.underlier < b.underlier ? -1 : 1))
        .slice(0, 6)
    : [];
  const watch: FirmCompliance["watch"] = [];
  for (const d of ALL_DOSSIERS) if (d.watch) watch.push({ ticker: d.ticker, source: "dossier", reason: bound(d.watch.reason, 200)!, clearsWhen: bound(d.watch.clearsWhen, 200)! });
  for (const n of LONG_NAMES) if (n.watch) watch.push({ ticker: n.ticker, source: "board", reason: bound(n.watch.reason, 200)!, clearsWhen: bound(n.watch.clearsWhen, 200)! });
  const gate = ALL_DOSSIERS.map((d) => ({ d, ok: canAdd(d).canAdd, c: completeness(d) }));
  return {
    banned: Object.keys(WASH_SALE_BANNED),
    traded: [...TRADED_UNDERLIERS],
    twins: Object.keys(WASH_SALE_TWINS),
    heldBanned: i.book.banned.map((b) => ({ ticker: b.ticker })),
    dynamic,
    lookbackDays: WASH_LOOKBACK_DAYS,
    washWindowDays: WASH_WINDOW_DAYS,
    journalFills: i.rhFills ? i.rhFills.length : null,
    watch: watch.slice(0, 6),
    dossiers: ALL_DOSSIERS.length,
    addable: gate.filter((g) => g.ok).length,
    blocked: gate.filter((g) => !g.ok).length,
    incomplete: gate.filter((g) => !g.c.complete).slice(0, 4).map((g) => ({ ticker: g.d.ticker, missing: g.c.missing.slice(0, 3) })),
  };
}

function diligenceOf(i: FirmInputs): FirmDiligence {
  const rules = killQueries(i.nowMs).length;
  const k = i.kill;
  const last = k?.lastRun ?? null;
  const due = isDue({ lastCheckedAt: last?.ranAt ?? null }, i.nowMs);
  const judgements = k?.judgements ?? [];
  const tripped = [...trippedFrom(judgements).values()].map((j) => ({ ticker: j.ticker, judgedAt: j.judgedAt }));
  const results = last?.results ?? [];
  return {
    rules,
    intervalDays: CHECK_INTERVAL_DAYS,
    dueInDays: last ? (due.due ? 0 : CHECK_INTERVAL_DAYS - (due.daysSince ?? 0)) : null,
    readable: k != null,
    lastRanAt: last?.ranAt ?? null,
    daysSince: due.daysSince,
    due: due.due,
    results: results.length,
    sourced: results.filter((r) => r.citations.length > 0).length,
    unjudged: last ? results.filter((r) => !judgements.some((j) => j.ticker === r.ticker && j.judgedAt >= last.ranAt)).length : 0,
    tripped: tripped.slice(0, 4),
    judgedCount: new Set(judgements.map((j) => j.ticker)).size,
  };
}

/**
 * ledger.ts words each thing it could not apply as a sentence with entry ids in it, which a voice cannot say. This sorts them by kind
 * from the sentence's own shape; a sentence it does not know lands in "other", and scripts/verify-invest-office.mjs provokes every
 * problem the replay can raise and fails if one of them is "other" — so a reworded problem cannot slip by unnoticed.
 */
export function problemKind(text: string): LedgerProblemKind {
  if (/^Duplicate entry id /.test(text)) return "duplicate";
  if (/^Void \S+ names \S+, which is not in the ledger/.test(text)) return "void-missing";
  if (/^Void \S+ targets another void/.test(text)) return "void-void";
  if (/^Sale \S+ \(.*\) exceeds the .* shares open then/.test(text)) return "sale-short";
  if (/ is logged twice \(/.test(text)) return "month-twice";
  return "other";
}

function kindsOf(problems: string[]): FirmOps["problems"] {
  const n = new Map<LedgerProblemKind, number>();
  for (const p of problems) n.set(problemKind(p), (n.get(problemKind(p)) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([kind, count]) => ({ kind, n: count }));
}

function opsOf(i: FirmInputs, led: LedgerRead): FirmOps {
  const byId = new Map(led.entries.map((e) => [e.id, e]));
  const voids = [...led.voided.values()]
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.id < b.id ? 1 : -1))
    .map((v) => {
      const t = byId.get(v.targetId);
      return { date: v.date, kind: t?.kind ?? "entry", ticker: t && "ticker" in t ? t.ticker : null, reason: bound(v.reason, 160) ?? "no reason recorded" };
    });
  const missed = missedMonths(led.sweeps, i.dayKey.slice(0, 7));
  const over = round2(i.queue.deployedUsd - i.queue.sweptUsd);
  return {
    entries: led.entries.length,
    problemCount: led.problems.length,
    problems: kindsOf(led.problems),
    voidCount: voids.length,
    voids: voids.slice(0, 3),
    missedCount: missed.length,
    missed: missed.slice(-6),
    overSpendUsd: over > 0 ? over : 0,
    waitingUsd: i.queue.waitingUsd,
    journal: i.rhFills ? { fills: i.rhFills.length, cap: RH_JOURNAL_CAP, atCap: i.rhFills.length >= RH_JOURNAL_CAP } : null,
  };
}

const taxOf1 = (t: ReturnType<typeof taxYear>): FirmTaxYear => ({ year: t.year, stGainUsd: t.stGainUsd, ltGainUsd: t.ltGainUsd, washDeferredEstUsd: t.washDeferredEstUsd, dividendsUsd: t.dividendsUsd, sales: t.sales });

function taxOf(i: FirmInputs, led: LedgerRead, held: HeldPosition[]): FirmTax {
  const year = Number(i.dayKey.slice(0, 4));
  const ty = taxYear(led, year);
  const ly = taxYear(led, year - 1);
  const turns = held.filter((h) => h.nextLongTerm != null).sort((a, b) => (a.nextLongTerm! < b.nextLongTerm! ? -1 : a.nextLongTerm! > b.nextLongTerm! ? 1 : 0));
  return {
    thisYear: taxOf1(ty),
    lastYear: ly.sales > 0 || ly.dividendsUsd !== 0 ? taxOf1(ly) : null,
    openLots: held.reduce((s, h) => s + h.lots.length, 0),
    positions: held.slice(0, 4).map((h) => ({ ticker: h.ticker, lots: h.lots.length, shares: round4(h.shares), longTermShares: round4(h.longTermShares), nextLongTerm: h.nextLongTerm })),
    nextTurn: turns[0] ? { ticker: turns[0].ticker, date: turns[0].nextLongTerm! } : null,
    approx: held.some((h) => h.hasMigrated),
    washFlagged: led.sales.filter((s) => s.date.startsWith(String(year)) && s.wash != null).length,
  };
}

function fundingOf(i: FirmInputs, led: LedgerRead): FirmFunding {
  const sorted = [...led.sweeps].sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));
  const e = sorted[0] ?? null;
  let last: FirmFunding["last"] = null;
  if (e) {
    // The tab's own waterfall, re-run on what the month logged: the sleeve cash that reproduces the recorded restore, the recorded rate's rung of the ladder.
    const plan = planSweep({
      realizedMonthUsd: e.realizedUsd,
      monthClosed: true,
      sleeveEquityUsd: SLEEVE_TARGET_USD - e.restoreUsd,
      closedMonths: e.rate >= SWEEP_RATE_ESTABLISHED ? SWEEP_ESTABLISHED_MIN_MONTHS : 0,
      fullRateEarned: e.rate >= SWEEP_RATE_FULL,
    });
    const rv = rentVsSweep({ ...plan, sweepUsd: e.sweptUsd });
    last = {
      month: e.month,
      verdict: e.verdict,
      realizedUsd: e.realizedUsd,
      rentUsd: e.rentUsd,
      restoreUsd: e.restoreUsd,
      sweptUsd: e.sweptUsd,
      ratePct: Math.round(e.rate * 100),
      rentDrag: Number.isFinite(plan.rentDrag) ? plan.rentDrag : null,
      rentAlarm: plan.rentAlarm,
      annualRentUsd: rv.annualRent,
      annualSweepUsd: rv.annualSweep,
    };
  }
  const j = i.rhFills ? rhMonthFrom(i.rhFills, priorMonthOf(i.dayKey)) : null;
  return {
    months: led.sweeps.length,
    ratePct: Math.round(i.ladder.rate * 100),
    rentUsd: DATA_RENT_MONTHLY_USD,
    sleeveTargetUsd: SLEEVE_TARGET_USD,
    rentAlarmAt: RENT_DRAG_ALARM,
    last,
    journal: j ? { month: j.month, realizedUsd: j.realizedUsd, closed: j.closedCount, open: j.openCount, openDebitUsd: j.openDebitUsd, capNote: j.capNote } : null,
    needs: [25, 100, 250].map((t) => ({ sweepUsd: t, realizedUsd: realizedNeededFor(t, i.ladder.rate) })),
  };
}

/** The names the memo can be about: companies the dossiers cover, plus companies the book holds that the board or a dossier knows. Sorted, so the date alone picks. */
export function memoCandidates(held: string[]): string[] {
  const set = new Set<string>();
  for (const d of ALL_DOSSIERS) if (d.kind === "company") set.add(d.ticker);
  const board = new Set(LONG_NAMES.map((n) => n.ticker));
  for (const t of held) {
    const d = dossierFor(t);
    if ((d && d.kind === "company") || (!d && board.has(t))) set.add(t);
  }
  return [...set].sort();
}

/** Which name the committee reads today: the ET date's hash over the candidate list. Never a ranking, never "best". */
export function memoPick(dayKey: string, held: string[]): string | null {
  const c = memoCandidates(held);
  return c.length ? c[hash32(dayKey) % c.length]! : null;
}

function nextReport(dayKey: string, ticker: string): FirmMemo["catalyst"] {
  for (const e of timeline(dayKey, plusDays(dayKey, 14), { minQqqWeight: 0 })) {
    if (e.kind === "earnings" && e.ticker?.toUpperCase() === ticker) return { date: e.date, when: e.when === "pre-market" ? "pre-market" : e.when === "after close" ? "after close" : "time not stated" };
  }
  return null;
}

function memoOf(i: FirmInputs, read: ExposureRead): FirmMemo | null {
  const ticker = memoPick(i.dayKey, i.held);
  if (!ticker) return null;
  const d = dossierFor(ticker);
  const board = LONG_NAMES.find((n) => n.ticker === ticker) ?? null;
  const f = fundamentalsFor(ticker);
  const rvd = requiredVsDelivered(ticker);
  const ey = earningsYield(f);
  const basis = ey.forward != null ? "forward" : ey.trailing != null ? "trailing" : null;
  const eyValue = ey.forward ?? ey.trailing;
  const gate = d ? canAdd(d) : null;
  const level = d ? evidenceFor(ticker, "governance.ceo") : null;
  const killRule = d && d.killRule.trim() && !/^none/i.test(d.killRule.trim()) ? d.killRule : null;
  const w = d?.watch ?? board?.watch ?? null;
  return {
    ticker,
    name: d?.name ?? board?.name ?? ticker,
    held: i.held.includes(ticker),
    sleeve: board?.sleeve ?? null,
    dossier: d != null,
    sells: bound(d?.sells),
    moat: bound(d?.moat),
    useIn2035: bound(d?.useIn2035),
    killRule: bound(killRule, 260),
    boardKill: bound(board?.kill, 200),
    boardEvidence: bound(board?.evidence, 220),
    competitor: board?.competitor ?? null,
    boardRole: bound(board?.role, 160),
    regulatory: bound(d?.regulatory),
    caveat: bound(d?.caveat, 260),
    operator: d && level ? { ceo: bound(d.governance.ceo, 80) ?? "", level } : null,
    gate: gate ? { canAdd: gate.canAdd, reason: bound(gate.reason, 240)! } : null,
    watch: w ? { reason: bound(w.reason, 200)!, clearsWhen: bound(w.clearsWhen, 200)! } : null,
    fundamentalsAsOf: f && !f.pendingCapture ? f.asOf ?? null : null,
    durabilityAsOf: durabilityCapturedAt(),
    required: rvd.required,
    delivered: rvd.delivered,
    deliveredBasis: bound(rvd.deliveredBasis, 90),
    read: rvd.read,
    earningsYield: eyValue,
    earningsYieldBasis: basis,
    riskFreePct: RISK_FREE.yieldPct,
    riskFreeAsOf: RISK_FREE.asOf,
    spreadPts: ey.spreadPts,
    maxWeight: d?.maxWeight ?? null,
    weight: read.preview ? null : round4(effectiveWeight(read, ticker).total),
    catalyst: nextReport(i.dayKey, ticker),
  };
}

function boardOf(i: FirmInputs, cards: LongCard[]): FirmBoard {
  const split = splitSweep(i.queue.waitingUsd, cards).map((s) => ({
    sleeve: s.sleeve as string,
    weight: s.weight,
    usd: s.usd,
    ticker: s.ticker,
    state: (s.state === "pass" || s.state === "wait" || s.state === "fail" ? s.state : "none") as "pass" | "wait" | "fail" | "none",
    line: bound(s.line, 200)!,
  }));
  const counts = { pass: 0, wait: 0, fail: 0, total: cards.length };
  const why = new Map<string, number>();
  for (const c of cards) {
    counts[c.state] += 1;
    if (c.state === "wait") {
      const r = firstSentence(c.reason);
      why.set(r, (why.get(r) ?? 0) + 1);
    }
  }
  const reasons = [...why.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([reason, n]) => ({ reason: bound(reason, 140)!, n }));
  // The rule's two waits, nearest first: names still inside a lock-up by the day the lock-up ends, then names past it by the day four public quarters are done.
  const gateDate = (p: { read: { stage: string; lockupEnds: string | null; eligibleFrom: string | null } }): string => (p.read.stage === "lockup" ? p.read.lockupEnds : p.read.eligibleFrom) ?? "9999-12-31";
  const priced = pricedIpos(i.dayKey)
    .filter((p) => p.read.stage !== "research")
    .sort((a, b) => (a.read.stage === b.read.stage ? (gateDate(a) < gateDate(b) ? -1 : gateDate(a) > gateDate(b) ? 1 : 0) : a.read.stage === "lockup" ? -1 : 1))
    .slice(0, 4)
    .map((p) => ({ company: bound(p.company, 60)!, ticker: p.ticker, stage: p.read.stage as string, eligibleFrom: p.read.eligibleFrom, lockupEnds: p.read.lockupEnds, onBoard: LONG_NAMES.some((n) => n.ticker === p.ticker) }));
  const up = upcomingIpos(i.dayKey);
  const first = up[0];
  return {
    waitingUsd: i.queue.waitingUsd,
    split,
    counts,
    reasons,
    leftOff: LEFT_OFF.map((l) => ({ area: l.area, why: bound(l.why, 160)! })),
    ipo: {
      capturedAt: ipoCapturedAt(),
      upcoming: up.length,
      nextUpcoming: first ? { company: bound(first.company, 60)!, ticker: first.ticker, expected: first.expected, status: bound(first.status, 90)! } : null,
      priced,
      lockupDays: LOCKUP_DAYS_DEFAULT,
      trackRecordDays: TRACK_RECORD_DAYS,
    },
  };
}

function policyOf(): FirmPolicy {
  return {
    horizons: HORIZON_EVIDENCE.map((h) => ({ horizon: h.horizon, window: h.window, usable: h.usable, say: firstSentence(h.verdict) })),
    baseRates: BASE_RATES.map((b) => ({ id: b.id, say: firstSentence(b.claim), soWhat: firstSentence(b.soWhat) })),
    traps: STALENESS_TRAPS.map((t) => ({ ticker: t.ticker, lesson: firstSentence(t.lesson) })),
  };
}

export function buildFirm(i: FirmInputs): InvestFirm {
  const read = lookThrough(i.book.positions.map((p) => ({ ticker: p.ticker, valueUsd: p.valueUsd })));
  const cards = gradeBoard({ today: i.dayKey });
  const held = i.ledger ? heldPositions(i.ledger, i.dayKey) : [];
  return {
    asOf: i.dayKey,
    risk: riskOf(i, read, cards),
    compliance: complianceOf(i),
    diligence: diligenceOf(i),
    ops: i.ledger ? opsOf(i, i.ledger) : null,
    tax: i.ledger ? taxOf(i, i.ledger, held) : null,
    funding: i.ledger ? fundingOf(i, i.ledger) : null,
    memo: memoOf(i, read),
    board: boardOf(i, cards),
    policy: policyOf(),
    fresh: freshOf(i.dayKey),
    macro: { riskFreePct: RISK_FREE.yieldPct, riskFreeAsOf: RISK_FREE.asOf },
  };
}
