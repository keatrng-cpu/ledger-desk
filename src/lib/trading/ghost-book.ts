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
import { getSessionClock, etWallToEpochMs, etWallParts, isJudasWindow } from "./sessions";
import { debriefGhost, pushDebrief } from "./trade-debrief";
import { tapeHitsForSide } from "./smc-board";
import { isHighProbPath } from "@/lib/alerts/path-alarm";

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
  /** What to do on THIS tape after the outcome. Live for misses. */
  next?: string;
  /** Short banner tag, e.g. "draw spent" / "Judas, no retrace". */
  tag?: string;
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

function px(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function rootSym(s: string): string {
  return s.replace(/^M(?=NQ$|ES$)/, "");
}

function bookOf(desk: DeskPayload, symbol: string): "left" | "right" {
  if (symbol === desk.left.symbol || symbol === desk.bias.left.symbol) return "left";
  if (symbol === desk.right.symbol || symbol === desk.bias.right.symbol) return "right";
  return rootSym(symbol) === rootSym(desk.left.symbol) ? "left" : "right";
}

function inJudasMs(ms: number): boolean {
  const p = etWallParts(ms);
  return isJudasWindow(p.hour, p.minute);
}

type AnalyzeCtx = {
  desk: DeskPayload;
  last: number;
  peers: GhostTrade[];
};

function analyzeMissed(g: GhostTrade, ctx: AnalyzeCtx): GhostAnalysis {
  const { desk, last, peers } = ctx;
  const book = bookOf(desk, g.symbol);
  const bias = desk.bias[book];
  const draw = desk.draws[book];
  const narr = desk.narrative[book];
  const tape = tapeHitsForSide(
    desk.smc?.[book],
    g.side === "short" ? "bear" : "bull",
  );
  const cond =
    book === "left" ? desk.scan.conditions.left : desk.scan.conditions.right;
  const clock = desk.clock;
  const news = desk.news;
  const week = desk.weekAhead?.focus ?? desk.weekAhead?.today ?? null;
  const brief = desk.brief;

  const printed = g.exitPrice ?? g.tp1;
  const zoneMid = (g.entryLo + g.entryHi) / 2;
  const runPts = g.side === "short" ? zoneMid - printed : printed - zoneMid;
  const atr = draw.atr || 0;
  const runAtr = atr > 0 ? runPts / atr : 0;
  const eps = Math.max(atr * 0.05, 1);

  const htfAgrees =
    (g.side === "short" && bias.topDown === "bear") ||
    (g.side === "long" && bias.topDown === "bull");
  const sessAgrees =
    (g.side === "short" && bias.sessionStance === "bear") ||
    (g.side === "long" && bias.sessionStance === "bull");

  const dirMagnet =
    g.side === "short"
      ? (draw.below ?? (draw.primary?.side === "below" ? draw.primary : null))
      : (draw.above ?? (draw.primary?.side === "above" ? draw.primary : null));

  const magnetSpent = dirMagnet
    ? g.side === "short"
      ? last <= dirMagnet.price + eps
      : last >= dirMagnet.price - eps
    : g.side === "short"
      ? last <= g.tp1 + eps
      : last >= g.tp1 - eps;

  const retracing =
    g.side === "short"
      ? last > printed + eps && last < g.entryLo
      : last < printed - eps && last > g.entryHi;

  const judasThen = inJudasMs(g.seenAt) || (g.exitAt != null && inJudasMs(g.exitAt));
  const judasNow = isJudasWindow(clock.etHour, clock.etMinute);

  const peerMiss = peers.filter(
    (p) =>
      p.id !== g.id &&
      p.dayKey === g.dayKey &&
      p.side === g.side &&
      p.status === "missed" &&
      rootSym(p.symbol) !== rootSym(g.symbol),
  );
  const dualMiss = peerMiss.length > 0;

  const livePath = desk.scan.candidates.find((c) => {
    if (c.symbol !== g.symbol || c.side !== g.side) return false;
    if (!isHighProbPath(c)) return false;
    const z = parseZone(c.entryZone);
    if (!z) return true;
    const same =
      Math.abs(z.lo - g.entryLo) < 2 && Math.abs(z.hi - g.entryHi) < 2;
    return !same;
  });

  const why: string[] = [
    `Price printed ${px(printed)} without trading ${px(g.entryLo)}–${px(g.entryHi)} (${runPts.toFixed(1)}pt${runAtr ? ` · ${runAtr.toFixed(2)} ATR` : ""}). Limit in the array would not have filled.`,
    `HTF ${bias.topDown} · session ${bias.sessionStance}${bias.dealing?.zone ? ` · ${bias.dealing.zone}` : ""}${htfAgrees ? " · with the idea" : " · FIGHTS this card"}${sessAgrees ? "" : " · session disagrees"}. Last ${px(last)}.`,
  ];

  if (dualMiss) {
    why.push(
      `${g.symbol} and ${peerMiss[0]!.symbol} both ${g.side} missed — market-wide displacement, not a one-book late print.`,
    );
  }

  const smt =
    g.smtNote ||
    (desk.smtStack?.primary.active
      ? desk.smtStack.primary.note
      : desk.scan.smt.edge !== "none"
        ? desk.scan.smt.note
        : "");
  if (smt) why.push(`SMT ${smt}`);

  if (judasThen) {
    why.push(
      "Seen or resolved inside Judas 09:30–09:45 ET — cash-open raids often never retrace the array.",
    );
  }
  if (news.verdict !== "clear") why.push(`News ${news.verdict}: ${news.reason}`);

  const sweep = narr.liquidity.lastSweep;
  if (sweep && sweep !== "none") {
    why.push(
      `Last sweep ${sweep.toUpperCase()}${narr.liquidity.lastSweepLabel ? ` ${narr.liquidity.lastSweepLabel}` : ""} · ${narr.class} · ${narr.confirmation}.`,
    );
  }
  if (tape.displacement) {
    why.push(
      `Tape displacement already printed${tape.notes[0] ? ` (${tape.notes[0]})` : ""} — confirmation happened; entry is the retest, which never came.`,
    );
  }
  if (tape.ifvg) {
    why.push("Fresh IFVG still on the tape — that is the next array, not this zone.");
  }

  if (dirMagnet) {
    why.push(
      magnetSpent
        ? `Draw ${dirMagnet.name} ${px(dirMagnet.price)} is spent (last ${px(last)}).`
        : `Draw still ${dirMagnet.side} ${dirMagnet.name} ${px(dirMagnet.price)} · ${(dirMagnet.reachProbability * 100).toFixed(0)}% reach · ${Math.abs(dirMagnet.price - last).toFixed(1)}pt left.`,
    );
  }

  if (week) {
    why.push(`Week ${week.weekday}: ${week.dailyBias}.`);
  } else if (brief) {
    why.push(`Day ${brief.kind} · ${brief.verdict.replace("_", " ")} · ${brief.headline}`);
  }
  if (g.blocked.length) {
    why.push(`Card was already gated: ${g.blocked.slice(0, 2).join(" · ")}`);
  }
  if (cond.regime === "dead" || !cond.tradeable) {
    why.push(`Conditions ${cond.regime} / ${cond.volatility} — not tradeable.`);
  }

  const whatWorked = ["No chase — unfilled limit is not a trade"];
  if (!g.killzoneOk || g.blocked.length) {
    whatWorked.push("Process skip was already on");
  }
  if (htfAgrees && !magnetSpent) whatWorked.push("HTF idea is still intact");

  const whatFailed: string[] = [];
  if (judasThen) whatFailed.push("Judas displacement never offered the OTE");
  else if (news.verdict === "blackout") whatFailed.push("News impulse skipped the array");
  else whatFailed.push("Card printed late — displacement already underway");
  if (!htfAgrees) whatFailed.push("HTF did not agree with this card");

  let tag = "displacement, no fill";
  let headline = `${g.symbol} ${g.side} displacement skip — target ${px(printed)} with no fill`;
  let next: string;
  let lesson: string;

  if (judasNow || (judasThen && clock.etHour === 9 && clock.etMinute < 45)) {
    tag = "Judas, no retrace";
    headline = `${g.symbol} ${g.side} Judas dump — no retrace into the array`;
    next =
      "STAND until 09:45 ET. After the window, only a complete A+ on a NEW impulse IFVG. This zone is dead.";
    lesson = "Judas is for naming the raid, not for entries. The miss is the process working.";
  } else if (news.verdict === "blackout") {
    tag = "news impulse";
    headline = `${g.symbol} ${g.side} news impulse — no fill`;
    next = `${news.reason} Do not chase ${px(last)}. Next trade is after the blackout on a fresh array.`;
    lesson = "News expansions skip the OTE. Count the skip. Do not market-in.";
  } else if (!clock.inTradeWindow) {
    tag = "window closed";
    headline = `${g.symbol} ${g.side} missed the array — window done`;
    next = `Window closed (${clock.killzoneLabel}). Journal the skip. Do not drag this idea into ${clock.nextWindow}.`;
    lesson = "Unfilled plans die with the window.";
  } else if (magnetSpent) {
    tag = "draw spent";
    headline = `${g.symbol} ${g.side} delivered without you — magnet spent`;
    next = dirMagnet
      ? `Primary draw ${dirMagnet.name} ${px(dirMagnet.price)} already tagged. STAND. Do not fade this impulse. Next card only after a new raid + displacement + array.`
      : `Target ${px(g.tp1)} already printed. STAND. Do not chase leftover.`;
    lesson = "The move you wanted already happened. A miss here is not a late entry.";
  } else if (retracing) {
    tag = "retracing — not a late fill";
    headline = `${g.symbol} ${g.side} missed — price coming back, old card is still dead`;
    next = `Retrace toward ${px(g.entryLo)}–${px(g.entryHi)} is NOT a fill of this ticket (TP already printed at ${px(printed)}). If PATH re-arms on a new IFVG/OTE, that is a different trade. One book. Invalidation ${px(g.stop)}.`;
    lesson = "Do not get in late on a spent card. Re-grade the new array.";
  } else if (!htfAgrees) {
    tag = "HTF conflict";
    headline = `${g.symbol} ${g.side} ran without fill — HTF ${bias.topDown} fights the card`;
    next = `Re-read HTF before hunting a continuation ${g.side}. Session is ${bias.sessionStance}. If session agrees with the dump, bias may be flipping — do not fade and do not chase the old zone.`;
    lesson = "A missed counter-HTF card is not permission to reverse.";
  } else if (livePath) {
    tag = "new PATH after miss";
    headline = `${g.symbol} ${g.side} missed the first array — new PATH ${livePath.pathBand || livePath.grade} ${livePath.confluence.toFixed(2)}`;
    next = `Old zone is dead. Fresh card: ${livePath.entryZone} → ${livePath.targets[0] ?? "structure"}. Grade it as a new trade (HTF + array + window). One book.`;
    lesson = "The first miss does not license a chase. The new card has to pass the same gates.";
  } else {
    tag = "displacement, idea live";
    headline = `${g.symbol} ${g.side} displacement skip — idea live, this array is dead`;
    const mag = dirMagnet
      ? `Next magnet ${dirMagnet.name} ${px(dirMagnet.price)} (${(dirMagnet.reachProbability * 100).toFixed(0)}% reach).`
      : "Wait for the next opposing-liquidity magnet.";
    next = `HTF ${bias.topDown} still holds. ${mag} Wait for a NEW IFVG/OTE retrace. Do not chase ${px(last)}. Invalidation still ${px(g.stop)}. One book.`;
    lesson =
      "If you are not filled, you do not have a trade. The next array is the trade, not this print.";
  }

  if (dualMiss && !/one book/i.test(next)) {
    next += " Both books already ran — pick one if a new array forms (NQ usually leads).";
  }

  return {
    result: "missed",
    headline,
    why: why.slice(0, 6),
    whatWorked,
    whatFailed,
    lesson,
    next,
    tag,
  };
}

function analyzeExpired(g: GhostTrade, ctx: AnalyzeCtx): GhostAnalysis {
  const { desk, last } = ctx;
  const book = bookOf(desk, g.symbol);
  const bias = desk.bias[book];
  const invalidated = /invalidation/i.test(g.exitReason ?? "");
  const htfAgrees =
    (g.side === "short" && bias.topDown === "bear") ||
    (g.side === "long" && bias.topDown === "bull");

  if (invalidated) {
    return {
      result: "expired",
      headline: `${g.symbol} ${g.side} died — invalidation ${px(g.stop)} tagged with no fill`,
      tag: "invalidation, no fill",
      why: [
        `Stop side printed ${px(g.exitPrice ?? g.stop)} without trading ${px(g.entryLo)}–${px(g.entryHi)}.`,
        `HTF ${bias.topDown} · session ${bias.sessionStance}${htfAgrees ? " — idea was with HTF and still failed" : " — HTF already disagreed"}.`,
        "The array was wrong or already spent when the card printed.",
      ],
      whatWorked: ["Skip was a process win — you were not in a losing idea"],
      whatFailed: [`${g.strategy} never became a fill`, "Invalidation came first"],
      lesson: "When the stop-side prints first, the ticket is dead. Do not invert and chase.",
      next: `STAND. Last ${px(last)}. Re-read HTF before the next card. One book if a fresh PATH arms the other way.`,
    };
  }

  return {
    result: "expired",
    headline: `${g.symbol} ${g.side} expired — no fill into the close`,
    tag: "never filled",
    why: [
      "Session ended without a visit to the array.",
      `HTF ${bias.topDown} · session ${bias.sessionStance} · last ${px(last)}.`,
      desk.clock.killzoneLabel,
    ],
    whatWorked: ["No force-fill"],
    whatFailed: ["Idea went stale"],
    lesson: "Unfilled plans die at the cash close. Do not drag them into the next session.",
    next: `Journal the skip. Next session is a new card. Do not restore this zone (${px(g.entryLo)}–${px(g.entryHi)}).`,
  };
}

function analyze(g: GhostTrade, ctx?: AnalyzeCtx): GhostAnalysis {
  if (g.status === "missed") {
    return ctx
      ? analyzeMissed(g, ctx)
      : {
          result: "missed",
          headline: `${g.symbol} ${g.side} never retraced the zone — target printed anyway`,
          why: [
            `Price went to ${g.tp1.toFixed(2)} without trading ${g.entryLo.toFixed(2)}–${g.entryHi.toFixed(2)}.`,
            "That is a chase, not a setup. Limit in the array would not have filled.",
          ],
          whatWorked: ["Standing down was correct"],
          whatFailed: ["Card printed late, after displacement"],
          lesson:
            "If you are not filled, you do not have a trade. Count this as a clean skip.",
          tag: "target without fill",
        };
  }
  if (g.status === "expired") {
    return ctx
      ? analyzeExpired(g, ctx)
      : {
          result: "expired",
          headline: `${g.symbol} ${g.side} expired — no fill into the close`,
          why: ["Session ended without a visit to the array."],
          whatWorked: ["No force-fill"],
          whatFailed: ["Idea went stale"],
          lesson:
            "Unfilled plans die at the cash close. Do not drag them into the next session.",
          tag: "never filled",
        };
  }

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
      whatFailed: [`${g.strategy} did not deliver`, "Grade is probability, not a promise"],
      lesson: g.taken
        ? "Take the R, journal the miss on structure, do not add."
        : "You skipped and it failed — that skip was a process win. Keep doing that when the tape disagrees after entry.",
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
  const d = debriefGhost(g);
  if (d) pushDebrief(d);
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
  const resolved = rows.map((g) => {
    const book = bookOf(desk, g.symbol);
    const series = book === "left" ? desk.left : desk.right;
    const last = book === "left" ? desk.quotes.left.price : desk.quotes.right.price;
    return {
      before: g.status,
      last,
      updated: resolveAgainst(g, series.bars ?? [], last, now),
    };
  });
  const peers = resolved.map((x) => x.updated);
  const next: GhostTrade[] = [];
  for (const { before, last, updated } of resolved) {
    const terminal =
      updated.status === "won" ||
      updated.status === "lost" ||
      updated.status === "missed" ||
      updated.status === "expired";
    const stamped: GhostTrade = terminal
      ? {
          ...updated,
          analysis: analyze(updated, { desk, last, peers }),
        }
      : updated;
    if (stamped.status !== before && stamped.analysis) {
      rememberGhost(stamped);
    } else if (
      (stamped.status === "missed" || stamped.status === "expired") &&
      stamped.analysis &&
      (stamped.analysis.headline !== updated.analysis?.headline ||
        stamped.analysis.tag !== updated.analysis?.tag)
    ) {
      const d = debriefGhost(stamped);
      if (d) pushDebrief(d);
    }
    next.push(stamped);
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
