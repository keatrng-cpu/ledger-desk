/**
 * Trade-log audit: the desk's Supabase record vs the desk-watcher's own logs. READ ONLY.
 *
 *   npx tsx scripts/audit/trade-log-audit.mts --watcher-dir /workspace/desk-watcher \
 *       [--supabase-json export.json | (DATABASE_URL / SUPABASE_DB_URL set)] [--out report.md]
 *
 * Sources
 *  - Supabase (existing tables only): desk_card_journal (cards), desk_trades (fills recorded by the desk),
 *    room_orders (orders the floor carried to a broker), desk_watcher_status (last watcher heartbeat + rules hash).
 *    With a DB URL it opens ONE connection inside `BEGIN READ ONLY` and only runs SELECTs. With --supabase-json
 *    it reads an export of the same shape (how the 10-16 run was done, via the Supabase MCP read-only SQL).
 *  - Watcher: watcher.log / alerts.log JSONL (DESK = a card the watcher saw, FIRE / PLACED / FILLED / EXIT,
 *    fire_refused_desk, REJECT), plus status.json.
 *
 * Gaps reported
 *  1. watcher FIRE with no journal card (same ET day, symbol, side, entry within tolerance, opened <= 4 h before the fire)
 *  2. watcher FILLED with no desk_trades / room_orders row
 *  3. journal card marked filled with no broker fill in the watcher (paper fill only)
 *  4. trading days present in one source and absent in the other
 *  5. journal cards with no signal id (cannot be joined to the watcher)
 *  6. rules hash: watcher vs desk RULES_HASH; watcher heartbeat age
 * It never prints a connection string, key, token or full account number (output is scrubbed).
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { scrubText } from "../../src/lib/notify/scrub.ts";

export type JournalCard = { id: string; day_key: string; symbol: string; side: string; band: string; q?: number; entry: number; stop: number; target: number; opened_ms: number; filled: boolean; status: string; signal?: string | null };
export type DbTrade = { id?: string | number; symbol?: string; side?: string; filled_at?: string | null; opened_at?: string | null; plan_entry?: number | null; entry?: number | null; reason?: string | null; why?: string | null };
export type DbOrder = { client_order_id?: string; broker_order_id?: string | null; symbol: string; side: string; status: string; filled_qty?: number; phase?: string; at_ms: number };
export type SupabaseSnapshot = { cards: JournalCard[]; trades: DbTrade[]; orders: DbOrder[]; watcher_status_ms: number | null; watcher_rules: string | null };

export type WFire = { ts: string; day: string; symbol: string; side: string; band: string; entry: number; stop: number; target: number; signal?: string };
/** symbol/side/entry are the FIRE this fill belongs to (the underlier card), orderId the broker (RH) order id. */
export type WFill = { ts: string; day: string; qty: number; price: number; signal?: string; orderId?: string; symbol?: string; side?: string; entry?: number };
type LogRec = { ts?: unknown; kind?: unknown; text?: unknown; signal?: string; result?: { id?: unknown } | null };
export type WatcherSnapshot = { deskCards: { day: string; signal: string; symbol: string; side: string; band: string }[]; fires: WFire[]; fills: WFill[]; rejects: { ts: string; day: string; text: string }[]; refused: number; days: string[]; statusRules: string | null; heartbeat: number | null };

const etDay = (ts: string) => ts.slice(0, 10); // watcher stamps ISO with the ET offset, so the date part IS the ET day

export function parseWatcherLines(lines: string[]): Omit<WatcherSnapshot, "statusRules" | "heartbeat"> {
  const deskCards = new Map<string, WatcherSnapshot["deskCards"][number]>();
  const fires: WFire[] = [], fills: WFill[] = [], rejects: WatcherSnapshot["rejects"] = [];
  const days = new Set<string>(); const seenAlert = new Set<string>();
  let refused = 0, lastPlacedKey: string | undefined, lastOrderId: string | undefined, lastFire: WFire | undefined;
  for (const l of lines) {
    let d: LogRec;
    try { d = JSON.parse(l) as LogRec; } catch { continue; }
    if (!d || typeof d !== "object") continue;
    if (typeof d.ts !== "string") continue;
    const day = etDay(d.ts);
    if (d.kind === "fire_refused_desk") { refused++; days.add(day); continue; }
    if (d.kind !== "alert" || typeof d.text !== "string") continue;
    const dupKey = `${d.ts}|${d.text}`; if (seenAlert.has(dupKey)) continue; seenAlert.add(dupKey); // alerts.log mirrors watcher.log
    days.add(day);
    const t: string = d.text;
    const rid = typeof d.result?.id === "string" ? d.result.id : undefined;
    let m: RegExpMatchArray | null;
    if (t.startsWith("DESK ") && d.signal) {
      m = t.match(/^DESK (\S+) (\S+) (long|short)/);
      if (m && !deskCards.has(`${day}|${d.signal}`)) deskCards.set(`${day}|${d.signal}`, { day, signal: d.signal, band: m[1], symbol: m[2], side: m[3] });
    } else if ((m = t.match(/^FIRE (\S+) (\S+) (long|short).*?entry=([\d.]+) stop=([\d.]+) tgt=([\d.]+)/))) {
      lastFire = { ts: d.ts, day, band: m[1], symbol: m[2], side: m[3], entry: +m[4], stop: +m[5], target: +m[6], signal: d.signal };
      fires.push(lastFire); // the watcher logs PLACED (with the RH order) just BEFORE FIRE, so the order id is not reset here
    } else if ((m = t.match(/^PLACED .*key=(sig-[0-9a-f]+)/))) {
      lastPlacedKey = m[1]; if (rid) lastOrderId = rid;
      const f = fires[fires.length - 1]; if (f && !f.signal) f.signal = m[1];
    } else if ((m = t.match(/^FILLED (\d+) @ ([\d.]+)/))) {
      fills.push({ ts: d.ts, day, qty: +m[1], price: +m[2], signal: d.signal ?? lastPlacedKey, orderId: rid ?? lastOrderId, symbol: lastFire?.symbol, side: lastFire?.side, entry: lastFire?.entry });
      lastOrderId = undefined; // EXIT carries the closing (sell) order id, never the entry's
    } else if (/^(REJECT|ORDER REJECTED|CANCEL)/i.test(t)) {
      rejects.push({ ts: d.ts, day, text: t.slice(0, 160) });
    }
  }
  return { deskCards: [...deskCards.values()], fires, fills, rejects, refused, days: [...days].sort() };
}

export type Finding = { level: "GAP" | "WARN" | "INFO"; what: string };

/** Fill → Supabase row. 1) by id: room_orders.client_order_id = signal or broker_order_id = RH order id; desk_trades id/reason/why
 *  carrying either id. 2) fallback: same ET day + symbol + side (+ entry within tolerance for desk_trades). */
export function matchFill(f: WFill, db: SupabaseSnapshot, tolPct = 0.0005): { how: "id" | "fallback" | "none"; table?: "room_orders" | "desk_trades" } {
  const ids = [f.signal, f.orderId].filter((x): x is string => Boolean(x));
  if (ids.length) {
    if (db.orders.some((o) => ids.includes(o.client_order_id ?? "") || ids.includes(o.broker_order_id ?? ""))) return { how: "id", table: "room_orders" };
    if (db.trades.some((t) => ids.some((id) => String(t.id ?? "") === id || `${t.reason ?? ""} ${t.why ?? ""}`.includes(id)))) return { how: "id", table: "desk_trades" };
  }
  const etDayOf = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso)) : "");
  const PROXY: Record<string, string> = { ES: "SPY", MNQ: "QQQ" }; // the watcher trades the ETF option for the futures card
  const symOk = (sym?: string) => !f.symbol || !sym || sym === f.symbol || PROXY[f.symbol] === sym;
  const sideOk = (sd?: string) => !f.side || !sd || sd === f.side || sd === "buy"; // an option entry is a buy either way
  const sameSide = (sym?: string, sd?: string) => symOk(sym) && sideOk(sd);
  if (db.orders.some((o) => (o.filled_qty ?? 0) > 0 && etDayOf(new Date(o.at_ms).toISOString()) === f.day && sameSide(o.symbol, o.side))) return { how: "fallback", table: "room_orders" };
  const near = (a?: number | null) => f.entry == null || a == null || Math.abs(a - f.entry) <= Math.max(0.5, Math.abs(f.entry) * tolPct);
  if (db.trades.some((t) => etDayOf(t.filled_at ?? t.opened_at) === f.day && sameSide(t.symbol, t.side) && near(t.plan_entry ?? t.entry))) return { how: "fallback", table: "desk_trades" };
  return { how: "none" };
}

export function audit(db: SupabaseSnapshot, w: WatcherSnapshot, deskRulesHash: string, nowMs: number, tolPct = 0.0005): Finding[] {
  const out: Finding[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * tolPct);
  for (const f of w.fires) {
    const fMs = Date.parse(f.ts);
    // Same card = same ET day/symbol/side, entry within tolerance, opened before the fire (5 min clock slack) and at most 4 h before it.
    const hit = db.cards.find((c) => c.day_key === f.day && c.symbol === f.symbol && c.side === f.side && near(c.entry, f.entry) && c.opened_ms <= fMs + 300_000 && fMs - c.opened_ms <= 4 * 3600_000);
    if (!hit) out.push({ level: "GAP", what: `watcher FIRE ${f.band} ${f.symbol} ${f.side} entry ${f.entry} stop ${f.stop} T1 ${f.target} (${f.ts}, ${f.signal ?? "no signal"}) has no desk_card_journal card` });
  }
  for (const f of w.fills) {
    const m = matchFill(f, db);
    if (m.how === "none") out.push({ level: "GAP", what: `watcher FILLED ${f.qty} @ ${f.price} (${f.ts}, ${f.signal ?? "?"}${f.orderId ? `, RH order ${f.orderId}` : ""}) has no desk_trades or room_orders row (by id or by day/symbol/side/entry)` });
    else if (m.how === "fallback") out.push({ level: "WARN", what: `watcher FILLED ${f.qty} @ ${f.price} (${f.ts}) matched ${m.table} only by day/symbol/side/entry, not by id` });
  }
  for (const r of w.rejects) out.push({ level: "WARN", what: `watcher order reject ${r.ts}: ${r.text}` });
  const paper = db.cards.filter((c) => c.filled);
  const brokerDays = new Set(w.fills.map((f) => f.day));
  const paperNoBroker = paper.filter((c) => !brokerDays.has(c.day_key));
  if (paper.length) out.push({ level: paperNoBroker.length ? "WARN" : "INFO", what: `${paper.length} journal cards are filled=true; ${paper.length - paperNoBroker.length} fall on a day with a broker fill, ${paperNoBroker.length} are paper fills only (journal "filled" = price touched entry, not a broker fill)` });
  const cardDays = new Set(db.cards.map((c) => c.day_key));
  for (const d of w.days) if (!cardDays.has(d)) out.push({ level: "GAP", what: `watcher active on ${d} but desk_card_journal has no card that day` });
  for (const d of cardDays) if (!w.days.includes(d)) out.push({ level: "GAP", what: `desk_card_journal has cards on ${d} but the watcher logged nothing that day` });
  for (const d of [...cardDays].sort()) {
    const j = db.cards.filter((c) => c.day_key === d).length, wc = w.deskCards.filter((c) => c.day === d).length;
    out.push({ level: "INFO", what: `${d}: journal cards ${j}, distinct watcher DESK cards ${wc}, watcher fires ${w.fires.filter((f) => f.day === d).length}, fills ${w.fills.filter((f) => f.day === d).length}` });
  }
  const noSig = db.cards.filter((c) => !c.signal).length;
  if (noSig) out.push({ level: "WARN", what: `${noSig}/${db.cards.length} journal cards carry no signal id in context, so cards join to the watcher only by day/symbol/side/entry` });
  if (!db.trades.length && !db.orders.length) out.push({ level: "WARN", what: "desk_trades and room_orders are both empty: no fill has ever been recorded in Supabase" });
  const wr = w.statusRules ?? db.watcher_rules;
  if (wr && wr !== deskRulesHash) out.push({ level: "GAP", what: `rules hash mismatch: watcher ${wr} vs desk main RULES_HASH ${deskRulesHash}` });
  const hb = w.heartbeat ? w.heartbeat * 1000 : db.watcher_status_ms;
  if (hb) { const age = (nowMs - hb) / 1000; out.push({ level: age > 600 ? "WARN" : "INFO", what: `watcher last heartbeat ${new Date(hb).toISOString()} (${Math.round(age / 60)} min before this audit); Supabase desk_watcher_status received ${db.watcher_status_ms ? new Date(db.watcher_status_ms).toISOString() : "never"}` }); }
  return out;
}

export function renderReport(f: Finding[], meta: Record<string, string>): string {
  const lines = ["# Trade-log audit — Supabase vs desk-watcher", "", ...Object.entries(meta).map(([k, v]) => `- **${k}:** ${v}`), ""];
  for (const lvl of ["GAP", "WARN", "INFO"] as const) {
    const xs = f.filter((x) => x.level === lvl);
    lines.push(`## ${lvl} (${xs.length})`, "", ...(xs.length ? xs.map((x) => `- ${x.what}`) : ["- none"]), "");
  }
  return scrubText(lines.join("\n"));
}

function readLines(p: string): string[] { return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean) : []; }

/**
 * TLS for the audit connection is VERIFIED by default. Supabase's Postgres certs chain to Supabase's own root CA, not a public
 * one, so pass it: --ca <prod-ca-2021.crt> or env SUPABASE_CA_CERT (Dashboard → Database → SSL Configuration → Download certificate).
 * Without a CA file verification uses the system store, which fails against Supabase with SELF_SIGNED_CERT_IN_CHAIN; the only way
 * past that is the explicit --insecure-tls flag (encrypted, unverified), which the report header then says.
 */
export function auditTls(args: Record<string, string>, env: Record<string, string | undefined> = process.env): { rejectUnauthorized: boolean; ca?: string } {
  const caPath = args.ca || env.SUPABASE_CA_CERT;
  if (caPath) return { rejectUnauthorized: true, ca: readFileSync(caPath, "utf8") };
  return { rejectUnauthorized: !args["insecure-tls"] };
}

async function loadDb(args: Record<string, string>): Promise<SupabaseSnapshot> {
  if (args["supabase-json"]) {
    const j = JSON.parse(readFileSync(args["supabase-json"], "utf8"));
    return { cards: j.cards ?? [], trades: j.trades ?? [], orders: j.orders ?? [], watcher_status_ms: j.watcher_status_ms ?? null, watcher_rules: j.watcher_rules ?? null };
  }
  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("no --supabase-json and no SUPABASE_DB_URL / DATABASE_URL / POSTGRES_URL");
  const pg = (await import("pg")).default;
  const c = new pg.Client({ connectionString: url, ssl: auditTls(args) });
  await c.connect();
  try {
    await c.query("begin read only");
    const cards = (await c.query("select id, day_key, symbol, side, band, q, entry, stop, target, opened_ms::float8 as opened_ms, filled, status, context->>'signal' as signal from desk_card_journal order by opened_ms")).rows;
    const trades = (await c.query("select id::text as id, symbol, side, filled_at::text as filled_at, opened_at::text as opened_at, plan_entry, entry, reason, why from desk_trades")).rows;
    const orders = (await c.query("select client_order_id, broker_order_id, symbol, side, status, filled_qty, phase, at_ms::float8 as at_ms from room_orders")).rows;
    const ws = (await c.query("select received_ms::float8 as ms, body->>'rules_hash' as rh from desk_watcher_status where id = 1")).rows[0];
    await c.query("rollback");
    return { cards, trades, orders, watcher_status_ms: ws?.ms ?? null, watcher_rules: ws?.rh ?? null };
  } finally { await c.end(); }
}

async function main() {
  const argv = process.argv.slice(2); const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") ? "1" : argv[++i];
  const wdir = args["watcher-dir"] ?? "/workspace/desk-watcher";
  const parsed = parseWatcherLines([...readLines(join(wdir, "watcher.log")), ...readLines(join(wdir, "alerts.log"))]);
  let status: { rules_hash?: string | null; heartbeat?: unknown } = {};
  try { status = JSON.parse(readFileSync(join(wdir, "status.json"), "utf8")); } catch { /* optional */ }
  const w: WatcherSnapshot = { ...parsed, statusRules: status.rules_hash ?? null, heartbeat: typeof status.heartbeat === "number" ? status.heartbeat : null };
  const db = await loadDb(args);
  const { RULES_HASH } = await import("../../src/lib/desk/rules-hash.ts");
  const findings = audit(db, w, RULES_HASH, Date.now());
  const md = renderReport(findings, {
    generated: new Date().toISOString(),
    "supabase source": args["supabase-json"] ? "read-only export (--supabase-json)" : `read-only transaction, TLS ${args["insecure-tls"] && !(args.ca || process.env.SUPABASE_CA_CERT) ? "UNVERIFIED (--insecure-tls)" : "verified"}`,
    "watcher dir": wdir,
    counts: `journal cards ${db.cards.length}, desk_trades ${db.trades.length}, room_orders ${db.orders.length}; watcher DESK cards ${w.deskCards.length}, fires ${w.fires.length}, fills ${w.fills.length}, rejects ${w.rejects.length}, fire_refused_desk ${w.refused}`,
  });
  if (args.out) { mkdirSync(dirname(args.out), { recursive: true }); writeFileSync(args.out, md); }
  console.log(md);
  if (findings.some((f) => f.level === "GAP")) process.exitCode = 2;
}

if (process.argv[1] && /trade-log-audit\.mts$/.test(process.argv[1])) main().catch((e) => { console.error(scrubText(String(e?.message ?? e))); process.exit(1); });
