/**
 * The four schools as the trader describes them (ICT, TJR, PB Blake, PB Patty), and a deterministic reader that grades a card against each.
 *
 * Two layers, kept apart on purpose:
 *   - SCHOOL_BRIEF / HYBRIDS: the trader's description, stored as given (`src/data/school-brief.json`). The brain seeds from it and the
 *     Brain tab shows it. It is the trader's reading of each school, not an independent source; `smc-canon.ts` SCHOOLS is the researched,
 *     source-labelled version and is untouched.
 *   - schoolReads(): what each school would need to see on THIS card, graded from facts the desk already computes (the scanner's
 *     components, the clock, the draw, the timeframe ladder). A fact the desk does not read is "unknown", never a guess, so a character
 *     can never claim a nesting, a macro window or a closing-candle quality the desk never measured.
 *
 * This is narration and readiness. `schoolGate` can refuse a card whose own school failed a must, and it ships off until that refusal is measured. The 0.65 floor, the PATH bands, `topDown`, the one-book rule and the sleeve sizing do not read it. Four years of cards say the ladder carries direction but not R (tf-ladder.ts, 2026-10-01), and the desk acts only on a measured |z| >= 2. Where a school's style differs from a measured desk rule (TJR's 2R partial, a full exit at the first array), the brief's `deskNote` says the desk's rule stands.
 */

import raw from "@/data/school-brief.json";
import { STRATEGY_SCHOOL } from "./smc-canon";
import type { SetupCandidate } from "./scanner";
import type { SponsoredRead } from "./sponsored-gap";
import type { LadderBias, TfRead } from "./tf-ladder";

export type SchoolKey = "ict" | "tjr" | "blake" | "patty";
export const SCHOOL_KEYS: readonly SchoolKey[] = ["ict", "tjr", "blake", "patty"];

export type Facet = "market" | "entry" | "target" | "confluence" | "liquidity" | "timeframes" | "bias" | "ranges" | "arrays";
export const FACETS: readonly Facet[] = ["market", "entry", "target", "confluence", "liquidity", "timeframes", "bias", "ranges", "arrays"];

export interface BriefFacet {
  /** One sentence, written to be said aloud. */
  short: string;
  /** The trader's paragraph, as given. */
  long: string;
  /** Present where the desk's measured rule differs from the school's style. */
  deskNote?: string;
}
export interface SchoolBrief {
  name: string;
  avatar: string;
  facets: Record<Facet, BriefFacet>;
}
export interface HybridBrief {
  name: string;
  blueprint: string;
  short: string;
  long: string;
  deskNote?: string;
}

export const SCHOOL_BRIEF = raw.schools as unknown as Record<SchoolKey, SchoolBrief>;
export const HYBRIDS = raw.hybrids as unknown as Record<"ict_tjr" | "blake_patty", HybridBrief>;
export const BRIEF_SOURCE: string = raw.source;
export const BRIEF_AS_OF: string = raw.asOf;

/** The school whose rules a card's best model follows, among the four that have a grader. Null for models with none (continuation, SMT, Ronan). */
export function ownSchool(strategy: string | null | undefined): SchoolKey | null {
  const s = (STRATEGY_SCHOOL as Record<string, string | null>)[String(strategy ?? "")];
  return s === "ict" || s === "tjr" || s === "blake" || s === "patty" ? s : null;
}

/** What the voice calls each school. */
export const SCHOOL_SAY: Record<SchoolKey, string> = { ict: "ICT", tjr: "TJR", blake: "Blake", patty: "Patty" };
/** The cast seat that presents each school on the Floor. */
export const SCHOOL_AVATAR: Record<SchoolKey, string> = { ict: "Gemma", tjr: "Jax", blake: "Nova", patty: "Sterling" };

/* ── Direction: what each school reads from the timeframe ladder ─────────── */

export type Dir = "long" | "short" | "none";
export interface BiasRead {
  dir: Dir;
  why: string;
}

/** The part of the timeframe ladder the schools read. A full TfLadder satisfies it. */
export interface LadderLite {
  reads: ReadonlyArray<Pick<TfRead, "tf" | "bias" | "vsOpenPct">>;
  tier3: LadderBias;
  /** The trigger rungs (3, 2, 1 minute). Optional: only the delivery read needs them. */
  tier4?: LadderBias;
  phase: string;
}

const dirOf = (b: LadderBias | undefined | null): Dir => (b === "bull" ? "long" : b === "bear" ? "short" : "none");
const up = (d: Dir): string => (d === "long" ? "up" : "down");
const rung = (l: LadderLite, tf: TfRead["tf"]) => l.reads.find((r) => r.tf === tf) ?? null;

/**
 * Each school's direction, from closed-candle ladder reads (tf-ladder.ts), by the rungs that school names:
 *   ICT    daily, with the weekly; the daily open says whether the Judas leg has printed
 *   TJR    the 1 hour and 4 hour structure, both; he ignores the other side until it breaks on a close
 *   Blake  weekly and daily order flow
 *   Patty  the daily state, locked to the direction of the lower-timeframe shift (15 and 5 minute)
 * "none" is a real answer: the rungs disagree or are not read.
 */
export function schoolBias(school: SchoolKey, l: LadderLite | null | undefined): BiasRead {
  if (!l) return { dir: "none", why: "the ladder is not read" };
  const d = dirOf(rung(l, "1d")?.bias);
  const w = dirOf(rung(l, "1w")?.bias);
  switch (school) {
    case "ict": {
      if (d === "none") return { dir: "none", why: "the daily is not read" };
      if (w !== "none" && w !== d) return { dir: "none", why: "the daily and weekly disagree" };
      const open = rung(l, "1d")?.vsOpenPct;
      const loc = open == null ? "" : open < 0 ? ", price is below the daily open" : ", price is above the daily open";
      return { dir: d, why: `the daily${w === d ? " and weekly" : ""} is ${up(d)}${loc}` };
    }
    case "tjr": {
      const h1 = dirOf(rung(l, "1h")?.bias);
      const h4 = dirOf(rung(l, "4h")?.bias);
      if (h1 === "none" || h4 === "none") return { dir: "none", why: "the 1 hour or 4 hour structure is mixed" };
      if (h1 !== h4) return { dir: "none", why: "the 1 hour and 4 hour disagree" };
      return { dir: h1, why: `the 1 hour and 4 hour structure is ${up(h1)}` };
    }
    case "blake": {
      if (d === "none" || w === "none") return { dir: "none", why: "the weekly or daily order flow is not read" };
      if (d !== w) return { dir: "none", why: "the weekly and daily order flow disagree" };
      return { dir: d, why: `the weekly and daily order flow is ${up(d)}` };
    }
    case "patty": {
      if (d === "none") return { dir: "none", why: "the daily is not read" };
      if (l.phase === "range") return { dir: "none", why: "the daily is consolidating" };
      const t = dirOf(l.tier3);
      if (t !== "none" && t !== d) return { dir: "none", why: `the daily is ${up(d)} but the 15 and 5 minute shift is ${up(t)}` };
      return { dir: d, why: `the daily is ${up(d)} and the lower-timeframe shift ${t === d ? "agrees" : "has not turned it"}` };
    }
  }
}

/* ── Entry: what each school needs to see on this card ───────────────────── */

export type CheckState = "pass" | "fail" | "unknown";

export interface SchoolFacts {
  side: "long" | "short";
  /** The scanner's component keys present on the card. */
  components: readonly string[];
  killzoneOk: boolean;
  /** The card trades against the higher-timeframe read and the desk released that gate (htf-invalidation). */
  disrespected: boolean;
  /** The draw the card points at; `swept` true means it already traded. Null when the card names none. */
  drawName: string | null;
  drawSwept: boolean | null;
  /** First-target distance over stop distance, from the card's priced plan. */
  rr1: number | null;
  /** The card's array was tested before (the mitigation-block read); null when not read. */
  mitigated: boolean | null;
  ladder: LadderLite | null;
  /**
   * smc-master's layers for this side, when the desk has them. A present layer
   * outranks the scanner component: the component can say "sweep" on a card
   * whose sequence says there was none.
   */
  layers?: readonly { id: string; state: "pass" | "wait" | "fail" }[] | null;
  /** PB's sponsored-gap read (sponsored-gap.ts). Absent means the higher-timeframe gaps were not read: unknown, never a pass. */
  sponsored?: Pick<SponsoredRead, "state" | "trigger"> | null;
}

export interface SchoolCheck {
  id: string;
  /** Said when this is what is missing: "a sweep into the array". */
  need: string;
  /** Said when this is what is there: "the sweep". */
  have: string;
  must: boolean;
  state: CheckState;
  detail: string;
}

type Def = {
  id: string;
  need: string;
  have: string;
  must: boolean;
  test: (f: SchoolFacts, b: BiasRead) => CheckState | [CheckState, string];
};

const has = (f: SchoolFacts, ...keys: string[]): boolean => keys.some((k) => f.components.includes(k));
const layerOf = (f: SchoolFacts, id: string) => f.layers?.find((l) => l.id === id)?.state ?? null;
/** A sequence layer, when the desk graded one, wins. Otherwise the scanner component. */
const sequenced = (f: SchoolFacts, id: string, fallback: boolean): boolean => {
  const s = layerOf(f, id);
  return s ? s === "pass" : fallback;
};
const yes = (ok: boolean, why?: string): [CheckState, string] => [ok ? "pass" : "fail", why ?? ""];
const UNREAD = "the desk does not read this";

const biasCheck = (need: string): Def => ({
  id: "bias",
  need,
  have: "the bias",
  must: true,
  test: (f, b) => {
    // A card the desk released against the higher-timeframe read has had that bias disrespected: that IS the school's reversal condition.
    if (f.disrespected) return ["pass", "the higher-timeframe bias was disrespected and the desk released the gate"];
    if (b.dir === "none") return ["unknown", b.why];
    return [b.dir === f.side ? "pass" : "fail", b.why];
  },
});
const timeCheck = (need: string, must: boolean): Def => ({
  id: "time",
  need,
  have: "the window",
  must,
  test: (f) => {
    const s = layerOf(f, "time");
    const ok = s ? s === "pass" : f.killzoneOk;
    return yes(ok, ok ? "inside a killzone" : s ? "the sequence is outside the window" : "outside the killzones");
  },
});
const sweepCheck: Def = {
  id: "sweep",
  need: "a sweep of a pool",
  have: "the sweep",
  must: true,
  test: (f) => {
    const s = layerOf(f, "sweep");
    if (s) return yes(s === "pass", s === "pass" ? "the sequence swept" : "the sequence has no sweep");
    return yes(has(f, "sweep_significant"));
  },
};
const halfCheck = (need: string): Def => ({
  id: "half",
  need,
  have: "the right half",
  must: true,
  test: (f) => {
    const s = layerOf(f, "pd_half");
    if (s) return yes(s === "pass", s === "pass" ? "the sequence is in the right half" : "the sequence is in the wrong half");
    return yes(has(f, "pd"));
  },
});
/** PB (Blake and Patty): the 1 hour / 4 hour sponsored gap is the map. A preference, not a must: it never refuses a card by itself. */
const htfGapCheck: Def = {
  id: "htf_gap",
  need: "a 1 hour or 4 hour sponsored gap in play",
  have: "the sponsored gap",
  must: false,
  test: (f) =>
    f.sponsored == null
      ? ["unknown", "the higher-timeframe gaps are not read"]
      : f.sponsored.state === "in_gap" || f.sponsored.state === "near"
        ? ["pass", f.sponsored.trigger ? "the 1 to 5 minute inverse printed in it" : "price is in or at it"]
        : ["fail", f.sponsored.state === "far" ? "the nearest one is not near" : "none on this side"],
};
const unread = (id: string, need: string): Def => ({ id, need, have: need, must: false, test: () => ["unknown", UNREAD] });

const DEFS: Record<SchoolKey, Def[]> = {
  ict: [
    biasCheck("the daily and weekly to agree with the side"),
    timeCheck("a killzone or silver bullet window", true),
    sweepCheck,
    halfCheck("the right half of the dealing range"),
    {
      id: "shift",
      need: "a structure shift with displacement",
      have: "the shift",
      must: true,
      test: (f) => yes(sequenced(f, "ltf", has(f, "mss", "cisd") && has(f, "displacement"))),
    },
    {
      id: "draw",
      need: "an unswept draw to aim at",
      have: "the draw",
      must: true,
      test: (f) => {
        const s = layerOf(f, "target");
        if (s) return yes(s === "pass", s === "pass" ? "the sequence priced a target" : "the sequence has no target");
        return f.drawName == null ? ["unknown", "the card names no draw"] : f.drawSwept ? ["fail", `${f.drawName} already traded`] : ["pass", `${f.drawName} has not traded`];
      },
    },
    { id: "rest", need: "an OTE, order block or gap to rest at", have: "the array", must: false, test: (f) => yes(has(f, "ote", "ifvg", "order_block", "breaker")) },
    { id: "smt", need: "SMT between NQ and ES", have: "SMT", must: false, test: (f) => (has(f, "smt") ? ["pass", "SMT printed"] : ["unknown", "no SMT printed"]) },
  ],
  tjr: [
    biasCheck("the 1 hour and 4 hour structure to agree with the side"),
    sweepCheck,
    { id: "shift", need: "a break of structure on the 5 or 1 minute", have: "the break", must: true, test: (f) => yes(sequenced(f, "ltf", has(f, "mss", "cisd"))) },
    { id: "displacement", need: "displacement on the break", have: "the displacement", must: true, test: (f) => yes(sequenced(f, "ltf", has(f, "displacement"))) },
    { id: "rest", need: "a fresh gap or order block to rest the limit at", have: "the gap", must: true, test: (f) => yes(has(f, "ifvg", "order_block")) },
    timeCheck("the session open", false),
    {
      id: "fresh",
      need: "an array that was not tested before",
      have: "a fresh array",
      must: false,
      test: (f) => (f.mitigated == null ? ["unknown", UNREAD] : yes(!f.mitigated, f.mitigated ? "the array was tested before" : "untested")),
    },
    {
      id: "reward",
      need: "2R to the first target",
      have: "2R",
      must: false,
      test: (f) => (f.rr1 == null ? ["unknown", "no priced target"] : yes(f.rr1 >= 2, `first target is ${f.rr1.toFixed(1)}R; TJR's partial is at 2R, the desk's floor is 1R`)),
    },
  ],
  blake: [
    biasCheck("the weekly and daily order flow to agree with the side"),
    {
      id: "frame",
      need: "the 15 minute trend to agree",
      have: "the 15 minute trend",
      must: true,
      test: (f) => {
        const d = dirOf(f.ladder ? rung(f.ladder, "15m")?.bias : null);
        return d === "none" ? ["unknown", "the 15 minute is not read"] : yes(d === f.side, `the 15 minute is ${up(d)}`);
      },
    },
    // The entry is the BODY CLOSE through the gap that ran into the pool
    // (detectors.ts detectMechanicalModel, 0c3abe6). The trader's own
    // description of Blake PREFERS a retest of it; the desk does not require
    // one, so the need says what the detector wants and the retest stays a
    // preference in the trader's paragraph rather than a requirement here.
    {
      id: "invert",
      need: "a body close through the gap that ran into the pool",
      have: "the inversion close",
      must: true,
      test: (f) => yes(has(f, "ifvg", "breaker")),
    },
    halfCheck("deep discount for a long or premium for a short"),
    timeCheck("the 9:30 to 11:00 or 13:00 to 15:00 window", false),
    htfGapCheck,
    unread("nested", "a lower array nested inside a 4 hour or daily one"),
  ],
  patty: [
    biasCheck("the daily state and the lower-timeframe shift to agree"),
    { id: "breaker", need: "a breaker block", have: "the breaker", must: true, test: (f) => yes(has(f, "breaker")) },
    { id: "gap", need: "a fresh gap overlapping it", have: "the gap", must: true, test: (f) => yes(has(f, "ifvg")) },
    {
      id: "shift",
      need: "a displacement that breaks structure",
      have: "the shift",
      must: true,
      test: (f) => yes(sequenced(f, "ltf", has(f, "displacement") && has(f, "mss", "cisd"))),
    },
    halfCheck("deep discount for a long or premium for a short"),
    {
      id: "state",
      need: "a daily that is not consolidating",
      have: "the daily state",
      must: true,
      test: (f) => (f.ladder ? yes(f.ladder.phase !== "range", f.ladder.phase) : ["unknown", "the ladder is not read"]),
    },
    {
      id: "stack",
      need: "two of the inversion gap, breaker and OTE stacked",
      have: "the stack",
      must: false,
      test: (f) => yes(["ifvg", "breaker", "ote"].filter((k) => has(f, k)).length >= 2),
    },
    htfGapCheck,
    timeCheck("a session-open window", false),
  ],
};

/** The grader's facts from a scanner card, the ladder of the index it trades, and — when the desk has graded this side — the sequence layers. Nothing here is computed again. */
export function schoolFactsFrom(
  c: Pick<SetupCandidate, "side" | "components" | "killzoneOk" | "htfDisrespected" | "draw" | "plan" | "patterns">,
  ladder: LadderLite | null,
  layers?: SchoolFacts["layers"],
  sponsored?: SchoolFacts["sponsored"],
): SchoolFacts {
  return {
    side: c.side,
    components: c.components,
    killzoneOk: c.killzoneOk,
    disrespected: Boolean(c.htfDisrespected),
    drawName: c.draw?.name ?? c.plan?.drawName ?? null,
    drawSwept: c.draw ? c.draw.swept : null,
    rr1: c.plan?.rr1 ?? null,
    mitigated: c.patterns ? c.patterns.mitigation : null,
    ladder,
    layers: layers ?? null,
    sponsored: sponsored ?? null,
  };
}

export type Verdict = "fits" | "missing" | "against";

export interface SchoolRead {
  school: SchoolKey;
  bias: BiasRead;
  checks: SchoolCheck[];
  verdict: Verdict;
  /** What the school is still waiting for, in its own words (the first failed must), or null. */
  next: string | null;
  /** How many failed musts there are. */
  lacking: number;
}

export function schoolRead(school: SchoolKey, f: SchoolFacts): SchoolRead {
  const bias = schoolBias(school, f.ladder);
  const checks = DEFS[school].map((d): SchoolCheck => {
    const r = d.test(f, bias);
    const [state, detail] = typeof r === "string" ? [r, ""] : r;
    return { id: d.id, need: d.need, have: d.have, must: d.must, state, detail };
  });
  const failed = checks.filter((c) => c.must && c.state === "fail");
  const against = !f.disrespected && bias.dir !== "none" && bias.dir !== f.side;
  return {
    school,
    bias,
    checks,
    verdict: against ? "against" : failed.length ? "missing" : "fits",
    next: against ? null : (failed[0]?.need ?? null),
    lacking: failed.length,
  };
}

export function schoolReads(f: SchoolFacts): SchoolRead[] {
  return SCHOOL_KEYS.map((s) => schoolRead(s, f));
}

/* ── Saying it ───────────────────────────────────────────────────────────── */

/** One school, one sentence. Short on purpose: it is read aloud after the card's own numbers. */
export function schoolSentence(r: SchoolRead, side: "long" | "short"): string {
  const name = SCHOOL_SAY[r.school];
  if (r.verdict === "against") return `${name} reads ${r.bias.dir === "long" ? "long" : "short"}, against this ${side}: ${r.bias.why}. A note, not a stand-down.`;
  if (r.verdict === "missing") {
    const more = r.lacking > 1 ? `, and ${r.lacking - 1} more` : "";
    return `${name} is waiting for ${r.next}${more}.`;
  }
  const held = r.checks.filter((c) => c.must && c.state === "pass").map((c) => c.have);
  const unread = r.checks.some((c) => c.must && c.state === "unknown");
  return `${name} fits: ${held.slice(0, 3).join(", ")}${unread ? ", the rest I cannot grade" : ""}.`;
}

/** The four schools in one line: who fits, who reads the other way, who is waiting for what. */
export function consensusLine(reads: SchoolRead[], side: "long" | "short"): string {
  const names = (v: Verdict) => reads.filter((r) => r.verdict === v).map((r) => SCHOOL_SAY[r.school]);
  const join = (a: string[]) => (a.length <= 1 ? (a[0] ?? "") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
  const fits = names("fits");
  const against = names("against");
  const parts: string[] = [];
  if (fits.length) parts.push(`${join(fits)} ${fits.length === 1 ? "fits" : "fit"} this ${side}`);
  if (against.length) parts.push(`${join(against)} ${against.length === 1 ? "reads" : "read"} the other way`);
  for (const r of reads.filter((x) => x.verdict === "missing").slice(0, 2)) parts.push(`${SCHOOL_SAY[r.school]} needs ${r.next}`);
  return parts.length ? `${parts.join(". ")}.` : "";
}

/**
 * School gate. Off until a day-clustered measurement says the cards it
 * refuses are not better (z of refused-minus-taken must not be ≥ +2).
 * Narration does not read this. A caller that wants the measured rule
 * passes `enabled`.
 */
export const SCHOOL_GATE = { enabled: false };

export function schoolGate(
  strategy: string | null | undefined,
  reads: readonly SchoolRead[],
  enabled: boolean = SCHOOL_GATE.enabled,
): { ok: boolean; reason: string | null } {
  if (!enabled) return { ok: true, reason: null };
  const own = ownSchool(strategy);
  if (!own) return { ok: true, reason: null };
  const r = reads.find((x) => x.school === own);
  if (!r || r.verdict === "fits") return { ok: true, reason: null };
  const reason = r.verdict === "against" ? `${SCHOOL_SAY[own]} reads the other way.` : `${SCHOOL_SAY[own]} needs ${r.next ?? "a must"}.`;
  return { ok: false, reason };
}

/** The reversal case the trader asked for: the higher-timeframe bias was disrespected and ICT, TJR and Patty each pass every must they can grade. */
export function reversalAgreement(reads: SchoolRead[], f: Pick<SchoolFacts, "disrespected">): { agree: boolean; schools: SchoolKey[] } {
  if (!f.disrespected) return { agree: false, schools: [] };
  const ok = reads.filter((r) => r.verdict === "fits").map((r) => r.school);
  const core: SchoolKey[] = ["ict", "tjr", "patty"];
  return { agree: core.every((s) => ok.includes(s)), schools: ok };
}
