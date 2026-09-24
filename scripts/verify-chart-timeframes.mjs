import { readFileSync } from "node:fs";
/**
 * The timeframe switch must never show a chart that lies about what it covers,
 * and must never invent a bar that did not print.
 *
 *   npx tsx scripts/verify-chart-timeframes.mjs
 */
import {
  CHART_TFS,
  TF_MARKS,
  TF_ROLE,
  TF_VISIBLE_BARS,
  DEFAULT_TF,
  seriesFor,
  allSeries,
  marksFor,
  showsContext,
  autoTf,
  resolveTf,
} from "../src/lib/trading/chart-timeframes.ts";

let pass = 0;
let fail = 0;
const fails = [];
const ok = (c, l) => (c ? pass++ : (fail++, fails.push(l)));

// A synthetic minute series: 480 bars = 8h, the real shape of mtf.minute.
const T0 = 1_700_000_000_000;
const minute = Array.from({ length: 480 }, (_, i) => ({
  t: T0 + i * 60_000,
  o: 100 + i * 0.01,
  h: 100.5 + i * 0.01,
  l: 99.5 + i * 0.01,
  c: 100.2 + i * 0.01,
  v: 10,
}));
// 15m series: 1600 bars, matching the MAX_BARS raised for the odds floor.
const m15 = Array.from({ length: 1600 }, (_, i) => ({
  t: T0 - 1600 * 900_000 + i * 900_000,
  o: 100,
  h: 101,
  l: 99,
  c: 100.5,
  v: 100,
}));

// ── 1. No timeframe is upsampled ────────────────────────────────────────────
{
  const noMinute = seriesFor("1m", m15, []);
  ok(noMinute.bars.length === 0, "1m refuses to draw without a minute series");
  ok(noMinute.source === null, "refused series reports no source");
  ok(/cannot be drawn/i.test(noMinute.coverage), "refusal explains itself");

  const no5 = seriesFor("5m", m15, []);
  ok(no5.bars.length === 0, "5m refuses to be built from 15m");

  // The critical one: never fabricate 1m bars from a fat 15m series.
  ok(
    seriesFor("1m", m15, []).bars.length === 0,
    "a 1600-bar 15m series still cannot produce a single 1m bar",
  );
}

// ── 2. Coverage is honest about the 1m window ──────────────────────────────
{
  const s1 = seriesFor("1m", m15, minute);
  ok(s1.bars.length === 480, "1m passes the minute series through untouched");
  ok(s1.source === "1m", "1m names its source");
  ok(s1.coverageHours !== null && s1.coverageHours < 9, "1m coverage is ~8h, not days");
  ok(/TIMING/i.test(s1.coverage), "1m says it is for timing, not bias");

  const s5 = seriesFor("5m", m15, minute);
  ok(s5.bars.length > 0 && s5.bars.length < 480, "5m is a genuine downsample of 1m");
  ok(s5.source === "1m", "5m inherits the 1m window, and says so");
  ok(
    (s5.coverageHours ?? 99) < 9,
    "5m does NOT claim days of coverage it does not have",
  );

  const s15 = seriesFor("15m", m15, minute);
  ok(s15.bars === m15, "15m is the engine's own series, not a copy");
  ok(/engine grades/i.test(s15.coverage), "15m says it is the graded series");

  const s1h = seriesFor("1h", m15, minute);
  const s4h = seriesFor("4h", m15, minute);
  ok(s1h.source === "15m" && s4h.source === "15m", "slow rungs resample from 15m");
  ok(s1h.bars.length < m15.length, "1h is coarser than 15m");
  ok(s4h.bars.length < s1h.bars.length, "4h is coarser than 1h");
  ok(s4h.bars.length > 0, "4h produces bars from a 1600-bar 15m series");
}

// ── 3. Empty inputs never throw and never show a blank chart silently ──────
{
  for (const tf of CHART_TFS) {
    const s = seriesFor(tf, [], []);
    ok(s.bars.length === 0, `${tf} empty in, empty out`);
    ok(s.coverage.length > 10, `${tf} explains an empty series`);
  }
  const all = allSeries([], []);
  ok(Object.keys(all).length === CHART_TFS.length, "allSeries covers every rung");
}

// ── 4. Per-rung marks — the auto-adapting markup ───────────────────────────
{
  const marks = [
    { kind: "pool", id: "a" },
    { kind: "sweep", id: "b" },
    { kind: "displacement", id: "c" },
    { kind: "array", id: "d" },
    { kind: "entry", id: "e" },
    { kind: "stop", id: "f" },
    { kind: "target", id: "g" },
    { kind: "eq", id: "h" },
  ];

  const at4h = marksFor("4h", marks).map((m) => m.kind);
  ok(!at4h.includes("entry"), "4h never draws an entry line — false precision on a 4h bar");
  ok(!at4h.includes("stop"), "4h never draws a stop");
  ok(at4h.includes("pool"), "4h draws the pools");

  const at1m = marksFor("1m", marks).map((m) => m.kind);
  ok(at1m.includes("entry") && at1m.includes("array"), "1m draws the execution marks");
  ok(!at1m.includes("pool"), "1m does not clutter with pools that are hours away");
  ok(!at1m.includes("target"), "1m does not draw an off-screen target");

  const at15 = marksFor("15m", marks).map((m) => m.kind);
  ok(at15.length === marks.length, "15m draws everything — it is the audited chart");

  // Every rung must draw SOMETHING, or the switch has a dead position.
  for (const tf of CHART_TFS) {
    ok(marksFor(tf, marks).length > 0, `${tf} draws at least one mark`);
    ok(TF_MARKS[tf].reads.length > 10, `${tf} says what it is read for`);
    ok(TF_ROLE[tf].length > 5, `${tf} has a role label`);
    ok(TF_VISIBLE_BARS[tf] > 0, `${tf} has a visible-bar count`);
  }

  ok(showsContext("15m", "score_drivers"), "15m shows what drove the score");
  ok(showsContext("1m", "ce_line"), "1m shows the CE the limit rests at");
  ok(!showsContext("1m", "htf_levels"), "1m is not cluttered with weekly levels");
  ok(showsContext("4h", "draw_line"), "4h carries the draw line");
  // htf_levels was removed: the pools ARE the HTF levels here, and they
  // arrive as marks rather than as a context layer nothing rendered.
  ok(!showsContext("4h", "score_drivers"), "4h does not label 15m score drivers");
  ok(!showsContext("4h", "score_drivers"), "4h does not label 15m score drivers");
}

// ── 5. Auto-adapt follows the trade's life ─────────────────────────────────
{
  ok(autoTf({ entry: "live" }).tf === "1m", "live → 1m, the turn is a 1m fact");
  ok(autoTf({ entry: "armed" }).tf === "5m", "armed → 5m, reading the retrace");
  ok(autoTf({ entry: "not-yet" }).tf === "15m", "not-yet → 15m, the graded series");
  ok(autoTf({ entry: "gone" }).tf === "15m", "gone → 15m, looking for the next setup");

  // A structure layer sends you to structure, not to 15m to stare.
  ok(
    autoTf({ entry: "not-yet", missingLayer: "htf" }).tf === "1h",
    "missing htf → 1h",
  );
  ok(
    autoTf({ entry: "not-yet", missingLayer: "pd_half" }).tf === "1h",
    "missing pd_half → 1h",
  );
  // But execution state outranks the missing-layer hint: if it is live, it is live.
  ok(
    autoTf({ entry: "live", missingLayer: "htf" }).tf === "1m",
    "live outranks a stale missing-layer hint",
  );

  for (const e of ["not-yet", "armed", "live", "gone"]) {
    const r = autoTf({ entry: e });
    ok(CHART_TFS.includes(r.tf), `autoTf(${e}) returns a real rung`);
    ok(r.why.length > 10, `autoTf(${e}) explains itself`);
  }
  ok(CHART_TFS.includes(DEFAULT_TF), "the default is a real rung");
  ok(DEFAULT_TF === "15m", "the default is the series the engine graded");
}

// ── 6. The trailing bucket is never passed off as complete ─────────────────
{
  // 15m bars ending at :15 leave a 4h bucket holding two bars out of sixteen.
  // It must be flagged, not drawn with the shape of a closed 4h candle — the
  // same rule that stops the gateway flushing a partial minute as a bar.
  const oneBar = [
    { t: Date.UTC(2024, 0, 1, 8, 0), o: 1, h: 2, l: 0, c: 1.5, v: 1 },
    { t: Date.UTC(2024, 0, 1, 8, 15), o: 1.5, h: 2.5, l: 1, c: 2, v: 1 },
  ];
  const s4 = seriesFor("4h", oneBar, []);
  ok(s4.lastBarPartial === true, "a 4h bucket holding two 15m bars is flagged partial");
  ok((s4.lastBarFill ?? 1) < 0.2, "fill reports how little of the bucket printed");
  ok(/still forming/i.test(s4.coverage), "coverage says the last bar is forming");

  // A series ending exactly on a bucket boundary is COMPLETE, not partial.
  const full = [];
  for (let i = 0; i < 16; i++) {
    full.push({
      t: Date.UTC(2024, 0, 1, 8, 0) + i * 900000,
      o: 1,
      h: 2,
      l: 0,
      c: 1.5,
      v: 1,
    });
  }
  const s4full = seriesFor("4h", full, []);
  ok(s4full.lastBarPartial === false, "sixteen 15m bars fill a 4h bucket exactly");
  ok(!/still forming/i.test(s4full.coverage), "a complete bucket makes no forming claim");

  // Passthrough rungs make no claim either way — the feed owns that bar.
  ok(seriesFor("15m", m15, minute).lastBarPartial === false, "15m makes no partial claim");
  ok(seriesFor("1m", m15, minute).lastBarPartial === false, "1m makes no partial claim");

  // Never report a span of "0d" — the old Math.round(h/24) did exactly that.
  const shortCov = seriesFor("4h", oneBar, []).coverage;
  ok(!/about 0d/.test(shortCov), "never claims zero days of coverage");
  // One bucket cannot have a span, and the module declines to invent one
  // rather than printing "about 0d" — the bug this replaced.
  ok(!/about /.test(shortCov), "a single-bucket series makes no span claim at all");

  // 24h of 15m bars is six 4h buckets: a real span, under two days, so it must
  // read in hours rather than rounding to "1d".
  const day = [];
  for (let i = 0; i < 96; i++) {
    day.push({ t: Date.UTC(2024, 0, 1, 0, 0) + i * 900000, o: 1, h: 2, l: 0, c: 1.5, v: 1 });
  }
  const dayCov = seriesFor("4h", day, []).coverage;
  ok(/about \d+h/.test(dayCov), "a sub-48h span reports hours, not days");
  ok(!/about 0/.test(dayCov), "never reports a zero span");
  ok(/about \d+d/.test(seriesFor("4h", m15, []).coverage), "a long series still reports days");
}

// ── 7. resolveTf never lands on an empty rung ──────────────────────────────
{
  // THE interaction bug: a LIVE card wants 1m, and a desk with no gateway has
  // no minute series. Blanking the chart at that exact moment is the worst
  // possible degraded state, so the want is resolved against reality.
  const noMinute = allSeries(m15, []);
  const r = resolveTf("1m", noMinute);
  ok(r.tf !== "1m", "a wanted 1m with no minute series is substituted");
  ok(noMinute[r.tf].bars.length > 0, "the substitute actually has bars");
  ok(r.substituted === true && !!r.why, "the substitution is declared, not hidden");
  ok(r.tf === "15m", "falls back to the series the engine graded");

  // The desk's own auto-pick must survive that same desk.
  const want = autoTf({ entry: "live" }).tf;
  const solved = resolveTf(want, noMinute);
  ok(noMinute[solved.tf].bars.length > 0, "a live card always gets a drawable chart");

  // 5m is equally unavailable without a minute series.
  ok(resolveTf("5m", noMinute).substituted === true, "5m also substitutes without 1m");

  // With a minute series, nothing is substituted.
  const withMinute = allSeries(m15, minute);
  const r2 = resolveTf("1m", withMinute);
  ok(r2.tf === "1m" && !r2.substituted, "1m is honoured when the series exists");
  for (const tf of CHART_TFS) {
    ok(resolveTf(tf, withMinute).tf === tf, `${tf} honoured on a full desk`);
  }

  // A desk with NO data cannot invent a rung, and must not claim it substituted.
  const nothing = allSeries([], []);
  const r3 = resolveTf("15m", nothing);
  ok(r3.substituted === false, "no data means no false substitution claim");
  ok(nothing[r3.tf].bars.length === 0, "and no pretend bars");
}

// ── 8. NOTHING IS DECLARED THAT NOTHING PRODUCES ───────────────────────────
//
// The review caught this one: TF_MARKS listed pool/entry/stop/eq while
// anticipate() emitted none of them, so 4h drew a single mark and 1m drew
// zero. The spec described a chart that could not exist.
//
// A fixture full of hand-written mark kinds sails straight through that — the
// same module-agrees-with-its-own-fixture trap as the false green flash. So
// these assertions read the SOURCE instead of a fixture.
{
  const antSrc = readFileSync(
    new URL("../src/lib/trading/setup-anticipation.ts", import.meta.url),
    "utf8",
  );
  const emitted = new Set([...antSrc.matchAll(/kind:\s*"([a-z_]+)"/g)].map((m) => m[1]));
  ok(emitted.size >= 8, `anticipate() emits ${emitted.size} mark kinds (want >= 8)`);

  for (const tf of CHART_TFS) {
    for (const k of TF_MARKS[tf].kinds) {
      ok(emitted.has(k), `TF_MARKS[${tf}] declares "${k}" and anticipate() emits it`);
    }
  }

  // Every context a rung declares must be READ by a component. An unconsumed
  // context is a promise the chart does not keep.
  const ui =
    readFileSync(
      new URL("../src/components/desk/setup-mini-chart.tsx", import.meta.url),
      "utf8",
    ) +
    readFileSync(
      new URL("../src/components/desk/setup-scanner.tsx", import.meta.url),
      "utf8",
    );
  const declared = new Set(CHART_TFS.flatMap((tf) => TF_MARKS[tf].context));
  for (const ctx of declared) {
    ok(
      ui.includes(`"${ctx}"`),
      `context "${ctx}" is consumed by the UI, not merely declared`,
    );
  }

  // And every rung must be able to draw MORE than nothing on a live setup.
  for (const tf of CHART_TFS) {
    ok(
      TF_MARKS[tf].kinds.some((k) => emitted.has(k)),
      `${tf} can draw at least one mark anticipate() actually produces`,
    );
  }
}

console.log(`\nchart-timeframes: ${pass} passed, ${fail} failed`);
if (fails.length) {
  console.log("\nFAILURES:");
  for (const f of fails) console.log("  ✗", f);
}
process.exit(fail ? 1 : 0);
