/**
 * The trading floor's live engine — runs one room cycle on every desk
 * refresh, whichever tab is open, so a stop or an 11:00 time exit fires even
 * when nobody is watching the 3D room. The Floor tab only draws it.
 *
 * Two clocks, both real:
 *  - the CYCLE (once per desk build, ~once a minute): the paper book, the
 *    gates, the exits, the director's meetings — everything that can move
 *    money;
 *  - the TAPE TICK (once per quote patch, 1–2 s): the live-talk engine
 *    (lib/room/live-talk.ts) looks at what the desk can see right now — the
 *    prints, the levels, the headlines, the calendar, the book, the feed's
 *    honesty — and decides whether anyone has something real to say. What it
 *    produces is queued for the scene and written to the wire log.
 *
 * There is no replay, no drill and no time control: nothing here runs on
 * anything but the real clock and the real feeds. State: the room's paper
 * book and the people's minds (localStorage), the talk memory (sessionStorage,
 * 30 min). The VIX/10y pulse is pulled every five minutes and the headlines
 * every 2½ minutes, whichever tab is open — the talk reads them too.
 */

import { useEffect, useRef } from "react";
import { create } from "zustand";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { evaluateOptionsDesk } from "@/lib/trading/options-desk";
import { NEWS_CALENDAR } from "@/lib/trading/news";
import { getNewsFeed, getPulse } from "@/lib/news/news-server";
import { etWallParts, etWallToEpochMs } from "@/lib/trading/sessions";
import type { MindState } from "@/lib/room/agents";
import { booksOf, marketDataFromDesk, readDeskForRoom } from "@/lib/room/desk-read";
import { etDateOf, type Underlier } from "@/lib/room/option-math";
import { runRoomCycle, type RoomCycle } from "@/lib/room/orchestrator";
import { asLab, labRead, type LabRead } from "@/lib/room/lab";
import { asGoal, defaultGoal, GOAL_STORAGE, type GoalSpec } from "@/lib/room/goal";
import { computeRace, type Race } from "@/lib/room/race";
import { asSeatBook, ensureSeats } from "@/lib/room/seats";
import { freshTalkState, talkTick } from "@/lib/room/live-talk";
import { floorProps, propsSignature, type FloorProps } from "@/lib/room/floor-props";
import { TALK, type FeedRead, type NewsLite, type TalkItem, type TalkKind, type TalkState, type TalkWorld, type Urgency } from "@/lib/room/live-types";
import { atrOf, emptyRings, feedOf, goalLite, labLite, newsLiteFrom, ringsAfter, rndLite, scannerCards, seatsLite, worldFromDesk, type Rings } from "@/lib/room/live-world";
import { readInvestOffice } from "@/lib/room/invest-sources";
import { deskAudit } from "@/lib/room/audit";
import { freshnessOf } from "@/lib/room/data-fresh";
import { EXEC_FLAGS } from "@/lib/room/exec/limits";
import type { DialogueLine } from "@/lib/room/orchestrator";
import { rankOf, richer } from "@/lib/room/snapshot";
import { backupRoom, restoreRoomIfRicher, type BackupState } from "@/lib/room/snapshot-sync";
import {
  ROOM_DEFAULT_CASH,
  applyCycle,
  applyLab,
  emptyBook,
  equityOf,
  exitWatchOf,
  ledgerOf,
  loadRoomBook,
  markBook,
  rollCounters,
  saveRoomBook,
  toRoomInput,
  voidPosition,
  type RoomBook,
} from "@/lib/room/paper-book";
import type { Void } from "@/lib/room/exec/executor";
import { execAfterCycle, execFlatten } from "./exec-bridge";
import { researchShelf } from "@/lib/room/research";
// RH Individual account on the desk (Keaton 2026-10-06) — context for the seats, never a ticket.
import { RH_AGENTIC_DESK_READ } from "@/lib/execution/rh-account";
import { consensus } from "@/lib/room/debate";
import { clockEt, contractName } from "@/lib/room/format";
import { roomManagerFeed } from "@/lib/room/manager-room-feed";
import type { FloorFrame, FloorScreens, LedgerScreen, RaceScreen } from "./floor-screens";

const MINDS_STORAGE = "ledger-room-minds-v1";
const ENABLED_STORAGE = "ledger-room-enabled-v1";

function loadMinds(): MindState | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(MINDS_STORAGE) : null;
    const m = raw ? (JSON.parse(raw) as MindState) : null;
    return m?.version === 1 ? m : null;
  } catch {
    return null;
  }
}

function saveMinds(m: MindState | null) {
  try {
    if (m && typeof window !== "undefined") window.localStorage.setItem(MINDS_STORAGE, JSON.stringify(m));
  } catch {
    // Storage full or blocked: the room keeps running for this tab.
  }
}

function loadEnabled(): boolean {
  try {
    return typeof window === "undefined" || window.localStorage.getItem(ENABLED_STORAGE) !== "0";
  } catch {
    return true;
  }
}

function loadGoal(): GoalSpec {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(GOAL_STORAGE) : null;
    const g = raw ? asGoal(JSON.parse(raw)) : null;
    if (g) return g;
  } catch {
    // Storage blocked or corrupt: the default goal below.
  }
  return defaultGoal(Date.now());
}

function saveGoal(g: GoalSpec) {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(GOAL_STORAGE, JSON.stringify(g));
  } catch {
    // The goal runs for this tab.
  }
}

/* ── Frame building ─────────────────────────────────────────────────────── */

const RESEARCH_LINES = (() => {
  const shelf = researchShelf(RH_AGENTIC_DESK_READ, RH_AGENTIC_DESK_READ.asOfMs);
  return Object.fromEntries(Object.entries(shelf).map(([k, notes]) => [k, notes.map((n) => n.line)])) as FloorScreens["research"];
})();

function etClockLabel(nowMs: number): string {
  const p = etWallParts(nowMs);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][p.weekday] ?? "";
  return `${day} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")} ET`;
}

function bookScreen(book: RoomBook): FloorScreens["book"] {
  const equity = equityOf(book);
  return {
    cash: book.cash,
    equity,
    start: book.startCash,
    dayPnl: Math.round((equity - book.counters.dayStartEquity) * 100) / 100,
    positions: book.positions.map((p) => ({ id: p.id, contracts: p.contracts, pnlPct: p.pnlPct, bid: p.mark?.bid ?? null })),
    events: book.events.slice(0, 6).map((e) => e.text),
  };
}

function ageOf(iso: string | null, nowMs: number): string {
  if (!iso) return "";
  const m = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

export function calendarFor(nowMs: number): FloorScreens["calendar"] {
  const today = etDateOf(nowMs);
  const rows = NEWS_CALENDAR.filter((e) => e.date >= today).slice(0, 8);
  let nextMarked = false;
  return rows.map((e) => {
    const at = etWallToEpochMs(e.date, e.timeEt);
    const printed = at <= nowMs;
    const status = printed ? "printed" : !nextMarked ? ((nextMarked = true), "next") : "later";
    return { timeEt: e.date === today ? e.timeEt : `${e.date.slice(5)} ${e.timeEt}`, name: e.name, impact: e.impact, status } as FloorScreens["calendar"][number];
  });
}

/** The ledger the jumbotron draws: the card under review, else the first held position the room can price. */
function ledgerScreenOf(cycle: RoomCycle): LedgerScreen | null {
  const clock = (ms: number) => {
    const w = etWallParts(ms);
    return clockEt(w.hour * 60 + w.minute);
  };
  const e = cycle.trace.entry;
  if (e?.ev) {
    return {
      title: `${e.entry.futSymbol} ${e.entry.futSide} · PATH ${e.entry.band ?? "—"}`,
      contract: `${contractName(e.entry.underlier, e.quote.strike, e.entry.type, e.exp)} @ ${e.quote.ask.toFixed(2)}`,
      held: false,
      measured: e.ev.measured,
      pT1Model: e.ev.pT1Model,
      windowBars: e.ev.window.windowBars,
      share: e.ev.measured ? e.ev.window.shareOfHitsInWindow : null,
      paths: e.ev.scenarios.map((x) => ({ kind: x.kind, p: x.p, pnlUsd: x.pnlUsd, clock: clock(x.atMs) })),
      evUsd: e.ev.evUsd,
      evCalUsd: e.ev.calibrated?.evUsd ?? null,
      pCal: e.ev.calibrated?.p ?? null,
      t1Pays: e.ev.t1Pays,
      edgeUsd: null,
    };
  }
  for (const [id, h] of Object.entries(cycle.trace.holds ?? {})) {
    if (!h) continue;
    return {
      title: `${id} — held`,
      contract: id,
      held: true,
      measured: h.ev.measured,
      pT1Model: h.pT1Now,
      windowBars: h.ev.window.windowBars,
      share: h.ev.measured ? h.ev.window.shareOfHitsInWindow : null,
      paths: h.ev.scenarios.map((x) => ({ kind: x.kind, p: x.p, pnlUsd: x.pnlUsd, clock: clock(x.atMs) })),
      evUsd: h.ev.evUsd,
      evCalUsd: null,
      pCal: null,
      t1Pays: h.ev.t1Pays,
      edgeUsd: h.edgeUsd,
    };
  }
  return null;
}

export function frameFromCycle(args: {
  id: number;
  nowMs: number;
  cycle: RoomCycle;
  book: RoomBook;
  screens: Omit<FloorScreens, "book" | "research" | "ledger" | "lab" | "lenses" | "roomP" | "race" | "invest">;
  caption: string | null;
  lab: LabRead | null;
  race: RaceScreen | null;
  invest: FloorScreens["invest"];
}): FloorFrame {
  const p = etWallParts(args.nowMs);
  const lenses = args.cycle.trace.lenses;
  return {
    id: args.id,
    nowMs: args.nowMs,
    etMin: p.hour * 60 + p.minute,
    clockLabel: etClockLabel(args.nowMs),
    output: args.cycle.output,
    trace: args.cycle.trace,
    acts: args.cycle.trace.acts,
    minds: args.cycle.minds,
    screens: {
      ...args.screens,
      book: bookScreen(args.book),
      research: RESEARCH_LINES,
      ledger: ledgerScreenOf(args.cycle),
      lab: args.lab,
      lenses,
      roomP: lenses ? consensus(lenses, args.lab).p : null,
      race: args.race,
      invest: args.invest,
    },
    caption: args.caption,
  };
}

/**
 * What the annex screens draw — the race, the desk audit, the setup scanner and the feed's health — from the same reads the
 * live talk quotes, so a TV and a line of dialogue can never disagree about a number.
 */
export function raceScreenOf(race: Race | null, desk: DeskPayload, lab: LabRead | null, vix: number | null, nowMs: number): RaceScreen {
  const goal = goalLite(race, vix);
  const seats = seatsLite(race);
  const rnd = rndLite(race);
  const feed = feedOf(desk);
  return {
    goal,
    seats,
    rnd,
    audit: deskAudit({ feed, goal, lab: labLite(lab), rnd, seats, fresh: freshnessOf(etDateOf(nowMs)) }),
    scanner: scannerCards(desk, 6),
    feed,
    execFlags: Object.entries(EXEC_FLAGS).map(([name, on]) => ({ name, on })),
  };
}

/* ── The store ──────────────────────────────────────────────────────────── */

/** Where an exchange stands: queued for the scene, said, dropped as stale before it could start, or made while nobody was watching. */
export type WireStatus = "queued" | "said" | "dropped" | "unseen";

/** One line of the wire log: what was said, why, and the numbers it rested on. */
export interface WireEntry {
  id: string;
  at: number;
  /** The talk's kinds, plus the cycle's own events (a ticket, an exit, a director's meeting). */
  kind: TalkKind | "cycle";
  label: string;
  urgency: Urgency;
  lines: DialogueLine[];
  facts: string[];
  status: WireStatus;
}

interface RoomState {
  hydrated: boolean;
  enabled: boolean;
  book: RoomBook;
  minds: MindState | null;
  frame: FloorFrame | null;
  frameSeq: number;
  lastFetchedAt: string | null;
  pulse: { vix: number | null; tenYear: number | null; at: number | null };
  news: FloorScreens["news"];
  /** The headlines as the talk reads them (tagged, tiered), newest first. */
  newsLite: NewsLite[];
  /** The talk's memory: what was said, when, and what has already been announced. */
  talkState: TalkState;
  /** Ticks with an exchange in them since this page loaded — the Floor tab plays whatever is `pending`. */
  talkSeq: number;
  pending: TalkItem[];
  wire: WireEntry[];
  /** What the desk's feed is, right now (the badge), updated when it changes. */
  feedRead: FeedRead | null;
  /** The last time the tape tick ran — the badge says NO TICKS when this goes quiet. */
  tickAt: number | null;
  /** The 3D scene is mounted and will play what it is handed. */
  sceneOpen: boolean;
  /**
   * Floor 3D overhaul (Chunk A): what the ticker wall, liquidity lanes, VIX weather, stat banners, trophy shelf and wall
   * of scars show — `floorProps` over the same world the live talk reads. Replaced only when its signature moves.
   */
  floorProps: FloorProps | null;
  floorPropsSig: string;
  /** The server copy of the room (book + memory): restored at startup if richer, pushed after book changes. */
  backup: BackupState;
  /** The trader's goal (goal.ts) and the race it sets running (seats.ts): the plan, the league and the R&D board, once per desk build. */
  goal: GoalSpec;
  race: Race | null;
  setGoal: (g: GoalSpec) => string | null;
  hydrate: () => void;
  setEnabled: (on: boolean) => void;
  reset: (cash?: number) => void;
  setNews: (news: FloorScreens["news"]) => void;
  ackTalk: (status: Record<string, WireStatus>) => void;
  setSceneOpen: (open: boolean) => void;
}

export const useRoomStore = create<RoomState>((set, get) => ({
  hydrated: false,
  enabled: true,
  book: emptyBook(ROOM_DEFAULT_CASH, 0),
  minds: null,
  frame: null,
  frameSeq: 0,
  lastFetchedAt: null,
  pulse: { vix: null, tenYear: null, at: null },
  news: [],
  newsLite: [],
  talkState: freshTalkState(),
  talkSeq: 0,
  pending: [],
  wire: [],
  feedRead: null,
  tickAt: null,
  sceneOpen: false,
  floorProps: null,
  floorPropsSig: "",
  backup: { status: "idle", at: null, why: "Not checked yet." },
  goal: defaultGoal(0),
  race: null,
  setGoal: (g) => {
    const ok = asGoal(g);
    if (!ok) return "That goal is not valid — check the numbers (the target must be above the start; the ticket share between 1% and 100%).";
    saveGoal(ok);
    set({ goal: ok, race: null });
    if (latestDesk) refreshRace(latestDesk);
    return null;
  },
  hydrate: () => {
    if (get().hydrated) return;
    set({ hydrated: true, enabled: loadEnabled(), book: loadRoomBook(), minds: loadMinds(), talkState: loadTalk(), goal: loadGoal() });
    // Once per page load: adopt the server copy only if it has MORE history
    // than this browser's book at the moment it arrives — never merged.
    void restoreRoomIfRicher(get().book).then(({ snapshot, state }) => {
      if (snapshot && richer(rankOf(snapshot.book), rankOf(get().book))) {
        saveRoomBook(snapshot.book);
        saveMinds(snapshot.minds);
        // The race rides in the book: adopt the goal it was started under, or the next cycle would restart it.
        const sg = asSeatBook(asLab(snapshot.book.lab).seats)?.goal;
        if (sg) saveGoal(sg);
        set({ book: snapshot.book, minds: snapshot.minds, backup: state, frame: null, lastFetchedAt: null, ...(sg ? { goal: sg, race: null } : {}) });
      } else if (snapshot?.minds && (snapshot.minds.memories?.length ?? 0) > (get().minds?.memories.length ?? 0)) {
        saveMinds(snapshot.minds);
        set({ minds: snapshot.minds, backup: state });
      } else {
        set({ backup: snapshot ? { ...state, why: "This browser's room is current." } : state });
      }
    });
  },
  setEnabled: (on) => {
    try {
      window.localStorage.setItem(ENABLED_STORAGE, on ? "1" : "0");
    } catch {
      // per-tab only
    }
    set({ enabled: on });
  },
  reset: (cash = ROOM_DEFAULT_CASH) => {
    const book = emptyBook(cash);
    saveRoomBook(book);
    set({ book, frame: null, lastFetchedAt: null });
    // A reset is the one push that may replace a richer server copy.
    void backupRoom(book, get().minds, { force: true })?.then((backup) => set({ backup }));
  },
  setNews: (news) => set({ news }),
  ackTalk: (status) =>
    set((s) => ({
      pending: s.pending.filter((p) => !(p.id in status)),
      wire: s.wire.map((w) => (w.id in status ? { ...w, status: status[w.id]! } : w)),
    })),
  setSceneOpen: (open) => set({ sceneOpen: open }),
}));

/** A trade, an exit, or a change of beat or meeting — the cycle has a new story. */
export function storyMoved(next: FloorFrame, prev: FloorFrame | null): boolean {
  return !prev || next.output.broker_action.execute_trade || next.trace.beat !== prev.trace.beat || (next.trace.meeting?.key ?? "") !== (prev.trace.meeting?.key ?? "");
}

/** The cycle's own story as a wire entry: what the room decided or the director convened, in the words the contract carries. */
function cycleWire(f: FloorFrame, sceneOpen: boolean): WireEntry {
  const ba = f.output.broker_action;
  return {
    id: `c${f.id}`,
    at: f.nowMs,
    kind: "cycle",
    label: f.trace.meeting?.title ?? `${f.trace.beat}${ba.execute_trade ? ` · ${ba.action_type} ${ba.contracts_quantity}× ${ba.underlying} ${ba.option_type}` : ""}`,
    urgency: ba.execute_trade ? 2 : 1,
    lines: f.output.floor_dialogue_and_meetings,
    facts: [],
    status: sceneOpen ? "said" : "unseen",
  };
}

/** One live cycle on the desk the browser just built. */
function runLiveCycle(desk: DeskPayload) {
  const st = useRoomStore.getState();
  const nowMs = Date.parse(desk.fetchedAt) || Date.now();
  const od = evaluateOptionsDesk(desk);
  const { market } = marketDataFromDesk(desk, st.pulse.vix, nowMs);
  let book = rollCounters(st.book, nowMs, desk.clock.killzone);
  book = markBook(book, market, nowMs);
  const input = toRoomInput(book, market);
  const read = readDeskForRoom(desk, od, exitWatchOf(book), nowMs, st.pulse.tenYear);
  const lab = labRead(asLab(book.lab), book.closed);
  const cycle = runRoomCycle(input, { desk: read, ledger: ledgerOf(book), minds: st.minds, lab, rhAccount: RH_AGENTIC_DESK_READ }, nowMs);
  const bookBefore = book;
  book = applyCycle(book, cycle, nowMs);
  book = applyLab(book, cycle, market, read, nowMs, st.goal);
  saveRoomBook(book);
  saveMinds(cycle.minds);
  void backupRoom(book, cycle.minds, { nowMs })?.then((backup) => useRoomStore.setState({ backup }));

  const books = booksOf(desk);
  const chart = (u: Underlier) => {
    const b = books[u];
    const minute = b.minute ?? [];
    const bars = minute.length > 20 ? minute.slice(-90) : (b.series.bars ?? []).slice(-60);
    return { symbol: b.series.symbol, price: b.quote.price, bars, tf: minute.length > 20 ? "1m" : "15m" };
  };
  const e = read.entry;
  const held = book.positions[0]?.fut ?? null;
  const plan = e?.plan
    ? { symbol: e.futSymbol, side: e.futSide, entry: e.plan.entry, stop: e.plan.stop, t1: e.plan.t1, t2: e.plan.t2 }
    : held
      ? { symbol: held.symbol, side: held.side, entry: held.entry, stop: held.stop, t1: held.t1, t2: held.t2 }
      : null;
  const seq = st.frameSeq + 1;
  const labNow = labRead(asLab(book.lab), book.closed);
  const race = computeRace({ goal: st.goal, lab: asLab(book.lab), desk: read, market, nowMs, vix: market.QQQ.vix, closedRoom: book.closed, atr: atrOf(desk) });
  const frame = frameFromCycle({
    id: seq,
    nowMs,
    cycle,
    book,
    caption: null,
    lab: labNow,
    race: raceScreenOf(race, desk, labNow, market.QQQ.vix, nowMs),
    invest: readInvestOffice(nowMs),
    screens: {
      market,
      charts: { QQQ: chart("QQQ"), SPY: chart("SPY") },
      plan,
      news: st.news,
      calendar: calendarFor(nowMs),
      vix: st.pulse.vix,
      tenYear: st.pulse.tenYear,
      // The desk already refuses every card on a synthetic feed; say so on the TVs too.
      source:
        desk.feed === "synthetic"
          ? "SYNTHETIC desk feed — no live data"
          : `desk ${desk.feed}${read.lagSec != null ? ` · lag ${read.lagSec}s` : ""}`,
      synthetic: false,
    },
  });
  useRoomStore.setState((s) => ({
    book,
    minds: cycle.minds,
    frame,
    race,
    frameSeq: seq,
    lastFetchedAt: desk.fetchedAt,
    wire: frameIsEvent(frame) && storyMoved(frame, s.frame) ? [cycleWire(frame, s.sceneOpen), ...s.wire].slice(0, TALK.wireKeep) : s.wire,
  }));
  // The REAL Trading Stand Manager feed reads this cycle (chair beat, gates, call, plan,
  // lenses) — not a demo cycle. Its agentAgree reaches the RH path only through
  // managerStateForAgree → candidateFromFloorPathStand (every hard gate still applies).
  try {
    roomManagerFeed().pushRoom(
      { id: frame.id, nowMs: frame.nowMs, output: frame.output, trace: frame.trace, roomP: frame.screens.roomP, lenses: frame.screens.lenses },
      { card: read.entry, newsBlackout: read.news.blackout, synthetic: desk.feed === "synthetic" },
    );
  } catch (err) {
    console.error("[room] manager feed push failed:", err);
  }
  // The execution layer (exec/): what the room just did goes to the broker's side — shadow, paper, or nothing (off is the
  // default and a browser cannot change it). A synthetic desk feed is never a decision worth sending anywhere.
  if (desk.feed !== "synthetic") {
    void execAfterCycle(
      { before: bookBefore, after: book, cycle, feedLagSec: read.lagSec, nowMs },
      { getBook: () => useRoomStore.getState().book, onVoids: applyVoids },
    );
  }
}

/** The desk the engine last saw, so a change of goal can show its plan at once instead of at the next desk build. */
let latestDesk: DeskPayload | null = null;

/**
 * Restart the race for the current goal and recompute the plan from the desk as it is, without running another room cycle (a
 * cycle is the house room's decision; this only re-reads). Called when the trader changes the goal.
 */
export function refreshRace(desk: DeskPayload) {
  const st = useRoomStore.getState();
  const nowMs = Date.parse(desk.fetchedAt) || Date.now();
  const od = evaluateOptionsDesk(desk);
  const { market } = marketDataFromDesk(desk, st.pulse.vix, nowMs);
  const read = readDeskForRoom(desk, od, exitWatchOf(st.book), nowMs, st.pulse.tenYear);
  const lab = ensureSeats(asLab(st.book.lab), st.goal, nowMs);
  const book = { ...st.book, lab };
  saveRoomBook(book);
  const race = computeRace({ goal: st.goal, lab, desk: read, market, nowMs, vix: market.QQQ.vix, closedRoom: book.closed, atr: atrOf(desk) });
  // The TVs follow a new goal at once, not at the next cycle.
  const frame = st.frame ? { ...st.frame, screens: { ...st.frame.screens, race: raceScreenOf(race, desk, st.frame.screens.lab, market.QQQ.vix, nowMs) } } : st.frame;
  useRoomStore.setState({ book, race, frame });
}

/** The office panel saved something (the other-income line): redraw the investment TVs now instead of at the next desk build. */
export function refreshInvestScreens(): void {
  const f = useRoomStore.getState().frame;
  if (!f) return;
  useRoomStore.setState({ frame: { ...f, screens: { ...f.screens, invest: readInvestOffice(Date.now()) } } });
}

/** The trader's Flatten button (Execution card): close everything the executor owns at the broker, and stop new entries. */
export function flattenBroker(): Promise<void> {
  return execFlatten({ getBook: () => useRoomStore.getState().book, onVoids: applyVoids });
}

/** Entries the broker never filled: the room's book stops claiming them (paper-book.ts voidPosition). */
function applyVoids(voids: Void[]) {
  useRoomStore.setState((s) => {
    let b = s.book;
    for (const v of voids) b = voidPosition(b, v.positionId, v.keepQty, v.why, Date.now());
    if (b === s.book) return s;
    saveRoomBook(b);
    return { book: b };
  });
}

/* ── What the cycle may say, and the tape tick ──────────────────────────── */

/**
 * A cycle frame carries a story worth PLAYING when something happened that the live talk cannot see for itself: a
 * ticket sent, an exit, a refusal at the CE touch, or a director's meeting. The quiet beats (closed, chop, blocked,
 * holding, waiting for the touch) used to replay canned banter every few minutes; the live talk covers them now,
 * from the tape, so the cycle stays silent on them.
 */
export function frameIsEvent(f: FloorFrame): boolean {
  const b = f.trace.beat;
  return Boolean(f.output.broker_action.execute_trade || f.trace.meeting || b === "fill" || b === "exit" || b === "vetoed");
}

const TALK_STORAGE = "ledger-room-talk-v1";
const TALK_KEEP_MS = 30 * 60_000;

function loadTalk(): TalkState {
  try {
    const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(TALK_STORAGE) : null;
    const o = raw ? (JSON.parse(raw) as { at?: number; state?: TalkState }) : null;
    if (o?.state?.v === 1 && typeof o.at === "number" && Date.now() - o.at < TALK_KEEP_MS) return o.state;
  } catch {
    // Storage blocked: the talk starts fresh.
  }
  return freshTalkState();
}

let lastSaveMs = 0;
function saveTalk(state: TalkState, nowMs: number) {
  if (nowMs - lastSaveMs < 10_000) return;
  lastSaveMs = nowMs;
  try {
    window.sessionStorage.setItem(TALK_STORAGE, JSON.stringify({ at: nowMs, state }));
  } catch {
    // Storage full or blocked: the talk keeps its memory for this page.
  }
}

/** Dev-only seam for the browser tests: look at the world the talk is about to read, and replace it. */
interface RoomDev {
  store: typeof useRoomStore;
  patchWorld: ((w: TalkWorld) => TalkWorld) | null;
  rings: () => Rings;
}
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __roomDev?: RoomDev }).__roomDev = { store: useRoomStore, patchWorld: null, rings: () => rings };
}

/** The prints as they arrived, per book. Module state: it is a memory of the tape, not something a component renders. */
let rings: Rings = emptyRings();
let lastTickMs = 0;

/**
 * One look at the live desk, at most once a second. Pure talk (live-talk.ts) decides; this only feeds it the desk and
 * files what it says: the scene's queue while the floor is open, the wire log always.
 */
export function liveTick(desk: DeskPayload, nowMs = Date.now()) {
  if (nowMs - lastTickMs < 900) return;
  lastTickMs = nowMs;
  const st = useRoomStore.getState();
  rings = ringsAfter(rings, desk, nowMs);
  let world = worldFromDesk({
    desk,
    nowMs,
    rings,
    pulse: st.pulse,
    news: st.newsLite,
    book: st.book,
    beat: st.frame?.trace.beat ?? null,
    minds: st.minds,
    lab: st.frame?.screens.lab ?? null,
    race: st.race,
    invest: readInvestOffice(nowMs),
    busyUntil: 0,
  });
  if (import.meta.env.DEV) {
    const patch = (window as unknown as { __roomDev?: RoomDev }).__roomDev?.patchWorld;
    if (patch) world = patch(world);
  }
  const { item, state } = talkTick(world, st.talkState);
  saveTalk(state, nowMs);
  // The overhaul's props: presentation only, never read back by the talk or the cycle.
  let props: FloorProps | null = null;
  try {
    props = floorProps(world, { closed: st.book.closed, startCash: st.book.startCash, memories: st.minds?.memories ?? [], bookEvents: st.book.events });
  } catch (err) {
    console.error("[room] floor props failed:", err);
  }
  const propsSig = propsSignature(props);
  const feed = world.feed;
  const was = st.feedRead;
  const feedMoved = !was || was.kind !== feed.kind || (was.lagSec == null) !== (feed.lagSec == null) || Math.abs((was.lagSec ?? 0) - (feed.lagSec ?? 0)) >= 5;
  useRoomStore.setState((s) => {
    const next: Partial<RoomState> = { talkState: state, tickAt: nowMs };
    if (feedMoved) next.feedRead = feed;
    if (propsSig !== s.floorPropsSig) {
      next.floorProps = props;
      next.floorPropsSig = propsSig;
    }
    if (item) {
      const keep = s.pending.filter((p) => nowMs - p.at <= p.ttlMs);
      next.talkSeq = s.talkSeq + 1;
      next.pending = s.sceneOpen ? [...keep, item] : keep;
      next.wire = [
        { id: item.id, at: item.at, kind: item.kind, label: item.label, urgency: item.urgency, lines: item.lines, facts: item.facts, status: s.sceneOpen ? "queued" : "unseen" } satisfies WireEntry,
        ...s.wire,
      ].slice(0, TALK.wireKeep);
    }
    return next;
  });
}

/** Mount once at the page level: the room runs while the desk does. */
export function useRoomEngine(desk: DeskPayload | null) {
  const enabled = useRoomStore((s) => s.enabled);
  const hydrated = useRoomStore((s) => s.hydrated);
  useEffect(() => {
    useRoomStore.getState().hydrate();
  }, []);
  // Wait for the first desk before pulling pulse/news so cold-start does not
  // stack getPulse + getNewsFeed beside fetchTradingDesk / loadRisk (same
  // serverless budget; Yahoo + RSS contention can starve the desk build).
  const hasDesk = desk != null;
  useEffect(() => {
    if (!enabled || !hydrated || !hasDesk) return;
    let alive = true;
    const pull = async () => {
      try {
        const r = await getPulse();
        if (!alive) return;
        const vix = r.pulse.find((p) => p.label === "VIX")?.last ?? null;
        const tenYear = r.pulse.find((p) => p.label === "10y yield")?.last ?? null;
        useRoomStore.setState({ pulse: { vix, tenYear, at: Date.now() } });
      } catch {
        // No pulse: the room prices with the desk's fixed IVs and says so.
      }
    };
    void pull();
    const id = window.setInterval(pull, 5 * 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [enabled, hydrated, hasDesk]);
  // Headlines: the news TVs and the talk both read them, so they are pulled here, not by the tab.
  useEffect(() => {
    if (!enabled || !hydrated || !hasDesk) return;
    let alive = true;
    const pull = async () => {
      try {
        const r = await getNewsFeed();
        if (!alive) return;
        const now = Date.now();
        useRoomStore.setState({
          news: r.items.slice(0, 12).map((i) => ({ title: i.title, source: i.source, age: ageOf(i.published, now) })),
          newsLite: newsLiteFrom(r.items),
        });
      } catch {
        // The TV says "no headlines" and the talk has nothing new to read.
      }
    };
    void pull();
    const id = window.setInterval(pull, 150_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [enabled, hydrated, hasDesk]);
  const fetchedAt = desk?.fetchedAt ?? null;
  useEffect(() => {
    if (!enabled || !hydrated || !desk || !fetchedAt) return;
    if (useRoomStore.getState().lastFetchedAt === fetchedAt) return;
    try {
      runLiveCycle(desk);
    } catch (err) {
      console.error("[room] live cycle failed:", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchedAt, enabled, hydrated]);
  // The tape tick. A quote patch gives the desk a new identity and is looked at at once; a steady one-second beat also
  // runs, because most of what the room watches is time — a release five minutes out, a session mark, a feed that has
  // held its new state, a quiet room — and a market that is shut, or a synthetic feed, patches nothing.
  const deskRef = useRef<DeskPayload | null>(desk);
  deskRef.current = desk;
  useEffect(() => {
    latestDesk = desk;
  }, [desk]);
  useEffect(() => {
    if (!enabled || !hydrated || !desk) return;
    try {
      liveTick(desk);
    } catch (err) {
      console.error("[room] live tick failed:", err);
    }
  }, [desk, enabled, hydrated]);
  useEffect(() => {
    if (!enabled || !hydrated) return;
    const id = window.setInterval(() => {
      const d = deskRef.current;
      if (!d || document.visibilityState === "hidden") return;
      try {
        liveTick(d);
      } catch (err) {
        console.error("[room] live tick failed:", err);
      }
    }, 5000);
    return () => window.clearInterval(id);
  }, [enabled, hydrated]);
}

export { ageOf };
