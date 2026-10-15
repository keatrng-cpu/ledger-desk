// 10/15 13:00-13:10 CT ES read-priority case on the post-mortem's 1m bars (Databento GLBX 08:30-13:00 + Supabase tail; $0).
// Prints per poll minute: the long's fast:ifvg (B+), whether the read flipped, and the short the desk generates in the same poll.
// Run: node docs/postmortem-fixes-1015/case_readprio.mjs   (fixture: scripts/fixtures/es1m_1015.json)
import { register } from "tsx/esm/api"; register();
import { readFileSync, writeFileSync } from "node:fs";
const F = await import("../../src/lib/smc/ifvg-flip.ts");
const M = await import("../../src/lib/smc/mtf-arrays.ts");
const A = await import("../../src/lib/smc/ltf-arm.ts");
const bars = JSON.parse(readFileSync(new URL("../../scripts/fixtures/es1m_1015.json", import.meta.url), "utf8"));
const ct = (ms) => new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour12: false });
const out = [];
for (const [m, s] of [[0, 30], [1, 5], [2, 3], [3, 5], [4, 5], [5, 5], [6, 5], [8, 5], [10, 5]]) {
  const now = Date.UTC(2026, 9, 15, 18, m, s);
  const upto = bars.filter((b) => b.t + 60_000 <= now); const px = upto.at(-1)?.c;
  const rows = M.mtfArrays("ES:rp", upto, []).map((r) => ({ ...r, ...M.through1m(upto, r, now) }));
  const arr = rows.filter((r) => r.tf === "5m" || r.tf === "15m");
  const [blk, why] = F.ifvgAgainst(arr, "long", px, undefined, "B+");
  const flipped = F.readFlipped(arr, "long");
  const pools = A.sessionPools(upto, now, 60_000);
  const sh = F.ifvgFlipOf({ symbol: "ES:rp", side: "short", minute: upto, closed15: [], targets: F.flipTargets(pools, F.scannerPools({ symbol: "ES:rp", side: "short", minute: upto, nowMs: now, arrays: arr })), nowMs: now, arrays: arr });
  out.push({ ct: ct(now), px, longBlocked: blk, why, readFlipped: flipped, short: sh && { tf: sh.tf, gap: sh.gap, entry: sh.entry, stop: sh.stop, t1: sh.t1, rr1: sh.rr1, why: sh.why } });
  console.log(ct(now), "px", px, "| long(B+)", blk ? "BLOCK" : "ok", "-", why, "| flipped", flipped, "| short:", sh ? `entry ${sh.entry} stop ${sh.stop} T1 ${sh.t1?.name} ${sh.t1?.price} (${sh.rr1}R) — ${sh.why}` : "none");
}
writeFileSync(new URL("./case_readprio.json", import.meta.url), JSON.stringify(out, null, 1));
