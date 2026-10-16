// Connectors (10-16): Slack notifier, Sentry scrub/no-op, 8:20 CT pre-open check, trade-log audit. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const n = await import("../src/lib/notify/desk-alert.ts");
const sc = await import("../src/lib/notify/scrub.ts");
const se = await import("../src/lib/notify/sentry.ts");
const po = await import("../src/lib/notify/preopen.ts");
const au = await import("./audit/trade-log-audit.mts");
const h = await import("../src/lib/desk/rules-hash.ts");

const FIRE = { type: "card_fire", symbol: "ES", grade: "A", side: "long", entry: 7782.63, stop: 7775, t1: 7792.25, signal: "sig-1" };
function mk(o = {}) {
  const sent = []; let t = 1_000_000;
  const notifier = n.createNotifier({ webhookUrl: "https://hooks.slack.com/services/T/B/x", fetch: async (_u, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200 }; }, now: () => t, ...o });
  return { notifier, sent, tick: (ms) => (t += ms) };
}

test("notify: no-op when SLACK_DESK_WEBHOOK_URL unset", async () => {
  let called = false;
  const x = n.createNotifier({ webhookUrl: undefined, fetch: async () => { called = true; return { ok: true, status: 200 }; } });
  assert.equal(x.enabled, false);
  assert.deepEqual(await x.notify(FIRE), { sent: false, why: "disabled" });
  assert.equal(called, false);
});

test("notify: formats every event type", () => {
  assert.equal(n.formatEvent(FIRE), ":rotating_light: FIRE A ES long · entry 7782.63 · stop 7775 · T1 7792.25");
  const all = [
    { ...FIRE, type: "card_arm" }, { type: "order_filled", symbol: "SPY", qty: 1, price: 2.96 }, { type: "order_rejected", symbol: "SPY", reason: "bp" },
    { type: "daily_stop", pnl: -300, limit: -250 }, { type: "weekly_lock", pnl: 900 }, { type: "preopen_check", ok: false, day: "2026-10-16", failures: ["stale"] },
    { type: "watcher_down", heartbeatAgeS: 400 }, { type: "rules_hash_mismatch", expected: "a", got: "b" }, { type: "rule1_shadow", symbol: "MNQ", side: "long", entry: 1, stop: 0.5 },
  ];
  for (const e of all) { assert.ok(n.formatEvent(e).length > 5, e.type); assert.ok(n.eventKey(e)); }
});

test("notify: dedupe inside the window, resend after it", async () => {
  const { notifier, sent, tick } = mk();
  assert.equal((await notifier.notify(FIRE)).sent, true);
  assert.deepEqual(await notifier.notify(FIRE), { sent: false, why: "duplicate" });
  tick(n.DEDUPE_MS + 1);
  assert.equal((await notifier.notify(FIRE)).sent, true);
  assert.equal(sent.length, 2);
});

test("notify: rate limit drops overflow and reports the count", async () => {
  const { notifier, sent, tick } = mk({ rateMax: 2, rateWindowMs: 60_000 });
  for (let i = 0; i < 5; i++) await notifier.notify({ ...FIRE, signal: `s${i}` });
  assert.equal(sent.length, 2);
  tick(61_000);
  await notifier.notify({ ...FIRE, signal: "s9" });
  assert.match(sent.at(-1).text, /\+3 suppressed/);
});

test("notify: slack failure is swallowed", async () => {
  const x = n.createNotifier({ webhookUrl: "https://hooks.slack.com/x", fetch: async () => { throw new Error("down"); } });
  assert.deepEqual(await x.notify(FIRE), { sent: false, why: "error" });
});

test("scrub: keys, tokens, URLs and account numbers never leave; prices stay", () => {
  const env = { DATABENTO_API_KEY: "db-ABCDEFGHIJKLMNOPQRSTUVWXYZ", SUPABASE_SERVICE_ROLE_KEY: "supersecretservicerole", RH_PASSWORD: "hunter2hunter2" };
  const s = sc.scrubText("acct 995386158 db-ABCDEFGHIJKLMNOPQRSTUVWXYZ supersecretservicerole hunter2hunter2 Bearer abcdefghijkl https://hooks.slack.com/services/a/b/c postgres://u:p@h/db token=zzzzzz eyJhbGciOiJIUzI1.eyJyb2xlIjoic2Vy.c2lnbmF0dXJl entry 7782.63", env);
  for (const bad of ["995386158", "db-ABC", "supersecret", "hunter2", "abcdefghijkl", "hooks.slack", "postgres://", "zzzzzz", "eyJhbG"]) assert.ok(!s.includes(bad), bad);
  assert.ok(s.includes("7782.63"));
  const v = sc.scrubValue({ account_number: "995386158", nested: { SUPABASE_KEY: "x", msg: "ok" } }, env);
  assert.equal(v.account_number, "[redacted]"); assert.equal(v.nested.SUPABASE_KEY, "[redacted]"); assert.equal(v.nested.msg, "ok");
});

test("sentry: no-op without SENTRY_DSN; scrubs events when on", async () => {
  delete process.env.SENTRY_DSN; se._resetSentryForTest();
  let loaded = false;
  assert.equal(await se.initSentry(async () => { loaded = true; return {}; }), false);
  assert.equal(loaded, false);
  await se.captureError(new Error("x")); // must not throw
  process.env.SENTRY_DSN = "https://pub@o1.ingest.sentry.io/1"; se._resetSentryForTest();
  let opts; const caught = [];
  const fake = { init: (o) => { opts = o; }, captureException: (e) => { caught.push(e); return "id"; }, flush: async () => true };
  assert.equal(await se.initSentry(async () => fake), true);
  assert.equal(opts.sendDefaultPii, false);
  const ev = opts.beforeSend({ message: "acct 995386158", request: { headers: { authorization: "Bearer zzzzzzzzzz" }, cookies: "c" }, extra: { DATABENTO_API_KEY: "k" } });
  assert.ok(!JSON.stringify(ev).includes("995386158")); assert.equal(ev.request.headers, undefined); assert.equal(ev.extra.DATABENTO_API_KEY, "[redacted]");
  await se.captureError(new Error("boom"));
  assert.equal(caught.length, 1);
  delete process.env.SENTRY_DSN; se._resetSentryForTest();
});

test("preopen: 08:20 CT slot across DST, pass/fail verdicts", () => {
  assert.equal(po.isPreopenSlot(Date.parse("2026-10-16T13:20:00Z")), true);  // CDT
  assert.equal(po.isPreopenSlot(Date.parse("2026-10-16T14:20:00Z")), false);
  assert.equal(po.isPreopenSlot(Date.parse("2026-12-15T14:20:00Z")), true);  // CST
  assert.equal(po.isPreopenSlot(Date.parse("2026-10-17T13:20:00Z")), false); // Saturday
  const now = Date.parse("2026-10-16T13:20:00Z");
  const good = po.evaluatePreopen({ ok: true, status: { rules_hash: "h1" }, heartbeatAgeS: 5 }, "h1", now);
  assert.equal(good.ok, true); assert.deepEqual(good.events.map((e) => e.type), ["preopen_check"]);
  const bad = po.evaluatePreopen({ ok: true, status: { rules_hash: "h2" }, heartbeatAgeS: 900 }, "h1", now);
  assert.equal(bad.ok, false); assert.deepEqual(bad.events.map((e) => e.type), ["watcher_down", "rules_hash_mismatch", "preopen_check"]);
  assert.equal(po.evaluatePreopen(null, "h1", now).ok, false);
});

test("audit: finds fire/fill/day/hash gaps from fixture logs", () => {
  const lines = [
    { ts: "2026-10-15T14:02:04-04:00", kind: "alert", text: "FIRE B+ ES long q=0.6499 entry=7782.63 stop=7775.0 tgt=7792.25 rr=1.26" },
    { ts: "2026-10-15T14:02:04-04:00", kind: "alert", text: "PLACED 1x SPY @ 2.98 key=sig-85e8feddd99efe46 stop=7775.0" },
    { ts: "2026-10-15T14:02:10-04:00", kind: "alert", text: "FILLED 1 @ 2.96 (filled)" },
    { ts: "2026-10-15T14:02:10-04:00", kind: "alert", text: "FILLED 1 @ 2.96 (filled)" }, // alerts.log mirror: counted once
    { ts: "2026-10-16T09:00:00-04:00", kind: "alert", text: "DESK A MNQ short q=0.7", signal: "sig-x" },
  ].map((x) => JSON.stringify(x));
  const w = { ...au.parseWatcherLines([...lines, "not json"]), statusRules: "647c5ff4b8c3454c", heartbeat: null };
  assert.equal(w.fires.length, 1); assert.equal(w.fills.length, 1); assert.equal(w.fills[0].signal, "sig-85e8feddd99efe46");
  const db = { cards: [{ id: "c", day_key: "2026-10-15", symbol: "ES", side: "long", band: "A", entry: 7786.88, stop: 7780, target: 7800, opened_ms: 0, filled: true, status: "loss" },
                       { id: "d", day_key: "2026-10-14", symbol: "ES", side: "long", band: "A", entry: 1, stop: 0, target: 2, opened_ms: 0, filled: true, status: "loss" }], trades: [], orders: [], watcher_status_ms: null, watcher_rules: null };
  const f = au.audit(db, w, "a4bfcb65c88badcd", Date.now());
  const gaps = f.filter((x) => x.level === "GAP").map((x) => x.what).join("\n");
  assert.match(gaps, /FIRE B\+ ES long entry 7782.63.*no desk_card_journal card/);
  assert.match(gaps, /FILLED 1 @ 2.96.*no desk_trades or room_orders row/);
  assert.match(gaps, /watcher active on 2026-10-16/);
  assert.match(gaps, /cards on 2026-10-14 but the watcher logged nothing/);
  assert.match(gaps, /rules hash mismatch/);
  const md = au.renderReport(f, { note: "acct 995386158" });
  assert.ok(!md.includes("995386158"));
});

test("desk-rules hash unchanged", () => assert.equal(h.RULES_HASH, "a4bfcb65c88badcd"));
