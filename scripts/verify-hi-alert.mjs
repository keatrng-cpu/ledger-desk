/**
 * The high-alert ledger (src/lib/trading/hi-alert.ts): every 0.90+ card kept, explained, and graded on the chart.
 *
 *   npx tsx scripts/verify-hi-alert.mjs
 *
 * WHY: on 2026-10-07 an ES short printed at fit 0.99, band A+, and the desk correctly refused it (no raid yet, outside the session, NQ led, its own
 * odds negative). Nothing kept it, so neither the trader nor the Floor could ask what the last four of these did and whether passing was right.
 *
 * Pins: the 0.90 threshold; the live card reproduced as a fixture and explained from its own fields; one record per (day, symbol, side, entry in
 * ATRs) whose plan never moves; the grade is the evidence pack's rule on closed 15m bars AFTER the sighting (no look-ahead, no forming bar, the fill
 * bar cannot score a target, a stop and a target on one bar are scored against); the call (was passing right); the recall line; persistence.
 */
import { readFileSync } from "node:fs";

const H = await import("../src/lib/trading/hi-alert.ts");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const BAR = 15 * 60_000;
const T0 = Date.UTC(2026, 9, 7, 15, 30); // a bar boundary
const ctx = (over = {}) => ({
  nowMs: T0 + 5 * 60_000,
  day: "2026-10-07",
  clock: { killzone: "none", etHour: 11, etMinute: 35, weekday: 3 },
  blocked: ["Outside trade window (NY lunch / mid) — no session event: 0.8× ATR on 1.4× volume"],
  bookFor: () => ({ word: "WAIT", missing: "BSL raid", detail: "price must trade above 7877.25 and close back under it" }),
  ladderFor: () => null,
  takenFor: () => "no",
  ...over,
});

/** The card as it stood on the live desk: ES short, Patty, fit 0.99, refused. */
const card = (over = {}) => ({
  id: "ES-short", symbol: "ES", side: "short", confluence: 0.99, grade: "A+", pathBand: "A+",
  components: ["ifvg", "sweep_significant", "mss", "displacement", "pd"], completeStrategy: "patty", strategyPrimary: "patty",
  killzoneOk: false, htfOk: true, actionable: false, missing: ["BSL raid", "Entry array"],
  hitOdds: { pT1: 0.2, expR: -0.33 }, patterns: { inducement: false, mitigation: true }, atr: 8.9, entryPx: 7832.88,
  plan: { entry: 7832.88, stop: 7834.94, t1: 7829.0, t2: 7815.75, riskAtr: 0.23, atr: 8.9, rr1: 1.88, drawName: "PDL" },
  draw: { name: "PDL", swept: false },
  ...over,
});

console.log("what is recorded, and why");
{
  const none = H.recordHiAlerts([], [card({ confluence: 0.89 })], ctx());
  check("0.89 is not a high alert", none.length === 0);
  const one = H.recordHiAlerts([], [card({ confluence: 0.9 })], ctx());
  check("0.90 is, taken or not, either side", one.length === 1 && H.recordHiAlerts([], [card({ side: "long", plan: { ...card().plan, entry: 7800, stop: 7798, t1: 7804, t2: null } })], ctx()).length === 1);
  const [h] = H.recordHiAlerts([], [card()], ctx());
  check("the live ES short is stored with its plan, its odds and that nobody took it", h.sym === "ES" && h.side === "short" && h.fit === 0.99 && h.plan.entry === 7832.88 && h.pT1 === 0.2 && h.taken === "no" && h.actionable === false && h.everActionable === false);
  check("the reason names the session first", /^Outside the session: Outside trade window/.test(h.why[0]), h.why[0]);
  check("... then the sequence and what it is missing", h.why.some((w) => /SMC sequence says WAIT, missing BSL raid \(price must trade above 7877\.25/.test(w)), h.why.join(" | "));
  check("... then the desk's own odds, which are negative", h.why.some((w) => /P\(T1\) 20%, E\[R\] −0\.33 per fill/.test(w)), h.why.join(" | "));
  check("... the stop band, and the schools that are not satisfied", h.why.some((w) => /0\.23× ATR, outside the 0\.5–1\.5 band/.test(w)) && h.why.some((w) => /Patty needs|ICT needs|TJR needs|Blake needs/.test(w)), h.why.join(" | "));
  check("the card's own four-year buckets are kept as 'the research'", h.evidence.length >= 2 && h.evidence.some((e) => /0\.85/.test(e)), h.evidence.join(" | "));
  check("a school verdict is recorded for each of the four", h.schools.length === 4 && h.schools.every((s) => ["fits", "missing", "against"].includes(s.verdict)));
  const [t] = H.recordHiAlerts([], [card({ actionable: true, killzoneOk: true })], ctx({ takenFor: () => "paper", blocked: [] }));
  check("a card that was taken says what it cleared, not what held it", t.taken === "paper" && /^Taken \(filled in the paper book\)/.test(t.why[0]) && !t.why.some((w) => /Outside the session/.test(w)), t.why[0]);
  const [g] = H.recordHiAlerts([], [card({ htfOk: false, htfRelease: { met: 2, of: 4, checks: [], missing: ["displacement", "structure break"], reason: "" } })], ctx());
  check("a card the HTF gate refused says so and how far from released", g.why.some((w) => /higher-timeframe gate refused it: still missing displacement and structure break/.test(w)), g.why.join(" | "));
}

console.log("one record per setup, and its plan never moves");
{
  const a = H.recordHiAlerts([], [card()], ctx());
  const b = H.recordHiAlerts(a, [card({ confluence: 0.95, actionable: true, plan: { ...card().plan, entry: 7833.1, stop: 7835.0 } })], ctx({ nowMs: T0 + 20 * 60_000, takenFor: () => "rested" }));
  check("the same setup later is the same record", b.length === 1 && b[0].firstMs === a[0].firstMs && b[0].lastMs === T0 + 20 * 60_000);
  check("its plan is the first sight's (the grade must be fair)", b[0].plan.entry === 7832.88 && b[0].plan.stop === 7834.94);
  check("the fit keeps its high; actionable and 'ever actionable' track the read", b[0].fit === 0.99 && b[0].actionable === true && b[0].everActionable === true);
  const c = H.recordHiAlerts(b, [card({ actionable: false })], ctx({ nowMs: T0 + 40 * 60_000, takenFor: () => "no" }));
  check("taken only ever goes up (a rested order is not forgotten when the book empties)", c[0].taken === "rested" && c[0].everActionable === true);
  const far = H.recordHiAlerts(c, [card({ plan: { ...card().plan, entry: 7900, stop: 7902, t1: 7890, t2: null } })], ctx());
  check("a different entry (more than an ATR away) is a new record", far.length === 2);
  const tomorrow = H.recordHiAlerts(c, [card()], ctx({ day: "2026-10-08" }));
  check("a different day is a new record", tomorrow.length === 2);
}

console.log("graded on the chart");
{
  const short = { side: "short", firstMs: T0 + 5 * 60_000, plan: { entry: 100, stop: 102, t1: 98, t2: 96, riskAtr: 1 } };
  const bar = (k, o, h, l, c) => ({ t: T0 + BAR * (k + 1), o, h, l, c, v: 1 }); // k = 0 is the first bar AFTER the sighting bar
  const now = (n) => T0 + BAR * (n + 2); // n bars are closed after the sighting bar
  const flat = (k) => bar(k, 99, 99.5, 98.6, 99);

  check("nothing closed yet after the sighting: pending", H.gradeHiAlert(short, [], now(0)).status === "pending");
  check("not yet filled with the window still open: pending, not done", (() => { const o = H.gradeHiAlert(short, [flat(0), flat(1), flat(2)], now(3)); return o.status === "pending" && !o.done && !o.filled; })());
  const nofill = Array.from({ length: 12 }, (_, k) => flat(k));
  check("12 closed bars and the limit never touched: unfilled, done", (() => { const o = H.gradeHiAlert(short, nofill, now(12)); return o.status === "unfilled" && o.done && o.R === null; })());

  const fill = bar(0, 99.5, 100.2, 99, 99.6);
  check("fill then the stop: stopped, about −1.1R (one tick of slip)", (() => { const o = H.gradeHiAlert(short, [fill, bar(1, 100, 102.5, 99.9, 102)], now(2)); return o.status === "stopped" && o.done && o.filled && o.R === -1.12 && o.maeR <= -1; })());
  check("the fill bar cannot score the first target (it dips through T1 on the fill bar and nothing happens)", (() => { const p = { ...short, plan: { ...short.plan, t2: null } }; const o = H.gradeHiAlert(p, [bar(0, 99.5, 100.2, 97.5, 98.5)], now(1)); return o.status === "pending" && o.filled && !o.done; })());
  check("a stop and a target on one bar are scored against the trade", (() => { const o = H.gradeHiAlert(short, [fill, bar(1, 100, 102.1, 97.5, 99)], now(2)); return o.status === "stopped"; })());
  check("T1 then the stop at breakeven: t1, +0.44R (half at +1R, the runner out a tick under entry)", (() => { const o = H.gradeHiAlert(short, [fill, bar(1, 99, 99.2, 97.9, 98.2), bar(2, 98.2, 100.4, 98, 100)], now(3)); return o.status === "t1" && o.done && o.R === 0.44; })());
  check("T1 then T2: t2, +1.5R", (() => { const o = H.gradeHiAlert(short, [fill, bar(1, 99, 99.2, 97.9, 98.2), bar(2, 98, 98.5, 95.9, 96)], now(3)); return o.status === "t2" && o.R === 1.5 && o.mfeR >= 2; })());
  check("with no second target the whole position leaves at T1", (() => { const p = { ...short, plan: { ...short.plan, t2: null } }; const o = H.gradeHiAlert(p, [fill, bar(1, 99, 99.2, 97.9, 98.2)], now(2)); return o.status === "t1" && o.R === 1; })());
  check("32 bars held with nothing: flat at the last close", (() => { const bars = [fill, ...Array.from({ length: 31 }, (_, k) => bar(k + 1, 99.4, 99.9, 98.4, 99.2))]; const o = H.gradeHiAlert(short, bars, now(32)); return o.status === "flat" && o.done && o.R === 0.4; })());

  const long = { side: "long", firstMs: T0 + 5 * 60_000, plan: { entry: 100, stop: 98, t1: 102, t2: null, riskAtr: 1 } };
  check("longs mirror: fill on a dip, then T1", (() => { const o = H.gradeHiAlert(long, [bar(0, 100.4, 100.6, 99.8, 100.3), bar(1, 100.3, 102.2, 100, 102)], now(2)); return o.status === "t1" && o.R === 1; })());

  // No look-ahead: the bar the card was first seen in, and a bar still forming, are never read.
  const seenBar = { t: T0, o: 100, h: 103, l: 99, c: 102, v: 1 };
  check("the bar the card was first seen in is not read (it would have stopped a short)", H.gradeHiAlert(short, [seenBar], now(0)).status === "pending");
  check("a bar still forming at 'now' is not read", (() => { const forming = bar(0, 99.5, 102.5, 99, 102); const o = H.gradeHiAlert(short, [forming], T0 + BAR + 60_000); return o.status === "pending" && !o.filled; })());
  check("a plan with no first target, or a target on the wrong side, cannot be graded", H.gradeHiAlert({ ...short, plan: { ...short.plan, t1: null } }, [fill], now(1)) === null && H.gradeHiAlert({ ...short, plan: { ...short.plan, t1: 101 } }, [fill], now(1)) === null && H.gradeHiAlert({ ...short, plan: null }, [fill], now(1)) === null);

  const rec = H.recordHiAlerts([], [card({ plan: { ...card().plan, entry: 100, stop: 102, t1: 98, t2: 96 } })], ctx({ nowMs: T0 + 5 * 60_000 }));
  const g1 = H.gradeAll(rec, { ES: [fill, bar(1, 100, 102.5, 99.9, 102)] }, now(2));
  check("gradeAll grades an open record", g1[0].outcome.status === "stopped" && g1[0].outcome.done);
  const g2 = H.gradeAll(g1, { ES: [] }, now(40));
  check("... and never touches a finished one again", g2[0].outcome === g1[0].outcome);
  check("a symbol with no bars is left alone", H.gradeAll(rec, {}, now(2))[0].outcome === null);
}

console.log("what it taught");
{
  const base = { id: "x", day: "2026-10-07", sym: "ES", side: "short", fit: 0.99, strategy: "patty", why: ["Outside the session: lunch."] };
  const done = (taken, status, R) => ({ ...base, taken, outcome: { status, done: true, filled: status !== "unfilled", R, mfeR: 1, maeR: -1, barsSeen: 12 } });
  check("not taken and it never filled: passing was right", H.callOf(done("no", "unfilled", null)) === "right");
  check("not taken and it stopped: passing was right", H.callOf(done("no", "stopped", -1.1)) === "right");
  check("not taken and it reached T1: passing cost", H.callOf(done("no", "t1", 0.5)) === "cost");
  check("taken and it paid / taken and it lost", H.callOf(done("paper", "t2", 1.5)) === "paid" && H.callOf(done("paper", "stopped", -1.1)) === "lost");
  check("an open record has no call yet", H.callOf({ taken: "no", outcome: { status: "pending", done: false } }) === "open" && H.callOf({ taken: "no", outcome: null }) === "open");
  const words = (s) => s.split(/\s+/).length;
  const L = H.lessonOf(done("no", "unfilled", null));
  check("the lesson: what it was, what the desk did and why, what the chart did, and the call", /ES short, patty, fit 0\.99, 2026-10-07: not taken \(Outside the session: lunch\); it never filled inside 3 hours\. Passing was right\./.test(L) && words(L) < 45, L);
  check("... a miss says what it cost", /Passing cost about \+0\.50 R\./.test(H.lessonOf(done("no", "t1", 0.5))), H.lessonOf(done("no", "t1", 0.5)));
  check("... an unfinished one says it is still being graded", /still being graded/.test(H.lessonOf({ ...base, taken: "no", outcome: null })));

  const hist = [done("no", "unfilled", null), done("no", "stopped", -1.1), done("no", "t1", 0.5), { ...done("paper", "t2", 1.5) }, { ...done("no", "t1", 0.5), side: "long" }];
  const line = H.recallHiAlerts(hist, { strategy: "patty", side: "short" });
  check("recall counts the same model and side only, and says how often passing was right", line === "The last 4 0.90-plus patty short cards: 2 reached a target, 1 stopped, 1 never filled. Passing was right 2 of 3 times.", line);
  check("no history, no sentence (nothing is invented)", H.recallHiAlerts([], { strategy: "patty", side: "short" }) === null && H.recallHiAlerts(hist, { strategy: "tjr", side: "short" }) === null);
  check("an open record is not history", H.recallHiAlerts([{ ...base, taken: "no", outcome: { status: "pending", done: false } }], { strategy: "patty", side: "short" }) === null);
}

console.log("persistence fails closed");
{
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) };
  const rec = H.recordHiAlerts([], [card()], ctx());
  H.saveHiAlerts(rec);
  check("save then load round-trips", H.loadHiAlerts().length === 1 && H.loadHiAlerts()[0].id === rec[0].id);
  store.set(H.HI_ALERT_KEY, "{not json");
  check("bad JSON loads as empty, not a crash", H.loadHiAlerts().length === 0);
  store.set(H.HI_ALERT_KEY, JSON.stringify([{ nope: 1 }, rec[0]]));
  check("rows without an id are dropped", H.loadHiAlerts().length === 1);
  const many = Array.from({ length: 320 }, (_, i) => ({ ...rec[0], id: `d|ES|short|${i}` }));
  H.saveHiAlerts(many);
  check("the ledger is capped at 300 (newest kept)", H.loadHiAlerts().length === 300 && H.loadHiAlerts()[299].id === "d|ES|short|319");
  delete globalThis.localStorage;
  check("with no storage, load is empty and save is silent", H.loadHiAlerts().length === 0 && (H.saveHiAlerts(rec), true));
}

console.log("the desk uses it");
{
  const idx = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  check("the shell records every candidate on each desk build, grades on the desk's own bars, and saves", /recordHiAlerts\(loadHiAlerts\(\), desk\.scan\.candidates/.test(idx) && /gradeAll\(list, \{ \[desk\.left\.symbol\]: desk\.left\.bars, \[desk\.right\.symbol\]: desk\.right\.bars \}/.test(idx) && /saveHiAlerts\(list\)/.test(idx));
  check("it is keyed on the desk build, not on every render, and a failure is swallowed", /\}, \[desk\?\.fetchedAt\]\);/.test(idx) && /the ledger must never break the desk/.test(idx));
  check("a paper fill or a rested limit on the same book and side is what 'taken' means", /t\.symbol === sym && t\.side === side/.test(idx) && /r && r\.side === side \? "rested" : "no"/.test(idx));
}

console.log("the export, the summary, and the Python lab reading them");
{
  const done = (id, taken, status, R, why = ["Outside the session."]) => ({
    id, day: "2026-10-07", firstMs: 1, lastMs: Number(id.split("|").pop()), sym: "ES", side: "short", fit: 0.99, band: "A+", strategy: "patty",
    plan: { entry: 100, stop: 102, t1: 98, t2: 96, riskAtr: 0.23 }, pT1: 0.2, expR: -0.33, actionable: false, everActionable: false, taken, why,
    evidence: ["Q 0.85+ -0.15R n1504"], schools: [], sequence: null, deliveryAtSight: "against",
    outcome: status ? { status, done: status !== "pending", filled: status !== "unfilled", R, mfeR: 1, maeR: -1, barsSeen: 12 } : null,
  });
  const list = [done("d|ES|short|1", "no", "unfilled", null), done("d|ES|short|2", "no", "t1", 0.5), done("d|ES|short|3", "paper", "stopped", -1.12), done("d|ES|short|4", "paper", "t2", 1.5), done("d|ES|short|5", "no", "pending", null), done("d|ES|short|6", "no", null, null)];
  const rows = H.ledgerExport(list);
  check("the export is newest first and carries what the lab and the panel read", rows[0].id === "d|ES|short|6" && rows.every((r) => ["id", "day", "sym", "side", "strategy", "fit", "taken", "call", "lesson", "why", "evidence", "status", "R", "deliveryAtSight"].every((k) => k in r)));
  check("each row's call is the chart's verdict on the decision", rows.find((r) => r.id.endsWith("|1")).call === "right" && rows.find((r) => r.id.endsWith("|2")).call === "cost" && rows.find((r) => r.id.endsWith("|3")).call === "lost" && rows.find((r) => r.id.endsWith("|4")).call === "paid" && rows.find((r) => r.id.endsWith("|5")).call === "open");
  check("a record that was never graded exports as open with a lesson that says so", rows[0].call === "open" && /still being graded/.test(rows[0].lesson) && rows[0].status === null && rows[0].R === null);
  const st = H.ledgerStats(list);
  check("the summary counts each outcome, and warns that this is too few cards for a rate", st.n === 6 && st.graded === 4 && st.passedRight === 1 && st.passedCost === 1 && st.paid === 1 && st.lost === 1 && /too few for a rate/.test(st.note), JSON.stringify(st));
  check("with 20 or more graded cards the warning goes", H.ledgerStats(Array.from({ length: 20 }, (_, i) => done(`d|ES|short|${i + 10}`, "no", "unfilled", null))).note === "20 graded cards.");
  check("an empty ledger exports and summarises to nothing, not an error", H.ledgerExport([]).length === 0 && H.ledgerStats([]).n === 0);

  // The contract with the Python lab: what the TypeScript side writes is what brainlab/memory.py ledger_notes reads.
  const { spawnSync } = await import("node:child_process");
  const { existsSync, writeFileSync, mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { fileURLToPath } = await import("node:url");
  const pyPath = fileURLToPath(new URL(process.platform === "win32" ? "../brainlab/.venv/Scripts/python.exe" : "../brainlab/.venv/bin/python", import.meta.url));
  if (!existsSync(pyPath)) {
    console.log("  skip the Python contract check: the lab is not set up (npm run lab:setup). Nothing is claimed about it.");
  } else {
    const tmp = join(mkdtempSync(join(tmpdir(), "ledger-")), "ledger.json");
    writeFileSync(tmp, JSON.stringify(rows));
    const r = spawnSync(pyPath, ["-c", "import json,sys; sys.path.insert(0,'brainlab'); from memory import ledger_notes; n=ledger_notes(json.load(open(sys.argv[1]))); print(json.dumps([[i,t[:40]] for i,t in n]))", tmp], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1" } });
    const notes = r.status === 0 ? JSON.parse(r.stdout) : null;
    check("the lab turns exactly the graded cards into notes (4 of 6; the open ones are skipped)", notes?.length === 4 && notes.every(([id]) => id.startsWith("hialert-d|ES|short|")), r.stderr?.slice(0, 200) ?? "");
  }
}

console.log("the Brain tab shows it");
{
  const idx = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../src/components/desk/hi-alert-panel.tsx", import.meta.url), "utf8");
  const vet = readFileSync(new URL("../src/components/desk/veteran-brain.tsx", import.meta.url), "utf8");
  check("the panel is mounted ONCE in the Brain tab (inside the veteran-brain panel), not a second time in the shell", /import \{ HiAlertPanel \} from "@\/components\/desk\/hi-alert-panel"/.test(vet) && (vet.match(/<HiAlertPanel \/>/g) ?? []).length === 1 && !/HiAlertPanel/.test(idx));
  check("it reads the ledger, refreshes on the heartbeat, and offers Copy and Download", /loadHiAlerts\(\)/.test(panel) && /onBeat\(\(\) => setTick/.test(panel) && /Copy JSON/.test(panel) && /Download/.test(panel));
  check("it says the ledger is browser-only and a high fit is not a high win rate", /Kept in this browser only/.test(panel) && /A high fit is not a high win rate/.test(panel));
  check("it gates nothing: no config, size or order import", !/aplus\/config|rh-autofire|sleeve|APLUS_RULES/.test(panel));
}

console.log("no model, no clock, no randomness");
{
  const src = readFileSync(new URL("../src/lib/trading/hi-alert.ts", import.meta.url), "utf8");
  check("deterministic: no network, no model, no clock, no randomness", !/\bfetch\s*\(|anthropic|\bxai\b|Math\.random|Date\.now\s*\(|new Date\s*\(/.test(src));
  check("it imports no config, gate or size", !/aplus\/config|profit-rules|options-sleeve|sleeve-sizing|APLUS_RULES/.test(src));
}

console.log(`\nhi-alert: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
