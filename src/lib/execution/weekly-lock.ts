/**
 * Weekly profit / loss lock (shared rules `weekly`; Python twin watcher/weekly.py). Week = Mon–Fri ET,
 * realized option PnL from RH fills on the Agentic account (the watcher reads them, read-only).
 */
import RULES from "../../../shared/desk-rules.json";

export const WEEKLY = RULES.weekly;
export type WeekState = "open" | "locked" | "giveback_block" | "loss_block";
export interface WeekLock { state: WeekState; pnl: number; peak: number; locked: boolean; block: boolean }

export function lockState(pnl: number, peak: number | null, lockedBefore = false): WeekLock {
  const pk = Math.max(peak ?? 0, pnl);
  const locked = lockedBefore || pk >= WEEKLY.lockTarget;
  if (pnl <= WEEKLY.lossLock) return { state: "loss_block", pnl, peak: pk, locked, block: true };
  if (locked && pnl <= pk * (1 - WEEKLY.givebackPct)) return { state: "giveback_block", pnl, peak: pk, locked: true, block: true };
  return { state: locked ? "locked" : "open", pnl, peak: pk, locked, block: false };
}
/** May this band fire this week? Locked: lockedBands only (A+), at lockedMaxContracts / lockedMaxDebit. */
export function weeklyAllows(w: WeekLock | null, band: string): boolean {
  if (!w) return false;
  if (w.block) return false;
  return !w.locked || (WEEKLY.lockedBands as string[]).includes(band);
}
export function weeklyCaps(w: WeekLock | null, maxContracts: number, maxDebit: number): [number, number] {
  return w?.locked ? [Math.min(maxContracts, WEEKLY.lockedMaxContracts), Math.min(maxDebit, WEEKLY.lockedMaxDebit)] : [maxContracts, maxDebit];
}
export function weekLine(w: { pnl?: number | null; peak?: number | null; state?: string | null } | null | undefined): string {
  if (!w || w.pnl == null) return "Week: realized PnL unread";
  const s = (x: number) => `${x >= 0 ? "+" : "−"}$${Math.abs(x).toFixed(0)}`;
  const lab: Record<string, string> = { open: "open", locked: `LOCKED: A+ only, ${WEEKLY.lockedMaxContracts}ct / $${WEEKLY.lockedMaxDebit}`, giveback_block: "BLOCKED: gave back 30% of peak", loss_block: `BLOCKED: loss lock ${s(WEEKLY.lossLock)}` };
  return `Week ${s(w.pnl)} · peak ${s(w.peak ?? 0)} · ${lab[String(w.state)] ?? String(w.state)}`;
}
