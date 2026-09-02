/**
 * Post-trade debrief — summary, why it worked/failed, stats, memory.
 * Fired on paper close and ghost miss/expire/win/loss.
 */

import { loadDeskMemory, type RateBucket } from "./desk-memory";
import type { PaperTrade } from "./paper-manager";
import type { GhostTrade } from "./ghost-book";
import { getPaperAccount } from "./paper-account";

export type DebriefResult = "win" | "loss" | "miss" | "skip";

export interface TradeDebrief {
  id: string;
  at: number;
  source: "paper" | "ghost";
  result: DebriefResult;
  headline: string;
  symbol: string;
  side: string;
  strategy: string;
  grade: string;
  r: number | null;
  usd: number | null;
  exit: string;
  entry?: number;
  exitPx?: number;
  why: string[];
  worked: string[];
  failed: string[];
  lesson: string;
  /** Live next-action after a miss — from ghost analysis. */
  next?: string;
  stats: {
    paperN: number;
    paperWr: number | null;
    paperSumR: number;
    equity: number;
    stratN: number;
    stratWr: number | null;
    sideN: number;
    sideWr: number | null;
  };
}

const KEY = "ledger.debrief.v1";
const EVENT = "ledger-debrief";
const MAX = 40;

function wrOf(b: RateBucket | undefined): number | null {
  if (!b || b.n < 1) return null;
  return b.wins / b.n;
}

function statsFor(strategy: string, side: string): TradeDebrief["stats"] {
  const mem = loadDeskMemory();
  const acc = getPaperAccount(mem);
  const strat = mem.rates.byStrategy[strategy];
  const sideB = mem.rates.bySide[side];
  return {
    paperN: acc.paperTaken,
    paperWr: acc.paperWinRate,
    paperSumR: acc.paperSumR,
    equity: acc.equity,
    stratN: strat?.n ?? 0,
    stratWr: wrOf(strat),
    sideN: sideB?.n ?? 0,
    sideWr: wrOf(sideB),
  };
}

export function loadDebriefs(): TradeDebrief[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TradeDebrief[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function loadLastDebrief(): TradeDebrief | null {
  return loadDebriefs()[0] ?? null;
}

export function pushDebrief(d: TradeDebrief): void {
  if (typeof window === "undefined") return;
  const rows = loadDebriefs().filter((x) => x.id !== d.id);
  rows.unshift(d);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows.slice(0, MAX)));
  } catch {
    /* quota */
  }
  window.dispatchEvent(new Event(EVENT));
  window.dispatchEvent(new Event("ledger-memory"));
}

export function subscribeDebriefs(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT, fn);
  window.addEventListener("ledger-paper", fn);
  window.addEventListener("ledger-ghost", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("ledger-paper", fn);
    window.removeEventListener("ledger-ghost", fn);
  };
}

export function debriefPaper(t: PaperTrade): TradeDebrief {
  const r = t.rMultiple ?? 0;
  const usd = t.pnlUsd ?? 0;
  const win = usd > 0;
  const result: DebriefResult = win ? "win" : "loss";
  const rTxt = `${r >= 0 ? "+" : ""}${r.toFixed(2)}R`;
  const $txt = `${usd >= 0 ? "+" : ""}$${usd.toFixed(0)}`;
  const exit = t.exitReason || "close";
  const mfe = t.mfeR;
  const scaled = t.scaleLegs.some((l) => /tp1/i.test(l.note));
  const be = /be/i.test(exit) || t.scaleLegs.some((l) => /be/i.test(l.note));

  const why: string[] = [
    `${t.displaySymbol} ${t.side} ${t.grade} ${t.strategy} · ${t.entry} → ${t.exit ?? "?"} · ${exit}`,
  ];
  const worked: string[] = [];
  const failed: string[] = [];
  let lesson: string;

  if (win && /tp|target|structure/i.test(exit)) {
    why.push(
      `Draw paid. Stop ${t.stop} never tagged. Target ${t.tp1}${t.tp2 ? ` / ${t.tp2}` : ""} printed.`,
    );
    worked.push(`${t.strategy} sequence delivered`);
    worked.push("Risk stayed defined — invalidation untouched");
    if (scaled) worked.push("Scale 50% @ 1R then runner");
    lesson =
      "This is the template: array → fill → 1R scale → draw. Size the next same-model A/A+ the same way.";
  } else if (win && be) {
    why.push("Scaled at +1R, remainder scratched at BE. Net still green after commission.");
    worked.push("Risk-off at 1R did its job");
    failed.push("Runner did not reach TP2 — leave a runner, don't give it back");
    lesson = "Banking 1R is a process win. Do not move the leftover stop past BE.";
  } else if (!win && /stop/i.test(exit)) {
    why.push(
      `Invalidation ${t.workingStop} tagged before target ${t.tp1}. Grade is probability, not a promise.`,
    );
    if (mfe != null && mfe >= 0.5) {
      why.push(`MFE ${mfe.toFixed(2)}R — idea was working, then failed. Trail/BE was late or the raid continued.`);
      worked.push(`Got to +${mfe.toFixed(2)}R before the stop`);
      failed.push("Did not lock enough at 1R / BE before reversal");
      lesson =
        "If MFE ≥ 0.5R and you still full-stop, the next same model must scale or BE sooner — do not add.";
    } else {
      worked.push("Stop did its job — defined −1R");
      failed.push(`${t.strategy} did not deliver from ${t.entry}`);
      lesson =
        "Take the R. Journal the miss on structure. Next card only if HTF + sweep still align — never revenge.";
    }
  } else if (/time|session|flatten|news/i.test(exit)) {
    why.push(`Context/time stop: ${exit}. Plan was not allowed to bleed into the next window.`);
    worked.push("Time stop prevented overnight/news risk");
    if (!win) failed.push("No progress into the killzone close");
    lesson = "Unfinished ideas die with the window. Do not drag them into lunch or the next day.";
  } else {
    why.push(`Closed ${exit} at ${t.exit ?? "?"}.`);
    if (win) worked.push("Net green after costs");
    else failed.push("Manual/other exit was red");
    lesson = win
      ? "Booked. Review the tape vs the thesis before the next card."
      : "Red exit. Size stays at grade until the model WR recovers.";
  }

  const headline = win
    ? `PAPER WIN ${t.displaySymbol} ${t.side.toUpperCase()} ${rTxt} (${$txt}) — ${exit}`
    : `PAPER LOSS ${t.displaySymbol} ${t.side.toUpperCase()} ${rTxt} (${$txt}) — ${exit}`;

  return {
    id: `paper-${t.id}`,
    at: t.closedAt ?? Date.now(),
    source: "paper",
    result,
    headline,
    symbol: t.displaySymbol,
    side: t.side,
    strategy: t.strategy,
    grade: t.grade,
    r,
    usd,
    exit,
    entry: t.entry,
    exitPx: t.exit,
    why,
    worked: worked.filter(Boolean),
    failed: failed.filter(Boolean),
    lesson,
    stats: statsFor(t.strategy, t.side),
  };
}

export function debriefGhost(g: GhostTrade): TradeDebrief | null {
  if (!g.analysis) return null;
  const a = g.analysis;
  const result: DebriefResult =
    g.status === "won"
      ? "win"
      : g.status === "lost"
        ? "loss"
        : g.status === "missed"
          ? "miss"
          : "skip";
  return {
    id: `ghost-${g.id}-${g.status}`,
    at: g.exitAt ?? Date.now(),
    source: "ghost",
    result,
    headline: g.taken
      ? a.headline
      : `${a.headline}${result === "miss" || result === "skip" ? " (not taken)" : " (ghost)"}`,
    symbol: g.symbol,
    side: g.side,
    strategy: g.strategy,
    grade: g.grade,
    r: g.r ?? null,
    usd: null,
    exit: g.exitReason || g.status,
    entry: g.fillPrice ?? g.entry,
    exitPx: g.exitPrice,
    why: a.why,
    worked: a.whatWorked,
    failed: a.whatFailed,
    lesson: a.lesson,
    next: a.next,
    stats: statsFor(g.strategy, g.side),
  };
}

export function debriefSkip(opts: {
  symbol: string;
  side: string;
  strategy: string;
  grade: string;
  reason: string;
}): TradeDebrief {
  const d: TradeDebrief = {
    id: `skip-${opts.symbol}-${opts.side}-${Date.now()}`,
    at: Date.now(),
    source: "ghost",
    result: "skip",
    headline: `SKIP ${opts.symbol} ${opts.side.toUpperCase()} ${opts.grade} — process win`,
    symbol: opts.symbol,
    side: opts.side,
    strategy: opts.strategy,
    grade: opts.grade,
    r: 0,
    usd: 0,
    exit: "skip",
    why: [opts.reason || "Trader stood down. Missing confluence or window closed."],
    worked: ["No forced fill"],
    failed: [],
    lesson: "Skips on dirty tape are wins for process. Journal them.",
    stats: statsFor(opts.strategy, opts.side),
  };
  return d;
}
