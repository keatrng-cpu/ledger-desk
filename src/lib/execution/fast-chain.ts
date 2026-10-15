/**
 * FAST-SETUPS-ONLY fire chain (shared rules `fastChain`; Python twin watcher/fastchain.py; parity in scripts/fast-chain.test.mjs).
 * The watcher fires from it; the desk uses the same pure checks so the Floor / Watcher tab say the same thing.
 */
import RULES from "../../../shared/desk-rules.json";

export const FC = RULES.fastChain;
const BANDS = ["C", "B", "B+", "A-", "A", "A+"];
const rank = (b: string | null | undefined) => BANDS.indexOf(String(b ?? ""));
export interface FastSnap {
  band?: string | null; symbol?: string | null; side?: string | null; entry?: number | null; stop_px?: number | null; first_target?: number | null;
  px?: number | null; atr?: number | null; brain_symbol?: string | null; brain_side?: string | null; bias1h?: string | null; bias4h?: string | null; expMin?: number | null;
  t2?: number | null; desk_ticket_side?: string | null; desk_ticket_underlier?: string | null;
}
/** [name, ok] in the watcher's order (persistence needs the clock and is checked by the watcher). */
export function fastSetupRows(s: FastSnap): [string, boolean][] {
  const r: [string, boolean][] = [];
  r.push(["band", rank(s.band) >= rank(FC.minBand) && rank(s.band) >= 0]);
  const { entry: e, stop_px: st, first_target: t1, side } = s;
  const sides = e != null && st != null && t1 != null && ((side === "long" && st < e && e < t1) || (side === "short" && t1 < e && e < st));
  const rr = sides ? Math.abs(t1! - e!) / Math.abs(e! - st!) : null;
  r.push(["fast:plan", Boolean(sides && rr! >= FC.rrMin)]);
  const okE = s.px != null && e != null && !!s.atr && Math.abs(s.px - e) <= FC.entryAtr * s.atr && (st == null || (side === "short" ? s.px < st : s.px > st));
  r.push(["fast:entry", Boolean(okE)]);
  const opposite = s.brain_symbol === s.symbol && (s.brain_side === "long" || s.brain_side === "short") && s.brain_side !== side;
  const want = side === "long" ? "bull" : "bear";
  const both = s.bias1h != null && s.bias4h != null && s.bias1h !== want && s.bias4h !== want;
  r.push(["fast:agree", !opposite && !both]);
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
export interface FastStreak { key: string | null; firstMs: number | null; polls: number; lastAt: string | null; byId: Record<string, SetupConfirm>; lastId: string | null; spent?: Record<string, SpentSetup> }
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
  return cur ? { key: sid, ...cur, byId: by, lastId, spent } : { key: null, firstMs: null, polls: 0, lastAt: at, byId: by, lastId, spent };
}
/** fast:persist: confirmPolls consecutive passes and no older than maxActionableAgeS. */
export function persistOk(st: FastStreak | null, nowMs: number): boolean {
  if (st?.firstMs == null) return false;
  return (nowMs - st.firstMs) / 1000 <= FC.maxActionableAgeS && st.polls >= FC.confirmPolls;
}
