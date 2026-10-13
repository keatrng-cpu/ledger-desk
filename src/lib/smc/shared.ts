/**
 * One SMC read for the desk scanner, the brain (smc-master / smc-canon) and the
 * Floor's tickets (options-desk). Before this module each read its own raid:
 *
 *   scanner  `sweep_significant` = the NEWEST sweep of either side, kept only
 *            if it was this side's polarity (det.sweep.latest), or Blake's
 *            mechanical sweep. A later tag of the other pool erased the raid.
 *   scanner  `displacement` = `polaritySweep` (newest raid OF THIS SIDE).
 *   brain    canon `sweep` = the narrative's raid, which is the raid of the
 *            NARRATIVE's direction, not the card's side. A long card on a
 *            bear-narrative book read "BSL raid arms SHORT" and STOOD even
 *            when the card carried its own SSL raid + paired displacement.
 *
 * Shadow replay (src/data/shadow-replay.json, 195 cards Jul–Aug 2026) has 126
 * of 195 refusals on that `sweep` layer, 124 of them the wrong-polarity text.
 *
 * Rule here (raid-pair.ts doc, already the repo's own canon): the raid that
 * arms a side is the newest real sweep OF THAT SIDE's polarity inside
 * GATE.recentSweepBars; a later sweep of the other pool does not erase it.
 * Blake's mechanical sweep counts when the model is alive in the same
 * direction. Nothing here places, sizes or reads the clock.
 */

import type { OhlcBar } from "@/lib/market/types";
import type { DetectorSummary, SweepEvent } from "@/lib/trading/detectors";
import { polaritySweep } from "@/lib/trading/raid-pair";

export type Dir = "bull" | "bear";
export type TradeSide = "long" | "short";
export type PoolSide = "bsl" | "ssl" | "none";
export type SharedConfirmation = "none" | "sweep_only" | "sweep_displace" | "confirmed" | "armed_entry";

export const dirOfSide = (s: TradeSide): Dir => (s === "long" ? "bull" : "bear");
/** The pool whose raid arms this side: SSL arms a long, BSL arms a short. */
export const armingPool = (s: TradeSide): Exclude<PoolSide, "none"> => (s === "long" ? "ssl" : "bsl");
export const poolArms = (pool: PoolSide, s: TradeSide | null | undefined): boolean =>
  s != null && pool !== "none" && pool === armingPool(s);

export interface ArmingRaid {
  sweep: SweepEvent;
  source: "polarity" | "mechanical";
}

/**
 * The raid that arms `direction`. Polarity sweep first (newest same-polarity,
 * closed back inside, recent), else Blake's live mechanical sweep.
 */
export function armingRaid(
  bars: OhlcBar[],
  direction: Dir,
  det: Pick<DetectorSummary, "mechanical"> | null,
): ArmingRaid | null {
  const p = bars.length > 20 ? polaritySweep(bars, direction) : null;
  if (p) return { sweep: p, source: "polarity" };
  const m = det?.mechanical;
  const mDir: Dir | null = m?.direction === "long" ? "bull" : m?.direction === "short" ? "bear" : null;
  if (m && m.alive && m.sweep && m.sweep.closeBackInside > 0 && mDir === direction) {
    return { sweep: m.sweep, source: "mechanical" };
  }
  return null;
}

/** Components a card carries that mean "the raid for this side printed". */
export const RAID_COMPONENTS = ["sweep_significant", "mechanical_model"] as const;

export function cardHasRaid(components: readonly string[]): boolean {
  return RAID_COMPONENTS.some((k) => components.includes(k));
}

/**
 * What the brain should read as `swept` / `confirmation` for ONE card.
 *
 * The narrative's raid is per book, for the narrative's direction. When it
 * already arms the card's side, keep it (no behaviour change). When it does
 * not, but the card carries its own raid (scanner, same `armingRaid`), the
 * card's raid is the read, and its confirmation is rebuilt from the card's own
 * parts: displacement → `sweep_displace`, plus a priced array → `armed_entry`.
 */
export function raidReadForCard(
  card: { side: TradeSide; components: readonly string[]; entryPx?: number | null },
  narrative: { swept: PoolSide; confirmation: SharedConfirmation },
): { swept: PoolSide; confirmation: SharedConfirmation; source: "narrative" | "card" } {
  if (poolArms(narrative.swept, card.side) || !cardHasRaid(card.components)) {
    return { ...narrative, source: "narrative" };
  }
  const disp = card.components.includes("displacement") || card.components.includes("mechanical_model");
  const array = card.entryPx != null && Number.isFinite(card.entryPx);
  return {
    swept: armingPool(card.side),
    confirmation: !disp ? "sweep_only" : array ? "armed_entry" : "sweep_displace",
    source: "card",
  };
}

/**
 * Premium / discount, one verdict for all three.
 *   pass  — the array is in the side's half
 *   wait  — equilibrium (no half yet)
 *   note  — fights the half, but the raid AND the displacement already named
 *           the side (smc-master halfNote, the brain's rule since 2026-09)
 *   fail  — fights the half with no raid+displacement behind it
 * The Floor ticket treats `note` and `fail` as a size cut, never a block
 * (same as the PATH ticket, options-desk.ts "Dealing … fights … Size is cut").
 */
export type LocationVerdict = "pass" | "wait" | "note" | "fail";
export function locationVerdict(
  side: TradeSide,
  zone: string | null | undefined,
  named: { raid: boolean; displacement: boolean },
): LocationVerdict {
  if (zone == null) return "wait";
  if (zone === "equilibrium") return "wait";
  const good = (side === "long" && zone === "discount") || (side === "short" && zone === "premium");
  if (good) return "pass";
  return named.raid && named.displacement ? "note" : "fail";
}

/**
 * STRATEGY INDEPENDENCE (Keaton 2026-10-13): each model is its own strategy.
 * A card's "still missing" list names only ITS OWN template's musts. Another
 * model's key (mechanical_model, blake_swing, opening_raid, or_raid, htf_gap,
 * smt …) that the card does not carry is not missing — it is an optional
 * confluence the card simply does not have.
 *
 * Keeps every non-component string (vetoes, gates, prose) untouched.
 */
export function ownTemplateMissing(
  template: { must: readonly string[]; mustAnyOf?: readonly (readonly string[])[] } | null | undefined,
  missing: readonly string[],
  componentKeys: ReadonlySet<string>,
): string[] {
  const own = new Set<string>([...(template?.must ?? []), ...(template?.mustAnyOf ?? []).flat()]);
  return missing.filter((m) => !componentKeys.has(m) || own.has(m));
}
