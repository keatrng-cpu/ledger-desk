/**
 * Grok SHADOW reader (shared/grok-reader.json). Fire-and-forget, informational only.
 *
 * Contract: `kickGrokReader` does a few microseconds of synchronous bookkeeping, schedules the network work with
 * setTimeout(0) and returns void. It never throws, never awaits, never mutates its input, and nothing in the
 * gate / score / fire / rules-hash path imports this module (scripts/grok-reader.test.mjs proves it). Results land in
 * an in-memory ring (`grokReadsSnapshot`) + one `[grok-reader]` JSON log line per read; the desk attaches the
 * snapshot to the payload as `grokReads` (display only) when the flag is on.
 */
import CFG from "../../../shared/grok-reader.json";
import { SMC_PACK } from "./knowledge";
import { parseGrokJson, reviewSuggestion, toProposals, detectorProposal, type BrainView, type SuggestionCard, type GrokProposal } from "./suggest";

export type Bar = { t: number; o: number; h: number; l: number; c: number };
export type ArrayLite = { tf: string; kind: string; dir: "bull" | "bear"; lo: number; hi: number; ce: number; mitigated?: boolean; ageBars?: number };
export type CardLite = {
  id: string; symbol: string; side: string; pathBand?: string; actionable?: boolean;
  plan?: { entry?: number | null; stop?: number | null; t1?: number | null; t2?: number | null } | null;
  entryPx?: number | null; strategyPrimary?: string; reasons?: string[]; q?: number | null; vetoed?: boolean;
};
export type BookInput = { symbol: string; minute: Bar[]; bars15: Bar[]; arrays?: ArrayLite[] };
export type MissedFlag = { symbol: string; side: "long" | "short"; kind: "mss" | "htfGapTap" | "lowerHigh" | "higherLow"; at: number; level: number; detail: string };
export type GrokRead = {
  key: string; kind: "card" | "missed"; symbol: string; side: string; cardId?: string; at: number;
  status: "ok" | "timeout" | "error" | "capped" | "nokey" | "malformed";
  text: string | null; staleEntry: boolean | null; flag?: MissedFlag; suggestions: string[]; latencyMs: number; costUsd: number;
};

const BAND_ORDER = ["A+", "A", "A-", "B+", "B", "C", "skip"];
export const bandAtLeast = (b: string | undefined, min = CFG.minBand) => { const i = BAND_ORDER.indexOf(String(b)); return i >= 0 && i <= BAND_ORDER.indexOf(min); };

type Env = Record<string, string | undefined>;
export function readerEnabled(env: Env = process.env): boolean {
  const f = String(env[CFG.envFlag] ?? "").trim().toLowerCase();
  return f === "1" || f === "true" || f === "on";
}
const hasKey = (env: Env) => Boolean(env.XAI_API_KEY?.trim());

// ---------- budget (daily call cap + spend cap) ----------
const budget = { day: "", calls: 0, spendUsd: 0 };
const ctDay = (ms: number) => new Date(ms - 5 * 3600_000).toISOString().slice(0, 10);
export function estCostUsd(inTok: number, outTok: number) { return (inTok * CFG.pricePerMTokIn + outTok * CFG.pricePerMTokOut) / 1e6; }
function reserve(nowMs: number, est: number): boolean {
  const d = ctDay(nowMs);
  if (budget.day !== d) { budget.day = d; budget.calls = 0; budget.spendUsd = 0; }
  if (budget.calls >= CFG.dailyCallCap || budget.spendUsd + est > CFG.dailySpendCapUsd) return false;
  budget.calls++; budget.spendUsd += est; return true;
}
export function budgetRead() { return { ...budget, callCap: CFG.dailyCallCap, spendCapUsd: CFG.dailySpendCapUsd }; }

// ---------- bars ----------
export function resample(bars: Bar[], min: number): Bar[] {
  const ms = min * 60_000; const out: Bar[] = [];
  for (const b of bars) {
    const k = Math.floor(b.t / ms) * ms; const x = out[out.length - 1];
    if (x && x.t === k) { x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.c = b.c; } else out.push({ t: k, o: b.o, h: b.h, l: b.l, c: b.c });
  }
  return out;
}
/** Only buckets whose window has closed by nowMs. */
const closedOnly = (bars: Bar[], min: number, nowMs: number) => bars.filter((b) => b.t + min * 60_000 <= nowMs);
const atr = (bars: Bar[], n = 14) => { const s = bars.slice(-n); return s.length ? s.reduce((a, b) => a + (b.h - b.l), 0) / s.length : 0; };
const ctMin = (ms: number) => { const d = new Date(ms - 5 * 3600_000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const hhmm = (ms: number) => { const m = ctMin(ms); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };

/** Same rungs the desk charts use: 1m-5m from the 1m tape, 15m/1h/4h from the 15m series. Compact OHLC lines. */
export function mtfSummary(b: BookInput, nowMs: number): string {
  const m1 = b.minute.filter((x) => x.t + 60_000 <= nowMs);
  const b15 = b.bars15.filter((x) => x.t + 15 * 60_000 <= nowMs);
  const rungs: [string, Bar[], number][] = [
    ["1m", m1, 12], ["5m", closedOnly(resample(m1, 5), 5, nowMs), 12], ["15m", b15, 12],
    ["1h", closedOnly(resample(b15, 60), 60, nowMs), 8], ["4h", closedOnly(resample(b15, 240), 240, nowMs), 6],
  ];
  const lines = rungs.map(([tf, bars, n]) => `${tf}: ` + bars.slice(-n).map((x) => `${hhmm(x.t)} ${x.o}/${x.h}/${x.l}/${x.c}`).join(" | "));
  const day = m1.filter((x) => ctDay(x.t) === ctDay(nowMs));
  const pre = day.filter((x) => ctMin(x.t) < 510);
  const lv = (xs: Bar[]) => xs.length ? `${Math.max(...xs.map((x) => x.h))}/${Math.min(...xs.map((x) => x.l))}` : "-";
  lines.push(`levels: day hi/lo ${lv(day)} · pre-RTH hi/lo ${lv(pre)} · last ${m1[m1.length - 1]?.c ?? "-"}`);
  const arr = (b.arrays ?? []).slice(0, 14).map((a) => `${a.tf} ${a.dir} ${a.kind} ${a.lo}-${a.hi} ce ${a.ce}${a.mitigated ? " mit" : ""}`);
  if (arr.length) lines.push(`arrays: ${arr.join(" | ")}`);
  return `${b.symbol}\n${lines.join("\n")}`;
}

// ---------- staleness (deterministic, also shown when Grok is unreachable) ----------
export function newestArray(arrays: ArrayLite[] | undefined, side: string): ArrayLite | null {
  const dir = side === "short" ? "bear" : "bull";
  const xs = (arrays ?? []).filter((a) => a.dir === dir && !a.mitigated);
  if (!xs.length) return null;
  return xs.reduce((m, a) => ((a.ageBars ?? 1e9) < (m.ageBars ?? 1e9) ? a : m));
}
export function entryStale(card: CardLite, arrays: ArrayLite[] | undefined): boolean | null {
  const e = card.entryPx ?? card.plan?.entry ?? null; const n = newestArray(arrays, card.side);
  if (e == null || !n) return null;
  return !(e >= n.lo - 0.25 && e <= n.hi + 0.25);
}

// ---------- missed-setup scan (deterministic pre-screen; Grok only explains what this finds) ----------
type Bear15Gap = { lo: number; hi: number; formedAt: number };
export function missedScan(b: BookInput, nowMs: number): MissedFlag[] {
  const mc = CFG.missedCheck; const out: MissedFlag[] = [];
  const m1 = b.minute.filter((x) => x.t + 60_000 <= nowMs);
  const m5 = closedOnly(resample(m1, 5), 5, nowMs);
  const b15 = b.bars15.filter((x) => x.t + 15 * 60_000 <= nowMs);
  if (m5.length < 15) return out;
  const last = m5[m5.length - 1], prev = m5[m5.length - 2];
  const a5 = atr(m5.slice(0, -1)); const a15 = atr(b15) || a5 * 3;
  const mk = (side: MissedFlag["side"], kind: MissedFlag["kind"], level: number, detail: string) => out.push({ symbol: b.symbol, side, kind, at: last.t + 5 * 60_000, level, detail });
  // 1) displacement MSS off the last hour's swing (sweep/AMD distribution leg)
  const look = m5.slice(-13, -1);
  const body = last.c - last.o;
  if (-body >= mc.dispBodyAtr5 * a5 && last.c < Math.min(...look.slice(-6).map((x) => x.l))) {
    const sh = Math.max(...look.slice(-6).map((x) => x.h));
    mk("short", "mss", sh, `5m displacement ${last.o}->${last.c} broke the 30m low; short anchored off swing high ${sh}`);
  }
  if (body >= mc.dispBodyAtr5 * a5 && last.c > Math.max(...look.slice(-6).map((x) => x.h))) {
    const sl = Math.min(...look.slice(-6).map((x) => x.l));
    mk("long", "mss", sl, `5m displacement ${last.o}->${last.c} broke the 30m high; long anchored off swing low ${sl}`);
  }
  // 2) 15m bear/bull gap tap with rejection (front-run tolerance fvgTapTolAtr15 x ATR15)
  const tol = Math.max(mc.fvgTapTolAtr15 * a15, 0.5 * a5);
  const gaps: (Bear15Gap & { dir: "bear" | "bull" })[] = [];
  for (let i = 2; i < b15.length; i++) {
    if (b15[i - 2].l > b15[i].h) gaps.push({ dir: "bear", lo: b15[i].h, hi: b15[i - 2].l, formedAt: b15[i].t });
    if (b15[i - 2].h < b15[i].l) gaps.push({ dir: "bull", lo: b15[i - 2].h, hi: b15[i].l, formedAt: b15[i].t });
  }
  for (const g of gaps.slice(-6)) {
    const after = m1.filter((x) => x.t >= g.formedAt + 15 * 60_000 && x.t < last.t);
    if (g.dir === "bear") {
      if (after.some((x) => x.c > g.hi)) continue; // closed through = mitigated/inverted
      if (last.h >= g.lo - tol && last.c < last.h - 0.4 * (last.h - last.l) && last.c < g.hi)
        mk("short", "htfGapTap", g.lo, `15m bear gap ${g.lo}-${g.hi} tapped (high ${last.h}) and rejected to ${last.c}`);
    } else {
      if (after.some((x) => x.c < g.lo)) continue;
      if (last.l <= g.hi + tol && last.c > last.l + 0.4 * (last.h - last.l) && last.c > g.lo)
        mk("long", "htfGapTap", g.hi, `15m bull gap ${g.lo}-${g.hi} tapped (low ${last.l}) and rejected to ${last.c}`);
    }
  }
  // 3) lower high / higher low right after a displacement leg (re-entry on retest)
  const pivH = Math.max(...m5.slice(-5, -1).map((x) => x.h)), pivL = Math.min(...m5.slice(-5, -1).map((x) => x.l));
  if (prev.o - prev.c >= mc.dispBodyAtr5 * a5 && last.h > prev.c && last.h < pivH && last.h < prev.o - 0.5 * (prev.o - prev.c))
    mk("short", "lowerHigh", last.h, `lower high ${last.h} under ${pivH} after displacement ${prev.o}->${prev.c}; retest short (retrace < 50% of the leg)`);
  if (prev.c - prev.o >= mc.dispBodyAtr5 * a5 && last.l < prev.c && last.l > pivL && last.l > prev.o + 0.5 * (prev.c - prev.o))
    mk("long", "higherLow", last.l, `higher low ${last.l} over ${pivL} after displacement ${prev.o}->${prev.c}; retest long (retrace < 50% of the leg)`);
  return out;
}
/** Flags for which the desk had NO actionable B+ card on that symbol/side. */
export function missedVsDesk(flags: MissedFlag[], cards: CardLite[]): MissedFlag[] {
  return flags.filter((f) => !cards.some((c) => c.symbol === f.symbol && c.side === f.side && c.actionable && bandAtLeast(c.pathBand)));
}

// ---------- xAI call ----------
type Fetch = typeof fetch;
export async function callXai(user: string, opts: { env?: Env; fetchImpl?: Fetch; timeoutMs?: number } = {}): Promise<{ status: GrokRead["status"]; text: string | null; inTok: number; outTok: number }> {
  const env = opts.env ?? process.env; const key = env.XAI_API_KEY?.trim();
  if (!key) return { status: "nokey", text: null, inTok: 0, outTok: 0 };
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? CFG.timeoutMs);
  try {
    const res = await (opts.fetchImpl ?? fetch)(CFG.endpoint, {
      method: "POST", signal: ac.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: CFG.model, max_tokens: CFG.maxOutputTokens, temperature: 0.2, messages: [{ role: "system", content: SMC_PACK }, { role: "user", content: user }] }),
    });
    if (!res.ok) return { status: "error", text: `http ${res.status}`, inTok: 0, outTok: 0 };
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return { status: "ok", text: String(j.choices?.[0]?.message?.content ?? "").trim().slice(0, 800), inTok: j.usage?.prompt_tokens ?? 0, outTok: j.usage?.completion_tokens ?? 0 };
  } catch (e) {
    return { status: ac.signal.aborted ? "timeout" : "error", text: e instanceof Error ? e.message.slice(0, 120) : "error", inTok: 0, outTok: 0 };
  } finally { clearTimeout(timer); }
}

// ---------- store ----------
const reads: GrokRead[] = [];
const seen = new Set<string>();
const last5m = new Map<string, number>();
const pending = new Set<Promise<void>>();
const suggestions: SuggestionCard[] = [];
const proposals: GrokProposal[] = [];
export function grokReadsSnapshot(): GrokRead[] { return reads.map((r) => ({ ...r })); }
export function grokSuggestSnapshot(): SuggestionCard[] { return suggestions.map((r) => ({ ...r })); }
export function grokProposalsSnapshot(): GrokProposal[] { return proposals.map((r) => ({ ...r })); }
export function suggestFireFlag(env: Env = process.env) { const f = String(env.GROK_SUGGEST_FIRE ?? "").trim().toLowerCase(); return f === "1" || f === "true" || f === "on"; }
function logLine(tag: string, o: object) { try { console.log(JSON.stringify({ tag, ...o })); } catch { /* never */ } }
function addProposal(p: GrokProposal) {
  if (proposals.some((x) => x.title === p.title && x.hypothesis === p.hypothesis)) return;
  proposals.unshift(p); if (proposals.length > CFG.keepReads) proposals.length = CFG.keepReads;
  logLine("grok-proposal", p);
}
function addSuggestion(c: SuggestionCard) {
  suggestions.unshift(c); if (suggestions.length > CFG.keepReads) suggestions.length = CFG.keepReads;
  logLine("grok-suggest", c);
  // Trading Stand async review line (not in the fire path; the watcher's notify sink picks this tag up).
  logLine("grok-suggest-stand", { id: c.id, line: `Grok suggestion ${c.symbol} ${c.side} @${c.entry} stop ${c.review.stop} T1 ${c.review.t1} (${c.setup}, conf ${c.confidence}) → desk review ${c.review.decision} [${c.review.route}] — Trading Stand please review`, standReview: "pending" });
}
/** Test hook: wait for in-flight reads. The desk never calls this. */
export async function drainGrokReader() { while (pending.size) await Promise.allSettled([...pending]); }
export function resetGrokReader() { suggestions.length = 0; proposals.length = 0; reads.length = 0; seen.clear(); last5m.clear(); budget.day = ""; budget.calls = 0; budget.spendUsd = 0; }
function store(r: GrokRead) {
  reads.unshift(r); if (reads.length > CFG.keepReads) reads.length = CFG.keepReads;
  try { console.log(JSON.stringify({ tag: "grok-reader", mode: "shadow", ...r })); } catch { /* never */ }
}

export type KickInput = { clock?: () => number; brain?: BrainView | null; cards: CardLite[]; books: BookInput[]; nowMs: number; env?: Env; fetchImpl?: Fetch; arraysOf?: (b: BookInput) => ArrayLite[] };
type Job = { book?: BookInput; key: string; kind: GrokRead["kind"]; symbol: string; side: string; cardId?: string; prompt: string; staleEntry: boolean | null; flag?: MissedFlag; suggestions: string[] };

/** Pure job planning (sync, cheap). Exported for tests. Dedup keys: card id + entry + newest array (re-anchor => new read). */
export function planJobs(inp: KickInput): Job[] {
  const jobs: Job[] = []; const { nowMs } = inp;
  const book = (s: string) => inp.books.find((b) => b.symbol === s);
  for (const c of inp.cards) {
    if (!bandAtLeast(c.pathBand)) continue;
    const b = book(c.symbol); const n = newestArray(b?.arrays, c.side); const e = c.entryPx ?? c.plan?.entry ?? null;
    const key = `card:${c.id}:${e}:${n ? `${n.tf}${n.lo}-${n.hi}` : "-"}`;
    if (seen.has(key)) continue;
    const st = entryStale(c, b?.arrays);
    const card = `CARD ${c.symbol} ${c.side} band ${c.pathBand} actionable ${Boolean(c.actionable)} entry ${e} stop ${c.plan?.stop ?? "-"} t1 ${c.plan?.t1 ?? "-"} t2 ${c.plan?.t2 ?? "-"} strategy ${c.strategyPrimary ?? "-"}\nreasons: ${(c.reasons ?? []).slice(-5).join("; ")}\nnewest ${c.side} array: ${n ? `${n.tf} ${n.kind} ${n.lo}-${n.hi} ce ${n.ce}` : "none"} · desk-side stale check: ${st}`;
    jobs.push({ key, kind: "card", symbol: c.symbol, side: c.side, cardId: c.id, staleEntry: st, suggestions: st ? [`re-anchor entry to newest ${n?.tf} ${n?.kind} CE ${n?.ce}`] : [], prompt: `${card}\n\n${b ? mtfSummary(b, nowMs) : ""}` });
  }
  if (CFG.missedCheck.everyClosed5m) {
    const m = ctMin(nowMs);
    if (m >= CFG.missedCheck.rthStartMinCt && m <= CFG.missedCheck.rthEndMinCt) {
      for (const b of inp.books) {
        const bucket = Math.floor(nowMs / 300_000);
        if (last5m.get(b.symbol) === bucket) continue;
        const flags = missedVsDesk(missedScan(b, nowMs), inp.cards);
        for (const f of flags) {
          const key = `missed:${f.symbol}:${f.side}:${f.kind}:${f.level}:${ctDay(f.at)}`;   // one call per setup per day (#22 setup-spent)
          if (seen.has(key)) continue;
          addProposal(detectorProposal(f, nowMs));
          const sug = [`desk had no actionable ${f.side} card on ${f.symbol} at ${hhmm(f.at)} CT for a ${f.kind} (${f.detail})`];
          jobs.push({ book: b, key, kind: "missed", symbol: f.symbol, side: f.side, flag: f, staleEntry: null, suggestions: sug, prompt: `MISSED-SETUP CHECK: ${f.detail}. The desk shows NO actionable ${f.side} card. Explain the setup and what the desk should change.\n\n${mtfSummary(b, nowMs)}` });
        }
      }
    }
  }
  return jobs;
}

/** Fire-and-forget entry point for the desk. Returns void synchronously and never throws. */
export function kickGrokReader(inp: KickInput): void {
  try {
    const env = inp.env ?? process.env;
    if (!readerEnabled(env)) return;
    // mark the 5m bucket now (sync) so overlapping polls never double-scan
    const bucketMs = inp.nowMs;
    setTimeout(() => {
      const p = (async () => {
        let jobs: Job[] = [];
        try { const books = inp.arraysOf ? inp.books.map((b) => ({ ...b, arrays: b.arrays ?? inp.arraysOf!(b) })) : inp.books; jobs = planJobs({ ...inp, books, nowMs: bucketMs }); for (const b of inp.books) last5m.set(b.symbol, Math.floor(bucketMs / 300_000)); } catch { return; }
        for (const j of jobs) {
          seen.add(j.key);
          const t0 = Date.now(); const est = estCostUsd(Math.ceil((SMC_PACK.length + j.prompt.length) / 4), CFG.maxOutputTokens);
          const base = { key: j.key, kind: j.kind, symbol: j.symbol, side: j.side, cardId: j.cardId, at: bucketMs, staleEntry: j.staleEntry, flag: j.flag, suggestions: j.suggestions };
          if (!hasKey(env)) { store({ ...base, status: "nokey", text: null, latencyMs: 0, costUsd: 0 }); continue; }
          if (!reserve(bucketMs, est)) { store({ ...base, status: "capped", text: null, latencyMs: 0, costUsd: 0 }); continue; }
          try {
            const r = await callXai(j.prompt, { env, fetchImpl: inp.fetchImpl });
            const cost = r.status === "ok" && r.inTok ? estCostUsd(r.inTok, r.outTok) : r.status === "ok" ? est : 0;
            budget.spendUsd += cost - est;
            const parsed = r.status === "ok" ? parseGrokJson(r.text) : null;
            const rd = parsed?.read ?? null;
            const stale = typeof rd?.stale === "boolean" ? rd.stale : j.staleEntry;
            const note = typeof rd?.note === "string" ? rd.note.trim() : "";
            const text = rd ? ["setup", "entryArray", "targetPool"].map((k) => `${k.toUpperCase()}: ${String(rd[k] ?? "-")}`).join("\n") : null;
            const readAt = inp.clock ? inp.clock() : Date.now();
            store({ ...base, status: r.status === "ok" && !parsed ? "malformed" : r.status, text: r.status === "ok" ? text : r.text, staleEntry: stale, suggestions: note && !/^none/i.test(note) ? [...j.suggestions, note] : j.suggestions, latencyMs: readAt - t0, costUsd: +cost.toFixed(6) });
            if (parsed) for (const p of toProposals(parsed.proposals, bucketMs)) addProposal(p);
            if (parsed?.suggestion && j.kind === "missed" && j.book) {
              const sg = parsed.suggestion;
              const review = reviewSuggestion(sg, { minute: j.book.minute, bars15: j.book.bars15, nowMs: readAt, readAt, flag: j.flag, deskCards: inp.cards, brain: inp.brain ?? null });
              addSuggestion({ ...sg, id: `grok:${sg.symbol}:${sg.side}:${bucketMs}`, at: bucketMs, readAt, source: "grok", mode: suggestFireFlag(env) ? "live" : "shadow", flagKind: j.flag?.kind, review, standReview: "pending" });
            }
          } catch { /* never escapes */ }
        }
      })().catch(() => {});
      pending.add(p); p.finally(() => pending.delete(p));
    }, 0);
  } catch { /* never throws into the desk */ }
}

/** Cheap sync snapshot of the desk's cards (the reader never holds a reference to live card objects). */
export function cardsLite(cands: readonly unknown[]): CardLite[] {
  return cands.map((x) => { const c = x as CardLite; return { id: c.id, symbol: c.symbol, side: c.side, pathBand: c.pathBand, actionable: c.actionable, entryPx: c.entryPx ?? null,
    plan: c.plan ? { entry: c.plan.entry ?? null, stop: c.plan.stop ?? null, t1: c.plan.t1 ?? null, t2: c.plan.t2 ?? null } : null, strategyPrimary: c.strategyPrimary, reasons: (c.reasons ?? []).slice(-5), q: (c as { confluence?: number }).confluence ?? null, vetoed: Boolean((c as { vetoes?: unknown[] }).vetoes?.length) }; });
}
