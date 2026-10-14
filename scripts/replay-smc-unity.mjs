// Replay one day's 1m tape minute by minute through the desk's REAL array/kill code (mtfArrays, ltfReversalsOf)
// and the smcUnity shadow reads. Levels are COMPUTED, never hard-coded: session ranges (sessionRanges, one
// session, 18:00 ET roll), prior-session high/low (sessionKeyOf), ATR15 from closed 15m (rollingAtr); T1 is
// the nearest computed level beyond price on the trade side. Bounded window (≤ 3000 1m bars) to stay fast.
// usage: npx tsx scripts/replay-smc-unity.mjs <bars.json: [{t,o,h,l,c}] or {SYM:[...]}> <SYM> <side> <YYYY-MM-DD> <fromET HH:MM> <toET HH:MM>
import fs from "node:fs";
const arr = await import("../src/lib/smc/mtf-arrays.ts");
const ctx = await import("../src/lib/smc/mtf-context.ts");
const su = await import("../src/lib/smc/smc-unity.ts");
const { rollingAtr } = await import("../src/lib/trading/detectors.ts");
const [file, sym = "MNQ", side = "short", day = "2026-10-14", from = "09:40", to = "10:07"] = process.argv.slice(2);
const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const m1all = (Array.isArray(raw) ? raw : raw[sym]).filter((b) => [b.o, b.h, b.l, b.c].every((x) => x != null));
const etHm = (t) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(new Date(t));
const etDay = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(t));
const agg15 = (bars) => { const o = []; for (const b of bars) { const k = Math.floor(b.t / 900e3) * 900e3; const L = o[o.length - 1]; if (L && L.t === k) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; } else o.push({ t: k, o: b.o, h: b.h, l: b.l, c: b.c }); } return o; };
const t0 = Date.now(); let n = 0;
for (let i = 20; i < m1all.length; i++) {
  const bt = m1all[i].t;
  if (etDay(bt) !== day) continue;
  const hm = etHm(bt); if (hm < from || hm > to) continue;
  const now = bt + 60_000; // feed clock: bar i just closed
  const minute = m1all.slice(Math.max(0, i - 2999), i + 1);
  const b15 = agg15(minute).filter((b) => b.t + 900e3 <= now);
  const a15 = rollingAtr(b15); const atr15 = a15[a15.length - 1] ?? null;
  const rows = arr.mtfArrays(sym, minute, b15);
  const revs = ctx.ltfReversalsOf(rows, [...minute, { ...minute[minute.length - 1], t: now }]);
  const k = revs.find((r) => r.against === side);
  const px = m1all[i].c;
  const cur = su.sessionKeyOf(bt);
  const prev = minute.filter((b) => su.sessionKeyOf(b.t) < cur); const pk = prev.length ? su.sessionKeyOf(prev[prev.length - 1].t) : null;
  const ps = prev.filter((b) => su.sessionKeyOf(b.t) === pk);
  const levels = [
    ...su.sessionRanges(minute, now).flatMap((s) => [{ name: `${s.name} high`, price: s.hi }, { name: `${s.name} low`, price: s.lo }]),
    ...(ps.length ? [{ name: "PDH", price: Math.max(...ps.map((b) => b.h)) }, { name: "PDL", price: Math.min(...ps.map((b) => b.l)) }] : []),
  ];
  const beyond = levels.filter((l) => (side === "short" ? l.price < px : l.price > px)).sort((a, b) => Math.abs(a.price - px) - Math.abs(b.price - px));
  const book = { symbol: sym, rungs: [], ltfReversals: revs };
  const hold = su.structureHolds(book, rows, side);
  const cr = atr15 ? su.continuationRead({ side, price: px, t1: beyond[0]?.price ?? null, atr15, extremeSince: Math.min(...minute.slice(-30).map((b) => b.l)), book, rows, levels,
    ranges: (at) => su.rungRanges(sym, minute, b15, at, now), card: {} }) : null;
  const poi = cr?.poi; const pd = cr?.pdAtPoi; n++;
  console.log(`${hm} c=${px} atr15=${atr15?.toFixed(2)}`
    + (k ? ` | kill vs ${side}: ${k.why.join("; ")} level ${k.level} legacy=${k.rearmed ? "rearmed" : "LIVE"} cleared=${Boolean(k.killCleared)} smcFailedOnly=${k.smc?.failedOnly}` : " | no kill")
    + ` | hold ${hold.count} [${hold.rungs.join(",")}]`
    + (poi ? ` | POI ${poi.tf} ${poi.kind} CE ${poi.ce} pd@POI ${pd?.agree}/${pd?.of}` : " | no POI")
    + ` | T1 ${beyond[0] ? `${beyond[0].name} ${beyond[0].price}` : "—"}`
    + (cr?.t1 ? ` → ${cr.t1.name} ${cr.t1.price} ${cr.t1.r}R` : "") + ` | t1Spent=${cr?.t1Spent} wouldRoll=${cr?.wouldRoll}`);
}
console.error(`${n} minutes in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
