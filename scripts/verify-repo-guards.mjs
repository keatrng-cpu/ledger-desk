/**
 * The guards that stop the three failures which have actually cost this desk
 * money, as opposed to the ones that merely look untidy.
 *
 *   npx tsx scripts/verify-repo-guards.mjs
 *
 * Every check here exists because the thing it checks for HAS HAPPENED, at
 * least once, on a weekday. None of them are hypothetical.
 *
 *   1. STUBBED DATA AND PLAN FILES
 *      `week-ahead.ts` has been reduced from ~1030 lines to a one-line
 *      "see-file" placeholder three separate times, because a restamp commit
 *      REPLACES the file instead of editing it and a plain merge accepts the
 *      shorter side without a word. The desk then opens the week with no week
 *      plan. A line floor catches it before the push, which is the only place
 *      it can still be caught cheaply.
 *
 *   2. TWO BRAINS FOR ONE WORD
 *      The markup flashed ENTER NOW off a five-must canon stack while the
 *      gate it was claiming to represent had nine musts. Tests passed because
 *      the fixture shared the bug. There must be exactly one source for
 *      "ready", and every consumer must read THAT — not a cousin, not a
 *      recount.
 *
 *   3. DARK MODULES
 *      `target-odds.ts` sat for two days at 44/44 passing tests while being
 *      imported by nothing, so it printed nothing and changed no decision. A
 *      module that no tab and no builder imports is not shipped, however
 *      green its tests are.
 *
 * This file asserts about SOURCE TEXT on purpose. A fixture cannot encode the
 * same misunderstanding twice if there is no fixture.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: the repo lives under "New folder (6)", and
// pathname hands back percent-encoded spaces plus a leading slash before the
// drive letter. Every existence check then fails for the wrong reason.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

let pass = 0;
let fail = 0;
const fails = [];
const ok = (c, l) => (c ? pass++ : (fail++, fails.push(l)));

function read(p) {
  try {
    return readFileSync(join(ROOT, p), "utf8");
  } catch {
    return null;
  }
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = `${dir}/${e}`;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. PLAN AND DATA FILES MAY NOT BE STUBBED
//
// Floors are set well under the real size so ordinary editing never trips
// them; they only fire on a replacement. The point is to catch a 1030 -> 1
// collapse, not to freeze the file.
// ─────────────────────────────────────────────────────────────────────────────
// For JSON the floor is ENTRIES, not lines: news-calendar.json holds 30 events
// in 33 lines, so a line floor is either trivially met by pretty-printing or
// tripped by compact formatting. The stub that actually happened was a
// ONE-ENTRY calendar, and only an entry count catches that.
const FLOORS = [
  ["src/lib/trading/week-ahead.ts", 300, "lines"],
  ["src/lib/trading/month-ahead.ts", 150, "lines"],
  ["src/data/news-calendar.json", 20, "entries"],
  ["src/data/week-prints.json", 3, "entries"],
  ["src/lib/aplus/config.ts", 20, "lines"],
];

function entryCount(src) {
  try {
    const j = JSON.parse(src);
    return Array.isArray(j) ? j.length : Object.keys(j).length;
  } catch {
    return -1;
  }
}

for (const [path, floor, unit] of FLOORS) {
  const src = read(path);
  ok(src !== null, `${path} exists`);
  if (src === null) continue;
  const n = unit === "entries" ? entryCount(src) : src.split("\n").length;
  ok(n >= 0, `${path} parses`);
  ok(
    n >= floor,
    `${path} has ${n} ${unit} (floor ${floor}) — a collapse here means the desk opens with no plan`,
  );
}

// The literal markers an upstream stub leaves behind.
const STUB_MARKERS = [
  "see next file",
  "see-file",
  "see file",
  "PLACEHOLDER",
  "... rest of file",
  "TODO: restore",
];
for (const [path] of FLOORS) {
  const src = read(path);
  if (src === null) continue;
  for (const marker of STUB_MARKERS) {
    ok(
      !src.toLowerCase().includes(marker.toLowerCase()),
      `${path} contains no stub marker "${marker}"`,
    );
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// 2. ONE TAKE OBJECT
//
// `smcMaster.word` is the gate. Anything that decides "ready" — the flash,
// auto-paper, the alarm, the resting limit — must read it rather than
// recounting musts from some other stack.
// ─────────────────────────────────────────────────────────────────────────────
{
  const ant = read("src/lib/trading/setup-anticipation.ts");
  ok(ant !== null, "setup-anticipation.ts exists");
  if (ant) {
    ok(
      /sequence\?\.word === "TAKE"/.test(ant),
      "the flash reads smc-master's word, not a recomputed must-count",
    );
    // The specific regression: deriving completeness from a count.
    const derives =
      /const\s+complete\s*=\s*[^;]*mustPass\s*>=?\s*mustNeed/.test(ant) ||
      /complete\s*=\s*[^;]*canon[^;]*length/.test(ant);
    ok(!derives, "completeness is NOT re-derived from a must-count in setup-anticipation");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. NO DARK MODULES
//
// Every trading/market/invest module must be reachable from something that
// renders or builds. Verifier scripts do not count: a module whose only
// consumer is its own test changes no decision on the desk.
// ─────────────────────────────────────────────────────────────────────────────
{
  const sources = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts"));
  const corpus = new Map();
  for (const f of sources) corpus.set(f, read(f) ?? "");

  const libs = sources.filter(
    (f) =>
      /^src\/lib\/(trading|market|invest|alerts)\//.test(f) &&
      !/\/types\.ts$/.test(f) &&
      !/\.test\.ts$/.test(f),
  );

  const dark = [];
  for (const lib of libs) {
    const base = lib.replace(/^src\//, "").replace(/\.tsx?$/, "");
    const leaf = base.split("/").pop();
    let referenced = false;
    for (const [f, src] of corpus) {
      if (f === lib) continue;
      // An IMPORT, not a mention.
      //
      // `options-sleeve.ts` carries the comment "sleeve-sizing.ts is the
      // authority now" while importing nothing from it — so a plain substring
      // search for the filename reports a DEAD module as wired, which is
      // precisely how the corrected sleeve model sat unused behind a comment
      // claiming it was live. Only a real import/export specifier counts.
      const esc = leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const imported = new RegExp(
        `(?:from|import|require\\()\\s*["'][^"']*?(?:^|/)${esc}(?:\\.tsx?)?["']`,
      ).test(src);
      if (imported) {
        referenced = true;
        break;
      }
    }
    if (!referenced) dark.push(lib);
  }

  /**
   * KNOWN DARK, as of 2026-09-23. This list may only ever SHRINK.
   *
   * Baselined rather than ignored: each of these is finished, tested code that
   * changes no decision on the desk, and the most expensive one is not a
   * curiosity.
   *
   *   sleeve-sizing.ts   — the CORRECTED options model ($1,000 max debit, the
   *                        15% brake applied to the debit rather than to the
   *                        account). 29 passing tests, imported by nothing.
   *                        `options-sleeve.ts:33` even carries the comment
   *                        "sleeve-sizing.ts is the authority now" while the
   *                        legacy `rhMaxDebit()` — equity x riskPct = $150 —
   *                        is what actually sizes every RH ticket at four call
   *                        sites. The desk is sizing at roughly a sixth of the
   *                        intended debit. This is a live P&L defect, not tidy-up.
   *   setup-memory.ts    — 69 tests. Per-setup attribution and the discipline
   *                        read that excludes non-compliant records.
   *   card-freshness.ts  — 26 tests. Target-hit / entry-gone / side-stale.
   *   liquidity-map.ts, ladder-conflict.ts, override-log.ts,
   *   kill-watch-server.ts
   *
   * Wiring is the fix. Deleting the guard is not.
   */
  const KNOWN_DARK = new Set([
    "src/lib/invest/kill-watch-server.ts",
    "src/lib/trading/ladder-conflict.ts",
    "src/lib/trading/liquidity-map.ts",
    "src/lib/trading/override-log.ts",
  ]);
  // 2026-09-24: setup-memory.ts came off — `trade-log.ts` adapts the
  // hand-logged fills (a file written since the sleeve went live and read by
  // nothing) into SetupRecords, and the Book tab prints the discipline read
  // apart from the setup read.
  // 2026-09-23: sleeve-sizing.ts and card-freshness.ts came off this list.
  // sleeve-sizing now drives options-desk's contract count (the $1,000 ceiling
  // with the loss bounded by the worked stop); card-freshness drives the
  // spent-card strip on every scanner card.

  const fresh = dark.filter((d) => !KNOWN_DARK.has(d));
  ok(
    fresh.length === 0,
    fresh.length
      ? `${fresh.length} NEW dark module(s) — finished code that ships no decision: ${fresh.join(", ")}`
      : "no new dark modules",
  );

  // Shrinking the baseline is the goal, so a module that got wired must be
  // removed from the list — otherwise the debt looks permanent.
  const stale = [...KNOWN_DARK].filter((d) => !dark.includes(d));
  ok(
    stale.length === 0,
    stale.length
      ? `${stale.length} module(s) now wired — delete from KNOWN_DARK: ${stale.join(", ")}`
      : "KNOWN_DARK has no stale entries",
  );

  if (dark.length) {
    console.log(`    ${dark.length} dark (baselined), highest cost first:`);
    for (const d of dark) console.log("      ", d);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE HUD NEVER CLAIMS A FABRICATED PRICE IS FRESH
//
// A synthetic quote stamped `lagSec: 0` is a fabricated price claiming to be
// the freshest thing on the desk. `freshest.ts` filters synthetic before
// ranking, and that filter is what makes the stamp survivable — so the filter
// itself is the thing worth pinning down.
// ─────────────────────────────────────────────────────────────────────────────
{
  const fresh = read("src/lib/market/freshest.ts");
  ok(fresh !== null, "freshest.ts exists");
  if (fresh) {
    ok(
      /source === "synthetic"/.test(fresh) && /return false/.test(fresh),
      "freshest.ts refuses synthetic quotes before ranking by lag",
    );
  }
}

console.log(`\nrepo-guards: ${pass} passed, ${fail} failed`);
if (fails.length) {
  console.log("\nFAILURES:");
  for (const f of fails) console.log("  ✗", f);
}
process.exit(fail ? 1 : 0);
