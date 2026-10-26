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
import { PLAN_FILES, weekFileProblems, stubMarkerProblems, importedNamesFor } from "./plan-file-guard.mjs";

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

// The literal markers an upstream stub leaves behind. Matched with the plan-file guard's rule
// (2026-10-26): anywhere in a tiny file, otherwise only as a whole line by itself, so an
// ordinary comment that says "placeholder" or "see file" is not a stub.
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
      stubMarkerProblems(path, src, [marker]).length === 0,
      `${path} contains no stub marker "${marker}"`,
    );
  }
}


// 1b. WEEK PLAN + WEEK PRINTS: NOT PLACEHOLDER-ONLY, NOT TRUNCATED (2026-10-22).
// week-ahead.ts / week-prints.json were gutted again on 10/22 (d3eb1269/aed6d593/2a2f9764, restored in #83).
// The generic floors above are loose on purpose; these are the two files that keep getting replaced, so they get
// tight floors, more stub markers, and an end-of-file / shape check that catches a cut-off write.
// The checks themselves live in plan-file-guard.mjs (2026-10-26) so find-last-good-plan.mjs can reuse them.
for (const path of PLAN_FILES) {
  // requiredExports: every name another file imports from this plan must still be exported (partial-loss check).
  const requiredExports = importedNamesFor(ROOT, path);
  const probs = weekFileProblems(path, read(path), { requiredExports });
  ok(probs.length === 0, probs.join("; ") || path);
  // self-test: the guard must reject a placeholder-only and a truncated copy of the real file
  const real = read(path) ?? "";
  const stub = path.endsWith(".ts") ? "// FULL_CONTENT_HERE\nexport const WEEK = [];\n" : '[{"date":"PLACEHOLDER"}]';
  ok(weekFileProblems(path, stub).length > 0, `${path} guard rejects a placeholder-only file`);
  ok(weekFileProblems(path, real.slice(0, Math.floor(real.length * 0.6))).length > 0, `${path} guard rejects a truncated file`);
  if (probs.length) continue; // the self-tests below edit the real file, so they need a healthy one
  // self-test: an ordinary comment that merely mentions a marker word is NOT a stub (Accuracy Review 2026-10-26)
  const noted = path.endsWith(".ts")
    ? real.replace(/\n/, "\n// placeholder note: the truncated range is restamped Sunday; see the existing code path below.\n")
    : (() => { try { const j = JSON.parse(real); if (Array.isArray(j) && j[0]) j[0].note = `${j[0].note} (placeholder consensus; truncated session)`; return JSON.stringify(j, null, 2); } catch { return real; } })();
  ok(weekFileProblems(path, noted, { requiredExports }).length === 0, `${path} guard accepts a normal comment that mentions a marker word`);
  // self-test: dropping one imported function (the 01a7c5a6 partial loss) is caught
  const fn = [...requiredExports.keys()].find((n) => new RegExp(`export\\s+(async\\s+)?function\\s+${n}\\b`).test(real));
  if (fn) {
    const lost = real.replace(new RegExp(`export\\s+(async\\s+)?function\\s+${fn}\\b`), `function ${fn}_gone`);
    ok(weekFileProblems(path, lost, { requiredExports }).some((p) => p.includes("partial loss")), `${path} guard rejects losing imported function ${fn}`);
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

  // ALL of src/lib, not a named allowlist. The previous version watched only
  // lib/{trading,market,invest,alerts}, which is why src/lib/multiplayer/ —
  // 21KB of peer-to-peer code in a futures desk, imported by nothing — was
  // invisible to it. A guard that only looks where it expects trouble finds
  // only the trouble it expected.
  const libs = sources.filter(
    (f) =>
      /^src\/lib\//.test(f) &&
      !/\/types\.ts$/.test(f) &&
      !/\.test\.ts$/.test(f),
  );

  const dark = [];
  for (const lib of libs) {
    const base = lib.replace(/^src\//, "").replace(/\.tsx?$/, "");
    const leaf = base.split("/").pop();
    let referenced = false;
    // A module's own directory barrel does NOT count as a consumer.
    //
    // This was the hole that hid src/lib/multiplayer/: index.ts re-exports
    // p2p.ts, so p2p looked wired, while index.ts itself was excluded as a
    // barrel and was never checked. Two dead files vouching for each other.
    // A re-export is only reachability if something outside imports the barrel.
    const ownBarrel = `${lib.slice(0, lib.lastIndexOf("/"))}/index`;
    for (const [f, src] of corpus) {
      if (f === lib) continue;
      if (f === `${ownBarrel}.ts` || f === `${ownBarrel}.tsx`) continue;
      // An IMPORT, not a mention.
      //
      // `options-sleeve.ts` carries the comment "sleeve-sizing.ts is the
      // authority now" while importing nothing from it — so a plain substring
      // search for the filename reports a DEAD module as wired, which is
      // precisely how the corrected sleeve model sat unused behind a comment
      // claiming it was live. Only a real import/export specifier counts.
      const esc = leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const imported = new RegExp(
        `(?:from|import\\s*\\(?|require\\()\\s*["'][^"']*?(?:^|/)${esc}(?:\\.tsx?)?["']`,
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
  /**
   * KNOWN DARK. This list may only ever SHRINK.
   *
   * 2026-09-24: the original seven are GONE.
   *   sleeve-sizing    -> drives options-desk contract sizing
   *   card-freshness   -> the spent-card strip
   *   setup-memory     -> the Book tab, via trade-log.ts
   *   ladder-conflict  -> the scanner card's disagreement warning
   *   override-log     -> the Book tab's per-gate override scorecard
   *   kill-watch       -> the Invest tab, on demand
   *   liquidity-map    -> DELETED. It was a byte-identical duplicate of the
   *                       LiquidityPool mapping already live in structure.ts;
   *                       wiring it would have created two sources of truth
   *                       for the pool map, which is the exact "two brains for
   *                       one word" failure this desk has already paid for.
   *   src/lib/multiplayer/ -> DELETED. 21KB of peer-to-peer code in a futures
   *                       desk, no consumers.
   *
   * These are what WIDENING the scan to all of src/lib then surfaced.
   * They are infrastructure rather than non-desk junk, and deleting auth or
   * attestation code nobody asked about is not a guard's decision to make:
   *
   *   auth/popup.server.ts
   *     — server-side session handling. Other .server.ts modules in this repo
   *       ARE imported normally (coach/claude-server by trading-coach.tsx), so
   *       being unimported is a real signal, not a framework artefact.
   *   journal/attest-fn.ts
   *     — read-only server fns over the attestation chain. The chain itself is
   *       live; these readers are not mounted.
   *
   * Each needs a deliberate wire-or-delete by the trader.
   */
  const KNOWN_DARK = new Set([
    "src/lib/auth/popup.server.ts",
    "src/lib/journal/attest-fn.ts",
    // Alpaca adapter is exercised by verify-room-exec. The live desk places on
    // Robinhood (rh-autofire), so nothing under src/ imports this module.
    "src/lib/room/exec/alpaca.ts",
    // Floor avatar IK / locomotion — present for the 3D room, no decision path
    // under src/ imports them yet.
    "src/lib/room/floor-ik.ts",
    "src/lib/room/floor-locomotion.ts",
    // Backtest engine (2026-10-13): driven only by scripts/backtest.mts and the replay/measure scripts
    // (scripts/dump-loss-features.mts); no src/ path imports it — the live desk never backtests.
    "src/lib/backtest/engine.ts",
    // 2026-10-15: fast-chain.ts is the TS twin of watcher/fastchain.py — the WATCHER (Python) fires from the
    // fastChain rules; this module exists for the parity test (scripts/fast-chain.test.mjs). Its intended desk
    // use (Floor / Watcher tab showing the same rows) is not wired: watcher-tab.tsx is a read-only view of the
    // watcher's own output, so it already shows the watcher's verdict. Wiring would be a UI feature, not a fix.
    "src/lib/execution/fast-chain.ts",
    // 2026-10-15: seq/calibrate.ts is the SHADOW isotonic calibration (Fix 8) — fitted offline and evaluated only
    // by scripts/eval-desk-seq-f2378.mts. Promoting it to the live rank is a rules change needing Keaton's call
    // (deskSeq.calibrate mode), so it stays scripts-only until then.
    "src/lib/smc/seq/calibrate.ts",
    "src/lib/smc/seq/ladder-grade.ts", // #60 baselined until wired (Design Atelier req)
  ]);
  // 2026-10-12: auth/verify.server.ts and market/tape-trust.ts came off — both now
  // imported from live src/ paths (inventory refresh; guards unchanged).
  // 2026-10-12: rh-http / rh-ledger / rh-mcp came off — wired via dynamic import()
  // from cron + rh-server / option-marks; the dark scan now matches import("...").
  // 2026-10-12: auth/isolation.server.ts came off — middleware.ts dynamic-imports it.
  // 2026-10-06: src/lib/execution/rh-autofire.ts came off — the real Manager feed's live loop
  // (src/lib/room/manager-live-loop.ts) drives it, and the Floor's Manager panel prints its read.
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

// ─────────────────────────────────────────────────────────────────────────────
// 5. CLAUDE.md MAY NOT CLAIM A RULE THE CODE DOES NOT IMPLEMENT
//
// "If copy and code disagree, code wins" is the stated rule, and it only works
// if somebody notices the disagreement. The Judas row claimed an "A+ exception
// if fully complete after the raid" while THREE separate code paths refused
// every entry in that window unconditionally — a carve-out that existed only
// in the document, in the one window the desk most wants a hard rule in.
//
// These are coherence checks, not style checks: each pairs a sentence in the
// doc against the code path that would have to implement it.
// ─────────────────────────────────────────────────────────────────────────────
{
  const doc = read("CLAUDE.md") ?? "";
  const master = read("src/lib/trading/smc-master.ts") ?? "";
  const paper = read("src/lib/trading/paper-manager.ts") ?? "";

  // What the CODE does about the Judas window.
  //
  // UPDATED 2026-10-15. Keaton 2026-10-13: Judas 09:30-09:45 is TRADED; the
  // window is a warning, never a block (judas-window.ts JUDAS_BLOCKS = false,
  // a63bf6ca / fd86b3d1 / 430d18cf dropped judasRead.blocked). The previous
  // assertion pinned the 2026-09-24 "blocked until released" design, which no
  // longer exists, so it was red against a trader-approved change. This now
  // pins the CURRENT invariant: (a) one switch, JUDAS_BLOCKS, exported false;
  // (b) smc-master's clean layer fails on the NEWS print only, never the
  // window; (c) paper-manager and both path-alarm sites still read readJudas
  // and gate on JUDAS_BLOCKS, so flipping the one switch restores the
  // fail-closed block everywhere instead of needing a hunt for call sites.
  const alarm = read("src/lib/alerts/path-alarm.ts") ?? "";
  const judasMod0 = read("src/lib/trading/judas-window.ts") ?? "";
  const judasGuarded =
    /export const JUDAS_BLOCKS = false;/.test(judasMod0) &&
    /id: "clean",[\s\S]{0,120}?state: newsBlk \? "fail" : "pass"/.test(master) &&
    /readJudas\(/.test(master);
  const judasFillGuarded =
    /isJudasWindow\([^)]*\)\)\s*\{[\s\S]{0,400}?readJudas\([\s\S]{0,240}?JUDAS_BLOCKS\)\s*\{\s*return \{ ok: false/.test(paper) &&
    (alarm.match(/JUDAS_BLOCKS &&\s*isJudasWindow\([\s\S]{0,200}?readJudas\(/g) ?? []).length >= 2;
  ok(judasGuarded, "Judas is warning-only: JUDAS_BLOCKS=false and smc-master's clean layer fails on news only");
  ok(judasFillGuarded, "paper-manager + path-alarm gate the Judas read on the single JUDAS_BLOCKS switch");

  // The release must FAIL CLOSED. Without this the whole design inverts: no
  // minute tape would mean no block instead of no trade.
  const judasModule = read("src/lib/trading/judas-window.ts") ?? "";
  ok(
    /stage: "no-tape"/.test(judasModule) && /blocked: true/.test(judasModule),
    "judas-window fails closed when there is no sub-15m tape to resolve with",
  );
  ok(
    /JUDAS_MIN_CONFLUENCE = 0\.75/.test(judasModule),
    "a Judas entry still has to carry the A+ tag, not merely the 0.65 floor",
  );

  // The doc may not advertise a carve-out looser than the code implements.
  if (judasGuarded && judasFillGuarded) {
    const judasLines = doc
      .split("\n")
      .filter((l) => /judas/i.test(l))
      .join(" ");
    ok(
      !/A\+ exception/i.test(judasLines),
      'CLAUDE.md does not claim an "A+ exception" the code never implements',
    );
    ok(
      !/Judas[^.|]{0,40}A\+ only/i.test(judasLines),
      'CLAUDE.md does not say Judas is "A+ only" while the code takes nothing',
    );
  }

  // The sleeve model: the doc must not restate the superseded ceiling. The
  // trader replaced "$1,000 account, 15% of it = $150 max debit" with a
  // $1,000 DEBIT ceiling on 2026-09-23, and the Options tab row kept the old
  // sentence for a day after the hard-rules row changed.
  ok(
    !/risk 15% = \$150\*\* max debit/.test(doc),
    'CLAUDE.md does not restate the superseded "15% of $1,000 = $150 ceiling"',
  );
}

console.log(`\nrepo-guards: ${pass} passed, ${fail} failed`);
if (fails.length) {
  console.log("\nFAILURES:");
  for (const f of fails) console.log("  ✗", f);
}
process.exit(fail ? 1 : 0);
