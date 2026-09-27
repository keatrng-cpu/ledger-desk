/**
 * The GO ledger — every side the scanner flashed GO, and how it settled.
 *
 * GO is a price comparison against an estimate; whether that comparison pays
 * is an empirical question, so the first GO print per contract is written
 * down (price, fair value, fee, pregame or live) and resolved from the final
 * score: held to settlement, one contract, after the entry fee. Ties settle
 * at 50¢ (the NFL contract terms). Browser storage, like the journal.
 */

import type { BoardGame } from "./board";
import type { ScanRow } from "./scanner";
import { feePerContract, type FeeModel, DEFAULT_FEES } from "./math";

// v2: the record restarts with the fixed rule (51685f6); v1 held six live GOs from the first rule that ESPN alone drove.
const KEY = "ledger.predict.go.v2";

export interface GoPrint {
  key: string;
  gameId: string;
  league: string;
  game: string;
  team: string;
  phase: "pre" | "in";
  at: string;
  ask: number;
  fair: number;
  fee: number;
  result?: 0 | 0.5 | 1;
  /** Held to settlement, one contract, after the entry fee. */
  pnl?: number;
}

export function loadGo(): GoPrint[] {
  if (typeof window === "undefined") return [];
  try {
    const rows = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as GoPrint[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function save(rows: GoPrint[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 1000)));
  } catch {
    /* storage full or blocked — the scanner still works, the record does not */
  }
}

/** Write the first GO print of each contract. Returns the rows that are new. */
export function recordGo(rows: ScanRow[], fees: FeeModel = DEFAULT_FEES, now = new Date().toISOString()): GoPrint[] {
  const have = loadGo();
  const seen = new Set(have.map((g) => g.key));
  const fresh: GoPrint[] = rows
    .filter((r) => r.word === "GO" && r.ask != null && r.fairLo != null && !seen.has(r.key))
    .map((r) => ({
      key: r.key,
      gameId: r.gameId,
      league: r.league,
      game: r.game,
      team: r.team,
      phase: r.phase,
      at: now,
      ask: r.ask as number,
      fair: r.fairLo as number,
      fee: Math.round(feePerContract(r.ask as number, 100, fees) * 10_000) / 10_000,
    }));
  if (fresh.length) save([...fresh, ...have]);
  return fresh;
}

/** Settle open prints whose game has gone final on the board. Pure over its inputs. */
export function settle(prints: GoPrint[], games: BoardGame[]): { rows: GoPrint[]; changed: number } {
  let changed = 0;
  const rows = prints.map((g) => {
    if (g.result != null) return g;
    const b = games.find((x) => x.game.id === g.gameId);
    if (!b || b.game.state !== "post") return g;
    const mine = b.game.home.code === g.team ? b.game.home : b.game.away.code === g.team ? b.game.away : null;
    const other = mine === b.game.home ? b.game.away : b.game.home;
    if (!mine || mine.score == null || other.score == null) return g;
    const result: 0 | 0.5 | 1 = mine.score > other.score ? 1 : mine.score < other.score ? 0 : 0.5;
    changed++;
    return { ...g, result, pnl: Math.round((result - g.ask - g.fee) * 10_000) / 10_000 };
  });
  return { rows, changed };
}

export function resolveGo(games: BoardGame[]): number {
  const { rows, changed } = settle(loadGo(), games);
  if (changed) save(rows);
  return changed;
}

export interface GoStats {
  n: number;
  settled: number;
  wins: number;
  /** Sum over settled prints, dollars per one contract each. */
  net: number;
  pre: number;
  live: number;
  line: string;
}

export function goStats(rows: GoPrint[] = loadGo()): GoStats {
  const done = rows.filter((g) => g.result != null);
  const net = Math.round(done.reduce((a, g) => a + (g.pnl ?? 0), 0) * 100) / 100;
  const wins = done.filter((g) => g.result === 1).length;
  return {
    n: rows.length,
    settled: done.length,
    wins,
    net,
    pre: rows.filter((g) => g.phase === "pre").length,
    live: rows.filter((g) => g.phase === "in").length,
    line:
      rows.length === 0
        ? "No GO yet — every GO is recorded here and settled from the final score."
        : `${rows.length} GO (${rows.filter((g) => g.phase === "pre").length} pregame, ${rows.filter((g) => g.phase === "in").length} live) · ${done.length} settled · ${wins} won · ${net >= 0 ? "+" : "−"}$${Math.abs(net).toFixed(2)} per contract held${done.length < 30 ? " — under 30 settled, this is noise" : ""}`,
  };
}
