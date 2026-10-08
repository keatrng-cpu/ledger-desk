/**
 * ITEM 21 — a lagged tape must not arm a card.
 *
 * The wire reports lag; nothing refused on it. A card graded on a series whose
 * last bar closed three buckets ago was still actionable, and the live print is
 * patched onto the FORMING bar (`applyQuoteToLastBar`), which scanner.ts then
 * reads as bars — so a single live print could supply the wick a sweep needs
 * and the close a displacement needs.
 *
 * The properties under test:
 *   1. more than ONE closed bar of lag ⇒ not ok (the card reads WAIT),
 *   2. the quote's own lag counts the same way as the bar clock,
 *   3. a synthetic or empty tape never arms,
 *   4. `closedTape` cuts the forming bar, so the detectors cannot read it,
 *   5. `applyTapeTrust` only ever REMOVES a take, never grants one.
 *
 * Run: npx tsx scripts/verify-tape-trust.mjs
 */

const { tapeTrust, closedTape, applyTapeTrust, TAPE_MAX_BARS_BEHIND } = await import(
  "../src/lib/market/tape-trust.ts"
);

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const M15 = 15 * 60_000;
const T0 = Date.UTC(2026, 9, 5, 13, 0); // 09:00 ET bucket open
/** n 15m bars, the last one opening at `lastOpen`. */
const series = (lastOpen, n = 30) =>
  Array.from({ length: n }, (_, i) => {
    const t = lastOpen - (n - 1 - i) * M15;
    return { t, o: 100, h: 101, l: 99, c: 100.5, v: 10 };
  });

console.log("the rule is the trader's: more than one closed bar of lag waits");
{
  check("the tolerance is one bar", TAPE_MAX_BARS_BEHIND === 1, String(TAPE_MAX_BARS_BEHIND));

  // now sits inside the bucket that opened at T0 -> that bar is forming, the
  // bar before it closed a moment ago: 0 bars behind.
  const current = tapeTrust(series(T0), { nowMs: T0 + 60_000, interval: "15m" });
  check("a forming newest bar is the normal case", current.ok && current.formingBar, JSON.stringify(current));
  check("and it is zero bars behind", current.barsBehind === 0, String(current.barsBehind));

  // The bar that opened at T0 has just closed and nothing is forming yet.
  const justClosed = tapeTrust(series(T0), { nowMs: T0 + M15 + 60_000, interval: "15m" });
  check("a bar that closed a minute ago is current", justClosed.ok && justClosed.barsBehind === 0, JSON.stringify(justClosed));

  // A whole bucket has elapsed with nothing printed for it: one bar of lag.
  const oneBack = tapeTrust(series(T0), { nowMs: T0 + 2 * M15 + 60_000, interval: "15m" });
  check("one closed bar of lag still arms (Databento historical runs about one bucket back)", oneBack.ok, JSON.stringify(oneBack));
  check("and says so", oneBack.barsBehind === 1, String(oneBack.barsBehind));

  const twoBack = tapeTrust(series(T0), { nowMs: T0 + 3 * M15 + 60_000, interval: "15m" });
  check("two closed bars of lag does NOT arm", twoBack.ok === false && twoBack.barsBehind === 2, JSON.stringify(twoBack));
  check("the reason is the one the card carries", /TAPE LATE/.test(twoBack.reason) && /WAIT/.test(twoBack.reason), twoBack.reason);

  const far = tapeTrust(series(T0), { nowMs: T0 + 20 * M15, interval: "15m" });
  check("five hours behind does not arm", far.ok === false && far.barsBehind === 19, JSON.stringify([far.ok, far.barsBehind]));
}

console.log("\nthe quote's own lag counts, even when the bars look fresh");
{
  const now = T0 + 60_000;
  const fresh = tapeTrust(series(T0), { nowMs: now, interval: "15m", lagSec: 12 });
  check("a 12 s gateway confirmation is current", fresh.ok && fresh.quoteBarsBehind === 0, JSON.stringify(fresh));

  const late = tapeTrust(series(T0), { nowMs: now, interval: "15m", lagSec: 620 });
  check("the 620 s quiet-tape lag is inside one 15m bucket, so it still arms", late.ok && late.quoteBarsBehind === 0, JSON.stringify([late.ok, late.quoteBarsBehind]));

  const oneBucket = tapeTrust(series(T0), { nowMs: now, interval: "15m", lagSec: 16 * 60 });
  check("a 16 min stale print is one bucket and still arms", oneBucket.ok && oneBucket.quoteBarsBehind === 1, JSON.stringify([oneBucket.ok, oneBucket.quoteBarsBehind]));

  const dead = tapeTrust(series(T0), { nowMs: now, interval: "15m", lagSec: 2400 });
  check("a 40 min stale print does not arm even with fresh bars", dead.ok === false, JSON.stringify(dead));
  check("and the reason names the feed lag", /feed lag 2400s/.test(dead.reason), dead.reason);
  check("no lag given leaves the quote count null", tapeTrust(series(T0), { nowMs: now }).quoteBarsBehind === null);
}

console.log("\nnothing arms on a tape that is not a tape");
{
  check("no bars", tapeTrust([], { nowMs: T0, interval: "15m" }).ok === false);
  check("null bars", tapeTrust(null, { nowMs: T0, interval: "15m" }).ok === false);
  check("a synthetic feed", tapeTrust(series(T0), { nowMs: T0 + 60_000, interval: "15m", source: "synthetic" }).ok === false);
  check("a synthetic feed says so", /SYNTHETIC/.test(tapeTrust(series(T0), { nowMs: T0 + 60_000, source: "synthetic" }).reason));
  check("no clock", tapeTrust(series(T0), { nowMs: Number.NaN, interval: "15m" }).ok === false);
  const onlyForming = tapeTrust([{ t: T0, o: 1, h: 1, l: 1, c: 1, v: 0 }], { nowMs: T0 + 60_000, interval: "15m" });
  check("one bar that is still forming has no close to read", onlyForming.ok === false, JSON.stringify(onlyForming));
  check("the live gateway source arms like any other", tapeTrust(series(T0), { nowMs: T0 + 60_000, source: "live_gateway" }).ok === true);
}

console.log("\nthe forming bar cannot create a sweep, a gap or a displacement");
{
  const bars = series(T0);
  const kept = closedTape(bars, T0 + 60_000, "15m");
  check("the forming bar is cut", kept.length === bars.length - 1, `${bars.length} -> ${kept.length}`);
  check("the newest kept bar is the last CLOSED one", kept[kept.length - 1].t === T0 - M15, String(kept[kept.length - 1].t));
  check("a series with no forming bar is untouched", closedTape(bars, T0 + M15, "15m").length === bars.length);
  // The hazard in one line: a live print patched onto the forming bar invents a
  // wick. On the closed tape that wick does not exist.
  const patched = bars.slice(0, -1).concat({ ...bars[bars.length - 1], h: 9_999 });
  check("a print patched onto the forming bar is not in the closed tape", closedTape(patched, T0 + 60_000, "15m").every((b) => b.h < 9_999));
  check("but it IS in the full series the card reads for location", patched.some((b) => b.h === 9_999));
  check("an empty series stays empty", closedTape([], T0, "15m").length === 0);
}

console.log("\nthe gate only ever removes a take");
{
  const late = tapeTrust(series(T0), { nowMs: T0 + 3 * M15, interval: "15m" });
  const card = { actionable: true, missing: ["something else"] };
  check("a late tape stands the card down", applyTapeTrust(card, late) === true && card.actionable === false);
  check("the reason is first in missing", card.missing[0] === late.reason, JSON.stringify(card.missing));
  check("applying twice does not duplicate the reason", (() => {
    applyTapeTrust(card, late);
    return card.missing.filter((m) => m === late.reason).length === 1;
  })());

  const already = { actionable: false, missing: [] };
  const good = tapeTrust(series(T0), { nowMs: T0 + 60_000, interval: "15m" });
  check("a current tape does not make a stood-down card actionable", applyTapeTrust(already, good) === false && already.actionable === false);
  check("and it writes nothing", already.missing.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
