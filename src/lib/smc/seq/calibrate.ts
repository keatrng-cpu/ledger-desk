/**
 * Fix 8 — calibration (shadow). Isotonic (pool-adjacent-violators) map score → P(win), fitted offline on the
 * backtest's training sessions and stored in deskSeq.calibrate.table; E[R] = p·RR − (1 − p); cards rank by E[R]
 * and the shadow gate fire.minEdgeR logs what would be refused. Band edges are untouched (rise-only).
 */
import { seqItem, seqMode, seqNum, type Mode } from "./rules";

export function isotonic(xs: { x: number; y: number }[]): { x: number; p: number }[] {
  const s = [...xs].sort((a, b) => a.x - b.x);
  const blocks: { x: number; sum: number; n: number }[] = [];
  for (const v of s) {
    blocks.push({ x: v.x, sum: v.y, n: 1 });
    while (blocks.length > 1 && blocks.at(-2)!.sum / blocks.at(-2)!.n > blocks.at(-1)!.sum / blocks.at(-1)!.n) {
      const b = blocks.pop()!; const a = blocks.at(-1)!; a.sum += b.sum; a.n += b.n; a.x = b.x;
    }
  }
  return blocks.map((b) => ({ x: b.x, p: +(b.sum / b.n).toFixed(3) }));
}
export function pOf(table: { x: number; p: number }[] | undefined, x: number): number | null {
  if (!table?.length) return null;
  return (table.find((r) => x <= r.x) ?? table.at(-1)!).p;
}
export const edgeR = (p: number, rr: number) => +(p * rr - (1 - p)).toFixed(3);
export function edgeRead(score: number, rr: number, tableOverride?: { x: number; p: number }[]): { mode: Mode; p: number | null; edgeR: number | null; wouldRefuse: boolean } {
  const p = pOf(tableOverride ?? seqItem<{ x: number; p: number }[]>("calibrate", "table"), score);
  const e = p == null ? null : edgeR(p, rr);
  return { mode: seqMode("calibrate"), p, edgeR: e, wouldRefuse: e != null && e < seqNum("calibrate", "minEdgeR", 0.1) };
}
