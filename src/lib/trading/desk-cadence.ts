/**
 * When the desk rebuilds: just after candles close, not on a free-running
 * timer.
 *
 * Every scoring input on this desk changes only when a candle CLOSES — the
 * engine grades closed 15m bars, the ladder reads closed candles on every
 * frame, and every frame from 1m to 4h closes on a minute boundary. The
 * gateway writes each closed 1m bar about a second after the minute
 * (gateway logs: "1m bar … at hh:mm:01"). A free-running 20s timer
 * (DESK_POLL_MS until 2026-10-01) could therefore sit on a freshly closed
 * candle for up to ~20s before grading it. Rebuilding DESK_CLOSE_LAG_MS
 * after each minute grades it within a couple of seconds — with two
 * rebuilds a minute instead of three. The mid-minute rebuild keeps price
 * location (draw distance, OTE, the forming bar's quote) moving; the 1s
 * quote poll is separate and unchanged.
 */

/** After the minute: gives the gateway (~1s) time to write the closed 1m bar. */
export const DESK_CLOSE_LAG_MS = 2_000;
/** A second rebuild mid-minute, for price location. */
export const DESK_MID_MINUTE_MS = 32_000;
/** Never schedule closer than this — a timer that fires early must not loop. */
const MIN_GAP_MS = 250;

/** Milliseconds until the next desk rebuild. Minute boundaries are the same in UTC and ET. */
export function msUntilNextDeskPoll(nowMs: number = Date.now()): number {
  const into = ((nowMs % 60_000) + 60_000) % 60_000;
  const targets = [DESK_CLOSE_LAG_MS, DESK_MID_MINUTE_MS, 60_000 + DESK_CLOSE_LAG_MS];
  const next = targets.find((t) => t > into + MIN_GAP_MS) ?? 60_000 + DESK_CLOSE_LAG_MS;
  return next - into;
}
