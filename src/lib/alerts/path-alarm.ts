/**
 * Local PATH alarm — computer speaker + OS notification when an A+/A/A-
 * setup actually arms. Push (VAPID) is a second channel; this one works
 * with a tab open and no server keys.
 *
 * Must be armed by a user click (AudioContext + Notification permission).
 */

import { isWatchable, readEntry, touchKey } from "@/lib/trading/entry-trigger";
import type { DeskPayload } from "@/lib/trading/build-desk";
import type { SmcMasterBook } from "@/lib/trading/smc-master";
import type { SetupCandidate } from "@/lib/trading/scanner";
import { etWallParts, isJudasWindow } from "@/lib/trading/sessions";
import { readSession } from "@/lib/trading/session-event";
import { readJudas } from "@/lib/trading/judas-window";
import { buildEntryTicket, ticketHeadline } from "@/lib/trading/entry-ticket";
import { allSeries } from "@/lib/trading/chart-timeframes";

export const PATH_ALARM_STORAGE = "ledger-path-alarm";
export const PATH_ALARM_EVENT = "ledger-path-alarm-fire";

const HIGH_PROB = new Set(["A+", "A", "A-"]);

export interface PathAlarmState {
  armed: boolean;
  muted: boolean;
  /** Dedupe slot for the PATH (complete-sequence) alarm. */
  lastKey: string | null;
  /**
   * Dedupe slot for the CE-touch alarm, kept SEPARATE.
   *
   * Both alarms used to write `lastKey`. Firing one then cleared the other's
   * memory, so a PATH beep could un-suppress a touch that had already fired
   * and the same book alarmed twice — or, the other way, a touch could
   * silence a later PATH. Two independent events need two slots.
   */
  lastTouchKey: string | null;
  lastAt: number | null;
  lastTitle: string | null;
}

export interface PathAlarmFire {
  key: string;
  title: string;
  body: string;
  symbol: string;
  side: "long" | "short";
  grade: string;
  confluence: number;
  at: number;
}

type Listener = (s: PathAlarmState) => void;
const listeners = new Set<Listener>();

function etDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function load(): PathAlarmState {
  if (typeof window === "undefined") {
    return { armed: false, muted: false, lastKey: null, lastTouchKey: null, lastAt: null, lastTitle: null };
  }
  try {
    const raw = localStorage.getItem(PATH_ALARM_STORAGE);
    if (!raw) {
      return { armed: false, muted: false, lastKey: null, lastTouchKey: null, lastAt: null, lastTitle: null };
    }
    const p = JSON.parse(raw) as Partial<PathAlarmState>;
    return {
      armed: p.armed === true,
      muted: p.muted === true,
      lastKey: typeof p.lastKey === "string" ? p.lastKey : null,
      lastTouchKey: typeof p.lastTouchKey === "string" ? p.lastTouchKey : null,
      lastAt: typeof p.lastAt === "number" ? p.lastAt : null,
      lastTitle: typeof p.lastTitle === "string" ? p.lastTitle : null,
    };
  } catch {
    return { armed: false, muted: false, lastKey: null, lastTouchKey: null, lastAt: null, lastTitle: null };
  }
}

function save(s: PathAlarmState): PathAlarmState {
  if (typeof window !== "undefined") {
    localStorage.setItem(PATH_ALARM_STORAGE, JSON.stringify(s));
    window.dispatchEvent(new Event("ledger-path-alarm"));
  }
  for (const fn of listeners) fn(s);
  return s;
}

export function getPathAlarmState(): PathAlarmState {
  return load();
}

export function subscribePathAlarm(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  return audioCtx;
}

/** Unlock audio + notifications. Must run from a click. */
export async function armPathAlarm(): Promise<{ ok: boolean; reason?: string }> {
  const c = ctx();
  if (c && c.state === "suspended") {
    try {
      await c.resume();
    } catch {
      /* still try notifications */
    }
  }
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      /* */
    }
  }
  const s = load();
  save({ ...s, armed: true, muted: false });
  // Prove the speaker works on arm.
  playAlarmTone("short");
  return { ok: true };
}

export function disarmPathAlarm(): void {
  const s = load();
  save({ ...s, armed: false });
}

export function mutePathAlarm(muted: boolean): void {
  const s = load();
  save({ ...s, muted });
}

export function isHighProbPath(c: SetupCandidate | undefined | null): boolean {
  if (!c) return false;
  if (!c.actionable) return false;
  const band = String(c.pathBand || c.grade || "");
  if (!HIGH_PROB.has(band) && !HIGH_PROB.has(c.grade)) return false;
  if ((c.confluence ?? 0) < 0.65) return false;
  return true;
}

function alarmKey(c: SetupCandidate, day: string): string {
  const band = c.pathBand || c.grade;
  return `${day}:${c.id}:${c.side}:${band}`;
}

function playAlarmTone(side: "long" | "short"): void {
  const c = ctx();
  if (!c) return;
  void c.resume();
  const now = c.currentTime;
  const freqs =
    side === "short" ? [880, 659.25, 880, 659.25] : [523.25, 783.99, 1046.5, 783.99];
  freqs.forEach((f, i) => {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "square";
    osc.frequency.value = f;
    const t0 = now + i * 0.26;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + 0.22);
  });
}

/**
 * Distinct urgent siren for a tape shock — a fast descending triple, different
 * from the PATH chime so the trader knows it means STAND DOWN, not "go". Fired
 * once on the shock transition by the HUD; unaffected by the arm/mute state
 * (a circuit breaker is not something you silence).
 */
export function shockSiren(): void {
  const c = ctx();
  if (!c) return;
  void c.resume();
  const now = c.currentTime;
  [1174.66, 880, 659.25, 493.88, 659.25, 493.88].forEach((f, i) => {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = f;
    const t0 = now + i * 0.16;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.28, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + 0.16);
  });
}

function showOsNote(fire: PathAlarmFire): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification(fire.title, {
      body: fire.body,
      tag: fire.key,
      requireInteraction: true,
      silent: false,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* Safari / denied after grant race */
  }
}

/**
 * Call on every desk poll. Dedupe per candidate+day. Fires only when the
 * SMC sequence for that book is TAKE (all must-layers incl. retrace) AND the
 * PATH band is A+/A/A-. Judas 9:30-9:45 ET suppresses everything: the raid
 * is the setup, not the entry, and smc-master STANDs it anyway.
 */
export function considerPathAlarm(
  desk: DeskPayload,
  candidate: SetupCandidate | undefined,
): PathAlarmFire | null {
  const s = load();
  if (!s.armed || s.muted) return null;
  if (!isHighProbPath(candidate) || !candidate) return null;

  const clock = desk.clock;
  const band = String(candidate.pathBand || candidate.grade);
  // Wall clock, not the desk build's clock: the build can be up to a poll old.
  const wall = etWallParts(Date.now());
  // Judas is no longer a blanket mute. It mutes until the open's manipulation
  // has resolved on a sub-15m rung (judas-window.ts) — and since the sequence
  // applies the same read, a released window is one where the desk can
  // genuinely print TAKE, and an alarm that stayed silent for it would be the
  // worst of both. Without minute tape the read fails closed and this is
  // exactly the old behaviour.
  if (
    isJudasWindow(wall.hour, wall.minute) &&
    readJudas(allSeries(desk.left?.bars ?? [], desk.mtf?.left?.minute ?? []), { etHour: wall.hour, etMinute: wall.minute }, null)
      .blocked
  )
    return null;
  if (desk.news?.verdict === "blackout") return null;

  // Beep only on a COMPLETE sequence. A PATH grade alone is the scanner's
  // component score; the alarm used to fire on it while smc-master still
  // said WAIT (no retrace) or STAND (wrong sweep polarity) — so the trader
  // ran to the screen to be told not to trade.
  const root = (s: string) => s.replace(/^M/, "");
  const seq =
    root(candidate.symbol) === root(desk.smcMaster.left.symbol)
      ? desk.smcMaster.left
      : root(candidate.symbol) === root(desk.smcMaster.right.symbol)
        ? desk.smcMaster.right
        : null;
  if (!seq || seq.word !== "TAKE") return null;

  const day = etDay(Date.now());
  const key = alarmKey(candidate, day);
  if (s.lastKey === key) return null;

  const title = `PATH ${band} · ${candidate.symbol} ${candidate.side.toUpperCase()}`;
  const body = [
    `Q ${candidate.confluence.toFixed(2)}`,
    candidate.completeStrategy || candidate.strategyPrimary,
    candidate.entryZone.split("(")[0]?.trim(),
    clock.killzoneLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  const fire: PathAlarmFire = {
    key,
    title,
    body,
    symbol: candidate.symbol,
    side: candidate.side,
    grade: band,
    confluence: candidate.confluence,
    at: Date.now(),
  };

  save({
    ...s,
    lastKey: key,
    lastAt: fire.at,
    lastTitle: title,
  });

  playAlarmTone(candidate.side);
  showOsNote(fire);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PATH_ALARM_EVENT, { detail: fire }));
  }
  return fire;
}

/**
 * The CE-touch alarm — the one the trader actually needs.
 *
 * `considerPathAlarm` above fires on a COMPLETE sequence, which on this tape
 * happens about never (the 2026-09-21 replay found 0 TAKEs in a month). So
 * the trader was never called to the screen at all. This fires on the other
 * moment, the one that carries the measured edge: every must-layer passing
 * EXCEPT the retrace, and price now arriving at the plan's entry price.
 *
 * That is the only condition a trader cannot make happen by waiting. It is
 * also the moment the desk can add something the trader cannot: it is
 * watching all 1,170 polls of the session and they are not.
 *
 * Fires once per plan per day. Judas, news blackout and the trade window are
 * respected exactly as the PATH alarm respects them: this is a call to the
 * screen, not a permission to trade.
 */
export function considerEntryAlarm(desk: DeskPayload): PathAlarmFire | null {
  const s = load();
  if (!s.armed || s.muted) return null;

  const wall = etWallParts(Date.now());
  // Judas is no longer a blanket mute. It mutes until the open's manipulation
  // has resolved on a sub-15m rung (judas-window.ts) — and since the sequence
  // applies the same read, a released window is one where the desk can
  // genuinely print TAKE, and an alarm that stayed silent for it would be the
  // worst of both. Without minute tape the read fails closed and this is
  // exactly the old behaviour.
  if (
    isJudasWindow(wall.hour, wall.minute) &&
    readJudas(allSeries(desk.left?.bars ?? [], desk.mtf?.left?.minute ?? []), { etHour: wall.hour, etMinute: wall.minute }, null)
      .blocked
  )
    return null;
  if (desk.news?.verdict === "blackout") return null;

  // DEDUPED. `oneBook` is the same OBJECT as left or right (smc-master picks
  // it from them), so the old [oneBook, left, right] tested one book twice —
  // and combined with the early return below, a book that had already alarmed
  // ended the whole scan before the other book was ever looked at.
  const seen = new Set<SmcMasterBook>();
  const books = [desk.smcMaster?.oneBook, desk.smcMaster?.left, desk.smcMaster?.right]
    .filter((b): b is SmcMasterBook => !!b)
    .filter((b) => (seen.has(b) ? false : (seen.add(b), true)));

  for (const book of books) {
    if (!book?.plan || !isWatchable(book)) continue;
    const isLeft = book.symbol === desk.left.symbol;
    const price = isLeft
      ? desk.quotes.left.price
      : book.symbol === desk.right.symbol
        ? desk.quotes.right.price
        : null;
    if (price == null || !Number.isFinite(price) || price <= 0) continue;

    // The session gate, same read the sequence used (session-event.ts), and
    // read from THIS BOOK'S bars. Was a bare `desk.clock.inTradeWindow`
    // outside the loop, so once smc-master could print TAKE on a measured
    // session event the alarm stayed silent for it — a desk that says TAKE
    // and does not call you is worse than either answer alone. Per-book
    // because a shock on ES is not a shock on MNQ, and one shared reading
    // would let either book's quiet tape mute the other's event.
    const bars = isLeft ? desk.left?.bars : desk.right?.bars;
    if (!readSession(bars ?? [], desk.clock).live) continue;

    const read = readEntry(book.plan, price, null);
    if (!read?.inZone) continue;

    const key = touchKey(book, etDay(Date.now()));
    // CONTINUE, not return. This was `return null`, so once either book had
    // alarmed for the day the loop stopped on it and the OTHER book could
    // never fire — the desk trades one book a day, but it grades two, and the
    // one that touches second is exactly the one worth being called to.
    if (s.lastTouchKey === key) continue;

    const plan = book.plan;

    /**
     * THE WHOLE TRADE, not just the touch.
     *
     * This used to say entry, stop and T1 — all true, and still not something
     * you can act on without opening the desk. It did not say how many
     * contracts, what to do when T1 prints, where the stop goes afterwards,
     * or when the idea is dead. Every one of those gaps is a decision made at
     * the screen under time pressure, by the part of the process the trader
     * has identified as the weak one.
     *
     * On a funded prop account this matters more, not less: Apex permits
     * semi-automated management with the trader actively involved and
     * prohibits hands-off automation, so the desk cannot be the hands — which
     * makes it the desk's job to leave the hands nothing to invent.
     *
     * `buildEntryTicket` reads the plan the sequence already priced and the
     * rules already in APLUS_RULES. It computes nothing about the market.
     */
    const cand = desk.scan?.candidates?.find(
      (c) => c.symbol === book.symbol && c.side === book.side,
    );
    const ticket = buildEntryTicket({
      plan,
      confluence: cand?.confluence ?? 0,
      reachPct: plan.draw?.reachProbability ?? null,
    });

    const title = `TOUCH · ${ticketHeadline(ticket)}`;
    const body = [
      ticket.text,
      book.word === "TAKE" ? "sequence complete" : `waiting on: ${book.missing}`,
      desk.clock.sessionReason ?? desk.clock.killzoneLabel,
    ]
      .filter(Boolean)
      .join("\n");

    const fire: PathAlarmFire = {
      key,
      title,
      body,
      symbol: book.symbol,
      side: book.side === "short" ? "short" : "long",
      grade: book.pathBand ?? "—",
      confluence: 0,
      at: Date.now(),
    };
    save({ ...s, lastTouchKey: key, lastAt: fire.at, lastTitle: title });
    playAlarmTone(fire.side);
    showOsNote(fire);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(PATH_ALARM_EVENT, { detail: fire }));
    }
    return fire;
  }
  return null;
}

export function testPathAlarm(side: "long" | "short" = "short"): void {
  playAlarmTone(side);
  showOsNote({
    key: "test",
    title: "PATH alarm test",
    body: "If you heard this, the computer alarm is live. Keep this tab open during NY AM.",
    symbol: "MNQ",
    side,
    grade: "A",
    confluence: 0.7,
    at: Date.now(),
  });
}
