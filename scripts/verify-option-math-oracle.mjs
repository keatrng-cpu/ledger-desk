/**
 * The room's option pricer against an independent oracle — offline, no network, no model.
 *
 *   npx tsx scripts/verify-option-math-oracle.mjs
 *
 * `blackScholes` (src/lib/room/option-math.ts) prices every ticket the room quotes, books, marks and stops. Until now it was
 * checked by put-call parity (true by construction — the put is DEFINED by parity) and "an ATM delta is within 0.02 of 0.5".
 * This compares 864 prices, deltas and thetas to numbers written from the textbook formulas with an exact CDF
 * (scripts/oracle/bs_oracle.py → src/data/oracle-bs-grid.json: two spots, nine strikes from 50 in the money to 50 out, a quarter
 * hour to a month, four vols, calls and puts), against the tolerance the approximation documents for itself:
 *
 *   price  ≤ (S + K) · 7.5e-8   (Abramowitz & Stegun 7.1.26 is good to 7.5e-8 per CDF; a price holds two of them)
 *   delta  ≤ 7.5e-8             (one CDF)
 *   theta  ≤ 1e-9 relative      (it uses the pdf only, which is exact)
 *
 * An error beyond those bounds is not "the approximation" — it is a bug. The comparison is mutation-checked below: a pricer with
 * a delta off by 1e-6, a theta 0.1% high or a price a tenth of a cent off must be refused, or the bounds mean nothing.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const { blackScholes } = await import("../src/lib/room/option-math.ts");
const G = JSON.parse(readFileSync(new URL("../src/data/oracle-bs-grid.json", import.meta.url), "utf8"));

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};
const sci = (x) => x.toExponential(2);

/** Walk the fixture in the order it was written and hand each row to `visit` with the pricer's inputs. */
function walk(visit) {
  let i = 0;
  for (const s of G.spots) for (const off of G.offsets) for (const t of G.tYears) for (const v of G.ivs) for (const kind of G.kinds) visit({ s, k: s + off, t, v, kind, row: G.rows[i++] });
  return i;
}

/** The largest error, in units of its own bound, over the whole grid, for a pricer. >1 means a bound was broken. */
function worst(pricer) {
  const w = { price: 0, delta: 0, theta: 0, priceAbs: 0, deltaAbs: 0, thetaRel: 0 };
  walk(({ s, k, t, v, kind, row }) => {
    const [p, d, th] = row;
    const r = pricer(s, k, t, v, kind);
    const pb = (s + k) * 7.5e-8 * 1.01 + 1e-9;
    const db = 7.5e-8 * 1.01;
    const tb = 1e-9 * Math.max(1, Math.abs(th));
    const ep = Math.abs(r.price - p);
    const ed = Math.abs(r.delta - d);
    const et = Math.abs(r.thetaDay - th);
    w.price = Math.max(w.price, ep / pb);
    w.delta = Math.max(w.delta, ed / db);
    w.theta = Math.max(w.theta, et / tb);
    w.priceAbs = Math.max(w.priceAbs, ep);
    w.deltaAbs = Math.max(w.deltaAbs, ed);
    w.thetaRel = Math.max(w.thetaRel, et / Math.max(1e-12, Math.abs(th)));
  });
  return w;
}

console.log("the fixture");
const n = walk(() => {});
check("864 rows, as many as the axes say", n === 864 && G.rows.length === 864, `${n} / ${G.rows.length}`);
{
  const py = ["python", "python3"].map((cmd) => spawnSync(cmd, ["scripts/oracle/bs_oracle.py", "--check"], { encoding: "utf8" })).find((r) => !r.error && r.status !== null);
  if (!py) console.log("  SKIP the fixture is not regenerated here: no python on PATH — run scripts/oracle/bs_oracle.py --check where there is one");
  else check("the committed fixture is exactly what the Python oracle prints", py.status === 0, (py.stderr || py.stdout).trim());
}

console.log("the pricer against the oracle");
const w = worst(blackScholes);
check(`prices: worst error ${sci(w.priceAbs)} $/share, ${(w.price * 100).toFixed(0)}% of the documented bound`, w.price <= 1, `${w.price}`);
check(`deltas: worst error ${sci(w.deltaAbs)}, ${(w.delta * 100).toFixed(0)}% of the documented bound`, w.delta <= 1, `${w.delta}`);
check(`thetas: worst relative error ${sci(w.thetaRel)} (the bound is 1e-9)`, w.theta <= 1, `${w.theta}`);

console.log("the comparison has teeth (mutation check)");
const mutants = {
  "delta off by 1e-6": (s, k, t, v, kind) => ({ ...blackScholes(s, k, t, v, kind), delta: blackScholes(s, k, t, v, kind).delta + 1e-6 }),
  "theta 0.1% high": (s, k, t, v, kind) => ({ ...blackScholes(s, k, t, v, kind), thetaDay: blackScholes(s, k, t, v, kind).thetaDay * 1.001 }),
  "price a tenth of a cent off": (s, k, t, v, kind) => ({ ...blackScholes(s, k, t, v, kind), price: blackScholes(s, k, t, v, kind).price + 0.001 }),
  "theta per year, not per day": (s, k, t, v, kind) => ({ ...blackScholes(s, k, t, v, kind), thetaDay: blackScholes(s, k, t, v, kind).thetaDay * 365 }),
  "put priced as the call": (s, k, t, v, kind) => blackScholes(s, k, t, v, "CALL"),
};
for (const [name, m] of Object.entries(mutants)) {
  const mw = worst(m);
  check(`${name} is refused`, mw.price > 1 || mw.delta > 1 || mw.theta > 1, `price ${mw.price.toFixed(2)} delta ${mw.delta.toFixed(2)} theta ${mw.theta.toFixed(2)}`);
}

console.log("what must hold whatever the oracle says");
{
  let parity = 0;
  let deltaPar = 0;
  let outOfBounds = 0;
  let thetaSign = 0;
  const S = 777.71;
  for (const off of G.offsets) for (const t of G.tYears) for (const v of G.ivs) {
    const k = S + off;
    const c = blackScholes(S, k, t, v, "CALL");
    const p = blackScholes(S, k, t, v, "PUT");
    parity = Math.max(parity, Math.abs(c.price - p.price - (S - k)) > 1e-9 && c.price > 0 && p.price > 0 ? 1 : 0);
    deltaPar = Math.max(deltaPar, Math.abs(c.delta - p.delta - 1));
    if (c.delta < 0 || c.delta > 1 || p.delta > 0 || p.delta < -1) outOfBounds++;
    if (c.price < Math.max(0, S - k) - 2e-4 || c.price > S + 2e-4 || p.price < Math.max(0, k - S) - 2e-4 || p.price > k + 2e-4) outOfBounds++;
    if (!(c.thetaDay >= 0) || Math.abs(c.thetaDay - p.thetaDay) > 1e-12) thetaSign++;
  }
  check("call − put = S − K wherever neither price was clamped to zero", parity === 0);
  check("call delta − put delta = 1", deltaPar < 1e-12, sci(deltaPar));
  check("delta, intrinsic value and the cap (≤ S for a call, ≤ K for a put) hold on the whole grid", outOfBounds === 0, `${outOfBounds}`);
  check("theta is a non-negative loss, the same for the call and the put", thetaSign === 0, `${thetaSign}`);
}
{
  const S = 777.71;
  const up = (t, v) => blackScholes(S, S, t, v, "CALL").price;
  let mono = true;
  for (const v of G.ivs) for (let i = 1; i < G.tYears.length; i++) if (up(G.tYears[i], v) < up(G.tYears[i - 1], v) - 2e-4) mono = false;
  for (const t of G.tYears) for (let i = 1; i < G.ivs.length; i++) if (up(t, G.ivs[i]) < up(t, G.ivs[i - 1]) - 2e-4) mono = false;
  check("an ATM option is worth more with more time and more volatility", mono);
}
{
  // The clamps the pricer promises: a quarter hour of life at the least, a one-point vol at the least.
  const MIN_T = 15 / (365 * 24 * 60);
  const a = blackScholes(777.71, 778.71, 0, 0.19, "CALL");
  const b = blackScholes(777.71, 778.71, MIN_T, 0.19, "CALL");
  const c2 = blackScholes(777.71, 778.71, -1, 0.19, "CALL");
  const d = blackScholes(777.71, 778.71, 1 / 365, 0, "CALL");
  const e = blackScholes(777.71, 778.71, 1 / 365, 0.01, "CALL");
  check("no time left prices as the last quarter hour, and so does negative time", a.price === b.price && a.delta === b.delta && c2.price === b.price);
  check("zero volatility prices as a one-point vol", d.price === e.price && d.delta === e.delta);
}
{
  // Finite differences of the pricer's own price, at a size the approximation's noise cannot move: delta to 5e-4, theta to 1%.
  const S = 777.71;
  const t = 1 / 365;
  const h = 1;
  const fdDelta = (blackScholes(S + h, S, t, 0.19, "CALL").price - blackScholes(S - h, S, t, 0.19, "CALL").price) / (2 * h);
  const dt = 0.1 / 365;
  // Value LOST per calendar day: the price with more time left minus the price with less, over the span in days.
  const fdTheta = (blackScholes(S, S, t + dt / 2, 0.19, "CALL").price - blackScholes(S, S, t - dt / 2, 0.19, "CALL").price) / (dt * 365);
  const r = blackScholes(S, S, t, 0.19, "CALL");
  check(`delta is the slope of price in spot (finite difference ${fdDelta.toFixed(4)} vs ${r.delta.toFixed(4)})`, Math.abs(fdDelta - r.delta) < 5e-4);
  check(`theta is the slope of price in time (finite difference ${fdTheta.toFixed(3)} vs ${r.thetaDay.toFixed(3)} a day)`, Math.abs(fdTheta - r.thetaDay) < 0.01 * r.thetaDay + 5e-3);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
