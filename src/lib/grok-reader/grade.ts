/**
 * Scoring harness for Grok advisor suggestions (SHADOW). Pure; closed 1m bars strictly AFTER the decision, no lookahead.
 * Fill: entry must trade within fillWindowMin; a stop or target touched before the fill = NOFILL (the setup left).
 * After the fill: stop and target in the same bar = stop (conservative); otherwise mark-to-market at sessionEndCt.
 * Promotion of a blocker override needs >= minCases graded OOS cases where overriding beats the desk on BOTH R and WR.
 */
import CFG from "../../../shared/grok-reader.json";
import type { Bar } from "./reader";
const G = CFG.advisor.grading;
export type Graded = { id: string; type: string; reasonCode: string; blocker: string | null; at: number; outcome: "TARGET" | "STOP" | "EOD" | "NOFILL" | "NODATA"; r: number | null; filledAt: number | null };
const ctMin = (ms: number) => { const d = new Date(ms - 5 * 3600_000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const ctDay = (ms: number) => new Date(ms - 5 * 3600_000).toISOString().slice(0, 10);

export function gradeAdvice(s: { id: string; type: string; reasonCode: string; blocker: string | null; at: number; side: "long" | "short"; entry: number | null; stop: number | null; target: number | null }, bars: Bar[], o: { fillWindowMin?: number; sessionEndCt?: number } = {}): Graded {
  const base = { id: s.id, type: s.type, reasonCode: s.reasonCode, blocker: s.blocker, at: s.at };
  if (s.entry == null || s.stop == null || s.target == null) return { ...base, outcome: "NODATA", r: null, filledAt: null };
  const fw = (o.fillWindowMin ?? G.fillWindowMin) * 60_000, end = o.sessionEndCt ?? G.sessionEndCt;
  const fwd = bars.filter((b) => b.t >= s.at && ctDay(b.t) === ctDay(s.at) && ctMin(b.t) < end).sort((a, b) => a.t - b.t);
  if (!fwd.length) return { ...base, outcome: "NODATA", r: null, filledAt: null };
  const L = s.side === "long", risk = Math.abs(s.entry - s.stop);
  const hitStop = (b: Bar) => (L ? b.l <= s.stop! : b.h >= s.stop!), hitTgt = (b: Bar) => (L ? b.h >= s.target! : b.l <= s.target!);
  let fill = -1;
  for (let i = 0; i < fwd.length && fwd[i].t < s.at + fw; i++) {
    const b = fwd[i];
    if (b.l <= s.entry && b.h >= s.entry) { fill = i; break; }
    if (hitStop(b) || hitTgt(b)) return { ...base, outcome: "NOFILL", r: 0, filledAt: null };
  }
  if (fill < 0) return { ...base, outcome: "NOFILL", r: 0, filledAt: null };
  for (let i = fill; i < fwd.length; i++) {
    const b = fwd[i];
    if (hitStop(b)) return { ...base, outcome: "STOP", r: -1, filledAt: fwd[fill].t };
    if (hitTgt(b)) return { ...base, outcome: "TARGET", r: +(Math.abs(s.target - s.entry) / risk).toFixed(3), filledAt: fwd[fill].t };
  }
  const last = fwd[fwd.length - 1].c;
  return { ...base, outcome: "EOD", r: +(((L ? last - s.entry : s.entry - last)) / risk).toFixed(3), filledAt: fwd[fill].t };
}
export type Tally = { n: number; filled: number; wins: number; wr: number | null; netR: number; avgR: number | null };
export function tally(gs: Graded[]): Tally {
  const f = gs.filter((g) => g.outcome === "TARGET" || g.outcome === "STOP" || g.outcome === "EOD");
  const wins = f.filter((g) => (g.r ?? 0) > 0).length, netR = +f.reduce((a, g) => a + (g.r ?? 0), 0).toFixed(3);
  return { n: gs.length, filled: f.length, wins, wr: f.length ? +(wins / f.length).toFixed(3) : null, netR, avgR: f.length ? +(netR / f.length).toFixed(3) : null };
}
export function tallies(gs: Graded[]) {
  const by = (k: (g: Graded) => string | null) => { const m: Record<string, Graded[]> = {}; for (const g of gs) { const v = k(g); if (v) (m[v] ??= []).push(g); } return Object.fromEntries(Object.entries(m).map(([a, b]) => [a, tally(b)])); };
  return { all: tally(gs), byType: by((g) => g.type), byReason: by((g) => g.reasonCode), byBlocker: by((g) => g.blocker) };
}
/**
 * A blocker is promotable only when, on OOS cases (at >= oosFromMs), overriding it has >= minCases filled grades AND
 * beats the desk on BOTH net R and WR. Desk baseline per case = what the desk did (deskR; 0 when it stood aside), and
 * deskWr = the desk's own WR on the trades it took in the same OOS window (caller supplies; null = not provable -> no).
 */
export function promotable(blocker: string, gs: Graded[], o: { oosFromMs: number; deskR: number; deskWr: number | null; minCases?: number }): { promotable: boolean; why: string; t: Tally } {
  const oos = gs.filter((g) => g.blocker === blocker && g.type === "WRONGLY_BLOCKED" && g.at >= o.oosFromMs);
  const t = tally(oos); const min = o.minCases ?? G.minCasesToPromote;
  if (t.filled < min) return { promotable: false, why: `only ${t.filled}/${min} graded OOS cases`, t };
  if (o.deskWr == null) return { promotable: false, why: "desk OOS WR unknown", t };
  const ok = t.netR > o.deskR && (t.wr ?? 0) > o.deskWr;
  return { promotable: ok, why: ok ? `override +${t.netR}R vs desk ${o.deskR}R and WR ${t.wr} > ${o.deskWr}` : `fails: override ${t.netR}R/WR ${t.wr} vs desk ${o.deskR}R/WR ${o.deskWr}`, t };
}
