/**
 * What the office shows, derived from a decision the room already made.
 *
 * Nothing here gates, sizes or sends. A late tape, a veto and a halt were
 * already refusals. These are the words and the colours for them.
 */
import { EXEC_LIMITS } from "./exec/limits";

export type Stamp = "EV" | "HALT" | "TAPE" | "TIGHT" | "ONE" | "CLOCK" | "CASH" | null;
export type Tint = "ink" | "amber" | "hatch";
export type Blotter = "down" | "live" | "back";
export type Flight = "fill" | "return" | "none";
export type RangeZone = "discount" | "equilibrium" | "premium";

export interface FloorCues {
  armed: boolean;
  /** The one missing SMC layer, while it is still missing. */
  missing: string | null;
  range: { zone: RangeZone; hostile: boolean } | null;
  flight: Flight;
  /** The wall plate. Lit only when the server kill is on. The browser cannot arm. */
  kill: { lit: boolean; flat: boolean };
  stamp: Stamp;
  blotter: Blotter;
  sterlingFirst: boolean;
  savedUsd: number;
  costUsd: number;
  /** Model P(T1) minus the realized-decile rate, in probability points. Quoted, not a gate. */
  calGap: number | null;
  /** The pre-registered experiment closest to its sample. */
  experiment: { title: string; n: number; nNeeded: number } | null;
  clock: { dim: boolean; stopped: boolean };
  judas: { on: boolean; side: "long" | "short" | null };
  /** High-impact release inside T−15. A medium release does not frost the glass. */
  frost: boolean;
  tint: Tint;
  /** Futures-print age. Null when the print was never dated. */
  lagSec: number | null;
  lagHot: boolean;
  /** Broker quote age, when the desk has one. The hand is the tape age otherwise, and the face says so. */
  quoteAgeSec: number | null;
  quoteHot: boolean;
  /** Straight winners the measured book would need, against how many tickets it can spend. */
  ladderBreak: boolean;
  /** Paper seats that are done, or blocked and not leading. */
  seated: string[];
  leader: string | null;
}

export interface CueParts {
  etMin: number;
  beat: string | null;
  refusalGate: string | null;
  refusal: string | null;
  execute: boolean;
  action: string | null;
  feedKind: string | null;
  lagSec: number | null;
  synthetic: boolean;
  verdict: string | null;
  band: string | null;
  side: "long" | "short" | null;
  tier: string | null;
  missing: string | null;
  /** 0 at the low of the bars on screen, 1 at the high. Null when there are no bars. */
  rangePos: number | null;
  jaxLastChaseWrong: boolean;
  quoteAgeSec: number | null;
  experiments: { title: string; n: number; nNeeded: number; status: string }[];
  seats: { name: string; status: string }[];
  /** Newest seat event per name is not required; pass names whose latest event was a block. */
  blockedSeats: string[];
  leader: string | null;
  /** Refused tickets, priced. Positive pnl is a veto that cost; negative is one that saved. */
  refusals: { pnlUsd: number }[];
  modelP: number | null;
  calP: number | null;
  /** Minutes until the next high-impact release. Null if none is next. */
  highImpactMin: number | null;
  killed: boolean;
  openPositions: number;
  winsNeed: number | null;
  tradeBudget: number | null;
}

export function stampOf(gate: string | null, refusal: string | null): Stamp {
  if (refusal && /TOO TIGHT/i.test(refusal)) return "TIGHT";
  if (!gate) return null;
  if (gate === "ev" || gate === "t1_pays") return "EV";
  if (gate === "halt_day" || gate === "halt_week") return "HALT";
  if (gate === "fresh_tape") return "TAPE";
  if (gate === "cash_cap") return "CASH";
  if (gate === "one_book" || gate === "one_bias" || gate === "no_average") return "ONE";
  if (gate === "clock" || gate === "before_flat" || gate === "after_ten" || gate === "killzone") return "CLOCK";
  return null;
}

function freshTape(kind: string | null, lagSec: number | null, synthetic: boolean): boolean {
  if (synthetic || (kind != null && /synthetic/i.test(kind))) return false;
  return lagSec != null && lagSec <= EXEC_LIMITS.maxFeedLagSec;
}

export function floorCues(p: CueParts): FloorCues {
  const fresh = freshTape(p.feedKind, p.lagSec, p.synthetic);
  const hatch = p.synthetic || (p.feedKind != null && /synthetic/i.test(p.feedKind));
  const tint: Tint = hatch ? "hatch" : fresh ? "ink" : "amber";
  const veto = p.beat === "vetoed";
  let flight: Flight = "none";
  if (p.execute && p.action === "BUY_OPEN" && fresh) flight = "fill";
  else if (veto && p.refusalGate !== "fresh_tape") flight = "return";
  const zone: RangeZone | null =
    p.rangePos == null ? null : p.rangePos < 0.45 ? "discount" : p.rangePos > 0.55 ? "premium" : "equilibrium";
  const hostile = zone != null && p.side != null && ((p.side === "long" && zone === "premium") || (p.side === "short" && zone === "discount"));
  const open = p.experiments.filter((e) => e.status === "collecting" && e.nNeeded > 0);
  const closest = open.slice().sort((a, b) => b.n / b.nNeeded - a.n / a.nNeeded)[0] ?? null;
  let savedUsd = 0;
  let costUsd = 0;
  for (const r of p.refusals) {
    if (r.pnlUsd < 0) savedUsd += -r.pnlUsd;
    else if (r.pnlUsd > 0) costUsd += r.pnlUsd;
  }
  const seated = [
    ...p.seats.filter((s) => s.status !== "running").map((s) => s.name),
    ...p.blockedSeats.filter((n) => n !== p.leader),
  ];
  const judasOn = p.etMin >= 9 * 60 + 30 && p.etMin < 9 * 60 + 45;
  return {
    armed: p.verdict === "ARMED",
    missing: p.missing && p.missing.trim() && p.verdict !== "ARMED" ? p.missing.trim() : null,
    range: zone ? { zone, hostile } : null,
    flight,
    kill: { lit: p.killed, flat: p.openPositions === 0 },
    stamp: veto || (p.refusalGate != null && p.beat !== "fill") ? stampOf(p.refusalGate, p.refusal) : null,
    blotter: flight === "fill" || p.tier === "live" ? "live" : flight === "return" || p.tier === "gone" ? "back" : "down",
    sterlingFirst: p.jaxLastChaseWrong,
    savedUsd,
    costUsd,
    calGap: p.modelP != null && p.calP != null ? p.modelP - p.calP : null,
    experiment: closest ? { title: closest.title, n: closest.n, nNeeded: closest.nNeeded } : null,
    clock: {
      dim: p.etMin >= 10 * 60 && p.etMin < 11 * 60 && p.band !== "A+",
      stopped: p.etMin >= 11 * 60,
    },
    judas: { on: judasOn, side: judasOn ? p.side : null },
    frost: p.highImpactMin != null && p.highImpactMin >= 0 && p.highImpactMin <= 15,
    tint,
    lagSec: p.lagSec,
    lagHot: !fresh && !hatch,
    quoteAgeSec: p.quoteAgeSec,
    quoteHot: p.quoteAgeSec != null && p.quoteAgeSec > EXEC_LIMITS.maxQuoteAgeSec,
    ladderBreak: p.winsNeed != null && p.tradeBudget != null && p.winsNeed > p.tradeBudget,
    seated: [...new Set(seated)],
    leader: p.leader,
  };
}
