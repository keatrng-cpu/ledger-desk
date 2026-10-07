/**
 * The headless paper step: when it may run, and the write it is allowed.
 *   npx tsx scripts/verify-paper-step.mjs
 *
 * The options window, the 90s lease, a synthetic feed that must not persist,
 * and the compare-and-swap on the real migration. The route must not import
 * a broker. SERVER_RUNNER_BUILT stays false.
 */
import { readFileSync } from "node:fs";
import { etWallToUtc } from "../src/lib/journal/risk.ts";
import { EXEC_FLAGS, EXEC_LIMITS } from "../src/lib/room/exec/limits.ts";
import {
  PAPER_STEP_CAS_SQL,
  PAPER_STEP_INSERT_SQL,
  PAPER_STEP_READ_SQL,
  browserHoldsLease,
  decidePaperStep,
  feedMayStep,
  paperStepDue,
} from "../src/lib/room/paper-step.ts";

const { PGlite } = await import("@electric-sql/pglite");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const at = (y, m, d, h, min) => etWallToUtc(y, m, d, h, min).getTime();
// 2026-10-05 is a Monday.
const mon = (h, min) => at(2026, 10, 5, h, min);

console.log("window");
check("09:29 sits", paperStepDue(mon(9, 29)).due === false);
check("09:30 steps", paperStepDue(mon(9, 30)).due === true);
check("15:30 still steps", paperStepDue(mon(15, 30)).due === true);
check("15:59 still steps", paperStepDue(mon(15, 59)).due === true);
check("16:00 sits", paperStepDue(mon(16, 0)).due === false);
check("saturday sits", paperStepDue(at(2026, 10, 3, 10, 0)).due === false);
check("sunday sits", paperStepDue(at(2026, 10, 4, 10, 0)).due === false);
check("friday 15:59 steps", paperStepDue(at(2026, 10, 2, 15, 59)).due === true);
check("a forced saturday still answers the clock skip", paperStepDue(at(2026, 10, 3, 10, 0), true).due === true);

console.log("lease");
const lease = EXEC_LIMITS.leaseSec * 1000;
const now = 1_700_000_000_000;
check("89s still holds", browserHoldsLease(now - (lease - 1), now));
check("exactly 90s is free", !browserHoldsLease(now - lease, now));
check("no saved_at is free", !browserHoldsLease(null, now));
check("a future saved_at holds", browserHoldsLease(now + 5_000, now));

console.log("feed");
check("synthetic does not step", feedMayStep("synthetic").step === false);
check("yahoo still steps", feedMayStep("yahoo").step === true);
check("databento steps", feedMayStep("databento").step === true);
check("mixed steps", feedMayStep("mixed").step === true);

console.log("order");
const live = { nowMs: mon(10, 0), forced: false, savedAtMs: null, feed: "yahoo" };
check("a free monday steps", decidePaperStep(live).act === "step");
check("the window beats a free lease", decidePaperStep({ ...live, nowMs: mon(9, 29) }).act === "skip");
check(
  "the lease beats a live feed",
  decidePaperStep({ ...live, savedAtMs: live.nowMs - 1_000 }).why === "browser holds the lease",
);
check(
  "synthetic loses even when forced",
  decidePaperStep({ nowMs: at(2026, 10, 3, 12, 0), forced: true, savedAtMs: null, feed: "synthetic" }).why ===
    "synthetic feed is not a price",
);

console.log("the swap, on PGLite with the real migration");
const db = new PGlite();
await db.exec(readFileSync(new URL("../migrations/0017_room_snapshot.sql", import.meta.url), "utf8"));
const ins = await db.query(PAPER_STEP_INSERT_SQL, ["u1", JSON.stringify({ tag: "a" }), 0, 0]);
check("the first copy inserts", ins.rows.length === 1);
const read = (await db.query(PAPER_STEP_READ_SQL, ["u1"])).rows[0];
check("the read carries a microsecond token", typeof read.saved_at === "string" && read.saved_at.includes("."));
const upd = await db.query(PAPER_STEP_CAS_SQL, ["u1", JSON.stringify({ tag: "b" }), 1, 10, read.saved_at]);
check("the token we read writes", upd.rows.length === 1);
const stale = await db.query(PAPER_STEP_CAS_SQL, ["u1", JSON.stringify({ tag: "c" }), 9, 99, read.saved_at]);
check("a changed token is refused", stale.rows.length === 0);
const tag = (await db.query("select body from room_snapshot where user_id = 'u1'")).rows[0].body.tag;
check("the refused write left the book", tag === "b");
const again = await db.query(PAPER_STEP_INSERT_SQL, ["u1", JSON.stringify({ tag: "z" }), 0, 0]);
check("a second insert does not clobber", again.rows.length === 0 && tag === "b");
check("the swap is not the snapshot upsert", !PAPER_STEP_CAS_SQL.includes("history <") && !PAPER_STEP_CAS_SQL.includes("::boolean"));
await db.close();

console.log("the route");
const route = readFileSync(new URL("../src/routes/api/cron/room-step.ts", import.meta.url), "utf8");
const step = readFileSync(new URL("../src/lib/room/paper-step.ts", import.meta.url), "utf8");
const ringer = readFileSync(new URL("../netlify/functions/room-step.mjs", import.meta.url), "utf8");
const install = readFileSync(new URL("../scripts/install-netlify-cron.mjs", import.meta.url), "utf8");
const tree = readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");
const imports = [...route.matchAll(/^import .+$/gm)].map((m) => m[0]);
check("the route does not import a broker", imports.every((l) => !/alpaca|exec\/executor|execAfterCycle/i.test(l)));
check("the step module does not import a broker", !/alpaca|execAfterCycle/i.test(step));
check("the route does not assign the runner flag", !/SERVER_RUNNER_BUILT\s*[:=]/.test(route));
check("the route uses the swap, not the snapshot upsert", route.includes("PAPER_STEP_CAS_SQL") && !route.includes("SNAPSHOT_UPSERT_SQL"));
const body = route.slice(route.indexOf("async function handle"));
const iDue = body.indexOf("paperStepDue");
const iLease = body.indexOf("browserHoldsLease");
const iFeed = body.indexOf("feedMayStep");
const iCas = body.indexOf("PAPER_STEP_CAS_SQL");
check("window, then lease, then feed, then the swap", iDue >= 0 && iDue < iLease && iLease < iFeed && iFeed < iCas);
check("the ringer is five minutes across both seasons", ringer.includes('schedule: "*/5 13-21 * * 1-5"'));
check("the ringer cannot open on a missing secret", ringer.includes("CRON_SECRET") && ringer.includes("status: 200"));
check("the installer copies the ringer", install.includes("room-step.mjs"));
check("the route tree registers the step", tree.includes("/api/cron/room-step"));
check("the runner flag is on", EXEC_FLAGS.SERVER_RUNNER_BUILT === true);
check("the other live flags are on", EXEC_FLAGS.OPTIONS_LIVE_CONFIRMED_IN_WRITING === true && EXEC_FLAGS.EXIT_ESCALATION_VERIFIED_ON_PAPER === true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
