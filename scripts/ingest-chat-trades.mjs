// Upsert data/chat-trades/chat-trades.json into chat_trades. Dry-run unless --apply.
// Usage: node scripts/ingest-chat-trades.mjs [--apply] (needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CHAT_USER_ID)
import fs from "node:fs";
const rows = JSON.parse(fs.readFileSync(new URL("../data/chat-trades/chat-trades.json", import.meta.url)));
const out = rows.map(t => ({ id: t.id, user_id: process.env.CHAT_USER_ID ?? "keat", day_key: t.day, setup: t.setup,
  symbol: t.symbol, side: t.side, contract: t.contract, qty: t.qty, entry: t.entry, pnl: t.pnl, trigger: t.trigger, body: t }));
if (!process.argv.includes("--apply")) { console.log(JSON.stringify(out, null, 1)); console.log(`dry-run: ${out.length} rows`); process.exit(0); }
const { createClient } = await import("@supabase/supabase-js");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { error } = await db.from("chat_trades").upsert(out, { onConflict: "id" });
if (error) { console.error(error.message); process.exit(1); }
console.log(`upserted ${out.length}`);
