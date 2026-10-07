/**
 * The live room's talk (src/lib/room/live-talk.ts) against its contract.
 *
 *   npx tsx scripts/verify-live-talk.mjs
 *
 * WHY: the Floor looped — it opened on a scripted drill, replayed a three-variant bank of canned banter and
 * re-talked an unchanged story every 150 s. The replacement has no script and no clock of its own: what the
 * five say is a pure function of what the desk can see right now and of what they have already said.
 * This file replays whole simulated days through that function and asserts the properties that make it live:
 *
 *   - a move, a raid, a headline, a release, a session mark, a position near its level each make the room speak —
 *     once, and about that thing;
 *   - a flat tape makes it speak about different real things, never the same line twice in a row;
 *   - nothing priced is said on a synthetic or silent feed, and the tape topics stop when the tape does;
 *   - every number a line prints was produced by code (registered with `Facts`) — none is typed into a phrase;
 *   - every line is a legal line for that person (the trader's schema), and movement matches the animation;
 *   - the same world gives the same words (determinism), and the state survives a JSON round trip.
 *
 * Pure: no network, no real clock, no model.
 */
const { spokenProblems } = await import("./lib/spoken-check.mjs");
/** Every line any simulation below makes the room say — checked at the end for what a speech engine would be handed. */
const SPOKEN = [];
const { talkTick, freshTalkState, pushPrint, moveOver, restoreTalkState } = await import("../src/lib/room/live-talk.ts");
const { TALK, Facts, hash32, STABLE_HEARTBEATS } = await import("../src/lib/room/live-types.ts");
const { ANIMS_BY_CHARACTER, ZONES_BY_CHARACTER } = await import("../src/lib/room/orchestrator.ts");
const { globexOpenAt } = await import("../src/lib/room/live-world.ts");
const { etWallParts } = await import("../src/lib/trading/sessions.ts");
const { PATH_MONTH_CAP } = await import("../src/lib/trading/profit-rules.ts");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const SEC = 1000;
const MIN = 60_000;
// Tue 2026-10-06 09:40 ET (EDT = UTC−4).
const T_AM = Date.UTC(2026, 9, 6, 13, 40);
const at = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h + 4, mi); // ET (EDT) wall → epoch

/* ── A small, honest world ─────────────────────────────────────────────── */

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
      SPOKEN.push(...r.item.lines);
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

const STATIC = [/\b\d+m\b/gi, /\b\d ?DTE\b/gi, /\bA\+/g, /\bB\+/g, /\bT[12]\b/g, /\bE\[R\]/g, /\bP\(T1\)/g];
const numbersOf = (text) => {
  let t = text;
  for (const re of STATIC) t = t.replace(re, " ");
  return (t.match(/\d[\d,]*\.?\d*/g) ?? []).map((x) => x.replace(/[.,]+$/, ""));
};
const unsourced = (item) => {
  const bad = [];
  for (const l of item.lines) for (const n of numbersOf(l.text)) if (!item.facts.includes(n)) bad.push(`${n} in “${l.text}”`);
  return bad;
};
const legal = (item) => {
  const bad = [];
  for (const l of item.lines) {
    if (!ANIMS_BY_CHARACTER[l.character]?.includes(l.animation)) bad.push(`${l.character} cannot ${l.animation}`);
    if (!l.text.trim()) bad.push(`${l.character} said nothing`);
    if (l.animation === "SMASHING_ENTER_KEY") bad.push("a talk line must never send an order");
    if (l.character === "Nova" && l.animation === "WRITING_ON_WHITEBOARD" && item.moves.Nova?.zone !== "THE_WHITEBOARD") bad.push("Nova writes on a board she is not at");
    if (l.character === "Gemma" && l.animation === "GESTICURING_AT_WALL" && item.moves.Gemma?.zone !== "THE_WHITEBOARD") bad.push("Gemma gestures at a wall she is not at");
  }
  for (const [who, m] of Object.entries(item.moves)) {
    if (m.zone && m.zone !== "ANNEX" && !ZONES_BY_CHARACTER[who].includes(m.zone)) bad.push(`${who} cannot go to ${m.zone}`);
    if (m.zone === "ANNEX" && !/^office_(rnd|ops|goal)$/.test(m.spot ?? "")) bad.push(`${who}: the annex needs one of its offices as the spot`);
    if (m.spot && m.zone !== "WATERCOOLER" && m.zone !== "ANNEX") bad.push(`${who}: a spot without the watercooler or annex zone`);
  }
  return bad;
};
const textOf = (item) => item.lines.map((l) => l.text).join(" ");

/* ── The ring ──────────────────────────────────────────────────────────── */

console.log("The print ring");
{
  let r = [];
  r = pushPrint(r, 1000, 100);
  r = pushPrint(r, 1500, 100);
  check("an identical price a moment later is one print", r.length === 1);
  r = pushPrint(r, 7000, 100);
  check("an identical price seconds later still counts as a print", r.length === 2);
  r = pushPrint(r, 6000, 101);
  check("an out-of-order print is refused", r.length === 2);
  check("a non-finite price is refused", pushPrint(r, 9000, NaN).length === 2);
  let big = [];
  for (let k = 0; k < 60 * 60; k++) big = pushPrint(big, k * 1000, 100 + (k % 7));
  check(`the ring keeps ≤ ${TALK.ringKeepMs / MIN} minutes`, big[big.length - 1].t - big[0].t <= TALK.ringKeepMs, String(big[big.length - 1].t - big[0].t));
  const ring = [];
  let rr = ring;
  for (let k = 0; k <= 120; k++) rr = pushPrint(rr, k * 1000, 100 + k * 0.5);
  const m = moveOver(rr, 120_000, 160, 60);
  check("moveOver reads the move across the window", m && Math.abs(m.pts - 30) < 0.6 && Math.abs(m.sec - 60) < 1.5, JSON.stringify(m));
  check("a window the ring does not span is unknown, not guessed", moveOver(rr, 120_000, 160, 600) === null);
  check("a thin ring is unknown", moveOver([{ t: 0, px: 1 }], 1000, 1, 60) === null);
  const gap = [{ t: 0, px: 100 }, { t: 1000, px: 101 }];
  check("after a stall the window has no print near it → unknown", moveOver(gap, 500_000, 120, 60) === null);
}

/* ── A move ────────────────────────────────────────────────────────────── */

console.log("A burst on the tape");
{
  const sim = new Sim(T_AM);
  const walk = walker(7);
  sim.run(120, walk);
  const quiet = sim.items.filter((i) => i.kind === "tape" || i.kind === "level").length;
  check("120 s of flat tape: no tape or level talk", quiet === 0, String(quiet));
  // NQ +45 pts in 45 s (0.9 ATR).
  const base = sim.px.QQQ;
  const before = sim.items.length;
  for (let k = 1; k <= 45; k++) sim.tick({ QQQ: base + k });
  sim.run(10, () => ({ QQQ: base + 45 }));
  const tape = sim.items.slice(before).filter((i) => i.kind === "tape");
  check("a +45 pt burst makes the room speak — at the start, and once more when it doubles", tape.length >= 1 && tape.length <= 2, String(tape.length));
  const it = tape[tape.length - 1];
  check("the last remark is the urgent one (≥ 0.6 ATR is violent)", it && it.urgency === 2, String(it?.urgency));
  check("its label says what happened", it && /NQ \+\d+ in \d+ s · \d\.\d\d× ATR/.test(it.label), it?.label);
  check("the second remark says it is still going", tape.length === 2 ? /still going/.test(tape[1].label) : true, JSON.stringify(tape.map((t) => t.label)));
  check("an exchange, not a remark: ≥ 2 lines, ≥ 2 voices", it && it.lines.length >= 2 && new Set(it.lines.map((l) => l.character)).size >= 2);
  check("it quotes the size of the move", it && it.facts.some((f) => /^(3|4)\d$/.test(f)), JSON.stringify(it?.facts));
  check("it reads as up, not down", it && /up|ripped|higher|lifting|bid|\+|going/i.test(textOf(it)) && !/dumped|fell|lower|leaking|offered/.test(textOf(it)), it && textOf(it));
  check("every number is one the code produced", tape.every((t) => unsourced(t).length === 0), JSON.stringify(tape.flatMap(unsourced)));
  check("every line is legal for its speaker", tape.every((t) => legal(t).length === 0), JSON.stringify(tape.flatMap(legal)));
  const again = sim.items.length;
  sim.run(60, () => ({ QQQ: base + 45 }));
  check("the same burst is not remarked on again", sim.items.slice(again).filter((i) => i.kind === "tape").length === 0);
  // Down move after the cooldown.
  sim.run(TALK.tapeCooldownMs / 1000, () => ({ QQQ: base + 45 }));
  const b2 = sim.px.QQQ;
  const before2 = sim.items.length;
  for (let k = 1; k <= 40; k++) sim.tick({ QQQ: b2 - k * 1.2 });
  sim.run(8, () => ({ QQQ: b2 - 48 }));
  const dn = sim.items.slice(before2).find((i) => i.kind === "tape");
  check("a fall is remarked on, as a fall", dn && /dumped|fell|lower|off|−|Heavy|Who's selling|short/i.test(textOf(dn)), dn && textOf(dn));
}

console.log("A move on a stale feed is called old");
{
  const sim = new Sim(T_AM, { feed: { kind: "yahoo", lagSec: 600 } });
  const walk = walker(3);
  sim.run(90, walk);
  const base = sim.px.QQQ;
  const before = sim.items.length;
  for (let k = 1; k <= 40; k++) sim.tick({ QQQ: base + k });
  const it = sim.items.slice(before).find((i) => i.kind === "tape");
  check("a burst on a feed ten minutes behind still gets remarked on", Boolean(it));
  check("and Sterling says the print is old", it && /old|behind/.test(textOf(it)), it && textOf(it));
}

console.log("A move with a position on");
{
  const pos = {
    id: "p1",
    name: "QQQ 480C 10-07",
    u: "QQQ",
    type: "CALL",
    contracts: 2,
    pnlPct: 4,
    trimmed: false,
    openedAt: T_AM - 10 * MIN,
    plan: { symbol: "MNQ", side: "long", entry: 29_950, stop: 29_900, t1: 30_100, t2: 30_200 },
  };
  const sim = new Sim(T_AM, { book: { positions: [pos], dayPnl: 0, equity: 10_000, closedToday: 0, winsToday: 0, consecLosses: 0, monthEntries: 3 } });
  sim.run(90, walker(11));
  const base = sim.px.QQQ;
  const before = sim.items.length;
  for (let k = 1; k <= 40; k++) sim.tick({ QQQ: base + k });
  const it = sim.items.slice(before).find((i) => i.kind === "tape");
  check("the room names the position it holds", it && /QQQ 480C/.test(textOf(it)), it && textOf(it));
  check("and the level that governs it", it && it.facts.includes("29,900"), JSON.stringify(it?.facts));
  check("legal and sourced", it && legal(it).length === 0 && unsourced(it).length === 0, JSON.stringify(it && [...legal(it), ...unsourced(it)]));
}

/* ── Levels ────────────────────────────────────────────────────────────── */

console.log("A raid, an approach, a break");
{
  // PDH = 30,080. Price sits 70 below, spikes 9 through, comes back 8 inside.
  const sim = new Sim(T_AM);
  sim.run(200, () => ({ QQQ: 30_010 }));
  const before = sim.items.length;
  const path = [30_030, 30_060, 30_075, 30_089, 30_089, 30_070, 30_065, 30_068];
  for (const px of path) {
    sim.tick({ QQQ: px });
    sim.run(4, () => ({ QQQ: px }));
  }
  const sw = sim.items.slice(before).find((i) => i.kind === "level" && /raided/.test(i.label));
  check("a raid of PDH (through, then back inside) is called a raid", Boolean(sw), JSON.stringify(sim.items.slice(before).map((i) => i.label)));
  check("it names the pool and the price", sw && /PDH/.test(textOf(sw)) && sw.facts.includes("30,080"), sw && textOf(sw));
  check("it calls it buy-stops, not sell-stops", sw && /buy stops|raided|took/i.test(textOf(sw)), sw && textOf(sw));
  check("legal and sourced", sw && legal(sw).length === 0 && unsourced(sw).length === 0, JSON.stringify(sw && [...legal(sw), ...unsourced(sw)]));
  const n = sim.items.filter((i) => i.kind === "level" && /raided/.test(i.label)).length;
  sim.run(300, () => ({ QQQ: 30_068 }));
  check("one raid is one remark", sim.items.filter((i) => i.kind === "level" && /raided/.test(i.label)).length === n);
  // The next burst remembers what it came off.
  const b = sim.px.QQQ;
  const mark = sim.items.length;
  for (let k = 1; k <= 45; k++) sim.tick({ QQQ: b - k });
  const tp = sim.items.slice(mark).find((i) => i.kind === "tape");
  check("the move that follows says it came off the raid", tp && /PDH raid/.test(textOf(tp)), tp && textOf(tp));
}
{
  // Closing on PDL = 29,880 from 29,925 → 29,893 (0.26 ATR away).
  const sim = new Sim(T_AM);
  sim.run(200, () => ({ QQQ: 29_925 }));
  const before = sim.items.length;
  for (let k = 0; k <= 32; k++) sim.tick({ QQQ: 29_925 - k });
  sim.run(60, () => ({ QQQ: 29_893 }));
  const ap = sim.items.slice(before).find((i) => i.kind === "level" && /closing on/.test(i.label));
  check("closing on a pool is remarked on while it is still ahead", Boolean(ap), JSON.stringify(sim.items.slice(before).map((i) => i.label)));
  check("with the distance left", ap && /pts (below|above|up|down)/.test(textOf(ap)) && ap.facts.length >= 2, ap && textOf(ap));
  const n0 = sim.items.length;
  sim.run(120, () => ({ QQQ: 29_893 }));
  check("not remarked on again inside the cooldown", sim.items.slice(n0).filter((i) => i.kind === "level" && /closing on/.test(i.label)).length === 0);
}
{
  // Breaks PWH-ish: Range high = 30,150. Crosses and holds 20 pts above for > 2 minutes.
  const sim = new Sim(T_AM);
  sim.run(400, () => ({ QQQ: 30_110 }));
  const before = sim.items.length;
  for (let k = 0; k < 30; k++) sim.tick({ QQQ: 30_110 + k * 1.4 });
  sim.run(200, () => ({ QQQ: 30_172 }));
  const ac = sim.items.slice(before).find((i) => i.kind === "level" && /accepted/.test(i.label));
  check("holding beyond a pool after crossing it is acceptance, said as such", ac && /acceptance|break/.test(textOf(ac)), JSON.stringify(sim.items.slice(before).map((i) => i.label)));
}

/* ── News ──────────────────────────────────────────────────────────────── */

console.log("Headlines");
{
  const news = (id, title, o = {}) => ({
    id,
    title,
    source: o.source ?? "CNBC",
    publishedMs: o.publishedMs ?? T_AM,
    tier: o.tier ?? 1,
    why: o.why ?? "scheduled-macro topic",
    impact: o.impact ?? null,
    tickers: o.tickers ?? [],
    topics: o.topics ?? ["fed"],
    primary: o.primary ?? false,
  });
  // First load: three old tier-1 + one tier-3 → nothing about the old ones as breaking; a catch-up line at most.
  const old = [news("a", "Powell speaks on the path of rates", { publishedMs: T_AM - 180 * MIN }), news("b", "Treasury yields climb ahead of the auction", { publishedMs: T_AM - 200 * MIN, topics: ["rates"] }), news("c", "Local bakery wins award", { tier: 3, topics: [], publishedMs: T_AM - 20 * MIN })];
  const sim = new Sim(T_AM, { news: old });
  sim.run(20, walker(5));
  const breaking = sim.items.filter((i) => i.kind === "news" && !/catching up/.test(i.label));
  check("old headlines on first load are not announced as breaking", breaking.length === 0, JSON.stringify(breaking.map((i) => i.label)));
  check("a tier-3 headline is never announced", !sim.items.some((i) => /bakery/i.test(textOf(i))));
  // A fresh tier-1 lands.
  const fresh = news("d", "Fed's Powell says rate cuts are not yet warranted", { publishedMs: sim.t - 40 * SEC, source: "Federal Reserve", primary: true });
  const before = sim.items.length;
  sim.run(20, walker(6), () => ({ news: [fresh, ...old] }));
  const hit = sim.items.slice(before).filter((i) => i.kind === "news");
  check("a fresh tier-1 headline is read out, once", hit.length === 1, String(hit.length));
  check("with its source and its words", hit[0] && /Federal Reserve/.test(textOf(hit[0])) && /Powell/.test(textOf(hit[0])), hit[0] && textOf(hit[0]));
  check("by Sterling, at the news wall", hit[0] && hit[0].lines[0].character === "Sterling" && hit[0].moves.Sterling?.zone === "THE_WHITEBOARD");
  check("urgent while it is breaking", hit[0] && hit[0].urgency === 2);
  check("legal and sourced", hit[0] && legal(hit[0]).length === 0 && unsourced(hit[0]).length === 0, JSON.stringify(hit[0] && [...legal(hit[0]), ...unsourced(hit[0])]));
  const n1 = sim.items.length;
  sim.run(300, walker(8), () => ({ news: [fresh, ...old] }));
  check("the same headline is never read twice", sim.items.slice(n1).filter((i) => i.kind === "news" && !/catching up/.test(i.label)).length === 0);
  // Two tier-2 → one batch.
  const t2 = [news("e", "Retailers brace for the holiday season", { tier: 2, topics: ["growth"], publishedMs: sim.t - 30 * SEC }), news("f", "Oil edges higher on supply worries", { tier: 2, topics: ["energy"], publishedMs: sim.t - 20 * SEC })];
  const n2 = sim.items.length;
  sim.run(400, walker(9), () => ({ news: [...t2, fresh, ...old] }));
  const batch = sim.items.slice(n2).filter((i) => i.kind === "news");
  check("two context headlines are one remark, not two", batch.length === 1, String(batch.length));
}

/* ── The calendar ──────────────────────────────────────────────────────── */

console.log("A release");
{
  const rel = at(2026, 10, 6, 10, 0);
  const ev = { name: "ISM Services PMI", date: "2026-10-06", timeEt: "10:00", atMs: rel, impact: "high" };
  const prints = { "2026-10-06|10:00|ISM Services PMI": { actual: "54.1", vs: "vs 52.0 forecast" } };
  const t0 = rel - 59 * MIN;
  const sim = new Sim(t0, { cal: { events: [ev], prints: {} }, dt: 5000 });
  sim.run(70 * 60, walker(2, 0.15));
  const cal = sim.items.filter((i) => i.kind === "calendar");
  check("a high-impact release is announced an hour out", cal.some((i) => /in 5\d min/.test(i.label) || /60|59|58|57|56|55|54|53/.test(i.label)), JSON.stringify(cal.map((i) => i.label)));
  check("again at five minutes", cal.some((i) => /in [345] min/.test(i.label)), JSON.stringify(cal.map((i) => i.label)));
  check("again at one minute", cal.some((i) => /in 1 min/.test(i.label)), JSON.stringify(cal.map((i) => i.label)));
  check("and when it prints", cal.some((i) => /printed/.test(i.label)), JSON.stringify(cal.map((i) => i.label)));
  check("each step once", new Set(cal.map((i) => i.topic)).size === cal.length, JSON.stringify(cal.map((i) => i.topic)));
  check("the room is quiet about the blackout window it does not own (director's T−35…T−15)", !cal.some((i) => /in (3[0-5]|2\d|1[5-9]) min/.test(i.label)));
  check("legal and sourced", cal.every((i) => legal(i).length === 0 && unsourced(i).length === 0), JSON.stringify(cal.flatMap((i) => [...legal(i), ...unsourced(i)])));
  // With the stamped actual.
  const rel2 = at(2026, 10, 6, 10, 0);
  const sim2 = new Sim(rel2 - 30 * SEC, { cal: { events: [{ ...ev, atMs: rel2 }], prints }, dt: 1000 });
  sim2.run(90, walker(4, 0.15));
  const pr = sim2.items.find((i) => i.kind === "calendar" && /printed/.test(i.label));
  check("when the actual is stamped the room reads it", pr && /54\.1/.test(textOf(pr)), pr && textOf(pr));
  const sim3 = new Sim(rel2 - 30 * SEC, { cal: { events: [{ ...ev, atMs: rel2 }], prints: {} }, dt: 1000 });
  sim3.run(90, walker(4, 0.15));
  const np = sim3.items.find((i) => i.kind === "calendar" && /printed/.test(i.label));
  check("when it is not stamped the room says so rather than inventing one", np && /No actual stamped|nobody's stamped/i.test(textOf(np)), np && textOf(np));
  // A page opened 20 minutes after the release is not told it is about to happen.
  const sim4 = new Sim(rel2 + 20 * MIN, { cal: { events: [{ ...ev, atMs: rel2 }], prints: {} }, dt: 5000 });
  sim4.run(120, walker(4, 0.15));
  check("an old release is not announced as it happens", !sim4.items.some((i) => i.kind === "calendar"));
}

/* ── Sessions ──────────────────────────────────────────────────────────── */

console.log("The session's own marks");
{
  const sim = new Sim(at(2026, 10, 6, 9, 28), { dt: 5000 });
  sim.run(40 * 60, walker(21, 0.2));
  const marks = sim.items.filter((i) => i.kind === "session" && i.topic.startsWith("session:"));
  const ids = marks.map((i) => i.topic.replace("session:", ""));
  check("the bell, the Judas window, A+-only, the flat — each said at its minute", ["open", "judas_end", "aplus"].every((m) => ids.includes(m)), JSON.stringify(ids));
  check("each mark once", new Set(ids).size === ids.length);
  check("every mark is legal and sourced", marks.every((i) => legal(i).length === 0 && unsourced(i).length === 0), JSON.stringify(marks.flatMap((i) => [...legal(i), ...unsourced(i)])));
  const sim2 = new Sim(at(2026, 10, 6, 9, 50), { dt: 5000 });
  sim2.run(5 * 60, walker(22, 0.2));
  check("a page opened at 09:50 is not told the bell just rang", !sim2.items.some((i) => i.topic === "session:open"));
  const sat = new Sim(at(2026, 10, 10, 9, 28), { dt: 5000 });
  sat.run(40 * 60, walker(23, 0.2));
  check("no bell on a Saturday", !sat.items.some((i) => i.topic === "session:open"));
}

/* ── The book and the card ─────────────────────────────────────────────── */

console.log("A position and a card");
{
  const mk = (pnl) => ({
    id: "p9",
    name: "SPY 745C 10-07",
    u: "SPY",
    type: "CALL",
    contracts: 3,
    pnlPct: pnl,
    trimmed: false,
    openedAt: T_AM,
    plan: { symbol: "ES", side: "long", entry: 7_390, stop: 7_380, t1: 7_420, t2: 7_440 },
  });
  const sim = new Sim(T_AM, {
    make: (t, o) => ({ ...o, book: { positions: [mk(o.pnl ?? 0)], dayPnl: 0, equity: 10_000, closedToday: 0, winsToday: 0, consecLosses: 0, monthEntries: 3 } }),
    pnl: 0,
  });
  sim.run(30, () => ({ SPY: 7_400 }));
  const before = sim.items.length;
  sim.run(10, () => ({ SPY: 7_400 }), () => ({ pnl: 13 }));
  const p = sim.items.slice(before).find((i) => i.kind === "book");
  check("a position stepping through +10% is remarked on", p && /SPY 745C/.test(textOf(p)) && /\+13|13%/.test(textOf(p) + p.label), JSON.stringify(sim.items.slice(before).map((i) => i.label)));
  const near = sim.items.length;
  sim.run(10, () => ({ SPY: 7_383 }), () => ({ pnl: 12 }));
  const nr = sim.items.slice(near).find((i) => i.kind === "book" && /from the level/.test(i.label));
  check("price within 0.3 ATR of the level on a held position is urgent", nr && nr.urgency === 2, JSON.stringify(sim.items.slice(near).map((i) => i.label)));
  check("and says what happens next", nr && /out|level/i.test(textOf(nr)), nr && textOf(nr));
  check("legal and sourced", [p, nr].every((i) => i && legal(i).length === 0 && unsourced(i).length === 0), JSON.stringify([p, nr].flatMap((i) => (i ? [...legal(i), ...unsourced(i)] : ["missing"]))));
}
{
  const card = (tier, away) => ({
    key: "MNQ:long:A:1",
    name: "A MNQ long",
    verdict: "ARMED",
    u: "QQQ",
    type: "CALL",
    band: "A",
    tier,
    awayPts: away,
    futSymbol: "MNQ",
    futSide: "long",
    entry: 29_960,
    stop: 29_900,
    t1: 30_100,
    pT1: 0.31,
    expR: 0.05,
    block: null,
    strategy: "mechanical",
  });
  const sim = new Sim(T_AM, { make: (t, o) => ({ ...o, card: card(o.tier ?? "forming", o.away ?? 90) }), tier: "forming", away: 90 });
  sim.run(20, walker(31));
  const n0 = sim.items.length;
  sim.run(8, walker(31), () => ({ tier: "armed", away: 30 }));
  const ar = sim.items.slice(n0).find((i) => i.kind === "card");
  check("a card arming is remarked on, with the CE", ar && /armed/.test(ar.label) && ar.facts.includes("29,960"), ar && `${ar.label} :: ${textOf(ar)}`);
  const n1 = sim.items.length;
  sim.run(8, walker(31), () => ({ tier: "live", away: 0 }));
  const lv2 = sim.items.slice(n1).find((i) => i.kind === "card");
  check("price at CE is urgent: this is the touch", lv2 && lv2.urgency === 2 && /touch|CE/.test(textOf(lv2)), lv2 && textOf(lv2));
}

/* ── The feed's honesty ────────────────────────────────────────────────── */

console.log("The feed's honesty");
{
  const sim = new Sim(T_AM, { feed: { kind: "yahoo", lagSec: 600 } });
  sim.run(10, walker(41));
  const welcome = sim.items.find((i) => i.topic === "welcome");
  check("the first thing the room says is where its data comes from", welcome && /Yahoo/.test(textOf(welcome)) && /behind/.test(textOf(welcome)), welcome && textOf(welcome));
  const n0 = sim.items.length;
  for (let k = 0; k < 10; k++) sim.tick(walker(41)(), { feed: k % 2 ? { kind: "live_gateway", lagSec: 0.5 } : { kind: "yahoo", lagSec: 600 } });
  check("a feed that flaps for ten seconds is not remarked on", !sim.items.slice(n0).some((i) => i.kind === "feed"));
  sim.run(40, walker(41), () => ({ feed: { kind: "live_gateway", lagSec: 0.5 } }));
  const gw = sim.items.slice(n0).find((i) => i.kind === "feed");
  check("a feed that has changed and held is: the gateway is up", gw && /Gateway/.test(textOf(gw)), gw && textOf(gw));
}
{
  const sim = new Sim(T_AM, { feed: { kind: "synthetic", lagSec: null } });
  sim.run(60 * 60, walker(51), () => ({}));
  const priced = sim.items.filter((i) => ["tape", "level"].includes(i.kind));
  check("on a synthetic feed no tape or level talk, ever", priced.length === 0);
  const tops = new Set(sim.items.filter((i) => i.kind === "heartbeat").map((i) => i.topic));
  const bad = [...tops].filter((t) => !/^hb:(rules|week|evidence|lab|memory|mood|tomorrow|recap|audit:)/.test(t));
  check("and its chatter is only the unpriced topics", bad.length === 0, JSON.stringify(bad));
  check("it says plainly that the feed is not real", sim.items.some((i) => /synthetic/i.test(textOf(i))));
  check("every line sourced and legal", sim.items.every((i) => legal(i).length === 0 && unsourced(i).length === 0), JSON.stringify(sim.items.flatMap((i) => [...legal(i), ...unsourced(i)]).slice(0, 4)));
  check("the reminder is occasional, not a loop", sim.items.filter((i) => i.topic === "feed:reminder").length <= 3, String(sim.items.filter((i) => i.topic === "feed:reminder").length));
}

/* ── A quiet day does not loop ─────────────────────────────────────────── */

console.log("A quiet day (09:46 → 16:00, flat tape, slow-drifting data)");
const QUIET = (() => {
  const sim = new Sim(at(2026, 10, 6, 9, 46), {
    dt: 2000,
    make: (t, o) => {
      const drift = Math.floor((t - at(2026, 10, 6, 9, 46)) / (20 * MIN));
      return {
        ...o,
        bookOver: {
          QQQ: { rangeUsedPct: 40 + drift * 3, volRatio: drift % 3 === 0 ? 1.5 : 0.9 },
          SPY: { rangeUsedPct: 35 + drift * 3 },
        },
        pulse: { vix: 17.2 + drift * 0.15, tenYear: 4.12, at: t },
        minds: mkMinds({ Jax: { caffeine: drift % 4 === 1 ? 0.1 : 0.6 }, Sterling: { stress: drift % 5 === 2 ? 0.8 : 0.2 }, memories: [{ who: "Jax", against: "Sterling", clock: "09:36", kind: "chase_call", text: "Jax called calls on QQQ at 481.20", outcome: "wrong" }] }),
        lab: { refusals: [{ gate: "ev", n: 2 + drift, pnlUsd: -40 * drift, wins: 0 }], twins: { n: 3, deltaUsd: 12 }, calibration: { n: 4 + drift, meanP: 0.3, hitRate: 0.25, brier: 0.2 }, track: {} },
        card: { key: "MNQ:long:B+:2", name: "B+ MNQ long", verdict: "WATCH", u: "QQQ", type: "CALL", band: "B+", tier: "forming", awayPts: 100, futSymbol: "MNQ", futSide: "long", entry: 29_900, stop: 29_860, t1: 30_000, pT1: 0.27, expR: 0.01, block: "LTF shift not printed", strategy: null },
      };
    },
  });
  sim.run(6 * 3600 + 14 * 60, walker(61));
  return sim;
})();
{
  const sim = QUIET;
  const chatter = sim.items.filter((i) => i.kind === "heartbeat");
  const topics = new Set(chatter.map((i) => i.topic));
  check("a flat tape still makes the room talk — about real things", chatter.length >= 60, String(chatter.length));
  check("…but not constantly (chatter budget)", chatter.length <= 260, String(chatter.length));
  check(`about many different things (${topics.size} topics)`, topics.size >= 12, JSON.stringify([...topics]));
  let run = 0;
  let worst = 0;
  for (let i = 1; i < sim.items.length; i++) {
    run = sim.items[i].topic === sim.items[i - 1].topic ? run + 1 : 0;
    worst = Math.max(worst, run);
  }
  check("never the same topic twice in a row", worst === 0, String(worst));
  const texts = sim.items.flatMap((i) => i.lines.map((l) => `${l.character}|${l.text.toLowerCase()}`));
  let repeats = 0;
  for (let i = 0; i < texts.length; i++) for (let k = Math.max(0, i - TALK.recentKeep + 1); k < i; k++) if (texts[k] === texts[i]) repeats++;
  check(`no line is said again within ${TALK.recentKeep} lines`, repeats === 0, String(repeats));
  const counts = {};
  for (const t of texts) counts[t] = (counts[t] ?? 0) + 1;
  const worstLine = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  check("over a whole day no line is said more than a handful of times", worstLine[1] <= 8, JSON.stringify(worstLine));
  const gaps = [];
  for (let i = 1; i < chatter.length; i++) gaps.push(chatter[i].at - chatter[i - 1].at);
  check(`chatter waits for a quiet room (≥ ${TALK.quietGapMs.min / SEC} s between)`, gaps.every((g) => g >= TALK.quietGapMs.min), `min ${Math.min(...gaps)}`);
  const win = [];
  let over = false;
  for (const i of sim.items) {
    win.push(i.at);
    while (win.length && i.at - win[0] > TALK.budget.windowMs) win.shift();
    if (win.length > TALK.budget.max) over = true;
  }
  check(`never more than ${TALK.budget.max} exchanges in ten minutes`, !over);
  const speakers = {};
  for (const i of sim.items) for (const l of i.lines) speakers[l.character] = (speakers[l.character] ?? 0) + 1;
  check("all five people talk", CREW5.every((c) => (speakers[c] ?? 0) >= 10), JSON.stringify(speakers));
  const distinct = Object.fromEntries(CREW5.map((c) => [c, new Set(sim.items.flatMap((i) => i.lines.filter((l) => l.character === c).map((l) => l.text))).size]));
  check("each of them has a lot to say, not a short loop", CREW5.every((c) => distinct[c] >= 12), JSON.stringify(distinct));
  check("every exchange is legal", sim.items.every((i) => legal(i).length === 0), JSON.stringify(sim.items.flatMap(legal).slice(0, 4)));
  check("every number in every line was produced by code", sim.items.every((i) => unsourced(i).length === 0), JSON.stringify(sim.items.flatMap(unsourced).slice(0, 6)));
  check("nothing is said about a move: the tape never moved", !sim.items.some((i) => i.kind === "tape"));
  const kinds = {};
  for (const i of sim.items) kinds[i.kind] = (kinds[i.kind] ?? 0) + 1;
  console.log(`      ${sim.items.length} exchanges — ${JSON.stringify(kinds)}`);
}

console.log("Stable topics: what the brain already holds is said once, not on a timer");
{
  const said = (topic) => QUIET.items.filter((i) => i.topic === topic).length;
  check("the PATH counters are said at most once on a day they never moved (was: every ~70 min)", said("hb:rules") <= 1, String(said("hb:rules")));
  check("the contract price list is said at most once on a day its rungs never moved $25", said("hb:ladder") <= 1, String(said("hb:ladder")));
  check("the stable list is exactly the three topics that restate the rules, the balance/goal and the price list", JSON.stringify([...STABLE_HEARTBEATS].sort()) === JSON.stringify(["goalnight", "ladder", "rules"]), JSON.stringify(STABLE_HEARTBEATS));
  // The saved state across a day boundary (what the tab sees when it is opened on a new day).
  const HOUR = 60 * MIN;
  const saved = freshTalkState();
  saved.seq = 9;
  saved.topicAt["hb:rules"] = 1_000;
  saved.topicSig["hb:rules"] = "3|0|0|0";
  saved.topicAt["hb:goalnight"] = 2_000;
  saved.topicSig["hb:goalnight"] = "2026-10-06|29";
  saved.topicAt["hb:board"] = 3_000;
  saved.topicSig["hb:board"] = "x";
  const S0 = 5_000_000;
  const young = restoreTalkState({ at: S0, state: saved }, S0 + 2 * HOUR, 16 * HOUR, 7 * 24 * HOUR);
  check("a young state is kept whole", young === saved || (young.seq === 9 && young.topicAt["hb:board"] === 3_000));
  const next = restoreTalkState({ at: S0, state: saved }, S0 + 20 * HOUR, 16 * HOUR, 7 * 24 * HOUR);
  check("an expired state starts fresh (the sequence number resets)", next.seq === 0);
  check("…but the stable topics keep their memory, so a new day does not open by reciting them", next.topicAt["hb:rules"] === 1_000 && next.topicSig["hb:rules"] === "3|0|0|0" && next.topicAt["hb:goalnight"] === 2_000);
  check("…and nothing else is carried (a board talk or a headline may be said again)", next.topicAt["hb:board"] === undefined && next.topicSig["hb:board"] === undefined);
  const old = restoreTalkState({ at: S0, state: saved }, S0 + 8 * 24 * HOUR, 16 * HOUR, 7 * 24 * HOUR);
  check("after a week everything is forgotten", old.seq === 0 && old.topicAt["hb:rules"] === undefined);
  check("with nothing saved, or a state of another shape, it starts fresh", restoreTalkState(null, S0, 1, 1).seq === 0 && restoreTalkState({ at: S0, state: { v: 2 } }, S0, 9, 9).seq === 0);
  // A carried topic does not speak again unless its data moved: simulate the first hour of a new day with the carried memory.
  const T1 = at(2026, 10, 7, 9, 46);
  // The probe: the same world, no memory. It must say the rules (so the carried case below is not vacuous), and its
  // state holds the signature the world really has.
  const probe = new Sim(T1, { dt: 2000 });
  probe.run(150 * 60, walker(81));
  const realSig = probe.st.topicSig["hb:rules"];
  check("precondition: with no memory the room does say the rules counters within the first 150 minutes", probe.items.some((i) => i.topic === "hb:rules") && typeof realSig === "string", String(realSig));
  const carried = freshTalkState();
  carried.topicAt["hb:rules"] = T1 - 20 * HOUR;
  carried.topicSig["hb:rules"] = realSig;
  const simCarry = new Sim(T1, { dt: 2000 });
  simCarry.st = carried;
  simCarry.run(150 * 60, walker(81));
  check("a new day with the rules already said on the same numbers does not open by saying them", !simCarry.items.some((i) => i.topic === "hb:rules"), String(simCarry.items.filter((i) => i.topic === "hb:rules").length));
}

if (process.argv.includes("--transcript")) {
  const hhmm = (ms) => new Date(ms - 4 * 3600_000).toISOString().slice(11, 16);
  console.log("\n--- transcript: the quiet day, first 60 exchanges ---");
  for (const i of QUIET.items.slice(0, 60)) {
    console.log(`${hhmm(i.at)} ET · ${i.kind} · ${i.label}`);
    for (const l of i.lines) console.log(`    ${l.character.padEnd(8)} ${l.text}`);
  }
  console.log("--- end transcript ---\n");
}

console.log("Off hours (Tue 22:00 → Wed 01:00 ET, options shut, Globex open)");
{
  const sim = new Sim(at(2026, 10, 6, 22, 0), { dt: 2000 });
  sim.run(3 * 3600, walker(71));
  const chatter = sim.items.filter((i) => i.kind === "heartbeat");
  const topics = new Set(chatter.map((i) => i.topic));
  check("the room is still alive overnight", chatter.length >= 12, String(chatter.length));
  check("it reads tomorrow's plan", [...topics].some((t) => t === "hb:tomorrow"), JSON.stringify([...topics]));
  check("it reads the overnight range", [...topics].some((t) => t.startsWith("hb:overnight")), JSON.stringify([...topics]));
  check("it reads a measured finding", [...topics].some((t) => t === "hb:evidence"));
  check("it does not talk about the open or the board", ![...topics].some((t) => t === "hb:board") && !sim.items.some((i) => i.topic === "session:open"));
  check("legal and sourced", sim.items.every((i) => legal(i).length === 0 && unsourced(i).length === 0), JSON.stringify(sim.items.flatMap((i) => [...legal(i), ...unsourced(i)]).slice(0, 4)));
}

console.log("The weekend");
{
  const sim = new Sim(at(2026, 10, 10, 14, 0), { dt: 5000, feed: { kind: "yahoo", lagSec: 90_000 } });
  sim.run(2 * 3600, walker(81));
  check("a frozen tape on a Saturday is not read as a move", !sim.items.some((i) => ["tape", "level"].includes(i.kind)));
  check("no price-tape chatter either", !sim.items.some((i) => /^hb:(range|dealing|draw|htf|smt|gap|vol|overnight)/.test(i.topic)), JSON.stringify([...new Set(sim.items.map((i) => i.topic))]));
  check("it still has things to say (the plan, the record, the findings)", sim.items.filter((i) => i.kind === "heartbeat").length >= 6);
}

/* ── Quiet gaps, bursts and the budget ─────────────────────────────────── */

console.log("After the tab was hidden");
{
  const sim = new Sim(T_AM);
  sim.run(60, walker(91));
  sim.t += 8 * MIN; // the tab slept
  const before = sim.items.length;
  sim.run(5, walker(91));
  check("the first look after a long gap says nothing about a move that happened while nobody watched", !sim.items.slice(before).some((i) => i.kind === "tape" || i.kind === "level" || i.urgency === 0));
}

console.log("A violent minute is capped");
{
  const sim = new Sim(T_AM, { dt: 1000 });
  sim.run(60, walker(101));
  let px = BASE.QQQ;
  for (let i = 0; i < 600; i++) {
    px += (i % 20 < 10 ? 3.2 : -3.2);
    sim.tick({ QQQ: px, SPY: BASE.SPY + (i % 20 < 10 ? 1 : -1) });
  }
  const win = [];
  let over = false;
  for (const i of sim.items) {
    win.push(i.at);
    while (win.length && i.at - win[0] > TALK.budget.windowMs) win.shift();
    if (win.length > TALK.budget.max) over = true;
  }
  check("ten minutes of whipsaw never exceeds the exchange budget", !over, String(sim.items.length));
  check("and it still reacted", sim.items.some((i) => i.kind === "tape"));
}

/* ── Determinism and state ─────────────────────────────────────────────── */

console.log("Determinism");
{
  const run = () => {
    const sim = new Sim(T_AM, { dt: 2000 });
    sim.run(2 * 3600, walker(1234));
    return sim;
  };
  const a = run();
  const b = run();
  check("the same world gives the same words", JSON.stringify(a.items) === JSON.stringify(b.items), `${a.items.length} vs ${b.items.length}`);
  const st = JSON.stringify(a.st);
  check("the state survives a JSON round trip", JSON.stringify(JSON.parse(st)) === st);
  check("and stays small (it is cloned every tick)", st.length < 40_000, String(st.length));
  const c = new Sim(T_AM, { dt: 2000 });
  c.run(2 * 3600, walker(4321));
  check("a different tape gives different talk", JSON.stringify(a.items.map((i) => i.lines)) !== JSON.stringify(c.items.map((i) => i.lines)) || a.items.length === 0);
  check("hash32 is stable", hash32("room") === hash32("room") && hash32("room") !== hash32("rooms"));
}

console.log("Facts");
{
  const f = new Facts();
  check("pts: whole above 10, one decimal below", f.pts(31.4) === "31" && f.pts(7.46) === "7.5");
  check("px: separators and two decimals", f.px(21540.5) === "21,540.50");
  check("lvl: whole in the thousands", f.lvl(21540.4) === "21,540" && f.lvl(481.2) === "481.20");
  check("every printed number is registered", ["31", "7.5", "21,540.50", "21,540", "481.20"].every((x) => f.list.includes(x)), JSON.stringify(f.list));
  check("a trailing full stop is not part of a number", (() => { const g = new Facts(); g.raw("rose to 4."); return g.list.includes("4") && !g.list.includes("4."); })());
  check(`the monthly PATH cap is read from the rules (${PATH_MONTH_CAP}), never typed`, new Facts().int(PATH_MONTH_CAP) === String(PATH_MONTH_CAP));
}

console.log("What a speech engine would be handed");
{
  const unique = [...new Map(SPOKEN.map((l) => [l.text, l])).values()];
  const bad = spokenProblems(unique);
  check(`every distinct line the room said in these simulations (${unique.length}) is speakable: numbers and signs held, no symbol, unit, code name or unspelled abbreviation left`, unique.length > 20 && bad.length === 0, bad.slice(0, 3).join(" || "));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
