// Test case 10/15 13:00-13:10 CT (ES): read-only on desk-watcher ticks (the live-gateway price the watcher logged, ~5 s).
// 1m bars are built from those prints (coarser than the desk's real 1m feed). For each minute this prints the new
// fast:ifvg verdict on the long and the iFVG-flip short the scanner would add. Run: node docs/unblock-2-1015/case_1300.mjs
import { register } from "tsx/esm/api"; register();
import { readFileSync, writeFileSync } from "node:fs";
const F = await import("../../src/lib/smc/ifvg-flip.ts");
const M = await import("../../src/lib/smc/mtf-arrays.ts");
const A = await import("../../src/lib/smc/ltf-arm.ts");
const ticks = readFileSync("/workspace/desk-watcher/ticks/2026-10-15.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((x) => x.s === "ES");
const by = new Map();
for (const x of ticks) { const t = Math.floor(x.t / 60) * 60_000; const b = by.get(t); if (!b) by.set(t, { t, o: x.o, h: x.h, l: x.l, c: x.c, v: 1 }); else { b.h = Math.max(b.h, x.h); b.l = Math.min(b.l, x.l); b.c = x.c; } }
const bars = [...by.values()].sort((a, b) => a.t - b.t);
const ct = (ms) => new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour12: false });
const out = [];
for (let m = 0; m <= 10; m++) {
  const now = Date.UTC(2026, 9, 15, 18, m, 0);   // 13:mm CT
  const upto = bars.filter((b) => b.t < now); const px = upto.at(-1)?.c;
  const rows = M.mtfArrays("ES:case", upto, []).filter((r) => r.tf === "5m" || r.tf === "15m");
  const [blk, why] = F.ifvgAgainst(rows, "long", px);
  const pools = A.sessionPools(upto, now, 60_000);
  const s = F.ifvgFlipOf({ symbol: "ES:case", side: "short", minute: upto, closed15: [], targets: pools, nowMs: now });
  out.push({ ct: ct(now), px, longBlocked: blk, why, short: s && { tf: s.tf, gap: s.gap, entry: s.entry, stop: s.stop, t1: s.t1, t2: s.t2, rr1: s.rr1, dispAtr: s.dispAtr } });
  console.log(ct(now), "px", px, "| long fast:ifvg", blk ? "BLOCK" : "ok", "-", why, "| short:", s ? `${s.tf} iFVG ${s.gap.lo}-${s.gap.hi} entry ${s.entry} stop ${s.stop} T1 ${s.t1?.name} ${s.t1?.price} (${s.rr1}R) disp ${s.dispAtr}xATR` : "none");
}
writeFileSync(new URL("./case_1300.json", import.meta.url), JSON.stringify(out, null, 1));
