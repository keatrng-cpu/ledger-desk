/**
 * The failed-hold exit (exit-rules.ts) fires exactly as measured — and only
 * there.
 *
 * Measured (scripts/measure-exit-plan.mjs): before T1, a 15m CLOSE beyond the
 * entry by half the entry→stop distance exits. In-band cards +0.033R →
 * +0.066R, z = 2.6. These checks pin the level, the closed-candle rule, the
 * fill-bucket boundary, and that the paper book and the card read the same
 * function.
 *
 * Run: npx tsx scripts/verify-exit-rules.mjs
 */
import { readFileSync } from "node:fs";

const { failedHold, failedHoldLevel, FAILED_HOLD_FRACTION, FAILED_HOLD_TF_MS } = await import("../src/lib/trading/exit-rules.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => check(name, !!cond, true);
const TF = FAILED_HOLD_TF_MS;

console.log("\nthe level is half-way from entry to stop, on the stop's side");
check("measured fraction is one half", FAILED_HOLD_FRACTION, 0.5);
check("long: entry 100, stop 90 → 95", failedHoldLevel("long", 100, 90), 95);
check("short: entry 100, stop 110 → 105", failedHoldLevel("short", 100, 110), 105);

const t0 = Date.UTC(2026, 9, 1, 14, 0, 0); // a 15m boundary
const bar = (k, c, extra = {}) => ({ t: t0 + k * TF, o: 100, h: Math.max(100, c) + 1, l: Math.min(100, c) - 8, c, v: 1, ...extra });
const base = { side: "long", entry: 100, stop: 90, openedAt: t0 + 3 * 60_000 };

console.log("\na CLOSE through it exits; a wick through it does not");
const wick = [bar(0, 99), bar(1, 98, { l: 80 })];
check("wick to 80, close at 98 → holds", failedHold({ ...base, nowMs: t0 + 2 * TF, bars15: wick }).triggered, false);
const closeThrough = [bar(0, 99), bar(1, 94)];
const fh = failedHold({ ...base, nowMs: t0 + 2 * TF, bars15: closeThrough });
check("close at 94 (< 95) → out", fh.triggered, true);
check("it names the candle that closed through", fh.bar?.t, t0 + TF);
check("close exactly at the level is not through", failedHold({ ...base, nowMs: t0 + 2 * TF, bars15: [bar(0, 95)] }).triggered, false);

console.log("\nonly CLOSED candles count, from the fill's own candle onward");
check("a forming candle below the level does not count", failedHold({ ...base, nowMs: t0 + TF + 60_000, bars15: [bar(0, 99), bar(1, 90)] }).triggered, false);
check("the fill's own candle counts once it closes", failedHold({ ...base, nowMs: t0 + TF, bars15: [bar(0, 93)] }).triggered, true);
check("a candle that closed BEFORE the fill never counts", failedHold({ ...base, openedAt: t0 + TF + 60_000, nowMs: t0 + 2 * TF, bars15: [bar(0, 80), bar(1, 99)] }).triggered, false);

console.log("\nshorts mirror it");
const sbase = { side: "short", entry: 100, stop: 110, openedAt: t0 + 60_000 };
check("short: close at 106 (> 105) → out", failedHold({ ...sbase, nowMs: t0 + TF, bars15: [bar(0, 106)] }).triggered, true);
check("short: close at 104 → holds", failedHold({ ...sbase, nowMs: t0 + TF, bars15: [bar(0, 104)] }).triggered, false);

console.log("\nthe paper book and the card read the same rule");
const pm = readFileSync("src/lib/trading/paper-manager.ts", "utf8");
ok("paper-manager calls failedHold()", /failedHold\(\{/.test(pm));
ok("only before TP1", /!tp1Taken && bars15/.test(pm));
ok("held on a stale quote, like a time stop", /bars15 && !staleForFill/.test(pm));
ok("it runs before the time/context stops", pm.indexOf("3b) FAILED HOLD") > 0 && pm.indexOf("3b) FAILED HOLD") < pm.indexOf("4) TIME / CONTEXT STOPS"));
const shell = readFileSync("src/routes/index.tsx", "utf8");
check("every paper-manage call passes the 15m bars", (shell.match(/bars15: \{/g) || []).length, (shell.match(/managePaperTradesAgainstPrice\(/g) || []).length);
const card = readFileSync("src/components/desk/setup-scanner.tsx", "utf8");
ok("the card prints the same level", /failedHoldLevel\(/.test(card));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
