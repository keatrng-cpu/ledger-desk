/**
 * THE R&D BOARD — the five, trying to make the desk better, on evidence they can actually produce.
 *
 * The trader's brief (2026-10-05): the agents are "always trying to make the whole ledger desk better, more profitable and
 * more probable" — and competing and cooperating while they do. The honest form of that is not self-modification (at
 * about one qualifying ticket in five sessions a seat sees two or three decisions in a window; adapting on that is
 * fitting noise). It is a short list of QUESTIONS, each owned by one person, each answered by a fixed rule on the
 * evidence the seats and the ghost room produce going forward, with the sample the answer rests on printed beside it.
 *
 *   PRE-REGISTERED. The question, the metric, the minimum sample and the bar for each experiment are constants in this file,
 *   dated; changing one is a visible edit to a committed file, never something that happens while the data is being read.
 *   LIVE-FORWARD, NOT A TEST OF A RULE. These are small samples on a moving tape. A verdict here says what the last N
 *   tickets did; it is never enough to change a rule (the desk's own bar for that is the four-year capture at family
 *   z ≥ 2.87, CLAUDE.md). What a verdict can do is name the experiment worth running offline.
 *   AGENTS PROPOSE, THE TRADER APPLIES. A proposal is text with its numbers, for the trader. Nothing here writes a rule, a
 *   config, a gate or a size; nothing here calls a model. Every number is arithmetic on the lab's and the seats' own books.
 */

import type { GoalSpec } from "./goal";
import { opportunityRate } from "./goal";
import type { RoomLab } from "./lab";
import { labRead } from "./lab";
import type { SeatBook, SeatId } from "./seats";
import type { Character } from "./orchestrator";

export const RND_REGISTERED = "2026-10-05";

/** The fixed numbers every experiment is read against. */
export const RND_BARS = {
  /** One-sided 10% (t ≈ 1.28): a descriptive threshold on a small sample, not a significance claim. */
  t: 1.28,
  /** Plans scored before the card's odds are read against what happened. */
  calibrationN: 30,
  /** The widest honest gap between the mean P(T1) and the realized T1 rate. */
  calibrationGap: 0.1,
  /** Refused tickets per gate before the gate is read. */
  gateN: 10,
  /** Tickets on each side of a comparison before it is read. */
  armN: 8,
  /** Matched cards before the ladder is read against the room's two strikes. */
  pairsN: 8,
  /** Sessions watched before the desk's ticket rate is read against the planner's. */
  sessionsN: 10,
} as const;

export type RndStatus = "collecting" | "supported" | "not_supported" | "undecided";

export interface RndExperiment {
  id: string;
  owner: Character;
  title: string;
  /** What is being asked, and the metric and bar it is answered by — fixed in advance. */
  question: string;
  bar: string;
  /** What the sample is, how big, and the one-line reading. */
  n: number;
  nNeeded: number;
  status: RndStatus;
  read: string;
  /** Text for the trader when there is something to do about it; null otherwise. */
  proposal: string | null;
}

/* ── Arithmetic ────────────────────────────────────────────────────────── */

export function meanOf(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function sdOf(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = meanOf(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** One-sample t of the mean against 0. Null when the sample cannot support one (n < 2 or no spread). */
export function tOne(xs: number[]): number | null {
  const sd = sdOf(xs);
  return xs.length >= 2 && sd > 0 ? meanOf(xs) / (sd / Math.sqrt(xs.length)) : null;
}

/** Welch's t for mean(a) − mean(b). Null when either side has fewer than 2 or both have no spread. */
export function tWelch(a: number[], b: number[]): number | null {
  if (a.length < 2 || b.length < 2) return null;
  const se = Math.sqrt(sdOf(a) ** 2 / a.length + sdOf(b) ** 2 / b.length);
  return se > 0 ? (meanOf(a) - meanOf(b)) / se : null;
}

/** 95% interval for a Poisson mean from a count (square-root transform; the rule of three at zero). */
export function poissonCI(k: number): { lo: number; hi: number } {
  if (k <= 0) return { lo: 0, hi: 3 };
  return { lo: Math.max(0, (Math.sqrt(k) - 0.98) ** 2), hi: (Math.sqrt(k) + 0.98) ** 2 };
}

const usd = (n: number) => `${n < 0 ? "−" : "+"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const pts = (p: number) => `${(p * 100).toFixed(0)}`;
const tTxt = (t: number | null) => (t == null ? "t n/a" : `t ${t >= 0 ? "+" : "−"}${Math.abs(t).toFixed(1)}`);
const sig = (t: number | null, dir: 1 | -1) => t != null && t * dir >= RND_BARS.t;

/* ── The experiments ───────────────────────────────────────────────────── */

export interface RndRead {
  registered: string;
  experiments: RndExperiment[];
  /** How many have a verdict, and how many are still collecting. */
  decided: number;
  collecting: number;
}

export function rndRead(a: { lab: RoomLab; seats: SeatBook | null; goal: GoalSpec; closedRoom: { id: string; pnlUsd: number }[] }): RndRead {
  const { lab, seats } = a;
  const read = labRead(lab, a.closedRoom);
  const out: RndExperiment[] = [];

  /* Nova — are the odds on the card honest? */
  {
    const c = read.calibration;
    const n = c.n;
    const gap = c.meanP != null && c.hitRate != null ? c.meanP - c.hitRate : null;
    let status: RndStatus = "collecting";
    if (n >= RND_BARS.calibrationN && gap != null) status = Math.abs(gap) <= RND_BARS.calibrationGap + 1e-9 ? "supported" : "not_supported";
    out.push({
      id: "nova-calibration",
      owner: "Nova",
      title: "Are the card's odds honest?",
      question: "Over the plans the room has priced and followed to the flat, does the average P(T1 before the flat) match how often T1 printed?",
      bar: `${RND_BARS.calibrationN} scored plans; honest when the mean P(T1) is within ${pts(RND_BARS.calibrationGap)} points of the realized rate`,
      n,
      nNeeded: RND_BARS.calibrationN,
      status,
      read:
        gap == null
          ? "no plan has been scored yet"
          : `${n} plans · the card said ${pts(c.meanP!)}% on average · T1 printed ${pts(c.hitRate!)}% · gap ${gap >= 0 ? "+" : "−"}${pts(Math.abs(gap))} points${c.brier != null ? ` · Brier ${c.brier.toFixed(3)}` : ""}`,
      proposal:
        status === "not_supported" && gap != null
          ? `The card's P(T1) ran ${pts(Math.abs(gap))} points ${gap > 0 ? "above" : "below"} what happened over ${n} plans. A recalibration is tested on the four-year capture (scripts/build-hit-odds.mjs, family bar z ≥ 2.87), not edited live; this is the gap to test.`
          : null,
    });
  }

  /* Nova — is the opportunity rate behind the goal's arithmetic right? */
  {
    const sessions = seats?.seen.length ?? 0;
    const k = seats?.touches.length ?? 0;
    const lam = opportunityRate().perSession;
    const ci = poissonCI(k);
    const lo = sessions ? ci.lo / sessions : 0;
    const hi = sessions ? ci.hi / sessions : 0;
    let status: RndStatus = "collecting";
    if (sessions >= RND_BARS.sessionsN) status = lam >= lo && lam <= hi ? "supported" : "not_supported";
    out.push({
      id: "nova-frequency",
      owner: "Nova",
      title: "How many tickets does the desk really offer?",
      question: "The goal's odds rest on about one qualifying ticket in five sessions (evidence-dist.json × the NY AM share). How many cards actually reach their CE, ARMED with a ticket, before 11:00?",
      bar: `${RND_BARS.sessionsN} sessions watched; supported when the planner's ${lam.toFixed(2)} a session lies inside the 95% interval of the observed rate`,
      n: sessions,
      nNeeded: RND_BARS.sessionsN,
      status,
      read: sessions ? `${k} card${k === 1 ? "" : "s"} at the touch in ${sessions} session${sessions === 1 ? "" : "s"} = ${(k / sessions).toFixed(2)} a session (95% ${lo.toFixed(2)}–${hi.toFixed(2)}) · the planner uses ${lam.toFixed(2)}` : "no session watched yet",
      proposal:
        status === "not_supported"
          ? `The desk offered ${(k / sessions).toFixed(2)} cards a session (95% ${lo.toFixed(2)}–${hi.toFixed(2)}) against the ${lam.toFixed(2)} the goal's odds assume. The planner's rate is an input of goal.ts (opportunityRate), derived from the four-year files; it is yours to re-base on this window once you trust the sample.`
          : null,
    });
  }

  /* Sterling — what did each refusing gate cost or save? */
  {
    const byGate = new Map<string, number[]>();
    for (const g of lab.ghosts) if (g.kind === "refused" && g.closed) byGate.set(g.of, [...(byGate.get(g.of) ?? []), g.closed.pnlUsd]);
    const rows = [...byGate.entries()]
      .map(([gate, xs]) => ({ gate, n: xs.length, total: xs.reduce((s, x) => s + x, 0), mean: meanOf(xs), t: tOne(xs) }))
      .sort((x, y) => y.n - x.n);
    const ready = rows.filter((r) => r.n >= RND_BARS.gateN);
    const costing = ready.filter((r) => r.total > 0 && sig(r.t, 1));
    const earning = ready.filter((r) => r.total < 0 && sig(r.t, -1));
    const total = rows.reduce((s, r) => s + r.n, 0);
    const worst = [...costing].sort((x, y) => y.total - x.total)[0];
    out.push({
      id: "sterling-gates",
      owner: "Sterling",
      title: "Do the room's refusals earn their keep?",
      question: "Every ticket the room refused at the CE touch was followed to its end on the room's own rules. By the gate that refused it, did saying no save money or cost it?",
      bar: `${RND_BARS.gateN} refused tickets for a gate; "earning" when they would have lost money (t ≤ −${RND_BARS.t}), "costing" when they would have made it (t ≥ +${RND_BARS.t})`,
      n: total,
      nNeeded: RND_BARS.gateN,
      status: ready.length === 0 ? "collecting" : costing.length || earning.length ? (costing.length ? "not_supported" : "supported") : "undecided",
      read: rows.length
        ? rows.map((r) => `${r.gate} ${r.n}× ${usd(r.total)} (${tTxt(r.t)})`).join(" · ")
        : "no refused ticket has closed yet",
      proposal: worst
        ? `The "${worst.gate}" gate refused ${worst.n} tickets that would have made ${usd(worst.total)} (${tTxt(worst.t)}). Sterling's rule: that gate is not touched on a window of live-forward tickets — it is re-measured on the four-year capture at z ≥ 2.87 first (scripts/measure-room-ev.mjs is the harness).`
        : null,
    });
  }

  /* The seats' own questions need the race. */
  const seat = (id: SeatId) => seats?.seats.find((s) => s.id === id) ?? null;

  /* Gemma — does the structure filter pick better tickets? */
  {
    const g = seat("structure");
    const taken = g ? g.closed.map((c) => c.pnlUsd) : [];
    const declined = g ? g.skipped.filter((x) => x.closed && x.meta?.gate === "style").map((x) => x.closed!.pnlUsd) : [];
    const t = tWelch(taken, declined);
    const ready = taken.length >= RND_BARS.armN && declined.length >= RND_BARS.armN;
    out.push({
      id: "gemma-structure",
      owner: "Gemma",
      title: "Does the structure filter pick better tickets?",
      question: "Of the cards that passed the room's rules, the ones the higher timeframe and the dealing range backed against the ones Gemma declined for structure: which made more per ticket?",
      bar: `${RND_BARS.armN} tickets on each side; supported when the backed ones beat the declined (t ≥ +${RND_BARS.t}), not supported when the declined ones beat them (t ≤ −${RND_BARS.t})`,
      n: Math.min(taken.length, declined.length),
      nNeeded: RND_BARS.armN,
      status: !ready ? "collecting" : sig(t, 1) ? "supported" : sig(t, -1) ? "not_supported" : "undecided",
      read: taken.length + declined.length === 0 ? "no ticket on either side yet — waiting for a card Gemma backs or declines" : `backed ${taken.length}× avg ${taken.length ? usd(meanOf(taken)) : "—"} · declined for structure ${declined.length}× avg ${declined.length ? usd(meanOf(declined)) : "—"} · ${tTxt(t)}`,
      proposal:
        ready && sig(t, -1)
          ? `The tickets Gemma declined for structure made ${usd(meanOf(declined))} each against ${usd(meanOf(taken))} for the ones she took (${tTxt(t)}, ${taken.length} and ${declined.length}). tf-ladder.ts already says the higher timeframe carries direction, not R; this is a forward hint to re-test it offline, not a reason to change the card.`
          : null,
    });
  }

  /* Jax — does reaching down the ladder beat the room's two strikes on the same cards? */
  {
    const ladderIds: SeatId[] = ["protect", "edge", "press"];
    const room = seat("mechanical");
    const ret = (c: { pnlUsd: number; qty0: number; entryPx: number }) => c.pnlUsd / (c.qty0 * c.entryPx * 100);
    const deltas: number[] = [];
    if (room && seats) {
      const roomBy = new Map(room.closed.filter((c) => c.planKey).map((c) => [c.planKey!, ret(c)]));
      const plans = new Set<string>();
      for (const id of ladderIds) for (const c of seat(id)?.closed ?? []) if (c.planKey && roomBy.has(c.planKey)) plans.add(c.planKey);
      for (const pk of plans) {
        const xs = ladderIds.flatMap((id) => (seat(id)?.closed ?? []).filter((c) => c.planKey === pk).map(ret));
        if (xs.length) deltas.push(meanOf(xs) - roomBy.get(pk)!);
      }
    }
    const t = tOne(deltas);
    const ready = deltas.length >= RND_BARS.pairsN;
    out.push({
      id: "jax-ladder",
      owner: "Jax",
      title: "Do cheaper strikes beat the room's two?",
      question: "On the cards Vince took at the room's two strikes, what did the seats that may reach down the ladder (Sterling, Nova, Jax) make as a return on the debit, against Vince's, card by card?",
      bar: `${RND_BARS.pairsN} matched cards; supported when the ladder seats' return beats Vince's (t ≥ +${RND_BARS.t}), not supported when it trails (t ≤ −${RND_BARS.t})`,
      n: deltas.length,
      nNeeded: RND_BARS.pairsN,
      status: !ready ? "collecting" : sig(t, 1) ? "supported" : sig(t, -1) ? "not_supported" : "undecided",
      read: deltas.length ? `${deltas.length} matched card${deltas.length === 1 ? "" : "s"} · ladder seats minus Vince ${deltas.length ? `${meanOf(deltas) >= 0 ? "+" : "−"}${Math.abs(meanOf(deltas) * 100).toFixed(0)} points of debit` : "—"} per card · ${tTxt(t)}` : "no card has been taken by both Vince and a ladder seat and closed yet",
      proposal:
        ready && sig(t, 1)
          ? `Over ${deltas.length} matched cards the ladder seats returned ${(meanOf(deltas) * 100).toFixed(0)} points of debit more than the room's two strikes (${tTxt(t)}). Opening the house room to further strikes means widening your strike_offset schema and sizing each contract from the stop at its own delta (sleeve-sizing.ts); that is yours to decide and is measured offline first.`
          : ready && sig(t, -1)
            ? `The ladder seats trailed the room's two strikes by ${Math.abs(meanOf(deltas) * 100).toFixed(0)} points of debit per card over ${deltas.length} cards (${tTxt(t)}): on this window, reaching further out cost money.`
            : null,
    });
  }

  /* Vince — does cooperation pay? */
  {
    const co: number[] = [];
    const solo: number[] = [];
    for (const s of seats?.seats ?? []) for (const c of s.closed) (c.syn ? co : solo).push(c.pnlUsd);
    const t = tWelch(co, solo);
    const ready = co.length >= RND_BARS.armN && solo.length >= RND_BARS.armN;
    const dis = (seats?.syndicates ?? []).filter((y) => y.dissentUsd != null && y.dissent.length > 0);
    out.push({
      id: "vince-syndicates",
      owner: "Vince",
      title: "Does working together pay?",
      question: "Tickets held in a syndicate (two or more seats on the same card) against tickets held alone: which made more per ticket? And what were the dissenters' declined tickets worth?",
      bar: `${RND_BARS.armN} tickets on each side; supported when co-signed beats solo (t ≥ +${RND_BARS.t}), not supported when solo beats it (t ≤ −${RND_BARS.t})`,
      n: Math.min(co.length, solo.length),
      nNeeded: RND_BARS.armN,
      status: !ready ? "collecting" : sig(t, 1) ? "supported" : sig(t, -1) ? "not_supported" : "undecided",
      read: `${co.length + solo.length === 0 ? "no ticket has closed yet — nothing to compare" : `co-signed ${co.length}× avg ${co.length ? usd(meanOf(co)) : "—"} · solo ${solo.length}× avg ${solo.length ? usd(meanOf(solo)) : "—"} · ${tTxt(t)}`}${dis.length ? ` · dissenters' declined tickets on ${dis.length} card${dis.length === 1 ? "" : "s"} made ${usd(dis.reduce((s, y) => s + (y.dissentUsd ?? 0), 0))}` : ""}`,
      proposal:
        ready && sig(t, 1)
          ? `Co-signed tickets made ${usd(meanOf(co))} each against ${usd(meanOf(solo))} alone (${tTxt(t)}, ${co.length} and ${solo.length}). Worth a line in the desk's playbook for the trader to weigh: a card two or more seats back has done better than one a single seat held.`
          : null,
    });
  }

  return {
    registered: RND_REGISTERED,
    experiments: out,
    decided: out.filter((e) => e.status !== "collecting").length,
    collecting: out.filter((e) => e.status === "collecting").length,
  };
}

/** The experiment each person owns first (the talk's "what I'm working on"). */
export function ownedBy(r: RndRead, who: Character): RndExperiment[] {
  return r.experiments.filter((e) => e.owner === who);
}

/** Used by the talk and the panel to know when something is new. */
export function verdictKey(e: RndExperiment): string {
  return `${e.id}:${e.status}`;
}
