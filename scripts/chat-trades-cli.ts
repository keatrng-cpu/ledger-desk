// npx tsx scripts/chat-trades-cli.ts [parse|chart <id> <out.svg>|ingest [--apply]]
// ingest: dry-run unless --apply (needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CHAT_USER_ID). Never prints env.
import fs from "node:fs";
import { parseArmedLog, mergeChatTrades, chatTradeChartSvg, chatSetupPriors, type ChatTrade } from "../src/lib/trading/chat-trades";
const LOG = process.env.ARMED_LOG ?? "/workspace/live-tape/armed-trade.log";
const curated: ChatTrade[] = JSON.parse(fs.readFileSync("data/chat-trades/chat-trades.json", "utf8"));
const all = () => mergeChatTrades(curated, fs.existsSync(LOG) ? parseArmedLog(fs.readFileSync(LOG, "utf8")) : []);
const [cmd, a, b] = process.argv.slice(2);
if (cmd === "parse") { const p = parseArmedLog(fs.readFileSync(LOG, "utf8")); console.log(JSON.stringify(p.map((t) => [t.id, t.qty, t.entry, t.pnl]), null, 0)); console.log(JSON.stringify(chatSetupPriors(all()))); }
else if (cmd === "chart") { const t = all().find((x) => x.id === a)!; const bars = JSON.parse(fs.readFileSync(`data/chat-trades/bars/${t.symbol}-${t.day}-1m.json`, "utf8")); fs.writeFileSync(b, chatTradeChartSvg(t, bars)); console.log(b); }
else if (cmd === "ingest") {
  const rows = all().map((t) => ({ id: t.id, user_id: process.env.CHAT_USER_ID ?? "keat", day_key: t.day, setup: t.setup, symbol: t.symbol, side: t.side, contract: t.contract, qty: t.qty, entry: t.entry, pnl: t.pnl, trigger: t.trigger ?? null, body: t }));
  if (!process.argv.includes("--apply")) { console.log(rows.map((r) => `${r.id} ${r.qty}x @${r.entry} pnl ${r.pnl}`).join("\n")); console.log(`dry-run: ${rows.length} rows`); }
  else { const { createClient } = await import("@supabase/supabase-js"); const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { error } = await db.from("chat_trades").upsert(rows, { onConflict: "id" }); if (error) { console.error(error.message); process.exit(1); } console.log(`upserted ${rows.length}`); }
}
