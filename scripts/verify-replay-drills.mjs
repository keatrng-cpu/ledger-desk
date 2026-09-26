/**
 * Place it — the replay drill's data, simulator and scoring, pinned.
 *
 * Four things can be wrong here without the page looking broken:
 *
 *   1. THE CASES LIE ABOUT THE TAPE. A window shifted by one bar puts the
 *      decision bar's close in the "hidden" future, or the future's first bar
 *      in the visible past — lookahead either way, and it renders fine. So
 *      every case is compared bar for bar with src/data/history-4y.json, and
 *      its decision bar with the capture's own `t`.
 *   2. THE SIMULATOR DRIFTS FROM THE RULE. The drill's outcome is only worth
 *      showing if it is the rule the evidence pack measured. So the stored
 *      desk outcome is re-simulated twice: by the app's simulator on the
 *      stored bars, and by a LINE-FOR-LINE PORT of build-evidence-pack.mjs's
 *      sim() on the full four-year tape. A differential test, not a fixture:
 *      a fixture can share a misunderstanding with the code it tests.
 *   3. THE CHECKLIST SCORES A RULE THE DESK DOES NOT HAVE. Each process item
 *      is exercised by a fixture that should pass and one that should fail.
 *   4. THE VOCABULARY DRIFTS FROM THE ENGINE. Every blocker label is checked
 *      against the source text that prints it.
 *
 * What it SKIPS, stated rather than hidden: the row-by-row cross-check against
 * the causal capture runs only where .cache/signals exists (it is gitignored).
 * The line below says which happened.
 *
 * Run: npx tsx scripts/verify-replay-drills.mjs
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const D = await import("../src/lib/learn/replay-drill.ts");
const { MIN_RISK_ATR, MAX_RISK_ATR_TRADABLE } = await import("../src/lib/trading/trade-plan.ts");
const { FILL_WINDOW_BARS, MAX_HOLD_BARS } = await import("../src/lib/trading/shadow-book.ts");
const { APLUS_RULES } = await import("../src/lib/aplus/config.ts");
const { etWallParts, isJudasWindow } = await import("../src/lib/trading/sessions.ts");
const { newsRead } = await import("../src/lib/trading/news.ts");
const { evidenceHeadlines } = await import("../src/lib/trading/evidence.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
/** Many-row checks print once, with the first offenders named. */
const all = (name, bad) => check(`${name}${bad.length ? ` (${bad.slice(0, 4).join(", ")})` : ""}`, bad.length, 0);

const FILE = join(ROOT, "src/data/replay-drills.json");
const file = JSON.parse(readFileSync(FILE, "utf8"));
const cases = file.cases;
const H = JSON.parse(readFileSync(join(ROOT, "src/data/history-4y.json"), "utf8"));
const BARS = { MNQ: H.bars.MNQ, ES: H.bars.ES };

/* ── 1. The file ─────────────────────────────────────────────────────────── */

console.log("the file");
check("loads with cases", Array.isArray(cases) && cases.length > 0, true);
check("about 160 cases", cases.length >= 150 && cases.length <= 170, true);
check("under 1.5 MB", statSync(FILE).size < 1.5 * 1024 * 1024, true);
check("ids are unique", new Set(cases.map((c) => c.id)).size, cases.length);
check("the stored rules are the module's rules", file.rules, {
  fillBars: D.FILL_BARS,
  holdBars: D.HOLD_BARS,
  tp1Fraction: D.TP1_FRACTION,
  pastBars: D.PAST_BARS,
  futureBars: D.FUTURE_BARS,
  tick: 0.25,
});
check("fill window is the shadow book's", D.FILL_BARS, FILL_WINDOW_BARS);
check("hold is the shadow book's", D.HOLD_BARS, MAX_HOLD_BARS);
check("T1 fraction is config's", D.TP1_FRACTION, APLUS_RULES.scaleOut.tp1Fraction);
check("the future is exactly the rule's reach (12 + 32 - 1)", D.FUTURE_BARS, 43);
check("64 known bars, decision last", [D.PAST_BARS, D.DECISION], [64, 63]);

/* ── 2. Every case against the tape ──────────────────────────────────────── */

console.log("\nevery case against src/data/history-4y.json");
{
  const want = D.PAST_BARS + D.FUTURE_BARS;
  all("every case has 64 + 43 bars", cases.filter((c) => c.bars.length !== want).map((c) => c.id));
  all(
    "bars are in strict time order",
    cases.filter((c) => c.bars.some((b, k) => k > 0 && !(b[0] > c.bars[k - 1][0]))).map((c) => c.id),
  );
  all(
    "every candle is well-formed",
    cases
      .filter((c) => c.bars.some(([, o, h, l, cl]) => !(h >= Math.max(o, cl) && l <= Math.min(o, cl))))
      .map((c) => c.id),
  );
  all(
    "the decision bar's time is the capture's t",
    cases.filter((c) => D.barTime(c, D.DECISION) !== c.t).map((c) => c.id),
  );
  all(
    "and the tape's bar at the capture's i",
    cases.filter((c) => BARS[c.sym][c.i]?.t !== c.t).map((c) => c.id),
  );
  all(
    "every stored bar IS the tape's bar (time and OHLC)",
    cases
      .filter((c) =>
        c.bars.some((b, k) => {
          const x = BARS[c.sym][c.i - D.DECISION + k];
          return !x || D.barTime(c, k) !== x.t || b[1] !== x.o || b[2] !== x.h || b[3] !== x.l || b[4] !== x.c;
        }),
      )
      .map((c) => c.id),
  );
  all("px is the decision bar's close", cases.filter((c) => c.bars[D.DECISION][4] !== c.px).map((c) => c.id));
  all("every case clears the 0.65 floor", cases.filter((c) => !(c.conf >= 0.65)).map((c) => c.id));
  all(
    "the ET clock stored matches the decision bar",
    cases
      .filter((c) => {
        const w = etWallParts(c.t);
        return w.hour !== c.etH || w.minute !== c.etM || w.weekday !== c.wd;
      })
      .map((c) => c.id),
  );
  all("no case sits in the Judas window", cases.filter((c) => isJudasWindow(c.etH, c.etM)).map((c) => c.id));
  all(
    "no case sits in a news blackout",
    cases.filter((c) => newsRead(new Date(c.t)).verdict === "blackout").map((c) => c.id),
  );
  // The re-derived raid and array must be the plan's OWN inputs: rebuild the
  // stop exactly as trade-plan.ts does and demand the captured stop.
  const r2 = (x) => Math.round(x * 100) / 100;
  all(
    "raid and array re-derive the captured stop to the cent",
    cases
      .filter((c) => {
        if (!c.zone) return true;
        const [bottom, top] = c.zone;
        const pad = Math.max((top - bottom) * 0.25, 0.25);
        const long = c.side === "long";
        const raw = c.raid != null ? (long ? Math.min(c.raid, bottom) - pad : Math.max(c.raid, top) + pad) : long ? bottom - pad : top + pad;
        return r2(raw) !== c.s;
      })
      .map((c) => c.id),
  );
  all("CE is the array's midpoint", cases.filter((c) => !c.zone || Math.abs((c.zone[0] + c.zone[1]) / 2 - c.e) > 0.01).map((c) => c.id));
  all(
    "the stop protects the plan",
    cases.filter((c) => (c.side === "long" ? !(c.s < c.e) : !(c.s > c.e))).map((c) => c.id),
  );
  // No case's hidden future may be another case's visible past, on either book.
  const win = cases.map((c) => ({ id: c.id, a: c.t0, b: D.barTime(c, c.bars.length - 1) })).sort((x, y) => x.a - y.a);
  all(
    "no two case windows share wall-clock time",
    win.filter((w, k) => k > 0 && w.a <= win[k - 1].b).map((w) => w.id),
  );
}

/* ── 3. Stratification ───────────────────────────────────────────────────── */

console.log("\nstratified, not cherry-picked");
{
  const count = (f) => {
    const m = {};
    for (const c of cases) m[f(c)] = (m[f(c)] ?? 0) + 1;
    return m;
  };
  const qOf = (c) => (c.conf < 0.7 ? "0.65-0.70" : c.conf < 0.75 ? "0.70-0.75" : c.conf < 0.8 ? "0.75-0.80" : c.conf < 0.85 ? "0.80-0.85" : "0.85+");
  const bandOf = (c) => {
    const x = Math.abs(c.e - c.s) / c.atr;
    return x < MIN_RISK_ATR ? "under" : x <= MAX_RISK_ATR_TRADABLE ? "inside" : "over";
  };
  const sessOf = (c) => (c.kz === "london" ? "london" : c.kz === "ny_am" ? "ny_am" : "other");
  const halfOf = (c) => (new Date(c.t).getUTCFullYear() <= 2024 ? "IS" : "OOS");
  // Equal allocation, so every level must hold at least 80% of an equal share.
  const spread = (name, m, levels) => {
    const share = cases.length / levels.length;
    const thin = levels.filter((l) => (m[l] ?? 0) < 0.8 * share);
    check(`${name}: every level holds ≥80% of an equal share ${JSON.stringify(m)}`, thin, []);
  };
  spread("Q band", count(qOf), ["0.65-0.70", "0.70-0.75", "0.75-0.80", "0.80-0.85", "0.85+"]);
  spread("stop/ATR band", count(bandOf), ["under", "inside", "over"]);
  spread("session", count(sessOf), ["london", "ny_am", "other"]);
  spread("half", count(halfOf), ["IS", "OOS"]);
  const words = count((c) => c.word);
  check("WAIT and STAND both well represented", (words.WAIT ?? 0) >= 50 && (words.STAND ?? 0) >= 50, true);
  const sel = file.selection;
  check("every distinct captured TAKE setup is in", sel.takesIncluded, sel.takeEpisodes);
  check("and they are the TAKE cases", words.TAKE ?? 0, sel.takesIncluded);
  check("no case needed patching (re-run reproduced every plan)", sel.rerunRefused, 0);
  const blockers = count((c) => D.expectedAction(c).blocker ?? "none");
  check("the retrace blocker is drilled, not a rounding error", (blockers.retrace ?? 0) >= 8, true);
  check("so is the target blocker", (blockers.target ?? 0) >= 8, true);
}

/* ── 4. The desk's stored outcome, re-simulated twice ────────────────────── */

console.log("\nthe desk's outcome re-simulates identically");
{
  // LINE-FOR-LINE PORT of scripts/build-evidence-pack.mjs sim() (peak/trough
  // bookkeeping dropped — it never changes R). If either copy changes, this
  // disagrees with the app's simulator and the drill stops claiming the rule.
  const FILL = 12;
  const HOLD = 32;
  const TICK = 0.25;
  const TP1 = 0.5;
  function packSim(bars, r) {
    const long = r.side === "long";
    const E = r.e;
    const S = r.s;
    const risk = Math.abs(E - S);
    if (!(risk > 0) || r.t1 == null) return null;
    if (long ? r.t1 <= E : r.t1 >= E) return null;
    const t2 = r.t2 != null && (long ? r.t2 > r.t1 : r.t2 < r.t1) ? r.t2 : null;
    const hitStop = (b, lvl) => (long ? b.l <= lvl : b.h >= lvl);
    const hitTgt = (b, lvl) => (long ? b.h >= lvl : b.l <= lvl);
    let fi = null;
    for (let k = 1; k <= FILL && r.i + k < bars.length; k++) {
      const b = bars[r.i + k];
      if (long ? b.l <= E : b.h >= E) {
        fi = r.i + k;
        break;
      }
    }
    if (fi == null) return { filled: false };
    let stop = S;
    let rem = 1;
    let banked = 0;
    let t1Done = false;
    const rOf = (px) => (long ? px - E : E - px) / risk;
    for (let k = fi; k < bars.length && k < fi + HOLD; k++) {
      const b = bars[k];
      if (hitStop(b, stop)) {
        const px = long ? stop - TICK : stop + TICK;
        banked += rOf(px) * rem;
        return { filled: true, R: banked, t1: t1Done, exit: t1Done ? "be" : "stop", fi, k };
      }
      if (k === fi) continue;
      if (!t1Done && hitTgt(b, r.t1)) {
        t1Done = true;
        if (t2 == null) {
          banked += rOf(r.t1) * rem;
          return { filled: true, R: banked, t1: true, exit: "t1", fi, k };
        }
        banked += rOf(r.t1) * TP1;
        rem -= TP1;
        stop = E;
        continue;
      }
      if (t1Done && t2 != null && hitTgt(b, t2)) {
        banked += rOf(t2) * rem;
        return { filled: true, R: banked, t1: true, exit: "t2", fi, k };
      }
    }
    const li = Math.min(bars.length, fi + HOLD) - 1;
    banked += rOf(bars[li].c) * rem;
    return { filled: true, R: banked, t1: t1Done, exit: "time", fi, k: li };
  }

  const bad1 = [];
  const bad2 = [];
  const kinds = { filled: 0, "no-fill": 0, invalid: 0 };
  for (const c of cases) {
    kinds[c.desk.kind]++;
    const again = D.toDeskRecord(D.simulateOrder(D.caseBars(c), D.DECISION, D.deskOrder(c)));
    if (JSON.stringify(again) !== JSON.stringify(c.desk)) bad1.push(c.id);
    const full = packSim(BARS[c.sym], c);
    const offset = c.i - D.DECISION;
    const asRecord =
      full == null
        ? "invalid"
        : !full.filled
          ? { kind: "no-fill" }
          : { kind: "filled", R: D.roundR(full.R), exit: full.exit, fill: full.fi - offset, out: full.k - offset, t1: full.t1 };
    const stored = c.desk.kind === "invalid" ? "invalid" : c.desk;
    if (JSON.stringify(asRecord) !== JSON.stringify(stored)) bad2.push(c.id);
  }
  all("the app's simulator on the stored bars reproduces every stored outcome", bad1);
  all("the evidence pack's sim on the FULL four-year tape agrees — the 43-bar window cut nothing", bad2);
  check("the desk's plans filled, missed and were unpriceable in a real mix", kinds.filled > 0 && kinds["no-fill"] > 0, true);
}

/* ── 5. The simulator's rule, on bars built to test it ───────────────────── */

console.log("\nthe rule as coded, bar by bar");
{
  const flat = (p, n) => Array.from({ length: n }, () => ({ o: p, h: p + 0.5, l: p - 0.5, c: p }));
  const D0 = 5; // decision index in these fixtures
  const base = (future) => [...flat(103, D0 + 1), ...future];
  const long = (extra = {}) => ({ side: "long", type: "limit", entry: 100, stop: 96, t1: 108, t2: null, tick: 0.25, ...extra });

  {
    // The fill bar reaches T1 as well — it must not be paid.
    const bars = base([{ o: 101, h: 109, l: 99.5, c: 101 }, ...flat(101, 40)]);
    const r = D.simulateOrder(bars, D0, long());
    check("the fill bar can never score T1", [r.kind, r.t1, r.exit], ["filled", false, "time"]);
  }
  {
    const bars = base([{ o: 101, h: 101.5, l: 95.5, c: 96 }, ...flat(101, 40)]);
    const r = D.simulateOrder(bars, D0, long());
    check("the fill bar CAN stop out", [r.exit, r.fill, r.out], ["stop", D0 + 1, D0 + 1]);
    check("with one tick of slip", D.roundR(r.R), D.roundR(-(4 + 0.25) / 4));
  }
  {
    // A later bar touches the stop and T1 together.
    const bars = base([{ o: 101, h: 101.5, l: 99.5, c: 101 }, { o: 101, h: 109, l: 95, c: 100 }, ...flat(101, 40)]);
    const r = D.simulateOrder(bars, D0, long());
    check("a bar touching stop and target together is a STOP", [r.exit, r.t1], ["stop", false]);
  }
  {
    const bars = base([...flat(103, 12), { o: 101, h: 101.5, l: 99, c: 100 }, ...flat(101, 30)]);
    const r = D.simulateOrder(bars, D0, long());
    check("a touch on the 13th bar after the decision is not a fill", r.kind, "no-fill");
    const r12 = D.simulateOrder(base([...flat(103, 11), { o: 101, h: 101.5, l: 99, c: 100 }, ...flat(101, 40)]), D0, long());
    check("a touch on the 12th is", [r12.kind, r12.fill], ["filled", D0 + 12]);
  }
  {
    const bars = base([{ o: 101, h: 101.5, l: 99.5, c: 101 }, ...flat(101, 40)]);
    const r = D.simulateOrder(bars, D0, long());
    check("time exit on the 32nd bar counting the fill, at its close", [r.exit, r.out - r.fill + 1], ["time", 32]);
    check("priced at that close", D.roundR(r.R), D.roundR((101 - 100) / 4));
  }
  {
    const bars = base([{ o: 101, h: 101.5, l: 99.5, c: 101 }, { o: 104, h: 108.5, l: 103, c: 108 }, { o: 108, h: 113, l: 107, c: 112 }, ...flat(112, 40)]);
    const r = D.simulateOrder(bars, D0, long({ t2: 112 }));
    check("50% at T1, runner to T2", [r.exit, D.roundR(r.R)], ["t2", D.roundR(0.5 * (8 / 4) + 0.5 * (12 / 4))]);
    const noT2 = D.simulateOrder(bars, D0, long());
    check("no T2 — everything at T1", [noT2.exit, D.roundR(noT2.R)], ["t1", 2]);
    const behindT1 = D.simulateOrder(bars, D0, long({ t2: 105 }));
    check("a T2 not beyond T1 is ignored", behindT1.exit, "t1");
  }
  {
    const bars = base([{ o: 101, h: 101.5, l: 99.5, c: 101 }, { o: 104, h: 108.5, l: 103, c: 108 }, { o: 101, h: 102, l: 99.8, c: 100 }, ...flat(100, 40)]);
    const r = D.simulateOrder(bars, D0, long({ t2: 112 }));
    check("after T1 the stop is exact breakeven, exited with the tick", [r.exit, D.roundR(r.R)], ["be", D.roundR(0.5 * 2 + 0.5 * (-0.25 / 4))]);
  }
  {
    const bars = base([{ o: 102.25, h: 103, l: 101.5, c: 102.5 }, ...flat(102.5, 40)]);
    const r = D.simulateOrder(bars, D0, long({ type: "market", entry: null }));
    check("a market order fills at the next bar's open", [r.kind, r.entry, r.fill], ["filled", 102.25, D0 + 1]);
    const gap = D.simulateOrder(base([{ o: 95, h: 96, l: 94, c: 95 }, ...flat(95, 40)]), D0, long({ type: "market", entry: null }));
    check("a market fill through the stop is refused, not scored as a win", gap.kind, "invalid");
  }
  {
    const wrong = D.simulateOrder(base(flat(101, 43)), D0, long({ stop: 101 }));
    check("a stop on the wrong side is an order no broker takes", wrong.kind, "invalid");
    const behind = D.simulateOrder(base(flat(101, 43)), D0, long({ t1: 99 }));
    check("a T1 behind the entry is not a trade", behind.kind, "invalid");
  }
}

/* ── 6. The process checklist ────────────────────────────────────────────── */

console.log("\nthe process checklist");
{
  // A long plan: array 98–102 (CE 100), raid 97, ATR 4, desk stop 96.75,
  // T1 106, T2 110, price 103 — inside the array's reach.
  const bars = [...Array.from({ length: 64 }, (_, k) => [k * 15, 103, 103.5, 102.5, 103]), ...Array.from({ length: 43 }, (_, k) => [(64 + k) * 15, 103, 103.5, 102.5, 103])];
  const tc = {
    id: "FIX-1-L",
    sym: "MNQ",
    side: "long",
    i: 0,
    t: 0,
    t0: 0,
    word: "TAKE",
    fail: [],
    wait: [],
    conf: 0.8,
    band: "A",
    kz: "ny_am",
    etH: 10,
    etM: 0,
    wd: 2,
    atr: 4,
    px: 103,
    e: 100,
    s: 96.75,
    t1: 106,
    t2: 110,
    zone: [98, 102],
    raid: 97,
    draw: "PDH",
    range: [90, 100, 110],
    why: null,
    bars,
    desk: { kind: "no-fill" },
  };
  const st = (items) => Object.fromEntries(items.map((i) => [i.id, i.status]));
  const take = (o) => ({ word: "TAKE", layer: null, order: { type: "limit", limit: 100, stop: 96.5, t1: 106, t2: 110, ...o } });

  check("a placeable TAKE is expected as TAKE", D.expectedAction(tc).word, "TAKE");
  const perfect = st(D.scoreProcess(tc, take({})));
  check("a perfect placement passes every item that applies", perfect, {
    word: "pass",
    layer: "na",
    "limit-ce": "pass",
    "no-chase": "na",
    "stop-side": "pass",
    "stop-beyond": "pass",
    "stop-band": "pass",
    t1: "pass",
  });
  check("a limit one tick off CE still passes", st(D.scoreProcess(tc, take({ limit: 100.25 })))["limit-ce"], "pass");
  check("two ticks off does not", st(D.scoreProcess(tc, take({ limit: 100.5 })))["limit-ce"], "fail");

  // Market order with price 2 ATR beyond the array's near edge (102 + 8).
  const far = { ...tc, px: 110 };
  const chase = st(D.scoreProcess(far, { word: "TAKE", layer: null, order: { type: "market", limit: null, stop: 96.5, t1: 125, t2: null } }));
  check("a market order 2 ATR away fails 'do not pay the print'", chase["no-chase"], "fail");
  check("and is not a limit at CE", chase["limit-ce"], "fail");
  const near = st(D.scoreProcess(tc, { word: "TAKE", layer: null, order: { type: "market", limit: null, stop: 99, t1: 110, t2: null } }));
  check("a market order inside 1 ATR passes 'do not pay the print'", near["no-chase"], "pass");

  const tight = st(D.scoreProcess(tc, take({ stop: 98.8 })));
  check("a stop at 0.3 ATR fails the band", tight["stop-band"], "fail");
  const wide = st(D.scoreProcess(tc, take({ stop: 93.5 })));
  check("a stop at 1.63 ATR fails the band", wide["stop-band"], "fail");
  check("and still sits beyond the raid", wide["stop-beyond"], "pass");
  const wrongSide = st(D.scoreProcess(tc, take({ stop: 101 })));
  check("a stop on the wrong side fails the side item", wrongSide["stop-side"], "fail");
  check("and cannot be beyond the raid", wrongSide["stop-beyond"], "fail");
  const inside = st(D.scoreProcess(tc, take({ stop: 97.25 })));
  check("a stop inside the raid wick fails 'beyond the raid'", inside["stop-beyond"], "fail");
  const shortT1 = st(D.scoreProcess(tc, take({ t1: 103 })));
  check("T1 under 1R fails", shortT1.t1, "fail");
  const behindT1 = st(D.scoreProcess(tc, take({ t1: 99 })));
  check("T1 behind the entry fails", behindT1.t1, "fail");
  const stood = st(D.scoreProcess(tc, { word: "STAND", layer: "sweep", order: null }));
  check("standing on a placeable TAKE fails the word", stood.word, "fail");
  check("and leaves every placement item not-applicable", ["limit-ce", "no-chase", "stop-side", "stop-beyond", "stop-band", "t1"].map((k) => stood[k]), Array(6).fill("na"));

  // WAIT on the retrace: naming it passes, naming another layer fails.
  const wait = { ...tc, word: "WAIT", wait: ["retrace"] };
  check("a WAIT's blocker is its first non-passing layer", D.expectedAction(wait).blocker, "retrace");
  const named = st(D.scoreProcess(wait, { word: "WAIT", layer: "retrace", order: null }));
  check("naming the desk's blocker passes", [named.word, named.layer], ["pass", "pass"]);
  const misnamed = st(D.scoreProcess(wait, { word: "WAIT", layer: "sweep", order: null }));
  check("naming another layer fails", misnamed.layer, "fail");
  const overtrade = st(D.scoreProcess(wait, take({})));
  check("placing an order on a WAIT fails the word and the blocker", [overtrade.word, overtrade.layer], ["fail", "fail"]);
  check("a FAIL outranks an earlier WAIT", D.expectedAction({ ...tc, word: "STAND", fail: ["sweep"], wait: ["pd_half"] }).blocker, "sweep");
  check("nothing failing or waiting on a WAIT is the PATH grade", D.expectedAction({ ...tc, word: "WAIT" }).blocker, "path");

  // A TAKE whose raid sits 5 ATR out cannot be placed inside the band.
  const unplaceable = { ...tc, raid: 80, s: 79.75 };
  const x = D.expectedAction(unplaceable);
  check("an unplaceable TAKE is expected as STAND — the ticket's DO NOT SIZE", [x.word, x.blocker], ["STAND", "band"]);
  const refuse = st(D.scoreProcess(unplaceable, { word: "STAND", layer: "band", order: null }));
  check("and refusing it passes the word and the blocker", [refuse.word, refuse.layer], ["pass", "pass"]);
  // A desk stop inside the floor is still placeable: widen it past 0.5 ATR.
  const tightPlan = { ...tc, raid: 99.5, zone: [99.5, 100.5], s: 99.25 };
  check("a TAKE whose desk stop is too tight is still placeable by widening", D.placeable(tightPlan).ok, true);
  check("to at least 0.5 ATR, on the tick grid", D.placeable(tightPlan).stop, 98);

  // Outcomes are separate from process.
  const flatOut = D.traderOutcome(tc, { word: "WAIT", layer: "retrace", order: null });
  check("a WAIT is flat, 0R", [flatOut.kind, flatOut.R], ["flat", 0]);
  const noFill = D.traderOutcome(tc, take({}));
  check("an untouched limit is 'no fill', 0R, not a loss", [noFill.kind, noFill.R], ["no-fill", 0]);
}

/* ── 7. Vocabulary against the engine ────────────────────────────────────── */

console.log("\nthe blocker vocabulary is the engine's");
{
  const src = ["src/lib/trading/smc-master.ts", "src/lib/trading/smc-canon.ts"].map((p) => readFileSync(join(ROOT, p), "utf8")).join("\n");
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const b of D.BLOCKERS) {
    if (b.id === "band") continue; // the ticket's refusal, not a layer
    if (b.id === "path") {
      check(`"${b.label}" is what smc-master prints`, src.includes(`"${b.label}"`), true);
      continue;
    }
    const re = new RegExp(`id:\\s*"${esc(b.id)}",\\s*label:\\s*"${esc(b.label)}"`);
    check(`${b.id} → "${b.label}"`, re.test(src), true);
  }
  const ids = new Set(D.BLOCKERS.map((b) => b.id));
  all(
    "every case's blocker is in the vocabulary",
    cases.filter((c) => {
      const b = D.expectedAction(c).blocker;
      return b != null && !ids.has(b);
    }).map((c) => c.id),
  );
}

/* ── 8. Attempts, curves, next case, storage ─────────────────────────────── */

console.log("\nattempts, curves and the next case");
{
  check("no attempts → the first case in file order", D.nextCaseId(cases, []), cases[0].id);
  const bandCase = cases.find((c) => D.caseTags(c).has("band"));
  const mk = (c, fails, at) => ({
    caseId: c.id,
    at,
    openedAt: at - 30_000,
    secondsToDecide: 30,
    call: { word: "WAIT", layer: null, order: null },
    items: D.RULES.map((r) => ({ id: r.id, status: fails.includes(r.id) ? "fail" : r.id === "word" ? "pass" : "na", reason: "" })),
    yourR: 0,
    yourKind: "flat",
    deskR: 0,
    deskKind: "no-fill",
  });
  const one = [mk(cases[0], ["stop-band"], 1_000)];
  const pick = D.nextCaseId(cases, one);
  check("after a band fail, the repetition pick exercises the band", D.caseTags(cases.find((c) => c.id === pick)).has("band"), true);
  check("and it is deterministic", D.nextCaseId(cases, one), pick);
  check("never an attempted case", pick !== cases[0].id, true);
  const two = [...one, mk(cases.find((c) => c.id === pick), [], 2_000)];
  const base = cases.find((c) => !two.some((a) => a.caseId === c.id)).id;
  check("the pick after it is the base order again", D.nextCaseId(cases, two), base);
  const everything = cases.map((c, k) => mk(c, [], k));
  check("nothing left → null", D.nextCaseId(cases, everything), null);
  check("a band case exists to be surfaced", bandCase != null, true);

  const curves = D.ruleCurves([mk(cases[0], ["stop-band"], 1), mk(cases[1], [], 2)]);
  const band = curves.find((c) => c.id === "stop-band");
  check("a curve counts only attempts where the rule applied", [band.n, band.pass, band.marks], [1, 0, ["fail"]]);
  check("the word curve is its own line", curves.find((c) => c.id === "word").pass, 2);
  check("the rule failed most is named", D.weakestRule([mk(cases[0], ["stop-band"], 1)]), { id: "stop-band", fails: 1 });
  check("no fails → nothing named", D.weakestRule([mk(cases[0], [], 1)]), null);
  check("median seconds to decide", D.medianSeconds([{ ...mk(cases[0], [], 1), secondsToDecide: 10 }, { ...mk(cases[1], [], 2), secondsToDecide: 50 }, { ...mk(cases[2], [], 3), secondsToDecide: 20 }]), 20);

  check("empty storage reads as an empty store", D.parseStore(null), D.emptyStore());
  check("garbage reads as an empty store", D.parseStore("{not json"), D.emptyStore());
  const s1 = D.recordAttempt(D.emptyStore(), one[0]);
  check("a stored attempt round-trips", D.parseStore(JSON.stringify(s1)), s1);
  check("a second attempt at the same case is refused", D.recordAttempt(s1, { ...one[0], at: 9 }).attempts.length, 1);
  const dup = { ...s1, attempts: [one[0], { ...one[0], at: 5 }] };
  check("a duplicated attempt in storage keeps the FIRST answer", D.parseStore(JSON.stringify(dup)).attempts.map((a) => a.at), [1_000]);
  const openDone = { ...s1, open: { caseId: one[0].caseId, openedAt: 1 } };
  check("an attempted case cannot be reopened as undecided", D.parseStore(JSON.stringify(openDone)).open, null);
  const real = D.makeAttempt(cases[0], { word: "STAND", layer: "sweep", order: null }, 10_000, 42_300);
  check("time to decide is logged in seconds", real.secondsToDecide, 32.3);
  check("an attempt carries its itemised process", real.items.length, D.RULES.length);
}

/* ── 9. The picture before the commit knows nothing of the future ────────── */

console.log("\nthe chart before the commit is blind to the future");
{
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { DrillChart } = await import("../src/components/learn/replay-drill.tsx");
  const draw = (c, future, decided = false) => renderToStaticMarkup(React.createElement(DrillChart, { c, future, decided }));
  // Every future bar replaced with a wild one: a spike ten times the case's
  // own range, far outside anything the known bars printed.
  const leaks = [];
  const shows = [];
  for (const c of cases) {
    const lo = Math.min(...c.bars.map((b) => b[3]));
    const hi = Math.max(...c.bars.map((b) => b[2]));
    const wild = (hi - lo) * 10;
    const garbled = {
      ...c,
      bars: c.bars.map((b, k) => (k > D.DECISION ? [b[0], hi + wild, hi + 2 * wild, lo - wild, lo - wild / 2] : b)),
    };
    if (draw(c, 0) !== draw(garbled, 0)) leaks.push(c.id);
    if (draw(c, 1, true) === draw(garbled, 1, true)) shows.push(c.id);
  }
  all("the pre-commit chart is byte-identical whatever the hidden bars hold", leaks);
  all("and the first revealed bar does change it (the test can see a difference)", shows);
  // A candle's wick is the only vertical line in an up/down colour; level
  // lines in the same colours run horizontally (x1 !== x2).
  const wicks = (svg) =>
    [...svg.matchAll(/<line x1="([\d.]+)" x2="([\d.]+)"[^>]*?stroke="var\(--color-(?:up|down)\)"/g)].filter((m) => m[1] === m[2]).length;
  check("the pre-commit chart draws exactly the 64 known candles", wicks(draw(cases[0], 0)), D.PAST_BARS);
  check("each revealed bar adds exactly one", wicks(draw(cases[0], 10, true)), D.PAST_BARS + 10);
}

/* ── 10. The honest framing ──────────────────────────────────────────────── */

console.log("\nthe framing the drill prints");
{
  const lines = evidenceHeadlines();
  check("the pack's headline says the card alone is not an edge", /not an edge/.test(lines[0] ?? ""), true);
  check("and the band's line says its value is the losses it refuses", lines.some((l) => /losses it refuses/.test(l)), true);
}

/* ── 11. Against the causal capture, where it exists ─────────────────────── */

console.log("\nagainst the causal capture");
{
  let dir = ROOT;
  let sig = null;
  for (let k = 0; k < 8 && !sig; k++) {
    const cand = join(dir, ".cache", "signals");
    if (existsSync(cand) && readdirSync(cand).some((f) => /^signals-all-\d+\.json$/.test(f))) sig = cand;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (!sig) {
    console.log("  SKIPPED — .cache/signals is not on this machine (gitignored); the tape checks above still ran");
  } else {
    const rows = new Map();
    for (const f of readdirSync(sig).filter((f) => /^signals-all-\d+\.json$/.test(f))) {
      for (const r of JSON.parse(readFileSync(join(sig, f), "utf8")).rows) {
        const k = `${r.sym}|${r.i}|${r.side}`;
        if (!rows.has(k)) rows.set(k, r);
      }
    }
    const bad = [];
    for (const c of cases) {
      const r = rows.get(`${c.sym}|${c.i}|${c.side}`);
      const same =
        r &&
        r.t === c.t &&
        r.e === c.e &&
        r.s === c.s &&
        r.t1 === c.t1 &&
        r.t2 === c.t2 &&
        r.word === c.word &&
        r.conf === c.conf &&
        r.atr === c.atr &&
        r.px === c.px &&
        JSON.stringify(r.fail) === JSON.stringify(c.fail) &&
        JSON.stringify(r.wait) === JSON.stringify(c.wait) &&
        !r.judas &&
        !r.news;
      if (!same) bad.push(c.id);
    }
    console.log(`  ran against ${sig} (${rows.size} rows)`);
    all("every case is its capture row — time, plan, word, layers, no Judas, no news", bad);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
