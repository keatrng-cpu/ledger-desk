/**
 * Position management — time stops, context stops, and dynamic targets.
 * ROADMAP Phase B2 (time + context stops) and B3 (dynamic targets from draw).
 *
 * WHY THIS MODULE EXISTS
 * Entry rules were the only rules the desk enforced. A position, once open,
 * was managed by exactly three numbers frozen at entry (stop, tp1, tp2) and
 * by nothing else: not the clock, not the calendar, not the draw. So a trade
 * opened in the NY AM killzone could still be open at 15:50 ET; and the news
 * calendar — which already blocks ENTRIES — happily let an open position ride
 * straight into an FOMC print.
 *
 * PURE FUNCTIONS ONLY. No timers, no I/O, no `Date.now()`, no DB, no
 * localStorage — the same discipline `trading/paper.ts` was written under.
 * Every input a decision depends on (the instant, the session clock, the last
 * print, the calendar, the draw) is passed in, so the identical call can be
 * replayed over historical bars and asserted in a test.
 *
 * CONSERVATIVE BY CONSTRUCTION. Nothing here can widen a stop, add size, or
 * re-open anything. `shouldFlatten` only ever says "get out"; `retarget` only
 * ever moves targets to prices the position reaches by moving in its own
 * favour. Both are advice — the caller performs the fill and books the money
 * (net of commission, see paper-manager.ts).
 */

import { APLUS_RULES } from "@/lib/aplus/config";
import { drawTargetsForSide, type DrawRead } from "./draw";
import { NEWS_CALENDAR, newsRead, type NewsEvent } from "./news";
import { resolveKillzone, type KillzoneId, type SessionClock } from "./sessions";

/* ------------------------------------------------------------------ */
/* Thresholds — every one named, every one commented                   */
/* ------------------------------------------------------------------ */

/**
 * Length of one "management bar". The desk polls prices every 30s, but the
 * structure it trades is read on 5-minute candles (build-desk / scanner), so
 * time in trade is counted in 5-minute blocks rather than in poll ticks.
 */
export const MANAGEMENT_BAR_MINUTES = 5;

/**
 * Flat after this many bars if the thesis never produced progress.
 * 12 × 5m = 60 min. The NY AM killzone is 150 min long: an idea that has not
 * moved a quarter of an R in the first 40% of its window is not the sweep →
 * displacement → retrace expansion it was taken as, it is chop consuming a
 * risk slot.
 */
export const MAX_BARS_IN_TRADE = 12;

/**
 * How much favourable excursion counts as "the thesis triggered", in R.
 * Deliberately small — the test is "did it move at all in our direction",
 * not "is it winning".
 */
export const PROGRESS_R = 0.25;

/**
 * Look-ahead for the news test, in minutes. The calendar opens a blackout 15
 * min before a high-impact release (news.ts BLACKOUT_HIGH_MIN); evaluating
 * the calendar this far into the future means a position is flat by T-20 —
 * five minutes of slack to be out before the window even opens.
 */
export const NEWS_FLATTEN_LEAD_MIN = 5;

/**
 * Flat this many minutes before the current killzone ends. The last prints of
 * a killzone are where the session's liquidity has already been taken; the
 * lead exists so the exit is a decision, not a scramble at the boundary.
 */
export const KILLZONE_FLATTEN_LEAD_MIN = 5;

/**
 * Flat this many minutes before the 16:00 ET cash close. Futures keep
 * trading; the participants that make the structure readable do not.
 */
export const SESSION_END_FLATTEN_LEAD_MIN = 5;

/**
 * Grace period after entry during which no time/context stop may fire. Guards
 * the case where a position is opened one tick before a boundary and would be
 * flattened on the very next poll for a rule it never had a chance to satisfy.
 */
export const MIN_HOLD_MINUTES = 1;

/**
 * Floor for a retargeted TP1, in R. Matches the 0.35R floor
 * `buildPaperLevels` (paper-manager.ts) already accepts for a structure
 * target, so a re-target can never produce a level the entry builder would
 * have rejected.
 */
export const RETARGET_MIN_TP1_R = 0.35;

/**
 * Ceiling for a trailed TP2, in R. Same band `buildPaperLevels` accepts
 * (APLUS_RULES.tpMaxR + 0.5 = 3.5R). A draw level beyond it is real, but
 * sizing the runner for it is a projection, not a plan.
 */
export const RETARGET_MAX_TP2_R = APLUS_RULES.tpMaxR + 0.5;

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

/**
 * The minimum a position must expose to be managed.
 *
 * Structural, not nominal: `PaperTrade` (paper-manager.ts) satisfies it as-is
 * and a live `JournalTrade` can be adapted in a few lines. Declaring it here
 * rather than importing `PaperTrade` is deliberate — it keeps this module
 * free of any dependency on where the position is stored, and keeps the
 * import graph acyclic (paper-manager imports management, never the reverse).
 */
export interface ManagedPosition {
  side: "long" | "short";
  entry: number;
  /** Original stop as placed at entry. Never modified here. */
  stop: number;
  /** Stop actually working now (BE after TP1). Never modified here. */
  workingStop: number;
  tp1: number;
  tp2: number;
  /** Entry risk in points. Must be > 0 for any R math to mean anything. */
  riskPts: number;
  /** Contracts at entry. */
  contracts: number;
  /** Contracts still open. 0 = flat, nothing to manage. */
  contractsOpen: number;
  /** Epoch ms of the fill. */
  openedAt: number;
  /** Killzone id recorded at entry, when known. */
  killzone?: string | null;
  /**
   * Maximum favourable excursion so far, in R (a PRICE ratio — not the booked
   * net R). Optional: when absent the progress test falls back to the current
   * print, which is stricter (a spike that gave everything back reads as no
   * progress, and flat is the conservative side of that call).
   */
  mfeR?: number;
}

/** Everything the decision depends on, passed in — never read from ambient state. */
export interface ManagementContext {
  /** Epoch ms of this evaluation. */
  now: number;
  /** Session clock AT `now` (sessions.getSessionClock). */
  clock: SessionClock;
  /** Last print for this instrument. Omit and the progress test is skipped. */
  last?: number | null;
  /** Calendar override. Defaults to the bundled NEWS_CALENDAR. */
  calendar?: NewsEvent[];
}

export type FlattenReason =
  | "news_blackout_imminent"
  | "session_end"
  | "killzone_ended"
  | "max_bars_no_progress";

export interface FlattenDecision {
  flatten: boolean;
  /** null when `flatten` is false. */
  reason: FlattenReason | null;
  /** Readable, journal-ready — this string is what the exit is logged with. */
  detail: string;
  /** Minutes to the event that triggered it (0 = already here, null = n/a). */
  minutesAway: number | null;
}

/* ------------------------------------------------------------------ */
/* Time + context stops (B2)                                           */
/* ------------------------------------------------------------------ */

function hold(detail: string): FlattenDecision {
  return { flatten: false, reason: null, detail, minutesAway: null };
}

function flat(
  reason: FlattenReason,
  detail: string,
  minutesAway: number | null,
): FlattenDecision {
  return { flatten: true, reason, detail, minutesAway };
}

/**
 * Minutes until the killzone id changes, probed against `resolveKillzone`
 * itself rather than a second copy of the window table — sessions.ts stays
 * the single source of truth for where the boundaries are, so the two can
 * never drift apart.
 *
 * @returns minutes to the change, or null if none within `lookaheadMin`.
 */
export function minutesUntilKillzoneChange(
  etMinutesOfDay: number,
  killzone: KillzoneId,
  lookaheadMin = 8 * 60,
): number | null {
  for (let i = 1; i <= lookaheadMin; i++) {
    const m = (etMinutesOfDay + i) % 1440;
    if (resolveKillzone(Math.floor(m / 60), m % 60).id !== killzone) return i;
  }
  return null;
}

/**
 * Has the position produced favourable excursion worth waiting for?
 *
 * `known: false` means the inputs cannot answer it (no MFE recorded and no
 * print supplied) — in which case the caller must NOT flatten. A time stop
 * fires on measured stagnation, never on missing data.
 */
export function progressRead(
  pos: ManagedPosition,
  last?: number | null,
): { known: boolean; progressed: boolean; r: number | null } {
  // A banked partial is progress by definition — TP1 was reached.
  if (pos.contractsOpen < pos.contracts) {
    return { known: true, progressed: true, r: null };
  }
  // Stop pulled to BE (or better) only happens after TP1 in this desk.
  const sign = pos.side === "long" ? 1 : -1;
  if (sign * (pos.workingStop - pos.stop) > 0) {
    return { known: true, progressed: true, r: null };
  }
  if (pos.mfeR != null && Number.isFinite(pos.mfeR)) {
    return { known: true, progressed: pos.mfeR >= PROGRESS_R, r: pos.mfeR };
  }
  if (last != null && Number.isFinite(last) && pos.riskPts > 0) {
    const r = (sign * (last - pos.entry)) / pos.riskPts;
    return { known: true, progressed: r >= PROGRESS_R, r };
  }
  return { known: false, progressed: false, r: null };
}

/**
 * Should this position be flattened for a reason that has nothing to do with
 * its stop or target?
 *
 * Precedence, most urgent first — the first rule that fires wins:
 *   1. news_blackout_imminent — a high-impact release is the only event that
 *      can gap through a stop, so it outranks everything.
 *   2. session_end — weekend, post-close dead zone, or the 16:00 ET close.
 *   3. killzone_ended — the window the idea was taken in is over.
 *   4. max_bars_no_progress — measured stagnation.
 *
 * Never fires inside MIN_HOLD_MINUTES of the fill, and never on a flat
 * position.
 */
export function shouldFlatten(
  pos: ManagedPosition,
  ctx: ManagementContext,
): FlattenDecision {
  if (pos.contractsOpen <= 0) return hold("already flat");

  const heldMin = (ctx.now - pos.openedAt) / 60_000;
  if (!Number.isFinite(heldMin) || heldMin < MIN_HOLD_MINUTES) {
    return hold(`held ${Math.max(0, heldMin).toFixed(1)}m — inside the ${MIN_HOLD_MINUTES}m grace`);
  }

  // 1 — News. Evaluated twice: now (already inside a blackout) and
  // NEWS_FLATTEN_LEAD_MIN ahead (one is about to open).
  const calendar = ctx.calendar ?? NEWS_CALENDAR;
  const nowNews = newsRead(new Date(ctx.now), calendar);
  const aheadNews = newsRead(
    new Date(ctx.now + NEWS_FLATTEN_LEAD_MIN * 60_000),
    calendar,
  );
  if (nowNews.verdict === "blackout" || aheadNews.verdict === "blackout") {
    const trigger = nowNews.verdict === "blackout" ? nowNews : aheadNews;
    const away = trigger.nextEvent ? trigger.nextEvent.minutesAway : 0;
    return flat(
      "news_blackout_imminent",
      `News blackout — ${trigger.reason} Flat before the print: an open position is the one thing a stop cannot protect through a gap.`,
      nowNews.verdict === "blackout" ? 0 : away,
    );
  }

  const etMinutes = ctx.clock.etHour * 60 + ctx.clock.etMinute;
  const toChange = minutesUntilKillzoneChange(etMinutes, ctx.clock.killzone);

  // 2 — Session end.
  if (!ctx.clock.isWeekday) {
    return flat("session_end", "Weekend — no position carries the gap.", 0);
  }
  if (ctx.clock.killzone === "dead") {
    return flat(
      "session_end",
      "Post-close dead zone (16:00–19:00 ET) — journal and plan only.",
      0,
    );
  }
  if (
    ctx.clock.killzone === "ny_pm" &&
    toChange != null &&
    toChange <= SESSION_END_FLATTEN_LEAD_MIN
  ) {
    return flat(
      "session_end",
      `${toChange} min to the 16:00 ET close — flat into the bell.`,
      toChange,
    );
  }

  // 3 — Killzone ended.
  if (pos.killzone && pos.killzone !== ctx.clock.killzone) {
    return flat(
      "killzone_ended",
      `Opened in ${pos.killzone}; it is now ${ctx.clock.killzone} (${ctx.clock.killzoneLabel}). The window the idea was taken in has closed.`,
      0,
    );
  }
  if (toChange != null && toChange <= KILLZONE_FLATTEN_LEAD_MIN) {
    return flat(
      "killzone_ended",
      `${ctx.clock.killzoneLabel} ends in ${toChange} min — flat by the boundary.`,
      toChange,
    );
  }

  // 4 — Max bars with no progress.
  const bars = Math.floor(heldMin / MANAGEMENT_BAR_MINUTES);
  if (bars >= MAX_BARS_IN_TRADE) {
    const prog = progressRead(pos, ctx.last);
    if (prog.known && !prog.progressed) {
      const seen = prog.r == null ? "no excursion recorded" : `best ${prog.r.toFixed(2)}R`;
      return flat(
        "max_bars_no_progress",
        `${bars} bars (${Math.round(heldMin)} min) in trade and ${seen} — under the ${PROGRESS_R}R progress floor. The thesis has not triggered; the risk slot is doing nothing.`,
        0,
      );
    }
  }

  return hold("no time or context stop");
}

/* ------------------------------------------------------------------ */
/* Dynamic targets from the draw (B3)                                  */
/* ------------------------------------------------------------------ */

export interface RetargetResult {
  changed: boolean;
  tp1: number;
  tp2: number;
  /** Human-readable record of every move, for the trade's journal line. */
  notes: string[];
}

/**
 * Re-rank a position's targets against the current draw.
 *
 * THE ONE INVARIANT: **a target is never moved against the position.**
 * Enforced as four post-conditions, all asserted before anything is returned:
 *   P1. A target never lands on the losing side of entry.
 *   P2. A target never lands where price would have to travel AGAINST the
 *       position to reach it (long: tp ≥ last; short: tp ≤ last) — checked
 *       only when a last print is supplied.
 *   P3. Ordering is preserved: TP1 is never beyond TP2.
 *   P4. Direction of travel is fixed per leg —
 *         TP1 may only move NEARER to entry. It is the risk-off leg; banking
 *              at the nearest real pool instead of a synthetic 1R is strictly
 *              safer, and making it harder to reach never is.
 *         TP2 may only move FURTHER from entry. It is the runner; "trail to
 *              the next unswept level" means extend it. Pulling it in would
 *              cap a winner the draw says has further to go.
 *   Plus the floors: TP1 ≥ RETARGET_MIN_TP1_R, TP2 ≤ RETARGET_MAX_TP2_R.
 *
 * OPT-IN SAFE: with no draw (or no favourable level in it) this returns the
 * position's existing targets and `changed: false` — behaviour identical to a
 * desk that never called it.
 *
 * Never touches the stop and never touches size.
 */
export function retarget(
  pos: ManagedPosition,
  draw?: DrawRead | null,
  opts?: { last?: number | null },
): RetargetResult {
  const unchanged: RetargetResult = {
    changed: false,
    tp1: pos.tp1,
    tp2: pos.tp2,
    notes: [],
  };
  if (!draw || !(pos.riskPts > 0)) return unchanged;

  const favorable = drawTargetsForSide(draw, pos.side); // nearest-first
  if (!favorable.length) return unchanged;

  const sign = pos.side === "long" ? 1 : -1;
  /** Signed distance from entry — positive means "in the position's favour". */
  const dist = (px: number) => sign * (px - pos.entry);
  const last = opts?.last != null && Number.isFinite(opts.last) ? opts.last : null;
  /** P2 — can price still reach this level by moving in our favour? */
  const ahead = (px: number) => (last == null ? true : sign * (px - last) > 0);

  const minTp1 = RETARGET_MIN_TP1_R * pos.riskPts;
  const maxTp2 = RETARGET_MAX_TP2_R * pos.riskPts;

  let tp1 = pos.tp1;
  let tp2 = pos.tp2;
  const notes: string[] = [];

  // TP1 — nearest pool/EQ that clears the min-R floor and is still ahead of
  // price. Applied only when it is NEARER than the current TP1 (P4).
  const tp1Cand = favorable.find(
    (t) => dist(t.price) >= minTp1 && dist(t.price) < dist(pos.tp1) && ahead(t.price),
  );
  if (tp1Cand) {
    tp1 = tp1Cand.price;
    notes.push(
      `TP1 → ${tp1Cand.name} @ ${tp1Cand.price.toFixed(2)} (${(dist(tp1Cand.price) / pos.riskPts).toFixed(2)}R, ${(tp1Cand.reachProbability * 100).toFixed(0)}% base rate) — nearest pool beats a synthetic ${(dist(pos.tp1) / pos.riskPts).toFixed(2)}R`,
    );
  }

  // TP2 — the next UNSWEPT level beyond TP1. Applied only when it is FURTHER
  // than the current TP2 (P4) and inside the max-R band.
  const tp2Cand = favorable.find(
    (t) =>
      !t.swept &&
      dist(t.price) > dist(tp1) &&
      dist(t.price) > dist(pos.tp2) &&
      dist(t.price) <= maxTp2 &&
      ahead(t.price),
  );
  if (tp2Cand) {
    tp2 = tp2Cand.price;
    notes.push(
      `TP2 → ${tp2Cand.name} @ ${tp2Cand.price.toFixed(2)} (${(dist(tp2Cand.price) / pos.riskPts).toFixed(2)}R, unswept) — runner trailed to the next resting pool`,
    );
  }

  // Post-conditions. A violation means a bug above, so we return the ORIGINAL
  // targets rather than a "mostly right" one: refusing to move is always safe.
  const p1 = dist(tp1) > 0 && dist(tp2) > 0;
  const p2 = ahead(tp1) && ahead(tp2);
  const p3 = dist(tp2) >= dist(tp1);
  const p4 = dist(tp1) <= dist(pos.tp1) && dist(tp2) >= dist(pos.tp2);
  if (!p1 || !p2 || !p3 || !p4) return unchanged;

  const changed = tp1 !== pos.tp1 || tp2 !== pos.tp2;
  return { changed, tp1, tp2, notes: changed ? notes : [] };
}

/** One-line summary of a management decision, for toasts and the journal. */
export function describeFlatten(d: FlattenDecision): string {
  if (!d.flatten || !d.reason) return "hold";
  return `${d.reason.replace(/_/g, " ")} — ${d.detail}`;
}
