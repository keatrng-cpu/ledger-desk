/**
 * THE DEBATE — how five people argue a card from measured numbers.
 *
 * A card the room can price is argued in a fixed shape, so the argument is
 * about the trade and not about who talks loudest:
 *
 *   thesis     the card's school owner states the setup in levels
 *   price      Nova: the desk model's 8-hour odds, cut to what lands before
 *              the 11:00 flat (the measured time curve), the three paths and
 *              EV after both crossings
 *   challenge  the strongest MEASURED argument against, said by whoever owns
 *              that number (Sterling the ledger and the refusals, Gemma the
 *              clock, Vince the fill)
 *   rebuttal   the owner answers with the strongest measured argument for —
 *              or concedes, when the ledger has already said no
 *   numbers    every person's own probability and the room's number
 *   verdict    Sterling: the binding gate, or the clearance and a pre-mortem
 *
 * EACH PERSON'S NUMBER (a "lens") is a different measured slice of the same
 * question — P(T1 before the 11:00 flat) — so they genuinely disagree:
 *
 *   Nova      the desk model × the measured time curve
 *   Sterling  the model's odds read through its own OUT-OF-SAMPLE table
 *             (quant.ts calibratedP: 2025–26 deciles, pooled to be monotone)
 *             × the time curve — the same number the EV gate requires
 *   Gemma     the model × NY AM's measured T1 rate over the baseline's — a
 *             session lens the fitted model does NOT use (it tested out at
 *             z −0.54), so the lab will show whether she is right to
 *   Jax       the geometry alone, 1/(1+rr) × the time curve — he trades the
 *             picture
 *   Vince     per CARD, not per fill: the location tier's measured fill rate
 *             × Nova's number
 *
 * The lab (lab.ts) scores every lens on the plans it follows; once a person
 * has five scored plans their Brier score weights the room's number. Nobody's
 * number is a gate. Deterministic: same facts, same lines.
 */

import { EVIDENCE } from "@/lib/trading/evidence";
import { HIT_ODDS_MODEL } from "@/lib/trading/hit-odds-model";
import { MIN_TRACK, type LabRead } from "./lab";
import type { Animation, Character, RoomEntryRead } from "./orchestrator";
import { calibratedP, realizedForDecile, type OptionEv } from "./quant";

export interface Lens {
  p: number;
  basis: string;
}
export type Lenses = Record<Character, Lens>;

const CREW: Character[] = ["Jax", "Nova", "Sterling", "Gemma", "Vince"];
const clamp = (x: number) => Math.min(0.99, Math.max(0.01, x));
const pc = (p: number) => `${Math.round(p * 100)}%`;

/** NY AM's measured T1 rate over the baseline's (evidence-pack.json). Null if either is missing. */
export function sessionRatio(): { ratio: number; nyAm: number; base: number; n: number } | null {
  const am = (EVIDENCE.session ?? []).find((b) => b.key === "ny_am");
  const base = EVIDENCE.baseline;
  if (am?.t1Rate == null || base?.t1Rate == null || !(base.t1Rate > 0)) return null;
  return { ratio: am.t1Rate / base.t1Rate, nyAm: am.t1Rate, base: base.t1Rate, n: am.n };
}

function fillRate(tier: RoomEntryRead["tier"], pFill: number | null): number {
  if (tier === "live") return 1;
  if (pFill != null) return pFill;
  const f = HIT_ODDS_MODEL.fillByTier as Record<string, number>;
  return tier === "armed" ? (f.ARMED ?? 0.8) : (f.FORMING ?? 0.52);
}

/** Every person's own P(T1 before the flat) for a priced card. */
export function lensesFor(card: RoomEntryRead, ev: OptionEv, _lab: LabRead | null): Lenses {
  void _lab;
  const p8 = clamp(card.pT1 ?? ev.pT1Model);
  // At entry the window's T1 probability is p8 × the share of T1s that land inside it.
  const share = ev.window.measured ? ev.window.shareOfHitsInWindow : 1;
  const cal = calibratedP(p8);
  const sess = sessionRatio();
  const rr = card.plan?.rr1 ?? (card.plan?.t1 != null ? Math.abs(card.plan.t1 - card.plan.entry) / Math.max(1e-9, Math.abs(card.plan.entry - card.plan.stop)) : null);
  const nova = clamp(ev.window.pT1);
  return {
    Nova: { p: nova, basis: `model ${pc(p8)} in 8h × ${pc(share)} of T1s before the flat` },
    Sterling: {
      p: clamp((cal?.p ?? p8) * share),
      basis: cal ? `cards the model priced at ${pc(p8)} hit ${pc(cal.p)} out of sample (its 2025–26 table, n ${cal.n} around it)` : "no calibration table — the model's number",
    },
    Gemma: {
      p: clamp(p8 * (sess?.ratio ?? 1) * share),
      basis: sess ? `NY AM fills reached T1 ${pc(sess.nyAm)} against ${pc(sess.base)} overall (×${sess.ratio.toFixed(2)})` : "no session table — the model's number",
    },
    Jax: { p: clamp((rr != null && rr > 0 ? 1 / (1 + rr) : p8) * share), basis: rr != null ? `geometry alone: 1/(1+${rr.toFixed(2)}R)` : "no geometry — the model's number" },
    Vince: { p: clamp(nova * fillRate(card.tier, card.pFill)), basis: `per card: ${pc(fillRate(card.tier, card.pFill))} fill at ${(card.tier ?? "?").toUpperCase()} × Nova` },
  };
}

/** The room's number: equal weights until a person has MIN_TRACK scored plans, then 1/Brier. */
export function consensus(l: Lenses, lab: LabRead | null): { p: number; weighted: boolean } {
  let sw = 0;
  let sp = 0;
  let weighted = false;
  for (const c of CREW) {
    const b = lab?.track[c]?.brier;
    const w = b != null && (lab?.track[c]?.n ?? 0) >= MIN_TRACK ? 1 / Math.max(0.05, b) : 1;
    if (b != null) weighted = true;
    sw += w;
    sp += w * l[c].p;
  }
  return { p: sw > 0 ? sp / sw : l.Nova.p, weighted };
}

/* ── Who owns the thesis ───────────────────────────────────────────────── */

/** The school a card's model name belongs to (smc-canon.ts schools, by their own vocabulary). */
export function thesisOwner(strategy: string | null | undefined): Character {
  const s = (strategy ?? "").toLowerCase();
  if (/\btjr\b|sweep → 5m|choch/.test(s)) return "Jax";
  if (/blake|mech|ifvg/.test(s)) return "Nova";
  if (/\bpb\b|patty|pullback/.test(s)) return "Sterling";
  if (/ict|ote|silver|judas|power of 3|po3|amd/.test(s)) return "Gemma";
  if (/\bsmc\b|order block|breaker/.test(s)) return "Vince";
  // No school named: the room's loudest advocate pitches it.
  return "Jax";
}

/* ── Arguments ──────────────────────────────────────────────────────────── */

export interface Argument {
  who: Character;
  text: string;
  want: Animation;
  /** True when this argument alone refuses the ticket. */
  decisive: boolean;
}

const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const usdSigned = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

/** The strongest measured argument against the card, in a fixed order of strength. */
export function challengeFor(card: RoomEntryRead, ev: OptionEv, lab: LabRead | null, clockOfT1: string | null): Argument {
  const t1 = ev.scenarios.find((s) => s.kind === "t1");
  const loss = ev.scenarios.find((s) => s.kind === "loss");
  const none = ev.scenarios.find((s) => s.kind === "none");
  const gateLab = lab?.refusals.find((r) => r.gate === "ev");
  if (ev.evUsd <= 0) {
    const ghost = gateLab && gateLab.n >= 3 ? ` The ghost room has followed ${gateLab.n} of these refusals: ${usdSigned(gateLab.pnlUsd)} between them.` : "";
    return {
      who: "Sterling",
      text: `The paths don't pay. T1 ${pc(ev.window.pT1)} for ${usdSigned(t1?.pnlUsd ?? 0)}, loss ${pc(ev.window.pLoss)} for ${usdSigned(loss?.pnlUsd ?? 0)}, flat ${pc(ev.window.pNone)} for ${usdSigned(none?.pnlUsd ?? 0)} — EV ${usdSigned(ev.evUsd)} a contract after costs.${ghost}`,
      want: "CROSSING_ARMS",
      decisive: true,
    };
  }
  if (!ev.t1Pays) {
    return {
      who: "Sterling",
      text: `Even if T1 prints ${clockOfT1 ? `by ${clockOfT1}` : "on time"}, this contract is ${usdSigned(ev.t1PnlUsd)} — theta and ${usd(ev.spreadUsd)} of spread eat the move.`,
      want: "CROSSING_ARMS",
      decisive: true,
    };
  }
  if (ev.calibrated && ev.calibrated.evUsd <= 0) {
    return {
      who: "Sterling",
      text: `On the model's ${pc(ev.pT1Model)} it's ${usdSigned(ev.evUsd)}. Out of sample, cards it priced there hit ${pc(ev.calibrated.p)} — and on that it's ${usdSigned(ev.calibrated.evUsd)} a contract. The model is optimistic exactly where options look best. I'm taking the realized number.`,
      want: "CROSSING_ARMS",
      decisive: true,
    };
  }
  if (card.patterns?.inducement || card.patterns?.mitigation) {
    const key = card.patterns.inducement ? "inducement" : "mitigation";
    const yes = (EVIDENCE[key] ?? []).find((b) => b.key === "yes");
    const no = (EVIDENCE[key] ?? []).find((b) => b.key === "no");
    return {
      who: "Sterling",
      text: `There's ${key === "inducement" ? "a decoy sweep" : "a mitigation block"} on it. Measured: ${yes?.exp != null ? `${yes.exp.toFixed(3)}R` : "?"} a card over ${yes?.n ?? "?"} fills, against ${no?.exp != null ? `${no.exp.toFixed(3)}R` : "?"} without.`,
      want: "CHECKING_TABLET",
      decisive: false,
    };
  }
  const p8 = card.pT1 ?? ev.pT1Model;
  const dec = realizedForDecile(p8);
  const calP = calibratedP(p8);
  if (dec && calP && calP.p < p8 - 0.03) {
    return {
      who: "Sterling",
      text: `The model says ${pc(p8)}. Its own decile at ${pc(dec.meanP)} realized ${pc(dec.hitRate)} out of sample over ${dec.n} fills — read monotonically that's ${pc(calP.p)}, and EV still clears at ${usdSigned(ev.calibrated?.evUsd ?? ev.evUsd)}. Noted, not blocking.`,
      want: "CHECKING_TABLET",
      decisive: false,
    };
  }
  if (ev.window.measured && ev.window.shareOfHitsInWindow < 0.5) {
    return {
      who: "Gemma",
      text: `Clock. Only ${pc(ev.window.shareOfHitsInWindow)} of T1s like this print inside ${ev.window.windowBars} bars — the rest arrive after the 11:00 flat, when the option's already sold.`,
      want: "EXPLAINING",
      decisive: false,
    };
  }
  const drag = (card.drivers ?? []).filter((d) => d.pts < 0).sort((a, b) => a.pts - b.pts)[0];
  if (drag) {
    return {
      who: "Sterling",
      text: `Biggest drag on the odds: ${drag.label.toLowerCase()}, ${drag.pts.toFixed(1)} points${drag.reliable ? " — and that effect is reliable over four years" : ""}.`,
      want: "CHECKING_TABLET",
      decisive: false,
    };
  }
  if (card.tier !== "live") {
    return {
      who: "Vince",
      text: `It hasn't filled. From ${(card.tier ?? "here").toUpperCase()} the limit fills ${pc(fillRate(card.tier, card.pFill))} of the time — the trade you don't get is the most common outcome.`,
      want: "STEADY_MONITORING",
      decisive: false,
    };
  }
  const base = EVIDENCE.baseline;
  return {
    who: "Sterling",
    text: `Base rate: every card at or above 0.65 ran ${base?.exp != null ? `${base.exp.toFixed(3)}R` : "negative"} a card. The card isn't the edge — the refusals are.`,
    want: "CROSSING_ARMS",
    decisive: false,
  };
}

/** The strongest measured argument for — or a concession when the challenge is decisive. */
export function rebuttalFor(owner: Character, card: RoomEntryRead, ev: OptionEv, challenge: Argument): Argument {
  if (challenge.decisive) {
    const lines: Record<Character, string> = {
      Jax: "Fine. Then it's a pass — but I want the ghost on the board.",
      Nova: "Agreed. A right plan in the wrong contract is still a loss.",
      Sterling: "Then the list says no, and I'm the list.",
      Gemma: "Then the numbers win. The ghost room can keep the receipt.",
      Vince: "Then nothing routes. The ghost takes it.",
    };
    return { who: owner, text: lines[owner], want: owner === "Jax" ? "POINTING" : owner === "Sterling" ? "CROSSING_ARMS" : owner === "Nova" ? "NODDING" : owner === "Gemma" ? "EXPLAINING" : "STEADY_MONITORING", decisive: false };
  }
  const want: Animation = owner === "Jax" ? "POINTING" : owner === "Nova" ? "ANALYZING" : owner === "Sterling" ? "APPROVING" : owner === "Gemma" ? "EXPLAINING" : "THUMBS_UP";
  const t1 = ev.scenarios.find((s) => s.kind === "t1");
  const sess = sessionRatio();
  if (card.tier === "live") {
    const f = HIT_ODDS_MODEL.fillByTier as Record<string, number>;
    return { who: owner, text: `It's ON the CE — a limit there filled ${pc(f.LIVE ?? 0.97)} of the time, and T1 pays ${usdSigned(t1?.pnlUsd ?? 0)} a contract when it comes.`, want, decisive: false };
  }
  if (sess && sess.ratio > 1.05) {
    return { who: owner, text: `This is NY AM: ${pc(sess.nyAm)} of morning fills reached T1 against ${pc(sess.base)} overall, over ${sess.n} fills. The window is the edge.`, want, decisive: false };
  }
  const lift = (card.drivers ?? []).filter((d) => d.pts > 0).sort((a, b) => b.pts - a.pts)[0];
  if (lift) return { who: owner, text: `${lift.label} adds ${lift.pts.toFixed(1)} points to the odds, and EV is ${usdSigned(ev.evUsd)} a contract after costs.`, want, decisive: false };
  return { who: owner, text: `EV is ${usdSigned(ev.evUsd)} a contract after both crossings. That's the bar.`, want, decisive: false };
}

/** "Jax 35% · Nova 18% · …" and the room's number — with how it moved since the room's first look at this plan. */
export function tallyLine(l: Lenses, lab: LabRead | null, planKey: string | null = null): string {
  const c = consensus(l, lab);
  const parts = CREW.map((who) => `${who} ${pc(l[who].p)}`).join(" · ");
  const first = planKey ? lab?.open.find((o) => o.key === planKey) : undefined;
  let moved = "";
  if (first) {
    const was = CREW.reduce((a, who) => a + (first.lenses[who] ?? l[who].p), 0) / CREW.length;
    const now = CREW.reduce((a, who) => a + l[who].p, 0) / CREW.length;
    const biggest = CREW.map((who) => ({ who, d: l[who].p - (first.lenses[who] ?? l[who].p) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0]!;
    if (Math.abs(now - was) >= 0.01)
      moved = ` Was ${pc(was)} at the first look — ${biggest.who} moved most (${biggest.d >= 0 ? "+" : "−"}${Math.round(Math.abs(biggest.d) * 100)} pts).`;
  }
  const best = lab
    ? CREW.filter((who) => lab.track[who]?.brier != null).sort((a, b) => (lab.track[a]!.brier ?? 1) - (lab.track[b]!.brier ?? 1))[0]
    : undefined;
  const weight = c.weighted && best ? ` (weighted by track record — ${best} has the best Brier, ${lab!.track[best]!.brier!.toFixed(3)} over ${lab!.track[best]!.n})` : "";
  return `T1 before 11:00 — ${parts}. Room ${pc(c.p)}${weight}.${moved}`;
}

/** Sterling's pre-mortem: the likeliest way a cleared ticket loses, from the numbers. */
export function preMortem(card: RoomEntryRead, ev: OptionEv): string {
  const drag = (card.drivers ?? []).filter((d) => d.pts < 0).sort((a, b) => a.pts - b.pts)[0];
  const none = ev.scenarios.find((s) => s.kind === "none");
  const loss = ev.scenarios.find((s) => s.kind === "loss");
  if ((none?.p ?? 0) >= (loss?.p ?? 0))
    return `Pre-mortem: the likeliest loser is the clock — ${pc(none?.p ?? 0)} that nothing happens and 11:00 sells it for ${usdSigned(none?.pnlUsd ?? 0)}.`;
  return `Pre-mortem: if it loses, it's the level — ${pc(loss?.p ?? 0)} for ${usdSigned(loss?.pnlUsd ?? 0)}${drag ? `, with ${drag.label.toLowerCase()} the biggest drag` : ""}.`;
}

/** Nova's whiteboard sentence when she passed on a strike — the Socratic exchange. */
export function strikeWhy(chosen: { offset: string; ev: OptionEv | null }, alt: { offset: string; ev: OptionEv | null } | null): { ask: string; answer: string } | null {
  if (!alt?.ev || !chosen.ev) return null;
  const a = chosen.ev.evPerDollar;
  const b = alt.ev.evPerDollar;
  if (Math.abs(a - b) < 0.005) return null;
  return {
    ask: `Why ${chosen.offset === "ATM" ? "at the money" : "one strike out"}?`,
    answer: `EV per dollar of debit: ${chosen.offset} ${(a * 100).toFixed(1)}¢, ${alt.offset} ${(b * 100).toFixed(1)}¢. Same budget, more expected P&L.`,
  };
}
