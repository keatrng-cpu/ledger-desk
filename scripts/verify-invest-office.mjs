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
const { ALL_DOSSIERS } = await import("../src/lib/invest/dossiers.ts");
const { catalystsFor, CATALYST_WINDOW_DAYS } = await import("../src/lib/room/invest-office.ts");
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

  const first = EARN.rows.find((r) => r[0] !== "GOOG" && r[2] >= DAY);
  const X = first[0];
  check("an earnings row is a catalyst on the last day of the window, not the day after", catalystsFor(IR.plusDays(first[2], -CATALYST_WINDOW_DAYS), [X], []).some((c) => c.ticker === X) && !catalystsFor(IR.plusDays(first[2], -CATALYST_WINDOW_DAYS - 1), [X], []).some((c) => c.ticker === X));
  check("…and a report that already happened is not one", !catalystsFor(IR.plusDays(first[2], 1), [X], []).some((c) => c.ticker === X && c.date === first[2]));
  check("a name nobody watches is never a catalyst", catalystsFor(DAY, [], []).length === 0 && catalystsFor(DAY, ["ZZZZ"], []).length === 0);

  const cs = catalystsFor("2026-10-27", HEAVY, INV.themes);
  const WR = { "pre-market": 0, "time not stated": 1, "after close": 2 };
  const RK = { held: 0, theme: 1, competitor: 2 };
  const resorted = [...cs].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : WR[a.when] - WR[b.when] || RK[a.why] - RK[b.why] || (a.ticker < b.ticker ? -1 : 1)));
  check("they are in the order a person reads them: date, then before the open → after the close, then held → theme → competitor", cs.length >= 5 && JSON.stringify(cs) === JSON.stringify(resorted));
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
  check("a competitor with no ticker is not a catalyst source", catalystsFor(first[2], [], [T("Theme N", [], [{ name: "Private Co" }])]).length === 0);

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
  check("the board TV draws the calendar: the heading, and the first three reports as the talk says them (day, ticker, when, why)", catsNow.length >= 1 && /REPORTS IN THE NEXT TWO WEEKS/.test(bd) && catsNow.slice(0, 3).every((c) => bd.includes(c.ticker) && bd.includes(IR.dayPhrase(c.date, INV.dayKey)) && bd.includes(c.when) && bd.includes(c.why === "theme" ? "vehicle" : c.why)), bd.slice(-320));
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
  for (const i of all.filter((x) => x.etMin !== undefined).slice(0, 12)) {
    console.log(`\n[${hhmm(i.etMin)} ET] ${i.label}`);
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
