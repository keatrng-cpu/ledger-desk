/**
 * FAST-SETUPS-ONLY fire chain (shared rules `fastChain`; Python twin watcher/fastchain.py; parity in scripts/fast-chain.test.mjs).
 * The watcher fires from it; the desk uses the same pure checks so the Floor / Watcher tab say the same thing.
 */
import RULES from "../../../shared/desk-rules.json";
import { ifvgAgainst, type WireArray } from "../smc/ifvg-flip";

export const FC = RULES.fastChain;
const BANDS = ["C", "B", "B+", "A-", "A", "A+"];
const rank = (b: string | null | undefined) => BANDS.indexOf(String(b ?? ""));
export interface FastSnap {
  band?: string | null; symbol?: string | null; side?: string | null; entry?: number | null; stop_px?: number | null; first_target?: number | null;
  px?: number | null; atr?: number | null; brain_symbol?: string | null; brain_side?: string | null; bias1h?: string | null; bias4h?: string | null; expMin?: number | null;
  t2?: number | null; desk_ticket_side?: string | null; desk_ticket_underlier?: string | null;
  // unblock-2 10/15: grade smoothing + HTF reversal inputs
  q?: number | null; sweep?: boolean | null; displacement?: boolean | null; choch?: boolean | null; bandHist?: [string | null, number | null, string | null][];
  /** wire.arrays rows of THIS card's symbol (fast:ifvg). */
  arrays?: WireArray[] | null;
  /** post-mortem 13:02: brain word (TAKE/WAIT/STAND) and minutes since 00:00 ET (default: now). */
  brain_word?: string | null; etMin?: number | null;
}
const GS = FC.gradeSmoothing; const HR = FC.htfReversal;
const QP = (FC as unknown as { qPenalty: { htf: { mode: string; q: number; requireOneOf: string[] }; pmBplus: { mode: string; q: number; fromEt: string } } }).qPenalty;
const EDGE_LIST: [string, number][] = (["A+", "A", "A-", "B+", "B"] as const).map((b) => [b, (RULES.bandEdges as Record<string, number>)[b]]);
export const bandOfQ = (q: number) => EDGE_LIST.find(([, e]) => q >= e - 1e-9)?.[0] ?? "C";
const nOppOf = (s: FastSnap) => { const want = s.side === "long" ? "bull" : "bear"; return [s.bias1h, s.bias4h].filter((b) => b != null && b !== want).length; };
const etMinNow = () => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()); return +p.find((x) => x.type === "hour")!.value * 60 + +p.find((x) => x.type === "minute")!.value; };
/** post-mortem 13:02 soft q penalties (twin of watcher fastchain.q_penalty): [sum, notes]. */
export function qPenalty(s: FastSnap): [number, string[]] {
  let pen = 0; const why: string[] = [];
  if (QP.htf.mode === "live" && nOppOf(s) >= 1) { pen += QP.htf.q; why.push(`1h/4h opposes -${QP.htf.q}`); }
  const [h, m] = QP.pmBplus.fromEt.split(":").map(Number);
  if (QP.pmBplus.mode === "live" && s.band === "B+" && (s.etMin ?? etMinNow()) >= h! * 60 + m!) { pen += QP.pmBplus.q; why.push(`after ${QP.pmBplus.fromEt} ET -${QP.pmBplus.q}`); }
  if (isStand(s)) { pen += STAND_Q; why.push(`brain STAND -${STAND_Q}`); }
  return [+pen.toFixed(4), why];
}
/**
 * 10/15 PM (Keaton: 4-5 correct reads did not fire): brain STAND is a q WEIGHT (-STAND_Q), not a veto. It still blocks
 * (fast:agree) when it combines with the iFVG flip against the card's side (read-priority flip, 1m close-through or 5m/15m
 * inversion). Code constants, no desk-rules.json key: rulesHash unchanged (c40b5555966491f3).
 */
export const STAND_Q = 0.03;
export const isStand = (s: FastSnap) => String(s.brain_word ?? "").toUpperCase() === "STAND";
/** Band after the q penalties: never above the card's band; edges unchanged. */
export function penalizedBand(s: FastSnap): string | null | undefined {
  const [pen] = qPenalty(s); if (!pen || s.q == null) return s.band;
  const nb = bandOfQ(s.q - pen); return rank(nb) < rank(s.band) ? nb : s.band;
}
/** htf requireOneOf: sweep | displacement | brain TAKE. */
export const htfEvidence = (s: FastSnap) => QP.htf.requireOneOf.some((k) => (k === "sweep" && s.sweep === true) || (k === "displacement" && s.displacement === true) || (k === "brainTake" && String(s.brain_word ?? "").toUpperCase() === "TAKE"));
const B_EDGE = RULES.bandEdges["B+"];
/** gradeSmoothing (twin of watcher fastchain.smoothed_band): >= minBand on minOf of the last `polls` polls, or q within edgeEps of the B+ edge and rising. Edges never lowered. */
export function smoothedBand(s: FastSnap): boolean {
  if (GS.mode !== "live") return false;
  const h = (s.bandHist ?? []).slice(-GS.polls);
  const good = h.filter(([, , b]) => rank(b) >= rank(FC.minBand)).length;
  if (h.length >= GS.minOf && good >= GS.minOf) return true;
  const qs = h.slice(0, -1).map(([, q]) => q).filter((q): q is number => q != null);
  return s.q != null && qs.length > 0 && s.q >= B_EDGE - GS.edgeEps - 1e-9 && s.q < B_EDGE && s.q > qs[qs.length - 1];
}
/** Last `polls` [at, q, band] for this symbol:side (twin of hist_next): a re-read (same at) is not a new poll; a side change resets. */
export function histNext(prev: Record<string, [string | null, number | null, string | null][]> | null | undefined, s: FastSnap & { at?: string | null }) {
  const k = `${s.symbol}:${s.side}`; const out: Record<string, [string | null, number | null, string | null][]> = {};
  for (const [kk, v] of Object.entries(prev ?? {})) if (kk.split(":")[0] !== String(s.symbol) || kk === k) out[kk] = [...v];
  let h = out[k] ?? [];
  const at = s.at ?? null;
  if (!(h.length && h[h.length - 1][0] != null && h[h.length - 1][0] === at)) h = [...h, [at, s.q ?? null, s.band ?? null] as [string | null, number | null, string | null]].slice(-GS.polls);
  out[k] = h; return out;
}
/** htfReversal: 1h+4h both oppose is allowed (at sizeMult) only with sweep AND (displacement OR CHoCH) and band >= minBand. */
export const ltfReversal = (s: FastSnap, bandOk: boolean) => HR.mode === "live" && s.sweep === true && (s.displacement === true || s.choch === true) && bandOk;
/** Half size on an htfReversal pass (whole contracts, >= 1, never above n). */
export function htfSize(n: number | null, s: FastSnap, minContracts = 1): number | null {
  if (n == null) return n;
  const want = s.side === "long" ? "bull" : "bear";
  const nOpp = [s.bias1h, s.bias4h].filter((b) => b != null && b !== want).length;
  const both = HR.anyOppose ? nOpp >= 1 : s.bias1h != null && s.bias4h != null && nOpp === 2;
  if (!both || !ltfReversal(s, rank(s.band) >= rank(HR.minBand) || smoothedBand(s))) return n;
  return Math.min(n, Math.max(Math.max(1, minContracts), Math.floor(n * HR.sizeMult)));
}
// Re-fire after a stop / T1 touch: #22 marks the setup spent for the session (Accuracy 10/15); no separate guard here.
/** [name, ok] in the watcher's order (persistence needs the clock and is checked by the watcher). */
export function fastSetupRows(s: FastSnap): [string, boolean][] {
  const r: [string, boolean][] = [];
  const pb = penalizedBand(s);
  const bandOk = (rank(pb) >= rank(FC.minBand) && rank(pb) >= 0) || (pb === s.band && smoothedBand(s));   // a q-penalised card is never smoothed back up
  r.push(["band", bandOk]);
  const { entry: e, stop_px: st, first_target: t1, side } = s;
  const sides = e != null && st != null && t1 != null && ((side === "long" && st < e && e < t1) || (side === "short" && t1 < e && e < st));
  const rr = sides ? Math.abs(t1! - e!) / Math.abs(e! - st!) : null;
  r.push(["fast:plan", Boolean(sides && rr! >= FC.rrMin)]);
  const okE = s.px != null && e != null && !!s.atr && Math.abs(s.px - e) <= FC.entryAtr * s.atr && (st == null || (side === "short" ? s.px < st : s.px > st));
  r.push(["fast:entry", Boolean(okE)]);
  const opposite = s.brain_symbol === s.symbol && (s.brain_side === "long" || s.brain_side === "short") && s.brain_side !== side;
  const want = side === "long" ? "bull" : "bear";
  // unblock-2 + live lesson 10/15 13:02 CT: any 1h/4h opposition needs a confirmed LTF reversal (never q alone) -> half size; else block.
  const nOpp = [s.bias1h, s.bias4h].filter((b) => b != null && b !== want).length;
  const against = QP.htf.mode === "live" ? nOpp >= 1 && !htfEvidence(s)
    : (HR.anyOppose ? nOpp >= 1 : s.bias1h != null && s.bias4h != null && nOpp === 2) && !ltfReversal(s, bandOk);
  const flipAgainst = ifvgAgainst(s.arrays ?? [], side === "short" ? "short" : "long", s.px, undefined, null)[0];
  // STAND (incl. a STAND brain leaning the other way) only weighs q; STAND + iFVG flip against this side = veto.
  const standVeto = isStand(s) && flipAgainst;
  r.push(["fast:agree", (isStand(s) ? !standVeto : !opposite) && !against]);
  r.push(["fast:ifvg", !ifvgAgainst(s.arrays ?? [], side === "short" ? "short" : "long", s.px, undefined, s.band ?? null)[0]]);
  // fast:geometry (twin of watcher geometry_row; Floor review 2026-10-13 19:28 ET): long stop<entry<T1 / short reversed.
  // fire-bugs-live 10/15: a T2 not beyond T1 is "no T2" (see effectiveT2), and a desk Floor ticket on another underlying or
  // the other direction is another setup, so neither refuses the card.
  const L = side === "long";
  const ord = (side === "long" || side === "short") && e != null && st != null && t1 != null && (L ? st < e && e < t1 : st > e && e > t1);
  r.push(["fast:geometry", Boolean(ord)]);
  // fire-bugs-live 10/15 (Keaton): velocity is a size cut (velocitySize), never a block.
  if (FC.velocity.mode === "size") r.push(["soft:fast:velocity", true]);
  else r.push(["fast:velocity", s.expMin != null && s.expMin <= FC.maxMinutesToT1]);
  return r;
}

/** Twin of watcher gates.DEFAULT_ATR (points; used when the card has no ATR). */
export const DEFAULT_ATR: Record<string, number> = { ES: 4.0, MNQ: 20.0 };
export const ETF: Record<string, string> = { ES: "SPY", MES: "SPY", NQ: "QQQ", MNQ: "QQQ" };
/** T2 only when it is beyond T1 on the card's side; a malformed T2 is treated as no T2 (fire-bugs-live 10/15). */
export function effectiveT2(s: FastSnap): number | null {
  const { first_target: t1, t2, side } = s;
  if (t2 == null || t1 == null) return t2 ?? null;
  return (side === "long" ? t2 > t1 : side === "short" ? t2 < t1 : false) ? t2 : null;
}
/** A desk Floor ticket counts for this card only when it is on the card's ETF and direction; otherwise it is ignored. */
export function deskTicketApplies(s: FastSnap): boolean {
  if (s.desk_ticket_side == null) return false;
  const und = ETF[String(s.symbol)];
  return s.desk_ticket_side === (s.side === "long" ? "call" : "put") && (s.desk_ticket_underlier == null || und == null || s.desk_ticket_underlier === und);
}

/** Price through the plan stop or T1 already touched (twin of watcher fastchain.invalidated). */
export function invalidated(s: FastSnap): boolean {
  const { px, stop_px: st, first_target: t1, side } = s;
  if (px == null || (side !== "long" && side !== "short")) return false;
  if (st != null && (side === "long" ? px <= st : px >= st)) return true;
  if (t1 != null && (side === "long" ? px >= t1 : px <= t1)) return true;
  return false;
}
/** fast:entry failed because price is more than entryAtr x ATR from entry (twin of watcher fastchain._chased). */
export function chased(s: FastSnap): boolean {
  const atr = s.atr && s.atr > 0 ? s.atr : DEFAULT_ATR[String(s.symbol)]; // default-ATR fallback, as the watcher
  return s.px != null && s.entry != null && !!atr && Math.abs(s.px - s.entry) > FC.entryAtr * atr;
}
/** Velocity size cut (twin of watcher fastchain.velocity_size): ETA > cap -> x cutMult; > minSizeBeyondCapX x cap or unknown -> minimum. */
export function velocitySize(n: number | null, expMin: number | null | undefined, minContracts = 1): number | null {
  if (n == null || FC.velocity.mode !== "size") return n;
  const cap = FC.maxMinutesToT1; const lo = Math.max(1, minContracts);
  if (expMin == null || expMin > FC.velocity.minSizeBeyondCapX * cap) return Math.min(n, lo);
  if (expMin > cap) return Math.min(n, Math.max(lo, Math.floor(n * FC.velocity.cutMult)));
  return n;
}
/** Debit-cap multiplier when the velocity cut applies (twin of watcher fastchain.velocity_debit_mult): cutMult, i.e. $650 -> $325. */
export function velocityDebitMult(): number {
  const m = Number(FC.velocity.cutMult); return m > 0 && m <= 1 ? m : 0.5;
}
/**
 * Velocity cut BEFORE sizing (twin of watcher fastchain.velocity_cap + gates.size_contracts; Accuracy CHANGES 10/15): the
 * contract ceiling min(maxContracts, wanted) is cut by velocity and the band $ cap (maxDebit) is cut by cutMult ($650 -> $325),
 * then that cut $ cap and the minDebit floor are enforced on the cut count (minimum 1 whole contract). Returns null when no count fits.
 */
export function velocitySizedContracts(ask: number | null | undefined, wanted: number | null | undefined, maxContracts: number, maxDebit: number,
  minDebit: number, expMin: number | null | undefined, minContracts = 1): number | null {
  if (ask == null || !(ask > 0) || maxContracts < minContracts) return null;
  const lo = Math.max(1, minContracts); const base = Math.max(lo, Math.min(maxContracts, Math.floor(wanted || 1)));
  const maxc = velocitySize(base, expMin, minContracts) ?? base;
  // The velocity cut also halves the band $ cap ($650 -> $325) before the $ cap and minDebit checks (twin of gates.size_contracts).
  const cutApplies = FC.velocity.mode === "size" && (expMin == null || expMin > FC.maxMinutesToT1);
  if (cutApplies) maxDebit = maxDebit * velocityDebitMult();
  const per = ask * 100;
  if (per > maxDebit + 1e-9) return null;
  let n = Math.max(minContracts, Math.min(maxc, Math.floor(wanted || 1)));
  while (n > minContracts && n * per > maxDebit + 1e-9) n--;
  if (n * per < minDebit - 1e-9) {
    while (n < maxc && n * per < minDebit) n++;
    if (n * per < minDebit - 1e-9 || n * per > maxDebit + 1e-9) return null;
  }
  return n;
}
export const setupId = (s: FastSnap) => `${s.symbol}:${s.side}:${s.entry ?? null}`;
export interface SetupConfirm { firstMs: number; polls: number; lastAt: string | null; outOfZone?: boolean; rearmed?: number }
export interface SpentSetup { why: string; day: string | null }
export interface FastStreak { key: string | null; firstMs: number | null; polls: number; lastAt: string | null; byId: Record<string, SetupConfirm>; lastId: string | null; spent?: Record<string, SpentSetup>; hist?: Record<string, [string | null, number | null, string | null][]> }
/** Session date (ET) for the spent set (twin of watcher fastchain.session_day). */
export const sessionDay = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
/** After a fire the setup id is spent for the session (twin of watcher fastchain.mark_spent). */
export function markSpent(st: FastStreak | null, sid: string, why = "fired", nowMs: number | null = null): FastStreak {
  const base: FastStreak = st ? { ...st } : { key: null, firstMs: null, polls: 0, lastAt: null, byId: {}, lastId: null };
  const spent = { ...(base.spent ?? {}) }; if (!spent[sid]) spent[sid] = { why, day: nowMs != null ? sessionDay(nowMs) : null };
  const byId = { ...base.byId }; delete byId[sid];
  const out: FastStreak = { ...base, spent, byId };
  if (out.key === sid) { out.key = null; out.firstMs = null; out.polls = 0; }
  if (out.lastId === sid) out.lastId = null;
  return out;
}
/**
 * fast:persist (twin of watcher fastchain.streak_next; fire-bugs-live 10/15, Keaton): no hold timer. Fires the first time the
 * setup is fully actionable once the SAME setup id (symbol:side:entry) passed confirmPolls consecutive real polls, and only
 * within maxActionableAgeS of first becoming actionable (older, never fired = stale). Resets on invalidation (through the
 * stop / T1 touched / strategy.invalidated) or a side change on the symbol. A re-read of the same card is not a new poll.
 * Entry re-arm: price > entryAtr x ATR from entry keeps the setup alive; back inside the zone restarts the clock + polls.
 */
export function streakNext(prev: FastStreak | null, s: FastSnap & { at?: string | null; strategy_invalidated?: boolean | null }, nowMs: number): FastStreak {
  const hist = histNext(prev?.hist, s); s = { ...s, bandHist: hist[`${s.symbol}:${s.side}`] };
  const sid = setupId(s); const at = s.at ?? null;
  const by: Record<string, SetupConfirm> = {};
  for (const [k, v] of Object.entries(prev?.byId ?? {})) {
    const [ks, kd] = k.split(":");
    if (ks === String(s.symbol) && kd !== String(s.side)) continue; // side change
    by[k] = { ...v };
  }
  let lastId = prev?.lastId ?? null;
  const day = sessionDay(nowMs);
  const spent: Record<string, SpentSetup> = {};
  for (const [k, v] of Object.entries(prev?.spent ?? {})) if (v && (v.day === day || v.day == null)) spent[k] = v;
  if (s.strategy_invalidated === true || invalidated(s)) {
    if ((sid in by || sid in spent) && !spent[sid]) spent[sid] = { why: "invalidated", day }; // stop / T1 touched: spent
    delete by[sid]; lastId = null;
  } else if (spent[sid]) { delete by[sid]; lastId = null; } // spent: never re-arms
  else {
    const cur = by[sid];
    if (cur && at != null && at === cur.lastAt && lastId === sid) { /* same card re-read */ }
    else if (fastSetupRows(s).every(([, ok]) => ok)) {
      if (cur?.outOfZone) { // entry re-arm: back inside the zone -> fresh clock + polls
        by[sid] = { firstMs: nowMs, polls: 1, lastAt: at, rearmed: (cur.rearmed ?? 0) + 1 };
      } else {
        const c = cur ?? { firstMs: nowMs, polls: 0, lastAt: null };
        by[sid] = { ...c, polls: lastId === sid ? c.polls + 1 : 1, lastAt: at };
      }
      lastId = sid;
    } else {
      if (cur) by[sid] = { ...cur, polls: 0, lastAt: at, ...(FC.entryRearm.mode === "live" && chased(s) ? { outOfZone: true } : {}) };
      lastId = null;
    }
  }
  const cur = by[sid];
  return cur ? { key: sid, ...cur, byId: by, lastId, spent, hist } : { key: null, firstMs: null, polls: 0, lastAt: at, byId: by, lastId, spent, hist };
}
/**
 * fast:persist (10/15 PM fix; live gates.log showed "held Nones over 0 cards (need >= 90s)" ~3k times: the hold clock never
 * started). The clock starts at the FIRST qualifying card (streakNext sets firstMs the poll every fast row passes).
 *  - A- or better with a fresh sweep or displacement: fires on the next real poll (2 consecutive passes, no hold);
 *  - otherwise: confirmPolls consecutive passes AND a short hold of PERSIST_HOLD_S since the first qualifying card;
 *  - either way no older than maxActionableAgeS (stale). Code constants: rulesHash unchanged.
 */
export const PERSIST_HOLD_S = 20;
export const fastEvidence = (s: FastSnap | null | undefined) => !!s && rank(s.band) >= rank("A-") && (s.sweep === true || s.displacement === true);
export function persistOk(st: FastStreak | null, nowMs: number, s?: FastSnap | null): boolean {
  if (st?.firstMs == null) return false;
  const age = (nowMs - st.firstMs) / 1000;
  if (age > FC.maxActionableAgeS) return false;
  if (fastEvidence(s)) return st.polls >= 2;
  return st.polls >= FC.confirmPolls && age >= PERSIST_HOLD_S;
}
/** The fast:persist row text (never "Nones": names the first qualifying card and what is still missing). */
export function persistWhy(st: FastStreak | null, nowMs: number, s?: FastSnap | null): string {
  if (st?.firstMs == null) return "no qualifying card yet (clock starts at the first card that passes every fast row)";
  const age = +((nowMs - st.firstMs) / 1000).toFixed(1);
  return fastEvidence(s) ? `A-+ with fresh sweep/displacement: ${st.polls} poll(s) since first qualifying card ${age}s ago (need 2)`
    : `${st.polls} poll(s), held ${age}s since first qualifying card (need ${FC.confirmPolls} and >= ${PERSIST_HOLD_S}s, <= ${FC.maxActionableAgeS}s)`;
}
