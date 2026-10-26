/**
 * Plan-file integrity checks, shared by verify-repo-guards.mjs (CI, pre-push) and
 * find-last-good-plan.mjs (restore finder). Pure: (path, src) -> list of problems.
 *
 * Moved out of verify-repo-guards.mjs on 2026-10-26 so another script can import it
 * (verify-repo-guards runs its checks at top level and exits). Same rules as before for
 * week-ahead.ts / week-prints.json; month-ahead.ts gets the same shape checks with its
 * own floor, because 1c1abc4 (2026-10-25) reduced BOTH plan files to the 22-byte literal
 * `FULL_CONTENT_FROM_FILE`, and month-ahead.ts only had the loose 150-line floor.
 */

export const STUB_MARKERS = ["FULL_CONTENT_HERE", "FULL_CONTENT_FROM_FILE", "PLACEHOLDER", "rest of file", "rest of the file",
  "remaining content", "content unchanged", "TRUNCATED", "<content>", "[content]", "existing code", "see next file", "see-file",
  "TODO: restore", "// ...", "/* ... */"];

/** Line floors for the TS plan files: well under healthy size (week ~710, month ~535), far above any stub. */
export const TS_FLOORS = {
  "src/lib/trading/week-ahead.ts": 500,
  "src/lib/trading/month-ahead.ts": 300,
};

/** The files a restamp keeps replacing. */
export const PLAN_FILES = ["src/lib/trading/week-ahead.ts", "src/lib/trading/month-ahead.ts", "src/data/week-prints.json"];

export function planFileProblems(path, src) {
  const out = [];
  if (src == null) return [`${path} missing`];
  for (const m of STUB_MARKERS) if (src.toLowerCase().includes(m.toLowerCase())) out.push(`${path} contains stub marker "${m}"`);
  if (path.endsWith(".ts")) {
    const floor = TS_FLOORS[path] ?? 500;
    const lines = src.split("\n").length;
    if (lines < floor) out.push(`${path} has ${lines} lines (floor ${floor}) — placeholder or truncated`);
    const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").trim();
    if (!/[}\];]\s*$/.test(body)) out.push(`${path} does not end on a closing brace/bracket/semicolon — truncated write`);
    const bal = (o, c) => (body.split(o).length - 1) - (body.split(c).length - 1);
    if (bal("{", "}") !== 0) out.push(`${path} braces unbalanced (${bal("{", "}")}) — truncated write`);
    if (bal("[", "]") !== 0) out.push(`${path} brackets unbalanced (${bal("[", "]")}) — truncated write`);
    if (!/export\s+(async\s+)?function\s+\w+/.test(body)) out.push(`${path} exports no function — placeholder`);
  } else {
    let j = null;
    try { j = JSON.parse(src); } catch { out.push(`${path} does not parse — truncated write`); return out; }
    if (!Array.isArray(j)) { out.push(`${path} is not an array`); return out; }
    if (j.length < 30) out.push(`${path} has ${j.length} entries (floor 30; healthy is ~40) — placeholder or truncated`);
    const need = ["date", "name", "actual", "vs", "note"];
    j.forEach((e, i) => {
      if (!e || typeof e !== "object") { out.push(`${path}[${i}] is not an object`); return; }
      for (const k of need) if (!(k in e)) out.push(`${path}[${i}] missing "${k}"`);
      if (!/^\d{4}-\d\d-\d\d$/.test(String(e.date ?? ""))) out.push(`${path}[${i}] date ${JSON.stringify(e.date)} not YYYY-MM-DD`);
      if (!String(e.name ?? "").trim()) out.push(`${path}[${i}] empty name — placeholder entry`);
    });
  }
  return out;
}

/** Back-compat name used by verify-repo-guards since #85. */
export const weekFileProblems = planFileProblems;
