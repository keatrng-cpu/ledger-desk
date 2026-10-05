/**
 * The unattended safety net: from 15:30 ET (the room's own last-resort flatten — ROOM_CLOCK.flattenAllMin: the
 * broker force-sells expiring contracts from there) until the close, a cron flattens everything the executor
 * owns, even with every browser closed. It guarantees NO automated position is carried into the close; it does
 * not manage a position during the day (stops and targets run in the room engine, which runs in a browser — a
 * server-side runner is what live still needs). Pure.
 */

import { etWallParts } from "@/lib/trading/sessions";
import { ROOM_CLOCK } from "../mandate";

export interface NetWindow {
  due: boolean;
  why: string;
}

export function safetyNetDue(nowMs: number, forced = false): NetWindow {
  if (forced) return { due: true, why: "forced" };
  const p = etWallParts(nowMs);
  const min = p.hour * 60 + p.minute;
  if (p.weekday < 1 || p.weekday > 5) return { due: false, why: "weekend" };
  if (min < ROOM_CLOCK.flattenAllMin) return { due: false, why: "before 15:30 ET" };
  if (min >= ROOM_CLOCK.optionsCloseMin) return { due: false, why: "after the close" };
  return { due: true, why: "inside 15:30–16:00 ET" };
}
