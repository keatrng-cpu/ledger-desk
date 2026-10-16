/**
 * Offline backtest of advisor prompt v2 on the week's 122 moments (10/12–10/16). Shadow research.
 * Desk card state per moment comes ONLY from the logged cards.log/gates.log rows in the audit (diff_evidence.json);
 * a moment without a logged row gets "no card" (NEW_SETUP check). Uses XAI_API_KEY from env (never printed).
 * Hard cap --cap-usd (default 0.58). --dry prints the cost estimate and exits without calling.
 * Usage: npx tsx scripts/grok-advisor-replay.mts --in replay.json --ev diff_evidence.json --out adv.jsonl [--dry]
 */
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { callXai, resample, estCostUsd, type Bar, type CardLite } from "../src/lib/grok-reader/reader.ts";
import { ADVISOR_PACK, advisorPrompt, parseAdvice, PROMPT_VERSION } from "../src/lib/grok-reader/advisor.ts";
import { gradeAdvice } from "../src/lib/grok-reader/grade.ts";
import { mtfArrays } from "../src/lib/smc/mtf-arrays.ts";
import CFG from "../shared/grok-reader.json";
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DRY = process.argv.includes("--dry"), CAP = Number(arg("--cap-usd", "0.58"));
const rows = JSON.parse(readFileSync(arg("--in")!, "utf8")).rows as { day: string; sym: string; at: number; side: "long" | "short"; kind: string; entry: number; stop: number; t1: number; r: number }[];
const EV = JSON.parse(readFileSync(arg("--ev")!, "utf8")) as { evidence: { cards_row: string | null; gates_row?: string; brain?: string; card?: string; caps?: string[] } }[];
const ALL = JSON.parse(readFileSync(new URL("../tests/fixtures/bars-1m-2026-10-12_16.json", import.meta.url), "utf8")) as Record<string, Bar[]>;
const OUT = arg("--out")!;
const bookAt = (s: string, now: number) => { const m = ALL[s].filter((b) => b.t >= now - 5 * 86_400_000 && b.t + 60_000 <= now); const b15 = resample(m, 15).filter((b) => b.t + 900_000 <= now); return { symbol: s, minute: m, bars15: b15, arrays: mtfArrays(s, m as never, b15 as never) as never } as const; };
function cardOf(i: number, sym: string, side: string): { card: CardLite | null; brain: { word: string; symbol: string; side: string; q: null; vetoed: boolean } | null } {
  const e = EV[i]?.evidence; if (!e?.cards_row || !e.gates_row) return { card: null, brain: null };
  const g = e.gates_row.match(/(sig-\w+) band (\S+) q ([\d.]+) failing (\S+)/); const ent = e.card?.match(/entry ([\d.]+)/);
  const br = e.brain?.match(/^(\w+) (\S+) (\S+) missing '(.+)'$/);
  const card: CardLite = { id: g?.[1] ?? `ev${i}`, symbol: sym, side, pathBand: g?.[2], q: g ? +g[3] : null, actionable: false, entryPx: ent ? +ent[1] : null,
    missing: (g?.[4] ?? "").split(",").filter(Boolean), vetoes: br ? [`Brain: ${br[4]}`] : [], caps: [...new Set(e.caps ?? [])].map((c) => c.replace(/^\[[^\]]+\]\s*/, "")).slice(0, 4), reasons: [] };
  return { card, brain: br ? { word: br[1], symbol: br[2], side: br[3], q: null, vetoed: false } : null };
}
const jobs = rows.map((r, i) => { const now = Date.parse(`${r.day}T05:00:00Z`) + r.at * 60_000; const { card, brain } = cardOf(i, r.sym, r.side);
  const ctx = { book: bookAt(r.sym, now), other: bookAt(r.sym === "MNQ" ? "ES" : "MNQ", now), side: r.side, nowMs: now, card, brain, flag: card ? null : `${r.side} ${r.kind} (scan entry ${r.entry}, stop ${r.stop}, T1 ${r.t1})` };
  return { i, r, now, card, ctx, prompt: advisorPrompt(ctx) }; });
const est = jobs.reduce((a, j) => a + estCostUsd(Math.ceil((ADVISOR_PACK.length + j.prompt.length) / 3.6), 200), 0);
console.log(JSON.stringify({ moments: jobs.length, withCard: jobs.filter((j) => j.card).length, estUsd: +est.toFixed(4), cap: CAP }));
if (DRY) process.exit(0);
writeFileSync(OUT, ""); let spent = 0;
const q = [...jobs];
await Promise.all(Array.from({ length: 4 }, async () => { while (q.length) { const j = q.shift()!;
  const e1 = estCostUsd(Math.ceil((ADVISOR_PACK.length + j.prompt.length) / 3.6), CFG.advisor.maxOutputTokens);
  if (spent + e1 > CAP) { appendFileSync(OUT, JSON.stringify({ idx: j.i, status: "skipped-cap" }) + "\n"); continue; }
  spent += e1;
  const res = await callXai(j.prompt, { system: ADVISOR_PACK, maxTokens: CFG.advisor.maxOutputTokens, timeoutMs: 20_000 });
  const cost = res.inTok ? estCostUsd(res.inTok, res.outTok) : 0; spent += cost - e1;
  const a = res.status === "ok" ? parseAdvice(res.text, { symbol: j.r.sym, side: j.r.side, card: j.card }) : null;
  const gr = a && a.type !== "AGREE" ? gradeAdvice({ id: `${j.i}`, type: a.type, reasonCode: a.reasonCode, blocker: a.blocker, at: j.now, side: a.side, entry: a.entry, stop: a.stop, target: a.target }, ALL[j.r.sym]) : null;
  appendFileSync(OUT, JSON.stringify({ idx: j.i, promptVersion: PROMPT_VERSION, sym: j.r.sym, side: j.r.side, day: j.r.day, at: j.r.at, scanR: j.r.r, hadCard: Boolean(j.card), deskGrade: j.card?.pathBand ?? null, status: res.status === "ok" && !a ? "malformed" : res.status, inTok: res.inTok, outTok: res.outTok, cost, advice: a, grade: gr, raw: a ? undefined : (res.text ?? "").slice(0, 600) }) + "\n");
} }));
console.log(JSON.stringify({ spentUsd: +spent.toFixed(4) }));
