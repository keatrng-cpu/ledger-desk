/**
 * When the desk rebuilds.
 *
 * A closed 1m bar is graded DESK_CLOSE_LAG_MS after the minute, once the
 * gateway has written it. Between closes the board rebuilds every
 * DESK_POLL_GAP_MS so a new score or a take is on the card within one gap,
 * not held until a mid-minute slot. The client already refuses to stack a
 * second build on top of one that is still running.
 */

/** After the minute: gives the gateway (~1s) time to write the closed 1m bar. */
export const DESK_CLOSE_LAG_MS = 2_000;
/** How soon the next rebuild starts once the close has been graded. */
export const DESK_POLL_GAP_MS = 3_000;
/** Never schedule closer than this — a timer that fires early must not loop. */
const MIN_GAP_MS = 250;

/** Milliseconds until the next desk rebuild. Minute boundaries are the same in UTC and ET. */
export function msUntilNextDeskPoll(nowMs: number = Date.now()): number {
  const into = ((nowMs % 60_000) + 60_000) % 60_000;
  if (into + MIN_GAP_MS < DESK_CLOSE_LAG_MS) return DESK_CLOSE_LAG_MS - into;
  const untilClose = 60_000 + DESK_CLOSE_LAG_MS - into;
  return Math.max(MIN_GAP_MS, Math.min(DESK_POLL_GAP_MS, untilClose));
}