/**
 * The R&D board (src/lib/room/rnd.ts) against its contract.
 *
 *   npx tsx scripts/verify-rnd.mjs
 *
 * WHY: the trader wants the five to be "always trying to make the whole ledger desk better". The honest version is a
 * short list of questions, each owned by one person and answered by a FIXED rule on the evidence the seats and the ghost
 * room produce, with the sample printed beside the answer. That only means anything if the rules cannot bend to the data:
 *
 *   - the arithmetic (t statistics, the Poisson interval) is hand-checked;
 *   - every experiment is "collecting" below its minimum sample, however extreme the numbers look, and says so;
 *   - above it the status follows the pre-registered bar exactly — supported / not supported / undecided — and a
 *     proposal exists only when the bar says there is something to propose, as text, with its numbers;
 *   - nothing here can write a rule: the module imports no config, no gate, no size, no model.
 *
 * Pure: no network, no real clock, no model.
 */
const R = await import("../src/lib/room/rnd.ts");
const S = await import("../src/lib/room/seats.ts");
const { emptyLab } = await import("../src/lib/room/lab.ts");
const { opportunityRate } = await import("../src/lib/room/goal.ts");
const fs = await import("node:fs");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const json = (x) => JSON.stringify(x);

const GOAL = { version: 1, start: 1000, target: 5000, startDate: "2026-10-05", tradingDays: 10, floorFrac: 0.5, capFrac: 0.4, minDelta: 0.15, minAskUsd: 20 };

console.log("arithmetic");
{
  check("mean and sample sd by hand: [1,2,3,4,5] → 3, √2.5", R.meanOf([1, 2, 3, 4, 5]) === 3 && near(R.sdOf([1, 2, 3, 4, 5]), Math.sqrt(2.5)));
  check("one-sample t: 3 ÷ (√2.5 ÷ √5) = 4.2426", near(R.tOne([1, 2, 3, 4, 5]), 3 / (Math.sqrt(2.5) / Math.sqrt(5)), 1e-12));
  check("no t from one point or from no spread", R.tOne([5]) === null && R.tOne([2, 2, 2]) === null && R.tOne([]) === null);
  const a = [10, 12, 14, 16];
  const b = [4, 6, 8, 10];
  const se = Math.sqrt(R.sdOf(a) ** 2 / 4 + R.sdOf(b) ** 2 / 4);
  check("Welch's t: (13 − 7) ÷ √(s²a/4 + s²b/4)", near(R.tWelch(a, b), 6 / se, 1e-12) && R.tWelch([1], b) === null && R.tWelch([3, 3], [3, 3]) === null);
  check("Poisson interval: none observed → [0, 3] (the rule of three); 4 observed → (2 ± .98)²", (() => {
    const z = R.poissonCI(0);
    const f = R.poissonCI(4);
    return z.lo === 0 && z.hi === 3 && near(f.lo, (2 - 0.98) ** 2) && near(f.hi, (2 + 0.98) ** 2);
  })());
  check("the bar is a one-sided 10% t (1.28), registered with a date", R.RND_BARS.t === 1.28 && R.RND_REGISTERED === "2026-10-05");
}

const closedRow = (over = {}) => ({ id: "S1", ticker: "QQQ", type: "CALL", strike: 777, exp: "2026-10-06", qty0: 1, entryPx: 3, openedAt: 0, closedAt: 1, pnlUsd: 10, reason: "x", planKey: null, syn: null, override: null, ...over });
const skipGhost = (pnl, gate = "style", pk = "k") => ({ id: `K${Math.random()}`, kind: "skipped", of: "structure", planKey: pk, ticker: "QQQ", type: "CALL", strike: 777, exp: "x", offset: "ATM", contracts: 1, entryPx: 3, openedAt: 0, fut: null, quant: null, trimmed: false, realizedUsd: 0, pnlPct: 0, meta: { seat: "structure", qty0: 1, syn: null, override: null, gate }, closed: { at: 1, px: 1, reason: "x", pnlUsd: pnl } });
const refusedGhost = (pnl, gate) => ({ id: `G${Math.random()}`, kind: "refused", of: gate, planKey: "k", ticker: "QQQ", type: "CALL", strike: 777, exp: "x", offset: "ATM", contracts: 1, entryPx: 3, openedAt: 0, fut: null, quant: null, trimmed: false, realizedUsd: 0, pnlPct: 0, closed: { at: 1, px: 1, reason: "x", pnlUsd: pnl } });
const watch = (pWindow, outcome) => ({ key: `w${Math.random()}`, at: 0, flatAt: 1, symbol: "MNQ", underlier: "QQQ", side: "long", entry: 1, stop: 0, t1: 2, decision: "fill", gate: null, pWindow, evUsd: 1, lenses: {}, touched: true, outcome, resolvedAt: 1 });
const book = (edit) => {
  const b = S.newSeatBook(GOAL, 0);
  return edit(b) ?? b;
};
const withSeat = (b, id, over) => ({ ...b, seats: b.seats.map((s) => (s.id === id ? { ...s, ...over } : s)) });
const rnd = (o = {}) => R.rndRead({ lab: o.lab ?? emptyLab(), seats: o.seats ?? null, goal: GOAL, closedRoom: [] });
const get = (r, id) => r.experiments.find((e) => e.id === id);

console.log("the board");
{
  const r = rnd();
  check("six experiments, each owned by one of the five", r.experiments.length === 6 && r.experiments.every((e) => ["Gemma", "Jax", "Nova", "Sterling", "Vince"].includes(e.owner)) && new Set(r.experiments.map((e) => e.id)).size === 6);
  check("an empty room: every experiment is collecting, none has a proposal, nothing is decided", r.experiments.every((e) => e.status === "collecting" && e.proposal === null && e.n === 0) && r.decided === 0 && r.collecting === 6);
  check("every experiment states its question, its bar and the sample it needs", r.experiments.every((e) => e.question.length > 40 && e.bar.length > 20 && e.nNeeded >= 8 && typeof e.read === "string" && e.read.length > 5));
  check("each of the five owns at least one", ["Gemma", "Jax", "Nova", "Sterling", "Vince"].every((p) => R.ownedBy(r, p).length >= 1) && R.ownedBy(r, "Nova").length === 2);
  check("verdictKey names the experiment and its status", R.verdictKey(r.experiments[0]) === `${r.experiments[0].id}:collecting`);
  const src = fs.readFileSync(new URL("../src/lib/room/rnd.ts", import.meta.url), "utf8");
  check("the module imports no config, no gate, no size, no model — it can propose nothing it can apply", !/aplus\/config|execution|exec\/|anthropic|grok|fetch\(|callClaude|callGrok/i.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
}

console.log("Nova — are the odds honest?");
{
  const mk = (n, p, hits) => ({ ...emptyLab(), watches: Array.from({ length: n }, (_, i) => watch(p, i < hits ? "t1" : "stop")) });
  const small = get(rnd({ lab: mk(12, 0.6, 1) }), "nova-calibration");
  check("12 plans, a huge gap: still collecting, no proposal (the sample is the point)", small.status === "collecting" && small.proposal === null && small.n === 12);
  const honest = get(rnd({ lab: mk(40, 0.3, 12) }), "nova-calibration");
  check("40 plans, the card said 30%, T1 printed 30%: supported, nothing to propose", honest.status === "supported" && honest.proposal === null && /gap \+0 points/.test(honest.read), honest.read);
  const over = get(rnd({ lab: mk(40, 0.45, 12) }), "nova-calibration");
  check("40 plans, the card said 45%, T1 printed 30%: not supported, a proposal names the 15 points and the offline route (z ≥ 2.87), not a live edit", over.status === "not_supported" && /15 points above/.test(over.proposal) && /2\.87/.test(over.proposal) && /not edited live/.test(over.proposal), json(over));
  const under = get(rnd({ lab: mk(40, 0.15, 12) }), "nova-calibration");
  check("…and below: 'below'", under.status === "not_supported" && /15 points below/.test(under.proposal));
  const edge = get(rnd({ lab: mk(40, 0.4, 12) }), "nova-calibration");
  check("a gap of exactly 10 points is inside the bar", edge.status === "supported");
}

console.log("Nova — how many tickets does the desk offer?");
{
  const lam = opportunityRate().perSession;
  const touches = (k) => Array.from({ length: k }, (_, i) => ({ key: `t${i}`, at: i, etDate: "x", symbol: "MNQ", side: "long", band: "A", per: {} }));
  const seatsWith = (sessions, k) => book((b) => ({ ...b, seen: Array.from({ length: sessions }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`), touches: touches(k) }));
  check("5 sessions watched: collecting, however many cards", get(rnd({ seats: seatsWith(5, 9) }), "nova-frequency").status === "collecting");
  const ok = get(rnd({ seats: seatsWith(12, 2) }), "nova-frequency");
  check(`12 sessions, 2 cards (0.17 a session, interval 0.02–0.48): the planner's ${lam.toFixed(2)} is inside → supported`, ok.status === "supported" && ok.proposal === null, ok.read);
  const many = get(rnd({ seats: seatsWith(12, 14) }), "nova-frequency");
  const ci = R.poissonCI(14);
  check("12 sessions, 14 cards: the planner's rate is below the interval's floor → not supported, a proposal quotes both rates and says re-basing goal.ts is the trader's", many.status === "not_supported" && lam < ci.lo / 12 && /re-base/.test(many.proposal) && /yours/.test(many.proposal), json(many));
  const none = get(rnd({ seats: seatsWith(12, 0) }), "nova-frequency");
  check("12 sessions and no card at all: the interval is [0, 3/12] — the planner's 0.19 is inside, so the planner is not contradicted", none.status === "supported");
  const zero = get(rnd({ seats: seatsWith(40, 0) }), "nova-frequency");
  check("40 sessions and no card: now 0.19 is above 3/40 = 0.075 — not supported", zero.status === "not_supported");
}

console.log("Sterling — do the refusals earn their keep?");
{
  const lab = (items) => ({ ...emptyLab(), ghosts: items });
  const noisy = (base, n, gate) => Array.from({ length: n }, (_, i) => refusedGhost(base + (i % 2 ? 4 : -4), gate));
  check("9 refused tickets for a gate: collecting", get(rnd({ lab: lab(noisy(40, 9, "ev")) }), "sterling-gates").status === "collecting");
  const costing = get(rnd({ lab: lab(noisy(40, 12, "ev")) }), "sterling-gates");
  check("12 refused tickets that would have made ~$40 each: the gate is costing — not supported — and the proposal sends it to the four-year harness first", costing.status === "not_supported" && /"ev" gate refused 12 tickets/.test(costing.proposal) && /four-year/.test(costing.proposal) && /2\.87/.test(costing.proposal), json(costing));
  const earning = get(rnd({ lab: lab(noisy(-30, 12, "t1_pays")) }), "sterling-gates");
  check("12 refused tickets that would have lost ~$30 each: the gate is earning its keep — supported, nothing to propose", earning.status === "supported" && earning.proposal === null);
  const mixed = get(rnd({ lab: lab(Array.from({ length: 12 }, (_, i) => refusedGhost(i % 2 ? 60 : -60, "clock"))) }), "sterling-gates");
  check("12 that wash out: undecided", mixed.status === "undecided" && mixed.proposal === null);
  check("the reading lists every gate with its count, total and t", /ev 12× \+\$\d+ \(t \+/.test(costing.read), costing.read);
  check("ghosts of other kinds (twins, seats' declined tickets) do not count as the room's refusals", get(rnd({ lab: lab(Array.from({ length: 12 }, () => ({ ...refusedGhost(50, "ev"), kind: "twin" }))) }), "sterling-gates").status === "collecting");
}

console.log("Gemma — does structure pick better tickets?");
{
  const seats = (taken, declined) =>
    book((b) =>
      withSeat(b, "structure", {
        closed: taken.map((p) => closedRow({ pnlUsd: p })),
        skipped: declined.map((p) => skipGhost(p)),
      }),
    );
  const spread = (m, n) => Array.from({ length: n }, (_, i) => m + (i % 2 ? 5 : -5));
  check("7 on a side: collecting", get(rnd({ seats: seats(spread(30, 7), spread(-10, 7)) }), "gemma-structure").status === "collecting");
  const good = get(rnd({ seats: seats(spread(30, 10), spread(-10, 10)) }), "gemma-structure");
  check("10 backed tickets averaging +$30 against 10 declined averaging −$10: supported", good.status === "supported" && good.proposal === null, good.read);
  const bad = get(rnd({ seats: seats(spread(-10, 10), spread(30, 10)) }), "gemma-structure");
  check("the other way round: not supported, and the proposal says this is a hint to re-test offline, not a reason to change the card", bad.status === "not_supported" && /re-test it offline/.test(bad.proposal) && /direction, not R/.test(bad.proposal), json(bad));
  check("declined tickets only count when they were declined FOR STRUCTURE (gate 'style'), not for a pricing gate", get(rnd({ seats: book((b) => withSeat(b, "structure", { closed: spread(30, 10).map((p) => closedRow({ pnlUsd: p })), skipped: spread(-10, 10).map((p) => skipGhost(p, "ev")) })) }), "gemma-structure").status === "collecting");
  check("the same spread on both sides: undecided", get(rnd({ seats: seats(spread(10, 10), spread(10, 10)) }), "gemma-structure").status === "undecided");
}

console.log("Jax — do cheaper strikes beat the room's two?");
{
  // Vince holds the room's strike on each card; the ladder seats hold other contracts on the same cards.
  const plans = Array.from({ length: 10 }, (_, i) => `MNQ:long:${31000 + i}.00`);
  const mech = (r) => plans.map((pk, i) => closedRow({ planKey: pk, qty0: 1, entryPx: 3, pnlUsd: 300 * r[i % r.length] }));
  const lad = (r) => plans.map((pk, i) => closedRow({ planKey: pk, qty0: 3, entryPx: 1, pnlUsd: 300 * r[i % r.length] }));
  const seats = (m, l) => book((b) => withSeat(withSeat(withSeat(b, "mechanical", { closed: mech(m) }), "press", { closed: lad(l) }), "edge", { closed: [] }));
  check("7 matched cards: collecting", get(rnd({ seats: book((b) => withSeat(withSeat(b, "mechanical", { closed: mech([0.4, -0.2]).slice(0, 7) }), "press", { closed: lad([0.9, -0.2]).slice(0, 7) })) }), "jax-ladder").status === "collecting");
  const win = get(rnd({ seats: seats([0.4, -0.2, 0.3], [0.9, -0.2, 0.8]) }), "jax-ladder");
  const deltas = plans.map((_, i) => [0.9, -0.2, 0.8][i % 3] - [0.4, -0.2, 0.3][i % 3]);
  check("10 matched cards where the ladder seat returned more on the debit: supported, with the mean difference in points of debit and a proposal that sends the strike-set change to the trader", win.status === "supported" && win.n === 10 && new RegExp(`${Math.round(R.meanOf(deltas) * 100)} points of debit more`).test(win.proposal) && /strike_offset/.test(win.proposal) && /measured offline first/.test(win.proposal), json(win));
  const lose = get(rnd({ seats: seats([0.9, -0.2, 0.8], [0.4, -0.2, 0.3]) }), "jax-ladder");
  check("the ladder trailing the room's strikes: not supported, in plain words", lose.status === "not_supported" && /reaching further out cost money/.test(lose.proposal));
  check("a card only a ladder seat held (Vince did not) is not a matched card", get(rnd({ seats: book((b) => withSeat(b, "press", { closed: lad([0.9]) })) }), "jax-ladder").n === 0);
  check("the return is pnl ÷ (contracts bought × entry × 100): a 3-contract $1 ticket and a 1-contract $3 ticket on the same $300 compare on the same footing", near(R.meanOf(deltas), R.meanOf(plans.map((_, i) => [0.9, -0.2, 0.8][i % 3] - [0.4, -0.2, 0.3][i % 3])), 1e-12));
  const avg = get(rnd({ seats: book((b) => withSeat(withSeat(withSeat(withSeat(b, "mechanical", { closed: [closedRow({ planKey: "p", qty0: 1, entryPx: 1, pnlUsd: 0 })] }), "press", { closed: [closedRow({ planKey: "p", qty0: 1, entryPx: 1, pnlUsd: 100 })] }), "edge", { closed: [closedRow({ planKey: "p", qty0: 1, entryPx: 1, pnlUsd: 0 })] }), "protect", { closed: [closedRow({ planKey: "p", qty0: 1, entryPx: 1, pnlUsd: 0 })] })) }), "jax-ladder");
  check("several ladder seats on one card count once (their average), so the sample is cards, not seat-cards", avg.n === 1 && /\+33 points/.test(avg.read), avg.read);
}

console.log("Vince — does working together pay?");
{
  const spread = (m, n) => Array.from({ length: n }, (_, i) => m + (i % 2 ? 6 : -6));
  const seats = (co, solo) => book((b) => withSeat(withSeat(b, "mechanical", { closed: co.map((p) => closedRow({ pnlUsd: p, syn: "Y1" })) }), "press", { closed: solo.map((p) => closedRow({ pnlUsd: p, syn: null })) }));
  check("7 on a side: collecting", get(rnd({ seats: seats(spread(30, 7), spread(-5, 7)) }), "vince-syndicates").status === "collecting");
  const good = get(rnd({ seats: seats(spread(30, 10), spread(-5, 10)) }), "vince-syndicates");
  check("co-signed +$30 against solo −$5 over 10 and 10: supported, a proposal for the trader to weigh", good.status === "supported" && /weigh/.test(good.proposal), json(good));
  const bad = get(rnd({ seats: seats(spread(-5, 10), spread(30, 10)) }), "vince-syndicates");
  check("solo ahead: not supported, no proposal (a finding, not an action)", bad.status === "not_supported" && bad.proposal === null);
  const dis = book((b) => ({ ...withSeat(b, "mechanical", { closed: [] }), syndicates: [{ id: "Y1", planKey: "p", etDate: "x", at: 0, members: ["mechanical", "structure"], dissent: ["edge"], abstain: [], closedUsd: 100, dissentUsd: 161 }] }));
  check("the dissenters' declined tickets are quoted when a syndicate had any", /dissenters' declined tickets on 1 card made \+\$161/.test(get(rnd({ seats: dis }), "vince-syndicates").read));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
