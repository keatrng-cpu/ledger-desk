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
    // His own numbers vary by year and asset: London 2–5 (2017/2024) or 1–5
    // (2016); indices 8:30–11 NY (2022 Ep 2/17/41); Silver Bullet 3–4, 10–11,
    // 14–15 (2023-05-15); noon–13:00 no-trade (Ep 5). The desk's 09:30–09:45
    // no-entry window is a DESK rule, not his — his opening range is 09:30–10:00.
    timeFilter: "London 2–5 · NY indices 8:30–11 · Silver Bullet 3–4 / 10–11 / 14–15 ET · no trade 12–13",
    entry: "Sweep, then displacement 'preferably closing' through structure, into an FVG at CE (50%) or OB in discount (long) / premium (short)",
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
    // Research 2026-09-19: blow-ups verified (his own timeline); "after ICT
    // overload" not found in his words. "If a setup isn't obvious, skip it"
    // — every step is a discretionary call, so the style is hybrid, whatever
    // downstream copies call it.
    origin: "Multiple blown accounts 2017–19, then one sequence; discretionary by his own account",
    style: "hybrid",
    sequence: [
      "HTF liquidity sweep first (1H/4H, PDH/PDL, session H/L, EQH/EQL, trendline) — non-negotiable",
      "5m CONTEXT: BOS/CHoCH, IFVG, SMT as a filter",
      "1m TRIGGER: IFVG, BOS, or his '79% extension closure' (his vocabulary, not ICT's OTE — mechanic unverified)",
      "Enter on the shift or first clean retrace — never chase",
      "Target the next low-resistance draw on liquidity",
    ],
    timeFilter: "Session opens — Asia 18:00, London 03:00, NY 09:30 ET — after the manipulation, never blindly at the open",
    entry: "After 5m context, on the 1m trigger; 'close back inside' on the sweep is a community rendering, not his stated rule",
    journal: "Every trade with screenshots and notes (TradeZella affiliate); field list and weekly cadence unverified",
    discretion: "High — his own copy; risk 1–2% per trade, R:R ≥ 2:1 on the checklist. No verified statements; a 2026 exposé disputes the livestream P&L",
  },
  blake: {
    id: "blake",
    name: "Blake Mech / PDI",
    // PDI = Pre Distribution Inversion (his course index). "While in school"
    // belongs to Patrick, not Blake. Rules below are from leaked re-uploads of
    // the paid Mech Model videos — secondhand, labelled as such in the canon.
    origin: "PB Trading co-founder — Mech Model + PDI (Pre Distribution Inversion); works at all-time highs where bias is unclear",
    style: "mechanical",
    sequence: [
      "HTF bias + draw: Daily/4H/1H/15m FVGs respected or disrespected",
      "Price at a key level: HTF PD array, FVG, CISD, PDH/PDL, session pool",
      "Swing low → swing high → LOWER LOW that sweeps liquidity (sweep required)",
      "Inversion (IFVG) on the highest TF inside the manipulation leg, body close through the gap",
      "T1 at 1:1, stop to break-even; target an unfilled 5m/15m FVG",
    ],
    timeFilter: "09:30–11:00 and 13:00–15:00 ET; avoid lunch; max two signals per session",
    entry: "Inversion body-close (the edge), stop below the inversion candle low — tighter than the sweep wick",
    journal: "Not found; TradeZella affiliate",
    discretion: "Claims 70–80% WR with no sample size; at 1:1 the model NEEDS ~70% to be positive expectancy",
  },
  patty: {
    id: "patty",
    name: "Patty Swing",
    // "Patty swing" is a real 2026 model name in the community; no PB-authored
    // rule set for it was retrieved. What IS verified from Patty's own videos
    // is conditions theory. The 9:30-manipulation sequence the desk carried
    // was unverified and is replaced by the PB Theory IFVG method (student
    // notes of his videos).
    origin: "PB Trading co-founder (Patrick 'Patty' Lovelace) — PB Theory; 'patty swing' rules unverified",
    style: "hybrid",
    sequence: [
      "Price reaches an HTF (1H/4H) FVG — do not trade immediately on the touch",
      "Wait for a 5m FVG or structure at the level",
      "Stop at the swing low of the 5m FVG; break-even at the previous internal high",
      "Target the nearest significant liquidity",
      "Session objective met → no more trades (checklist: 'OBJECTIVES ALREADY MET')",
    ],
    timeFilter: "Checklist: 10:00–14:00 ET plus macros 09:45–10:15 and 13:45–14:30 — not '09:30–11:00 only'",
    entry: "5m confirmation at the HTF gap; community trades the 'patty swing' with a 1m IFVG for 1:1",
    journal: "Not found beyond TradeZella affiliate links",
    discretion: "Conditions theory — if-then-execute on 5m/15m gaps; react, don't predict (verified, own videos Jan 2026)",
  },
  ronan: {
    id: "ronan",
    name: "Ronan (PB coach) — BionicNQ",
    // Research 2026-09-19 found no trace of Ronan beyond one student review
    // naming him as helpful in the PB Discord: no channel, bio, model, or
    // student-to-coach story. On 2026-09-22 the trader supplied the missing
    // handle — the YouTube channel is BionicNQ. That closes the identity gap
    // but NOT the evidence gap: the sequence below is still generic PB Theory
    // reconstructed from the crew, not from a published model of his, and it
    // stays UNVERIFIED until someone watches the channel and writes down what
    // is actually taught there.
    origin:
      "PARTIALLY VERIFIED — identified by the trader as the BionicNQ YouTube channel (2026-09-22); no published written model, sequence below is reconstructed PB Theory",
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
  // Item 24: the silver bullet is ICT's own window and ICT's own shape.
  silver_bullet: "ict",
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
  /**
   * The HTF bias has been invalidated on the tape (scanner.ts biasDisrespect),
   * so a counter-bias trade is the REVERSAL rather than a fight. This is the
   * one exception CLAUDE.md allows to the absolute HTF gate; before
   * 2026-09-23 the flag was set and never read, so the exception did not
   * exist in practice.
   */
  htfDisrespected?: boolean;
  /**
   * ITEM 11 — did this book LEAD the divergence (smt-level.ts `led`)?
   *
   * `false` is the laggard: the other index made the extreme and displaced, so
   * this side is not a second setup on the same divergence and does not earn
   * the optional SMT factor. `null`/`undefined` means no divergence read and
   * behaves exactly as before.
   */
  smtLed?: boolean | null;
}

/**
 * ITEM 11 — SMT credits the index that inverted FIRST.
 *
 * Switchable for the same reason GATE is: nothing writes it at runtime, and a
 * sweep script can restore the pre-2026-10-08 behaviour (either book earns the
 * factor wherever the divergence printed) in one flip.
 *
 * SAFE BY CONSTRUCTION, AND THE LIMIT OF WHAT IS WIRED. `smt` is an OPTIONAL
 * factor (`must: false` below), so this can move the A+/A boundary — A+ needs
 * two optional hits — and can never move the WORD. The work order also asks
 * for the laggard to be "stood down"; a refusal on the laggard would be a NEW
 * hard gate with no measurement behind it, so what ships is the removal of the
 * factor plus a named reason. Promoting it to a stand-down is the trader's call.
 */
export const SMT_TRADES_THE_LEADER = { value: true };

function has(comps: string[], ...keys: string[]): boolean {
  const set = new Set(comps);
  return keys.some((k) => set.has(k));
}

/** Minutes after ET midnight, inclusive start / exclusive end. */
export type EtWindow = readonly [number, number];

export interface ModelRequirement {
  id: StrategyId;
  /** The ONLY hours this model may be named in. Null = any hour. */
  windows: readonly EtWindow[] | null;
  /** The pool a raid must have taken for this model to be itself. */
  pool: "overnight_range" | "opening_range_0930_1000" | null;
  /** Components without which the name is wrong, whatever else is on the tape. */
  requires: readonly ComponentKey[];
  note: string;
}

/**
 * ONE definition of each time-and-pool-bound model.
 *
 * Patty's hours were hard-coded in TWO places (`strategies.ts` classify and
 * `strategy-grade.ts` gradeAllStrategies) with the same values and no shared
 * constant, and Judas's in a third. Same values, one definition — a change in
 * one place can no longer leave the other naming a model out of its hours.
 */
export const MODEL_REQUIREMENTS: Readonly<Partial<Record<StrategyId, ModelRequirement>>> = {
  judas: {
    id: "judas",
    windows: [[9 * 60 + 30, 9 * 60 + 45]],
    pool: "overnight_range",
    requires: ["opening_raid", "sweep_significant"],
    note: "09:30–09:45 ET, and the pool is the OVERNIGHT range. Fading the failed raid.",
  },
  patty: {
    id: "patty",
    // ITEM 14: 09:45–11:00 and 13:30–14:30 only. Not lunch.
    windows: [
      [9 * 60 + 45, 11 * 60],
      [13 * 60 + 30, 14 * 60 + 30],
    ],
    pool: null,
    requires: ["htf_gap"],
    note: "A 1h/4h gap, still unmitigated, then a close back INTO it. The touch is not the entry, and Patty needs no sweep.",
  },
  silver_bullet: {
    id: "silver_bullet",
    /**
     * ITEM 24: only the 10:00–11:00 ET window is added.
     *
     * CLAUDE.md measured 10:00–11:00 FLAT and 03:00–04:00 at −0.32R/−0.45R
     * (half-hour buckets). 14:00–15:00 has no measurement here. This is a
     * NAMING fix — "10:00–11:00 is just NY AM, so a Patty or a continuation
     * can take the name" — and emphatically not an edge claim, which is why
     * the other two ICT windows are deliberately absent.
     */
    windows: [[10 * 60, 11 * 60]],
    pool: "opening_range_0930_1000",
    requires: ["or_raid", "displacement"],
    note: "The raid of the 09:30–10:00 dealing range, then the displacement. Judas's shape on a different range.",
  },
};

/**
 * ITEM 24 — the silver bullet carries NO size, only a name.
 *
 * Completing a template adds +0.03 fit and lifts the not-complete clamp
 * (`strategy-grade.ts`), so a falsely-named model can turn a C into B+/A−.
 * `or_raid` therefore carries weight 0 (engine-weights.ts) and this says in
 * the tree that the window grants nothing.
 */
export const SILVER_BULLET_EVIDENCE = {
  window: "10:00–11:00 ET",
  measuredR: 0,
  note: "CLAUDE.md: 10:00–11:00 measured FLAT; 03:00–04:00 measured −0.32R/−0.45R. A name, not an edge.",
  grantsSize: false,
} as const;

/**
 * The 62–79% OTE size cut, measured and NOT wired.
 *
 * Recorded so the idea is not silently re-proposed: entry inside the OTE band
 * measured +0.06R at z = 0.43 (scripts/measure-model-claims.mjs, 2026-10-01),
 * far inside the |z| >= 2 bar this repo holds a new finding to.
 */
export const OTE_SIZE_CUT_EVIDENCE = {
  deltaR: 0.06,
  z: 0.43,
  source: "scripts/measure-model-claims.mjs (2026-10-01)",
  wired: false,
} as const;

/** True when `etMin` falls inside any of the model's windows. */
export function inModelWindow(id: StrategyId, etMin: number | null | undefined): boolean {
  const req = MODEL_REQUIREMENTS[id];
  if (!req?.windows) return true;
  if (etMin == null || !Number.isFinite(etMin)) return false;
  return req.windows.some(([a, b]) => etMin >= a && etMin < b);
}

/**
 * May this model be NAMED on this tape, in this hour?
 *
 * A pure precondition check: it refuses a NAME, it never grants one. A model
 * with no entry in `MODEL_REQUIREMENTS` is unconstrained and always passes, so
 * adding this call to a classifier can only ever remove a wrong name.
 */
export function modelMayBeNamed(
  id: StrategyId,
  input: { etMin: number | null; components: readonly string[] },
): { ok: boolean; why: string } {
  const req = MODEL_REQUIREMENTS[id];
  if (!req) return { ok: true, why: "No time or pool requirement for this model." };
  if (!inModelWindow(id, input.etMin)) {
    const hours = (req.windows ?? [])
      .map(([a, b]) => `${hhmm(a)}–${hhmm(b)}`)
      .join(" and ");
    return {
      ok: false,
      why: `${id} is only itself at ${hours} ET — ${input.etMin == null ? "no clock" : hhmm(input.etMin)} is outside it.`,
    };
  }
  const set = new Set(input.components);
  const lacking = req.requires.filter((k) => !set.has(k));
  if (lacking.length) {
    return { ok: false, why: `${id} needs ${lacking.join(" + ")} — ${req.note}` };
  }
  return { ok: true, why: req.note };
}

function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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
    // Carry the release through so the canon layer and the scanner agree.
    htfDisrespected: c.htfDisrespected === true,
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

  // `htfDisrespected` is the documented release: the HTF bias has been
  // invalidated on the tape, so the counter-bias trade is the REVERSAL
  // rather than a fight. Without this the canon layer silently re-imposed
  // the gate scanner.ts had just released, and the two disagreed.
  const alignedHtf =
    input.htfDisrespected === true ||
    (side === "long" && htf === "bull") ||
    (side === "short" && htf === "bear");
  const alignedMtf =
    (side === "long" && mtf === "bull") || (side === "short" && mtf === "bear");
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
    confirmation === "armed_entry" ||
    confirmation === "confirmed" ||
    (confirmation === "sweep_displace" && has(components, "ltf_reaction"));
  const poi = has(components, "ifvg", "order_block", "breaker");
  /**
   * A POI array AND a real OTE retracement pointing at the same price.
   *
   * This factor has been labelled "FVG/OB + OTE" since it was written while
   * checking `pdHalf` (premium/discount) as a stand-in for OTE, because no
   * Fibonacci math existed anywhere in the repo to check against. Now that
   * trading/fib.ts computes a real 61.8%-79% band and scanner.ts emits an
   * `ote` component from the post-sweep impulse leg, this asks the question
   * the label always claimed: is the entry array sitting in the OTE zone,
   * on the correct half of the range?
   */
  const oteOverlap =
    has(components, "ifvg", "order_block") && has(components, "ote") && pdHalf;
  // ITEM 11: false is "this book is the laggard". null/undefined is "no
  // divergence read", which must behave exactly as it did before.
  const smtEarned = !SMT_TRADES_THE_LEADER.value || input.smtLed !== false;

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
      // `ltfOk` is already only armed_entry, confirmed, or sweep_displace with a live ltf_reaction, so a further
      // "not sweep_only, not none" could never be false. The two dead comparisons broke `tsc` (TS2367) on main.
      pass: ltfOk,
      detail: ltfOk
        ? `LTF confirm ${confirmation}`
        : "Need the 1m–5m displacement after the raid, or the array that displacement left",
    },
    {
      id: "time",
      label: "Kill zone",
      must: true,
      pass: inKillzone,
      detail: inKillzone
        ? killzoneLabel || "In window"
        : "Outside NY AM / NY PM — watch only",
    },
    {
      id: "smt",
      label: "SMT (optional)",
      must: false,
      // ITEM 11: the leader trades it. The laggard held — that is the same
      // divergence seen from the other side, not a second setup.
      pass: smt && smtEarned,
      detail: !smt
        ? "No SMT — not required"
        : smtEarned
          ? "Correlated pair failed to confirm extreme"
          : "SMT present, but the OTHER index made the extreme and displaced. The laggard is not a second setup — trade the book that led.",
    },
    {
      id: "overlap",
      label: "FVG/OB + OTE (optional)",
      must: false,
      pass: oteOverlap,
      detail: oteOverlap
        ? "FVG/OB sits in the 62–79% OTE band, correct half"
        : has(components, "ote")
          ? "In OTE band but no aligned FVG/OB — still valid if musts hit"
          : "Not in the 62–79% OTE band — still valid if musts hit",
    },
    {
      id: "mtf",
      label: "MTF intact",
      must: true,
      pass: alignedMtf,
      detail: alignedMtf
        ? `MTF ${mtf ?? "n/a"} agrees`
        : mtf == null || mtf === "neutral"
          ? "Middle timeframe unread — that is not agreement"
          : `MTF ${mtf} fights — wait`,
    },
  ];

  const musts = factors.filter((f) => f.must);
  const opts = factors.filter((f) => !f.must);
  const mustHits = musts.filter((f) => f.pass).length;
  const optionalHits = opts.filter((f) => f.pass).length;
  const score = mustHits / musts.length + optionalHits * 0.08;

  const sweepPassed = factors.find((f) => f.id === "sweep")?.pass === true;
  let grade: CanonStack["grade"] = "skip";
  if (mustHits === musts.length && optionalHits >= 2) grade = "A+";
  else if (mustHits === musts.length) grade = "A";
  else if (mustHits === musts.length - 1 && ltfOk && alignedHtf && sweepPassed) grade = "A-";
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
      "Enter only on the retrace. Stop beyond the raid. 50% off at T1 (the draw), stop to BE, runner to T2.",
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
