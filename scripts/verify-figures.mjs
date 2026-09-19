/**
 * Historic Learn figures must teach the tape they show.
 *
 * A wrong diagram in a trading app is worse than no diagram: it trains the
 * eye on a shape the market never printed. These checks are the same gates
 * scripts/build-learn-figures.py asserts at build time.
 *
 * Run: npx tsx scripts/verify-figures.mjs
 */
import { readFileSync } from "node:fs";
import { structureOf } from "../src/lib/learn/scenarios.ts";
import { getFigure } from "../src/lib/learn/figures.ts";
import { MODULES } from "../src/lib/learn/curriculum.ts";
import { scoreCall, scenarioCall, CONTRAST_VERDICT } from "../src/lib/learn/drill.ts";
import { SCENARIOS } from "../src/lib/learn/scenarios.ts";

const file = JSON.parse(readFileSync("src/data/learn-figures.json", "utf8"));
let pass = 0;
let fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ""}`);
  }
};

const figs = file.figures ?? {};
ok("has figures", Object.keys(figs).length >= 10, `${Object.keys(figs).length}`);
ok("July–August capture", /2026-07/.test(file.month) || /07/.test(file.month), file.month);

for (const [id, f] of Object.entries(figs)) {
  const bars = f.bars ?? [];
  const n = bars.length;
  ok(`${id}: enough bars`, n >= 8, `${n}`);
  ok(
    `${id}: candles well-formed`,
    bars.every((b) => b.h >= Math.max(b.o, b.c) - 1e-9 && b.l <= Math.min(b.o, b.c) + 1e-9),
  );
  const hi = Math.max(...bars.map((b) => b.h));
  const lo = Math.min(...bars.map((b) => b.l));
  for (const m of f.marks ?? []) {
    if (m.kind === "point") {
      const b = bars[m.bar];
      ok(`${id}: point bar in range`, b != null, `${m.bar}`);
      if (b) ok(`${id}: point on candle`, m.price <= b.h + 0.011 && m.price >= b.l - 0.011, `${m.price} vs ${b.l}-${b.h}`);
    }
    if (m.kind === "level") {
      ok(`${id}: level on tape`, m.price <= hi + 0.05 && m.price >= lo - 0.05, `${m.price}`);
    }
    if (m.kind === "zone") {
      ok(`${id}: zone upright`, m.top >= m.bottom - 1e-9);
      ok(`${id}: zone has height`, m.top - m.bottom >= 0.2, `${m.top - m.bottom}`);
    }
  }
}

const fvg = figs.fvg;
if (fvg) {
  const z = fvg.marks.find((m) => m.kind === "zone");
  const from = z?.from ?? 0;
  const a = fvg.bars[from];
  const c = fvg.bars[from + 2];
  ok("fvg: 3-bar exists", a && c);
  if (a && c && z) {
    const bot = Math.min(a.h, c.l);
    const top = Math.max(a.h, c.l);
    ok("fvg: zone is the 3-bar gap", Math.abs(z.bottom - bot) < 0.35 && Math.abs(z.top - top) < 0.35, `${z.bottom}-${z.top} vs ${bot}-${top}`);
  }
}

const liq = figs.liquidity;
if (liq) {
  const lv = (re) => liq.marks.find((m) => m.kind === "level" && re.test(m.label));
  const eh = lv(/ERL high/);
  const el = lv(/ERL low/);
  const ih = lv(/IRL high/);
  const il = lv(/IRL low/);
  ok("liquidity: four levels", eh && el && ih && il);
  if (eh && el && ih && il) {
    const rng = eh.price - el.price;
    ok("liquidity: IRL strictly inside", el.price + 0.05 * rng < il.price && ih.price < eh.price - 0.05 * rng);
    ok("liquidity: IRL high ≠ IRL low", ih.price - il.price >= 0.12 * rng, `${ih.price - il.price} vs ${0.12 * rng}`);
  }
}

const rt = figs["retrace-into"];
if (rt) {
  const z = rt.marks.find((m) => m.kind === "zone");
  const p = rt.marks.find((m) => m.kind === "point");
  ok("retrace: close inside gap", z && p && p.price <= z.top + 0.05 && p.price >= z.bottom - 0.05, p && z ? `${p.price} vs ${z.bottom}-${z.top}` : "missing");
}

for (const [id, want] of [
  ["bias-bull", "bull"],
  ["bias-bear", "bear"],
  ["bias-expansion", "neutral"],
  ["bias-coil", "neutral"],
]) {
  const f = getFigure(id);
  ok(`${id}: served`, f != null);
  if (f) ok(`${id}: structure ${want}`, structureOf(f) === want, structureOf(f));
}

const prem = figs["range-premium-short"];
if (prem) {
  const eq = prem.marks.find((m) => m.kind === "level" && /^EQ/.test(m.label));
  const last = prem.bars[prem.bars.length - 1].c;
  ok("range-premium: last close above EQ", eq && last > eq.price, `${last} vs ${eq?.price}`);
}
const disc = figs["range-discount-short"];
if (disc) {
  const eq = disc.marks.find((m) => m.kind === "level" && /^EQ/.test(m.label));
  const last = disc.bars[disc.bars.length - 1].c;
  ok("range-discount: last close below EQ", eq && last < eq.price, `${last} vs ${eq?.price}`);
}

const sw = figs["sweep-clean"];
if (sw) {
  const pool = sw.marks.find((m) => m.kind === "level");
  const pt = sw.marks.find((m) => m.kind === "point");
  if (pool && pt) {
    const bar = sw.bars[pt.bar];
    ok("sweep-clean: wick above pool", bar.h > pool.price);
    ok("sweep-clean: close back inside", bar.c < pool.price);
    ok("sweep-clean: point is the wick", Math.abs(pt.price - bar.h) < 0.011);
  }
}

const hit = scoreCall(
  { word: "STAND", missing: "POI in correct half" },
  { word: "STAND", missing: "POI in correct half" },
);
ok("score: exact STAND+layer is a hit", hit.grade === "hit");
const alias = scoreCall(
  { word: "STAND", missing: "POI in correct half" },
  { word: "STAND", missing: "POI in correct premium/discount" },
);
ok("score: half aliases premium/discount", alias.grade === "hit");
const take = scoreCall(
  { word: "TAKE", missing: "Sequence complete" },
  { word: "TAKE", missing: "Sequence complete" },
);
ok("score: TAKE is a hit", take.grade === "hit");
const miss = scoreCall(
  { word: "TAKE", missing: "Sequence complete" },
  { word: "STAND", missing: "Liquidity sweep" },
);
ok("score: TAKE vs STAND is a miss", miss.grade === "miss");
const wordOnly = scoreCall(
  { word: "WAIT", missing: "Kill zone" },
  { word: "WAIT", missing: "Retrace into array" },
);
ok("score: right word wrong layer", wordOnly.grade === "word");

for (const sc of SCENARIOS) {
  const call = scenarioCall(sc.id, sc.verdict);
  ok(`${sc.id}: scenario word matches`, call.word === sc.verdict);
  if (sc.verdict === "TAKE") ok(`${sc.id}: TAKE names complete`, call.missing === "Sequence complete");
  else ok(`${sc.id}: STAND/WAIT names a layer`, call.missing.length > 3);
}

for (const [id, v] of Object.entries(CONTRAST_VERDICT)) {
  const f = getFigure(id);
  ok(`contrast ${id} exists`, f != null);
  ok(`contrast ${id} verdict ${v}`, f?.verdict === v, f?.verdict);
}

for (const m of MODULES.filter((x) => x.pairing === "contrast")) {
  ok(`${m.id}: two figures`, m.figures.length === 2);
  ok(`${m.id}: has why`, Boolean(m.why && m.whyAnswer && m.whyAnswer.length > 20));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
