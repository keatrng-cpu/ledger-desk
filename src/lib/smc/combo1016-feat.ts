/**
 * combo1016 card inputs from real desk bars: a closed-bar port of score-rebuild/ev/feat.py (+ the side mapping in gbm.py).
 * Fills the S2 inputs tr4h_with and rng30 and the GBM features sw_with, smt_with, fail3_with, mss5_with, tr1h_with, tr4h_with,
 * pdpos_with, compress, rng30, since_disp and atrpct (from the desk's 1mo 5m feed + closed 1m: atrpctAt).
 *
 * tMs = LABEL of the decision 1m bar (decision at its close, as SMC integration minutes_*.json t_bar) → research row t5 = floor(tMs, 5m): every feature uses only 5m bars that CLOSED at or before t5 (no lookahead).
 * Sources: own/other closed 1m (desk minute feed, 480 kept) for the 5m features; own closed 15m (1 month) for session levels
 * (PDH/PDL, overnight, Asia, London: every boundary sits on a 15m edge, so max/min are exact) and the 1h / 4h EMA20 trends.
 * Research quirks kept bit-for-bit: tr1h_with = −tr1h for both sides (gbm.py sign bug); onh/onl use the whole overnight of the
 * session day (research lookahead before 08:30 CT; here only closed bars, so rows before 08:30 can differ — listed).
 */
export interface B { t: number; o: number; h: number; l: number; c: number }
type Side = "long" | "short";
const HOUR = 3_600_000, M5 = 300_000;
const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const offCache = new Map<number, number>();
/** CT wall-clock offset (ms) for this UTC hour. */
function ctOff(ms: number): number {
  const k = Math.floor(ms / HOUR); let v = offCache.get(k);
  if (v == null) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(k * HOUR)).map((x) => [x.type, x.value]));
    v = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour! % 24, +p.minute!) - k * HOUR; offCache.set(k, v);
  }
  return v;
}
const wall = (ms: number) => ms + ctOff(ms);                       // CT wall clock as a fake-UTC ms
const tod = (ms: number) => { const w = wall(ms); return Math.floor((w % 86_400_000) / 60_000); };
const sday = (ms: number) => Math.floor((wall(ms) + 7 * HOUR) / 86_400_000);   // session day rolls at 17:00 CT
const nan = NaN;

/** pandas ewm(span, adjust=True).mean() */
function ewm(x: number[], span: number): number[] {
  const a = 2 / (span + 1); let num = 0, den = 0; return x.map((v) => { num = v + (1 - a) * num; den = 1 + (1 - a) * den; return num / den; });
}
/** pandas resample(rule[, offset]).last() on a tz-aware index: Tick bins are ABSOLUTE time from origin start_day (2010-06-30 00:00 CDT
 * = 05:00 UTC in the research data), so 1h bins sit on UTC hours and 4h/offset 1h bins on 02,06,10,14,18,22 UTC (DST shifts them in CT). */
function lastByBin(bars: B[], binMs: number, offUtcMs: number): { end: number; c: number }[] {
  const out: { key: number; c: number }[] = [];
  for (const b of bars) { const key = Math.floor((b.t - offUtcMs) / binMs); const L = out[out.length - 1]; if (L && L.key === key) L.c = b.c; else out.push({ key, c: b.c }); }
  return out.map(({ key, c }) => ({ end: key * binMs + offUtcMs + binMs, c }));
}
function trendAt(bins: { end: number; c: number }[], t5: number): number | null {
  const e = ewm(bins.map((b) => b.c), 20); let v: number | null = null;
  for (let i = 0; i < bins.length; i++) if (bins[i]!.end <= t5) v = Math.sign(bins[i]!.c - e[i]!); else break;
  return v;
}

export interface BarFeat { sw_with: number | null; smt_with: number | null; fail3_with: number | null; mss5_with: number | null; tr1h_with: number | null; tr4h_with: number | null;
  pdpos_with: number | null; compress: number | null; rng30: number | null; since_disp: number | null; atrpct: number | null; atr5: number | null; why: Record<string, string>;
  /** decision row before 08:30 CT: research sw_with/pdpos_with used the whole overnight session (lookahead); desk values are closed-bar only → partial */
  preRthLevels: boolean }

/** own1m/other1m: closed 1m bars (any length, ≥ ~40 5m bars before t5 for exact values). own15m: closed 15m bars, ~1 month. */
export function barFeatures(i: { own1m: B[]; other1m: B[]; own15m: B[]; tMs: number; side: Side; own5m?: B[] }): BarFeat {
  const why: Record<string, string> = {};
  const t5 = Math.floor(i.tMs / M5) * M5;
  const ap = atrpctAt(i.own5m ?? [], i.own1m, t5);
  // 5m bars (label left) from own 1m, only buckets fully closed by t5 → buckets with start < t5; row t5 itself is the decision row
  const oth = new Map(i.other1m.map((b) => [b.t, b]));
  const b5: { t: number; o: number; h: number; l: number; c: number; oh: number; ol: number }[] = [];
  for (const b of i.own1m) {
    if (b.t >= t5) break;
    const k = Math.floor(b.t / M5) * M5; const o = oth.get(b.t); const L = b5[b5.length - 1];
    if (L && L.t === k) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; if (o) { L.oh = Number.isNaN(L.oh) ? o.h : Math.max(L.oh, o.h); L.ol = Number.isNaN(L.ol) ? o.l : Math.min(L.ol, o.l); } }
    else b5.push({ t: k, o: b.o, h: b.h, l: b.l, c: b.c, oh: o ? o.h : nan, ol: o ? o.l : nan });
  }
  const n = b5.length; // index n = the decision row (t5); H/L/C = bar n-1
  const out: BarFeat = { sw_with: null, smt_with: null, fail3_with: null, mss5_with: null, tr1h_with: null, tr4h_with: null, pdpos_with: null, compress: null, rng30: null, since_disp: null, atrpct: ap.v, atr5: null, why, preRthLevels: tod(t5) < 510 };
  if (ap.v == null) why.atrpct = ap.why;
  if (out.preRthLevels) why.sw_with = why.pdpos_with = "before 08:30 CT the research used the full overnight session (lookahead); desk uses closed bars only";
  const sd = i.side === "short" ? 1 : -1;
  // trends from 15m (hour close = last 15m close in the hour); keep bars closed by t5
  const b15 = i.own15m.filter((b) => b.t + 15 * 60_000 <= t5);
  if (b15.length) {
    const tr1 = trendAt(lastByBin(b15, HOUR, 0), t5);
    const tr4 = trendAt(lastByBin(b15, 4 * HOUR, 2 * HOUR), t5);
    out.tr1h_with = tr1 == null ? null : -tr1;                       // research: tr1h_with = −tr1h regardless of side
    out.tr4h_with = tr4 == null ? null : tr4 * (sd > 0 ? -1 : 1);
  } else { why.tr1h_with = why.tr4h_with = "no closed 15m bars"; }
  if (n < 16) { for (const k of ["sw_with", "smt_with", "fail3_with", "mss5_with", "pdpos_with", "compress", "rng30", "since_disp"]) why[k] = `only ${n} closed 5m bars before t5`; return out; }
  // ATR14 known at bar open: atr[j] = mean(tr[j-14..j-1]); tr[0] NaN
  const tr = b5.map((b, j) => (j === 0 ? nan : Math.max(b.h - b.l, Math.abs(b.h - b5[j - 1]!.c), Math.abs(b.l - b5[j - 1]!.c))));
  const atrAt = (j: number) => { if (j < 15) return nan; let s = 0; for (let k = j - 14; k < j; k++) s += tr[k]!; return s / 14; };
  const atr = atrAt(n); out.atr5 = Number.isFinite(atr) ? atr : null;
  const Hh = (j: number) => b5[j - 1]?.h ?? nan, Ll = (j: number) => b5[j - 1]?.l ?? nan, Cc = (j: number) => b5[j - 1]?.c ?? nan;
  const rmax = (f: (j: number) => number, j: number, w: number) => { let m = -Infinity; for (let k = j - w + 1; k <= j; k++) { const v = f(k); if (Number.isNaN(v)) return nan; m = Math.max(m, v); } return m; };
  const rmin = (f: (j: number) => number, j: number, w: number) => { let m = Infinity; for (let k = j - w + 1; k <= j; k++) { const v = f(k); if (Number.isNaN(v)) return nan; m = Math.min(m, v); } return m; };
  const hi30 = rmax(Hh, n, 6), lo30 = rmin(Ll, n, 6), C = Cc(n);
  // session levels on the decision row's session day (from 15m; 1m tail for the latest minutes not yet in a closed 15m bar)
  const sdN = sday(t5); const src = [...b15, ...i.own1m.filter((b) => b.t < t5 && b.t >= (b15.length ? b15[b15.length - 1]!.t + 15 * 60_000 : 0))];
  const lv = { pdh: nan, pdl: nan, onh: nan, onl: nan, ah: nan, al: nan, lh: nan, ll: nan };
  let prevRth = -1; const rthHi = new Map<number, number>(), rthLo = new Map<number, number>();
  for (const b of src) {
    const d = sday(b.t), m = tod(b.t);
    if (m >= 510 && m < 900) { rthHi.set(d, Math.max(rthHi.get(d) ?? -Infinity, b.h)); rthLo.set(d, Math.min(rthLo.get(d) ?? Infinity, b.l)); }
    if (d !== sdN) continue;
    const up = (k: "onh" | "ah" | "lh", v: number) => { lv[k] = Number.isNaN(lv[k]) ? v : Math.max(lv[k], v); };
    const dn = (k: "onl" | "al" | "ll", v: number) => { lv[k] = Number.isNaN(lv[k]) ? v : Math.min(lv[k], v); };
    if (m >= 1020 || m < 510) { up("onh", b.h); dn("onl", b.l); }
    if (m >= 1140) { up("ah", b.h); dn("al", b.l); }
    if (m >= 60 && m < 240) { up("lh", b.h); dn("ll", b.l); }
  }
  for (const d of rthHi.keys()) if (d < sdN && d > prevRth) prevRth = d;
  if (prevRth >= 0) { lv.pdh = rthHi.get(prevRth)!; lv.pdl = rthLo.get(prevRth)!; } else why.pd_levels = "no prior RTH session in the 15m history";
  const swH = [[lv.pdh], [lv.onh], [lv.ah], [lv.lh]].some(([u]) => hi30 > u! && C < u!);
  const swL = [[lv.pdl], [lv.onl], [lv.al], [lv.ll]].some(([d]) => lo30 < d! && C > d!);
  // equal highs/lows: 5m pivots in the prior 2h, swept in the last 30 min (the research loop, replayed over the available bars)
  let lastH: [number, number][] = [], lastL: [number, number][] = []; let eqh = false, eql = false;
  for (let j = 0; j <= n; j++) {
    const ph = Hh(j - 1) > Hh(j - 2) && Hh(j - 1) > Hh(j), pl = Ll(j - 1) < Ll(j - 2) && Ll(j - 1) < Ll(j);
    if (ph) lastH = [...lastH, [j, Hh(j - 1)] as [number, number]].slice(-6);
    if (pl) lastL = [...lastL, [j, Ll(j - 1)] as [number, number]].slice(-6);
    if (j < n) continue;
    const a = atrAt(j); if (!(a > 0)) break;
    const hs = lastH.filter(([k]) => j - k > 6 && j - k <= 30).map(([, p]) => p), ls = lastL.filter(([k]) => j - k > 6 && j - k <= 30).map(([, p]) => p);
    for (let x = 0; x < hs.length; x++) for (let y = x + 1; y < hs.length; y++) { const mx = Math.max(hs[x]!, hs[y]!); if (Math.abs(hs[x]! - hs[y]!) <= 0.15 * a && hi30 > mx && C < mx) eqh = true; }
    for (let x = 0; x < ls.length; x++) for (let y = x + 1; y < ls.length; y++) { const mn = Math.min(ls[x]!, ls[y]!); if (Math.abs(ls[x]! - ls[y]!) <= 0.15 * a && lo30 < mn && C > mn) eql = true; }
  }
  if (n < 40) why.sw_with = `eq-pivot history short (${n} 5m bars)`;
  out.sw_with = (sd > 0 ? swH || eqh : swL || eql) ? 1 : 0;
  // SMT
  const OH = (j: number) => b5[j - 1]?.oh ?? nan, OL = (j: number) => b5[j - 1]?.ol ?? nan;
  const gt = (a: number, b: number) => a > b, lt = (a: number, b: number) => a < b;
  const newH = gt(rmax(Hh, n, 3), rmax(Hh, n - 3, 9)), onewH = gt(rmax(OH, n, 3), rmax(OH, n - 3, 9));
  const newL = lt(rmin(Ll, n, 3), rmin(Ll, n - 3, 9)), onewL = lt(rmin(OL, n, 3), rmin(OL, n - 3, 9));
  out.smt_with = sd > 0 ? (newH !== onewH ? 1 : 0) : (newL !== onewL ? 1 : 0);
  if (!Number.isFinite(atr)) { why.rng30 = "5m ATR14 not ready"; return out; }
  out.compress = (hi30 - lo30) / (atr * 6) < 0.45 ? 1 : 0;
  out.rng30 = (hi30 - lo30) / atr;
  let cH = 0, cL = 0; for (let k = 0; k < 6; k++) { if (Hh(n - k) >= hi30 - 0.2 * atr) cH++; if (Ll(n - k) <= lo30 + 0.2 * atr) cL++; }
  out.fail3_with = (sd > 0 ? cH : cL) >= 3 ? 1 : 0;
  out.mss5_with = sd > 0 ? (C < rmin(Ll, n - 1, 3) ? 1 : 0) : (C > rmax(Hh, n - 1, 3) ? 1 : 0);
  const top = Math.max(lv.pdh, lv.onh), bot = Math.min(lv.pdl, lv.onl);
  const pdpos = Math.max(-0.5, Math.min(1.5, (C - bot) / (top - bot)));
  out.pdpos_with = Number.isFinite(pdpos) ? (sd > 0 ? pdpos : 1 - pdpos) : null;
  if (out.pdpos_with == null) why.pdpos_with = "PDH/PDL or overnight level missing";
  // since last |body| >= 1.5 ATR (strictly before the decision row), clip 200; censored when none in the available history
  let last = -1; for (let j = 0; j < n; j++) { const a = atrAt(j); if (a > 0 && Math.abs(b5[j]!.c - b5[j]!.o) / a >= 1.5) last = j; }
  if (last >= 0) out.since_disp = Math.min(200, n - last); else why.since_disp = `no strong 5m bar in the ${n} available (censored → missing)`;
  if (n - 15 < 200 && last < 0) out.since_disp = null;
  return out;
}

/**
 * atrpct (feat.py / features-ref.ts exact): ATR14 of 24h 5m bars known at the row's open (mean TR of the 14 previous bars), percentile rank
 * (pandas rank(pct=True), ties averaged) of the decision row's ATR within the last 5760 rows; null when fewer than 500 valid ATRs.
 * 5m series = the desk's 1mo 5m feed (closed bars) with every COMPLETE 5m bucket rebuilt from closed 1m bars overriding it; rows < t5 only.
 * With < 5760 rows (Yahoo 1mo 5m ≈ 20 sessions) the rank uses every available row (≥ 500), which is exactly what the reference does in its own
 * warmup (rolling(5760, min_periods=500)); exact parity needs a full 5760-row window and is reported in `why`.
 */
export function atrpctAt(own5m: B[], own1m: B[], t5: number): { v: number | null; rows: number; why: string } {
  const m = new Map<number, B>();
  for (const b of own5m) if (b.t + M5 <= t5) m.set(b.t, { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c });
  const g = new Map<number, B & { n: number; first: number }>();
  for (const b of own1m) { if (b.t >= t5) break; const k = Math.floor(b.t / M5) * M5; const L = g.get(k);
    if (L) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; L.n++; } else g.set(k, { t: k, o: b.o, h: b.h, l: b.l, c: b.c, n: 1, first: b.t }); }
  for (const [k, b] of g) if (b.first === k && (b.n === 5 || k + M5 <= t5)) m.set(k, { t: k, o: b.o, h: b.h, l: b.l, c: b.c });
  const b5 = [...m.values()].sort((a, b) => a.t - b.t); const n = b5.length;   // row n = the decision row t5
  if (n < 515) return { v: null, rows: n, why: `only ${n} 5m rows before t5 (reference needs ≥ 500 valid ATRs; feed 1mo 5m + closed 1m)` };
  const tr: number[] = b5.map((b, j) => (j === 0 ? NaN : Math.max(b.h - b.l, Math.abs(b.h - b5[j - 1]!.c), Math.abs(b.l - b5[j - 1]!.c))));
  const atr = (j: number) => { if (j < 15) return NaN; let s = 0; for (let k = j - 14; k < j; k++) s += tr[k]!; return s / 14; };
  const a = atr(n); if (!Number.isFinite(a)) return { v: null, rows: n, why: "ATR not available" };
  let cnt = 0, lt = 0, eq = 0;
  for (let k = Math.max(0, n - 5759); k <= n; k++) { const v = atr(k); if (!Number.isFinite(v)) continue; cnt++; if (v < a) lt++; else if (v === a) eq++; }
  if (cnt < 500) return { v: null, rows: n, why: `${cnt} valid 5m ATRs < 500` };
  return { v: (lt + (eq + 1) / 2) / cnt, rows: n, why: cnt >= 5760 ? "full 5760-row window" : `warmup window ${cnt} rows (< 5760; reference min_periods 500)` };
}

/** pandas ewm(span, adjust=False).mean() (eng.py b1/b4) */
function ewmF(x: number[], span: number): number[] { const a = 2 / (span + 1); let e = NaN; return x.map((v, k) => (e = k === 0 ? v : a * v + (1 - a) * e)); }
const cdate = (ms: number) => Math.floor(wall(ms) / 86_400_000);          // CT calendar date (eng.py groups days by T.date)

export interface CandFeat { a5: number | null; risk_atr: number | null; b1: number | null; b4: number | null; pd: number | null; smt: boolean | null; chaseR: number | null; tmin: number; why: Record<string, string> }
/**
 * Research-exact candidate-level features (week1016-review eng.py + score.py), closed bars only, decided at the close of the 1m bar labelled tMs.
 * b1/b4: sign(close − EMA20 adjust=False) of the last 1h / 4h bin (4h bins 02/06/10/14/18/22 UTC) closed by tMs+1m, × side.
 * pd: C = close of bar tMs; DR = min/max(prior calendar-day RTH 08:30–15:00, ON = prior day ≥15:15 + today <08:00); short pdpos, long 1−pdpos (unclipped).
 * smt: per book, window [raid−5, decision] (≤40 bars) makes a new extreme vs the 60 bars before raid−5; smt = ES XOR NQ.
 * chaseR: |next open (≈ price) − newest near edge| / |price − stop| (the MARKET anchor's risk, not riskEdge).
 */
export function candFeatures(i: { own1m: B[]; other1m: B[]; own15m: B[]; tMs: number; side: Side; tRaidMs: number | null; price: number | null; edge: number | null; stop: number | null }): CandFeat {
  const why: Record<string, string> = {}; const sg = i.side === "long" ? 1 : -1;
  const decEnd = i.tMs + 60_000;
  const b15 = i.own15m.filter((b) => b.t + 15 * 60_000 <= decEnd);
  const tail = i.own1m.filter((b) => b.t <= i.tMs && b.t >= (b15.length ? b15[b15.length - 1]!.t + 15 * 60_000 : -Infinity));
  const src = [...b15.map((b) => ({ ...b, end: b.t + 15 * 60_000 })), ...tail.map((b) => ({ ...b, end: b.t + 60_000 }))];
  const bias = (binMs: number, off: number) => {
    const bins: { end: number; c: number }[] = [];
    for (const b of src) { const key = Math.floor((b.t - off) / binMs); const end = key * binMs + off + binMs; const L = bins[bins.length - 1]; if (L && L.end === end) L.c = b.c; else bins.push({ end, c: b.c }); }
    const done = bins.filter((b) => b.end <= decEnd); if (done.length < 20) return null;
    const e = ewmF(done.map((b) => b.c), 20); const k = done.length - 1; return Math.sign(done[k]!.c - e[k]!) * sg;
  };
  const b1 = bias(HOUR, 0), b4 = bias(4 * HOUR, 2 * HOUR);
  if (b1 == null) why.b1 = "fewer than 20 closed 1h bins"; if (b4 == null) why.b4 = "fewer than 20 closed 4h bins";
  // pd
  let pd: number | null = null; const cb = i.own1m.find((b) => b.t === i.tMs);
  if (cb) {
    const today = cdate(i.tMs); const days = [...new Set(src.map((b) => cdate(b.t)))].filter((d) => d < today).sort((a, b) => a - b);
    const prev = days[days.length - 1]; const rthDays = days.filter((d) => src.some((b) => cdate(b.t) === d && tod(b.t) >= 510 && tod(b.t) < 900));
    const rd = rthDays[rthDays.length - 1];
    if (prev != null && rd != null) {
      const prth = src.filter((b) => cdate(b.t) === rd && tod(b.t) >= 510 && tod(b.t) < 900);
      const on = src.filter((b) => (cdate(b.t) === prev && tod(b.t) >= 915) || (cdate(b.t) === today && tod(b.t) < 480 && b.end <= decEnd));
      if (on.length) {
        const hi = Math.max(...prth.map((b) => b.h), ...on.map((b) => b.h)), lo = Math.min(...prth.map((b) => b.l), ...on.map((b) => b.l));
        const pp = (cb.c - lo) / Math.max(hi - lo, 1e-9); pd = sg < 0 ? pp : 1 - pp;
        if (rd !== prev) why.pd = "prior calendar day had no RTH (research skips such days: Monday/holiday); PD from the last RTH day";
      } else why.pd = "no overnight bars";
    } else why.pd = "no prior day in history";
  } else why.pd = "decision bar missing";
  // smt
  let smt: boolean | null = null;
  if (i.tRaidMs != null) {
    const made = (x: B[]) => {
      const ts = x.map((b) => b.t); const ss = (t: number) => { let lo = 0, hi = ts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m]! < t) lo = m + 1; else hi = m; } return lo; };
      const a = ss(i.tRaidMs!) - 5, b = ss(i.tMs); if (a < 60 || b >= x.length) return null;
      const L = Math.max(1, Math.min(40, b - a + 1)); const w = x.slice(b - L + 1, b + 1), p = x.slice(a - 60, a);
      return sg < 0 ? Math.max(...w.map((q) => q.h)) > Math.max(...p.map((q) => q.h)) : Math.min(...w.map((q) => q.l)) < Math.min(...p.map((q) => q.l));
    };
    const m1 = made(i.own1m), m2 = made(i.other1m);
    if (m1 != null && m2 != null) smt = m1 !== m2; else why.smt = "fewer than 65 1m bars before the raid on a book";
  } else why.smt = "no raid time";
  // a5 (eng.py): ATR14 (rolling mean, min_periods 1, TR vs previous close; first bar uses its own close) of 5m bars (label left) whose END <= decision close
  let a5: number | null = null;
  { const b5: B[] = [];
    for (const b of i.own1m) { if (b.t > i.tMs) break; const k = Math.floor(b.t / M5) * M5; const L = b5[b5.length - 1];
      if (L && L.t === k) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; } else b5.push({ t: k, o: b.o, h: b.h, l: b.l, c: b.c }); }
    const done = b5.filter((b) => b.t + M5 <= decEnd);
    if (done.length >= 15) { const tr = done.map((b, j) => { const pc = j === 0 ? b.c : done[j - 1]!.c; return Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)); });
      a5 = tr.slice(-14).reduce((x, y) => x + y, 0) / 14; } else why.a5 = `only ${done.length} closed 5m bars`; }
  const risk_atr = a5 && i.edge != null && i.stop != null ? Math.abs(i.edge - i.stop) / a5 : null;
  let chaseR: number | null = null;
  if (i.price != null && i.edge != null && i.stop != null) { const r = Math.abs(i.price - i.stop); if (r > 0) chaseR = Math.abs(i.price - i.edge) / r; }
  return { a5, risk_atr, b1, b4, pd, smt, chaseR, tmin: tod(i.tMs), why };
}
