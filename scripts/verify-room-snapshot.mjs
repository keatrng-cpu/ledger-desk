/**
 * The room backup (migrations/0017_room_snapshot.sql, src/lib/room/snapshot.ts)
 * against its contract.
 *
 *   npx tsx scripts/verify-room-snapshot.mjs
 *
 * The rank only grows with fills and ghosts; the richer copy wins; malformed
 * bodies are refused; and the EXACT upsert statement the server runs, on
 * PGLite with the real migration: a poorer copy never overwrites a richer
 * one, equal rank writes (marks), a reset (force) replaces anything. And
 * when the browser pushes (mayPush / afterPush): a book the server already
 * answered is not re-sent until it changes, and signed out it retries every
 * 10 minutes, not every minute.
 */
import { readFileSync } from "node:fs";
const S = await import("../src/lib/room/snapshot.ts");
const { playDrill } = await import("../src/lib/room/drill.ts");
const { emptyBook } = await import("../src/lib/room/paper-book.ts");
const { PGlite } = await import("@electric-sql/pglite");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

console.log("rank");
const steps = playDrill();
const ranks = steps.map((s) => S.rankOf(s.book));
check("an empty book has no history", S.rankOf(emptyBook()).history === 0);
check("history never falls through the drill day", ranks.every((r, i) => i === 0 || r.history >= ranks[i - 1].history), JSON.stringify(ranks.map((r) => r.history)));
check("the drill day ends richer than it started", S.richer(ranks[ranks.length - 1], ranks[0]));
check("richer is strict (a copy is not richer than itself)", !S.richer(ranks[ranks.length - 1], ranks[ranks.length - 1]));

console.log("shape");
const book = steps[steps.length - 1].book;
const minds = steps[steps.length - 1].minds;
check("a real end-of-day snapshot passes", S.isSnapshot({ version: 1, book, minds }));
check("so does one without memory", S.isSnapshot({ version: 1, book, minds: null }));
check("a wrong version is refused", !S.isSnapshot({ version: 2, book, minds }));
check("a book without positions is refused", !S.isSnapshot({ version: 1, book: { ...book, positions: undefined }, minds }));
check("non-finite cash is refused", !S.isSnapshot({ version: 1, book: { ...book, cash: Number.NaN }, minds }));
check("the end-of-day snapshot is far under the size cap", JSON.stringify({ version: 1, book, minds }).length < S.MAX_SNAPSHOT_BYTES / 10);

console.log("the upsert, on PGLite with the real migration");
const db = new PGlite();
await db.exec(readFileSync(new URL("../migrations/0017_room_snapshot.sql", import.meta.url), "utf8"));
const put = async (h, at, force, tag) => (await db.query(S.SNAPSHOT_UPSERT_SQL, ["u1", JSON.stringify({ tag }), h, at, force])).rows.length === 1;
const tagNow = async () => (await db.query("select body from room_snapshot where user_id = 'u1'")).rows[0]?.body?.tag;
check("the first copy is saved", await put(5, 100, false, "a"));
check("a richer copy overwrites", (await put(7, 120, false, "b")) && (await tagNow()) === "b");
check("a poorer copy is refused and the richer one stays", !(await put(2, 999, false, "c")) && (await tagNow()) === "b");
check("same history, newer activity overwrites", await put(7, 130, false, "d"));
check("same rank overwrites (marks moved, nothing closed)", await put(7, 130, false, "e"));
check("same history, older activity is refused", !(await put(7, 110, false, "f")) && (await tagNow()) === "e");
check("a reset (force) replaces a richer copy", (await put(0, 0, true, "reset")) && (await tagNow()) === "reset");
check("another trader's row is untouched", (await db.query(S.SNAPSHOT_UPSERT_SQL, ["u2", "{}", 1, 1, false])).rows.length === 1 && (await tagNow()) === "reset");
await db.close();

console.log("when the browser pushes");
const MIN = 60_000;
const sent = (m, ms) => ({ ...m, lastMs: ms });
let m = S.freshPushMemory();
check("a fresh page pushes on its first cycle", S.mayPush(m, "k1", Date.now()));
m = S.afterPush(sent(m, 0), "k1", "saved");
check("a saved book is not re-sent", !S.mayPush(m, "k1", 60 * MIN));
check("a changed book waits out the minute, then goes", !S.mayPush(m, "k2", MIN - 1) && S.mayPush(m, "k2", MIN));
m = S.afterPush(sent(m, MIN), "k2", "refused");
check("a book the server refused as poorer is not re-sent every minute", !S.mayPush(m, "k2", 60 * MIN));
check("…its next change is", S.mayPush(m, "k3", 2 * MIN));
m = S.afterPush(sent(m, 2 * MIN), "k3", "signed_out");
check("signed out: nothing for 10 minutes, even when the book changes", !S.mayPush(m, "k4", 2 * MIN + 10 * MIN - 1));
check("signed out: the same book is tried again after 10 minutes (a sign-in without a reload)", S.mayPush(m, "k3", 12 * MIN));
m = S.afterPush(sent(m, 12 * MIN), "k3", "failed");
check("a network or database failure retries the same book after a minute", !S.mayPush(m, "k3", 13 * MIN - 1) && S.mayPush(m, "k3", 13 * MIN));
m = S.afterPush(sent(m, 13 * MIN), "k3", "saved");
check("a save after a failure settles the book and restores the minute gap", !S.mayPush(m, "k3", 99 * MIN) && S.mayPush(m, "k4", 14 * MIN));

console.log(`\nroom-snapshot: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
