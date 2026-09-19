/**
 * Real-tape figures for the bias-conflict module, found with the ENGINE.
 *
 * The three conflict scenarios cannot be found geometrically: they are about
 * what structure.ts concluded — three timeframes agreeing, or the vote saying
 * bull while price sat in premium with the mid timeframe already bear, so the
 * desk forced NEUTRAL. So this runs analyzeStructure() over the captured
 * history at the live 800-bar horizon and keeps the moments where each read
 * actually occurred. The caption states the engine's own numbers.
 *
 * The override is recomputed the way structure.ts computes it (majority of
 * daily / mid / last-BOS, then the two premium/discount overrides), and a
 * moment only qualifies as "override" if the vote and the published topDown
 * genuinely disagree in the direction the override explains. A figure that
 * merely LOOKED like an override would teach the rule from a coincidence.
 *
 * Merges into src/data/learn-figures.json after the Python builder has run.
 * Run: npx tsx scripts/build-learn-conflicts.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const { analyzeStructure } = await import("../src/lib/trading/structure.ts");

const HIST = JSON.parse(readFileSync("src/data/learn-history.json", "utf8"));
const FIGS = JSON.parse(readFileSync("src/data/learn-figures.json", "utf8"));
const HORIZON = 800;
const SHOW = 32;

const ET = (t) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(t));
const nyRth = (t) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(t));
  const m = Number(p.find((x) => x.type === "hour").value) * 60 + Number(p.find((x) => x.type === "minute").value);
  return m >= 9 * 60 + 30 && m <= 16 * 60;
};
const dayKey = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(t));
function dayChangePct(slice) {
  const last = slice[slice.length - 1];
  const k = dayKey(last.t);
  for (const b of slice) if (dayKey(b.t) === k) return b.o > 0 ? ((last.c - b.o) / b.o) * 100 : 0;
  return 0;
}
function vote(...vs) {
  let bull = 0, bear = 0;
  for (const v of vs) { if (v === "bull") bull++; if (v === "bear") bear++; }
  return bull > bear ? "bull" : bear > bull ? "bear" : "neutral";
}
const stamp = (bars, sym) => {
  const a = new Date(bars[0].t), b = new Date(bars[bars.length - 1].t);
  const f = (d, o) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", ...o }).format(d);
  return `${sym} 15m · ${f(a, { weekday: "short", month: "short", day: "numeric" })} ${f(a, { hour: "2-digit", minute: "2-digit", hour12: false })}–${f(b, { hour: "2-digit", minute: "2-digit", hour12: false })} ET`;
};

const found = {};
for (const [symbol, sym] of [["ES", "ESU6"], ["MNQ", "NQU6"]]) {
  const bars = HIST.bars[symbol];
  for (let i = 200; i < bars.length; i += 2) {
    const now = bars[i];
    if (!nyRth(now.t)) continue;
    const slice = bars.slice(Math.max(0, i + 1 - HORIZON), i + 1);
    const r = analyzeStructure(symbol, slice, dayChangePct(slice));
    if (!r.dealing) continue;
    const v = vote(r.daily, r.mid, r.lastBOS?.direction ?? "neutral");
    const zone = r.dealing.zone;
    // The dealing range is read over a longer lookback than a figure shows.
    // A level drawn off the visible tape is meaningless (and the verifier
    // refuses it), so widen the window until the range's high and low are
    // both on screen; skip the moment if even 96 bars cannot hold it.
    let view = null;
    for (const n of [SHOW, 48, 64, 96]) {
      const w = bars.slice(Math.max(0, i + 1 - n), i + 1);
      const hi = Math.max(...w.map((b) => b.h));
      const lo = Math.min(...w.map((b) => b.l));
      if (hi >= r.dealing.high - 0.05 && lo <= r.dealing.low + 0.05) { view = w; break; }
    }
    if (!view) continue;
    const base = {
      bars: view.map((b) => ({ o: b.o, h: b.h, l: b.l, c: b.c, t: b.t })),
      symbol: sym,
      stamp: stamp(view, sym),
      range: { high: r.dealing.high, low: r.dealing.low, eq: r.dealing.eq },
      read: `daily ${r.daily} · mid ${r.mid} · last BOS ${r.lastBOS?.direction ?? "none"} · vote ${v} · price in ${zone} · published ${r.topDown} · confidence ${(r.confidence * 100).toFixed(0)}%`,
      conf: r.confidence,
      t: now.t,
    };

    // Aligned: unanimous, not neutral, high confidence.
    if (r.daily !== "neutral" && r.daily === r.mid && r.mid === (r.lastBOS?.direction ?? null) && r.topDown === r.daily) {
      if (!found["conflict-aligned"] || r.confidence > found["conflict-aligned"].conf) found["conflict-aligned"] = base;
    }
    // Premium override: vote bull, mid bear, premium, published neutral.
    if (v === "bull" && r.mid === "bear" && zone === "premium" && r.topDown === "neutral") {
      if (!found["conflict-premium-override"]) found["conflict-premium-override"] = base;
    }
    // Discount override: mirror.
    if (v === "bear" && r.mid === "bull" && zone === "discount" && r.topDown === "neutral") {
      if (!found["conflict-discount-override"]) found["conflict-discount-override"] = base;
    }
  }
}

const captions = {
  "conflict-aligned": "Three votes, one direction, and the published read agrees. This is what high confidence looks like on real tape.",
  "conflict-premium-override": "The vote said BULL. Price was in premium and the mid timeframe had turned bear, so the desk published NEUTRAL. The override, on real tape.",
  "conflict-discount-override": "The vote said BEAR. Price was in discount and the mid timeframe had turned bull, so the desk published NEUTRAL. The mirror override, on real tape.",
};

let added = 0;
for (const [id, hit] of Object.entries(found)) {
  const { range } = hit;
  const last = hit.bars[hit.bars.length - 1];
  const marks = [
    { kind: "zone", top: range.high, bottom: range.eq, label: "premium", tone: "bad" },
    { kind: "zone", top: range.eq, bottom: range.low, label: "discount", tone: "good" },
    { kind: "level", price: range.eq, label: `EQ ${range.eq.toFixed(2)}`, tone: "neutral", dash: true },
    { kind: "point", bar: hit.bars.length - 1, price: last.c, label: "price is here", tone: "accent" },
  ];
  FIGS.figures[id] = {
    id,
    caption: `${captions[id]}  ${hit.read}.  ${hit.stamp}`,
    bars: hit.bars,
    marks,
    stamp: hit.stamp,
    symbol: hit.symbol,
  };
  added++;
  console.log(id, hit.stamp, "|", hit.read);
}

const missing = ["conflict-aligned", "conflict-premium-override", "conflict-discount-override"].filter((k) => !found[k]);
if (missing.length) console.error("not found on this tape:", missing.join(", "));

writeFileSync("src/data/learn-figures.json", JSON.stringify(FIGS));
console.log(`merged ${added} engine-derived figures → ${Object.keys(FIGS.figures).length} total`);
