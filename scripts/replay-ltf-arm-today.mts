/**
 * Scanner-level replay of 2026-10-14 NY AM (fixture: Yahoo 1m + 15m, no network). For each closed minute
 * 09:31-09:48 ET runs scanSetups exactly as build-desk does (forming 15m bucket patched from the 1m, closed
 * prefix for detection, 1m tape) in ltfArm shadow AND live mode, and prints every LONG row.
 * Usage: npx tsx scripts/replay-ltf-arm-today.mts
 */
import { readFileSync } from "node:fs";
import { LTF_ARM } from "../src/lib/smc/ltf-arm";
import { scanSetups } from "../src/lib/trading/scanner";
import { analyzeStructure, smtDivergence } from "../src/lib/trading/structure";
import { getSessionClock } from "../src/lib/trading/sessions";
const F = JSON.parse(readFileSync(new URL("./fixtures/ltf-arm-2026-10-14.json", import.meta.url), "utf8"));
const KZ0 = Date.UTC(2026, 9, 14, 13, 30);
const et = (t: number) => new Date(t).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false }).slice(0, 5);
type B = { t: number; o: number; h: number; l: number; c: number; v?: number };
const build15 = (h15: B[], m1: B[], now: number) => {
  const out = h15.map((b) => ({ ...b, v: 0 }));
  for (const b of m1.filter((x) => x.t >= KZ0 - 0 && x.t < now)) {
    const k = Math.floor(b.t / 900_000) * 900_000; const L = out[out.length - 1];
    if (L && L.t === k) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; } else out.push({ ...b, t: k, v: 0 });
  }
  return out;
};
const rows: Record<string, unknown[]> = { shadow: [], live: [] };
for (const mode of ["shadow", "live"] as const) {
  (LTF_ARM as { mode: string }).mode = mode;
  for (let now = KZ0 + 60_000; now <= KZ0 + 18 * 60_000; now += 60_000) {
    const mL = F.MNQ.filter((b: B) => b.t < now).map((b: B) => ({ ...b, v: 0 })), mR = F.ES.filter((b: B) => b.t < now).map((b: B) => ({ ...b, v: 0 }));
    const L = build15(F.MNQ_15m, mL, now), R = build15(F.ES_15m, mR, now);
    const cL = L.filter((b) => b.t + 900_000 <= now), cR = R.filter((b) => b.t + 900_000 <= now);
    const bl = analyzeStructure("MNQ", L as never, 0, { closed: cL as never }), br = analyzeStructure("ES", R as never, 0, { closed: cR as never });
    const clock = getSessionClock(new Date(now));
    const scan = scanSetups(bl, br, clock, smtDivergence(cL as never, cR as never), L as never, R as never, undefined, { left: mL as never, right: mR as never }, { left: cL as never, right: cR as never }, { nowMs: now, interval: "15m" });
    for (const c of scan.candidates.filter((x) => x.side === "long")) rows[mode]!.push(`${et(now)} ${c.symbol} long ${c.strategyPrimary} q${c.confluence.toFixed(2)} path ${c.pathBand} htfOk ${c.htfOk} act ${c.actionable}${c.ltfArmed ? ` ARMED ${c.ltfArm!.tf} entry ${c.entryPx} stop ${c.ltfArm!.stop} T1 ${c.ltfArm!.t1?.name ?? "-"} ${c.ltfArm!.t1?.price ?? ""}` : c.ltfArm ? ` (shadow arm ${c.ltfArm.tf}, would ${c.ltfArmShadow?.wouldBand})` : ""} | ${c.missing.slice(0, 2).join("; ")}`);
    for (const d of scan.ltfArmShadow ?? []) rows[mode]!.push(`${et(now)} ${d.symbol} ${d.side} DROPPED by board, shadow would ${d.wouldBand}: ${d.arm.why}`);
  }
}
for (const m of ["shadow", "live"]) { console.log(`== ${m}`); for (const r of rows[m]!) console.log("  " + r); }
