/**
 * Short post-mortem 2026-10-16 — Keaton-approved fixes 1–8 (audits/1016-short-postmortem.md "Exhaustive gate trace").
 * One rules block, `fix1016` in shared/desk-rules.json (byte-identical watcher copy, one RULES_HASH).
 *
 * Every STRATEGY item ships mode "shadow": the would-be read is written to card.fix1016 (wire strategy.fix1016) and
 * logged by the watcher as shadow:fix1016:<item>. Shadow never moves q, band, entry, plan, brain word, Floor verdict
 * or a fire. A backtest survivor flips one item to "live" and sets its parameters in the rules block.
 *
 * Pure functions only (no I/O); build-desk / discipline / amd-state / scanner call them.
 */
import RULES from "../../../shared/desk-rules.json";

export type Side = "long" | "short";
export type FixMode = "live" | "shadow";
type Item = { mode?: string; [k: string]: unknown };
const FX = (((RULES as unknown) as { fix1016?: Record<string, Item> }).fix1016 ?? {}) as Record<string, Item>;
/** Backtest/test-only overrides (never set by the desk or the watcher; the rules file stays the source of truth). */
let OVR: Record<string, Record<string, unknown>> = {};
export function setFixOverrides(o: Record<string, Record<string, unknown>> | null): void { OVR = o ?? {}; }
export const fixMode = (k: string): FixMode => ((OVR[k]?.mode ?? FX[k]?.mode) === "live" ? "live" : "shadow");
export const fixNum = (k: string, f: string, d: number): number => {
  const v = OVR[k]?.[f] ?? FX[k]?.[f];
  return typeof v === "number" && Number.isFinite(v) ? v : d;
};
export const fixItem = <T = unknown>(k: string, f: string): T | undefined => (OVR[k]?.[f] ?? FX[k]?.[f]) as T | undefined;
const r2 = (n: number) => Math.round(n * 100) / 100;
const BANDS = ["A+", "A", "A-", "B+", "B", "C", "skip"];
const bandRank = (b: string | null | undefined) => { const i = BANDS.indexOf(String(b ?? "")); return i < 0 ? 99 : i; };

// ---------------------------------------------------------------- fix 1: re-anchor
export interface Anchor { src: string; entry: number; stop: number; t1: number | null; t2?: number | null; t: number; zone?: { top: number; bottom: number } | null; why?: string }
export interface ReanchorRead {
  mode: FixMode;
  trigger: "distance" | "invalidated" | null;
  distAtr: number | null;
  from: { entry: number | null; stop: number | null };
  to: Anchor | null;
  /** live only: the card's plan was cleared/replaced. */
  applied: boolean;
  why: string;
}
/**
 * Decide whether the card's entry is dead: price > atrMult × ATR15 from the entry, or through the plan's stop
 * (invalidated). The replacement is the NEWEST same-side anchor whose entry is still ahead of price (a short's entry
 * at/above price, below its stop) and not older than maxAgeMin.
 */
export function reanchorDecision(i: {
  side: Side; price: number | null; entry: number | null; stop: number | null; atr15: number | null;
  invalidated?: boolean; nowMs: number; anchors: (Anchor | null | undefined)[];
}): ReanchorRead {
  const mode = fixMode("reanchor");
  const base: ReanchorRead = { mode, trigger: null, distAtr: null, from: { entry: i.entry, stop: i.stop }, to: null, applied: false, why: "" };
  if (i.price == null || !Number.isFinite(i.price)) return { ...base, why: "no price" };
  const S = i.side === "short";
  const dist = i.entry != null && i.atr15 && i.atr15 > 0 ? Math.abs(i.price - i.entry) / i.atr15 : null;
  const through = i.stop != null && (S ? i.price >= i.stop : i.price <= i.stop);
  const inv = (i.invalidated === true || through) && fixItem<boolean>("reanchor", "onInvalidated") !== false;
  const far = dist != null && dist > fixNum("reanchor", "atrMult", 1.0);
  const trigger = inv ? "invalidated" : far ? "distance" : null;
  const out = { ...base, trigger, distAtr: dist == null ? null : r2(dist) } as ReanchorRead;
  if (!trigger) return { ...out, why: dist == null ? "no entry/ATR" : `entry ${r2(dist)}×ATR15 from price — keep` };
  const maxAge = fixNum("reanchor", "maxAgeMin", 45) * 60_000;
  const px = i.price;
  const ok = (a: Anchor | null | undefined): a is Anchor => !!a && Number.isFinite(a.entry) && Number.isFinite(a.stop)
    && (S ? a.stop > a.entry && a.entry >= px - 1e-9 && a.stop > px : a.stop < a.entry && a.entry <= px + 1e-9 && a.stop < px)
    && (i.nowMs - a.t) <= maxAge && (a.entry !== i.entry || a.stop !== i.stop);
  const to = i.anchors.filter(ok).sort((a, b) => b.t - a.t || Math.abs(a.entry - px) - Math.abs(b.entry - px))[0] ?? null;
  return { ...out, to, why: `${trigger === "invalidated" ? "plan invalidated" : `entry ${r2(dist!)}×ATR15 from price`} → ${to ? `newest ${to.src} ${to.entry}/${to.stop}` : "no live same-side array ahead — dead plan released"}` };
}

// ---------------------------------------------------------------- fix 2: AMD lower-high / higher-low retest
export interface HtfGap { tf: string; dir: "bull" | "bear"; lo: number; hi: number; live?: boolean }
/**
 * A short re-arms on a LOWER high (bar.h < lastExt) that wicks into the PREMIUM half of a live bear HTF gap
 * (CE ≤ high ≤ top) and closes back below the CE; a long mirrors it in the discount half of a bull gap.
 */
export function amdRetest(i: { side: Side; bar: { h: number; l: number; c: number }; lastExt: number | null; gaps: HtfGap[]; used: number }): { ok: boolean; gap: HtfGap | null; why: string } {
  const S = i.side === "short";
  if (i.lastExt == null) return { ok: false, gap: null, why: "no prior raid" };
  if (i.used >= fixNum("amdRetest", "maxPerSide", 2)) return { ok: false, gap: null, why: "retest cap" };
  const lower = S ? i.bar.h < i.lastExt : i.bar.l > i.lastExt;
  if (!lower) return { ok: false, gap: null, why: S ? "not a lower high" : "not a higher low" };
  const tfs = fixItem<string[]>("amdRetest", "tfs") ?? ["5m", "15m", "30m", "1h", "4h"];
  const back = fixItem<boolean>("amdRetest", "closeBackThroughCe") !== false;
  const half = fixItem<string>("amdRetest", "zone") === "gapHalf";
  for (const g of i.gaps) {
    if (g.live === false || !tfs.includes(g.tf) || g.dir !== (S ? "bear" : "bull")) continue;
    const ce = (g.lo + g.hi) / 2;
    // zone "gap": the wick trades INTO the gap (the gap itself is the premium array for a short); "gapHalf": into its premium/discount half
    const tap = S ? i.bar.h >= (half ? ce : g.lo) && i.bar.h <= g.hi : i.bar.l <= (half ? ce : g.hi) && i.bar.l >= g.lo;
    const closed = !back || (S ? i.bar.c < ce : i.bar.c > ce);
    if (tap && closed) return { ok: true, gap: g, why: `${S ? "lower high" : "higher low"} ${S ? i.bar.h : i.bar.l} into ${half ? `the ${S ? "premium" : "discount"} half of ` : ""}${g.tf} ${g.dir} gap ${g.lo}–${g.hi}, closed back through CE` };
  }
  return { ok: false, gap: null, why: "no HTF gap half tapped" };
}

// ---------------------------------------------------------------- fix 3: ltfArm promotion
export interface LtfPromote { mode: FixMode; eligible: boolean; deskOk: boolean; needsBrainTake: boolean; why: string[]; plan: Anchor | null }
/** Desk half of the gate (band ≥ minBand, 1h/4h agree, an arm with a real T1). The watcher adds Brain TAKE. */
export function ltfPromote(i: { side: Side; band: string | null; htf: { "1h"?: string | null; "4h"?: string | null }; arm: { entry: number; stop: number; t1: { price: number } | null; t2?: { price: number } | null; gap: { lo: number; hi: number }; tf: string; sweep: { t: number } } | null | undefined; brainWord?: string | null; brainSide?: Side | null }): LtfPromote {
  const mode = fixMode("ltfPromote");
  const why: string[] = [];
  const minBand = fixItem<string>("ltfPromote", "minBand") ?? "B+";
  const a = i.arm;
  if (!a || !a.t1) return { mode, eligible: false, deskOk: false, needsBrainTake: true, why: [a ? "arm has no real T1" : "no LTF arm"], plan: null };
  const bandOk = bandRank(i.band) <= bandRank(minBand);
  why.push(`band ${i.band ?? "-"} ${bandOk ? ">=" : "<"} ${minBand}`);
  const want = i.side === "long" ? "bull" : "bear";
  const htfOk = fixItem<boolean>("ltfPromote", "requireHtfAgree") === false || (["1h", "4h"] as const).every((k) => i.htf[k] == null || i.htf[k] === want);
  why.push(`1h ${i.htf["1h"] ?? "-"} 4h ${i.htf["4h"] ?? "-"} ${htfOk ? "agree" : "AGAINST"}`);
  const deskOk = bandOk && htfOk;
  const needBrain = fixItem<boolean>("ltfPromote", "requireBrainTake") !== false;
  const brainOk = !needBrain || (String(i.brainWord ?? "").toUpperCase() === "TAKE" && i.brainSide === i.side);
  if (i.brainWord !== undefined) why.push(`brain ${i.brainWord ?? "none"} ${i.brainSide ?? ""}${brainOk ? "" : " (need TAKE same side)"}`);
  const plan: Anchor = { src: `ltfArm ${a.tf}`, entry: a.entry, stop: a.stop, t1: a.t1.price, t2: a.t2?.price ?? null, t: a.sweep.t, zone: { top: a.gap.hi, bottom: a.gap.lo } };
  return { mode, eligible: deskOk && (i.brainWord === undefined ? true : brainOk), deskOk, needsBrainTake: needBrain, why, plan };
}

// ---------------------------------------------------------------- fix 4: five-layer score
export interface Score5 { mode: FixMode; total: number; old: number; delta: number; layers: Record<"htf" | "liquidity" | "displacement" | "entry" | "risk", number>; sub: Record<string, number> }
/** Five top layers with sub-factors in [0,1]; weights from rules (sum 1). The old q is kept beside it. */
export function score5(c: {
  side: Side; confluence: number; components: string[]; htfOk?: boolean; gapSide?: Side | null; pdHalf?: boolean | null;
  rr1?: number | null; chaseAtr?: number | null; hasEntryArray?: boolean; t1IsPool?: boolean; dispStrength?: number | null;
}): Score5 {
  const has = (...k: string[]) => k.some((x) => c.components.includes(x));
  const sub: Record<string, number> = {
    htfBias: c.htfOk ? 1 : 0,
    htfGapSide: c.gapSide == null ? 0.5 : c.gapSide === c.side ? 1 : 0,
    pdHalf: c.pdHalf == null ? (has("pd", "weekly_pd") ? 1 : 0.5) : c.pdHalf ? 1 : 0,
    sweep: has("sweep_significant", "opening_raid", "or_raid") ? 1 : 0,
    smt: has("smt") ? 1 : 0,
    displacement: has("displacement", "propulsion") ? 1 : c.dispStrength != null ? Math.max(0, Math.min(1, c.dispStrength)) : 0,
    structure: has("mss", "cisd", "structure") ? 1 : 0,
    array: has("ifvg", "order_block", "breaker", "sponsored", "mitigation") || c.hasEntryArray ? 1 : 0,
    ote: has("ote") ? 1 : 0,
    timing: c.chaseAtr == null ? 1 : Math.max(0, 1 - c.chaseAtr / fixNum("score5", "chaseAtrZero", 2.0)),
    rr: c.rr1 == null ? 0 : Math.max(0, Math.min(1, (c.rr1 - fixNum("score5", "minRr", 1.5) + 1) / (fixNum("score5", "goodRr", 3.0) - fixNum("score5", "minRr", 1.5) + 1))),
    t1Pool: c.t1IsPool ? 1 : 0.5,
  };
  const layers = {
    htf: (sub.htfBias! + sub.htfGapSide! + sub.pdHalf!) / 3,
    liquidity: sub.sweep! * 0.8 + sub.smt! * 0.2,
    displacement: (sub.displacement! + sub.structure!) / 2,
    entry: sub.array! * 0.6 + sub.ote! * 0.2 + sub.timing! * 0.2,
    risk: sub.rr! * 0.7 + sub.t1Pool! * 0.3,
  };
  const w = fixItem<Record<string, number>>("score5", "weights") ?? { htf: 0.25, liquidity: 0.2, displacement: 0.2, entry: 0.2, risk: 0.15 };
  const wsum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const total = (Object.keys(layers) as (keyof typeof layers)[]).reduce((s, k) => s + (w[k] ?? 0) * layers[k], 0) / wsum;
  const t = +Math.min(0.99, total).toFixed(4);
  const L = Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, +v.toFixed(3)])) as Score5["layers"];
  return { mode: fixMode("score5"), total: t, old: c.confluence, delta: +(t - c.confluence).toFixed(4), layers: L, sub: Object.fromEntries(Object.entries(sub).map(([k, v]) => [k, +v.toFixed(3)])) };
}

// ---------------------------------------------------------------- fix 5: chase from the current anchor
export function chaseFrom(side: Side, price: number | null, entry: number | null, atr: number | null): { distAtr: number; qFactor: number } | null {
  if (price == null || entry == null || !atr || !(atr > 0)) return null;
  const past = side === "long" ? price - entry : entry - price;
  const d = Math.max(0, past) / atr;
  return { distAtr: +d.toFixed(2), qFactor: +Math.max(0, 1 - 0.5 * d).toFixed(4) };
}
/** The entry R3 chase measures from: the re-anchored entry when chaseFromAnchor is live and a re-anchor exists. */
export function chaseEntry(c: { entryPx?: number | null; plan?: { entry?: number | null } | null; fix1016?: { reanchor?: ReanchorRead | null } | null }): number | null {
  const base = c.entryPx ?? c.plan?.entry ?? null;
  if (fixMode("chaseFromAnchor") !== "live") return base;
  return c.fix1016?.reanchor?.to?.entry ?? base;
}

// ---------------------------------------------------------------- fix 8: T1 partial + runner to the next pool
export interface RunnerPlan { mode: FixMode; t1: number; partialFrac: number; runnerTarget: number | null; runnerR: number | null; beStop: number | null; why: string }
export function runnerPlan(i: { side: Side; entry: number; stop: number; t1: number | null; pools: (number | null | undefined)[] }): RunnerPlan | null {
  if (i.t1 == null || !Number.isFinite(i.entry) || !Number.isFinite(i.stop)) return null;
  const S = i.side === "short"; const risk = Math.abs(i.entry - i.stop);
  if (!(risk > 0)) return null;
  const minR = fixNum("runner", "minRunnerR", 2.0);
  const beyond = i.pools.filter((p): p is number => p != null && Number.isFinite(p) && (S ? p < i.t1! : p > i.t1!) && Math.abs(p - i.entry) / risk >= minR)
    .sort((a, b) => (S ? b - a : a - b));
  const rt = beyond[0] ?? null;
  const frac = fixNum("runner", "t1PartialFrac", 0.5);
  const be = fixItem<boolean>("runner", "beAfterT1") !== false ? i.entry : null;
  return { mode: fixMode("runner"), t1: i.t1, partialFrac: frac, runnerTarget: rt, runnerR: rt == null ? null : r2(Math.abs(rt - i.entry) / risk), beStop: be,
    why: `T1 ${i.t1}: take ${Math.round(frac * 100)}%${be != null ? `, stop → BE ${be}` : ""}; runner → ${rt != null ? `next pool ${rt} (${r2(Math.abs(rt - i.entry) / risk)}R)` : "no pool ≥ " + minR + "R — runner closes at T1"}` };
}

/** Snapshot of the item modes, published on the card so the watcher/Floor/Brain can show what is live. */
export function fixModes(): Record<string, FixMode> {
  return Object.fromEntries(["reanchor", "amdRetest", "ltfPromote", "score5", "chaseFromAnchor", "reviewQuoteRetry", "runner"].map((k) => [k, fixMode(k)]));
}
