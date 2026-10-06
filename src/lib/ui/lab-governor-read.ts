/**
 * Floor Lab command-card governor readout. Pure — no I/O.
 * A null RiskState (signed out / no row) may say "sign in".
 * A thrown / transport failure must say "unknown", never "sign in".
 */
import type { RiskState } from "@/lib/journal/risk";

export type LabGovernorStatus = "live" | "stale" | "offline" | "unknown" | "loading";

export interface LabGovernorCard {
  status: LabGovernorStatus;
  primary: string;
  lines?: string[];
  title?: string;
}

const usd = (n: number) => (Number.isFinite(n) ? `$${Math.round(n).toLocaleString()}` : "—");

function agoWords(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s ago`;
  return `${Math.round(s / 60)} min ago`;
}

/** Map a successful getRiskState result (including null = signed out). */
export function labGovernorFromState(r: RiskState | null): LabGovernorCard {
  if (!r) {
    return {
      status: "offline",
      primary: "Governor offline — sign in for live PnL.",
      title: "Risk governor (same as Lab)",
    };
  }
  const halt = r.dailyHaltHit || r.weeklyHaltHit || r.killzoneCapHit;
  const bits = [
    `Day ${usd(r.dayPnl)} / −${usd(r.dailyLimit)}`,
    `Week ${usd(r.weekPnl)} / −${usd(r.weeklyLimit)}`,
    `${r.killzoneLabel} ${r.entriesThisKillzone}/${r.killzoneCap}`,
  ];
  return {
    status: halt ? "stale" : "live",
    primary: halt
      ? `HALTED · ${r.dailyHaltHit ? "daily" : r.weeklyHaltHit ? "weekly" : "killzone cap"}`
      : `Open ${r.openTrades} · ${bits[2]}`,
    lines: bits,
    title: "Risk governor (same as Lab)",
  };
}

/**
 * Map a failed getRiskState (catch / timeout / transport).
 * Never says "sign in". Includes time since last good read when known.
 */
export function labGovernorFromError(lastGoodAtMs: number | null, nowMs: number = Date.now()): LabGovernorCard {
  const since =
    lastGoodAtMs != null && Number.isFinite(lastGoodAtMs)
      ? ` · last good ${agoWords(nowMs - lastGoodAtMs)}`
      : "";
  return {
    status: "unknown",
    primary: `Governor unknown — risk read failed${since}`,
    title: "Risk governor (same as Lab) — transport/read failure, not a signed-out state",
  };
}
