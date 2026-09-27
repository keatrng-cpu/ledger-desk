/**
 * The Predict scanner — one row per side, one word per row, like the desk's
 * PATH scanner: GO (flashing) only when every must-layer passes.
 *
 * WHAT GO MEANS (trader's call 2026-09-27: "flash the ones I should trade")
 * The contract costs less than the conservative reference says it is worth,
 * after the venue's fees and a safety margin, and nothing the evidence warns
 * about is present. It does NOT say the team will win. The reference is an
 * estimate — DraftKings' price with its margin removed (the lowest of three
 * de-vig methods) before the game, ESPN's live model during it — so GO is a
 * price comparison, and the GO ledger (go-ledger.ts) records how every GO
 * settled: that record, not this comment, is the test of whether it pays.
 *
 * Must-layers, in order (the first failure is the one named):
 *   1. reference      a fair value exists
 *   2. price          ask ≤ the highest price clearing fees + margin (1¢ pregame, 3¢ live)
 *   3. longshot       ask ≥ 20¢ — Kalshi contracts ≤10¢ lost >60% after fees
 *   4. late game      not a sub-30¢ side in the final period (historically overpriced)
 *   5. liquidity      spread ≤ 3¢ and ≥ 100 contracts at the ask
 *   6. second market  Polymarket US (NFL) does not price it more than 1¢ under the ask
 *   7. QB news        pregame: no Questionable/Doubtful QB in the game before inactives
 *   8. held           live: the gap was there on the previous refresh too
 * LIMIT (pregame only): every layer but price passes and resting an order
 * between the bid and the limit price would clear — the number to rest.
 * Live games get no LIMIT: a resting order in a moving game fills mostly
 * when the news is bad for it.
 */

import type { BoardGame, SideRead } from "./board";
import { lateUnderdog, qbFlag } from "./board";
import { feePerContract, DEFAULT_FEES, type FeeModel } from "./math";
import { limitPriceFor } from "./sizing";

export type ScanWord = "GO" | "LIMIT" | "STAND";

export const SCAN = {
  marginPre: 0.01,
  marginLive: 0.03,
  longshotBelow: 0.2,
  maxSpread: 0.03,
  minDepth: 100,
  polyTolerance: 0.01,
} as const;

export interface ScanLayer {
  id: "reference" | "price" | "longshot" | "late" | "liquidity" | "second" | "qb" | "held";
  ok: boolean;
  detail: string;
}

export interface ScanRow {
  /** Kalshi ticker. */
  key: string;
  gameId: string;
  league: string;
  game: string;
  team: string;
  phase: "pre" | "in";
  clock: string;
  ask: number | null;
  bid: number | null;
  fairLo: number | null;
  fairHi: number | null;
  refName: string | null;
  /** Dollars per contract bought at the ask vs the conservative fair value, after fees. */
  gap: number | null;
  /** The most to pay: clears fees + the margin against fairLo. */
  limit: number | null;
  /** Sell when the bid reaches this range — the market then pays more than fair after the exit fee. */
  target: [number, number] | null;
  /** Dollars per contract if it settles YES, after the entry fee. */
  winPays: number | null;
  word: ScanWord;
  /** The first failing layer, in words. */
  missing: string | null;
  layers: ScanLayer[];
  analysis: string;
}

const c = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}¢`);
const pc = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const sc = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}¢`;
const ceilC = (x: number) => Math.ceil(x * 100 - 1e-9) / 100;

function inactivesDue(b: BoardGame): number | null {
  if (b.league !== "nfl") return null;
  const k = Date.parse(b.game.start);
  return Number.isFinite(k) ? k - 90 * 60_000 : null;
}

export function scanSide(b: BoardGame, s: SideRead, fees: FeeModel = DEFAULT_FEES, prevGap: number | null = null, now = Date.now()): ScanRow | null {
  const k = s.side;
  const phase = b.game.state === "in" ? "in" : b.game.state === "pre" ? "pre" : null;
  if (!k || !phase) return null;
  const live = phase === "in";
  const ask = k.ask != null && k.ask > 0 && k.ask < 1 ? k.ask : null;
  const bid = k.bid != null && k.bid > 0 && k.bid < 1 ? k.bid : null;
  const fairLo = s.reference;
  const fairHi = live ? s.reference : (s.bookRange?.[1] ?? s.reference);
  const margin = live ? SCAN.marginLive : SCAN.marginPre;
  const gap = ask != null && fairLo != null ? fairLo - ask - feePerContract(ask, 100, fees) : null;
  const limit = fairLo != null ? limitPriceFor(fairLo, 100, Math.round(margin * 100), fees) : null;
  const opp = s.team.code === b.game.home.code ? b.game.away.code : b.game.home.code;

  const spread = ask != null && bid != null ? ask - bid : null;
  const pm = s.poly?.bid != null && s.poly?.ask != null ? (s.poly.bid + s.poly.ask) / 2 : null;
  const due = inactivesDue(b);
  const qb = [qbFlag(b, s.team.code), qbFlag(b, opp)].find((x) => x && /Questionable|Doubtful/i.test(x)) ?? null;
  const dueAt = due != null ? new Date(due).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) : "";

  const layers: ScanLayer[] = [
    { id: "reference", ok: fairLo != null, detail: live ? "no live model probability for this game" : "no book line to price against" },
    {
      id: "price",
      ok: ask != null && limit != null && ask <= limit + 1e-9,
      detail: ask == null ? "no ask" : limit == null ? "no price clears fees + margin" : `ask ${c(ask)} is above the ${c(limit)} limit`,
    },
    { id: "longshot", ok: ask == null || ask >= SCAN.longshotBelow, detail: `ask ${c(ask)} is in the longshot zone (<20¢), where contracts lose the most` },
    { id: "late", ok: !lateUnderdog(b, s), detail: "sub-30¢ side in the final period — historically overpriced" },
    {
      id: "liquidity",
      ok: (spread == null || spread <= SCAN.maxSpread + 1e-9) && (k.askSize == null || k.askSize >= SCAN.minDepth),
      detail: spread != null && spread > SCAN.maxSpread + 1e-9 ? `spread ${c(spread)} is too wide` : `only ${Math.round(k.askSize ?? 0)} contracts at the ask`,
    },
    {
      id: "second",
      ok: pm == null || ask == null || pm >= ask - SCAN.polyTolerance - 1e-9,
      detail: `Polymarket prices it at ${pc(pm)} — more than 1¢ under the ${c(ask)} ask`,
    },
    {
      id: "qb",
      ok: live || !qb || due == null || now >= due,
      detail: `${qb ?? "QB"} — open until inactives ~${dueAt} ET`,
    },
    { id: "held", ok: !live || (prevGap != null && prevGap >= margin - 1e-9), detail: "live gap has to hold for a second refresh" },
  ];

  const failing = layers.filter((l) => !l.ok);
  let word: ScanWord = "STAND";
  if (!failing.length) word = "GO";
  else if (!live && failing.every((l) => l.id === "price") && limit != null && ask != null && limit < ask && (bid == null || limit >= bid)) word = "LIMIT";

  const target: [number, number] | null =
    fairLo != null && fairHi != null && fairLo > 0 && fairHi < 1
      ? [ceilC(fairLo + feePerContract(fairLo, 100, fees)), ceilC(fairHi + feePerContract(fairHi, 100, fees))]
      : null;

  const parts: string[] = [];
  if (fairLo != null && ask != null && gap != null) {
    const range = fairHi != null && fairHi - fairLo >= 0.0005 ? `${pc(fairLo)}–${pc(fairHi)}` : pc(fairLo);
    parts.push(`${s.referenceName ?? "reference"} ${range} vs ask ${c(ask)}: ${sc(gap)}/contract after ${fees.label} fees`);
  }
  if (s.poly?.ask != null) parts.push(`Polymarket ${c(s.poly.bid)}/${c(s.poly.ask)}`);
  if (!live && s.book != null && s.bookOpen != null && Math.abs(s.book - s.bookOpen) >= 0.005) {
    parts.push(`line ${s.book > s.bookOpen ? "+" : "−"}${Math.abs((s.book - s.bookOpen) * 100).toFixed(1)} pts since open`);
  }
  if (k.askSize != null) parts.push(`${k.askSize >= 1000 ? `${Math.round(k.askSize / 1000)}K` : Math.round(k.askSize)} at the ask`);
  if (live) parts.push("ESPN's live model is the reference — live gaps often close by the model catching up, not the price");

  return {
    key: k.ticker,
    gameId: b.game.id,
    league: b.league,
    game: `${b.game.away.code} @ ${b.game.home.code}`,
    team: s.team.code,
    phase,
    clock: b.game.detail,
    ask,
    bid,
    fairLo,
    fairHi,
    refName: s.referenceName,
    gap: gap == null ? null : Math.round(gap * 10_000) / 10_000,
    limit,
    target,
    winPays: ask != null ? Math.round((1 - ask - feePerContract(ask, 100, fees)) * 10_000) / 10_000 : null,
    word,
    missing: failing[0]?.detail ?? null,
    layers,
    analysis: parts.join(" · "),
  };
}

const RANK: Record<ScanWord, number> = { GO: 0, LIMIT: 1, STAND: 2 };

/** Every priced side of every pregame and live game, GO first, then by gap. */
export function scanBoard(games: BoardGame[], fees: FeeModel = DEFAULT_FEES, prevGaps: Map<string, number> = new Map(), now = Date.now()): ScanRow[] {
  const rows: ScanRow[] = [];
  for (const b of games) {
    for (const s of [b.away, b.home]) {
      const r = scanSide(b, s, fees, s.side ? (prevGaps.get(s.side.ticker) ?? null) : null, now);
      if (r) rows.push(r);
    }
  }
  return rows.sort((x, y) => RANK[x.word] - RANK[y.word] || (y.gap ?? -9) - (x.gap ?? -9));
}

export interface ScanStats {
  scanned: number;
  go: number;
  limit: number;
  live: number;
  /** Mean |Kalshi midpoint − book| across pregame sides: how close the exchange sits to the book. */
  marketVsBook: number | null;
  closest: ScanRow | null;
}

export function scanStats(rows: ScanRow[], games: BoardGame[]): ScanStats {
  const diffs = games
    .filter((b) => b.game.state === "pre")
    .flatMap((b) => [b.away, b.home])
    .filter((s) => s.market != null && s.book != null)
    .map((s) => Math.abs((s.market as number) - (s.book as number)));
  return {
    scanned: rows.length,
    go: rows.filter((r) => r.word === "GO").length,
    limit: rows.filter((r) => r.word === "LIMIT").length,
    live: rows.filter((r) => r.phase === "in").length,
    marketVsBook: diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null,
    closest: rows.find((r) => r.word !== "GO" && r.gap != null) ?? null,
  };
}
