/**
 * The kill-rule record — the last check's results and every human judgement.
 *
 * `tripped` on a KillResult is never set by the model (kill-watch-server.ts
 * does not return it). A person opens the citations and records a
 * judgement here; a TRIPPED judgement is what turns a name OUT on the
 * Invest tab (book.ts verdictFor). Append-only: a later judgement supersedes
 * an earlier one for display, and nothing is deleted.
 */

import type { KillResult } from "./kill-watch";

const RUN_KEY = "ledger.invest.killwatch.run.v1";
const JUDGE_KEY = "ledger.invest.killwatch.judgements.v1";
export const KILL_STORE_EVENT = "ledger-invest-kill";
const MAX_JUDGEMENTS = 500;

export interface KillJudgement {
  id: string;
  ticker: string;
  tripped: boolean;
  judgedAt: string;
  note: string;
  killRule: string;
  sources: string[];
}

export interface StoredKillRun {
  ranAt: string;
  sinceDays: number;
  results: KillResult[];
}

function emit(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(KILL_STORE_EVENT));
}

export function subscribeKill(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const on = () => fn();
  window.addEventListener(KILL_STORE_EVENT, on);
  return () => window.removeEventListener(KILL_STORE_EVENT, on);
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return false;
  }
  emit();
  return true;
}

export function loadLastRun(): StoredKillRun | null {
  const r = read<StoredKillRun | null>(RUN_KEY, null);
  return r && typeof r.ranAt === "string" && Array.isArray(r.results) ? r : null;
}

export function saveRun(run: StoredKillRun): void {
  write(RUN_KEY, run);
}

/** Newest first. */
export function loadKillJudgements(): KillJudgement[] {
  const rows = read<KillJudgement[]>(JUDGE_KEY, []);
  return Array.isArray(rows) ? rows.filter((j) => j && typeof j.ticker === "string" && typeof j.tripped === "boolean") : [];
}

export function judgeKill(
  j: Omit<KillJudgement, "id" | "judgedAt"> & { judgedAt?: string },
): KillJudgement[] {
  const entry: KillJudgement = {
    id: `kj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    judgedAt: j.judgedAt ?? new Date().toISOString(),
    ticker: j.ticker,
    tripped: j.tripped,
    note: j.note.trim(),
    killRule: j.killRule,
    sources: j.sources.slice(0, 10),
  };
  const next = [entry, ...loadKillJudgements()].slice(0, MAX_JUDGEMENTS);
  write(JUDGE_KEY, next);
  return next;
}

export function latestJudgement(ticker: string): KillJudgement | null {
  return loadKillJudgements().find((j) => j.ticker === ticker) ?? null;
}

/** Latest judgement per ticker, only where that latest one is TRIPPED. */
export function trippedTickers(): Map<string, KillJudgement> {
  const out = new Map<string, KillJudgement>();
  const seen = new Set<string>();
  for (const j of loadKillJudgements()) {
    if (seen.has(j.ticker)) continue;
    seen.add(j.ticker);
    if (j.tripped) out.set(j.ticker, j);
  }
  return out;
}
