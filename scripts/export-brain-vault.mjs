/**
 * Write the trading book into the Obsidian vault Graphify already built.
 * These notes are the desk's own nodes. They are not mixed into graph.json.
 *
 *   npx tsx scripts/export-brain-vault.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mergeAtlas } from "../src/lib/room/desk-atlas.ts";

const atlas = mergeAtlas(null, null, 0);
const root = join("graphify-out", "obsidian", "brain");
mkdirSync(root, { recursive: true });

const stem = (id) => id.replace(/:/g, "-");
const byId = new Map(atlas.nodes.map((n) => [n.id, n]));

for (const n of atlas.nodes) {
  const touches = atlas.edges.filter((e) => e.from === n.id || e.to === n.id);
  const lines = touches.map((e) => {
    const other = e.from === n.id ? e.to : e.from;
    const title = byId.get(other)?.title ?? other;
    return `- [[${stem(other)}|${title}]] — ${e.why}`;
  });
  const body = `---
type: brain
shelf: ${n.shelf}
who: ${n.who}
confidence: ${n.confidence}
id: ${n.id}
---

# ${n.title}

${n.text}

## Touches

${lines.length ? lines.join("\n") : "Nothing else yet."}
`;
  writeFileSync(join(root, `${stem(n.id)}.md`), body);
}

const shelves = ["now", "smc", "discretion", "market", "backtest"];
const groups = shelves
  .map((shelf) => {
    const rows = atlas.nodes
      .filter((n) => n.shelf === shelf)
      .map((n) => `- [[${stem(n.id)}|${n.title}]] — ${n.who}`)
      .join("\n");
    return `## ${shelf}\n\n${rows}`;
  })
  .join("\n\n");

writeFileSync(
  join(root, "Book.md"),
  `---
type: brain
shelf: index
---

# The book

The floor's book, as notes. The code graph is the rest of this vault. A line here is the same line the desk recalls. It is not a second copy of the source.

${groups}
`,
);

console.log(`brain vault: ${atlas.nodes.length} notes in ${root}`);
