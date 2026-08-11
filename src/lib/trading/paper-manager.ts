/**
 * One-click paper trading + auto management from live desk prices.
 * No auth required — localStorage book. Optional server journal when logged in.
 *
 * System rules:
 * - Entry at zone mid (key area)
 * - Stop from invalidation, clamped to day-trade max risk
 * - Target ≥ 1R (prefer structure target if valid)
 * - Size from grade × paper equity (micros)
 * - Scale-out: 50% @ +1R → BE, runner @ +2R / TP2
 * - Exit when live print hits stop / targets
 */

import {
  APLUS_RULES,
  CONTRACTS,
  sizeContracts,
  type ContractKey,
  type RiskGrade,
} from "@/lib/aplus/config";
import type { SetupCandidate } from "./scanner";
import { getPaperAccount, applyPaperPnl, PAPER_START_EQUITY } from "./paper-account";
import { MAX_RISK_PTS } from "./simulate-path-trade";
import { rememberLiveSetup } from "./desk-memory";

const STORAGE_KEY = "ledger-paper-trades-v1";

export type PaperStatus = "open" | "closed";

export interface PaperTrade {
  id: string;
  symbol: ContractKey;
  displaySymbol: string;
  side: "long" | "short";
  status: PaperStatus;
  entry: number;
  stop: number;
  /** Working stop (moves to BE after TP1) */
  workingStop: number;
  tp1: number;
  tp2: number;
  contracts: number;
  contractsOpen: number;
  riskPts: number;
  riskPct: number;
  riskDollars: number;
  grade: string;
  score: number;
  strategy: string;
  openedAt: number;
  closedAt?: number;
  exit?: number;
  exitReason?: string;
  rMultiple?: number;
  pnlUsd?: number;
  scaleLegs: { at: string; price: number; contracts: number; r: number; note: string }[];
  reason: string;
  pathBand?: string;
}

function parseNums(text: string | undefined | null): number[] {
  if (!text) return [];
  return [...text.matchAll(/(\d{3,7}(?:\.\d+)?)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function zoneMid(entryZone: string): number | null {
  const nums = parseNums(entryZone);
  if (nums.length >= 2) return (nums[0]! + nums[1]!) / 2;
  if (nums.length === 1) return nums[0]!;
  return null;
}

function firstPrice(s: string | undefined): number | null {
  const n = parseNums(s)[0];
  return n ?? null;
}

function tickRound(symbol: string, px: number): number {
  const key = (symbol in CONTRACTS ? symbol : "MNQ") as ContractKey;
  const tick = CONTRACTS[key]?.tick ?? 0.25;
  return Math.round(px / tick) * tick;
}

function resolveContractSymbol(symbol: string): ContractKey {
  const key = (symbol in CONTRACTS ? symbol : "MNQ") as ContractKey;
  if (APLUS_RULES.useMicros) {
    const micro = CONTRACTS[key].micro as ContractKey;
    if (micro in CONTRACTS) return micro;
  }
  return key;
}

export interface BuiltPaperLevels {
  symbol: ContractKey;
  displaySymbol: string;
  side: "long" | "short";
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  riskPts: number;
  contracts: number;
  riskPct: number;
  riskDollars: number;
  grade: RiskGrade | string;
}

/**
 * Build correct key-area levels + contract size from a scanner setup.
 */
export function buildPaperLevels(
  c: SetupCandidate,
  equity?: number,
  lastPrice?: number,
): BuiltPaperLevels {
  const displaySymbol = c.symbol;
  const symbol = resolveContractSymbol(c.symbol);
  const side = c.side;
  const eq = equity ?? getPaperAccount().equity ?? PAPER_START_EQUITY;

  let entry =
    zoneMid(c.entryZone) ??
    firstPrice(c.entryZone) ??
    lastPrice ??
    0;

  // Prefer live mid if zone is far from last print (stale array)
  if (lastPrice != null && entry > 0) {
    const dist = Math.abs(entry - lastPrice);
    const maxRisk = MAX_RISK_PTS[c.symbol] ?? MAX_RISK_PTS[symbol] ?? 48;
    if (dist > maxRisk * 1.5) {
      entry = lastPrice; // enter at market / key print near array
    }
  }

  const inv = firstPrice(c.invalidation);
  const maxRisk =
    MAX_RISK_PTS[c.symbol] ?? MAX_RISK_PTS[symbol] ?? DEFAULT_MAX(symbol);

  let stop: number;
  if (inv != null) {
    stop =
      side === "long"
        ? Math.min(inv, entry - entry * 0.0004)
        : Math.max(inv, entry + entry * 0.0004);
  } else {
    const pad = Math.min(maxRisk * 0.5, entry * 0.001);
    stop = side === "long" ? entry - pad : entry + pad;
  }

  let riskPts = Math.abs(entry - stop);
  if (riskPts < entry * 0.0004) {
    riskPts = Math.max(maxRisk * 0.25, entry * 0.0006);
    stop = side === "long" ? entry - riskPts : entry + riskPts;
  }
  if (riskPts > maxRisk) {
    riskPts = maxRisk;
    stop = side === "long" ? entry - riskPts : entry + riskPts;
  }

  // Targets: prefer structure if ≥ 0.9R and ≤ tpMaxR, else synthetic 1R/2R
  const t1raw = firstPrice(c.targets[0]);
  const t2raw = firstPrice(c.targets[1]);
  let tp1 = side === "long" ? entry + riskPts : entry - riskPts;
  let tp2 = side === "long" ? entry + riskPts * 2 : entry - riskPts * 2;

  if (t1raw != null) {
    const ok = side === "long" ? t1raw > entry : t1raw < entry;
    const r = Math.abs(t1raw - entry) / riskPts;
    if (ok && r >= 0.9 && r <= APLUS_RULES.tpMaxR) tp1 = t1raw;
  }
  if (t2raw != null) {
    const ok = side === "long" ? t2raw > entry : t2raw < entry;
    const r = Math.abs(t2raw - entry) / riskPts;
    if (ok && r > Math.abs(tp1 - entry) / riskPts && r <= APLUS_RULES.tpMaxR) {
      tp2 = t2raw;
    }
  }

  // Critical: target must be correct side of entry (fixes inverted target bugs)
  if (side === "short" && tp1 >= entry) tp1 = entry - riskPts;
  if (side === "long" && tp1 <= entry) tp1 = entry + riskPts;
  if (side === "short" && tp2 >= tp1) tp2 = entry - riskPts * 2;
  if (side === "long" && tp2 <= tp1) tp2 = entry + riskPts * 2;

  entry = tickRound(symbol, entry);
  stop = tickRound(symbol, stop);
  tp1 = tickRound(symbol, tp1);
  tp2 = tickRound(symbol, tp2);
  riskPts = Math.abs(entry - stop);

  const grade = (c.riskGrade || c.pathBand || c.grade || "A-") as RiskGrade;
  const sizing = sizeContracts({
    symbol,
    riskPts,
    equity: eq,
    gradeOrScore: grade === "skip" ? "B+" : grade,
  });

  return {
    symbol,
    displaySymbol,
    side,
    entry,
    stop,
    tp1,
    tp2,
    riskPts,
    contracts: Math.max(1, sizing.contracts),
    riskPct: sizing.riskPct,
    riskDollars: sizing.riskDollars,
    grade,
  };
}

function DEFAULT_MAX(symbol: string): number {
  if (symbol.includes("ES") || symbol === "MES") return 18;
  return 48;
}

export function loadPaperTrades(): PaperTrade[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PaperTrade[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePaperTrades(trades: PaperTrade[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trades.slice(0, 200)));
  window.dispatchEvent(new Event("ledger-paper"));
  window.dispatchEvent(new Event("ledger-memory"));
}

export function listOpenPaperTrades(): PaperTrade[] {
  return loadPaperTrades().filter((t) => t.status === "open");
}

/**
 * One-click open paper trade from setup — no dialog.
 */
export function openPaperTradeInstant(
  c: SetupCandidate,
  opts?: { lastPrice?: number; killzone?: string },
): { ok: true; trade: PaperTrade } | { ok: false; error: string } {
  try {
    const levels = buildPaperLevels(c, getPaperAccount().equity, opts?.lastPrice);
    if (!levels.entry || !levels.stop) {
      return { ok: false, error: "Could not resolve entry/stop from setup" };
    }
    // Validate geometry
    if (levels.side === "long" && levels.stop >= levels.entry) {
      return { ok: false, error: "Stop not below entry for long" };
    }
    if (levels.side === "short" && levels.stop <= levels.entry) {
      return { ok: false, error: "Stop not above entry for short" };
    }
    if (levels.side === "long" && levels.tp1 <= levels.entry) {
      return { ok: false, error: "Target not above entry for long" };
    }
    if (levels.side === "short" && levels.tp1 >= levels.entry) {
      return { ok: false, error: "Target not below entry for short" };
    }

    const trade: PaperTrade = {
      id: `paper-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      symbol: levels.symbol,
      displaySymbol: levels.displaySymbol,
      side: levels.side,
      status: "open",
      entry: levels.entry,
      stop: levels.stop,
      workingStop: levels.stop,
      tp1: levels.tp1,
      tp2: levels.tp2,
      contracts: levels.contracts,
      contractsOpen: levels.contracts,
      riskPts: levels.riskPts,
      riskPct: levels.riskPct,
      riskDollars: levels.riskDollars,
      grade: String(levels.grade),
      score: c.confluence,
      strategy: c.completeStrategy || c.strategyPrimary || "—",
      openedAt: Date.now(),
      scaleLegs: [],
      reason: [
        c.title,
        `strategy:${c.completeStrategy || c.strategyPrimary || "—"}`,
        `band:${c.pathBand || c.grade}`,
        opts?.killzone ? `kz:${opts.killzone}` : null,
        "mode:paper auto",
      ]
        .filter(Boolean)
        .join(" · "),
      pathBand: c.pathBand,
    };

    const all = loadPaperTrades();
    all.unshift(trade);
    savePaperTrades(all);

    rememberLiveSetup({
      symbol: trade.displaySymbol,
      side: trade.side,
      grade: c.grade,
      score: c.confluence,
      mode: "paper",
    });

    return { ok: true, trade };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Paper open failed",
    };
  }
}

function pointValue(symbol: ContractKey): number {
  return CONTRACTS[symbol]?.pointValue ?? 2;
}

function commission(symbol: ContractKey): number {
  return CONTRACTS[symbol]?.commission ?? 1;
}

/**
 * Manage open paper trades against a live price print.
 * Applies scale-out + BE + full exit when levels hit.
 */
export function managePaperTradesAgainstPrice(
  prices: Partial<Record<string, number>>,
): { closed: PaperTrade[]; updated: PaperTrade[] } {
  const all = loadPaperTrades();
  const closed: PaperTrade[] = [];
  const updated: PaperTrade[] = [];
  const so = APLUS_RULES.scaleOut;

  for (const t of all) {
    if (t.status !== "open") continue;
    const px =
      prices[t.displaySymbol] ??
      prices[t.symbol] ??
      prices[t.displaySymbol.replace(/^M/, "")] ??
      null;
    if (px == null || !Number.isFinite(px)) continue;

    let dirty = false;
    const sign = t.side === "long" ? 1 : -1;
    const rPts = (price: number) => (sign * (price - t.entry)) / t.riskPts;

    // Stop hit (working stop)
    const stopHit =
      t.side === "long" ? px <= t.workingStop : px >= t.workingStop;
    if (stopHit && t.contractsOpen > 0) {
      const r = rPts(t.workingStop);
      const legUsd =
        sign *
        (t.workingStop - t.entry) *
        pointValue(t.symbol) *
        t.contractsOpen;
      const fee = commission(t.symbol) * t.contractsOpen;
      const pnl = legUsd - fee;
      t.scaleLegs.push({
        at: new Date().toISOString(),
        price: t.workingStop,
        contracts: t.contractsOpen,
        r,
        note: t.workingStop === t.entry || Math.abs(t.workingStop - t.entry) < 0.01
          ? "BE stop"
          : "stop",
      });
      t.contractsOpen = 0;
      t.status = "closed";
      t.closedAt = Date.now();
      t.exit = t.workingStop;
      t.exitReason =
        Math.abs(r) < 0.05 ? "be_stop" : r < 0 ? "stop" : "trail_stop";
      // Weighted R from all legs
      const totalR = t.scaleLegs.reduce(
        (s, l) => s + l.r * (l.contracts / t.contracts),
        0,
      );
      const totalUsd = t.scaleLegs.reduce((s, l) => {
        const u =
          sign * (l.price - t.entry) * pointValue(t.symbol) * l.contracts;
        return s + u - commission(t.symbol) * l.contracts;
      }, 0);
      t.rMultiple = +totalR.toFixed(3);
      t.pnlUsd = +totalUsd.toFixed(2);
      applyPaperPnl(t.pnlUsd, t.rMultiple);
      closed.push(t);
      dirty = true;
      continue;
    }

    // TP1 scale-out
    const tp1Hit =
      t.side === "long" ? px >= t.tp1 : px <= t.tp1;
    const alreadyTp1 = t.scaleLegs.some((l) => l.note.includes("TP1"));
    if (so.enabled && tp1Hit && !alreadyTp1 && t.contractsOpen >= 1) {
      const closeN =
        t.contractsOpen >= 2
          ? Math.max(1, Math.floor(t.contractsOpen * so.tp1Fraction))
          : 0; // single contract: hold for BE path via full TP
      if (closeN > 0) {
        const r = rPts(t.tp1);
        t.scaleLegs.push({
          at: new Date().toISOString(),
          price: t.tp1,
          contracts: closeN,
          r,
          note: "TP1 scale-out → BE",
        });
        t.contractsOpen -= closeN;
        if (so.moveStopToBeAfterTp1) {
          t.workingStop = t.entry + sign * (so.beBufferR * t.riskPts);
        }
        dirty = true;
      }
    }

    // TP2 / runner
    const tp2Hit =
      t.side === "long" ? px >= t.tp2 : px <= t.tp2;
    if (tp2Hit && t.contractsOpen > 0) {
      const r = rPts(t.tp2);
      t.scaleLegs.push({
        at: new Date().toISOString(),
        price: t.tp2,
        contracts: t.contractsOpen,
        r,
        note: "TP2 runner",
      });
      t.contractsOpen = 0;
      t.status = "closed";
      t.closedAt = Date.now();
      t.exit = t.tp2;
      t.exitReason = alreadyTp1 || t.scaleLegs.some((l) => l.note.includes("TP1"))
        ? "tp1_tp2"
        : "tp2";
      const totalR = t.scaleLegs.reduce(
        (s, l) => s + l.r * (l.contracts / t.contracts),
        0,
      );
      const totalUsd = t.scaleLegs.reduce((s, l) => {
        const u =
          sign * (l.price - t.entry) * pointValue(t.symbol) * l.contracts;
        return s + u - commission(t.symbol) * l.contracts;
      }, 0);
      t.rMultiple = +totalR.toFixed(3);
      t.pnlUsd = +totalUsd.toFixed(2);
      applyPaperPnl(t.pnlUsd, t.rMultiple);
      closed.push(t);
      dirty = true;
      continue;
    }

    // Single-contract: full close at TP1 if scale can't split
    if (
      so.enabled &&
      tp1Hit &&
      t.contracts === 1 &&
      t.contractsOpen === 1 &&
      !t.scaleLegs.length
    ) {
      const r = rPts(t.tp1);
      t.scaleLegs.push({
        at: new Date().toISOString(),
        price: t.tp1,
        contracts: 1,
        r,
        note: "TP1 full (1ct)",
      });
      t.contractsOpen = 0;
      t.status = "closed";
      t.closedAt = Date.now();
      t.exit = t.tp1;
      t.exitReason = "tp1";
      t.rMultiple = +r.toFixed(3);
      t.pnlUsd = +(
        sign * (t.tp1 - t.entry) * pointValue(t.symbol) -
        commission(t.symbol)
      ).toFixed(2);
      applyPaperPnl(t.pnlUsd, t.rMultiple);
      closed.push(t);
      dirty = true;
      continue;
    }

    if (dirty) updated.push(t);
  }

  if (closed.length || updated.length) {
    savePaperTrades(all);
  }
  return { closed, updated };
}

export function formatPaperTradeLine(t: PaperTrade): string {
  if (t.status === "open") {
    return `${t.displaySymbol} ${t.side.toUpperCase()} ${t.contractsOpen}/${t.contracts}ct @ ${t.entry} · SL ${t.workingStop} · TP1 ${t.tp1} · ${t.grade}`;
  }
  return `${t.displaySymbol} ${t.side} CLOSED ${t.exitReason} R ${t.rMultiple?.toFixed(2) ?? "—"} $${t.pnlUsd?.toFixed(0) ?? "—"}`;
}
