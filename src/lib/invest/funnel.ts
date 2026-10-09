/**
 * Where a swept dollar goes after the waterfall.
 *
 * The 20% is already the policy (`SWEEP_RATE_NEW`). This file does not
 * change it. It splits the dollars that survived rent and the sleeve
 * refill. A hall needs power before it needs another chip, and the chip
 * is already the options book, so compute is the small sleeve. Space is
 * the high-variance slice and stays on watch. Nothing here places an order.
 */

import { DATA_RENT_MONTHLY_USD, SWEEP_RATE_NEW } from "./policy";
import { gradeBoard, LONG_NAMES, type LongCard, type LongSleeve } from "./long-board";

export interface FunnelSlice {
  sleeve: LongSleeve;
  /** Share of the surviving sweep. The slices sum to 1. */
  weight: number;
  /** Why this share, in the thing a data center has to buy. */
  demand: string;
}

export const FUNNEL: FunnelSlice[] = [
  { sleeve: "safety", weight: 0.4, demand: "The net. Total market and bills. Survives a year the growth book does not." },
  { sleeve: "power", weight: 0.18, demand: "The first thing a hall buys. A contracted nuclear or gas year, not a new reactor design." },
  { sleeve: "grid", weight: 0.15, demand: "Switchgear, turbines, the crews, and the cooling in the room. The build after the plant." },
  { sleeve: "fuel", weight: 0.08, demand: "Uranium, components, and the gas pipe. A fleet does not run on a headline." },
  { sleeve: "compute", weight: 0.08, demand: "The chip and the switch. Small on purpose: the options sleeve is already this bet." },
  { sleeve: "building", weight: 0.05, demand: "The hall itself. Rent and power available, not a model." },
  { sleeve: "space", weight: 0.03, demand: "The high-variance slice. Listed launch only, and it waits until the dossier exists." },
  { sleeve: "health", weight: 0.03, demand: "Cash that does not stop if the data-center build pauses." },
];

const SUM = FUNNEL.reduce((s, x) => s + x.weight, 0);
if (Math.abs(SUM - 1) > 1e-9) throw new Error(`funnel weights sum to ${SUM}`);

export interface SlicePlan {
  sleeve: LongSleeve;
  weight: number;
  usd: number;
  demand: string;
  ticker: string | null;
  state: string;
  line: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** First name in the sleeve that is not banned. Pass before wait. Never a fail. */
export function nextInSleeve(cards: LongCard[], sleeve: LongSleeve): LongCard | null {
  const rows = cards.filter((c) => c.name.sleeve === sleeve && c.state !== "fail");
  return rows.find((c) => c.state === "pass") ?? rows[0] ?? null;
}

/** Split a surviving sweep. The last slice takes the rounding cent. */
export function splitSweep(waitingUsd: number, cards: LongCard[]): SlicePlan[] {
  const usd = Math.max(0, waitingUsd);
  let used = 0;
  return FUNNEL.map((slice, i) => {
    const dollars = i === FUNNEL.length - 1 ? round2(usd - used) : round2(usd * slice.weight);
    used = round2(used + dollars);
    const next = nextInSleeve(cards, slice.sleeve);
    return {
      sleeve: slice.sleeve,
      weight: slice.weight,
      usd: dollars,
      demand: slice.demand,
      ticker: next?.name.ticker ?? null,
      state: next?.state ?? "none",
      line: next ? `${next.name.ticker} is ${next.state}. ${next.reason}` : "No name in this sleeve.",
    };
  });
}

/**
 * The path from a closed options month to a sleeve dollar.
 * Rent first, then 20% of what is left. Sleeve restore is not in this
 * picture: a month that has to refill the sleeve sweeps zero.
 */
export function workedMonth(realizedUsd: number, rent = DATA_RENT_MONTHLY_USD): { left: number; sweep: number; line: string } {
  const left = round2(Math.max(0, realizedUsd - rent));
  const sweep = round2(left * SWEEP_RATE_NEW);
  return {
    left,
    sweep,
    line: `$${realizedUsd.toFixed(0)} closed, minus $${rent} rent, leaves $${left.toFixed(2)}. Twenty percent of that is $${sweep.toFixed(2)}. A month that does not cover rent sweeps zero.`,
  };
}

export function funnelPlan(waitingUsd: number, marks?: { ticker: string; last: { price: number; at: string } | null }[]): SlicePlan[] {
  return splitSweep(waitingUsd, gradeBoard({ marks }));
}

export const FUNNEL_NAMES = LONG_NAMES.length;
