/**
 * What the floor's people have READ — the desk's own measured research,
 * split by whose job it is to quote it.
 *
 * Every number here comes from a committed data file the desk's scripts
 * built — `src/data/evidence-pack.json` (scripts/build-evidence-pack.mjs:
 * four years of plan moments, rule as coded) and `src/data/hit-odds-model.json`
 * (scripts/build-hit-odds.mjs) — through the same accessors the desk's cards
 * use. Nothing is typed in by hand, so a rebuilt pack changes what the room
 * says the next time it speaks, and a character can never quote a figure
 * the desk does not hold.
 *
 *   Nova     — what the edge is and is not (baseline, the stop band, Q).
 *   Vince    — where the fill is (fill rate by entry tier).
 *   Sterling — what the refusals are worth (inducement, mitigation, events).
 *   Gemma    — when the tape delivers (session buckets).
 *   Jax      — how rarely the desk actually says TAKE.
 */

import { EVIDENCE, type EvidenceBucket } from "@/lib/trading/evidence";
import { HIT_ODDS_MODEL } from "@/lib/trading/hit-odds-model";

const byKey = (arr: EvidenceBucket[] | undefined, key: string): EvidenceBucket | null =>
  (arr ?? []).find((b) => b.key === key) ?? null;

const r = (x: number | null | undefined) => (x == null ? "n/a" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(3)}R`);
const pct = (x: number | null | undefined, dp = 1) => (x == null ? "n/a" : `${(x * 100).toFixed(dp)}%`);
const n = (x: number) => x.toLocaleString("en-US");

export interface ResearchNote {
  id: string;
  /** One sentence a character can say out loud. */
  line: string;
  /** Where the number came from, for the panel's footnote. */
  source: string;
}

const PACK = "evidence-pack.json";
const ODDS = "hit-odds-model.json";

/** The baseline: what a card is worth with nothing else known. */
export function baselineNote(): ResearchNote | null {
  const b = EVIDENCE.baseline;
  if (b?.exp == null) return null;
  return {
    id: "baseline",
    line: `Every card at or above 0.65, taken as coded, ran ${r(b.exp)} a card over ${n(b.n)} fills — the card alone is not the edge.`,
    source: `${PACK} · baseline`,
  };
}

export function bandNote(): ResearchNote | null {
  const inB = byKey(EVIDENCE.inBand, "in");
  const out = byKey(EVIDENCE.inBand, "out");
  if (inB?.exp == null || out?.exp == null) return null;
  return {
    id: "band",
    line: `Stops inside 0.5–1.5 ATR ran ${r(inB.exp)} a card over ${n(inB.n)} fills; outside the band, ${r(out.exp)} over ${n(out.n)}. The band earns by what it refuses.`,
    source: `${PACK} · inBand`,
  };
}

export function qNote(): ResearchNote | null {
  const hi = byKey(EVIDENCE.q, "0.85+");
  const lo = byKey(EVIDENCE.q, "0.65-0.70");
  if (hi?.dirHit == null || lo?.dirHit == null) return null;
  return {
    id: "q",
    line: `Fit is not probability: Q 0.85+ went the card's way ${pct(hi.dirHit)} of the time, Q 0.65–0.70 went ${pct(lo.dirHit)}.`,
    source: `${PACK} · q`,
  };
}

/** Out of sample, the card's own P(T1) model against what happened. */
export function oddsNote(): ResearchNote | null {
  const v = HIT_ODDS_MODEL.validation as unknown as { oosN?: number; oosHitRate?: number } | undefined;
  if (v?.oosHitRate == null || v.oosN == null) return null;
  return {
    id: "odds",
    line: `Out of sample, ${pct(v.oosHitRate)} of ${n(v.oosN)} fills reached T1. Most fills never see the first target.`,
    source: `${ODDS} · validation`,
  };
}

export function fillTierNote(): ResearchNote | null {
  const f = HIT_ODDS_MODEL.fillByTier as unknown as Record<string, number> | undefined;
  if (!f?.LIVE || !f.ARMED || !f.FORMING) return null;
  return {
    id: "fill_tier",
    line: `A limit resting at CE filled ${pct(f.LIVE, 0)} of the time when price was already there, ${pct(f.ARMED, 0)} from inside one ATR, ${pct(f.FORMING, 0)} from further out.`,
    source: `${ODDS} · fillByTier`,
  };
}

export function inducementNote(): ResearchNote | null {
  const yes = byKey(EVIDENCE.inducement, "yes");
  const no = byKey(EVIDENCE.inducement, "no");
  if (yes?.exp == null || no?.exp == null) return null;
  return {
    id: "inducement",
    line: `A decoy sweep before the real one ran ${r(yes.exp)} a card over ${n(yes.n)} fills, against ${r(no.exp)} without one. That's a warning, not confirmation.`,
    source: `${PACK} · inducement`,
  };
}

export function mitigationNote(): ResearchNote | null {
  const yes = byKey(EVIDENCE.mitigation, "yes");
  const no = byKey(EVIDENCE.mitigation, "no");
  if (yes?.exp == null || no?.exp == null) return null;
  return {
    id: "mitigation",
    line: `Mitigation blocks ran ${r(yes.exp)} a card over ${n(yes.n)} fills against ${r(no.exp)} without — the largest sample of any concept we've measured, and it says warning.`,
    source: `${PACK} · mitigation`,
  };
}

export function eventNote(): ResearchNote | null {
  const out = byKey(EVIDENCE.event, "out-event");
  if (out?.exp == null) return null;
  return {
    id: "event",
    line: `Tape-event cards outside the killzones ran ${r(out.exp)} a card over ${n(out.n)} fills. The event opens the window; it doesn't make the trade good.`,
    source: `${PACK} · event`,
  };
}

export function sessionNote(): ResearchNote | null {
  const am = byKey(EVIDENCE.session, "ny_am");
  const ldn = byKey(EVIDENCE.session, "london");
  if (am?.t1Rate == null || ldn?.t1Rate == null) return null;
  return {
    id: "session",
    line: `NY AM fills reached T1 ${pct(am.t1Rate)} of the time against London's ${pct(ldn.t1Rate)} — the morning delivers more often, not always.`,
    source: `${PACK} · session`,
  };
}

export function takeWordNote(): ResearchNote | null {
  const take = byKey(EVIDENCE.word, "TAKE");
  const total = EVIDENCE.source?.simulated;
  if (!take || !total) return null;
  return {
    id: "take_word",
    line: `The desk said TAKE on ${n(take.signals)} of ${n(total)} cards in the four-year capture. It doesn't say it often.`,
    source: `${PACK} · word`,
  };
}

/** Rotate a non-empty list by a deterministic seed. */
export function pick<T>(xs: (T | null)[], seed: number): T | null {
  const ok = xs.filter((x): x is T => x != null);
  return ok.length ? ok[Math.abs(seed) % ok.length]! : null;
}

/** The notes each person carries, for their monitor and the Research panel. */
export function researchShelf(): Record<"Nova" | "Vince" | "Sterling" | "Gemma" | "Jax", ResearchNote[]> {
  const keep = (xs: (ResearchNote | null)[]) => xs.filter((x): x is ResearchNote => x != null);
  return {
    Nova: keep([baselineNote(), bandNote(), qNote(), oddsNote()]),
    Vince: keep([fillTierNote()]),
    Sterling: keep([inducementNote(), mitigationNote(), eventNote()]),
    Gemma: keep([sessionNote()]),
    Jax: keep([takeWordNote()]),
  };
}

export const RESEARCH_BUILT = { pack: EVIDENCE.builtAt, odds: HIT_ODDS_MODEL.builtAt };
