/**
 * Does the trading floor's EV gate pick better OPTION trades on real cards?
 *
 *   npx tsx scripts/measure-room-ev.mjs [--sigdir .cache/signals] [--curves .cache/room-time-odds-is.json]
 *
 * WHY THIS EXISTS
 * The room (src/lib/room) refuses an option ticket whose priced paths lose
 * after costs (quant.ts priceOptionPlan: the desk's P(T1), cut to before the
 * 11:00 flat by the measured time curve, three paths, both crossings). That is
 * a refusal RULE. Whether refusing on it picks better trades is a claim, and
 * this script tests the claim on the four-year capture before anyone quotes it.
 *
 * RULE, FIXED BEFORE THE FIRST RUN (2026-10-04) — nothing below is tuned
 *  Population: measure-option-time.mjs's (no Judas, no news, conf >= 0.65,
 *    deduped, T1 ahead, stop inside 0.5–1.5 ATR), filled under the LIVE rule
 *    (CE within 12 bars), fill bar opening 09:45–10:45 ET — the room's entry
 *    window (Judas excluded, nothing new at or after 11:00).
 *  The contract: the room's day ticket — an ATM call (long card) or put
 *    (short card) on the ETF the future prices, QQQ = NQ/40 and SPY = ES/10
 *    (the room's ratios), 1 DTE (primary) and 0 DTE (secondary). IV is FIXED
 *    per run at VIX 14 / 18 / 24 through ivFor — the four-year file has no VIX,
 *    so the gate and the outcome are priced under the SAME IV (internally
 *    consistent; real IV moves, skew and the morning IV crush are missing).
 *    Bought at the model ask (mid + the desk's crossing cost) at the fill
 *    bar's midpoint, with the ETF at the CE.
 *  The gate under test: quant.ts priceOptionPlan at the fill, flat 11:00, the
 *    desk's hit-odds model (fit 2022–24) and time curves measured on 2022–24
 *    ONLY (--curves): PASS = EV > 0 and T1 pays. Secondary: the calibrated
 *    gate (also EV > 0 on the model's out-of-sample hit rate) — that table IS
 *    2025–26, so its 2025–26 half is not out of sample and is labelled so.
 *  The outcome, on the real 15m path, ties against, the same exits for every
 *    card (the test is the ENTRY gate): per bar from the fill bar on —
 *    (1) adverse: the plan stop (−1 tick) or the −20% premium backstop
 *        (runner: breakeven premium) — everything out at the better of the
 *        backstop and the bid at the stop, whichever the price met first;
 *    (2) favorable, untrimmed, not on the fill bar: T1 → half out at the bid
 *        at T1; else +40% on the bar's best bid → half out at +40%;
 *    (3) a 15m close beyond the failed-hold level before the trim → all out
 *        at the bid at the close;
 *    (4) 11:00 → what is left out at the bid at the last close.
 *  Reported: PASS / REFUSE / ALL — n, mean $ per contract, win rate, mean as
 *    % of the premium paid — for 2022–24 and 2025–26 separately, and the
 *    PASS − REFUSE difference with a day-block bootstrap SE (2,000 draws,
 *    fixed seed). The gate is said to HELP only if, on 2025–26 at VIX 18
 *    1 DTE, PASS beats REFUSE at z >= 2 AND PASS is positive. Anything else is
 *    reported as not shown.
 *  SECONDARY, for power (also fixed before the first run): the NY AM window
 *    gives ~15 priced fills a year. The same rule on every regular-hours fill
 *    whose bar opens 09:45–14:30 ET, held 75 minutes (the 09:45→11:00 window)
 *    and priced on the ALL-SESSION curves (the NY AM ones stripped). It asks
 *    whether the EV ranking carries information about option outcomes at all;
 *    it is not the room's window and never its verdict.
 *  EXITS, paired on the same fills (also fixed before the first run; every
 *    priced fill, VIX 18, 1 DTE): the trader's mandate alone (+40% trims half,
 *    no T1 trim, no theta stop) vs the room's T1 trim (T1 first, then +40%)
 *    vs the room's T1 trim + its theta stop (at a bar close, untrimmed, at or
 *    below the premium paid, when quant.ts holdValue on the same curves says
 *    holding is worth less than the bid → all out at the bid). Mean paired $
 *    difference per fill with a day-block bootstrap z; said to help only at
 *    z >= 2 on 2025–26. The event exit is not tested — there is no four-year
 *    release calendar in the repo.
 *
 * Out: src/data/room-ev-test.json
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const SIGDIR = argOf("sigdir", ".cache/signals");
const CURVES = argOf("curves", ".cache/room-time-odds-is.json");
const OUT = argOf("out", "src/data/room-ev-test.json");
const HIST = "src/data/history-4y.json";
const FILL_BARS = 12;
const TICK = 0.25;
const FLOOR = 0.65;
const IS_YEARS = [2022, 2023, 2024];
const OOS_YEARS = [2025, 2026];
const BAR = 15 * 60_000;
const RATIO = { MNQ: 40, ES: 10 };
const ETF = { MNQ: "QQQ", ES: "SPY" };
const VIXES = [14, 18, 24];
const DTES = [1, 0];
const BOOT = 2000;
/** The primary population (the room's window) and the secondary (power). */
const POPS = [
  { key: "nyam", window: [9 * 60 + 45, 10 * 60 + 45], hold: null },
  { key: "rth", window: [9 * 60 + 45, 14 * 60 + 30], hold: 75 * 60_000 },
];

for (const f of [SIGDIR, CURVES, HIST]) {
  if (!existsSync(f)) {
    console.error(
      `needs ${f}${f === CURVES ? " (npx tsx scripts/measure-option-time.mjs --years 2022,2023,2024 --out " + CURVES + ")" : ""}`,
    );
    process.exit(1);
  }
}

const { etWallParts, etWallToEpochMs } = await import("../src/lib/trading/sessions.ts");
const { planHitOdds } = await import("../src/lib/trading/hit-odds-model.ts");
const Q = await import("../src/lib/room/quant.ts");
const OM = await import("../src/lib/room/option-math.ts");
const { ROOM_MANDATE } = await import("../src/lib/room/mandate.ts");

const H = JSON.parse(readFileSync(HIST, "utf8"));
const BARS = { MNQ: H.bars.MNQ ?? [], ES: H.bars.ES ?? [] };
const curves = JSON.parse(readFileSync(CURVES, "utf8"));
if (!(curves.version >= 1)) {
  console.error(`${CURVES} is not a measured curve file`);
  process.exit(1);
}
const curvesAllSession = {
  ...curves,
  subsets: Object.fromEntries(
    Object.entries(curves.subsets).filter(([k]) => !k.startsWith("nyam_")),
  ),
};

/* ── Population (identical filters to measure-option-time.mjs) ──────────── */

let rows = [];
for (const f of readdirSync(SIGDIR).filter(
  (f) => f.startsWith("signals-") && f.endsWith(".json"),
)) {
  rows.push(...JSON.parse(readFileSync(`${SIGDIR}/${f}`, "utf8")).rows);
}
{
  const seen = new Set();
  rows = rows.filter((r) => {
    const k = `${r.sym}|${r.i}|${r.side}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
const cards = rows.length;
rows = rows.filter(
  (r) =>
    !r.judas &&
    !r.news &&
    r.conf >= FLOOR &&
    r.t1 != null &&
    r.atr > 0 &&
    Math.abs(r.e - r.s) > 0 &&
    (r.side === "long" ? r.t1 > r.e : r.t1 < r.e) &&
    Math.abs(r.e - r.s) / r.atr >= 0.5 &&
    Math.abs(r.e - r.s) / r.atr <= 1.5,
);
rows.sort((a, b) => a.t - b.t);

const etMin = (t) => {
  const w = etWallParts(t);
  return w.hour * 60 + w.minute;
};
const round2 = (n) => Math.round(n * 100) / 100;

function fillBarOf(r) {
  const bars = BARS[r.sym];
  for (let k = 1; k <= FILL_BARS && r.i + k < bars.length; k++) {
    const b = bars[r.i + k];
    if (r.side === "long" ? b.l <= r.e : b.h >= r.e) return r.i + k;
  }
  return null;
}

/* ── The option on the real path ─────────────────────────────────────────── */

/** Exit policies under test: the room's (T1 trim first), the mandate alone, the room + its theta stop. */
const ROOM_EXITS = { t1Trim: true, theta: false };
const MANDATE_EXITS = { t1Trim: false, theta: false };
const THETA_EXITS = { t1Trim: true, theta: true };

function simOption(r, fi, c, pol = ROOM_EXITS) {
  const bars = BARS[r.sym];
  const long = r.side === "long";
  const E = r.e;
  const S = r.s;
  const risk = Math.abs(E - S);
  const failLevel = long ? E - 0.5 * risk : E + 0.5 * risk;
  const bidAt = (fut, ms) =>
    OM.quoteOption(fut / RATIO[r.sym], c.strike, c.exp, c.type, c.iv, ms).bid;
  const backstop = round2(c.ask * (1 + ROOM_MANDATE.hardStopPct / 100));
  const trimAt = round2(c.ask * (1 + ROOM_MANDATE.takeProfitPct / 100));
  let qty = 1;
  let cash = 0;
  let trimmed = false;
  let lastClose = E;
  let how = "flat";
  const sell = (q, px) => {
    cash += q * (px - c.ask) * 100;
    qty -= q;
  };
  for (let k = fi; k < bars.length && qty > 1e-9; k++) {
    const b = bars[k];
    if (b.t >= c.flatMs) break;
    const mid = Math.max(c.fillMs, b.t + BAR / 2);
    // (1) Adverse first (ties against).
    const floor = trimmed ? c.ask : backstop;
    const adverse = long ? b.l : b.h;
    const stopHit = long ? b.l <= S : b.h >= S;
    if (stopHit) {
      sell(qty, Math.max(floor, bidAt(long ? S - TICK : S + TICK, mid)));
      how = trimmed ? "runner_stop" : "stop";
      break;
    }
    if (bidAt(adverse, mid) <= floor) {
      sell(qty, floor);
      how = trimmed ? "runner_be" : "backstop";
      break;
    }
    // (2) Favorable, untrimmed, never on the fill bar.
    if (!trimmed && k !== fi) {
      const t1Hit = pol.t1Trim && (long ? b.h >= r.t1 : b.l <= r.t1);
      if (t1Hit) {
        sell(qty / 2, bidAt(r.t1, mid));
        trimmed = true;
        how = "t1";
      } else if (bidAt(long ? b.h : b.l, mid) >= trimAt) {
        sell(qty / 2, trimAt);
        trimmed = true;
        how = "plus40";
      }
    }
    // (3) The failed hold, before any trim, on the close.
    if (!trimmed && (long ? b.c < failLevel : b.c > failLevel)) {
      sell(qty, bidAt(b.c, Math.min(c.flatMs, b.t + BAR)));
      how = "failed_hold";
      break;
    }
    // (3b) The theta stop: untrimmed, at or below the premium paid, holding worth less than the bid.
    if (pol.theta && !trimmed) {
      const endMs = Math.min(c.flatMs, b.t + BAR);
      const bidNow = bidAt(b.c, endMs);
      if (bidNow <= c.ask && endMs < c.flatMs) {
        const hold = Q.holdValue({
          plan: c.plan,
          pT1Entry: c.pT1,
          type: c.type,
          strike: c.strike,
          exp: c.exp,
          iv: c.iv,
          entryPx: c.ask,
          futNow: b.c,
          etfNow: b.c / RATIO[r.sym],
          nowMs: endMs,
          fillMs: c.fillMs,
          flatMs: c.flatMs,
          curves: c.curves,
        });
        if (hold.ev.measured && hold.edgeUsd < 0) {
          sell(qty, bidNow);
          how = "theta";
          break;
        }
      }
    }
    lastClose = b.c;
  }
  // (4) The 11:00 flat.
  if (qty > 1e-9) sell(qty, bidAt(lastClose, c.flatMs));
  return { usd: round2(cash), how };
}

/* ── Run ─────────────────────────────────────────────────────────────────── */

const trades = [];
let unfilled = 0;
const outside = { nyam: 0, rth: 0 };
for (const r of rows) {
  const fi = fillBarOf(r);
  if (fi == null) {
    unfilled++;
    continue;
  }
  const fb = BARS[r.sym][fi];
  const m = etMin(fb.t);
  const wd = new Date(fb.t).getUTCDay();
  for (const pop of POPS) {
    if (m < pop.window[0] || m > pop.window[1] || wd === 0 || wd === 6) {
      outside[pop.key]++;
      continue;
    }
    const etDate = OM.etDateOf(fb.t);
    const fillMs = fb.t + BAR / 2;
    const flatMs = pop.hold == null ? etWallToEpochMs(etDate, "11:00") : fb.t + pop.hold;
    const popCurves = pop.key === "nyam" ? curves : curvesAllSession;
    const type = r.side === "long" ? "CALL" : "PUT";
    const etfE = r.e / RATIO[r.sym];
    const odds = planHitOdds({
      side: r.side,
      symbol: r.sym,
      entry: r.e,
      stop: r.s,
      t1: r.t1,
      atr: r.atr,
      price: r.e,
    });
    if (!odds) continue;
    const year = new Date(fb.t).getUTCFullYear();
    for (const vix of VIXES) {
      for (const dte of DTES) {
        const exp = dte === 1 ? OM.nextWeekday(etDate) : etDate;
        const iv = OM.ivFor(ETF[r.sym], vix);
        const strike = OM.strikeFor(etfE, type, "ATM");
        const q = OM.quoteOption(etfE, strike, exp, type, iv, fillMs);
        const ev = Q.priceOptionPlan({
          plan: { side: r.side, entry: r.e, stop: r.s, t1: r.t1, atr: r.atr, symbol: r.sym },
          pT1: odds.pT1,
          type,
          strike,
          exp,
          iv,
          entryPx: q.ask,
          futNow: r.e,
          etfNow: etfE,
          nowMs: fillMs,
          fillMs,
          flatMs,
          curves: popCurves,
        });
        const pass = ev.evUsd > 0 && ev.t1Pays;
        const passCal = pass && ev.calibrated != null && ev.calibrated.evUsd > 0;
        const plan = { side: r.side, entry: r.e, stop: r.s, t1: r.t1, atr: r.atr, symbol: r.sym };
        const sc = {
          strike,
          exp,
          type,
          iv,
          ask: q.ask,
          fillMs,
          flatMs,
          plan,
          pT1: odds.pT1,
          curves: popCurves,
        };
        const out = simOption(r, fi, sc, ROOM_EXITS);
        const paired =
          vix === 18 && dte === 1
            ? {
                mandate: simOption(r, fi, sc, MANDATE_EXITS).usd,
                theta: simOption(r, fi, sc, THETA_EXITS).usd,
              }
            : null;
        trades.push({
          pop: pop.key,
          vix,
          dte,
          year,
          half: IS_YEARS.includes(year) ? "is" : OOS_YEARS.includes(year) ? "oos" : null,
          day: etDate,
          sym: r.sym,
          pT1: odds.pT1,
          t1Atr: Math.abs(r.t1 - r.e) / r.atr,
          evUsd: ev.evUsd,
          evCalUsd: ev.calibrated?.evUsd ?? null,
          pass,
          passCal,
          premiumUsd: q.ask * 100,
          usd: out.usd,
          how: out.how,
          usdMandate: paired?.mandate ?? null,
          usdTheta: paired?.theta ?? null,
        });
      }
    }
  }
}

/* ── Statistics ──────────────────────────────────────────────────────────── */

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

function summary(xs) {
  if (!xs.length) return { n: 0, meanUsd: null, winRate: null, meanPctPremium: null };
  const mean = xs.reduce((s, t) => s + t.usd, 0) / xs.length;
  return {
    n: xs.length,
    meanUsd: r2(mean),
    winRate: r3(xs.filter((t) => t.usd > 0).length / xs.length),
    meanPctPremium: r3(xs.reduce((s, t) => s + t.usd / t.premiumUsd, 0) / xs.length),
  };
}

/** PASS − REFUSE, with a day-block bootstrap SE. */
function diff(xs, key) {
  const a = xs.filter((t) => t[key]);
  const b = xs.filter((t) => !t[key]);
  if (a.length < 2 || b.length < 2) return { diffUsd: null, se: null, z: null };
  const mean = (ys) => ys.reduce((s, t) => s + t.usd, 0) / ys.length;
  const d0 = mean(a) - mean(b);
  const days = [...new Set(xs.map((t) => t.day))];
  const byDay = new Map(days.map((d) => [d, xs.filter((t) => t.day === d)]));
  const rnd = mulberry32(20261004);
  const ds = [];
  for (let k = 0; k < BOOT; k++) {
    let sa = 0;
    let na = 0;
    let sb = 0;
    let nb = 0;
    for (let j = 0; j < days.length; j++) {
      for (const t of byDay.get(days[Math.floor(rnd() * days.length)])) {
        if (t[key]) {
          sa += t.usd;
          na++;
        } else {
          sb += t.usd;
          nb++;
        }
      }
    }
    if (na && nb) ds.push(sa / na - sb / nb);
  }
  const m = ds.reduce((s, x) => s + x, 0) / ds.length;
  const se = Math.sqrt(ds.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, ds.length - 1));
  return { diffUsd: r2(d0), se: r2(se), z: se > 0 ? r2(d0 / se) : null };
}

/** Mean paired difference (a − b per fill) with a day-block bootstrap SE. */
function pairedDiff(xs, fa, fb) {
  const ds = xs.map((t) => ({ day: t.day, d: fa(t) - fb(t) })).filter((x) => Number.isFinite(x.d));
  if (ds.length < 2) return { n: ds.length, meanUsd: null, se: null, z: null };
  const mean = ds.reduce((s, x) => s + x.d, 0) / ds.length;
  const days = [...new Set(ds.map((x) => x.day))];
  const byDay = new Map(days.map((d) => [d, ds.filter((x) => x.day === d)]));
  const rnd = mulberry32(20261005);
  const ms = [];
  for (let k = 0; k < BOOT; k++) {
    let sum = 0;
    let n = 0;
    for (let j = 0; j < days.length; j++) {
      for (const x of byDay.get(days[Math.floor(rnd() * days.length)])) {
        sum += x.d;
        n++;
      }
    }
    if (n) ms.push(sum / n);
  }
  const m = ms.reduce((acc, x) => acc + x, 0) / ms.length;
  const se = Math.sqrt(ms.reduce((acc, x) => acc + (x - m) ** 2, 0) / Math.max(1, ms.length - 1));
  return { n: ds.length, meanUsd: r2(mean), se: r2(se), z: se > 0 ? r2(mean / se) : null };
}

const exits = [];
for (const pop of POPS.map((p) => p.key)) {
  for (const half of ["is", "oos", "all"]) {
    const xs = trades.filter(
      (t) =>
        t.pop === pop &&
        t.vix === 18 &&
        t.dte === 1 &&
        t.usdMandate != null &&
        (half === "all" || t.half === half),
    );
    exits.push({
      pop,
      half,
      n: xs.length,
      mandateUsd: summary(xs.map((t) => ({ ...t, usd: t.usdMandate }))).meanUsd,
      roomUsd: summary(xs).meanUsd,
      thetaUsd: summary(xs.map((t) => ({ ...t, usd: t.usdTheta }))).meanUsd,
      t1TrimVsMandate: pairedDiff(
        xs,
        (t) => t.usd,
        (t) => t.usdMandate,
      ),
      thetaVsRoom: pairedDiff(
        xs,
        (t) => t.usdTheta,
        (t) => t.usd,
      ),
    });
  }
}

const results = [];
for (const pop of POPS.map((p) => p.key)) {
  for (const vix of VIXES) {
    for (const dte of DTES) {
      for (const half of ["is", "oos", "all"]) {
        const xs = trades.filter(
          (t) =>
            t.pop === pop && t.vix === vix && t.dte === dte && (half === "all" || t.half === half),
        );
        results.push({
          pop,
          vix,
          dte,
          half,
          all: summary(xs),
          pass: summary(xs.filter((t) => t.pass)),
          refuse: summary(xs.filter((t) => !t.pass)),
          passVsRefuse: diff(xs, "pass"),
          passCal: summary(xs.filter((t) => t.passCal)),
          passCalVsRest: diff(xs, "passCal"),
          exits: Object.fromEntries(
            [
              "t1",
              "plus40",
              "stop",
              "backstop",
              "failed_hold",
              "runner_stop",
              "runner_be",
              "flat",
            ].map((h) => [h, xs.filter((t) => t.how === h).length]),
          ),
        });
      }
    }
  }
}

const primary = results.find(
  (x) => x.pop === "nyam" && x.vix === 18 && x.dte === 1 && x.half === "oos",
);
const secondary = results.find(
  (x) => x.pop === "rth" && x.vix === 18 && x.dte === 1 && x.half === "oos",
);
const helps =
  primary?.passVsRefuse.z != null && primary.passVsRefuse.z >= 2 && (primary.pass.meanUsd ?? 0) > 0;
const verdict =
  !primary || primary.pass.n === 0
    ? "not shown — the gate passed no 2025–26 card at VIX 18, 1 DTE"
    : helps
      ? `HELPS on 2025–26 (VIX 18, 1 DTE): PASS ${primary.pass.meanUsd} vs REFUSE ${primary.refuse.meanUsd} $/contract, z ${primary.passVsRefuse.z}`
      : `not shown on 2025–26 (VIX 18, 1 DTE): PASS ${primary.pass.meanUsd} $/contract (n ${primary.pass.n}) vs REFUSE ${primary.refuse.meanUsd} (n ${primary.refuse.n}), z ${primary.passVsRefuse.z}`;

const out = {
  version: 1,
  builtAt: new Date().toISOString(),
  script: "scripts/measure-room-ev.mjs",
  rule: {
    population:
      "measure-option-time population, filled (CE within 12 bars), fill bar opening 09:45–10:45 ET",
    contract:
      "ATM call/put on QQQ (NQ/40) or SPY (ES/10), 1 DTE primary / 0 DTE secondary, model ask at the fill bar's midpoint",
    iv: "fixed per run at VIX 14/18/24 via ivFor — no VIX in the 4-year file; gate and outcome priced under the same IV",
    gate: "quant.ts priceOptionPlan, flat 11:00, hit-odds model (fit 2022-24), time curves from 2022-24 only: PASS = EV > 0 and T1 pays",
    secondary:
      "calibrated gate (also EV > 0 on the model's 2025-26 decile table) — its 2025-26 half is in-sample for that table",
    exits:
      "ties against: plan stop or −20% backstop (runner: breakeven) → all out; T1 (not the fill bar) → half; else +40% → half; failed-hold close → all; 11:00 → rest",
    exitTest:
      "paired on the same fills (VIX 18, 1 DTE): mandate (+40% only) vs room (T1 trim first) vs room + theta stop (bar close, untrimmed, ≤ premium paid, holdValue edge < 0); helps only at z >= 2 on 2025-26",
    verdictRule:
      "HELPS only if on 2025-26 at VIX 18, 1 DTE: PASS − REFUSE z >= 2 (day-block bootstrap) AND PASS mean > 0",
  },
  curves: CURVES,
  population: {
    cards,
    eligible: rows.length,
    unfilled,
    outsideWindow: outside,
    priced: Object.fromEntries(
      POPS.map((p) => [
        p.key,
        trades.filter((t) => t.pop === p.key).length / (VIXES.length * DTES.length),
      ]),
    ),
  },
  verdict,
  exits,
  secondary: secondary
    ? `RTH 09:45–14:30, 75-minute hold, 2025–26, VIX 18, 1 DTE: PASS ${secondary.pass.meanUsd} $/contract (n ${secondary.pass.n}) vs REFUSE ${secondary.refuse.meanUsd} (n ${secondary.refuse.n}), z ${secondary.passVsRefuse.z}`
    : null,
  results,
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");

console.log(
  `cards ${cards} · eligible ${rows.length} · unfilled ${unfilled} · priced ${JSON.stringify(out.population.priced)}`,
);
const fmt = (s) =>
  s.n
    ? `n ${String(s.n).padStart(4)} ${String(s.meanUsd).padStart(7)}$ win ${s.winRate}`
    : "n    0";
for (const x of results) {
  console.log(
    `${x.pop.padEnd(4)} VIX ${x.vix} ${x.dte}DTE ${x.half.padEnd(3)} | ALL ${fmt(x.all)} | PASS ${fmt(x.pass)} | REFUSE ${fmt(x.refuse)} | Δ ${x.passVsRefuse.diffUsd} se ${x.passVsRefuse.se} z ${x.passVsRefuse.z} | CAL ${fmt(x.passCal)} z ${x.passCalVsRest.z}`,
  );
}
for (const x of exits)
  console.log(
    `exits ${x.pop.padEnd(4)} ${x.half.padEnd(3)} n ${x.n} | mandate ${x.mandateUsd} · room (T1 trim) ${x.roomUsd} · room + theta ${x.thetaUsd} | T1 trim vs mandate ${x.t1TrimVsMandate.meanUsd} z ${x.t1TrimVsMandate.z} | theta vs room ${x.thetaVsRoom.meanUsd} z ${x.thetaVsRoom.z}`,
  );
console.log(`verdict: ${verdict}`);
console.log(`secondary: ${out.secondary}`);
console.log(`-> ${OUT}`);
