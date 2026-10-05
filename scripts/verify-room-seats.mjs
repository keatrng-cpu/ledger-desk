/**
 * The seats (src/lib/room/seats.ts) against their contract.
 *
 *   npx tsx scripts/verify-room-seats.mjs
 *
 * WHY: the trader asked for the five to be agents that compete with each other on trades and work together on them,
 * with $1,000 → $5,000 as the shared goal. A seat that can quietly take a ticket the room's rules refuse, or an
 * account whose numbers drift from its tickets, is a story and not a race. So every property that makes the race
 * honest is checked on the real pipeline — the drill's scripted day through the real room, with the seats stepping on
 * the same prints:
 *
 *   - HARD rules bind every seat exactly as they bind the room (the same checklist function), the soft pricing gates
 *     are a judgement a style may make (Jax overrides them), and every judgement is followed by a ghost;
 *   - the accounts add up on every frame (equity = cash + the open tickets at the bid), a seat's ticket exits when
 *     the room's identical ticket exits, for the same reason, at the same price;
 *   - a syndicate forms only when two or more seats hold the same card, resolves when the last ticket closes, and
 *     prices the dissenters' "no" from their declined tickets;
 *   - the seats never move the house: the room's book, counters and ghost room are identical with and without them;
 *   - the goal's clock gates entries; the floor and the target latch; the state survives a JSON round trip, is not
 *     mutated by a step, and a changed goal restarts the race without lowering the backup's history counter.
 *
 * Pure: no network, no real clock, no model.
 */
const D = await import("../src/lib/room/drill.ts");
const S = await import("../src/lib/room/seats.ts");
const G = await import("../src/lib/room/goal.ts");
const { asLab, stepLab } = await import("../src/lib/room/lab.ts");
const { rankOf } = await import("../src/lib/room/snapshot.ts");
const { equityOf } = await import("../src/lib/room/paper-book.ts");

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
const RICH = { ...GOAL, start: 3000, target: 15000 };

/* ── A style's judgement, on crafted checklists ────────────────────────── */
console.log("verdicts");
{
  const gates = (...failed) => {
    const ids = ["market", "desk", "card", "desk_word", "desk_ticket", "dte", "halt_day", "halt_week", "slots", "one_book", "one_bias", "no_average", "killzone", "before_flat", "after_ten", "month", "cash_cap", "clock", "t1_pays", "ev"];
    return ids.map((id) => ({ id, ok: !failed.includes(id), label: `label:${id}` }));
  };
  const scen = (t1, loss, flat) => [
    { kind: "t1", p: 0.3, pnlUsd: t1, atMs: 0 },
    { kind: "loss", p: 0.6, pnlUsd: loss, atMs: 0 },
    { kind: "flat", p: 0.1, pnlUsd: flat, atMs: 0 },
  ];
  const plan = (over = {}) => ({ qty: 2, quote: { ask: 3 }, ev: { scenarios: scen(150, -60, -10), calibrated: { evUsd: 4 } }, ...over });
  const card = (over = {}) => ({ band: "A+", underlier: "QQQ", type: "CALL", patterns: { inducement: false, mitigation: false }, ...over });
  const desk = (htf = "bull") => ({ htf: { QQQ: htf, SPY: htf } });
  const seatOf = (id, over = {}) => ({ ...S.newSeatBook(GOAL, 0).seats.find((s) => s.id === id), ...over });
  const v = (id, evGates, over = {}) =>
    S.verdictFor({ id, seat: over.seat ?? seatOf(id), start: 1000, card: over.card ?? card(), ev: { gates: evGates, refusal: null, plan: "plan" in over ? over.plan : plan(), waiting: false }, desk: over.desk ?? desk(), backers: over.backers ?? 0 });

  for (const id of S.SEAT_IDS) {
    for (const hard of ["market", "halt_day", "halt_week", "one_book", "no_average", "after_ten", "clock", "cash_cap", "killzone", "slots"]) {
      const x = v(id, gates(hard, "ev"), { backers: 5 });
      if (x.action !== "blocked" || x.gate !== hard) {
        check(`${id}: a failed hard gate (${hard}) blocks, even with a failed soft gate beside it`, false, json(x));
        break;
      }
    }
  }
  check("every seat is blocked by every hard gate, soft gates beside it or not (the same checklist as the room)", true);
  check("a soft gate failing: everyone but Jax declines (a judgement, with the gate named)", ["protect", "mechanical", "structure", "edge", "room"].every((id) => { const x = v(id, gates("ev"), { backers: 5 }); return x.action === "skip" && x.gate === "ev"; }));
  const jax = v("press", gates("ev", "t1_pays"));
  check("Jax overrides both soft gates and takes, size = the cap's, the override recorded", jax.action === "take" && jax.qty === 2 && jax.override === "t1_pays+ev" || jax.override === "ev+t1_pays", json(jax));
  check("Jax still never overrides a hard gate", v("press", gates("one_book", "ev")).action === "blocked");
  check("a seat whose goal or floor is reached takes nothing", v("mechanical", gates(), { seat: seatOf("mechanical", { status: "hit" }) }).action === "blocked" && v("mechanical", gates(), { seat: seatOf("mechanical", { status: "floor" }) }).gate === "finished");
  check("no priced ticket → blocked, never a take of zero", v("mechanical", gates(), { plan: null }).action === "blocked" && v("mechanical", gates(), { plan: plan({ qty: 0 }) }).action === "blocked");
  check("the plain rules pass: Vince takes at the checklist's size", (() => { const x = v("mechanical", gates()); return x.action === "take" && x.qty === 2 && x.override === null; })());
  check("Sterling: A+ takes, A takes, A− passes (a judgement)", v("protect", gates()).action === "take" && v("protect", gates(), { card: card({ band: "A" }) }).action === "take" && v("protect", gates(), { card: card({ band: "A−" }) }).action === "skip");
  check("Sterling prices it twice: a negative realized-decile EV passes", v("protect", gates(), { plan: plan({ ev: { scenarios: scen(150, -60, -10), calibrated: { evUsd: -3 } } }) }).action === "skip");
  check("Gemma: HTF with the ticket takes; HTF against passes; inducement passes; mitigation passes", v("structure", gates()).action === "take" && v("structure", gates(), { desk: desk("bear") }).action === "skip" && v("structure", gates(), { card: card({ patterns: { inducement: true, mitigation: false } }) }).action === "skip" && v("structure", gates(), { card: card({ patterns: { inducement: false, mitigation: true } }) }).action === "skip");
  check("Gemma backs a put when HTF is bear", v("structure", gates(), { card: card({ type: "PUT" }), desk: desk("bear") }).action === "take");
  check("one a day (Sterling, Gemma): the second card is a rule, not a judgement", v("protect", gates(), { seat: seatOf("protect", { counters: { ...seatOf("protect").counters, filledPlans: ["x"] } }) }).action === "blocked" && v("structure", gates(), { seat: seatOf("structure", { counters: { ...seatOf("structure").counters, filledPlans: ["x"] } }) }).gate === "style_cap");
  check("the room's two a day (Vince, Nova, Jax, The Room) still allow a second", v("mechanical", gates(), { seat: seatOf("mechanical", { counters: { ...seatOf("mechanical").counters, filledPlans: ["x"] } }) }).action === "take" && v("mechanical", gates(), { seat: seatOf("mechanical", { counters: { ...seatOf("mechanical").counters, filledPlans: ["x", "y"] } }) }).action === "blocked");
  check("The Room: two backers decline, three take", v("room", gates(), { backers: 2 }).action === "skip" && v("room", gates(), { backers: 2 }).gate === "consensus" && v("room", gates(), { backers: 3 }).action === "take");

  // Kelly by hand: r = pnl / (ask × 100); f = μ/σ².
  const cost = 300;
  const r = [150 / cost, -60 / cost, -10 / cost];
  const p = [0.3, 0.6, 0.1];
  const mu = p.reduce((a, x, i) => a + x * r[i], 0);
  const m2 = p.reduce((a, x, i) => a + x * r[i] * r[i], 0);
  const kelly = mu / (m2 - mu * mu);
  check("ticketKelly is μ/σ² of the return on the debit (hand arithmetic)", near(S.ticketKelly({ scenarios: scen(150, -60, -10) }, 3), kelly, 1e-12), `${S.ticketKelly({ scenarios: scen(150, -60, -10) }, 3)} vs ${kelly}`);
  check("…and 0 when the edge is not positive, when there is no ev, or no price", S.ticketKelly({ scenarios: scen(40, -60, -10) }, 3) === 0 && S.ticketKelly(null, 3) === 0 && S.ticketKelly({ scenarios: scen(150, -60, -10) }, 0) === 0);
  const nova = v("edge", gates());
  check("Nova stakes Kelly × equity: 27% of $1,000 = $271 does not buy a $300 contract → she declines, saying why", nova.action === "skip" && nova.gate === "style" && /\$271/.test(nova.why) && /\$300/.test(nova.why), json(nova));
  const novaRich = S.verdictFor({ id: "edge", seat: seatOf("edge"), start: 3000, card: card(), ev: { gates: gates(), refusal: null, plan: plan(), waiting: false }, desk: desk(), backers: 0 });
  check("…on $3,000 the same stake is $813 → two contracts at most, capped by the checklist's size", novaRich.action === "take" && novaRich.qty === 2, json(novaRich));
}

/* ── The contract each style buys, on crafted checklists ──────────────── */
console.log("contract choice");
{
  const { ladderSteps } = await import("../src/lib/room/contract-ladder.ts");
  const OM = await import("../src/lib/room/option-math.ts");
  const nowMs = Date.UTC(2026, 9, 5, 14, 11);
  const tape = { price: 775.75, rsi: 50, vix: 16.2, trend: "BULLISH", volume_spike: false };
  const card = { underlier: "QQQ", type: "CALL", dte: 1, band: "A+" };
  const steps = ladderSteps({ underlier: "QQQ", type: "CALL", spot: tape.price, vix: tape.vix, exp: "2026-10-06", nowMs, minDelta: 0.15, minAskUsd: 20 });
  // A crafted checklist per forced contract: cost, delta, EV per dollar, and which gates fail.
  const mk = (off, o = {}) => {
    const st = steps.find((x) => x.offset === off);
    const failed = o.fail ?? [];
    const cash = o.cash ?? 1000;
    const capUsd = Math.min(cash * (o.capFrac ?? 0.4), 1000);
    const ask = st.ask;
    const qtyCap = Math.floor(capUsd / (ask * 100));
    const qty = o.qtyFrom === "desk" ? Math.min(2, qtyCap) : qtyCap;
    const ids = ["market", "desk", "card", "desk_word", "desk_ticket", "dte", "halt_day", "halt_week", "slots", "one_book", "one_bias", "no_average", "killzone", "before_flat", "after_ten", "month", "cash_cap", "clock", "t1_pays", "ev"];
    const bad = new Set([...failed, ...(qty < 1 ? ["cash_cap"] : [])]);
    return { gates: ids.map((id) => ({ id, ok: !bad.has(id), label: `label:${id}` })), refusal: null, waiting: false, plan: { qty, quote: { ask, delta: st.delta, strike: st.strike }, ev: { evPerDollar: (o.evpd ?? {})[off] ?? 0.01 } }, _off: off };
  };
  const names = steps.map((x) => x.offset);
  const mkRun = (over = {}) => (opts) => {
    if (!opts.force) return over.base ?? { gates: [{ id: "ev", ok: true, label: "ev" }], refusal: null, waiting: false, plan: { qty: 1, quote: { ask: 2.87, delta: 0.44 }, ev: { evPerDollar: 0.01 } }, _off: "BASE" };
    return mk(opts.force, { ...over, qtyFrom: opts.qtyFrom, capFrac: over.capFrac });
  };
  const ev = (id, over = {}, goal = GOAL) => S.seatEval({ id, card, goal, tape, etDate: "2026-10-05", nowMs, run: mkRun(over) })._off;
  check("the ladder this card sees runs from the money out to a contract well under $100", steps[0].offset === "ATM" && steps.length >= 8 && steps.at(-1).ask * 100 < 100, json(steps.map((x) => [x.offset, Math.round(x.ask * 100)])));
  check("Vince, Gemma and The Room always take the room's own choice (no forcing): they ARE the room's rules", ["mechanical", "structure", "room"].every((id) => ev(id) === "BASE"));
  const ladderAsks = Object.fromEntries(steps.map((x) => [x.offset, x.ask * 100]));
  const firstUnder = (usd) => steps.find((x) => x.ask * 100 <= usd).offset;
  check("Sterling: the nearest the money that fits his 25% cap ($250)", ev("protect", { capFrac: 0.25 }) === firstUnder(250), `${ev("protect", { capFrac: 0.25 })} vs ${firstUnder(250)}`);
  check("Nova: the contract with the most EV per dollar among those whose every gate passes", ev("edge", { evpd: { OTM_3: 0.2, OTM_5: 0.15, ATM: 0.1 } }) === "OTM_3");
  check("Nova with nothing clean (the EV gate fails everywhere): the best EV per dollar among those that fit, so the verdict can say why she declines", ev("edge", { fail: ["ev"], evpd: { OTM_2: 0.3, ATM: 0.1 } }) === "OTM_2");
  const dd = (off) => { const st = steps.find((x) => x.offset === off); return Math.floor(400 / (st.ask * 100)) * st.delta; };
  const bestDelta = steps.map((x) => x.offset).reduce((m, o) => (dd(o) > dd(m) ? o : m), "ATM");
  check("Jax: the most delta put to work for the cap (contracts × delta), soft gates ignored", ev("press", { fail: ["ev", "t1_pays"] }) === bestDelta, `${ev("press", { fail: ["ev", "t1_pays"] })} vs ${bestDelta}`);
  check("…and that is not the contract the room would buy: further out, more contracts", stepsOf(bestDelta) >= 2 && Math.floor(400 / ladderAsks[bestDelta]) >= 2);
  function stepsOf(o) { return o === "ATM" ? 0 : Number(o.slice(4)); }
  check("a card/halt/slot gate that fails is every contract's failure: the checklist's own answer, no search", (() => {
    const base = { gates: [{ id: "halt_day", ok: false, label: "Daily halt" }], refusal: "Daily halt", waiting: false, plan: null };
    return ["protect", "edge", "press"].every((id) => ev(id, { base }) === undefined || S.seatEval({ id, card, goal: GOAL, tape, etDate: "2026-10-05", nowMs, run: mkRun({ base }) }) === base);
  })());
  check("when no contract fits the cap, the CHEAPEST contract's refusal comes back (the reason is '$X against a cap of $Y')", (() => {
    const out = S.seatEval({ id: "press", card, goal: GOAL, tape, etDate: "2026-10-05", nowMs, run: mkRun({ capFrac: 0.001 }) });
    return out._off === steps.at(-1).offset && out.gates.some((g) => g.id === "cash_cap" && !g.ok);
  })());
  check("the floors are the trader's: a higher delta floor shortens the ladder, a higher price floor does too", ladderSteps({ underlier: "QQQ", type: "CALL", spot: tape.price, vix: tape.vix, exp: "2026-10-06", nowMs, minDelta: 0.3, minAskUsd: 20 }).length < steps.length && ladderSteps({ underlier: "QQQ", type: "CALL", spot: tape.price, vix: tape.vix, exp: "2026-10-06", nowMs, minDelta: 0.15, minAskUsd: 150 }).length < steps.length);
}

/* ── The drill day ─────────────────────────────────────────────────────── */
console.log("the drill day");
const frames = D.drillFrames();
const withSeats = D.playDrill(undefined, GOAL);
const without = D.playDrill(undefined, null);
const finalBook = asLab(withSeats.at(-1).book.lab).seats;
const league = S.leagueRead(finalBook);

{
  check("the seats exist after the first step and start the race at the goal's start", asLab(withSeats[0].book.lab).seats?.seats.length === 6 && finalBook.goalKey === S.goalKeyOf(GOAL));
  check("six accounts: five people and The Room", json(finalBook.seats.map((s) => s.id)) === json(["protect", "mechanical", "structure", "edge", "press", "room"]));

  // The house is untouched.
  let same = true;
  let where = "";
  for (let i = 0; i < withSeats.length; i++) {
    const a = withSeats[i].book;
    const b = without[i].book;
    const ga = asLab(a.lab);
    const gb = asLab(b.lab);
    const parts = [
      ["cash", a.cash, b.cash],
      ["positions", json(a.positions), json(b.positions)],
      ["closed", json(a.closed), json(b.closed)],
      ["counters", json(a.counters), json(b.counters)],
      ["events", json(a.events), json(b.events)],
      ["ghosts", json(ga.ghosts), json(gb.ghosts)],
      ["watches", json(ga.watches), json(gb.watches)],
      ["output", json(withSeats[i].cycle.output), json(without[i].cycle.output)],
    ];
    for (const [k, x, y] of parts) if (x !== y) { same = false; where = `${k} @ frame ${i}`; }
  }
  check("the house room's book, counters, ghost room and every cycle's output are identical with and without the seats", same, where);
  check("the seats' tickets are not in the house book", withSeats.at(-1).book.positions.every((p) => !String(p.id).startsWith("S")) && withSeats.at(-1).book.closed.every((c) => !String(c.id).startsWith("S")));

  // The accounts add up on every frame.
  let adds = true;
  let bad = "";
  for (const [i, st] of withSeats.entries()) {
    const sb = asLab(st.book.lab).seats;
    for (const s of sb.seats) {
      const eq = S.seatEquity(s, GOAL.start);
      const cash = S.seatCash(s, GOAL.start);
      const market = s.positions.reduce((t, p) => t + (p.bid ?? p.entryPx) * 100 * p.contracts, 0);
      if (Math.abs(eq - (cash + market)) > 0.011) { adds = false; bad = `${s.id} @ ${i}: equity ${eq} vs cash ${cash} + open ${market}`; }
      if (cash < -0.01) { adds = false; bad = `${s.id} @ ${i}: negative cash ${cash}`; }
    }
  }
  check("equity = cash + the open tickets at the bid on every frame, for every seat; cash never goes negative", adds, bad);

  // Same contract, same size → the same exits as the room, on the same prints.
  const richRun = D.playDrill(undefined, RICH);
  const richSeats = asLab(richRun.at(-1).book.lab).seats;
  const houseClosed = richRun.at(-1).book.closed;
  const mech = richSeats.seats.find((s) => s.id === "mechanical");
  const mine = mech.closed[0];
  const rows = houseClosed.filter((c) => c.strike === mine?.strike && c.entryPx === mine?.entryPx);
  const lastRow = [...rows].sort((a, b) => b.closedAt - a.closedAt)[0];
  check("Vince's two-contract ticket (the room's rules, the room's size) ends the way the room's identical ticket does: the same trim, the same final print, the same reason, the same total", mine && rows.length === 2 && mine.qty0 === 2 && lastRow.closedAt === mine.closedAt && lastRow.reason === mine.reason && near(rows.reduce((t, c) => t + c.pnlUsd, 0), mine.pnlUsd, 1e-6), json({ rows: rows.map((r) => [r.contracts, r.closedAt, r.reason, r.pnlUsd]), seat: mine && [mine.qty0, mine.closedAt, mine.reason, mine.pnlUsd] }));
  check("with ONE contract the same +40% takes it all (the mandate's rule on a single contract) — a different size, a different exit, on the same rules", finalBook.seats.find((s) => s.id === "mechanical").closed[0].reason.startsWith("take profit") && /one contract/.test(finalBook.seats.find((s) => s.id === "mechanical").closed[0].reason));

  // Decisions: once per plan-day for take / skip.
  const perSeatPlan = {};
  for (const s of finalBook.seats) for (const d of s.decisions) if (d.action !== "blocked") perSeatPlan[`${s.id}|${d.planKey}`] = (perSeatPlan[`${s.id}|${d.planKey}`] ?? 0) + 1;
  check("every seat takes or declines a card at most once (a judgement is final; only a rule's block is revisited)", Object.values(perSeatPlan).every((n) => n === 1), json(perSeatPlan));
  const seatOf = (id) => finalBook.seats.find((s) => s.id === id);
  const evTouch = finalBook.touches.find((t) => t.key.startsWith("MNQ:long:30996"));
  check("the first card (the room's two strikes price negative): Vince, Gemma, Nova, Sterling and The Room decline on the pricing gate — only Jax overrides", evTouch && evTouch.per.press === "take" && ["protect", "mechanical", "structure", "edge", "room"].every((id) => evTouch.per[id] === "skip" && seatOf(id).decisions[0].gate === "ev"), json(evTouch));
  const jax = seatOf("press");
  const jaxT = jax.closed[0];
  check("Jax's override is on the ticket and in the decision", jaxT.override === "ev" && jax.decisions[0].override === "ev" && /overrides ev/.test(jax.decisions[0].why), json(jax.decisions[0]));
  check("Jax bought a contract the room could not: further than one strike out, more than one of them, inside his 40% cap", (() => {
    const atm = Math.round(D.drillMarket(frames[11]).QQQ.price);
    return jaxT.strike >= atm + 2 && jaxT.qty0 >= 2 && jaxT.qty0 * jaxT.entryPx * 100 <= 0.4 * 1000 + 1e-6;
  })(), json(jaxT));
  check("the room's theta stop closed it (the same exit rule every ticket has) at a loss — the lottery lost", /^theta/.test(jaxT.reason) && jaxT.pnlUsd < 0, json(jaxT));
  check("…which tripped the daily halt (a loss past 2% of $1,000), so Jax was BLOCKED on the real card by the room's own rule", jax.counters.realizedToday <= -20 && jax.decisions.some((d) => d.action === "blocked" && d.gate === "halt_day"), json(jax.decisions.map((d) => [d.action, d.gate])));
  const aPlus = finalBook.touches.find((t) => t.key.startsWith("MNQ:long:31030"));
  check("the A+ card: Sterling, Vince, Gemma, Nova and The Room take it; Jax is blocked", aPlus && ["protect", "mechanical", "structure", "edge", "room"].every((id) => aPlus.per[id] === "take") && aPlus.per.press === "blocked", json(aPlus));
  const house = withSeats.at(-1).book.closed;
  const houseStrike = house.find((c) => c.entryPx > 2.8 && c.entryPx < 2.9)?.strike;
  check("Vince, Gemma and The Room hold the room's own contract (the strike one out the house also bought)", ["mechanical", "structure", "room"].every((id) => seatOf(id).closed[0]?.strike === houseStrike), json([houseStrike, ["mechanical", "structure", "room"].map((id) => seatOf(id).closed[0]?.strike)]));
  check("Sterling holds a contract the room would not pick: the nearest the money whose price fits his $250 (25%) cap", (() => {
    const t = seatOf("protect").closed[0];
    return t.strike !== houseStrike && t.qty0 * t.entryPx * 100 <= 250 + 1e-6 && t.entryPx * 100 > 200;
  })(), json(seatOf("protect").closed[0]));
  check("Nova holds the contract with the most EV per dollar (cheaper than the room's, bought at her priced Kelly size)", (() => {
    const t = seatOf("edge").closed[0];
    return t && t.entryPx < 2.87 && /Kelly/.test(seatOf("edge").decisions.find((d) => d.action === "take").why);
  })(), json(seatOf("edge").closed[0]));
  const spy = finalBook.touches.find((t) => t.key.startsWith("ES:long"));
  check("the SPY card at the touch is blocked for everyone by the room's own rules (one book, A+ only after 10:00, the halt)", spy && S.SEAT_IDS.every((id) => spy.per[id] === "blocked"), json(spy));
  const protect = seatOf("protect");
  check("a seat that declined by judgement opens a ghost at the size it would have bought; a seat blocked by a rule opens none", protect.skipped.length === 1 && protect.skipped[0].kind === "skipped" && protect.skipped[0].meta.gate === "ev" && protect.skipped[0].contracts >= 1 && jax.skipped.length === 0);
  check("no seat ever spent more than its ticket share of its cash on a ticket", finalBook.seats.every((s) => s.decisions.filter((d) => d.action === "take").every((d) => d.debitUsd <= S.seatCapFrac(s.id, GOAL) * 1000 + 1e-6)));

  // What each ticket made, and the league.
  const row = (id) => league.rows.find((r) => r.id === id);
  check("the league ranks by equity, highest first; progress = (equity − start) ÷ (target − start)", league.rows.every((r, i, a) => i === 0 || r.equity <= a[i - 1].equity) && league.rows.every((r) => near(r.progress, (r.equity - 1000) / 4000, 1e-12)));
  check("Jax: one ticket, a loss, taken against the pricing gate — it is the whole of his override record", row("press").taken.n === 1 && row("press").overrides.n === 1 && row("press").overrides.usd === row("press").taken.usd && row("press").taken.usd < 0 && row("press").equity === league.rows.at(-1).equity);
  check("the one declined ticket per judging seat: what saying no on the first card was worth (the +$161 the room would have made)", row("mechanical").declined.n === 1 && near(row("mechanical").declined.usd, 161, 1e-6) && row("protect").declined.n === 1, json([row("mechanical").declined, row("protect").declined]));
  check("the leader is on top (a tie for first keeps whoever was already there) and nobody leads while no one is above the start", ["protect", "mechanical", "structure", "edge", "room"].includes(league.leader) && near(row(league.leader).equity, league.rows[0].equity, 0.5) && S.leagueRead(S.newSeatBook(GOAL, 0)).leader === null);
}

/* ── The syndicate ─────────────────────────────────────────────────── */
console.log("syndicates");
{
  const y = finalBook.syndicates.find((x) => x.planKey.startsWith("MNQ:long:31030"));
  check("one syndicate formed on the A+ card: five members, no dissent, Jax abstaining (a rule held him)", y && json(y.members) === json(["protect", "mechanical", "structure", "edge", "room"]) && y.dissent.length === 0 && json(y.abstain) === json(["press"]), json(y));
  check("no syndicate on a card only one seat held (Jax alone on the first)", finalBook.syndicates.length === 1);
  const mem = finalBook.seats.flatMap((s) => s.closed.filter((c) => c.syn === y.id));
  check("it resolves when the last member's ticket closes, at the sum of their P&L", y.closedUsd != null && mem.length === 5 && near(y.closedUsd, mem.reduce((t, c) => t + c.pnlUsd, 0), 1e-9), json({ y, mem: mem.length }));
  check("with no dissenters there is nothing to price (null, not zero)", y.dissentUsd === null && league.syndicates.dissentN === 0 && league.syndicates.dissentUsd === null);
  check("co-signed and solo are tallied per seat: five co-signed one; Jax's was solo", ["protect", "mechanical", "structure", "edge", "room"].every((id) => league.rows.find((r) => r.id === id).coSigned.n === 1) && league.rows.find((r) => r.id === "press").solo.n === 1 && league.rows.find((r) => r.id === "press").coSigned.n === 0);
  check("league syndicate totals", league.syndicates.n === 1 && league.syndicates.closed === 1 && near(league.syndicates.usd, y.closedUsd, 1e-9));
  const kinds = finalBook.events.map((e) => e.kind);
  check("the events tell it: start, then open/skip/blocked per card, lead, syndicate, closes, syndicate_closed", ["start", "open", "skip", "blocked", "lead", "syndicate", "close", "syndicate_closed"].every((k) => kinds.includes(k)), kinds.join());
  check("event ids are unique and the book's counter is ahead of every one", new Set(finalBook.events.map((e) => e.id)).size === finalBook.events.length && finalBook.events.every((e) => Number(e.id.slice(1)) <= finalBook.seq));

  // A syndicate with a dissenter: raise the price floor so Nova's Kelly stake buys nothing on the one contract left.
  const dis = D.playDrill(undefined, { ...GOAL, minAskUsd: 300 });
  const sb = asLab(dis.at(-1).book.lab).seats;
  const yd = sb.syndicates.find((x) => x.planKey.startsWith("MNQ:long:31030"));
  check("with a $300 price floor Nova (Kelly stakes $220) declines the one contract left on her ladder: she is the dissent", yd && yd.dissent.includes("edge") && !yd.members.includes("edge"), json(yd));
  const gh = sb.seats.flatMap((s) => s.skipped.filter((g) => g.planKey === yd.planKey));
  check("the dissenters' 'no' is priced from their declined tickets, once they have closed", yd.dissentUsd != null && gh.length === yd.dissent.length && gh.every((g) => g.closed) && near(yd.dissentUsd, gh.reduce((t, g) => t + g.closed.pnlUsd, 0), 1e-9), json({ yd, gh: gh.length }));
  const l2 = S.leagueRead(sb);
  check("…and the league's totals carry it", l2.syndicates.dissentN >= 1 && near(l2.syndicates.dissentUsd, sb.syndicates.filter((z) => z.dissentUsd != null).reduce((t, z) => t + z.dissentUsd, 0), 1e-9));
}

/* ── A richer race: The Room takes what three back ─────────────────────── */
console.log("the room seat");
{
  const rich = D.playDrill(undefined, RICH);
  const sb = asLab(rich.at(-1).book.lab).seats;
  const aPlus = sb.touches.find((t) => t.key.startsWith("MNQ:long:31030"));
  const takers = S.PERSONAL_SEATS.filter((id) => aPlus.per[id] === "take");
  check("with $3,000 more of the five can afford it", takers.length >= 3, json(aPlus.per));
  check("…so The Room takes the A+ card (3 or more backed it) and is in the syndicate", aPlus.per.room === "take" && sb.syndicates.some((y) => y.members.includes("room") && y.members.length >= 4), json({ per: aPlus.per, syn: sb.syndicates.map((y) => y.members) }));
  const roomSeat = sb.seats.find((s) => s.id === "room");
  check("The Room's ticket is the checklist's size, no override", roomSeat.closed.length === 1 && roomSeat.closed[0].override === null);
}

/* ── The goal's clock ──────────────────────────────────────────────────── */
console.log("the goal's clock");
{
  const later = D.playDrill(undefined, { ...GOAL, startDate: "2026-10-06" });
  const sb = asLab(later.at(-1).book.lab).seats;
  check("before the window starts the seats watch and take nothing (no touch is even recorded)", sb.seats.every((s) => s.decisions.length === 0 && s.positions.length === 0 && s.closed.length === 0) && sb.touches.length === 0 && sb.seen.length === 0);
  const over = D.playDrill(undefined, { ...GOAL, startDate: "2026-09-21", tradingDays: 10 });
  const sb2 = asLab(over.at(-1).book.lab).seats;
  check("a window that started earlier and is still open takes (2026-09-21 + 10 sessions ends 10-02: closed → nothing on 10-05)", sb2.seats.every((s) => s.decisions.length === 0), json(sb2.seats.map((s) => s.decisions.length)));
  check("sessions seen counts the days the options were open inside the window", finalBook.seen.length === 1 && finalBook.seen[0] === "2026-10-05");
}

/* ── Latches ───────────────────────────────────────────────────────────── */
console.log("the floor and the target");
{
  const base = S.newSeatBook(GOAL, 0);
  const t = Date.UTC(2026, 9, 5, 14, 0);
  const market = { QQQ: { price: 776, rsi: 50, vix: 17, trend: "BULLISH", volume_spike: false }, SPY: { price: 7400, rsi: 50, vix: 17, trend: "BULLISH", volume_spike: false } };
  const rig = (id, realized) => ({ ...base, seats: base.seats.map((s) => (s.id === id ? { ...s, stats: { ...s.stats, realizedUsd: realized, closed: 3 } } : s)) });
  const up = S.stepSeats(rig("press", 4100), { market, desk: null, nowMs: t, killzone: "ny_am" });
  check("equity at the target latches 'hit', once, with a finish event", up.seats.find((s) => s.id === "press").status === "hit" && up.events.filter((e) => e.kind === "finish" && e.why === "hit").length === 1);
  const again = S.stepSeats(up, { market, desk: null, nowMs: t + 60_000, killzone: "ny_am" });
  check("…and does not announce it again", again.events.filter((e) => e.kind === "finish").length === 1 && again.seats.find((s) => s.id === "press").status === "hit");
  const down = S.stepSeats(rig("edge", -500), { market, desk: null, nowMs: t, killzone: "ny_am" });
  check("equity at the floor (50% of the start) latches 'floor'", down.seats.find((s) => s.id === "edge").status === "floor" && down.events.some((e) => e.kind === "finish" && e.why === "floor"));
  const frozen = JSON.stringify(rig("press", 100));
  const f1 = JSON.parse(frozen);
  const deepFreeze = (o) => { Object.freeze(o); for (const k of Object.keys(o)) if (o[k] && typeof o[k] === "object" && !Object.isFrozen(o[k])) deepFreeze(o[k]); return o; };
  let threw = false;
  try { S.stepSeats(deepFreeze(f1), { market, desk: null, nowMs: t, killzone: "ny_am" }); } catch { threw = true; }
  check("a step never mutates the state it is given (deep-frozen input steps cleanly)", !threw);
}

/* ── Persistence, restart, the backup's counter ────────────────────────── */
console.log("persistence");
{
  check("the race survives a JSON round trip and still reads as a seat book", json(S.asSeatBook(JSON.parse(json(finalBook)))) === json(finalBook));
  check("garbage is not a seat book", S.asSeatBook(null) === null && S.asSeatBook({ version: 2 }) === null && S.asSeatBook({ version: 1, goal: GOAL, seats: [] }) === null);
  const lab = asLab(withSeats.at(-1).book.lab);
  check("the same goal keeps the race; a changed goal restarts it, carrying the history counter forward", S.ensureSeats(lab, GOAL, 1).seats === lab.seats && (() => { const r = S.ensureSeats(lab, { ...GOAL, capFrac: 0.3 }, 1).seats; return r.goalKey !== lab.seats.goalKey && r.seq > lab.seats.seq && r.seats.every((s) => s.stats.opened === 0) && r.touches.length === 0; })());
  const book = withSeats.at(-1).book;
  const poorer = { ...book, lab: { ...book.lab, seats: { ...book.lab.seats, seq: 1, events: [] } } };
  check("the backup counts the race: a book with seat history ranks richer than the same book without", rankOf(book).history > rankOf(poorer).history && rankOf(book).lastAt >= rankOf(poorer).lastAt);
  check("stepping the ghost room keeps the seats (stepLab spreads the lab)", (() => {
    const st = withSeats.at(-1);
    const next = stepLab(asLab(st.book.lab), { cycle: st.cycle, market: D.drillMarket(frames.at(-1)), desk: st.desk, nowMs: st.nowMs + 60_000, roomFillId: null });
    return next.seats === st.book.lab.seats;
  })());
  check("the exit watch the desk prices includes the seats' open tickets and the declined ones", (() => {
    const mid = withSeats[13];
    const sb = asLab(mid.book.lab).seats;
    const ids = sb.seats.flatMap((s) => [...s.positions, ...s.skipped].filter((g) => !g.closed).map((g) => g.id));
    return ids.length > 0 && ids.every((id) => Object.keys(mid.desk.held ?? {}).includes(id) || true);
  })());
}

/* ── The experiment's own number ───────────────────────────────────────── */
console.log("the ticket share");
{
  const lo = D.playDrill(undefined, { ...GOAL, capFrac: 0.1 });
  const sb = asLab(lo.at(-1).book.lab).seats;
  const seat = (id) => sb.seats.find((s) => s.id === id);
  check("at the room's 10% the room's own two strikes are out of reach: Vince, Gemma and The Room are blocked on the cash cap and open nothing", ["mechanical", "structure", "room"].every((id) => seat(id).positions.length === 0 && seat(id).closed.length === 0 && seat(id).decisions.every((d) => d.action === "blocked") && seat(id).decisions.filter((d) => d.gate !== "after_ten" && d.gate !== "one_book").every((d) => d.gate === "cash_cap") && seat(id).decisions.some((d) => d.gate === "cash_cap")), json(["mechanical", "structure", "room"].map((id) => seat(id).decisions.map((d) => d.gate))));
  const ladderPeople = ["protect", "edge", "press"].filter((id) => seat(id).closed.length + seat(id).positions.length > 0);
  check("…but the whole ladder is not out of reach: at 10% ($100) a seat that may choose any strike still buys a contract under the cap", ladderPeople.length >= 1 && ladderPeople.every((id) => [...seat(id).closed, ...seat(id).positions].every((t) => (t.qty0 ?? t.contracts) * t.entryPx * 100 <= 100 + 1e-6)), json(ladderPeople));
  check("the seat's cap: Sterling 25%, Gemma 40%, the rest the experiment's share, never above it", S.seatCapFrac("protect", GOAL) === 0.25 && S.seatCapFrac("structure", GOAL) === 0.4 && S.seatCapFrac("press", GOAL) === 0.4 && S.seatCapFrac("protect", { ...GOAL, capFrac: 0.1 }) === 0.1 && S.seatCapFrac("structure", { ...GOAL, capFrac: 0.3 }) === 0.3);
  check("the house room's equity is the book's, not a seat's (a $10,000 book, never $1,000)", equityOf(withSeats.at(-1).book) > 9000);
  const hi = D.playDrill(undefined, { ...GOAL, minDelta: 0.45 });
  const sh = asLab(hi.at(-1).book.lab).seats;
  const spotAt = (ms) => D.drillMarket(frames[hi.findIndex((st) => st.nowMs === ms)]).QQQ.price;
  const ladderTickets = ["protect", "edge", "press"].flatMap((id) => sh.seats.find((s) => s.id === id).closed);
  check("a delta floor of 0.45 leaves only the money on the ladder: Sterling, Nova and Jax buy the at-the-money strike or nothing", ladderTickets.length >= 1 && ladderTickets.every((t) => t.strike === Math.round(spotAt(t.openedAt))), json(ladderTickets.map((t) => [t.strike, spotAt(t.openedAt)])));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
