// npx tsx scripts/chat-trades-cli.ts [parse|chart <id> <out.svg>|ingest [--apply]]
// ingest: dry-run unless --apply (writes via the app getSql/DATABASE_URL path; user_id = CHAT_USER_ID ?? DESK_OWNER_USER_ID). Never prints env.
import fs from "node:fs";
import { parseArmedLog, mergeChatTrades, chatTradeChartSvg, chatSetupPriors, type ChatTrade } from "../src/lib/trading/chat-trades";
const LOG = process.env.ARMED_LOG ?? "/workspace/live-tape/armed-trade.log";
const curated: ChatTrade[] = JSON.parse(fs.readFileSync("data/chat-trades/chat-trades.json", "utf8"));
const all = () => mergeChatTrades(curated, fs.existsSync(LOG) ? parseArmedLog(fs.readFileSync(LOG, "utf8")) : []);
const [cmd, a, b] = process.argv.slice(2);
if (cmd === "parse") { const p = parseArmedLog(fs.readFileSync(LOG, "utf8")); console.log(JSON.stringify(p.map((t) => [t.id, t.qty, t.entry, t.pnl]), null, 0)); console.log(JSON.stringify(chatSetupPriors(all()))); }
else if (cmd === "chart") { const t = all().find((x) => x.id === a)!; const bars = JSON.parse(fs.readFileSync(`data/chat-trades/bars/${t.symbol}-${t.day}-1m.json`, "utf8")); fs.writeFileSync(b, chatTradeChartSvg(t, bars)); console.log(b); }
else if (cmd === "ingest") {
  const owner = process.env.CHAT_USER_ID ?? process.env.DESK_OWNER_USER_ID;
  if (!owner && process.argv.includes("--apply")) { console.error("set CHAT_USER_ID or DESK_OWNER_USER_ID"); process.exit(1); }
  const rows = all().map((t) => ({ id: t.id, user_id: owner, day_key: t.day, setup: t.setup, symbol: t.symbol, side: t.side, contract: t.contract, qty: t.qty, entry: t.entry, pnl: t.pnl, trigger: t.trigger ?? null, body: t }));
  if (!process.argv.includes("--apply")) { console.log(rows.map((r) => `${r.id} ${r.qty}x @${r.entry} pnl ${r.pnl}`).join("\n")); console.log(`dry-run: ${rows.length} rows`); }
  else {
    const { getSql } = await import("../src/lib/db");
    const sql = await getSql();
    for (const r of rows) {
      await sql.query(
        `insert into chat_trades (id, user_id, day_key, setup, symbol, side, contract, qty, entry, pnl, trigger, body)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
         on conflict (id) do update set user_id=excluded.user_id, day_key=excluded.day_key, setup=excluded.setup, symbol=excluded.symbol,
           side=excluded.side, contract=excluded.contract, qty=excluded.qty, entry=excluded.entry, pnl=excluded.pnl, trigger=excluded.trigger, body=excluded.body`,
        [r.id, r.user_id, r.day_key, r.setup, r.symbol, r.side, r.contract, r.qty, r.entry, r.pnl, r.trigger, JSON.stringify(r.body)],
      );
    }
    const chk = await sql.query<{ n: number; pnl: number }>(`select count(*)::int n, coalesce(sum(pnl),0)::float pnl from chat_trades where user_id = $1`, [owner]);
    console.log(`upserted ${rows.length}; table now ${chk[0]?.n} rows, pnl ${chk[0]?.pnl}`);
    process.exit(0);
  }
}
