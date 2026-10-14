/**
 * deskSeq no-lookahead replay over the watcher's cards.log polls (10/13–10/14). For each poll, the tape is the
 * Yahoo 1m series (NQ=F for MNQ, ES=F for ES; labelled source "yahoo") cut to bars CLOSED at the poll's
 * now_ms (t + 60 s <= now_ms) — no later bar is read. Usage:
 *   npx tsx scripts/replay-desk-seq.mts [cards.log] [dataDir]
 * Read-only: no orders, no network.
 */
import { readFileSync } from "node:fs";
import { pdLegRead } from "../src/lib/smc/seq/pd-leg";
type B = { t: number; o: number; h: number; l: number; c: number };
const [cardsPath = "/workspace/desk-watcher/cards.log", dir = "/workspace/audits/seq-data"] = process.argv.slice(2);
const tape: Record<string, B[]> = { MNQ: JSON.parse(readFileSync(`${dir}/yahoo-1m-MNQ.json`, "utf8")), ES: JSON.parse(readFileSync(`${dir}/yahoo-1m-ES.json`, "utf8")) };
const upto = (sym: string, now: number): B[] => {
  const a = tape[sym]!; let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m]!.t + 60_000 <= now) lo = m + 1; else hi = m; }
  return a.slice(Math.max(0, lo - 3000), lo);
};
const et = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", hourCycle: "h23", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const out: Record<string, Record<string, number>> = {};
const inc = (fix: string, k: string) => { (out[fix] ??= {})[k] = (out[fix]![k] ?? 0) + 1; };
const samples: string[] = [];
const seen = new Set<string>();
for (const line of readFileSync(cardsPath, "utf8").split("\n")) {
  if (!line.trim()) continue;
  let d: any; try { d = JSON.parse(line); } catch { continue; }
  const now: number = d.now_ms; const c = d.card ?? {}; const w = c.wire ?? {};
  const s = w.strategy ?? {}; const brain = { ...(w.brain ?? {}), ...(c.brain ?? {}) };
  if (!s.symbol || !tape[s.symbol] || (s.side !== "long" && s.side !== "short")) continue;
  const key = `${Math.floor(now / 60_000)}:${s.symbol}:${s.side}:${s.entry}`; if (seen.has(key)) continue; seen.add(key); // one read per minute per card
  const bars = upto(s.symbol, now);
  if (bars.length < 30) { inc("data", "no-tape"); continue; }
  const day = et(now).slice(0, 5);
  // F6 — legacy pd_half for the SAME book only (brain graded this symbol)
  const sameBook = brain.symbol === s.symbol && brain.side === s.side;
  const legacyFail = sameBook && brain.missing === "POI in correct half";
  const r = pdLegRead({ side: s.side, poi: s.entry ?? null, price: bars.at(-1)!.c, closed1m: bars, feedNowMs: now, legacyFail });
  {
    const hm = et(now).slice(-5);
    if (!sameBook && day === "10/14" && s.symbol === "MNQ" && s.side === "short" && hm >= "09:45" && hm <= "10:10") samples.push(`${et(now)} MNQ short ${s.band} entry ${s.entry} leg ${r.leg?.lo}–${r.leg?.hi} POI ${r.atPoi?.zone} ${r.atPoi?.ratio} (brain on ${brain.symbol} ${brain.side} ${brain.word} "${brain.missing}")`);
  }
  if (sameBook) {
    inc("F6", `${day} same-book polls`);
    if (legacyFail) inc("F6", `${day} legacy pd_half FAIL`);
    if (legacyFail && r.pass) inc("F6", `${day} legacy FAIL → leg PASS`);
    if (!legacyFail && r.pass === false) inc("F6", `${day} legacy pass → leg FAIL`);
    if (r.noEdge) inc("F6", `${day} leg noEdge`);
    const hm = et(now).slice(-5);
    if (day === "10/14" && s.symbol === "MNQ" && s.side === "short" && hm >= "09:45" && hm <= "10:10") samples.push(`${et(now)} ${s.symbol} ${s.side} ${s.band} entry ${s.entry} leg ${r.leg?.lo}–${r.leg?.hi} POI ${r.atPoi?.zone} ${r.atPoi?.ratio} legacy ${legacyFail ? 'FAIL' : 'pass'} brain ${brain.symbol} ${brain.side}`);
  }
}
console.log(JSON.stringify(out, null, 1));
for (const x of samples) console.log(x);
