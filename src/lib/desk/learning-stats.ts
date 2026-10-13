/**
 * Brain/learning stats (pure). Every function reads GRADED snapshots (never invents outcomes) and only
 * REPORTS; anything that would change scoring is a proposal (approval + shadow week, shared rules learning.*).
 */
import RULES from "../../../shared/desk-rules.json";
import type { SnapCard, Grade, PlanGrade } from "@/lib/desk/learning";
import { isWin, isLoss } from "@/lib/desk/learning";
type OhlcBar = { t: number; o: number; h: number; l: number; c: number; v?: number };

export type Row = { id: string; c: SnapCard; g: Grade; openedMs: number };
const L = RULES.learning;

/** 25: deterministic holdout — the loop never learns from these ids. */
export function isHoldout(id: string): boolean {
  let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000 < L.holdoutFrac;
}
/** 20: 60-day exponential decay weight. */
export const decayW = (openedMs: number, nowMs: number) => Math.exp(-Math.max(0, nowMs - openedMs) / (L.decayDays * 86_400_000));

export interface Stat { n: number; w: number; wins: number; hit: number | null; lo: number | null; hi: number | null; avgR: number | null }
/** 14: Wilson interval on a (decay-weighted) hit rate. */
export function wilson(wins: number, n: number, z = L.qCiZ): [number | null, number | null] {
  if (!(n > 0)) return [null, null];
  const p = wins / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [+((c - m) / d).toFixed(3), +((c + m) / d).toFixed(3)];
}
export function statOf(rows: Row[], nowMs: number): Stat {
  let w = 0, wins = 0, rs = 0, rn = 0;
  for (const r of rows) { const k = decayW(r.openedMs, nowMs); w += k; if (isWin(r.g)) wins += k; if (r.g.kind === "plan" && r.g.r != null) { rs += r.g.r; rn++; } }
  const [lo, hi] = wilson(wins, w);
  return { n: rows.length, w: +w.toFixed(2), wins: +wins.toFixed(2), hit: w ? +(wins / w).toFixed(3) : null, lo, hi, avgR: rn ? +(rs / rn).toFixed(3) : null };
}
export function groupBy(rows: Row[], key: (r: Row) => string | null | undefined, nowMs: number): Record<string, Stat> {
  const m: Record<string, Row[]> = {};
  for (const r of rows) { const k = key(r); if (k == null) continue; (m[k] ??= []).push(r); }
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, statOf(v, nowMs)]));
}
const ctx = (r: Row) => r.c.ctx as Record<string, unknown>;
const etHalfHour = (ms: number) => { const d = new Date(ms); const h = Number(d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false })); const m = d.getUTCMinutes(); return `${String(h).padStart(2, "0")}:${m < 30 ? "00" : "30"} ET`; };

/** 1: MFE/MAE checkpoints at +15m, +60m and end of day, in R (plan) or ATR (no plan). */
export function checkpoints(c: SnapCard, openedMs: number, bars: OhlcBar[], nowMs: number) {
  const unit = c.entry != null && c.stop != null && c.entry !== c.stop ? Math.abs(c.entry - c.stop) : c.atr ?? null;
  const ref = c.entry ?? c.price; if (!unit || ref == null) return null;
  const long = c.side === "long"; const after = bars.filter((b) => b.t >= openedMs && b.t + 60_000 <= nowMs);
  const at = (mins: number | "eod") => {
    const end = mins === "eod" ? Infinity : openedMs + mins * 60_000;
    const w = after.filter((b) => b.t < end); if (!w.length || (mins !== "eod" && w[w.length - 1]!.t + 60_000 < end)) return null;
    const mfe = Math.max(...w.map((b) => (long ? b.h - ref : ref - b.l))) / unit, mae = Math.max(...w.map((b) => (long ? ref - b.l : b.h - ref))) / unit;
    return { mfe: +mfe.toFixed(2), mae: +mae.toFixed(2) };
  };
  return { unit: c.entry != null && c.stop != null ? "R" : "ATR", m15: at(L.checkpointsMin[0]!), m60: at(L.checkpointsMin[1]!), eod: at("eod") };
}
/** 2: stop heat — how deep winners went toward the stop (maeR buckets). */
export function stopHeat(rows: Row[]) {
  const b = { "<0.25R": 0, "0.25-0.5R": 0, "0.5-0.75R": 0, ">=0.75R": 0 };
  for (const r of rows) { if (!isWin(r.g) || r.g.kind !== "plan" || r.g.maeR == null) continue; const x = r.g.maeR; b[x < 0.25 ? "<0.25R" : x < 0.5 ? "0.25-0.5R" : x < 0.75 ? "0.5-0.75R" : ">=0.75R"]++; }
  return b;
}
/** 4: per feature — hit when present vs absent. */
export function featureAccuracy(rows: Row[], nowMs: number) {
  const fs = [...new Set(rows.flatMap((r) => r.c.present))];
  return Object.fromEntries(fs.map((f) => [f, { present: statOf(rows.filter((r) => r.c.present.includes(f)), nowMs), absent: statOf(rows.filter((r) => !r.c.present.includes(f)), nowMs) }]));
}
/** 5: factor hit-rates per regime (report; a weight change would be a proposal). */
export function regimeFeatures(rows: Row[], nowMs: number) {
  const regs = [...new Set(rows.map((r) => String(ctx(r).regime ?? "unknown")))];
  return Object.fromEntries(regs.map((g) => [g, featureAccuracy(rows.filter((r) => String(ctx(r).regime ?? "unknown") === g), nowMs)]));
}
/** 8: one-line STAND reason from the brain checklist. */
export function standLine(checklist: { name: string; ok: boolean; must?: boolean }[]): string {
  const miss = checklist.filter((k) => !k.ok); const must = miss.filter((k) => k.must !== false);
  const pass = checklist.length - miss.length;
  return miss.length ? `STAND ${pass}/${checklist.length}: missing ${(must.length ? must : miss).slice(0, 3).map((k) => k.name).join(", ")}` : `READY ${pass}/${checklist.length}`;
}
/** 9/15: veto counterfactuals + veto power earned (precision of each veto source, shrunk). */
export function vetoes(rows: Row[], nowMs: number) {
  const src = (r: Row): string | null => {
    const x = ctx(r); const b = (x.brain as { word?: string } | null)?.word; const f = (x.floor as { verdict?: string; blocks?: unknown[] } | null);
    if (b === "STAND") return "brain STAND"; if (f && (f.blocks?.length ?? 0) > 0) return "floor block"; if (x.ltfKilled) return "LTF kill"; return null;
  };
  const by = groupBy(rows.filter((r) => src(r)), src, nowMs);
  return Object.fromEntries(Object.entries(by).map(([k, s]) => {
    const right = s.w ? (s.w - s.wins) / s.w : null; // veto right = the vetoed card lost
    const power = right == null ? null : +((right * s.w + 0.5 * L.shrinkK) / (s.w + L.shrinkK)).toFixed(3);
    return [k, { ...s, vetoRight: right == null ? null : +right.toFixed(3), power, wouldHaveR: s.avgR }];
  }));
}
/** 10: pass counterfactuals — cards below A- that were not taken. */
export function passes(rows: Row[], nowMs: number) {
  return groupBy(rows.filter((r) => !["A+", "A", "A-"].includes(String(r.c.band))), (r) => String(r.c.band), nowMs);
}
/** 11: Grok (watcher grok_agree) vs desk grade. */
export function grokVsDesk(rows: Row[], nowMs: number) {
  return groupBy(rows.filter((r) => typeof ctx(r).grokAgree === "boolean"), (r) => `grok ${ctx(r).grokAgree ? "agree" : "disagree"} · desk ${r.c.band}`, nowMs);
}
/** 12: news/shock reaction memory. */
export const shockStats = (rows: Row[], nowMs: number) => groupBy(rows, (r) => { const s = ctx(r).shock as { active?: boolean; bias?: string } | undefined; return s?.active ? `shock ${s.bias ?? "?"} · ${r.c.side}` : null; }, nowMs);
/** 13: per-timeframe bias accuracy → vote weights (shrunk toward 1; report/proposal). */
export function tfVoteWeights(rows: Row[]) {
  const acc: Record<string, { n: number; right: number }> = {};
  for (const r of rows) {
    const rungs = ((ctx(r).mtf as { rungs?: { tf: string; bias: string }[] } | null)?.rungs) ?? [];
    for (const g of rungs) { if (g.bias !== "bull" && g.bias !== "bear") continue; const a = (acc[g.tf] ??= { n: 0, right: 0 }); a.n++; const dirUp = r.c.side === "long" ? isWin(r.g) : isLoss(r.g); if ((g.bias === "bull") === dirUp) a.right++; }
  }
  return Object.fromEntries(Object.entries(acc).map(([tf, a]) => [tf, { n: a.n, acc: +(a.right / a.n).toFixed(3), weight: +((a.right / a.n / 0.5) * (a.n / (a.n + L.shrinkK)) + (L.shrinkK / (a.n + L.shrinkK))).toFixed(3) }]));
}
/** 16: chase distance (|price − entry| / ATR at snapshot) vs outcome. */
export const chaseStats = (rows: Row[], nowMs: number) => groupBy(rows, (r) => { if (r.c.entry == null || r.c.price == null || !r.c.atr) return null; const d = Math.abs(r.c.price - r.c.entry) / r.c.atr; return d < 0.25 ? "<0.25 ATR" : d < 0.5 ? "0.25-0.5" : d < 0.75 ? "0.5-0.75" : ">=0.75"; }, nowMs);
/** 17: target-type accuracy (T1 vs promoted T2 vs draw kind). */
export const targetStats = (rows: Row[], nowMs: number) => groupBy(rows.filter((r) => r.g.kind === "plan"), (r) => String(ctx(r).targetWhich ?? (ctx(r).draws as { name?: string }[] | undefined)?.[0]?.name?.split(" ")[0] ?? "unknown"), nowMs);
/** 21: pattern fatigue — setups that lost fatigueLosses+ in a row on a symbol today. */
export function fatigue(rows: Row[], dayKey: (ms: number) => string, nowMs: number) {
  const today = rows.filter((r) => dayKey(r.openedMs) === dayKey(nowMs)).sort((a, b) => a.openedMs - b.openedMs);
  const run: Record<string, number> = {};
  for (const r of today) { const k = `${r.c.symbol} ${r.c.setup}`; run[k] = isLoss(r.g) ? (run[k] ?? 0) + 1 : 0; }
  return Object.entries(run).filter(([, n]) => n >= L.fatigueLosses).map(([k, n]) => ({ setup: k, losses: n }));
}
/** 22: taken liquidity — draw levels price already traded through since the session open. */
export function takenLevels(levels: { name: string; price: number }[], bars: OhlcBar[], sessionOpenMs: number) {
  const s = bars.filter((b) => b.t >= sessionOpenMs); if (!s.length) return levels.map((l) => ({ ...l, taken: null as boolean | null }));
  const hi = Math.max(...s.map((b) => b.h)), lo = Math.min(...s.map((b) => b.l)), open = s[0]!.o;
  return levels.map((l) => ({ ...l, taken: l.price >= open ? hi >= l.price : lo <= l.price }));
}
/** 23: setup clusters — identical top-4 present-factor signatures. */
export const clusters = (rows: Row[], nowMs: number) => groupBy(rows, (r) => [...r.c.present].sort().slice(0, 4).join("+") || null, nowMs);

/** Full report (items 1–7, 9–17, 20–23, 25). */
export function statsReport(all: Row[], nowMs: number, dayKey: (ms: number) => string) {
  const learn = all.filter((r) => !isHoldout(r.id)), hold = all.filter((r) => isHoldout(r.id));
  return {
    n: all.length, learnN: learn.length, holdoutN: hold.length, decayDays: L.decayDays,
    holdout: statOf(hold, nowMs), learnSet: statOf(learn, nowMs),
    perStrategy: groupBy(learn, (r) => r.c.setup, nowMs), perSymbol: groupBy(learn, (r) => r.c.symbol, nowMs),
    perWindow: groupBy(learn, (r) => etHalfHour(r.openedMs), nowMs), perBand: groupBy(learn, (r) => String(r.c.band), nowMs),
    features: featureAccuracy(learn, nowMs), regimes: regimeFeatures(learn, nowMs), stopHeat: stopHeat(learn),
    vetoes: vetoes(learn, nowMs), passes: passes(learn, nowMs), grokVsDesk: grokVsDesk(learn, nowMs), shock: shockStats(learn, nowMs),
    tfVotes: tfVoteWeights(learn), chase: chaseStats(learn, nowMs), targets: targetStats(learn, nowMs),
    fatigue: fatigue(all, dayKey, nowMs), clusters: clusters(learn, nowMs),
    checkpoints: learn.map((r) => ({ id: r.id, cp: (r.g as PlanGrade & { checkpoints?: unknown }).checkpoints ?? null })).filter((x) => x.cp).slice(-30),
  };
}
