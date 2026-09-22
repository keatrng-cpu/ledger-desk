/**
 * Does timing the entry on the 1m turn INSIDE the 15m array beat resting at
 * consequent encroachment?
 *
 * THE QUESTION
 * The desk's measured edge is a resting limit at CE (+0.35R/card against
 * +0.007R paying the print). That number was produced on 15m bars, where
 * "price touched the array" is all the resolution there is. On 1m bars two
 * more things become visible, and each is a different trade:
 *
 *   A — CONFIRMATION. Wait, after price enters the array, for a 1m bar that
 *       closes through the prior bar's extreme in the trade's direction.
 *       Costs a worse entry; buys evidence that the retrace is finished.
 *   B — MICRO STOP. Enter at CE as now, but put the stop just beyond the 1m
 *       swing the retrace actually made inside the array, instead of beyond
 *       the 15m raid wick. A tighter stop at the same DOLLAR risk is more R
 *       per point — which is the whole thesis — and more stop-outs, which is
 *       the whole risk.
 *   C — both.
 *
 * WHAT IS HELD CONSTANT
 * The plan. Same cards, same CE, same T1/T2 prices, same scale-out (half at
 * T1, stop to break-even, runner to T2), same 12-bar fill window and 32-bar
 * hold, same flat at the cash close, and the same tie rule: inside one bar
 * the stop is assumed hit before the target. Only the entry trigger and the
 * stop placement change, so any difference is theirs.
 *
 * R IS MEASURED AGAINST EACH VARIANT'S OWN RISK, which is the honest
 * comparison for a trader sizing to a fixed dollar amount: a stop half as
 * wide means twice the contracts for the same $150, so a point of favourable
 * move is worth twice the R.
 *
 * Run: npx tsx scripts/measure-micro-entry.mjs
 */
import { readFileSync } from "node:fs";

const shadows = JSON.parse(readFileSync("src/data/shadow-replay.json", "utf8"));
const hist = JSON.parse(readFileSync("src/data/learn-history-1m.json", "utf8"));
const BARS = hist.bars;

const FILL_WINDOW_MIN = 12 * 15; // 3h, the shadow book's fill window
const MAX_HOLD_MIN = 32 * 15; // 8h
const CONFIRM_WINDOW_MIN = 20; // how long a confirmation may take after entry
const SCALE_FRAC = 0.5; // half off at T1 (APLUS_RULES.scaleOut.tp1Fraction)
/** Pad beyond the micro swing, as a share of the 15m risk. Keeps a 1-tick
 *  stop from being placed on the exact low the market just printed. */
const MICRO_PAD_SHARE = 0.08;
/** A micro stop closer than this share of the 15m stop is noise, not structure. */
const MIN_MICRO_SHARE = 0.15;

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;
const etMin = (ms) => {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(ms));
  const g = (k) => p.find((x) => x.type === k)?.value;
  return Number(g("hour")) * 60 + Number(g("minute"));
};

/** 1m bars for a symbol strictly after `from`, capped at `minutes`. */
function window_(symbol, from, minutes) {
  const all = BARS[symbol];
  if (!all?.length) return [];
  let lo = 0;
  let hi = all.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (all[mid].t < from) lo = mid + 1;
    else hi = mid;
  }
  const out = [];
  const until = from + minutes * 60_000;
  for (let i = lo; i < all.length && all[i].t <= until; i++) out.push(all[i]);
  return out;
}

/**
 * Run one plan forward on 1m bars. Returns R against `risk`, or null when it
 * never filled. `entryAt` is the index of the fill bar in `bars`.
 */
function simulate({ bars, entryIdx, entry, stop, t1, t2, long, risk }) {
  const rOf = (px) => (long ? px - entry : entry - px) / risk;
  const up = (b, lv) => (long ? b.h >= lv : b.l <= lv);
  const down = (b, lv) => (long ? b.l <= lv : b.h >= lv);
  let banked = 0;
  let remaining = 1;
  let t1Hit = false;
  let stopLevel = stop;
  let held = 0;

  for (let i = entryIdx; i < bars.length && held < MAX_HOLD_MIN; i++, held++) {
    const b = bars[i];
    if (etMin(b.t) >= 16 * 60) return { r: banked + rOf(b.o) * remaining, held, exit: "flat at the close" };
    // Ties inside one bar go against the trade.
    if (down(b, stopLevel)) {
      return { r: banked + rOf(stopLevel) * remaining, held, exit: t1Hit ? "runner at break-even" : "stopped" };
    }
    if (!t1Hit && t1 != null && up(b, t1)) {
      t1Hit = true;
      banked += rOf(t1) * SCALE_FRAC;
      remaining -= SCALE_FRAC;
      stopLevel = entry;
      if (t2 == null || remaining <= 0) return { r: banked + rOf(t1) * remaining, held, exit: "T1, full close" };
      continue;
    }
    if (t1Hit && t2 != null && up(b, t2)) {
      return { r: banked + rOf(t2) * remaining, held, exit: "T2" };
    }
  }
  const last = bars[Math.min(bars.length, entryIdx + MAX_HOLD_MIN) - 1];
  if (!last) return null;
  return { r: banked + rOf(last.c) * remaining, held, exit: "time stop" };
}

/**
 * The 1m swing the retrace made inside the array, as a stop.
 *
 * For a long: the lowest low printed from the moment price entered the array
 * up to and including the entry bar, plus a pad. That is the price the
 * retrace actually turned from, as opposed to the 15m raid wick which may be
 * an hour and a hundred points away.
 */
function microStop({ bars, touchIdx, entryIdx, long, planStop, entry }) {
  let ext = long ? Infinity : -Infinity;
  for (let i = Math.max(0, touchIdx - 2); i <= entryIdx; i++) {
    const b = bars[i];
    if (!b) continue;
    ext = long ? Math.min(ext, b.l) : Math.max(ext, b.h);
  }
  if (!Number.isFinite(ext)) return null;
  const planRisk = Math.abs(entry - planStop);
  const pad = planRisk * MICRO_PAD_SHARE;
  const s = long ? ext - pad : ext + pad;
  const risk = Math.abs(entry - s);
  // Never WIDER than the plan's own stop — this variant is about tightening.
  if (risk >= planRisk) return { stop: planStop, risk: planRisk, tightened: false };
  // And never so tight it is inside the noise the array itself is made of.
  if (risk < planRisk * MIN_MICRO_SHARE) return null;
  return { stop: s, risk, tightened: true };
}

/** First 1m bar that trades the limit. */
function findTouch(bars, limit, long) {
  for (let i = 0; i < bars.length; i++) {
    if (long ? bars[i].l <= limit : bars[i].h >= limit) return i;
  }
  return -1;
}

/**
 * A 1m close through the prior bar's extreme, in the trade's direction,
 * within CONFIRM_WINDOW_MIN of the touch. Returns the entry index and price.
 */
function findConfirm(bars, touchIdx, long) {
  const end = Math.min(bars.length, touchIdx + CONFIRM_WINDOW_MIN);
  for (let i = touchIdx + 1; i < end; i++) {
    const prev = bars[i - 1];
    const b = bars[i];
    const through = long ? b.c > prev.h : b.c < prev.l;
    if (through) return { idx: i, price: b.c };
  }
  return null;
}

/* ── Run every limit-leg card through all four variants ─────────────────── */

const VARIANTS = ["baseline", "confirm", "microStop", "both"];
const mk = () =>
  Object.fromEntries(
    VARIANTS.map((v) => [v, { cards: 0, fills: 0, sumR: 0, wins: 0, losses: 0, riskPts: [], held: [] }]),
  );
/**
 * Reported per killzone, and NY AM first.
 *
 * 58% of the shadow book opens in the London killzone, which `inTradeWindow`
 * permits and the trader is asleep for. Pooling the two would answer a
 * question nobody is going to trade. NY AM is the window that matters; the
 * rest is shown for contrast, not for a decision.
 */
const BOOKS = { all: mk(), ny_am: mk(), london: mk(), other: mk() };
let skipped = 0;
let noBars = 0;

for (const s of shadows) {
  if (s.leg !== "limit") continue;
  if (s.t1 == null) continue;
  const long = s.side === "long";
  const bars = window_(s.symbol, s.openedAt, FILL_WINDOW_MIN + MAX_HOLD_MIN);
  // A card whose own open is not inside the captured slice cannot be
  // measured: binary-searching past it lands on the next session and
  // simulates a stale entry price against tape hours later. That silent
  // failure is what produced a −0.21R "baseline" on the first pass.
  if (bars.length < 30 || bars[0].t - s.openedAt > 5 * 60_000) {
    noBars++;
    continue;
  }
  const fillBars = bars.slice(0, FILL_WINDOW_MIN);
  const touchIdx = findTouch(fillBars, s.entry, long);
  const kz = s.tags?.kz === "ny_am" ? "ny_am" : s.tags?.kz === "london" ? "london" : "other";
  const books = [BOOKS.all, BOOKS[kz]];
  for (const b of books) for (const v of VARIANTS) b[v].cards++;
  if (touchIdx < 0) {
    skipped++;
    continue; // unfilled under every variant — counted as 0R per card
  }

  const planRisk = Math.abs(s.entry - s.stop);
  if (!(planRisk > 0)) continue;

  // baseline + microStop share the CE entry; confirm + both share the
  // confirmation entry.
  const confirm = findConfirm(bars, touchIdx, long);

  for (const v of VARIANTS) {
    const usesConfirm = v === "confirm" || v === "both";
    if (usesConfirm && !confirm) continue; // no confirmation, no trade
    const entryIdx = usesConfirm ? confirm.idx : touchIdx;
    const entry = usesConfirm ? confirm.price : s.entry;

    let stop = s.stop;
    let risk = Math.abs(entry - stop);
    if (v === "microStop" || v === "both") {
      const m = microStop({ bars, touchIdx, entryIdx, long, planStop: s.stop, entry });
      if (!m) continue;
      stop = m.stop;
      risk = m.risk;
    }
    if (!(risk > 0)) continue;

    const res = simulate({ bars, entryIdx, entry, stop, t1: s.t1, t2: s.t2, long, risk });
    if (!res) continue;
    for (const b of books) {
      const a = b[v];
      a.fills++;
      a.sumR += res.r;
      a.riskPts.push(risk);
      a.held.push(res.held);
      if (res.r > 0.05) a.wins++;
      else if (res.r < -0.05) a.losses++;
    }
  }
}


console.log(`1m file: ${hist.contracts ? JSON.stringify(hist.contracts) : "?"} · ${Object.entries(BARS).map(([k, v]) => `${k} ${v.length}`).join(" · ")} bars · slice ${hist.sessionSliceEt}`);
console.log(`never touched CE on 1m: ${skipped} · card open outside the captured slice: ${noBars}`);

const med = (arr) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

function report(name, acc) {
  if (!acc.baseline.cards) return;
  console.log(`
===== ${name} · ${acc.baseline.cards} cards =====`);
  console.log("variant      fills   R/fill   R/card    WR    medRisk  medHeld");
  for (const v of VARIANTS) {
    const a = acc[v];
    const decided = a.wins + a.losses;
    console.log(
      `${v.padEnd(12)} ${String(a.fills).padStart(5)}  ${r3(a.sumR / (a.fills || 1)).toFixed(3).padStart(7)}  ` +
        `${r3(a.sumR / (a.cards || 1)).toFixed(3).padStart(7)}  ${((100 * a.wins) / (decided || 1)).toFixed(0).padStart(3)}%  ` +
        `${med(a.riskPts).toFixed(1).padStart(7)}  ${med(a.held).toFixed(0).padStart(6)}m`,
    );
  }
  const base = acc.baseline;
  for (const v of VARIANTS.slice(1)) {
    const a = acc[v];
    const d = a.sumR / (a.cards || 1) - base.sumR / (base.cards || 1);
    console.log(
      `  vs baseline · ${v.padEnd(11)} ${(d >= 0 ? "+" : "") + r3(d).toFixed(3)}R/card · ` +
        `${a.fills - base.fills >= 0 ? "+" : ""}${a.fills - base.fills} fills · ` +
        `risk ${(100 * (med(a.riskPts) / med(base.riskPts) - 1)).toFixed(0)}%`,
    );
  }
}


report("NY AM — the window the trader sits", BOOKS.ny_am);
report("London — nobody is awake for these", BOOKS.london);
report("all killzones pooled", BOOKS.all);

console.log(
  [
    "",
    "The baseline row is the check on this harness: it must land near the +0.35R/fill",
    "the same cards measured on 15m bars. If it does not, the 1m simulation is wrong",
    "and nothing below it means anything.",
  ].join("\n"),
);
