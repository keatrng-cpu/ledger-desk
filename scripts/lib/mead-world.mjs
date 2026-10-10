/**
 * A small, honest TalkWorld for the Mead Hall's verifiers: the same shape the desk builds (live-world.ts `worldFromDesk`), with a
 * flat overnight tape, a populated prediction board (mead-fixture.mjs) and whatever else a test sets. The talk engine is pure, so a
 * simulated day is a loop over `talkTick`.
 */
const { talkTick, freshTalkState } = await import("../../src/lib/room/live-talk.ts");
const { globexOpenAt } = await import("../../src/lib/room/live-world.ts");
const { etWallParts } = await import("../../src/lib/trading/sessions.ts");
const X = await import("./mead-fixture.mjs");

export const MIN = 60_000;
/** ET (EDT) wall clock → epoch ms. */
export const at = (y, mo, d, h, mi, s = 0) => Date.UTC(y, mo - 1, d, h + 4, mi, s);

const BASE = { QQQ: 30_000, SPY: 7_400 };

export function clockAt(nowMs, o = {}) {
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

function book(u) {
  const nq = u === "QQQ";
  return {
    u,
    sym: nq ? "MNQ" : "ES",
    say: nq ? "NQ" : "ES",
    px: BASE[u],
    prevClose: BASE[u] - 40,
    changePct: 0.1,
    dayHigh: BASE[u] + 60,
    dayLow: BASE[u] - 90,
    atr: nq ? 50 : 12,
    samples: [],
    levels: [],
    perEtfPt: nq ? 40 : 10,
    htf: "bull",
    smcWord: "WAIT",
    smcMissing: "LTF shift",
    draw: null,
    rangeUsedPct: null,
    volRatio: 1,
  };
}

const NEEDS = { caffeine: 0.6, fatigue: 0.3, stress: 0.2, loneliness: 0.2, boredom: 0.2 };
const CREW5 = ["Jax", "Nova", "Sterling", "Gemma", "Vince"];
export const mkMinds = () => ({
  needs: Object.fromEntries(CREW5.map((c) => [c, { ...NEEDS }])),
  rank: Object.fromEntries(CREW5.map((c) => [c, 50])),
  rel: Object.fromEntries(CREW5.map((a) => [a, Object.fromEntries(CREW5.map((b) => [b, { affinity: 0, respect: 0 }]))])),
  memories: [],
});

/**
 * o.hall: false (no hall in the world) | a HallLite | "auto" (the fixture board at the last ten-minute poll, default) | a function (nowMs) => HallLite.
 * o.hallOpts: passed to the fixture (drift, models, record…). o.polls: stop polling after this ms (a dead feed).
 */
export function mkWorld(nowMs, o = {}) {
  let hall = null;
  if (o.hall && typeof o.hall === "object") hall = o.hall;
  else if (typeof o.hall === "function") hall = o.hall(nowMs);
  else if (o.hall !== false) hall = X.hallAt(o.polls != null ? Math.min(nowMs, o.polls) : nowMs, o.hallOpts ?? {});
  if (hall && o.polls != null && nowMs > o.polls) {
    // A dead feed: the same board, older. The age is what the talk reads.
    hall = { ...hall, ageSec: Math.round((nowMs - o.polls) / 1000) };
    hall.stale = hall.ageSec > hall.staleSec;
    hall.old = hall.ageSec > hall.talkMaxSec;
  }
  const predict = o.predict !== undefined ? o.predict : o.hall === false ? null : X.predictAt(o.polls != null ? Math.min(nowMs, o.polls) : nowMs, o.hallOpts ?? {});
  return {
    nowMs,
    clock: clockAt(nowMs, o.clock ?? {}),
    feed: o.feed ?? { kind: "yahoo", lagSec: 90_000 },
    books: { QQQ: book("QQQ"), SPY: book("SPY") },
    pulse: { vix: 17.2, tenYear: 4.12, at: nowMs },
    news: o.news ?? [],
    cal: { events: [], prints: {} },
    book: { positions: [], dayPnl: 0, equity: 10_000, closedToday: 0, winsToday: 0, consecLosses: 0, monthEntries: 3 },
    card: null,
    beat: "closed",
    minds: mkMinds(),
    lab: null,
    week: {
      today: { date: "2026-10-10", kind: "trade", trade: "", skipIf: "", pathNote: "", dailyBias: "bull", news: [] },
      next: { date: "2026-10-12", weekday: "Monday", kind: "trade", trade: "NQ lead", skipIf: "gap through PWH", dailyBias: "bull", news: [] },
      headline: "Labor week",
    },
    goal: null,
    seats: null,
    rnd: null,
    invest: null,
    predict,
    hall,
    evidence: ["Every card at or above 0.65, taken as coded: −0.14R/card over 3508 fills — the card alone is not an edge."],
    busyUntil: o.busyUntil ?? 0,
  };
}

/** A simulated stretch of clock: one `talkTick` every `dt` ms, the scene busy for as long as the last exchange takes to play. */
export class Sim {
  constructor(t0, o = {}) {
    this.t = t0;
    this.dt = o.dt ?? 5000;
    this.o = o;
    this.st = freshTalkState();
    this.items = [];
    this.busy = 0;
    this.worlds = [];
  }
  tick(over = {}) {
    const w = mkWorld(this.t, { ...this.o, ...over, busyUntil: this.busy });
    const r = talkTick(w, this.st);
    this.st = r.state;
    if (r.item) {
      this.items.push(r.item);
      this.worlds.push(w);
      this.busy = Math.max(this.busy, this.t) + r.item.estMs;
    }
    this.t += this.dt;
    return r.item;
  }
  run(sec, overFn = () => ({})) {
    const n = Math.round((sec * 1000) / this.dt);
    for (let i = 0; i < n; i++) this.tick(overFn(i, this.t));
    return this;
  }
}
