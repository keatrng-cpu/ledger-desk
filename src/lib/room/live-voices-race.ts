/**
 * What the five say about the goal, the race and the R&D — in whose voice.
 *
 * Same rules as live-voices.ts: fixed phrase banks, one builder per kind of event, every number through `Facts` as it is
 * printed (the verifier requires each digit in a line to have been registered by code — so no digit is ever typed into a
 * phrase), and a bank that has nothing new to say drops the line instead of repeating it. The builders are handed
 * numbers that goal.ts, seats.ts and rnd.ts already computed; they decide the WORDS and never the facts.
 *
 *   Nova      the arithmetic: the odds, the rate, the pace, the experiments' samples.
 *   Sterling  the floor, the halts, what collides with the goal, whose call it is.
 *   Jax       the push: size, the card, "someone has to take the ticket".
 *   Gemma     the market behind it: the plan for the day, the draw, the higher timeframe.
 *   Vince     the contracts and the execution: what the cap buys, what the ladder offers, what the room did.
 */

import { APLUS_RULES } from "@/lib/aplus/config";
import { ROOM_MANDATE } from "./mandate";
import { ANIM, type CardRead, type Facts, type GoalLite, type Line, type RndLite, type SeatEventLite, type SeatRowLite, type TalkMove, type TapeBook, type WeekLite } from "./live-types";
import type { AuditItem } from "./audit";
import { clip, compact, line, NEUTRAL, pick, signed, type Ctx, type Ex } from "./live-voices";
import { ROOM_BACKERS, SEAT_NAME, SEAT_OWNER, type SeatId } from "./seats";
import type { Character } from "./orchestrator";

/** End a clipped clause with a full stop if it has no punctuation of its own. */
const stop = (t: string): string => (/[.!?…]$/.test(t) ? t : `${t}.`);
const nameOf = (id: string | null): string => (id ? (SEAT_NAME[id as SeatId] ?? id) : "Somebody");
/** The person who speaks for a seat: its owner, or Vince for The Room (the operator signs for the consensus). */
const voice = (id: string | null): Character => (id ? (SEAT_OWNER[id as SeatId] ?? "Vince") : "Vince");
const list = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** A probability, in the fewest honest words: "11%", "4.8%", "0.03%", or "under 0.1%". */
function oddsTxt(f: Facts, p: number): string {
  if (p >= 0.1) return f.pct(p * 100, 0);
  if (p >= 0.01) return f.pct(p * 100, 1);
  if (p >= 0.001) return f.pct(p * 100, 2);
  return f.raw("under 0.1%");
}

const anim = (who: Character) => NEUTRAL[who];

/** Whoever writes on the whiteboard or gestures at the wall has to be standing at it (the scene's rule): the moves follow the lines. */
function boardMoves(lines: Line[]): Partial<Record<Character, { zone: "THE_WHITEBOARD" }>> {
  const out: Partial<Record<Character, { zone: "THE_WHITEBOARD" }>> = {};
  for (const l of lines) {
    if (l.animation === "WRITING_ON_WHITEBOARD" || l.animation === "GESTICURING_AT_WALL") out[l.character] = { zone: "THE_WHITEBOARD" };
  }
  return out;
}

/** Walk to one of the annex offices. "ANNEX" is a presentation-only zone (not in the cycle contract), so any of the five may go. */
const OFFICE = (spot: "office_rnd" | "office_ops" | "office_goal"): TalkMove => ({ zone: "ANNEX", spot });

/* ── The race: tickets, closes, the lead ───────────────────────────────── */

export interface TouchRoundData {
  opens: SeatEventLite[];
  skips: SeatEventLite[];
  blocked: { gate: string | null; why: string | null; seats: string[] }[];
  syndicate: SeatEventLite | null;
  goal: GoalLite | null;
}

export function exTouchRound(c: Ctx, d: TouchRoundData): Ex | null {
  const f = c.f;
  const lines: (Line | null)[] = [];
  const dollars = (e: SeatEventLite) => f.usd(e.debit ?? 0);
  for (const e of d.opens.slice(0, 3)) {
    const who = voice(e.seat);
    const nm = f.raw(e.contract ?? "the contract");
    const qty = f.int(e.qty ?? 1);
    const dollar = dollars(e);
    const s = e.seat as SeatId;
    const why = e.why ? f.raw(clip(e.why, 60)) : "";
    const banks: Record<SeatId, (() => string)[]> = {
      protect: [
        () => `In: ${qty} × ${nm}, ${dollar}. It fits the cap and the band is right.`,
        () => `${qty} of ${nm} for ${dollar}. A or A+, priced twice, small. That's the whole policy.`,
      ],
      mechanical: [
        () => `Filled: ${qty} × ${nm}, ${dollar}. The rules passed, so I took it.`,
        () => `${nm}, ${qty} ${plural(e.qty ?? 1, "contract", "contracts")}, ${dollar}. The same checklist the room runs — nothing added.`,
      ],
      structure: [
        () => `I'm in: ${qty} × ${nm}, ${dollar}. The higher timeframe backs it and there's no decoy in front of it.`,
        () => `${nm}, ${dollar}. Structure says yes: the draw is on the right side.`,
      ],
      edge: [
        () => `${qty} × ${nm} for ${dollar} — ${why}. That's what the edge supports.`,
        () => `${nm}, ${qty}, ${dollar}. Sized by the ticket's own priced edge: ${why}.`,
      ],
      press: e.gate
        ? [
            () => `${qty} × ${nm}, ${dollar}! I overrode ${f.raw(e.gate!)}. Somebody in this room has to take the ticket.`,
            () => `${nm}, ${qty} of them, ${dollar}. The pricing gate said no. I said size.`,
          ]
        : [() => `${qty} × ${nm} — ${dollar}. As big as the cap lets me.`, () => `${nm}, ${qty}, ${dollar}. The cap is the only thing between me and a bigger ticket.`],
      room: [
        () => `The Room signs: ${qty} × ${nm}, ${dollar}. ${f.int(ROOM_BACKERS)} of us backed it, so it takes it.`,
        () => `The Room is in — ${qty} × ${nm}, ${dollar}. Consensus carried it.`,
      ],
    };
    lines.push(line(who, anim(who), pick(c, `seat.open.${s}`, banks[s])));
  }
  for (const e of d.skips.slice(0, 2)) {
    const who = voice(e.seat);
    const s = e.seat as SeatId;
    const why = f.raw(clip(e.why ?? "it did not clear my rule", 100));
    const banks: Record<SeatId, (() => string)[]> = {
      protect: [() => `Passing. ${why}`, () => `Not mine: ${why}`],
      mechanical: [() => `The rules say no here. ${why}`, () => `Declined. ${why}`],
      structure: [() => `Not for structure. ${why}`, () => `I'll pass on this one: ${why}`],
      edge: [() => `No stake. ${why}`, () => `The edge isn't there: ${why}`],
      press: [() => `Even I'm passing: ${why}`, () => `Skipping it. ${why}`],
      room: [() => `The Room stands down. ${why}`, () => `The Room passes: ${why}`],
    };
    lines.push(line(who, anim(who), pick(c, `seat.skip.${s}`, banks[s])));
  }
  for (const b of d.blocked.slice(0, 2)) {
    const names = list(b.seats.map(nameOf));
    const why = f.raw(clip(b.why ?? "a rule holds it", 90));
    lines.push(
      line("Sterling", ANIM.Sterling.tablet!, pick(c, "seat.blocked", [
        () => (b.seats.length >= 2 ? `${names} are blocked: ${stop(why)}` : `${names} is blocked — ${stop(why)}`),
        () => `${names} can't take it: ${stop(why)} That's a rule, not an opinion.`,
      ])),
    );
  }
  if (d.syndicate && (d.syndicate.n ?? 0) >= 2) {
    const names = list((d.syndicate.members ?? []).map(nameOf));
    lines.push(
      line("Vince", ANIM.Vince.watch!, pick(c, "seat.syndicate", [
        () => `${f.int(d.syndicate!.n ?? 0)} of us are on one card now: ${names}. Each at its own size.`,
        () => `That's a syndicate — ${names}. One card, ${f.int(d.syndicate!.n ?? 0)} accounts.`,
      ])),
    );
  }
  if (!d.opens.length && !d.skips.length && d.blocked.length) {
    lines.push(line("Jax", ANIM.Jax.point!, pick(c, "seat.blocked.jax", [() => `Held by a rule again. I'd like it noted that I noticed.`, () => `Rules hold everyone the same. That's the only reason I tolerate them.`])));
  }
  const opened = new Set(d.opens.map((e) => voice(e.seat)));
  if (d.opens.length && !opened.has("Jax")) {
    lines.push(line("Jax", ANIM.Jax.point!, pick(c, "seat.rival.jax", [() => `Whose ticket is the best one? I'd like it on the board.`, () => `Race is on. Don't look at me, I'm watching the tape.`])));
  } else if (d.opens.some((e) => e.seat === "press") && d.opens.length === 1) {
    lines.push(line("Sterling", ANIM.Sterling.arms!, pick(c, "seat.rival.sterling", [() => `Size isn't edge. Write that down before it prints.`, () => `A big ticket on a priced no. We'll see what the ghost room says.`])));
  }
  const out = compact(lines).slice(0, 8);
  return out.length >= 2 ? { lines: out, moves: {} } : null;
}

export interface SeatCloseData {
  ev: SeatEventLite;
  row: SeatRowLite | null;
  rank: number;
  of: number;
  goal: GoalLite | null;
}

export function exSeatClose(c: Ctx, d: SeatCloseData): Ex | null {
  const f = c.f;
  const e = d.ev;
  const who = voice(e.seat);
  const up = (e.usd ?? 0) >= 0;
  const nm = f.raw(e.contract ?? "the ticket");
  const money = `${signed(e.usd ?? 0)}${f.usd(e.usd ?? 0)}`;
  const reason = e.why ? f.raw(clip(e.why, 80)) : "";
  const name = nameOf(e.seat);
  const eq = d.row ? f.usd(d.row.equity) : null;
  const lines = compact([
    line(who, anim(who), pick(c, `seat.close.${up ? "up" : "dn"}.${e.seat}`, up
      ? [() => `${nm} closed ${money}. ${reason}`, () => `${money} on ${nm}. ${reason}`]
      : [() => `${nm} closed ${money}. ${reason}`, () => `${money} on ${nm}. ${reason} It's inside the plan.`])),
    d.row && d.goal
      ? line("Nova", ANIM.Nova.analyze!, pick(c, "seat.close.nova", (() => {
          const pr = (d.row!.equity - d.goal!.start) / (d.goal!.target - d.goal!.start);
          const subj = who === "Nova" ? "My account is" : `${name}'s account is`;
          const way = pr >= 0 ? `${f.pct(pr * 100, 1)} of the way from ${f.usd(d.goal!.start)} to ${f.usd(d.goal!.target)}` : `${f.usd(d.goal!.start - d.row!.equity)} under the start`;
          return [
            () => `${subj} ${eq} — number ${f.int(d.rank)} of ${f.int(d.of)}, ${way}.`,
            () => `${who === "Nova" ? "I'm" : `${name} is`} at ${eq}: ${f.int(d.rank)} of ${f.int(d.of)}, ${way}.`,
          ];
        })()))
      : null,
    who !== "Jax"
      ? line("Jax", up ? ANIM.Jax.shout! : ANIM.Jax.point!, pick(c, up ? "seat.close.jax.up" : "seat.close.jax.dn", up ? [() => `Take the money and run. That's the sport.`, () => `See? Somebody gets it.`] : [() => `It happens. Next card.`, () => `That's why I size the next one bigger.`]))
      : line("Sterling", ANIM.Sterling.arms!, pick(c, up ? "seat.close.sterling.up" : "seat.close.sterling.dn", up ? [() => `One ticket is a sample of one.`, () => `Noted. Don't let it change the size.`] : [() => `A stop is the system working.`, () => `A lottery ticket lost like a lottery ticket. The floor held.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

export interface LeadData {
  seat: string;
  equity: number;
  margin: number;
  tickets: number;
  goal: GoalLite | null;
}

export function exLead(c: Ctx, d: LeadData): Ex | null {
  const f = c.f;
  const name = nameOf(d.seat);
  const who = voice(d.seat);
  const tie = d.margin < 1;
  const lines = compact([
    line("Nova", ANIM.Nova.analyze!, pick(c, tie ? "seat.lead.nova.tie" : "seat.lead.nova", tie
      ? [() => `${name} is level at the top: ${f.usd(d.equity)}.`, () => `A tie for first at ${f.usd(d.equity)}, ${name} among them.`]
      : [
          () => `${name} takes the lead: ${f.usd(d.equity)}, ${f.usd(d.margin)} ahead of the next account.`,
          () => `New leader. ${name} at ${f.usd(d.equity)}, ${f.usd(d.margin)} clear.`,
        ])),
    who === "Jax"
      ? line("Jax", ANIM.Jax.shout!, pick(c, "seat.lead.jax", [() => `Say it. Who's leading?`, () => `I want that written on the whiteboard in red.`]))
      : line("Jax", ANIM.Jax.point!, pick(c, "seat.lead.rival", [() => `That won't last.`, () => `Lead's a loan. I'll collect.`])),
    line("Sterling", ANIM.Sterling.tablet!, pick(c, d.tickets === 0 ? "seat.lead.sterling.open" : "seat.lead.sterling", d.tickets === 0
      ? [() => `No ticket has closed yet. A lead on marks is not a result.`, () => `That's an open ticket's mark. Wait for it to close.`]
      : [
          () => `${f.int(d.tickets)} ${plural(d.tickets, "ticket", "tickets")} closed between them. A lead on that is noise.`,
          () => `Lead after ${f.int(d.tickets)} closed ${plural(d.tickets, "ticket", "tickets")}. Don't read it as skill yet.`,
        ])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

export interface FinishData {
  seat: string;
  hit: boolean;
  equity: number;
  goal: GoalLite | null;
}

export function exFinish(c: Ctx, d: FinishData): Ex | null {
  const f = c.f;
  const name = nameOf(d.seat);
  const who = voice(d.seat);
  const lines = d.hit
    ? compact([
        line(who, anim(who), pick(c, "seat.finish.hit", [() => `${name} is at ${f.usd(d.equity)}. That's the number.`, () => `${f.usd(d.equity)}. The goal is reached on the paper account.`])),
        line("Nova", ANIM.Nova.analyze!, pick(c, "seat.finish.nova", [() => `The exact odds said ${d.goal ? oddsTxt(f, d.goal.pTarget) : "very small"}. It happened anyway. Log it, don't believe it.`, () => `A tail event. It goes in the book as one path, not as a plan.`])),
        line("Sterling", ANIM.Sterling.tablet!, pick(c, "seat.finish.sterling", [() => `Paper. Nothing here is a fill. The record is the point.`, () => `On paper. The live account has its own gates.`])),
        line("Jax", ANIM.Jax.shout!, pick(c, "seat.finish.jax", [() => `I want a parade.`, () => `Tell me that again, slowly.`])),
      ])
    : compact([
        line("Sterling", ANIM.Sterling.arms!, pick(c, "seat.finish.floor", [() => `${name} is at ${f.usd(d.equity)}. That's the floor. The experiment is over for that account.`, () => `Floor reached: ${name}, ${f.usd(d.equity)}. It stops trading.`])),
        line("Nova", ANIM.Nova.analyze!, pick(c, "seat.finish.floor.nova", [() => `The floor was ${d.goal ? f.usd(d.goal.floor) : "the line"}. The arithmetic said it was the likelier end.`, () => `Expected. The measured edge per ticket was negative.`])),
      ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

export interface SyndicateClosedData {
  members: string[];
  usd: number;
  dissentUsd: number | null;
}

export function exSyndicateClosed(c: Ctx, d: SyndicateClosedData): Ex | null {
  const f = c.f;
  const names = list(d.members.map(nameOf));
  const lines = compact([
    line("Vince", ANIM.Vince.watch!, pick(c, "seat.syn.vince", [
      () => `${names} held that card together: ${signed(d.usd)}${f.usd(d.usd)} between ${f.int(d.members.length)} accounts.`,
      () => `The syndicate's closed — ${signed(d.usd)}${f.usd(d.usd)} across ${f.int(d.members.length)} accounts.`,
    ])),
    d.dissentUsd != null
      ? line("Nova", ANIM.Nova.analyze!, pick(c, "seat.syn.nova", [
          () => `The ones who passed: their declined tickets made ${signed(d.dissentUsd!)}${f.usd(d.dissentUsd!)}. Saying no ${d.dissentUsd! > 0 ? "cost" : "saved"} that.`,
          () => `Dissent priced: ${signed(d.dissentUsd!)}${f.usd(d.dissentUsd!)} on the declined tickets.`,
        ]))
      : line("Jax", ANIM.Jax.point!, pick(c, "seat.syn.jax", [() => `Everybody in on one card. That's the room working.`, () => `Together. For once.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

/* ── The goal ──────────────────────────────────────────────────────────── */

export interface CouncilData {
  g: GoalLite;
  weekTrade: string | null;
  b: TapeBook | null;
}

/**
 * The morning council: the five plan the goal out loud, in order — the arithmetic, the floor and what collides with the
 * goal, the push, the market, the contracts. Every number is the planner's.
 */
export function exCouncil(c: Ctx, d: CouncilData): Ex | null {
  const f = c.f;
  const g = d.g;
  const sessions = f.int(g.daysLeft);
  const need = g.perSessionNeeded != null ? f.pct(g.perSessionNeeded * 100, 0) : null;
  const top = g.collisions[0] ?? null;
  const pending = g.collisions.find((x) => x.ask && x.severity !== "info") ?? null;
  const lines: (Line | null)[] = [];
  lines.push(
    line("Nova", ANIM.Nova.write!, g.status === "before"
      ? pick(c, "goal.council.nova.before", [
          () => `The goal opens on ${f.raw(g.startDate)}: ${f.usd(g.start)} to ${f.usd(g.target)} in ${f.int(g.of)} sessions. ${f.x(g.multipleNeeded)} — ${need ?? "a lot"} a session if it were smooth.`,
          () => `Planning ahead. ${f.usd(g.start)} to ${f.usd(g.target)} over ${f.int(g.of)} sessions starting ${f.raw(g.startDate)}. The desk offers about ${f.raw(g.lambda.toFixed(2))} cards a session.`,
        ])
      : pick(c, "goal.council.nova1", [
          () => `Day ${f.int(g.day)} of ${f.int(g.of)}. ${f.usd(g.equity)} to ${f.usd(g.target)} is ${f.x(g.multipleNeeded)} — ${need ?? "a lot"} a session if it were smooth. The desk offers about ${f.raw(g.lambda.toFixed(2))} cards a session: ${f.raw(g.expectedTickets.toFixed(1))} in the ${sessions} left.`,
          () => `${f.usd(g.equity)} now, ${f.usd(g.target)} to reach, ${sessions} ${plural(g.daysLeft, "session", "sessions")} left: ${f.x(g.multipleNeeded)}. At ${f.raw(g.lambda.toFixed(2))} cards a session the desk gives us about ${f.raw(g.expectedTickets.toFixed(1))}.`,
        ])),
  );
  lines.push(
    line("Nova", ANIM.Nova.analyze!, pick(c, "goal.council.nova2", [
      () => `On the measured numbers — ${f.frac(g.measured.pWin)} winners, ${g.measured.meanPct >= 0 ? "+" : "−"}${f.pct(Math.abs(g.measured.meanPct) * 100, 1)} a ticket — the exact chance is ${oddsTxt(f, g.pTarget)} on ${g.pTargetBy}'s approach. ${f.frac(g.pNoCard)} of the time not one card prints at all.`,
      () => `Exact odds, no sampling: ${oddsTxt(f, g.pTarget)} to reach ${f.usd(g.target)}. ${f.frac(g.pNoCard)} that no card prints at all. The edge per ticket is ${g.measured.meanPct >= 0 ? "positive" : "negative"}.`,
    ])),
  );
  if (g.stopShare != null) {
    lines.push(
      line("Sterling", ANIM.Sterling.tablet!, pick(c, "goal.council.sterling1", [
        () => `The floor is ${f.usd(g.floor)}. A stopped ticket at the cap costs ${f.pct(g.stopShare! * 100, 0)} of the account; the weekly halt is ${f.int(APLUS_RULES.weeklyLossLimitPct * 100)}%.`,
        () => `Floor ${f.usd(g.floor)}. One stop at the cap is ${f.pct(g.stopShare! * 100, 0)} of the account, and the weekly halt sits at ${f.int(APLUS_RULES.weeklyLossLimitPct * 100)}%.`,
      ])),
    );
  } else {
    lines.push(line("Sterling", ANIM.Sterling.tablet!, pick(c, "goal.council.sterling1.none", [() => `The floor is ${f.usd(g.floor)}. At the room's two strikes nothing fits the cap today, so the room takes nothing.`, () => `Floor ${f.usd(g.floor)}. The room's own strikes don't fit the cap right now.`])));
  }
  if (top) {
    lines.push(
      line("Sterling", ANIM.Sterling.arms!, pick(c, "goal.council.sterling2", [
        () => `${f.raw(top.title)}. ${f.raw(clip(top.detail, 110))}`,
        () => `What collides with the goal: ${f.raw(top.title)}. ${f.raw(clip(top.detail, 100))}`,
      ])),
    );
  }
  if (pending) {
    lines.push(
      line("Sterling", ANIM.Sterling.tablet!, pick(c, "goal.council.sterling3", [
        () => `And one is the trader's to set: ${f.raw(clip(pending.decision ?? "", 120))}`,
        () => `That number isn't ours: ${f.raw(clip(pending.decision ?? "", 120))}`,
      ])),
    );
  }
  lines.push(
    line("Jax", ANIM.Jax.shout!, g.needed.pWin != null || g.needed.lambdaMultiple != null
      ? pick(c, "goal.council.jax", [
          () => `To make it likely we'd need ${g.needed.pWin != null ? `${f.frac(g.needed.pWin)} winners` : "a better win rate"}${g.needed.lambdaMultiple != null ? `, or ${f.x(g.needed.lambdaMultiple)} the cards` : ""}. Nobody's offering that. So we press when the card's good.`,
          () => `${g.needed.pWin != null ? `${f.frac(g.needed.pWin)} winners` : "More winners"}${g.needed.lambdaMultiple != null ? ` or ${f.x(g.needed.lambdaMultiple)} the cards` : ""}. That's the ask. I'll take the biggest ticket the cap allows.`,
        ])
      : pick(c, "goal.council.jax.none", [
          () => `No measured win rate walks us there by itself. We take every B+ the chart clears, and we size it.`,
          () => `The wins aren't the holdup. Every card that clears the chart gets a ticket.`,
        ])),
  );
  const nq = d.b;
  const gem =
    d.weekTrade
      ? pick(c, "goal.council.gemma.week", [() => `Today's plan, as written: ${f.raw(clip(d.weekTrade!, 120))}`, () => `The week's plan for today: ${f.raw(clip(d.weekTrade!, 120))}`])
      : nq?.draw
        ? pick(c, "goal.council.gemma.draw", [() => `${nq.say} is ${nq.htf === "bull" ? "bullish" : nq.htf === "bear" ? "bearish" : "undecided"} on the higher frames; the draw is ${f.raw(nq.draw!.name)} at ${f.lvl(nq.draw!.price)}.`, () => `Where price wants to go: ${f.raw(nq.draw!.name)}, ${f.lvl(nq.draw!.price)}. Everything else is noise on the way.`])
        : null;
  lines.push(line("Gemma", ANIM.Gemma.wall!, gem));
  if (g.ladder.n > 0) {
    const r = g.ladder.room;
    lines.push(
      line("Vince", ANIM.Vince.watch!, pick(c, "goal.council.vince", [
        () => `${r ? `The room's strike is ${f.usd(r.askUsd)} a contract — ${f.int(r.contracts)} is ${f.usd(r.askUsd * r.contracts)}, inside the ${f.pct(g.capFrac * 100, 0)} cap. ` : ""}The ladder runs ${f.usd(g.ladder.cheapestUsd ?? 0)} to ${f.usd(g.ladder.richestUsd ?? 0)} a contract, down to delta ${f.raw(g.minDelta.toFixed(2))}. We don't drop delta just to buy more.`,
        () => `Contracts: ${f.int(g.ladder.n)} strikes, ${f.usd(g.ladder.cheapestUsd ?? 0)} to ${f.usd(g.ladder.richestUsd ?? 0)} each.${r ? ` The room's strike is ${f.usd(r.askUsd)}. ${f.int(r.contracts)} of them is ${f.usd(r.askUsd * r.contracts)}, inside the cap.` : ""} Cheaper than that is a different delta, not this trade.`,
      ])),
    );
  }
  const out = compact(lines).slice(0, 9);
  return out.length >= 5 ? { lines: out, moves: boardMoves(out) } : null;
}

export interface PaceData {
  g: GoalLite;
  from: string | null;
}

export function exPace(c: Ctx, d: PaceData): Ex | null {
  const f = c.f;
  const g = d.g;
  if (g.paceLabel == null || g.pathToday == null || g.paceUsd == null) return null;
  const label = g.paceLabel;
  const lines = compact([
    line("Nova", ANIM.Nova.analyze!, pick(c, "goal.pace.nova", [
      () => `Pace: ${f.usd(g.equity)} against a path of ${f.usd(g.pathToday!)} — ${signed(g.paceUsd!)}${f.usd(g.paceUsd!)}. ${label === "on path" ? "On the path." : label === "ahead" ? "Ahead of it." : "Behind it."}`,
      () => `The geometric path asks ${f.usd(g.pathToday!)} today; the best account has ${f.usd(g.equity)}. ${label === "on path" ? "That's on path." : label === "ahead" ? "Ahead." : "Behind."}`,
    ])),
    label === "ahead"
      ? line("Jax", ANIM.Jax.shout!, pick(c, "goal.pace.jax.ahead", [() => `Ahead! Write it down. Louder.`, () => `Don't touch anything. Ahead is ahead.`]))
      : label === "behind"
        ? line("Sterling", ANIM.Sterling.arms!, pick(c, "goal.pace.sterling.behind", [() => `Behind a path isn't a rule being broken. The path is an arithmetic line, not a target for the size.`, () => `Being behind doesn't change the gates. Not by a dollar.`]))
        : line("Vince", ANIM.Vince.watch!, pick(c, "goal.pace.vince.on", [() => `On path. Nothing changes.`, () => `Right where the line says. Keep it boring.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

export interface ReplanData {
  g: GoalLite;
}

export function exReplan(c: Ctx, d: ReplanData): Ex | null {
  const f = c.f;
  const g = d.g;
  const need = g.perSessionNeeded != null ? f.pct(g.perSessionNeeded * 100, 0) : null;
  const lines = compact([
    line("Nova", ANIM.Nova.write!, pick(c, "goal.replan.nova", [
      () => `Entries are over for today. Best account ${f.usd(g.equity)}; ${f.int(g.daysLeft)} ${plural(g.daysLeft, "session", "sessions")} left${need ? `, which is now ${need} a session` : ""}. Cards seen this window: ${f.raw(g.expectedTickets.toFixed(1))} expected from here.`,
      () => `Re-plan. ${f.usd(g.equity)} now, ${f.usd(g.target)} to go, ${f.int(g.daysLeft)} ${plural(g.daysLeft, "session", "sessions")}${need ? ` — ${need} a session` : ""}.`,
    ])),
    line("Sterling", ANIM.Sterling.tablet!, pick(c, "goal.replan.sterling", [
      () => `Tomorrow at the cap: ${f.int(g.plan.contracts)} ${plural(g.plan.contracts, "contract", "contracts")}, ${f.usd(g.plan.debitUsd)}. A bad day costs at most ${f.usd(g.plan.maxLossUsd)}.`,
      () => `Same rules tomorrow: ${f.usd(g.plan.debitUsd)} at the cap, and the day's loss is stopped at ${f.usd(g.plan.maxLossUsd)}.`,
    ])),
    g.paceLabel === "behind"
      ? line("Jax", ANIM.Jax.point!, pick(c, "goal.replan.jax.behind", [() => `Behind. So tomorrow I take the card, whatever the card is. …Whatever the gates allow.`, () => `I'm not saying relax the gates. I'm saying look at the clock.`]))
      : line("Vince", ANIM.Vince.watch!, pick(c, "goal.replan.vince", [() => `Cash close. Whatever is still open follows the chart, not the lunch bell.`, () => `The session is over. We start clean tomorrow.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: boardMoves(lines) } : null;
}

export interface LadderCardData {
  g: GoalLite;
  card: CardRead;
}

export function exLadderCard(c: Ctx, d: LadderCardData): Ex | null {
  const f = c.f;
  const g = d.g;
  const best = g.ladder.best;
  if (!best || best.pTarget == null) return null;
  const room = g.ladder.room;
  const lines = compact([
    line("Nova", ANIM.Nova.analyze!, pick(c, "goal.ladder.nova", [
      () => `On this card the best odds of the goal are on ${f.raw(best.name)} — ${f.usd(best.askUsd)}, delta ${f.raw(best.delta.toFixed(2))}, ${f.int(best.contracts)} at the cap: ${oddsTxt(f, best.pTarget!)} if every ticket looked like this one.`,
      () => `Priced on the card: ${f.raw(best.name)} at ${f.usd(best.askUsd)} gives the goal ${oddsTxt(f, best.pTarget!)} — a model on one card, not a measurement.`,
    ])),
    room && room.name !== best.name
      ? line("Vince", ANIM.Vince.watch!, pick(c, "goal.ladder.vince", [
          () => `The room's own strike is ${f.raw(room.name)} at ${f.usd(room.askUsd)}: ${f.int(room.contracts)} at the cap.`,
          () => `${f.raw(room.name)} is the room's pick — ${f.usd(room.askUsd)}, ${f.int(room.contracts)} of them.`,
        ]))
      : null,
    line("Sterling", ANIM.Sterling.arms!, pick(c, "goal.ladder.sterling", [
      () => `Cheaper isn't safer. The ${f.int(Math.abs(ROOM_MANDATE.hardStopPct))}% stop sits closer to the entry on the cheap ones.`,
      () => `More contracts, tighter stop. The odds are better for the goal and worse for the account.`,
    ])),
    line("Jax", ANIM.Jax.shout!, pick(c, "goal.ladder.jax", [() => `More contracts. That's the whole point.`, () => `Give me the cheap ones and a card that works.`])),
  ]);
  return lines.length >= 3 ? { lines, moves: {} } : null;
}

export interface DecisionData {
  col: { id: string; severity: string; title: string; detail: string; decision: string | null };
}

export function exDecision(c: Ctx, d: DecisionData): Ex | null {
  const f = c.f;
  const col = d.col;
  if (!col.decision) return null;
  const lines = compact([
    line("Sterling", ANIM.Sterling.arms!, pick(c, "goal.decision.sterling", [
      () => `A call that's the trader's: ${f.raw(col.title)}. ${f.raw(clip(col.detail, 150))}`,
      () => `This one isn't ours to move — ${f.raw(col.title)}. ${f.raw(clip(col.detail, 150))}`,
    ])),
    line("Vince", ANIM.Vince.watch!, pick(c, "goal.decision.vince", [
      () => `${f.raw(clip(col.decision!, 150))}`,
      () => `What's needed: ${f.raw(clip(col.decision!, 140))}`,
    ])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

export interface LeagueData {
  rows: SeatRowLite[];
  goal: GoalLite | null;
  tickets: number;
}

export function exLeagueTable(c: Ctx, d: LeagueData): Ex | null {
  const f = c.f;
  const top = d.rows.slice(0, 3);
  if (!top.length) return null;
  const board = top.map((r) => `${nameOf(r.id)} ${f.usd(r.equity)}`).join(", ");
  const leader = top[0]!;
  const lines = compact([
    line("Nova", ANIM.Nova.write!, d.tickets > 0
      ? pick(c, "hb.league.nova", [() => `League: ${board}.`, () => `Standings — ${board}. ${f.int(d.tickets)} closed ${plural(d.tickets, "ticket", "tickets")} between all of them.`])
      : pick(c, "hb.league.nova.none", [() => `League: nobody has closed a ticket. Everyone's at ${f.usd(d.rows[0]?.equity ?? 0)}. The cards are what's scarce.`, () => `Six accounts, no closed tickets yet. The standing is a tie.`])),
    d.tickets > 0 && leader.pnl > 0
      ? line(voice(leader.id), anim(voice(leader.id)), pick(c, `hb.league.leader.${leader.id}`, [() => `I'll take it. Don't clap.`, () => `Noted. I'll try not to enjoy it.`]))
      : line("Jax", ANIM.Jax.point!, pick(c, "hb.league.jax", [() => `Somebody take a ticket.`, () => `The race would be better with a card in it.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: boardMoves(lines) } : null;
}

export interface GoalNightData {
  g: GoalLite;
  next: WeekLite["next"];
}

export function exGoalNight(c: Ctx, d: GoalNightData): Ex | null {
  const f = c.f;
  const g = d.g;
  const need = g.perSessionNeeded != null ? f.pct(g.perSessionNeeded * 100, 0) : null;
  const rel = d.next && d.next.news.length ? d.next.news.slice(0, 2).map((n) => `${f.raw(n.name)} ${f.raw(n.timeEt)}`).join(", ") : null;
  const lines = compact([
    line("Nova", ANIM.Nova.write!, pick(c, "hb.goalnight.nova", [
      () => `${f.int(g.daysLeft)} ${plural(g.daysLeft, "session", "sessions")} left, ${f.usd(g.equity)} to ${f.usd(g.target)}${need ? ` — ${need} a session` : ""}. The window's expected cards from here: ${f.raw(g.expectedTickets.toFixed(1))}.`,
      () => `Night read. ${f.x(g.multipleNeeded)} to go over ${f.int(g.daysLeft)} ${plural(g.daysLeft, "session", "sessions")}.`,
    ])),
    d.next
      ? line("Gemma", ANIM.Gemma.wall!, pick(c, "hb.goalnight.gemma", [
          () => `${f.raw(d.next!.weekday)}: ${f.raw(d.next!.kind)}.${rel ? ` Releases: ${rel}.` : " No scheduled releases."}`,
          () => `Tomorrow is ${f.raw(d.next!.weekday)} — ${f.raw(d.next!.kind)}.${rel ? ` ${rel}.` : ""}`,
        ]))
      : null,
    line("Sterling", ANIM.Sterling.tablet!, pick(c, "hb.goalnight.sterling", [() => `Same gates tomorrow. The goal doesn't get a vote on them.`, () => `Nothing in the plan relaxes a rule. If the cards don't come, we don't trade.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: boardMoves(lines) } : null;
}

export interface GoalFinalData {
  g: GoalLite;
  rows: SeatRowLite[];
}

export function exGoalFinal(c: Ctx, d: GoalFinalData): Ex | null {
  const f = c.f;
  const top = d.rows[0];
  if (!top) return null;
  const lines = compact([
    line("Nova", ANIM.Nova.write!, pick(c, "goal.final.nova", [
      () => `The window is over. Best account: ${nameOf(top.id)} at ${f.usd(top.equity)} of ${f.usd(d.g.target)}.`,
      () => `Final standing: ${nameOf(top.id)}, ${f.usd(top.equity)}. The goal was ${f.usd(d.g.target)}.`,
    ])),
    line("Sterling", ANIM.Sterling.tablet!, pick(c, "goal.final.sterling", [() => `The record is what's worth keeping: tickets, declined tickets, the refusals. That's the next window's evidence.`, () => `What we learned goes on the R&D board, not into the rules.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: boardMoves(lines) } : null;
}

/* ── R&D ───────────────────────────────────────────────────────────────── */

type Exp = RndLite["experiments"][number];

const STATUS_WORD: Record<Exp["status"], string> = {
  collecting: "still collecting",
  supported: "supported",
  not_supported: "not supported",
  undecided: "undecided",
};

export function exRndVerdict(c: Ctx, d: { exp: Exp }): Ex | null {
  const f = c.f;
  const e = d.exp;
  const lines = compact([
    line(e.owner, anim(e.owner), pick(c, `rnd.verdict.${e.owner}`, [
      () => `${f.raw(e.title)} — ${STATUS_WORD[e.status]}. ${f.raw(clip(e.read, 150))}`,
      () => `My experiment reads ${STATUS_WORD[e.status]}: ${f.raw(clip(e.read, 150))}`,
    ])),
    e.proposal
      ? line("Sterling", ANIM.Sterling.tablet!, pick(c, "rnd.verdict.proposal", [() => `${f.raw(clip(e.proposal!, 190))} It's the trader's to apply.`, () => `Proposal, for the trader: ${f.raw(clip(e.proposal!, 170))}`]))
      : line("Nova", ANIM.Nova.analyze!, pick(c, "rnd.verdict.nova", [() => `A verdict on ${f.int(e.n)} ${plural(e.n, "sample", "samples")} is a hint. It changes nothing in the desk.`, () => `Noted, logged. ${f.int(e.n)} isn't a rule.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: { [e.owner]: OFFICE("office_rnd") } } : null;
}

export function exRndStandup(c: Ctx, d: { exp: Exp }): Ex | null {
  const f = c.f;
  const e = d.exp;
  const other: Character = e.owner === "Jax" ? "Sterling" : "Jax";
  const lines = compact([
    line(e.owner, anim(e.owner), pick(c, `hb.rnd.${e.id}`, [
      () => `Working on: ${f.raw(e.title)} ${f.int(e.n)} of ${f.int(e.nNeeded)} so far. ${f.raw(clip(e.read, 110))}`,
      () => `${f.raw(e.title)} — ${f.int(e.n)} of ${f.int(e.nNeeded)} ${plural(e.nNeeded, "sample", "samples")} in. ${f.raw(clip(e.read, 110))}`,
    ])),
    line(other, anim(other), pick(c, `hb.rnd.reply.${other}`, other === "Jax"
      ? [() => `Tell me when it says I'm right.`, () => `I'll believe it when there's a number with a plus in front.`]
      : [() => `A question with a fixed answer rule. Good. Leave the rule alone while the data comes in.`, () => `Don't move the bar once it's registered.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: { [e.owner]: OFFICE("office_rnd") } } : null;
}

/** Which annex office an audit item is worked from. */
const AUDIT_OFFICE = { data: "office_ops", execution: "office_ops", goal: "office_goal", rules: "office_rnd", model: "office_rnd", process: "office_rnd" } as const;

/**
 * One finding from the desk audit (audit.ts): its owner reports it from the office it belongs to, and somebody else says
 * whose call it is. The title, the evidence and the proposal are the audit's own words — nothing is composed here.
 */
export function exAudit(c: Ctx, d: { item: AuditItem }): Ex | null {
  const f = c.f;
  const it = d.item;
  const other: Character = it.owner === "Sterling" ? "Nova" : "Sterling";
  const lines = compact([
    line(it.owner, anim(it.owner), pick(c, `audit.open.${it.owner}`, [
      () => `Desk audit: ${f.raw(it.title)}. ${f.raw(stop(clip(it.evidence, 150)))}`,
      () => `Something's wrong with the desk — ${f.raw(it.title)}. ${f.raw(stop(clip(it.evidence, 150)))}`,
    ])),
    line(other, anim(other), pick(c, `audit.reply.${other}`, [
      () => `${f.raw(stop(clip(it.proposal, 170)))} That's the trader's to decide.`,
      () => `For the trader: ${f.raw(stop(clip(it.proposal, 160)))}`,
    ])),
  ]);
  return lines.length >= 2 ? { lines, moves: { [it.owner]: OFFICE(AUDIT_OFFICE[it.area]) } } : null;
}

export interface LadderPlainData {
  g: GoalLite;
}

/** The price list, when there is no card to price it on. */
export function exLadderPlain(c: Ctx, d: LadderPlainData): Ex | null {
  const f = c.f;
  const g = d.g;
  if (!g.ladder.n || g.ladder.cheapestUsd == null || g.ladder.richestUsd == null) return null;
  const lines = compact([
    line("Vince", ANIM.Vince.watch!, pick(c, "hb.ladder.vince", [
      () => `Contracts today: ${f.usd(g.ladder.cheapestUsd!)} to ${f.usd(g.ladder.richestUsd!)} across ${f.int(g.ladder.n)} strikes, delta down to ${f.raw(g.minDelta.toFixed(2))}.`,
      () => `The ladder is ${f.int(g.ladder.n)} strikes deep — ${f.usd(g.ladder.cheapestUsd!)} at the bottom, ${f.usd(g.ladder.richestUsd!)} at the money.`,
    ])),
    line("Nova", ANIM.Nova.analyze!, pick(c, "hb.ladder.nova", [
      () => `With no card there's nothing to price it on. When one prints, every rung gets the room's three paths.`,
      () => `Prices without a plan are only prices. The odds come with the card.`,
    ])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}
