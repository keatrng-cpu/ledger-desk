import { qWrite } from "./q-source";
/** Day-context nudge on live q. total == 0 is a strict no-op: live q stays byte-identical (no clamp, no re-round, no label). */
export function applyDayNudge(c: { confluence: number }, total: number): void {
  if (total) qWrite(c, "confluence", +Math.max(0, Math.min(0.99, c.confluence + total)).toFixed(4), "dayContext");
}
