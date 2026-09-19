/**
 * Render the setup chart to a standalone SVG file.
 *
 * Two jobs:
 *   1. Look at it. A chart can pass every arithmetic test and still be
 *      unreadable — labels colliding, bands inverted, the raid marker off the
 *      wick. Those are only visible by looking, and the live desk only shows a
 *      priced plan during a session, so this makes one on demand.
 *   2. Visual regression. The output is deterministic (fixed bars, fixed plan,
 *      no clock), so a diff on the committed SVG shows exactly what a change to
 *      the renderer did.
 *
 * Run: npx tsx scripts/render-setup-chart.mjs [out.svg]
 */

import { writeFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { SetupChart } = await import("../src/components/desk/setup-chart.tsx");
const { buildTradePlan } = await import("../src/lib/trading/trade-plan.ts");

const out = process.argv[2] ?? "setup-chart.svg";

/* A short off a PDH raid into premium — the desk's gold-standard book. */

const T0 = Date.UTC(2026, 8, 18, 13, 0, 0); // 09:00 ET
const STEP = 900_000; // 15m

/** Deterministic pseudo-random so the fixture never drifts between runs. */
let seed = 42;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const bars = [];
let px = 24_050;
for (let i = 0; i < 60; i++) {
  // Rally into the raid, sweep the high at bar 40, then roll over.
  const drift = i < 40 ? 3.6 : -5.2;
  const o = px;
  const noise = (rnd() - 0.5) * 14;
  const c = o + drift + noise;
  const wickUp = i === 40 ? 34 : Math.abs(noise) * 0.8 + 3;
  const wickDn = Math.abs(noise) * 0.8 + 3;
  bars.push({
    t: T0 + i * STEP,
    o: +o.toFixed(2),
    h: +(Math.max(o, c) + wickUp).toFixed(2),
    l: +(Math.min(o, c) - wickDn).toFixed(2),
    c: +c.toFixed(2),
    v: 1000,
  });
  px = c;
}

const raidBar = bars[40];
const price = bars[bars.length - 1].c;

const entryArray = {
  kind: "ifvg",
  tf: "15m",
  side: "bear",
  top: +(raidBar.h - 18).toFixed(2),
  bottom: +(raidBar.h - 34).toFixed(2),
  mid: +(raidBar.h - 26).toFixed(2),
  t: T0 + 42 * STEP,
  at: "10:30",
  state: "fresh",
  label: "IFVG",
};

const plan = buildTradePlan({
  symbol: "MNQ",
  side: "short",
  price,
  entryArray,
  sweepExtreme: raidBar.h,
  sweepT: raidBar.t,
  dol: { name: "PDL", price: 24_020, reachProbability: 0.68, side: "below" },
  range: { high: raidBar.h, low: 23_960, eq: +((raidBar.h + 23_960) / 2).toFixed(2) },
  arrays: [
    entryArray,
    { ...entryArray, kind: "ob", top: +(raidBar.h - 6).toFixed(2), bottom: +(raidBar.h - 16).toFixed(2), mid: +(raidBar.h - 11).toFixed(2), state: "partial", t: T0 + 41 * STEP },
    { ...entryArray, kind: "fvg", top: 24_180, bottom: 24_168, mid: 24_174, state: "fresh", t: T0 + 45 * STEP },
  ],
});

if (!plan) {
  console.error("fixture produced no plan — the chart would be empty");
  process.exit(1);
}

const markup = renderToStaticMarkup(
  React.createElement(SetupChart, { bars, plan, word: "TAKE" }),
);

// Pull the <svg> out of the <figure> wrapper and give it the desk's tokens so
// the file stands alone in any viewer.
const svg = markup.match(/<svg[\s\S]*<\/svg>/)?.[0];
if (!svg) {
  console.error("no <svg> in rendered markup");
  process.exit(1);
}

// Text styling is carried on SVG attributes (fill / fontSize / fontWeight),
// not Tailwind classes, so the only thing this has to supply is the page
// background and a font stack. That is what makes the exported file portable:
// it renders identically in a browser, a viewer, a doc or an email.
const tokens = `
  <style>
    svg { background: #09090b; font-family: "IBM Plex Sans", system-ui, sans-serif; }
  </style>`;

const themed = svg
  .replace(/var\(--color-bg\)/g, "#09090b")
  .replace(/var\(--color-fg\)/g, "#f4f4f5")
  .replace(/var\(--color-muted\)/g, "#a1a1aa")
  .replace(/var\(--color-subtle\)/g, "#71717a")
  .replace(/var\(--color-primary\)/g, "#2dd4bf")
  .replace(/var\(--color-up\)/g, "#34d399")
  .replace(/var\(--color-down\)/g, "#f87171")
  .replace(/var\(--color-warn\)/g, "#fbbf24")
  .replace(/var\(--color-chart-2\)/g, "#60a5fa")
  .replace(/var\(--color-chart-3\)/g, "#94a3b8")
  .replace(/var\(--color-chart-4\)/g, "#fbbf24")
  .replace("<svg", `<svg xmlns="http://www.w3.org/2000/svg"`)
  .replace(/(<svg[^>]*>)/, `$1${tokens}`);

writeFileSync(out, themed, "utf8");
console.log(`wrote ${out}`);
console.log(
  `plan: ${plan.symbol} ${plan.side} entry ${plan.entry} stop ${plan.stop} ` +
    `T1 ${plan.t1} (${plan.rr1}R) T2 ${plan.t2} (${plan.rr2}R) risk ${plan.riskPts}pt`,
);
