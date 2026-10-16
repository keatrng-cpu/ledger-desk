/**
 * Replay 10/12–10/16 (RTH, closed bars) of the Grok suggestion lane — SHADOW, offline, no network, no xAI calls.
 * Grok is PROXIED by the deterministic missed-setup pre-screen (the only thing that triggers a suggestion call) turned
 * into the strict JSON Grok must return: entry = price at the flag, stop = structural level, t1 = next opposing pool
 * (last-hour extreme, else 1.5R). Each suggestion goes through the same `reviewSuggestion` the live lane runs, with
 * readAt = flag + 3 s (assumed Grok round trip, inside the 4 s timeout). Outcome: first touch of stop (−1R) vs T1 (+rr1 R)
 * on 1m bars after the decision, else marked to the 15:00 CT close. Desk comparator: Rule 1 shadow tickets on the same bars.
 * Historic desk cards / brain words are not in the repo, so: (A) as specified — no brain TAKE known → B+ suggestions
 * can't fire; (B) upper bound — brain TAKE assumed on the suggestion's side.
 * Usage: npx tsx scripts/grok-suggest-replay.mts [--json]
 */
import { readFileSync } from "node:fs";
import { missedScan, resample, type Bar } from "../src/lib/grok-reader/reader.ts";
import { reviewSuggestion, validSuggestion, type GrokSuggestion } from "../src/lib/grok-reader/suggest.ts";
import { rule1Ticket } from "../src/lib/trading/rule1.ts";

const ALL = JSON.parse(readFileSync(new URL("../tests/fixtures/bars-1m-2026-10-12_16.json", import.meta.url), "utf8")) as Record<string, Bar[]>;
const DAYS = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
const GROK_RTT_MS = 3000;

export function proxySuggestion(sym: string, f: ReturnType<typeof missedScan>[number], m1: Bar[], at: number): GrokSuggestion | null {
  const closed = m1.filter((b) => b.t + 60_000 <= at);
  const entry = closed[closed.length - 1]?.c; if (entry == null) return null;
  const short = f.side === "short";
  const stop = short ? Math.max(f.level, entry) + 0.25 : Math.min(f.level, entry) - 0.25;
  const risk = Math.abs(entry - stop);
  const hour = closed.slice(-60);
  const pool = short ? Math.min(...hour.map((b) => b.l)) : Math.max(...hour.map((b) => b.h));
  const t1 = short ? (pool < entry - 0.5 * risk ? pool : entry - 1.5 * risk) : (pool > entry + 0.5 * risk ? pool : entry + 1.5 * risk);
  return validSuggestion({ symbol: sym, side: f.side, entry, stop, t1, setup: `${f.kind}: ${f.detail}`.slice(0, 200), confidence: 0.6 });
}
function outcome(side: string, entry: number, stop: number, t1: number, m1: Bar[], from: number, dayEnd: number) {
  const risk = Math.abs(entry - stop);
  for (const b of m1) {
    if (b.t < from || b.t > dayEnd) continue;
    const hitS = side === "short" ? b.h >= stop : b.l <= stop; const hitT = side === "short" ? b.l <= t1 : b.h >= t1;
    if (hitS) return { r: -1, how: "stop" };            // conservative: stop first when both print in one bar
    if (hitT) return { r: +(Math.abs(t1 - entry) / risk).toFixed(2), how: "t1" };
  }
  const last = m1.filter((b) => b.t <= dayEnd).pop()!;
  return { r: +(((side === "short" ? entry - last.c : last.c - entry) / risk)).toFixed(2), how: "eod" };
}

export function replay() {
  const sugg: any[] = []; const desk: any[] = [];
  for (const sym of ["MNQ", "ES"]) {
    const m1 = ALL[sym]; const b15 = resample(m1, 15);
    for (const day of DAYS) {
      const base = Date.parse(`${day}T05:00:00Z`);   // 00:00 CT (CDT, UTC-5)
      if (!m1.some((b) => b.t >= base + 510 * 60_000 && b.t < base + 900 * 60_000)) continue;
      const dayEnd = base + 900 * 60_000;
      const seen = new Set<string>();
      for (let min = 510; min <= 900; min += 5) {
        const now = base + min * 60_000; if (now > m1[m1.length - 1].t) break;
        const w1 = m1.filter((b) => b.t >= now - 3 * 86_400_000 && b.t < now + 60_000);
        const w15 = b15.filter((b) => b.t >= now - 3 * 86_400_000 && b.t < now);
        const today1 = w1.filter((b) => b.t >= base);
        for (const f of missedScan({ symbol: sym, minute: w1, bars15: w15 }, now)) {
          const sk = `${f.side}:${f.kind}:${f.level}`; if (seen.has(sk)) continue; seen.add(sk);   // same dedupe as the live lane
          const s = proxySuggestion(sym, f, w1, now); if (!s) continue;
          const readAt = now + GROK_RTT_MS;
          const t0 = performance.now();
          const A = reviewSuggestion(s, { minute: w1, bars15: w15, nowMs: readAt, readAt, flag: f, deskCards: [], brain: null });
          const B = reviewSuggestion(s, { minute: w1, bars15: w15, nowMs: readAt, readAt, flag: f, deskCards: [], brain: { word: "TAKE", symbol: sym, side: s.side, q: 0.6, vetoed: false } });
          const reviewMs = (performance.now() - t0) / 2;
          const o = outcome(s.side, s.entry, B.stop, B.t1, m1, readAt, dayEnd);
          sugg.push({ day, sym, at: min, side: s.side, kind: f.kind, entry: s.entry, stop: B.stop, t1: B.t1, rr1: B.rr1, fireA: A.decision === "would-fire", fireB: B.decision === "would-fire", failed: B.checks.filter((c) => !c.pass).map((c) => c.id), r: o.r, how: o.how, reviewMs });
        }
        const tk = rule1Ticket(sym, w1.filter((b) => b.t >= now - 30 * 3_600_000) as never, now);
        if (tk && !seen.has(`${tk.side}${tk.at}`)) { seen.add(`${tk.side}${tk.at}`); const o = outcome(tk.side, tk.entry, tk.stop, tk.target, m1, now, dayEnd); desk.push({ day, sym, at: min, side: tk.side, r: o.r, how: o.how }); }
      }
    }
  }
  const stat = (xs: { r: number }[]) => ({ n: xs.length, wins: xs.filter((x) => x.r > 0).length, losses: xs.filter((x) => x.r <= 0).length, netR: +xs.reduce((a, x) => a + x.r, 0).toFixed(2), avgR: xs.length ? +(xs.reduce((a, x) => a + x.r, 0) / xs.length).toFixed(3) : 0 });
  const rev = sugg.map((s) => s.reviewMs).sort((a, b) => a - b);
  return {
    suggestions: sugg.length,
    wouldFireA_asSpecified: stat(sugg.filter((s) => s.fireA)),
    wouldFireB_brainTakeAssumed: stat(sugg.filter((s) => s.fireB)),
    allSuggestions: stat(sugg),
    deskRule1Shadow: stat(desk),
    noFireReasons: Object.entries(sugg.filter((s) => !s.fireB).flatMap((s) => s.failed).reduce((m: any, k: string) => ((m[k] = (m[k] ?? 0) + 1), m), {})),
    perDay: DAYS.map((d) => ({ day: d, sugg: sugg.filter((s) => s.day === d).length, fireB: sugg.filter((s) => s.day === d && s.fireB).length, netRB: +sugg.filter((s) => s.day === d && s.fireB).reduce((a, s) => a + s.r, 0).toFixed(2) })),
    latency: { grokRttAssumedMs: GROK_RTT_MS, deskReviewP50Ms: +rev[Math.floor(rev.length / 2)].toFixed(3), deskReviewMaxMs: +rev[rev.length - 1].toFixed(3) },
    rows: sugg, desk,
  };
}
if (process.argv[1]?.endsWith("grok-suggest-replay.mts") && !process.argv.includes("--test")) {
  const r = replay();
  const { rows, desk, ...sum } = r;
  console.log(JSON.stringify(process.argv.includes("--json") ? r : sum, null, 1));
}
