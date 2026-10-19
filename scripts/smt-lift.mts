/**
 * SMT lift measurement (#4) — does the FAILING book reverse when SMT divergence
 * fires, more often than base rate? `componentFirePct.smt = 0` — SMT has never been
 * measured on the capture, yet it caps continuations and feeds the lead. This
 * quantifies its directional edge so it's kept only if it discriminates.
 *
 * ICT SMT: when one index makes a new extreme the other fails to confirm, trade the
 * FAILING book — short on bearish divergence, long on bullish. This steps the two
 * books through history, computes the desk's own `buildMtfContext().smtLead` at each
 * point, and measures the failing book's realized direction over a forward horizon
 * vs the unconditional base rate. lift = SMT hit − base.
 *
 * Data: Yahoo 1m (NQ=F + ES=F), no local files. --selftest runs synthetic.
 * Usage: npx tsx scripts/smt-lift.mts [days=15] [--horizon 60] [--step 15] [--md out.md]
 */
import { writeFileSync } from "node:fs";
import { buildMtfContext } from "../src/lib/smc/mtf-context";
import { et } from "../src/lib/smc/day-context";

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
const args = process.argv.slice(2);
const argN = (f: string, d: number) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? Number(args[i + 1]) : d; };
const selftest = args.includes("--selftest");
const days = Math.min(30, Math.max(5, Number(args.find((a) => /^\d+$/.test(a)) ?? 15)));
const HORIZON = argN("--horizon", 60); // minutes forward
const STEP = argN("--step", 15); // minutes between samples
const mdPath = args.includes("--md") ? args[args.indexOf("--md") + 1]! : null;

async function yahoo(sym: string): Promise<Bar[]> {
  const now = Math.floor(Date.now() / 1000); const out: Bar[] = []; const span = Math.ceil((days * 1.5 + 2) / 7);
  for (let k = span; k >= 1; k--) {
    const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&period1=${now - k * 7 * 86400}&period2=${now - (k - 1) * 7 * 86400}&includePrePost=true`;
    const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0" } }).catch(() => null);
    if (!r?.ok) continue; const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) continue; const q = res.indicators.quote[0];
    out.push(...res.timestamp.map((t: number, i: number) => ({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] ?? 0 })).filter((b: Bar) => [b.o, b.h, b.l, b.c].every((x) => x != null)));
  }
  const m = new Map(out.map((b) => [b.t, b])); return [...m.values()].sort((a, b) => a.t - b.t);
}
function resample(m1: Bar[], ms: number): Bar[] {
  const out: Bar[] = [];
  for (const b of m1) { const k = Math.floor(b.t / ms) * ms; const L = out[out.length - 1]; if (L && L.t === k) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; L.v += b.v; } else out.push({ t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }); }
  return out;
}
function synth(start: number, trend: number, phase: number): Bar[] {
  const out: Bar[] = []; let p = 20000;
  for (let k = 0; k < 400; k++) { const t = start + k * 60_000; const d = trend * Math.sin(k / 20 + phase); const o = p, c = p + d; out.push({ t, o, h: Math.max(o, c) + 2, l: Math.min(o, c) - 2, c, v: 100 }); p = c; }
  return out;
}

function run2(mnq: Bar[], es: Bar[]) {
  const priceAt = (bars: Bar[], t: number) => { let v: number | null = null; for (const b of bars) { if (b.t > t) break; v = b.c; } return v; };
  const byT = (bars: Bar[], t: number) => bars.filter((b) => b.t <= t);
  const fires: { right: boolean; tf: string; kind: string }[] = [];
  let baseDown = 0, baseUp = 0, baseN = 0;
  const allT = [...new Set([...mnq, ...es].map((b) => b.t))].sort((a, b) => a - b);
  let lastSample = 0;
  for (const t of allT) {
    const e = et(t); if (e.min < 570 || e.min > 960) continue; // RTH
    if (t - lastSample < STEP * 60_000) continue; lastSample = t;
    // base rate: both books' realized direction over the horizon
    for (const bars of [mnq, es]) { const p0 = priceAt(bars, t); const p1 = priceAt(bars, t + HORIZON * 60_000); if (p0 != null && p1 != null) { baseN++; if (p1 < p0) baseDown++; else if (p1 > p0) baseUp++; } }
    const L = { symbol: "MNQ", minute: byT(mnq, t), bars15: resample(byT(mnq, t), 900_000) };
    const R = { symbol: "ES", minute: byT(es, t), bars15: resample(byT(es, t), 900_000) };
    if (L.minute.length < 40 || R.minute.length < 40) continue;
    let ctx; try { ctx = buildMtfContext(L, R); } catch { continue; }
    const s = ctx.smtLead; if (!s) continue;
    const bars = s.failing === "ES" ? es : mnq;
    const p0 = priceAt(bars, t), p1 = priceAt(bars, t + HORIZON * 60_000);
    if (p0 == null || p1 == null) continue;
    const predictedDown = s.kind === "bearish"; // short the failing book
    const right = predictedDown ? p1 < p0 : p1 > p0;
    fires.push({ right, tf: s.tf, kind: s.kind });
  }
  return { fires, baseDown, baseUp, baseN };
}

async function run() {
  let data: { mnq: Bar[]; es: Bar[] };
  if (selftest) {
    // ES leads up, MNQ fails (bullish SMT on MNQ) across synthetic sessions
    const mnq: Bar[] = [], es: Bar[] = [];
    for (let d = 0; d < 3; d++) { const s = Date.UTC(2026, 0, 6 + d, 14, 30); mnq.push(...synth(s, 4, 0)); es.push(...synth(s, 4, 0.6)); }
    data = { mnq, es };
  } else {
    const [mnq, es] = await Promise.all([yahoo("NQ=F"), yahoo("ES=F")]);
    if (!mnq.length || !es.length) { console.error("no bars"); process.exit(1); }
    data = { mnq, es };
  }
  const { fires, baseDown, baseUp, baseN } = run2(data.mnq, data.es);
  const n = fires.length, right = fires.filter((f) => f.right).length;
  const hit = n ? +(right / n).toFixed(3) : null;
  const bearN = fires.filter((f) => f.kind === "bearish");
  const bullN = fires.filter((f) => f.kind === "bullish");
  const baseDownRate = baseN ? +(baseDown / baseN).toFixed(3) : null;
  const baseUpRate = baseN ? +(baseUp / baseN).toFixed(3) : null;
  // the matched base: bearish calls bet on "down", bullish on "up"
  const matchedBase = n ? +(((bearN.length * (baseDownRate ?? 0.5)) + (bullN.length * (baseUpRate ?? 0.5))) / n).toFixed(3) : null;
  const lift = hit != null && matchedBase != null ? +(hit - matchedBase).toFixed(3) : null;
  const report = {
    horizonMin: HORIZON, stepMin: STEP, days: selftest ? "synthetic" : days,
    smtFires: n, smtHit: hit,
    bearish: { n: bearN.length, hit: bearN.length ? +(bearN.filter((f) => f.right).length / bearN.length).toFixed(3) : null },
    bullish: { n: bullN.length, hit: bullN.length ? +(bullN.filter((f) => f.right).length / bullN.length).toFixed(3) : null },
    baseDownRate, baseUpRate, matchedBase, lift,
    verdict: lift == null ? "no fires" : lift > 0.03 ? "SMT adds edge — keep/weight" : lift < -0.03 ? "SMT hurts — drop or invert" : "no measurable edge — do not weight",
  };
  writeFileSync("ai/smt-lift.json", JSON.stringify(report, null, 2));
  const md = [
    `### SMT lift (horizon ${HORIZON}m, step ${STEP}m${selftest ? ", synthetic" : `, ${days}d`})`, "",
    `SMT fires: ${n} · hit ${hit}`,
    `  bearish (short failing): n=${report.bearish.n} hit ${report.bearish.hit}`,
    `  bullish (long failing):  n=${report.bullish.n} hit ${report.bullish.hit}`,
    `base: down ${baseDownRate} · up ${baseUpRate} · matched ${matchedBase}`,
    `**lift: ${lift}** → ${report.verdict}`,
  ].join("\n");
  if (mdPath) writeFileSync(mdPath, md);
  console.log(md);
}
run().catch((e) => { console.error(e); process.exit(1); });
