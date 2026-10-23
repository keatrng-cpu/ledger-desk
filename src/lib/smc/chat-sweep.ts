/**
 * Chat sweep (Keaton 2026-10-22 21:56 CT, "Make the desk trade like chat"; shared rules `chatSweep`).
 *
 * Twin of the desk-watcher's watcher/chat_sweep.py and of the reference live-tape armed_s.py (setup) /
 * armed_r.py (last-6-bar stop). Both sides are scored on every read; a side arms only when it prints:
 *
 *   1. the session high/low — set by closed 1m bars BEFORE the last `sweepBars` (3) — is wick-swept by one of
 *      the last 3 closed 1m bars;
 *   2. the newest closed 1m bar closes back inside that level AND beyond the prior `priorBars` (2) bars' extreme,
 *      in the reversal colour, with body >= dispBodyAvg (0.8) x the avg range of the `avgRangeBars` before it;
 *   3. the partner book's newest closed 1m bar is the same colour; the newest closed 5m bar is not against.
 *
 * Stop = the sweep wick or the last-6-bar extreme (whichever is further) +/- stopPadPts, refused when more than
 * maxStopPts from entry. Min 2 contracts; half off at T1; stop to break-even at T1 or beTriggerPts in favour.
 * Every timeframe is cut at the same nowMs, closed bars only: no forming bar, no lookahead.
 */
import RULES from "../../../shared/desk-rules.json";

export interface CsBar { t: number; o: number; h: number; l: number; c: number }
export type CsSide = "long" | "short";
export interface ChatSweepRules {
  mode: "live" | "shadow"; sessionStartEt: string; entryEndEt: string; sweepBars: number; priorBars: number; minBars: number;
  avgRangeBars: number; dispBodyAvg: number; fiveMinTolPts: number; stopPadPts: number; stopExtremeBars: number; maxStopPts: number;
  t1Pts: number; runnerPts: number; beTriggerPts: number; minContracts: number; t1Frac: number; etfSymbols: string[]; unitRefPx: number;
}
export const CHAT_SWEEP = (RULES as unknown as { chatSweep: ChatSweepRules }).chatSweep;
export const chatSweepLive = (): boolean => CHAT_SWEEP.mode === "live";

export interface ChatSweepPrint {
  side: CsSide; printed: true; t: number; level: number; wick: number; entry: number; stop: number; stopWhy: string;
  risk: number; t1: number; runner: number; beTrigger: number; minContracts: number; unit: number; why: string;
}
export interface ChatSweepRead {
  long: ChatSweepPrint | null; short: ChatSweepPrint | null; refused: { side: CsSide; why: string }[];
  barT: number | null; sessionHigh: number | null; sessionLow: number | null; inWindow: boolean;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
/** QQQ/SPY points as-is; other symbols scale by px / unitRefPx (NQ ~ 41x QQQ, ES ~ 10x SPY). */
export function chatUnit(symbol: string, px: number, R: ChatSweepRules = CHAT_SWEEP): number {
  return R.etfSymbols.includes(symbol.toUpperCase()) ? 1 : px / R.unitRefPx;
}
function etMinutes(ms: number): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  return Number(p.find((x) => x.type === "hour")!.value) * 60 + Number(p.find((x) => x.type === "minute")!.value);
}
const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
function etDay(ms: number): string { return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }

/** Closed 5m buckets (epoch-floored, same as armed_d.bars5) from closed 1m bars; a bucket counts once its span elapsed. */
export function closed5m(b1: CsBar[], nowMs: number): CsBar[] {
  const m = new Map<number, CsBar>();
  for (const b of b1) {
    if (b.t + 60_000 > nowMs) continue;
    const k = Math.floor(b.t / 300_000) * 300_000; const d = m.get(k);
    if (!d) m.set(k, { t: k, o: b.o, h: b.h, l: b.l, c: b.c }); else { d.h = Math.max(d.h, b.h); d.l = Math.min(d.l, b.l); d.c = b.c; }
  }
  return [...m.values()].sort((a, b) => a.t - b.t).filter((x) => x.t + 300_000 <= nowMs);
}

/** One read of both sides on the newest closed 1m bar. `minute`/`partner` are 1m bars (ms epoch, any order). */
export function chatSweepRead(i: { symbol: string; minute: CsBar[]; partner: CsBar[]; nowMs: number; rules?: ChatSweepRules }): ChatSweepRead {
  const R = i.rules ?? CHAT_SWEEP;
  const out: ChatSweepRead = { long: null, short: null, refused: [], barT: null, sessionHigh: null, sessionLow: null, inWindow: false };
  const closed = (xs: CsBar[]) => xs.filter((b) => b.t + 60_000 <= i.nowMs).sort((a, b) => a.t - b.t);
  const all = closed(i.minute);
  if (!all.length) return out;
  const day = etDay(i.nowMs); const s0 = hm(R.sessionStartEt);
  const inSess = (b: CsBar) => etDay(b.t) === day && etMinutes(b.t) >= s0;
  const q1 = all.filter(inSess);
  const p1 = closed(i.partner).filter(inSess);
  const q5 = closed5m(i.minute, i.nowMs).filter(inSess);
  const nowMin = etMinutes(i.nowMs);
  out.inWindow = etDay(i.nowMs) === day && nowMin >= s0 && nowMin < hm(R.entryEndEt);
  if (q1.length < R.minBars || !p1.length || !q5.length) return out;
  const b = q1[q1.length - 1]; out.barT = b.t;
  // all timeframes read together: the partner bar and the 5m bar must be the ones closed at the same cut
  const pb = p1[p1.length - 1]; const p5 = q5[q5.length - 1];
  if (pb.t !== b.t) { out.refused.push({ side: "long", why: "partner 1m bar not aligned" }, { side: "short", why: "partner 1m bar not aligned" }); return out; }
  const idx = all.indexOf(b);
  const prevR = all.slice(Math.max(0, idx - R.avgRangeBars), idx);
  if (!prevR.length) return out;
  const ar = prevR.reduce((s, x) => s + (x.h - x.l), 0) / prevR.length;
  const prior = q1.slice(0, -R.sweepBars); const rec = q1.slice(-R.sweepBars);
  const shi = Math.max(...prior.map((x) => x.h)); const slo = Math.min(...prior.map((x) => x.l));
  out.sessionHigh = shi; out.sessionLow = slo;
  const whi = Math.max(...rec.map((x) => x.h)); const wlo = Math.min(...rec.map((x) => x.l));
  const pr = q1.slice(-1 - R.priorBars, -1);
  const lo2 = Math.min(...pr.map((x) => x.l)); const hi2 = Math.max(...pr.map((x) => x.h));
  const ext = q1.slice(-R.stopExtremeBars);
  const u = chatUnit(i.symbol, b.c, R);
  const pc = pb.c - pb.o; const body = Math.abs(b.c - b.o); const tol = R.fiveMinTolPts * u;
  const mk = (side: CsSide, level: number, wick: number): ChatSweepPrint | null => {
    const L = side === "long"; const pad = R.stopPadPts * u;
    const extreme = L ? Math.min(...ext.map((x) => x.l)) : Math.max(...ext.map((x) => x.h));
    const base = L ? Math.min(wick, extreme) : Math.max(wick, extreme);
    const stop = r2(L ? base - pad : base + pad); const entry = b.c; const risk = r2(Math.abs(entry - stop));
    if (risk > R.maxStopPts * u + 1e-9) { out.refused.push({ side, why: `stop ${stop} is ${risk} from ${entry} (max ${r2(R.maxStopPts * u)})` }); return null; }
    if (!out.inWindow) { out.refused.push({ side, why: `outside ${R.sessionStartEt}-${R.entryEndEt} ET` }); return null; }
    const d = L ? 1 : -1;
    return { side, printed: true, t: b.t, level, wick, entry, stop, risk,
      stopWhy: `${base === wick ? "sweep wick" : `last-${R.stopExtremeBars}-bar extreme`} ${base} ${L ? "-" : "+"}${r2(pad)}`,
      t1: r2(entry + d * R.t1Pts * u), runner: r2(entry + d * R.runnerPts * u), beTrigger: r2(R.beTriggerPts * u), minContracts: R.minContracts, unit: u,
      why: `swept ${L ? "low" : "high"} ${level} to ${wick}, 1m close ${entry} ${L ? ">" : "<"} prior-${R.priorBars} ${L ? hi2 : lo2}, body ${r2(body)} >= ${R.dispBodyAvg}x avg ${r2(ar)}, partner ${L ? "green" : "red"}, 5m not against` };
  };
  const dispOk = body >= R.dispBodyAvg * ar;
  if (whi > shi && b.c < shi && b.c < b.o && b.c < lo2 && dispOk && pc < 0 && p5.c <= p5.o + tol) out.short = mk("short", shi, whi);
  if (wlo < slo && b.c > slo && b.c > b.o && b.c > hi2 && dispOk && pc > 0 && p5.c >= p5.o - tol) out.long = mk("long", slo, wlo);
  return out;
}

/** Contracts check: the setup needs at least minContracts (2) affordable, else it does not fire. */
/** minContracts is ONE config value (chatSweep.minContracts); Keaton deciding min 2 vs B+ 1ct = a one-line change. */
export const chatSweepMinContracts = (R: ChatSweepRules = CHAT_SWEEP): number => R.minContracts;
export function chatSweepSize(affordable: number, R: ChatSweepRules = CHAT_SWEEP): { ok: boolean; qty: number; why: string } {
  return affordable >= R.minContracts ? { ok: true, qty: affordable, why: `${affordable}ct (min ${R.minContracts})` } : { ok: false, qty: 0, why: `${affordable}ct affordable < min ${R.minContracts} — no fire` };
}

/** Management twin (watcher chat_sweep.manage): at T1 trim floor(qty x t1Frac) only when qty >= 2 (never 0); the
 *  break-even stop is requested only after the trim fill is confirmed (or at once with < 2 contracts, or at +beTrigger). */
export function chatSweepManage(p: { side: CsSide; entry: number; t1: number; beTrigger: number; px: number; qty: number; t1Done: boolean; beRequested: boolean }, R: ChatSweepRules = CHAT_SWEEP):
  { action: "trim" | "hold"; qty: number; requestBe: boolean; beAfterFill: boolean; why: string } {
  const L = p.side === "long"; const fav = L ? p.px - p.entry : p.entry - p.px;
  const atT1 = L ? p.px >= p.t1 : p.px <= p.t1;
  if (atT1 && !p.t1Done) {
    const n = p.qty >= 2 ? Math.floor(p.qty * R.t1Frac) : 0;
    if (n >= 1) return { action: "trim", qty: n, requestBe: false, beAfterFill: true, why: `T1 ${p.t1}: sell ${n} of ${p.qty}; break-even after the fill` };
    return { action: "hold", qty: 0, requestBe: true, beAfterFill: false, why: `T1 ${p.t1} with ${p.qty} contract: no trim, break-even stop` };
  }
  if (!p.beRequested && fav + 1e-9 >= p.beTrigger) return { action: "hold", qty: 0, requestBe: true, beAfterFill: false, why: `+${r2(fav)} >= ${p.beTrigger}: break-even stop` };
  return { action: "hold", qty: 0, requestBe: false, beAfterFill: false, why: "hold" };
}

/** Brain/Floor seat line (same words both places). */
export function chatSweepSeat(r: ChatSweepRead | null | undefined, side: CsSide | null): string | null {
  if (!r || !side) return null;
  const p = r[side];
  if (p) return `Chat sweep ${side.toUpperCase()} printed: ${p.why}. Stop ${p.stop} (${p.stopWhy}), T1 ${p.t1}, min ${p.minContracts}ct, half at T1, BE at T1/+${p.beTrigger}.`;
  const ref = r.refused.find((x) => x.side === side);
  return `Chat sweep ${side} not printed${ref ? ` (${ref.why})` : ""} — arms only when it prints.`;
}
