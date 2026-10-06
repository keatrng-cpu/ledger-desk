/**
 * Every way a room position can end, in one place — shared by the room's
 * book and by the ghost room (lab.ts), so a ghost can never exit on a rule
 * the room does not have.
 *
 * The trader's mandate (2026-10-04) is the base: −20% premium backstop, +40%
 * trims half with the stop to breakeven, flat at 11:00 for day tickets,
 * nothing held into 15:30, the futures LEVEL first. Three room rules were
 * built on top and tested on four years, paired on the same fills
 * (scripts/measure-room-ev.mjs, rule fixed before the run, "helps" only at
 * z >= 2 on 2025–26). The ghost room runs the mandate alone (MANDATE_POLICY)
 * beside every room fill so what stays in ROOM_POLICY keeps being measured:
 *
 *   t1     trim half when the futures plan touches T1 (the desk's futures
 *          rule, +0.50R a trade). On the OPTION it measured −$0.70 a fill
 *          against the mandate's +40% trim alone (n 146 NY AM, z −0.64),
 *          negative in both NY AM halves (−$0.91 / −$0.35) and −$0.51 in the
 *          all-session check — not shown to help, so it is OFF in ROOM_POLICY. Kept as a switch, never the default.
 *   theta  close an untrimmed option that is at or below its entry price
 *          when holding it is worth less than its bid: the measured odds of
 *          T1 before the flat (time-odds.ts) times what T1 pays no longer
 *          cover the other paths (quant.ts holdValue). A stalled-trade stop,
 *          never a profit-taker — it does not fire on a green position, and
 *          not at all without the measured time curve. Measured: no effect
 *          (−$0.09 a fill, z −0.97) — on 1 DTE the −20% backstop already
 *          bounds a stalled ticket, so it almost never binds. ON, as a
 *          candidate the twins keep measuring.
 *   event  close an untrimmed option a few minutes before a high-impact
 *          release inside its holding window — a print can gap through a
 *          level stop, and long premium pays the post-release IV drop.
 *          UNTESTED (no four-year release calendar in the repo yet). ON, as
 *          a candidate the twins keep measuring.
 */

import { ROOM_CLOCK, ROOM_MANDATE } from "./mandate";
import { STOP_TXT, clockEt, signedPct, usd } from "./format";
import { ivFor, quoteOption, type OptionType } from "./option-math";
import type { HoldRead } from "./quant";
import type { ExitPlan, RoomDeskRead, RoomPositionIn, UnderlierTape } from "./orchestrator";

export interface ExitPolicy {
  /** +40% premium trims half (the trader's mandate). */
  premiumTrim: boolean;
  /** T1 on the futures plan trims half. */
  levelTrim: boolean;
  /** Close when holding is worth less than the bid. */
  thetaStop: boolean;
  /** Close before a high-impact release inside the window. */
  eventGuard: boolean;
}

export const ROOM_POLICY: ExitPolicy = { premiumTrim: true, levelTrim: false, thetaStop: true, eventGuard: true };
export const MANDATE_POLICY: ExitPolicy = { premiumTrim: true, levelTrim: false, thetaStop: false, eventGuard: false };

/** How close to a high-impact release an untrimmed option is closed. */
export const EVENT_EXIT_MIN = 5;

export const EXIT_RANK: Record<ExitPlan["reason"], number> = {
  stop: 1,
  level: 2,
  failed_hold: 2,
  expiry: 3,
  event: 4,
  time: 5,
  theta: 6,
  t2: 7,
  t1: 8,
  take_profit: 9,
};

export function htfAligned(htf: string | undefined, type: OptionType): boolean {
  return type === "CALL" ? htf === "bull" : htf === "bear";
}

export interface ExitContext {
  desk: RoomDeskRead | null;
  etDate: string;
  etMin: number;
  nowMs: number;
  policy: ExitPolicy;
  /** quant.ts holdValue for this position, when its plan could be priced. */
  hold: HoldRead | null;
}

/** The highest-ranked way this one position should end this cycle, or null. */
export function exitFor(p: RoomPositionIn, tape: UnderlierTape, c: ExitContext): ExitPlan | null {
  const { desk, etDate, etMin, nowMs, policy } = c;
  const quote = quoteOption(tape.price, p.strike, p.exp, p.type, ivFor(p.ticker, tape.vix), nowMs);
  const plans: ExitPlan[] = [];
  const all = (reason: ExitPlan["reason"], why: string): ExitPlan => ({
    position: p,
    reason,
    why,
    qty: p.contracts ?? null,
    closesAll: true,
    quote,
    spot: tape.price,
  });
  const trimHalf = (reason: ExitPlan["reason"], why: (half: number | null, n: number | null) => string): ExitPlan => {
    const n = p.contracts ?? null;
    const half = n != null && n >= 2 ? Math.max(1, Math.floor(n * ROOM_MANDATE.takeProfitCloseFrac)) : null;
    const closesAll = half == null || half >= (n ?? 0);
    return { position: p, reason, why: why(closesAll ? null : half, n), qty: closesAll ? n : half, closesAll, quote, spot: tape.price };
  };

  const stopPct = p.trimmed ? 0 : ROOM_MANDATE.hardStopPct;
  if (p.pnl_percent <= stopPct) {
    plans.push(
      all(
        "stop",
        p.trimmed
          ? `runner back to breakeven (${signedPct(p.pnl_percent)}) after the trim`
          : `${signedPct(p.pnl_percent)} is through the ${STOP_TXT} hard stop`,
      ),
    );
  }
  const deskExit = desk?.exits[p.id];
  if (deskExit && (deskExit.kind === "level" || deskExit.kind === "failed_hold")) plans.push(all(deskExit.kind, deskExit.why));
  if (p.exp < etDate) plans.push(all("expiry", `expired ${p.exp} — the contract is past its bell`));
  else if (p.exp === etDate && etMin >= ROOM_CLOCK.flattenAllMin)
    plans.push(all("expiry", `expiry day ${clockEt(etMin)} ET — the broker force-sells from 15:30`));
  else if (etMin >= ROOM_CLOCK.flattenAllMin)
    plans.push(all("time", `${clockEt(etMin)} ET — QQQ/SPY options are unmanageable 16:15→09:30, nothing 0–1 DTE goes home`));
  if (policy.eventGuard && !p.trimmed) {
    const next = desk?.agenda?.next;
    const flatMin = ROOM_CLOCK.flattenAllMin;
    const [hh, mm] = (next?.timeEt ?? "").split(":").map(Number);
    const relMin = Number.isFinite(hh) && Number.isFinite(mm) ? (hh ?? 0) * 60 + (mm ?? 0) : null;
    if (next && next.impact === "high" && next.date === etDate && next.minutes >= 0 && next.minutes <= EVENT_EXIT_MIN && relMin != null && relMin <= flatMin)
      plans.push(all("event", `${next.name} prints at ${next.timeEt} ET in ${next.minutes}m — an untrimmed option does not sit through a release`));
  }
  // A stalled-trade stop, never a profit-taker: only at or below the entry
  // price, and only on a measured time curve (the desk measured "protect
  // early" — banking before T1 — at −0.42R a trade; T1 and +40% bank winners).
  if (policy.thetaStop && !p.trimmed && p.pnl_percent <= 0 && c.hold && c.hold.ev.measured && c.hold.edgeUsd < 0) {
    const h = c.hold;
    const t1 = h.ev.scenarios.find((s) => s.kind === "t1");
    plans.push(
      all(
        "theta",
        `holding is worth ${usd(Math.abs(h.edgeUsd))} a contract less than the bid — ${Math.round((t1?.p ?? 0) * 100)}% to T1 before the flat no longer pays the theta`,
      ),
    );
  }
  if (deskExit?.kind === "t2") plans.push(all("t2", deskExit.why));
  if (policy.levelTrim && !p.trimmed && deskExit?.kind === "t1") {
    plans.push(
      trimHalf("t1", (half, n) =>
        half != null ? `${deskExit.why} — trim ${half} of ${n}, runner's stop to breakeven` : `${deskExit.why} — ${n == null ? "an unknown size" : "one contract"}, so it all goes`,
      ),
    );
  }
  if (policy.premiumTrim && !p.trimmed && p.pnl_percent >= ROOM_MANDATE.takeProfitPct) {
    plans.push(
      trimHalf("take_profit", (half, n) =>
        half != null
          ? `${signedPct(p.pnl_percent)} is past the +${ROOM_MANDATE.takeProfitPct}% target — trim ${half} of ${n}`
          : `${signedPct(p.pnl_percent)} is past the +${ROOM_MANDATE.takeProfitPct}% target with ${n == null ? "an unknown size" : "one contract"}, so it all goes`,
      ),
    );
  }
  plans.sort((a, b) => EXIT_RANK[a.reason] - EXIT_RANK[b.reason]);
  return plans[0] ?? null;
}

/** The one exit the room sends this cycle: the highest-ranked across positions, worst P&L first on a tie. */
export function pickExit(
  positions: RoomPositionIn[],
  market: Record<"SPY" | "QQQ", UnderlierTape>,
  base: Omit<ExitContext, "hold">,
  holds: Record<string, HoldRead | null>,
): ExitPlan | null {
  const plans: ExitPlan[] = [];
  for (const p of positions) {
    const x = exitFor(p, market[p.ticker], { ...base, hold: holds[p.id] ?? null });
    if (x) plans.push(x);
  }
  plans.sort((a, b) => EXIT_RANK[a.reason] - EXIT_RANK[b.reason] || a.position.pnl_percent - b.position.pnl_percent);
  return plans[0] ?? null;
}
