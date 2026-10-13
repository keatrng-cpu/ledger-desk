// Full-fidelity desk replay: the REAL buildTradingDesk + deskListenCard, unchanged, at each minute of a session.
// Clock = Date shim; data = globalThis.fetch stub serving Yahoo chart JSON sliced to step time T from real 1m/1d history.
// Anything else (gateway, databento, LLMs, news) is refused -> those legs fail closed exactly as when they are down live.
// Usage: node scripts/fidelity/replay-desk.mjs 2026-10-12 [stepSec=60] > cards-2026-10-12.jsonl
import { register } from "tsx/esm/api"; register();
import { readFileSync, existsSync } from "node:fs";
process.on("unhandledRejection", () => {}); process.on("uncaughtException", () => {});
for (const k of ["XAI_API_KEY", "ANTHROPIC_API_KEY", "DATABENTO_API_KEY", "GATEWAY_URL", "DATABASE_URL", "NETLIFY_DATABASE_URL"]) delete process.env[k];
const DATA = process.env.FID_DATA ?? "/workspace/fidelity-data";
const day = process.argv[2]; const stepS = Number(process.argv[3] ?? 60);
const load = (f) => (existsSync(`${DATA}/${f}`) ? JSON.parse(readFileSync(`${DATA}/${f}`, "utf8")) : []);
const M1 = { "MNQ=F": load("NQ=F.1m.json"), "NQ=F": load("NQ=F.1m.json"), "ES=F": load("ES=F.1m.json"), SPY: load("SPY.1m.json"), QQQ: load("QQQ.1m.json"), "DX-Y.NYB": load("DX-Y.NYB.1m.json"), "^TNX": load("^TNX.1m.json") };
const D1 = { "MNQ=F": load("MNQ=F.1d.json"), "NQ=F": load("MNQ=F.1d.json"), "ES=F": load("ES=F.1d.json") };
const FUT = (s) => s.endsWith("=F");

// ---- clock ----
const RealDate = Date; let SIM = 0;
class SimDate extends RealDate { constructor(...a) { a.length ? super(...a) : super(SIM); } static now() { return SIM; } }
globalThis.Date = SimDate;

// ---- data ----
const bisect = (a, t) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].t < t) lo = m + 1; else hi = m; } return lo; };
/** ms to add to a wall-clock-as-UTC value in tz to get the real instant */
function tzOff(tz, T) { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new RealDate(T)).map((x) => [x.type, x.value]));
  return T - RealDate.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second); }
/** futures session start (17:00 CT the prior evening) or 04:00 ET for cash symbols */
function sessionStart(sym, T) {
  const tz = FUT(sym) ? "America/Chicago" : "America/New_York"; const off = tzOff(tz, T);
  const s = new RealDate(T - off); if (FUT(sym)) { if (s.getUTCHours() < 17) s.setUTCDate(s.getUTCDate() - 1); s.setUTCHours(17, 0, 0, 0); } else s.setUTCHours(4, 0, 0, 0);
  return s.getTime() + off;
}
function agg(bars, ms) { const out = []; for (const b of bars) { const k = Math.floor(b.t / ms) * ms; const l = out[out.length - 1];
  if (l && l.t === k) { l.h = Math.max(l.h, b.h); l.l = Math.min(l.l, b.l); l.c = b.c; l.v += b.v; } else out.push({ ...b, t: k }); } return out; }
const RANGE_MS = { "1d": 0, "5d": 5 * 86400e3, "1mo": 31 * 86400e3, "3mo": 92 * 86400e3, "2y": 731 * 86400e3 };
function series(sym, range, interval, T) {
  const m1 = M1[sym] ?? []; const upto = m1.slice(0, bisect(m1, T - 60e3 + 1));   // completed 1m bars (t+60s <= T)
  if (interval === "1d") {
    const d = (D1[sym] ?? []); const ss = sessionStart(sym, T);
    const past = d.filter((b) => b.t < ss - 6 * 3600e3);
    const today = upto.filter((b) => b.t >= ss); if (today.length) past.push(agg(today, 86400e3 * 9999)[0] && { t: ss, o: today[0].o, h: Math.max(...today.map((b) => b.h)), l: Math.min(...today.map((b) => b.l)), c: today.at(-1).c, v: today.reduce((s, b) => s + b.v, 0) });
    return past;
  }
  const from = range === "1d" ? sessionStart(sym, T) : T - (RANGE_MS[range] ?? 5 * 86400e3);
  const win = upto.slice(bisect(upto, from));
  return interval === "1m" ? win : agg(win, ({ "5m": 5, "15m": 15, "30m": 30, "60m": 60 })[interval] * 60e3);
}
function chartJson(sym, range, interval, T) {
  const b = series(sym, range, interval, T); if (!b.length) return null;
  const d = D1[sym] ?? []; const prev = d.filter((x) => x.t < sessionStart(sym, T) - 6 * 3600e3).at(-1);
  return { chart: { error: null, result: [{ meta: { symbol: sym, regularMarketPrice: b.at(-1).c, regularMarketTime: Math.floor(T / 1000) - 2, previousClose: prev?.c, chartPreviousClose: prev?.c,
    exchangeTimezoneName: FUT(sym) ? "America/Chicago" : "America/New_York", gmtoffset: FUT(sym) ? -18000 : -14400 },
    timestamp: b.map((x) => Math.floor(x.t / 1000)), indicators: { quote: [{ open: b.map((x) => x.o), high: b.map((x) => x.h), low: b.map((x) => x.l), close: b.map((x) => x.c), volume: b.map((x) => x.v) }] } }] } };
}
const refused = new Set();
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  const m = u.pathname.match(/\/v8\/finance\/chart\/(.+)$/);
  if (u.hostname.endsWith("finance.yahoo.com") && m) {
    const j = chartJson(decodeURIComponent(m[1]), u.searchParams.get("range"), u.searchParams.get("interval"), SIM);
    if (j) return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("{}", { status: 404 });
  }
  refused.add(u.hostname); throw new Error(`replay: no historical source for ${u.hostname} (fail closed)`);
};

const { buildTradingDesk } = await import("../../src/lib/trading/build-desk.ts");
const { deskListenCard } = await import("../../src/lib/trading/desk-listen.ts");
// 09:25 -> 15:50 ET
const etMs = (hhmm) => { const off = tzOff("America/New_York", new RealDate(`${day}T16:00:00Z`).getTime());
  const [h, mi] = hhmm.split(":").map(Number); return new RealDate(`${day}T00:00:00Z`).getTime() + (h * 60 + mi) * 60e3 + off; };
const end = etMs("15:51");
for (let T = etMs("09:25"); T <= end; T += stepS * 1000) {
  SIM = T + 3000;   // the card is built 3 s after the minute close, like the live poll
  let card;
  try { const desk = await buildTradingDesk({ left: "MNQ", right: "ES" }); if (process.env.FID_DEBUG) process.stderr.write(JSON.stringify({ blocked: desk?.scan?.blocked, budget: desk?.budget?.line, legs: desk?.budget?.legs?.map((l) => l.id + "=" + l.status) }) + "\n");
    card = desk?.ok ? { ok: true, ...deskListenCard(desk) } : { ok: false, error: desk?.error ?? "build failed" }; }
  catch (e) { card = { ok: false, error: String(e?.message ?? e) }; }
  process.stdout.write(JSON.stringify({ T: SIM, card }) + "\n");
}
process.stderr.write(`refused hosts (fail closed): ${[...refused].join(", ") || "none"}\n`);
process.exit(0);
