/**
 * Ghost book — every high-grade card is tracked against live tape even if
 * you never clicked Log. Resolves fill → win / loss / missed / expired and
 * writes a short SMC post-trade so the brain learns skips too.
 */

import type { OhlcBar } from "@/lib/market/types";
import type { DeskPayload } from "./build-desk";
import { remember } from "./desk-memory";
import { buildPaperLevels } from "./paper-manager";
import type { SetupCandidate } from "./scanner";
import { getSessionClock, etWallToEpochMs } from "./sessions";

const KEY = "ledger.ghost-book.v1";
const MAX = 80;
const EVENT = "ledger-ghost";

export type GhostStatus =
  | "watching"
  | "filled"
  | "won"
  | "lost"
  | "missed"
  | "expired";

export interface GhostAnalysis {
  result: GhostStatus;
  headline: string;
  why: string[];
  whatWorked: string[];
  whatFailed: string[];
  lesson: string;
}

export interface GhostTrade {
  id: string;
  dayKey: string;
  symbol: string;
  side: "long" | "short";
  strategy: string;
  grade: string;
  confluence: number;
  seenAt: number;
  killzoneOk: boolean;
  killzoneLabel: string;
  blocked: string[];
  entryLo: number;
  entryHi: number;
  entry: number;
  stop: number;
  tp1: number;
  targetLabel: string;
  taken: boolean;
  status: GhostStatus;
  fillAt?: number;
  fillPrice?: number;
  exitAt?: number;
  exitPrice?: number;
  exitReason?: string;
  r?: number;
  analysis?: GhostAnalysis;
  htfNote?: string;
  smtNote?: string;
}

function emit(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT));
}

function dayKeyEt(now = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

export function loadGhosts(): GhostTrade[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as GhostTrade[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function saveGhosts(rows: GhostTrade[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows.slice(0, MAX)));
  } catch {
    /* quota */
  }
  emit();
}

function parseZone(text: string): { lo: number; hi: number } | null {
  const nums = [...text.matchAll(/\d{3,}(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (nums.length < 2) return nums.length === 1 ? { lo: nums[0]!, hi: nums[0]! } : null;
  return { lo: Math.min(nums[0]!, nums[1]!), hi: Math.max(nums[0]!, nums[1]!) };
}

function trackable(c: SetupCandidate): boolean {
  if (c.grade === "A+" || c.grade === "A-") return true;
  if (c.pathBand === "A+" || c.pathBand === "A" || c.pathBand === "A-" || c.pathBand === "B+")
    return true;
  return c.confluence >= 0.65;
}

function ghostId(c: SetupCandidate, day: string): string {
  const strat = c.completeStrategy || c.strategyPrimary || "model";
  return `ghost-${c.symbol}-${c.side}-${strat}-${day}`;
}

function analyze(g: GhostTrade): GhostAnalysis {
  const rTxt = g.r != null ? `${g.r >= 0 ? "+" : ""}${g.r.toFixed(2)}R` : "";
  if (g.status === "won") {
    const process =
      !g.killzoneOk || g.blocked.length
        ? "Process skip was still correct if the window was closed — PnL would have been green, discipline stays."
        : g.taken
          ? "You were in it. This is the template: raid → array → delivery."
          : "You were not in it. Journal as a missed A+ that paid — size the next one, don't chase this one.";
    return {
      result: "won",
      headline: `${g.symbol} ${g.side} paid ${rTxt} → ${g.exitReason ?? "target"}`,
      why: [
        `Filled ${g.fillPrice?.toFixed(2)} in ${g.entryLo.toFixed(2)}–${g.entryHi.toFixed(2)}, target ${g.tp1.toFixed(2)} printed before stop ${g.stop.toFixed(2)}.`,
        g.smtNote || `${g.strategy} delivery held — opposing liquidity was the magnet.`,
        g.htfNote || "HTF idea was not violated before the target.",
      ],
      whatWorked: [
        `${g.strategy} sequence completed`,
        `Stop ${g.stop.toFixed(2)} never tagged`,
        `Draw ${g.targetLabel || g.tp1.toFixed(2)} reached`,
      ],
      whatFailed: g.taken ? [] : ["Not logged — no money, still a process sample"],
      lesson: process,
    };
  }
  if (g.status === "lost") {
    return {
      result: "lost",
      headline: `${g.symbol} ${g.side} failed ${rTxt} — ${g.exitReason ?? "stop"}`,
      why: [
        `Stop ${g.stop.toFixed(2)} tagged before target ${g.tp1.toFixed(2)}. Invalidation was the tell.`,
        "Either the raid continued (true break) or the array was already spent when the card printed.",
        g.smtNote ? `SMT context: ${g.smtNote}` : "No HTF SMT confirmation on the ticket.",
      ],
      whatWorked: ["Stop did its job — defined risk"],
      whatFailed: [
        `${g.strategy} did not deliver`,
        "Grade is probability, not a promise",
      ],
      lesson: g.taken
        ? "Take the R, journal the miss on structure, do not add."
        : "You skipped and it failed — that skip was a process win. Keep doing that when the tape disagrees after entry.",
    };
  }
  if (g.status === "missed") {
    return {
      result: "missed",
      headline: `${g.symbol} ${g.side} never retraced the zone — target printed anyway`,
      why: [
        `Price went to ${g.tp1.toFixed(2)} without trading ${g.entryLo.toFixed(2)}–${g.entryHi.toFixed(2)}.`,
        "That is a chase, not a setup. Limit in the array would not have filled.",
      ],
      whatWorked: ["Standing down was correct"],
      whatFailed: ["Card printed late, after displacement"],
      lesson: "If you are not filled, you do not have a trade. Count this as a clean skip.",
    };
  }
  if (g.status === "expired") {
    return {
      result: "expired",
      headline: `${g.symbol} ${g.side} expired — no fill into the close`,
      why: ["Session ended without a visit to the array."],
      whatWorked: ["No force-fill"],
      whatFailed: ["Idea went stale"],
      lesson: "Unfilled plans die at the cash close. Do not drag them into the next session.",
    };
  }
  return {
    result: g.status,
    headline: `${g.symbol} ${g.side} still live — watching fill ${g.entryLo.toFixed(2)}–${g.entryHi.toFixed(2)}`,
    why: [`Stop ${g.stop.toFixed(2)} · target ${g.tp1.toFixed(2)}`],
    whatWorked: [],
    whatFailed: [],
    lesson: "Wait for the array. Do not chase.",
  };
}

export function resolveAgainst(
  g: GhostTrade,
  bars: OhlcBar[],
  last: number,
  now: number,
): GhostTrade {
  if (g.status === "won" || g.status === "lost" || g.status === "expired" || g.status === "missed") {
    return g;
  }
  const sessionOpen = etWallToEpochMs(g.dayKey, "06:00");
  const after = bars
    .filter((b) => b.t >= sessionOpen)
    .sort((a, b) => a.t - b.t);
  const clock = getSessionClock(new Date(now));
  const expired =
    !clock.isWeekday ||
    (clock.etHour >= 16 && clock.etMinute >= 10) ||
    now - g.seenAt > 6 * 3600_000;

  const hitZone = (h: number, l: number) =>
    g.side === "short" ? h >= g.entryLo : l <= g.entryHi;
  const hitStop = (h: number, l: number) =>
    g.side === "short" ? h >= g.stop : l <= g.stop;
  const hitTp = (h: number, l: number) =>
    g.side === "short" ? l <= g.tp1 : h >= g.tp1;

  let status: GhostStatus = g.status;
  let fillPrice = g.fillPrice;
  let fillAt = g.fillAt;
  let exitPrice = g.exitPrice;
  let exitAt = g.exitAt;
  let exitReason = g.exitReason;
  let r = g.r;

  const markFill = (px: number, t: number) => {
    status = "filled";
    fillPrice = px;
    fillAt = t;
  };
  const markExit = (next: GhostStatus, px: number, t: number, why: string) => {
    status = next;
    exitPrice = px;
    exitAt = t;
    exitReason = why;
    const entry = fillPrice ?? g.entry;
    const risk = Math.abs(entry - g.stop) || 1;
    r = g.side === "short" ? (entry - px) / risk : (px - entry) / risk;
    r = +r.toFixed(3);
  };

  if (status === "watching") {
    for (const b of after) {
      if (hitZone(b.h, b.l)) {
        markFill(g.entry, b.t);
        if (hitStop(b.h, b.l) && hitTp(b.h, b.l)) {
          markExit("lost", g.stop, b.t, "stop (same bar as fill — conservative)");
          break;
        }
        if (hitStop(b.h, b.l)) {
          markExit("lost", g.stop, b.t, "stop");
          break;
        }
        if (hitTp(b.h, b.l)) {
          markExit("won", g.tp1, b.t, "target");
          break;
        }
      } else if (hitTp(b.h, b.l) && !hitZone(b.h, b.l)) {
        markExit("missed", g.tp1, b.t, "target without fill");
        break;
      } else if (hitStop(b.h, b.l) && !hitZone(b.h, b.l)) {
        markExit("expired", g.stop, b.t, "invalidation without fill");
        break;
      }
    }
    if (status === "watching" && hitZone(last, last)) {
      markFill(g.entry, now);
    }
  }

  if (status === "filled") {
    for (const b of after.filter((x) => x.t >= (fillAt ?? g.seenAt))) {
      if (hitStop(b.h, b.l) && hitTp(b.h, b.l)) {
        markExit("lost", g.stop, b.t, "stop (both printed — stop first)");
        break;
      }
      if (hitStop(b.h, b.l)) {
        markExit("lost", g.stop, b.t, "stop");
        break;
      }
      if (hitTp(b.h, b.l)) {
        markExit("won", g.tp1, b.t, "target");
        break;
      }
    }
    if (status === "filled") {
      if (hitStop(last, last)) markExit("lost", g.stop, now, "stop (print)");
      else if (hitTp(last, last)) markExit("won", g.tp1, now, "target (print)");
    }
  }

  if (status === "watching" && expired) {
    markExit("expired", last, now, "session / time stop — never filled");
  }
  if (status === "filled" && expired) {
    const entry = fillPrice ?? g.entry;
    const risk = Math.abs(entry - g.stop) || 1;
    const liveR = g.side === "short" ? (entry - last) / risk : (last - entry) / risk;
    markExit(
      liveR >= 0 ? "won" : "lost",
      last,
      now,
      "flattened at session end",
    );
  }

  const next: GhostTrade = {
    ...g,
    status,
    fillPrice,
    fillAt,
    exitPrice,
    exitAt,
    exitReason,
    r,
  };
  if (
    next.status !== g.status &&
    (next.status === "won" ||
      next.status === "lost" ||
      next.status === "missed" ||
      next.status === "expired")
  ) {
    next.analysis = analyze(next);
  }
  return next;
}

function rememberGhost(g: GhostTrade): void {
  if (!g.analysis) return;
  remember(
    "session",
    g.analysis.headline,
    `${g.analysis.why.join(" ")} ${g.analysis.lesson}`,
    ["ghost", g.symbol, g.side, g.strategy, g.status],
    { ghostId: g.id, r: g.r, status: g.status, taken: g.taken },
  );
}

export function observeAndTickGhosts(desk: DeskPayload, takenIds: Set<string> = new Set()): GhostTrade[] {
  const now = Date.now();
  const day = dayKeyEt(now);
  let rows = loadGhosts();
  const byId = new Map(rows.map((g) => [g.id, g]));

  for (const c of desk.scan.candidates) {
    if (!trackable(c)) continue;
    const last =
      c.symbol === desk.left.symbol ? desk.quotes.left.price : desk.quotes.right.price;
    const levels = buildPaperLevels(c, 100_000, last);
    if (!levels.entry || !levels.stop) continue;
    const zone = parseZone(c.entryZone) ?? {
      lo: Math.min(levels.entry, levels.tp1),
      hi: Math.max(levels.entry, levels.stop),
    };
    const id = ghostId(c, day);
    const prev = byId.get(id);
    if (prev && (prev.status === "won" || prev.status === "lost" || prev.status === "missed" || prev.status === "expired")) {
      if (takenIds.has(c.id) || takenIds.has(id)) prev.taken = true;
      continue;
    }
    const blocked = [
      ...desk.scan.blocked.slice(0, 3),
      ...(c.actionable ? [] : c.missing.slice(0, 2)),
    ];
    const draft: GhostTrade = {
      id,
      dayKey: day,
      symbol: c.symbol,
      side: c.side,
      strategy: c.completeStrategy || c.strategyPrimary || "model",
      grade: String(c.pathBand || c.grade),
      confluence: c.confluence,
      seenAt: prev?.seenAt ?? now,
      killzoneOk: desk.clock.inTradeWindow,
      killzoneLabel: desk.clock.killzoneLabel,
      blocked,
      entryLo: zone.lo,
      entryHi: zone.hi,
      entry: levels.entry,
      stop: levels.stop,
      tp1: levels.tp1,
      targetLabel: c.targets[0] ?? "",
      taken: Boolean(prev?.taken || takenIds.has(c.id) || takenIds.has(id)),
      status: prev?.status ?? "watching",
      fillAt: prev?.fillAt,
      fillPrice: prev?.fillPrice,
      htfNote: `${c.symbol} ${c.htfOk ? "HTF ok" : "HTF off"}`,
      smtNote: desk.smtStack?.primary.active
        ? desk.smtStack.primary.note
        : desk.scan.smt.note,
    };
    byId.set(id, draft);
  }

  rows = [...byId.values()];
  const next: GhostTrade[] = [];
  for (const g of rows) {
    const series = g.symbol === desk.left.symbol ? desk.left : desk.right;
    const last =
      g.symbol === desk.left.symbol ? desk.quotes.left.price : desk.quotes.right.price;
    const before = g.status;
    const updated = resolveAgainst(g, series.bars ?? [], last, now);
    if (updated.status !== before && updated.analysis) rememberGhost(updated);
    next.push(updated);
  }
  next.sort((a, b) => b.seenAt - a.seenAt);
  saveGhosts(next);
  return next;
}

export function markGhostTaken(symbol: string, side: "long" | "short"): void {
  const day = dayKeyEt();
  const rows = loadGhosts().map((g) =>
    g.dayKey === day && g.symbol === symbol && g.side === side
      ? { ...g, taken: true }
      : g,
  );
  saveGhosts(rows);
}

export function ghostForCandidate(c: SetupCandidate): GhostTrade | null {
  const id = ghostId(c, dayKeyEt());
  return loadGhosts().find((g) => g.id === id) ?? null;
}

export function subscribeGhosts(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

export function todayGhosts(): GhostTrade[] {
  const day = dayKeyEt();
  return loadGhosts().filter((g) => g.dayKey === day);
}
