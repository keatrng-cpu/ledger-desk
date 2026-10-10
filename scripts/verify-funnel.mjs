import { readFileSync } from "node:fs";
const src = readFileSync("src/lib/invest/funnel.ts", "utf8");
const weights = [...src.matchAll(/weight: (0\.\d+)/g)].map((m) => Number(m[1]));
const sum = Math.round(weights.reduce((s, n) => s + n, 0) * 1000) / 1000;
if (sum !== 1) {
  console.error("weights", weights, sum);
  process.exit(1);
}
if (!src.includes("does not place an order") && !src.includes("Nothing here places an order")) process.exit(1);
if (src.includes("placeOrder")) process.exit(1);
console.log(`funnel ok · ${weights.length} sleeves · ${sum}`);
