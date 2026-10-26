/**
 * Plan-file integrity checks, shared by verify-repo-guards.mjs (CI, pre-push) and
 * find-last-good-plan.mjs (restore finder). Core check is pure: (path, src[, opts]) -> problems.
 *
 * Moved out of verify-repo-guards.mjs on 2026-10-26 so another script can import it
 * (verify-repo-guards runs its checks at top level and exits). Same rules as before for
 * week-ahead.ts / week-prints.json; month-ahead.ts gets the same shape checks with its
 * own floor, because 1c1abc4 (2026-10-25) reduced BOTH plan files to the 22-byte literal
 * `FULL_CONTENT_FROM_FILE`, and month-ahead.ts only had the loose 150-line floor.
 *
 * Stub markers (Accuracy Review, 2026-10-26). The first cut matched a marker ANYWHERE,
 * case-insensitive, so an ordinary comment ("placeholder until the print lands", "a
 * truncated range") failed the guard. A marker now counts only when it is:
 *   - in a TINY file (< TINY_BYTES): every whole-file stub on record is under 1 KB; or
 *   - a WHOLE LINE by itself: a comment whose text is just the marker (`// rest of the file`,
 *     `// ... existing code ...`, `// PLACEHOLDER`), a comment that is only an ellipsis
 *     (`// ...`, `/* ... *\/`), a comment that OPENS with an ellipsis and then the marker
 *     (`// ... (truncated for brevity in this call ...)`, the 4a51a712 / 0467fc58 shape), or a
 *     bare non-code line that is just the marker (`PLACEHOLDER`).
 *
 * Partial loss (2026-10-26). 01a7c5a6 dropped ~30 lines (712 -> 682) and passed the 500-line
 * floor; it had lost resolveWeekAhead / weekDayFor / weekAheadFocusLine. 29d7cbca (603 -> 582)
 * did the same to weekDayFor / weekAheadFocusLine. A line-count shrink check cannot tell
 * those from legitimate edits (e6ff6cbe went 1050 -> 366 on a real weekly rewrite, and the
 * two losses are 3-4% shrinks), so the check is on SYMBOLS instead: every name another file
 * in the repo imports from the plan file must still be exported (importedNamesFor). A
 * legitimate removal or rename edits its importers in the same commit, so the required set
 * follows it; the weekly WEEK_* / MONTH_* constants are imported by nobody, so a restamp that
 * rolls them over is never flagged.
 *
 * KNOWN LIMITS (documented, not fixed):
 *   - A partial loss INSIDE a plan (e.g. 30 lines cut from the middle of a WEEK_* object or a
 *     function body, braces still balanced, every imported name still exported) still passes.
 *     Nothing in the file's shape distinguishes that from an edit; review the diff.
 *   - week-prints.json has no shrink check, only the 30-entry floor and per-entry shape.
 *   - A marker inside a longer sentence in a normal-size file is no longer flagged by itself;
 *     the floor / brace / export checks are what catch a cut that leaves such a sentence.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

export const STUB_MARKERS = ["FULL_CONTENT_HERE", "FULL_CONTENT_FROM_FILE", "PLACEHOLDER", "rest of file", "rest of the file",
  "remaining content", "content unchanged", "TRUNCATED", "<content>", "[content]", "existing code", "see next file", "see-file",
  "TODO: restore", "// ...", "/* ... */"];

/** Below this size a marker anywhere counts: the whole file is the stub. Real plan files are 20 KB+. */
export const TINY_BYTES = 2048;

/** Line floors for the TS plan files: well under healthy size (week ~710, month ~535), far above any stub. */
export const TS_FLOORS = {
  "src/lib/trading/week-ahead.ts": 500,
  "src/lib/trading/month-ahead.ts": 300,
};

/** The files a restamp keeps replacing. */
export const PLAN_FILES = ["src/lib/trading/week-ahead.ts", "src/lib/trading/month-ahead.ts", "src/data/week-prints.json"];

const norm = (s) => s.toLowerCase().replace(/[\s.…()[\]<>{}:;,!?"'`*/#=—–-]+/g, " ").trim();
const COMMENT_OPEN = /^(?:\{\s*)?(?:\/\/+|\/\*+|\*+(?!\/)|#+|<!--)\s*/;
const COMMENT_CLOSE = /\s*(?:\*+\/|-->)\s*\}?\s*$/;
const ELLIPSIS = /\.{3}|…/;
const ELLIPSIS_LEAD = /^[[(]?\s*(?:\.{2,}|…)/;
const BARE_TEXT = /^[\w\s.…\-:<>[\]/*]+$/; // no quotes, commas, parens, =, ; — i.e. not a line of code

/** Whole-line marker hits: [{ marker, line }]. */
function lineMarkerHits(src, markers) {
  const MARKER_NORM = markers.map((m) => [m, norm(m)]);
  const has = (m) => markers.includes(m);
  const hits = [];
  src.split("\n").forEach((raw, i) => {
    const t = raw.trim();
    if (!t) return;
    const isComment = COMMENT_OPEN.test(t) || /^\*\/$/.test(t);
    if (isComment) {
      const text = t.replace(COMMENT_OPEN, "").replace(COMMENT_CLOSE, "");
      const n = norm(text);
      if (n === "") {
        const m = t.startsWith("/*") ? "/* ... */" : "// ...";
        if (ELLIPSIS.test(t) && has(m)) hits.push({ marker: m, line: i + 1 });
        return;
      }
      const lead = ELLIPSIS_LEAD.test(text.trim());
      for (const [m, nm] of MARKER_NORM) {
        if (nm && (n === nm || (lead && n.startsWith(nm + " ")))) { hits.push({ marker: m, line: i + 1 }); return; }
      }
      return;
    }
    if (!BARE_TEXT.test(t)) return;
    const n = norm(t);
    if (n === "" && ELLIPSIS.test(t) && has("// ...")) { hits.push({ marker: "// ...", line: i + 1 }); return; }
    for (const [m, nm] of MARKER_NORM) if (nm && n === nm) { hits.push({ marker: m, line: i + 1 }); return; }
  });
  return hits;
}

/** Marker problems for one file, per the tiny-file / whole-line rule above. `markers` defaults to STUB_MARKERS. */
export function stubMarkerProblems(path, src, markers = STUB_MARKERS) {
  if (Buffer.byteLength(src) < TINY_BYTES) {
    const low = src.toLowerCase();
    return markers.filter((m) => low.includes(m.toLowerCase())).map((m) => `${path} contains stub marker "${m}"`);
  }
  return lineMarkerHits(src, markers).map((h) => `${path} contains stub marker "${h.marker}" (line ${h.line} is only a stub marker)`);
}

/** Names a TS module exports (declarations and `export { a, b as c }`). */
export function exportedNames(src) {
  const out = new Set();
  for (const m of src.matchAll(/^\s*export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|type|interface|abstract\s+class|class|enum)\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (name) out.add(name);
    }
  }
  return out;
}

/**
 * Every name other files in the repo import from `planPath`: Map name -> [importing files].
 * Reads the working tree under `root` (git ls-files). Not pure; callers pass the result into
 * planFileProblems as { requiredExports }.
 */
export function importedNamesFor(root, planPath) {
  const out = new Map();
  if (!planPath.endsWith(".ts")) return out;
  let files;
  try {
    files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 }).split("\0");
  } catch { return out; }
  const target = planPath.replace(/\.ts$/, "");
  const base = posix.basename(target);
  const resolves = (from, spec) => {
    const s = spec.replace(/\.(ts|tsx|js|mjs)$/, "");
    if (s.startsWith("@/")) return "src/" + s.slice(2) === target;
    if (s.startsWith(".")) return posix.normalize(posix.join(posix.dirname(from), s)) === target;
    return false;
  };
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g,
    /\{([^}]*)\}\s*=\s*await\s+import\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const f of files) {
    if (!f || f === planPath || f.includes("node_modules/") || !/\.(ts|tsx|mts|mjs|js|jsx)$/.test(f)) continue;
    let src;
    try { src = readFileSync(join(root, f), "utf8"); } catch { continue; }
    if (!src.includes(base)) continue;
    for (const re of patterns) {
      for (const m of src.matchAll(re)) {
        if (!resolves(f, m[2])) continue;
        for (const part of m[1].split(",")) {
          const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+|\s*:\s*/)[0].trim();
          if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
          if (!out.has(name)) out.set(name, []);
          if (!out.get(name).includes(f)) out.get(name).push(f);
        }
      }
    }
  }
  return out;
}

/**
 * @param {string} path repo-relative plan file
 * @param {string|null} src file content
 * @param {{ requiredExports?: Map<string,string[]>|string[] }} [opts] names the file must still export (TS only)
 */
export function planFileProblems(path, src, { requiredExports } = {}) {
  const out = [];
  if (src == null) return [`${path} missing`];
  out.push(...stubMarkerProblems(path, src));
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
    if (requiredExports) {
      const have = exportedNames(src);
      const req = requiredExports instanceof Map ? requiredExports : new Map([...requiredExports].map((n) => [n, []]));
      const lost = [...req.keys()].filter((n) => !have.has(n));
      if (lost.length) {
        out.push(`${path} no longer exports ${lost.map((n) => `"${n}"${req.get(n).length ? ` (imported by ${req.get(n).join(", ")})` : ""}`).join(", ")} — partial loss`);
      }
    }
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
