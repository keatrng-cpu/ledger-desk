/**
 * Keaton 13:26 CT read-priority kill (2+ same-side 5m FVGs closed through on 1m -> this side's card is C the same poll).
 * Accuracy CHANGES #24: the band write is labelled (qWrite "cap:readPriority") on a TRACKED card, so capReasons attributes
 * it; trackCard runs first here (build-desk's later trackCard is then a no-op), and a killed A+/A/A- grade reads B.
 * Watcher mirror: a fire block (fastchain read_flipped / ifvg_against), not a band write; same effect (no fire).
 */
import { capStage, trackCard } from "./cap-attribution";
import { qWrite } from "./q-source";

type Killable = { confluence: number; pathBand?: string | null; grade?: string; actionable: boolean; reasons: string[]; side: string };

/** A grade above B never survives a kill/cap to C or B: A+ / A / A- -> B. */
export function demoteGrade(c: { grade?: string }): void {
  if (c.grade === "A+" || c.grade === "A" || c.grade === "A-") c.grade = "B";
}

export function readPriorityKill<C extends Killable>(c: C): C {
  trackCard(c as never);
  capStage("scan:readPriority");
  const before = c.pathBand;
  qWrite(c as never, "pathBand" as never, "C" as never, "cap:readPriority");
  c.actionable = false;
  demoteGrade(c);
  (c as { readFlippedAgainst?: boolean }).readFlippedAgainst = true;
  c.reasons.push(`read flipped: 2+ 5m ${c.side === "long" ? "bull" : "bear"} FVGs closed through on 1m — ${before} → C (readPriority)`);
  return c;
}
