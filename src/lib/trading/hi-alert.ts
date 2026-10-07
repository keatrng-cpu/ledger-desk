/**
 * The high-alert ledger: every card at fit 0.90 or higher, kept whether or not the desk took it, with the reason, and graded afterwards on the chart.
 *
 * WHY: a 0.90+ card is the loudest thing on the board and, measured, the least reliable (Q 0.85+ went the card's way less often than 0.65-0.70;
 * evidence.ts). The desk refuses many of them, usually for a layer the fit does not price (no raid yet, no session, the other index leads). Until
 * now nothing kept those, so nobody — the trader or the five on the Floor — could ask "what happened to the last four of these, and was passing right".
 *
 * WHAT IT STORES, per (day, symbol, side, entry-in-ATRs): the card as first seen (the plan is never moved afterwards, so the grade is fair),
 * the latest read (actionable, the blockers, the four schools), whether a paper order was rested or filled for it, the card's own four-year evidence
 * buckets, and WHY in plain lines built from fields the desk already computed. No model writes any of it.
 *
 * GRADING: the chart. From the first CLOSED 15m bar after the card was first seen, with the evidence pack's own rule (a limit at CE that must fill
 * within 12 bars, the stop and a target on one bar scored against the trade, 50% off at T1 with the stop to breakeven, runner to T2, 32 bars at
 * most, the fill bar cannot score T1). It also records how far the trade ran for (MFE) and against (MAE) in R. A card nobody took is graded the
 * same as one that was taken, which is the point: it says what passing cost or saved.
 *
 * Pure. Persistence (localStorage) is at the bottom and fails closed. Nothing here is a gate, a score or a size.
 */

import type { OhlcBar } from "@/lib/market/types";
import { deliveryLine, deliveryOfLadder, type Delivery } from "@/lib/room/focus-pick";
import { cardEvidence } from "./evidence";
import { HIGH_CONFLUENCE_THRESHOLD, type SetupCandidate } from "./scanner";
import { SCHOOL_SAY, schoolFactsFrom, schoolReads, type LadderLite, type SchoolKey, type Verdict } from "./school-brief";

export const HI_ALERT_MIN = HIGH_CONFLUENCE_THRESHOLD;
export const HI_ALERT_KEY = "ledger-hialert-v1";
export const HI_ALERT_CAP = 300;

const BAR_MS = 15 * 60_000;
const FILL_BARS = 12;
const HOLD_BARS = 32;
const TICK = 0.25;
const TP1_FRACTION = 0.5;

export type Taken = "no" | "rested" | "paper";
const TAKEN_RANK: Record<Taken, number> = { no: 0, rested: 1, paper: 2 };

export interface HiPlan {
  entry: number;
  stop: number;
  t1: number | null;
  t2: number | null;
  riskAtr: number | null;
}

export type HiStatus = "pending" | "unfilled" | "stopped" | "t1" | "t2" | "flat";
export interface HiOutcome {
  status: HiStatus;
  /** True once nothing more can change: filled and out, never filled inside the window, or held the full length. */
  done: boolean;
  filled: boolean;
  /** R after the 50%-at-T1 rule, before commission. Null until it fills. */
  R: number | null;
  mfeR: number | null;
  maeR: number | null;
  barsSeen: number;
}

export interface HiAlert {
  id: string;
  day: string;
  firstMs: number;
  lastMs: number;
  sym: string;
  side: "long" | "short";
  fit: number;
  band: string | null;
  strategy: string | null;
  plan: HiPlan | null;
  pT1: number | null;
  expR: number | null;
  actionable: boolean;
  everActionable: boolean;
  taken: Taken;
  why: string[];
  evidence: string[];
  schools: { school: SchoolKey; verdict: Verdict; next: string | null }[];
  sequence: { word: string | null; missing: string | null } | null;
  outcome: HiOutcome | null;
  /**
   * Whether the lower timeframes were delivering this card's way when it was FIRST seen (focus-pick.ts). "against" is the case the Floor kept
   * discussing a short while the 1 to 3 minute delivered up; recording it beside the chart grade is what lets the desk learn whether it mattered.
   */
  deliveryAtSight?: Delivery | null;
  /** The brain has been given this one (so it is written once). */
  fed?: boolean;
}

export interface HiCtx {
  nowMs: number;
  /** ET trade date, YYYY-MM-DD. */
  day: string;
  clock: { killzone?: string | null; etHour?: number; etMinute?: number; weekday?: number };
  /** `desk.scan.blocked`: the reasons the whole board is held (session, conditions). */
  blocked: readonly string[];
  /** The SMC sequence book for this card's symbol and side, if the desk graded one. */
  bookFor: (symbol: string, side: "long" | "short") => { word: string | null; missing: string | null; detail?: string | null } | null;
  ladderFor: (symbol: string) => LadderLite | null;
  takenFor: (symbol: string, side: "long" | "short") => Taken;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (p: number) => `${Math.round(p * 100)}%`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;

/** The card's delivery on its own index's ladder: are the 3, 2 and 1 minute going its way? "unknown" without a ladder. */
function deliveryOf(c: SetupCandidate, ctx: HiCtx): Delivery {
  const lad = ctx.ladderFor(c.symbol);
  if (!lad?.tier4) return "unknown";
  return deliveryOfLadder({ tier3: lad.tier3, tier4: lad.tier4 }, { side: c.side === "short" ? "short" : "long", actionable: Boolean(c.actionable) });
}

/* ── Why ─────────────────────────────────────────────────────────────────── */

/**
 * The reasons, most decisive first, from fields the desk already computed. A card that was taken says what it cleared; one that was not says every
 * layer that held it, then what the desk's own numbers say about it. Each line stands alone.
 */
export function explainHiAlert(c: SetupCandidate, ctx: HiCtx, taken: Taken): string[] {
  const out: string[] = [];
  const side = c.side === "short" ? "short" : "long";
  const book = ctx.bookFor(c.symbol, side);
  const p = c.plan ?? null;
  if (taken !== "no") {
    out.push(
      `Taken (${taken === "paper" ? "filled in the paper book" : "a paper limit rested at CE"}): fit ${r2(c.confluence)}, band ${c.pathBand ?? c.grade}, actionable, session live${book?.word ? `, SMC sequence ${book.word}` : ""}.`,
    );
  } else {
    if (c.htfOk === false) {
      out.push(`The higher-timeframe gate refused it${c.htfRelease?.missing?.length ? `: still missing ${c.htfRelease.missing.slice(0, 2).join(" and ")}` : ""}.`);
    }
    const session = ctx.blocked.find((b) => /outside|session|window|weekend|blackout|news/i.test(b));
    if (!c.killzoneOk || session) out.push(`Outside the session: ${session ?? "no killzone and no measured session event"}.`);
    if (book && book.word !== "TAKE") {
      out.push(`The SMC sequence says ${book.word ?? "WAIT"}${book.missing ? `, missing ${book.missing}${book.detail ? ` (${book.detail})` : ""}` : ""}.`);
    }
    const d = deliveryOf(c, ctx);
    if (d === "against") out.push(deliveryLine({ card: { side, htfOk: c.htfOk, actionable: c.actionable }, switchedFrom: null, topDelivery: d, delivery: d }));
    if (!c.actionable && !out.length) out.push(`Not actionable: ${c.missing.slice(0, 3).join("; ") || "the model is not complete"}.`);
    else if (!c.actionable && c.missing.length) out.push(`Also holding it: ${c.missing.slice(0, 2).join("; ")}.`);
    if (c.actionable && !out.length) out.push("It cleared the scanner but no order was rested for it (no CE touch, or an earlier fill was open).");
  }
  if (c.hitOdds && c.hitOdds.pT1 != null) {
    out.push(
      `The desk's own odds on it: P(T1) ${pct(c.hitOdds.pT1)}${c.hitOdds.expR != null ? `, E[R] ${signed(c.hitOdds.expR)} per fill` : ""}. A high fit is not a high win rate.`,
    );
  }
  if (p?.riskAtr != null && (p.riskAtr < 0.5 || p.riskAtr > 1.5)) {
    out.push(`The stop is ${p.riskAtr.toFixed(2)}× ATR, outside the 0.5–1.5 band the four years favour; size is cut.`);
  }
  const reads = schoolReads(schoolFactsFrom(c, ctx.ladderFor(c.symbol)));
  const off = reads.filter((r) => r.verdict !== "fits");
  if (off.length) out.push(off.slice(0, 3).map((r) => (r.verdict === "against" ? `${SCHOOL_SAY[r.school]} reads the other way` : `${SCHOOL_SAY[r.school]} needs ${r.next}`)).join("; ") + ".");
  return out;
}

/* ── Record ──────────────────────────────────────────────────────────────── */

const idOf = (c: SetupCandidate, day: string): string => {
  const atr = c.plan?.atr ?? c.atr ?? 1;
  const e = c.plan?.entry ?? c.entryPx;
  return `${day}|${c.symbol}|${c.side}|${e != null && Number.isFinite(e) ? Math.round(e / Math.max(atr, 0.25)) : "na"}`;
};

/** Add or refresh every card at 0.90 or higher. The first sight's plan is kept; the read around it is refreshed. */
export function recordHiAlerts(prev: readonly HiAlert[], cands: readonly SetupCandidate[], ctx: HiCtx): HiAlert[] {
  const out = [...prev];
  for (const c of cands) {
    if (!(c.confluence >= HI_ALERT_MIN)) continue;
    const side = c.side === "short" ? "short" : "long";
    const id = idOf(c, ctx.day);
    const taken = ctx.takenFor(c.symbol, side);
    const book = ctx.bookFor(c.symbol, side);
    const reads = schoolReads(schoolFactsFrom(c, ctx.ladderFor(c.symbol)));
    const evidence = cardEvidence({
      confluence: c.confluence,
      riskAtr: c.plan?.riskAtr ?? null,
      side,
      hasInducement: c.patterns?.inducement ?? null,
      hasMitigation: c.patterns?.mitigation ?? null,
      killzone: ctx.clock.killzone ?? null,
      etHour: ctx.clock.etHour,
      etMinute: ctx.clock.etMinute,
      weekday: ctx.clock.weekday,
    }).map((e) => e.text);
    const read = {
      fit: c.confluence,
      band: c.pathBand ?? c.grade ?? null,
      pT1: c.hitOdds?.pT1 ?? null,
      expR: c.hitOdds?.expR ?? null,
      actionable: Boolean(c.actionable),
      schools: reads.map((r) => ({ school: r.school, verdict: r.verdict, next: r.next })),
      sequence: book ? { word: book.word, missing: book.missing } : null,
      evidence,
    };
    const i = out.findIndex((h) => h.id === id);
    if (i < 0) {
      out.push({
        id,
        day: ctx.day,
        firstMs: ctx.nowMs,
        lastMs: ctx.nowMs,
        sym: c.symbol,
        side,
        strategy: c.completeStrategy || c.strategyPrimary || null,
        plan: c.plan
          ? { entry: c.plan.entry, stop: c.plan.stop, t1: c.plan.t1, t2: c.plan.t2, riskAtr: c.plan.riskAtr }
          : null,
        everActionable: read.actionable,
        deliveryAtSight: deliveryOf(c, ctx),
        taken,
        why: explainHiAlert(c, ctx, taken),
        outcome: null,
        ...read,
      });
      continue;
    }
    const cur = out[i]!;
    const bestTaken = TAKEN_RANK[taken] > TAKEN_RANK[cur.taken] ? taken : cur.taken;
    out[i] = {
      ...cur,
      ...read,
      fit: Math.max(cur.fit, read.fit),
      lastMs: ctx.nowMs,
      everActionable: cur.everActionable || read.actionable,
      taken: bestTaken,
      why: explainHiAlert(c, ctx, bestTaken),
    };
  }
  return out.slice(-HI_ALERT_CAP);
}

/* ── Grade it on the chart ───────────────────────────────────────────────── */

/** Closed 15m bars strictly after the bar the card was first seen in. No bar that was still forming at `nowMs`. */
function barsAfter(bars: readonly OhlcBar[], firstMs: number, nowMs: number): OhlcBar[] {
  const start = Math.ceil((firstMs + 1) / BAR_MS) * BAR_MS;
  return bars.filter((b) => b.t >= start && b.t + BAR_MS <= nowMs);
}

export function gradeHiAlert(h: Pick<HiAlert, "plan" | "side" | "firstMs">, bars: readonly OhlcBar[], nowMs: number): HiOutcome | null {
  const p = h.plan;
  if (!p || p.t1 == null) return null;
  const long = h.side === "long";
  const E = p.entry;
  const S = p.stop;
  const risk = Math.abs(E - S);
  if (!(risk > 0) || (long ? p.t1 <= E : p.t1 >= E)) return null;
  const t2 = p.t2 != null && (long ? p.t2 > p.t1 : p.t2 < p.t1) ? p.t2 : null;
  const w = barsAfter(bars, h.firstMs, nowMs);
  const hitStop = (b: OhlcBar, lvl: number) => (long ? b.l <= lvl : b.h >= lvl);
  const hitTgt = (b: OhlcBar, lvl: number) => (long ? b.h >= lvl : b.l <= lvl);
  const rOf = (px: number) => (long ? px - E : E - px) / risk;
  let fi = -1;
  for (let k = 0; k < Math.min(FILL_BARS, w.length); k++) {
    const b = w[k]!;
    if (long ? b.l <= E : b.h >= E) {
      fi = k;
      break;
    }
  }
  if (fi < 0) {
    const waited = w.length >= FILL_BARS;
    return { status: waited ? "unfilled" : "pending", done: waited, filled: false, R: null, mfeR: null, maeR: null, barsSeen: w.length };
  }
  let stop = S;
  let rem = 1;
  let banked = 0;
  let t1Done = false;
  let mfe = 0;
  let mae = 0;
  const end = Math.min(w.length, fi + HOLD_BARS);
  for (let k = fi; k < end; k++) {
    const b = w[k]!;
    mfe = Math.max(mfe, long ? rOf(b.h) : rOf(b.l));
    mae = Math.min(mae, long ? rOf(b.l) : rOf(b.h));
    if (hitStop(b, stop)) {
      banked += rOf(long ? stop - TICK : stop + TICK) * rem;
      return { status: t1Done ? "t1" : "stopped", done: true, filled: true, R: r2(banked), mfeR: r2(mfe), maeR: r2(mae), barsSeen: w.length };
    }
    if (k === fi) continue; // the fill bar cannot score a target
    if (!t1Done && hitTgt(b, p.t1)) {
      t1Done = true;
      if (t2 == null) {
        banked += rOf(p.t1) * rem;
        return { status: "t1", done: true, filled: true, R: r2(banked), mfeR: r2(mfe), maeR: r2(mae), barsSeen: w.length };
      }
      banked += rOf(p.t1) * TP1_FRACTION;
      rem -= TP1_FRACTION;
      stop = E;
      continue;
    }
    if (t1Done && t2 != null && hitTgt(b, t2)) {
      banked += rOf(t2) * rem;
      return { status: "t2", done: true, filled: true, R: r2(banked), mfeR: r2(mfe), maeR: r2(mae), barsSeen: w.length };
    }
  }
  if (w.length >= fi + HOLD_BARS) {
    const last = w[fi + HOLD_BARS - 1]!;
    banked += rOf(last.c) * rem;
    return { status: t1Done ? "t1" : "flat", done: true, filled: true, R: r2(banked), mfeR: r2(mfe), maeR: r2(mae), barsSeen: w.length };
  }
  return { status: "pending", done: false, filled: true, R: null, mfeR: r2(mfe), maeR: r2(mae), barsSeen: w.length };
}

/** Grade every record that is not finished against its symbol's bars. Finished records are never touched again. */
export function gradeAll(list: readonly HiAlert[], barsBySymbol: Record<string, readonly OhlcBar[]>, nowMs: number): HiAlert[] {
  return list.map((h) => {
    if (h.outcome?.done) return h;
    const bars = barsBySymbol[h.sym];
    if (!bars) return h;
    const o = gradeHiAlert(h, bars, nowMs);
    return o ? { ...h, outcome: o } : h;
  });
}

/* ── What it taught ──────────────────────────────────────────────────────── */

export type Call = "right" | "cost" | "paid" | "lost" | "open";

/** Was the decision right, judged by the chart? Not taken and it did not work = right. Not taken and it hit T1 = it cost. */
export function callOf(h: Pick<HiAlert, "taken" | "outcome">): Call {
  const o = h.outcome;
  if (!o?.done) return "open";
  const worked = o.filled && (o.status === "t1" || o.status === "t2") && (o.R ?? 0) > 0;
  if (h.taken === "no") return worked ? "cost" : "right";
  return worked || (o.R ?? 0) > 0 ? "paid" : "lost";
}

const OUTCOME_TEXT: Record<HiStatus, string> = {
  pending: "is still open",
  unfilled: "never filled inside 3 hours",
  stopped: "filled and was stopped",
  t1: "reached the first target",
  t2: "ran to the second target",
  flat: "filled and went nowhere",
};

/** One sentence for the brain: what it was, what the desk did, what the chart did, and whether the decision was right. */
export function lessonOf(h: HiAlert): string {
  const o = h.outcome;
  const who = `${h.sym} ${h.side}${h.strategy ? `, ${h.strategy}` : ""}, fit ${r2(h.fit)}`;
  if (!o?.done) return `${who}, ${h.day}: ${h.taken === "no" ? "not taken" : "taken"}, still being graded.`;
  const call = callOf(h);
  const verdict =
    call === "right"
      ? "Passing was right."
      : call === "cost"
        ? `Passing cost about ${o.R != null ? signed(o.R) : "the first target"} R.`
        : call === "paid"
          ? "Taking it paid."
          : "Taking it lost.";
  const why = h.taken === "no" ? (h.why[0] ?? "") : "";
  const against = h.deliveryAtSight === "against" ? " The 1 to 3 minute was against it." : "";
  return `${who}, ${h.day}: ${h.taken === "no" ? "not taken" : "taken"}${why ? ` (${why.replace(/\.$/, "")})` : ""}; it ${OUTCOME_TEXT[o.status]}${o.R != null ? ` at ${signed(o.R)} R` : ""}.${against} ${verdict}`;
}

/** What the last graded cards like this one did. Same model and side. Null when there is no history, so nothing is invented. */
export function recallHiAlerts(list: readonly HiAlert[], q: { strategy: string | null; side: "long" | "short" }): string | null {
  const past = list.filter((h) => h.outcome?.done && h.side === q.side && h.strategy === q.strategy);
  if (!past.length) return null;
  const n = past.length;
  const count = (f: (h: HiAlert) => boolean) => past.filter(f).length;
  const t = count((h) => h.outcome!.status === "t1" || h.outcome!.status === "t2");
  const s = count((h) => h.outcome!.status === "stopped");
  const u = count((h) => h.outcome!.status === "unfilled");
  const right = count((h) => callOf(h) === "right");
  const decided = count((h) => h.taken === "no");
  const parts = [`${t} reached a target`, `${s} stopped`, `${u} never filled`].filter((x) => !x.startsWith("0 "));
  return `The last ${n} ${HI_ALERT_MIN.toFixed(2)}-plus ${q.strategy ?? "model"} ${q.side} card${n === 1 ? "" : "s"}: ${parts.join(", ") || "none resolved"}${decided ? `. Passing was right ${right} of ${decided} times` : ""}.`;
}

/* ── Persistence (browser only; fails closed) ────────────────────────────── */

let memoRaw: string | null = null;
let memoList: HiAlert[] = [];

export function loadHiAlerts(): HiAlert[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(HI_ALERT_KEY);
    // The Floor reads this every few seconds: parse again only when the stored text changed.
    if (raw === memoRaw) return memoList;
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    memoList = Array.isArray(parsed) ? (parsed as HiAlert[]).filter((h) => h && typeof h.id === "string") : [];
    memoRaw = raw;
    return memoList;
  } catch {
    return [];
  }
}

export function saveHiAlerts(list: readonly HiAlert[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(HI_ALERT_KEY, JSON.stringify(list.slice(-HI_ALERT_CAP)));
  } catch {
    /* a full disk does not stop the desk */
  }
}
