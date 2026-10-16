/**
 * Grok SUGGESTION cards + improvement PROPOSALS (Keaton 2026-10-16 follow-up on #45).
 *
 * Grok never fires and never changes a rule. A Grok missed-setup read may carry ONE strict-JSON trade suggestion;
 * anything malformed is dropped. `reviewSuggestion` is the deterministic FAST review, run the moment the read lands
 * (microseconds). It reuses existing desk rule VALUES only (rrMin, minStopAtr, entryZoneAtr, bandEdges) and adds no
 * new strictness. Risk limits ($650 debit cap, $150 daily loss, weekly lock, Agentic-only) belong to the watcher and
 * are re-checked there on its next poll (docs/grok-suggest-1016/watcher-grok-suggest.patch). Live fire needs
 * GROK_SUGGEST_FIRE=1 on the WATCHER. Default off, so the decision is shadow-logged only. Trading Stand reviews each
 * suggestion asynchronously (log + notify line) and is NOT in the fire path.
 */
import RULES from "../../../shared/desk-rules.json";
import type { Bar, MissedFlag } from "./reader";

export type GrokSuggestion = { symbol: string; side: "long" | "short"; entry: number; stop: number; t1: number; setup: string; confidence: number };
export type GrokProposal = { id: string; title: string; hypothesis: string; backtest: string; source: "grok" | "detector"; at: number; status: "proposed" };
export type BrainView = { word: string | null; symbol: string | null; side: string | null; q: number | null; vetoed: boolean };
export type DeskCardView = { symbol: string; side: string; pathBand?: string; q?: number | null; vetoed?: boolean };
export type SuggestReview = {
  decision: "would-fire" | "no-fire"; band: string; route: "normal-gates" | "brain-take" | "none";
  stop: number; t1: number; rr1: number | null; checks: { id: string; pass: boolean; detail: string }[]; reviewUs: number;
};
export type SuggestionCard = GrokSuggestion & {
  id: string; at: number; readAt: number; source: "grok"; mode: "shadow" | "live"; flagKind?: MissedFlag["kind"];
  review: SuggestReview; standReview: "pending";
};

const SYMS = new Set(["ES", "MNQ", "NQ", "MES"]);
const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);

/** Strict: a JSON object (optionally wrapped in a ```json fence and nothing else) with exactly-typed fields. Returns null on ANY defect. */
export function parseGrokJson(text: string | null | undefined): { suggestion: GrokSuggestion | null; proposals: { title: string; hypothesis: string; backtest: string }[]; read: Record<string, unknown> | null } | null {
  if (!text) return null;
  const m = text.trim().match(/^(?:```(?:json)?\s*)?(\{[\s\S]*\})(?:\s*```)?$/);
  if (!m) return null;
  let j: unknown; try { j = JSON.parse(m[1]); } catch { return null; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  return { suggestion: validSuggestion(o.suggestion), proposals: validProposals(o.proposals), read: o.read && typeof o.read === "object" ? (o.read as Record<string, unknown>) : null };
}
export function validSuggestion(x: unknown): GrokSuggestion | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const s = x as Record<string, unknown>;
  const keys = ["symbol", "side", "entry", "stop", "t1", "setup", "confidence"];
  if (!keys.every((k) => k in s)) return null;
  if (typeof s.symbol !== "string" || !SYMS.has(s.symbol)) return null;
  if (s.side !== "long" && s.side !== "short") return null;
  if (!num(s.entry) || !num(s.stop) || !num(s.t1) || !num(s.confidence)) return null;
  if (typeof s.setup !== "string" || !s.setup.trim() || s.setup.length > 200) return null;
  const e = s.entry as number, st = s.stop as number, t = s.t1 as number, c = s.confidence as number;
  if (c < 0 || c > 1) return null;
  if (s.side === "long" ? !(st < e && e < t) : !(t < e && e < st)) return null;
  return { symbol: s.symbol, side: s.side, entry: e, stop: st, t1: t, setup: s.setup.trim(), confidence: c };
}
function validProposals(x: unknown) {
  if (!Array.isArray(x)) return [];
  return x.filter((p) => p && typeof p === "object" && typeof p.title === "string" && typeof p.hypothesis === "string" && typeof p.backtest === "string")
    .slice(0, 3).map((p) => ({ title: String(p.title).slice(0, 120), hypothesis: String(p.hypothesis).slice(0, 400), backtest: String(p.backtest).slice(0, 400) }));
}
export function toProposals(ps: { title: string; hypothesis: string; backtest: string }[], at: number, source: GrokProposal["source"] = "grok"): GrokProposal[] {
  return ps.map((p, i) => ({ id: `prop:${at}:${i}:${p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`, ...p, source, at, status: "proposed" as const }));
}

const BAND_ORDER = ["A+", "A", "A-", "B+", "B", "C", "skip"];
const atLeast = (b: string | undefined, min: string) => { const i = BAND_ORDER.indexOf(String(b)); return i >= 0 && i <= BAND_ORDER.indexOf(min); };
const atr = (bars: Bar[], n = 14) => { const s = bars.slice(-n); return s.length ? s.reduce((a, b) => a + (b.h - b.l), 0) / s.length : 0; };
const tick = (sym: string) => (sym === "ES" || sym === "MES" ? 0.25 : 0.25);

/**
 * Deterministic fast review. Band: a Grok card inherits the desk's band for the same symbol/side, else B+ (Grok's
 * confidence never lifts it). A- or better → normal gates; B+ → only when Brain says TAKE on the same symbol/side
 * with q >= bandEdges.B+ (0.60) and no veto. Stop/T1 from structure: the stop is the structural level (swing/gap edge)
 * when Grok's stop sits inside it, floored at minStopAtr x ATR15 (existing rule); T1 = the nearest opposing pool
 * (last-hour extreme) when it is closer than Grok's. Closed-bar re-check: the last CLOSED 1m bar is still within
 * entryZoneAtr x ATR15 of entry and neither the stop nor T1 traded since the read.
 */
export function reviewSuggestion(s: GrokSuggestion, ctx: { minute: Bar[]; bars15: Bar[]; nowMs: number; readAt: number; flag?: MissedFlag | null; deskCards: DeskCardView[]; brain: BrainView | null }): SuggestReview {
  const t0 = performance.now();
  const checks: SuggestReview["checks"] = [];
  const ck = (id: string, pass: boolean, detail: string) => { checks.push({ id, pass, detail }); return pass; };
  const closed = ctx.minute.filter((b) => b.t + 60_000 <= ctx.nowMs);
  const a15 = atr(ctx.bars15.filter((b) => b.t + 900_000 <= ctx.nowMs)) || atr(closed) * 4;
  const short = s.side === "short";
  const desk = ctx.deskCards.filter((c) => c.symbol === s.symbol && c.side === s.side).sort((a, b) => BAND_ORDER.indexOf(String(a.pathBand)) - BAND_ORDER.indexOf(String(b.pathBand)))[0];
  const band = desk && atLeast(desk.pathBand, "B+") ? String(desk.pathBand) : "B+";
  // stop from structure
  let stop = s.stop;
  const lvl = ctx.flag && ctx.flag.side === s.side ? ctx.flag.level : null;
  if (lvl != null && (short ? stop < lvl + tick(s.symbol) : stop > lvl - tick(s.symbol))) stop = short ? lvl + tick(s.symbol) : lvl - tick(s.symbol);
  const minStop = RULES.minStopAtr * a15;
  if (Math.abs(stop - s.entry) < minStop) stop = short ? s.entry + minStop : s.entry - minStop;
  stop = Math.round(stop / tick(s.symbol)) * tick(s.symbol);
  // T1 from structure (nearest opposing pool beyond entry within the last hour)
  const hour = closed.slice(-60);
  let t1 = s.t1;
  if (hour.length) {
    const pool = short ? Math.min(...hour.map((b) => b.l)) : Math.max(...hour.map((b) => b.h));
    if (short ? pool < s.entry && pool > t1 : pool > s.entry && pool < t1) t1 = pool;
  }
  const risk = Math.abs(s.entry - stop);
  const rr1 = risk > 0 ? +(Math.abs(t1 - s.entry) / risk).toFixed(2) : null;
  ck("rr", rr1 != null && rr1 >= RULES.rrMin, `rr1 ${rr1} vs rrMin ${RULES.rrMin} (stop ${stop}, T1 ${t1} from structure)`);
  // closed-bar re-check
  const last = closed[closed.length - 1];
  const zone = ((RULES.entryZoneAtr as Record<string, number>)[band] ?? RULES.entryZoneAtr["B+"]) * a15;
  ck("closedBar:atEntry", Boolean(last) && Math.abs(last.c - s.entry) <= zone, last ? `last closed 1m ${last.c} vs entry ${s.entry} (zone ±${zone.toFixed(2)})` : "no closed bar");
  const since = closed.filter((b) => b.t >= ctx.readAt - 60_000);
  const stopHit = since.some((b) => (short ? b.h >= stop : b.l <= stop));
  const t1Hit = since.some((b) => (short ? b.l <= t1 : b.h >= t1));
  ck("closedBar:invalidation", !stopHit, stopHit ? `stop ${stop} traded since the read` : "stop untouched");
  ck("closedBar:t1", !t1Hit, t1Hit ? `T1 ${t1} already traded` : "T1 untouched");
  // band route
  let route: SuggestReview["route"] = "none";
  if (atLeast(band, "A-")) route = ck("band:A-+", !desk?.vetoed, `${band} via desk card → normal gates${desk?.vetoed ? " (desk veto)" : ""}`) ? "normal-gates" : "none";
  else {
    const b = ctx.brain; const take = Boolean(b && b.word === "TAKE" && b.symbol === s.symbol && b.side === s.side && (b.q ?? 0) >= RULES.bandEdges["B+"] && !b.vetoed);
    route = ck("band:B+brainTake", take, b ? `brain ${b.word} ${b.symbol} ${b.side} q ${b.q} veto ${b.vetoed}` : "no brain read") ? "brain-take" : "none";
  }
  const ok = checks.every((c) => c.pass);
  return { decision: ok ? "would-fire" : "no-fire", band, route, stop, t1, rr1, checks, reviewUs: Math.round((performance.now() - t0) * 1000) };
}

/** Deterministic improvement proposal from a missed flag (logged even without Grok). */
export function detectorProposal(f: MissedFlag, at: number): GrokProposal {
  const what = f.kind === "htfGapTap" ? "anchor a card on unmitigated 15m gap taps with rejection (front-run tol 0.15xATR15 / 0.5xATR5)"
    : f.kind === "mss" ? "re-anchor entry to the newest displacement leg after a 5m MSS (stale first-array entry)"
    : "arm a retest card on LH/HL < 50% retrace after displacement";
  return toProposals([{ title: `${f.kind}: ${what}`, hypothesis: `Desk had no actionable ${f.side} card: ${f.detail}`, backtest: `scripts/grok-suggest-replay.mts — replay ${f.kind} flags vs desk cards, R to T1/stop on closed 1m bars` }], at, "detector")[0];
}
