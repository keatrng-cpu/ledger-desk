/**
 * Replay the fast LTF flip (seq/ladder.ts ltfFlip) minute by minute over a fixture, closed bars only (no lookahead):
 *   npx tsx scripts/replay-ltf-flip.mts [scripts/fixtures/ladder-2026-10-15.json] [MNQ]
 * Prints every stage change (SWEPT → RECLAIMED → PROMOTED) and the no-upgrade notes, with CT clock times.
 */
import { readFileSync } from "node:fs";
import { ladderBook } from "../src/lib/smc/seq/ladder.ts";

const fx = JSON.parse(readFileSync(process.argv[2] ?? new URL("./fixtures/ladder-2026-10-15.json", import.meta.url), "utf8"));
const sym = process.argv[3] ?? "MNQ";
const b = fx.books[sym];
const m1 = b.minute as { t: number; o: number; h: number; l: number; c: number }[];
const ct = (t: number) => new Date(t).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour12: false, hour: "2-digit", minute: "2-digit" }) + " CT";
const mapOf = { symbol: sym, levels: b.levels, pools: b.pools, arrays: [], biasStack: { htf: "bear", mtf: "bear", ltf: "bear" }, atr15: null };
let last = "";
for (let now = m1[0].t + 61 * 60_000; now <= m1.at(-1)!.t + 60_000; now += 60_000) {
  const closed = m1.filter((x) => x.t + 60_000 <= now);
  const px = closed.at(-1)!.c;
  const hourly = b.hourly.filter((x: { t: number }) => x.t + 3_600_000 <= now);
  const r = ladderBook({ symbol: sym, price: px, nowMs: now, hourly, daily: b.daily, minuteClosed: closed, map: mapOf as never });
  const f = r.ltfFlip;
  const key = f ? `${f.side}:${f.stage}:${f.entry}` : "none";
  if (key !== last) {
    console.log(`${ct(now)} px ${px} | ${f ? `${f.stage} ${f.side} (demotes ${f.demotes})${f.entry != null ? ` entry ${f.entry} stop ${f.stop} T1 ${f.targets[0]?.touch} (${f.targets[0]?.r}R)` : ""} — ${f.why.join("; ")}` : "no flip"}${r.noUpgrade.length ? " | " + r.noUpgrade.map((n) => n.why).join("; ") : ""}`);
    last = key;
  }
}
