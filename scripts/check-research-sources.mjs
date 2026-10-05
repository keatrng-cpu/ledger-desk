/**
 * Does each cited page still say the figure the research file quotes? A deterministic check — no model, no summary.
 *
 *   npx tsx scripts/check-research-sources.mjs                 # every demand fact in src/data/invest-themes.json
 *   npx tsx scripts/check-research-sources.mjs --theme nuclear # themes whose id contains "nuclear"
 *   npx tsx scripts/check-research-sources.mjs --refresh       # ignore the page cache (.cache/research-sources)
 *   npx tsx scripts/check-research-sources.mjs --strict        # an unreachable page is a failure too
 *   npx tsx scripts/check-research-sources.mjs --write         # (full runs only) leave src/data/source-check-report.json for the desk audit
 *
 * For every demand fact it fetches the cited URL (a PDF through pdftotext), and tests that each informative number in the quoted
 * figure appears in the page text (scripts/lib/source-check.ts: years and single digits are ignored, thousands separators and
 * odd spaces are folded). A number that is NOT on the page is a finding for a person: the page moved on (live pages do), the
 * figure was mistyped, or the page states it in other units. A number that is on the page does not prove the sentence.
 *
 * Not named verify-*: it needs the network and live pages move, so it must not run in verify-all or the pre-push hook. Run it when
 * the research file is refreshed, and monthly. The pure matching is covered offline by verify-source-check.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const { checkFigure, htmlToText } = await import("./lib/source-check.ts");

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CACHE = path.join(ROOT, ".cache", "research-sources");
fs.mkdirSync(CACHE, { recursive: true });

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : null;
};
const REFRESH = flag("refresh");
const STRICT = flag("strict");
const ONLY = opt("theme");

// A neutral browser-like agent: some agencies refuse the default one. Nothing about the person running it is sent.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 ledger-desk-source-check/1";

const file = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "data", "invest-themes.json"), "utf8"));
const facts = [];
for (const t of file.themes) {
  if (ONLY && !t.id.includes(ONLY)) continue;
  for (const d of t.demand) facts.push({ theme: t.id, ...d });
}

const key = (url) => crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);

function pdfText(bytes, k) {
  const pdf = path.join(CACHE, `${k}.pdf`);
  fs.writeFileSync(pdf, bytes);
  const r = spawnSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (r.error) throw new Error(`pdftotext unavailable (${r.error.code ?? r.error.message})`);
  if (r.status !== 0) throw new Error(`pdftotext exit ${r.status}`);
  return r.stdout;
}

/** The page's text, from the cache when it is there. Throws with a reason when it cannot be had. */
async function pageText(url) {
  const k = key(url);
  const txt = path.join(CACHE, `${k}.txt`);
  if (!REFRESH && fs.existsSync(txt)) return { text: fs.readFileSync(txt, "utf8"), cached: true };
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  const bytes = Buffer.from(await res.arrayBuffer());
  const isPdf = /pdf/i.test(type) || /\.pdf($|\?)/i.test(url) || bytes.subarray(0, 5).toString() === "%PDF-";
  const text = isPdf ? pdfText(bytes, k) : htmlToText(bytes.toString("utf8"));
  fs.writeFileSync(txt, text);
  return { text, cached: false };
}

const ICON = { match: "OK     ", partial: "PARTIAL", missing: "MISSING", "no-numbers": "PHRASE?", unreachable: "NO PAGE", empty: "NO TEXT", moved: "MOVED  ", "by-hand": "BY HAND" };
const results = [];
let next = 0;
async function worker() {
  while (next < facts.length) {
    const f = facts[next++];
    let r;
    try {
      const { text, cached } = await pageText(f.source);
      if (text.replace(/\s+/g, "").length < 200) r = f.manual ? { status: "by-hand", detail: f.manual } : { status: "empty", detail: "no readable text (a script-rendered page or a scanned PDF)" };
      else {
        const c = checkFigure(f.figure, text);
        // A rolling "latest" page moves on: a figure that no longer matches it is a dated reading, not an error.
        r = { status: f.volatile && (c.verdict === "partial" || c.verdict === "missing") ? "moved" : c.verdict, c, cached, chars: text.length };
      }
    } catch (e) {
      r = f.manual ? { status: "by-hand", detail: f.manual } : { status: "unreachable", detail: String(e.message ?? e).slice(0, 80) };
    }
    results.push({ f, r });
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

results.sort((a, b) => a.f.theme.localeCompare(b.f.theme) || a.f.figure.localeCompare(b.f.figure));
const host = (u) => new URL(u).host.replace(/^www\./, "");
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
let lastTheme = "";
for (const { f, r } of results) {
  if (f.theme !== lastTheme) {
    console.log(`\n${f.theme}`);
    lastTheme = f.theme;
  }
  const why =
    r.status === "unreachable" || r.status === "empty" || r.status === "by-hand"
      ? clip(r.detail, 120)
      : r.status === "moved"
        ? `a rolling page — it no longer shows ${r.c.missing.join(", ")}; the figure is a dated reading of it`
        : r.status === "match"
          ? r.c.phrase
            ? "the figure is on the page word for word"
            : r.c.derived.length
              ? `all ${r.c.numbers.length} numbers on the page (${r.c.derived.join(", ")} as a unit conversion)`
              : `all ${r.c.numbers.length} numbers on the page`
          : r.status === "no-numbers"
            ? "no informative number to test and the phrase is not verbatim — read it by hand"
            : `not on the page: ${r.c.missing.join(", ")} (found ${r.c.found.length} of ${r.c.numbers.length})`;
  console.log(`  ${ICON[r.status]}  ${clip(f.figure, 58).padEnd(58)}  ${host(f.source).padEnd(26)} ${why}`);
}

const count = (s) => results.filter((x) => x.r.status === s).length;
console.log(`\n${results.length} facts: ${count("match")} match · ${count("moved")} moved (rolling page) · ${count("partial")} partial · ${count("missing")} missing · ${count("no-numbers")} phrase to read · ${count("by-hand")} read by hand · ${count("unreachable")} unreachable · ${count("empty")} no text`);
console.log("A MISSING or PARTIAL number is a finding, not a verdict: open the page and decide whether the figure or the page changed.");
const bad = count("partial") + count("missing") + (STRICT ? count("unreachable") + count("empty") : 0);

// --write: leave the result where the desk's own audit can read it (src/data/source-check-report.json). Only a FULL run may write — a
// one-theme run must never stand in for the whole file. The report holds counts and the findings a person has to read, not page text.
if (flag("write")) {
  if (ONLY) {
    console.error("\n--write needs a full run (no --theme): a partial report must not stand in for a full one.");
    process.exitCode = 2;
  } else {
    const STATUSES = ["match", "moved", "partial", "missing", "no-numbers", "by-hand", "unreachable", "empty"];
    const report = {
      version: 1,
      script: "scripts/check-research-sources.mjs",
      checkedAt: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()),
      researchAsOf: file.asOf ?? null,
      facts: results.length,
      counts: Object.fromEntries(STATUSES.map((s) => [s, count(s)])),
      findings: results
        .filter((x) => ["partial", "missing", "no-numbers", "unreachable", "empty"].includes(x.r.status))
        .map((x) => ({ theme: x.f.theme, figure: x.f.figure, source: x.f.source, status: x.r.status, missing: x.r.c?.missing ?? [], detail: x.r.detail ?? null })),
    };
    fs.writeFileSync(path.join(ROOT, "src", "data", "source-check-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nwrote src/data/source-check-report.json (checked ${report.checkedAt}, ${report.findings.length} finding${report.findings.length === 1 ? "" : "s"} to read)`);
  }
}
// exitCode, not exit(): on Windows a hard exit while fetch sockets are closing trips a libuv assertion.
process.exitCode = bad ? 1 : 0;
