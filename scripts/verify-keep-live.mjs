/**
 * The background heartbeat (src/lib/live/keep-live.ts) and the loops that ride it.
 *
 *   npx tsx scripts/verify-keep-live.mjs
 *
 * WHY: the quote poll, the desk rebuild, the room's 5 s tick, the paper book's stop manager and auto paper were page timers, and four of them
 * returned early when the Chrome tab was hidden. A trader on another tab got no new quotes or cards and no Stand / stop / 11:00-flat checks
 * until they came back, and Chrome clamps a hidden tab's timers to once a second and then once a minute.
 *
 * This pins: the heartbeat fires on every worker message and stops on unsubscribe; `everyBeats` counts; one worker and one Web Lock no matter
 * how many subscribers; a throwing subscriber does not stop the others; a failed or blocked worker falls back to a 1 s interval exactly once;
 * and that none of the engine loops skips on `document.visibilityState` any more (only the two "refresh when you come back" handlers remain).
 * It cannot prove Chrome's behaviour in a real hidden tab: that is a browser fact, not something a Node test can show.
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

/* ── A browser-shaped world: window, Worker, Web Locks, createObjectURL ──── */
globalThis.window = globalThis;
const workers = [];
let workerMode = "ok"; // "ok" | "throws"
class FakeWorker {
  constructor(url) {
    if (workerMode === "throws") throw new Error("blocked by policy");
    this.url = url;
    this.terminated = false;
    workers.push(this);
  }
  terminate() {
    this.terminated = true;
  }
  beat() {
    this.onmessage?.({ data: 0 });
  }
  fail() {
    this.onerror?.(new Event("error"));
  }
}
globalThis.Worker = FakeWorker;
const blobs = [];
URL.createObjectURL = (b) => {
  blobs.push(b);
  return `blob:fake/${blobs.length}`;
};
const lockCalls = [];
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    locks: {
      request: (name, opts, cb) => {
        lockCalls.push({ name, opts, p: cb() });
        return Promise.resolve();
      },
    },
  },
});
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
const intervals = [];
globalThis.setInterval = (fn, ms) => {
  intervals.push({ fn, ms, cleared: false });
  return intervals.length;
};
globalThis.clearInterval = (id) => {
  if (intervals[id - 1]) intervals[id - 1].cleared = true;
};

const K = await import("../src/lib/live/keep-live.ts");

console.log("the heartbeat");
{
  let a = 0;
  let b = 0;
  const offA = K.onBeat(() => a++);
  K.onBeat(() => b++, 3);
  const w = workers[0];
  check("the first subscriber starts one worker that posts every second", workers.length === 1 && blobs.length === 1);
  const src = await blobs[0].text();
  check("the worker source is a 1000 ms postMessage timer", /setInterval/.test(src) && /postMessage/.test(src) && /1000/.test(src), src);
  w.beat();
  w.beat();
  w.beat();
  check("a subscriber fires on every worker message", a === 3, String(a));
  check("everyBeats counts: the third beat fires it, not the first two", b === 1, String(b));
  w.beat();
  w.beat();
  w.beat();
  check("... and every third after that", b === 2 && a === 6, `${a}/${b}`);
  offA();
  w.beat();
  check("unsubscribing stops it, and leaves the others running", a === 6, String(a));
  K.onBeat(() => {});
  check("more subscribers do not start more workers", workers.length === 1);
  check("one shared Web Lock, held for the life of the page", lockCalls.length === 1 && lockCalls[0].name === "ledger-desk-live" && lockCalls[0].opts.mode === "shared");
  const settled = await Promise.race([lockCalls[0].p.then(() => "released"), new Promise((r) => setTimeout(() => r("held"), 30))]);
  check("the lock callback never settles (that is what holds it)", settled === "held", settled);
  check("no interval is used while a worker is running", intervals.length === 0);
}

console.log("one bad subscriber, a blocked worker");
{
  K.stopKeepLive();
  check("stop terminates the worker and forgets every subscriber", workers[0].terminated === true);
  let after = 0;
  K.onBeat(() => {
    throw new Error("boom");
  });
  K.onBeat(() => after++);
  workers[1].beat();
  check("a throwing subscriber does not stop the next one", after === 1, String(after));

  K.stopKeepLive();
  workerMode = "throws";
  let hits = 0;
  K.onBeat(() => hits++);
  check("a Worker that cannot be made falls back to one 1 s interval", intervals.length === 1 && intervals[0].ms === 1000);
  intervals[0].fn();
  intervals[0].fn();
  check("... and the interval fires the subscribers", hits === 2, String(hits));
  K.onBeat(() => {});
  check("... without starting a second interval", intervals.length === 1);
  K.stopKeepLive();
  check("stop clears that interval", intervals[0].cleared === true);

  workerMode = "ok";
  const before = workers.length;
  let e = 0;
  K.onBeat(() => e++);
  const w = workers[before];
  w.fail();
  check("a worker that errors after it was made is terminated and replaced by the interval, once", w.terminated === true && intervals.length === 2 && intervals[1].ms === 1000);
  w.fail();
  check("a second error does not start a second interval", intervals.length === 2);
  intervals[1].fn();
  check("the fallback interval drives the same subscribers", e === 1, String(e));
  K.stopKeepLive();
}

console.log("the loops that ride it do not skip when the tab is hidden");
{
  const idx = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  const eng = readFileSync(new URL("../src/components/room/room-engine.ts", import.meta.url), "utf8");
  const vis = (idx.match(/visibilityState/g) ?? []).length;
  check("index.tsx keeps exactly two visibilityState reads, both 'refresh when you come back'", vis === 2 && (idx.match(/visibilityState === "visible"\) void (?:load|tick)\(\)/g) ?? []).length === 2, String(vis));
  check("no loop returns on a hidden tab any more (quote poll, room tick, stop manager, auto paper)", !/visibilityState\s*(?:===\s*"hidden"|!==\s*"visible")/.test(idx) && !/visibilityState/.test(eng));
  check("the desk rebuild rides the heartbeat (no setTimeout chain that a hidden tab clamps)", /let nextAt = Date\.now\(\) \+ msUntilNextDeskPoll\(\);[\s\S]{0,400}if \(Date\.now\(\) < nextAt\) return;\s*nextAt = Date\.now\(\) \+ msUntilNextDeskPoll\(\);\s*void load\(\);/.test(idx) && !/id = window\.setTimeout\(\(\) => \{\s*if \(document/.test(idx));
  check("the quote poll also rides it, beside its own timer, and cleans both up", /const offBeat = onBeat\(\(\) => \{\s*if \(!cancelled && !inFlight && Date\.now\(\) - lastStartAt >= delay\) void tick\(\);/.test(idx) && /offBeat\(\);\s*document\.removeEventListener\("visibilitychange", onVis\);\s*\};\s*\/\/ Start once a desk exists/.test(idx));
  check("the paper stop manager runs every 3 beats", /return onBeat\(\(\) => \{\s*const d = deskRef\.current;\s*if \(!d\) return;\s*if \(!listOpenPaperTrades\(\)\.length\) return;/.test(idx) && /\}, 3\);/.test(idx));
  check("the room's live tick runs every 5 beats, and liveTick still runs on every desk update", /return onBeat\(\(\) => \{[\s\S]*?liveTick\(d\);[\s\S]*?\}, 5\);/.test(eng) && /liveTick\(desk\);/.test(eng));
  check("the room engine is mounted once at the shell, so a different desk tab does not pause it", /useRoomEngine\(desk\);/.test(idx) && (idx.match(/useRoomEngine\(/g) ?? []).length === 1 /* one call, at the shell, not inside a tab */);
  check("auto paper no longer returns on a hidden tab", !/const tryAuto = \(\) => \{\s*if \(typeof document/.test(idx));
}

globalThis.setInterval = realSetInterval;
globalThis.clearInterval = realClearInterval;
console.log(`\nkeep-live: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
