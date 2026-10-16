/**
 * Grok SHADOW ADVISOR (Keaton 2026-10-16, PR #45 follow-up). Prompt v2 from grok-vs-desk-1016 §6.
 *
 * Grok can never fire, block or change a rule. It only writes structured suggestions of three types:
 *   MISGRADED       — a desk card exists and its grade is lower than the setup deserves;
 *   WRONGLY_BLOCKED — a desk card is held back by a named blocker/veto that is likely wrong (named verbatim);
 *   NEW_SETUP       — a valid setup the desk has no card for.
 * (AGREE = Grok agrees with the desk; logged, never routed.)
 * Rows go to a local jsonl + the bots' file queue (Trading Stand, SMC data analysis) and, behind its own flag,
 * the Supabase shadow table from migrations/0011_grok_advisor_shadow.sql. Off unless GROK_ADVISOR=1.
 * Nothing in gate / score / fire / rules-hash imports this module (scripts/grok-advisor.test.mjs proves it).
 */
import CFG from "../../../shared/grok-reader.json";
import { GATE_SECTIONS } from "./knowledge";
import { callXai, estCostUsd, reserveBudget, settleBudget, resample, mtfSummary, missedScan, bandAtLeast, type Bar, type BookInput, type CardLite, type ArrayLite } from "./reader";
import type { BrainView } from "./suggest";
import { newsTag, type XPulse } from "./xpulse";

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;
const ACFG = CFG.advisor;
export const PROMPT_VERSION = ACFG.promptVersion;
const on = (v: string | undefined) => ["1", "true", "on"].includes(String(v ?? "").trim().toLowerCase());
export const advisorEnabled = (env: Env = process.env) => on(env[ACFG.envFlag]);

export const ADVICE_TYPES = ["MISGRADED", "WRONGLY_BLOCKED", "NEW_SETUP", "AGREE"] as const;
export type AdviceType = (typeof ADVICE_TYPES)[number];
/** Why a setup is good (MISGRADED / WRONGLY_BLOCKED / NEW_SETUP). */
export const SETUP_CODES = ["HTF_ARRAY_TAP", "MSS_DISPLACEMENT", "LIQ_SWEEP_REVERSAL", "RETEST_LH_HL", "SMT_DIVERGENCE", "KEY_LEVEL_REACTION", "STALE_ANCHOR"] as const;
/** Why Grok agrees with the desk passing (AGREE). */
export const PASS_CODES = ["NO_DISPLACEMENT", "CHOP", "WRONG_HALF", "HTF_AGAINST", "PRICE_PAST_ENTRY", "NO_ARRAY", "INTO_OPPOSING_LEVEL", "OTHER"] as const;
export type Advice = { type: AdviceType; symbol: string; side: "long" | "short"; entry: number | null; stop: number | null; target: number | null; reasonCode: string; blocker: string | null; note: string };

// ---------- context (all closed bars only, no lookahead) ----------
const CT_OFF = 5 * 3600_000;
const ctDay = (ms: number) => new Date(ms - CT_OFF).toISOString().slice(0, 10);
const ctMin = (ms: number) => { const d = new Date(ms - CT_OFF); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const hiLo = (xs: Bar[]) => (xs.length ? { hi: Math.max(...xs.map((x) => x.h)), lo: Math.min(...xs.map((x) => x.l)) } : null);
/** CME session day: bars from 17:00 CT belong to the NEXT session. */
const sessionOf = (ms: number) => (ctMin(ms) >= 17 * 60 ? ctDay(ms + 7 * 3600_000) : ctDay(ms));
const weekOf = (day: string) => { const d = new Date(`${day}T00:00:00Z`); const wd = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - wd * 86_400_000).toISOString().slice(0, 10); };

export type Levels = { pdh: number | null; pdl: number | null; onh: number | null; onl: number | null; pwh: number | null; pwl: number | null };
export function keyLevels(minute: Bar[], nowMs: number): Levels {
  const m = minute.filter((b) => b.t + 60_000 <= nowMs); const cur = sessionOf(nowMs);
  const sessions = [...new Set(m.map((b) => sessionOf(b.t)))].filter((d) => d < cur).sort();
  const prev = sessions[sessions.length - 1];
  // prior day = previous session's RTH 08:30–15:00 CT; overnight = this session's bars before 08:30 CT
  const pd = hiLo(m.filter((b) => sessionOf(b.t) === prev && ctMin(b.t) >= 510 && ctMin(b.t) < 900));
  const on_ = hiLo(m.filter((b) => sessionOf(b.t) === cur && (ctMin(b.t) >= 17 * 60 || ctMin(b.t) < 510)));
  const wk = weekOf(cur); const pw = sessions.filter((d) => weekOf(d) < wk);
  const lastWk = pw.length ? weekOf(pw[pw.length - 1]) : null;
  const pwBars = lastWk ? m.filter((b) => weekOf(sessionOf(b.t)) === lastWk) : [];
  // a prior week counts only if the tape covers it from its first session (else "n/a", never a partial week)
  const pwFull = pwBars.length && sessions.some((d) => weekOf(d) === lastWk && new Date(`${d}T00:00:00Z`).getUTCDay() === 1);
  const w = pwFull ? hiLo(pwBars) : null;
  return { pdh: pd?.hi ?? null, pdl: pd?.lo ?? null, onh: on_?.hi ?? null, onl: on_?.lo ?? null, pwh: w?.hi ?? null, pwl: w?.lo ?? null };
}
export function levelsLine(l: Levels, last: number | null): string {
  const f = (k: string, v: number | null) => `${k} ${v ?? "n/a"}${v != null && last != null ? ` (${v > last ? "+" : ""}${+(v - last).toFixed(2)})` : ""}`;
  return `key levels (distance from last): ${f("PDH", l.pdh)} · ${f("PDL", l.pdl)} · ${f("ONH", l.onh)} · ${f("ONL", l.onl)} · ${f("PWH", l.pwh)} · ${f("PWL", l.pwl)}`;
}
/** Deterministic SMT over the last closed 30m vs the 60m before it. */
export function smtLine(self: BookInput, other: BookInput | null, nowMs: number): string {
  if (!other) return "SMT: other index n/a";
  const win = (b: BookInput) => { const m = b.minute.filter((x) => x.t + 60_000 <= nowMs); const a = hiLo(m.filter((x) => x.t >= nowMs - 30 * 60_000)); const p = hiLo(m.filter((x) => x.t >= nowMs - 90 * 60_000 && x.t < nowMs - 30 * 60_000)); return a && p ? { hi: a.hi > p.hi, lo: a.lo < p.lo, last: m[m.length - 1]?.c } : null; };
  const s = win(self), o = win(other); if (!s || !o) return "SMT: n/a";
  const out: string[] = [];
  if (s.hi !== o.hi) out.push(`${s.hi ? self.symbol : other.symbol} took the prior-60m high, ${s.hi ? other.symbol : self.symbol} did not (bearish SMT)`);
  if (s.lo !== o.lo) out.push(`${s.lo ? self.symbol : other.symbol} took the prior-60m low, ${s.lo ? other.symbol : self.symbol} did not (bullish SMT)`);
  const m5 = closed5(other, nowMs).slice(-4).map((x) => `${x.o}/${x.h}/${x.l}/${x.c}`).join(" | ");
  return `SMT vs ${other.symbol}: ${out.join("; ") || "none (both or neither took the 60m extremes)"} · ${other.symbol} last ${o.last} · ${other.symbol} 5m: ${m5}`;
}
const closed5 = (b: BookInput, nowMs: number) => resample(b.minute.filter((x) => x.t + 60_000 <= nowMs), 5).filter((x) => x.t + 300_000 <= nowMs);
export function volumeLine(b: BookInput, nowMs: number): string {
  const m = closed5(b, nowMs);
  const vols = b.minute.some((x) => typeof x.v === "number") ? m.map((x) => b.minute.filter((y) => y.t >= x.t && y.t < x.t + 300_000).reduce((a, y) => a + (y.v ?? 0), 0)) : null;
  if (!vols || vols.length < 6) return "volume: n/a (feed carries no volume)";
  const avg = vols.slice(-21, -1).reduce((a, v) => a + v, 0) / Math.max(1, vols.slice(-21, -1).length);
  return `volume: last 5m ${vols[vols.length - 1]} = ${(vols[vols.length - 1] / (avg || 1)).toFixed(2)}x the 20-bar avg`;
}
export function deskLine(card: CardLite | null, side: string, brain: BrainView | null): string {
  const br = brain ? `Brain seat: ${brain.word ?? "?"}${brain.symbol ? ` on ${brain.symbol} ${brain.side ?? "-"}` : ""}${brain.q != null ? ` q ${brain.q}` : ""}${brain.vetoed ? " (vetoed)" : ""}` : "Brain seat: n/a";
  if (!card) return `DESK CARD (${side}): none — the desk has no card on this side.\n${br}`;
  const bl = blockersOf(card);
  return `DESK CARD (${side}) id ${card.id}: grade ${card.pathBand ?? "?"} q ${card.q ?? "?"} actionable ${Boolean(card.actionable)} entry ${card.entryPx ?? card.plan?.entry ?? "-"} stop ${card.plan?.stop ?? "-"} t1 ${card.plan?.t1 ?? "-"} strategy ${card.strategyPrimary ?? "-"}\nblockers: ${bl.length ? bl.map((b) => `"${b}"`).join(", ") : "none"}\nreasons: ${(card.reasons ?? []).slice(-4).join("; ") || "-"}\n${br}`;
}
export const blockersOf = (c: CardLite) => [...(c.vetoes ?? []), ...(c.missing ?? []), ...(c.caps ?? [])].filter(Boolean).map((s) => String(s).slice(0, 120)).slice(0, 10);

// ---------- prompt v2 ----------
export const ADVISOR_PACK = `
You are a SHADOW advisor to an SMC/ICT futures desk (ES, MNQ). You never fire, block or change rules; humans grade you against outcomes.
Concepts: liquidity pools (PDH/PDL, ONH/ONL, PWH/PWL, equal highs/lows) get swept then reverse; displacement (body >= ~1.2x ATR) through the last opposing swing = MSS, usually leaving an FVG whose CE (50%) is the entry; iFVG = gap closed through, flips polarity; a tap of an unmitigated 15m-4h gap with rejection is an entry in the gap's direction; lower high / higher low into the newest gap after a leg is a re-entry; premium (above 50% of the dealing range) sells, discount buys; SMT = one index takes a high/low the other does not, the weaker one is the tell.
Time: the desk's main window is NY AM 08:30-11:00 CT. It is context, NOT a filter: never reject or downgrade for time alone; a setup outside the window is judged on structure.
Desk vocabulary: grade A+ > A > A- > B+ > B > C (B+ or better is tradeable); blockers are the card's missing items, vetoes and caps. Rule sections: ${GATE_SECTIONS.join(", ")}.
Reply with ONE JSON object, nothing else:
{"type":"MISGRADED"|"WRONGLY_BLOCKED"|"NEW_SETUP"|"AGREE","symbol":"ES"|"MNQ","side":"long"|"short","entry":number|null,"stop":number|null,"target":number|null,"reasonCode":str,"blocker":str|null,"note":str}
- MISGRADED: a desk card exists on this side and deserves a higher grade. WRONGLY_BLOCKED: a desk card exists and ONE listed blocker is likely wrong; copy that blocker string exactly into "blocker". NEW_SETUP: the desk has NO card on this side and the setup is valid now.
- For those three: entry near current price at a real array, stop beyond the structural level, target = next opposing pool or key level; reasonCode one of ${SETUP_CODES.join(", ")}.
- AGREE (the desk is right to pass): entry/stop/target null; reasonCode one of ${PASS_CODES.join(", ")}.
- note <= 25 words, cite the actual level. No confidence field.
`.trim();

export type AdvisorCtx = { book: BookInput; other: BookInput | null; side: "long" | "short"; nowMs: number; card: CardLite | null; brain: BrainView | null; flag?: string | null };
export function advisorPrompt(c: AdvisorCtx): string {
  const m1 = c.book.minute.filter((x) => x.t + 60_000 <= c.nowMs); const last = m1[m1.length - 1]?.c ?? null;
  const hm = ctMin(c.nowMs);
  return [
    `ADVISOR CHECK ${c.book.symbol} ${c.side} at ${String(Math.floor(hm / 60)).padStart(2, "0")}:${String(hm % 60).padStart(2, "0")} CT ${ctDay(c.nowMs)}${c.flag ? ` · scan flag: ${c.flag}` : ""}`,
    deskLine(c.card, c.side, c.brain),
    levelsLine(keyLevels(c.book.minute, c.nowMs), last),
    smtLine(c.book, c.other, c.nowMs),
    volumeLine(c.book, c.nowMs),
    mtfSummary(c.book, c.nowMs),
  ].join("\n");
}

// ---------- strict parse ----------
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
export function parseAdvice(text: string | null | undefined, ctx: { symbol: string; side: string; card: CardLite | null }): Advice | null {
  if (!text) return null;
  const m = text.trim().match(/^(?:```(?:json)?\s*)?(\{[\s\S]*\})(?:\s*```)?$/); if (!m) return null;
  let o: Record<string, unknown>; try { o = JSON.parse(m[1]); } catch { return null; }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const type = o.type as AdviceType; if (!ADVICE_TYPES.includes(type)) return null;
  if (o.symbol !== ctx.symbol || o.side !== ctx.side) return null;
  const note = typeof o.note === "string" ? o.note.trim().slice(0, 240) : "";
  const rc = typeof o.reasonCode === "string" ? o.reasonCode.trim().toUpperCase() : "";
  const side = o.side as "long" | "short";
  if (type === "AGREE") return (PASS_CODES as readonly string[]).includes(rc) ? { type, symbol: ctx.symbol, side, entry: null, stop: null, target: null, reasonCode: rc, blocker: null, note } : null;
  if (!(SETUP_CODES as readonly string[]).includes(rc)) return null;
  if (!num(o.entry) || !num(o.stop) || !num(o.target)) return null;
  const e = o.entry, s = o.stop, t = o.target;
  if (side === "long" ? !(s < e && e < t) : !(t < e && e < s)) return null;
  if ((type === "NEW_SETUP") !== !ctx.card) return null;           // NEW_SETUP only without a card; the others only with one
  let blocker: string | null = null;
  if (type === "WRONGLY_BLOCKED") {
    const bl = ctx.card ? blockersOf(ctx.card) : [];
    const want = typeof o.blocker === "string" ? o.blocker.trim() : "";
    blocker = bl.find((b) => b === want) ?? bl.find((b) => want.length >= 4 && (b.includes(want) || want.includes(b))) ?? null;
    if (!blocker) return null;                                       // must name a REAL blocker from the card
  }
  return { type, symbol: ctx.symbol, side, entry: e, stop: s, target: t, reasonCode: rc, blocker, note };
}

// ---------- routing ----------
export type AdviceRow = Advice & {
  id: string; at: number; readAt: number; promptVersion: string; mode: "shadow"; cardId: string | null;
  desk: { grade: string | null; q: number | null; actionable: boolean; blockers: string[] } | null;
  brain: string | null; news: ReturnType<typeof newsTag>; costUsd: number;
};
export const SINKS = ["trading-stand", "smc-data-analysis"] as const;
export function inboxNote(r: AdviceRow): string {
  const lv = r.entry != null ? ` @${r.entry} stop ${r.stop} target ${r.target}` : "";
  return `Grok ${r.type} ${r.symbol} ${r.side}${lv} [${r.reasonCode}]${r.blocker ? ` blocker "${r.blocker}"` : ""}${r.desk ? ` · desk ${r.desk.grade} q ${r.desk.q}` : ""}${r.news ? ` · NEWS ${r.news.minutesFrom}m: ${r.news.headline.slice(0, 60)}` : ""} — ${r.note} (shadow; never a fire)`;
}
/** Supabase row for public.grok_advisor_suggestions (migrations/0011). */
export function supabaseRow(r: AdviceRow) {
  return { id: r.id, ts: new Date(r.at).toISOString(), symbol: r.symbol, side: r.side, type: r.type, entry: r.entry, stop: r.stop, target: r.target, reason_code: r.reasonCode, blocker: r.blocker, note: r.note, card_id: r.cardId, desk: r.desk, brain: r.brain, news: r.news, prompt_version: r.promptVersion, cost_usd: r.costUsd };
}
export async function routeAdvice(r: AdviceRow, o: { env?: Env; fetchImpl?: Fetch; dir?: string } = {}): Promise<{ jsonl: boolean; inbox: boolean; supabase: "off" | "ok" | "error" }> {
  const env = o.env ?? process.env; const dir = o.dir ?? env.GROK_ADVISOR_DIR ?? ACFG.dir;
  const out = { jsonl: false, inbox: false, supabase: "off" as "off" | "ok" | "error" };
  try {
    const fs = await import("node:fs"); fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(`${dir}/suggestions.jsonl`, JSON.stringify(r) + "\n"); out.jsonl = true;
    if (r.type !== "AGREE") { fs.appendFileSync(`${dir}/inbox.jsonl`, JSON.stringify({ id: r.id, at: r.at, to: SINKS, note: inboxNote(r), row: r, status: "new" }) + "\n"); out.inbox = true; }
  } catch { /* shadow sink; never into the desk */ }
  if (on(env[ACFG.supabaseFlag]) && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && r.type !== "AGREE") {
    try {
      const res = await (o.fetchImpl ?? fetch)(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/grok_advisor_suggestions`, { method: "POST", headers: { "content-type": "application/json", apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(supabaseRow(r)) });
      out.supabase = res.ok ? "ok" : "error";
    } catch { out.supabase = "error"; }
  }
  return out;
}

// ---------- fire-and-forget kick ----------
const seen = new Set<string>(); const ring: AdviceRow[] = []; const pending = new Set<Promise<void>>();
export const advisorSnapshot = () => ring.map((r) => ({ ...r }));
export async function drainAdvisor() { while (pending.size) await Promise.allSettled([...pending]); }
export function resetAdvisor() { seen.clear(); ring.length = 0; }
export type AdvisorJob = AdvisorCtx & { key: string };
/** Pure planning: one job per (card id, grade, blocker set) for sub-B+/blocked cards, and per missed-scan flag with no card. */
export function planAdvisorJobs(inp: { cards: CardLite[]; books: BookInput[]; nowMs: number; brain: BrainView | null }): AdvisorJob[] {
  const m = ctMin(inp.nowMs); if (m < ACFG.startMinCt || m > ACFG.endMinCt) return [];
  const jobs: AdvisorJob[] = [];
  for (const b of inp.books) {
    const other = inp.books.find((x) => x.symbol !== b.symbol) ?? null;
    for (const side of ["long", "short"] as const) {
      const card = inp.cards.filter((c) => c.symbol === b.symbol && c.side === side).sort((x, y) => (y.q ?? 0) - (x.q ?? 0))[0] ?? null;
      if (card && (!bandAtLeast(card.pathBand) || !card.actionable || blockersOf(card).length)) {
        const key = `adv:card:${card.id}:${card.pathBand}:${blockersOf(card).join("|")}:${ctDay(inp.nowMs)}`;
        if (!seen.has(key)) jobs.push({ key, book: b, other, side, nowMs: inp.nowMs, card, brain: inp.brain });
      } else if (!card) {
        const f = missedScan(b, inp.nowMs).find((x) => x.side === side);
        const key = f ? `adv:new:${b.symbol}:${side}:${f.kind}:${f.level}:${ctDay(inp.nowMs)}` : "";
        if (f && !seen.has(key)) jobs.push({ key, book: b, other, side, nowMs: inp.nowMs, card: null, brain: inp.brain, flag: `${f.kind} ${f.detail}` });
      }
    }
  }
  return jobs.slice(0, ACFG.maxJobsPerPoll);
}
export function kickGrokAdvisor(inp: { cards: CardLite[]; books: BookInput[]; nowMs: number; brain: BrainView | null; env?: Env; fetchImpl?: Fetch; arraysOf?: (b: BookInput) => ArrayLite[]; pulses?: XPulse[]; dir?: string }): void {
  try {
    const env = inp.env ?? process.env; if (!advisorEnabled(env) || !env.XAI_API_KEY?.trim()) return;
    setTimeout(() => {
      const p = (async () => {
        const books = inp.arraysOf ? inp.books.map((b) => ({ ...b, arrays: b.arrays ?? inp.arraysOf!(b) })) : inp.books;
        for (const j of planAdvisorJobs({ ...inp, books })) {
          seen.add(j.key);
          const prompt = advisorPrompt(j); const est = estCostUsd(Math.ceil((ADVISOR_PACK.length + prompt.length) / 4), ACFG.maxOutputTokens);
          if (!reserveBudget(j.nowMs, est)) return;
          const t0 = Date.now();
          const r = await callXai(prompt, { env, fetchImpl: inp.fetchImpl, system: ADVISOR_PACK, maxTokens: ACFG.maxOutputTokens });
          const cost = r.inTok ? estCostUsd(r.inTok, r.outTok) : r.status === "ok" ? est : 0; settleBudget(cost - est);
          const a = r.status === "ok" ? parseAdvice(r.text, { symbol: j.book.symbol, side: j.side, card: j.card }) : null;
          log({ tag: "grok-advisor", mode: "shadow", key: j.key, status: r.status === "ok" && !a ? "malformed" : r.status, type: a?.type ?? null, ms: Date.now() - t0, costUsd: +cost.toFixed(6) });
          if (!a) continue;
          const row: AdviceRow = { ...a, id: `adv:${a.symbol}:${a.side}:${a.type}:${j.nowMs}`, at: j.nowMs, readAt: Date.now(), promptVersion: PROMPT_VERSION, mode: "shadow", cardId: j.card?.id ?? null,
            desk: j.card ? { grade: j.card.pathBand ?? null, q: j.card.q ?? null, actionable: Boolean(j.card.actionable), blockers: blockersOf(j.card) } : null,
            brain: j.brain ? `${j.brain.word ?? "?"} ${j.brain.symbol ?? ""} ${j.brain.side ?? ""}`.trim() : null, news: newsTag(j.nowMs, inp.pulses ?? []), costUsd: +cost.toFixed(6) };
          ring.unshift(row); if (ring.length > CFG.keepReads) ring.length = CFG.keepReads;
          log({ tag: "grok-advice", ...row });
          await routeAdvice(row, { env, fetchImpl: inp.fetchImpl, dir: inp.dir });
        }
      })().catch(() => {});
      pending.add(p); p.finally(() => pending.delete(p));
    }, 0);
  } catch { /* never into the desk */ }
}
function log(o: object) { try { console.log(JSON.stringify(o)); } catch { /* never */ } }
