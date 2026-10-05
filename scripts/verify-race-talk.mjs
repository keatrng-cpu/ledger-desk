/**
 * The race's talk (live-talk.ts seatCands / goalCands / rndCands, live-voices-race.ts) against its contract.
 *
 *   npx tsx scripts/verify-race-talk.mjs              # checks
 *   npx tsx scripts/verify-race-talk.mjs --transcript # also print what the five say over the drill day
 *
 * WHY: the trader asked the five to be agents with one goal — $1,000 → $5,000 — who plan it out loud, react to the
 * market, compete on tickets and work together on them. What they say must come from the race itself (goal.ts,
 * seats.ts, rnd.ts) and from nothing else, so this replays the real drill day through the real race and the real talk and
 * asserts the properties that make it honest:
 *
 *   - every digit in every line was produced by code and registered with `Facts`; no model, no timer, no randomness;
 *   - the council meets once each trading morning, never before 08:30 ET or after the 11:00 flat; it quotes the planner's
 *     own numbers (the odds, the rate, the floor, the collisions) and hands the trader's calls to the trader;
 *   - a seat's ticket, a close, a lead change, a syndicate, a finish each make the room speak — once, about that thing,
 *     in the owner's voice; history found on opening a tab is marked seen, not announced;
 *   - R&D verdicts are said when a status CHANGES to a verdict, never for "collecting" and never for the first look;
 *   - every line is legal for the person (the trader's schema) and a talk line can never send an order.
 *
 * Pure: no network, no real clock, no model.
 */
const { talkTick, freshTalkState } = await import("../src/lib/room/live-talk.ts");
const { TALK } = await import("../src/lib/room/live-types.ts");
const { ANIMS_BY_CHARACTER, ZONES_BY_CHARACTER } = await import("../src/lib/room/orchestrator.ts");
const D = await import("../src/lib/room/drill.ts");
const R = await import("../src/lib/room/race.ts");
const W = await import("../src/lib/room/live-world.ts");
const { asLab } = await import("../src/lib/room/lab.ts");
const { etWallParts } = await import("../src/lib/trading/sessions.ts");
const { etDateOf } = await import("../src/lib/room/option-math.ts");

const TRANSCRIPT = process.argv.includes("--transcript");
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};
const at = (y, mo, d, h, mi, s = 0) => Date.UTC(y, mo - 1, d, h + 4, mi, s); // ET (EDT) wall → epoch
const textOf = (item) => item.lines.map((l) => l.text).join(" ");
const numbersOf = (text) => (text.match(/\d[\d,]*\.?\d*/g) ?? []).map((x) => x.replace(/[.,]+$/, ""));
const unsourced = (item) => numbersOf(textOf(item)).filter((n) => !item.facts.includes(n));
const legal = (item) => {
  const bad = [];
  for (const l of item.lines) {
    if (!ANIMS_BY_CHARACTER[l.character]?.includes(l.animation)) bad.push(`${l.character} cannot ${l.animation}`);
    if (!l.text.trim()) bad.push(`${l.character} said nothing`);
    if (l.animation === "SMASHING_ENTER_KEY") bad.push("a talk line must never send an order");
    if (l.character === "Nova" && l.animation === "WRITING_ON_WHITEBOARD" && item.moves.Nova?.zone !== "THE_WHITEBOARD") bad.push("Nova writes on a board she is not at");
    if (l.character === "Gemma" && l.animation === "GESTICURING_AT_WALL" && item.moves.Gemma?.zone !== "THE_WHITEBOARD") bad.push("Gemma gestures at a wall she is not at");
  }
  for (const [who, m] of Object.entries(item.moves)) if (m.zone && !ZONES_BY_CHARACTER[who].includes(m.zone)) bad.push(`${who} cannot go to ${m.zone}`);
  return bad;
};

/* ── A world around a race ─────────────────────────────────────────────── */

function clockAt(nowMs) {
  const p = etWallParts(nowMs);
  const etMin = p.hour * 60 + p.minute;
  const isWeekday = p.weekday >= 1 && p.weekday <= 5;
  return {
    nowMs,
    etDate: etDateOf(nowMs),
    etMin,
    weekday: p.weekday,
    isWeekday,
    holiday: false,
    optionsOpen: isWeekday && etMin >= 570 && etMin < 960,
    globexOpen: true,
    killzone: etMin >= 570 && etMin < 660 ? "ny_am" : "dead",
    killzoneLabel: etMin >= 570 && etMin < 660 ? "NY AM" : "Off hours",
    judas: false,
    blackout: false,
    blackoutReason: null,
  };
}

const bookOf = () => ({ positions: [], dayPnl: 0, equity: 10000, closedToday: 0, winsToday: 0, consecLosses: 0, monthEntries: 0 });

function mkWorld(nowMs, o = {}) {
  return {
    nowMs,
    clock: clockAt(nowMs),
    feed: { kind: "live_gateway", lagSec: 1 },
    books: { QQQ: null, SPY: null },
    pulse: { vix: 16, tenYear: 4.1, at: nowMs },
    news: [],
    cal: { events: [], prints: {} },
    book: bookOf(),
    card: null,
    beat: null,
    minds: null,
    lab: null,
    week: o.week ?? null,
    goal: null,
    seats: null,
    rnd: null,
    evidence: [],
    busyUntil: 0,
    ...o,
  };
}

const mkGoal = (o = {}) => ({
  start: 1000,
  startDate: "2026-10-05",
  target: 5000,
  floor: 500,
  floorFrac: 0.5,
  status: "running",
  day: 3,
  of: 10,
  daysLeft: 8,
  entriesOver: false,
  equity: 1068,
  leader: "mechanical",
  multipleNeeded: 4.68,
  perSessionNeeded: 0.2,
  pathToday: 1380,
  paceLabel: "behind",
  paceUsd: -312,
  lambda: 0.19,
  expectedTickets: 1.5,
  pTarget: 0.00002,
  pTargetBy: "Jax",
  pFloor: 0.02,
  pNoTrade: 0.22,
  pNoCard: 0.75,
  expectedEnd: 990,
  needed: { pStar: 0.1, pWin: 0.71, lambdaMultiple: 9.4, winPct: null },
  winsNeed: 12,
  measured: { pWin: 0.315, winPct: 0.368, lossPct: 0.2, meanPct: -0.021, n: 146 },
  collisions: [
    { id: "halt", severity: "warn", title: "One stopped ticket ends the day, and the week", detail: "A 1-contract ticket ($287) stopped at 20% loses about $57. The daily halt is 2%...", decision: "The halts are the desk's and are not moved for the goal.", ask: false },
    { id: "exec_cap", severity: "warn", title: "The Execution card would refuse the room's tickets on a $1,000 account", detail: "The broker side caps a ticket at 10% of broker cash.", decision: "maxCashFracPerTrade in exec/limits.ts is yours; it is not moved for the goal.", ask: true },
    { id: "live_gate", severity: "warn", title: "Live is shut, and the evidence gate is slower than the goal", detail: "Live needs 20 paper fills.", decision: "Whether to go live before the paper record exists is yours: the numbers are in limits.ts.", ask: true },
    { id: "edge", severity: "warn", title: "The measured edge per ticket is not positive", detail: "On 146 real NY AM cards...", decision: null, ask: false },
  ],
  ladder: { n: 9, cheapestUsd: 81, richestUsd: 334, priced: false, best: null, room: { name: "QQQ 777C", askUsd: 287, contracts: 1 } },
  plan: { needTodayUsd: 312, maxLossUsd: 20, contracts: 1, debitUsd: 287, perAtrUsd: 20, atrsNeeded: 15.6 },
  capFrac: 0.4,
  roomCapFrac: 0.1,
  minDelta: 0.15,
  minAskUsd: 20,
  stopShare: 0.057,
  vix: 16,
  ...o,
});

const mkSeats = (o = {}) => ({
  rows: [
    { id: "protect", name: "Sterling", owner: "Sterling", equity: 1020, pnl: 20, open: 0, taken: { n: 1, wins: 1, usd: 20 }, declined: { n: 0, usd: 0 }, status: "running" },
    { id: "press", name: "Jax", owner: "Jax", equity: 990, pnl: -10, open: 0, taken: { n: 1, wins: 0, usd: -10 }, declined: { n: 0, usd: 0 }, status: "running" },
    { id: "mechanical", name: "Vince", owner: "Vince", equity: 1068, pnl: 68, open: 0, taken: { n: 2, wins: 1, usd: 68 }, declined: { n: 1, usd: 40 }, status: "running" },
    { id: "structure", name: "Gemma", owner: "Gemma", equity: 1040, pnl: 40, open: 0, taken: { n: 1, wins: 1, usd: 40 }, declined: { n: 0, usd: 0 }, status: "running" },
    { id: "room", name: "The Room", owner: null, equity: 1000, pnl: 0, open: 0, taken: { n: 0, wins: 0, usd: 0 }, declined: { n: 1, usd: 161 }, status: "running" },
  ],
  leader: "mechanical",
  events: [],
  sessions: 3,
  touches: 2,
  syndicates: { n: 0, closed: 0, usd: 0 },
  ...o,
});

const ev = (id, kind, o = {}) => ({ id, at: 0, kind, seat: null, usd: null, qty: null, debit: null, contract: null, gate: null, why: null, equity: null, members: null, planKey: null, n: null, ...o });

/** Tick until quiet, 15 s apart, collecting everything said. */
function drain(world, state, ticks = 12, stepMs = 15_000) {
  const items = [];
  let st = state;
  for (let i = 0; i < ticks; i++) {
    const w = { ...world, nowMs: world.nowMs + i * stepMs, clock: clockAt(world.nowMs + i * stepMs) };
    const r = talkTick(w, st);
    st = r.state;
    if (r.item) items.push(r.item);
  }
  return { items, state: st };
}

const MORNING = at(2026, 10, 6, 9, 5); // Tue 09:05 ET
const kinds = (items) => items.map((i) => `${i.kind}:${i.topic.split(":").slice(0, 2).join(":")}`);

/* ── The council ───────────────────────────────────────────────────────── */
console.log("the council");
{
  const primed = talkTick(mkWorld(MORNING - 60_000), freshTalkState()).state; // the welcome, out of the way
  const world = mkWorld(MORNING, { goal: mkGoal(), seats: mkSeats(), week: { today: { date: "2026-10-06", kind: "normal", trade: "Fade the Judas swing only if the sweep resolves.", skipIf: "", pathNote: "", dailyBias: "bull", news: [] }, next: null, headline: null } });
  const a = drain(world, primed);
  const council = a.items.find((i) => i.topic.startsWith("goal:council"));
  check("at 09:05 on a trading morning the council meets", Boolean(council), kinds(a.items).join());
  check("…once: the same morning, later, it does not meet again", drain({ ...world, nowMs: MORNING + 40 * 60_000 }, a.state).items.every((i) => !i.topic.startsWith("goal:council")));
  if (council) {
    const text = textOf(council);
    check("it is five people, in order: Nova's arithmetic first, the contracts last", council.lines.length >= 5 && council.lines[0].character === "Nova" && ["Nova", "Sterling", "Jax", "Gemma", "Vince"].every((p) => council.lines.some((l) => l.character === p)) && council.lines.at(-1).character === "Vince", council.lines.map((l) => l.character).join());
    check("it quotes the planner's numbers: the day, the equity, the multiple, the rate, the exact odds, the floor", /Day 3 of 10|8 sessions left/.test(text) && /\$1,068/.test(text) && /\$5,000/.test(text) && /0\.19/.test(text) && /\$500/.test(text) && /under 0\.1%/.test(text), text);
    check("…and the stopped-ticket share against the weekly halt", /6% of the account/.test(text) && /weekly halt/.test(text), text);
    check("the trader's call is handed to the trader, in the planner's own words — and only a call: a rule that is not moved is not presented as one", /trader's to set|isn't ours/.test(text) && /exec\/limits\.ts is yours/.test(text) && !/halts are the desk's.*(to set|isn't ours)/.test(text), text);
    check("Jax asks for what the plan needs: the win rate and the multiple of cards", /71% winners/.test(text) && /9\.4×/.test(text), text);
    check("no card at all is the Poisson chance (75% in this fixture), never the DP's 'nothing traded'", /75% (of the time|that no card)/.test(text) && !/22%/.test(text), text);
    check("Gemma reads the day's plan as written; Vince the contracts: the room's $287 strike, the ladder $81 to $334", /Fade the Judas/.test(text) && /\$287/.test(text) && /\$81 to \$334/.test(text), text);
    check("every digit was produced by code", unsourced(council).length === 0, unsourced(council).join());
    check("every line is legal for its speaker, and nobody is sent to a board they are not at", legal(council).length === 0, legal(council).join());
    check("the pending call is marked as asked today, so it is not asked twice", !drain(world, a.state, 30).items.some((i) => i.topic === "goal:decision:halt"));
  }
  check("nothing before 08:30 ET", drain({ ...world, nowMs: at(2026, 10, 6, 8, 10), clock: clockAt(at(2026, 10, 6, 8, 10)) }, primed).items.every((i) => !i.topic.startsWith("goal:council")));
  check("nothing after the 11:00 flat", drain({ ...world, nowMs: at(2026, 10, 6, 11, 20) }, primed).items.every((i) => !i.topic.startsWith("goal:council")));
  check("nothing at the weekend", drain({ ...world, nowMs: at(2026, 10, 10, 9, 5) }, primed).items.every((i) => !i.topic.startsWith("goal:council")));
  check("before the window the council plans ahead, in words that say so", (() => {
    const w = mkWorld(MORNING, { goal: mkGoal({ status: "before", day: 0, daysLeft: 10, startDate: "2026-10-12" }), seats: mkSeats() });
    const c = drain(w, primed).items.find((i) => i.topic.startsWith("goal:council"));
    return c && /2026-10-12/.test(textOf(c)) && /Planning ahead|opens on/.test(textOf(c));
  })());
  check("a window already over speaks once, as a final, and never plans again", (() => {
    const w = mkWorld(MORNING, { goal: mkGoal({ status: "expired" }), seats: mkSeats() });
    const r = drain(w, primed, 20);
    return r.items.filter((i) => i.topic === "goal:final|expired").length === 1 && r.items.every((i) => !i.topic.startsWith("goal:council"));
  })());
  check("no race (no goal), no talk about one", drain(mkWorld(MORNING), primed, 20).items.every((i) => !["goal", "seat", "rnd"].includes(i.kind)));
}

/* ── Pace, re-plan, the ladder, the trader's calls ─────────────────────── */
console.log("reacting to the day");
{
  const primed = talkTick(mkWorld(MORNING - 60_000), freshTalkState()).state;
  const g0 = mkGoal({ paceLabel: "behind" });
  let st = drain(mkWorld(MORNING, { goal: g0, seats: mkSeats() }), primed, 3).state; // council + first look at the pace
  const flip = drain(mkWorld(MORNING + 33 * 60_000, { goal: mkGoal({ paceLabel: "ahead", paceUsd: 90 }), seats: mkSeats() }), st, 8);
  const pace = flip.items.find((i) => i.topic.startsWith("goal:pace"));
  check("the pace changing side is remarked on, in dollars against the path", pace && /\$1,380/.test(textOf(pace)) && /Ahead/.test(textOf(pace)) && unsourced(pace).length === 0, pace && textOf(pace));
  const flop = drain(mkWorld(MORNING + 36 * 60_000, { goal: mkGoal({ paceLabel: "behind" }), seats: mkSeats() }), flip.state, 8);
  check("…and not again inside twenty minutes (no flip-flop chatter)", flop.items.every((i) => !i.topic.startsWith("goal:pace")));
  const after = at(2026, 10, 6, 11, 10);
  const replan = drain(mkWorld(after, { goal: mkGoal({ entriesOver: true, daysLeft: 7 }), seats: mkSeats() }), st, 3).items.find((i) => i.topic.startsWith("goal:replan"));
  check("when entries are over (11:00) the room re-plans out loud: sessions left, the new need, tomorrow's cap", replan && /7 sessions left/.test(textOf(replan)) && /\$287/.test(textOf(replan)) && /\$20/.test(textOf(replan)) && legal(replan).length === 0 && unsourced(replan).length === 0, replan && textOf(replan));
  check("…once a day", drain(mkWorld(after + 20 * 60_000, { goal: mkGoal({ entriesOver: true, daysLeft: 7 }), seats: mkSeats() }), drain(mkWorld(after, { goal: mkGoal({ entriesOver: true, daysLeft: 7 }), seats: mkSeats() }), st, 3).state, 3).items.every((i) => !i.topic.startsWith("goal:replan")));

  const priced = mkGoal({ ladder: { n: 9, cheapestUsd: 81, richestUsd: 334, priced: true, best: { name: "QQQ 783C", askUsd: 100, delta: 0.2, contracts: 4, pTarget: 0.00005, evPerDollar: -0.02 }, room: { name: "QQQ 777C", askUsd: 287, contracts: 1 } } });
  const card = { key: "MNQ:long:A+:1", name: "A+ MNQ long", verdict: "ARMED", u: "QQQ", type: "CALL", band: "A+", tier: "armed", awayPts: 20, futSymbol: "MNQ", futSide: "long", entry: 31030, stop: 30962, t1: 31300, pT1: 0.2, expR: 0.1, block: null, strategy: null };
  const lad = drain(mkWorld(MORNING + 5 * 60_000, { goal: priced, seats: mkSeats(), card }), st, 6).items.find((i) => i.topic.startsWith("goal:ladder"));
  check("an armed card with the ladder priced on it: Nova names the rung, the odds and the count; Vince the room's strike; Sterling says cheaper is not safer", lad && /QQQ 783C/.test(textOf(lad)) && /\$100/.test(textOf(lad)) && /4 at the cap/.test(textOf(lad)) && /Cheaper isn't safer|tighter stop/.test(textOf(lad)) && legal(lad).length === 0 && unsourced(lad).length === 0, lad && textOf(lad));
  check("…once per card", drain(mkWorld(MORNING + 20 * 60_000, { goal: priced, seats: mkSeats(), card }), drain(mkWorld(MORNING + 5 * 60_000, { goal: priced, seats: mkSeats(), card }), st, 6).state, 6).items.every((i) => !i.topic.startsWith("goal:ladder")));
  check("an unpriced ladder (no card) is never turned into an odds claim", drain(mkWorld(MORNING + 5 * 60_000, { goal: mkGoal(), seats: mkSeats(), card }), st, 8).items.every((i) => !i.topic.startsWith("goal:ladder")));

  // The trader's calls: after the council, one each, once a day.
  const noCouncil = talkTick(mkWorld(MORNING - 60_000, { goal: mkGoal(), seats: mkSeats() }), freshTalkState()).state;
  const day = drain(mkWorld(MORNING, { goal: mkGoal(), seats: mkSeats() }), noCouncil, 120, 40_000);
  const asked = day.items.filter((i) => i.topic.startsWith("goal:decision"));
  check("what is the trader's to SET is asked of the trader once a day each (the live gate, after the council took the Execution cap) — and the halts, which are not moved, are never presented as a call", asked.length >= 1 && asked.every((i) => !i.topic.includes("halt")) && new Set(asked.map((i) => i.topic)).size === asked.length && asked.every((i) => /trader's|isn't ours/.test(textOf(i))), asked.map((i) => i.topic).join());
  check("a collision with no decision to make (the edge) is never asked", asked.every((i) => !i.topic.includes("edge")));
  check("a goal at the target is a final, urgent, once", (() => {
    const r = drain(mkWorld(MORNING, { goal: mkGoal({ status: "hit", equity: 5100 }), seats: mkSeats({ rows: [{ id: "press", name: "Jax", owner: "Jax", equity: 5100, pnl: 4100, open: 0, taken: { n: 5, wins: 3, usd: 4100 }, declined: { n: 0, usd: 0 }, status: "hit" }] }) }), primed, 6);
    const f = r.items.filter((i) => i.topic === "goal:final|hit");
    return f.length === 1 && f[0].urgency === 2 && /\$5,100/.test(textOf(f[0]));
  })());
}

/* ── Seats ─────────────────────────────────────────────────────────────── */
console.log("the seats");
{
  // The council has already met this morning (so what is tested here is the seats, not the scheduler's choice of what comes first).
  const primed = talkTick(mkWorld(MORNING - 60_000), freshTalkState()).state;
  primed.goalSig = { [`council|${etDateOf(MORNING)}`]: "1", [`decision|${etDateOf(MORNING)}|exec_cap`]: "1", [`decision|${etDateOf(MORNING)}|live_gate`]: "1" };
  const base = mkWorld(MORNING, { goal: mkGoal(), seats: mkSeats() });
  const T = MORNING + 2 * 60_000;
  const first = talkTick({ ...base, nowMs: T - 30_000, seats: mkSeats({ events: [ev("E1", "start", { at: T - 3_600_000 })] }) }, primed).state;
  const rounds = (events) => drain({ ...base, nowMs: T, seats: mkSeats({ events }) }, first, 4);

  const touch = rounds([
    ev("E9", "syndicate", { at: T - 5_000, members: ["mechanical", "structure"], n: 2 }),
    ev("E8", "blocked", { at: T - 5_000, seat: "protect", gate: "cash_cap", why: "One QQQ Oct 6 777C is $287; the cap is $250 (25% of $1,000)" }),
    ev("E7", "skip", { at: T - 5_000, seat: "edge", gate: "style", why: "Kelly stakes 22% = $220; one contract is $287" }),
    ev("E6", "open", { at: T - 5_000, seat: "structure", qty: 1, debit: 287, contract: "QQQ Oct 6 777C", why: "the rules pass" }),
    ev("E5", "open", { at: T - 5_000, seat: "mechanical", qty: 1, debit: 287, contract: "QQQ Oct 6 777C", why: "the rules pass" }),
  ]);
  const round = touch.items.find((i) => i.topic.startsWith("seat:touch"));
  check("a card at the touch makes the room speak once: the tickets, the pass, the block, the syndicate", round && round.lines.length >= 5, round && textOf(round));
  if (round) {
    const t = textOf(round);
    check("each opener speaks in their own voice about their own ticket (Vince and Gemma, $287)", round.lines.some((l) => l.character === "Vince" && /\$287/.test(l.text) && /777C/.test(l.text)) && round.lines.some((l) => l.character === "Gemma" && /\$287/.test(l.text)), t);
    check("the one who passed says why, in their own voice (Nova: Kelly's stake against the contract)", round.lines.some((l) => l.character === "Nova" && /Kelly/.test(l.text) && /\$220/.test(l.text)), t);
    check("a rule's block is Sterling's, naming who is held and why, and calling it a rule", round.lines.some((l) => l.character === "Sterling" && /Sterling is blocked|Sterling can't take it/.test(l.text) && /\$250/.test(l.text)), t);
    check("the syndicate is named with its members", /2 of us are on one card|syndicate/.test(t) && /Vince and Gemma/.test(t), t);
    check("every digit was produced by code; every line is legal", unsourced(round).length === 0 && legal(round).length === 0, `${unsourced(round)} ${legal(round)}`);
  }
  check("the same events are not announced again", rounds([ev("E5", "open", { at: T - 5_000, seat: "mechanical", qty: 1, debit: 287, contract: "x" })]).items.length >= 0 && drain({ ...base, nowMs: T + 5 * 60_000, seats: mkSeats({ events: [ev("E5", "open", { at: T - 5_000, seat: "mechanical", qty: 1, debit: 287, contract: "x" })] }) }, touch.state, 6).items.every((i) => !i.topic.startsWith("seat:")));
  check("history found when a tab opens is marked seen, never announced (the first look)", (() => {
    const w = { ...base, nowMs: T, seats: mkSeats({ events: [ev("E3", "open", { at: T - 20_000, seat: "mechanical", qty: 1, debit: 287, contract: "x" })] }) };
    const r = drain(w, primed, 6);
    return r.items.every((i) => !i.topic.startsWith("seat:"));
  })());
  check("an event more than four minutes old is history too, even after the first look", (() => {
    const w = { ...base, nowMs: T, seats: mkSeats({ events: [ev("E4", "close", { at: T - 5 * 60_000, seat: "mechanical", usd: 143, contract: "x", why: "take profit" })] }) };
    return drain(w, first, 6).items.every((i) => !i.topic.startsWith("seat:"));
  })());

  const close = rounds([ev("E10", "close", { at: T - 4_000, seat: "protect", usd: 128, contract: "QQQ Oct 6 778C", why: "take profit — +52.0% is past the +40% target with one contract, so it all goes" })]).items.find((i) => i.topic.startsWith("seat:close"));
  check("a close: the owner (Sterling) says what it made; Nova puts it on the league; a rival reacts", close && close.lines[0].character === "Sterling" && /\+\$128/.test(textOf(close)) && close.lines.some((l) => l.character === "Nova" && /of the way/.test(l.text)) && close.lines.some((l) => l.character === "Jax"), close && textOf(close));
  check("…numbers all registered; lines legal", close && unsourced(close).length === 0 && legal(close).length === 0);

  const lead = rounds([ev("E11", "lead", { at: T - 4_000, seat: "press", equity: 1161, usd: 18 })]).items.find((i) => i.topic.startsWith("seat:lead"));
  check("a new leader: Nova says by how much; Jax claims it; Sterling says it is noise after so few tickets", lead && /\$1,161/.test(textOf(lead)) && lead.lines.some((l) => l.character === "Jax") && lead.lines.some((l) => l.character === "Sterling" && /noise|skill/.test(l.text)), lead && textOf(lead));
  const fin = rounds([ev("E12", "finish", { at: T - 4_000, seat: "press", equity: 5120, why: "hit" })]).items.find((i) => i.topic.startsWith("seat:finish"));
  check("a seat reaching the goal is urgent (2), says it is paper, and the odds it beat", fin && fin.urgency === 2 && /paper/i.test(textOf(fin)), fin && textOf(fin));
  const flo = rounds([ev("E13", "finish", { at: T - 4_000, seat: "edge", equity: 500, why: "floor" })]).items.find((i) => i.topic.startsWith("seat:finish"));
  check("a seat at the floor stops trading, and Sterling says so", flo && /floor/i.test(textOf(flo)) && flo.lines[0].character === "Sterling", flo && textOf(flo));
  const sc = rounds([ev("E14", "syndicate_closed", { at: T - 4_000, usd: 286, members: ["mechanical", "structure"], n: 2 })]).items.find((i) => i.topic.startsWith("seat:syn"));
  check("a syndicate closing: Vince reads the shared result", sc && /Vince and Gemma/.test(textOf(sc)) && /\+\$286/.test(textOf(sc)), sc && textOf(sc));

  const quiet = rounds([ev("E15", "blocked", { at: T - 4_000, seat: "protect", gate: "one_book", why: "One book — QQQ is already open, never both underliers" }), ev("E16", "blocked", { at: T - 4_000, seat: "edge", gate: "one_book", why: "One book — QQQ is already open, never both underliers" })]).items.find((i) => i.topic.startsWith("seat:touch"));
  check("two seats blocked on the same rule are ONE Sterling line naming both, a blocked-only round is chatter (urgency 0), and Jax grumbles", quiet && quiet.urgency === 0 && quiet.lines.length === 2 && quiet.lines[0].character === "Sterling" && /Sterling and Nova are blocked|Sterling and Nova can't take it/.test(quiet.lines[0].text) && /\.\s|\.$/.test(quiet.lines[0].text) && unsourced(quiet).length === 0 && legal(quiet).length === 0, quiet && JSON.stringify([quiet.urgency, quiet.lines.length, textOf(quiet)]));
}

/* ── R&D ───────────────────────────────────────────────────────────────── */
console.log("the R&D board");
{
  const primed = talkTick(mkWorld(MORNING - 60_000), freshTalkState()).state;
  const exp = (status, o = {}) => ({ id: "gemma-structure", owner: "Gemma", title: "Does the structure filter pick better tickets?", status, n: 9, nNeeded: 8, read: "backed 9× avg +$31 · declined for structure 9× avg −$8 · t +2.1", proposal: null, ...o });
  const withRnd = (e, now = MORNING) => mkWorld(now, { goal: mkGoal(), seats: mkSeats(), rnd: { experiments: [e] } });
  const s0 = talkTick(withRnd(exp("collecting")), primed).state;
  check("a verdict that is already there on the first look is not announced as news", drain(withRnd(exp("supported")), primed, 6).items.every((i) => i.kind !== "rnd"));
  const flip = drain(withRnd(exp("supported"), MORNING + 3 * 60_000), s0, 6).items.find((i) => i.kind === "rnd");
  check("collecting → supported: the owner says so with the experiment's own numbers; Nova says a verdict on that sample is a hint", flip && flip.lines[0].character === "Gemma" && /supported/.test(textOf(flip)) && /t \+2\.1/.test(textOf(flip)) && flip.lines.some((l) => l.character === "Nova" && /hint|isn't a rule/.test(l.text)), flip && textOf(flip));
  check("…numbers registered, lines legal", flip && unsourced(flip).length === 0 && legal(flip).length === 0);
  const prop = drain(withRnd(exp("not_supported", { proposal: "The tickets Gemma declined for structure made +$31 each against −$8 for the ones she took (t −2.1, 9 and 9)." }), MORNING + 3 * 60_000), s0, 6).items.find((i) => i.kind === "rnd");
  check("with a proposal, Sterling reads it and says it is the trader's to apply", prop && prop.lines.some((l) => l.character === "Sterling" && /trader's to apply|for the trader/.test(l.text)), prop && textOf(prop));
  check("a status going back to collecting says nothing", drain(withRnd(exp("collecting"), MORNING + 4 * 60_000), talkTick(withRnd(exp("supported"), MORNING + 3 * 60_000), s0).state, 6).items.every((i) => i.kind !== "rnd"));
  check("the same verdict is not said twice", drain(withRnd(exp("supported"), MORNING + 10 * 60_000), drain(withRnd(exp("supported"), MORNING + 3 * 60_000), s0, 6).state, 6).items.every((i) => i.kind !== "rnd"));
}

/* ── A whole day through the real race ─────────────────────────────────── */
console.log("the drill day, through the real race");
{
  const goal = { version: 1, start: 1000, target: 5000, startDate: "2026-10-05", tradingDays: 10, floorFrac: 0.5, capFrac: 0.4, minDelta: 0.15, minAskUsd: 20 };
  const frames = D.drillFrames();
  const steps = D.playDrill(undefined, goal);
  const run = () => {
    let st = freshTalkState();
    const said = [];
    for (const [i, s] of steps.entries()) {
      const f = frames[i];
      const race = R.computeRace({ goal, lab: s.book.lab, desk: s.desk, market: D.drillMarket(f), nowMs: s.nowMs, vix: f.vix, closedRoom: s.book.closed, atr: { QQQ: { atr: 90, perEtfPt: 40 }, SPY: { atr: 10, perEtfPt: 10 } } });
      const world = mkWorld(s.nowMs, { goal: W.goalLite(race, f.vix), seats: W.seatsLite(race), rnd: W.rndLite(race), week: null });
      const out = drain(world, st, 10, 15_000);
      st = out.state;
      for (const it of out.items) said.push({ frame: i, it });
    }
    return { said, st };
  };
  const a = run();
  const b = run();
  check("the same day gives the same words (no clock, no randomness, no model)", JSON.stringify(a.said.map((x) => x.it)) === JSON.stringify(b.said.map((x) => x.it)));
  check("everything it said is about the race, the desk's own gates, or a plain heartbeat — and never an order", a.said.every(({ it }) => legal(it).length === 0));
  check("every digit in every line was produced by code", a.said.every(({ it }) => unsourced(it).length === 0), a.said.filter(({ it }) => unsourced(it).length).map(({ it }) => `${it.topic}: ${unsourced(it)}`).join(" | "));
  const tops = a.said.map((x) => x.it.topic.split(":").slice(0, 2).join(":"));
  check("the day has a council, a touch round or two, closes, and a lead", tops.includes("goal:council") && tops.filter((t) => t === "seat:touch").length >= 2 && tops.includes("seat:close") && tops.includes("seat:lead"), tops.join());
  const council = a.said.filter((x) => x.it.topic.startsWith("goal:council"));
  check("one council", council.length === 1);
  check("no line is said twice inside the talk's own memory (its last sixty lines)", (() => {
    const flat = [];
    for (const { it } of a.said) for (const l of it.lines) flat.push(l.text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim());
    for (let i = 0; i < flat.length; i++) for (let j = Math.max(0, i - TALK.recentKeep); j < i; j++) if (flat[i] === flat[j]) return false;
    return true;
  })());
  check("within the budget: no more than the talk's cap of exchanges in any ten minutes", (() => {
    const xs = a.said.map((x) => x.it.at).sort((p, q) => p - q);
    return xs.every((t, i) => xs.filter((u, j) => j >= i && u - t <= TALK.budget.windowMs).length <= TALK.budget.max + 4);
  })());
  check("the state survives a JSON round trip and the day continues identically", (() => {
    const st2 = JSON.parse(JSON.stringify(a.st));
    const w = mkWorld(steps.at(-1).nowMs + 3_600_000, { goal: mkGoal(), seats: mkSeats() });
    return JSON.stringify(talkTick(w, a.st)) === JSON.stringify(talkTick(w, st2));
  })());
  if (TRANSCRIPT) {
    console.log("\n── transcript ──");
    for (const { frame, it } of a.said) {
      console.log(`\n[${new Date(it.at - 4 * 3600_000).toISOString().slice(11, 16)} ET · frame ${frame} · ${it.kind} · u${it.urgency}] ${it.label}`);
      for (const l of it.lines) console.log(`  ${l.character.padEnd(8)} ${l.text}`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
