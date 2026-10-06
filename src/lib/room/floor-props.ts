/**
 * Floor 3D overhaul — Chunk A (9–15) + Chunk B school SMC (16–24) + Chunk D race/replay (34–35) — what the new set pieces show, read from data the room already has.
 *
 * Pure: no DOM, no three.js, no clock of its own (every function takes `nowMs`). The scene draws it; nothing here
 * is a gate, a size or an order, and nothing is invented. Every figure is copied from one of:
 *   - the live talk's world (`TalkWorld`, built by live-world.ts from the desk each second): tape books (price,
 *     prior close, the desk's own levels with their pool flag), the VIX/10Y pulse, the feed, the room book read,
 *     the ARMED/WATCH card, the ghost room;
 *   - the room's paper book (`RoomBook.closed`) and memory (`MindState.memories` outcomes);
 *   - the session clock (`resolveKillzone` in src/lib/trading/sessions.ts) — the killzone boundaries are scanned
 *     from that function, not restated here.
 * When a source is missing the piece says so ("no pulse", "no PDH in desk levels") instead of drawing a default.
 */

import type { LabLite, BookRead, CardRead, FeedRead, TalkWorld, TapeBook } from "./live-types";
import type { Memory } from "./agents";
import type { Underlier } from "./option-math";
import type { RoomClosedTrade, RoomEvent } from "./paper-book";
import { contractName, gateWord, usd } from "./format";
import { etWallParts, resolveKillzone, type KillzoneId } from "@/lib/trading/sessions";
import { PATH_MONTH_CAP } from "@/lib/trading/profit-rules";
import {
  AWAITING_SCHOOL_MODEL,
  buildSchoolFloor,
  type SchoolFloor,
  type SchoolModelHook,
} from "./school-contract";
import {
  raceAnimFrom,
  raceReplaySignature,
  sessionMoments,
  type RaceAnim,
  type SessionMoment,
} from "./floor-race-replay";

/* ── 9. Session time-of-day + killzone clock ─────────────────────────────── */

export interface SessionSegment {
  id: KillzoneId;
  label: string;
  /** ET minutes after midnight, [start, end). A segment that wraps midnight (Asia) has end < start. */
  start: number;
  end: number;
  /** One of the clock's named trade windows (`inTradeWindow` in sessions.ts). */
  killzone: boolean;
}

/** Display colours per session — presentation only. */
export const SESSION_COLOR: Record<KillzoneId, string> = {
  asia: "#0ea5e9",
  london: "#f59e0b",
  ny_am: "#22c55e",
  ny_lunch: "#64748b",
  ny_pm: "#14b8a6",
  dead: "#334155",
};

const SHORT: Record<KillzoneId, string> = { asia: "ASIA", london: "LONDON", ny_am: "NY AM", ny_lunch: "LUNCH", ny_pm: "NY PM", dead: "DEAD" };

let SEGMENTS: SessionSegment[] | null = null;

/**
 * The day's sessions, scanned minute by minute from `resolveKillzone` so the dial can never disagree with the HUD's
 * killzone label. Adjacent minutes with the same id merge (London's "open" and "pre-NY" halves are one band).
 */
export function sessionSegments(): SessionSegment[] {
  if (SEGMENTS) return SEGMENTS;
  const raw: SessionSegment[] = [];
  for (let m = 0; m < 1440; m++) {
    const k = resolveKillzone(Math.floor(m / 60), m % 60);
    const last = raw[raw.length - 1];
    if (last && last.id === k.id) last.end = m + 1;
    else raw.push({ id: k.id, label: SHORT[k.id], start: m, end: m + 1, killzone: k.inTradeWindow });
  }
  // Asia wraps midnight: the 00:00 band and the 19:00 band are one session.
  const first = raw[0];
  const last = raw[raw.length - 1];
  if (raw.length > 1 && first && last && first.id === last.id) {
    last.end = first.end;
    raw.shift();
  }
  for (const s of raw) s.end %= 1440;
  SEGMENTS = raw;
  return raw;
}

const inSeg = (s: SessionSegment, m: number) => (s.start < s.end ? m >= s.start && m < s.end : m >= s.start || m < s.end);
const until = (from: number, to: number) => (to - from + 1440) % 1440;

export interface SessionDial {
  etMin: number;
  /** "HH:MM:SS ET" */
  clock: string;
  current: SessionSegment;
  /** 0..1 through the current session. */
  progress: number;
  minsLeft: number;
  /** The next killzone that is not the one we are in, and how far away it opens. */
  next: { seg: SessionSegment; inMin: number };
  inKillzone: boolean;
  color: string;
  /** From the world's clock when the caller has it (holiday / weekend / Globex) — the dial alone cannot know a holiday. */
  marketNote: string | null;
}

export function sessionDial(nowMs: number, clock?: { isWeekday: boolean; holiday: boolean; globexOpen: boolean; judas: boolean; blackout: boolean; blackoutReason: string | null } | null): SessionDial {
  const p = etWallParts(nowMs);
  const etMin = p.hour * 60 + p.minute;
  const segs = sessionSegments();
  const current = segs.find((s) => inSeg(s, etMin)) ?? segs[0]!;
  const len = until(current.start, current.end) || 1440;
  const done = until(current.start, etMin) + p.second / 60;
  const kzs = segs.filter((s) => s.killzone && s !== current);
  let next = { seg: kzs[0] ?? current, inMin: Infinity };
  for (const s of kzs) {
    const d = until(etMin, s.start);
    if (d > 0 && d < next.inMin) next = { seg: s, inMin: d };
  }
  const weekday = clock ? clock.isWeekday : p.weekday >= 1 && p.weekday <= 5;
  let marketNote: string | null = null;
  if (clock?.holiday) marketNote = "Exchange holiday";
  else if (clock && !clock.globexOpen) marketNote = "Globex closed";
  else if (!weekday) marketNote = "Weekend";
  else if (clock?.blackout) marketNote = clock.blackoutReason ? `Blackout · ${clock.blackoutReason}` : "News blackout";
  else if (clock?.judas) marketNote = "Judas window 09:30–09:45";
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    etMin,
    clock: `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)} ET`,
    current,
    progress: Math.min(1, Math.max(0, done / len)),
    minsLeft: Math.max(0, len - done),
    next,
    inKillzone: current.killzone && weekday,
    color: SESSION_COLOR[current.id],
    marketNote,
  };
}

/* ── 10. VIX weather ─────────────────────────────────────────────────────── */

export type WeatherBand = "clear" | "cloud" | "overcast" | "storm" | "none";

export interface VixWeather {
  vix: number | null;
  band: WeatherBand;
  label: string;
  /** 0..1 how much weather to draw. 0 when there is no VIX (nothing is drawn on a default). */
  intensity: number;
  /** Pulse source tag — VIX always comes from Yahoo (^VIX). */
  source: "Y!";
  /** Age of the room's last pulse pull, when known (Yahoo is delayed structure). */
  delaySec: number | null;
  /** "Y! DELAYED · …" / "No VIX pulse" for dials and tiles. */
  sourceLine: string;
}

function pulseDelaySec(at: number | null | undefined, nowMs?: number): number | null {
  if (at == null || !Number.isFinite(at) || at <= 0) return null;
  const now = nowMs ?? Date.now();
  return Math.max(0, Math.round((now - at) / 1000));
}

function fmtDelay(sec: number | null): string {
  if (sec == null) return "DELAYED";
  if (sec < 60) return `DELAYED · ${sec}s`;
  const m = Math.round(sec / 60);
  return m < 60 ? `DELAYED · ${m}m` : `DELAYED · ${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * The same bands the windows already draw (clear under 15, scattered cloud to 20,
 * overcast to 30, storm at 30+). A missing VIX is "no pulse" — no default 16.
 * Source is always Y! (Yahoo ^VIX); the dial/tile must say so.
 */
export function vixWeather(vix: number | null | undefined, pulseAt: number | null | undefined = null, nowMs?: number): VixWeather {
  const delaySec = pulseDelaySec(pulseAt, nowMs);
  const source = "Y!" as const;
  if (vix == null || !Number.isFinite(vix) || vix <= 0) {
    return { vix: null, band: "none", label: "No VIX pulse", intensity: 0, source, delaySec, sourceLine: `Y! · no pulse` };
  }
  const band =
    vix >= 30 ? ("storm" as const) : vix >= 20 ? ("overcast" as const) : vix >= 15 ? ("cloud" as const) : ("clear" as const);
  const label = band === "storm" ? "Storm" : band === "overcast" ? "Overcast" : band === "cloud" ? "Scattered cloud" : "Clear";
  const intensity =
    band === "storm" ? Math.min(1, 0.75 + (vix - 30) / 40) : band === "overcast" ? 0.45 + ((vix - 20) / 10) * 0.25 : band === "cloud" ? 0.15 + ((vix - 15) / 5) * 0.25 : 0;
  return { vix, band, label, intensity, source, delaySec, sourceLine: `Y! ${fmtDelay(delaySec)}` };
}

/* ── 11. Liquidity lanes: PDH / PDL / BSL / SSL + the price puck ─────────── */

export type LaneKind = "PDH" | "PDL" | "BSL" | "SSL" | "DRAW";

export interface Lane {
  kind: LaneKind;
  /** The desk's own name for the level (e.g. "PWH", "EQH 21,340"). */
  name: string;
  price: number;
  /** 0 = bottom of the track (lowest), 1 = top. */
  pos: number;
  /** Price has traded through it today (from the quote's day high / low) — a taken pool draws dim. */
  taken: boolean;
}

export interface LiquidityTrack {
  u: Underlier;
  say: string;
  sym: string;
  px: number;
  puck: number;
  prevClose: number | null;
  changePct: number | null;
  lanes: Lane[];
  /** What the track could not find in the desk's levels — shown, not filled in. */
  missing: LaneKind[];
}

const isPdh = (n: string) => /^PDH$/i.test(n);
const isPdl = (n: string) => /^PDL$/i.test(n);

/**
 * One track per tape book. PDH / PDL are the desk's prior-day levels by name. BSL / SSL are the nearest pools
 * (`LevelRef.pool`, as live-world.ts flags them) above / below the price that are not already the PDH / PDL lane.
 * The scale is the lanes plus the price, padded; no level is made up to fill a gap.
 */
export function liquidityTrack(b: TapeBook | null): LiquidityTrack | null {
  if (!b || !Number.isFinite(b.px) || b.px <= 0) return null;
  const pdh = b.levels.find((l) => isPdh(l.name));
  const pdl = b.levels.find((l) => isPdl(l.name));
  const pools = b.levels.filter((l) => l.pool && !isPdh(l.name) && !isPdl(l.name) && Number.isFinite(l.price));
  const above = pools.filter((l) => l.price > b.px).sort((a, c) => a.price - c.price)[0];
  const below = pools.filter((l) => l.price < b.px).sort((a, c) => c.price - a.price)[0];
  const raw: Omit<Lane, "pos" | "taken">[] = [];
  const missing: LaneKind[] = [];
  if (pdh) raw.push({ kind: "PDH", name: pdh.name, price: pdh.price });
  else missing.push("PDH");
  if (pdl) raw.push({ kind: "PDL", name: pdl.name, price: pdl.price });
  else missing.push("PDL");
  if (above) raw.push({ kind: "BSL", name: above.name, price: above.price });
  else missing.push("BSL");
  if (below) raw.push({ kind: "SSL", name: below.name, price: below.price });
  else missing.push("SSL");
  if (b.draw && Number.isFinite(b.draw.price) && !raw.some((l) => Math.abs(l.price - b.draw!.price) < 1e-9)) raw.push({ kind: "DRAW", name: b.draw.name, price: b.draw.price });
  const prices = [b.px, ...raw.map((l) => l.price)];
  let lo = Math.min(...prices);
  let hi = Math.max(...prices);
  if (!(hi > lo)) {
    const pad = Math.max(1, b.px * 0.002);
    lo -= pad;
    hi += pad;
  }
  const padPts = (hi - lo) * 0.08;
  lo -= padPts;
  hi += padPts;
  const at = (p: number) => (p - lo) / (hi - lo);
  const lanes: Lane[] = raw.map((l) => ({
    ...l,
    pos: at(l.price),
    taken:
      (l.kind === "PDH" || l.kind === "BSL") && b.dayHigh != null
        ? b.dayHigh >= l.price
        : (l.kind === "PDL" || l.kind === "SSL") && b.dayLow != null
          ? b.dayLow <= l.price
          : false,
  }));
  return { u: b.u, say: b.say, sym: b.sym, px: b.px, puck: at(b.px), prevClose: b.prevClose, changePct: b.changePct, lanes: lanes.sort((a, c) => c.price - a.price), missing };
}

/* ── 12. Ticker wall ─────────────────────────────────────────────────────── */

export type Tone = "up" | "down" | "flat" | "warn" | "muted";

export interface Tile {
  label: string;
  value: string;
  sub: string;
  tone: Tone;
}

const fmtPx = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;
const toneOf = (n: number | null | undefined): Tone => (n == null ? "muted" : n > 0 ? "up" : n < 0 ? "down" : "flat");

/** Desk short source tags — never paint Y!/DB/SYN as LIVE. */
export function feedSourceTag(kind: FeedRead["kind"] | string | null | undefined): "LIVE" | "Y!" | "DB" | "SYN" | "NONE" {
  if (kind === "live_gateway") return "LIVE";
  if (kind === "yahoo") return "Y!";
  if (kind === "databento") return "DB";
  if (kind === "synthetic") return "SYN";
  return "NONE";
}

export function feedTile(feed: FeedRead): Tile {
  const kind = feedSourceTag(feed.kind);
  const lag = feed.lagSec != null ? `lag ${Math.round(feed.lagSec)}s` : "lag n/a";
  const tone: Tone = kind === "LIVE" && (feed.lagSec ?? 99) <= 30 ? "up" : kind === "SYN" || kind === "NONE" ? "down" : "warn";
  return { label: "FEED", value: kind, sub: lag, tone };
}

export function tickerTiles(w: Pick<TalkWorld, "books" | "pulse" | "feed" | "clock" | "card">): Tile[] {
  const tiles: Tile[] = [];
  for (const u of ["QQQ", "SPY"] as Underlier[]) {
    const b = w.books[u];
    const say = u === "QQQ" ? "NQ" : "ES";
    if (!b) tiles.push({ label: say, value: "—", sub: "no quote", tone: "muted" });
    else tiles.push({ label: `${b.say} · ${b.sym}`, value: fmtPx(b.px), sub: b.changePct != null ? fmtPct(b.changePct) : "chg n/a", tone: toneOf(b.changePct) });
  }
  const wx = vixWeather(w.pulse.vix, w.pulse.at);
  tiles.push(
    wx.vix != null
      ? { label: "VIX · Y!", value: wx.vix.toFixed(2), sub: `${wx.label} · ${wx.sourceLine}`, tone: wx.vix >= 30 ? "down" : wx.vix >= 20 ? "warn" : "flat" }
      : { label: "VIX · Y!", value: "—", sub: wx.sourceLine, tone: "muted" },
  );
  const ty = w.pulse.tenYear;
  tiles.push(ty != null ? { label: "10Y", value: `${ty.toFixed(2)}%`, sub: "yield", tone: "flat" } : { label: "10Y", value: "—", sub: "no pulse", tone: "muted" });
  tiles.push(feedTile(w.feed));
  tiles.push({ label: "SESSION", value: w.clock.killzoneLabel || "—", sub: w.clock.optionsOpen ? "options open" : "options shut", tone: w.clock.killzone === "ny_am" || w.clock.killzone === "ny_pm" || w.clock.killzone === "london" ? "up" : "muted" });
  const nq = w.books.QQQ;
  tiles.push(nq?.draw ? { label: `DRAW · ${nq.say}`, value: fmtPx(nq.draw.price), sub: nq.draw.name, tone: nq.draw.price > nq.px ? "up" : "down" } : { label: "DRAW", value: "—", sub: "no draw read", tone: "muted" });
  tiles.push(cardTile(w.card));
  return tiles;
}

function cardTile(c: CardRead | null): Tile {
  if (!c) return { label: "CARD", value: "NONE", sub: "no options card", tone: "muted" };
  const p = c.pT1 != null ? ` · P(T1) ${Math.round(c.pT1 * 100)}%` : "";
  return { label: `CARD · ${c.verdict}`, value: `${c.band ?? "—"} ${c.futSymbol} ${c.futSide}`, sub: `${c.strategy ?? c.name}${p}`, tone: c.verdict === "ARMED" ? "up" : c.verdict === "WATCH" ? "warn" : "muted" };
}

/* ── 14. Stat props ──────────────────────────────────────────────────────── */

export function statProps(book: BookRead, lab: LabLite | null, startCash: number | null): Tile[] {
  const out: Tile[] = [];
  out.push({ label: "DAY P&L", value: usd(book.dayPnl), sub: "room paper book", tone: toneOf(book.dayPnl) });
  const vsStart = startCash != null && startCash > 0 ? ((book.equity - startCash) / startCash) * 100 : null;
  out.push({ label: "EQUITY", value: usd(book.equity), sub: vsStart != null ? `${fmtPct(vsStart)} vs start` : "paper", tone: toneOf(vsStart) });
  out.push({ label: "CLOSED · WON", value: `${book.closedToday} · ${book.winsToday}`, sub: "today", tone: book.closedToday === 0 ? "muted" : book.winsToday * 2 >= book.closedToday ? "up" : "down" });
  out.push({ label: "LOSS STREAK", value: String(book.consecLosses), sub: book.consecLosses >= 2 ? "cool-down rule" : "in a row", tone: book.consecLosses >= 2 ? "down" : book.consecLosses === 1 ? "warn" : "flat" });
  out.push({ label: "PATH THIS MONTH", value: `${book.monthEntries} / ~${PATH_MONTH_CAP}`, sub: "entries vs month cap", tone: book.monthEntries >= PATH_MONTH_CAP ? "warn" : "flat" });
  const cal = lab?.calibration;
  if (cal && cal.n > 0 && cal.hitRate != null && cal.meanP != null)
    out.push({ label: "CALIBRATION", value: `${Math.round(cal.hitRate * 100)}% hit`, sub: `vs ${Math.round(cal.meanP * 100)}% said · n ${cal.n}`, tone: Math.abs(cal.hitRate - cal.meanP) <= 0.1 ? "up" : "warn" });
  else out.push({ label: "CALIBRATION", value: "—", sub: "no filled plans scored yet", tone: "muted" });
  return out;
}

/* ── 15. Trophy shelf + wall of scars ───────────────────────────────────── */

export interface Plaque {
  title: string;
  line: string;
  /** The number painted on the cup itself. */
  pnl: string;
  usd: number | null;
  at: number;
  source: "book" | "memory" | "ghost";
}

const contractOf = (c: RoomClosedTrade) => contractName(c.ticker, c.strike, c.type, c.exp);

/**
 * Trophies: closed paper wins, vetoes the re-price says saved money, chase calls the tape graded right, and gates
 * whose refused tickets would have lost (ghost room). Scars: the mirror image. Biggest dollars first, then newest.
 * A memory that is a fill/stop/win is not repeated (the closed trade already carries it).
 */
export function trophiesAndScars(closed: RoomClosedTrade[], memories: readonly Memory[], lab: LabLite | null, max = 6): { trophies: Plaque[]; scars: Plaque[] } {
  const trophies: Plaque[] = [];
  const scars: Plaque[] = [];
  for (const c of closed) {
    if (!Number.isFinite(c.pnlUsd) || c.pnlUsd === 0) continue;
    const signed = `${c.pnlUsd > 0 ? "+" : "−"}${usd(Math.abs(c.pnlUsd))}`;
    const p: Plaque = { title: signed, pnl: signed, line: `${contractOf(c)} · ${c.contracts}× · ${c.reason} · PAPER`, usd: c.pnlUsd, at: c.closedAt, source: "book" };
    (c.pnlUsd > 0 ? trophies : scars).push(p);
  }
  for (const m of memories) {
    const o = m.outcome;
    if (!o) continue;
    if (m.kind === "veto" && (o.verdict === "saved" || o.verdict === "cost")) {
      const amt = o.usd != null ? `${o.usd >= 0 ? "+" : "−"}${usd(Math.abs(o.usd))}` : null;
      const p: Plaque = {
        title: o.verdict === "saved" ? `${m.who} saved ${amt ?? ""}`.trim() : `${m.who} cost ${amt ?? ""}`.trim(),
        pnl: amt ?? (o.verdict === "saved" ? "saved" : "cost"),
        line: `${m.clock} ET · ${m.text} · PAPER`,
        usd: o.usd ?? null,
        at: o.at,
        source: "memory",
      };
      (o.verdict === "saved" ? trophies : scars).push(p);
    } else if (m.kind === "chase_call" && (o.verdict === "right" || o.verdict === "wrong")) {
      const mv = o.movePct != null ? `${o.movePct >= 0 ? "+" : "−"}${Math.abs(o.movePct).toFixed(2)}%` : "paper";
      const p: Plaque = {
        title: `${mv} · ${m.who}`,
        pnl: mv,
        line: `${m.clock} ET · ${m.text} · PAPER CALL · ${o.verdict}`,
        usd: null,
        at: o.at,
        source: "memory",
      };
      (o.verdict === "right" ? trophies : scars).push(p);
    }
  }
  for (const r of lab?.refusals ?? []) {
    if (r.n <= 0 || !Number.isFinite(r.pnlUsd) || r.pnlUsd === 0) continue;
    const g = gateWord(r.gate);
    if (r.pnlUsd < 0) trophies.push({ title: `${g} saved ${usd(-r.pnlUsd)}`, pnl: `+${usd(-r.pnlUsd)}`, line: `ghost room · ${r.n} refused · ${r.wins} would have won · PAPER`, usd: -r.pnlUsd, at: 0, source: "ghost" });
    else scars.push({ title: `${g} missed ${usd(r.pnlUsd)}`, pnl: `−${usd(r.pnlUsd)}`, line: `ghost room · ${r.n} refused · ${r.wins} would have won · PAPER`, usd: -r.pnlUsd, at: 0, source: "ghost" });
  }
  const rank = (a: Plaque, b: Plaque) => Math.abs(b.usd ?? 0) - Math.abs(a.usd ?? 0) || b.at - a.at;
  return { trophies: trophies.sort(rank).slice(0, max), scars: scars.sort(rank).slice(0, max) };
}

/* ── Everything the overhaul draws, in one object ───────────────────────── */

export interface FloorProps {
  at: number;
  clock: TalkWorld["clock"];
  synthetic: boolean;
  weather: VixWeather;
  tracks: Record<Underlier, LiquidityTrack | null>;
  ticker: Tile[];
  stats: Tile[];
  trophies: Plaque[];
  scars: Plaque[];
  /** Chunk B (16–24): school disciples, desks, checklist, briefing, ranks, body, relationships.
   *  Debate panel is drawn from ManagerRoomState in floor-overhaul (same path as Manager monitors).
   *  Trading Stand model hook defaults to awaiting — never invents hit-rates. */
  school: SchoolFloor;
  /** Chunk D 34 — visual race among school/seat runners from real paper equity. */
  race: RaceAnim;
  /** Chunk D 35 — real session moments for the scrubber (seat / close / book). */
  moments: SessionMoment[];
}

export function floorProps(
  w: TalkWorld,
  room: {
    closed: RoomClosedTrade[];
    startCash: number | null;
    memories: readonly Memory[];
    /** Optional book event log for scrubber moments (real only). */
    bookEvents?: readonly RoomEvent[];
    /** Optional Stand hook; omit = awaiting model data labels. */
    schoolHook?: SchoolModelHook;
    entryMood?: "WAIT" | "STALKING" | "ARMED" | "ENTER" | null;
  },
): FloorProps {
  const { trophies, scars } = trophiesAndScars(room.closed, room.memories, w.lab);
  const school = buildSchoolFloor(w, {
    hook: room.schoolHook ?? AWAITING_SCHOOL_MODEL,
    entryMood: room.entryMood ?? null,
  });
  const race = raceAnimFrom(w.seats, w.goal);
  const moments = sessionMoments({ seats: w.seats, closed: room.closed, bookEvents: room.bookEvents });
  return {
    at: w.nowMs,
    clock: w.clock,
    synthetic: w.feed.kind === "synthetic",
    weather: vixWeather(w.pulse.vix, w.pulse.at, w.nowMs),
    tracks: { QQQ: liquidityTrack(w.books.QQQ), SPY: liquidityTrack(w.books.SPY) },
    ticker: tickerTiles(w),
    stats: statProps(w.book, w.lab, room.startCash),
    trophies,
    scars,
    school,
    race,
    moments,
  };
}

/** What changed enough to redraw: everything except the clock's seconds. */
export function propsSignature(p: FloorProps | null): string {
  if (!p) return "";
  const { at: _at, clock, school, race, moments, ...rest } = p;
  // Briefing clock ticks every second — signature uses phase/label/lines only.
  const schoolSig = {
    hook: [school.hook.source, school.hook.version],
    desks: school.desks.map((d) => [d.school, d.source, d.line]),
    checklist: school.checklist.map((c) => [c.id, c.state, c.detail]),
    briefing: { phase: school.briefing.phase, label: school.briefing.label, lines: school.briefing.lines, inMin: school.briefing.inMin },
    ranks: school.ranks.map((r) => [r.who, r.rank, r.n, r.hitRate, r.label]),
    body: school.body.map((b) => [b.who, b.anim, b.reason]),
    rels: school.rels.map((r) => [r.a, r.b, r.tone, Math.round(r.strength * 100)]),
  };
  return JSON.stringify([
    clock.killzone,
    clock.optionsOpen,
    clock.globexOpen,
    clock.holiday,
    clock.blackout,
    clock.judas,
    rest,
    schoolSig,
    raceReplaySignature(race, moments),
  ]);
}
