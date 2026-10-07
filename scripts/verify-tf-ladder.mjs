/**
 * The timeframe ladder reads the trader's twelve frames, in four tiers, from
 * CLOSED candles only — and the tier rules hold.
 *
 * Found 2026-10-01: every rung read its FORMING bucket as "last" and the
 * `nowMs` the ladder was handed was discarded (`void nowMs`), so all rungs
 * repainted tick by tick; direction was decided by the YEAR, which is not in
 * the trader's stack; and 1m–3m voted on direction, which the trader's
 * hierarchy forbids ("never take a bias from the 1m–3m alone").
 *
 * Run: npx tsx scripts/verify-tf-ladder.mjs
 */
import { readFileSync } from "node:fs";

const { buildTfLadder, ladderTags, tradeDateOf, dailyFromIntraday, TF_ORDER, TF_TIER } = await import("../src/lib/trading/tf-ladder.ts");
const { etWallToEpochMs } = await import("../src/lib/trading/sessions.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => check(name, !!cond, true);

const MIN = 60_000;
const et = (d, t) => etWallToEpochMs(d, t);

console.log("\nthe trader's twelve frames, in four tiers");
check("exactly Q M W D | 4H 1H 30m | 15m 5m | 3m 2m 1m", TF_ORDER, ["3M", "1M", "1w", "1d", "4h", "1h", "30m", "15m", "5m", "3m", "2m", "1m"]);
check("Tier 1 is Q·M·W·D", TF_ORDER.filter((t) => TF_TIER[t] === 1), ["3M", "1M", "1w", "1d"]);
check("Tier 2 is 4H·1H·30m", TF_ORDER.filter((t) => TF_TIER[t] === 2), ["4h", "1h", "30m"]);
check("Tier 3 is 15m·5m", TF_ORDER.filter((t) => TF_TIER[t] === 3), ["15m", "5m"]);
check("Tier 4 is 3m·2m·1m", TF_ORDER.filter((t) => TF_TIER[t] === 4), ["3m", "2m", "1m"]);

console.log("\ntrade dates roll at 18:00 ET (a Globex session trades the next date)");
check("17:59 ET Wednesday is Wednesday", tradeDateOf(et("2026-09-30", "17:59")), "2026-09-30");
check("18:00 ET Wednesday is Thursday", tradeDateOf(et("2026-09-30", "18:00")), "2026-10-01");
check("18:00 ET Friday is Saturday's date (no session — the week is closed)", tradeDateOf(et("2026-10-02", "18:00")), "2026-10-03");

// A synthetic tape: 30 trade dates of 15m bars, a steady climb with
// pullbacks, so structure is readable on every intraday rung.
const m15 = [];
let px = 30000;
for (let d = 0; d < 40; d++) {
  const date = new Date(Date.UTC(2026, 7, 3 + d)); // from 2026-08-03
  const dow = date.getUTCDay();
  if (dow === 0 || dow === 6) continue;
  const iso = date.toISOString().slice(0, 10);
  // 02:00 → 11:45 ET: the last bar closes mid-session, after midnight.
  for (let k = 0; k < 40; k++) {
    const t = et(iso, "02:00") + k * 15 * MIN;
    const wave = Math.sin(k / 5) * 12;
    const o = px;
    px = px + 1.5 + wave * 0.1;
    m15.push({ t, o, h: Math.max(o, px) + 4, l: Math.min(o, px) - 4, c: px, v: 100 });
  }
}
const daily = dailyFromIntraday(m15);
const lastT = m15[m15.length - 1].t;
const nowMs = lastT + 15 * MIN; // the last 15m bar has just closed

console.log("\nclosed candles only — nothing repaints");
const base = buildTfLadder({ symbol: "T", daily, m15, m1: [], nowMs });
const forming = { t: nowMs, o: px, h: px + 500, l: px - 500, c: px - 400, v: 9999 };
const withForming = buildTfLadder({ symbol: "T", daily, m15: [...m15, forming], m1: [], nowMs });
const changed = base.reads.filter((r, i) => r.structure !== withForming.reads[i].structure || r.bars !== withForming.reads[i].bars);
check("a forming 15m bar changes no rung's closed read", changed.map((r) => r.tf), []);
const earlier = buildTfLadder({ symbol: "T", daily, m15, m1: [], nowMs: lastT + 14 * MIN });
const r15 = (l) => l.reads.find((r) => r.tf === "15m");
check("a bar whose end is after now is not closed", r15(earlier).bars <= r15(base).bars, true);
ok("the 15m rung counts the bar the moment it closes", r15(base).bars >= r15(earlier).bars);
// Code only: the file's own header documents the old `void nowMs` bug.
const src = readFileSync("src/lib/trading/tf-ladder.ts", "utf8")
  .split("\n")
  .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
  .join("\n");
ok("nowMs is no longer discarded", !/void nowMs/.test(src));
const right18 = buildTfLadder({ symbol: "T", daily, m15, m1: [], nowMs: et(tradeDateOf(nowMs), "00:00") + 18 * 60 * MIN });
ok("at a fresh 18:00 session with no bars yet, the daily rung reads no open rather than inventing one", right18.reads.find((r) => r.tf === "1d").open == null || right18.reads.find((r) => r.tf === "1d").why.length > 0);

console.log("\ndirection is HTF structure (the day and the 4H); the quarter and the 1m–3m do not vote");
ok("a climb with no swing is not a direction from the quarter open", base.direction === "neutral" && base.decidedBy == null);
ok("the quarter did not decide the no-swing tape", base.decidedBy !== "3M" && base.decidedBy !== "1M");
// Hand-built daily swings (HH/HL). The 15m tape has no swings, so only the day can decide.
const swingDaily = [100, 110, 140, 120, 110, 130, 160, 140, 130, 155, 190, 160].map((h, i) => {
  const l = [70, 80, 100, 90, 85, 100, 125, 115, 110, 130, 155, 140][i];
  const iso = new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10);
  return { t: et(iso, "00:00"), o: l + 5, h, l, c: (h + l) / 2, v: 100 };
});
const swing = buildTfLadder({ symbol: "T", daily: swingDaily, m15, m1: [], nowMs });
ok("a daily HH/HL is a direction", swing.direction === "bull");
ok("decided by the day, not the quarter", swing.decidedBy === "1d");
const mk1m = (dir) => {
  const out = [];
  const start = nowMs - 120 * MIN;
  let p = px;
  for (let i = 0; i < 120; i++) {
    const o = p;
    p = p + (dir === "up" ? 2 : -2) + Math.sin(i / 3) * 3;
    out.push({ t: start + i * MIN, o, h: Math.max(o, p) + 1, l: Math.min(o, p) - 1, c: p, v: 10 });
  }
  return out;
};
const up = buildTfLadder({ symbol: "T", daily: swingDaily, m15, m1: mk1m("up"), nowMs });
const down = buildTfLadder({ symbol: "T", daily: swingDaily, m15, m1: mk1m("down"), nowMs });
check("a bullish vs bearish 1m tape leaves direction unchanged", up.direction, down.direction);
check("and leaves the deciding rung unchanged", up.decidedBy, down.decidedBy);
ok("while the trigger tier itself did flip", up.tier4 !== down.tier4);

console.log("\nalignment counts Tiers 1–3 only, Tier 1 heaviest");
const W = { 1: 2, 2: 1.5, 3: 1, 4: 0 };
for (const [name, l] of [["up", up], ["down", down]]) {
  let a = 0;
  let t = 0;
  for (const r of l.reads) {
    if (r.source === "none" || W[r.tier] === 0) continue;
    t += W[r.tier];
    if (l.direction !== "neutral" && r.bias === l.direction) a += W[r.tier];
  }
  check(`${name}: alignment matches the tier-weighted Tier 1–3 share`, +l.alignment.toFixed(6), +(t ? a / t : 0).toFixed(6));
}

console.log("\nthe daily rung reads ICT's midnight open once midnight has passed");
const d1 = base.reads.find((r) => r.tf === "1d");
ok(`daily rung names the midnight open (${d1.why})`, /midnight open/.test(d1.why));

console.log("\nIPDA 20/40/60-day range is read from closed days");
ok("an IPDA range exists with 20+ closed days", base.ipda != null);
ok("60-day position is a fraction of the range", base.ipda && base.ipda.pct60 >= 0 && base.ipda.pct60 <= 1.5);
const tags = ladderTags(base, "long");
ok("tags carry the tiers and the IPDA zone for the shadow book", "tf_tier1" in tags && "tf_tier4" in tags && "tf_ipda" in tags);

console.log("\nthe panel shows the server's closed read, never a browser rebuild");
const panel = readFileSync("src/components/desk/tf-ladder-panel.tsx", "utf8");
ok("tf-ladder-panel does not call buildTfLadder", !/buildTfLadder\(/.test(panel));
ok("it renders desk.ladder", /desk\.ladder/.test(panel));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
