/**
 * The futures → ETF crossover (src/lib/market/spot-cross.ts) against its contract.
 *
 *   npx tsx scripts/verify-spot-cross.mjs
 *
 * WHY: a 1-DTE ATM option costs ~0.4% of the ETF, so a 1% error in the spot an option is priced on
 * is about the whole premium. The desk used to take the Yahoo SPY/QQQ print as "now" for up to 15
 * minutes and read its ratio to the LIVE future off that print — two moments in one number. Now
 * ratio = future at the print's own timestamp ÷ print, and ETF now = live future ÷ ratio.
 *
 * Pure and deterministic: no network, no clock. The last section prices the same option three ways
 * with the real Black-Scholes in the room's option-math and prints what the stale print costs.
 */
const { futAt, alignRatio, crossProxy, crossBoth, etfFromFuture, DEFAULT_RATIO, PRINT_FRESH_SEC, PRINT_MAX_AGE_SEC, FUT_LIVE_MAX_LAG_SEC, ALIGN_MAX_GAP_SEC, RATIO_BAND } = await import(
  "../src/lib/market/spot-cross.ts"
);
const { estimateSpot, spotSource } = await import("../src/lib/trading/options-desk.ts");
const { quoteOption, ivFor } = await import("../src/lib/room/option-math.ts");
const { etWallToEpochMs } = await import("../src/lib/trading/sessions.ts");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};
const close = (a, b, tol = 1e-9) => a != null && b != null && Math.abs(a - b) <= tol;

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 6, 13, 40); // 09:40 ET Tue 2026-10-06 (EDT = UTC−4)
const bar = (k, o, c) => ({ t: T0 + k * MIN, o, h: Math.max(o, c), l: Math.min(o, c), c, v: 100 });

console.log("futAt — the future at an instant, from 1m bars");
{
  const bars = [bar(0, 100, 102), bar(1, 102, 101), bar(2, 101, 105)];
  check("empty bars → null", futAt([], T0) === null);
  check("before the first bar → null", futAt(bars, T0 - 1) === null);
  check("non-finite instant → null", futAt(bars, NaN) === null);
  check("at a bar's start → its open", futAt(bars, T0) === 100);
  check("half-way through a minute → open→close interpolated", close(futAt(bars, T0 + 30_000), 101));
  check("a quarter of the way into the third bar", close(futAt(bars, T0 + 2 * MIN + 15_000), 102));
  check("exactly at the last bar's end → its close", futAt(bars, T0 + 3 * MIN) === 105);
  check(`≤${ALIGN_MAX_GAP_SEC}s past the last bar's end → its close`, futAt(bars, T0 + 3 * MIN + ALIGN_MAX_GAP_SEC * 1000) === 105);
  check(`>${ALIGN_MAX_GAP_SEC}s past the last bar's end → null (a gap is not a price)`, futAt(bars, T0 + 3 * MIN + (ALIGN_MAX_GAP_SEC + 1) * 1000) === null);
  const gap = [bar(0, 100, 102), bar(5, 110, 111)];
  check("inside a short gap between bars → the prior close", futAt(gap, T0 + 2 * MIN) === 102);
  check("deep inside a long gap → null", futAt(gap, T0 + 4 * MIN + 50_000) === null);
  const long = Array.from({ length: 480 }, (_, k) => bar(k, 1000 + k, 1000 + k + 3));
  check("a 480-bar session: the right bar is found (binary search)", close(futAt(long, T0 + 300 * MIN + 20_000), 1300 + 1), String(futAt(long, T0 + 300 * MIN + 20_000)));
  check("a flat/zero bar is not a price", futAt([{ t: T0, o: 0, h: 0, l: 0, c: 0, v: 1 }], T0 + 10_000) === null);
}

console.log("alignRatio — the ratio at the print's own instant");
{
  const nowMs = T0 + 10 * MIN; // 09:50:00
  const live = { px: 31_108.5, lagSec: 1 };
  const bars = [bar(0, 30_950, 30_970), bar(1, 30_970, 31_000), bar(2, 31_000, 31_020), bar(9, 31_100, 31_108.5)];
  // A print at 09:42:30 (bar 2 starts 09:42): bar 2 is 31 000 → 31 020, so 31 010 half-way.
  const stale = { price: 775.25, marketTimeMs: T0 + 2 * MIN + 30_000 };

  check("no proxy → no_print", alignRatio("QQQ", null, bars, live, nowMs).how === "no_print");
  check("a zero print → no_print", alignRatio("QQQ", { price: 0, marketTimeMs: nowMs }, bars, live, nowMs).how === "no_print");
  check("no future → no_future", alignRatio("QQQ", stale, bars, { px: 0, lagSec: 0 }, nowMs).how === "no_future");

  const fresh = alignRatio("QQQ", { price: 777.7125, marketTimeMs: nowMs - 3000 }, bars, live, nowMs);
  check(`a print ≤${PRINT_FRESH_SEC}s old calibrates against the live future directly`, fresh.how === "fresh_print" && close(fresh.ratio, 40, 1e-4), JSON.stringify(fresh));
  const delayed = alignRatio("QQQ", { price: 777.7125, marketTimeMs: nowMs - 3000 }, bars, { px: 31_108.5, lagSec: 600 }, nowMs);
  check(`a fresh print against a DELAYED future (lag 600s > ${FUT_LIVE_MAX_LAG_SEC}s) is refused — two moments in one ratio`, delayed.ratio === null && delayed.how === "future_not_live", JSON.stringify(delayed));
  const edgeLive = alignRatio("QQQ", { price: 777.7125, marketTimeMs: nowMs - 3000 }, bars, { px: 31_108.5, lagSec: FUT_LIVE_MAX_LAG_SEC }, nowMs);
  check("a future exactly at the live bound still calibrates", edgeLive.how === "fresh_print");

  const al = alignRatio("QQQ", stale, bars, live, nowMs);
  check("an older print uses the future AT ITS OWN TIMESTAMP, not the future now", al.how === "aligned" && close(al.ratio, Math.round((31_010 / 775.25) * 1e4) / 1e4, 1e-9), JSON.stringify(al));
  check("…which differs from the naïve ratio against the future now by ≥0.3% (the mixed-moments error)", Math.abs(al.ratio / (31_108.5 / 775.25) - 1) >= 0.003, `aligned ${al.ratio} naive ${31_108.5 / 775.25}`);

  check("the future now disagrees with the series' last bar by >1% (a roll) → series_mismatch", alignRatio("QQQ", stale, bars, { px: 31_108.5 * 1.02, lagSec: 1 }, nowMs).how === "series_mismatch");
  check("a print newer than the bars (>150s) → bars_do_not_cover", alignRatio("QQQ", { price: 777, marketTimeMs: T0 + 9 * MIN + 61_000 + 200_000 }, bars.slice(0, 3), { px: 31_020, lagSec: 1 }, T0 + 20 * MIN).how === "bars_do_not_cover");
  check("a print before the bars → bars_do_not_cover", alignRatio("QQQ", { price: 775, marketTimeMs: T0 - 5 * MIN }, bars, live, nowMs).how === "bars_do_not_cover");
  check("a print older than 72h → print_too_old", alignRatio("QQQ", { price: 775, marketTimeMs: nowMs - PRINT_MAX_AGE_SEC * 1000 - 1000 }, bars, live, nowMs).how === "print_too_old");
  check("a Friday close still calibrates Sunday night (<72h)", alignRatio("QQQ", { price: 775, marketTimeMs: nowMs - 52 * 3600_000 }, [bar(-52 * 60, 31_000, 31_000), ...bars], live, nowMs).how !== "print_too_old");

  const sOK = alignRatio("SPY", { price: 7000, marketTimeMs: nowMs - 3000 }, bars, { px: 70_200, lagSec: 1 }, nowMs);
  check(`SPY ratio ≈ ${DEFAULT_RATIO.SPY} is accepted`, sOK.how === "fresh_print" && close(sOK.ratio, 10.0286, 1e-4), JSON.stringify(sOK));
  check("the ratio is rounded to 4 dp (70 200 ÷ 7 000 = 10.028571… → 10.0286)", sOK.ratio === 10.0286, String(sOK.ratio));
  check(`a ratio outside ±${RATIO_BAND * 100}% of the default is not a ratio (SPY 12.5)`, alignRatio("SPY", { price: 5000, marketTimeMs: nowMs - 1000 }, bars, { px: 62_500, lagSec: 1 }, nowMs).how === "ratio_out_of_band");
  check("…nor QQQ against the wrong scale (NQ ÷ 1250 → 24.8)", alignRatio("QQQ", { price: 1250, marketTimeMs: nowMs - 1000 }, bars, { px: 31_000, lagSec: 1 }, nowMs).how === "ratio_out_of_band");
}

console.log("crossProxy — attaches the ratio, never mutates");
{
  const p = Object.freeze({ ticker: "QQQ", price: 777.7125, marketTimeMs: T0 + 10 * MIN - 3000, lagSec: 3, source: "yahoo" });
  const out = crossProxy("QQQ", p, [], { px: 31_108.5, lagSec: 1 }, T0 + 10 * MIN);
  check("returns a new object carrying ratio and printAgeSec", out !== p && close(out.ratio, 40, 1e-4) && out.printAgeSec === 3, JSON.stringify(out));
  check("the input is untouched", p.ratio === undefined && p.printAgeSec === undefined);
  check("the original fields survive", out.ticker === "QQQ" && out.price === 777.7125 && out.source === "yahoo");
  check("null in → null out", crossProxy("QQQ", null, [], { px: 31_000, lagSec: 1 }, T0) === null);
  const none = crossProxy("QQQ", p, [], { px: 0, lagSec: 1 }, T0 + 10 * MIN);
  check("no future → ratio null (the print stays as it was)", none.ratio === null && none.price === 777.7125);
}

console.log("etfFromFuture — the ETF now");
{
  check("future ÷ ratio", close(etfFromFuture(40, 31_108.5, 775), 777.7125));
  check("no ratio → null", etfFromFuture(null, 31_000, 775) === null && etfFromFuture(undefined, 31_000, 775) === null && etfFromFuture(0, 31_000, 775) === null && etfFromFuture(-40, 31_000, 775) === null);
  check("no future → null", etfFromFuture(40, 0, 775) === null);
  check("an answer >10% from the print is not credible → null (a futures glitch cannot move the ETF a tenth)", etfFromFuture(40, 35_000, 775) === null);
  check("…the same answer is fine when the print is far older than the move (<10%)", etfFromFuture(40, 31_900, 775) != null);
  check("the spot moves at futures speed: +0.1% future → +0.1% ETF", close(etfFromFuture(40, 31_108.5 * 1.001, 775) / etfFromFuture(40, 31_108.5, 775), 1.001, 1e-12));
}

console.log("crossBoth — the right future for the right ETF, wherever the desk put it");
{
  const nowMs = T0 + 10 * MIN;
  const mnq = (price, lagSec = 1, source = "live_gateway") => ({ symbol: "MNQ", quote: { price, lagSec, source }, minute: [bar(9, price, price)] });
  const es = (price, lagSec = 1, source = "live_gateway") => ({ symbol: "ES", quote: { price, lagSec, source }, minute: [bar(9, price, price)] });
  const spots = {
    SPY: { ticker: "SPY", price: 7000, marketTimeMs: nowMs - 2000, lagSec: 2, source: "yahoo" },
    QQQ: { ticker: "QQQ", price: 777.7125, marketTimeMs: nowMs - 2000, lagSec: 2, source: "yahoo" },
  };
  const live = (s) => s === "live_gateway" || s === "databento" || s === "yahoo";

  const a = crossBoth({ left: mnq(31_108.5), right: es(70_200) }, spots, nowMs, live);
  check("left MNQ / right ES: QQQ ← MNQ", close(a.QQQ.ratio, 40, 1e-4), String(a.QQQ.ratio));
  check("left MNQ / right ES: SPY ← ES", close(a.SPY.ratio, 10.0286, 1e-4), String(a.SPY.ratio));
  const b = crossBoth({ left: es(70_200), right: mnq(31_108.5) }, spots, nowMs, live);
  check("left ES / right MNQ gives the same answer (not a left/right assumption)", b.QQQ.ratio === a.QQQ.ratio && b.SPY.ratio === a.SPY.ratio);
  const c = crossBoth({ left: mnq(31_108.5, 1, "synthetic"), right: es(70_200) }, spots, nowMs, live);
  check("a synthetic NQ quote crosses nothing — QQQ's proxy comes back untouched", c.QQQ === spots.QQQ && c.QQQ.ratio === undefined);
  check("…and does not stop SPY crossing against a real ES", c.SPY.ratio != null);
  const d = crossBoth({ left: mnq(31_108.5), right: es(70_200, 1, "synthetic") }, spots, nowMs, live);
  check("a synthetic ES quote crosses nothing for SPY", d.SPY === spots.SPY && d.QQQ.ratio != null);
  const e = crossBoth({ left: es(70_200), right: es(70_200) }, spots, nowMs, live);
  check("two ES books and no NQ: QQQ is untouched, not crossed against the wrong future", e.QQQ === spots.QQQ && e.SPY.ratio != null);
  const f = crossBoth({ left: mnq(31_108.5), right: es(70_200) }, { SPY: null, QQQ: null }, nowMs, live);
  check("no ETF prints at all → nothing to cross, nothing invented", f.SPY === null && f.QQQ === null);
  const g = crossBoth({ left: mnq(31_108.5, 600, "yahoo"), right: es(70_200, 600, "yahoo") }, spots, nowMs, live);
  check("Yahoo-delayed futures never calibrate a live print (the real-time print stays the spot)", g.QQQ.ratio === null && g.SPY.ratio === null, JSON.stringify([g.QQQ.ratio, g.SPY.ratio]));
}

console.log("estimateSpot / spotSource — the precedence the options desk prices on");
{
  const esPx = 70_200;
  const nqPx = 31_108.5;
  const print = (extra) => ({ ticker: "QQQ", price: 775.25, marketTimeMs: 0, lagSec: 450, source: "yahoo", ...extra });
  const prox = (q, s) => ({ SPY: s ?? null, QQQ: q ?? null });

  check("a crossed QQQ is the live NQ ÷ the print-time ratio (not the stale print)", close(estimateSpot("QQQ", esPx, nqPx, prox(print({ ratio: 40.0, printAgeSec: 450 }))), 777.7125));
  check("a crossed SPY is the live ES ÷ ITS ratio (ES, not NQ)", close(estimateSpot("SPY", esPx, nqPx, prox(null, { ...print({ ticker: "SPY", price: 6990 }), ratio: 10.04, printAgeSec: 450 })), esPx / 10.04, 1e-9));
  const r0 = estimateSpot("QQQ", nqPx, nqPx, prox(print({ ratio: 40 })));
  const r1 = estimateSpot("QQQ", nqPx, nqPx * 1.001, prox(print({ ratio: 40 })));
  check("the spot follows the future between desk builds (+0.1% → +0.1%)", close(r1 / r0, 1.001, 1e-12));
  check("no ratio, print ≤900s → the print (as before)", estimateSpot("QQQ", esPx, nqPx, prox(print({ ratio: null, lagSec: 899 }))) === 775.25);
  check("no ratio field at all, print ≤900s → the print (as before)", estimateSpot("QQQ", esPx, nqPx, prox(print({ lagSec: 12 }))) === 775.25);
  check("no ratio, print >900s → NQ/40 (as before)", close(estimateSpot("QQQ", esPx, nqPx, prox(print({ ratio: null, lagSec: 901 }))), nqPx / 40));
  check("no proxies → ES/10 for SPY, NQ/40 for QQQ (as before)", close(estimateSpot("SPY", esPx, nqPx), esPx / 10) && close(estimateSpot("QQQ", esPx, nqPx), nqPx / 40));
  check("a ratio that puts the ETF >10% off its print is not credible → falls back to the print", estimateSpot("QQQ", esPx, 40_000, prox(print({ ratio: 40, lagSec: 5 }))) === 775.25);

  const src = spotSource("QQQ", esPx, nqPx, prox(print({ ratio: 40, printAgeSec: 450 })));
  check("source copy says what the number is: future ÷ ratio, and the print's age", /^QQQ 777\.71 \(NQ live ÷ 40\.000, print 450s\)$/.test(src), src);
  check("SPY copy names ES", /^SPY .* \(ES live ÷ /.test(spotSource("SPY", esPx, nqPx, prox(null, { ...print({ ticker: "SPY", price: 6990 }), ratio: 10.04, printAgeSec: 3 }))));
  check("print fallback keeps its old wording", spotSource("QQQ", esPx, nqPx, prox(print({ lagSec: 12 }))) === "QQQ 775.25 (Yahoo 12s)");
  check("constant fallback keeps its old wording", spotSource("QQQ", esPx, nqPx) === `QQQ ≈ ${(nqPx / 40).toFixed(2)} (NQ/40 est.)` && spotSource("SPY", esPx, nqPx) === `SPY ≈ ${(esPx / 10).toFixed(2)} (ES/10 est.)`);
}

console.log("what a stale print costs a 1-DTE ATM call (real Black-Scholes, QQQ, VIX 18)");
{
  // 09:42:30 ET: QQQ prints 775.00 with NQ at 31 000.00 (ratio 40.000). 09:50:00: NQ is 31 108.50 (+0.35%).
  // The ETF's own print is 7.5 minutes old; the desk used to price off it.
  const nowMs = etWallToEpochMs("2026-10-06", "09:50");
  const exp = "2026-10-07";
  const iv = ivFor("QQQ", 18);
  const futNow = 31_108.5;
  const bars = [{ t: T0 + 2 * MIN, o: 30_990, h: 31_020, l: 30_985, c: 31_010, v: 100 }, { t: T0 + 9 * MIN, o: 31_100, h: 31_110, l: 31_095, c: 31_108.5, v: 100 }];
  const printTime = T0 + 2 * MIN + 30_000;
  const cross = crossProxy("QQQ", { ticker: "QQQ", price: 775.0, marketTimeMs: printTime, lagSec: 450, source: "yahoo" }, bars, { px: futNow, lagSec: 1 }, nowMs);
  check("the print time falls inside bar 09:42 → the future then was 31 000.00 → ratio 40.0000", close(cross.ratio, 40, 1e-9), String(cross.ratio));
  const crossed = estimateSpot("QQQ", 0, futNow, { SPY: null, QQQ: cross });
  const stale = 775.0; // what estimateSpot returned before: the print, 450s old, inside the 900s window
  const strike = 778;
  const price = (s) => quoteOption(s, strike, exp, "CALL", iv, nowMs);
  // The truth in this scenario: the ratio held, so the ETF is exactly NQ ÷ 40. A second truth lets the basis drift 0.04% in the 7.5 minutes.
  const truthHeld = futNow / 40;
  const truthDrift = futNow / (40 * 1.0004);
  const prem = price(truthHeld).mid;
  const errStale = Math.abs(price(stale).mid - prem);
  const errCross = Math.abs(price(crossed).mid - prem);
  const premD = price(truthDrift).mid;
  const errStaleD = Math.abs(price(stale).mid - premD);
  const errCrossD = Math.abs(price(crossed).mid - premD);
  console.log(`  QQQ now ${truthHeld.toFixed(2)} · stale print ${stale.toFixed(2)} (−${(((truthHeld - stale) / truthHeld) * 100).toFixed(2)}%) · crossed ${crossed.toFixed(2)}`);
  console.log(`  ${strike}C 1 DTE mid ${prem.toFixed(2)}: stale print prices it ${price(stale).mid.toFixed(2)} (off $${errStale.toFixed(2)}/sh = ${((errStale / prem) * 100).toFixed(0)}% of the premium; $${(errStale * 100).toFixed(0)}/contract) · crossed ${price(crossed).mid.toFixed(2)} (off $${errCross.toFixed(2)})`);
  console.log(`  with 0.04% basis drift: stale off $${errStaleD.toFixed(2)} (${((errStaleD / premD) * 100).toFixed(0)}%) · crossed off $${errCrossD.toFixed(2)} (${((errCrossD / premD) * 100).toFixed(0)}%)`);
  check("the crossed spot is the future ÷ the ratio", close(crossed, truthHeld));
  check("a 0.35% stale print misprices the call by ≥25% of its premium (why this exists)", errStale / prem >= 0.25, `${((errStale / prem) * 100).toFixed(1)}%`);
  check("crossed with the ratio holding: priced to the cent", errCross < 0.005, `$${errCross.toFixed(3)}`);
  check("crossed with a 0.04% basis drift: still ≥5× closer than the stale print", errCrossD * 5 <= errStaleD, `crossed $${errCrossD.toFixed(3)} stale $${errStaleD.toFixed(3)}`);
  check("crossed with a 0.04% basis drift: within 8% of the premium", errCrossD / premD <= 0.08, `${((errCrossD / premD) * 100).toFixed(1)}%`);
  // The strike the ledger picks follows the spot: 777.71 rounds to 778, 775.00 to 775 — three strikes apart.
  check("the ATM strike moves with the spot: the stale print sits three strikes from the live ATM", Math.round(crossed) - Math.round(stale) === 3, `${Math.round(crossed)} vs ${Math.round(stale)}`);
}

console.log(`\nspot-cross: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
