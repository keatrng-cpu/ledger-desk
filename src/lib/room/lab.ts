/**
 * THE GHOST ROOM — what the room's rules are worth, measured on its own tape.
 *
 * Every rule the room adds on top of the trader's mandate (exits.ts:
 * ROOM_POLICY) and every refusal Sterling makes at the CE touch is a claim:
 * "this makes more money than not doing it". The room cannot prove that from
 * the futures research alone — no options history is on this desk — so it
 * keeps score forward, on the same model marks its real paper book uses:
 *
 *   twin     every room fill opens an identical ghost run on the MANDATE
 *            ALONE (−20% / +40% / 11:00 / the level). Room P&L minus twin
 *            P&L, over the same fills, is what the room's extra exits did.
 *   refused  a desk-ARMED ticket refused at the CE touch is opened as a ghost
 *            and run on the room's own rules. What refused tickets would have
 *            made, by the gate that refused them, is what each gate is worth.
 *   watch    every priced plan the room reviews is followed to the flat:
 *            did the CE fill, did T1 print before 11:00? That scores Nova's
 *            P(T1 before the flat) (calibration) and each person's own number
 *            (lenses, debate.ts) — Brier scores the meeting quotes back.
 *
 * Ghosts are NEVER fills: they do not touch the room's cash, counters or
 * halts, and they resolve on the same prints the room's level exits read.
 * Pure functions; the state rides in the room book (paper-book.ts).
 */

import type { ExitWatch } from "./desk-read";
import { exitFor, MANDATE_POLICY, ROOM_POLICY } from "./exits";
import { expiryMs, etDateOf, ivFor, quoteOption, type OptionType, type StrikeOffset, type Underlier } from "./option-math";
import type { Character, RoomCycle, RoomDeskRead, RoomEntryRead, RoomPositionIn, UnderlierTape } from "./orchestrator";
import { holdReadFor } from "./quant";
import { etWallParts, etWallToEpochMs } from "@/lib/trading/sessions";
import { ROOM_CLOCK } from "./mandate";
import { clockEt } from "./format";

const KEEP = 200;
const CREW: Character[] = ["Jax", "Nova", "Sterling", "Gemma", "Vince"];

export interface GhostFut {
  symbol: string;
  side: "long" | "short";
  entry: number;
  stop: number;
  t1: number | null;
  t2: number | null;
}

export interface GhostPos {
  id: string;
  kind: "twin" | "refused";
  /** twin: the room position it shadows. refused: the gate that refused it. */
  of: string;
  planKey: string | null;
  ticker: Underlier;
  type: OptionType;
  strike: number;
  exp: string;
  offset: StrikeOffset;
  contracts: number;
  entryPx: number;
  openedAt: number;
  fut: GhostFut | null;
  quant: { pT1: number; atr: number | null } | null;
  trimmed: boolean;
  realizedUsd: number;
  pnlPct: number;
  closed: { at: number; px: number; reason: string; pnlUsd: number } | null;
}

export interface PlanWatch {
  key: string;
  at: number;
  flatAt: number;
  symbol: string;
  underlier: Underlier;
  side: "long" | "short";
  entry: number;
  stop: number;
  t1: number;
  decision: "fill" | "refused" | "review";
  gate: string | null;
  /** Nova's P(T1 before the flat | the CE fills). */
  pWindow: number;
  evUsd: number | null;
  lenses: Partial<Record<Character, number>>;
  touched: boolean;
  outcome: "t1" | "stop" | "none" | "void" | null;
  resolvedAt: number | null;
}

export interface RoomLab {
  version: 1;
  seq: number;
  ghosts: GhostPos[];
  watches: PlanWatch[];
}

export function emptyLab(): RoomLab {
  return { version: 1, seq: 0, ghosts: [], watches: [] };
}

export function asLab(x: unknown): RoomLab {
  const l = x as RoomLab | undefined;
  return l?.version === 1 && Array.isArray(l.ghosts) && Array.isArray(l.watches) ? l : emptyLab();
}

const money = (n: number) => Math.round(n * 100) / 100;

/** Open ghosts, in the shape the desk's level-exit reader takes. */
export function labWatchList(lab: RoomLab): ExitWatch[] {
  return lab.ghosts
    .filter((g) => !g.closed)
    .map((g) => ({ id: g.id, trimmed: g.trimmed, openedAt: g.openedAt, fut: g.fut, quant: g.quant }));
}

function planKeyOf(e: Pick<RoomEntryRead, "futSymbol" | "futSide" | "plan">): string | null {
  return e.plan ? `${e.futSymbol}:${e.futSide}:${e.plan.entry.toFixed(2)}` : null;
}

function optionsOpen(nowMs: number): boolean {
  const w = etWallParts(nowMs);
  const m = w.hour * 60 + w.minute;
  return w.weekday >= 1 && w.weekday <= 5 && m >= ROOM_CLOCK.optionsOpenMin && m < ROOM_CLOCK.optionsCloseMin;
}

export interface LabStepArgs {
  cycle: RoomCycle;
  market: Record<Underlier, UnderlierTape>;
  desk: RoomDeskRead | null;
  nowMs: number;
  /** The room position this cycle opened, when it opened one (paper-book.ts after applyCycle). */
  roomFillId: string | null;
}

/** Mark and exit the ghosts, open new ones, follow the plans. Pure. */
export function stepLab(prev: RoomLab, a: LabStepArgs): RoomLab {
  const { cycle, market, desk, nowMs } = a;
  const etDate = etDateOf(nowMs);
  const w = etWallParts(nowMs);
  const etMin = w.hour * 60 + w.minute;
  const open = optionsOpen(nowMs);
  let seq = prev.seq;

  // 1) Ghosts: mark, then let each run its own policy on the room's rules.
  const ghosts: GhostPos[] = prev.ghosts.map((g0) => {
    if (g0.closed) return g0;
    const g = { ...g0 };
    const tape = market[g.ticker];
    if (!tape || !(tape.price > 0)) return g;
    if (nowMs >= expiryMs(g.exp)) {
      const intrinsic = g.type === "CALL" ? Math.max(0, tape.price - g.strike) : Math.max(0, g.strike - tape.price);
      const pnl = money((intrinsic - g.entryPx) * 100 * g.contracts) + g.realizedUsd;
      return { ...g, closed: { at: nowMs, px: intrinsic, reason: "expired — settled at intrinsic", pnlUsd: money(pnl) } };
    }
    const iv = ivFor(g.ticker, tape.vix);
    const q = quoteOption(tape.price, g.strike, g.exp, g.type, iv, nowMs);
    g.pnlPct = Math.round(((q.bid - g.entryPx) / g.entryPx) * 1000) / 10;
    if (!open) return g;
    const pos: RoomPositionIn = {
      id: g.id,
      ticker: g.ticker,
      type: g.type,
      strike: g.strike,
      exp: g.exp,
      pnl_percent: g.pnlPct,
      contracts: g.contracts,
      trimmed: g.trimmed,
      strike_offset: g.offset,
      entry_px: g.entryPx,
    };
    const policy = g.kind === "twin" ? MANDATE_POLICY : ROOM_POLICY;
    const hold = policy.thetaStop ? holdReadFor(pos, desk?.held?.[g.id], tape, etDate, nowMs) : null;
    const x = exitFor(pos, tape, { desk, etDate, etMin, nowMs, policy, hold });
    if (!x) return g;
    const px = x.quote?.bid ?? q.bid;
    const qty = x.qty != null && x.qty > 0 ? Math.min(x.qty, g.contracts) : g.contracts;
    const pnl = money((px - g.entryPx) * 100 * qty);
    if (qty >= g.contracts) {
      return { ...g, closed: { at: nowMs, px, reason: `${x.reason.replace("_", " ")} — ${x.why}`, pnlUsd: money(pnl + g.realizedUsd) } };
    }
    return { ...g, contracts: g.contracts - qty, trimmed: true, realizedUsd: money(g.realizedUsd + pnl) };
  });

  // 2) New ghosts.
  const tr = cycle.trace;
  const b = cycle.output.broker_action;
  if (b.action_type === "BUY_OPEN" && tr.entry && a.roomFillId) {
    const e = tr.entry;
    seq += 1;
    ghosts.push(ghostFrom(`G${seq}`, "twin", a.roomFillId, e.entry, e.quote.strike, e.exp, e.offset, e.qty, e.quote.ask, nowMs));
  }
  const card = desk?.entry ?? null;
  if (tr.beat === "vetoed" && tr.entry && card?.tier === "live" && tr.refusalGate) {
    const key = planKeyOf(card);
    if (key && !ghosts.some((g) => g.planKey === key && g.openedAt > nowMs - 24 * 3_600_000)) {
      const e = tr.entry;
      seq += 1;
      ghosts.push(ghostFrom(`G${seq}`, "refused", tr.refusalGate, e.entry, e.quote.strike, e.exp, e.offset, Math.max(1, e.qty), e.quote.ask, nowMs));
    }
  }

  // 3) Plan watches: open on the first priced review, follow to the flat.
  let watches = prev.watches.map((x) => resolveWatch(x, desk, nowMs));
  if (card?.plan?.t1 != null && tr.entry?.ev && tr.lenses) {
    const key = `${planKeyOf(card)}:${etDate}`;
    const decision: PlanWatch["decision"] = b.action_type === "BUY_OPEN" ? "fill" : tr.beat === "vetoed" && card.tier === "live" ? "refused" : "review";
    const i = watches.findIndex((x) => x.key === key);
    if (i < 0) {
      watches.push({
        key,
        at: nowMs,
        flatAt: etWallToEpochMs(etDate, clockEt(ROOM_CLOCK.dayFlatMin)),
        symbol: card.futSymbol,
        underlier: card.underlier,
        side: card.futSide,
        entry: card.plan.entry,
        stop: card.plan.stop,
        t1: card.plan.t1,
        decision,
        gate: decision === "refused" ? tr.refusalGate : null,
        pWindow: tr.entry.ev.window.pT1,
        evUsd: tr.entry.ev.evUsd,
        lenses: Object.fromEntries(CREW.map((c) => [c, tr.lenses![c].p])),
        touched: decision !== "review" || card.tier === "live",
        outcome: null,
        resolvedAt: null,
      });
    } else if (watches[i]!.outcome == null && decision !== "review" && watches[i]!.decision !== "fill") {
      watches[i] = { ...watches[i]!, decision, gate: decision === "refused" ? tr.refusalGate : null, touched: true };
    }
  }
  watches = watches.slice(-KEEP);
  const keptGhosts = [...ghosts.filter((g) => !g.closed), ...ghosts.filter((g) => g.closed).slice(-KEEP)];
  return { version: 1, seq, ghosts: keptGhosts, watches };
}

function ghostFrom(
  id: string,
  kind: GhostPos["kind"],
  of: string,
  e: RoomEntryRead,
  strike: number,
  exp: string,
  offset: StrikeOffset,
  contracts: number,
  ask: number,
  nowMs: number,
): GhostPos {
  const plan = e.plan;
  return {
    id,
    kind,
    of,
    planKey: planKeyOf(e),
    ticker: e.underlier,
    type: e.type,
    strike,
    exp,
    offset,
    contracts,
    entryPx: ask,
    openedAt: nowMs,
    fut: plan ? { symbol: e.futSymbol, side: e.futSide, entry: plan.entry, stop: plan.stop, t1: plan.t1, t2: plan.t2 } : null,
    quant: e.pT1 != null ? { pT1: e.pT1, atr: e.atr ?? null } : null,
    trimmed: false,
    realizedUsd: 0,
    pnlPct: 0,
    closed: null,
  };
}

/** Follow a plan on the futures print: CE touched, then T1 or the stop, else the flat. */
function resolveWatch(x: PlanWatch, desk: RoomDeskRead | null, nowMs: number): PlanWatch {
  if (x.outcome != null) return x;
  const price = desk?.futures?.[x.underlier]?.price;
  const long = x.side === "long";
  let w = x;
  if (price != null && price > 0 && nowMs <= x.flatAt) {
    if (!w.touched && (long ? price <= w.entry : price >= w.entry)) w = { ...w, touched: true };
    if (w.touched) {
      if (long ? price >= w.t1 : price <= w.t1) return { ...w, outcome: "t1", resolvedAt: nowMs };
      if (long ? price <= w.stop : price >= w.stop) return { ...w, outcome: "stop", resolvedAt: nowMs };
    }
  }
  if (nowMs > x.flatAt) return { ...w, outcome: w.touched ? "none" : "void", resolvedAt: nowMs };
  return w;
}

/* ── What the room has learned ──────────────────────────────────────────── */

export interface TrackRecord {
  n: number;
  brier: number | null;
  meanP: number | null;
  hitRate: number | null;
}

export interface LabRead {
  ghostsOpen: number;
  /** Room P&L minus the mandate twin's, over fills both have closed. */
  twins: { n: number; roomUsd: number; mandateUsd: number; deltaUsd: number };
  /** Refused tickets by the gate that refused them: what they would have made. */
  refusals: { gate: string; n: number; pnlUsd: number; wins: number }[];
  calibration: {
    n: number;
    meanP: number | null;
    hitRate: number | null;
    brier: number | null;
    bins: { lo: number; hi: number; n: number; meanP: number | null; hit: number | null }[];
  };
  track: Record<Character, TrackRecord>;
  recent: { key: string; at: number; decision: PlanWatch["decision"]; gate: string | null; outcome: NonNullable<PlanWatch["outcome"]>; pWindow: number }[];
  /** Plans still being followed: what each person said at the first look (the debate quotes the change). */
  open: { key: string; at: number; lenses: Partial<Record<Character, number>> }[];
}

/** Below this many scored plans a person's Brier is not quoted. */
export const MIN_TRACK = 5;

export function labRead(lab: RoomLab, closedRoom: { id: string; pnlUsd: number }[]): LabRead {
  const closed = lab.ghosts.filter((g) => g.closed);
  // Twins: the room's total on a position (trims included) against its ghost's.
  const roomBy = new Map<string, number>();
  for (const c of closedRoom) roomBy.set(c.id, money((roomBy.get(c.id) ?? 0) + c.pnlUsd));
  const pairs = closed.filter((g) => g.kind === "twin" && roomBy.has(g.of));
  const roomUsd = money(pairs.reduce((s, g) => s + (roomBy.get(g.of) ?? 0), 0));
  const mandateUsd = money(pairs.reduce((s, g) => s + (g.closed?.pnlUsd ?? 0), 0));
  const byGate = new Map<string, { n: number; pnlUsd: number; wins: number }>();
  for (const g of closed.filter((x) => x.kind === "refused")) {
    const r = byGate.get(g.of) ?? { n: 0, pnlUsd: 0, wins: 0 };
    r.n += 1;
    r.pnlUsd = money(r.pnlUsd + (g.closed?.pnlUsd ?? 0));
    if ((g.closed?.pnlUsd ?? 0) > 0) r.wins += 1;
    byGate.set(g.of, r);
  }
  const scored = lab.watches.filter((w) => w.touched && (w.outcome === "t1" || w.outcome === "stop" || w.outcome === "none"));
  const hit = (w: PlanWatch) => (w.outcome === "t1" ? 1 : 0);
  const brier = (xs: { p: number; y: number }[]) => (xs.length ? xs.reduce((s, x) => s + (x.p - x.y) ** 2, 0) / xs.length : null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const BINS: [number, number][] = [
    [0, 0.2],
    [0.2, 0.4],
    [0.4, 0.6],
    [0.6, 1.01],
  ];
  // Vince's number is per CARD (the fill is part of it): a plan whose CE never
  // filled is a miss for him; everyone else is scored on filled plans only.
  const perCard = lab.watches.filter((w) => w.outcome === "t1" || w.outcome === "stop" || w.outcome === "none" || w.outcome === "void");
  const track = Object.fromEntries(
    CREW.map((c) => {
      const pool = c === "Vince" ? perCard : scored;
      const xs = pool.filter((w) => w.lenses[c] != null).map((w) => ({ p: w.lenses[c]!, y: w.touched ? hit(w) : 0 }));
      return [c, { n: xs.length, brier: xs.length >= MIN_TRACK ? round3(brier(xs)) : null, meanP: round3(mean(xs.map((x) => x.p))), hitRate: round3(mean(xs.map((x) => x.y))) }];
    }),
  ) as Record<Character, TrackRecord>;
  return {
    ghostsOpen: lab.ghosts.filter((g) => !g.closed).length,
    twins: { n: pairs.length, roomUsd, mandateUsd, deltaUsd: money(roomUsd - mandateUsd) },
    refusals: [...byGate.entries()].map(([gate, r]) => ({ gate, ...r })).sort((a, b) => b.n - a.n),
    calibration: {
      n: scored.length,
      meanP: round3(mean(scored.map((w) => w.pWindow))),
      hitRate: round3(mean(scored.map(hit))),
      brier: round3(brier(scored.map((w) => ({ p: w.pWindow, y: hit(w) })))),
      bins: BINS.map(([lo, hi]) => {
        const xs = scored.filter((w) => w.pWindow >= lo && w.pWindow < hi);
        return { lo, hi: Math.min(1, hi), n: xs.length, meanP: round3(mean(xs.map((w) => w.pWindow))), hit: round3(mean(xs.map(hit))) };
      }),
    },
    track,
    recent: lab.watches
      .filter((w) => w.outcome != null && w.outcome !== "void")
      .slice(-6)
      .reverse()
      .map((w) => ({ key: w.key, at: w.at, decision: w.decision, gate: w.gate, outcome: w.outcome!, pWindow: w.pWindow })),
    open: lab.watches.filter((w) => w.outcome == null).map((w) => ({ key: w.key, at: w.at, lenses: w.lenses })),
  };
}

function round3(x: number | null): number | null {
  return x == null ? null : Math.round(x * 1000) / 1000;
}
