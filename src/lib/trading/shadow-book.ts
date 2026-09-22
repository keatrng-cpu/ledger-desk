/**
 * Shadow book — every PATH-grade card the desk REFUSED, paper-traded anyway,
 * against real tape, and logged with its PnL, its path and its analysis.
 *
 * WHY THIS EXISTS
 * The paper book is the sample of what the desk TOOK. It says nothing about
 * what the gates cost or saved: a STAND on "POI in correct half" that would
 * have paid +1.6R is invisible, and so is the one that would have been
 * stopped in eight minutes. The 2026-09-21 replay found the sequence prints
 * TAKE ~0×/month on closed bars while PATH-grade cards print on half of all
 * NY-AM bars — so nearly every card the desk sees is a refusal, and the only
 * way to learn whether a gate is earning its keep is to trade the refusals
 * on paper and count. The trader's call (2026-09-21): do exactly that,
 * automatically, and feed the result back into discretion.
 *
 * WHAT A SHADOW IS, AND IS NOT
 * A shadow is opened when a book has a priced plan (smc-master.ts
 * TradePlan: entry at consequent encroachment, stop beyond the raid, T1 at
 * the draw, T2 at the range) AND a PATH-grade candidate AND the word is
 * STAND or WAIT. Two legs are opened per refusal, because "what if we had
 * taken it" has two honest answers:
 *   limit — a limit resting at the plan's CE, filled only if price comes
 *           back inside the fill window (3h). This is the desk's own trade.
 *   chase — a market entry at the print the moment the card was refused.
 *           This is the trade the desk tells you NOT to take.
 * Both are resolved on real tape only: closed 15m bars with intrabar ties
 * AGAINST the trade, plus the live prints between bars, with the paper
 * book's own scale-out (T1 banks the configured fraction, stop → break-even,
 * runner to T2), a 32-bar time stop and a flat at the cash close.
 *
 * A shadow is NOT a paper trade. It never touches the paper book, the
 * journal, the attestation chain, sizing or any gate. It is evidence about
 * the gates, kept in its own ledger (shadow_trades) and read by
 * discretion-memory.ts, which turns it into per-refusal verdicts and the
 * "little things" — the context features that separate the refusals that
 * would have paid from the ones that would not.
 *
 * "Do not invent fills" holds: a limit that price never revisits is
 * `unfilled`, not a trade; a chase fills at a price that actually printed.
 */

import { APLUS_RULES } from "@/lib/aplus/config";
import { isHighProbPath } from "@/lib/alerts/path-alarm";
import type { OhlcBar } from "@/lib/market/types";
import type { DeskPayload } from "./build-desk";
import { APLUS_PROBE_RISK } from "./profit-rules";
import type { SetupCandidate } from "./scanner";
import { etWallParts, etWallToEpochMs, isJudasWindow } from "./sessions";
import type { SmcLayer, SmcMasterBook } from "./smc-master";
import { ladderTags } from "./tf-ladder";

export type ShadowLeg = "limit" | "chase";
export type ShadowStatus = "resting" | "open" | "won" | "lost" | "scratch" | "unfilled" | "expired";
export type ShadowKind = "refusal" | "wait";

export interface ShadowEvent {
  t: number;
  kind: "open" | "fill" | "t1" | "t2" | "stop" | "be" | "time" | "unfilled" | "expired";
  text: string;
}

export interface ShadowAnalysis {
  /** What the outcome says about the gate that refused the card. */
  verdict: "gate-right" | "gate-cost" | "neutral" | "unfilled";
  headline: string;
  why: string[];
  lesson: string;
}

export interface ShadowTrade {
  id: string;
  dayKey: string;
  symbol: string;
  side: "long" | "short";
  leg: ShadowLeg;
  kind: ShadowKind;
  word: "STAND" | "WAIT";
  /** The must-layer that refused the card (smc-master layer id + label). */
  reasonId: string;
  reason: string;
  reasonDetail: string;
  grade: string;
  confluence: number;
  strategy: string;
  openedAt: number;
  killzone: string;
  entry: number;
  stop: number;
  t1: number | null;
  t2: number | null;
  riskPts: number;
  /** Dollars at risk at the grade's paper sizing — R × this is the $ PnL. */
  riskDollars: number;
  status: ShadowStatus;
  fillAt?: number;
  fillPrice?: number;
  exitAt?: number;
  exitPrice?: number;
  exitReason?: string;
  r?: number;
  pnl?: number;
  /** Excursion after the fill, in R: best it went for us / worst against. */
  mfe?: number;
  mae?: number;
  /** Extremes seen since the fill — closed bars and live prints. */
  seenHi: number;
  seenLo: number;
  /** Running scale-out state. */
  banked: number;
  remaining: number;
  t1Hit: boolean;
  stopLevel: number;
  /** Closed bars processed so far (bar time), so ticking is incremental. */
  lastBarT: number;
  /** Closed bars since open (limit: fill window) / since fill (time stop). */
  barsSinceOpen: number;
  barsSinceFill: number;
  path: ShadowEvent[];
  layers: { id: string; label: string; state: SmcLayer["state"]; must: boolean }[];
  /** The little things — context at the moment of refusal, for slicing. */
  tags: Record<string, string>;
  analysis?: ShadowAnalysis;
  source: "live" | "replay";
  updatedAt: number;
}

/** Bars a resting limit waits before it is `unfilled` (3h on 15m). */
export const FILL_WINDOW_BARS = 12;
/** Bars an open shadow is held before the time stop (8h on 15m). */
export const MAX_HOLD_BARS = 32;
/** Shadows per symbol per day, both legs counted. Past this a day is noise. */
export const MAX_PER_SYMBOL_DAY = 8;
/** Cash close, ET minutes — everything is flat here. */
const FLAT_ET_MIN = 16 * 60;
const BAR_MS = 15 * 60_000;
const KEY = "ledger.shadow-book.v1";
const MAX_LOCAL = 500;
const EVENT = "ledger-shadow";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const px = (n: number) => n.toFixed(2);

export function etDayKey(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function etTime(ms: number): string {
  const p = etWallParts(ms);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/* ── Sizing ──────────────────────────────────────────────────────────────── */

/** Dollars at risk for a grade on the paper book, A+ at the probe size. */
export function riskDollarsForGrade(grade: string): number {
  const g = grade === "A−" ? "A-" : grade;
  const pct =
    g === "A+"
      ? APLUS_PROBE_RISK
      : (APLUS_RULES.riskByGrade[g as keyof typeof APLUS_RULES.riskByGrade] ?? APLUS_RULES.riskPct);
  return r2(APLUS_RULES.paperEquity * (pct || APLUS_RULES.riskPct));
}

/* ── Tags: the little things ─────────────────────────────────────────────── */

function bucket(n: number | null | undefined, edges: number[], labels: string[]): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  for (let i = 0; i < edges.length; i++) if (n < edges[i]!) return labels[i]!;
  return labels[edges.length]!;
}

/**
 * Context at the moment of refusal, as flat string tags so the scorecard
 * can group by any of them. Everything here is from the payload; nothing is
 * inferred after the fact.
 */
export function shadowTags(
  desk: ShadowDesk,
  book: SmcMasterBook,
  cand: SetupCandidate,
  side: "long" | "short",
  price: number,
): Record<string, string> {
  const isLeft = desk.left.symbol === book.symbol;
  const bias = isLeft ? desk.bias.left : desk.bias.right;
  const narr = isLeft ? desk.narrative.left : desk.narrative.right;
  const draw = isLeft ? desk.draws.left : desk.draws.right;
  const clock = desk.clock;
  const m = clock.etHour * 60 + clock.etMinute;
  const atr = draw.atr || 0;
  const plan = book.plan;
  const zoneBox = plan?.entryZone ?? null;
  const away =
    zoneBox && atr > 0
      ? Math.max(0, price > zoneBox.top ? price - zoneBox.top : zoneBox.bottom - price) / atr
      : null;
  const musts = book.layers.filter((l) => l.must);
  const want = side === "long" ? "bull" : "bear";
  const dolAgrees = draw.primary
    ? (side === "long" && draw.primary.side === "above") || (side === "short" && draw.primary.side === "below")
    : false;
  const zone = book.dealing?.zone ?? bias.dealing?.zone ?? "none";
  const dow = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][clock.weekday] ?? "n/a";
  return {
    kz: clock.killzone,
    et: bucket(m, [9 * 60 + 45, 10 * 60, 10 * 60 + 30, 11 * 60, 11 * 60 + 30], ["<09:45", "09:45–10:00", "10:00–10:30", "10:30–11:00", "11:00–11:30", ">11:30"]),
    judas: isJudasWindow(clock.etHour, clock.etMinute) ? "y" : "n",
    dow,
    htf: bias.topDown,
    htfAgrees: bias.topDown === want ? "y" : bias.topDown === "neutral" ? "neutral" : "n",
    mid: bias.mid,
    ltf: bias.ltf,
    session: bias.sessionStance === want ? "with" : bias.sessionStance === "neutral" ? "flat" : "against",
    zone,
    zoneOk: zone === (side === "long" ? "discount" : "premium") ? "y" : zone === "equilibrium" ? "eq" : "n",
    raid: narr.liquidity.lastSweep,
    raidOk: narr.liquidity.lastSweep === (side === "long" ? "ssl" : "bsl") ? "y" : "n",
    confirm: narr.confirmation,
    smt: desk.smtStack?.primary.active ? "y" : desk.scan.smt.edge !== "none" ? "edge" : "n",
    news: desk.news.verdict,
    dol: dolAgrees ? "agrees" : draw.primary ? "against" : "none",
    dolReach: bucket(draw.primary?.reachProbability ?? null, [0.6, 0.8], ["<60%", "60–80%", ">80%"]),
    away: bucket(away, [0.25, 0.5, 1], ["<0.25atr", "0.25–0.5atr", "0.5–1atr", ">1atr"]),
    rr1: bucket(plan?.rr1 ?? null, [1, 2], ["<1R", "1–2R", ">2R"]),
    musts: `${musts.filter((l) => l.state === "pass").length}/${musts.length}`,
    grade: String(cand.pathBand || cand.grade),
    q: bucket(cand.confluence, [0.75, 0.85], ["0.65–0.75", "0.75–0.85", ">0.85"]),
    strategy: cand.completeStrategy || cand.strategyPrimary || "model",
    oneBook: desk.smcMaster.oneBook?.symbol === book.symbol ? "y" : "n",
    shock: desk.shock?.active ? "active" : desk.shock?.tail ? "tail" : "n",
    day: desk.weekAhead?.today?.kind ?? "n/a",
    vol: isLeft ? desk.scan.conditions.left.volatility : desk.scan.conditions.right.volatility,
    regime: isLeft ? desk.scan.conditions.left.regime : desk.scan.conditions.right.regime,
    // The timeframe ladder vs this side: which rungs were with the trade,
    // the phase, the alignment. The scorecard slices on these.
    ...ladderTags(desk.ladder ? (isLeft ? desk.ladder.left : desk.ladder.right) : null, side),
  };
}

/* ── Opening ─────────────────────────────────────────────────────────────── */

/** The slice of the desk payload the shadow book reads (replay builds it too). */
export type ShadowDesk = Pick<
  DeskPayload,
  "clock" | "bias" | "scan" | "smcMaster" | "narrative" | "draws" | "news" | "left" | "right" | "quotes"
> &
  Partial<Pick<DeskPayload, "smtStack" | "shock" | "weekAhead" | "ladder">>;

function shadowId(symbol: string, side: string, dayKey: string, reasonId: string, leg: ShadowLeg, entry: number): string {
  return `shadow-${symbol}-${side}-${dayKey}-${reasonId}-${leg}-${entry.toFixed(2)}`;
}

/** The must-layer that refused the card, in the order the desk reports it. */
export function refusingLayer(book: SmcMasterBook): SmcLayer | null {
  const musts = book.layers.filter((l) => l.must);
  return musts.find((l) => l.state === "fail") ?? musts.find((l) => l.state === "wait") ?? null;
}

/**
 * Open the shadows a desk snapshot calls for. Pure: returns the NEW rows
 * only (ids not already in `existing`), never mutates.
 *
 * `now` is the decision time (live: Date.now(); replay: the bar close).
 */
export function openShadows(
  desk: ShadowDesk,
  existing: ReadonlyMap<string, ShadowTrade> | Set<string>,
  now: number,
  source: "live" | "replay" = "live",
): ShadowTrade[] {
  const clock = desk.clock;
  if (!clock.isWeekday) return [];
  if (!(clock.inTradeWindow || clock.killzone === "ny_am")) return [];
  const dayKey = etDayKey(now);
  const has = (id: string) => (existing instanceof Set ? existing.has(id) : existing.has(id));
  const out: ShadowTrade[] = [];

  for (const book of [desk.smcMaster.left, desk.smcMaster.right]) {
    if (!book || !book.plan || !book.side) continue;
    if (book.word === "TAKE") continue;
    const plan = book.plan;
    const cand =
      desk.scan.candidates.find((c) => c.symbol === book.symbol && c.side === book.side && isHighProbPath(c)) ??
      null;
    if (!cand) continue;
    const layer = refusingLayer(book);
    if (!layer) continue;
    const isLeft = desk.left.symbol === book.symbol;
    const price = isLeft ? desk.quotes.left.price : desk.quotes.right.price;
    if (!Number.isFinite(price) || price <= 0) continue;
    // Per-day cap, counting what already exists for this symbol today.
    let countToday = 0;
    const iter = existing instanceof Set ? existing : existing.keys();
    for (const id of iter) if (id.startsWith(`shadow-${book.symbol}-`) && id.includes(`-${dayKey}-`)) countToday++;
    if (countToday >= MAX_PER_SYMBOL_DAY) continue;

    const grade = String(cand.pathBand || cand.grade);
    const tags = shadowTags(desk, book, cand, book.side, price);
    const layersSnap = book.layers.map((l) => ({ id: l.id, label: l.label, state: l.state, must: l.must }));
    const base = {
      dayKey,
      symbol: book.symbol,
      side: book.side,
      kind: (book.word === "WAIT" ? "wait" : "refusal") as ShadowKind,
      word: book.word as "STAND" | "WAIT",
      reasonId: layer.id,
      reason: layer.label,
      reasonDetail: layer.detail,
      grade,
      confluence: cand.confluence,
      strategy: cand.completeStrategy || cand.strategyPrimary || "model",
      openedAt: now,
      killzone: clock.killzone,
      stop: plan.stop,
      t1: plan.t1,
      t2: plan.t2,
      riskDollars: riskDollarsForGrade(grade),
      seenHi: price,
      seenLo: price,
      banked: 0,
      remaining: 1,
      t1Hit: false,
      lastBarT: Math.floor(now / BAR_MS) * BAR_MS,
      barsSinceOpen: 0,
      barsSinceFill: 0,
      layers: layersSnap,
      tags,
      source,
      updatedAt: now,
    };

    // Limit leg: the desk's own plan, resting at CE.
    const limitId = shadowId(book.symbol, book.side, dayKey, layer.id, "limit", plan.entry);
    if (!has(limitId) && plan.riskPts > 0) {
      out.push({
        ...base,
        id: limitId,
        leg: "limit",
        entry: plan.entry,
        riskPts: plan.riskPts,
        stopLevel: plan.stop,
        status: "resting",
        path: [
          {
            t: now,
            kind: "open",
            text: `${etTime(now)} ET · ${book.word} on "${layer.label}" — limit rests at CE ${px(plan.entry)}, stop ${px(plan.stop)}${plan.t1 != null ? `, T1 ${px(plan.t1)}` : ""}${plan.t2 != null ? `, T2 ${px(plan.t2)}` : ""}`,
          },
        ],
      });
    }

    // Chase leg: market at the print, the plan's stop and targets. Only when
    // the stop is still on the correct side of the print — a chase whose
    // stop is already behind price is not a trade, it is a loss booked at open.
    const chaseId = shadowId(book.symbol, book.side, dayKey, layer.id, "chase", plan.entry);
    const chaseRisk = book.side === "long" ? price - plan.stop : plan.stop - price;
    if (!has(chaseId) && chaseRisk > 0) {
      out.push({
        ...base,
        id: chaseId,
        leg: "chase",
        entry: r2(price),
        riskPts: r2(chaseRisk),
        stopLevel: plan.stop,
        status: "open",
        fillAt: now,
        fillPrice: r2(price),
        path: [
          {
            t: now,
            kind: "fill",
            text: `${etTime(now)} ET · ${book.word} on "${layer.label}" — chased at the print ${px(price)} (${r2(chaseRisk).toFixed(2)}pt risk), stop ${px(plan.stop)}${plan.t1 != null ? `, T1 ${px(plan.t1)}` : ""}${plan.t2 != null ? `, T2 ${px(plan.t2)}` : ""}`,
          },
        ],
      });
    }
  }
  return out;
}

/* ── Resolution ──────────────────────────────────────────────────────────── */

interface Touch {
  h: number;
  l: number;
}

function rOf(s: ShadowTrade, exit: number): number {
  const entry = s.fillPrice ?? s.entry;
  return (s.side === "long" ? exit - entry : entry - exit) / (s.riskPts || 1);
}

function close(s: ShadowTrade, t: number, exitPx: number, reason: string, kind: ShadowEvent["kind"]): ShadowTrade {
  const exitR = rOf(s, exitPx);
  const banked = s.banked + exitR * s.remaining;
  const r = r3(banked);
  const status: ShadowStatus = r > 0.05 ? "won" : r < -0.05 ? "lost" : "scratch";
  const fill = s.fillPrice ?? s.entry;
  const hi = Math.max(s.seenHi, exitPx);
  const lo = Math.min(s.seenLo, exitPx);
  const mfe = r2(Math.max(0, (s.side === "long" ? hi - fill : fill - lo) / (s.riskPts || 1)));
  const mae = r2(Math.max(0, (s.side === "long" ? fill - lo : hi - fill) / (s.riskPts || 1)));
  return {
    ...s,
    status,
    mfe,
    mae,
    exitAt: t,
    exitPrice: r2(exitPx),
    exitReason: reason,
    r,
    pnl: r2(r * s.riskDollars),
    banked: r,
    remaining: 0,
    path: [...s.path, { t, kind, text: `${etTime(t)} ET · ${reason}` }],
    updatedAt: t,
  };
}

/**
 * Apply one price range (a closed bar, or a live print as a zero-height
 * range) to a shadow. `closedBar` chooses the tie rule: inside a closed bar
 * the order of touches is unknown, so a stop and a target in the same bar is
 * a stop (against the trade); a print is a point, so no tie exists.
 */
function applyRange(s: ShadowTrade, t: number, rng: Touch, closedBar: boolean): ShadowTrade {
  if (s.status !== "resting" && s.status !== "open") return s;
  const long = s.side === "long";
  const touchesAbove = (lv: number) => rng.h >= lv;
  const touchesBelow = (lv: number) => rng.l <= lv;
  const hitsUp = (lv: number) => (long ? touchesAbove(lv) : touchesBelow(lv)); // favourable direction
  const hitsDown = (lv: number) => (long ? touchesBelow(lv) : touchesAbove(lv)); // adverse direction

  let cur = s;
  if (cur.status === "resting") {
    // A short's limit sits above price: filled when the range reaches it.
    if (long ? touchesBelow(cur.entry) : touchesAbove(cur.entry)) {
      cur = {
        ...cur,
        status: "open",
        fillAt: t,
        fillPrice: cur.entry,
        seenHi: cur.entry,
        seenLo: cur.entry,
        barsSinceFill: 0,
        path: [...cur.path, { t, kind: "fill", text: `${etTime(t)} ET · filled at ${px(cur.entry)}${closedBar ? " (bar touched CE)" : " (print)"}` }],
        updatedAt: t,
      };
    } else {
      return cur;
    }
  }

  // Open: every range the position lives through is excursion.
  cur = { ...cur, seenHi: Math.max(cur.seenHi, rng.h), seenLo: Math.min(cur.seenLo, rng.l) };

  // Stop first (ties against), then T1, then T2.
  if (hitsDown(cur.stopLevel)) {
    const why = cur.t1Hit
      ? `runner stopped at break-even ${px(cur.stopLevel)}`
      : `stopped at ${px(cur.stopLevel)} (−1R)${closedBar && cur.t1 != null && hitsUp(cur.t1) ? " — bar also reached T1; tie goes against the trade" : ""}`;
    return close(cur, t, cur.stopLevel, why, cur.t1Hit ? "be" : "stop");
  }
  if (!cur.t1Hit && cur.t1 != null && hitsUp(cur.t1)) {
    const frac = APLUS_RULES.scaleOut.enabled ? APLUS_RULES.scaleOut.tp1Fraction : 0;
    const r1 = rOf(cur, cur.t1);
    const banked = cur.banked + r1 * frac;
    const remaining = cur.remaining - frac;
    const stopLevel = APLUS_RULES.scaleOut.moveStopToBeAfterTp1 ? (cur.fillPrice ?? cur.entry) : cur.stopLevel;
    cur = {
      ...cur,
      t1Hit: true,
      banked,
      remaining,
      stopLevel,
      path: [
        ...cur.path,
        { t, kind: "t1", text: `${etTime(t)} ET · T1 ${px(cur.t1)} hit: +${r1.toFixed(2)}R banked on ${(frac * 100).toFixed(0)}%, stop → break-even ${px(stopLevel)}` },
      ],
      updatedAt: t,
    };
    const t1Px = cur.t1 as number;
    if (cur.t2 == null || remaining <= 0) {
      return close(cur, t, t1Px, `no T2 priced — remainder closed at T1 ${px(t1Px)}`, "t1");
    }
    // A same-bar T2 is not credited: the order inside the bar is unknown.
    if (closedBar) return cur;
  }
  if (cur.t1Hit && cur.t2 != null && hitsUp(cur.t2)) {
    return close(cur, t, cur.t2, `T2 ${px(cur.t2)} hit on the runner`, "t2");
  }
  return cur;
}

/**
 * Advance a shadow with everything that has happened since it was last
 * ticked: the closed bars after `lastBarT`, then the live print. Pure.
 *
 * Replay passes `last = null` and only the bars up to `now`; live passes
 * both. The bar the shadow was opened in is never applied as a range (its
 * extremes before the open are not the trade's), so a live shadow relies on
 * prints until the next bar closes — which is why the quote poll ticks the
 * book too. Nothing after the cash close of the shadow's day is applied:
 * the day trade is flat there, whatever the overnight did.
 */
export function tickShadow(s: ShadowTrade, bars: OhlcBar[], last: number | null, now: number): ShadowTrade {
  if (s.status !== "resting" && s.status !== "open") return s;
  let cur = s;
  const openBarT = Math.floor(cur.openedAt / BAR_MS) * BAR_MS;
  const flatAt = etWallToEpochMs(cur.dayKey, "16:00");

  for (const b of bars) {
    if (b.t <= openBarT || b.t <= cur.lastBarT) continue;
    if (b.t >= flatAt) break;
    if (b.t + BAR_MS > now) break; // forming — prints cover it
    const closeT = b.t + BAR_MS - 1;
    cur = applyRange(cur, closeT, { h: b.h, l: b.l }, true);
    cur = {
      ...cur,
      lastBarT: b.t,
      barsSinceOpen: cur.barsSinceOpen + 1,
      barsSinceFill: cur.status === "open" ? cur.barsSinceFill + 1 : cur.barsSinceFill,
    };
    if (isTerminal(cur)) return cur;
    if (cur.status === "resting" && cur.barsSinceOpen >= FILL_WINDOW_BARS) {
      return {
        ...cur,
        status: "unfilled",
        exitAt: closeT,
        exitReason: `limit at ${px(cur.entry)} never filled inside ${FILL_WINDOW_BARS} bars — price did not come back`,
        path: [...cur.path, { t: closeT, kind: "unfilled", text: `${etTime(closeT)} ET · unfilled — ${FILL_WINDOW_BARS} bars without a touch of ${px(cur.entry)}` }],
        updatedAt: now,
      };
    }
    if (cur.status === "open" && cur.barsSinceFill >= MAX_HOLD_BARS) {
      return close(cur, closeT, b.c, `time stop after ${MAX_HOLD_BARS} bars — closed at ${px(b.c)}`, "time");
    }
  }

  // The live print — only while the day is still open.
  if (last != null && Number.isFinite(last) && last > 0 && now < flatAt) {
    cur = applyRange(cur, now, { h: last, l: last }, false);
    if (isTerminal(cur)) return cur;
  }

  // Flat at the cash close of the shadow's day.
  if (now >= flatAt) {
    if (cur.status === "resting") {
      return {
        ...cur,
        status: "expired",
        exitAt: flatAt,
        exitReason: "session closed — limit never filled",
        path: [...cur.path, { t: flatAt, kind: "expired", text: `${etTime(flatAt)} ET · expired flat — never filled` }],
        updatedAt: now,
      };
    }
    // Mark: the print if we are still in the close's own hour, else the last
    // bar before the close — the overnight is not this trade's tape.
    let lastBar: OhlcBar | undefined;
    for (let i = bars.length - 1; i >= 0; i--) {
      if (bars[i]!.t < flatAt && bars[i]!.t > openBarT) {
        lastBar = bars[i];
        break;
      }
    }
    const mark = now - flatAt < 60 * 60_000 && last != null && last > 0 ? last : (lastBar?.c ?? last ?? cur.fillPrice ?? cur.entry);
    return close(cur, flatAt, mark, `flat at the cash close — ${px(mark)}`, "time");
  }
  return cur.updatedAt === now ? cur : { ...cur, updatedAt: now };
}

/* ── Analysis ────────────────────────────────────────────────────────────── */

export function analyzeShadow(s: ShadowTrade): ShadowAnalysis {
  const r = s.r ?? 0;
  const rTxt = `${r >= 0 ? "+" : ""}${r.toFixed(2)}R`;
  const legTxt = s.leg === "chase" ? "chasing the print" : "the resting limit";
  const excursion = s.mfe != null && s.mae != null ? { mfe: s.mfe, mae: s.mae } : null;
  const ex = excursion ? `Excursion: +${excursion.mfe.toFixed(2)}R favourable / −${excursion.mae.toFixed(2)}R adverse on the prints.` : "";
  const gate = `${s.reason} (${s.reasonDetail})`;

  if (s.status === "unfilled" || s.status === "expired") {
    return {
      verdict: "unfilled",
      headline: `${s.symbol} ${s.side} — ${s.word} on ${s.reason}: price never came back to CE ${px(s.entry)}`,
      why: [`The desk's plan was a limit at consequent encroachment; ${s.exitReason ?? "it never filled"}.`, `The refusal was moot for the limit — there was no trade to refuse. The chase leg is the one that measures the gate here.`],
      lesson: "A plan that price never revisits is not a missed trade. Count it, do not chase it.",
    };
  }
  const lostAll = r <= -0.9;
  const paidFull = r >= 1;
  if (s.status === "lost" || (s.status === "scratch" && lostAll)) {
    return {
      verdict: "gate-right",
      headline: `${s.symbol} ${s.side} — ${s.word} on ${s.reason} held: ${legTxt} lost ${rTxt}`,
      why: [`Refused on ${gate}.`, `${s.exitReason ?? "Stopped"}.`, ex].filter(Boolean),
      lesson:
        s.leg === "chase"
          ? `The gate earned its keep — ${s.reason} was the tell, and the print was the wrong place to be.`
          : `Even the desk's own limit lost here — the array was not the reversal's footprint. ${s.reason} was right to wait.`,
    };
  }
  if (s.status === "won" && paidFull) {
    return {
      verdict: "gate-cost",
      headline: `${s.symbol} ${s.side} — ${s.word} on ${s.reason} refused ${rTxt}`,
      why: [`Refused on ${gate}.`, `${s.exitReason ?? "Target"}.`, ex].filter(Boolean),
      lesson:
        s.leg === "chase"
          ? `This refusal cost money. One trade proves nothing — the scorecard's n for "${s.reason}" is what decides whether the gate is too tight.`
          : `The plan the desk priced was right; only the gate stood between it and the fill. If "${s.reason}" keeps refusing winners, that layer is the one to sweep.`,
    };
  }
  return {
    verdict: "neutral",
    headline: `${s.symbol} ${s.side} — ${s.word} on ${s.reason}: ${legTxt} ${rTxt}`,
    why: [`Refused on ${gate}.`, `${s.exitReason ?? "Closed"}.`, ex].filter(Boolean),
    lesson: "Small either way — the gate neither saved nor cost much on this one. It counts toward n.",
  };
}

export function isTerminal(s: ShadowTrade): boolean {
  return s.status !== "resting" && s.status !== "open";
}

/** Tick every live shadow against the tape, open new ones, stamp analyses. */
export function observeShadows(desk: ShadowDesk, rows: ShadowTrade[], now: number): { rows: ShadowTrade[]; changed: ShadowTrade[] } {
  const byId = new Map(rows.map((s) => [s.id, s]));
  const changed: ShadowTrade[] = [];
  for (const s of openShadows(desk, byId, now, "live")) {
    byId.set(s.id, s);
    changed.push(s);
  }
  for (const [id, s] of byId) {
    if (isTerminal(s)) continue;
    const isLeft = desk.left.symbol === s.symbol;
    const series = isLeft ? desk.left : desk.right;
    const last = isLeft ? desk.quotes.left.price : desk.quotes.right.price;
    let next = tickShadow(s, series.bars ?? [], Number.isFinite(last) && last > 0 ? last : null, now);
    if (isTerminal(next) && !next.analysis) next = { ...next, analysis: analyzeShadow(next) };
    if (next !== s && (next.status !== s.status || next.path.length !== s.path.length || next.t1Hit !== s.t1Hit)) {
      byId.set(id, next);
      changed.push(next);
    } else if (next !== s) {
      byId.set(id, next);
    }
  }
  const out = [...byId.values()].sort((a, b) => b.openedAt - a.openedAt);
  return { rows: out, changed };
}

/* ── Local cache + events ────────────────────────────────────────────────── */

export function loadShadowsLocal(): ShadowTrade[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ShadowTrade[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveShadowsLocal(rows: ShadowTrade[]): void {
  if (typeof window === "undefined") return;
  try {
    const sorted = [...rows].sort((a, b) => b.openedAt - a.openedAt).slice(0, MAX_LOCAL);
    window.localStorage.setItem(KEY, JSON.stringify(sorted));
  } catch {
    /* quota */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeShadows(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/** Merge server rows into local: terminal rows from the server win. */
export function mergeShadows(local: ShadowTrade[], remote: ShadowTrade[]): ShadowTrade[] {
  const byId = new Map(local.map((s) => [s.id, s]));
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l || isTerminal(r) || r.updatedAt >= l.updatedAt) byId.set(r.id, r);
  }
  return [...byId.values()].sort((a, b) => b.openedAt - a.openedAt);
}
