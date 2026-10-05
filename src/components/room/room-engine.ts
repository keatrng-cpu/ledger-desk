/**
 * The trading floor's live engine — runs one room cycle on every desk
 * refresh, whichever tab is open, so a stop or an 11:00 time exit fires even
 * when nobody is watching the 3D room. The Floor tab only draws it.
 *
 * State: the room's paper book (paper-book.ts) and the people's minds
 * (agents.ts), both in this browser's localStorage. The VIX/10y pulse is
 * pulled every five minutes; headlines are pulled only while the Floor tab
 * is open (the news TV is the only reader).
 */

import { useEffect } from "react";
import { create } from "zustand";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { evaluateOptionsDesk } from "@/lib/trading/options-desk";
import { NEWS_CALENDAR } from "@/lib/trading/news";
import { getPulse } from "@/lib/news/news-server";
import { etWallParts, etWallToEpochMs } from "@/lib/trading/sessions";
import type { OhlcBar } from "@/lib/market/types";
import type { MindState } from "@/lib/room/agents";
import { booksOf, marketDataFromDesk, readDeskForRoom } from "@/lib/room/desk-read";
import type { DrillStep } from "@/lib/room/drill";
import { etDateOf, type Underlier } from "@/lib/room/option-math";
import { runRoomCycle, type RoomCycle } from "@/lib/room/orchestrator";
import { asLab, labRead, type LabRead } from "@/lib/room/lab";
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
import { consensus } from "@/lib/room/debate";
import { clockEt, contractName } from "@/lib/room/format";
import type { FloorFrame, FloorScreens, LedgerScreen } from "./floor-screens";

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

/* ── Frame building (shared by live and the drill) ──────────────────────── */

const RESEARCH_LINES = (() => {
  const shelf = researchShelf();
  return Object.fromEntries(Object.entries(shelf).map(([k, notes]) => [k, notes.map((n) => n.line)])) as FloorScreens["research"];
})();

function etClockLabel(nowMs: number, synthetic: boolean): string {
  const p = etWallParts(nowMs);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][p.weekday] ?? "";
  return `${day} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")} ET${synthetic ? " · DRILL" : ""}`;
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
  screens: Omit<FloorScreens, "book" | "research" | "ledger" | "lab" | "lenses" | "roomP">;
  caption: string | null;
  lab: LabRead | null;
}): FloorFrame {
  const p = etWallParts(args.nowMs);
  const lenses = args.cycle.trace.lenses;
  return {
    id: args.id,
    nowMs: args.nowMs,
    etMin: p.hour * 60 + p.minute,
    clockLabel: etClockLabel(args.nowMs, args.screens.synthetic),
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
    },
    caption: args.caption,
  };
}

/** The drill's screens: its own synthetic tape, its scripted release and headlines. */
export function drillFrame(step: DrillStep, history: DrillStep[], id: number): FloorFrame {
  const bars = (pick: (s: DrillStep) => number): OhlcBar[] =>
    history.map((s, i) => {
      const prev = i ? pick(history[i - 1]!) : pick(s);
      const cur = pick(s);
      const pad = Math.abs(cur) * 0.0002;
      return { t: s.nowMs, o: prev, c: cur, h: Math.max(prev, cur) + pad, l: Math.min(prev, cur) - pad, v: 0 };
    });
  const e = step.frame.entry;
  const held = step.book.positions[0]?.fut ?? null;
  const plan = e?.plan
    ? { symbol: e.futSymbol, side: e.futSide, entry: e.plan.entry, stop: e.plan.stop, t1: e.plan.t1, t2: e.plan.t2 }
    : held
      ? { symbol: held.symbol, side: held.side, entry: held.entry, stop: held.stop, t1: held.t1, t2: held.t2 }
      : null;
  const ag = step.desk.agenda;
  const calendar: FloorScreens["calendar"] = [
    ...(ag?.last ? [{ timeEt: ag.last.timeEt, name: ag.last.name, impact: ag.last.impact, status: "printed" as const }] : []),
    ...(ag?.next ? [{ timeEt: ag.next.timeEt, name: ag.next.name, impact: ag.next.impact, status: "next" as const }] : []),
  ];
  const news = history
    .flatMap((s) => (s.frame.news ?? []).map((title) => ({ title, source: "drill wire", age: s.frame.at })))
    .reverse()
    .slice(0, 6);
  return frameFromCycle({
    id,
    nowMs: step.nowMs,
    cycle: step.cycle,
    book: step.book,
    caption: step.frame.caption,
    lab: labRead(asLab(step.book.lab), step.book.closed),
    screens: {
      market: step.input.market_data,
      charts: {
        QQQ: { symbol: "MNQ", price: step.frame.nq, bars: bars((s) => s.frame.nq), tf: "drill" },
        SPY: { symbol: "ES", price: step.frame.es, bars: bars((s) => s.frame.es), tf: "drill" },
      },
      plan,
      news,
      calendar,
      vix: step.frame.vix,
      tenYear: 4.12,
      source: "DRILL — synthetic",
      synthetic: true,
    },
  });
}

/* ── The store ──────────────────────────────────────────────────────────── */

interface RoomState {
  hydrated: boolean;
  enabled: boolean;
  book: RoomBook;
  minds: MindState | null;
  frame: FloorFrame | null;
  frameSeq: number;
  /** Today's story beats, for the time-lapse replay (memory only, never stored). */
  history: FloorFrame[];
  lastFetchedAt: string | null;
  pulse: { vix: number | null; tenYear: number | null; at: number | null };
  news: FloorScreens["news"];
  /** The server copy of the room (book + memory): restored at startup if richer, pushed after book changes. */
  backup: BackupState;
  hydrate: () => void;
  setEnabled: (on: boolean) => void;
  reset: (cash?: number) => void;
  setNews: (news: FloorScreens["news"]) => void;
}

export const useRoomStore = create<RoomState>((set, get) => ({
  hydrated: false,
  enabled: true,
  book: emptyBook(ROOM_DEFAULT_CASH, 0),
  minds: null,
  frame: null,
  frameSeq: 0,
  history: [],
  lastFetchedAt: null,
  pulse: { vix: null, tenYear: null, at: null },
  news: [],
  backup: { status: "idle", at: null, why: "Not checked yet." },
  hydrate: () => {
    if (get().hydrated) return;
    set({ hydrated: true, enabled: loadEnabled(), book: loadRoomBook(), minds: loadMinds() });
    // Once per page load: adopt the server copy only if it has MORE history
    // than this browser's book at the moment it arrives — never merged.
    void restoreRoomIfRicher(get().book).then(({ snapshot, state }) => {
      if (snapshot && richer(rankOf(snapshot.book), rankOf(get().book))) {
        saveRoomBook(snapshot.book);
        saveMinds(snapshot.minds);
        set({ book: snapshot.book, minds: snapshot.minds, backup: state, frame: null, lastFetchedAt: null });
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
}));

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
  const cycle = runRoomCycle(input, { desk: read, ledger: ledgerOf(book), minds: st.minds, lab }, nowMs);
  const bookBefore = book;
  book = applyCycle(book, cycle, nowMs);
  book = applyLab(book, cycle, market, read, nowMs);
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
  const frame = frameFromCycle({
    id: seq,
    nowMs,
    cycle,
    book,
    caption: null,
    lab: labRead(asLab(book.lab), book.closed),
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
  useRoomStore.setState({ book, minds: cycle.minds, frame, frameSeq: seq, lastFetchedAt: desk.fetchedAt, history: keepForReplay(st.history, frame) });
  // The execution layer (exec/): what the room just did goes to the broker's side — shadow, paper, or nothing (off is the
  // default and a browser cannot change it). A synthetic desk feed is never a decision worth sending anywhere.
  if (desk.feed !== "synthetic") {
    void execAfterCycle(
      { before: bookBefore, after: book, cycle, feedLagSec: read.lagSec, nowMs },
      { getBook: () => useRoomStore.getState().book, onVoids: applyVoids },
    );
  }
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

const HISTORY_MAX = 160;

/** Keep a frame for the replay when the story moved (a ticket, a new beat or meeting) or every 15 minutes; a new ET day starts fresh. */
function keepForReplay(history: FloorFrame[], f: FloorFrame): FloorFrame[] {
  const last = history[history.length - 1];
  const day = (x: FloorFrame) => etDateOf(x.nowMs);
  if (last && day(last) !== day(f)) return [f];
  const moved =
    !last ||
    f.output.broker_action.execute_trade ||
    f.trace.beat !== last.trace.beat ||
    (f.trace.meeting?.key ?? "") !== (last.trace.meeting?.key ?? "") ||
    f.nowMs - last.nowMs >= 15 * 60_000;
  return moved ? [...history, f].slice(-HISTORY_MAX) : history;
}

/** Mount once at the page level: the room runs while the desk does. */
export function useRoomEngine(desk: DeskPayload | null) {
  const enabled = useRoomStore((s) => s.enabled);
  const hydrated = useRoomStore((s) => s.hydrated);
  useEffect(() => {
    useRoomStore.getState().hydrate();
  }, []);
  useEffect(() => {
    if (!enabled || !hydrated) return;
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
  }, [enabled, hydrated]);
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
}

export { ageOf };
