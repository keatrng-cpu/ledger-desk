/**
 * Persistent paper trading account — equity and stats that actually hold.
 * Source of truth: desk-memory.book (+ localStorage). Survives refresh.
 */

import {
  loadDeskMemory,
  saveDeskMemory,
  type DeskMemoryState,
} from "./desk-memory";
import { APLUS_RULES } from "@/lib/aplus/config";

export const PAPER_START_EQUITY = APLUS_RULES.paperEquity; // 100_000

export interface PaperAccountSnapshot {
  equity: number;
  startEquity: number;
  peakEquity: number;
  sumR: number;
  sumUsd: number;
  pathTaken: number;
  pathWins: number;
  pathLosses: number;
  winRate: number | null;
  expectancyR: number | null;
  drawdownPct: number;
  /** One-click paper fills only */
  paperTaken: number;
  paperWins: number;
  paperSumR: number;
  paperSumUsd: number;
  paperWinRate: number | null;
  openPaperCount: number;
  lastPaperLabel?: string;
  lastBacktestLabel?: string;
  lastBacktestWr?: number | null;
  lastBacktestSumR?: number | null;
  lastBacktestSumUsd?: number | null;
  updatedAt: number;
}

function peakFromState(state: DeskMemoryState): number {
  const p = state.book.peakEquity;
  if (typeof p === "number" && p > 0) return p;
  return Math.max(state.book.equity, PAPER_START_EQUITY);
}

export function getPaperAccount(state?: DeskMemoryState): PaperAccountSnapshot {
  const s = state ?? loadDeskMemory();
  const equity = s.book.equity > 0 ? s.book.equity : PAPER_START_EQUITY;
  const peak = peakFromState(s);
  const wr =
    s.book.pathTaken > 0 ? s.book.pathWins / s.book.pathTaken : null;
  const exp =
    s.book.pathTaken > 0 ? s.book.sumR / s.book.pathTaken : null;
  const dd =
    peak > 0 ? Math.max(0, ((peak - equity) / peak) * 100) : 0;
  const paperTaken = s.book.paperTaken ?? 0;
  const paperWins = s.book.paperWins ?? 0;
  return {
    equity,
    startEquity: s.book.startEquity || PAPER_START_EQUITY,
    peakEquity: peak,
    sumR: s.book.sumR,
    sumUsd: s.book.sumUsd,
    pathTaken: s.book.pathTaken,
    pathWins: s.book.pathWins,
    pathLosses: s.book.pathLosses,
    winRate: wr,
    expectancyR: exp,
    drawdownPct: Math.round(dd * 100) / 100,
    paperTaken,
    paperWins,
    paperSumR: s.book.paperSumR ?? 0,
    paperSumUsd: s.book.paperSumUsd ?? 0,
    paperWinRate: paperTaken > 0 ? paperWins / paperTaken : null,
    openPaperCount: s.book.openPaperCount ?? 0,
    lastPaperLabel: s.book.lastPaperLabel,
    lastBacktestLabel: s.book.lastBacktestLabel,
    lastBacktestWr: s.book.lastBacktestWr,
    lastBacktestSumR: s.book.lastBacktestSumR,
    lastBacktestSumUsd: s.book.lastBacktestSumUsd ?? null,
    updatedAt: s.book.updatedAt,
  };
}

/** Apply closed trade PnL to paper equity (and peak). */
export function applyPaperPnl(usd: number, r?: number): PaperAccountSnapshot {
  const state = loadDeskMemory();
  const next = Math.max(
    100,
    Math.round((state.book.equity + usd) * 100) / 100,
  );
  state.book.equity = next;
  state.book.peakEquity = Math.max(peakFromState(state), next);
  if (r != null && Number.isFinite(r)) {
    /* rates already handled by ingest */
  }
  state.book.updatedAt = Date.now();
  saveDeskMemory(state);
  return getPaperAccount(state);
}

/** Reset paper book to start (keep rates optional). */
export function resetPaperAccount(opts?: {
  keepRates?: boolean;
}): PaperAccountSnapshot {
  const state = loadDeskMemory();
  state.book.equity = PAPER_START_EQUITY;
  state.book.peakEquity = PAPER_START_EQUITY;
  state.book.startEquity = PAPER_START_EQUITY;
  state.book.pathTaken = 0;
  state.book.pathWins = 0;
  state.book.pathLosses = 0;
  state.book.sumR = 0;
  state.book.sumUsd = 0;
  state.book.paperTaken = 0;
  state.book.paperWins = 0;
  state.book.paperLosses = 0;
  state.book.paperSumR = 0;
  state.book.paperSumUsd = 0;
  state.book.lastPaperLabel = undefined;
  state.book.lastPaperR = undefined;
  state.book.lastPaperUsd = undefined;
  state.book.openPaperCount = 0;
  state.book.lastBacktestLabel = undefined;
  state.book.lastBacktestPath = undefined;
  state.book.lastBacktestWr = undefined;
  state.book.lastBacktestSumR = undefined;
  state.book.lastBacktestSumUsd = undefined;
  state.book.updatedAt = Date.now();
  if (!opts?.keepRates) {
    state.rates = {
      byStrategy: {},
      byBand: {},
      bySide: {},
      bySymbol: {},
      gold: { n: 0, wins: 0, sumR: 0 },
      recentFills: [],
    };
  }
  saveDeskMemory(state);
  return getPaperAccount(state);
}

export function formatPaperChip(s?: PaperAccountSnapshot): string {
  const a = s ?? getPaperAccount();
  const pnl = a.equity - a.startEquity;
  const pnlStr = `${pnl >= 0 ? "+" : ""}$${Math.round(pnl).toLocaleString()}`;
  const live =
    a.paperTaken > 0
      ? ` · live ${a.paperTaken} WR ${
          a.paperWinRate != null
            ? (a.paperWinRate * 100).toFixed(0) + "%"
            : "—"
        } ΣR ${a.paperSumR >= 0 ? "+" : ""}${a.paperSumR.toFixed(1)}`
      : " · live 0";
  const open = a.openPaperCount > 0 ? ` · OPEN ${a.openPaperCount}` : "";
  return `Paper $${Math.round(a.equity).toLocaleString()} (${pnlStr})${live}${open}`;
}
