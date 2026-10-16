/**
 * Real-Grok replay of the 10/12–10/16 suggestion moments (research; shadow). Uses the box env XAI_API_KEY via the
 * reader's callXai (never printed). Hard spend cap (--cap-usd, default 2). Each moment gets the knowledge pack +
 * the same 1m/5m/15m/1h/4h OHLC, levels and arrays the desk uses, plus the scan's flag, and Grok answers in strict JSON.
 * Output: JSON lines to --out. Usage: npx tsx scripts/grok-real-replay.mts --in replay.json --out grok.jsonl [--cap-usd 2]
 */
import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { callXai, mtfSummary, resample, estCostUsd as xaiCost, type Bar } from "../src/lib/grok-reader/reader.ts";
import { SMC_PACK } from "../src/lib/grok-reader/knowledge.ts";
const PROVIDER = (process.argv.includes("--claude") ? "claude" : "grok") as "claude" | "grok";
const CLAUDE_MODEL = "claude-sonnet-5";   // repo's coach model (src/lib/coach/claude-server.ts); $2 in / $10 out per MTok
const estCostUsd = (i: number, o: number) => PROVIDER === "claude" ? (i * 2 + o * 10) / 1e6 : xaiCost(i, o);
async function callClaude(user: string, timeoutMs: number) {
  const key = process.env.ANTHROPIC_API_KEY?.trim(); if (!key) return { status: "nokey" as const, text: null, inTok: 0, outTok: 0 };
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: ac.signal, headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", ...(process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : {}) },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 400, temperature: 0.2, system: SMC_PACK, messages: [{ role: "user", content: user }] }) });
    if (!res.ok) return { status: "error" as const, text: `http ${res.status} ${(await res.text()).slice(0, 200)}`, inTok: 0, outTok: 0 };
    const j = await res.json() as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    return { status: "ok" as const, text: (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("").trim(), inTok: j.usage?.input_tokens ?? 0, outTok: j.usage?.output_tokens ?? 0 };
  } catch (e) { return { status: ac.signal.aborted ? "timeout" as const : "error" as const, text: String(e).slice(0, 120), inTok: 0, outTok: 0 }; } finally { clearTimeout(tm); }
}
import { parseGrokJson } from "../src/lib/grok-reader/suggest.ts";
import { mtfArrays } from "../src/lib/smc/mtf-arrays.ts";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const IN = arg("--in")!, OUT = arg("--out")!, CAP = Number(arg("--cap-usd", "2"));
const rows = JSON.parse(readFileSync(IN, "utf8")).rows as { day: string; sym: string; at: number; side: string; kind: string; entry: number; stop: number; t1: number; r: number; fireB: boolean }[];
const ALL = JSON.parse(readFileSync(new URL("../tests/fixtures/bars-1m-2026-10-12_16.json", import.meta.url), "utf8")) as Record<string, Bar[]>;
writeFileSync(OUT, "");
let spent = 0, calls = 0;
async function one(r: (typeof rows)[number], idx: number) {
  const now = Date.parse(`${r.day}T05:00:00Z`) + r.at * 60_000;
  const m1 = ALL[r.sym].filter((b) => b.t >= now - 3 * 86_400_000 && b.t + 60_000 <= now);
  const b15 = resample(m1, 15).filter((b) => b.t + 900_000 <= now);
  const arrays = (mtfArrays(r.sym, m1 as never, b15 as never) as never as { tf: string; kind: string; dir: "bull" | "bear"; lo: number; hi: number; ce: number; mitigated: boolean; ageBars: number }[]);
  const ctx = mtfSummary({ symbol: r.sym, minute: m1, bars15: b15, arrays }, now);
  const prompt = `MISSED-SETUP CHECK at ${String(Math.floor(r.at / 60)).padStart(2, "0")}:${String(r.at % 60).padStart(2, "0")} CT ${r.day}. A mechanical scan flagged: ${r.side} ${r.kind} (scan entry ${r.entry}, structural stop ${r.stop}, T1 ${r.t1}). The desk has NO actionable card. Judge independently with SMC/ICT: if it is a valid setup that is still near entry, return a suggestion with YOUR levels; if it is not valid (chop, wrong half, no displacement, late, against HTF), return suggestion null and say why in read.note.\n\n${ctx}`;
  const est = estCostUsd(Math.ceil((5200 + prompt.length) / 4), 400);
  if (spent + est > CAP) return { idx, skipped: "cap" };
  spent += est; calls++;
  const t0 = performance.now();
  const res = PROVIDER === "claude" ? await callClaude(prompt, 30_000) : await callXai(prompt, { timeoutMs: 20_000 });
  const ms = Math.round(performance.now() - t0);
  const cost = res.inTok ? estCostUsd(res.inTok, res.outTok) : est; spent += cost - est;
  const p = res.status === "ok" ? parseGrokJson(res.text) : null;
  const rec = { provider: PROVIDER, idx, day: r.day, sym: r.sym, at: r.at, scanSide: r.side, kind: r.kind, scanR: r.r, fireB: r.fireB, status: res.status === "ok" && !p ? "malformed" : res.status, ms, inTok: res.inTok, outTok: res.outTok, cost, suggestion: p?.suggestion ?? null, note: (p?.read as { note?: string } | null)?.note ?? null, setup: (p?.read as { setup?: string } | null)?.setup ?? null, raw: p ? undefined : (res.text ?? "").slice(0, 3000) };
  appendFileSync(OUT, JSON.stringify(rec) + "\n");
  return rec;
}
const q = rows.map((r, i) => [r, i] as const); const conc = 4;
await Promise.all(Array.from({ length: conc }, async () => { while (q.length) { const [r, i] = q.shift()!; try { await one(r, i); } catch (e) { appendFileSync(OUT, JSON.stringify({ idx: i, status: "error", err: String(e).slice(0, 120) }) + "\n"); } } }));
console.log(JSON.stringify({ calls, spentUsd: +spent.toFixed(4) }));
