// Shared talk-world fixture (floor-62), extracted from verify-live-talk.mjs so npm test can replay a day.
const { talkTick, freshTalkState, pushPrint } = await import("../../src/lib/room/live-talk.ts");
const { globexOpenAt } = await import("../../src/lib/room/live-world.ts");
const { etWallParts } = await import("../../src/lib/trading/sessions.ts");
const MX = await import("./mead-fixture.mjs");
export const SEC = 1000;
export const MIN = 60_000;
export const at = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h + 4, mi);
const BASE = { QQQ: 30_000, SPY: 7_400 };

const lv = (name, price, kind, pool) => ({ name, price, kind, pool });
const levelsFor = (u) => {
  const b = BASE[u];
  return [
    lv("PDH", b + 80, "prior", true),
    lv("PDL", b - 120, "prior", true),
    lv("PWH", b + 260, "weekly", true),
    lv("PWL", b - 300, "weekly", true),
    lv("Range high", b + 150, "range", true),
    lv("Range low", b - 200, "range", true),
    lv("EQ", b - 25, "range", false),
    lv("Midnight open", b - 10, "open", false),
  ];
};

function mkBook(u, px, samples, o = {}) {
  const nq = u === "QQQ";
  return {
    u,
    sym: nq ? "MNQ" : "ES",
    say: nq ? "NQ" : "ES",
    px,
    prevClose: BASE[u] - 40,
    changePct: nq ? 0.31 : 0.12,
    dayHigh: BASE[u] + 60,
    dayLow: BASE[u] - 90,
    atr: nq ? 50 : 12,
    samples,
    levels: levelsFor(u),
    perEtfPt: nq ? 40 : 10,
    htf: "bull",
    smcWord: "WAIT",
    smcMissing: "LTF shift",
    draw: { name: "PDH", price: BASE[u] + 80 },
    rangeUsedPct: 55,
    volRatio: 1.0,
    ...o,
  };
}

function clockAt(nowMs, o = {}) {
  const p = etWallParts(nowMs);
  const etMin = p.hour * 60 + p.minute;
  const isWeekday = p.weekday >= 1 && p.weekday <= 5;
  const d = new Date(nowMs - 4 * 3600_000).toISOString().slice(0, 10);
  return {
    nowMs,
    etDate: d,
    etMin,
    weekday: p.weekday,
    isWeekday,
    holiday: false,
    optionsOpen: isWeekday && etMin >= 570 && etMin < 960,
    globexOpen: globexOpenAt(nowMs),
    killzone: etMin >= 570 && etMin < 660 ? "ny_am" : "dead",
    killzoneLabel: etMin >= 570 && etMin < 660 ? "NY AM" : "",
    judas: etMin >= 570 && etMin < 585,
    blackout: false,
    blackoutReason: null,
    ...o,
  };
}

const NEEDS = { caffeine: 0.6, fatigue: 0.3, stress: 0.2, loneliness: 0.2, boredom: 0.2 };
const CREW5 = ["Jax", "Nova", "Sterling", "Gemma", "Vince"];
const mkMinds = (over = {}) => ({
  needs: Object.fromEntries(CREW5.map((c) => [c, { ...NEEDS, ...(over[c] ?? {}) }])),
  rank: Object.fromEntries(CREW5.map((c) => [c, 50])),
  rel: Object.fromEntries(CREW5.map((a) => [a, Object.fromEntries(CREW5.map((b) => [b, { affinity: 0, respect: 0 }]))])),
  memories: over.memories ?? [],
});

function mkWorld(nowMs, o = {}) {
  const px = o.px ?? BASE;
  const rings = o.rings ?? { QQQ: [], SPY: [] };
  return {
    nowMs,
    clock: clockAt(nowMs, o.clock ?? {}),
    feed: o.feed ?? { kind: "live_gateway", lagSec: 0.6 },
    books: {
      QQQ: mkBook("QQQ", px.QQQ, rings.QQQ, o.bookOver?.QQQ),
      SPY: mkBook("SPY", px.SPY, rings.SPY, o.bookOver?.SPY),
    },
    pulse: o.pulse ?? { vix: 17.2, tenYear: 4.12, at: nowMs },
    news: o.news ?? [],
    cal: o.cal ?? { events: [], prints: {} },
    book: o.book ?? { positions: [], dayPnl: 0, equity: 10_000, closedToday: 0, winsToday: 0, consecLosses: 0, monthEntries: 3 },
    card: o.card ?? null,
    beat: "chop",
    minds: o.minds === undefined ? mkMinds() : o.minds,
    lab: o.lab === undefined ? null : o.lab,
    week:
      o.week === undefined
        ? {
            today: { date: "2026-10-06", kind: "trade", trade: "NQ lead, long only from discount after the 09:45 raid resolves", skipIf: "NFP surprise before the open", pathNote: "", dailyBias: "bull", news: [] },
            next: { date: "2026-10-07", weekday: "Wednesday", kind: "trade", trade: "ISM day — wait for the retest", skipIf: "gap through PWH", dailyBias: "bull", news: [{ timeEt: "10:00", name: "ISM Services", impact: "high", note: "" }] },
            headline: "Labor week",
          }
        : o.week,
    // A populated prediction board (the real chain: Kalshi fixture → Predict board → scanner → signal engine), read at the last ten-minute poll.
    predict: o.predict === undefined ? MX.predictAt(nowMs) : o.predict,
    hall: o.hall === undefined ? MX.hallAt(nowMs) : o.hall,
    evidence: o.evidence ?? [
      "Every card at or above 0.65, taken as coded: −0.14R/card over 3508 fills — the card alone is not an edge.",
      "Stop outside 0.5-1.5 ATR: −0.24R/card, losing in both halves.",
      "Q is a fit score, not a probability: Q 0.85+ went the card's way 46.3% of the time vs 53.6% at 0.65-0.70.",
    ],
    busyUntil: o.busyUntil ?? 0,
  };
}

class Sim {
  constructor(t0, o = {}) {
    this.t = t0;
    this.dt = o.dt ?? 1000;
    this.st = freshTalkState();
    this.rings = { QQQ: [], SPY: [] };
    this.items = [];
    this.o = o;
    this.busy = 0;
    this.px = { QQQ: BASE.QQQ, SPY: BASE.SPY };
  }
  /** Advance one tick with the given price (or the last one) and world overrides. */
  tick(px = this.px, over = {}) {
    this.px = { ...this.px, ...px };
    for (const u of ["QQQ", "SPY"]) this.rings[u] = pushPrint(this.rings[u], this.t, this.px[u]);
    const o = { ...this.o, ...over, px: this.px, rings: this.rings, busyUntil: this.busy };
    const w = mkWorld(this.t, typeof o.make === "function" ? o.make(this.t, o) : o);
    const r = talkTick(w, this.st);
    this.st = r.state;
    if (r.item) {
      this.items.push(r.item);
      
      this.busy = Math.max(this.busy, this.t) + r.item.estMs;
    }
    this.t += this.dt;
    return r.item;
  }
  run(sec, pxFn = () => ({}), overFn = () => ({})) {
    const n = Math.round((sec * 1000) / this.dt);
    for (let i = 0; i < n; i++) this.tick(pxFn(i, this.t), overFn(i, this.t));
  }
}

/** A small deterministic walk: ± a fraction of a point a second — far below any threshold. */
function walker(seed, step = 0.35) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const px = { QQQ: BASE.QQQ, SPY: BASE.SPY };
  return () => {
    px.QQQ += (rnd() - 0.5) * 2 * step;
    px.SPY += (rnd() - 0.5) * 2 * step * 0.25;
    // A gentle tether so it never wanders into a level.
    px.QQQ += (BASE.QQQ - px.QQQ) * 0.01;
    px.SPY += (BASE.SPY - px.SPY) * 0.01;
    return { QQQ: px.QQQ, SPY: px.SPY };
  };
}
export { BASE, mkWorld, mkMinds, Sim, walker, CREW5 };
