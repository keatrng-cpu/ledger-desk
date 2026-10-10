/**
 * The investment wing (the Invest tab's long game, as the Floor's five act it out) against its contract.
 *
 *   npx tsx scripts/verify-invest-office.mjs              # checks
 *   npx tsx scripts/verify-invest-office.mjs --transcript # also print what the five say over a weekday
 *
 * WHY: the trader asked for an office where the five manage a mid-to-long-term portfolio — analytics, arithmetic, news,
 * industry research, a boardroom and a chair — funded by a share of day-trading income and other income. The risk is the one the
 * rest of the desk already learned: a room that talks about money invents it. So this proves, with the REAL research file, the
 * REAL Invest functions and the REAL talk engine and drawers, that:
 *
 *   - the wing exists in the layout, every spot the voices send people to is there, every screen has a drawer;
 *   - the research file obeys the desk's rules at the door (a sourced, dated demand figure per theme; no wash-sale name; three
 *     tiers; no recommendation language) and a theme that breaks one is dropped, not shown;
 *   - the office's numbers are the Invest tab's own functions' numbers (a differential check, not a restatement) and the
 *     "other income" line is arithmetic that never moves money;
 *   - what the five say quotes only numbers code produced, is legal for each person, never uses a desk verdict word or a
 *     recommendation, stays out of the NY AM live window, fires once per day per topic, and replays identically;
 *   - what the screens draw is the same read, valued at cost and saying so.
 *
 * Pure: no network, no real clock, no model.
 */
import fs from "node:fs";

const { talkTick, freshTalkState } = await import("../src/lib/room/live-talk.ts");
const { Facts } = await import("../src/lib/room/live-types.ts");
const { ANIMS_BY_CHARACTER } = await import("../src/lib/room/orchestrator.ts");
const { buildInvest, floorWords } = await import("../src/lib/room/invest-office.ts");
const { RESEARCH, usableThemes, themeProblem } = await import("../src/lib/room/invest-themes.ts");
const IR = await import("../src/lib/room/invest-read.ts");
const IV = await import("../src/lib/room/live-voices-invest.ts");
const { buildBook, rebalanceCheck, nextBuy, DRIFT_BAND } = await import("../src/lib/invest/book.ts");
const { rateLadder, deployQueue, contributionPath } = await import("../src/lib/invest/policy.ts");
const { WASH_SALE_BANNED } = await import("../src/lib/invest/universe.ts");
const { ALL_DOSSIERS, RISK_FREE } = await import("../src/lib/invest/dossiers.ts");
const { catalystsFor, CATALYST_WINDOW_DAYS, TAB_TAIL, FLOOR_TAIL } = await import("../src/lib/room/invest-office.ts");
const { LONG_NAMES } = await import("../src/lib/invest/long-board.ts");
const { drawScreen } = await import("../src/components/room/floor-screens.ts");
const { etWallParts } = await import("../src/lib/trading/sessions.ts");
const { etDateOf } = await import("../src/lib/room/option-math.ts");

const { spokenProblems } = await import("./lib/spoken-check.mjs");
/** Every line the wing says in the simulations below — checked at the end for what a speech engine would be handed. */
const SPOKEN = [];
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
const etMinOf = (ms) => {
  const p = etWallParts(ms);
  return p.hour * 60 + p.minute;
};
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const SPOT_OK = /^(inv_(cio|scout|news|struct|wall)|board_(chair|tv|tv2|north)|chair_desk)$/;
const VERDICT_WORDS = /\b(TAKE|STAND|MANAGE|PATH)\b/;
const ADVICE = /\b(i|we) recommend\b|\byou should\b|\bshould (buy|sell|own|add)\b|\bwill (outperform|beat the market|rally|double)\b|(?<!\b(?:not|no|never) )\bguarantee|\bundervalued\b|\bovervalued\b|\bcan'?t lose\b|\brisk-free\b|\bprice target\b/i;
const legal = (item) => {
  const bad = [];
  for (const l of item.lines) {
    if (!ANIMS_BY_CHARACTER[l.character]?.includes(l.animation)) bad.push(`${l.character} cannot ${l.animation}`);
    if (!l.text.trim()) bad.push(`${l.character} said nothing`);
    if (l.animation === "SMASHING_ENTER_KEY") bad.push("a talk line must never send an order");
    if (l.text.split(/\s+/).length > 42) bad.push(`a line of ${l.text.split(/\s+/).length} words: ${l.text.slice(0, 40)}…`);
    if (VERDICT_WORDS.test(l.text)) bad.push(`desk verdict word in "${l.text.slice(0, 50)}"`);
    if (ADVICE.test(l.text)) bad.push(`advice language in "${l.text.slice(0, 50)}"`);
  }
  for (const [who, m] of Object.entries(item.moves)) {
    if (m.zone !== "ANNEX") bad.push(`${who}: an investment move must be an annex spot`);
    if (!SPOT_OK.test(m.spot ?? "")) bad.push(`${who}: spot ${m.spot} is not a wing spot`);
  }
  if (item.urgency === 2) bad.push("the long game never drops everything");
  return bad;
};

/* ── The wing in the layout ────────────────────────────────────────────── */
console.log("the wing");
const LAYOUT = JSON.parse(fs.readFileSync(new URL("../src/data/floor-layout.json", import.meta.url), "utf8"));
{
  const roomIds = LAYOUT.rooms.map((r) => r.id);
  for (const id of ["invest_floor", "boardroom", "chair_office"]) check(`room ${id} exists`, roomIds.includes(id));
  const voiceSrc = fs.readFileSync(new URL("../src/lib/room/live-voices-invest.ts", import.meta.url), "utf8");
  const spots = [...new Set([...voiceSrc.matchAll(/AT\("([a-z0-9_]+)"\)/g)].map((m) => m[1]))];
  check("the voices send people to at least the nine wing spots", spots.length >= 9, spots.join());
  check("every spot a voice uses exists in the layout", spots.every((s) => LAYOUT.spots[s]), spots.filter((s) => !LAYOUT.spots[s]).join());
  check("every spot a voice uses is a legal wing spot", spots.every((s) => SPOT_OK.test(s)), spots.join());
  const screenIds = new Set(LAYOUT.screens.map((s) => s.id));
  const WING = ["tv_portfolio", "tv_funnel", "tv_theme", "tv_board", "mon_Inv_0", "mon_Inv_1", "mon_Inv_2", "mon_Inv_3", "mon_Chair_0", "plate_Inv", "plate_Board", "plate_Chair"];
  check("all twelve wing screens are in the layout", WING.every((s) => screenIds.has(s)), WING.filter((s) => !screenIds.has(s)).join());
  const inBounds = LAYOUT.screens.filter((s) => WING.includes(s.id)).every((s) => s.center[0] >= LAYOUT.bounds.x[0] && s.center[0] <= LAYOUT.bounds.x[1] && s.center[2] >= LAYOUT.bounds.z[0] && s.center[2] <= LAYOUT.bounds.z[1]);
  check("the wing's screens sit inside the layout bounds", inBounds);
  check("the layout reaches the wing's south wall", LAYOUT.bounds.z[1] >= 17.4, String(LAYOUT.bounds.z[1]));
  check("both wing cameras exist", Boolean(LAYOUT.camera.invest) && Boolean(LAYOUT.camera.boardroom));
  const crewSpots = ["inv_cio", "inv_scout", "inv_news", "inv_struct"].map((k) => LAYOUT.spots[k]);
  check("four research desks seat the four of the crew who work them", crewSpots.every((s) => s && s.pose === "sit"));
  check("the chair's seat is a seat", LAYOUT.spots.chair_desk?.pose === "sit" && LAYOUT.spots.board_chair?.pose === "sit");
}

/* ── The research file, at the door ────────────────────────────────────── */
console.log("the research file");
const ALL = RESEARCH.themes ?? [];
const THEMES = usableThemes();
{
  check("it is dated, and not in the future", /^\d{4}-\d{2}-\d{2}$/.test(RESEARCH.asOf) && RESEARCH.asOf <= "2026-10-06", RESEARCH.asOf);
  check("it describes its three tiers", ["safe", "mid", "high"].every((t) => typeof RESEARCH.tiers?.[t] === "string" && RESEARCH.tiers[t].length > 10));
  check("every theme in the file passes the door (nothing is silently dropped)", ALL.length === THEMES.length, ALL.filter((t) => themeProblem(t)).map((t) => `${t.id}: ${themeProblem(t)}`).join("; "));
  check("at least nine themes, at least three in each tier", THEMES.length >= 9 && ["safe", "mid", "high"].every((t) => THEMES.filter((x) => x.tier === t).length >= 3), ["safe", "mid", "high"].map((t) => `${t}=${THEMES.filter((x) => x.tier === t).length}`).join());
  check("theme ids are unique", new Set(THEMES.map((t) => t.id)).size === THEMES.length);
  check("every demand fact is figure + year + source name + https URL", THEMES.every((t) => t.demand.every((d) => /\d/.test(d.figure) && /\b20(2[3-6])\b/.test(d.asOf) && d.sourceName.length > 2 && /^https:\/\//.test(d.source))));
  check("every theme names at least two competitors and at least one risk and one innovation", THEMES.every((t) => t.competitors.length >= 2 && t.risks.length >= 1 && t.innovations.length >= 1), THEMES.filter((t) => t.competitors.length < 2 || !t.risks.length || !t.innovations.length).map((t) => t.id).join());
  const banned = new Set(Object.keys(WASH_SALE_BANNED));
  check("no vehicle is on the wash-sale list (QQQ, QQQM, SPY, VOO, IVV, SPLG)", THEMES.every((t) => t.vehicles.every((v) => !banned.has(v.ticker.toUpperCase()))));
  check("every theme has a vehicle, and a vehicle is a fund or a stock", THEMES.every((t) => t.vehicles.length >= 1 && t.vehicles.every((v) => v.kind === "fund" || v.kind === "stock")));
  const blob = (t) => [t.name, t.summary, ...t.innovations, ...t.risks, ...t.demand.map((d) => d.claim), ...t.competitors.map((c) => c.angle), ...t.vehicles.map((v) => v.note)].join(" · ");
  check("no theme talks like a recommendation", THEMES.every((t) => !ADVICE.test(blob(t))), THEMES.filter((t) => ADVICE.test(blob(t))).map((t) => `${t.id}: ${blob(t).match(ADVICE)?.[0]}`).join("; "));
  // The door itself: a theme that breaks a rule is dropped.
  const t0 = THEMES[0];
  const clone = (patch) => ({ ...t0, ...patch });
  check("the door drops a theme with a banned vehicle", themeProblem(clone({ vehicles: [{ ticker: "QQQ", kind: "fund", note: "x" }] })) != null);
  check("the door drops a demand fact with no source URL", themeProblem(clone({ demand: [{ ...t0.demand[0], source: "" }] })) != null);
  check("the door drops a demand fact with no figure", themeProblem(clone({ demand: [{ ...t0.demand[0], figure: "" }] })) != null);
  check("the door drops a theme with no competitors", themeProblem(clone({ competitors: [] })) != null);
  check("the door drops a tier it does not know", themeProblem(clone({ tier: "wild" })) != null);
}

/* ── The office's numbers are the Invest tab's numbers ─────────────────── */
console.log("the office's numbers");
const NOW = at(2026, 10, 6, 13, 0); // Tue 13:00 ET
const DAY = "2026-10-06";
const heldTicker = (THEMES.find((t) => t.tier === "mid") ?? THEMES[0]).vehicles[0].ticker;
const POSITIONS = [
  { ticker: "VTI", sleeve: "ballast", shares: 6.5, costUsd: 1800, openedAt: "2026-05-04" },
  { ticker: "SGOV", sleeve: "drypowder", shares: 12, costUsd: 1200, openedAt: "2026-06-02" },
  { ticker: heldTicker, sleeve: "compounder", shares: 2, costUsd: 600, openedAt: "2026-07-06" },
];
const SWEEPS = [
  { month: "2026-07", realizedUsd: 900, verdict: "SWEEP", sweptUsd: 100, loggedAt: "2026-08-03T12:00:00Z" },
  { month: "2026-08", realizedUsd: 1100, verdict: "SWEEP", sweptUsd: 140.5, loggedAt: "2026-09-03T12:00:00Z" },
];
function inputsFor({ positions = POSITIONS, sweeps = SWEEPS, boughtWithSweep = 0, other = null, dayKey = DAY } = {}) {
  const book = buildBook(positions, {}, NOW);
  const queue = deployQueue(sweeps, boughtWithSweep, NOW);
  return {
    dayKey,
    book,
    reb: rebalanceCheck(book),
    ladder: rateLadder(sweeps),
    queue,
    next: nextBuy(book, queue.waitingUsd, new Set(positions.map((p) => p.ticker))),
    held: positions.map((p) => p.ticker),
    sweptMonthly: sweeps.map((s) => s.sweptUsd),
    other,
  };
}
const INV = buildInvest(inputsFor({ other: { monthlyUsd: 1500, ratePct: 20 } }));
{
  const i = inputsFor({ other: { monthlyUsd: 1500, ratePct: 20 } });
  const avg = (100 + 140.5) / 2;
  check("the funnel's rate is the ladder's rate", INV.funnel.ratePct === Math.round(i.ladder.rate * 100) && INV.funnel.closedMonths === 2);
  check("swept and waiting are the deploy queue's", INV.funnel.sweptUsd === i.queue.sweptUsd && INV.funnel.waitingUsd === i.queue.waitingUsd && INV.funnel.sweptUsd === 240.5, `${INV.funnel.sweptUsd}/${INV.funnel.waitingUsd}`);
  check("the average sweep is the mean of the logged sweeps", Math.abs(INV.funnel.avgMonthlyUsd - avg) < 0.01, String(INV.funnel.avgMonthlyUsd));
  check("five and ten years are contributionPath's, contributions only", INV.funnel.fiveYearUsd === contributionPath(avg, 5).totalUsd && INV.funnel.tenYearUsd === contributionPath(avg, 10).totalUsd && Math.abs(INV.funnel.tenYearUsd - avg * 120) < 0.01);
  check("the book total is the cost of what is held, valued at cost", INV.book.totalUsd === 3600 && INV.book.valuedAtCost === true && INV.book.positions === 3, JSON.stringify(INV.book));
  check("sleeve weights sum to one", Math.abs(INV.book.sleeves.reduce((s, x) => s + x.weight, 0) - 1) < 1e-9);
  check("beyondBand counts the sleeves past the band", INV.book.beyondBand === INV.book.sleeves.filter((s) => Math.abs(s.driftPct) > DRIFT_BAND).length && INV.book.driftBand === DRIFT_BAND);
  const tabHead = i.next.line.split(" Choose among")[0];
  check("the next buy is the Invest tab's own line — one tail reworded for the Floor, every figure untouched", INV.next?.usd === i.next.usd && INV.next.line.startsWith(tabHead) && !/below|the tab does not/.test(INV.next.line.slice(tabHead.length)) && numbersOf(INV.next.line).join() === numbersOf(i.next.line).join(), INV.next?.line);
  check("floorWords touches nothing but that tail", floorWords("$10.00 → VTI (ballast is the lightest sleeve, -5% vs target).") === "$10.00 → VTI (ballast is the lightest sleeve, -5% vs target)." && floorWords(i.next.line) === INV.next.line);
  check("other income is carried as entered, and only when both numbers are positive", INV.other?.monthlyUsd === 1500 && INV.other?.ratePct === 20 && buildInvest(inputsFor({ other: { monthlyUsd: 1500, ratePct: 0 } })).other === null && buildInvest(inputsFor({ other: { monthlyUsd: 0, ratePct: 20 } })).other === null);
  const empty = buildInvest(inputsFor({ positions: [], sweeps: [] }));
  check("an empty ledger is an empty office: no path, no next buy, no invented average", empty.funnel.avgMonthlyUsd === null && empty.funnel.fiveYearUsd === null && empty.funnel.tenYearUsd === null && empty.next === null && empty.book.positions === 0 && empty.funnel.closedMonths === 0);
  check("a held vehicle of a theme shows as held, and only that", INV.themes.some((t) => t.held.includes(heldTicker)) && INV.themes.every((t) => t.held.every((h) => POSITIONS.some((p) => p.ticker === h))));
  check("buildInvest is deterministic", JSON.stringify(buildInvest(inputsFor({ other: { monthlyUsd: 1500, ratePct: 20 } }))) === JSON.stringify(INV));
  const cov = IR.tierCoverage(INV);
  check("tier coverage counts themes the book holds a vehicle of", cov.length === 3 && cov.every((c) => c.covered <= c.themes) && cov.reduce((s, c) => s + c.covered, 0) === INV.themes.filter((t) => t.held.length > 0).length);
}

/* ── Reading it ────────────────────────────────────────────────────────── */
console.log("reading it");
{
  const a = IR.themeOfTheDay(INV, 0);
  const b = IR.themeOfTheDay(INV, 1);
  check("the same ET date always picks the same theme", IR.themeOfTheDay(INV, 0)?.id === a.id && IR.themeOfTheDay({ ...INV }, 0)?.id === a.id);
  check("the second look is a different theme", b && a.id !== b.id);
  const seen = new Set();
  for (let d = 1; d <= 40; d++) seen.add(IR.themeOfTheDay({ ...INV, dayKey: `2026-11-${String(((d - 1) % 28) + 1).padStart(2, "0")}-${d}` }, 0).id);
  check("over forty days the rotation reaches most of the themes", seen.size >= Math.min(THEMES.length, 8), `${seen.size} of ${THEMES.length}`);
  const v = THEMES[0].vehicles[0].ticker;
  const hit = IR.watchHit(INV, `${v} jumps after a supply update`, []);
  check("a theme vehicle named in a headline is a hit", hit != null, v);
  check("a held name beats a theme", IR.watchHit(INV, `${heldTicker} and ${v} both move`, [])?.kind === "held", JSON.stringify(IR.watchHit(INV, `${heldTicker} and ${v} both move`, [])));
  check("a ticker must match as a whole upper-case word", IR.watchHit(INV, `${v.toLowerCase()} is not a ticker here`, []) == null || IR.watchHit(INV, `${v.toLowerCase()} is not a ticker here`, [])?.key !== v);
  check("a headline that names nothing on the list is no hit", IR.watchHit(INV, "Weather turns cooler across the Midwest this weekend", []) == null);
  const comp = THEMES.flatMap((t) => t.competitors).find((c) => c.name.split(/\s+/)[0].length >= 5);
  check("a competitor's name in a headline is a hit (or beaten by a stronger one), never silence", !comp || IR.watchHit(INV, `${comp.name} announces a new plant`, []) != null, comp?.name);
  check("the tickers the feed attached count too", IR.watchHit(INV, "A quiet day", [heldTicker])?.kind === "held");
  const ag = IR.boardAgenda(INV);
  check("the board's agenda has the swept-and-waiting dollars first", ag[0]?.kind === "waiting" && ag[0].usd === INV.funnel.waitingUsd, JSON.stringify(ag));
  check("an empty office has an empty agenda", IR.boardAgenda(buildInvest(inputsFor({ positions: [], sweeps: [] }))).length === 0);
  const [l0, l1] = IR.investLooks(true);
  const [w0, w1] = IR.investLooks(false);
  check("the looks come after the NY AM window on a weekday and mid-day at the weekend", l0 >= 11 * 60 + 15 && l1 > l0 && w0 >= 10 * 60 && w1 > w0);
  check("lookAt switches at the second look", IR.lookAt(l1 - 1, true) === 0 && IR.lookAt(l1, true) === 1 && IR.lookAt(w1, false) === 1);
}

/* ── The voices, one at a time, on every theme ─────────────────────────── */
console.log("the voices");
{
  const ctx = (key) => ({ st: freshTalkState(), f: new Facts(), key, now: NOW });
  let bad = [];
  for (const t of INV.themes) {
    const c = ctx(`theme|${t.id}`);
    const ex = IV.exInvTheme(c, { inv: INV, theme: t });
    if (!ex || ex.lines.length < 3) {
      bad.push(`${t.id}: no exchange`);
      continue;
    }
    const item = { lines: ex.lines, facts: c.f.list, moves: ex.moves, urgency: 0 };
    SPOKEN.push(...ex.lines);
    const u = unsourced(item);
    if (u.length) bad.push(`${t.id}: unsourced ${u.join()}`);
    bad.push(...legal(item).map((x) => `${t.id}: ${x}`));
    const text = textOf(item);
    if (!text.includes(t.demand[0].figure) || !text.includes(t.demand[0].sourceName) || !text.includes(t.demand[0].asOf)) bad.push(`${t.id}: the demand figure is not quoted with its source and year`);
    if (!ex.lines.some((l) => l.character === "Jax") || !ex.lines.some((l) => l.character === "Sterling")) bad.push(`${t.id}: the scout and the chair both speak`);
  }
  check("every theme makes a legal, sourced exchange: figure + source + year quoted, every digit registered", bad.length === 0, bad.slice(0, 4).join(" | "));
  const funnel = (inv) => {
    const c = ctx("funnel");
    const ex = IV.exInvFunnel(c, { inv });
    return { ex, c };
  };
  const f1 = funnel(INV);
  const t1 = f1.ex.lines.map((l) => l.text).join(" ");
  check("the funnel quotes the rate, the swept and waiting dollars and the five- and ten-year path", t1.includes("20%") && t1.includes("$240.50") && t1.includes("$120.25") && t1.includes(`$${Math.round(INV.funnel.fiveYearUsd).toLocaleString("en-US")}`) && /contributions only|no return assumed|before any return/i.test(t1), t1);
  check("…and the other income line when it is entered", /Other income/.test(t1) && t1.includes("$1,500") && t1.includes("$300"), t1);
  const f0 = funnel(buildInvest(inputsFor({ positions: [], sweeps: [] })));
  check("an empty ledger says so, and quotes no average", f0.ex && /No month is logged|sweep log is empty/.test(f0.ex.lines.map((l) => l.text).join(" ")) && !/a month: \$/.test(f0.ex.lines.map((l) => l.text).join(" ")));
  const fn = funnel(buildInvest(inputsFor({ other: null })));
  check("with no other income entered, the chair says it is the trader's call", fn.ex.lines.some((l) => l.character === "Sterling" && /trader's call/.test(l.text)));
  const small = IV.exInvBook(ctx("book"), { inv: INV });
  check("a book under $500 would say arithmetic, not allocation; this one quotes its sleeves at cost", small && /At cost, by sleeve/.test(small.lines.map((l) => l.text).join(" ")) && /Research coverage/.test(small.lines.map((l) => l.text).join(" ")));
  const tiny = buildInvest(inputsFor({ positions: [{ ticker: "VTI", sleeve: "ballast", shares: 1, costUsd: 200, openedAt: "2026-09-01" }] }));
  const tinyEx = IV.exInvBook(ctx("tiny"), { inv: tiny });
  check("a small book says the weights are arithmetic", tinyEx && /arithmetic, not allocation/.test(tinyEx.lines.map((l) => l.text).join(" ")));
  const board = IV.exInvBoard(ctx("board"), { inv: INV });
  check("the board reads the same agenda the TV draws", board && board.lines[0].character === "Sterling" && /swept and not yet bought/.test(board.lines[0].text) && /no order is placed|never buys or sells/i.test(textOf({ lines: board.lines })));
  const news = IV.exInvNews(ctx("news"), { inv: INV, n: { id: "n", title: `${heldTicker} widens its lead`, source: "Wire", publishedMs: NOW, tier: 3, why: "", impact: null, tickers: [], topics: [], primary: false }, hit: { key: heldTicker, label: heldTicker, kind: "held" } });
  check("a headline about a held name is said as context, never a verdict", news && /touches/.test(news.lines[0].text) && news.lines.some((l) => /dossier|verdict/.test(l.text)));
}

/* ── The talk engine over a day ────────────────────────────────────────── */
console.log("the talk");
function clockAt(nowMs, holiday = false) {
  const p = etWallParts(nowMs);
  const etMin = p.hour * 60 + p.minute;
  const isWeekday = p.weekday >= 1 && p.weekday <= 5;
  return { nowMs, etDate: etDateOf(nowMs), etMin, weekday: p.weekday, isWeekday, holiday, optionsOpen: isWeekday && !holiday && etMin >= 570 && etMin < 960, globexOpen: true, killzone: etMin >= 570 && etMin < 660 ? "ny_am" : "dead", killzoneLabel: "x", judas: false, blackout: false, blackoutReason: null };
}
const bookOf = () => ({ positions: [], dayPnl: 0, equity: 10000, closedToday: 0, winsToday: 0, consecLosses: 0, monthEntries: 0 });
const mkWorld = (nowMs, o = {}) => ({
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
  week: null,
  goal: null,
  seats: null,
  rnd: null,
  invest: INV,
  evidence: [],
  busyUntil: 0,
  ...o,
});
/** Tick a day minute by minute, as the scene would, collecting what the investment office said. */
function runDay(date, { from = 6 * 60, to = 23 * 60, state = freshTalkState(), world = {} } = {}) {
  const [y, mo, d] = date.split("-").map(Number);
  const items = [];
  let st = state;
  let busy = 0;
  for (let m = from; m < to; m++) {
    const t = at(y, mo, d, Math.floor(m / 60), m % 60);
    const over = typeof world === "function" ? world(t) : world;
    const w = mkWorld(t, { ...(over.invest === undefined ? { invest: { ...INV, dayKey: date } } : {}), ...over, busyUntil: busy });
    const r = talkTick(w, st);
    st = r.state;
    if (r.item) {
      busy = Math.max(busy, t) + r.item.estMs;
      if (r.item.kind === "invest") {
        items.push({ ...r.item, etMin: m });
        SPOKEN.push(...r.item.lines);
      }
    }
  }
  return { items, state: st };
}
const topicOf = (i) => i.topic.split(":").slice(0, 2).join(":");
const all = [];
{
  const tue = runDay("2026-10-06");
  all.push(...tue.items);
  const by = (p) => tue.items.filter((i) => i.topic.startsWith(p));
  check("on a weekday the office says something, and only about its own topics", tue.items.length >= 5 && tue.items.every((i) => i.topic.startsWith("invest:")), tue.items.map((i) => i.topic).join());
  check("it never speaks inside the NY AM window (09:25–11:15 ET)", tue.items.every((i) => i.etMin < 9 * 60 + 25 || i.etMin >= 11 * 60 + 15), tue.items.map((i) => `${hhmm(i.etMin)} ${i.topic}`).join());
  const fn = by("invest:funnel");
  check("the funnel is said once, after the live window", fn.length === 1 && fn[0].etMin >= 11 * 60 + 30, fn.map((i) => hhmm(i.etMin)).join());
  const th = by("invest:theme");
  check("two theme looks, 12:30 and 14:30 or later, and they are different themes", th.length === 2 && th[0].etMin >= 12 * 60 + 30 && th[1].etMin >= 14 * 60 + 30 && th[0].label !== th[1].label, th.map((i) => `${hhmm(i.etMin)} ${i.label}`).join(" | "));
  check("the theme on the first look is the theme of the day the TVs show", th[0]?.label === `theme of the day · ${IR.themeOfTheDay(INV, 0).name}` && th[1]?.label === `theme of the day · ${IR.themeOfTheDay(INV, 1).name}`, th.map((i) => i.label).join(" | "));
  const bk = by("invest:book");
  check("the book is said once, from midday", bk.length === 1 && bk[0].etMin >= 12 * 60, bk.map((i) => hhmm(i.etMin)).join());
  const bd = by("invest:board");
  check("the board meets once, after the close", bd.length === 1 && bd[0].etMin >= 16 * 60 + 30, bd.map((i) => hhmm(i.etMin)).join());
  check("every line's numbers were produced by code (registered with Facts)", tue.items.every((i) => unsourced(i).length === 0), tue.items.filter((i) => unsourced(i).length).map((i) => `${i.topic}: ${unsourced(i).join()}`).join("; "));
  check("every exchange is legal for its people, a wing spot, no verdict word, no advice", tue.items.every((i) => legal(i).length === 0), tue.items.flatMap((i) => legal(i).map((x) => `${i.topic}: ${x}`)).slice(0, 3).join(" | "));
  check("urgency is chatter only (the headline about a held name is the one step above)", tue.items.every((i) => i.urgency === 0));
  const again = runDay("2026-10-06", { state: tue.state, from: 6 * 60, to: 23 * 60 });
  check("the same day again says nothing new", again.items.length === 0, again.items.map((i) => i.topic).join());
  const twice = runDay("2026-10-06");
  check("the day replays identically (no timer, no randomness)", JSON.stringify(tue.items.map((i) => [i.topic, i.etMin, i.lines])) === JSON.stringify(twice.items.map((i) => [i.topic, i.etMin, i.lines])));
  const wed = runDay("2026-10-07", { state: tue.state });
  all.push(...wed.items);
  check("the next day the funnel, two themes and the board come back; the unchanged book does not", wed.items.filter((i) => i.topic.startsWith("invest:funnel")).length === 1 && wed.items.filter((i) => i.topic.startsWith("invest:theme")).length === 2 && wed.items.filter((i) => i.topic.startsWith("invest:board")).length === 1 && wed.items.filter((i) => i.topic.startsWith("invest:book")).length === 0, wed.items.map(topicOf).join());
  const moved = buildInvest(inputsFor({ boughtWithSweep: 100, dayKey: "2026-10-08" }));
  const thu = runDay("2026-10-08", { state: wed.state, world: { invest: moved }, from: 12 * 60 - 1, to: 12 * 60 + 40 });
  check("the book speaks again when its numbers moved (and 3+ hours have passed)", thu.items.some((i) => i.topic === "invest:book"), thu.items.map(topicOf).join());
  const early = runDay("2026-10-08", { state: wed.state, world: { invest: moved }, from: 12 * 60 - 1, to: 12 * 60 + 40 });
  check("…identically on a replay", JSON.stringify(early.items.map((i) => i.lines)) === JSON.stringify(thu.items.map((i) => i.lines)));
  const late = runDay("2026-10-09", { from: 15 * 60 + 30, to: 17 * 60 });
  all.push(...late.items);
  check("a late load (15:30) says ONE theme, the latest look, not both", late.items.filter((i) => i.topic.startsWith("invest:theme")).length === 1 && late.items.find((i) => i.topic.startsWith("invest:theme")).label.includes(IR.themeOfTheDay({ ...INV, dayKey: "2026-10-09" }, 1).name));
  const sat = runDay("2026-10-10");
  all.push(...sat.items);
  const sb = (p) => sat.items.filter((i) => i.topic.startsWith(p));
  check("at the weekend the funnel is from 09:30, the looks 10:30 and 15:00, the board from 10:00", sb("invest:funnel").length === 1 && sb("invest:funnel")[0].etMin >= 9 * 60 + 30 && sb("invest:theme").length === 2 && sb("invest:theme")[0].etMin >= 10 * 60 + 30 && sb("invest:theme")[1].etMin >= 15 * 60 && sb("invest:board").length === 1 && sb("invest:board")[0].etMin >= 10 * 60, sat.items.map((i) => `${hhmm(i.etMin)} ${topicOf(i)}`).join(" "));
  const dark = runDay("2026-10-06", { world: { invest: null } });
  check("no read of the ledger, no talk: a dark office is silent", dark.items.length === 0);
  const noThemes = runDay("2026-10-06", { world: { invest: buildInvest({ ...inputsFor(), themes: [] }) } });
  check("with no usable themes the office still does its arithmetic and says nothing about industries", noThemes.items.length >= 1 && noThemes.items.every((i) => !i.topic.startsWith("invest:theme")), noThemes.items.map(topicOf).join());
}

/* ── The calendar: what reports inside two weeks ───────────────────────── */
console.log("the calendar");
{
  // Independent of schedule.ts: read the committed earnings file directly and recompute who is watched and what reports.
  const EARN = JSON.parse(fs.readFileSync(new URL("../src/data/earnings-calendar.json", import.meta.url), "utf8"));
  const WHEN = { "pre-market": "pre-market", "post-market": "after close" };
  const watched = (held, themes) => {
    const m = new Map();
    for (const t of held) m.set(t.toUpperCase(), "held");
    for (const n of LONG_NAMES) if (!m.has(n.ticker.toUpperCase())) m.set(n.ticker.toUpperCase(), "board");
    for (const th of themes) for (const v of th.vehicles) if (v.kind === "stock" && !m.has(v.ticker.toUpperCase())) m.set(v.ticker.toUpperCase(), "theme");
    for (const th of themes) for (const c of th.competitors) if (c.ticker && !m.has(c.ticker.toUpperCase())) m.set(c.ticker.toUpperCase(), "competitor");
    return m;
  };
  const expected = (day, held, themes) => {
    const w = watched(held, themes);
    return EARN.rows
      .filter((r) => r[0] !== "GOOG" && r[2] >= day && r[2] <= IR.plusDays(day, CATALYST_WINDOW_DAYS) && w.has(r[0].toUpperCase()))
      .map((r) => `${r[2]} ${r[0]} ${WHEN[r[5]] ?? "time not stated"} ${w.get(r[0].toUpperCase())}`)
      .sort()
      .join("|");
  };
  const got = (cs) => cs.map((c) => `${c.date} ${c.ticker} ${c.when} ${c.why}`).sort().join("|");
  const HEAVY = ["MSFT", "NVDA", "AAPL", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "LLY", "ETN"];
  const DAYS = ["2026-10-01", DAY, "2026-10-13", "2026-10-20", "2026-10-27", "2026-11-03", "2026-11-10"];
  const diffs = [];
  let seen = 0;
  for (const day of DAYS)
    for (const held of [[], [heldTicker], HEAVY]) {
      const cs = catalystsFor(day, held, INV.themes);
      seen += cs.length;
      if (got(cs) !== expected(day, held, INV.themes)) diffs.push(`${day} held=${held.length}`);
    }
  check("the catalysts are exactly the committed calendar's rows for watched names inside the window (differential, 21 reads)", diffs.length === 0 && seen > 20, `${diffs.join(", ")} (saw ${seen})`);
  check("the window is two weeks", CATALYST_WINDOW_DAYS === 14);

  const LONG_SET = new Set(LONG_NAMES.map((n) => n.ticker));
  const first = EARN.rows.find((r) => r[0] !== "GOOG" && r[2] >= DAY && !LONG_SET.has(r[0]));
  const X = first[0];
  check("an earnings row is a catalyst on the last day of the window, not the day after", catalystsFor(IR.plusDays(first[2], -CATALYST_WINDOW_DAYS), [X], []).some((c) => c.ticker === X) && !catalystsFor(IR.plusDays(first[2], -CATALYST_WINDOW_DAYS - 1), [X], []).some((c) => c.ticker === X));
  check("…and a report that already happened is not one", !catalystsFor(IR.plusDays(first[2], 1), [X], []).some((c) => c.ticker === X && c.date === first[2]));
  check("a name nobody watches is never a catalyst: with no book and no themes the only reports are the Invest tab's own long board", catalystsFor(DAY, [], []).every((c) => c.why === "board" && LONG_SET.has(c.ticker)) && catalystsFor(DAY, ["ZZZZ"], []).every((c) => c.why === "board"));

  const cs = catalystsFor("2026-10-27", HEAVY, INV.themes);
  const WR = { "pre-market": 0, "time not stated": 1, "after close": 2 };
  const RK = { held: 0, board: 1, theme: 2, competitor: 3 };
  const resorted = [...cs].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : WR[a.when] - WR[b.when] || RK[a.why] - RK[b.why] || (a.ticker < b.ticker ? -1 : 1)));
  check("they are in the order a person reads them: date, then before the open → after the close, then held → long board → theme → competitor", cs.length >= 5 && JSON.stringify(cs) === JSON.stringify(resorted));
  check("a name the book holds is 'held', and one it does not is not", cs.filter((c) => HEAVY.includes(c.ticker)).every((c) => c.why === "held") && cs.filter((c) => !HEAVY.includes(c.ticker)).every((c) => c.why !== "held"));
  check("the same inputs give the same list", JSON.stringify(catalystsFor("2026-10-27", HEAVY, INV.themes)) === JSON.stringify(cs));

  const rule = ALL_DOSSIERS.find((d) => d.kind === "company" && d.killRule && !/^none/i.test(d.killRule.trim()) && EARN.rows.some((r) => r[0] === d.ticker && r[2] >= "2026-10-20"));
  const withRule = catalystsFor(IR.plusDays(EARN.rows.find((r) => r[0] === rule.ticker)[2], -3), [rule.ticker], INV.themes).find((c) => c.ticker === rule.ticker);
  check("a researched name's report carries the trader's own kill rule, word for word", withRule && withRule.killRule === rule.killRule, rule.ticker);
  const bare = cs.find((c) => !ALL_DOSSIERS.some((d) => d.kind === "company" && d.ticker === c.ticker && d.killRule && !/^none/i.test(d.killRule.trim())));
  check("a name with no kill rule carries none (never an invented one)", bare && bare.killRule === null, bare?.ticker);

  const T = (name, vehicles, competitors) => ({ name, vehicles, competitors });
  const v = (ticker, kind = "stock") => ({ ticker, kind, name: ticker });
  const c = (ticker) => ({ name: ticker, ticker });
  const mix = [T("Theme A", [v("ZZA")], [c(X)]), T("Theme B", [v(X)], [])];
  const pr = catalystsFor(first[2], [], mix).find((k) => k.ticker === X);
  check("a name that is one theme's competitor and another's stock vehicle is a vehicle, whichever theme is listed first", pr?.why === "theme" && pr.theme === "Theme B", JSON.stringify(pr));
  check("…and held beats both", catalystsFor(first[2], [X], mix).find((k) => k.ticker === X)?.why === "held");
  check("a fund vehicle is not a catalyst source (a fund does not report earnings)", !catalystsFor(first[2], [], [T("Theme F", [v(X, "fund")], [])]).some((k) => k.ticker === X));
  check("a competitor with no ticker is not a catalyst source", catalystsFor(first[2], [], [T("Theme N", [], [{ name: "Private Co" }])]).every((k) => k.why !== "competitor"));

  check("daysBetween and dayPhrase say today, tomorrow, a weekday, then a date", IR.daysBetween("2026-10-06", "2026-10-13") === 7 && IR.daysBetween("2026-10-13", "2026-10-06") === -7 && IR.dayPhrase("2026-10-06", "2026-10-06") === "today" && IR.dayPhrase("2026-10-07", "2026-10-06") === "tomorrow" && IR.dayPhrase("2026-10-09", "2026-10-06") === "Friday" && IR.dayPhrase("2026-10-13", "2026-10-06") === "Tuesday 13 October", [IR.dayPhrase("2026-10-09", "2026-10-06"), IR.dayPhrase("2026-10-13", "2026-10-06")].join());
  check("daysBetween is whole calendar days across a clock change", IR.daysBetween("2026-11-01", "2026-11-02") === 1 && IR.daysBetween("2026-03-07", "2026-03-09") === 2);
  check("whenPhrase says what the calendar says, and says so when it does not say", IR.whenPhrase("pre-market") === "before the open" && IR.whenPhrase("after close") === "after the close" && IR.whenPhrase("time not stated") === "(time not stated)");

  // The voice, on a hand-built list (so the lead, the rule and the count are all known).
  const ruleRow = EARN.rows.find((r) => r[0] === rule.ticker && r[2] >= "2026-10-20");
  const cat = (o) => ({ date: "2026-10-13", when: "time not stated", ticker: "ZZA", name: "Zed Alpha", why: "competitor", theme: "Quantum computing", killRule: null, ...o });
  const fx = (catalysts, extra = {}) => ({ ...INV, dayKey: "2026-10-06", catalystsAsOf: EARN.capturedAt, catalysts, ...extra });
  const ctx2 = () => ({ st: freshTalkState(), f: new Facts(), key: "cat", now: NOW });
  const list = [cat({ ticker: "ZZA", date: "2026-10-07" }), cat({ ticker: "ZZB", name: "Zed Beta", why: "theme", date: "2026-10-08", when: "pre-market" }), cat({ ticker: rule.ticker, name: "Held Co", why: "held", date: ruleRow[2], when: "after close", killRule: rule.killRule }), cat({ ticker: "ZZC", date: "2026-10-14" }), cat({ ticker: "ZZD", date: "2026-10-15" }), cat({ ticker: "ZZE", date: "2026-10-16" })];
  const c1 = ctx2();
  const ex1 = IV.exInvCatalysts(c1, { inv: fx(list) });
  const item1 = ex1 && { lines: ex1.lines, facts: c1.f.list, moves: ex1.moves, urgency: 0 };
  const text1 = item1 ? textOf(item1) : "";
  const everyRule = ALL_DOSSIERS.filter((d) => d.kind === "company" && d.killRule && !/^none/i.test(d.killRule.trim()));
  const longRule = [];
  for (const d of everyRule) {
    const cx = ctx2();
    const exr = IV.exInvCatalysts(cx, { inv: fx([cat({ ticker: d.ticker, name: d.name ?? d.ticker, why: "held", killRule: d.killRule })]) });
    const itr = exr && { lines: exr.lines, facts: cx.f.list, moves: exr.moves, urgency: 0 };
    if (!itr || legal(itr).length || unsourced(itr).length) longRule.push(`${d.ticker}: ${itr ? [...legal(itr), ...unsourced(itr)].join(" | ") : "null"}`);
  }
  check(`every real kill rule in the dossiers (${everyRule.length}) makes a legal, fully registered exchange — no line over the word cap`, everyRule.length >= 5 && longRule.length === 0, longRule.slice(0, 2).join(" ; "));
  check("the voice leads with the held name even when it is not first on the list", ex1 && ex1.lines[0].character === "Gemma" && ex1.lines[0].text.includes(rule.ticker) && /We hold/.test(ex1.lines[1].text), text1.slice(0, 160));
  check("…the chair reads the report against the pre-written kill rule and says not to read the price reaction", /not the price reaction/.test(text1) && text1.includes(rule.killRule.slice(0, 30)));
  check("…the CIO counts the rest and names the first three", /5 more on the list inside two weeks/.test(text1) && /ZZA tomorrow/.test(text1) && /and 2 others/.test(text1), text1);
  check("…the last line dates the source and says the far dates are provisional", new RegExp(`Alpha Vantage's as of ${EARN.capturedAt}`).test(text1) && /provisional/.test(text1));
  check("…every digit it speaks was registered by code, and every line is legal", ex1 && unsourced(item1).length === 0 && legal(item1).length === 0, ex1 ? `${unsourced(item1).join()} ${legal(item1).join(" | ")}` : "null");
  const c2 = ctx2();
  const ex2 = IV.exInvCatalysts(c2, { inv: fx([cat({ ticker: "ZZB", name: "Zed Beta", why: "theme", date: "2026-10-08", when: "pre-market" })]) });
  const t2 = ex2 ? ex2.lines.map((l) => l.text).join(" ") : "";
  check("a vehicle we do not hold is said not to be held; with no kill rule the chair says a date is not a signal", /we do not hold it/.test(t2) && /A date is not a signal/.test(t2) && !/Nova/.test(ex2.lines.map((l) => l.character).join()), t2);
  const c3 = ctx2();
  const ex3 = IV.exInvCatalysts(c3, { inv: fx([cat({})]) });
  check("a competitor is context for the map, not a position", ex3 && /Context for the map, not a position/.test(ex3.lines.map((l) => l.text).join(" ")));
  check("no catalysts, no exchange", IV.exInvCatalysts(ctx2(), { inv: fx([]) }) === null);
  check("the same list says the same thing (no randomness)", JSON.stringify(IV.exInvCatalysts(ctx2(), { inv: fx(list) })?.lines) === JSON.stringify(ex1.lines));
  const verdict = ex1.lines.some((l) => /\b(buy|sell|add|trim)\b/i.test(l.text));
  check("it never tells anyone to buy, sell, add or trim", !verdict, text1);

  // In the talk engine.
  const catItems = (r) => r.items.filter((i) => i.topic.startsWith("invest:catalyst:"));
  const wk = (date, o = {}) => runDay(date, { world: { invest: buildInvest(inputsFor({ dayKey: date })), ...o } });
  const tuesday = wk("2026-10-06");
  const ct = catItems(tuesday);
  check("on a weekday the calendar is said once, after the live window (13:30 ET or later)", ct.length === 1 && ct[0].etMin >= 13 * 60 + 30 && /^the calendar/.test(ct[0].label), ct.map((i) => `${hhmm(i.etMin)} ${i.label}`).join());
  check("…and it is legal, sourced and urgency 0", ct.every((i) => unsourced(i).length === 0 && legal(i).length === 0 && i.urgency === 0), ct.flatMap((i) => [...unsourced(i), ...legal(i)]).join(" | "));
  check("the same day again says nothing new", catItems(wk("2026-10-06", {})).length === 1 && catItems(runDay("2026-10-06", { state: tuesday.state, world: { invest: buildInvest(inputsFor({ dayKey: "2026-10-06" })) } })).length === 0);
  const wed2 = runDay("2026-10-07", { state: tuesday.state, world: { invest: buildInvest(inputsFor({ dayKey: "2026-10-07" })) } });
  check("the next day it says it again (its topic is per day)", catItems(wed2).length === 1, wed2.items.map(topicOf).join());
  const sat2 = wk("2026-10-10");
  check("at the weekend it is from 11:00", catItems(sat2).length === 1 && catItems(sat2)[0].etMin >= 11 * 60, catItems(sat2).map((i) => hhmm(i.etMin)).join());
  const lateLoad = runDay("2026-10-06", { from: 15 * 60 + 30, to: 17 * 60, world: { invest: buildInvest(inputsFor({ dayKey: "2026-10-06" })) } });
  check("a late load (15:30) still says it once", catItems(lateLoad).length === 1);
  const stale = runDay("2026-10-06", { world: { invest: { ...buildInvest(inputsFor({ dayKey: "2026-10-06" })), catalystsAsOf: "2026-08-01" } } });
  check("a calendar more than three weeks old is not spoken from", catItems(stale).length === 0, catItems(stale).map((i) => i.topic).join());
  const none = runDay("2026-10-06", { world: { invest: { ...buildInvest(inputsFor({ dayKey: "2026-10-06" })), catalysts: [] } } });
  check("no catalysts in the window, nothing said about the calendar", catItems(none).length === 0);
  const morning = runDay("2026-10-06", { from: 9 * 60 + 25, to: 11 * 60 + 15, world: { invest: buildInvest(inputsFor({ dayKey: "2026-10-06" })) } });
  check("never inside the NY AM window", morning.items.length === 0);
  all.push(...ct, ...catItems(sat2));
}

/* ── Headlines ─────────────────────────────────────────────────────────── */
console.log("the headlines");
{
  const head = (id, title, ageMin, extra = {}) => ({ id, title, source: "Wire", publishedMs: at(2026, 10, 13, 12, 0) - ageMin * 60_000, tier: 3, why: "", impact: null, tickers: [], topics: [], primary: false, ...extra });
  const comp = THEMES.flatMap((t) => t.competitors).find((c) => c.name.split(/\s+/)[0].length >= 5);
  const themeVeh = THEMES.find((t) => t.vehicles[0].ticker !== heldTicker).vehicles[0].ticker;
  const NEWS = [
    head("h1", `${heldTicker} wins a large new contract`, 5),
    head("h2", `${comp.name} opens a second plant`, 6),
    head("h3", "Weather turns cooler across the Midwest", 4),
    head("h4", `${themeVeh} shares jump`, 600),
    head("h5", `${themeVeh} fund inflows continue`, 25 * 60),
  ];
  const run = runDay("2026-10-13", { from: 11 * 60 + 30, to: 14 * 60, world: { news: NEWS } });
  const said = run.items.filter((i) => i.topic.startsWith("invest:news:"));
  check("a fresh headline about a held name is announced, one step above chatter", said.length >= 1 && said[0].urgency === 1 && said[0].lines[0].text.includes(heldTicker), said.map((i) => `${i.urgency} ${i.lines[0]?.text}`).join(" | "));
  check("the competitor's headline waits out the 45-minute gap", said.length === 2 && said[1].etMin - said[0].etMin >= 45 && said[1].urgency === 0 && said[1].lines[0].text.includes(comp.name.split(/\s+/)[0]), said.map((i) => `${hhmm(i.etMin)} ${i.lines[0]?.text}`).join(" | "));
  check("a headline that names nothing on the list is never said", run.items.every((i) => !/Weather turns cooler/.test(textOf(i))));
  check("old headlines found on the first look are marked seen, not announced", run.items.every((i) => !/shares jump|inflows continue/.test(textOf(i))));
  check("a headline's numbers are quoted as the headline's own, registered", run.items.every((i) => unsourced(i).length === 0) && run.items.every((i) => legal(i).length === 0), run.items.flatMap((i) => legal(i)).join(" | "));
  all.push(...run.items);
  const loadLate = runDay("2026-10-14", { from: 12 * 60, to: 14 * 60, world: (t) => ({ news: [head("h6", `${heldTicker} backlog item`, 26 * 60, { publishedMs: t - 26 * 3_600_000 })] }) });
  check("a headline older than the day is context, never news", loadLate.items.every((i) => !i.topic.startsWith("invest:news:")));
  const quiet = runDay("2026-10-15", { from: 9 * 60 + 25, to: 11 * 60 + 15, world: { news: [head("h7", `${heldTicker} jumps`, 3)] } });
  check("even a held name's headline waits for the live window to close", quiet.items.length === 0);
}

/* ── The screens ───────────────────────────────────────────────────────── */
console.log("the screens");
function mockCtx() {
  const texts = [];
  const set = {};
  return new Proxy(set, {
    get(t, k) {
      if (k === "texts") return texts;
      if (k === "measureText") return (s) => ({ width: String(s).length * 7 });
      if (k === "fillText" || k === "strokeText") return (s) => void texts.push(String(s));
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}
const frameFor = (invest, nowMs = NOW) => ({
  id: 1,
  nowMs,
  etMin: etMinOf(nowMs),
  clockLabel: "",
  output: {},
  trace: {},
  acts: null,
  minds: null,
  caption: null,
  screens: {
    market: {},
    charts: { QQQ: null, SPY: null },
    plan: null,
    news: [
      { title: `${heldTicker} wins a large new contract`, source: "Wire", age: "5m" },
      { title: "Weather turns cooler across the Midwest", source: "Wire", age: "9m" },
    ],
    calendar: [],
    book: { cash: 0, equity: 0, start: 0, dayPnl: 0, positions: [], events: [] },
    vix: null,
    tenYear: null,
    research: {},
    source: "",
    synthetic: false,
    ledger: null,
    lab: null,
    lenses: null,
    roomP: null,
    race: null,
    invest,
  },
});
{
  const WING = ["tv_portfolio", "tv_funnel", "tv_theme", "tv_board", "mon_Inv_0", "mon_Inv_1", "mon_Inv_2", "mon_Inv_3", "mon_Chair_0", "plate_Inv", "plate_Board", "plate_Chair"];
  const sizes = (id) => (id.startsWith("tv_") ? [768, 432] : id.startsWith("plate_") ? [440, 112] : [512, 306]);
  const empty = buildInvest(inputsFor({ positions: [], sweeps: [] }));
  for (const [name, inv] of [["rich", INV], ["empty", empty], ["dark", null], ["no themes", buildInvest({ ...inputsFor(), themes: [] })]]) {
    const failed = [];
    for (const id of WING) {
      const ctx = mockCtx();
      try {
        const [w, h] = sizes(id);
        if (!drawScreen(id, ctx, w, h, frameFor(inv), NOW)) failed.push(`${id} returned false`);
        if (!ctx.texts.length) failed.push(`${id} drew no text`);
      } catch (e) {
        failed.push(`${id}: ${String(e).slice(0, 80)}`);
      }
    }
    check(`all twelve wing screens draw (${name} read), none throws, none is blank`, failed.length === 0, failed.join("; "));
  }
  const textFor = (id, inv, nowMs) => {
    const ctx = mockCtx();
    const [w, h] = sizes(id);
    drawScreen(id, ctx, w, h, frameFor(inv, nowMs), nowMs ?? NOW);
    return ctx.texts.join(" | ");
  };
  const port = textFor("tv_portfolio", INV);
  check("the long-book TV says it is valued at cost and shows the total", /valued at cost/.test(port) && port.includes("$3,600"), port.slice(0, 200));
  const fun = textFor("tv_funnel", INV);
  check("the funnel TV shows swept, waiting, the ladder, the path and the other income", fun.includes("$240.50") && !fun.includes("$241") && /Contributions only/.test(fun) && /Other income/.test(fun) && fun.includes("$1,500"), fun.slice(0, 260));
  const theme0 = IR.themeOfTheDay(INV, 0);
  const th = textFor("tv_theme", INV, at(2026, 10, 6, 13, 0));
  check("the theme TV shows the day's theme with its sourced demand figure, source and year", th.includes(theme0.name.slice(0, 20)) && th.includes(theme0.demand[0].figure.slice(0, 12)) && th.includes(theme0.demand[0].sourceName.slice(0, 12)) && th.includes(theme0.demand[0].asOf), th.slice(0, 260));
  const theme1 = IR.themeOfTheDay(INV, 1);
  const th1 = textFor("tv_theme", INV, at(2026, 10, 6, 15, 0));
  check("after the second look it shows the second theme — the one the five are on", th1.includes(theme1.name.slice(0, 20)), th1.slice(0, 120));
  const bd = textFor("tv_board", INV);
  check("the board TV seats the chair and the four, and draws the agenda from the same list", ["Sterling", "Nova", "Jax", "Gemma", "Vince"].every((n) => bd.includes(n)) && /swept, not yet bought/.test(bd) && /No order is placed/.test(bd), bd.slice(0, 260));
  const catsNow = IR.freshCatalysts(INV);
  check("the board TV draws the calendar: the heading, and the first three reports as the talk says them (day, ticker, when, why)", catsNow.length >= 1 && /REPORTS IN THE NEXT TWO WEEKS/.test(bd) && catsNow.slice(0, 3).every((c) => bd.includes(c.ticker) && bd.includes(IR.dayPhrase(c.date, INV.dayKey)) && bd.includes(c.when) && bd.includes(c.why === "theme" ? "vehicle" : c.why === "board" ? "long board" : c.why)), bd.slice(-320));
  const crowded = { ...buildInvest(inputsFor({ dayKey: "2026-10-27" })), catalystsAsOf: "2026-10-20" };
  const crowdedText = textFor("tv_board", crowded);
  check("with more than three it says how many more, and draws only three", IR.freshCatalysts(crowded).length > 3 && crowdedText.includes(`+${IR.freshCatalysts(crowded).length - 3} more`) && IR.freshCatalysts(crowded).slice(3).every((c) => !crowdedText.split(" | ").includes(c.ticker)), crowdedText.slice(-260));
  check("with nothing in the window it says so, not a blank", /None touches the book or the list/.test(textFor("tv_board", { ...INV, catalysts: [] })));
  const staleInv = { ...INV, catalystsAsOf: "2026-08-01" };
  const staleText = textFor("tv_board", staleInv);
  check("a calendar more than three weeks old is not drawn from; the TV says when it was captured", /captured 2026-08-01 — too old to read/.test(staleText) && catsNow.every((c) => !staleText.split(" | ").includes(c.ticker)), staleText.slice(-200));
  check("the voice and the TV read one list: a stale calendar silences both", IR.freshCatalysts(staleInv).length === 0 && IV.exInvCatalysts({ st: freshTalkState(), f: new Facts(), key: "k", now: NOW }, { inv: staleInv }) === null);
  check("freshCatalysts is the list itself while the calendar is current, and the edge is 21 days", IR.freshCatalysts(INV) === INV.catalysts && IR.freshCatalysts({ ...INV, catalystsAsOf: IR.plusDays(INV.dayKey, -21) }).length === INV.catalysts.length && IR.freshCatalysts({ ...INV, catalystsAsOf: IR.plusDays(INV.dayKey, -22) }).length === 0);
  const cio = textFor("mon_Inv_0", INV);
  check("Nova's monitor tabulates the sleeves", /Ballast/.test(cio) && /Compounders/.test(cio) && /Dry powder/.test(cio) && /To restore/.test(cio));
  const news = textFor("mon_Inv_2", INV);
  check("Gemma's monitor marks the headline that touches the book", news.includes(heldTicker) && /HELD/.test(news), news.slice(0, 200));
  const chair = textFor("mon_Chair_0", INV);
  check("the chair's page is one page: rate, swept, waiting, book, band, coverage, other income", /Sweep rate/.test(chair) && /Swept so far/.test(chair) && /Waiting to be bought/.test(chair) && /Long book at cost/.test(chair) && /Other income/.test(chair));
  const plates = ["plate_Inv", "plate_Board", "plate_Chair"].map((id) => textFor(id, INV));
  check("the three doors are named", /INVESTMENT OFFICE/.test(plates[0]) && /BOARDROOM/.test(plates[1]) && /CHAIR'S OFFICE/.test(plates[2]), plates.join(" / "));
  const darkText = textFor("tv_funnel", null);
  check("a dark office says it reads the ledger from this browser — it invents nothing", /ledger/.test(darkText) && !/\$\d/.test(darkText), darkText);
  const allText = WING.map((id) => textFor(id, INV)).join(" ");
  check("no wing screen uses a desk verdict word", !VERDICT_WORDS.test(allText), allText.match(VERDICT_WORDS)?.[0]);
}

/* ── The firm's standing reviews ───────────────────────────────────────── */
console.log("the firm");
const FV = await import("../src/lib/room/live-voices-invest-firm.ts");
const FIRM = await import("../src/lib/room/invest-firm.ts");
const EXP = await import("../src/lib/invest/exposure.ts");
const LED = await import("../src/lib/invest/ledger.ts");
const POL = await import("../src/lib/invest/policy.ts");
const LB = await import("../src/lib/invest/long-board.ts");
const FUN = await import("../src/lib/invest/funnel.ts");
const UNI = await import("../src/lib/invest/universe.ts");
const KS = await import("../src/lib/invest/kill-store.ts");
const KW = await import("../src/lib/invest/kill-watch.ts");
const RHB = await import("../src/lib/invest/rh-bridge.ts");
const IPO = await import("../src/lib/invest/ipo.ts");
const FACT = await import("../src/lib/invest/factors.ts");
const DUR = await import("../src/lib/invest/durability.ts");
const EVID = await import("../src/lib/invest/evidence.ts");
const DFRESH = await import("../src/lib/room/data-fresh.ts");
const AUDIT = await import("../src/lib/room/audit.ts");
const STUDY = await import("../src/lib/room/off-hours-study.ts");
const LTYPES = await import("../src/lib/room/live-types.ts");

/** A seeded ledger that exercises every review: two lots a year apart, a loss sale with a wash replacement, a dividend, two sweeps with a month missing, a voided typo. */
const E = (o) => ({ loggedAt: `${o.date}T15:00:00.000Z`, ...o });
const FIRM_ENTRIES = [
  E({ id: "buy-1", kind: "buy", date: "2025-08-04", ticker: "VTI", sleeve: "ballast", shares: 5, costUsd: 1500, source: "other" }),
  E({ id: "buy-2", kind: "buy", date: "2026-05-04", ticker: "VTI", sleeve: "ballast", shares: 1, costUsd: 300, source: "other" }),
  E({ id: "buy-3", kind: "buy", date: "2026-06-02", ticker: "SGOV", sleeve: "drypowder", shares: 12, costUsd: 1200, source: "other" }),
  E({ id: "buy-4", kind: "buy", date: "2026-07-06", ticker: "MSFT", sleeve: "compounder", shares: 1.2, costUsd: 600, source: "other" }),
  E({ id: "buy-5", kind: "buy", date: "2026-08-20", ticker: "VTI", sleeve: "ballast", shares: 0.5, costUsd: 140, source: "sweep" }),
  E({ id: "buy-6", kind: "buy", date: "2026-09-03", ticker: "VTI", sleeve: "ballast", shares: 3, costUsd: 900, source: "other" }),
  E({ id: "sell-1", kind: "sell", date: "2026-08-10", ticker: "VTI", shares: 1, proceedsUsd: 280 }),
  E({ id: "div-1", kind: "dividend", date: "2026-06-26", ticker: "VTI", amountUsd: 9.4, reinvested: false }),
  E({ id: "sweep-07", kind: "sweep", date: "2026-07-01", month: "2026-07", verdict: "SWEEP", realizedUsd: 900, rentUsd: 199, restoreUsd: 0, sweptUsd: 100, rate: 0.2, note: "x" }),
  E({ id: "sweep-09", kind: "sweep", date: "2026-09-01", month: "2026-09", verdict: "SWEEP", realizedUsd: 1100, rentUsd: 199, restoreUsd: 0, sweptUsd: 140.5, rate: 0.2, note: "x" }),
  E({ id: "void-1", kind: "void", date: "2026-09-04", targetId: "buy-6", reason: "typed the wrong ticker" }),
];
const RH_FILLS = [
  { id: "f1", openedAt: "2026-09-20T14:00:00Z", closedAt: "2026-09-21T15:00:00Z", underlier: "QQQ", side: "call", debit: 200, exit: 240, pnl: 40, note: "" },
  { id: "f2", openedAt: "2026-09-25T14:00:00Z", underlier: "IWM", side: "call", debit: 150, note: "" },
  { id: "f3", openedAt: "2026-08-12T14:00:00Z", closedAt: "2026-08-13T15:00:00Z", underlier: "QQQ", side: "put", debit: 120, exit: 90, pnl: -30, note: "" },
  { id: "f4", openedAt: "2026-06-01T14:00:00Z", closedAt: "2026-06-02T15:00:00Z", underlier: "XLK", side: "call", debit: 100, exit: 130, pnl: 30, note: "" },
];
const kr = (ticker, n) => ({ ticker, killRule: "r", summary: "s", citations: Array.from({ length: n }, (_, i) => ({ url: `https://example.com/${ticker}/${i}`, title: null })), tripped: null, checkedAt: "2026-10-01T12:00:00Z" });
const KILL = {
  lastRun: { ranAt: "2026-10-01T12:00:00.000Z", sinceDays: 7, results: [kr("NVDA", 1), kr("MSFT", 0), kr("ETN", 2)] },
  judgements: [
    { id: "kj-3", ticker: "ETN", tripped: true, judgedAt: "2026-10-02T12:00:00.000Z", note: "orders fell two quarters", killRule: "r", sources: [] },
    { id: "kj-2", ticker: "NVDA", tripped: false, judgedAt: "2026-10-01T18:00:00.000Z", note: "read the filing", killRule: "r", sources: [] },
    { id: "kj-1", ticker: "ETN", tripped: false, judgedAt: "2026-09-10T12:00:00.000Z", note: "older read", killRule: "r", sources: [] },
  ],
};
/** The adapter's own inputs (invest-sources.ts), rebuilt from raw entries — the verifier's side of the same recipe. */
function firmInputs(entries, { dayKey = DAY, nowMs = Date.parse(`${dayKey}T17:00:00Z`), rhFills = RH_FILLS, kill = KILL, other = null } = {}) {
  const ledger = LED.replay(entries);
  const held = LED.heldPositions(ledger, dayKey);
  const positions = held.map((h) => ({ ticker: h.ticker, sleeve: h.sleeve, shares: h.shares, costUsd: h.costUsd, openedAt: h.openedAt }));
  const book = buildBook(positions, {}, nowMs);
  const queue = deployQueue(ledger.sweeps, LED.sweepFundedUsd(ledger), nowMs);
  return { dayKey, book, reb: rebalanceCheck(book), ladder: rateLadder(ledger.sweeps), queue, next: nextBuy(book, queue.waitingUsd, new Set(held.map((h) => h.ticker))), held: held.map((h) => h.ticker), sweptMonthly: ledger.sweeps.map((s) => s.sweptUsd), other, ledger, nowMs, rhFills, kill };
}
const IP = firmInputs(FIRM_ENTRIES);
const INVF = buildInvest(IP);
const FM = INVF.firm;
const fmt = (n, dp = 0) => n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const PER_NAME = /\b(CORE|ADD|HOLD|TRIM|OUT)\b/;
/** The Invest tab's own gate and list are called by name ("the ADD gate", "the ADD list"); nothing else shouts a per-name word. */
const perNameWord = (text) => PER_NAME.test(text.replace(/\bADD (gate|list|names)\b/g, ""));
const NEGATION = /\b(no|not|none|nothing|need|needs|without|cannot|never|holds? no)\b/i;
const PRICE_WORDS = /\b(unrealized|unrealised|drawdown|performance|outperform\w*|underperform\w*|mark-to-market|market value|current price|share price|trading at|P\/L)\b|\b(up|down)\s+\$?\d|\bsince (purchase|we bought)\b/i;
/** A sentence that talks about price or performance must be the sentence that says the Floor has none. */
const priceClaims = (text) => text.split(/(?<=[.!?])\s+/).filter((s) => PRICE_WORDS.test(s) && !NEGATION.test(s));
const extraBad = (item) => {
  const out = [];
  const t = textOf(item);
  if (perNameWord(t)) out.push(`a per-name verdict word in “${t.match(PER_NAME)?.[0]}”`);
  const pc = priceClaims(t);
  if (pc.length) out.push(`a price or performance claim from a book valued at cost: “${pc[0].slice(0, 60)}”`);
  return out;
};
const ctxF = (key, nowMs = NOW) => ({ st: freshTalkState(), f: new Facts(), key, now: nowMs });
/** The text of every variant a builder can choose, answering includes() and all() only if EVERY variant does — a mutated phrase in the variant the first key did not pick must still be seen. */
class AllText {
  constructor(ts) {
    this.ts = ts;
  }
  includes(s) {
    return this.ts.every((t) => t.includes(s));
  }
  all(re) {
    return this.ts.every((t) => re.test(t));
  }
  slice(a, b) {
    return this.ts[0].slice(a, b);
  }
  toString() {
    return this.ts[0];
  }
}
/** Run a builder under ten different keys (a bank of phrases picks by the key, so ten reach both variants of a pair), check every guard on every run, and keep the lines for the speech check. */
function runFirm(name, fn, { keep = true, keys = 10 } = {}) {
  const runs = [];
  for (let k = 0; k < keys; k++) {
    const c = ctxF(k ? `${name}#${k}` : name);
    const ex = fn(c);
    if (!ex) {
      if (k === 0) return { ex: null, item: null, bad: [], text: new AllText([""]), runs };
      continue;
    }
    const item = { lines: ex.lines, facts: c.f.list, moves: ex.moves, urgency: 0 };
    if (keep) SPOKEN.push(...ex.lines);
    runs.push({ ex, item, text: textOf(item), bad: [...legal(item), ...unsourced(item), ...extraBad(item)] });
  }
  return { ex: runs[0].ex, item: runs[0].item, text: new AllText(runs.map((r) => r.text)), bad: [...new Set(runs.flatMap((r) => r.bad))], runs };
}
const has = (text, ...subs) => subs.filter((s) => !text.includes(s));

/* The reads against the Invest tab's own functions, one by one. */
const sleevesW = IP.book.positions.map((p) => ({ ticker: p.ticker, weight: p.weight }));
function diffFirm(fm, ip = IP, day = ip.dayKey) {
  const bad = [];
  const ck = (name, ok) => {
    if (!ok) bad.push(name);
  };
  try {
    diffInto(fm, ip, day, ck);
  } catch (e) {
    // A builder that drops a whole section is a failure with a name, not a crash of the verifier.
    bad.push(`threw: ${String(e).slice(0, 90)}`);
  }
  return bad;
}
function diffInto(fm, ip, day, ck) {
  const cards = LB.gradeBoard({ today: day });
  // risk — exposure.ts lookThrough, long-board.ts sleeveLoad / NAME_CAP / SLEEVE_CAP, universe.ts concentrationWarning
  const lt = EXP.lookThrough(ip.book.positions.map((p) => ({ ticker: p.ticker, valueUsd: p.valueUsd })));
  ck("risk.overlap", fm.risk.overlapQQQ === lt.overlapQQQ && fm.risk.overlapWarn === EXP.OVERLAP_WARN);
  ck("risk.tech", fm.risk.techWeight === lt.techWeight && fm.risk.sectorUnknown === lt.sectorUnknown);
  ck("risk.fees", fm.risk.feeUsdYear === lt.feeUsdYear && near(fm.risk.feeBlended, lt.feeBlended));
  ck("risk.names", fm.risk.names.length === Math.min(3, lt.names.length) && fm.risk.names.every((n, i) => n.ticker === lt.names[i].ticker && near(n.weight, lt.names[i].weight) && near(n.direct, lt.names[i].direct) && near(n.viaFunds, lt.names[i].viaFunds)));
  ck("risk.caps", fm.risk.nameCap === LB.NAME_CAP && fm.risk.sleeveCap === LB.SLEEVE_CAP);
  ck("risk.over", JSON.stringify(fm.risk.namesOverCap.map((n) => n.ticker)) === JSON.stringify(lt.names.filter((n) => n.weight > LB.NAME_CAP).slice(0, 3).map((n) => n.ticker)));
  const sl = LB.sleeveLoad(ip.book.positions.map((p) => ({ ticker: p.ticker, weight: p.weight })));
  ck("risk.sleeves", fm.risk.sleeves.length === sl.length && fm.risk.sleeves.every((s, i) => s.sleeve === sl[i].sleeve && near(s.weight, sl[i].weight) && s.over === sl[i].over));
  ck("risk.direct", near(fm.risk.directTechWeight, ip.book.concentration.techWeight) && fm.risk.directTechWarn === ip.book.concentration.warn);
  ck("risk.compute", JSON.stringify(fm.risk.computeNames) === JSON.stringify(cards.filter((c) => c.overlap === "same bet as the sleeve").map((c) => c.name.ticker)) && fm.risk.computeShare === FUN.FUNNEL.find((s) => s.sleeve === "compute").weight);
  // compliance — universe.ts lists and canAdd, rh-bridge.ts window
  ck("comp.list", JSON.stringify(fm.compliance.banned) === JSON.stringify(Object.keys(UNI.WASH_SALE_BANNED)) && JSON.stringify(fm.compliance.twins) === JSON.stringify(Object.keys(UNI.WASH_SALE_TWINS)));
  const unc = ip.rhFills ? RHB.recentUnderliersFrom(ip.rhFills, ip.nowMs).filter((u) => !UNI.WASH_SALE_BANNED[u.underlier]) : [];
  ck("comp.dynamic", JSON.stringify(fm.compliance.dynamic.map((u) => [u.underlier, u.lastAt])) === JSON.stringify(unc.sort((a, b) => (a.underlier < b.underlier ? -1 : 1)).map((u) => [u.underlier, u.lastAt])));
  ck("comp.window", fm.compliance.lookbackDays === RHB.WASH_LOOKBACK_DAYS && fm.compliance.washWindowDays === LED.WASH_WINDOW_DAYS);
  ck("comp.through", fm.compliance.dynamic.every((u) => RHB.banReasonFrom(ip.rhFills, u.underlier, Date.parse(u.lastAt) + RHB.WASH_LOOKBACK_DAYS * 86_400_000) != null && RHB.banReasonFrom(ip.rhFills, u.underlier, Date.parse(u.lastAt) + (RHB.WASH_LOOKBACK_DAYS + 1) * 86_400_000) == null && u.throughDate === etDateOf(Date.parse(u.lastAt) + RHB.WASH_LOOKBACK_DAYS * 86_400_000)));
  ck("comp.gate", fm.compliance.dossiers === ALL_DOSSIERS.length && fm.compliance.addable === ALL_DOSSIERS.filter((d) => UNI.canAdd(d).canAdd).length && fm.compliance.blocked === ALL_DOSSIERS.filter((d) => !UNI.canAdd(d).canAdd).length);
  const watchSet = [...ALL_DOSSIERS.filter((d) => d.watch).map((d) => `d:${d.ticker}`), ...LB.LONG_NAMES.filter((n) => n.watch).map((n) => `b:${n.ticker}`)].slice(0, 6);
  ck("comp.watch", JSON.stringify(fm.compliance.watch.map((w) => `${w.source === "dossier" ? "d" : "b"}:${w.ticker}`)) === JSON.stringify(watchSet));
  ck("comp.held", JSON.stringify(fm.compliance.heldBanned.map((b) => b.ticker)) === JSON.stringify(ip.book.banned.map((b) => b.ticker)));
  // diligence — kill-watch.ts isDue / killQueries, kill-store.ts trippedFrom
  const k = ip.kill;
  const due = KW.isDue({ lastCheckedAt: k?.lastRun?.ranAt ?? null }, ip.nowMs);
  ck("dd.rules", fm.diligence.rules === KW.killQueries(ip.nowMs).length && fm.diligence.intervalDays === KW.CHECK_INTERVAL_DAYS);
  ck("dd.due", fm.diligence.due === due.due && fm.diligence.daysSince === due.daysSince && fm.diligence.dueInDays === (k?.lastRun ? (due.due ? 0 : KW.CHECK_INTERVAL_DAYS - due.daysSince) : null));
  ck("dd.tripped", JSON.stringify(fm.diligence.tripped.map((t) => t.ticker)) === JSON.stringify([...KS.trippedFrom(k?.judgements ?? []).keys()].slice(0, 4)));
  ck("dd.results", fm.diligence.results === (k?.lastRun?.results.length ?? 0) && fm.diligence.sourced === (k?.lastRun?.results.filter((r) => r.citations.length > 0).length ?? 0));
  // ops — ledger.ts replay problems, policy.ts missedMonths / deployQueue
  if (ip.ledger) {
    const o = fm.ops;
    ck("ops.entries", o.entries === ip.ledger.entries.length && o.problemCount === ip.ledger.problems.length);
    ck("ops.kinds", o.problems.reduce((s, p) => s + p.n, 0) === ip.ledger.problems.length && o.problems.every((p) => p.kind !== "other"));
    const missed = POL.missedMonths(ip.ledger.sweeps, ip.dayKey.slice(0, 7));
    ck("ops.missed", o.missedCount === missed.length && JSON.stringify(o.missed) === JSON.stringify(missed.slice(-6)));
    ck("ops.voids", o.voidCount === ip.ledger.voided.size && o.voids.every((v) => [...ip.ledger.voided.values()].some((x) => x.date === v.date && x.reason.startsWith(v.reason.slice(0, 20)))));
    ck("ops.overspend", o.overSpendUsd === Math.max(0, Math.round((ip.queue.deployedUsd - ip.queue.sweptUsd) * 100) / 100) && o.waitingUsd === ip.queue.waitingUsd);
    ck("ops.journal", o.journal.fills === ip.rhFills.length && o.journal.cap === RHB.RH_JOURNAL_CAP);
    // tax — ledger.ts taxYear / heldPositions
    const y = Number(ip.dayKey.slice(0, 4));
    const ty = LED.taxYear(ip.ledger, y);
    const t = fm.tax;
    ck("tax.year", t.thisYear.stGainUsd === ty.stGainUsd && t.thisYear.ltGainUsd === ty.ltGainUsd && t.thisYear.dividendsUsd === ty.dividendsUsd && t.thisYear.washDeferredEstUsd === ty.washDeferredEstUsd && t.thisYear.sales === ty.sales && t.thisYear.year === y);
    const hp = LED.heldPositions(ip.ledger, ip.dayKey);
    ck("tax.lots", t.openLots === hp.reduce((s, h) => s + h.lots.length, 0) && t.positions.every((p, i) => p.ticker === hp[i].ticker && p.lots === hp[i].lots.length && p.nextLongTerm === hp[i].nextLongTerm && near(p.longTermShares, hp[i].longTermShares)));
    const nt = hp.filter((h) => h.nextLongTerm).sort((a, b) => (a.nextLongTerm < b.nextLongTerm ? -1 : 1))[0];
    ck("tax.next", (nt ? t.nextTurn?.ticker === nt.ticker && t.nextTurn?.date === nt.nextLongTerm : t.nextTurn === null) && t.washFlagged === ip.ledger.sales.filter((s) => s.date.startsWith(String(y)) && s.wash).length);
    // funding — policy.ts planSweep / rentVsSweep / realizedNeededFor, rh-bridge.ts rhMonthFrom
    const fu = fm.funding;
    const lastSweep = [...ip.ledger.sweeps].sort((a, b) => (a.month < b.month ? 1 : -1))[0];
    if (lastSweep) {
      const plan = POL.planSweep({ realizedMonthUsd: lastSweep.realizedUsd, monthClosed: true, sleeveEquityUsd: POL.SLEEVE_TARGET_USD - lastSweep.restoreUsd, closedMonths: lastSweep.rate >= POL.SWEEP_RATE_ESTABLISHED ? POL.SWEEP_ESTABLISHED_MIN_MONTHS : 0, fullRateEarned: lastSweep.rate >= POL.SWEEP_RATE_FULL });
      const rv = POL.rentVsSweep({ ...plan, sweepUsd: lastSweep.sweptUsd });
      ck("fund.last", fu.last.month === lastSweep.month && fu.last.realizedUsd === lastSweep.realizedUsd && fu.last.sweptUsd === lastSweep.sweptUsd && fu.last.rentDrag === plan.rentDrag && fu.last.rentAlarm === plan.rentAlarm && fu.last.annualRentUsd === rv.annualRent && fu.last.annualSweepUsd === rv.annualSweep);
    } else ck("fund.last", fu.last === null);
    ck("fund.needs", fu.needs.every((n) => n.realizedUsd === POL.realizedNeededFor(n.sweepUsd, ip.ladder.rate)) && fu.ratePct === Math.round(ip.ladder.rate * 100) && fu.rentUsd === POL.DATA_RENT_MONTHLY_USD && fu.rentAlarmAt === POL.RENT_DRAG_ALARM);
    const m = RHB.rhMonthFrom(ip.rhFills, FIRM.priorMonthOf(ip.dayKey));
    ck("fund.journal", fu.journal.month === m.month && fu.journal.realizedUsd === m.realizedUsd && fu.journal.closed === m.closedCount && fu.journal.open === m.openCount && fu.journal.openDebitUsd === m.openDebitUsd);
  }
  // memo — dossiers.ts, factors.ts, durability.ts, evidence.ts, universe.ts
  const cand = FIRM.memoCandidates(ip.held);
  const pick = cand[LTYPES.hash32(day) % cand.length];
  const me = fm.memo;
  ck("memo.pick", me.ticker === pick && cand.every((t) => ALL_DOSSIERS.find((d) => d.ticker === t)?.kind !== "fund"));
  const d = ALL_DOSSIERS.find((x) => x.ticker === pick);
  const rvd = DUR.requiredVsDelivered(pick);
  const ey = FACT.earningsYield(UNI.fundamentalsFor(pick));
  ck("memo.valuation", me.required === rvd.required && me.delivered === rvd.delivered && me.read === rvd.read && me.earningsYield === (ey.forward ?? ey.trailing) && me.spreadPts === ey.spreadPts && me.riskFreePct === RISK_FREE.yieldPct && me.riskFreeAsOf === RISK_FREE.asOf && me.durabilityAsOf === DUR.durabilityCapturedAt());
  ck("memo.dossier", d ? me.sells === d.sells.replace(/\s+/g, " ").trim().slice(0, 220) || me.sells?.startsWith(d.sells.slice(0, 40)) : me.dossier === false);
  ck("memo.gate", d ? me.gate.canAdd === UNI.canAdd(d).canAdd && me.operator.level === EVID.evidenceFor(pick, "governance.ceo") && me.maxWeight === d.maxWeight : true);
  // board — funnel.ts splitSweep / FUNNEL, long-board.ts gradeBoard / LEFT_OFF, ipo.ts
  const sp = FUN.splitSweep(ip.queue.waitingUsd, cards);
  ck("board.split", fm.board.split.length === sp.length && fm.board.split.every((s, i) => s.sleeve === sp[i].sleeve && s.weight === sp[i].weight && s.usd === sp[i].usd && s.ticker === sp[i].ticker) && near(fm.board.split.reduce((s, x) => s + x.weight, 0), 1, 1e-9) && near(fm.board.split.reduce((s, x) => s + x.usd, 0), ip.queue.waitingUsd, 0.011));
  ck("board.counts", fm.board.counts.pass === cards.filter((c) => c.state === "pass").length && fm.board.counts.wait === cards.filter((c) => c.state === "wait").length && fm.board.counts.fail === cards.filter((c) => c.state === "fail").length && fm.board.counts.total === LB.LONG_NAMES.length);
  ck("board.leftoff", JSON.stringify(fm.board.leftOff.map((l) => l.area)) === JSON.stringify(LB.LEFT_OFF.map((l) => l.area)));
  const priced = IPO.pricedIpos(day).filter((p) => p.read.stage !== "research");
  ck("board.ipo", fm.board.ipo.capturedAt === IPO.ipoCapturedAt() && fm.board.ipo.upcoming === IPO.upcomingIpos(day).length && fm.board.ipo.priced.every((p) => priced.some((q) => q.ticker === p.ticker && q.read.stage === p.stage && q.read.eligibleFrom === p.eligibleFrom && q.read.lockupEnds === p.lockupEnds)) && fm.board.ipo.priced.length === Math.min(4, priced.length));
  // policy — factors.ts HORIZON_EVIDENCE / BASE_RATES, evidence.ts STALENESS_TRAPS: each sentence is the tab's own first sentence
  ck("policy.horizon", fm.policy.horizons.length === FACT.HORIZON_EVIDENCE.length && fm.policy.horizons.every((h, i) => FACT.HORIZON_EVIDENCE[i].verdict.startsWith(h.say) && FACT.HORIZON_EVIDENCE[i].horizon === h.horizon && FACT.HORIZON_EVIDENCE[i].usable === h.usable));
  ck("policy.rates", fm.policy.baseRates.length === FACT.BASE_RATES.length && fm.policy.baseRates.every((b, i) => FACT.BASE_RATES[i].claim.startsWith(b.say) && FACT.BASE_RATES[i].soWhat.startsWith(b.soWhat) && FACT.BASE_RATES[i].id === b.id));
  ck("policy.traps", fm.policy.traps.length === EVID.STALENESS_TRAPS.length && fm.policy.traps.every((t, i) => EVID.STALENESS_TRAPS[i].lesson.startsWith(t.lesson) && EVID.STALENESS_TRAPS[i].ticker === t.ticker));
  // freshness — the five snapshots' own dates
  const snaps = [["universe", UNI.snapshotCapturedAt()], ["durability", DUR.durabilityCapturedAt()], ["fund-profiles", EXP.profilesCapturedAt()], ["ipo-watch", IPO.ipoCapturedAt()]];
  ck("fresh.ages", snaps.every(([id, asOf]) => fm.fresh.items.find((x) => x.id === id)?.asOf === asOf && fm.fresh.items.find((x) => x.id === id)?.ageDays === IR.daysBetween(asOf, day)) && fm.fresh.maxDays === LB.CAPTURE_MAX_DAYS && fm.fresh.stale === (fm.fresh.stalest.ageDays > LB.CAPTURE_MAX_DAYS) && fm.fresh.items.every((x) => x.ageDays <= fm.fresh.stalest.ageDays));
  ck("macro.riskfree", fm.macro.riskFreePct === RISK_FREE.yieldPct && fm.macro.riskFreeAsOf === RISK_FREE.asOf);
}
function near(a, b, e = 1e-4) {
  return Math.abs(a - b) <= e;
}
{
  check("every review reads the Invest tab's own function: risk, compliance, diligence, ops, tax, funding, memo, board, policy, freshness (differential, 40+ comparisons)", diffFirm(FM).length === 0, diffFirm(FM).join(", "));
  check("the firm is small enough to ride in a frame (under 24 KB of JSON) and deterministic", JSON.stringify(FM).length < 24_000 && JSON.stringify(buildInvest(firmInputs(FIRM_ENTRIES)).firm) === JSON.stringify(FM), String(JSON.stringify(FM).length));
  // The seeded world really does exercise what it claims.
  check("the seeded world has: a long-term lot and a short-term one, a loss sale flagged as a wash, a dividend, a missing month, a voided typo, a journal ban and a tripped rule", FM.tax.positions[0].longTermShares > 0 && FM.tax.thisYear.sales === 1 && FM.tax.washFlagged === 1 && FM.tax.thisYear.dividendsUsd === 9.4 && FM.ops.missed.includes("2026-08") && FM.ops.voidCount === 1 && FM.compliance.dynamic[0]?.underlier === "IWM" && FM.diligence.tripped[0]?.ticker === "ETN", JSON.stringify([FM.tax.positions[0], FM.tax.washFlagged, FM.ops.missed, FM.compliance.dynamic, FM.diligence.tripped]));
  check("QQQ in the journal is not 'added' (it is on the fixed list), and a fill older than the window adds nothing", !FM.compliance.dynamic.some((u) => u.underlier === "QQQ" || u.underlier === "XLK"));
  check("no ledger, no ops/tax/funding — null, never a guess", buildInvest({ ...inputsFor(), ledger: null }).firm.ops === null && buildInvest({ ...inputsFor(), ledger: null }).firm.tax === null && buildInvest({ ...inputsFor(), ledger: null }).firm.funding === null && INV.firm.ops === null);
  check("an unreadable journal is null, not 'no trades'", buildInvest(firmInputs(FIRM_ENTRIES, { rhFills: null })).firm.compliance.journalFills === null && buildInvest(firmInputs(FIRM_ENTRIES, { rhFills: null })).firm.funding.journal === null);
  check("the date picks the memo name, never a ranking: forty dates reach several names and the name is a dossier company or a held one", new Set(Array.from({ length: 40 }, (_, k) => buildInvest(firmInputs(FIRM_ENTRIES, { dayKey: IR.plusDays("2026-10-05", k) })).firm.memo.ticker)).size >= 6);
}

/* The mutants: a builder that moves a number must be caught by the differential. */
{
  const tweak = (fn) => {
    const c = JSON.parse(JSON.stringify(FM));
    fn(c);
    return c;
  };
  const MUT = [
    ["risk overlap moved", (c) => (c.risk.overlapQQQ += 0.01), "risk.overlap"],
    ["a name weight moved", (c) => (c.risk.names[0].weight += 0.01), "risk.names"],
    ["a sleeve flagged over the cap that is not", (c) => (c.risk.sleeves[0].over = !c.risk.sleeves[0].over), "risk.sleeves"],
    ["the wash window changed", (c) => (c.compliance.washWindowDays += 1), "comp.window"],
    ["a ban date moved by a day", (c) => (c.compliance.dynamic[0].throughDate = IR.plusDays(c.compliance.dynamic[0].throughDate, 1)), "comp.through"],
    ["a gate count moved", (c) => (c.compliance.addable += 1), "comp.gate"],
    ["a kill rule judged tripped that no person judged", (c) => c.diligence.tripped.push({ ticker: "NVDA", judgedAt: "2026-10-01T00:00:00Z" }), "dd.tripped"],
    ["days until the next check moved", (c) => (c.diligence.dueInDays += 1), "dd.due"],
    ["a missed month dropped", (c) => (c.ops.missed = []), "ops.missed"],
    ["an over-spend invented", (c) => (c.ops.overSpendUsd = 500), "ops.overspend"],
    ["the short-term gain moved", (c) => (c.tax.thisYear.stGainUsd += 5), "tax.year"],
    ["a lot clock moved", (c) => (c.tax.positions[0].nextLongTerm = "2027-01-01"), "tax.lots"],
    ["the rent drag moved", (c) => (c.funding.last.rentDrag += 0.05), "fund.last"],
    ["a needed-realized figure moved", (c) => (c.funding.needs[1].realizedUsd += 10), "fund.needs"],
    ["the memo's required growth moved", (c) => (c.memo.required += 0.01), "memo.valuation"],
    ["a sleeve dollar moved", (c) => (c.board.split[0].usd += 1), "board.split"],
    ["a pass count moved", (c) => (c.board.counts.pass += 1), "board.counts"],
    ["a base rate reworded", (c) => (c.policy.baseRates[0].say = `${c.policy.baseRates[0].say} Always.`), "policy.rates"],
    ["a snapshot's age moved", (c) => (c.fresh.items[0].ageDays += 3), "fresh.ages"],
  ];
  const missed = MUT.filter(([, fn, expect]) => !diffFirm(tweak(fn)).includes(expect));
  check(`${MUT.length} mutants of the firm (a moved number, a moved date, a moved count) are each caught by the differential`, missed.length === 0, missed.map((m) => m[0]).join("; "));
}

/* The voices: each review's words carry the Invest tab's numbers, and every guard holds. */
{
  const FMT = (x, dp = 0) => fmt(x, dp);
  const lt = EXP.lookThrough(IP.book.positions.map((p) => ({ ticker: p.ticker, valueUsd: p.valueUsd })));
  const risk = runFirm("risk", (c) => FV.exFirmRisk(c, { inv: INVF }));
  check("risk: five people, wing spots, no verdict word, nothing at a price; says the overlap, the tech weight, the biggest line and the cap", risk.ex && risk.ex.lines.length >= 5 && new Set(risk.ex.lines.map((l) => l.character)).size >= 4 && risk.bad.length === 0 && has(risk.text, `${Math.round(lt.overlapQQQ * 100)}%`, `${Math.round(lt.techWeight * 100)}%`, `${(lt.names[0].weight * 100).toFixed(1)}%`, lt.names[0].ticker, `${Math.round(LB.NAME_CAP * 100)}%`, `${Math.round(EXP.OVERLAP_WARN * 100)}%`).length === 0, risk.bad.join(" | ") || risk.text);
  check("risk: it teaches the mechanism (the smaller of the two weights, added up) and says why compute is the small sleeve, in the tab's own words", risk.text.all(/smaller of its weight/) && risk.text.includes(FM.risk.computeWhy.slice(0, 30)) && FM.risk.computeNames.every((t) => risk.text.includes(t)) && risk.text.includes(`${Math.round(FM.risk.computeShare * 100)}%`), risk.text);
  check("risk: the safety sleeve is the net — the cap is read about the others, and the line says so", risk.text.all(/Safety is the net/));
  const comp = runFirm("compliance", (c) => FV.exFirmCompliance(c, { inv: INVF }));
  check("compliance: the fixed list, the journal's extra underlier with the day it clears, the 30-day rule and the gate count", comp.ex && comp.bad.length === 0 && has(comp.text, ...Object.keys(UNI.WASH_SALE_BANNED), "IWM", "25 November", `${RHB.WASH_LOOKBACK_DAYS} day`, `${LED.WASH_WINDOW_DAYS} days either side`, `${ALL_DOSSIERS.filter((d) => UNI.canAdd(d).canAdd).length} of ${ALL_DOSSIERS.length}`).length === 0, comp.bad.join(" | ") || comp.text);
  check("compliance: it names the watch names and one written clearing condition word for word", FM.compliance.watch.every((w) => comp.text.includes(w.ticker)) && FM.compliance.watch.some((w) => comp.text.includes(w.clearsWhen.slice(0, 40))), comp.text.slice(-300));
  const dd = runFirm("diligence", (c) => FV.exFirmDiligence(c, { inv: INVF }));
  check("diligence: the weekly interval, the last check with its age, sourced answers, the tripped rule a PERSON judged, and that the model never trips one", dd.ex && dd.bad.length === 0 && has(dd.text, `${KW.CHECK_INTERVAL_DAYS} days`, "1 October", "5 days ago", "2 of 3 answers", "ETN", "never trips a rule", `${KW.CHECK_INTERVAL_DAYS - 5} days`).length === 0, dd.bad.join(" | ") || dd.text);
  const ops = runFirm("ops", (c) => FV.exFirmOps(c, { inv: INVF }));
  check("ops: the entry count, the voided typo with its reason, the missing month, the journal's cap, and that the sync result is the tab's to show", ops.ex && ops.bad.length === 0 && has(ops.text, `${IP.ledger.entries.length} entries`, "typed the wrong ticker", "August 2026", `${RHB.RH_JOURNAL_CAP} fills`, "only on the Invest tab").length === 0, ops.bad.join(" | ") || ops.text);
  const tax = runFirm("tax", (c) => FV.exFirmTax(c, { inv: INVF }));
  const ty = LED.taxYear(IP.ledger, 2026);
  check("tax: open lots, the lot clock, the realized year (a loss said as a loss), dividends, wash sales — and no unrealized figure", tax.ex && tax.bad.length === 0 && has(tax.text, `${FM.tax.openLots} open lots`, "5 May 2027", "a loss of $20", "$9.40", "a wash sale", "Unrealized gains").length === 0 && ty.ltGainUsd === -20, tax.bad.join(" | ") || tax.text);
  const fund = runFirm("funding", (c) => FV.exFirmFunding(c, { inv: INVF }));
  check("funding: the waterfall order, the last logged month, rent drag, the annual rent against the annual sweep, the journal's month, and the backwards arithmetic", fund.ex && fund.bad.length === 0 && has(fund.text, "$199", "$1,000", "20%", "September 2026", "$1,100", "$140.50", "18%", "$2,388", "$1,686", "$699", "a gain of $40").length === 0, fund.bad.join(" | ") || fund.text);
  const memo = runFirm("memo", (c) => FV.exFirmMemo(c, { inv: INVF }));
  check("memo: five content lines across the five people, the dated valuation read, the whole kill rule, ending with the house wording", memo.ex && memo.bad.length === 0 && new Set(memo.ex.lines.map((l) => l.character)).size === 5 && /None of this is a recommendation/.test(memo.ex.lines.at(-1).text) && memo.text.includes(FM.memo?.name) && (FM.memo?.killRule ? memo.text.includes(FM.memo?.killRule.slice(0, 60)) : true) && memo.text.includes(String((FM.memo?.required * 100).toFixed(1))), memo.bad.join(" | ") || memo.text);
  const board = runFirm("board", (c) => FV.exFirmBoard(c, { inv: INVF }));
  check("board: the eight-way split, the next names, the pass/wait/fail count with the commonest reason, a left-off area, the IPO rule", board.ex && board.bad.length === 0 && has(board.text, "42%", "14%", "12%", "6%", "5%", "4%", "3%", `${LB.LONG_NAMES.length} names`, "2 pass", "No dossier", "four public quarters").length === 0, board.bad.join(" | ") || board.text);
  const pol = runFirm("policy", (c) => FV.exFirmPolicy(c, { inv: INVF }));
  check("policy: the three horizons, 'growth does not persist beyond chance' and 'the price already assumes a growth rate', a base rate and a staleness trap", pol.ex && pol.bad.length === 0 && has(pol.text, "Growth does not persist beyond chance", "the price already assumes", FM.policy.horizons[2].say, FM.policy.baseRates[2].say.slice(0, 40)).length === 0, pol.bad.join(" | ") || pol.text);
  const staleFresh = { ...INVF, firm: { ...FM, fresh: { ...FM.fresh, stale: true, stalest: { id: "fund-profiles", label: "fund profiles", asOf: "2026-08-01", ageDays: 66 } } } };
  const fr = runFirm("fresh", (c) => FV.exFirmFresh(c, { inv: staleFresh }));
  check("freshness: said only when the stalest snapshot is past the board's line; names it, its date and its age", fr.ex && fr.bad.length === 0 && has(fr.text, "fund profiles", "1 August", "66 days", `${LB.CAPTURE_MAX_DAYS}`, "Look-through and overlap").length === 0 && runFirm("fresh0", (c) => FV.exFirmFresh(c, { inv: INVF }), { keep: false }).ex === null, fr.bad.join(" | ") || fr.text);
  const mac = runFirm("macro", (c) => FV.exFirmMacro(c, { inv: INVF, pulse: { vix: 16.2, tenYear: 4.1, at: NOW } }));
  const mr = IR.macroRead(FM, { vix: 16.2, tenYear: 4.1 });
  check("macro: the live ten-year beside the dossiers' dated one (5.18% as of 24 September), the shift in every spread as arithmetic, and a worked name", mac.ex && mac.bad.length === 0 && has(mac.text, "4.10%", "5.18%", "24 September", `${Math.abs(mr.deltaPts).toFixed(2)} points lower`, `${Math.abs(mr.deltaPts).toFixed(2)} points wider`, "not a call").length === 0 && mr.deltaPts === Math.round((4.1 - RISK_FREE.yieldPct) * 100) / 100, mac.bad.join(" | ") || mac.text);
  check("macro: no pulse, no exchange", FV.exFirmMacro(ctxF("m0"), { inv: INVF, pulse: { vix: 16, tenYear: null, at: NOW } }) === null);
  const minutes = runFirm("minutes", (c) => IV.exInvBoard(c, { inv: INVF }));
  check("the evening board's minutes carry the week's rhythm — Tuesday's standing review, named from the list the board TV draws", minutes.ex && minutes.bad.length === 0 && minutes.text.all(/risk committee and compliance on today's calendar: look-through and caps, then the restricted list/) && IR.firmDay(INVF.dayKey).title === "Risk committee and compliance", minutes.bad.join(" | ") || minutes.text);

  // The same voices on every other world: nothing held, nothing logged, a dark journal, a ledger with problems.
  const worlds = {
    "empty book": buildInvest({ ...firmInputs([]), rhFills: [], kill: { lastRun: null, judgements: [] } }),
    "no ledger": INV,
    "journal and kill record unreadable": buildInvest(firmInputs(FIRM_ENTRIES, { rhFills: null, kill: null })),
    "a tripped rule and a banned holding": buildInvest(firmInputs([...FIRM_ENTRIES, E({ id: "buy-9", kind: "buy", date: "2026-09-10", ticker: "SPY", sleeve: "ballast", shares: 1, costUsd: 600, source: "other" })])),
  };
  const bad = [];
  let spoken = 0;
  for (const [wn, w] of Object.entries(worlds)) {
    for (const [name, fn] of [
      ["risk", (c) => FV.exFirmRisk(c, { inv: w })],
      ["compliance", (c) => FV.exFirmCompliance(c, { inv: w })],
      ["diligence", (c) => FV.exFirmDiligence(c, { inv: w })],
      ["ops", (c) => FV.exFirmOps(c, { inv: w })],
      ["tax", (c) => FV.exFirmTax(c, { inv: w })],
      ["funding", (c) => FV.exFirmFunding(c, { inv: w })],
      ["memo", (c) => FV.exFirmMemo(c, { inv: w })],
      ["board", (c) => FV.exFirmBoard(c, { inv: w })],
      ["policy", (c) => FV.exFirmPolicy(c, { inv: w })],
      ["macro", (c) => FV.exFirmMacro(c, { inv: w, pulse: { vix: 21.4, tenYear: 5.3, at: NOW } })],
    ]) {
      const r = runFirm(`${wn}|${name}`, fn);
      if (!r.ex) continue;
      spoken++;
      bad.push(...r.bad.map((b) => `${wn}/${name}: ${b}`));
    }
  }
  check(`the same ten voices on four other worlds (empty book, no ledger, unreadable stores, a tripped rule with a banned holding) are legal, sourced, and clean (${spoken} exchanges)`, spoken >= 28 && bad.length === 0, bad.slice(0, 3).join(" | "));
  const banned = worlds["a tripped rule and a banned holding"];
  const cb = runFirm("banned", (c) => FV.exFirmCompliance(c, { inv: banned }), { keep: false });
  check("a banned holding is the first thing the chair says", banned.firm.compliance.heldBanned.some((h) => h.ticker === "SPY") && /holds SPY/.test(cb.ex.lines[0].text) && cb.ex.lines[0].character === "Sterling", cb.text?.slice(0, 160));
  // Every memo candidate, on many dates, through the voice and the speech check.
  const names = FIRM.memoCandidates(["SPCX", "VST"]);
  const memoBad = [];
  let memoN = 0;
  for (let k = 0; k < 90; k++) {
    const day = IR.plusDays("2026-10-05", k);
    const w = buildInvest(firmInputs(FIRM_ENTRIES.concat([]), { dayKey: day }));
    const r = runFirm(`memo|${day}`, (c) => FV.exFirmMemo(c, { inv: w }));
    memoN++;
    if (!r.ex) memoBad.push(`${day}: null`);
    else memoBad.push(...r.bad.map((b) => `${day} ${w.firm.memo.ticker}: ${b}`));
  }
  // …and each name by force: for every candidate, a date that picks it, so every dossier's own words go through the voice and the speech check.
  const extra = [E({ id: "buy-vst", kind: "buy", date: "2026-09-10", ticker: "VST", sleeve: "compounder", shares: 0.4, costUsd: 60, source: "other" }), E({ id: "buy-isrg", kind: "buy", date: "2026-09-10", ticker: "ISRG", sleeve: "compounder", shares: 0.1, costUsd: 60, source: "other" }), E({ id: "buy-spcx", kind: "buy", date: "2026-09-10", ticker: "SPCX", sleeve: "compounder", shares: 0.3, costUsd: 60, source: "other" })];
  const withExtra = firmInputs([...FIRM_ENTRIES, ...extra]);
  const covered = new Set();
  for (const t of FIRM.memoCandidates(withExtra.held)) {
    let k = 0;
    while (k < 2000 && FIRM.memoPick(IR.plusDays("2026-10-05", k), withExtra.held) !== t) k++;
    const day = IR.plusDays("2026-10-05", k);
    const w = buildInvest(firmInputs([...FIRM_ENTRIES, ...extra], { dayKey: day }));
    const r = runFirm(`memo-by-name|${t}`, (c) => FV.exFirmMemo(c, { inv: w }));
    covered.add(w.firm.memo?.ticker);
    if (!r.ex || w.firm.memo.ticker !== t) memoBad.push(`${t}: ${r.ex ? "wrong name" : "null"}`);
    else memoBad.push(...r.bad.map((b) => `${t}: ${b}`));
  }
  check(`the memo, on ${memoN} consecutive dates and by every candidate name (${covered.size}: the dossier companies plus three long-board holdings), never breaks a guard and is always speakable`, covered.size === FIRM.memoCandidates(withExtra.held).length && covered.size >= 12 && memoBad.length === 0, memoBad.slice(0, 3).join(" | "));
}

/* The guards have teeth: each mutant of a finished exchange is caught by the check meant for it. */
{
  const base = runFirm("mutants", (c) => FV.exFirmRisk(c, { inv: INVF }), { keep: false }).item;
  const withLine = (fn) => ({ ...base, lines: base.lines.map((l, i) => (i === 1 ? { ...l, text: fn(l.text) } : l)) });
  const MUT = [
    ["a moved number (the overlap said as 27%, registered nowhere)", (t) => t.replace(/\d+%/, "97%"), (item) => unsourced(item).length > 0],
    ["a desk verdict word on the exchange", (t) => `${t} TAKE it.`, (item) => legal(item).some((b) => /verdict word/.test(b))],
    ["an advice phrase", (t) => `${t} You should add more.`, (item) => legal(item).some((b) => /advice/.test(b))],
    ["a per-name ADD", (t) => `${t} NVDA is ADD.`, (item) => extraBad(item).some((b) => /per-name/.test(b))],
    ["a per-name TRIM", (t) => `${t} Trim MSFT.`.replace("Trim", "TRIM"), (item) => extraBad(item).some((b) => /per-name/.test(b))],
    ["a price claimed from a book valued at cost", (t) => `${t} The book is up since purchase and the unrealized gain is solid.`, (item) => extraBad(item).some((b) => /price or performance/.test(b))],
    ["a drawdown claimed from a book valued at cost", (t) => `${t} Drawdown of the book is small.`, (item) => extraBad(item).some((b) => /price or performance/.test(b))],
    ["a line over the word cap", (t) => `${t} ${"word ".repeat(40)}`, (item) => legal(item).some((b) => /words/.test(b))],
  ];
  const missed = MUT.filter(([, fn, caught]) => !caught(withLine(fn)));
  check(`${MUT.length} mutants of a finished exchange are each caught by the guard meant for them`, missed.length === 0, missed.map((m) => m[0]).join("; "));
  // And the negations are allowed: the sentences that say the Floor holds no prices are honest, not claims.
  check("the honest sentences pass: 'nothing here is a gain or a drawdown', 'unrealized gains need prices, and the Floor holds none'", priceClaims("All of this is at cost. The Floor holds no prices, so nothing here is a gain or a drawdown.").length === 0 && priceClaims("Unrealized gains and harvest candidates need prices, and the Floor holds none.").length === 0 && !perNameWord("the Invest tab's ADD list and the ADD gate"));
  // A spoken mutant: a line that would be handed to the speech engine with a moved number.
  const moved = spokenProblems([{ character: "Nova", text: "Opened up, this book overlaps QQQ by 26%.", spoken: undefined }], { say: () => "Opened up, this book overlaps Q Q Q by 62 percent." });
  check("the speech check catches a number moved between the caption and the voice", moved.length > 0, JSON.stringify(moved));
}

/* The week: one review a slot, on its weekday, outside the live window, once a day, the same on a replay. */
console.log("the firm's week");
const FIRM_EV = [];
{
  const worldFor = (date, extra = {}) => ({ invest: buildInvest(firmInputs(FIRM_ENTRIES, { dayKey: date })), ...extra });
  const days = { Mon: "2026-10-05", Tue: "2026-10-06", Wed: "2026-10-07", Thu: "2026-10-08", Fri: "2026-10-09", Sat: "2026-10-10", Sun: "2026-10-11" };
  const WANT = { Mon: ["memo", "macro"], Tue: ["risk", "compliance"], Wed: ["ops", "diligence"], Thu: ["tax", "funding"], Fri: ["board", "policy"], Sat: [], Sun: [] };
  let state = freshTalkState();
  const ran = {};
  const before = {};
  for (const [dn, date] of Object.entries(days)) {
    before[dn] = state;
    const r = runDay(date, { state, world: worldFor(date) });
    state = r.state;
    ran[dn] = r;
    const firmItems = r.items.filter((i) => i.topic.startsWith("invest:firm:"));
    FIRM_EV.push(...firmItems.map((i) => ({ ...i, etMin: i.etMin, label: i.label })));
    const ids = firmItems.map((i) => i.topic.split(":")[2]);
    check(`${dn}: the standing reviews are ${WANT[dn].length ? WANT[dn].join(" then ") : "none"} — each once, in the week's order`, JSON.stringify(ids) === JSON.stringify(WANT[dn]), `${ids.join()} on ${date}`);
    if (WANT[dn].length) {
      const trading = !["Sat", "Sun"].includes(dn);
      check(`${dn}: the first opens after the live window (${trading ? "12:15" : "10:30"}) and the second in the afternoon (${trading ? "15:00" : "14:00"}); never inside 09:25–11:15`, firmItems[0].etMin >= (trading ? 12 * 60 + 15 : 10 * 60 + 30) && firmItems[1].etMin >= (trading ? 15 * 60 : 14 * 60) && firmItems.every((i) => i.etMin < 9 * 60 + 25 || i.etMin >= 11 * 60 + 15), firmItems.map((i) => hhmm(i.etMin)).join());
      check(`${dn}: chatter only, wing spots only, every number registered, no verdict word, no advice, no per-name word, no price claim`, firmItems.every((i) => i.urgency === 0 && legal(i).length === 0 && unsourced(i).length === 0 && extraBad(i).length === 0), firmItems.flatMap((i) => [...legal(i), ...unsourced(i), ...extraBad(i)]).join(" | "));
    }
  }
  const replay = runDay(days.Tue, { state: before.Tue, world: worldFor(days.Tue) });
  check("the same day replays identically from the same start (no timer, no randomness)", JSON.stringify(replay.items.map((i) => [i.topic, i.etMin, i.lines])) === JSON.stringify(ran.Tue.items.map((i) => [i.topic, i.etMin, i.lines])));
  const again = runDay(days.Tue, { state: ran.Tue.state, world: worldFor(days.Tue) });
  check("the same Tuesday again says nothing new", again.items.length === 0, again.items.map((i) => i.topic).join());
  // A late load: both of the day's reviews are due, both are said, one at a time.
  const late = runDay(days.Thu, { from: 15 * 60 + 30, to: 18 * 60, world: worldFor(days.Thu) });
  check("a late load (15:30) says both of the day's reviews, once each", late.items.filter((i) => i.topic.startsWith("invest:firm:")).length === 2, late.items.map((i) => i.topic).join());
  // The board TV draws the same week the talk follows.
  const dayName = (date) => IR.firmDay(date).weekday;
  check("firmDay is the week's one list: each weekday's reviews are what the talk said", Object.entries(days).every(([dn, date]) => JSON.stringify(IR.firmDay(date).reviews) === JSON.stringify(WANT[dn]) && dayName(date) === { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" }[dn]));
  // The data's age speaks once while the same snapshot is stale, again if the stalest changes or a week passes.
  const oldW = (date, asOf = "2026-07-01", id = "oldest-row") => {
    const w = worldFor(date);
    const f = w.invest.firm.fresh;
    return { invest: { ...w.invest, firm: { ...w.invest.firm, fresh: { ...f, stale: true, stalest: { id, label: "oldest fundamentals row", asOf, ageDays: IR.daysBetween(asOf, date) } } } } };
  };
  const a1 = runDay(days.Tue, { state: freshTalkState(), world: oldW(days.Tue) });
  const a2 = runDay(days.Wed, { state: a1.state, world: oldW(days.Wed) });
  const a3 = runDay(IR.plusDays(days.Tue, 8), { state: a2.state, world: oldW(IR.plusDays(days.Tue, 8)) });
  const a4 = runDay(days.Wed, { state: a1.state, world: oldW(days.Wed, "2026-07-15", "durability") });
  const fresh = (r) => r.items.filter((i) => i.topic === "invest:firm-fresh");
  check("the data-age review speaks when a snapshot has aged out, not again the next day while it is the same one, again a week on, and at once when a different one is the stalest", fresh(a1).length === 1 && fresh(a2).length === 0 && fresh(a3).length === 1 && fresh(a4).length === 1 && fresh(a1)[0].etMin >= 13 * 60, [fresh(a1).length, fresh(a2).length, fresh(a3).length, fresh(a4).length].join());
  check("…and not at all while everything is inside the line", ran.Tue.items.every((i) => i.topic !== "invest:firm-fresh"));
  // Off the weekly rhythm: a banned holding, a tripped rule or a ledger the replay could not apply is said when it appears, once.
  const SPY_BUY = E({ id: "buy-spy", kind: "buy", date: "2026-09-10", ticker: "SPY", sleeve: "ballast", shares: 1, costUsd: 600, source: "other" });
  const alertWorld = (date, { kill = KILL, entries = [...FIRM_ENTRIES, SPY_BUY] } = {}) => ({ invest: buildInvest(firmInputs(entries, { dayKey: date, kill })) });
  const alerts = (r) => r.items.filter((i) => i.topic.startsWith("invest:firm-alert:"));
  let sa = freshTalkState();
  const sat = runDay("2026-10-10", { state: sa, world: alertWorld("2026-10-10") });
  sa = sat.state;
  const sun = runDay("2026-10-11", { state: sa, world: alertWorld("2026-10-11") });
  sa = sun.state;
  const extraKill = { ...KILL, judgements: [{ id: "kj-9", ticker: "NVDA", tripped: true, judgedAt: "2026-10-09T12:00:00.000Z", note: "export rule took effect", killRule: "r", sources: [] }, ...KILL.judgements] };
  const mon = runDay("2026-10-12", { state: sa, world: alertWorld("2026-10-12", { kill: extraKill }) });
  sa = mon.state;
  const tue = runDay("2026-10-13", { state: sa, world: alertWorld("2026-10-13", { kill: extraKill }) });
  const alertTopics = (r) => alerts(r).map((i) => i.topic.replace("invest:firm-alert:", ""));
  check("a banned holding and a tripped rule are each said once when they appear (Saturday), by the chair first for the ban, not held for their weekday", JSON.stringify(alertTopics(sat).sort()) === JSON.stringify(["compliance", "diligence"]) && alerts(sat).every((i) => i.etMin >= 10 * 60 && i.urgency === 0 && legal(i).length === 0 && unsourced(i).length === 0 && extraBad(i).length === 0) && alerts(sat).find((i) => i.topic.endsWith("compliance")).lines[0].character === "Sterling" && /holds SPY/.test(alerts(sat).find((i) => i.topic.endsWith("compliance")).lines[0].text), alertTopics(sat).join());
  check("…not again the next day while nothing changed", alerts(sun).length === 0, alertTopics(sun).join());
  check("…and again when a different rule is judged tripped (Monday: the diligence alert only; the ban is unchanged)", JSON.stringify(alertTopics(mon)) === JSON.stringify(["diligence"]) && /NVDA/.test(textOf(alerts(mon)[0])), alertTopics(mon).join());
  check("…on the weekday of the same review, the review says it and the alert does not repeat it (Tuesday: the compliance review, no compliance alert)", tue.items.some((i) => i.topic === "invest:firm:compliance:2026-10-13") && !alertTopics(tue).includes("compliance"), tue.items.map((i) => i.topic).join());
  const tueCold = runDay("2026-10-13", { state: freshTalkState(), world: alertWorld("2026-10-13") });
  check("from a cold start on its own weekday the review says the ban and no alert goes ahead of it (Tuesday: compliance is said once, by the review)", tueCold.items.filter((i) => i.topic.includes("compliance")).map((i) => i.topic).join() === "invest:firm:compliance:2026-10-13" && /holds SPY/.test(textOf(tueCold.items.find((i) => i.topic === "invest:firm:compliance:2026-10-13"))), tueCold.items.map((i) => i.topic).join());
  const calm = runDay("2026-10-10", { state: freshTalkState(), world: worldFor("2026-10-10") });
  check("a clean world raises no alert, and the seeded world's one tripped rule raises exactly the diligence alert", alerts(runDay("2026-10-10", { state: freshTalkState(), world: alertWorld("2026-10-10", { kill: { lastRun: KILL.lastRun, judgements: [] }, entries: FIRM_ENTRIES }) })).length === 0 && alertTopics(calm).join() === "diligence", alertTopics(calm).join());
  const bad = LED.replay([E({ id: "dup-1", kind: "buy", date: "2026-01-05", ticker: "VTI", sleeve: "ballast", shares: 1, costUsd: 100, source: "other" }), E({ id: "dup-1", kind: "buy", date: "2026-01-06", ticker: "VTI", sleeve: "ballast", shares: 1, costUsd: 100, source: "other" })]);
  const opsAlert = runDay("2026-10-10", { state: freshTalkState(), world: { invest: buildInvest({ ...firmInputs(FIRM_ENTRIES), dayKey: "2026-10-10", ledger: bad }) } });
  check("a ledger the replay could not apply is said on a day that is not operations day, and by kind", alertTopics(opsAlert).includes("ops") && /repeated id/.test(textOf(alerts(opsAlert).find((i) => i.topic.endsWith("ops")))), alertTopics(opsAlert).join());
  all.push(...FIRM_EV);
}

/* The defects the audit found. */
console.log("the audit's defects");
{
  // 1 — the catalyst scope reaches the long board.
  const EARN = JSON.parse(fs.readFileSync(new URL("../src/data/earnings-calendar.json", import.meta.url), "utf8"));
  const boardRows = EARN.rows.filter((r) => LB.LONG_NAMES.some((n) => n.ticker === r[0]) && r[2] >= "2026-10-10" && r[2] <= IR.plusDays("2026-10-10", CATALYST_WINDOW_DAYS));
  const got = catalystsFor("2026-10-10", [], INV.themes);
  check("1. UNH, ASML and ISRG, which report inside the window and are on the long board, are on the office list as 'board' names", boardRows.length >= 3 && ["UNH", "ASML", "ISRG"].every((t) => got.some((c) => c.ticker === t && c.why === "board" && c.sleeve)), `${boardRows.map((r) => r[0]).join()} vs ${got.map((c) => `${c.ticker}:${c.why}`).join()}`);
  check("   …a held name on the board stays 'held' and keeps its sleeve; a theme vehicle that is on the board is a board name", catalystsFor("2026-10-10", ["UNH"], INV.themes).find((c) => c.ticker === "UNH")?.why === "held" && catalystsFor("2026-10-10", ["UNH"], INV.themes).find((c) => c.ticker === "UNH")?.sleeve === "health");
  // 2 — in-session news matching sees the long board, as the closed-hours study already did.
  const onBoard = LB.LONG_NAMES.map((n) => n.ticker).filter((t) => t.length >= 3);
  const unseen = onBoard.filter((t) => !IR.watchHit(INV, `${t} announces a new contract`, []));
  check("2. every long-board ticker is in the in-session watch map (it was missing CEG, VST, TLN, VRT, BWXT, WMB, ASML, EQIX, DLR, ISRG, ETR, ANET, UNH)", unseen.length === 0, unseen.join());
  check("   …a headline on CEG is a 'board' hit at 14:00, and a held name or a theme vehicle still beats it", IR.watchHit(INV, "CEG signs a long power contract", [])?.kind === "board" && IR.watchHit(INV, `${heldTicker} and CEG both move`, [])?.kind === "held");
  const ceg = { id: "c1", title: "Constellation extends a long power contract", source: "Wire", publishedMs: NOW - 5 * 60_000, tier: 3, why: "", impact: null, tickers: ["CEG"], topics: [], primary: false };
  const pack = STUDY.studyPack({ weekend: false, etDate: DAY, etMin: 17 * 60, news: [ceg], invest: INV, predict: null });
  check("   …and the closed-hours study and the in-session matcher agree on that headline", pack.hits[0]?.ticker === "CEG" && IR.watchHit(INV, ceg.title, ceg.tickers)?.key === "CEG");
  const sess = runDay("2026-10-13", { from: 12 * 60, to: 14 * 60, world: { news: [{ ...ceg, publishedMs: at(2026, 10, 13, 12, 0) - 300_000 }] } });
  check("   …in session, the headline on a board name is announced (chatter, wing spots, board wording)", sess.items.some((i) => i.topic.startsWith("invest:news:") && i.urgency === 0 && /long board/.test(textOf(i)) && legal(i).length === 0 && unsourced(i).length === 0), sess.items.map((i) => i.topic).join());
  // 3 — the news desk's monitor passes the feed's tickers, as the talk does.
  const onlyTickers = { title: "Power names move on a new filing", source: "Wire", age: "4m", tickers: ["CEG"] };
  const frame3 = frameFor(INV);
  frame3.screens.news = [onlyTickers, { title: "Weather turns cooler", source: "Wire", age: "9m", tickers: [] }];
  const t3 = (() => {
    const ctx = mockCtx();
    drawScreen("mon_Inv_2", ctx, 512, 306, frame3, NOW);
    return ctx.texts.join(" | ");
  })();
  check("3. the news desk's monitor shows the headline that carries CEG in its tags, marked BOARD — what the talk would match", IR.watchHit(INV, onlyTickers.title, onlyTickers.tickers)?.kind === "board" && /BOARD · CEG/.test(t3) && IR.watchHit(INV, onlyTickers.title, [])?.kind !== "board", t3.slice(0, 200));
  const engineSrc = fs.readFileSync(new URL("../src/components/room/room-engine.ts", import.meta.url), "utf8");
  check("   …and the engine hands the frame those tags", /tagged = new Map\(lite\.map\(\(n\) => \[n\.title, n\.tickers\]\)\)/.test(engineSrc) && /tickers: tagged\.get\(i\.title\)/.test(engineSrc));
  // 4 — the theme the closed room names is the theme the TV shows.
  const looks = [[6 * 60, false], [17 * 60, false], [14 * 60 + 29, false], [14 * 60 + 30, false], [9 * 60, true], [16 * 60, true]];
  const bad4 = [];
  for (const [etMin, weekend] of looks) {
    const sp = STUDY.studyPack({ weekend, etDate: "2026-10-07", etMin, news: [], invest: { ...INV, dayKey: "2026-10-07" }, predict: null });
    const want = IR.themeOfTheDay({ ...INV, dayKey: "2026-10-07" }, IR.lookAt(etMin, !weekend));
    if (sp.theme?.name !== want.name) bad4.push(`${hhmm(etMin)} ${weekend ? "weekend" : "weekday"}: ${sp.theme?.name} vs ${want.name}`);
  }
  check("4. the closed room's theme is themeOfTheDay at the same look the TV uses (it was a 90-minute bucket of its own)", bad4.length === 0, bad4.join(" | "));
  const tvTheme = (() => {
    const inv = { ...INV, dayKey: "2026-10-07" };
    const ctx = mockCtx();
    drawScreen("tv_theme", ctx, 768, 432, frameFor(inv, at(2026, 10, 7, 17, 0)), at(2026, 10, 7, 17, 0));
    return ctx.texts.join(" | ");
  })();
  const stNow = STUDY.studyPack({ weekend: false, etDate: "2026-10-07", etMin: 17 * 60, news: [], invest: { ...INV, dayKey: "2026-10-07" }, predict: null }).theme;
  check("   …at 17:00 the study pack and tv_theme name the same theme", tvTheme.includes(stNow.name.slice(0, 20)), `${stNow.name} / ${tvTheme.slice(0, 120)}`);
  // 5 — the funnel TV reads the split, it does not hold a copy.
  const screensSrc = fs.readFileSync(new URL("../src/components/room/floor-screens.ts", import.meta.url), "utf8");
  check("5. the funnel TV carries no copy of the eight weights (no ['Safety', 0.42] table, no waiting dollars times a literal weight) and reads the split instead", !/\["Safety", 0\.42\]|waitingUsd \* 0\.\d+/.test(screensSrc) && /inv\.firm\?\.board\.split/.test(screensSrc));
  const waiting = buildInvest(firmInputs(FIRM_ENTRIES));
  const ctx5 = mockCtx();
  drawScreen("tv_funnel", ctx5, 768, 432, frameFor(waiting), NOW);
  const t5 = ctx5.texts.join(" | ");
  check("   …every sleeve's weight and dollars on the TV are splitSweep's (the Invest tab's FUNNEL), eight of them", FUN.FUNNEL.length === 8 && FUN.splitSweep(waiting.funnel.waitingUsd, LB.gradeBoard({ today: DAY })).every((s) => t5.includes(`${Math.round(s.weight * 100)}%`) && t5.includes(`${fmt(s.usd, Number.isInteger(s.usd) ? 0 : 2).replace(/^/, "$")}`)), t5.slice(0, 400));
  // 6 — floorWords fails loudly when the tab's wording changes.
  const lightComp = buildBook([{ ticker: "VTI", sleeve: "ballast", shares: 6, costUsd: 1800, openedAt: "2026-05-04" }, { ticker: "SGOV", sleeve: "drypowder", shares: 12, costUsd: 1200, openedAt: "2026-06-02" }], {}, NOW);
  const nb = nextBuy(lightComp, 50, new Set(["VTI", "SGOV"]));
  check("6. the one book that makes nextBuy write the sentence floorWords swaps (compounders lightest) still writes it — if the tab rewords it, this fails", nb.sleeve === "compounder" && nb.line.includes(TAB_TAIL) && floorWords(nb.line).includes(FLOOR_TAIL) && !floorWords(nb.line).includes(TAB_TAIL), nb.line);
  const reworded = nb.line.replace(TAB_TAIL, "Pick among the ADD names below.");
  check("   …and a reworded sentence is exactly what that check catches (floorWords would be a silent no-op)", !reworded.includes(TAB_TAIL) && floorWords(reworded) === reworded);
  // 7 — the invest study heartbeats keep out of 09:25–09:30, which `optionsOpen` leaves open.
  const hbs = (from, to, world, start = freshTalkState()) => {
    let st = start;
    let busy = 0;
    const out = [];
    for (let m = from; m < to; m++) {
      const t = at(2026, 10, 7, Math.floor(m / 60), m % 60);
      const w = mkWorld(t, { invest: { ...INV, dayKey: "2026-10-07" }, news: [], busyUntil: busy, ...world });
      const r = talkTick(w, st);
      st = r.state;
      if (r.item) {
        busy = Math.max(busy, t) + r.item.estMs;
        out.push({ ...r.item, etMin: m });
      }
    }
    return out;
  };
  // A room that is already primed, whose prediction pass was just said (and is unchanged, so not due), and whose study family is not on its gap:
  // the one study pass that is due is the invest one — at 09:25 if the guard let it, at 08:50 certainly. (The prediction pass is another stream's.)
  const primedAt = (h, mi) => {
    const s = freshTalkState();
    s.primed = true;
    s.dayKey = "2026-10-07";
    s.topicAt["hb:study:predict"] = at(2026, 10, 7, h, mi) - 60_000;
    s.topicSig["hb:study:predict"] = "empty|The prediction book has not been read this session.";
    return s;
  };
  const early = hbs(9 * 60 + 25, 9 * 60 + 30, {}, primedAt(9, 25));
  const control = hbs(8 * 60 + 50, 8 * 60 + 55, {}, primedAt(8, 50));
  check("7. no invest study pass between 09:25 and 09:30 on a trading day (it was open: optionsOpen starts at 09:30)", early.every((i) => !/^hb:study:(invest|watch|outsider)$/.test(i.topic)), early.map((i) => `${hhmm(i.etMin)} ${i.topic}`).join());
  check("   …and the control: the same room at 08:50 does study the long game, at once (so the check above can see a leak)", control.some((i) => /^hb:study:invest$/.test(i.topic)), control.map((i) => `${hhmm(i.etMin)} ${i.topic}`).join());
  const studyNews = [{ id: "n1", title: "CEG and SMCI lead a power rally", source: "Wire", publishedMs: NOW - 600_000, tier: 3, why: "", impact: null, tickers: ["CEG", "SMCI"], topics: ["ai-capex"], primary: false }];
  const night = hbs(17 * 60, 20 * 60, { news: studyNews });
  const studyItems = night.filter((i) => /^hb:study:(invest|watch|outsider)$/.test(i.topic));
  SPOKEN.push(...studyItems.flatMap((i) => i.lines));
  check("   …the invest study passes send the five to the research desks, not the Mead Hall, and carry no whiteboard animation", studyItems.length >= 2 && studyItems.every((i) => Object.values(i.moves).every((m) => m.zone === "ANNEX" && SPOT_OK.test(m.spot)) && i.lines.every((l) => l.animation !== "WRITING_ON_WHITEBOARD" && l.animation !== "SMASHING_ENTER_KEY")), studyItems.map((i) => JSON.stringify(i.moves)).join(" | ").slice(0, 200));
  check("   …in words that obey the wing's rules (no verdict word, no advice, registered numbers)", studyItems.every((i) => i.lines.every((l) => !VERDICT_WORDS.test(l.text) && !ADVICE.test(l.text)) && unsourced(i).length === 0), studyItems.flatMap((i) => unsourced(i)).join());
}

/* The audit and the data's age. */
console.log("the data's age");
{
  const fresh = DFRESH.freshnessOf("2026-10-06");
  check("data-fresh.ts carries the Invest tab's five snapshots with the dates they carry", ["universe", "durability", "fund-profiles", "ipo-watch"].every((id) => (fresh.invest ?? []).find((s) => s.id === id)) && (fresh.invest ?? []).find((s) => s.id === "universe")?.asOf === UNI.snapshotCapturedAt() && (fresh.invest ?? []).find((s) => s.id === "durability")?.asOf === DUR.durabilityCapturedAt() && (fresh.invest ?? []).find((s) => s.id === "fund-profiles")?.asOf === EXP.profilesCapturedAt() && (fresh.invest ?? []).find((s) => s.id === "ipo-watch")?.asOf === IPO.ipoCapturedAt(), JSON.stringify(fresh.invest));
  const itemsAt = (today, patch = {}) => AUDIT.deskAudit({ feed: null, goal: null, lab: null, rnd: null, seats: null, fresh: { ...DFRESH.freshnessOf(today), ...patch } }).filter((x) => x.id === "invest_data_old");
  const edge = IR.plusDays(UNI.snapshotCapturedAt(), LB.CAPTURE_MAX_DAYS);
  const oldest = UNI.oldestAsOf();
  check("the audit raises nothing while every snapshot is inside 45 days", itemsAt(IR.plusDays(oldest, LB.CAPTURE_MAX_DAYS)).length === 0, JSON.stringify(itemsAt(IR.plusDays(oldest, LB.CAPTURE_MAX_DAYS))));
  const oneOver = itemsAt(IR.plusDays(oldest, LB.CAPTURE_MAX_DAYS + 1));
  check("…one day past the line it raises exactly one finding, naming the stalest snapshot, its date and age, with the re-capture command", oneOver.length === 1 && oneOver[0].owner === "Gemma" && oneOver[0].area === "data" && oneOver[0].severity === "low" && oneOver[0].evidence.includes(oldest) && oneOver[0].evidence.includes(`${LB.CAPTURE_MAX_DAYS + 1} days`) && /capture:invest/.test(oneOver[0].proposal), JSON.stringify(oneOver));
  check("…and it is a medium finding past twice the line", itemsAt(IR.plusDays(oldest, LB.CAPTURE_MAX_DAYS * 2 + 1))[0]?.severity === "med");
  check("a world built without the Invest snapshots raises nothing about them", itemsAt("2030-01-01", { invest: undefined }).length === 0);
  check("the audit holds no number of its own for the line: data-fresh.ts carries the long board's (45), and a world without it raises nothing", fresh.investMaxDays === LB.CAPTURE_MAX_DAYS && LB.CAPTURE_MAX_DAYS === 45 && itemsAt("2030-01-01", { investMaxDays: undefined }).length === 0);
  void edge;
  // mutants of the threshold
  const m1 = itemsAt(IR.plusDays(oldest, LB.CAPTURE_MAX_DAYS)).length === 0 && itemsAt(IR.plusDays(oldest, LB.CAPTURE_MAX_DAYS + 1)).length === 1;
  check("the threshold is 45 exactly: 45 days is not stale, 46 is (a >= mutant would fail the first, a > 46 mutant the second)", m1);
}

/* The screens that carry the firm. */
console.log("the firm on the walls");
{
  const sizes = (id) => (id.startsWith("tv_") ? [768, 432] : id.startsWith("plate_") ? [440, 112] : [512, 306]);
  const textOfScreen = (id, inv, nowMs = NOW, news) => {
    const ctx = mockCtx();
    const [w, h] = sizes(id);
    const fr = frameFor(inv, nowMs);
    if (news) fr.screens.news = news;
    drawScreen(id, ctx, w, h, fr, nowMs);
    return ctx.texts.join(" | ");
  };
  const lt = EXP.lookThrough(IP.book.positions.map((p) => ({ ticker: p.ticker, valueUsd: p.valueUsd })));
  const cio = textOfScreen("mon_Inv_0", INVF);
  check("the CIO's monitor: look-through and the caps — QQQ overlap, tech and communication, fees, the largest line against the name cap, growth sleeves over the cap", /LOOK-THROUGH/.test(cio) && cio.includes(`${Math.round(lt.overlapQQQ * 100)}%`) && cio.includes(`${Math.round(lt.techWeight * 100)}%`) && cio.includes(`${lt.names[0].ticker} ${(lt.names[0].weight * 100).toFixed(1)}%`) && /name cap/.test(cio) && /Growth sleeves over 33%/.test(cio), cio.slice(-300));
  const struct = textOfScreen("mon_Inv_3", INVF);
  check("the structure monitor: the restricted list — the fixed six, what the journal adds and the day it clears, the watch gates", Object.keys(UNI.WASH_SALE_BANNED).every((t) => struct.includes(t)) && /IWM through 25 November/.test(struct) && FM.compliance.watch.every((w) => struct.includes(w.ticker)) && /RESTRICTED LIST/.test(struct), struct.slice(-340));
  const newsD = textOfScreen("mon_Inv_2", INVF);
  check("the news desk's monitor: the kill-rule state — rules written, interval, last check and age, answers with sources, what the trader judged tripped", /KILL RULES/.test(newsD) && newsD.includes(`${FM.diligence.rules} written`) && newsD.includes("1 October") && newsD.includes("2 of 3") && /ETN/.test(newsD), newsD.slice(-300));
  const chair = textOfScreen("mon_Chair_0", INVF);
  const health = IR.opsHealth(FM.ops);
  check("the chair's page: the ledger-health line (the one summary the ops review speaks field by field) and the restricted count", /Ledger health/.test(chair) && chair.includes(health.text) && /Restricted today/.test(chair) && chair.includes("6 fixed + 1 from the journal"), chair.slice(-260));
  check("opsHealth says clean only when nothing is wrong, and names each thing that is", health.ok === false && /1 month missing/.test(health.text) && IR.opsHealth({ ...FM.ops, missedCount: 0, missed: [], overSpendUsd: 0, problemCount: 0 }).ok === true && /clean · 11 entries · 1 voided/.test(IR.opsHealth({ ...FM.ops, missedCount: 0, overSpendUsd: 0, problemCount: 0 }).text) && IR.opsHealth(null).ok === false && /could not be applied/.test(IR.opsHealth({ ...FM.ops, problemCount: 2 }).text) && /over-spent/.test(IR.opsHealth({ ...FM.ops, overSpendUsd: 5 }).text));
  const bd = textOfScreen("tv_board", INVF);
  const today = IR.firmDay(INVF.dayKey);
  check("the board TV: today's standing review and the week, Tuesday marked — the list the talk follows", /TUESDAY'S STANDING REVIEW/.test(bd) && bd.includes(today.title) && IR.firmWeek().every((d) => bd.includes(d.title)) && today.weekday === "Tuesday", bd.slice(-300));
  const wk = textOfScreen("tv_board", buildInvest(firmInputs(FIRM_ENTRIES, { dayKey: "2026-10-10" })), at(2026, 10, 10, 13, 0));
  check("…on a Saturday it says there is no review today, and still shows the week", /THE FIRM'S WEEK/.test(wk) && /No review today/.test(wk) && IR.firmWeek().every((d) => wk.includes(d.title)), wk.slice(-200));
  // every number on a firm screen is one of the firm's own, and nothing on a wall is a verdict, advice, a per-name word or a price claim
  const ids = ["tv_portfolio", "tv_funnel", "tv_theme", "tv_board", "mon_Inv_0", "mon_Inv_1", "mon_Inv_2", "mon_Inv_3", "mon_Chair_0"];
  const allWalls = ids.map((id) => textOfScreen(id, INVF)).join(" | ");
  check("no firm screen carries a desk verdict word, advice language, a per-name verdict word or a price claim", !VERDICT_WORDS.test(allWalls) && !ADVICE.test(allWalls) && !perNameWord(allWalls) && priceClaims(allWalls.replace(/ \| /g, ". ")).length === 0, [allWalls.match(VERDICT_WORDS)?.[0], allWalls.match(ADVICE)?.[0], allWalls.match(PER_NAME)?.[0], priceClaims(allWalls.replace(/ \| /g, ". "))[0]].filter(Boolean).join(" / "));
  const failed = [];
  for (const id of ids) for (const [name, inv] of [["rich", INVF], ["no ledger", INV], ["empty", buildInvest({ ...firmInputs([]), rhFills: [], kill: { lastRun: null, judgements: [] } })], ["dark", null]]) {
    try {
      const t = textOfScreen(id, inv);
      if (!t.length) failed.push(`${id}/${name} blank`);
    } catch (e) {
      failed.push(`${id}/${name}: ${String(e).slice(0, 60)}`);
    }
  }
  check("every wing screen draws on four worlds (rich, no ledger, empty, dark) without throwing and is never blank", failed.length === 0, failed.join("; "));
  // Layout: a canvas has no flow, so two texts can sit on each other or run off the edge without any error. This draws each screen with a
  // context that records every text's box (font size, alignment and a proportional width) and refuses overlap and overflow.
  const sizeOfFont = (font) => Number(/(\d+)px/.exec(font)?.[1] ?? 12);
  const boxCtx = () => {
    const boxes = [];
    const st = { font: "500 12px Inter", textAlign: "left", textBaseline: "alphabetic" };
    const wOf = (s, font) => String(s).length * sizeOfFont(font) * (/monospace|Menlo|Consolas/.test(font) ? 0.6 : 0.54) * (/^(6|7|8)00/.test(font) ? 1.07 : 1);
    return new Proxy(st, {
      get(t, k) {
        if (k === "boxes") return boxes;
        if (k === "measureText") return (s) => ({ width: wOf(s, t.font) });
        if (k === "fillText") {
          return (s, x, y) => {
            const size = sizeOfFont(t.font);
            const w = wOf(s, t.font);
            const left = t.textAlign === "right" ? x - w : t.textAlign === "center" ? x - w / 2 : x;
            const mid = t.textBaseline === "middle";
            boxes.push({ s: String(s), l: left, r: left + w, t: mid ? y - size * 0.5 : y - size * 0.78, b: mid ? y + size * 0.5 : y + size * 0.2 });
          };
        }
        if (k in t) return t[k];
        return () => {};
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    });
  };
  const layoutIssues = (inv) => {
    const out = [];
    for (const id of ids) {
      const ctx = boxCtx();
      const [w, h] = sizes(id);
      drawScreen(id, ctx, w, h, frameFor(inv, NOW), NOW);
      const bx = ctx.boxes;
      for (let i = 0; i < bx.length; i++) {
        const a = bx[i];
        if (a.r > w + 1 || a.b > h + 1 || a.l < -1) out.push(`${id}: “${a.s.slice(0, 40)}” runs off the screen`);
        for (let j = i + 1; j < bx.length; j++) {
          const b = bx[j];
          if (Math.min(a.r, b.r) - Math.max(a.l, b.l) > 3 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 3) out.push(`${id}: “${a.s.slice(0, 28)}” on “${b.s.slice(0, 28)}”`);
        }
      }
    }
    return out;
  };
  const crowded = buildInvest({
    ...firmInputs(FIRM_ENTRIES, { dayKey: "2026-10-27" }),
    rhFills: ["IWM", "XLK", "TLT", "GLD", "SMH", "XLE"].map((u, i) => ({ id: `f${i}`, openedAt: "2026-09-25T14:00:00Z", underlier: u, side: "call", debit: 150, note: "" })),
    kill: { lastRun: KILL.lastRun, judgements: ["ETN", "NVDA", "AAPL", "CEG", "GOOGL"].map((t, i) => ({ id: `kj-${i}`, ticker: t, tripped: true, judgedAt: "2026-10-02T12:00:00.000Z", note: "n", killRule: "r", sources: [] })) },
  });
  const lay = [["rich", INVF], ["no ledger", INV], ["empty", buildInvest({ ...firmInputs([]), rhFills: [], kill: { lastRun: null, judgements: [] } })], ["six journal bans and five tripped rules", crowded]].flatMap(([n, inv]) => layoutIssues(inv).map((x) => `${n}: ${x}`));
  check("on every firm screen, in four worlds (rich, no ledger, empty, six journal bans with five tripped rules), no text sits on another and none runs off the edge", lay.length === 0, lay.slice(0, 3).join(" | "));
  const crushed = layoutIssues(INVF).length === 0 && (() => {
    // A mutant of the layout: the same screen drawn 40% larger must be caught (proves the check can see an overlap).
    const ctx = boxCtx();
    ctx.font = "700 40px Inter";
    ctx.fillText("A line that is far too long for the screen it is drawn on at this size", 14, 40);
    ctx.fillText("another line directly on top of it", 20, 44);
    return ctx.boxes[0].r > 512 && Math.min(ctx.boxes[0].b, ctx.boxes[1].b) - Math.max(ctx.boxes[0].t, ctx.boxes[1].t) > 3;
  })();
  check("…and the layout check can see what it looks for (a text too wide for the screen and one drawn on another are both boxed)", crushed);
}

/* Ledger problems: every one the replay can raise has a kind of its own. */
{
  const P = [
    E({ id: "dup-1", kind: "buy", date: "2026-01-05", ticker: "VTI", sleeve: "ballast", shares: 1, costUsd: 100, source: "other" }),
    E({ id: "dup-1", kind: "buy", date: "2026-01-06", ticker: "VTI", sleeve: "ballast", shares: 1, costUsd: 100, source: "other" }),
    E({ id: "void-x", kind: "void", date: "2026-01-07", targetId: "no-such", reason: "typo" }),
    E({ id: "void-a", kind: "void", date: "2026-01-08", targetId: "dup-1", reason: "typo" }),
    E({ id: "void-b", kind: "void", date: "2026-01-09", targetId: "void-a", reason: "typo" }),
    E({ id: "sell-9", kind: "sell", date: "2026-01-10", ticker: "SGOV", shares: 5, proceedsUsd: 500 }),
    E({ id: "sw-1a", kind: "sweep", date: "2026-02-01", month: "2026-02", verdict: "SWEEP", realizedUsd: 500, rentUsd: 199, restoreUsd: 0, sweptUsd: 60, rate: 0.2, note: "x" }),
    E({ id: "sw-1b", kind: "sweep", date: "2026-02-02", month: "2026-02", verdict: "SWEEP", realizedUsd: 500, rentUsd: 199, restoreUsd: 0, sweptUsd: 60, rate: 0.2, note: "x" }),
  ];
  const led = LED.replay(P);
  const kinds = led.problems.map((p) => FIRM.problemKind(p));
  check("every problem the replay can raise (duplicate id, void of nothing, void of a void, a sale larger than the shares, a month logged twice) has its own kind, and none falls to 'other'", led.problems.length >= 5 && new Set(kinds).size === 5 && !kinds.includes("other"), `${led.problems.join(" || ")} → ${kinds.join()}`);
  const world = buildInvest({ ...firmInputs(FIRM_ENTRIES), ledger: led });
  const r = runFirm("problems", (c) => FV.exFirmOps(c, { inv: world }));
  check("the ops voice says them by kind (never an entry id, which a speech engine cannot say), with counts", r.ex && r.bad.length === 0 && r.text.all(/could not apply/) && r.runs.every((x) => !/dup-1|void-x|sell-9|sw-1a/.test(x.text)) && r.text.all(/sale larger than the shares open then/), `${r.bad.join(" | ")} :: ${r.text}`);
  check("a reworded problem would land in 'other' — the loud case the check above is for", FIRM.problemKind("Something else went wrong with entry abc.") === "other");
}

/* Purity and wiring. */
{
  const srcF = (p) => fs.readFileSync(new URL(`../src/lib/room/${p}`, import.meta.url), "utf8");
  const FORBIDDEN = /\bfetch\s*\(|XMLHttpRequest|WebSocket|anthropic|\bxai\b|api\.openai|Math\.random|Date\.now\s*\(|new Date\s*\(\s*\)|localStorage|window\./;
  for (const f of ["invest-firm.ts", "live-voices-invest-firm.ts"]) check(`${f} has no network, no model, no clock, no randomness and no storage`, !FORBIDDEN.test(srcF(f)), srcF(f).match(FORBIDDEN)?.[0]);
  check("neither reads a price: no marks, no quote, no close", !/getInvestMarks|marks-server|InvestMarks|\blast\.price\b|priceUsd\s*[:=]\s*[^n]/.test(srcF("invest-firm.ts") + srcF("live-voices-invest-firm.ts")));
  check("nothing in the firm writes the Invest ledger, judges a rule, sizes or sends an order", !/recordBuy|recordSell|recordDividend|logSweep|voidEntry|judgeKill|saveRun|openPaperTrade|sizeFromStop|placeOrder/.test(srcF("invest-firm.ts") + srcF("live-voices-invest-firm.ts")));
  check("config.ts is untouched by the firm", !/aplus\/config/.test(srcF("invest-firm.ts") + srcF("live-voices-invest-firm.ts")));
  check("the talk engine reaches the firm's voices and the office reaches the firm's builder (nothing is dark)", /live-voices-invest-firm/.test(srcF("live-talk.ts")) && /from "\.\/invest-firm"/.test(srcF("invest-office.ts")) && /from "\.\/invest-firm"/.test(srcF("data-fresh.ts")) && /live-voices-invest-firm/.test(srcF("live-voices-invest.ts")));
  const spots = [...new Set([...srcF("live-voices-invest-firm.ts").matchAll(/AT\("([a-z0-9_]+)"\)/g)].map((m) => m[1]))];
  check("every spot the firm's voices use is a legal wing spot that exists in the layout", spots.length >= 8 && spots.every((s) => SPOT_OK.test(s) && LAYOUT.spots[s]), spots.filter((s) => !SPOT_OK.test(s) || !LAYOUT.spots[s]).join());
  check("STABLE_HEARTBEATS is untouched (goalnight, ladder, rules)", JSON.stringify([...LTYPES.STABLE_HEARTBEATS].sort()) === JSON.stringify(["goalnight", "ladder", "rules"]));
}

/* ── The adapter: the ledger, other income, the memo ───────────────────── */
console.log("the adapter");
{
  const store = new Map();
  globalThis.window = {
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, String(v)), removeItem: (k) => void store.delete(k) },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const S = await import("../src/lib/room/invest-sources.ts");
  check("no other income is stored until the trader enters it", S.loadOtherIncome() === null);
  check("an impossible share is refused, with a reason", S.saveOtherIncome({ monthlyUsd: 100, ratePct: 150 }).ok === false && S.saveOtherIncome({ monthlyUsd: -5, ratePct: 10 }).ok === false && S.loadOtherIncome() === null);
  const r0 = S.readInvestOffice(NOW);
  check("an empty ledger reads as an empty office with every research theme", r0 && r0.book.positions === 0 && r0.funnel.closedMonths === 0 && r0.next === null && r0.other === null && r0.themes.length === usableThemes().length, JSON.stringify(r0?.funnel));
  check("the read is memoised for a minute", S.readInvestOffice(NOW + 5_000) === r0);
  const saved = S.saveOtherIncome({ monthlyUsd: 1234.567, ratePct: 12.5 });
  check("a valid entry is saved, rounded to cents, and says so", saved.ok && saved.why === "saved" && S.loadOtherIncome()?.monthlyUsd === 1234.57 && S.loadOtherIncome()?.ratePct === 12.5);
  const r1 = S.readInvestOffice(NOW + 6_000);
  check("saving invalidates the memo, and the office carries it", r1 !== r0 && r1.other?.monthlyUsd === 1234.57 && r1.other?.ratePct === 12.5);
  check("other income never writes the Invest ledger", ![...store.keys()].some((k) => /ledger/i.test(k) && !/other/i.test(k)));
  check("clearing removes it", S.saveOtherIncome(null).ok && S.loadOtherIncome() === null && S.readInvestOffice(NOW + 7_000)?.other === null);
  check("a new ET day rebuilds the read", S.readInvestOffice(NOW + 30 * 3600_000)?.dayKey !== r0.dayKey);
  store.set("ledger-invest-other-income-v1", "{broken");
  check("a corrupted other-income entry reads as not entered", S.loadOtherIncome() === null);
  // The firm's inputs, read from the stores the Invest tab writes: the ledger, the RH options journal, the kill-rule record.
  store.delete("ledger-invest-other-income-v1");
  globalThis.localStorage = globalThis.window.localStorage;
  store.set("ledger.invest.ledger.v2", JSON.stringify(FIRM_ENTRIES));
  store.set("ledger-rh-income-v1", JSON.stringify({ fills: RH_FILLS }));
  store.set("ledger.invest.killwatch.run.v1", JSON.stringify(KILL.lastRun));
  store.set("ledger.invest.killwatch.judgements.v1", JSON.stringify(KILL.judgements));
  const T = NOW + 10 * 60_000;
  const real = S.readInvestOffice(T);
  const expected = buildInvest(firmInputs(FIRM_ENTRIES, { dayKey: DAY, nowMs: T })).firm;
  check("the adapter feeds the firm what the tab's own stores hold: its firm is the pure builder's, byte for byte, on the same inputs", real?.firm != null && JSON.stringify(real.firm) === JSON.stringify(expected), diffFirm(real?.firm ?? FM).join(","));
  check("…the journal ban, the tripped rule and the voided typo came from storage", real.firm.compliance.dynamic[0]?.underlier === "IWM" && real.firm.diligence.tripped[0]?.ticker === "ETN" && real.firm.ops.voidCount === 1 && real.firm.diligence.lastRanAt === KILL.lastRun.ranAt);
  store.delete("ledger-rh-income-v1");
  store.delete("ledger.invest.killwatch.run.v1");
  store.delete("ledger.invest.killwatch.judgements.v1");
  const bare = S.readInvestOffice(T + 120_000);
  check("with the journal and the kill record empty the firm says so (no extra ban, no check on record) — it does not guess", bare.firm.compliance.dynamic.length === 0 && bare.firm.diligence.lastRanAt === null && bare.firm.diligence.due === true && bare.firm.diligence.tripped.length === 0);
  delete globalThis.localStorage;
  delete globalThis.window;
}

/* ── It is pure ────────────────────────────────────────────────────────── */
console.log("purity");
{
  const src = (p) => fs.readFileSync(new URL(`../src/lib/room/${p}`, import.meta.url), "utf8");
  const FORBIDDEN = /\bfetch\s*\(|XMLHttpRequest|WebSocket|anthropic|\bxai\b|api\.openai|Math\.random|Date\.now\s*\(|new Date\s*\(\s*\)/;
  for (const f of ["invest-office.ts", "invest-read.ts", "invest-themes.ts", "live-voices-invest.ts"]) {
    check(`${f} has no network, no model, no timer, no randomness`, !FORBIDDEN.test(src(f)), src(f).match(FORBIDDEN)?.[0]);
  }
  check("the talk engine and the voices never import the adapter or the research file directly", !/invest-sources|invest-themes|invest-themes\.json/.test(src("live-talk.ts")) && !/invest-sources|invest-themes|invest-themes\.json/.test(src("live-voices-invest.ts")));
  check("nothing in the wing writes the Invest ledger or sizes a trade", !/recordBuy|recordSell|logSweep|loadLedger.*write|openPaperTrade|sizeFromStop/.test(src("invest-office.ts") + src("live-voices-invest.ts") + src("invest-read.ts")));
  check("config.ts is untouched by the wing", !/aplus\/config/.test(src("invest-office.ts") + src("invest-read.ts") + src("live-voices-invest.ts") + src("invest-sources.ts")));
}

if (TRANSCRIPT) {
  console.log("\n── a weekday in the investment wing ──");
  for (const i of all.filter((x) => x.etMin !== undefined && !x.topic.startsWith("invest:firm")).slice(0, 12)) {
    console.log(`\n[${hhmm(i.etMin)} ET] ${i.label}`);
    for (const l of i.lines) console.log(`  ${l.character}: ${l.text}`);
  }
  console.log("\n── the firm's week (Monday 5 October to Sunday 11 October; seeded ledger) ──");
  for (const i of FIRM_EV) {
    console.log(`\n[${i.topic.split(":").slice(-1)[0]} ${hhmm(i.etMin)} ET] ${i.label}`);
    for (const l of i.lines) console.log(`  ${l.character}: ${l.text}`);
  }
}

console.log("what a speech engine would be handed");
{
  const unique = [...new Map(SPOKEN.map((l) => [l.text, l])).values()];
  const bad = spokenProblems(unique);
  check(`every distinct line the wing said (${unique.length}) — every theme, the funnel, the book, the calendar, the board — is speakable`, unique.length > 40 && bad.length === 0, bad.slice(0, 3).join(" || "));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
