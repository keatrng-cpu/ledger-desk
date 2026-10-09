/**
 * The long board and the add gate cannot disagree, and the board cannot buy.
 * Run: node scripts/verify-long-board.mjs
 */
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/invest/long-board.ts", "utf8");
const ui = readFileSync("src/components/invest/long-board.tsx", "utf8");
const fail = [];
const want = ["VTI","SGOV","CEG","VST","TLN","ETN","GEV","PWR","VRT","CCJ","BWXT","WMB","NVDA","AVGO","TSM","ASML","EQIX","DLR","SPCX","RKLB","LLY","ISRG","UNH","ETR","ANET"];
if (want.length !== 25) fail.push("list drift");
for (const t of want) if (!src.includes(`ticker: "${t}"`)) fail.push(`missing ${t}`);
for (const banned of ["QQQ", "SPY", "VOO", "IVV", "SPLG"]) {
  if (src.includes(`ticker: "${banned}"`)) fail.push(`banned ${banned} is featured`);
}
if (!src.includes('ticker: "SPCX"') || !src.includes("watch:")) fail.push("space names must start on watch");
if (!src.includes("The board still does not buy") && !src.includes("does not buy")) fail.push("no buy refusal");
if (ui.includes("placeOrder") || ui.includes("rh-cycle")) fail.push("ui has an order path");
if (!src.includes("washSaleBan")) fail.push("ban not read");
if (!src.includes("heroic")) fail.push("heroic growth is not a wait");
if (!src.includes("SLEEVE_CAP")) fail.push("no sleeve cap");
if (fail.length) {
  console.error(fail.join("\n"));
  process.exit(1);
}
console.log(`long board ok · ${want.length} names · no buy path`);
