/**
 * The live room's talk engine: one pure function from "what the desk can see right now" plus "what we have
 * already said" to at most one new exchange.
 *
 *   talkTick(world, state) → { item, state }
 *
 * No timers, no randomness, no model. The world carries its own clock (`world.nowMs`), so the same inputs
 * always give the same words and a verifier can replay a whole simulated day in milliseconds.
 *
 * WHAT MAKES THE ROOM SPEAK, in order of how loudly:
 *   urgency 2  a release printing, a position near its level, the price touching the card's CE, a raid with a
 *              card or a position in that book, a violent move, a tier-1 headline that just landed
 *   urgency 1  a move worth remarking, a level approached or accepted, a session mark, a killzone change, the
 *              feed changing, VIX or the 10y jumping, a card arming, a position's P&L stepping, a ghost closing
 *   urgency 0  chatter — only when the room has been quiet: the range, the dealing range, the draw, the
 *              sequence's missing layer, the best card, NQ against ES, the gap, volume, the day's plan, the
 *              rules' counters, calibration, a call someone made earlier, somebody's mood, a measured finding,
 *              tomorrow's calendar, the overnight range, the day's recap
 *
 * WHAT KEEPS IT FROM LOOPING
 *   - Every topic has a cooldown, and a topic that spoke repeats early only if its data signature moved.
 *   - A phrase bank never repeats its last variant, and a line already said recently is not said again
 *     (live-voices.ts `pick`); when every variant is spent the line is dropped, not repeated.
 *   - Chatter waits for a quiet room; a budget caps exchanges per ten minutes; a stale exchange is dropped.
 *   - Nothing is said that the data cannot back: no priced topic runs on a synthetic or silent feed, and the
 *     tape topics stop when the tape does.
 *
 * This is narration. It never gates, sizes or sends anything.
 */

import { ROOM_CLOCK } from "./mandate";
import { EXEC_LIMITS } from "./exec/limits";
import * as V from "./live-voices";
import * as R from "./live-voices-race";
import * as IV from "./live-voices-invest";
import { freshCatalysts, investLooks, themeOfTheDay, watchHit, type WatchHit } from "./invest-read";
import { deskAudit } from "./audit";
import {
  ATM_DELTA,
  Facts,
  TALK,
  freshTalkState,
  hash32,
  norm,
  playMs,
  type CardRead,
  type NewsLite,
  type SeatEventLite,
  type PositionRead,
  type TalkItem,
  type TalkKind,
  type TalkState,
  type TalkWorld,
  type TapeBook,
  type TapeSample,
  type Urgency,
} from "./live-types";
import type { Underlier } from "./option-math";
import type { Character } from "./orchestrator";

export { freshTalkState };
export type { TalkItem, TalkState, TalkWorld };

/* ── The tape ring ─────────────────────────────────────────────────────── */

/** Add a print. Identical prices inside a few seconds are one print; anything older than the ring is dropped. */
export function pushPrint(ring: TapeSample[], t: number, px: number): TapeSample[] {
  if (!Number.isFinite(px) || px <= 0) return ring;
  const last = ring[ring.length - 1];
  if (last) {
    if (t <= last.t) return ring;
    if (last.px === px && t - last.t < 5_000) return ring;
    if (t - last.t < TALK.ringMinPrintGapMs && last.px === px) return ring;
  }
  const keepFrom = t - TALK.ringKeepMs;
  let start = 0;
  while (start < ring.length && ring[start]!.t < keepFrom) start++;
  const next = start ? ring.slice(start) : ring.slice();
  next.push({ t, px });
  return next;
}

/** The move from `windowSec` ago to the live price, or null when the ring cannot say. */
export function moveOver(ring: TapeSample[], nowMs: number, livePx: number, windowSec: number): { pts: number; sec: number } | null {
  if (ring.length < 2) return null;
  const target = nowMs - windowSec * 1000;
  let best: TapeSample | null = null;
  let bestD = Infinity;
  for (const s of ring) {
    const d = Math.abs(s.t - target);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  if (!best || bestD > windowSec * 1000 * TALK.windowSlack) return null;
  const sec = (nowMs - best.t) / 1000;
  if (sec <= 0) return null;
  return { pts: livePx - best.px, sec };
}

/* ── Candidates ────────────────────────────────────────────────────────── */

interface Cand {
  id: string;
  kind: TalkKind;
  topic: string;
  urgency: Urgency;
  /** Tie-break inside an urgency: higher goes first. */
  prio: number;
  /** When the thing happened (newest first inside a tie). */
  at: number;
  label: string;
  build: (c: V.Ctx) => V.Ex | null;
  commit: (st: TalkState) => void;
}

const UNDERLIERS: Underlier[] = ["QQQ", "SPY"];

const clone = (st: TalkState): TalkState => structuredClone(st);

const etfUsd = (futPts: number, perEtfPt: number): number => ATM_DELTA * (Math.abs(futPts) / perEtfPt) * 100;

function tapeLive(w: TalkWorld): boolean {
  if (w.feed.kind === "synthetic" || w.feed.kind === "none") return false;
  if (!(w.clock.globexOpen || w.clock.optionsOpen)) return false;
  return (w.feed.lagSec ?? 0) < 1800;
}

function nearestPool(b: TapeBook, dir: 1 | -1): { name: string; price: number; dist: number; side: "above" | "below" } | null {
  let best: { name: string; price: number; dist: number; side: "above" | "below" } | null = null;
  for (const lv of b.levels) {
    if (!lv.pool) continue;
    const d = dir > 0 ? lv.price - b.px : b.px - lv.price;
    if (d <= 0) continue;
    if (!best || d < best.dist) best = { name: lv.name, price: lv.price, dist: d, side: dir > 0 ? "above" : "below" };
  }
  return best;
}

const heldIn = (w: TalkWorld, u: Underlier): PositionRead | null => w.book.positions.find((p) => p.u === u) ?? null;
const cardIn = (w: TalkWorld, u: Underlier): CardRead | null => (w.card && w.card.u === u ? w.card : null);

/* ── Feed ──────────────────────────────────────────────────────────────── */

function feedCands(w: TalkWorld, st: TalkState, out: Cand[]) {
  const kind = w.feed.kind;
  if (st.feedKind == null) {
    st.feedKind = kind;
    return;
  }
  if (kind === st.feedKind) {
    st.feedPend = null;
    if (kind === "synthetic" && w.nowMs - st.feedNoteAt >= TALK.heartbeatTopicCooldownMs) {
      out.push({
        id: "feed|reminder",
        kind: "feed",
        topic: "feed:reminder",
        urgency: 0,
        prio: 1,
        at: w.nowMs,
        label: "feed is still synthetic",
        build: (c) => V.exFeed(c, { kind, lagSec: w.feed.lagSec, from: kind, reminder: true }),
        commit: (s) => {
          s.feedNoteAt = w.nowMs;
        },
      });
    }
    return;
  }
  if (!st.feedPend || st.feedPend.kind !== kind) {
    st.feedPend = { kind, since: w.nowMs };
    return;
  }
  if (w.nowMs - st.feedPend.since < 20_000) return;
  const from = st.feedKind;
  out.push({
    id: `feed|${from}>${kind}`,
    kind: "feed",
    topic: `feed:${kind}`,
    urgency: 1,
    prio: 9,
    at: w.nowMs,
    label: `feed ${from} → ${kind}`,
    build: (c) => V.exFeed(c, { kind, lagSec: w.feed.lagSec, from, reminder: false }),
    commit: (s) => {
      s.feedKind = kind;
      s.feedPend = null;
      s.feedNoteAt = w.nowMs;
    },
  });
}

/* ── Session marks ─────────────────────────────────────────────────────── */

interface Mark {
  id: string;
  min: number;
  /** Weekdays it applies to (0 = Sunday). */
  days: number[];
  /** Needs a cash trading day (not a holiday). */
  cash: boolean;
}

const MARKS: Mark[] = [
  { id: "pre_open", min: 9 * 60, days: [1, 2, 3, 4, 5], cash: true },
  { id: "open", min: ROOM_CLOCK.optionsOpenMin, days: [1, 2, 3, 4, 5], cash: true },
  { id: "judas_end", min: 9 * 60 + 45, days: [1, 2, 3, 4, 5], cash: true },
  { id: "aplus", min: ROOM_CLOCK.aPlusOnlyAfterMin, days: [1, 2, 3, 4, 5], cash: true },
  { id: "flat", min: ROOM_CLOCK.dayFlatMin, days: [1, 2, 3, 4, 5], cash: true },
  { id: "flatten", min: ROOM_CLOCK.flattenAllMin, days: [1, 2, 3, 4, 5], cash: true },
  { id: "close", min: ROOM_CLOCK.optionsCloseMin, days: [1, 2, 3, 4, 5], cash: true },
  { id: "halt", min: 17 * 60, days: [1, 2, 3, 4], cash: false },
  { id: "week_close", min: 17 * 60, days: [5], cash: false },
  { id: "globex_open", min: 18 * 60, days: [0, 1, 2, 3, 4], cash: false },
];

const MARK_VALID_MIN = 4;

function sessionCands(w: TalkWorld, st: TalkState, out: Cand[]) {
  const k = w.clock;
  const book = w.books.QQQ ?? w.books.SPY;
  for (const m of MARKS) {
    if (!m.days.includes(k.weekday)) continue;
    if (m.cash && (k.holiday || !k.isWeekday)) continue;
    const since = k.etMin - m.min;
    if (since < 0 || since >= MARK_VALID_MIN) continue;
    const key = `${k.etDate}|${m.id}`;
    if (st.sessFired[key]) continue;
    const gap = book && book.prevClose != null ? book.px - book.prevClose : null;
    out.push({
      id: `sess|${key}`,
      kind: "session",
      topic: `session:${m.id}`,
      urgency: m.id === "open" || m.id === "flatten" || m.id === "close" ? 2 : 1,
      prio: 8,
      at: w.nowMs,
      label: `session mark · ${m.id.replace("_", " ")}`,
      build: (c) =>
        V.exSession(c, {
          id: m.id,
          b: book,
          gapPts: gap,
          positions: w.book.positions.length,
          monthEntries: w.book.monthEntries,
          dayPnl: w.book.dayPnl,
          winsToday: w.book.winsToday,
          closedToday: w.book.closedToday,
          killzoneLabel: k.killzoneLabel,
          rangeUsedPct: book?.rangeUsedPct ?? null,
          weekTrade: w.week?.today?.trade ?? null,
          consecLosses: w.book.consecLosses,
        }),
      commit: (s) => {
        s.sessFired[key] = true;
      },
    });
  }
  // Killzones: the desk's own clock, not a hard-coded list.
  const kz = k.killzone;
  if (st.killzone == null) {
    st.killzone = kz;
  } else if (kz !== st.killzone) {
    const named = kz !== "dead" && k.killzoneLabel;
    const prev = st.killzone;
    if (named && (k.globexOpen || k.optionsOpen)) {
      out.push({
        id: `kz|${k.etDate}|${kz}`,
        kind: "session",
        topic: `killzone:${kz}`,
        urgency: 1,
        prio: 6,
        at: w.nowMs,
        label: `killzone ${prev} → ${kz}`,
        build: (c) => V.exKillzone(c, { label: k.killzoneLabel, b: book, rangeUsedPct: book?.rangeUsedPct ?? null }),
        commit: (s) => {
          s.killzone = kz;
        },
      });
    } else st.killzone = kz;
  }
}

/* ── The calendar ──────────────────────────────────────────────────────── */

function calendarCands(w: TalkWorld, st: TalkState, out: Cand[]) {
  const live = w.books.QQQ ?? w.books.SPY;
  for (const e of w.cal.events) {
    const minutes = (e.atMs - w.nowMs) / 60_000;
    const printKey = `${e.date}|${e.timeEt}|${e.name}`;
    const printed = w.cal.prints[printKey];
    const mk = (step: number, urgency: Urgency, label: string) => {
      const key = `${printKey}|${step}`;
      if (st.calFired[key]) return;
      const sinceSec = Math.max(0, -minutes * 60);
      const tape =
        step <= 0 || step === 5 && minutes < 0
          ? (() => {
              if (!live || !tapeLive(w)) return null;
              const m = moveOver(live.samples, w.nowMs, live.px, Math.max(30, sinceSec));
              if (!m) return null;
              return { b: live, dir: (m.pts >= 0 ? 1 : -1) as 1 | -1, pts: Math.abs(m.pts), sec: m.sec, atrX: live.atr ? Math.abs(m.pts) / live.atr : null };
            })()
          : null;
      out.push({
        id: `cal|${key}`,
        kind: "calendar",
        topic: `calendar:${printKey}:${step}`,
        urgency,
        prio: 10,
        at: e.atMs,
        label,
        build: (c) =>
          V.exCalendar(c, {
            name: e.name,
            timeEt: e.timeEt,
            impact: e.impact,
            step,
            minutes: Math.max(1, Math.round(minutes)),
            note: (w.week?.today?.news ?? []).find((n) => n.timeEt === e.timeEt)?.note?.trim() || null,
            actual: printed?.actual ?? null,
            vs: printed?.vs ?? null,
            tape,
            blackout: w.clock.blackout,
            vix: w.pulse.vix,
            held: w.book.positions.length > 0,
          }),
        commit: (s) => {
          s.calFired[key] = true;
        },
      });
    };
    if (e.impact === "high") {
      for (const step of TALK.calendarPre) {
        // Each step is a short window ending at the step itself: 60 → 52–60 min out, 5 → 2.5–5, 1 → 0–1.
        const lo = step >= 30 ? step - 8 : step <= 1 ? 0 : step - 2.5;
        if (minutes <= step && minutes > lo) mk(step, step === 60 ? 1 : 2, `${e.name} in ${Math.round(minutes)} min`);
      }
    }
    for (const step of TALK.calendarPost) {
      const since = -minutes;
      if (step === 0 && since >= 0 && since < 3) mk(0, 2, `${e.name} printed`);
      if (step === 5 && since >= 5 && since < 8 && e.impact === "high") mk(5, 1, `${e.name} +5 min`);
    }
  }
}

/* ── News ──────────────────────────────────────────────────────────────── */

const newsHash = (n: NewsLite): string => hash32(`${n.source}|${n.title}`).toString(36);

function newsCands(w: TalkWorld, st: TalkState, out: Cand[]) {
  if (!w.news.length) return;
  const now = w.nowMs;
  const ageOf = (n: NewsLite): number | null => (n.publishedMs != null ? Math.max(0, Math.round((now - n.publishedMs) / 60_000)) : null);
  const live = w.books.QQQ ?? w.books.SPY;
  const tapeSince = (ageMin: number | null) => {
    if (!live || !tapeLive(w) || ageMin == null || ageMin < 1 || ageMin > 10) return null;
    const m = moveOver(live.samples, now, live.px, ageMin * 60);
    return m ? { b: live, dir: (m.pts >= 0 ? 1 : -1) as 1 | -1, pts: Math.abs(m.pts), sec: m.sec, atrX: live.atr ? Math.abs(m.pts) / live.atr : null } : null;
  };
  const ids = (xs: NewsLite[]) => xs.map(newsHash);
  const markSeen = (s: TalkState, xs: NewsLite[]) => {
    s.newsSeen = [...new Set([...s.newsSeen, ...ids(xs)])].slice(-300);
  };

  if (!st.newsPrimed) {
    // First look. Only what is young enough to still be news is left to be announced; everything else is marked
    // seen now, so an old headline is never read out as if it had just landed. Older tier-1 items are summarised
    // once, as "catching up".
    const young = (n: NewsLite) => n.tier <= 2 && (ageOf(n) ?? 9999) <= TALK.news.firstLoadAgeMin;
    markSeen(st, w.news.filter((n) => !young(n)));
    st.newsPrimed = true;
    const older = w.news.filter((n) => n.tier === 1 && !young(n) && (ageOf(n) ?? 9999) <= 8 * 60);
    if (older.length) {
      st.newsCatch = ids(older);
      st.newsCatchAt = now;
    }
  }

  if (st.newsCatch.length && now - st.newsCatchAt <= 20 * 60_000) {
    const want = new Set(st.newsCatch);
    const older = w.news.filter((n) => want.has(newsHash(n)));
    if (older.length) {
      out.push({
        id: "news|catchup",
        kind: "news",
        topic: "news:catchup",
        urgency: 0,
        prio: 3,
        at: now,
        label: `catching up · ${older.length} tier-1`,
        build: (c) => V.exNewsCatchUp(c, older, 8),
        commit: (s) => {
          s.newsCatch = [];
        },
      });
    }
  } else if (st.newsCatch.length) st.newsCatch = [];

  const seen = new Set(st.newsSeen);
  const fresh = w.news.filter((n) => !seen.has(newsHash(n)));
  if (!fresh.length) return;
  // Tier 3 is never announced.
  markSeen(st, fresh.filter((n) => n.tier === 3));
  const t1 = fresh.filter((n) => n.tier === 1).sort((a, b) => (b.publishedMs ?? 0) - (a.publishedMs ?? 0));
  const t2 = fresh.filter((n) => n.tier === 2).sort((a, b) => (b.publishedMs ?? 0) - (a.publishedMs ?? 0));
  const top1 = t1[0];
  if (top1 && now - st.newsAt[1] >= TALK.news.tier1GapMs) {
    const age = ageOf(top1);
    out.push({
      id: `news|${newsHash(top1)}`,
      kind: "news",
      topic: `news:${newsHash(top1)}`,
      urgency: age != null && age <= TALK.news.breakingAgeMin ? 2 : 1,
      prio: 7,
      at: top1.publishedMs ?? now,
      label: `headline · ${top1.source} · tier 1`,
      build: (c) => V.exNews(c, { n: top1, ageMin: age, tape: tapeSince(age), vix: w.pulse.vix, tenYear: w.pulse.tenYear }),
      commit: (s) => {
        markSeen(s, [top1]);
        s.newsAt[1] = now;
      },
    });
  }
  if (t2.length && now - st.newsAt[2] >= TALK.news.tier2GapMs) {
    const single = t2.length === 1 ? t2[0]! : null;
    out.push({
      id: single ? `news|${newsHash(single)}` : `news|batch|${t2.length}|${newsHash(t2[0]!)}`,
      kind: "news",
      topic: single ? `news:${newsHash(single)}` : `news:batch:${newsHash(t2[0]!)}`,
      urgency: 0,
      prio: 4,
      at: t2[0]!.publishedMs ?? now,
      label: single ? `headline · ${single.source} · context` : `${t2.length} context headlines`,
      build: (c) =>
        single
          ? V.exNews(c, { n: single, ageMin: ageOf(single), tape: null, vix: w.pulse.vix, tenYear: w.pulse.tenYear })
          : V.exNewsBatch(c, t2),
      commit: (s) => {
        markSeen(s, t2);
        s.newsAt[2] = now;
      },
    });
  }
}

/* ── Levels ────────────────────────────────────────────────────────────── */

function levelCands(w: TalkWorld, st: TalkState, out: Cand[]) {
  if (!tapeLive(w)) return;
  const now = w.nowMs;
  const L = TALK.level;
  for (const u of UNDERLIERS) {
    const b = w.books[u];
    if (!b || !b.atr || b.atr <= 0 || b.samples.length < 5) continue;
    const atr = b.atr;
    const look = b.samples.filter((s) => s.t >= now - L.sweepLookbackSec * 1000);
    if (look.length < 3) continue;
    const first = look[0]!;
    let hi = look[0]!;
    let lo = look[0]!;
    for (const s of look) {
      if (s.px > hi.px) hi = s;
      if (s.px < lo.px) lo = s;
    }
    const through = Math.max(L.throughAtr * atr, 0.25);
    const back = Math.max(L.backInsideAtr * atr, 0.25);
    const card = cardIn(w, u);
    const held = heldIn(w, u);
    let approaches = 0;
    for (const lv of b.levels) {
      if (!lv.pool) continue;
      const kSweep = `${u}|${lv.name}|sweep`;
      const kApp = `${u}|${lv.name}|approach`;
      const kAcc = `${u}|${lv.name}|accept`;
      // A raid: through the pool, then back inside, with price on the pool's own side before the excursion.
      const swHigh = first.px < lv.price && hi.px >= lv.price + through && b.px <= lv.price - back;
      const swLow = first.px > lv.price && lo.px <= lv.price - through && b.px >= lv.price + back;
      if ((swHigh || swLow) && now - (st.levelAt[kSweep] ?? 0) >= L.cooldownMs) {
        const side = swHigh ? "high" : "low";
        const ext = swHigh ? hi : lo;
        const thr = swHigh ? hi.px - lv.price : lv.price - lo.px;
        out.push({
          id: `lvl|${kSweep}|${Math.round(ext.t / 1000)}`,
          kind: "level",
          topic: `level:${kSweep}`,
          urgency: card || held ? 2 : 1,
          prio: 8,
          at: ext.t,
          label: `${b.say} raided ${lv.name} ${lv.price >= 1000 ? Math.round(lv.price) : lv.price.toFixed(2)}`,
          build: (c) => V.exLevel(c, { b, lv, kind: "sweep", side, through: thr, agoSec: (now - ext.t) / 1000, card, held }),
          commit: (s) => {
            s.levelAt[kSweep] = now;
            s.raid[u] = { name: lv.name, at: now };
            s.tapeAt[`${u}|1`] = now;
            s.tapeAt[`${u}|-1`] = now;
            delete s.tapeSize[`${u}|1`];
            delete s.tapeSize[`${u}|-1`];
          },
        });
        continue;
      }
      // Acceptance: beyond the pool and holding, having crossed recently.
      const above = b.px >= lv.price + L.acceptAtr * atr;
      const below = b.px <= lv.price - L.acceptAtr * atr;
      if ((above || below) && now - (st.levelAt[kAcc] ?? 0) >= L.cooldownMs * 1.5) {
        const win = b.samples.filter((s) => s.t >= now - L.acceptSec * 1000);
        const span = win.length ? (now - win[0]!.t) / 1000 : 0;
        const holds = win.length >= 4 && span >= L.acceptSec * 0.8 && win.every((s) => (above ? s.px >= lv.price + 0.5 * L.acceptAtr * atr : s.px <= lv.price - 0.5 * L.acceptAtr * atr));
        const pre = b.samples.filter((s) => s.t >= now - (L.acceptSec + 300) * 1000 && s.t < now - L.acceptSec * 1000);
        const crossed = pre.some((s) => (above ? s.px < lv.price : s.px > lv.price));
        if (holds && crossed) {
          out.push({
            id: `lvl|${kAcc}|${Math.round(now / 60_000)}`,
            kind: "level",
            topic: `level:${kAcc}`,
            urgency: 1,
            prio: 6,
            at: now,
            label: `${b.say} accepted ${above ? "above" : "below"} ${lv.name}`,
            build: (c) => V.exLevel(c, { b, lv, kind: "accept", side: above ? "high" : "low", beyond: Math.abs(b.px - lv.price), holdSec: span, card, held }),
            commit: (s) => {
              s.levelAt[kAcc] = now;
            },
          });
          continue;
        }
      }
      // Approach: closing on a pool, inside 0.35 ATR but not yet there.
      const dist = Math.abs(b.px - lv.price);
      if (dist <= L.approachAtr * atr && dist > L.touchAtr * atr && approaches === 0) {
        const recentSweep = now - (st.levelAt[kSweep] ?? 0) < 10 * 60_000;
        const ago = moveOver(b.samples, now, b.px, 60);
        const was = ago ? Math.abs(b.px - ago.pts - lv.price) : null;
        const closing = was != null && was - dist >= 0.03 * atr;
        if (closing && !recentSweep && now - (st.levelAt[kApp] ?? 0) >= L.cooldownMs && now - (st.bookApproachAt[u] ?? 0) >= L.approachPerBookMs) {
          approaches++;
          out.push({
            id: `lvl|${kApp}|${Math.round(now / 60_000)}`,
            kind: "level",
            topic: `level:${kApp}`,
            urgency: 1,
            prio: 5,
            at: now,
            label: `${b.say} closing on ${lv.name}`,
            build: (c) => V.exLevel(c, { b, lv, kind: "approach", side: lv.price > b.px ? "high" : "low", dist, card, held }),
            commit: (s) => {
              s.levelAt[kApp] = now;
              s.bookApproachAt[u] = now;
            },
          });
        }
      }
    }
  }
}

/* ── Tape ──────────────────────────────────────────────────────────────── */

function tapeCands(w: TalkWorld, st: TalkState, out: Cand[]) {
  if (!tapeLive(w)) return;
  const now = w.nowMs;
  for (const u of UNDERLIERS) {
    const b = w.books[u];
    if (!b || b.samples.length < 3) continue;
    // Every window that clears its bar; the SHORTEST one that carries most of the largest move is how the room
    // says it ("+45 in a minute", not "+45 in three").
    const hits: { pts: number; sec: number; ratio: number }[] = [];
    for (const win of TALK.tapeWindows) {
      const m = moveOver(b.samples, now, b.px, win.sec);
      if (!m) continue;
      const thr = b.atr && b.atr > 0 ? win.atr * b.atr : (b.px * win.pct) / 100;
      const ratio = Math.abs(m.pts) / thr;
      if (ratio >= 1) hits.push({ pts: m.pts, sec: m.sec, ratio });
    }
    if (!hits.length) continue;
    const maxAbs = Math.max(...hits.map((h) => Math.abs(h.pts)));
    const best = hits.filter((h) => Math.abs(h.pts) >= 0.85 * maxAbs).sort((a, c) => a.sec - c.sec)[0]!;
    const dir: 1 | -1 = best.pts >= 0 ? 1 : -1;
    const key = `${u}|${dir}`;
    const absPts = Math.abs(best.pts);
    const atrX = b.atr && b.atr > 0 ? absPts / b.atr : null;
    const big = atrX != null ? atrX >= TALK.tapeBigAtr : best.ratio >= 2.5;
    const last = st.tapeSize[key];
    const sinceLast = now - (st.tapeAt[key] ?? 0);
    // A move that has since doubled (and is violent) is worth a second remark inside the cooldown.
    const again = sinceLast < TALK.tapeCooldownMs && last != null && absPts >= 2 * last && big && sinceLast >= 12_000;
    if (sinceLast < TALK.tapeCooldownMs && !again) continue;
    const held = heldIn(w, u);
    const card = cardIn(w, u);
    const raidRec = st.raid[u];
    const raid = raidRec && now - raidRec.at <= 10 * 60_000 ? { name: raidRec.name, agoSec: (now - raidRec.at) / 1000 } : null;
    const aligned = held ? (held.type === "CALL") === (dir > 0) : null;
    out.push({
      id: `tape|${u}|${dir}|${Math.round(now / 15_000)}${again ? "|again" : ""}`,
      kind: "tape",
      topic: `tape:${key}${again ? ":again" : ""}`,
      urgency: big ? 2 : 1,
      prio: big ? 7 : 4,
      at: now,
      label: `${b.say} ${dir > 0 ? "+" : "−"}${absPts >= 10 ? absPts.toFixed(0) : absPts.toFixed(1)} in ${Math.round(best.sec)} s${atrX != null ? ` · ${atrX.toFixed(2)}× ATR` : ""}${again ? " · still going" : ""}`,
      build: (c) =>
        V.exTape(c, {
          b,
          dir,
          pts: absPts,
          sec: best.sec,
          atrX,
          big,
          again,
          nearest: nearestPool(b, dir),
          raid,
          held,
          heldAligned: aligned,
          heldStopDist: held?.plan ? Math.abs(b.px - held.plan.stop) : null,
          card,
          lagSec: w.feed.lagSec,
          deltaUsd: etfUsd(absPts, b.perEtfPt),
          atrUsd: b.atr ? etfUsd(b.atr, b.perEtfPt) : null,
        }),
      commit: (s) => {
        s.tapeAt[key] = now;
        s.tapeSize[key] = absPts;
      },
    });
  }
}

/* ── The book and the card ─────────────────────────────────────────────── */

function bookCands(w: TalkWorld, st: TalkState, out: Cand[], announceNew = false) {
  const now = w.nowMs;
  const live = tapeLive(w);
  for (const p of w.book.positions) {
    const step = Math.trunc(p.pnlPct / 10);
    const prev = st.pnlStep[p.id];
    if (prev === undefined) {
      if (announceNew)
        out.push({
          id: `open|${p.id}`,
          kind: "book",
          topic: `book:open:${p.id}`,
          urgency: 2,
          prio: 12,
          at: now,
          label: `in · ${p.name}`,
          build: (c) => V.exFill(c, { p, b: w.books[p.u] }),
          commit: (s) => {
            s.pnlStep[p.id] = step;
          },
        });
      else st.pnlStep[p.id] = step;
    } else if (step !== prev && Math.abs(step) >= 1 && now - (st.nearFired[`pnl|${p.id}`] ?? 0) >= 60_000) {
      const b = w.books[p.u];
      out.push({
        id: `pnl|${p.id}|${step}`,
        kind: "book",
        topic: `book:pnl:${p.id}:${step}`,
        urgency: 1,
        prio: 6,
        at: now,
        label: `${p.name} ${p.pnlPct >= 0 ? "+" : "−"}${Math.abs(p.pnlPct).toFixed(0)}%`,
        build: (c) => V.exPnl(c, { p, b, up: p.pnlPct >= 0 }),
        commit: (s) => {
          s.pnlStep[p.id] = step;
          s.nearFired[`pnl|${p.id}`] = now;
        },
      });
    } else if (step !== prev) st.pnlStep[p.id] = step;
    // Near the level (stop) or the target.
    const b = w.books[p.u];
    if (live && b && b.atr && p.plan) {
      const checks: { which: "stop" | "t1"; level: number | null }[] = [
        { which: "stop", level: p.plan.stop },
        { which: "t1", level: p.plan.t1 },
      ];
      for (const { which, level } of checks) {
        if (level == null) continue;
        const long = p.plan.side === "long";
        const toward = which === "stop" ? (long ? b.px - level : level - b.px) : long ? level - b.px : b.px - level;
        if (toward <= 0) continue;
        if (toward > 0.3 * b.atr) continue;
        const key = `near|${p.id}|${which}`;
        if (now - (st.nearFired[key] ?? 0) < 3 * 60_000) continue;
        out.push({
          id: `${key}|${Math.round(now / 60_000)}`,
          kind: "book",
          topic: `book:${key}`,
          urgency: 2,
          prio: 9,
          at: now,
          label: `${b.say} ${toward.toFixed(1)} pts from ${which === "stop" ? "the level" : "T1"} on ${p.name}`,
          build: (c) => V.exNear(c, { p, b, which, dist: toward, level }),
          commit: (s) => {
            s.nearFired[key] = now;
          },
        });
      }
    }
  }
  // The card, the moment it appears or changes. First sight is news, not a silent note.
  const card = w.card;
  if (card) {
    const to = `${card.tier ?? "board"}|${card.band ?? ""}|${card.verdict}`;
    const prev = st.tier[card.key];
    if (prev !== to) {
      const from = prev == null ? null : prev.split("|")[0]!;
      out.push({
        id: `tier|${card.key}|${to}`,
        kind: "card",
        topic: `card:${card.key}`,
        urgency: 2,
        prio: 10,
        at: now,
        label: prev == null ? `${card.name} is on the board` : `${card.name} ${from} → ${card.tier ?? "board"}`,
        build: (c) => V.exTier(c, { card, from, to: card.tier ?? "board", b: w.books[card.u] }),
        commit: (s) => {
          s.tier[card.key] = to;
        },
      });
    }
  }
  // A ghost closing: the refused tickets' running result.
  const total = (w.lab?.refusals ?? []).reduce((a, r) => a + r.n, 0);
  if (st.ghostN === 0 && total > 0 && !st.primed) st.ghostN = total;
  else if (total > st.ghostN && w.lab) {
    const g = [...w.lab.refusals].sort((a, b) => b.n - a.n)[0];
    if (g)
      out.push({
        id: `ghost|${total}`,
        kind: "book",
        topic: `book:ghost:${total}`,
        urgency: 1,
        prio: 5,
        at: now,
        label: `ghost room · ${g.gate} ${g.n} closed`,
        build: (c) => V.exGhost(c, { gate: g.gate, n: g.n, usd: g.pnlUsd, wins: g.wins }),
        commit: (s) => {
          s.ghostN = total;
        },
      });
  } else if (total < st.ghostN) st.ghostN = total;
}

/* ── Pulse ─────────────────────────────────────────────────────────────── */

function pulseCands(w: TalkWorld, st: TalkState, out: Cand[]) {
  const { vix, tenYear, at } = w.pulse;
  if (at == null || (vix == null && tenYear == null)) return;
  const p = st.pulse;
  if (p.baseAt === 0) {
    p.vix = vix;
    p.tenYear = tenYear;
    p.baseAt = w.nowMs;
    return;
  }
  const vixMove = vix != null && p.vix != null ? vix - p.vix : 0;
  const tenMove = tenYear != null && p.tenYear != null ? tenYear - p.tenYear : 0;
  const vixHit = Math.abs(vixMove) >= TALK.pulse.vixPts;
  const tenHit = Math.abs(tenMove) >= TALK.pulse.tenYearPct;
  if ((vixHit || tenHit) && w.nowMs - p.baseAt >= 60_000) {
    out.push({
      id: `pulse|${Math.round(w.nowMs / 60_000)}`,
      kind: "pulse",
      topic: "pulse",
      urgency: 1,
      prio: 5,
      at: w.nowMs,
      label: `${vixHit ? `VIX ${p.vix!.toFixed(1)} → ${vix!.toFixed(1)}` : ""}${vixHit && tenHit ? " · " : ""}${tenHit ? `10y ${p.tenYear!.toFixed(2)} → ${tenYear!.toFixed(2)}` : ""}`,
      build: (c) =>
        V.exPulse(c, {
          vix: vixHit ? { from: p.vix!, to: vix! } : null,
          tenYear: tenHit ? { from: p.tenYear!, to: tenYear! } : null,
        }),
      commit: (s) => {
        s.pulse = { vix, tenYear, baseAt: w.nowMs };
      },
    });
  } else if (w.nowMs - p.baseAt >= TALK.pulse.gapMs) {
    p.vix = vix;
    p.tenYear = tenYear;
    p.baseAt = w.nowMs;
  }
}

/* ── The race: the seats' tickets, the goal's council, the R&D's verdicts ── */

/** A seat event older than this is history, not news: a tab opened after it marks it seen without remark. */
const SEAT_FRESH_MS = 4 * 60_000;

function seatCands(w: TalkWorld, st: TalkState, out: Cand[]) {
  const s = w.seats;
  if (!s) return;
  if (!st.seatPrimed) {
    st.seatPrimed = true;
    st.seatSeen = s.events.map((e) => e.id);
    return;
  }
  const seen = new Set(st.seatSeen);
  const unseen = s.events.filter((e) => !seen.has(e.id));
  if (!unseen.length) return;
  const old = unseen.filter((e) => w.nowMs - e.at > SEAT_FRESH_MS);
  if (old.length) st.seatSeen = [...st.seatSeen, ...old.map((e) => e.id)].slice(-300);
  const fresh = unseen.filter((e) => w.nowMs - e.at <= SEAT_FRESH_MS).sort((a, b) => a.at - b.at);
  const mark = (ids: string[]) => (t: TalkState) => {
    t.seatSeen = [...t.seatSeen, ...ids].slice(-300);
  };
  const tickets = s.rows.reduce((a, r) => a + r.taken.n, 0);
  const rowOf = (id: string | null) => s.rows.find((r) => r.id === id) ?? null;
  const byCycle = new Map<number, SeatEventLite[]>();
  for (const e of fresh) byCycle.set(e.at, [...(byCycle.get(e.at) ?? []), e]);
  for (const [at, evs] of byCycle) {
    const of = (k: SeatEventLite["kind"]) => evs.filter((e) => e.kind === k);
    const opens = of("open");
    const skips = of("skip");
    const blockedEvs = of("blocked");
    const syn = of("syndicate")[0] ?? null;
    if (opens.length || skips.length || blockedEvs.length || syn) {
      const groups = new Map<string, { gate: string | null; why: string | null; seats: string[] }>();
      for (const b of blockedEvs) {
        const key = `${b.gate}|${b.why}`;
        const gset = groups.get(key) ?? { gate: b.gate, why: b.why, seats: [] };
        gset.seats.push(b.seat ?? "");
        groups.set(key, gset);
      }
      const quiet = !opens.length && !syn;
      const names = [...opens, ...skips].map((e) => e.seat).filter(Boolean).length;
      out.push({
        id: `seat|touch|${at}`,
        kind: "seat",
        topic: `seat:touch:${at}`,
        urgency: quiet ? 0 : 1,
        prio: quiet ? 3 : 7,
        at,
        label: opens.length ? `${opens.length} ticket${opens.length === 1 ? "" : "s"} opened at the touch${syn ? ` · ${syn.n ?? ""} on one card` : ""}` : `${names + blockedEvs.length} seats looked at the card`,
        build: (c) => R.exTouchRound(c, { opens, skips, blocked: [...groups.values()], syndicate: syn, goal: w.goal }),
        commit: mark([...opens, ...skips, ...blockedEvs, ...(syn ? [syn] : [])].map((e) => e.id)),
      });
    }
    for (const e of of("close")) {
      const rank = Math.max(1, s.rows.findIndex((r) => r.id === e.seat) + 1);
      out.push({
        id: `seat|${e.id}`,
        kind: "seat",
        topic: `seat:close:${e.id}`,
        urgency: 1,
        prio: 6,
        at,
        label: `${e.seat ?? "a seat"} closed ${(e.usd ?? 0) >= 0 ? "+" : "−"}$${Math.abs(Math.round(e.usd ?? 0))}`,
        build: (c) => R.exSeatClose(c, { ev: e, row: rowOf(e.seat), rank, of: s.rows.length, goal: w.goal }),
        commit: mark([e.id]),
      });
    }
    for (const e of of("lead")) {
      out.push({
        id: `seat|${e.id}`,
        kind: "seat",
        topic: `seat:lead:${e.id}`,
        urgency: 1,
        prio: 5,
        at,
        label: `${e.seat ?? "a seat"} takes the lead`,
        build: (c) => R.exLead(c, { seat: e.seat ?? "", equity: e.equity ?? 0, margin: e.usd ?? 0, tickets, goal: w.goal }),
        commit: mark([e.id]),
      });
    }
    for (const e of of("finish")) {
      out.push({
        id: `seat|${e.id}`,
        kind: "seat",
        topic: `seat:finish:${e.id}`,
        urgency: 2,
        prio: 9,
        at,
        label: `${e.seat ?? "a seat"} ${e.why === "hit" ? "reached the goal" : "reached the floor"}`,
        build: (c) => R.exFinish(c, { seat: e.seat ?? "", hit: e.why === "hit", equity: e.equity ?? 0, goal: w.goal }),
        commit: mark([e.id]),
      });
    }
    for (const e of of("syndicate_closed")) {
      out.push({
        id: `seat|${e.id}`,
        kind: "seat",
        topic: `seat:syn:${e.id}`,
        urgency: 1,
        prio: 4,
        at,
        label: `syndicate closed ${(e.usd ?? 0) >= 0 ? "+" : "−"}$${Math.abs(Math.round(e.usd ?? 0))}`,
        build: (c) => R.exSyndicateClosed(c, { members: e.members ?? [], usd: e.usd ?? 0, dissentUsd: null }),
        commit: mark([e.id]),
      });
    }
    // Events nobody speaks about (the start marker) are marked seen with the rest.
    const spoken = new Set(["open", "skip", "blocked", "syndicate", "close", "lead", "finish", "syndicate_closed"]);
    const silent = evs.filter((e) => !spoken.has(e.kind));
    if (silent.length) st.seatSeen = [...st.seatSeen, ...silent.map((e) => e.id)].slice(-300);
  }
}

function goalCands(w: TalkWorld, st: TalkState, out: Cand[]) {
  const g = w.goal;
  if (!g) return;
  const k = w.clock;
  const day = k.etDate;
  const trading = k.isWeekday && !k.holiday;
  const sig = (key: string) => st.goalSig[key];
  if (g.status === "hit" || g.status === "floor" || g.status === "expired") {
    const key = `final|${g.status}`;
    if (!sig(key) && w.seats) {
      out.push({
        id: `goal|${key}`,
        kind: "goal",
        topic: `goal:${key}`,
        urgency: 2,
        prio: 9,
        at: w.nowMs,
        label: `the window is over · ${g.status}`,
        build: (c) => R.exGoalFinal(c, { g, rows: w.seats!.rows }),
        commit: (s) => {
          s.goalSig[key] = "1";
        },
      });
    }
    return;
  }
  // The council: once each trading morning, before the 11:00 flat.
  if (trading && k.etMin >= 8 * 60 + 30 && k.etMin < ROOM_CLOCK.dayFlatMin && !sig(`council|${day}`)) {
    const pending = g.collisions.find((x) => x.ask && x.severity !== "info") ?? null;
    out.push({
      id: `goal|council|${day}`,
      kind: "goal",
      topic: `goal:council:${day}`,
      urgency: 1,
      prio: 7,
      at: w.nowMs,
      label: g.status === "before" ? "the council · planning ahead of the window" : `the council · day ${g.day} of ${g.of}`,
      build: (c) => R.exCouncil(c, { g, weekTrade: w.week?.today?.trade ?? null, b: w.books.QQQ ?? w.books.SPY }),
      commit: (s) => {
        s.goalSig[`council|${day}`] = "1";
        if (pending) s.goalSig[`decision|${day}|${pending.id}`] = "1";
      },
    });
  }
  // The pace against the path: said when it changes side, and not more than every twenty minutes.
  if (g.status === "running" && g.paceLabel) {
    const prev = sig("pace");
    if (prev === undefined) st.goalSig["pace"] = g.paceLabel;
    else if (prev !== g.paceLabel && w.nowMs - Number(sig("paceAt") ?? 0) >= 20 * 60_000 && trading) {
      out.push({
        id: `goal|pace|${g.paceLabel}|${Math.round(w.nowMs / 60_000)}`,
        kind: "goal",
        topic: `goal:pace:${g.paceLabel}`,
        urgency: 1,
        prio: 5,
        at: w.nowMs,
        label: `pace · ${prev} → ${g.paceLabel}`,
        build: (c) => R.exPace(c, { g, from: prev }),
        commit: (s) => {
          s.goalSig["pace"] = g.paceLabel!;
          s.goalSig["paceAt"] = String(w.nowMs);
        },
      });
    } else if (prev !== g.paceLabel && w.nowMs - Number(sig("paceAt") ?? 0) >= 20 * 60_000) st.goalSig["pace"] = g.paceLabel;
  }
  // Entries are over for the day: re-plan out loud, once.
  if (g.status === "running" && g.entriesOver && trading && k.etMin >= ROOM_CLOCK.dayFlatMin && k.etMin < ROOM_CLOCK.optionsCloseMin && g.day >= 1 && !sig(`replan|${day}`)) {
    out.push({
      id: `goal|replan|${day}`,
      kind: "goal",
      topic: `goal:replan:${day}`,
      urgency: 1,
      prio: 6,
      at: w.nowMs,
      label: `re-plan · ${g.daysLeft} session${g.daysLeft === 1 ? "" : "s"} left`,
      build: (c) => R.exReplan(c, { g }),
      commit: (s) => {
        s.goalSig[`replan|${day}`] = "1";
      },
    });
  }
  // A card has the ladder priced on it.
  const card = w.card;
  if (card && (card.tier === "armed" || card.tier === "live") && g.ladder.priced && g.ladder.best && !sig(`ladder|${card.key}`)) {
    out.push({
      id: `goal|ladder|${card.key}`,
      kind: "goal",
      topic: `goal:ladder:${card.key}`,
      urgency: 1,
      prio: 6,
      at: w.nowMs,
      label: `the ladder priced on ${card.name}`,
      build: (c) => R.exLadderCard(c, { g, card }),
      commit: (s) => {
        s.goalSig[`ladder|${card.key}`] = "1";
      },
    });
  }
  // A call that is the trader's: said once a day each, after the council has had its turn.
  if (sig(`council|${day}`) || !trading) {
    const col = g.collisions.find((x) => x.ask && x.severity !== "info" && !sig(`decision|${day}|${x.id}`));
    if (col) {
      out.push({
        id: `goal|decision|${day}|${col.id}`,
        kind: "goal",
        topic: `goal:decision:${col.id}`,
        urgency: 0,
        prio: 4,
        at: w.nowMs,
        label: `a call that's the trader's · ${col.id.replace("_", " ")}`,
        build: (c) => R.exDecision(c, { col }),
        commit: (s) => {
          s.goalSig[`decision|${day}|${col.id}`] = "1";
        },
      });
    }
  }
}

function rndCands(w: TalkWorld, st: TalkState, out: Cand[]) {
  const r = w.rnd;
  if (!r) return;
  if (!st.rndPrimed) {
    st.rndPrimed = true;
    for (const e of r.experiments) st.rndSeen[e.id] = e.status;
    return;
  }
  for (const e of r.experiments) {
    const prev = st.rndSeen[e.id];
    if (prev === undefined || e.status === "collecting") {
      st.rndSeen[e.id] = e.status;
      continue;
    }
    if (prev === e.status) continue;
    out.push({
      id: `rnd|${e.id}|${e.status}`,
      kind: "rnd",
      topic: `rnd:${e.id}:${e.status}`,
      urgency: 1,
      prio: 5,
      at: w.nowMs,
      label: `${e.owner}'s experiment · ${e.status.replace("_", " ")}`,
      build: (c) => R.exRndVerdict(c, { exp: e }),
      commit: (s) => {
        s.rndSeen[e.id] = e.status;
      },
    });
  }
}

/* ── The investment office ─────────────────────────────────────────────── */

/*
 * The long game's own talk, held to the same rules as the rest of the room: it speaks when the data gives it something
 * to say and not otherwise. The funnel once a day, the book when its numbers moved, a theme of the day with a second look,
 * a headline that touches a name the office watches, and the board's evening agenda. All of it is chatter (urgency 0)
 * except a headline about a name the book HOLDS (urgency 1). None of it runs inside the NY AM live window — the desk's
 * morning is the futures book's — and none of it ever sizes, buys or sells anything.
 */
const INV_LIVE_FROM_MIN = 9 * 60 + 25;
const INV_LIVE_TO_MIN = 11 * 60 + 15;
const INV_BOOK_GAP_MS = 3 * 3_600_000;
const INV_NEWS_GAP_MS = 45 * 60_000;
const INV_NEWS_MAX_AGE_MS = 20 * 3_600_000;
/** On the first look a headline older than this is context already seen, not something to announce. */
const INV_PRIME_AGE_MS = 90 * 60_000;
/** The earnings calendar is a committed snapshot; older than this it would be a guess and the office says nothing from it. */

function investCands(w: TalkWorld, st: TalkState, out: Cand[]) {
  const inv = w.invest;
  if (!inv) return;
  const now = w.nowMs;
  const day = w.clock.etDate;
  const m = w.clock.etMin;
  const trading = w.clock.isWeekday && !w.clock.holiday;
  if (trading && m >= INV_LIVE_FROM_MIN && m < INV_LIVE_TO_MIN) return;

  // A headline that touches the book, a theme's vehicles or a competitor on the research list.
  if (!st.topicAt["invest:primed"]) {
    st.topicAt["invest:primed"] = now;
    for (const n of w.news) {
      const age = n.publishedMs != null ? now - n.publishedMs : Infinity;
      if (age > INV_PRIME_AGE_MS && watchHit(inv, n.title, n.tickers)) st.topicAt[`invest:news:${newsHash(n)}`] = now;
    }
  }
  if (now - (st.topicAt["invest:newsfam"] ?? 0) >= INV_NEWS_GAP_MS) {
    let best: { n: NewsLite; hit: WatchHit; topic: string; score: number } | null = null;
    for (const n of w.news) {
      const topic = `invest:news:${newsHash(n)}`;
      if (st.topicAt[topic] != null || n.publishedMs == null || now - n.publishedMs > INV_NEWS_MAX_AGE_MS) continue;
      const hit = watchHit(inv, n.title, n.tickers);
      if (!hit) continue;
      const score = (hit.kind === "held" ? 2 : hit.kind === "theme" ? 1 : 0) * 1e13 + n.publishedMs;
      if (!best || score > best.score) best = { n, hit, topic, score };
    }
    if (best) {
      const { n, hit, topic } = best;
      out.push({
        id: `invest|news|${newsHash(n)}`,
        kind: "invest",
        topic,
        urgency: hit.kind === "held" ? 1 : 0,
        prio: 4,
        at: n.publishedMs ?? now,
        label: `the office's headline · ${hit.label}`,
        build: (c) => IV.exInvNews(c, { inv, n, hit }),
        commit: (s) => {
          s.topicAt["invest:newsfam"] = now;
        },
      });
    }
  }

  // The funnel: day-trading income and the other income, into the long book. Once a day, after the live window.
  const fTopic = `invest:funnel:${day}`;
  if (m >= (trading ? 11 * 60 + 30 : 9 * 60 + 30) && st.topicAt[fTopic] == null) {
    out.push({
      id: `invest|funnel|${day}`,
      kind: "invest",
      topic: fTopic,
      urgency: 0,
      prio: 3,
      at: now,
      label: "the funnel · income into the long book",
      build: (c) => IV.exInvFunnel(c, { inv }),
      commit: () => {},
    });
  }

  // The calendar: reports in the next two weeks that touch a name we hold or compete with. Once a day, mid-afternoon, and only
  // while the committed calendar is fresh enough to say anything from.
  const cTopic = `invest:catalyst:${day}`;
  if (freshCatalysts(inv).length && m >= (trading ? 13 * 60 + 30 : 11 * 60) && st.topicAt[cTopic] == null) {
    out.push({
      id: `invest|catalyst|${day}`,
      kind: "invest",
      topic: cTopic,
      urgency: 0,
      prio: 3,
      at: now,
      label: "the calendar · reports that touch the book and the list",
      build: (c) => IV.exInvCatalysts(c, { inv }),
      commit: () => {},
    });
  }

  // The book: when its numbers moved (or never said), not on a timer.
  const bookSig = [inv.book.positions, Math.round(inv.book.totalUsd), inv.book.beyondBand, Math.round(inv.funnel.waitingUsd), inv.book.sleeves.map((x) => Math.round(x.weight * 100)).join("/")].join("|");
  const bTopic = "invest:book";
  const bNever = st.topicAt[bTopic] == null;
  if (m >= (trading ? 12 * 60 : 10 * 60) && (bNever || (st.topicSig[bTopic] !== bookSig && now - (st.topicAt[bTopic] ?? 0) >= INV_BOOK_GAP_MS))) {
    out.push({
      id: `invest|book|${bookSig}`,
      kind: "invest",
      topic: bTopic,
      urgency: 0,
      prio: 3,
      at: now,
      label: "the long book · sleeves and research coverage",
      build: (c) => IV.exInvBook(c, { inv }),
      commit: (s) => {
        s.topicSig[bTopic] = bookSig;
      },
    });
  }

  // The theme of the day, and a second look later. Only the latest look that is due is a candidate, so a late load says one.
  const looks = investLooks(w.clock.isWeekday);
  for (let k = looks.length - 1; k >= 0; k--) {
    if (m < looks[k]!) continue;
    const tTopic = `invest:theme:${day}:${k}`;
    const theme = themeOfTheDay(inv, k);
    if (theme && st.topicAt[tTopic] == null) {
      out.push({
        id: `invest|theme|${day}|${k}|${theme.id}`,
        kind: "invest",
        topic: tTopic,
        urgency: 0,
        prio: 2,
        at: now,
        label: `theme of the day · ${theme.name}`,
        build: (c) => IV.exInvTheme(c, { inv, theme }),
        commit: () => {},
      });
    }
    break;
  }

  // The board: the evening agenda after the close (30 minutes after the options close), or mid-morning on a weekend.
  const dTopic = `invest:board:${day}`;
  if (m >= (trading ? ROOM_CLOCK.optionsCloseMin + 30 : 10 * 60) && st.topicAt[dTopic] == null) {
    out.push({
      id: `invest|board|${day}`,
      kind: "invest",
      topic: dTopic,
      urgency: 0,
      prio: 2,
      at: now,
      label: "the board · agenda and minutes",
      build: (c) => IV.exInvBoard(c, { inv }),
      commit: () => {},
    });
  }
}

/* ── Heartbeats ────────────────────────────────────────────────────────── */

interface Hb {
  id: string;
  weight: number;
  sig: string;
  build: (c: V.Ctx) => V.Ex | null;
}

function heartbeats(w: TalkWorld, st: TalkState): Hb[] {
  const out: Hb[] = [];
  const day = w.clock.optionsOpen;
  const live = tapeLive(w);
  const f = (a: number, b: number) => (day ? a : b);
  for (const u of UNDERLIERS) {
    const b = w.books[u];
    if (!b || !live) continue;
    if (b.rangeUsedPct != null && b.rangeUsedPct > 0) {
      const used = b.rangeUsedPct;
      out.push({ id: `range:${u}`, weight: f(1.0, 0.6), sig: `${Math.floor(used / 12)}`, build: (c) => V.exRange(c, { b, usedPct: used }) });
    }
    const hiL = b.levels.find((l) => l.name === "Range high");
    const loL = b.levels.find((l) => l.name === "Range low");
    if (hiL && loL && hiL.price > loL.price) {
      const pos = ((b.px - loL.price) / (hiL.price - loL.price)) * 100;
      if (pos >= -10 && pos <= 110) {
        const zone = pos > 55 ? "premium" : pos < 45 ? "discount" : "equilibrium";
        out.push({
          id: `dealing:${u}`,
          weight: f(1.1, 0.5),
          sig: `${zone}`,
          build: (c) => V.exDealing(c, { b, posPct: Math.max(0, Math.min(100, pos)), zone, low: loL.price, high: hiL.price }),
        });
      }
    }
    if (b.draw) {
      const d = b.draw;
      const dist = Math.abs(d.price - b.px);
      out.push({
        id: `draw:${u}`,
        weight: f(1.0, 0.5),
        sig: `${d.name}|${Math.floor(dist / Math.max(1, (b.atr ?? 10) * 0.5))}`,
        build: (c) => V.exDraw(c, { b, name: d.name, price: d.price, dist, side: d.price >= b.px ? "above" : "below" }),
      });
    }
    if (b.smcWord) {
      out.push({ id: `htf:${u}`, weight: f(1.0, 0.4), sig: `${b.htf}|${b.smcWord}|${b.smcMissing ?? ""}`, build: (c) => V.exHtf(c, { b }) });
    }
    if (b.prevClose != null && b.atr) {
      const pts = b.px - b.prevClose;
      if (Math.abs(pts) >= 0.15 * b.atr) {
        out.push({ id: `gap:${u}`, weight: f(0.7, 0.5), sig: `${Math.sign(pts)}|${Math.floor(Math.abs(pts) / b.atr)}`, build: (c) => V.exGap(c, { b, pts, prev: b.prevClose! }) });
      }
    }
    if (b.volRatio != null && b.volRatio > 0 && (b.volRatio >= 1.3 || b.volRatio <= 0.6)) {
      out.push({ id: `vol:${u}`, weight: f(0.8, 0.3), sig: `${b.volRatio >= 1.3 ? "hot" : "thin"}`, build: (c) => V.exVol(c, { b, ratio: b.volRatio! }) });
    }
  }
  const nq = w.books.QQQ;
  const es = w.books.SPY;
  if (live && nq && es && nq.changePct != null && es.changePct != null && Math.abs(nq.changePct - es.changePct) >= 0.1) {
    const leader = nq.changePct > es.changePct ? "NQ" : "ES";
    out.push({
      id: "smt",
      weight: f(1.0, 0.5),
      sig: `${leader}|${Math.floor(Math.abs(nq.changePct - es.changePct) * 10)}`,
      build: (c) => V.exSmt(c, { nq, es, leader, nqPct: nq.changePct!, esPct: es.changePct! }),
    });
  }
  const card = w.card;
  if (card && live && card.verdict !== "STAND") {
    out.push({ id: "board", weight: f(1.4, 0.5), sig: `${card.key}|${card.tier ?? ""}|${card.block ?? ""}`, build: (c) => V.exBoard(c, { card }) });
  }
  const today = w.week?.today;
  if (today && today.trade) {
    out.push({ id: "week", weight: f(0.9, 0.9), sig: today.date, build: (c) => V.exWeek(c, { trade: today.trade, skipIf: today.skipIf, kind: today.kind }) });
  }
  out.push({
    id: "rules",
    weight: f(0.9, 0.6),
    sig: `${w.book.monthEntries}|${w.book.consecLosses}|${Math.round(w.book.dayPnl)}|${w.book.positions.length}`,
    build: (c) => V.exRules(c, { monthEntries: w.book.monthEntries, consecLosses: w.book.consecLosses, dayPnl: w.book.dayPnl, positions: w.book.positions.length }),
  });
  if (w.lab && ((w.lab.calibration && w.lab.calibration.n >= 1) || w.lab.twins.n >= 1 || w.lab.refusals.length)) {
    const lab = w.lab;
    out.push({
      id: "lab",
      weight: f(0.8, 1.0),
      sig: `${lab.calibration?.n ?? 0}|${lab.twins.n}|${lab.refusals.reduce((a, r) => a + r.n, 0)}`,
      build: (c) => V.exLab(c, { cal: lab.calibration, twins: lab.twins, refusals: { n: lab.refusals.reduce((a, r) => a + r.n, 0), pnlUsd: lab.refusals.reduce((a, r) => a + r.pnlUsd, 0) } }),
    });
  }
  // The race: the standings, the price list when no card can price it, each person's experiment.
  if (w.seats && w.goal && (w.goal.status === "running" || w.goal.status === "before")) {
    const rows = w.seats.rows;
    const tickets = rows.reduce((a, r) => a + r.taken.n, 0);
    out.push({
      id: "league",
      weight: f(1.0, 0.7),
      sig: rows.map((r) => `${r.id}:${Math.round(r.equity)}`).join("|"),
      build: (c) => R.exLeagueTable(c, { rows, goal: w.goal, tickets }),
    });
    if (w.goal.ladder.n > 0 && !w.goal.ladder.priced) {
      const l = w.goal.ladder;
      out.push({ id: "ladder", weight: f(0.8, 0.6), sig: `${l.n}|${Math.round(l.cheapestUsd ?? 0)}|${Math.round(l.richestUsd ?? 0)}`, build: (c) => R.exLadderPlain(c, { g: w.goal! }) });
    }
    if (!day && w.week?.next) {
      out.push({ id: "goalnight", weight: 1.2, sig: `${w.clock.etDate}|${w.goal.daysLeft}`, build: (c) => R.exGoalNight(c, { g: w.goal!, next: w.week!.next }) });
    }
  }
  if (w.rnd) {
    for (const e of w.rnd.experiments) {
      out.push({ id: `rnd:${e.id}`, weight: 0.7, sig: `${e.status}|${e.n}`, build: (c) => R.exRndStandup(c, { exp: e }) });
    }
  }
  // What the five find wrong with the desk (audit.ts): one finding at a time, in turn, from the office it belongs to.
  const audit = deskAudit({ feed: w.feed, goal: w.goal, lab: w.lab, rnd: w.rnd, seats: w.seats, fresh: w.fresh ?? null });
  if (audit.length) {
    const it = audit[(st.variant["audit.idx"] ?? 0) % audit.length]!;
    out.push({ id: `audit:${it.id}`, weight: 0.9, sig: `${it.id}|${it.evidence}`, build: (c) => R.exAudit(c, { item: it }) });
  }
  // A call somebody made earlier, now scored — each one is brought up once.
  const mem = w.minds?.memories.find((m) => m.outcome != null && !st.memSaid.includes(`${m.clock}|${m.text}|${m.outcome}`));
  if (mem) {
    out.push({
      id: "memory",
      weight: f(0.9, 0.9),
      sig: `${mem.clock}|${mem.text}|${mem.outcome}`,
      build: (c) => V.exMemory(c, { who: mem.who, against: mem.against, clock: mem.clock, text: mem.text, verdict: mem.outcome, movePct: null, usd: null }),
    });
  }
  // Somebody's mood.
  if (w.minds) {
    const order: Character[] = ["Jax", "Nova", "Gemma", "Vince", "Sterling"];
    const need = (ch: Character): "caffeine" | "fatigue" | "stress" | "loneliness" | "boredom" | null => {
      const n = w.minds!.needs[ch];
      if (n.caffeine <= 0.2) return "caffeine";
      if (n.stress >= 0.75) return "stress";
      if (n.fatigue >= 0.8) return "fatigue";
      if (n.boredom >= 0.8) return "boredom";
      if (n.loneliness >= 0.8) return "loneliness";
      return null;
    };
    for (const ch of order) {
      const nd = need(ch);
      if (nd) {
        out.push({ id: `mood:${ch}`, weight: 0.8, sig: `${ch}|${nd}`, build: (c) => V.exMood(c, { who: ch, need: nd }) });
        break;
      }
    }
  }
  // A measured finding, rotating through the pack: the night shift's reading list, and day chatter in a lull.
  if (w.evidence.length) {
    const idx = (st.variant["evid.idx"] ?? 0) % w.evidence.length;
    out.push({ id: "evidence", weight: f(0.5, 1.1), sig: `${idx}`, build: (c) => V.exEvidence(c, { text: w.evidence[idx]! }) });
  }
  if (live) {
    const missing = UNDERLIERS.map((u) => w.books[u]?.smcMissing).find((m) => m && m.trim()) ?? null;
    const openExp = (w.rnd?.experiments ?? []).filter((e) => e.status === "collecting" && e.nNeeded > 0);
    const experiment = openExp.slice().sort((a, b) => b.n / b.nNeeded - a.n / a.nNeeded)[0] ?? null;
    const seated = w.seats?.rows.find((r) => r.status !== "running")?.name ?? null;
    const jaxWrong = w.minds?.memories.some((m) => m.who === "Jax" && m.kind === "chase_call" && m.outcome === "wrong") ?? false;
    const cost = (w.lab?.refusals ?? []).filter((r) => r.pnlUsd > 0).sort((a, b) => b.pnlUsd - a.pnlUsd)[0] ?? null;
    const stamp = w.feed.lagSec != null && w.feed.lagSec > EXEC_LIMITS.maxFeedLagSec ? "TAPE" : null;
    out.push({
      id: "huddle",
      weight: f(1.05, 0.7),
      sig: `${missing ?? ""}|${experiment?.id ?? ""}|${experiment?.n ?? 0}|${w.seats?.leader ?? ""}|${jaxWrong ? 1 : 0}|${stamp ?? ""}|${cost?.gate ?? ""}`,
      build: (c) =>
        V.exHuddle(c, {
          missing,
          experiment: experiment ? { owner: experiment.owner, title: experiment.title, n: experiment.n, nNeeded: experiment.nNeeded } : null,
          leader: w.seats?.leader ?? null,
          seated,
          jaxWrong,
          stamp,
          costGate: cost?.gate ?? null,
        }),
    });
  }
  // Off hours: tomorrow, the overnight range, the day's recap.
  if (!day) {
    const nx = w.week?.next;
    if (nx) {
      out.push({
        id: "tomorrow",
        weight: 1.3,
        sig: nx.date,
        build: (c) => V.exTomorrow(c, { weekday: nx.weekday, kind: nx.kind, trade: nx.trade, news: nx.news, skipIf: nx.skipIf }),
      });
    }
    if (w.clock.globexOpen && live) {
      for (const u of UNDERLIERS) {
        const b = w.books[u];
        if (!b || b.dayHigh == null || b.dayLow == null || b.dayHigh <= b.dayLow) continue;
        const open = b.levels.find((l) => l.name === "Session open (18:00)");
        out.push({
          id: `overnight:${u}`,
          weight: 1.2,
          sig: `${Math.floor((b.dayHigh - b.dayLow) / Math.max(1, (b.atr ?? 10) * 0.5))}`,
          build: (c) => V.exOvernight(c, { b, lo: b.dayLow!, hi: b.dayHigh!, openPts: open ? b.px - open.price : null }),
        });
      }
    }
    if (w.clock.isWeekday && !w.clock.holiday && w.clock.etMin >= ROOM_CLOCK.optionsCloseMin && (w.book.closedToday > 0 || w.book.dayPnl !== 0)) {
      out.push({
        id: "recap",
        weight: 1.5,
        sig: `${w.clock.etDate}|${w.book.closedToday}`,
        build: (c) =>
          V.exRecap(c, {
            dayPnl: w.book.dayPnl,
            closed: w.book.closedToday,
            wins: w.book.winsToday,
            refusals: w.lab && w.lab.refusals.length ? { n: w.lab.refusals.reduce((a, r) => a + r.n, 0), pnlUsd: w.lab.refusals.reduce((a, r) => a + r.pnlUsd, 0) } : null,
          }),
      });
    }
  }
  return out;
}

function heartbeatCand(w: TalkWorld, st: TalkState): Cand | null {
  const now = w.nowMs;
  let best: { hb: Hb; score: number } | null = null;
  const all = heartbeats(w, st);
  // The last heartbeat said never comes straight back while there is anything else to say.
  let lastKey: string | null = null;
  let lastAt = 0;
  for (const [k, t] of Object.entries(st.topicAt)) if (k.startsWith("hb:") && t > lastAt) [lastKey, lastAt] = [k, t];
  for (const hb of all) {
    const key = `hb:${hb.id}`;
    if (key === lastKey && all.length > 1) continue;
    const family = `hbf:${hb.id.split(":")[0]}`;
    const age = now - (st.topicAt[key] ?? 0);
    const changed = st.topicSig[key] !== hb.sig;
    const never = st.topicAt[key] == null;
    if (now - (st.topicAt[family] ?? 0) < TALK.heartbeatFamilyGapMs) continue;
    // Said once already: it comes back when its data has moved, or after a long while — never on a timer alone.
    const eligible = never || (changed && age >= TALK.heartbeatChangedGapMs) || age >= TALK.heartbeatTopicCooldownMs;
    if (!eligible) continue;
    const score = hb.weight * (1 + Math.min(never ? 3 : age / TALK.heartbeatTopicCooldownMs, 3)) * (changed && !never ? 1.5 : 1) + (hash32(`${hb.id}|${st.seq}`) % 100) / 1000;
    if (!best || score > best.score) best = { hb, score };
  }
  if (!best) return null;
  const { hb } = best;
  const family = `hbf:${hb.id.split(":")[0]}`;
  return {
    id: `hb|${hb.id}|${st.seq}`,
    kind: "heartbeat",
    topic: `hb:${hb.id}`,
    urgency: 0,
    prio: 1,
    at: now,
    label: `nothing moving · ${hb.id.replace(":", " ")}`,
    build: hb.build,
    commit: (s) => {
      s.topicAt[`hb:${hb.id}`] = now;
      s.topicAt[family] = now;
      s.topicSig[`hb:${hb.id}`] = hb.sig;
      if (hb.id === "evidence") s.variant["evid.idx"] = (s.variant["evid.idx"] ?? 0) + 1;
      if (hb.id.startsWith("audit:")) s.variant["audit.idx"] = (s.variant["audit.idx"] ?? 0) + 1;
      if (hb.id === "memory") s.memSaid = [...s.memSaid, hb.sig].slice(-40);
    },
  };
}

/* ── The scheduler ─────────────────────────────────────────────────────── */

function quietGap(st: TalkState): number {
  const { min, max } = TALK.quietGapMs;
  return min + (hash32(`${st.seq}|${st.dayKey}`) % Math.max(1, max - min));
}

function allowed(c: Cand, w: TalkWorld, st: TalkState): boolean {
  const now = w.nowMs;
  if (now < st.silentUntil && c.urgency < 2) return false;
  if (now - st.lastEmitAt < TALK.spacingMs[c.urgency]) return false;
  const recent = st.emits.filter((e) => now - e.at <= TALK.budget.windowMs);
  if (recent.length >= TALK.budget.max && c.urgency < 2) return false;
  if (c.urgency === 0) {
    if (recent.filter((e) => e.chatter).length >= TALK.budget.maxChatter) return false;
    if (now < Math.max(w.busyUntil, st.lastEndAt) + quietGap(st)) return false;
  }
  return true;
}

function rollDay(st: TalkState, w: TalkWorld) {
  if (st.dayKey === w.clock.etDate) return;
  const keep = (k: string) => k.startsWith(w.clock.etDate) || k.includes(w.clock.etDate);
  st.sessFired = Object.fromEntries(Object.entries(st.sessFired).filter(([k]) => keep(k)));
  st.calFired = Object.fromEntries(Object.entries(st.calFired).filter(([k]) => keep(k)));
  st.levelAt = {};
  st.tapeAt = {};
  st.tapeSize = {};
  st.pnlStep = {};
  st.nearFired = {};
  st.bookApproachAt = {};
  st.raid = {};
  // Day-scoped goal talk (the council, the re-plan, a call asked of the trader) starts over; the pace and the finals persist.
  st.goalSig = Object.fromEntries(Object.entries(st.goalSig).filter(([k]) => k === "pace" || k === "paceAt" || k.startsWith("final|") || k.startsWith("ladder|") || k.includes(w.clock.etDate)));
  // Day-keyed investment topics start over; the book's signature and each headline's seen-mark persist.
  for (const k of Object.keys(st.topicAt)) if (/^invest:(funnel|theme|board|catalyst):/.test(k) && !k.includes(w.clock.etDate)) delete st.topicAt[k];
  st.dayKey = w.clock.etDate;
}

function feedSentence(w: TalkWorld): string {
  const lag = w.feed.lagSec;
  switch (w.feed.kind) {
    case "live_gateway":
      return "Gateway tape — real-time.";
    case "yahoo":
      return lag != null && lag >= 90 ? `Yahoo tape, ${Math.round(lag / 60)} min behind.` : "Yahoo tape.";
    case "databento":
      return "Databento tape.";
    case "synthetic":
      return "Synthetic feed — not live data.";
    default:
      return "No feed yet.";
  }
}

/**
 * One look at the world. Returns the new state, and at most one exchange to play. The state must be passed back in
 * next time; the caller owns it (the engine keeps it in memory, a verifier keeps it in a variable).
 */
export function talkTick(w: TalkWorld, prev: TalkState): { item: TalkItem | null; state: TalkState } {
  let st = clone(prev);
  const now = w.nowMs;
  rollDay(st, w);
  const gap = st.lastTickMs ? now - st.lastTickMs : 0;
  st.lastTickMs = now;
  if (gap > TALK.resumeGapMs) st.silentUntil = now + TALK.resumeSilenceMs;

  const cands: Cand[] = [];
  const first = !st.primed;
  st.primed = true;
  if (first) {
    cands.push({
      id: `welcome|${w.clock.etDate}`,
      kind: "session",
      topic: "welcome",
      urgency: 1,
      prio: 10,
      at: now,
      label: "the desk is live",
      build: (c) =>
        V.exWelcome(c, {
          feedLine: feedSentence(w),
          positions: w.book.positions.length,
          monthEntries: w.book.monthEntries,
          b: w.books.QQQ ?? w.books.SPY,
          optionsOpen: w.clock.optionsOpen,
          globexOpen: w.clock.globexOpen,
        }),
      commit: () => {},
    });
  }
  feedCands(w, st, cands);
  sessionCands(w, st, cands);
  calendarCands(w, st, cands);
  newsCands(w, st, cands);
  levelCands(w, st, cands);
  tapeCands(w, st, cands);
  bookCands(w, st, cands, !first);
  pulseCands(w, st, cands);
  seatCands(w, st, cands);
  goalCands(w, st, cands);
  rndCands(w, st, cands);
  investCands(w, st, cands);

  cands.sort((a, b) => b.urgency - a.urgency || b.prio - a.prio || b.at - a.at);

  const tryEmit = (c: Cand): TalkItem | null => {
    if (!allowed(c, w, st)) return null;
    const draft = clone(st);
    const f = new Facts();
    const ex = c.build({ st: draft, f, key: c.id, now });
    c.commit(draft);
    draft.topicAt[c.topic] = now;
    if (!ex || !ex.lines.length) {
      draft.suppressed += 1;
      st = draft;
      return null;
    }
    const lines = ex.lines;
    const estMs = playMs(lines);
    draft.seq += 1;
    draft.lastEmitAt = now;
    draft.lastEndAt = Math.max(w.busyUntil, now) + estMs;
    draft.emits = [...draft.emits.filter((e) => now - e.at <= TALK.budget.windowMs), { at: now, kind: c.kind, chatter: c.urgency === 0 }];
    for (const l of lines) {
      draft.recent.push(norm(l.text));
      (draft.spoke[l.character] ??= []).push(now);
      draft.spoke[l.character] = draft.spoke[l.character]!.slice(-12);
    }
    draft.recent = draft.recent.slice(-TALK.recentKeep);
    st = draft;
    return {
      id: `t${draft.seq}`,
      at: now,
      kind: c.kind,
      topic: c.topic,
      label: c.label,
      urgency: c.urgency,
      lines,
      moves: ex.moves,
      facts: f.list,
      estMs,
      ttlMs: TALK.ttlMs[c.urgency],
    };
  };

  for (const c of cands) {
    const item = tryEmit(c);
    if (item) return { item, state: st };
  }
  // Nothing happened worth interrupting for. If the room is quiet, it talks about something real.
  const hb = heartbeatCand(w, st);
  if (hb) {
    const item = tryEmit(hb);
    if (item) return { item, state: st };
  }
  return { item: null, state: st };
}
