/**
 * Fixes 1–4, 6, 9–15, 21, 22: day/session context and setup refinements.
 * Pure, closed bars only; every read is null when its bars are not there.
 * Fix 5 (DXY / 10y): no real feed is wired into the desk — `macroRisk`
 * is always null with that note. Never synthesized.
 */
import type { OhlcBar } from "@/lib/market/types";
import { fractalSwings } from "@/lib/trading/detectors";

type Side = "long" | "short";
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
export function et(ms: number) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute), wd: p.weekday as string };
}
const hi = (b: OhlcBar[]) => Math.max(...b.map((x) => x.h));
const lo = (b: OhlcBar[]) => Math.min(...b.map((x) => x.l));
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)]! : 0; };

/** Session slices of today's (ET) minute bars. Asia 20:00–00:00 prior evening, London 02:00–05:00, overnight 18:00–09:30, OR 09:30–09:45. */
export function sessions(minute: OhlcBar[], nowMs: number) {
  const today = et(nowMs).day;
  const tag = minute.map((b) => ({ b, ...et(b.t) }));
  const td = tag.filter((x) => x.day === today);
  const prevEve = tag.filter((x) => x.day !== today && x.min >= 18 * 60 && nowMs - x.b.t < 20 * 3_600_000);
  // Asia 20:00–00:00 ET (Keaton's window); the overnight range still opens at 18:00
  const asia = prevEve.filter((x) => x.min >= 20 * 60).map((x) => x.b);
  const london = td.filter((x) => x.min >= 120 && x.min < 300).map((x) => x.b);
  const overnight = [...prevEve.map((x) => x.b), ...td.filter((x) => x.min < 570).map((x) => x.b)];
  const or = td.filter((x) => x.min >= 570 && x.min < 585).map((x) => x.b);
  const ny = td.filter((x) => x.min >= 570).map((x) => x.b);
  return { asia, london, overnight, or, ny };
}

/** Fix 1: daily bias set from premarket facts only (PDH/PDL, weekly open, overnight range). */
export function dailyBias(daily: OhlcBar[], minute: OhlcBar[], nowMs: number) {
  const today = et(nowMs).day;
  const prior = daily.filter((d) => et(d.t + 12 * 3_600_000).day < today);
  if (prior.length < 6) return null;
  const pd = prior[prior.length - 1]!;
  // weekly open: first daily bar of this ET week (Mon), else null
  const wk = prior.slice(-6).filter((d) => et(d.t + 12 * 3_600_000).wd === "Mon").pop() ?? null;
  const s = sessions(minute, nowMs);
  const pre = s.overnight;
  const prePx = pre.length ? pre[pre.length - 1]!.c : null;
  if (prePx == null) return { bias: null as Side | null, pdh: pd.h, pdl: pd.l, weeklyOpen: wk?.o ?? null, onHigh: null, onLow: null, why: ["no overnight bars — bias unset"] };
  let score = 0; const why: string[] = [];
  const mid = (pd.h + pd.l) / 2;
  if (prePx > mid) { score++; why.push("premarket above PD mid"); } else { score--; why.push("premarket below PD mid"); }
  if (wk) { if (prePx > wk.o) { score++; why.push("above weekly open"); } else { score--; why.push("below weekly open"); } }
  if (prePx > pd.h) { score++; why.push("above PDH"); } else if (prePx < pd.l) { score--; why.push("below PDL"); }
  return { bias: score >= 2 ? "long" : score <= -2 ? "short" : null, pdh: pd.h, pdl: pd.l, weeklyOpen: wk?.o ?? null, onHigh: hi(pre), onLow: lo(pre), why } as const;
}

/** Fix 2: premium/discount of price in the prior-day and 4h (last 24h of 15m) dealing ranges. */
export function premiumDiscount(price: number | null, daily: OhlcBar[], bars15: OhlcBar[], nowMs: number) {
  if (price == null) return null;
  const today = et(nowMs).day;
  const pd = daily.filter((d) => et(d.t + 12 * 3_600_000).day < today).pop();
  const r4 = bars15.filter((b) => b.t + 900_000 <= nowMs).slice(-96);
  const at = (h: number, l: number) => (h > l ? +((price - l) / (h - l)).toFixed(3) : null);
  const d = pd ? at(pd.h, pd.l) : null;
  const h4 = r4.length >= 16 ? at(hi(r4), lo(r4)) : null;
  const zone = (x: number | null) => (x == null ? null : x > 0.5 ? "premium" : "discount");
  return { daily: d, h4, dailyZone: zone(d), h4Zone: zone(h4) };
}

/** Fix 3: London swept an Asia extreme → NY favours the other way. */
export function sessionSequence(minute: OhlcBar[], nowMs: number) {
  const s = sessions(minute, nowMs);
  if (!s.asia.length || !s.london.length) return null;
  const aH = hi(s.asia), aL = lo(s.asia), lH = hi(s.london), lL = lo(s.london);
  const sweptHigh = lH > aH, sweptLow = lL < aL;
  if (sweptHigh === sweptLow) return { londonSwept: sweptHigh ? "both" : "none", nyFavours: null as Side | null, asiaHigh: aH, asiaLow: aL };
  return { londonSwept: sweptHigh ? "Asia high" : "Asia low", nyFavours: (sweptHigh ? "short" : "long") as Side, asiaHigh: aH, asiaLow: aL };
}

/** Fix 4: ES/NQ alignment for a side from both books' MTF alignment scores; size hint. */
export function pairAlignment(scores: (number | null | undefined)[]) {
  const v = scores.filter((x): x is number => x != null);
  if (v.length < 2) return null;
  const score = +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2);
  return { score, sizeHint: score >= 0.67 ? "full" : score >= 0.5 ? "half" : "quarter" } as const;
}

/** Fix 6: opening range 9:30–9:45 break (2 5m closes beyond) or fakeout (wick beyond, close back). */
export function openingRange(minute: OhlcBar[], nowMs: number) {
  const s = sessions(minute, nowMs);
  if (s.or.length < 15) return null;
  const h = hi(s.or), l = lo(s.or);
  const after = s.ny.filter((b) => b.t >= s.or[s.or.length - 1]!.t + 60_000 && b.t + 60_000 <= nowMs);
  const b5: OhlcBar[] = [];
  for (let i = 0; i + 5 <= after.length; i += 5) { const g = after.slice(i, i + 5); b5.push({ t: g[0]!.t, o: g[0]!.o, h: hi(g), l: lo(g), c: g[4]!.c, v: 0 }); }
  let read: { kind: "break" | "fakeout"; side: Side } | null = null;
  for (let i = 0; i < b5.length; i++) {
    const b = b5[i]!, n = b5[i + 1];
    if (n && b.c > h && n.c > h) { read = { kind: "break", side: "long" }; }
    else if (n && b.c < l && n.c < l) { read = { kind: "break", side: "short" }; }
    else if (b.h > h && b.c < h) { read = { kind: "fakeout", side: "short" }; }
    else if (b.l < l && b.c > l) { read = { kind: "fakeout", side: "long" }; }
  }
  const r = h - l;
  // Fix 14: SD projections of the opening range as draws
  const sd = r > 0 ? { up2: +(h + 2 * r).toFixed(2), up25: +(h + 2.5 * r).toFixed(2), dn2: +(l - 2 * r).toFixed(2), dn25: +(l - 2.5 * r).toFixed(2) } : null;
  return { high: h, low: l, read, sd };
}

/** Fix 9: 1m stop-run — range ≥2.5× and volume ≥2× the 30-bar median, beyond a 30-bar extreme, close back inside. */
export function stopRun(minute: OhlcBar[], lookback = 10) {
  const m = minute.slice(0, -1);
  for (let i = m.length - 1; i >= Math.max(31, m.length - lookback); i--) {
    const b = m[i]!, w = m.slice(i - 30, i);
    const rMed = median(w.map((x) => x.h - x.l)), vMed = median(w.map((x) => x.v ?? 0));
    const bigR = b.h - b.l >= 2.5 * rMed && rMed > 0;
    const bigV = vMed > 0 ? (b.v ?? 0) >= 2 * vMed : false;
    if (!bigR || !bigV) continue;
    if (b.h > hi(w) && b.c < hi(w)) return { side: "short" as Side, level: hi(w), ageBars: m.length - 1 - i };
    if (b.l < lo(w) && b.c > lo(w)) return { side: "long" as Side, level: lo(w), ageBars: m.length - 1 - i };
  }
  return null;
}

/** Fix 10: a level with 2+ consecutive 5m closes beyond it is a breakout, not a sweep. */
export function failedSweep(bars5: OhlcBar[], levels: { name: string; price: number }[]) {
  const n = bars5.length;
  if (n < 3) return null;
  const [a, b] = [bars5[n - 2]!, bars5[n - 1]!];
  for (const lv of levels) {
    const before = bars5.slice(Math.max(0, n - 14), n - 2);
    if (a.c > lv.price && b.c > lv.price && before.some((x) => x.c < lv.price)) return { side: "long" as Side, level: lv.price, name: lv.name };
    if (a.c < lv.price && b.c < lv.price && before.some((x) => x.c > lv.price)) return { side: "short" as Side, level: lv.price, name: lv.name };
  }
  return null;
}

/** Fix 11: 40/40/20 ladder — near edge, CE, far edge of the entry zone. */
export function entryLadder(side: Side, zone: { top: number; bottom: number } | null | undefined) {
  if (!zone || !(zone.top > zone.bottom)) return null;
  const ce = +((zone.top + zone.bottom) / 2).toFixed(2);
  const near = side === "short" ? zone.bottom : zone.top;
  const far = side === "short" ? zone.top : zone.bottom;
  return [{ px: near, pct: 40 }, { px: ce, pct: 40 }, { px: far, pct: 20 }];
}

/** Fix 12/13: order blocks on 5m → OB, breaker (OB closed through: polarity flips) or mitigation (OB of a failed swing, closed through). */
export interface Block { kind: "ob" | "breaker" | "mitigation"; dir: "bull" | "bear"; lo: number; hi: number; ageBars: number }
export function blocks5m(bars5: OhlcBar[], maxAge = 48): Block[] {
  const out: Block[] = [];
  const n = bars5.length;
  const sw = fractalSwings(bars5, 2);
  for (let i = 1; i < n - 1; i++) {
    const c = bars5[i]!, nx = bars5[i + 1]!;
    const bullOb = c.c < c.o && nx.c > c.h; // last down candle before an up displacement
    const bearOb = c.c > c.o && nx.c < c.l;
    if (!bullOb && !bearOb) continue;
    const dir = bullOb ? "bull" : "bear";
    const z = { lo: Math.min(c.o, c.c, c.l), hi: Math.max(c.o, c.c, c.h) };
    // did the leg break the prior swing? (success) else it is a failed swing
    const prior = sw.filter((s) => s.index < i && s.kind === (bullOb ? "high" : "low")).pop();
    const leg = bars5.slice(i + 1, Math.min(n, i + 13));
    const broke = prior ? leg.some((b) => (bullOb ? b.c > prior.price : b.c < prior.price)) : false;
    const later = bars5.slice(i + 2);
    const violated = later.some((b) => (bullOb ? b.c < z.lo : b.c > z.hi));
    const age = n - 1 - i;
    if (age > maxAge) continue;
    if (!violated) out.push({ kind: "ob", dir, ...z, ageBars: age });
    else out.push({ kind: broke ? "breaker" : "mitigation", dir: bullOb ? "bear" : "bull", ...z, ageBars: age });
  }
  return out.slice(-12);
}
export function overlaps(a: { lo: number; hi: number }, b: { top: number; bottom: number }) {
  return a.lo <= b.top && a.hi >= b.bottom;
}

/** Fix 15: trigger timeframe from volatility — ATR15 vs its own 5-day median. */
export function triggerTf(bars15: OhlcBar[], atrSeries: number[]) {
  const a = atrSeries.slice(-480);
  if (a.length < 40) return null;
  const now = a[a.length - 1]!, med = median(a);
  const ratio = +(now / med).toFixed(2);
  return { tf: ratio >= 1.4 ? "5m" : ratio >= 0.9 ? "3m" : "1m", ratio } as const;
}

/** Fix 21: age decay for the arming sweep — −0.01 per 6 5m bars past 12, max −0.04. */
export function ageDecay(sweepAge5m: number | null | undefined) {
  if (sweepAge5m == null || sweepAge5m <= 12) return 0;
  return -Math.min(0.04, Math.floor((sweepAge5m - 12) / 6 + 1) * 0.01);
}

/** Fix 22: q spread across strategies (base q = 0.4·structureQ + 0.55·modelQ). */
export function qSpread(board: { id: string; structureQ: number; modelQ: number; complete?: boolean }[] | null | undefined) {
  if (!board?.length) return null;
  const qs = board.map((b) => ({ id: String(b.id), q: +(0.4 * b.structureQ + 0.55 * b.modelQ).toFixed(3) })).sort((a, b) => b.q - a.q);
  const best = qs[0]!, worst = qs[qs.length - 1]!;
  const agree = qs.filter((x) => x.q >= best.q - 0.05).length;
  return { best: best.id, bestQ: best.q, worstQ: worst.q, spread: +(best.q - worst.q).toFixed(3), agree, n: qs.length };
}

export const MACRO_RISK_NOTE = "DXY/10y: no real feed wired into the desk — null, not synthesized (fix 5).";
