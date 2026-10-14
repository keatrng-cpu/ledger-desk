// Replay a day's 1m tape minute by minute through the desk's array/kill code and the smcUnity shadow reads.
// usage: npx tsx scripts/replay-smc-unity.mjs <bars.json> <SYM> <side> <fromET HH:MM> <toET HH:MM>
import fs from "node:fs";
const arr = await import("../src/lib/smc/mtf-arrays.ts");
const ctx = await import("../src/lib/smc/mtf-context.ts");
const su = await import("../src/lib/smc/smc-unity.ts");
const [file, sym = "MNQ", side = "short", from = "09:40", to = "10:07"] = process.argv.slice(2);
const all = JSON.parse(fs.readFileSync(file, "utf8"));
const m1 = all[sym];
const et = (t) => new Date(t - 4 * 3600e3).toISOString().slice(11, 16);
const agg15 = (bars) => { const o = []; for (const b of bars) { const k = Math.floor(b.t / 900e3) * 900e3; const L = o[o.length - 1]; if (L && L.t === k) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; } else o.push({ t: k, o: b.o, h: b.h, l: b.l, c: b.c }); } return o; };
for (let i = 20; i < m1.length; i++) {
  const now = m1[i].t + 60_000; // feed clock: bar i just closed
  if (et(m1[i].t) < from || et(m1[i].t) > to) continue;
  const minute = m1.slice(0, i + 1);
  const b15 = agg15(minute).filter((b) => b.t + 900e3 <= now);
  // rows on the feed clock
  const rows = [];
  for (const tf of arr.LTF_RUNGS) rows.push(...rowsAt(tf, minute, now));
  const revs = ctx.ltfReversalsOf(rows, [...minute, { ...minute[minute.length - 1], t: now }]);
  const k = revs.find((r) => r.against === side);
  const px = m1[i].c;
  const book = { symbol: sym, rungs: [], ltfReversals: revs };
  const hold = su.structureHolds(book, rows, side);
  const levels = [{ name: "PDL", price: 30591.25 }, { name: "Range low", price: 30465.75 }, { name: "OR low", price: 30498 }, { name: "OR SD dn2", price: 30243 }];
  const cr = su.continuationRead({ side, price: px, t1: 30512.5, atr15: 84.6, extremeSince: Math.min(...minute.slice(-30).map((b) => b.l)), book, rows, levels,
    ranges: (at) => su.rungRanges(sym, minute, b15, at, now), card: {} });
  const poi = cr?.poi; const pd = cr?.pdAtPoi;
  console.log(`${et(m1[i].t)} c=${px}`
    + (k ? ` | kill vs ${side}: ${k.why.join("; ")} level ${k.level} legacy=${k.rearmed ? "rearmed" : "LIVE"} smcFailedOnly=${k.smc.failedOnly}` : " | no kill")
    + ` | hold ${hold.count} [${hold.rungs.join(",")}]`
    + (poi ? ` | POI ${poi.tf} ${poi.kind} CE ${poi.ce} pd@POI ${pd.agree}/${pd.of}` : " | no POI")
    + (cr?.t1 ? ` | T1→${cr.t1.name} ${cr.t1.price} ${cr.t1.r}R` : "") + ` | t1Spent=${cr?.t1Spent} wouldRoll=${cr?.wouldRoll}`);
}
function rowsAt(tf, minute, now) {
  const { bars, gaps } = arr.rung(sym, minute, tf, now);
  const last = bars.length - 1;
  return gaps.map((g) => {
    const inv = g.inverted;
    return { tf, kind: inv ? "ifvg" : "fvg", dir: inv ? (g.kind === "bull" ? "bear" : "bull") : g.kind, lo: g.bottom, hi: g.top, ce: (g.top + g.bottom) / 2,
      mitigated: !inv && g.fill === "full", failed: inv ? g.inversionFailed === true : undefined, invertedT: inv ? g.invertedT : undefined,
      ageBars: inv && g.invertedIndex != null ? last - g.invertedIndex : last - g.createdIndex, createdT: g.createdT };
  });
}
