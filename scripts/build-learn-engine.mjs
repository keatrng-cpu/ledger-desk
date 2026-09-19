/**
 * Real-tape figures found with the ENGINE rather than by geometry.
 *
 * Three kinds live here:
 *   - bias-conflict: what structure.ts CONCLUDED at a moment (a unanimous
 *     read; the premium/discount override forcing NEUTRAL against the vote).
 *   - arrays: an inverted FVG that was then retested, and an order block
 *     that was returned to and delivered from — found with buildSmcTape, so
 *     the drawn zone is exactly what the desk would have drawn.
 *   - time: a 09:30 Judas swing, found geometrically but placed here because
 *     it depends on the ET clock the desk uses.
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
const { buildSmcTape } = await import("../src/lib/trading/smc-board.ts");

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

/* ── Arrays, from the desk's own detector ─────────────────────────────── */

const idxAt = (bars, t) => bars.findIndex((b) => b.t === t);
const touches = (b, z) => b.h >= z.bottom && b.l <= z.top;

for (const [symbol, sym] of [["ES", "ESU6"], ["MNQ", "NQU6"]]) {
  const bars = HIST.bars[symbol];
  // Scan in windows so each tape is a slice the desk could have seen.
  for (let end = 400; end < bars.length && (!found.ifvg || !found.ob); end += 40) {
    const slice = bars.slice(Math.max(0, end - HORIZON), end);
    const tape = buildSmcTape(slice);

    if (!found.ifvg) {
      // Inverted AND retested, on 15m, with the original gap in view.
      const cand = tape.arrays.filter((a) => a.kind === "ifvg" && a.tf === "15m" && a.state === "partial");
      for (const a of cand) {
        const base = tape.arrays.find((x) => x.kind === "fvg" && x.tf === "15m" && Math.abs(x.top - a.top) < 0.01 && Math.abs(x.bottom - a.bottom) < 0.01);
        if (!base) continue;
        const iCreate = idxAt(slice, base.t);
        const iInvert = idxAt(slice, a.t);
        if (iCreate < 0 || iInvert < 0 || iInvert <= iCreate) continue;
        // Retest: first bar after the inversion whose range enters the gap.
        let iRetest = -1;
        for (let j = iInvert + 1; j < Math.min(slice.length, iInvert + 16); j++) {
          if (touches(slice[j], a)) { iRetest = j; break; }
        }
        if (iRetest < 0) continue;
        const from = Math.max(0, iCreate - 6);
        const to = Math.min(slice.length, iRetest + 6);
        if (to - from < 12 || to - from > 60) continue;
        const view = slice.slice(from, to);
        const invBar = slice[iInvert];
        const retBar = slice[iRetest];
        // The inversion must have CLOSED through the gap — that is what inverts it.
        const closedThrough = base.side === "bull" ? invBar.c < a.bottom : invBar.c > a.top;
        if (!closedThrough) continue;
        found.ifvg = {
          bars: view.map((b) => ({ o: b.o, h: b.h, l: b.l, c: b.c, t: b.t })),
          symbol: sym,
          stamp: stamp(view, sym),
          marks: [
            { kind: "zone", top: a.top, bottom: a.bottom, label: `${base.side} FVG → ${a.side} iFVG`, tone: "accent", from: iCreate - from },
            { kind: "point", bar: iInvert - from, price: invBar.c, label: "closed through — inverted", tone: "bad" },
            { kind: "point", bar: iRetest - from, price: base.side === "bull" ? retBar.h : retBar.l, label: base.side === "bull" ? "retested as resistance" : "retested as support", tone: "good" },
          ],
          caption: `A ${base.side} fair value gap that price closed THROUGH. The failed gap flips: it is now a ${a.side} array, and the first return to it is the entry the desk grades.`,
        };
        break;
      }
    }

    if (!found.ob) {
      // The detector keeps FRESH blocks at the edge of the tape it was handed
      // and prunes the rest, so "mitigated" never appears inside one tape.
      // Take a fresh bear OB as the desk would have seen it, then read what
      // the FULL history did afterwards — the return into the block and the
      // delivery from it. Decision on the left of the split, future on the
      // right, same as a walkthrough.
      const cand = tape.arrays.filter((a) => a.kind === "ob" && a.tf === "15m" && a.state === "fresh" && a.side === "bear");
      for (const a of cand) {
        const gOb = bars.findIndex((b) => b.t === a.t); // index in FULL history
        if (gOb < 0) continue;
        const obBar = bars[gOb];
        if (!(obBar.c > obBar.o)) continue; // last UP-close before the drop
        const gEnd = end - 1; // last bar the desk had seen
        let gMit = -1;
        for (let j = Math.max(gOb + 2, gEnd + 1); j < Math.min(bars.length, gEnd + 40); j++) {
          if (touches(bars[j], a)) { gMit = j; break; }
        }
        if (gMit < 0) continue;
        let gDel = -1;
        for (let j = gMit + 1; j < Math.min(bars.length, gMit + 7); j++) {
          if (bars[j].c < a.bottom) { gDel = j; break; }
        }
        if (gDel < 0) continue;
        const from = Math.max(0, gOb - 6);
        const to = Math.min(bars.length, gDel + 4);
        if (to - from < 12 || to - from > 64) continue;
        const view = bars.slice(from, to);
        found.ob = {
          bars: view.map((b) => ({ o: b.o, h: b.h, l: b.l, c: b.c, t: b.t })),
          symbol: sym,
          stamp: stamp(view, sym),
          marks: [
            { kind: "zone", top: a.top, bottom: a.bottom, label: "bear order block", tone: "warn", from: gOb - from },
            { kind: "point", bar: gOb - from, price: obBar.c, label: "last up-close before the drop", tone: "neutral" },
            { kind: "split", bar: gEnd - from, label: "decision → what followed", tone: "accent" },
            { kind: "point", bar: gMit - from, price: bars[gMit].h, label: "returned into the block", tone: "warn" },
            { kind: "point", bar: gDel - from, price: bars[gDel].c, label: "delivered", tone: "good" },
          ],
          caption: "The last up-close candle before the displacement down, as the desk had it marked FRESH. Right of the divider: price came back into its body and delivered from it again — the reaction an OB is graded on.",
        };
        break;
      }
    }
  }
}

/* ── Judas swing: the 09:30 bar raids the pre-market range and reverses ─── */

const etHM = (t) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(t));
  return Number(p.find((x) => x.type === "hour").value) * 60 + Number(p.find((x) => x.type === "minute").value);
};
for (const [symbol, sym] of [["MNQ", "NQU6"], ["ES", "ESU6"]]) {
  if (found.judas) break;
  const bars = HIST.bars[symbol];
  let best = null;
  for (let i = 8; i < bars.length - 6; i++) {
    if (etHM(bars[i].t) !== 9 * 60 + 30) continue;
    const pre = bars.slice(i - 4, i); // 08:30–09:15
    const b = bars[i];
    const preHi = Math.max(...pre.map((x) => x.h));
    const preLo = Math.min(...pre.map((x) => x.l));
    let side = null, pierce = 0;
    if (b.h > preHi + 0.25 && b.c < preHi) { side = "up"; pierce = b.h - preHi; }
    else if (b.l < preLo - 0.25 && b.c > preLo) { side = "down"; pierce = preLo - b.l; }
    if (!side) continue;
    // Delivery the other way: the next three closes all beyond the 09:30 open.
    const nxt = bars.slice(i + 1, i + 4);
    if (nxt.length < 3) continue;
    const delivered = side === "up" ? nxt.every((x) => x.c < b.o) : nxt.every((x) => x.c > b.o);
    if (!delivered) continue;
    const reach = side === "up" ? b.o - Math.min(...nxt.map((x) => x.l)) : Math.max(...nxt.map((x) => x.h)) - b.o;
    const score = pierce + reach;
    if (!best || score > best.score) best = { score, i, side, preHi, preLo, pierce, reach };
  }
  if (best) {
    const { i, side, preHi, preLo } = best;
    const from = i - 6, to = Math.min(bars.length, i + 8);
    const view = bars.slice(from, to);
    const jb = bars[i];
    found.judas = {
      bars: view.map((b) => ({ o: b.o, h: b.h, l: b.l, c: b.c, t: b.t })),
      symbol: sym,
      stamp: stamp(view, sym),
      marks: [
        { kind: "level", price: side === "up" ? preHi : preLo, label: side === "up" ? "pre-market high" : "pre-market low", tone: "warn", dash: true },
        { kind: "point", bar: i - from, price: side === "up" ? jb.h : jb.l, label: "09:30 — Judas raid", tone: "bad" },
        { kind: "split", bar: i - from + 1, label: "09:45 — entries permitted", tone: "accent" },
        { kind: "point", bar: i - from + 3, price: bars[i + 3].c, label: "delivery the other way", tone: "good" },
      ],
      caption: `The 09:30 bar ran ${side === "up" ? "above the pre-market high" : "below the pre-market low"} and closed back inside; the next three bars delivered the other way. The first fifteen minutes took the stops of everyone positioned early. No entries until 09:45.`,
    };
  }
}

const captions = {
  "conflict-aligned": "Three votes, one direction, and the published read agrees. This is what high confidence looks like on real tape.",
  "conflict-premium-override": "The vote said BULL. Price was in premium and the mid timeframe had turned bear, so the desk published NEUTRAL. The override, on real tape.",
  "conflict-discount-override": "The vote said BEAR. Price was in discount and the mid timeframe had turned bull, so the desk published NEUTRAL. The mirror override, on real tape.",
};

let added = 0;
for (const [id, hit] of Object.entries(found)) {
  let marks, caption;
  if (hit.marks) {
    marks = hit.marks;
    caption = `${hit.caption}  ${hit.stamp}`;
  } else {
    const { range } = hit;
    const last = hit.bars[hit.bars.length - 1];
    marks = [
      { kind: "zone", top: range.high, bottom: range.eq, label: "premium", tone: "bad" },
      { kind: "zone", top: range.eq, bottom: range.low, label: "discount", tone: "good" },
      { kind: "level", price: range.eq, label: `EQ ${range.eq.toFixed(2)}`, tone: "neutral", dash: true },
      { kind: "point", bar: hit.bars.length - 1, price: last.c, label: "price is here", tone: "accent" },
    ];
    caption = `${captions[id]}  ${hit.read}.  ${hit.stamp}`;
  }
  FIGS.figures[id] = { id, caption, bars: hit.bars, marks, stamp: hit.stamp, symbol: hit.symbol };
  added++;
  console.log(id, hit.stamp, hit.read ? `| ${hit.read}` : "");
}

const missing = ["conflict-aligned", "conflict-premium-override", "conflict-discount-override", "ifvg", "ob", "judas"].filter((k) => !found[k]);
if (missing.length) console.error("not found on this tape:", missing.join(", "));

writeFileSync("src/data/learn-figures.json", JSON.stringify(FIGS));
console.log(`merged ${added} engine-derived figures → ${Object.keys(FIGS.figures).length} total`);
