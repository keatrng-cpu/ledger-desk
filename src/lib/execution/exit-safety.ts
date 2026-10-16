/**
 * Exit safety — one unit with desk-watcher watcher/exitsafe.py (Keaton 2026-10-16).
 * Today's QQQ put: entry went out LIVE, the exit ran LIVE=0 (dry-run refused the sell); a -$30 stop became -$96.
 * Pure logic shared by desk, brain and the Floor display. Behind EXIT_SAFE (default off). Params: shared/exit-safe.json
 * (NOT desk-rules.json -> RULES_HASH unchanged).
 */
import P from "../../../shared/exit-safe.json" with { type: "json" };

export const EXIT_SAFE_PARAMS = P;

export function exitSafeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|yes|on)$/i.test((env.EXIT_SAFE ?? "").trim());
}

export interface ExitPathProbe {
  entryLive: boolean;
  exitLive: boolean | null;
  sameInstance: boolean;
  exitCallable: boolean;
  sessionValid: boolean;
  guardError?: string | null;
}

/** 0. Preflight: no entry unless the exit path is live in the same mode/instance. Order of checks matches the watcher. */
export function preflightExitPath(p: ExitPathProbe): { ok: boolean; reason: string } {
  if (!p.sameInstance) return { ok: false, reason: "exit broker instance differs from entry broker instance" };
  if (Boolean(p.exitLive) !== Boolean(p.entryLive)) return { ok: false, reason: `LIVE mismatch: entry live=${p.entryLive} exit live=${p.exitLive}` };
  if (!p.entryLive) return { ok: false, reason: "LIVE=0: exit path is dry-run -> refuse entry" };
  if (!p.exitCallable) return { ok: false, reason: "exit function not callable" };
  if (!p.sessionValid) return { ok: false, reason: "broker session not ready (not logged in)" };
  if (p.guardError) return { ok: false, reason: `exit guard would refuse: ${p.guardError}` };
  return { ok: true, reason: "exit path live, same mode/instance as entry" };
}

/** 1. Resting stop-limit price for a sell-to-close stop. */
export function stopLimitPrice(stop: number): number {
  const off = Math.max(P.stopLimitOffsetMin, Math.round(stop * P.stopLimitOffsetPct * 100) / 100);
  return Math.round(Math.max(0.01, stop - off) * 100) / 100;
}

/** 2. Ladder rung price at elapsed t (s): bid until crossAfterS, then bid - tick (marketable). */
export function ladderPrice(tS: number, bid: number): { px: number; crossed: boolean } {
  const crossed = tS >= P.crossAfterS;
  return { px: Math.round(Math.max(0.01, crossed ? bid - P.tick : bid) * 100) / 100, crossed };
}

/** Rung schedule (s) the watcher follows: 0, 2.5, 5, 7.5 ... until maxLadderS. */
export function ladderSchedule(): number[] {
  const out: number[] = [];
  for (let t = 0; t <= P.maxLadderS + 1e-9; t += P.repriceS) out.push(Math.round(t * 100) / 100);
  return out;
}

export type CloseKind = "stop" | "ladder";
/** Single-close invariant: at most one working close order; nothing after the position is closed. */
export class CloseBook {
  working: { kind: CloseKind; id: string } | null = null;
  closed = false;
  canSend(): { ok: boolean; reason: string } {
    if (this.closed) return { ok: false, reason: "position already closed" };
    if (this.working) return { ok: false, reason: `single-close invariant: ${this.working.kind} already working` };
    return { ok: true, reason: "ok" };
  }
  send(kind: CloseKind, id: string) {
    const c = this.canSend();
    if (!c.ok) throw new Error(c.reason);
    this.working = { kind, id };
  }
  /** Call only once the broker confirms the working order terminal. */
  cleared(state: "filled" | "cancelled" | "rejected" | "expired") {
    this.working = null;
    if (state === "filled") this.closed = true;
  }
}

/** Floor / brain display line (notes only; never gates anything by itself). */
export function exitSafetyNote(enabled = exitSafeEnabled()): string {
  if (!enabled) return "Exit safety: OFF (script-watched stop, single limit exit).";
  return `Exit safety: ON — entry requires live exit path; broker-resting stop-limit (offset ${Math.round(P.stopLimitOffsetPct * 100)}%/min $${P.stopLimitOffsetMin}); exit ladder at bid, re-price every ${P.repriceS}s, cross at ${P.crossAfterS}s; one working close max.`;
}
