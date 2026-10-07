/**
 * What the brain hands the floor on a live card.
 * Setup, entry, target, and watch, from the schools and from the measured book.
 * The raid is not the fill. A high fit is not a high win rate.
 */

import { SCHOOLS } from "@/lib/trading/smc-canon";

export interface BrainJobs {
  setup: string;
  entry: string;
  target: string;
  watch: string;
  book: string;
  /** "The draw on the card is X." alone, or "" when the card has no target. */
  draw: string;
  /** "This card's own P(T1) if filled is N%…" alone, or "" when the card is not priced. */
  odds: string;
  /** What each school makes of this card, by the seat that presents it (Gemma ICT, Jax TJR, Nova Blake, Sterling Patty). Empty without a grade. */
  school: Record<string, string>;
  place: boolean;
  line: string;
}

export const BOOK =
  "The joint book reached the draw 19 of 29 times and made about zero R. After 2024 it was 5 of 11. Cards at 0.90 reached the first target 31% of the time on 1,504 fills and lost 0.31R out of sample. That number does not stand a card down, and it is not 65%.";

export function jobsFor(input: {
  symbol: string;
  side: string;
  sequence?: string | null;
  entryLine?: string | null;
  smcWord?: string | null;
  missing?: string | null;
  target?: number | null;
  pT1?: number | null;
  expR?: number | null;
  /** The four schools graded on this card (school-brief.ts, via live-world). */
  schools?: { line: string; by: Record<string, string> } | null;
}): BrainJobs {
  const seq = input.sequence?.trim() || input.smcWord?.trim() || "no sequence yet";
  const place = seq.startsWith("ENTER");
  const targetPx = input.target != null ? ` The draw on the card is ${input.target.toFixed(2)}.` : "";
  const odds =
    input.pT1 != null
      ? ` This card's own P(T1) if filled is ${Math.round(input.pT1 * 100)}%${input.expR != null ? `, E[R] ${input.expR >= 0 ? "+" : ""}${input.expR.toFixed(2)}` : ""}.`
      : "";
  // The card's own schools, graded. The static first steps of each school's canon are the fallback when the card was not graded: reciting
  // them on every card told the floor nothing it did not already know.
  const setup = input.schools?.line
    ? `${input.symbol} ${input.side}. ${seq}. ${input.schools.line}`
    : `${input.symbol} ${input.side}. ${seq}. ICT: ${SCHOOLS.ict.sequence[0]}. TJR: ${SCHOOLS.tjr.sequence[0]}. Patty: ${SCHOOLS.patty.sequence[0]}.`;
  const entry = input.entryLine?.trim()
    ? input.entryLine.trim()
    : place
      ? `${SCHOOLS.patty.entry} ${SCHOOLS.tjr.sequence[3]}.`
      : `${SCHOOLS.blake.entry} Until that prints, this is a watch.`;
  const target = `${SCHOOLS.smc.sequence[1]}. ${SCHOOLS.tjr.sequence[4]}.${targetPx}`;
  const watch = place
    ? "This is the fill. Watch the stop beyond the sweep. Do not add a second confirm."
    : `Watch, do not place. ${input.missing ? `Still missing ${input.missing}.` : "The raid, the arm, and a score are not the entry."}`;
  const line = `${setup} Entry: ${entry} Target: ${target} Watch: ${watch} ${BOOK}${odds}`;
  return { setup, entry, target, watch, book: `${BOOK}${odds}`, draw: targetPx.trim(), odds: odds.trim(), school: input.schools?.by ?? {}, place, line };
}
