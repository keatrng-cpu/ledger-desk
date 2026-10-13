/** Fast-move layer (SHADOW until the 1s replay proves an edge — shared rules fast.shadow). */
import RULES from "../../../shared/desk-rules.json";
export interface Spike { symbol: string; t: number; dir: "up" | "down"; tag: "failed" | "breakout"; moveAtr: number; ext: number; atExtreme: boolean; fast: { kill: string; arm: string } | null }
export interface FastWire { shadow: boolean; fresh: boolean; ageS: number | null; bars15s: Record<string, unknown[]>; spikes: Spike[]; floorLine: string | null }

export function fastWire(body: { at?: number; bars15s?: Record<string, unknown[]>; spikes?: Spike[] } | null, nowMs: number): FastWire | null {
  if (!body) return null;
  const ageS = body.at ? nowMs / 1000 - body.at : null;
  const fresh = ageS != null && ageS <= RULES.fast.freshS;
  // a stale feed (fresh=false) carries no spikes: old spikes must never read as live
  const spikes = fresh ? (body.spikes ?? []).filter((s) => nowMs / 1000 - s.t <= 300) : [];
  const last = spikes[spikes.length - 1];
  const floorLine = fresh && last
    ? `15s: ${last.symbol} ${last.dir} spike ${last.moveAtr}×ATR — ${last.tag === "failed" ? "failed push" : "holding (breakout)"}${last.atExtreme ? " at the session extreme" : ""}${last.fast ? ` · would kill the ${last.fast.kill}, arm the ${last.fast.arm}` : ""}${RULES.fast.shadow ? " (shadow — not graded)" : ""}`
    : null;
  return { shadow: RULES.fast.shadow, fresh, ageS: ageS == null ? null : +ageS.toFixed(1), bars15s: fresh ? body.bars15s ?? {} : {}, spikes, floorLine };
}
