// Usage: node scripts/smoke-desk-budget.mjs — live Yahoo; simulates a hung Yahoo to show the budget trip.
import { register } from "tsx/esm/api";
register();
// Local Node 20 lacks fs.glob (PGLite bootstrap); the gateway legs fail closed — ignore that noise.
process.on("unhandledRejection", () => {});
process.on("uncaughtException", (e) => console.log("  (ignored local env error:", e?.message, ")"));
const realFetch = globalThis.fetch;
let slow = false;
let slowAll = false;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if ((slow && u.includes("finance.yahoo.com") && u.includes("interval=15m")) || (slowAll && u.includes("finance.yahoo.com"))) {
    await new Promise((r) => setTimeout(r, 20_000));
  }
  return realFetch(url, init);
};
const mod = await import("../src/lib/trading/build-desk.ts");
const fn = (o) => mod.buildTradingDesk(o.data);
const call = async (label) => {
  const t = Date.now();
  let res;
  try { res = await fn({ data: { left: "MNQ", right: "ES" } }); } catch (e) { console.log(label, "THREW", e?.message); return; }
  const ms = Date.now() - t;
  if (!res?.ok) { console.log(label, ms, "ERR", res?.error ?? res); return; }
  console.log(label, `${ms}ms`, "stale=", res.stale, "feed=", res.feed, "L.src=", res.left.source, "L.stale=", res.left.stale ?? false, "Lq=", res.quotes.left.source, res.quotes.left.lagSec + "s", "Lq.stale=", res.quotes.left.stale ?? false);
  console.log("  legs:", res.budget.legs.map((l) => `${l.id}=${l.status}/${l.ms}ms${l.ageSec != null ? `/${l.ageSec}s` : ""}`).join(" "));
  console.log("  line:", res.budget.line || "(none)");
  console.log("  blocked:", res.scan.blocked.filter((b) => b.includes("stale desk") || b.includes("Stale")).join(" | ") || "(none)");
};
await call("cold   ");
await call("warm   ");
slow = true;
await call("slowY15");
await new Promise((r) => setTimeout(r, 21_000)); // let the 1m/daily TTLs lapse
slowAll = true;
await call("slowAll");
process.exit(0);
