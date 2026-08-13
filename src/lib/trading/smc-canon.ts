/**
 * SMC / ICT / TJR / PB canon — executable playbook the desk actually uses.
 *
 * ICT (Huddleston) is the detailed source: time, IPDA, AMD/PO3, Judas, OTE.
 * SMC is the community streamlining: structure, liquidity, OB, FVG, BOS/CHoCH/MSS.
 * TJR / PB (Blake, Patty, Ronan) keep one tight sequence and filter to A+.
 *
 * Deterministic. No LLM. Graded as a stack of independent factors —
 * a single concept is never enough to TAKE.
 */

import type { StrategyId } from "./strategies";
import type { ComponentKey } from "./engine-weights";
import type { SetupCandidate } from "./scanner";
import type { HtfBiasRead } from "./structure";
import type { MarketNarrative } from "./market-narrative";

export type SchoolId = "ict" | "smc" | "tjr" | "blake" | "patty" | "ronan";

export type LiqKind =
  | "eqh"
  | "eql"
  | "pdh"
  | "pdl"
  | "pwh"
  | "pwl"
  | "session_high"
  | "session_low"
  | "swing_high"
  | "swing_low"
  | "asia_high"
  | "asia_low"
  | "round";

export type LiqScope = "irl" | "erl";

export type PdArrayKind =
  | "old_high_low"
  | "order_block"
  | "fvg"
  | "ifvg"
  | "breaker"
  | "mitigation"
  | "rejection"
  | "ote";

export interface SchoolCanon {
  id: SchoolId;
  name: string;
  origin: string;
  style: "narrative" | "mechanical" | "hybrid";
  sequence: string[];
  timeFilter: string;
  entry: string;
  journal: string;
  discretion: string;
}

export const SCHOOLS: Record<SchoolId, SchoolCanon> = {
  ict: {
    id: "ict",
    name: "ICT (Huddleston)",
    origin: "IPDA / algorithmic delivery · 30+ years observation",
    style: "narrative",
    sequence: [
      "HTF narrative + DOL (ERL)",
      "Power of 3: accumulate → manipulate (Judas) → distribute",
      "Kill zone / Silver Bullet / macros only",
      "Sweep into PD array in correct premium/discount",
      "OTE 61.8–79% of impulse (70.5 sweet spot)",
      "LTF MSS + displacement, enter retest",
    ],
    timeFilter: "London + NY AM; Silver Bullet 10–11 / 14–15 ET",
    entry: "Judas/sweep into OB or FVG (CE 50%) in discount (long) / premium (short)",
    journal: "Observations, minute markers, what the algorithm did, positive framing",
    discretion: "Highest — models flex once liquidity engineering is internalized",
  },
  smc: {
    id: "smc",
    name: "SMC (community)",
    origin: "Streamlined ICT — structure, liquidity, OB, FVG, BOS/CHoCH",
    style: "hybrid",
    sequence: [
      "Mark dealing range + EQ",
      "Draw on next untapped BSL/SSL",
      "Wait sweep of IRL or ERL into POI",
      "BOS/CHoCH/MSS + displacement",
      "Retest FVG/OB",
    ],
    timeFilter: "Flexible; NY AM preferred",
    entry: "POI after sweep + structure shift — timing less rigid than ICT",
    journal: "Setup tags + HTF/LTF screenshots",
    discretion: "Medium — tools over strict time",
  },
  tjr: {
    id: "tjr",
    name: "TJR (Tyler Riches)",
    origin: "One sequence after ICT overload + blow-ups",
    style: "mechanical",
    sequence: [
      "HTF liquidity sweep first (1H/4H, PDH/PDL, session, EQH/EQL) — non-negotiable",
      "5m confirmation: BOS or IFVG or 79% extension close or SMT",
      "Enter on the shift or first clean retrace — never chase",
      "Target next DOL",
    ],
    timeFilter: "NY session / active kill zone",
    entry: "After 5m confirm, not on the sweep",
    journal: "Pair, session, every confluence, risk, emotions — TradeZella weekly review",
    discretion: "Low on core; filters from data (lose when HTF alignment weak)",
  },
  blake: {
    id: "blake",
    name: "Blake Mech / PDI",
    origin: "PB Trading — mechanical while in school; high-ATH continuation",
    style: "mechanical",
    sequence: [
      "Swing structure",
      "Liquidity hunt",
      "Inversion (IFVG) + unfilled FVG",
      "CISD / displacement",
      "Retest inversion",
    ],
    timeFilter: "NY open window",
    entry: "IFVG + structure/CISD + displacement — sweep preferred",
    journal: "Process + model adherence; student case reviews",
    discretion: "Start mechanical, recognize A+ narratives inside the model",
  },
  patty: {
    id: "patty",
    name: "Patty Swing",
    origin: "PB — pre-market AMD + 9:30 manipulation",
    style: "hybrid",
    sequence: [
      "Pre-market accumulation (Asia/London range)",
      "9:30 open manipulation into 15m/1H gap or intermediate H/L",
      "1–5m inverse / displacement",
      "Target opposing liquidity",
      "One trade — if it works, day objective met",
    ],
    timeFilter: "9:30–11:00 ET only",
    entry: "IFVG after HTF POI respect, post-open manip",
    journal: "Emotions B/D/A, rules followed, stop/target micromanagement, psych rating",
    discretion: "Conditions theory — react to facts, don't predict",
  },
  ronan: {
    id: "ronan",
    name: "Ronan (PB coach)",
    origin: "Student → 10k months → coach. Same PB models, HTF narrative first",
    style: "hybrid",
    sequence: [
      "HTF unfilled FVG / inefficiency + DOL",
      "Bias-aligned array in discount/premium",
      "LTF confirmation (structure/CISD/disp)",
      "Protect psychology — one model internalized",
    ],
    timeFilter: "NY AM preferred",
    entry: "Bias-aligned IFVG with multi-TF agreement",
    journal: "Internalize system + psych; onboarding checklist",
    discretion: "Build personal edge from mechanical base",
  },
};

/** Strategy → school. SMT is a companion, not a school. */
export const STRATEGY_SCHOOL: Record<StrategyId, SchoolId | null> = {
  tjr: "tjr",
  mechanical: "blake",
  blake_mech: "blake",
  judas: "ict",
  pdi: "blake",
  continuation: "smc",
  patty: "patty",
  ronan: "ronan",
  smt: null,
};

/** Liquidity magnet rank — lower = stronger draw. */
export const LIQUIDITY_RANK: Record<LiqKind, number> = {
  eqh: 1,
  eql: 1,
  pdh: 2,
  pdl: 2,
  pwh: 2,
  pwl: 2,
  session_high: 3,
  session_low: 3,
  asia_high: 3,
  asia_low: 3,
  swing_high: 4,
  swing_low: 4,
  round: 5,
};

/** PD array strength (ICT matrix, simplified). Lower = stronger bus stop. */
export const PD_ARRAY_RANK: Record<PdArrayKind, number> = {
  old_high_low: 1,
  order_block: 2,
  fvg: 3,
  ifvg: 3,
  breaker: 4,
  mitigation: 5,
  rejection: 6,
  ote: 2,
};

export const ENTRY_SKELETON = [
  "HTF bias + draw on liquidity (ERL).",
  "Price reaches POI after or with a liquidity sweep (setup, never entry).",
  "LTF MSS / CHoCH / BOS with displacement.",
  "Retrace into displacement OB / FVG / IFVG / OTE 62–79%.",
  "Enter limit or confirmation candle. Stop beyond sweep extreme.",
  "Partials at IRL, runner at ERL. ≥1:2–1:3 average.",
  "A+ only. Low frequency is the feature.",
] as const;

export const TOP_DOWN = [
  "HTF (D/4H/1H): structure, BOS/CHoCH, premium/discount, unfilled FVG/OB, DOL.",
  "Mark BSL/SSL pools + PD arrays. Do not drop to LTF yet.",
  "Wait for price to approach/sweep into a valid POI in London or NY AM.",
  "LTF (15/5/1): displacement + structural shift against the sweep.",
  "Enter on retrace into the resulting FVG/OB/IFVG. Never on the raid.",
] as const;

export const CONFLUENCE_STACK = [
  { id: "htf", label: "HTF bias + DOL", must: true },
  { id: "sweep", label: "Liquidity sweep (setup)", must: true },
  { id: "pd_half", label: "POI in correct premium/discount", must: true },
  { id: "ltf", label: "LTF shift + displacement", must: true },
  { id: "time", label: "Kill zone / model window", must: true },
  { id: "smt", label: "SMT divergence", must: false },
  { id: "overlap", label: "FVG/OB overlap + OTE", must: false },
] as const;

export const JOURNAL_TAGS = [
  "htf_bias",
  "dol_erl",
  "irl_partial",
  "sweep_ssl",
  "sweep_bsl",
  "dealing_discount",
  "dealing_premium",
  "pd_ob",
  "pd_fvg",
  "pd_ifvg",
  "ote",
  "mss",
  "displacement",
  "killzone",
  "smt",
  "school_tjr",
  "school_ict",
  "school_patty",
  "school_blake",
  "emotion_before",
  "emotion_during",
  "emotion_after",
  "rules_followed",
  "micromanaged",
] as const;

export const CANON_RULES = [
  "Sweep / raid / Judas = manipulation. Never the entry.",
  "Buy only from discount PD arrays; sell only from premium PD arrays.",
  "IRL (unfilled FVG/OB inside range) = partials. ERL (outside range) = DOL / full target.",
  "EQH/EQL densest stops — first magnet. Then PDH/PDL / session, then swings.",
  "Do not drop to LTF until price is at a valid HTF/MTF POI.",
  "Never enter against clear HTF bias.",
  "Confirmation = displacement + MSS/CISD after the sweep.",
  "Entry = first clean retrace into FVG CE / IFVG / last opposing OB / OTE 62–79%.",
  "Stop beyond sweep wick + buffer. Never widen. Bank 50% at +1R, BE rest.",
  "One book per day — MNQ or ES, not both same bias.",
  "A+ only. Low frequency is a feature.",
] as const;

export interface CanonFactor {
  id: string;
  label: string;
  pass: boolean;
  must: boolean;
  detail: string;
}

export interface CanonStack {
  score: number;
  mustHits: number;
  mustNeed: number;
  optionalHits: number;
  grade: "A+" | "A" | "A-" | "B" | "skip";
  factors: CanonFactor[];
  thesis: string;
  schoolHint: SchoolId | null;
  journalPrompt: string[];
}

export interface CanonInput {
  side: "long" | "short" | null;
  htf: "bull" | "bear" | "neutral";
  mtf?: "bull" | "bear" | "neutral";
  dealingZone: "premium" | "discount" | "equilibrium" | null;
  swept: "bsl" | "ssl" | "none";
  confirmation:
    | "none"
    | "sweep_only"
    | "sweep_displace"
    | "confirmed"
    | "armed_entry";
  inKillzone: boolean;
  killzoneLabel?: string;
  smt: boolean;
  components: string[];
  strategy?: StrategyId | string | null;
}

function has(comps: string[], ...keys: string[]): boolean {
  const set = new Set(comps);
  return keys.some((k) => set.has(k));
}

/**
 * Build the canon input for ONE candidate, from ITS OWN book's bias and
 * narrative — not a desk-wide approximation.
 *
 * WHY THIS EXISTS: `runVeteranBrain` (veteran-brain.ts) used to build a
 * `CanonInput` inline for a single desk-wide "rawBest" pick, borrowing
 * whichever book's narrative looked most confirmed even when scoring the
 * OTHER book's candidate. That was a reasonable shortcut for a one-paragraph
 * brief. It stops being reasonable the moment more than one candidate needs
 * a canon grade — the scanner routinely shows MNQ long/short and ES
 * long/short side by side, and each one's stack must be judged against its
 * OWN book, not borrowed from whichever book happens to read strongest.
 *
 * `smt` is intentionally a caller-supplied boolean rather than re-derived
 * here: after the 2026-08-13 fix, SMT direction and book attribution are
 * computed once in scanner.ts (scoreDirection) and already live on
 * `candidate.reasons`/`components` as `smt`. Re-deriving it from prose here
 * would reintroduce exactly the kind of duplicated, driftable logic this
 * function exists to remove.
 */
export function canonInputForCandidate(
  c: SetupCandidate,
  book: Pick<HtfBiasRead, "topDown" | "mid" | "dealing">,
  narrative: MarketNarrative | null,
  clock: { inTradeWindow: boolean; killzoneLabel: string },
): CanonInput {
  return {
    side: c.side,
    htf: book.topDown,
    mtf: book.mid,
    dealingZone: book.dealing?.zone ?? null,
    swept: narrative?.liquidity?.lastSweep ?? "none",
    confirmation: narrative?.confirmation ?? "none",
    inKillzone: clock.inTradeWindow,
    killzoneLabel: clock.killzoneLabel,
    smt: c.components.includes("smt"),
    components: c.components,
    strategy: c.completeStrategy || c.strategyPrimary,
  };
}

/** Live stack vs the shared skeleton. Independent factors — not strategy-summed. */
export function scoreCanonStack(input: CanonInput): CanonStack {
  const {
    side,
    htf,
    mtf,
    dealingZone,
    swept,
    confirmation,
    inKillzone,
    killzoneLabel,
    smt,
    components,
    strategy,
  } = input;

  const alignedHtf =
    (side === "long" && htf === "bull") ||
    (side === "short" && htf === "bear");
  const alignedMtf =
    mtf == null ||
    mtf === "neutral" ||
    (side === "long" && mtf === "bull") ||
    (side === "short" && mtf === "bear");
  const pdHalf =
    (side === "long" && dealingZone === "discount") ||
    (side === "short" && dealingZone === "premium");
  /**
   * A raid arms the side OPPOSITE to the liquidity it took.
   *
   *   SSL taken (lows swept, shorts trapped)  -> arms LONG
   *   BSL taken (highs swept, longs trapped)  -> arms SHORT
   *
   * This is the canon's own rule ("Sweep / raid / Judas = manipulation.
   * Never the entry.") and it matches scanner.ts's `sweep_significant`,
   * which filters sellside pools for bull and buyside pools for bear.
   *
   * WHAT WAS WRONG: this expression used to end with `|| swept !== "none"`,
   * which made a variable literally named `sweepForSide` true for ANY raid
   * in ANY direction — defeating both correct clauses above it and
   * disagreeing with the scanner's own polarity. Observed cost: on
   * 2026-08-13 the open took SELLSIDE liquidity (textbook manipulation
   * arming a bullish reversal) and the canon graded it a passing must-factor
   * for a SHORT, reaching "A+ 5/5" on the wrong side of the reversal.
   *
   * A sweep in the SAME direction as the trade is not a setup at all — it is
   * the draw/target being consumed, which is where you take profit, not
   * where you enter.
   */
  const sweepForSide =
    (side === "long" && swept === "ssl") ||
    (side === "short" && swept === "bsl");
  const ltfOk =
    confirmation === "confirmed" ||
    confirmation === "armed_entry" ||
    has(components, "mss", "cisd", "displacement", "structure");
  const poi =
    has(components, "ifvg", "order_block", "pd", "breaker", "mitigation");
  const oteOverlap = has(components, "ifvg", "order_block") && pdHalf;

  const factors: CanonFactor[] = [
    {
      id: "htf",
      label: "HTF bias + DOL",
      must: true,
      pass: alignedHtf,
      detail: alignedHtf
        ? `HTF ${htf} agrees ${side}`
        : `HTF ${htf} vs ${side ?? "flat"} — stand down or wait`,
    },
    {
      id: "sweep",
      label: "Liquidity sweep",
      must: true,
      pass: sweepForSide && confirmation !== "none",
      detail:
        swept === "none"
          ? "No raid yet — wait for SSL (long) or BSL (short)"
          : // The raid happened but on the wrong side for this trade. Name the
            // side it DOES arm — that is the actionable read, and the case
            // this desk missed on 2026-08-13 by silently passing it instead.
            !sweepForSide
            ? `${swept.toUpperCase()} raid arms ${swept === "ssl" ? "LONG" : "SHORT"}, not ${side ?? "this side"} — reversal is the other way`
            : confirmation === "sweep_only"
              ? `${swept.toUpperCase()} swept — setup only, not entry`
              : `${swept.toUpperCase()} swept · ${confirmation}`,
    },
    {
      id: "pd_half",
      label: "POI in correct half",
      must: true,
      pass: pdHalf && poi,
      detail: !dealingZone
        ? "No dealing range"
        : dealingZone === "equilibrium"
          ? "EQ — lower quality, wait displacement"
          : pdHalf
            ? `${dealingZone} favors ${side} · POI ${poi ? "present" : "missing"}`
            : `${dealingZone} fights ${side} — skip or reverse thesis`,
    },
    {
      id: "ltf",
      label: "LTF shift + displacement",
      must: true,
      pass: ltfOk && confirmation !== "sweep_only" && confirmation !== "none",
      detail: ltfOk
        ? `LTF confirm ${confirmation}`
        : "Need MSS/CISD + displacement after the sweep",
    },
    {
      id: "time",
      label: "Kill zone",
      must: true,
      pass: inKillzone,
      detail: inKillzone
        ? killzoneLabel || "In window"
        : "Outside London / NY AM — watch only",
    },
    {
      id: "smt",
      label: "SMT (optional)",
      must: false,
      pass: smt,
      detail: smt ? "Correlated pair failed to confirm extreme" : "No SMT — not required",
    },
    {
      id: "overlap",
      label: "FVG/OB + OTE (optional)",
      must: false,
      pass: oteOverlap,
      detail: oteOverlap
        ? "Array overlap in OTE half"
        : "No FVG+OB overlap — still valid if musts hit",
    },
    {
      id: "mtf",
      label: "MTF intact",
      must: false,
      pass: alignedMtf,
      detail: alignedMtf
        ? `MTF ${mtf ?? "n/a"} does not fight`
        : `MTF ${mtf} fights — cut size or wait`,
    },
  ];

  const musts = factors.filter((f) => f.must);
  const opts = factors.filter((f) => !f.must);
  const mustHits = musts.filter((f) => f.pass).length;
  const optionalHits = opts.filter((f) => f.pass).length;
  const score = mustHits / musts.length + optionalHits * 0.08;

  let grade: CanonStack["grade"] = "skip";
  if (mustHits === musts.length && optionalHits >= 2) grade = "A+";
  else if (mustHits === musts.length) grade = "A";
  else if (mustHits === musts.length - 1 && ltfOk && alignedHtf) grade = "A-";
  else if (mustHits >= 3) grade = "B";

  const school =
    (strategy && (STRATEGY_SCHOOL as Record<string, SchoolId | null>)[strategy]) ||
    null;

  const thesis = !side
    ? "No side — map DOL and wait."
    : grade === "A+" || grade === "A"
      ? `${side.toUpperCase()} ${school ?? "SMC"}: HTF ${htf} · ${swept} raid · ${dealingZone} array · ${confirmation}. Partials IRL, runner ERL.`
      : grade === "A-"
        ? `${side} almost stacked — missing ${musts
            .filter((f) => !f.pass)
            .map((f) => f.label)
            .join(", ")}.`
        : `Skip — ${musts
            .filter((f) => !f.pass)
            .map((f) => f.label)
            .join(", ") || "incomplete stack"}.`;

  const journalPrompt = [
    `Bias: HTF ${htf} · side ${side ?? "flat"} · DOL ${
      side === "long" ? "BSL / ERL high" : side === "short" ? "SSL / ERL low" : "—"
    }`,
    `Sweep: ${swept} · confirm ${confirmation} · zone ${dealingZone ?? "—"}`,
    `Time: ${killzoneLabel ?? (inKillzone ? "KZ" : "outside")} · school ${school ?? "generic"}`,
    "Emotion before / during / after — and whether you followed the stop.",
  ];

  return {
    score: +score.toFixed(3),
    mustHits,
    mustNeed: musts.length,
    optionalHits,
    grade,
    factors,
    thesis,
    schoolHint: school,
    journalPrompt,
  };
}

export function classifyLiqLabel(label: string): { kind: LiqKind; scope: LiqScope } {
  const s = label.toLowerCase();
  if (s.includes("eqh") || s.includes("equal high")) return { kind: "eqh", scope: "erl" };
  if (s.includes("eql") || s.includes("equal low")) return { kind: "eql", scope: "erl" };
  if (s.includes("pdh")) return { kind: "pdh", scope: "erl" };
  if (s.includes("pdl")) return { kind: "pdl", scope: "erl" };
  if (s.includes("pwh")) return { kind: "pwh", scope: "erl" };
  if (s.includes("pwl")) return { kind: "pwl", scope: "erl" };
  if (s.includes("asia") && (s.includes("high") || s.includes("bsl")))
    return { kind: "asia_high", scope: "irl" };
  if (s.includes("asia") && (s.includes("low") || s.includes("ssl")))
    return { kind: "asia_low", scope: "irl" };
  if (s.includes("session") && s.includes("high"))
    return { kind: "session_high", scope: "irl" };
  if (s.includes("session") && s.includes("low"))
    return { kind: "session_low", scope: "irl" };
  if (s.includes("dr high") || s.includes("range high"))
    return { kind: "swing_high", scope: "erl" };
  if (s.includes("dr low") || s.includes("range low"))
    return { kind: "swing_low", scope: "erl" };
  if (s.includes("high") || s.includes("bsl"))
    return { kind: "swing_high", scope: "irl" };
  return { kind: "swing_low", scope: "irl" };
}

export function schoolForStrategy(id: string | null | undefined): SchoolCanon | null {
  if (!id) return null;
  const sid = (STRATEGY_SCHOOL as Record<string, SchoolId | null>)[id];
  return sid ? SCHOOLS[sid] : null;
}

const PD_FROM_COMPONENT: Partial<Record<ComponentKey, PdArrayKind>> = {
  order_block: "order_block",
  ifvg: "ifvg",
  pd: "fvg",
  breaker: "breaker",
  mitigation: "mitigation",
  rejection: "rejection",
};

export function pdArraysFromComponents(components: string[]): PdArrayKind[] {
  const out: PdArrayKind[] = [];
  for (const c of components) {
    const k = PD_FROM_COMPONENT[c as ComponentKey];
    if (k && !out.includes(k)) out.push(k);
  }
  return out.sort((a, b) => PD_ARRAY_RANK[a] - PD_ARRAY_RANK[b]);
}

export function canonCoachLines(stack: CanonStack): string[] {
  const miss = stack.factors.filter((f) => f.must && !f.pass);
  if (stack.grade === "A+" || stack.grade === "A") {
    return [
      stack.thesis,
      "Enter only on the retrace. Stop beyond the raid. 50% off at +1R.",
    ];
  }
  if (miss.length) {
    return [
      `Wait: ${miss.map((m) => m.label).join(" + ")}.`,
      stack.factors.find((f) => f.id === "sweep" && f.pass)
        ? "Sweep is in — do not chase. Displacement then array retest."
        : "No raid yet. Map EQH/EQL, PDH/PDL, Asia, then wait.",
    ];
  }
  return [stack.thesis];
}
