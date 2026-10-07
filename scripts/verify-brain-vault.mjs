/**
 * The code graph is a real Graphify run, and the trading book sits in the same vault.
 *
 *   npx tsx scripts/verify-brain-vault.mjs
 */
import { readFileSync, existsSync } from "node:fs";

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const report = readFileSync("graphify-out/GRAPH_REPORT.md", "utf8");
const seed = readFileSync("graphify-out/SEED_REPORT.md", "utf8");
const graph = JSON.parse(readFileSync("graphify-out/graph.json", "utf8"));
const book = readFileSync("graphify-out/obsidian/brain/Book.md", "utf8");
const sequence = readFileSync("graphify-out/obsidian/brain/smc-sequence.md", "utf8");

check("the report is a Graphify run, not the hand-built seed", report.includes("8943 nodes") && !report.includes("HAND-BUILT"));
check("the hand-built import map is kept beside it", seed.includes("HAND-BUILT"));
check("the graph has the extracted nodes", graph.nodes.length > 8000, String(graph.nodes.length));
check("the book index names the sequence", book.includes("[[smc-sequence|Sequence]]"));
check("a school note links to what it touches", sequence.includes("[[") && sequence.includes("type: brain"));
check("the vault canvas is there", existsSync("graphify-out/obsidian/graph.canvas"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
