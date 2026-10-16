/**
 * Stamp official actuals into src/data/week-prints.json after a release.
 *
 *   npx tsx scripts/stamp-actuals.mjs --date 2026-10-14            # dry run: print what would be stamped
 *   npx tsx scripts/stamp-actuals.mjs --date 2026-10-14 --write    # append to week-prints.json (never overwrites)
 *   ... --grok                                                     # let Grok write the note prose (numbers stay code's)
 *
 * Reads the bundled calendar for that ET date, and for every CPI / PPI / NFP / GDP / PCE row computes the actual from
 * the BLS API (BEA API with BEA_API_KEY). Rows already stamped are left alone. The numbers come from the agency
 * series; a model never writes one. Prints only key presence, never a key.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const A = await import("../src/lib/news/actuals.ts");
const { NEWS_CALENDAR } = await import("../src/lib/trading/news.ts");

const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};
const date = arg("--date") ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const write = process.argv.includes("--write");
const useGrok = process.argv.includes("--grok");
const file = join(import.meta.dirname, "..", "src", "data", "week-prints.json");
let prints = JSON.parse(readFileSync(file, "utf8"));

console.log(`stamp-actuals ${date} · BLS_API_KEY ${process.env.BLS_API_KEY ? "present" : "absent"} · BEA_API_KEY ${process.env.BEA_API_KEY ? "present" : "absent"} · XAI_API_KEY ${process.env.XAI_API_KEY ? "present" : "absent"}`);
const rows = NEWS_CALENDAR.filter((e) => e.date === date && A.kindOf(e.name));
if (!rows.length) console.log("  no CPI/PPI/NFP/GDP/PCE row on the calendar for that date");
let added = 0;
for (const r of rows) {
  const kind = A.kindOf(r.name);
  if (A.alreadyStamped(prints, date, r.name)) {
    console.log(`  skip  ${r.name} — already stamped`);
    continue;
  }
  try {
    const c = await A.computeActual(kind, Number(date.slice(0, 4)));
    if (!c) throw new Error("series had no usable observation");
    if (!A.refMatches(r.name, c)) throw new Error(`API newest month is ${A.MON_SHORT[c.ref.month - 1]} ${c.ref.year}, not the row's — not printed yet?`);
    const n = useGrok ? await A.noteFor(kind, r.name, c) : { note: A.deterministicNote(kind), byModel: false, rejected: null };
    const row = { date, name: r.name, actual: c.actual, vs: c.vs, note: n.note };
    console.log(`  stamp ${r.name}: ${c.actual} | ${c.vs}${n.rejected ? ` | grok note rejected (${n.rejected})` : n.byModel ? " | note by grok" : ""}`);
    prints = A.mergePrint(prints, row);
    added++;
  } catch (e) {
    console.log(`  FAIL  ${r.name} — ${e instanceof Error ? e.message : e}`);
  }
}
if (write && added) {
  writeFileSync(file, JSON.stringify(prints, null, 2) + "\n");
  console.log(`  wrote ${added} row(s) to src/data/week-prints.json`);
} else if (added) console.log("  dry run — pass --write to append");
