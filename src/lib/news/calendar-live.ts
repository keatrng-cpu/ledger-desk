/**
 * WS-CAL — the official release calendar, fetched live from the agencies.
 *
 * Sources (agency pages only, never an aggregator):
 *   - BLS  https://www.bls.gov/schedule/news_release/bls.ics   (CPI, PPI, Employment Situation, JOLTS, ECI, import prices)
 *   - BEA  https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics  (GDP, Personal Income & Outlays/PCE, trade)
 *   - Fed  https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm  (FOMC statement 14:00 ET, presser 14:30 ET)
 *
 * BLS answers anonymous clients 403 (Akamai bot policy), so every request carries an identifying User-Agent:
 * CALENDAR_USER_AGENT on the deploy, else DEFAULT_UA below. If BLS still refuses, the run fails and the bundled
 * file stays in charge — that is the designed outcome, not an error to route around.
 *
 * THE FLAG. The ±15-minute blackout in src/lib/trading/news.ts refuses fires. Rows handed to `setLiveCalendar`
 * change what that blackout sees, so they are only handed over when NEWS_LIVE_CALENDAR is "1"/"true"/"on".
 * Default OFF: the job fetches, validates, diffs against the bundled file and logs, and src/data/news-calendar.json
 * remains the only calendar the desk reads. See docs/NEWS_LIVE_CALENDAR.md.
 *
 * MODELS NEVER WRITE ROWS. Grok (web search) may only cross-check the parsed rows against agency pages; its
 * answer is logged and nothing it says is merged, dropped or re-timed.
 */
import { etWallParts } from "@/lib/trading/sessions";
import { isNewsEvent, NEWS_CALENDAR, setLiveCalendar, type NewsEvent } from "@/lib/trading/news";
import { firstJson, grokSearch, type GrokSearchResult } from "./grok-search";

export const BLS_ICS_URL = "https://www.bls.gov/schedule/news_release/bls.ics";
export const BEA_ICS_URL = "https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics";
export const FED_FOMC_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
export const DEFAULT_UA = "LedgerDesk-calendar/1.0 (+https://github.com/keatrng-cpu/ledger-desk; official release schedule check)";
export const LIVE_CALENDAR_FLAG = "NEWS_LIVE_CALENDAR";
const FETCH_MS = 8_000;

/** Rows kept: from LOOKBACK_DAYS ago to LOOKAHEAD_DAYS ahead (ET dates). */
export const LOOKBACK_DAYS = 7;
export const LOOKAHEAD_DAYS = 180;
/** A parse yielding fewer rows ahead than this is treated as parser drift, not a quiet quarter. */
export const MIN_ROWS_AHEAD = 6;

export function liveCalendarFlagOn(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|on|yes)$/i.test((env[LIVE_CALENDAR_FLAG] ?? "").trim());
}

/* ── ICS ─────────────────────────────────────────────────────────────── */

export interface IcsEvent {
  summary: string;
  date: string;
  timeEt: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ET date + wall time for a UTC instant. */
function etOf(ms: number): { date: string; timeEt: string } {
  const p = etWallParts(ms);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, timeEt: `${pad(p.hour)}:${pad(p.minute)}` };
}

const EASTERN_TZID = /^(America\/New_York|US-Eastern|US\/Eastern|EST5EDT|Eastern Standard Time)$/i;

/** RFC 5545 lines: unfolded, unescaped. Timed events only; all-day (VALUE=DATE) rows carry no release minute and are skipped. */
export function parseIcs(text: string): IcsEvent[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out: IcsEvent[] = [];
  let cur: { summary?: string; start?: { date: string; timeEt: string } | null } | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") {
      if (cur?.summary && cur.start) out.push({ summary: cur.summary, ...cur.start });
      cur = null;
    } else if (cur) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const head = line.slice(0, colon);
      const value = line.slice(colon + 1).trim();
      const [prop, ...params] = head.split(";");
      if (prop === "SUMMARY") cur.summary = value.replace(/\\([,;\\])/g, "$1").replace(/\\n/gi, " ").trim();
      else if (prop === "DTSTART") {
        if (params.some((p) => /^VALUE=DATE$/i.test(p))) {
          cur.start = null;
          continue;
        }
        const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{0,2}(Z?)$/.exec(value);
        if (!m) {
          cur.start = null;
          continue;
        }
        const [, y, mo, d, h, mi, z] = m;
        if (z === "Z") cur.start = etOf(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!));
        else {
          const tz = params.find((p) => /^TZID=/i.test(p))?.slice(5) ?? "";
          // A floating or Eastern time is already the ET wall clock. Any other zone is not something these feeds use; skip it.
          cur.start = !tz || EASTERN_TZID.test(tz) ? { date: `${y}-${mo}-${d}`, timeEt: `${h}:${mi}` } : null;
        }
      }
    }
  }
  return out;
}

/* ── Classification: which agency rows are desk releases ────────────────── */

const MON: Record<string, string> = {
  january: "Jan", february: "Feb", march: "Mar", april: "Apr", may: "May", june: "Jun",
  july: "Jul", august: "Aug", september: "Sep", october: "Oct", november: "Nov", december: "Dec",
};

function refMonth(summary: string): string {
  const m = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i.exec(summary);
  return m ? ` (${MON[m[1]!.toLowerCase()]})` : "";
}

function refQuarter(summary: string): string {
  const m = /\b(1st|2nd|3rd|4th|First|Second|Third|Fourth)\s+Quarter\b/i.exec(summary);
  if (!m) return "";
  const q = { "1st": 1, first: 1, "2nd": 2, second: 2, "3rd": 3, third: 3, "4th": 4, fourth: 4 }[m[1]!.toLowerCase()];
  return q ? ` Q${q}` : "";
}

/** Agency SUMMARY → desk row name + impact, or null when the release is not one the desk blacks out for. */
export function classify(summary: string, source: "bls" | "bea"): { name: string; impact: NewsEvent["impact"] } | null {
  const s = summary;
  if (source === "bls") {
    if (/^Consumer Price Index\b/i.test(s)) return { name: `CPI${refMonth(s)}`, impact: "high" };
    if (/^Employment Situation\b/i.test(s)) return { name: `NFP / Employment Situation${refMonth(s)}`, impact: "high" };
    if (/^Producer Price Index\b/i.test(s)) return { name: `PPI${refMonth(s)}`, impact: "high" };
    if (/Job Openings and Labor Turnover/i.test(s)) return { name: `JOLTS Job Openings${refMonth(s)}`, impact: "high" };
    if (/^Employment Cost Index\b/i.test(s)) return { name: "Employment Cost Index", impact: "medium" };
    if (/Import and Export Price/i.test(s)) return { name: `Import/Export Price Indexes${refMonth(s)}`, impact: "medium" };
    return null;
  }
  if (/^(GDP|Gross Domestic Product)\b/i.test(s)) {
    const advance = /Advance/i.test(s);
    const est = advance ? "adv" : /Second/i.test(s) ? "2nd est" : /Third/i.test(s) ? "3rd est" : "est";
    return { name: `GDP${refQuarter(s)} (${est})`, impact: advance ? "high" : "medium" };
  }
  if (/^Personal Income and Outlays\b/i.test(s)) return { name: `PCE / Personal Income${refMonth(s)}`, impact: "high" };
  if (/^U\.S\. International Trade in Goods and Services\b/i.test(s) && !/Annual Update/i.test(s))
    return { name: `International Trade${refMonth(s)}`, impact: "medium" };
  return null;
}

export function rowsFromIcs(text: string, source: "bls" | "bea"): NewsEvent[] {
  const out: NewsEvent[] = [];
  for (const e of parseIcs(text)) {
    const c = classify(e.summary, source);
    if (c) out.push({ date: e.date, timeEt: e.timeEt, name: c.name, impact: c.impact });
  }
  return out;
}

/* ── Fed FOMC page ─────────────────────────────────────────────────────── */

const MONTH_NUM: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/**
 * The FOMC calendar page: one panel per year ("2026 FOMC Meetings"), then month / date pairs ("October" / "27-28",
 * "April/May" / "30-1", "December" / "8-9*"). The decision day is the LAST day of the meeting. Notation votes and
 * unscheduled calls are skipped (no statement slot is known in advance).
 */
export function rowsFromFomcHtml(html: string): NewsEvent[] {
  const out: NewsEvent[] = [];
  const panels = html.split(/(?=<h4><a id="\d+">\d{4} FOMC Meetings)/);
  for (const panel of panels) {
    const ym = /<h4><a id="\d+">(\d{4}) FOMC Meetings/.exec(panel);
    if (!ym) continue;
    const year = Number(ym[1]);
    const re = /fomc-meeting__month[^>]*>\s*<strong>([A-Za-z/]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)</g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(panel))) {
      const months = m[1]!.split("/").map((x) => MONTH_NUM[x.toLowerCase()]);
      const dateTxt = m[2]!.trim();
      if (/notation|unscheduled|cancel/i.test(dateTxt)) continue;
      const dm = /^(\d{1,2})(?:\s*-\s*(\d{1,2}))?\*?/.exec(dateTxt);
      if (!dm || months.some((x) => !x)) continue;
      const lastDay = Number(dm[2] ?? dm[1]);
      const firstDay = Number(dm[1]);
      // "30-1" under "April/May": the decision is on the second month.
      const month = months.length > 1 && lastDay < firstDay ? months[1]! : months[months.length - 1]!;
      const date = `${year}-${pad(month)}-${pad(lastDay)}`;
      out.push({ date, timeEt: "14:00", name: "FOMC Rate Decision", impact: "high" });
      out.push({ date, timeEt: "14:30", name: "FOMC Press Conference", impact: "high" });
    }
  }
  return out;
}

/* ── Validation ───────────────────────────────────────────────────────── */

const addDaysIso = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export interface Validated {
  rows: NewsEvent[];
  problems: string[];
}

/**
 * The same row validator the bundled file goes through (`isNewsEvent`), then the checks that catch a parser that
 * quietly changed shape: dates inside the window, a real ET release minute (07:00–16:00), at least MIN_ROWS_AHEAD
 * rows ahead, and an FOMC decision ahead. Names are aligned to the bundled file where it already has a row at the
 * same date and minute, so the merge in `effectiveCalendar` does not double-count one release.
 */
export function validateLiveRows(candidates: unknown[], todayEt: string, bundled: NewsEvent[] = NEWS_CALENDAR): Validated {
  const problems: string[] = [];
  const lo = addDaysIso(todayEt, -LOOKBACK_DAYS);
  const hi = addDaysIso(todayEt, LOOKAHEAD_DAYS);
  const bundledAt = new Map<string, NewsEvent>();
  for (const b of bundled) bundledAt.set(`${b.date} ${b.timeEt}`, b);
  const seen = new Set<string>();
  const rows: NewsEvent[] = [];
  let bad = 0;
  for (const c of candidates) {
    if (!isNewsEvent(c)) {
      bad++;
      continue;
    }
    if (c.date < lo || c.date > hi) continue;
    const [h, mi] = c.timeEt.split(":").map(Number);
    const mins = h! * 60 + mi!;
    if (mins < 7 * 60 || mins > 16 * 60) {
      problems.push(`${c.name} ${c.date} at ${c.timeEt} ET is outside 07:00–16:00 — parser drift?`);
      continue;
    }
    const twin = bundledAt.get(`${c.date} ${c.timeEt}`);
    const row: NewsEvent = twin ? { ...c, name: twin.name, impact: twin.impact === "high" || c.impact === "high" ? "high" : "medium" } : c;
    const k = `${row.date} ${row.timeEt} ${row.name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push(row);
  }
  if (bad) problems.push(`${bad} row(s) failed the bundled-file validator`);
  const ahead = rows.filter((r) => r.date >= todayEt);
  if (ahead.length < MIN_ROWS_AHEAD) problems.push(`only ${ahead.length} rows ahead (need ${MIN_ROWS_AHEAD}) — treating as parser drift`);
  if (!ahead.some((r) => /FOMC Rate Decision/i.test(r.name))) problems.push("no FOMC decision ahead");
  rows.sort((a, b) => (a.date + a.timeEt).localeCompare(b.date + b.timeEt));
  return { rows, problems };
}

/** Rows the live fetch has that the bundled file does not, and bundled high-impact rows the fetch lacks (date+minute). */
export function diffVsBundled(live: NewsEvent[], bundled: NewsEvent[], fromDate: string, toDate: string) {
  const at = (e: NewsEvent) => `${e.date} ${e.timeEt}`;
  const liveAt = new Set(live.map(at));
  const bundledAt = new Set(bundled.map(at));
  return {
    onlyLive: live.filter((e) => e.date >= fromDate && e.date <= toDate && !bundledAt.has(at(e))),
    onlyBundledHigh: bundled.filter((e) => e.impact === "high" && e.date >= fromDate && e.date <= toDate && !liveAt.has(at(e))),
  };
}

/* ── The run ──────────────────────────────────────────────────────────── */

export interface SourceRun {
  ok: boolean;
  rows: number;
  error: string | null;
}

export interface LiveCalendarRun {
  at: string;
  todayEt: string;
  /** Every source answered, parsed, and the merged rows passed validation. */
  ok: boolean;
  /** "live" only when the rows were handed to setLiveCalendar (flag ON and ok); otherwise the bundled file is in charge. */
  inCharge: "live" | "bundled";
  flagOn: boolean;
  applied: boolean;
  sources: { bls: SourceRun; bea: SourceRun; fed: SourceRun };
  rows: NewsEvent[];
  problems: string[];
  diff: { onlyLive: NewsEvent[]; onlyBundledHigh: NewsEvent[] } | null;
  crossCheck: CrossCheck | null;
}

export interface LiveCalendarDeps {
  fetchImpl?: typeof fetch;
  nowMs?: number;
  env?: Record<string, string | undefined>;
  /** Hand-over seam; defaults to news.ts setLiveCalendar. Injected in tests. */
  apply?: (rows: NewsEvent[], atMs: number) => void;
  bundled?: NewsEvent[];
  /** Skip the Grok cross-check (tests, or a run with no key). */
  crossCheck?: (rows: NewsEvent[], todayEt: string) => Promise<CrossCheck>;
}

async function fetchText(url: string, f: typeof fetch, ua: string): Promise<string> {
  const res = await f(url, {
    headers: { "User-Agent": ua, Accept: "text/calendar, text/html, */*" },
    signal: AbortSignal.timeout(FETCH_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

let lastRun: LiveCalendarRun | null = null;
/** The last run in this instance (for the chip / diagnostics). Never read by a gate. */
export function lastLiveCalendarRun(): LiveCalendarRun | null {
  return lastRun;
}

export async function runLiveCalendar(deps: LiveCalendarDeps = {}): Promise<LiveCalendarRun> {
  const f = deps.fetchImpl ?? fetch;
  const nowMs = deps.nowMs ?? Date.now();
  const env = deps.env ?? process.env;
  const bundled = deps.bundled ?? NEWS_CALENDAR;
  const ua = env.CALENDAR_USER_AGENT?.trim() || DEFAULT_UA;
  const todayEt = etOf(nowMs).date;
  const flagOn = liveCalendarFlagOn(env);

  const one = async (url: string, parse: (t: string) => NewsEvent[]): Promise<{ run: SourceRun; rows: NewsEvent[] }> => {
    try {
      const text = await fetchText(url, f, ua);
      const rows = parse(text);
      return { run: { ok: rows.length > 0, rows: rows.length, error: rows.length ? null : "parsed 0 desk rows" }, rows };
    } catch (e) {
      return { run: { ok: false, rows: 0, error: String(e instanceof Error ? e.message : e).slice(0, 80) }, rows: [] };
    }
  };
  const [bls, bea, fed] = await Promise.all([
    one(BLS_ICS_URL, (t) => rowsFromIcs(t, "bls")),
    one(BEA_ICS_URL, (t) => rowsFromIcs(t, "bea")),
    one(FED_FOMC_URL, rowsFromFomcHtml),
  ]);
  const sources = { bls: bls.run, bea: bea.run, fed: fed.run };
  const problems: string[] = [];
  for (const [k, s] of Object.entries(sources)) if (!s.ok) problems.push(`${k.toUpperCase()}: ${s.error}`);

  let rows: NewsEvent[] = [];
  if (!problems.length) {
    const v = validateLiveRows([...bls.rows, ...bea.rows, ...fed.rows], todayEt, bundled);
    rows = v.rows;
    problems.push(...v.problems);
  }
  const ok = problems.length === 0;
  let applied = false;
  if (ok && flagOn) {
    (deps.apply ?? ((r, at) => void setLiveCalendar(r, at)))(rows, nowMs);
    applied = true;
  }
  const diff = ok ? diffVsBundled(rows, bundled, todayEt, addDaysIso(todayEt, 45)) : null;
  let crossCheck: CrossCheck | null = null;
  if (ok) {
    try {
      crossCheck = await (deps.crossCheck ?? grokCrossCheck)(rows, todayEt);
    } catch (e) {
      crossCheck = { ok: false, checked: [], disagreements: [], sources: [], error: String(e).slice(0, 80) };
    }
  }
  lastRun = {
    at: new Date(nowMs).toISOString(),
    todayEt,
    ok,
    inCharge: applied ? "live" : "bundled",
    flagOn,
    applied,
    sources,
    rows,
    problems,
    diff,
    crossCheck,
  };
  return lastRun;
}

/* ── Grok cross-check (log only) ───────────────────────────────────────── */

export interface CrossCheck {
  ok: boolean;
  checked: { name: string; date: string; timeEt: string; agree: boolean | null }[];
  disagreements: string[];
  sources: string[];
  error: string | null;
}

export const CROSS_CHECK_INSTRUCTIONS =
  "You check a US economic release calendar against the issuing agency's own web page (bls.gov, bea.gov, federalreserve.gov). " +
  "For each row given, search the agency page and say whether the date and ET time match. Do not add, remove or correct rows. " +
  'Reply with JSON only: {"rows":[{"i":<row index>,"agree":true|false|null}]} — null when the agency page could not be reached.';

/** Ask Grok to compare the next high-impact rows with the agency pages. Logged only; never edits a row. */
export async function grokCrossCheck(rows: NewsEvent[], todayEt: string, search: (a: Parameters<typeof grokSearch>[0]) => Promise<GrokSearchResult> = grokSearch): Promise<CrossCheck> {
  const next = rows.filter((r) => r.impact === "high" && r.date >= todayEt).slice(0, 8);
  const input = next.map((r, i) => `${i}. ${r.date} ${r.timeEt} ET — ${r.name}`).join("\n");
  const res = await search({ instructions: CROSS_CHECK_INSTRUCTIONS, input, ms: 20_000, maxTokens: 500 });
  if (!res.ok) return { ok: false, checked: [], disagreements: [], sources: [], error: res.error };
  const j = firstJson(res.text);
  const list = Array.isArray(j?.rows) ? (j!.rows as { i?: unknown; agree?: unknown }[]) : [];
  const checked = next.map((r, i) => {
    const hit = list.find((x) => x && x.i === i);
    return { name: r.name, date: r.date, timeEt: r.timeEt, agree: typeof hit?.agree === "boolean" ? hit.agree : null };
  });
  return {
    ok: list.length > 0,
    checked,
    disagreements: checked.filter((c) => c.agree === false).map((c) => `${c.date} ${c.timeEt} ${c.name}`),
    sources: res.citations.map((c) => c.url),
    error: list.length ? null : "reply was not the JSON asked for",
  };
}
