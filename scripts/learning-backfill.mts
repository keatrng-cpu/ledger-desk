/**
 * Backfill the learning journal from TODAY's watcher logs + saved card
 * snapshots, graded against real Yahoo 1m bars (the desk's hole-fill feed).
 * Only fields the logs actually carry are used; anything missing is null.
 * Usage: npx tsx scripts/learning-backfill.mts <watcher.log> <snapsDir> <yahooDir> <out.json>
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import * as L from "../src/lib/desk/learning";
import { rollingAtr } from "../src/lib/trading/detectors";

const [logPath, snapsDir, ydir, out] = process.argv.slice(2);
type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
function bars(sym: string, iv: string): Bar[] {
  const r = JSON.parse(readFileSync(`${ydir}/y_${sym}_${iv}.json`, "utf8")).chart.result[0];
  const q = r.indicators.quote[0];
  return r.timestamp.map((t: number, i: number) => ({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] ?? 0 }))
    .filter((b: Bar) => [b.o, b.h, b.l, b.c].every((x) => x != null && Number.isFinite(x)));
}
const B1 = { MNQ: bars("MNQ", "1m"), ES: bars("ES", "1m") } as Record<string, Bar[]>;
const B15 = { MNQ: bars("MNQ", "15m"), ES: bars("ES", "15m") } as Record<string, Bar[]>;
const atrAt = (sym: string, ms: number) => { const b = B15[sym]!.filter((x) => x.t + 900_000 <= ms); const a = rollingAtr(b as never); return a.length ? +a[a.length - 1]!.toFixed(2) : null; };
const num = (s: unknown) => { const m = typeof s === "string" ? s.match(/Stop\s+(\d+(?:\.\d+)?)/) : null; return m ? Number(m[1]) : null; };

const rows: (L.SnapCard & { openedMs: number; grade: L.Grade | null; src: string })[] = [];
const seen = new Set<string>();
function add(at: number, s: Record<string, any>, src: string) {
  const q = Number(s.q), qRaw = s.qRaw != null ? Number(s.qRaw) : null;
  if (!(q >= L.SNAP_MIN_Q || (qRaw ?? 0) >= L.SNAP_MIN_Q) || !s.symbol || !s.side) return;
  const setup = `${s.strategy ?? s.name ?? "none"}/${s.regimeLabel ?? s.regime ?? "?"}`;
  const key = `${s.symbol}:${s.side}:${setup}`;
  if (seen.has(key)) return;
  seen.add(key);
  const sym = s.symbol as string;
  const price = s.tape_prices?.[sym] ?? s.price ?? null;
  const entry = typeof s.entry === "number" ? s.entry : null;
  const stop = typeof s.stopPx === "number" ? s.stopPx : entry != null ? num(s.strategy_stop ?? s.stop) : null;
  const target = typeof s.target === "number" ? s.target : null;
  const c: L.SnapCard = {
    symbol: sym, side: s.side, setup, band: s.band ?? null, q, qRaw, price, atr: atrAt(sym, at), entry, stop, target,
    present: [], missing: s.brain_missing ? [String(s.brain_missing)] : [],
    checklist: [{ name: "actionable", ok: Boolean(s.actionable) }, { name: "Floor not STAND", ok: (s.verdict ?? s.floor) !== "STAND" }, { name: "brain TAKE", ok: s.brain_word === "TAKE" }],
    ctx: { chop: s.chop ?? null, bias1h: s.bias1h ?? null, bias4h: s.bias4h ?? null, entryResting: s.entryResting ?? false, brain: s.brain_word ?? null, floor: s.verdict ?? null, blocks: s.blocks ?? [], killzone: s.killzone ?? null, source: src, capReasons: [] },
  };
  const now = Date.now();
  const b = B1[sym]!;
  let g: L.Grade | null = null;
  if (c.entry != null && c.stop != null && c.target != null) g = L.gradePlan({ side: c.side, entry: c.entry, stop: c.stop, target: c.target, resting: Boolean(c.ctx.entryResting) }, at, b as never, now);
  else if (c.price != null && c.atr) g = L.gradeDirection({ side: c.side, price: c.price, atr: c.atr }, at, b as never, now);
  rows.push({ ...c, openedMs: at, grade: g, src });
}
for (const line of readFileSync(logPath, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const w = JSON.parse(line);
  if (w.snap?.ok && w.snap.at) add(Date.parse(w.snap.at), w.snap, `watcher:${w.kind}`);
}
for (const f of readdirSync(snapsDir).filter((x) => x.endsWith(".json"))) {
  try {
    const d = JSON.parse(readFileSync(`${snapsDir}/${f}`, "utf8"));
    const s = d.wire?.strategy; if (!s) continue;
    const at = Date.parse(d.at ?? d.fetchedAt ?? d.wire?.at ?? "");
    if (!Number.isFinite(at)) continue;
    add(at, { ...s, price: d.quotes?.[d.quotes?.left?.symbol === s.symbol ? "left" : "right"]?.price, brain_word: d.wire?.brain?.word, verdict: d.wire?.floor?.verdict, blocks: d.wire?.floor?.blocks }, `snap:${f}`);
  } catch { /* unreadable snapshot: skipped, not guessed */ }
}
rows.sort((a, b) => a.openedMs - b.openedMs);
writeFileSync(out!, JSON.stringify({ note: "Backfill 2026-10-13 from desk-watcher logs + saved card snapshots; graded on Yahoo 1m (MNQ=F, ES=F). Unresolved = open.", builtAt: new Date().toISOString(), rows }, null, 1));
const st: Record<string, number> = {};
for (const r of rows) st[r.grade?.status ?? "none"] = (st[r.grade?.status ?? "none"] ?? 0) + 1;
console.log(rows.length, st);
for (const r of rows) console.log(new Date(r.openedMs).toISOString().slice(11, 16), r.symbol, r.side, r.band, r.q, r.setup, r.grade?.kind, r.grade?.status, JSON.stringify((r.grade as any)?.moves ?? (r.grade as any)?.r), L.failureMode(r, r.grade ?? ({ status: "open" } as never)) ?? "");
