/**
 * Local PATH alarm — computer speaker + OS notification when an A+/A/A-
 * setup actually arms. Push (VAPID) is a second channel; this one works
 * with a tab open and no server keys.
 *
 * Must be armed by a user click (AudioContext + Notification permission).
 */

import type { DeskPayload } from "@/lib/trading/build-desk";
import type { SetupCandidate } from "@/lib/trading/scanner";
import { isJudasWindow } from "@/lib/trading/sessions";

export const PATH_ALARM_STORAGE = "ledger-path-alarm";
export const PATH_ALARM_EVENT = "ledger-path-alarm-fire";

const HIGH_PROB = new Set(["A+", "A", "A-"]);

export interface PathAlarmState {
  armed: boolean;
  muted: boolean;
  lastKey: string | null;
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
    return { armed: false, muted: false, lastKey: null, lastAt: null, lastTitle: null };
  }
  try {
    const raw = localStorage.getItem(PATH_ALARM_STORAGE);
    if (!raw) {
      return { armed: false, muted: false, lastKey: null, lastAt: null, lastTitle: null };
    }
    const p = JSON.parse(raw) as Partial<PathAlarmState>;
    return {
      armed: p.armed === true,
      muted: p.muted === true,
      lastKey: typeof p.lastKey === "string" ? p.lastKey : null,
      lastAt: typeof p.lastAt === "number" ? p.lastAt : null,
      lastTitle: typeof p.lastTitle === "string" ? p.lastTitle : null,
    };
  } catch {
    return { armed: false, muted: false, lastKey: null, lastAt: null, lastTitle: null };
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
 * Call on every desk poll. Dedupe per candidate+day. Judas 9:30–9:45 ET
 * suppresses everything except A+ (the raid is the setup, not the entry).
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
  if (isJudasWindow(clock.etHour, clock.etMinute) && band !== "A+") {
    return null;
  }
  if (desk.news?.verdict === "blackout") return null;

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
