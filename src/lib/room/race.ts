/**
 * THE RACE, as one read: the goal's plan (goal.ts), the five seats and The Room (seats.ts), the R&D board (rnd.ts), and
 * the contract ladder priced on today's card (contract-ladder.ts) — computed once per desk build from what the room
 * already has, and handed to the Floor's panels and the live talk. Pure: no network, no clock of its own, no model.
 *
 * The ladder is priced on the live card when there is one (the room's own three-path pricing of every strike) and is a bare
 * price list when there is not — never an odds table without a card to price it on.
 */

import { buildLadder, roomRungs, type Rung } from "./contract-ladder";
import { clockEt } from "./format";
import { goalClock, viewGoal, type GoalSpec, type GoalView } from "./goal";
import { asLab, type RoomLab } from "./lab";
import { ROOM_CLOCK } from "./mandate";
import { etDateOf, ivFor, quoteOption, strikeFor, type OptionType, type Underlier } from "./option-math";
import { expiryFor, type RoomDeskRead, type UnderlierTape } from "./orchestrator";
import { rndRead, type RndRead } from "./rnd";
import { asSeatBook, leagueRead, type LeagueRead, type SeatBook } from "./seats";
import { etWallToEpochMs } from "@/lib/trading/sessions";

/** An ATM option's delta, for "what is an ATR worth on a contract" — a modelling convenience. */
const ATM_DELTA = 0.5;

export interface RaceInput {
  goal: GoalSpec;
  lab: RoomLab | null;
  desk: RoomDeskRead | null;
  market: Record<Underlier, UnderlierTape>;
  nowMs: number;
  vix: number | null;
  closedRoom: { id: string; pnlUsd: number }[];
  /** 15m ATR in futures points and futures points per ETF point, per underlier. */
  atr: Record<Underlier, { atr: number | null; perEtfPt: number }>;
}

/**
 * The goal view costs a few hundred milliseconds with a priced ladder (an exact programme per strike), and almost nothing in it
 * changes between desk builds: the card prices at its CE until the touch, the clock moves once a day. One entry, keyed on
 * everything the view reads except the minute.
 */
let memo: { key: string; view: GoalView } | null = null;
function memoView(a: Parameters<typeof viewGoal>[0]): GoalView {
  const c = goalClock(a.spec, a.nowMs);
  const key = JSON.stringify([
    a.spec,
    Math.round(a.equity * 100),
    c.state,
    c.day,
    c.daysLeft,
    c.entriesOver,
    c.today,
    Math.round(a.contractUsd * 100),
    a.ladder?.map((r) => [r.offset, r.strike, r.askUsd, r.stopEtfMove, r.priced?.outcomes.map((o) => [Math.round(o.p * 1e4), Math.round(o.r * 1e4)])]),
    a.monthEntries,
    a.atrUsdPerContract == null ? null : Math.round(a.atrUsdPerContract * 100),
    a.dayNet0,
    a.weekNet0,
  ]);
  if (memo?.key === key) return memo.view;
  const view = viewGoal(a);
  memo = { key, view };
  return view;
}

export interface Race {
  seats: SeatBook | null;
  league: LeagueRead | null;
  view: GoalView | null;
  rnd: RndRead | null;
  /** The ladder in the view is priced on a live card (else it is a price list). */
  priced: boolean;
  /** What the ladder was built for, for the panel's caption. */
  ladderFor: { underlier: Underlier; type: OptionType; dte: 0 | 1; card: string | null } | null;
}

export function computeRace(i: RaceInput): Race {
  const lab = i.lab ? asLab(i.lab) : null;
  const seats = lab ? asSeatBook(lab.seats) : null;
  if (!lab || !seats) return { seats: null, league: null, view: null, rnd: null, priced: false, ladderFor: null };
  const goal = seats.goal;
  const league = leagueRead(seats);
  const top = league.rows[0]!;
  const etDate = etDateOf(i.nowMs);

  // The card the ladder is priced on: the desk's live card, with a plan, a ticket and odds.
  const e = i.desk?.entry ?? null;
  const usable = Boolean(e && e.plan && e.plan.t1 != null && e.pT1 != null && (e.deskContracts ?? 0) >= 1);
  const u: Underlier = usable ? e!.underlier : "QQQ";
  const type: OptionType = usable ? e!.type : "CALL";
  const dte: 0 | 1 = usable ? e!.dte : 1;
  const tape = i.market[u];
  let rungs: Rung[] = [];
  if (tape && tape.price > 0) {
    const futNow = i.desk?.futures[u]?.price ?? 0;
    const atTouch = !usable || e!.tier === "live" || !(futNow > 0);
    rungs = buildLadder({
      underlier: u,
      type,
      spot: tape.price,
      vix: tape.vix,
      exp: expiryFor(dte, etDate),
      nowMs: i.nowMs,
      minDelta: goal.minDelta,
      minAskUsd: goal.minAskUsd,
      card: usable
        ? {
            futSymbol: e!.futSymbol,
            futSide: e!.futSide,
            plan: { entry: e!.plan!.entry, stop: e!.plan!.stop, t1: e!.plan!.t1 },
            pT1: e!.pT1!,
            atr: e!.atr ?? null,
            priceFut: atTouch ? futNow : e!.plan!.entry,
            futNow,
            flatMs: etWallToEpochMs(etDate, clockEt(ROOM_CLOCK.dayFlatMin)),
          }
        : null,
    });
  }
  // What the room's own two strikes cost: from the ladder when it reaches them, else priced directly.
  const roomCost = (() => {
    const r = roomRungs(rungs);
    if (r.length) return Math.min(...r.map((x) => x.askUsd));
    if (!tape || !(tape.price > 0)) return 0;
    const iv = ivFor(u, tape.vix);
    const exp = expiryFor(dte, etDate);
    return Math.min(...(["ATM", "OTM_1"] as const).map((o) => quoteOption(tape.price, strikeFor(tape.price, type, o), exp, type, iv, i.nowMs).ask * 100));
  })();

  const leaderSeat = seats.seats.find((s) => s.id === (league.leader ?? top.id))!;
  const a = i.atr[u];
  const atrUsd = a.atr && a.perEtfPt > 0 ? ATM_DELTA * (a.atr / a.perEtfPt) * 100 : null;
  const args = {
    spec: goal,
    equity: top.equity,
    nowMs: i.nowMs,
    contractUsd: roomCost,
    cheapest: null,
    ladder: rungs.length ? rungs : null,
    monthEntries: Math.max(...seats.seats.map((s) => s.counters.monthEntries)),
    atrUsdPerContract: atrUsd,
    paperFills: null,
    dayNet0: leaderSeat.counters.realizedToday,
    weekNet0: leaderSeat.counters.realizedWeek,
  };
  const view = memoView(args);
  return {
    seats,
    league,
    view,
    rnd: rndRead({ lab, seats, goal, closedRoom: i.closedRoom }),
    priced: usable && rungs.some((r) => r.priced),
    ladderFor: { underlier: u, type, dte, card: usable ? `${e!.band ?? "—"} ${e!.futSymbol} ${e!.futSide}` : null },
  };
}
