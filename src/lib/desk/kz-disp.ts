/** Kill-zone opening-displacement (shared rules kzDisp, items 1-50; Keaton 2026-10-13).
 * Twin of desk-watcher watcher/killzone.py. Every item is mode "shadow": desk, brain and Floor read this
 * to label/log only — nothing here changes q, band, side, plan, stop or targets until an item is promoted
 * to "live" in shared/desk-rules.json (backtest: desk-watcher tools/kz_backtest.py). */
import RULES from "../../../shared/desk-rules.json";
export type KzItem = { name: string; mode: "shadow" | "live"; [k: string]: unknown };
export const KZ = (RULES as unknown as { kzDisp: { items: Record<string, KzItem>; killzones: Record<string, [string, string]> } }).kzDisp;
export const kzLiveItems = (): number[] => Object.entries(KZ.items).filter(([, v]) => v.mode === "live").map(([k]) => Number(k));
/** Items that have a desk-side score implementation. None yet: a live item without one must fail loudly. */
const KZ_SCORE_IMPL: Record<number, () => number> = {};
/** Score delta the desk/brain may apply from kzDisp: the sum over LIVE items' implementations (0 while all are
 * shadow). Accuracy 915e5ead #2: the old `length ? 0 : 0` hid a live item; now a live item with no
 * implementation throws instead of silently scoring 0. */
export function kzScoreDelta(): number {
  let d = 0;
  for (const k of kzLiveItems()) {
    const f = KZ_SCORE_IMPL[k];
    if (!f) throw new Error(`kzDisp item ${k} (${KZ.items[String(k)]?.name}) is live but has no desk score implementation`);
    d += f();
  }
  return d;
}
/** Floor "Kill Zone" seat line (item 49) — shadow: shown as a note citing the backtest, never a vote. */
export function kzSeatNote(): string {
  return `Kill Zone seat (shadow): ${Object.keys(KZ.items).length} items logged, ${kzLiveItems().length} live; skeptic: 20-day backtest hit 30%/-0.06R, not promoted.`;
}
