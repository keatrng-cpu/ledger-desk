/**
 * Robinhood QQQ/SPY options desk.
 *
 * Sleeve is $1,000, risk 15% = $150 max debit. Not the $100k futures book.
 * Long debit / debit spread only. Never places RH orders. Debit is an
 * estimate from proxy futures (SPY≈ES/10, QQQ≈NQ/40) — not a chain mid.
 *
 * Prefer QQQ when NQ leads (usual). SPY ATM weeklies often blow $150;
 * fall back to a 1–3 wide vertical rather than a lottery OTM.
 */

import { isHighProbPath } from "@/lib/alerts/path-alarm";
import type { DeskPayload } from "./build-desk";
import { isJudasWindow } from "./sessions";
import { etDateKey, weekDayFor, type WeekDayKind } from "./week-ahead";
import type { SetupCandidate } from "./scanner";
import {
  evaluateOptionsSwing,
  type OptionSide,
  type SwingUnderlier,
  type SwingSignal,
} from "./options-swing";
import { loadRhSleeve, rhMaxDebit, type RhSleeve } from "./options-sleeve";

export type RhHorizon = "day" | "swing";
export type RhVerdict = "ARMED" | "WATCH" | "STAND";
export type RhProduct = "single" | "debit_spread";

export type RhStrategyId =
  | "path_continuation"
  | "judas_ifvg_0dte"
  | "smt_lead"
  | "event_second"
  | "htf_swing";

export interface RhTicket {
  underlier: SwingUnderlier;
  side: OptionSide;
  product: RhProduct;
  dteMin: number;
  dteMax: number;
  dteTarget: number;
  deltaMin: number;
  deltaMax: number;
  strikeNote: string;
  contracts: number;
  estDebitEach: number;
  estDebitTotal: number;
  maxLoss: number;
  riskPctOfSleeve: number;
  hold: string;
  invalidation: string;
  targets: string[];
  robinhood: string;
}

export interface RhStrategyCard {
  id: RhStrategyId;
  name: string;
  horizon: RhHorizon;
  whyHighProb: string;
  verdict: RhVerdict;
  score: number;
  reasons: string[];
  blocks: string[];
  ticket: RhTicket | null;
  proxy: string | null;
  pathBand: string | null;
}

export interface UnderlierQuote {
  underlier: SwingUnderlier;
  proxy: string;
  spotEst: number;
  htf: string;
  dealing: string | null;
  session: string;
  changePct: number;
  role: "lead" | "lag" | "flat";
  ivUsed: number;
  menu: {
    label: string;
    dte: number;
    delta: number;
    single: number;
    spread: number;
    fitsSingle: boolean;
    fitsSpread: boolean;
  }[];
}

export interface OptionsDesk {
  sleeve: RhSleeve;
  maxDebit: number;
  focus: string;
  best: RhStrategyCard | null;
  day: RhStrategyCard[];
  swing: RhStrategyCard[];
  cards: RhStrategyCard[];
  quotes: { spy: UnderlierQuote; qqq: UnderlierQuote };
  primary: SwingUnderlier;
  swingSignal: SwingSignal;
  gates: { id: string; ok: boolean; label: string }[];
}

const IV = { SPY: 0.17, QQQ: 0.2 } as const;

function underlierOf(symbol: string): SwingUnderlier {
  return symbol.includes("ES") ? "SPY" : "QQQ";
}

function proxyPair(desk: DeskPayload) {
  const left = desk.bias.left;
  const right = desk.bias.right;
  const es =
    right.symbol === "ES" || right.symbol === "MES"
      ? right
      : left.symbol === "ES" || left.symbol === "MES"
        ? left
        : right;
  const nq =
    left.symbol === "NQ" || left.symbol === "MNQ"
      ? left
      : right.symbol === "NQ" || right.symbol === "MNQ"
        ? right
        : left;
  const esPx =
    desk.quotes.left.symbol === es.symbol
      ? desk.quotes.left.price
      : desk.quotes.right.symbol === es.symbol
        ? desk.quotes.right.price
        : es.last;
  const nqPx =
    desk.quotes.left.symbol === nq.symbol
      ? desk.quotes.left.price
      : desk.quotes.right.symbol === nq.symbol
        ? desk.quotes.right.price
        : nq.last;
  return { es, nq, esPx, nqPx };
}

function sideFromFutures(side: "long" | "short"): OptionSide {
  return side === "long" ? "call" : "put";
}

function locationFights(side: OptionSide, zone: string | undefined): boolean {
  if (side === "call" && zone === "premium") return true;
  if (side === "put" && zone === "discount") return true;
  return false;
}

function eventKind(kind: WeekDayKind | undefined): boolean {
  return kind === "nfp" || kind === "event";
}

function afterSecondImpulse(clock: DeskPayload["clock"]): boolean {
  return clock.etHour > 10 || (clock.etHour === 10 && clock.etMinute >= 15);
}

function pathCandidate(desk: DeskPayload): SetupCandidate | undefined {
  return desk.scan.candidates.find((c) => isHighProbPath(c));
}

function componentsHint(c: SetupCandidate | undefined) {
  const set = new Set(c?.components ?? []);
  return {
    sweep: set.has("sweep_significant"),
    displace: set.has("displacement") || set.has("mss") || set.has("cisd"),
    ifvg: set.has("ifvg"),
  };
}

/** SPY ≈ ES/10, QQQ ≈ NQ/40. Estimate only — RH chain is the fill. */
export function estimateSpot(underlier: SwingUnderlier, esPx: number, nqPx: number): number {
  if (underlier === "SPY") return esPx / 10;
  return nqPx / 40;
}

/**
 * Rough debit per CONTRACT (×100). ATM ~ 0.4 S σ √T; scale by Δ/0.40.
 * 0DTE uses 0.25 day so we do not print $0.
 */
export function estimateDebitContract(
  spot: number,
  dte: number,
  delta: number,
  iv: number,
): number {
  const t = Math.max(dte, 0.25) / 365;
  const perShare = spot * iv * Math.sqrt(t) * 0.4 * (delta / 0.4);
  const dollars = perShare * 100;
  return Math.max(15, Math.round(dollars / 5) * 5);
}

function estimateSpreadContract(spot: number, dte: number, iv: number, widthPts: number): number {
  const buy = estimateDebitContract(spot, dte, 0.4, iv);
  const sell = estimateDebitContract(spot, dte, 0.2, iv);
  const widthCap = widthPts * 100;
  const raw = Math.max(20, buy - sell);
  return Math.min(raw, Math.round(widthCap * 0.5));
}

function roundStrike(spot: number): number {
  return Math.round(spot);
}

function maxContracts(dte: number): number {
  if (dte <= 0) return 1;
  if (dte <= 2) return 2;
  return 2;
}

function pickWidth(underlier: SwingUnderlier, dte: number): number {
  if (underlier === "SPY") return dte <= 2 ? 2 : 3;
  return dte <= 2 ? 2 : 4;
}

function sizeProduct(
  underlier: SwingUnderlier,
  side: OptionSide,
  spot: number,
  dte: number,
  delta: number,
  iv: number,
  cap: number,
): {
  product: RhProduct;
  contracts: number;
  each: number;
  total: number;
  strikeNote: string;
} | null {
  const single = estimateDebitContract(spot, dte, delta, iv);
  const nMax = maxContracts(dte);
  if (single <= cap) {
    const n = Math.min(nMax, Math.max(1, Math.floor(cap / single)));
    const k = roundStrike(spot);
    const otm = side === "put" ? k - 1 : k + 1;
    return {
      product: "single",
      contracts: n,
      each: single,
      total: n * single,
      strikeNote: `ATM/~${otm} ${side} · est $${(single / 100).toFixed(2)} (not a chain mid)`,
    };
  }
  const width = pickWidth(underlier, dte);
  const spread = estimateSpreadContract(spot, dte, iv, width);
  if (spread <= cap) {
    const n = Math.min(nMax, Math.max(1, Math.floor(cap / spread)));
    const k = roundStrike(spot);
    const longK = side === "put" ? k : k;
    const shortK = side === "put" ? longK - width : longK + width;
    return {
      product: "debit_spread",
      contracts: n,
      each: spread,
      total: n * spread,
      strikeNote: `${longK}/${shortK} ${side} vertical · width $${width} · est $${(spread / 100).toFixed(2)}`,
    };
  }
  return null;
}

function rhLine(t: {
  underlier: SwingUnderlier;
  side: OptionSide;
  product: RhProduct;
  contracts: number;
  total: number;
  each: number;
  strikeNote: string;
  dte: number;
}): string {
  const verb = t.product === "debit_spread" ? "DEBIT SPREAD" : "BUY TO OPEN";
  return `Robinhood: ${verb} ${t.contracts} ${t.underlier} ${t.side.toUpperCase()} · DTE ${t.dte} · ${t.strikeNote} · pay ~$${t.total} ($${t.each}/ea) · max loss = debit. No naked short. Do not average.`;
}

function toTicket(
  underlier: SwingUnderlier,
  side: OptionSide,
  spot: number,
  dte: number,
  deltaLo: number,
  deltaHi: number,
  iv: number,
  cap: number,
  sleeve: RhSleeve,
  hold: string,
  invalidation: string,
  targets: string[],
): RhTicket | null {
  const sized = sizeProduct(underlier, side, spot, dte, (deltaLo + deltaHi) / 2, iv, cap);
  if (!sized) return null;
  return {
    underlier,
    side,
    product: sized.product,
    dteMin: dte,
    dteMax: dte,
    dteTarget: dte,
    deltaMin: deltaLo,
    deltaMax: deltaHi,
    strikeNote: sized.strikeNote,
    contracts: sized.contracts,
    estDebitEach: sized.each,
    estDebitTotal: sized.total,
    maxLoss: sized.total,
    riskPctOfSleeve: sized.total / sleeve.equity,
    hold,
    invalidation,
    targets,
    robinhood: rhLine({
      underlier,
      side,
      product: sized.product,
      contracts: sized.contracts,
      total: sized.total,
      each: sized.each,
      strikeNote: sized.strikeNote,
      dte,
    }),
  };
}

function underlierSheet(
  underlier: SwingUnderlier,
  proxy: ReturnType<typeof proxyPair>["es"],
  spot: number,
  role: UnderlierQuote["role"],
  cap: number,
): UnderlierQuote {
  const iv = IV[underlier];
  const rows: { label: string; dte: number; delta: number }[] = [
    { label: "0DTE 0.40Δ", dte: 0, delta: 0.4 },
    { label: "1–2 DTE 0.40Δ", dte: 1, delta: 0.4 },
    { label: "5 DTE 0.35Δ", dte: 5, delta: 0.35 },
    { label: "10 DTE 0.35Δ", dte: 10, delta: 0.35 },
    { label: "28 DTE 0.40Δ", dte: 28, delta: 0.4 },
  ];
  return {
    underlier,
    proxy: proxy.symbol,
    spotEst: spot,
    htf: `${proxy.topDown} (${Math.round((proxy.confidence ?? 0) * 100)}%)`,
    dealing: proxy.dealing?.zone ?? null,
    session: proxy.sessionStance,
    changePct: proxy.changePct,
    role,
    ivUsed: iv,
    menu: rows.map((r) => {
      const single = estimateDebitContract(spot, r.dte, r.delta, iv);
      const spread = estimateSpreadContract(spot, r.dte, iv, pickWidth(underlier, r.dte));
      return {
        label: r.label,
        dte: r.dte,
        delta: r.delta,
        single,
        spread,
        fitsSingle: single <= cap,
        fitsSpread: spread <= cap,
      };
    }),
  };
}

function pathContinuation(desk: DeskPayload, sleeve: RhSleeve, cap: number): RhStrategyCard {
  const blocks: string[] = [];
  const reasons: string[] = [];
  const clock = desk.clock;
  const day = desk.weekAhead?.today ?? weekDayFor(etDateKey());
  const c = pathCandidate(desk);
  const { es, nq, esPx, nqPx } = proxyPair(desk);

  if (!clock.isWeekday) blocks.push("Weekend");
  if (clock.killzone !== "ny_am") blocks.push(`Not NY AM (${clock.killzoneLabel})`);
  if (desk.news?.verdict === "blackout") blocks.push(desk.news.reason || "News blackout");
  if (day?.kind === "holiday") blocks.push("Cash holiday");
  if (eventKind(day?.kind) && !afterSecondImpulse(clock)) {
    blocks.push("Event window — wait second impulse after 10:15 ET");
  }
  if (isJudasWindow(clock.etHour, clock.etMinute)) {
    blocks.push("Judas 9:30–9:45 — no new day premium");
  }
  if (!c) blocks.push("No A+/A/A− PATH");

  if (c) {
    const band = String(c.pathBand || c.grade);
    reasons.push(`${c.symbol} ${c.side} PATH ${band} Q ${c.confluence.toFixed(2)}`);
    reasons.push(c.completeStrategy || c.strategyPrimary);
    if (!c.htfOk) blocks.push("PATH is counter-HTF — no RH debit");
    const proxy = c.symbol.includes("ES") ? es : nq;
    if (locationFights(sideFromFutures(c.side), proxy.dealing?.zone)) {
      blocks.push(`Dealing ${proxy.dealing?.zone} fights ${c.side}`);
    }
    if (day?.kind === "range_build" && band !== "A+") {
      blocks.push("Monday range-build — A+ only for day premium");
    }
    if (day?.kind === "a_plus_only" && band !== "A+") {
      blocks.push("Week card is A+ only");
    }
  }

  const armed = blocks.length === 0 && Boolean(c);
  const watch = Boolean(c) && blocks.every((b) => /NY AM|Judas|Event window|range-build/.test(b));
  const verdict: RhVerdict = armed ? "ARMED" : watch ? "WATCH" : "STAND";
  const side = c ? sideFromFutures(c.side) : "put";
  const underlier = c ? underlierOf(c.symbol) : "QQQ";
  const spot = estimateSpot(underlier, esPx, nqPx);
  const ticket =
    c && verdict !== "STAND"
      ? toTicket(
          underlier,
          side,
          spot,
          1,
          0.35,
          0.45,
          IV[underlier],
          cap,
          sleeve,
          "NY AM. Flat 11:00 ET unless +50% premium and HTF still aligned.",
          c.invalidation || "Futures PATH invalidates or HTF flips",
          [
            "Trim 50% at +40–60% of debit",
            "Hard time stop 11:00 ET",
            `Max loss $${cap} — do not roll`,
          ],
        )
      : null;
  if (c && verdict !== "STAND" && !ticket) {
    blocks.push(`ATM 1–2 DTE too rich for $${cap} sleeve — stand, do not lotto OTM`);
  }

  return {
    id: "path_continuation",
    name: "PATH continuation 1–2 DTE",
    horizon: "day",
    whyHighProb:
      "Same A+/A/A− PATH as Trade Now. 1–2 DTE so 0DTE pin does not own you. Size to $150, not $1,000.",
    verdict: verdict === "STAND" ? "STAND" : ticket ? verdict : "WATCH",
    score: c?.confluence ?? 0,
    reasons,
    blocks,
    pathBand: c ? String(c.pathBand || c.grade) : null,
    proxy: c?.symbol ?? null,
    ticket,
  };
}

function judasIfvg0dte(desk: DeskPayload, sleeve: RhSleeve, cap: number): RhStrategyCard {
  const blocks: string[] = [];
  const reasons: string[] = [];
  const clock = desk.clock;
  const day = desk.weekAhead?.today ?? weekDayFor(etDateKey());
  const c = pathCandidate(desk);
  const hint = componentsHint(c);
  const band = c ? String(c.pathBand || c.grade) : null;
  const { esPx, nqPx } = proxyPair(desk);

  if (!clock.isWeekday) blocks.push("Weekend");
  if (clock.killzone !== "ny_am") blocks.push(`Not NY AM (${clock.killzoneLabel})`);
  if (isJudasWindow(clock.etHour, clock.etMinute)) blocks.push("Still in Judas — wait 9:45");
  if (clock.etHour < 9 || (clock.etHour === 9 && clock.etMinute < 45)) {
    blocks.push("0DTE only after 9:45 ET");
  }
  if (desk.news?.verdict === "blackout") blocks.push(desk.news.reason || "News blackout");
  if (day?.kind === "holiday") blocks.push("Cash holiday");
  if (eventKind(day?.kind) && !afterSecondImpulse(clock)) {
    blocks.push("No 0DTE into the event print");
  }
  if (day?.kind === "nfp") {
    blocks.push("NFP Friday — 0DTE is seek-and-destroy unless A+ after 10:15");
  }
  if (!c) blocks.push("No A+/A/A− PATH");
  if (band && band !== "A+") blocks.push(`0DTE needs A+ (have ${band})`);
  if (c && !hint.displace) blocks.push("No displacement / MSS on the card");
  if (c && !hint.ifvg && !hint.sweep) blocks.push("Need IFVG or the Judas sweep tagged");

  if (c && band === "A+") {
    reasons.push(`${c.symbol} ${c.side} A+ Q ${c.confluence.toFixed(2)}`);
    if (hint.sweep) reasons.push("Sweep tagged");
    if (hint.displace) reasons.push("Displacement / MSS tagged");
    if (hint.ifvg) reasons.push("IFVG tagged");
    reasons.push("1 contract max — 0DTE gamma on a $1,000 sleeve");
  }

  const armed = blocks.length === 0 && Boolean(c) && band === "A+";
  const watch = Boolean(c) && band === "A+" && blocks.every((b) => /Judas|9:45|NY AM/.test(b));
  const verdict: RhVerdict = armed ? "ARMED" : watch ? "WATCH" : "STAND";
  const side = c ? sideFromFutures(c.side) : "put";
  const underlier = c ? underlierOf(c.symbol) : "QQQ";
  const spot = estimateSpot(underlier, esPx, nqPx);
  const ticket =
    c && verdict !== "STAND"
      ? toTicket(
          underlier,
          side,
          spot,
          0,
          0.35,
          0.5,
          IV[underlier],
          cap,
          sleeve,
          "Minutes. Flat 11:00 ET. No overnight 0DTE.",
          "Failed displacement or reclaim of the raid extreme",
          ["+30–50% of debit out half", "Flat rest at structure or 11:00"],
        )
      : null;

  return {
    id: "judas_ifvg_0dte",
    name: "Judas → IFVG 0DTE",
    horizon: "day",
    whyHighProb:
      "A+ after 9:45 with raid + MSS/IFVG only. One contract. $150 is the whole trade.",
    verdict: verdict === "STAND" ? "STAND" : ticket ? verdict : "WATCH",
    score: band === "A+" ? c?.confluence ?? 0 : 0,
    reasons,
    blocks,
    pathBand: band,
    proxy: c?.symbol ?? null,
    ticket,
  };
}

function smtLead(desk: DeskPayload, sleeve: RhSleeve, cap: number): RhStrategyCard {
  const blocks: string[] = [];
  const reasons: string[] = [];
  const { es, nq, esPx, nqPx } = proxyPair(desk);
  const smt = desk.scan.smt;
  const stack = desk.smtStack?.primary;
  const clock = desk.clock;
  const day = desk.weekAhead?.today ?? weekDayFor(etDateKey());

  const bearish = smt?.state === "bearish_smt" || stack?.kind === "bearish";
  const bullish = smt?.state === "bullish_smt" || stack?.kind === "bullish";

  if (!clock.isWeekday) blocks.push("Weekend");
  if (desk.news?.verdict === "blackout") blocks.push(desk.news.reason || "News blackout");
  if (day?.kind === "holiday") blocks.push("Cash holiday");
  if (!bearish && !bullish) blocks.push("No active SMT (need HH vs LH or LL vs HL)");

  let underlier: SwingUnderlier = "QQQ";
  let proxySym = nq.symbol;
  let side: OptionSide = "put";

  if (bearish) {
    side = "put";
    const nqWeaker = (nq.changePct ?? 0) < (es.changePct ?? 0);
    underlier = nqWeaker || nq.topDown === "bear" ? "QQQ" : "SPY";
    proxySym = underlier === "QQQ" ? nq.symbol : es.symbol;
    reasons.push(smt?.note || stack?.note || "Bearish SMT");
    reasons.push(
      `${nq.symbol} ${nq.changePct?.toFixed(2)}% vs ${es.symbol} ${es.changePct?.toFixed(2)}%`,
    );
    if (nq.topDown === "bull" && es.topDown === "bull") {
      blocks.push("Both HTF still bull — SMT fade only, not a swing debit");
    }
    if (underlier === "QQQ" && locationFights("put", nq.dealing?.zone)) {
      blocks.push(`NQ dealing ${nq.dealing?.zone} — wait premium for puts`);
    }
    reasons.push(
      underlier === "QQQ"
        ? "QQQ is the cheaper book on a $150 cap when NQ leads weakness"
        : "ES held relative — SPY put only if QQQ already took the high",
    );
  } else if (bullish) {
    side = "call";
    const nqStronger = (nq.changePct ?? 0) > (es.changePct ?? 0);
    underlier = nqStronger || nq.topDown === "bull" ? "QQQ" : "SPY";
    proxySym = underlier === "QQQ" ? nq.symbol : es.symbol;
    reasons.push(smt?.note || stack?.note || "Bullish SMT");
    if (nq.topDown === "bear" && es.topDown === "bear") {
      blocks.push("Both HTF bear — no SMT call");
    }
    if (locationFights("call", (underlier === "QQQ" ? nq : es).dealing?.zone)) {
      blocks.push("Call into premium — wait discount");
    }
  }

  const path = pathCandidate(desk);
  if (path) {
    const pathSide = sideFromFutures(path.side);
    if (pathSide === side) {
      reasons.push(`PATH agrees ${path.symbol} ${path.side} ${path.pathBand || path.grade}`);
    } else if (path.actionable) {
      blocks.push(`PATH fights SMT (${path.symbol} ${path.side})`);
    }
  }

  const score =
    (bearish || bullish ? 0.62 : 0) +
    (nq.topDown === "bear" && bearish ? 0.08 : 0) +
    (path && sideFromFutures(path.side) === side ? 0.06 : 0);

  const sessionOk =
    clock.killzone === "ny_am" || clock.killzone === "ny_pm" || clock.inTradeWindow;
  const armed = blocks.length === 0 && (bearish || bullish) && sessionOk;
  const watch = (bearish || bullish) && blocks.length <= 1;
  const verdict: RhVerdict = armed ? "ARMED" : watch ? "WATCH" : "STAND";
  const spot = estimateSpot(underlier, esPx, nqPx);
  const ticket =
    verdict !== "STAND"
      ? toTicket(
          underlier,
          side,
          spot,
          5,
          0.3,
          0.4,
          IV[underlier],
          cap,
          sleeve,
          "2–5 sessions. Out if SMT resolves (both books take the same extreme).",
          side === "put"
            ? "Both books reclaim the sweep high = out. ES taking a high NQ refuses is still valid."
            : "Both books fail the hold low = out",
          ["Trim 50% at +50% of debit", "Do not buy SPY and QQQ together"],
        )
      : null;

  if (verdict !== "STAND" && !ticket) {
    blocks.push(`5 DTE ${underlier} too rich for $${cap} — would need a lottery Δ, skip`);
  }

  return {
    id: "smt_lead",
    name: "SMT lead 3–7 DTE",
    horizon: "swing",
    whyHighProb:
      "NQ vs ES is this desk's cleanest tell. QQQ usually wins the $150 cap vs SPY ATM.",
    verdict: verdict === "STAND" ? "STAND" : ticket ? verdict : "WATCH",
    score,
    reasons,
    blocks,
    pathBand: path ? String(path.pathBand || path.grade) : null,
    proxy: proxySym,
    ticket,
  };
}

function eventSecond(desk: DeskPayload, sleeve: RhSleeve, cap: number): RhStrategyCard {
  const blocks: string[] = [];
  const reasons: string[] = [];
  const clock = desk.clock;
  const day = desk.weekAhead?.today ?? weekDayFor(etDateKey());
  const c = pathCandidate(desk);
  const { esPx, nqPx } = proxyPair(desk);

  if (!eventKind(day?.kind) && day?.kind !== "two_way" && day?.kind !== "a_plus_only") {
    blocks.push(`Not an event-style day (${day?.kind ?? "no week card"})`);
  }
  if (!afterSecondImpulse(clock)) blocks.push("Before 10:15 ET — stand the first impulse");
  if (desk.news?.verdict === "blackout") blocks.push(desk.news.reason || "News still blacked out");
  if (!c) blocks.push("Need PATH after the print");
  if (c && day?.kind === "a_plus_only" && String(c.pathBand || c.grade) !== "A+") {
    blocks.push("ADP / A+ only day");
  }
  if (c) {
    reasons.push(`${c.symbol} ${c.side} ${c.pathBand || c.grade} after the window`);
    if (day?.trade) reasons.push(day.trade);
  }

  const armed = blocks.length === 0 && Boolean(c);
  const watch = eventKind(day?.kind) || day?.kind === "two_way" || day?.kind === "a_plus_only";
  const verdict: RhVerdict = armed ? "ARMED" : watch && !armed ? "WATCH" : "STAND";
  const side = c ? sideFromFutures(c.side) : "put";
  const underlier = c ? underlierOf(c.symbol) : "QQQ";
  const spot = estimateSpot(underlier, esPx, nqPx);
  const ticket =
    c && verdict !== "STAND"
      ? toTicket(
          underlier,
          side,
          spot,
          7,
          0.3,
          0.4,
          IV[underlier],
          cap,
          sleeve,
          "1–4 sessions. Flatten before the NEXT high-impact print.",
          c.invalidation || "HTF flip or failed second impulse",
          ["Trim 50% at +50–80%", "Spread first — 7 DTE ATM usually > $150"],
        )
      : null;

  return {
    id: "event_second",
    name: "Event second impulse 7–14 DTE",
    horizon: "swing",
    whyHighProb:
      "Week card names the raid. Debit the second impulse after 10:15. Usually a vertical on this sleeve.",
    verdict: verdict === "STAND" ? "STAND" : ticket ? verdict : "WATCH",
    score: armed ? c?.confluence ?? 0 : watch ? 0.45 : 0,
    reasons,
    blocks,
    pathBand: c ? String(c.pathBand || c.grade) : null,
    proxy: c?.symbol ?? null,
    ticket,
  };
}

function htfSwingCard(
  swing: SwingSignal,
  desk: DeskPayload,
  sleeve: RhSleeve,
  cap: number,
): RhStrategyCard {
  const { esPx, nqPx } = proxyPair(desk);
  const verdict: RhVerdict =
    swing.verdict === "ARMED_CALL" || swing.verdict === "ARMED_PUT"
      ? "ARMED"
      : swing.verdict === "WATCH"
        ? "WATCH"
        : "STAND";
  const plan = swing.plan;
  const side = plan?.side ?? "put";
  const underlier = plan?.underlier ?? "QQQ";
  const spot = estimateSpot(underlier, esPx, nqPx);
  const extraBlocks = [...swing.blocks];
  if (desk.monthAhead?.phase?.id === "labor" && verdict === "ARMED") {
    extraBlocks.push("Labor / NFP week — do not pay 21–45 DTE into Friday");
  }
  const laborWatch = extraBlocks.some((b) => /Labor/.test(b));
  const ticket =
    plan && verdict !== "STAND" && !laborWatch
      ? toTicket(
          underlier,
          side,
          spot,
          21,
          0.3,
          0.4,
          IV[underlier],
          cap,
          sleeve,
          `${plan.holdSessionsMin}–${plan.holdSessionsMax} sessions`,
          plan.invalidation,
          [
            ...plan.targets,
            "ATM 21–45 DTE will not fit $150 — expect a $2–3 vertical or STAND",
          ],
        )
      : null;

  return {
    id: "htf_swing",
    name: "HTF swing 21–45 DTE",
    horizon: "swing",
    whyHighProb:
      "HTF absolute + correct half. On a $150 cap this is almost always a vertical, not a naked 40Δ.",
    verdict: laborWatch ? "WATCH" : verdict === "STAND" ? "STAND" : ticket ? verdict : "WATCH",
    score: swing.confidence,
    reasons: [...swing.reasons],
    blocks: extraBlocks,
    pathBand: null,
    proxy: swing.proxySymbol,
    ticket,
  };
}

export function evaluateOptionsDesk(
  desk: DeskPayload,
  sleeve: RhSleeve = loadRhSleeve(),
): OptionsDesk {
  const cap = rhMaxDebit(sleeve);
  const swingSignal = evaluateOptionsSwing(desk);
  const { es, nq, esPx, nqPx } = proxyPair(desk);
  const nqWeaker = (nq.changePct ?? 0) < (es.changePct ?? 0) - 0.05;
  const nqStronger = (nq.changePct ?? 0) > (es.changePct ?? 0) + 0.05;
  const qqqRole: UnderlierQuote["role"] = nqWeaker ? "lead" : nqStronger ? "lead" : "flat";
  const spyRole: UnderlierQuote["role"] = nqWeaker ? "lag" : nqStronger ? "lag" : "flat";

  const quotes = {
    spy: underlierSheet("SPY", es, estimateSpot("SPY", esPx, nqPx), spyRole, cap),
    qqq: underlierSheet("QQQ", nq, estimateSpot("QQQ", esPx, nqPx), qqqRole, cap),
  };

  const path = pathCandidate(desk);
  const primary: SwingUnderlier = path
    ? underlierOf(path.symbol)
    : nq.topDown === "bear" || nqWeaker
      ? "QQQ"
      : "SPY";

  const cards = [
    pathContinuation(desk, sleeve, cap),
    judasIfvg0dte(desk, sleeve, cap),
    smtLead(desk, sleeve, cap),
    eventSecond(desk, sleeve, cap),
    htfSwingCard(swingSignal, desk, sleeve, cap),
  ];

  const best = cards.filter((c) => c.verdict === "ARMED" && c.ticket).sort((a, b) => b.score - a.score)[0] ?? null;
  const day = cards.filter((c) => c.horizon === "day");
  const swing = cards.filter((c) => c.horizon === "swing");

  const clock = desk.clock;
  const dayPlan = desk.weekAhead?.today;
  const gates = [
    { id: "news", ok: desk.news?.verdict !== "blackout", label: "News not blacked out" },
    {
      id: "judas",
      ok: !isJudasWindow(clock.etHour, clock.etMinute),
      label: "Outside Judas 9:30–9:45",
    },
    {
      id: "htf",
      ok: desk.bias.left.topDown !== "neutral" || desk.bias.right.topDown !== "neutral",
      label: "HTF not neutral",
    },
    { id: "path", ok: Boolean(path), label: "PATH A+/A/A− (day tickets)" },
    {
      id: "week",
      ok: dayPlan?.kind !== "holiday",
      label: dayPlan ? `Week card ${dayPlan.kind}` : "No week card",
    },
    {
      id: "sleeve",
      ok: cap >= 50,
      label: `Sleeve $${sleeve.equity.toLocaleString()} · risk ${(sleeve.riskPct * 100).toFixed(0)}% = $${cap}`,
    },
  ];

  const watch = cards.find((c) => c.verdict === "WATCH");
  const focus = best?.ticket
    ? `RH ${best.ticket.product === "debit_spread" ? "SPREAD" : "BUY"} ${best.ticket.contracts} ${best.ticket.underlier} ${best.ticket.side.toUpperCase()} · ${best.name} · pay ~$${best.ticket.estDebitTotal} · max loss $${best.ticket.maxLoss}`
    : watch
      ? `WATCH — ${watch.name}: ${watch.blocks[0] ?? "timing"}`
      : `STAND RH — ${cards.find((c) => c.blocks[0])?.blocks[0] ?? "no high-prob ticket"}`;

  return {
    sleeve,
    maxDebit: cap,
    focus,
    best,
    day,
    swing,
    cards,
    quotes,
    primary,
    swingSignal,
    gates,
  };
}

export function optionsDeskPlaybook(): string[] {
  return [
    "Sleeve $1,000. Risk 15% = $150 max debit per thesis. That $150 is the whole loss — do not buy $1,000 of premium and hope a 15% stop holds on 0DTE.",
    "QQQ ← NQ · SPY ← ES. Never buy both the same day. QQQ usually fits the cap; SPY ATM weeklies often need a vertical.",
    "Estimates use ES/10 and NQ/40 plus a 17–20% IV. Robinhood chain is the fill. If the ask is > $150, skip or tighten the spread — do not chase OTM lotto.",
    "Day default: 1–2 DTE PATH continuation, 1–2 contracts. 0DTE is A+ after 9:45 with raid + MSS/IFVG, 1 contract only.",
    "SMT lead 3–7 DTE is the cleanest swing when NQ and ES disagree. Prefer QQQ puts when NQ is the weaker book.",
    "Event days: first impulse is the sweep. Debit the second after 10:15, usually a spread.",
    "Labor / NFP week: no new 21–45 DTE. Friday manage only.",
    "Trim 50% at +40–80% of debit. Time-stop day tickets 11:00 ET. Never average. Separate from the $100k futures paper book.",
  ];
}
