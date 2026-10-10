/**
 * The Mead Hall's prediction talk (src/lib/room/live-voices-mead.ts, hall-lite.ts, hall-store.ts) against its contract.
 *
 *   npx tsx scripts/verify-mead-talk.mjs            (add --transcript to print what the five say on a simulated Saturday)
 *
 * WHY: the Floor knew almost nothing about prediction markets — six rows of an event ticker, an outcome, a price and a constant grade
 * "D" — and said only the rules. The hall now carries the signal engine's own board into the talk (hall-lite.ts) and the five analyze it
 * the way a desk would: what the jumbotron shows, what YES must clear after the Kalshi taker fee, why Kalshi's own price is never a model,
 * which scanner layer is missing and the limit that would clear fees, the price bands and their source, a crowd that reacts to real
 * velocity, what settles next and how old the read is, an honest record, a headline that shares a subject, and the lectern's conditions.
 * This file proves, for every line they can say, what the other verifiers prove for the rest of the room, and the one thing none of them
 * could: that a number a line says IS the engine's field for that market, and that nothing is a pick.
 *
 *   - the Lite is the engine's: every field equals the MarketSignal's, in the hall's order; nothing is recomputed in the voice;
 *   - every digit is registered (Facts), every line is speakable (spokenProblems), no desk verdict word, no advice, no pick, no raw
 *     Kalshi ticker, no placeholder grade, at most 42 words a line, legal animations and legal hall spots (none shared);
 *   - a stale read is said to be stale and nothing else is said from it; the desk's morning (09:25–11:15 ET) is left alone;
 *   - mutants (a moved number, a pick, a raw ticker, a placeholder D, a stale read said as live, a swapped side, a verdict word,
 *     advice) are each caught by the checker that guards the real lines.
 */
import fs from "node:fs";

const { spokenProblems } = await import("./lib/spoken-check.mjs");
const X = await import("./lib/mead-fixture.mjs");
const W = await import("./lib/mead-world.mjs");
const E = await import("../src/lib/predict/signals.ts");
const M = await import("../src/lib/predict/math.ts");
const H = await import("../src/lib/room/hall-lite.ts");
const ST = await import("../src/lib/room/hall-store.ts");
const VM = await import("../src/lib/room/live-voices-mead.ts");
const OS = await import("../src/lib/room/off-hours-study.ts");
const IV = await import("../src/lib/room/live-voices-invest.ts");
const AG = await import("../src/lib/room/agents.ts");
const HL = await import("../src/lib/room/mead-hall-layout.ts");
const LT = await import("../src/lib/room/live-types.ts");
const { talkTick, freshTalkState } = await import("../src/lib/room/live-talk.ts");
const { ANIMS_BY_CHARACTER } = await import("../src/lib/room/orchestrator.ts");
const SF = await import("../src/components/mead/mead-signal-feed.ts");
const MS = await import("../src/components/mead/mead-screens.ts");

const TRANSCRIPT = process.argv.includes("--transcript");
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};
const LAYOUT = JSON.parse(fs.readFileSync(new URL("../src/data/floor-layout.json", import.meta.url), "utf8"));
const HALL_IDS = new Set(HL.HALL_SPOTS.map((s) => s.id));
const iso = (ms) => new Date(ms).toISOString();

/* ── The checker every line goes through ───────────────────────────────── */

const VERDICT = /\b(TAKE|STAND|MANAGE|PATH)\b/;
const ADVICE = /\b(i|we) recommend\b|\byou should\b|\bshould (buy|sell|own|add)\b|\bwill (outperform|beat the market|rally|double)\b|(?<!\b(?:not|no|never) )\bguarantee|\bundervalued\b|\bovervalued\b|\bcan'?t lose\b|\brisk-free\b|\bprice target\b|\bgood bet\b|\bsure thing\b/i;
const PICK = /\bwill win\b|\bto win\b|\btake the\b|\bbet on\b|\block(ed|s|ing)?\b|\bguaranteed\b|\bback the\b|\bgo with\b|\bmy pick\b|\bi'?d buy\b|\bbuy yes\b|\bbuy no\b/i;
const RAW_TICKER = /\bKX[A-Z0-9]+|\b[A-Z]{3,}-\d|\d{2}[A-Z]{3}\d{2}|-[A-Z]{3}\b/;
const PLACEHOLDER = /scanner grade|grade of D|placeholder/i;
const LETTER = /\b(grade|letter)\s+(is\s+|of\s+)?[A-F]\b(?![a-z])/;
const SENDS = /SMASHING_ENTER_KEY|placeOrder|review_option_order/;

const numbersIn = (text) => (text.match(/\d[\d,]*\.?\d*/g) ?? []).map((x) => Number(x.replace(/[.,]+$/, "").replace(/,/g, "")));
const leaves = (v, out = []) => {
  if (v == null) return out;
  if (typeof v === "number") out.push(Math.abs(v));
  else if (typeof v === "string") out.push(...numbersIn(v));
  else if (Array.isArray(v)) for (const x of v) leaves(x, out);
  else if (typeof v === "object") for (const x of Object.values(v)) leaves(x, out);
  return out;
};
/** Every number the Lite holds, plus the two forms the voice says an age in (seconds under 90, else whole minutes), plus a headline's own. */
const allowedNumbers = (h, extra = []) => {
  const s = new Set(leaves(h));
  s.add(Math.round(h.ageSec / 60));
  for (const e of extra) for (const x of numbersIn(e)) s.add(x);
  return s;
};

/** Everything that can be wrong with one exchange, as strings; empty is clean. `h` is the Lite the exchange was built from. */
function itemProblems(item, h, { extra = [], allowLetters = true } = {}) {
  const bad = [];
  const allowed = allowedNumbers(h, extra);
  for (const l of item.lines) {
    const words = l.text.trim().split(/\s+/).length;
    if (words > 42) bad.push(`${words} words: ${l.text.slice(0, 40)}…`);
    if (!ANIMS_BY_CHARACTER[l.character]?.includes(l.animation)) bad.push(`${l.character} cannot ${l.animation}`);
    if (SENDS.test(l.animation) || SENDS.test(l.text)) bad.push("a talk line must never send an order");
    if (VERDICT.test(l.text)) bad.push(`desk verdict word in “${l.text.slice(0, 50)}”`);
    if (ADVICE.test(l.text)) bad.push(`advice language in “${l.text.slice(0, 50)}”`);
    if (PICK.test(l.text)) bad.push(`a pick in “${l.text.slice(0, 50)}”`);
    if (RAW_TICKER.test(l.text)) bad.push(`a raw Kalshi ticker in “${l.text.slice(0, 60)}”`);
    if (PLACEHOLDER.test(l.text)) bad.push(`a placeholder grade in “${l.text.slice(0, 60)}”`);
    if (!allowLetters && LETTER.test(l.text)) bad.push(`a letter grade said where the engine gave none: “${l.text.slice(0, 60)}”`);
    for (const num of numbersIn(l.text)) if (!allowed.has(num)) bad.push(`${num} is not in the engine's fields (in “${l.text.slice(0, 50)}”)`);
    for (const num of l.text.match(/\d[\d,]*\.?\d*/g) ?? []) {
      const raw = num.replace(/[.,]+$/, "");
      if (!item.facts.includes(raw)) bad.push(`${raw} was not registered by code (in “${l.text.slice(0, 50)}”)`);
    }
  }
  const taken = new Map();
  for (const [who, m] of Object.entries(item.moves)) {
    if (m.zone !== "HALL") bad.push(`${who}: a hall exchange moves people to the HALL zone, not ${m.zone}`);
    if (!(HALL_IDS.has(m.spot) && /^mead_/.test(m.spot))) bad.push(`${who}: ${m.spot} is not a hall spot`);
    if (!LAYOUT.spots[m.spot]) bad.push(`${who}: ${m.spot} is not in the plan`);
    if (taken.has(m.spot)) bad.push(`${who} and ${taken.get(m.spot)} share ${m.spot}`);
    taken.set(m.spot, who);
    if (!item.lines.some((l) => l.character === who)) bad.push(`${who} is walked to ${m.spot} and says nothing`);
  }
  const sp = spokenProblems(item.lines);
  for (const p of sp) bad.push(`not speakable: ${p}`);
  return bad;
}

/** A read older than the talk limit is never talked from, except to say that it is old. */
const ageProblems = (item, h) => (h.old && item.topic !== "hb:hall:clock" ? [`spoke from a read ${h.ageSec} s old (limit ${h.talkMaxSec} s) under ${item.topic}`] : []);

/** The board exchange against the engine's own signal for the jumbotron: the numbers a listener hears are the book's, on the right side. */
function boardExpectations(item, s0) {
  const text = item.lines.map((l) => l.text).join(" ");
  const bad = [];
  const yes = Math.round(s0.prices.yesAsk * 100);
  const no = Math.round(s0.prices.noAsk * 100);
  if (!new RegExp(`yes asks ${yes}¢`, "i").test(text)) bad.push(`yes asks ${yes}¢ is not said`);
  if (!new RegExp(`no asks ${no}¢`).test(text)) bad.push(`no asks ${no}¢ is not said`);
  if (!new RegExp(`spread ${s0.spread.cents}¢`).test(text)) bad.push(`spread ${s0.spread.cents}¢ is not said`);
  if (!text.includes(String(Number((s0.implied.feeAdjustedYes * 100).toFixed(1))))) bad.push("what yes must clear is not the engine's");
  return bad;
}

/** Build one exchange from a builder with a fresh state, as the engine would (a Facts per exchange). */
let KEY = 0;
function build(fn, h, ...rest) {
  const f = new LT.Facts();
  const st = freshTalkState();
  const ex = fn({ st, f, key: `k${KEY}|${fn.name}`, now: Date.parse(h.asOf) + h.ageSec * 1000 }, h, ...rest);
  return ex ? { lines: ex.lines, moves: ex.moves, facts: f.list, topic: fn.name } : null;
}
/** The word choice is a function of the exchange's key: build one exchange under many keys so every variant of every bank is said and checked. */
const KEYS = 24;
function buildAll(fn, h, ...rest) {
  const out = [];
  for (KEY = 0; KEY < KEYS; KEY++) {
    const it = build(fn, h, ...rest);
    if (it) out.push(it);
  }
  KEY = 0;
  return out;
}

/* ── The fixture chain ─────────────────────────────────────────────────── */

const NOW = Date.UTC(2026, 9, 10, 23, 5); // Sat 2026-10-10 19:05 ET
const POLL = Math.floor(NOW / X.POLL_MS) * X.POLL_MS;
console.log("The hall's Lite is the engine's board, copied");
const board0 = X.boardAt(POLL, { models: true });
const boardD = X.boardAt(POLL, { drift: 4 });
const boardNo = X.boardAt(POLL, { models: false });
const lite = X.hallAt(NOW, { drift: 4 });
const liteNo = X.hallAt(NOW, { models: false });
{
  const sc = X.scanRows();
  check("the chain is real: the scanner priced both sides of the fixture game", sc.length === 2 && sc.every((r) => r.layers.length === 8), String(sc.length));
  check("…and its references became the engine's model inputs (two markets have an edge read, seven do not)", board0.noEdgeCount === 7 && board0.signals.length - board0.noEdgeCount === 2, String(board0.noEdgeCount));
  check("hall rows: the jumbotron and the Rune Board's five, no more", lite.rows.length === 6 && lite.rows.every((r, i) => r.slot === i));
  const ordered = SF.hallStateFromBoard(boardD).ordered.slice(0, 6).map((s) => s.id);
  check("in the hall's own order (the Mead feed's hallStateFromBoard)", JSON.stringify(lite.rows.map((r) => r.id)) === JSON.stringify(ordered), JSON.stringify([lite.rows.map((r) => r.id), ordered]));
  check("the Lite is JSON-small", JSON.stringify(lite).length < 12_000, String(JSON.stringify(lite).length));
  const byId = new Map(boardD.signals.map((s) => [s.id, s]));
  const c100 = (x) => (x == null ? null : Math.round(x * 100));
  const c1 = (x) => (x == null ? null : Math.round(x * 1000) / 10);
  let ok = true;
  const why = [];
  for (const r of lite.rows) {
    const s = byId.get(r.id);
    const eq = (name, got, want) => {
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        ok = false;
        why.push(`${r.id}.${name}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
      }
    };
    eq("yesAskC", r.yesAskC, c100(s.prices.yesAsk));
    eq("yesBidC", r.yesBidC, c100(s.prices.yesBid));
    eq("noAskC", r.noAskC, c100(s.prices.noAsk));
    eq("midC", r.midC, c1(s.implied.mid));
    eq("needsYesPct", r.needsYesPct, c1(s.implied.feeAdjustedYes));
    eq("needsNoPct", r.needsNoPct, c1(s.implied.feeAdjustedNo));
    eq("costPts", r.costPts, r.needsYesPct != null && r.midC != null ? Math.round((r.needsYesPct - r.midC) * 10) / 10 : null);
    eq("feeYesC", r.feeYesC, s.implied.feeYes == null ? null : Math.round(s.implied.feeYes * 10000) / 100);
    eq("spreadC", r.spreadC, s.spread.cents);
    eq("liq", r.liq, s.liquidity.word);
    eq("askSize", r.askSize, s.liquidity.askSize == null ? null : Math.round(s.liquidity.askSize));
    eq("moveC", r.moveC, c1(s.move.sinceOpen));
    eq("velCph", r.velCph, s.move.velocityCentsPerHour == null ? null : Math.round(s.move.velocityCentsPerHour * 10) / 10);
    eq("velHours", r.velHours, s.move.velocityWindowHours);
    eq("velPoints", r.velPoints, s.move.points);
    eq("phase", r.phase, s.settlement.phase);
    eq("fresh", r.fresh, s.freshness.word);
    eq("stale", r.stale, s.freshness.stale);
    eq("edgeStatus", r.edgeStatus, s.edge.status);
    eq("grade", r.grade, s.grade);
    eq("score", r.score, s.score);
    eq("gradedSide", r.gradedSide, s.gradedSide);
    eq("bin", r.bin?.id ?? null, s.priceBin);
    eq("edge.side", r.edge?.side ?? null, s.edge.status === "edge" ? s.edge.side : null);
    eq("edge.netC", r.edge?.netC ?? null, s.edge.status === "edge" ? c1(s.edge.netPerContract) : null);
    eq("nfl", r.nfl, s.nfl);
    // The settle span is the engine's own durationWords, as a number and a unit.
    const w = E.durationWords(s.settlement.msToSettle);
    const parsed = r.settle ? `${r.settle.n}` : null;
    eq("settle", parsed == null ? null : w.startsWith(parsed), parsed == null ? null : true);
  }
  check("every field of every row equals the engine's own field for that market (rounded, never recomputed)", ok, why.slice(0, 3).join(" | "));
  check("a market with no model input has NO letter in the Lite, not a placeholder", liteNo.rows.every((r) => r.grade === null && r.edge === null && r.noEdgeWhy), JSON.stringify(liteNo.rows.map((r) => r.grade)));
  check("a market with one has the engine's letter", lite.rows.filter((r) => r.edge).every((r) => r.grade && "ABCDF".includes(r.grade)));
  check("counts, total and the number with a model come from the board", lite.total === boardD.signals.length && lite.noEdge === boardD.noEdgeCount && lite.modeled === lite.total - lite.noEdge && lite.ungraded === boardD.ungraded);
  check("a go/stop word is never carried (the scanner's own words are not the Floor's)", !/"(GO|LIMIT|STAND)"/.test(JSON.stringify(lite)));
}

console.log("Labels: the hall's names, in words");
{
  const raws = X.FIXTURE.markets;
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check("the family tag is the Mead screens' own (categoryLabel) for every fixture market", board0.signals.every((s) => H.familyTag(s.id, s.event) === MS.categoryLabel(SF.signalToHallMarket(s))), board0.signals.map((s) => `${H.familyTag(s.id, s.event)}/${MS.categoryLabel(SF.signalToHallMarket(s))}`).join(" "));
  const e = (ev) => H.eventWords(ev);
  check("NFL event: the game and its date, no team codes", eq(e("KXNFLGAME-26OCT05MINDET"), { famSay: "NFL game", when: "on October 5" }), JSON.stringify(e("KXNFLGAME-26OCT05MINDET")));
  check("a game with a kickoff time in its ticker still reads as its date", eq(e("KXMLBGAME-26OCT071800LADATL"), { famSay: "MLB game", when: "on October 7" }));
  check("a weather event", eq(e("KXHIGHNY-26OCT06"), { famSay: "NYC high temp", when: "on October 6" }));
  check("a quarter", eq(e("KXGDP-26Q3"), { famSay: "GDP", when: "for the third quarter of 2026" }));
  check("a month", eq(e("KXCPIYOY-26OCT"), { famSay: "CPI", when: "in October 2026" }));
  check("a year", eq(e("KXSENATECONTROL-26"), { famSay: "Election", when: "in 2026" }));
  check("a series the table does not know is titled, not shouted", eq(e("KXLONGSHOT-DEMO"), { famSay: "Longshot", when: null }));
  check("a human event passes through as words", eq(e("GB @ MIN"), { famSay: "GB at MIN", when: null }));
  const mismatch = board0.signals.filter((s) => {
    const label = MS.eventLabel(SF.signalToHallMarket(s));
    const mine = e(s.event);
    return /KX/i.test(s.event) && /\d/.test(label) && mine.when && !label.startsWith(mine.famSay);
  });
  check("the series name matches the Mead screens' eventLabel for every fixture event", mismatch.length === 0, mismatch.map((s) => s.event).join());
  check("no spoken label holds a raw ticker", board0.signals.every((s) => { const w = e(s.event); return !RAW_TICKER.test(`${w.famSay} ${w.when ?? ""}`); }));
  const subjects = lite.rows.map((r) => H.subjectOf(r));
  check("every subject the hall can name is speakable (degrees, at least, money, percent)", spokenProblems(subjects).length === 0, spokenProblems(subjects).slice(0, 2).join(" || "));
  const odd = board0.signals.map((s) => H.sayable(s.outcome));
  check("…including the odd outcomes (72°F or above, ≥2.0%, Above 100000)", spokenProblems(odd).length === 0, spokenProblems(odd).slice(0, 2).join(" || "));
  check("sayable never changes a digit", board0.signals.every((s) => JSON.stringify(numbersIn(H.sayable(s.outcome))) === JSON.stringify(numbersIn(s.outcome))));
}

console.log("Fees, spans and the crowd: read from the engine's own functions");
{
  const k = M.VENUES.kalshi;
  check("the taker rate and the maker rate are the fee model's constants", lite.fee.takerPct === Math.round(M.KALSHI_TAKER_RATE * 10000) / 100 && lite.fee.makerPct === Math.round(M.KALSHI_MAKER_RATE * 10000) / 100);
  check("the fee at fifty cents is the engine's own fee function (cents per contract)", lite.fee.peakC === Math.round(M.feePerContract(0.5, 100, k) * 10000) / 100 && lite.fee.peakPriceC === 50);
  check("the fee at ten cents too", lite.fee.lowC === Math.round(M.feePerContract(0.1, 100, k) * 10000) / 100);
  check("the fee is widest in the middle (the lesson's claim, checked)", lite.fee.peakC > lite.fee.lowC && [5, 15, 25, 35, 45, 55, 65, 75, 85, 95].every((p) => M.feePerContract(p / 100, 100, k) <= M.feePerContract(0.5, 100, k) + 1e-12));
  check("a fee model that is not Kalshi's teaches nothing about Kalshi's schedule", H.hallLiteFrom({ board: { ...board0, feeModel: "rh-rothera" }, nowMs: NOW }).fee.takerPct === 0);
  const dur = (ms) => H.spanOf(ms);
  check("spans follow the engine's cut-offs: minutes under an hour, hours under two days, then days", JSON.stringify([dur(90_000), dur(60_000), dur(35 * 60_000), dur(3.5 * 3600_000), dur(20 * 3600_000), dur(72 * 3600_000), dur(0), dur(null)]) === JSON.stringify([{ n: 2, unit: "minutes" }, { n: 1, unit: "minute" }, { n: 35, unit: "minutes" }, { n: 3.5, unit: "hours" }, { n: 20, unit: "hours" }, { n: 3, unit: "days" }, null, null]), JSON.stringify([dur(90_000), dur(3.5 * 3600_000)]));
  check("the rules the lectern states are read from the code that enforces them", lite.rules.modelMaxMin === E.MAX_MODEL_AGE_MS / 60_000 && lite.rules.staleSec === 60 && lite.rules.minDepth === 100 && lite.rules.maxSpreadC === 3 && lite.rules.velWindowH === E.VELOCITY_WINDOW_MS / 3_600_000 && lite.rules.minSettled === 30);
  const mood = (o) => {
    const hl = X.hallAt(NOW, o);
    const layout = E.hallLayout(X.boardAt(POLL, o));
    return { lite: hl.crowd.reaction, engine: SF.reactionForCrowd(layout.crowd), mood: hl.crowd.mood };
  };
  const cases = [
    ["no candle reads", {}],
    ["a slow climb", { drift: 4 }],
    ["a fast climb", { drift: 7 }],
    ["a slide", { drift: -4 }],
    ["both sides moving opposite ways", { drift: 5, both: true }],
  ];
  for (const [name, o] of cases) {
    const r = mood(o);
    check(`crowd reaction equals the Mead feed's reactionForCrowd — ${name} (${r.mood} → ${r.engine})`, r.lite === r.engine, JSON.stringify(r));
  }
  check("only real velocity moves the crowd: the cases give null, cheer, hail, groan, null", JSON.stringify(cases.map(([, o]) => mood(o).lite)) === JSON.stringify([null, "cheer", "hail", "groan", null]), JSON.stringify(cases.map(([, o]) => mood(o).lite)));
  const fast = X.hallAt(NOW, { drift: 7 });
  const mover = VM.moverOf(fast);
  check("the mover is the row with the fastest real velocity, and every market with a velocity is on the hall's six", mover && mover.velCph === Math.max(...fast.rows.filter((r) => r.velCph != null).map((r) => r.velCph)) && X.boardAt(POLL, { drift: 7 }).signals.filter((s) => s.move.velocityCentsPerHour != null).every((s) => fast.rows.some((r) => r.id === s.id)));
}

console.log("Age: a stale read is stale, an old read is old");
{
  const b = board0;
  const at = (sec, o = {}) => H.hallLiteFrom({ board: b, nowMs: Date.parse(b.asOf) + sec * 1000, ...o });
  check("under the engine's sixty seconds it is fresh", at(30).stale === false && at(30).old === false && at(30).rows[0].conds.fresh);
  check("past sixty seconds it is stale (the engine's own rule), and no longer a fresh quote", at(75).stale === true && at(75).old === false && !at(75).rows[0].conds.fresh);
  check("past twenty minutes it is old: not talked from at all", at(21 * 60).old === true && at(19 * 60).old === false);
  check("a pull that failed is carried as held", at(30, { held: true }).held === true);
  check("a deadline-cut read says it is partial", H.hallLiteFrom({ board: { ...b, deadlineExceeded: true, skipped: ["KXNBAGAME", "KXNHLGAME"] }, nowMs: NOW }).partial === true && H.hallLiteFrom({ board: { ...b, deadlineExceeded: true, skipped: ["KXNBAGAME", "KXNHLGAME"] }, nowMs: NOW }).skipped === 2);
  check("scanner rows older than the engine's model window are ignored", at(30, { scan: X.scanRows(), scanAsOf: iso(Date.parse(b.asOf)) }).rows.some((r) => r.scan) && !at(16 * 60, { scan: X.scanRows(), scanAsOf: iso(Date.parse(b.asOf)) }).rows.some((r) => r.scan));
  check("an empty board is an empty Lite with the engine's reason, not a crash", (() => {
    const e = E.buildSignalBoard({ raw: [], asOf: b.asOf }, { now: Date.parse(b.asOf) + 1000 });
    const l = H.hallLiteFrom({ board: e, nowMs: Date.parse(b.asOf) + 1000 });
    return l.rows.length === 0 && l.total === 0 && /No priced Kalshi markets/.test(l.reason ?? "");
  })());
}

console.log("The study pass's rows (the defects the Floor had)");
{
  const p = H.predictLiteFromBoard(boardNo, NOW);
  check("no model, no letter: the study rows carry null, never a constant D", p.rows.length === 6 && p.rows.every((r) => r.grade === null), JSON.stringify(p.rows.map((r) => r.grade)));
  check("the study rows name the event in words, never as a Kalshi ticker", p.rows.every((r) => !RAW_TICKER.test(r.event) && !RAW_TICKER.test(r.outcome)), JSON.stringify(p.rows.map((r) => r.event)));
  const pm = H.predictLiteFromBoard(board0, NOW);
  check("with a model the study rows carry the engine's letter", pm.rows.some((r) => r.grade != null) && pm.rows.filter((r) => r.grade).every((r) => "ABCDF".includes(r.grade)));
  const old = OS.toPredictLite({ asOf: iso(NOW), label: "Kalshi", markets: [{ event: "KXNFLGAME-26OCT05MINDET", outcome: "Minnesota", yesPrice: 0.56, setupGrade: null }, { event: "KXGDP-26Q3", outcome: "Yes", yesPrice: 0.64, setupGrade: null }] });
  check("the raw-feed path (toPredictLite) now says the event in words too", old.rows[0].event === "NFL game on October 5" && old.rows[1].event === "GDP for the third quarter of 2026", JSON.stringify(old.rows.map((r) => r.event)));
  const pack = (predict, nowMs) => OS.studyPack({ weekend: true, etDate: "2026-10-10", etMin: 14 * 60, nowMs, news: [], invest: null, predict });
  check("a fresh read is studied", pack(pm, NOW + 60_000).predicts.length === 3);
  const stale = pack(pm, NOW + 25 * 60_000);
  check("a read older than the hall's talk limit is not studied: it is said to be old", stale.predicts.length === 0 && /minutes old/.test(stale.predictWhy ?? ""), String(stale.predictWhy));
  check("…and a pack built without a clock (older callers) is unchanged", pack(pm, undefined).predicts.length === 3);
  const mk = (predict) => {
    const f = new LT.Facts();
    const ex = IV.exStudyPredict({ st: freshTalkState(), f, key: "study", now: NOW }, pack(predict, NOW + 60_000));
    return ex ? { lines: ex.lines, facts: f.list } : null;
  };
  for (const [name, pr] of [["with a model", pm], ["with none", p]]) {
    const ex = mk(pr);
    const sp = ex ? spokenProblems(ex.lines) : ["no exchange"];
    check(`exStudyPredict (${name}) is speakable, has no raw ticker, no constant grade and registers its digits`, ex && sp.length === 0 && ex.lines.every((l) => !RAW_TICKER.test(l.text) && !PLACEHOLDER.test(l.text)) && ex.lines.every((l) => (l.text.match(/\d[\d,]*\.?\d*/g) ?? []).every((x) => ex.facts.includes(x.replace(/[.,]+$/, "")))), sp.slice(0, 2).join(" || "));
  }
  check("with no model the study line says so instead of a letter", /no edge read, so no grade/.test(mk(p).lines.map((l) => l.text).join(" ")) && !LETTER.test(mk(p).lines.map((l) => l.text).join(" ")));
  const news = { id: "n1", title: "ON Semiconductor shares jump", source: "Wire", publishedMs: 1, tier: 2, why: "", impact: null, tickers: ["ON"], topics: [], primary: false };
  check("a ticker symbol written in capitals links; a lower-case word never does (\"on October 5\" is not ON)", OS.linkScore("NFL game on October 5", "Minnesota", news) < 2 && OS.linkScore("ON Semiconductor tops", "Yes", news) >= 3);
  check("dates and report words are not subjects", OS.linkScore("GDP for the third quarter of 2026", "at least 2.0 percent", { ...news, title: "The third quarter report arrives in October", tickers: [] }) < 2);
}

console.log("The store");
{
  ST.resetHall();
  check("empty store: no board, no Lite", ST.getHall().board === null && ST.hallLiteNow(NOW) === null);
  let seen = 0;
  const off = ST.subscribeHall(() => seen++);
  ST.setHall({ board: board0, status: "live", scan: X.scanRows(), scanAsOf: iso(POLL), record: X.recordLite("small") });
  check("a board in, a Lite out, listeners told", ST.getHall().board === board0 && ST.hallLiteNow(NOW)?.rows.length === 6 && seen === 1);
  check("the Lite is aged to the moment it is asked", ST.hallLiteNow(POLL + 30_000).ageSec === Math.round((POLL + 30_000 - Date.parse(board0.asOf)) / 1000));
  ST.setHall({ status: "live", held: true, error: "x" });
  check("a write with some fields keeps the rest (the board, the scanner's rows, the record)", ST.getHall().board === board0 && ST.getHall().scan?.length === 2 && ST.getHall().record != null && ST.hallLiteNow(NOW).held === true);
  ST.setHall({ board: null, status: "loading" });
  check("a feed that has read nothing yet (a null board) never wipes the board that is held", ST.getHall().board === board0 && ST.getHall().status === "loading");
  ST.setHall({ status: "live" });
  const older = X.boardAt(POLL - X.POLL_MS, {});
  ST.setHall({ board: older });
  check("a board older than the one held is refused (two feeds never move the hall backwards)", ST.getHall().board === board0);
  const newer = X.boardAt(POLL + X.POLL_MS, {});
  ST.setHall({ board: newer, held: false });
  check("a newer one is taken", ST.getHall().board === newer && ST.hallLiteNow(POLL + X.POLL_MS + 5000).held === false);
  const cached = ST.hallLiteNow(POLL + X.POLL_MS + 5000);
  check("repeated looks in the same ten seconds cost one build", ST.hallLiteNow(POLL + X.POLL_MS + 6000) === cached);
  const seenAtOff = seen;
  off();
  ST.setHall({ status: "error" });
  check("an unsubscribed listener is not called again", seen === seenAtOff && seenAtOff >= 4, `${seen} vs ${seenAtOff}`);
  ST.resetHall();
  check("reset clears it", ST.getHall().board === null);
  const engineSrc = fs.readFileSync("src/components/room/room-engine.ts", "utf8");
  const worldSrc = fs.readFileSync("src/lib/room/live-world.ts", "utf8");
  check("the room engine pulls into this store and follows it (the study rows), and worldFromDesk builds the talk's Lite from it (wired, not just written)", /subscribeHall/.test(engineSrc) && /pullHall/.test(engineSrc) && /predictLiteFromBoard/.test(engineSrc) && /hallLiteNow\(nowMs\)/.test(worldSrc) && /hall\?: HallLite/.test(worldSrc));
  const poll = fs.readFileSync("src/components/room/room-engine.ts", "utf8");
  check("the background poll still never runs while the cash session is open, and is still one pull per ten minutes", /if \(cashOpen\(\)\) return;\s*\n\s*await pullHall/.test(poll) && /pull, 10 \* 60_000/.test(poll));
  const read = fs.readFileSync("src/components/room/hall-read.ts", "utf8");
  check("the pull takes the analyzer's path: the scanner's references become the engine's models, under a time budget", /getPredictBoard/.test(read) && /modelInputsFromScanRows/.test(read) && /getPredictionSignals/.test(read) && /HALL_PULL_BUDGET_MS/.test(read));
  check("no order path anywhere in the new modules", ["src/lib/room/hall-lite.ts", "src/lib/room/hall-store.ts", "src/components/room/hall-read.ts", "src/lib/room/live-voices-mead.ts"].every((p) => !/place_?order|review_option_order|submitOrder|alpaca|robinhood-mcp|rh-mcp|rh-http/i.test(fs.readFileSync(p, "utf8").replace(/Robinhood/g, ""))));
}

console.log("The pull: the analyzer's path, run on fixtures, with no network");
{
  const HR = await import("../src/components/room/hall-read.ts");
  const calls = { board: 0, signals: 0, models: [] };
  const deps = (over = {}) => ({
    board: async () => {
      calls.board++;
      return X.predictBoardAt(POLL);
    },
    signals: async (models) => {
      calls.signals++;
      calls.models.push(models);
      return X.signalsAt(POLL, models);
    },
    ...over,
  });
  const fresh = async (run) => {
    ST.resetHall();
    HR.resetHallGaps();
    calls.board = calls.signals = 0;
    calls.models = [];
    await run();
  };
  await fresh(async () => {
    await HR.pullHall(() => true, { deps: deps() });
    const s = ST.getHall();
    const m = calls.models[0];
    const sc = X.scanRows();
    check("a healthy pull fills the store: a live board, the scanner's rows, the paper record, nothing held", s.status === "live" && s.held === false && s.board?.signals.length === 9 && s.scan?.length === 2 && s.record != null && s.error === null);
    check("it costs one read of each source per pull (the Predict board, then the signal board)", calls.board === 1 && calls.signals === 1);
    check("the models sent to the engine are the scanner's conservative references, by Kalshi ticker, named for their source", Object.keys(m).length === 2 && sc.every((r) => m[r.key] && m[r.key].prob === r.fairLo && /DraftKings|ESPN/.test(m[r.key].source)), JSON.stringify(m));
    check("so the football rows are graded and the other seven say no edge read", s.board.noEdgeCount === 7 && s.board.signals.filter((x) => x.grade != null).length === 2);
    const l = ST.hallLiteNow(POLL + 20_000);
    check("and the talk's Lite carries the scanner's layers for them (the missing layer and the limit price)", l.rows.some((r) => r.scan && r.scan.total === 8 && r.scan.limitC != null), JSON.stringify(l.rows.map((r) => r.scan)));
  });
  await fresh(async () => {
    await HR.pullHall(() => true, { deps: deps({ board: async () => { calls.board++; throw new Error("espn down"); } }) });
    const s = ST.getHall();
    check("with the scanner's sources down the signal board is still read, with no models, and every row says no edge read", s.status === "live" && Object.keys(calls.models[0]).length === 0 && s.board.noEdgeCount === 9 && s.board.signals.every((x) => x.grade === null) && s.scan === null);
  });
  await fresh(async () => {
    await HR.pullHall(() => true, { deps: deps() });
    const kept = ST.getHall().board;
    await HR.pullHall(() => true, { deps: deps({ signals: async () => { throw new Error("kalshi 429"); } }) });
    const s = ST.getHall();
    check("a failed pull keeps the last board and says it failed (held, with the reason)", s.board === kept && s.held === true && /429/.test(s.error ?? ""));
    await HR.pullHall(() => true, { deps: deps({ signals: async () => X.signalsAt(POLL, {}) }) });
    check("the next good pull clears the hold", ST.getHall().held === false && ST.getHall().error === null);
  });
  await fresh(async () => {
    await HR.pullHall(() => true, { deps: deps({ signals: async () => { throw new Error("kalshi 500"); } }) });
    const s = ST.getHall();
    check("a failed pull with nothing held is an error, not a mock board", s.status === "error" && s.board === null && /500/.test(s.error ?? ""));
  });
  await fresh(async () => {
    await HR.pullHall(() => true, { deps: deps() });
    const kept = ST.getHall().board;
    const t0 = Date.now();
    await HR.pullHall(() => true, { budgetMs: 60, deps: deps({ signals: () => new Promise(() => {}) }) });
    const s = ST.getHall();
    check("a pull that runs out of time is abandoned (the budget), the last board held, and the caller is not kept waiting", Date.now() - t0 < 1500 && s.held === true && /ran out of time/.test(s.error ?? "") && s.board === kept, `${Date.now() - t0} ms`);
  });
  await fresh(async () => {
    await HR.pullHall(() => false, { deps: deps() });
    check("a pull that finishes after its owner went away writes nothing", ST.getHall().board === null && ST.getHall().status === "idle");
  });
  await fresh(async () => {
    await HR.pullHall(() => true, { deps: deps({ signals: async () => E.buildSignalBoard({ raw: [], asOf: iso(POLL) }, { now: POLL }) }) });
    const s = ST.getHall();
    check("an empty signal board is 'empty' with the engine's reason, never a mock", s.status === "empty" && s.board === null && /No priced Kalshi markets/.test(s.error ?? ""));
  });
  await fresh(async () => {
    const board = await HR.loadHallBoard(deps());
    check("loadHallBoard (what the Floor tab's own feed should call) returns the graded board and files the scanner's rows beside it", board.signals.length === 9 && ST.getHall().scan?.length === 2 && ST.getHall().board === null);
  });
  ST.resetHall();
}

console.log("The record (go ledger, journal, paper book)");
{
  const rec = X.recordLite("small");
  check("the go ledger's counts are goStats, the minimum is the engine's own thirty", rec.goN === 3 && rec.goSettled === 2 && rec.goWins === 1 && rec.minSettled === 30 && rec.paperRead === "too few to read" && rec.paperHitPct === null, JSON.stringify(rec));
  const h = X.hallAt(NOW, { record: rec });
  const items = buildAll(VM.exHallRecord, h);
  const ledger = (it) => it.lines.find((l) => l.character === "Nova")?.text ?? "";
  check("under thirty settled EVERY wording of the ledger line calls it noise, and the paper book is too few to read", items.length > 0 && items.every((it) => /noise/i.test(ledger(it)) && /too few to read/i.test(it.lines.map((l) => l.text).join(" "))), items.map(ledger).join(" | "));
  const big = { ...rec, goN: 40, goSettled: 35, goWins: 20, goNet: 1.25, paperRead: "ok", paperHitPct: 52, paperSettled: 33, paperTickets: 40 };
  const items2 = buildAll(VM.exHallRecord, X.hallAt(NOW, { record: big }));
  check("at thirty-five settled no wording calls it noise, and the scorer is quoted", items2.length > 0 && items2.every((it) => !/noise/i.test(it.lines.map((l) => l.text).join(" ")) && /52 percent/.test(it.lines.map((l) => l.text).join(" "))), items2.map(ledger).join(" | "));
  check("an empty record is said to be empty (nothing recorded, nothing tested)", /empty|nothing/.test(build(VM.exHallRecord, X.hallAt(NOW, { record: X.recordLite("empty") })).lines.map((l) => l.text).join(" ")));
  check("without a record in the world there is no record talk", VM.meadBeats(W.mkWorld(NOW, { hall: X.hallAt(NOW, { record: null }) }), freshTalkState()).every((b) => b.id !== "hall:record"));
}

console.log("Where people stand");
{
  const spots = Object.values(AG.ACTIVITY_SPOTS).flat();
  check("every lounge/hall activity spot exists in the plan", spots.every((s) => LAYOUT.spots[s]), spots.filter((s) => !LAYOUT.spots[s]).join());
  check("study and mead use the hall's spots (the old lounge corner is gone)", AG.ACTIVITY_SPOTS.study.every((s) => HALL_IDS.has(s)) && AG.ACTIVITY_SPOTS.mead.every((s) => HALL_IDS.has(s)));
  check("study sits at the Long Table or stands at the Rune Board; mead is the bar, the jumbotron, the pool, the hearth and the chat corner", AG.ACTIVITY_SPOTS.study.every((s) => /^mead_(long_|board)/.test(s)) && ["mead_bar_0", "mead_jumbo_0", "mead_pool_0", "mead_hearth_0", "mead_chat_0"].every((s) => AG.ACTIVITY_SPOTS.mead.includes(s)));
  const crew = ["Gemma", "Jax", "Nova", "Sterling", "Vince"];
  for (const act of ["study", "mead"]) {
    const pools = crew.map((w) => AG.HALL_HABITS[w][act]);
    const flat = pools.flat();
    check(`each person's ${act} corner exists, and no two people share one`, flat.every((s) => HALL_IDS.has(s) && LAYOUT.spots[s]) && new Set(flat).size === flat.length, flat.join());
  }
  check("hallSpotOf names the hall spot of a study or mead act, for any of the five, and nothing else", AG.hallSpotOf({ act: "mead", spot: "mead_tap" }) === "mead_tap" && AG.hallSpotOf({ act: "study", spot: "mead_long_n0" }) === "mead_long_n0" && AG.hallSpotOf({ act: "coffee", spot: "coffee" }) === null && AG.hallSpotOf({ act: "desk", spot: null }) === null && AG.hallSpotOf({ act: "mead", spot: "bar_1" }) === null);
  const src = ["src/lib/room/agents.ts", "src/lib/room/live-voices.ts", "src/lib/room/live-voices-invest.ts", "src/lib/room/live-talk.ts", "src/lib/room/live-voices-mead.ts"].map((p) => fs.readFileSync(p, "utf8")).join("\n");
  check("nothing in the talk or the people still names a spot the plan no longer has (study_0, study_1, mead_0, mead_1, mead_2)", !/\b(study_[01]|mead_[012])\b/.test(src));
  check("every scene the voices use puts five distinct people on five distinct, real hall spots", Object.entries(VM.HALL_SCENES).every(([, sc]) => new Set(Object.values(sc).map((m) => m.spot)).size === 5 && Object.values(sc).every((m) => m.zone === "HALL" && HALL_IDS.has(m.spot) && LAYOUT.spots[m.spot])));
  check("the closed room studies seated at the Long Table", Object.values(VM.HALL_STUDY_MOVES).every((m) => /^mead_long_/.test(m.spot)) && IV.exStudyInvest);
}

/* ── Every exchange, on every market the fixture can put on the jumbotron ─ */

console.log("Every exchange, every market, every line");
const BUILDERS = [
  ["board", VM.exHallBoard],
  ["fee", VM.exHallFee],
  ["no model", VM.exHallNoModel],
  ["model", VM.exHallModel],
  ["bins", VM.exHallBins],
  ["clock", VM.exHallClock],
  ["record", VM.exHallRecord],
  ["lectern", VM.exHallLectern],
];
const ALL_LINES = [];
{
  // One Lite per market: that market alone on the board (so it is the jumbotron), with and without a model, aged a little.
  const raws = X.FIXTURE.markets;
  let built = 0;
  const problems = [];
  const tickets = X.scanRows();
  for (const withModel of [false, true]) {
    for (const raw of raws) {
      const rawAt = X.rawAt(POLL).find((m) => m.ticker === raw.ticker);
      const models = withModel ? E.modelInputsFromScanRows(tickets, iso(POLL)) : {};
      const b = E.buildSignalBoard({ raw: [rawAt], asOf: iso(POLL) }, { now: POLL + 3000, models });
      if (!b.signals.length) continue;
      const h = H.hallLiteFrom({ board: b, nowMs: POLL + 45_000, scan: withModel ? tickets : null, scanAsOf: iso(POLL), record: X.recordLite("small") });
      for (const [name, fn] of BUILDERS) {
        for (const item of buildAll(fn, h)) {
          built++;
          ALL_LINES.push(...item.lines);
          for (const p of itemProblems(item, h, { allowLetters: withModel })) problems.push(`${name} on ${raw.ticker}${withModel ? " (model)" : ""}: ${p}`);
        }
      }
    }
  }
  check(`${built} exchanges built from single markets (9 markets, with and without a model, under ${KEYS} word-choice keys each) are clean: sourced, speakable, no pick, no verdict, legal`, built >= 1000 && problems.length === 0, problems.slice(0, 3).join(" || "));
  // The crowd and the news need their data.
  for (const [name, o, want] of [["surging (cheer)", { drift: 4 }, "cheer"], ["surging (hail)", { drift: 7 }, "hail"], ["sliding (groan)", { drift: -4 }, "groan"]]) {
    const h = X.hallAt(NOW, o);
    const items = buildAll(VM.exHallCrowd, h);
    for (const it of items) ALL_LINES.push(...it.lines);
    const bad = items.length ? items.flatMap((it) => itemProblems(it, h)) : ["no exchange"];
    check(`the crowd ${name}: clean under every word choice, and Jax reacts in kind`, h.crowd.reaction === want && bad.length === 0 && items.every((it) => it.lines.some((l) => l.character === "Jax")), bad.slice(0, 2).join(" || "));
  }
  check("a quiet crowd, or one with no real velocity, does not react", build(VM.exHallCrowd, X.hallAt(NOW, {})) === null && build(VM.exHallCrowd, X.hallAt(NOW, { drift: 5, both: true })) === null);
  const news = { id: "n1", title: "Minnesota quarterback questionable for Sunday night", source: "ESPN", publishedMs: NOW - 600_000, tier: 2, why: "", impact: "Predict: MIN/DET injury or lineup news - recheck the scanner", tickers: [], topics: ["nfl"], primary: false };
  const hn = X.hallAt(NOW, {});
  const link = VM.bestNewsLink(hn, [news], NOW);
  check("a headline that shares a real subject word with a market links to it (Minnesota)", link && link.row.outcome === "Minnesota", JSON.stringify(link?.row.outcome));
  check("a generic headline links to nothing", VM.bestNewsLink(hn, [{ ...news, id: "n2", title: "The market was higher today and prices rose" }], NOW) === null);
  check("a headline more than a day old, or with no time, is not news", VM.bestNewsLink(hn, [{ ...news, publishedMs: NOW - 25 * 3_600_000 }], NOW) === null && VM.bestNewsLink(hn, [{ ...news, publishedMs: null }], NOW) === null);
  check("a team code in the impact string is never read as a subject", VM.bestNewsLink(hn, [{ ...news, id: "n3", title: "Lineup news", impact: "Predict: MIN/DET injury" }], NOW) === null);
  const nitems = buildAll(VM.exHallNews, hn, link);
  for (const it of nitems) ALL_LINES.push(...it.lines);
  const nbad = nitems.flatMap((it) => itemProblems(it, hn, { extra: [news.title, news.source] }));
  check("the headline exchange is clean under every word choice, quotes the headline, and says a headline is not a side", nitems.length > 0 && nbad.length === 0 && nitems.every((it) => it.lines.some((l) => /headline is not a side/i.test(l.text)) && it.lines.some((l) => l.text.includes("Minnesota quarterback"))), nbad.slice(0, 2).join(" || "));
  const mitems = buildAll(VM.exMead, hn);
  const mitem = mitems[0];
  for (const it of mitems) ALL_LINES.push(...it.lines);
  check("the games-on line now speaks about an actual market (under every word choice), and the old rules line stays when there is no board", mitems.length > 0 && mitems.every((it) => itemProblems(it, hn).length === 0) && /56¢/.test(mitem.lines.map((l) => l.text).join(" ")) && /October 5, Minnesota/.test(mitem.lines.map((l) => l.text).join(" ")) && (() => {
    const f = new LT.Facts();
    const plain = VM.exMead({ st: freshTalkState(), f, key: "m", now: NOW }, null);
    return plain && plain.lines.length >= 2 && !/\d/.test(plain.lines.map((l) => l.text).join(" "));
  })());
}

console.log("What each line says is the engine's number for that market");
{
  const s0 = E.hallLayout(board0).jumbotron;
  const h = X.hallAt(NOW, {});
  const text = (item) => item.lines.map((l) => l.text).join(" ");
  const yes = Math.round(s0.prices.yesAsk * 100);
  const no = Math.round(s0.prices.noAsk * 100);
  const needs = (s0.implied.feeAdjustedYes * 100).toFixed(1);
  const mid = Number((s0.implied.mid * 100).toFixed(1));
  const board = text(build(VM.exHallBoard, h));
  check("board: yes ask, no ask, spread and depth are the book's", new RegExp(`yes asks ${yes}¢`).test(board) && new RegExp(`no asks ${no}¢`).test(board) && new RegExp(`spread ${s0.spread.cents}¢`).test(board) && new RegExp(`${Math.round(s0.liquidity.askSize)} contracts at the ask`).test(board), board);
  check("board: mid, what yes must clear after fees, and the cost between them are the engine's", board.includes(`Mid is ${mid} percent`) || board.includes(`own number is ${mid} percent`) ? board.includes(needs) && board.includes(String(Number((Number(needs) - mid).toFixed(1)))) : false, board);
  check("board: no letter on a market with no model", !LETTER.test(board.replace(/engine's letter/g, "")) || s0.grade != null);
  const fee = text(build(VM.exHallFee, h));
  check("fee: the featured ask's own fee, the rates and the curve are the engine's", fee.includes(`${(s0.implied.feeYes * 100).toFixed(2).replace(/0$/, "")}¢`) && fee.includes("7%") && fee.includes(`${M.VENUES.kalshi.perSide(0.5, 100) }`.replace(/^/, "") ? "1.75¢" : "x"), fee);
  const model = text(build(VM.exHallModel, h));
  const sm = board0.signals.find((s) => s.edge.status === "edge");
  const sc = X.scanRows().find((r) => r.key === sm.id);
  check("model: the model's chance, what it must clear, and the gap are the engine's", model.includes(String(Number((sm.edge.side === "yes" ? sm.edge.modelProb : 1 - sm.edge.modelProb) * 100).toFixed(1))) && model.includes(String(Number(((sm.edge.side === "yes" ? sm.implied.feeAdjustedYes : sm.implied.feeAdjustedNo) * 100).toFixed(1)))), model);
  check("model: the scanner's layer count, the layer that fails and its limit price are the scanner's own", model.includes(`${sc.layers.filter((l) => l.ok).length} `) && model.includes(`${Math.round(sc.limit * 100)}¢`) && model.includes(`${Math.round(sc.ask * 100)}¢`) && /the price/i.test(model), model);
  const none = text(build(VM.exHallNoModel, h));
  check("no model: it says no edge read, that Kalshi's own price is not a model, and the count is the board's", /no edge read/.test(none) && /Kalshi's (own )?price/.test(none) && none.includes(`${board0.noEdgeCount} of ${board0.signals.length}`), none);
  const bins = text(build(VM.exHallBins, h));
  check("bins: the band, the points and the source are the evidence module's", bins.includes("40 to 60¢") && bins.includes("Bürgi") && bins.includes("2025") && bins.includes(`${Math.round(-E.MAKER_TAKER.takerPostFee * 100)} percent`), bins);
  const cheap = X.hallAt(NOW, {});
  check("a cheap contract is docked, capped, and Jax says what a longshot pays", (() => {
    const c = E.buildSignalBoard({ raw: [X.rawAt(POLL).find((m) => m.ticker === "KXBTCD-26OCT06-B100000")], asOf: iso(POLL) }, { now: POLL + 3000 });
    const hc = H.hallLiteFrom({ board: c, nowMs: POLL + 30_000 });
    const t2 = text(build(VM.exHallBins, hc));
    return /12 points/.test(t2) && /(caps the letter at C|cannot pass C)/.test(t2) && /longshot pays big|Cheap ones pay/.test(t2) && /10 to 20¢/.test(t2);
  })());
  const lect = text(build(VM.exHallLectern, h));
  check("lectern: the four conditions as conditions, with the code's own limits, and not a prediction", /four things hold|Four conditions/.test(lect) && lect.includes("15 minutes") && lect.includes("60 seconds") && lect.includes("100 contracts") && lect.includes("3¢") && /not a (forecast|prediction)/.test(lect), lect);
  const clock = text(build(VM.exHallClock, h));
  check("clock: what settles next, and how old the read is, from the engine", /settles first, in 4 hours|nearest settlement is .*4 hours/.test(clock) && /stale|history|old|fresh|live/.test(clock), clock);
}

console.log("Mutants: each is caught by the checker that guards the real lines");
{
  const h = X.hallAt(NOW, {});
  const base = build(VM.exHallBoard, h);
  check("the unmutated exchange is clean (so a catch below is the mutant's doing)", itemProblems(base, h).length === 0, itemProblems(base, h).join(" || "));
  const mutate = (fn) => {
    const item = JSON.parse(JSON.stringify(base));
    fn(item);
    return item;
  };
  const caught = (name, item, re, hh = h, opts) => {
    const p = itemProblems(item, hh, opts).join(" | ");
    check(`mutant — ${name}`, re.test(p), p || "not caught");
  };
  caught("a moved number (yes asks 57¢ where the book says 56¢)", mutate((i) => { i.lines[0].text = i.lines[0].text.replace("56¢", "57¢"); }), /57 is not in the engine's fields|57 was not registered/);
  const s0 = E.hallLayout(board0).jumbotron;
  check("the unmutated board exchange passes the differential against the engine's own signal", boardExpectations(base, s0).length === 0, boardExpectations(base, s0).join(" | "));
  const swapped = mutate((i) => { i.lines[0].text = i.lines[0].text.replace("yes asks 56¢", "yes asks 46¢").replace("no asks 46¢", "no asks 56¢"); });
  check("mutant — a swapped side (the no ask said as the yes ask): every number is a real one, so only the differential against the engine's signal catches it", itemProblems(swapped, h).length === 0 && boardExpectations(swapped, s0).length >= 2, boardExpectations(swapped, s0).join(" | "));
  caught("a pick (an instruction to back a side)", mutate((i) => { i.lines[3].text = "I would bet on Minnesota tonight."; }), /a pick in/);
  caught("a pick (will win)", mutate((i) => { i.lines[3].text = "Minnesota will win this one."; }), /a pick in/);
  caught("a raw Kalshi ticker spoken", mutate((i) => { i.lines[0].text = "Jumbotron has KXNFLGAME-26OCT05MINDET-MIN."; }), /raw Kalshi ticker/);
  caught("a placeholder grade (scanner grade D)", mutate((i) => { i.lines[4].text = "The scanner grade D says it all."; }), /placeholder grade/);
  caught("a letter said where the engine gave none", mutate((i) => { i.lines[4].text = "The engine's grade is B."; }), /letter grade said where the engine gave none/, X.hallAt(NOW, { models: false }), { allowLetters: false });
  caught("a desk verdict word", mutate((i) => { i.lines[4].text = "STAND."; }), /desk verdict word/);
  caught("advice language", mutate((i) => { i.lines[4].text = "We recommend the favorite."; }), /advice language/);
  caught("an order word in an animation", mutate((i) => { i.lines[2].animation = "SMASHING_ENTER_KEY"; }), /cannot SMASHING_ENTER_KEY|send an order/);
  caught("a forty-fourth word", mutate((i) => { i.lines[4].text = Array(44).fill("word").join(" "); }), /44 words/);
  caught("a digit typed into a phrase (not registered by code)", mutate((i) => { i.facts = i.facts.filter((x) => x !== "410"); }), /410 was not registered/);
  caught("two people on one spot", mutate((i) => { i.moves.Jax = i.moves.Vince; }), /share mead_jumbo_0/);
  caught("a spot that is not a hall spot", mutate((i) => { i.moves.Jax = { zone: "HALL", spot: "mead_9" }; }), /not a hall spot|not in the plan/);
  caught("the wrong zone for a hall spot", mutate((i) => { i.moves.Jax = { zone: "WATERCOOLER", spot: "mead_tap" }; }), /not WATERCOOLER|HALL zone/);
  caught("a number that is not speakable as written (56 cents typed, not 56¢)", mutate((i) => { i.lines[0].text = i.lines[0].text.replace("56¢", "56 cents"); }), /not speakable.*number moved/);
  // A stale read said as live: the same builder on an old Lite, and the scheduler must never offer it.
  const oldH = X.hallAt(NOW, {});
  const stale = { ...oldH, ageSec: 25 * 60, old: true, stale: true };
  const asLive = build(VM.exHallBoard, stale);
  check("mutant — a stale read said as live: the age rule flags a board exchange built from an old read, and lets the clock's own 'it is old' through", asLive.lines.length > 0 && ageProblems({ ...asLive, topic: "hb:hall:board" }, stale).length === 1 && ageProblems({ ...asLive, topic: "hb:hall:clock" }, stale).length === 0 && ageProblems({ ...asLive, topic: "hb:hall:board" }, h).length === 0);
  const beats = VM.meadBeats(W.mkWorld(NOW, { hall: stale }), freshTalkState());
  check("…and the scheduler offers an old read exactly one thing: that it is old", beats.length === 1 && beats[0].id === "hall:clock");
  const clockOld = build(VM.exHallClock, stale);
  check("that one thing says it is stale and says nothing priced", itemProblems(clockOld, stale).length === 0 && /stale|history|old/.test(clockOld.lines.map((l) => l.text).join(" ")) && !/yes asks|no asks|settles/.test(clockOld.lines.map((l) => l.text).join(" ")), clockOld.lines.map((l) => l.text).join(" | "));
  // The checker itself, on the corpus of every real line: it must have flagged nothing.
  const flagged = ALL_LINES.filter((l) => VERDICT.test(l.text) || ADVICE.test(l.text) || PICK.test(l.text) || RAW_TICKER.test(l.text) || PLACEHOLDER.test(l.text));
  check(`the whole corpus (${ALL_LINES.length} lines said by the single-market and special builds) trips none of the word checks`, flagged.length === 0, flagged.slice(0, 2).map((l) => l.text).join(" || "));
}

/* ── Simulated days ────────────────────────────────────────────────────── */

const topicsOf = (sim) => [...new Set(sim.items.map((i) => i.topic))];
const HALL_TOPIC = /^(hb:hall:|hall:crowd|hb:mead$)/;
const NEWS = { id: "n1", title: "Minnesota quarterback questionable for Sunday night", source: "ESPN", publishedMs: at(2026, 10, 10, 11, 0), tier: 2, why: "", impact: null, tickers: [], topics: ["nfl"], primary: false };
function at(y, mo, d, h, mi, s = 0) {
  return W.at(y, mo, d, h, mi, s);
}

console.log("A simulated Saturday (games on, the hall polled every ten minutes, a surge, a headline)");
let SAT;
{
  SAT = new W.Sim(at(2026, 10, 10, 12, 0), { dt: 5000, hallOpts: { drift: 4 }, news: [NEWS] });
  SAT.run(8 * 3600);
  const topics = topicsOf(SAT);
  const hallTopics = topics.filter((t) => HALL_TOPIC.test(t));
  for (const want of ["hb:hall:board", "hb:hall:fee", "hb:hall:model", "hb:hall:nomodel", "hb:hall:bins", "hb:hall:clock", "hb:hall:lectern", "hb:hall:record", "hb:hall:news", "hall:crowd", "hb:mead", "hb:study:predict"])
    check(`the room talks about ${want.replace(/^hb:/, "")}`, topics.includes(want), JSON.stringify(topics.filter((t) => /hall|mead|study:predict/.test(t))));
  check("every hall exchange is sourced, speakable, unpicked and legal, built from the world it was said in", SAT.items.every((it, i) => !HALL_TOPIC.test(it.topic) || it.topic === "hb:mead" || (itemProblems(it, SAT.worlds[i].hall, { extra: [NEWS.title, NEWS.source] }).length === 0 && ageProblems(it, SAT.worlds[i].hall).length === 0)), (() => {
    for (let i = 0; i < SAT.items.length; i++) if (HALL_TOPIC.test(SAT.items[i].topic) && SAT.items[i].topic !== "hb:mead") { const p = itemProblems(SAT.items[i], SAT.worlds[i].hall, { extra: [NEWS.title, NEWS.source] }); if (p.length) return `${SAT.items[i].topic}: ${p[0]}`; }
    return "";
  })());
  check("everything the room said that day is speakable (the study lines too)", spokenProblems(SAT.items.flatMap((i) => i.lines)).length === 0, spokenProblems(SAT.items.flatMap((i) => i.lines)).slice(0, 2).join(" || "));
  check("a study line about the prediction book never carries a raw ticker or a constant grade", SAT.items.filter((i) => i.topic === "hb:study:predict").every((i) => i.lines.every((l) => !RAW_TICKER.test(l.text) && !PLACEHOLDER.test(l.text) && !/grade D\b/.test(l.text))));
  const stable = JSON.stringify([...LT.STABLE_HEARTBEATS].sort()) === JSON.stringify(["goalnight", "ladder", "rules"]);
  check("the stable heartbeats are exactly the three that restate the rules (none of the hall's is stable)", stable);
  const mine = SAT.items.filter((i) => HALL_TOPIC.test(i.topic) || i.topic === "hb:study:predict");
  const said = mine.flatMap((i) => i.lines.map((l) => l.text));
  const repeated = said.filter((t, k) => said.indexOf(t) !== k);
  const each = {};
  for (const i of mine) each[i.topic] = (each[i.topic] ?? 0) + 1;
  check(`they do not loop: ${mine.length} prediction and hall exchanges, ${said.length} lines, none said twice, each topic once while its data stands still (nothing new, nothing said)`, repeated.length === 0 && Object.values(each).every((k) => k === 1), JSON.stringify(each));
  const hallItems = SAT.items.filter((i) => HALL_TOPIC.test(i.topic));
  const byTopic = {};
  for (const i of hallItems) byTopic[i.topic] = (byTopic[i.topic] ?? 0) + 1;
  check("a lesson is given once a day, not on a timer (fee, bins, lectern: once each)", ["hb:hall:fee", "hb:hall:bins", "hb:hall:lectern"].every((t) => (byTopic[t] ?? 0) === 1), JSON.stringify(byTopic));
  check("the hall's own talk is not the whole evening (other topics still get their turn)", hallItems.length < SAT.items.length * 0.75 && hallItems.length >= 9, `${hallItems.length}/${SAT.items.length}`);
  check("the crowd reacts promptly and not before the jumbotron has been introduced", (() => {
    const board = SAT.items.findIndex((i) => i.topic === "hb:hall:board");
    const crowd = SAT.items.findIndex((i) => i.topic === "hall:crowd");
    return board >= 0 && crowd > board;
  })());
  check("the crowd does not repeat while the mood, the mover and its speed are unchanged", (byTopic["hall:crowd"] ?? 0) === 1, String(byTopic["hall:crowd"]));
  const used = new Set();
  for (const i of hallItems) for (const m of Object.values(i.moves)) used.add(m.spot);
  check(`the five used ${used.size} different hall spots (jumbotron, Rune Board, taps, Long Table, lectern, bar…)`, used.size >= 10 && [...used].every((s) => HALL_IDS.has(s)), [...used].join());
  check("the talk state stays small (it is cloned every tick)", JSON.stringify(SAT.st).length < 40_000, String(JSON.stringify(SAT.st).length));
  const again = new W.Sim(at(2026, 10, 10, 12, 0), { dt: 5000, hallOpts: { drift: 4 }, news: [NEWS] });
  again.run(8 * 3600);
  check("the same world gives the same words (deterministic)", JSON.stringify(again.items) === JSON.stringify(SAT.items));
  check("…and the state survives a JSON round trip", JSON.stringify(JSON.parse(JSON.stringify(SAT.st))) === JSON.stringify(SAT.st));
  check("the lines are teaching, not reciting: the mechanism comes with a worked number (the fee, the model gap, the scanner's limit)", (() => {
    const fee = SAT.items.find((i) => i.topic === "hb:hall:fee");
    const model = SAT.items.find((i) => i.topic === "hb:hall:model");
    return fee && model && /7%/.test(fee.lines.map((l) => l.text).join(" ")) && /\d+(\.\d+)?¢ a contract/.test(fee.lines.map((l) => l.text).join(" ")) && /layers/.test(model.lines.map((l) => l.text).join(" "));
  })());
  if (TRANSCRIPT) {
    const hhmm = (ms) => new Date(ms - 4 * 3600_000).toISOString().slice(11, 16);
    console.log("\n--- transcript: the Saturday, hall exchanges ---");
    for (const i of SAT.items.filter((x) => HALL_TOPIC.test(x.topic) || /study:predict/.test(x.topic))) {
      console.log(`${hhmm(i.at)} ET · ${i.topic} · ${Object.entries(i.moves).map(([w, m]) => `${w}@${m.spot}`).join(" ")}`);
      for (const l of i.lines) console.log(`    ${l.character.padEnd(8)} ${l.text}`);
    }
    console.log("--- end transcript ---\n");
  }
}

console.log("A weeknight with a faster surge, a slide and no headline");
{
  const night = new W.Sim(at(2026, 10, 12, 19, 0), { dt: 5000, hallOpts: { drift: 7 } });
  night.run(4.5 * 3600);
  const t = topicsOf(night);
  check("a roar (hail) is answered, and nothing about a headline is invented", night.items.some((i) => i.topic === "hall:crowd" && i.lines.some((l) => /Hail|roar/.test(l.text))) && !t.includes("hb:hall:news"));
  const nightBad = night.items.map((it, i) => (HALL_TOPIC.test(it.topic) && it.topic !== "hb:mead" ? [...itemProblems(it, night.worlds[i].hall), ...ageProblems(it, night.worlds[i].hall)].map((x) => `${it.topic}: ${x}`) : [])).flat();
  check("every hall exchange is clean", nightBad.length === 0, nightBad.slice(0, 2).join(" || "));
  const slide = new W.Sim(at(2026, 10, 12, 19, 0), { dt: 5000, hallOpts: { drift: -4 } });
  slide.run(2 * 3600);
  check("a slide is answered with a groan", slide.items.some((i) => i.topic === "hall:crowd" && i.lines.some((l) => /groan/.test(l.text))));
  const calm = new W.Sim(at(2026, 10, 12, 19, 0), { dt: 5000, hallOpts: {} });
  calm.run(2 * 3600);
  check("a hall with no real velocity never reacts to a crowd", !topicsOf(calm).includes("hall:crowd"));
}

console.log("The desk's morning (09:25–11:15 ET on a trading day) is left alone");
{
  const pre = new W.Sim(at(2026, 10, 13, 8, 30), { dt: 2000 });
  pre.run(55 * 60);
  const inWindow = (ms) => { const p = new Date(ms - 4 * 3600_000); const m = p.getUTCHours() * 60 + p.getUTCMinutes(); return m >= 9 * 60 + 25 && m < 11 * 60 + 15; };
  const before = pre.items.filter((i) => !inWindow(i.at) && (HALL_TOPIC.test(i.topic) || i.topic === "hb:study:predict"));
  check("precondition: before 09:25 the room does talk about the hall and the book", before.length >= 2, String(before.length));
  const inside = pre.items.filter((i) => inWindow(i.at) && (HALL_TOPIC.test(i.topic) || i.topic === "hb:study:predict"));
  check("from 09:25:00 to 09:29:59, when the options book is not yet open, none of it is said", inside.length === 0, inside.map((i) => i.topic).join());
  // The guard must be SEEN holding: a room that starts at 09:24 has not yet said anything about the book, so with no guard it
  // would speak at once. On a Saturday (no desk morning) the same room does; on a Tuesday it must not until the book opens.
  const sat924 = new W.Sim(at(2026, 10, 10, 9, 24), { dt: 2000 });
  sat924.run(6 * 60);
  const tue924 = new W.Sim(at(2026, 10, 13, 9, 24), { dt: 2000 });
  tue924.run(5 * 60 + 59);
  check("precondition: the same room, started at 09:24 on a Saturday, talks about the book within six minutes", sat924.items.some((i) => HALL_TOPIC.test(i.topic) || i.topic === "hb:study:predict"), sat924.items.map((i) => i.topic).join());
  check("started at 09:24 on a Tuesday it says nothing about the book or the hall until the options book opens at 09:30", !tue924.items.some((i) => HALL_TOPIC.test(i.topic) || i.topic === "hb:study:predict"), tue924.items.map((i) => i.topic).join());
  const am = new W.Sim(at(2026, 10, 13, 9, 20), { dt: 2000 });
  am.run(2 * 3600);
  check("and through the morning session not one hall or study-predict exchange", am.items.filter((i) => inWindow(i.at)).every((i) => !HALL_TOPIC.test(i.topic) && i.topic !== "hb:study:predict"));
  const holiday = new W.Sim(at(2026, 10, 12, 9, 20), { dt: 2000, clock: { holiday: true, optionsOpen: false } });
  holiday.run(2 * 3600);
  check("on a holiday (no desk morning) the hall is free to talk", holiday.items.some((i) => HALL_TOPIC.test(i.topic) && inWindow(i.at)));
}

console.log("Dead feeds: a stale board is said to be stale, then silence");
{
  const start = at(2026, 10, 10, 13, 0);
  const dead = new W.Sim(start, { dt: 5000, polls: start + 8 * 60_000, hallOpts: { drift: 4 } });
  dead.run(4 * 3600);
  const hallItems = dead.items.map((it, i) => ({ it, w: dead.worlds[i] })).filter(({ it }) => HALL_TOPIC.test(it.topic));
  const talkers = hallItems.filter(({ it }) => it.topic !== "hb:mead");
  check("nothing but the clock talks once the read is past the talk limit", talkers.every(({ it, w }) => ageProblems(it, w.hall).length === 0), talkers.filter(({ it, w }) => ageProblems(it, w.hall).length).map(({ it }) => it.topic).join());
  check("…and the games-on line, when it falls back to the rules, quotes no number from the old read", hallItems.filter(({ it, w }) => it.topic === "hb:mead" && w.hall.old).every(({ it }) => !/\d/.test(it.lines.map((l) => l.text).join(" "))));
  const olds = dead.items.filter((i) => i.topic === "hb:hall:clock" && i.lines.some((l) => /stale|history|old/.test(l.text)));
  check("it is said, once, that the read is old", olds.length === 1, String(olds.length));
  check("the old read is not read as today's: the study pass says it is minutes old", dead.items.some((i) => i.topic === "hb:study:predict" && i.lines.some((l) => /minutes old/.test(l.text))) || !dead.items.some((i) => i.topic === "hb:study:predict" && i.lines.some((l) => /yes asks/.test(l.text) && dead.worlds[dead.items.indexOf(i)].hall.ageSec > dead.worlds[0].hall.talkMaxSec)));
  const none = new W.Sim(start, { dt: 5000, hall: false });
  none.run(3 * 3600);
  check("with no hall in the world the room says nothing about the hall", !topicsOf(none).some((t) => HALL_TOPIC.test(t) && t !== "hb:mead"));
  check("…and the study pass says the book has not been read, without inventing a market", none.items.filter((i) => i.topic === "hb:study:predict").every((i) => i.lines.some((l) => /not been read|empty|did not answer/.test(l.text))));
  const held = new W.Sim(start, { dt: 5000, polls: start + 8 * 60_000, hallOpts: { held: true } });
  held.run(3 * 3600);
  check("a failed pull that kept the old board is said to have failed", held.items.some((i) => i.topic === "hb:hall:clock" && i.lines.some((l) => /pull failed|kept/.test(l.text))));
  const empty = new W.Sim(start, { dt: 5000, hall: () => H.hallLiteFrom({ board: E.buildSignalBoard({ raw: [], asOf: iso(start) }, { now: start }), nowMs: start }) });
  empty.run(2 * 3600);
  const emptyHall = empty.items.filter((i) => HALL_TOPIC.test(i.topic) && i.topic !== "hb:mead");
  check("an empty board is said to be empty and nothing else", emptyHall.length >= 1 && emptyHall.every((i) => i.topic === "hb:hall:clock" && i.lines.some((l) => /no priced market|Nothing priced/.test(l.text))), emptyHall.map((i) => i.topic).join());
}

console.log("Vikings, honestly: a market on a Minnesota game is an NFL market");
{
  const row = lite.rows.find((r) => r.outcome === "Minnesota");
  const { id: _ticker, ...spoken } = row ?? {};
  check("it carries no team flag, only the NFL one (the ticker is never spoken, and holds the team code)", row && row.nfl === true && !("team" in row) && !/vikings|skol/i.test(JSON.stringify(spoken)) && !/\bMIN\b/.test(JSON.stringify(spoken)), JSON.stringify(spoken).slice(0, 200));
  const src = fs.readFileSync("src/lib/room/live-voices-mead.ts", "utf8") + fs.readFileSync("src/lib/room/hall-lite.ts", "utf8");
  const code = src.replace(/Minnesota/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  check("nothing in the hall's talk or data special-cases a team (no boost beyond NFL)", !/vikings|skol|purple/i.test(code) && !/\bMIN\b/.test(code));
  const dets = lite.rows.filter((r) => r.fam === "NFL").map((r) => r.slot);
  check("NFL rows rank as the engine ranks them (the +3 is inside the score), not by name", dets.length === 2 && board0.signals.slice(0, 2).every((s) => s.nfl));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
