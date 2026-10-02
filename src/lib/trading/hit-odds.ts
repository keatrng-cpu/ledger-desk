/**
 * The card's score: the probability this trade reaches T1, from four years of
 * the desk's own cards.
 *
 * WHY THE SCORE CHANGED (trader's call, 2026-10-02)
 * The big number on every card was the engine's FIT — how much of a model's
 * checklist is on the tape — labelled "fit · not odds" because it was not
 * odds, and four years showed it is not even monotone: Q 0.85+ moved the
 * card's way 46.3% of the time against 53.6% at 0.65–0.70. A trader reads the
 * biggest number on the card as "how likely is this to work". So that number
 * is now exactly that: P(T1 reached | filled), under the live management rule
 * (limit at CE, the failed-hold exit before T1, hard stop beyond the raid,
 * 8h hold), fitted on the four-year capture and validated out of sample by
 * scripts/build-hit-odds.mjs. The fit stays — it is still what the 0.65
 * floor and the PATH bands in config.ts gate on — but it is the second number.
 *
 * WHAT GOES IN — only what is measurable identically on the four-year tape
 * and on the live desk:
 *   geometry   T1 distance in R and in ATR, the stop band (0.5–1.5 ATR)
 *   location   price's distance to CE when read (LIVE / ARMED / FORMING)
 *   ladder     Tier-1 direction; weekly AND daily both with / both against
 *   patterns   inducement, mitigation block
 *   SMT        at a major level / HTF array, vs anywhere else (smt-level.ts)
 *   time       London, NY AM, Friday
 *   the fit    itself, so its own (measured) relationship is priced, not assumed
 *   controls   long vs short, MNQ vs ES
 * Excluded: anything the capture cannot reproduce (1m tape, live order flow),
 * and the named-pool raid, which measured null and has no identical live
 * definition.
 *
 * PURE. The model file is data; this file is arithmetic on it.
 */

export type OddsSide = "long" | "short";

export interface OddsInput {
  side: OddsSide;
  symbol: string;
  entry: number;
  stop: number;
  t1: number | null | undefined;
  atr: number | null | undefined;
  /** Price the card is read at — the live price, or the decision bar's close. */
  price: number | null | undefined;
  /** ladderTags(ladder, side): tf_dir, tf_1w, tf_1d. */
  tags?: Record<string, string> | null;
  inducement?: boolean | null;
  mitigation?: boolean | null;
  smt?: { present: boolean; atLevel: boolean } | null;
  killzone?: string | null;
  /** 0 = Sunday … 5 = Friday. */
  weekday?: number | null;
  fit?: number | null;
  /** The 18-session first-passage race (target-odds.ts) — T1 before the stop, recent sessions only. */
  raceP?: number | null;
}

export type FeatureKey =
  | "lnRR"
  | "lnT1Atr"
  | "stopTight"
  | "stopWide"
  | "tierLive"
  | "tierForming"
  | "tier1With"
  | "tier1Against"
  | "wdWith"
  | "wdAgainst"
  | "inducement"
  | "mitigation"
  | "smtLevel"
  | "smtOff"
  | "kzLondon"
  | "kzNyAm"
  | "friday"
  | "fit"
  | "long"
  | "mnq"
  | "raceLogit"
  | "raceMissing";

export const GEOMETRY_FEATURES: FeatureKey[] = ["lnRR", "lnT1Atr", "stopTight", "stopWide"];
export const ALL_FEATURES: FeatureKey[] = [
  ...GEOMETRY_FEATURES,
  "tierLive",
  "tierForming",
  "tier1With",
  "tier1Against",
  "wdWith",
  "wdAgainst",
  "inducement",
  "mitigation",
  "smtLevel",
  "smtOff",
  "kzLondon",
  "kzNyAm",
  "friday",
  "fit",
  "long",
  "mnq",
];
/** M2 — everything plus the recent-session race, so the two probabilities are tested head to head. */
export const RACE_FEATURES: FeatureKey[] = [...ALL_FEATURES, "raceLogit", "raceMissing"];
/** Continuous features — standardized by the model's stored mean/sd. */
export const CONTINUOUS: FeatureKey[] = ["lnRR", "lnT1Atr", "fit", "raceLogit"];

export const FEATURE_LABEL: Record<FeatureKey, string> = {
  lnRR: "T1 distance in R",
  lnT1Atr: "T1 distance in ATR",
  stopTight: "stop under 0.5 ATR",
  stopWide: "stop over 1.5 ATR",
  tierLive: "price already at CE",
  tierForming: "CE over 1 ATR away",
  tier1With: "Tier-1 bias with",
  tier1Against: "Tier-1 bias against",
  wdWith: "weekly + daily with",
  wdAgainst: "weekly + daily against",
  inducement: "inducement (decoy sweep)",
  mitigation: "mitigation block",
  smtLevel: "SMT at a major level",
  smtOff: "SMT away from levels",
  kzLondon: "London session",
  kzNyAm: "NY AM session",
  friday: "Friday",
  fit: "engine fit",
  long: "long side",
  mnq: "MNQ (vs ES)",
  raceLogit: "recent-session race",
  raceMissing: "too few sessions for the race",
};

/** The fit range the model was trained on; outside it the number is extrapolated. */
export const FIT_RANGE: [number, number] = [0.65, 0.99];
export const TIER_LIVE_CE_ATR = 0.25;
export const TIER_ARMED_CE_ATR = 1;

export interface Geometry {
  rr1: number;
  t1Atr: number;
  riskAtr: number;
  awayAtr: number | null;
  tier: "LIVE" | "ARMED" | "FORMING" | null;
}

/** Plan geometry, or null when there is no target ahead of the entry. */
export function geometryOf(input: Pick<OddsInput, "side" | "entry" | "stop" | "t1" | "atr" | "price">): Geometry | null {
  const { side, entry, stop, t1, atr, price } = input;
  if (t1 == null || !Number.isFinite(t1) || !Number.isFinite(entry) || !Number.isFinite(stop)) return null;
  if (atr == null || !(atr > 0)) return null;
  const long = side === "long";
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return null;
  if (long ? t1 <= entry : t1 >= entry) return null;
  const reward = Math.abs(t1 - entry);
  const awayAtr = price != null && Number.isFinite(price) ? (long ? price - entry : entry - price) / atr : null;
  const tier = awayAtr == null ? null : awayAtr <= TIER_LIVE_CE_ATR ? "LIVE" : awayAtr <= TIER_ARMED_CE_ATR ? "ARMED" : "FORMING";
  return { rr1: reward / risk, t1Atr: reward / atr, riskAtr: risk / atr, awayAtr, tier };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const b = (x: unknown) => (x ? 1 : 0);

/** Raw (unstandardized) features. Null when the plan has no priced T1. */
export function oddsFeatures(input: OddsInput): Record<FeatureKey, number> | null {
  const g = geometryOf(input);
  if (!g) return null;
  const tags = input.tags ?? {};
  const kz = input.killzone ?? "";
  const fit = input.fit != null && Number.isFinite(input.fit) ? clamp(input.fit, FIT_RANGE[0], FIT_RANGE[1]) : 0.8;
  return {
    lnRR: Math.log(clamp(g.rr1, 0.2, 10)),
    lnT1Atr: Math.log(clamp(g.t1Atr, 0.1, 20)),
    stopTight: b(g.riskAtr < 0.5),
    stopWide: b(g.riskAtr > 1.5),
    tierLive: b(g.tier === "LIVE"),
    tierForming: b(g.tier === "FORMING"),
    tier1With: b(tags.tf_dir === "with"),
    tier1Against: b(tags.tf_dir === "against"),
    wdWith: b(tags.tf_1w === "with" && tags.tf_1d === "with"),
    wdAgainst: b(tags.tf_1w === "against" && tags.tf_1d === "against"),
    inducement: b(input.inducement),
    mitigation: b(input.mitigation),
    smtLevel: b(input.smt?.present && input.smt.atLevel),
    smtOff: b(input.smt?.present && !input.smt.atLevel),
    kzLondon: b(kz === "london"),
    kzNyAm: b(kz === "ny_am"),
    friday: b(input.weekday === 5),
    fit,
    long: b(input.side === "long"),
    mnq: b(input.symbol.toUpperCase().includes("NQ")),
    raceLogit: input.raceP != null && Number.isFinite(input.raceP) ? Math.log(clamp(input.raceP, 0.02, 0.98) / (1 - clamp(input.raceP, 0.02, 0.98))) : 0,
    raceMissing: b(input.raceP == null || !Number.isFinite(input.raceP)),
  };
}

/* ── The fitted model (src/data/hit-odds-model.json, via hit-odds-model.ts) ── */

export interface OddsModelFile {
  version: number;
  builtAt: string;
  chosen: "M0" | "M1";
  features: FeatureKey[];
  intercept: number;
  coef: Partial<Record<FeatureKey, number>>;
  scale: Partial<Record<FeatureKey, { mean: number; sd: number }>>;
  /** E[R | T1] ≈ winA + winB·rr1 ; E[R | no T1] = lossMean (live exits). */
  payoff: { winA: number; winB: number; lossMean: number };
  fillByTier: Record<"LIVE" | "ARMED" | "FORMING", number>;
  effects: Partial<Record<FeatureKey, { coef: number; lo: number; hi: number; n: number }>>;
  validation: Record<string, unknown>;
  n: { cards: number; fills: number; t1: number };
}

function linear(m: OddsModelFile, f: Record<FeatureKey, number>): number {
  let z = m.intercept;
  for (const k of m.features) {
    const w = m.coef[k];
    if (w == null) continue;
    const s = m.scale[k];
    const x = s ? (f[k] - s.mean) / (s.sd || 1) : f[k];
    z += w * x;
  }
  return z;
}
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export interface OddsDriver {
  key: FeatureKey;
  label: string;
  /** Probability points this feature moves P(T1) on THIS card. */
  pts: number;
  /** True when the four-year interval for the feature excludes zero. */
  reliable: boolean;
}

export interface HitOdds {
  /** P(T1 reached | filled), live management rule. 0–1. */
  pT1: number;
  /** What the geometry alone says on a random walk: 1 / (1 + rr1). */
  pRandomWalk: number;
  /** Expected R per FILL under the live rule. */
  expR: number;
  /** Four-year fill rate for this card's location tier. */
  pFill: number | null;
  /** Expected R per CARD (unfilled = 0). The ranking number. */
  expRPerCard: number | null;
  geometry: Geometry;
  drivers: OddsDriver[];
  /** Inputs outside what the model was trained on, said out loud. */
  caveats: string[];
  model: "M0" | "M1";
  n: number;
}

/** Reference value a feature is compared against when pricing its effect. */
function reference(k: FeatureKey, m: OddsModelFile): number {
  if (CONTINUOUS.includes(k)) return m.scale[k]?.mean ?? 0;
  return 0;
}

export function hitOdds(input: OddsInput, m: OddsModelFile): HitOdds | null {
  const f = oddsFeatures(input);
  if (!f) return null;
  const g = geometryOf(input)!;
  const p = sigmoid(linear(m, f));
  const drivers: OddsDriver[] = [];
  for (const k of m.features) {
    if (m.coef[k] == null) continue;
    const ref = reference(k, m);
    if (Math.abs(f[k] - ref) < 1e-9) continue;
    const alt = { ...f, [k]: ref };
    const pts = (p - sigmoid(linear(m, alt))) * 100;
    if (Math.abs(pts) < 0.5) continue;
    const e = m.effects[k];
    drivers.push({ key: k, label: FEATURE_LABEL[k], pts: +pts.toFixed(1), reliable: e != null && (e.lo > 0 || e.hi < 0) });
  }
  drivers.sort((a, b2) => Math.abs(b2.pts) - Math.abs(a.pts));
  const expR = p * (m.payoff.winA + m.payoff.winB * g.rr1) + (1 - p) * m.payoff.lossMean;
  const pFill = g.tier ? m.fillByTier[g.tier] ?? null : null;
  const caveats: string[] = [];
  if (input.fit != null && (input.fit < FIT_RANGE[0] || input.fit > FIT_RANGE[1])) {
    caveats.push(`fit ${input.fit.toFixed(2)} is outside the ${FIT_RANGE[0]}–${FIT_RANGE[1]} the model was trained on — read as ${FIT_RANGE[0]}`);
  }
  if (g.rr1 > 10 || g.rr1 < 0.2) caveats.push(`T1 at ${g.rr1.toFixed(1)}R is outside the trained 0.2–10R`);
  if (g.tier == null) caveats.push("no live price — location tier unknown");
  return {
    pT1: +p.toFixed(4),
    pRandomWalk: +(1 / (1 + g.rr1)).toFixed(4),
    expR: +expR.toFixed(3),
    pFill,
    expRPerCard: pFill != null ? +(pFill * expR).toFixed(3) : null,
    geometry: g,
    drivers,
    caveats,
    model: m.chosen,
    n: m.n.fills,
  };
}
