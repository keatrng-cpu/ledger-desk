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
import {
  ROOM_DEFAULT_CASH,
  applyCycle,
  emptyBook,
  equityOf,
  exitWatchOf,
  ledgerOf,
  loadRoomBook,
  markBook,
  rollCounters,
  saveRoomBook,
  toRoomInput,
  type RoomBook,
} from "@/lib/room/paper-book";
import { researchShelf } from "@/lib/room/research";
import type { FloorFrame, FloorScreens } from "./floor-screens";

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

export function frameFromCycle(args: {
  id: number;
  nowMs: number;
  cycle: RoomCycle;
  book: RoomBook;
  screens: Omit<FloorScreens, "book" | "research">;
  caption: string | null;
}): FloorFrame {
  const p = etWallParts(args.nowMs);
  return {
    id: args.id,
    nowMs: args.nowMs,
    etMin: p.hour * 60 + p.minute,
    clockLabel: etClockLabel(args.nowMs, args.screens.synthetic),
    output: args.cycle.output,
    trace: args.cycle.trace,
    acts: args.cycle.trace.acts,
    minds: args.cycle.minds,
    screens: { ...args.screens, book: bookScreen(args.book), research: RESEARCH_LINES },
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
  lastFetchedAt: string | null;
  pulse: { vix: number | null; tenYear: number | null; at: number | null };
  news: FloorScreens["news"];
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
  lastFetchedAt: null,
  pulse: { vix: null, tenYear: null, at: null },
  news: [],
  hydrate: () => {
    if (get().hydrated) return;
    set({ hydrated: true, enabled: loadEnabled(), book: loadRoomBook(), minds: loadMinds() });
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
  const cycle = runRoomCycle(input, { desk: read, ledger: ledgerOf(book), minds: st.minds }, nowMs);
  book = applyCycle(book, cycle, nowMs);
  saveRoomBook(book);
  saveMinds(cycle.minds);

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
  useRoomStore.setState({ book, minds: cycle.minds, frame, frameSeq: seq, lastFetchedAt: desk.fetchedAt });
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
