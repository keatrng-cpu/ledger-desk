/**
 * Official actuals for week-prints.json — numbers from the agencies, never from a model.
 *
 *   BLS Public API v2 (https://api.bls.gov/publicAPI/v2/timeseries/data/): CPI, PPI, Employment Situation.
 *     With BLS_API_KEY the request carries `registrationkey` (v2: 500 queries/day, 20 years); without it, the
 *     unregistered limits apply. The API has no release-schedule endpoint, so the calendar still needs the ICS.
 *   BEA API (https://apps.bea.gov/api/data): GDP (NIPA T10101 line 1, real GDP % change SAAR) and the PCE price
 *     index (T20804 line 1). Needs BEA_API_KEY; without it the BEA rows are skipped and reported, never guessed.
 *
 * Every figure is computed here from the series values: m/m from the seasonally adjusted index, y/y from the
 * unadjusted index twelve months back, payroll change from the level series. `vs` carries the PRIOR period only:
 * there is no free official consensus feed, and a consensus a model remembers is not a number this desk prints.
 *
 * Grok may write the NOTE — prose only. A note carrying any number the code did not compute is rejected
 * (ungroundedNumbers) and the deterministic note is used instead, so the Floor (which reads `note` through
 * week-ahead.ts → live-world.ts → live-talk) never speaks a model digit that is not registered.
 */
import { grokSearch, ungroundedNumbers, type GrokSearchResult } from "./grok-search";

export interface WeekPrint {
  date: string;
  name: string;
  actual: string;
  vs: string;
  note: string;
}

export type ActualKind = "cpi" | "ppi" | "nfp" | "gdp" | "pce";

export const BLS_API = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
export const BEA_API = "https://apps.bea.gov/api/data";

/** BLS series per release. sa = seasonally adjusted index (m/m), nsa = unadjusted index (y/y). */
export const BLS_SERIES = {
  cpi: { sa: "CUSR0000SA0", nsa: "CUUR0000SA0", coreSa: "CUSR0000SA0L1E", coreNsa: "CUUR0000SA0L1E" },
  ppi: { sa: "WPSFD4", nsa: "WPUFD4", coreSa: "WPSFD49104", coreNsa: "WPUFD49104" },
  nfp: { level: "CES0000000001", urate: "LNS14000000", ahe: "CES0500000003" },
} as const;

export const KIND_SOURCE: Record<ActualKind, string> = {
  cpi: "https://www.bls.gov/news.release/cpi.nr0.htm",
  ppi: "https://www.bls.gov/news.release/ppi.nr0.htm",
  nfp: "https://www.bls.gov/news.release/empsit.nr0.htm",
  gdp: "https://www.bea.gov/data/gdp/gross-domestic-product",
  pce: "https://www.bea.gov/data/personal-consumption-expenditures-price-index",
};

/** Which calendar row a kind answers to. */
export function kindOf(rowName: string): ActualKind | null {
  if (/^CPI\b/i.test(rowName)) return "cpi";
  if (/^PPI\b/i.test(rowName)) return "ppi";
  if (/^NFP\b|Nonfarm Payrolls|Employment Situation/i.test(rowName)) return "nfp";
  if (/^GDP\b/i.test(rowName)) return "gdp";
  if (/^PCE\b/i.test(rowName)) return "pce";
  return null;
}

/* ── BLS series math ───────────────────────────────────────────────────── */

export interface Obs {
  year: number;
  /** 1–12 */
  month: number;
  value: number;
}

/** BLS v2 JSON → { seriesId: Obs[] newest first }. Annual (M13) and missing values dropped. */
export function parseBls(json: unknown): Record<string, Obs[]> {
  const out: Record<string, Obs[]> = {};
  const series = (json as { Results?: { series?: { seriesID: string; data: { year: string; period: string; value: string }[] }[] } })?.Results?.series ?? [];
  for (const s of series) {
    out[s.seriesID] = (s.data ?? [])
      .filter((d) => /^M(0[1-9]|1[0-2])$/.test(d.period) && Number.isFinite(Number(d.value)))
      .map((d) => ({ year: Number(d.year), month: Number(d.period.slice(1)), value: Number(d.value) }))
      .sort((a, b) => b.year - a.year || b.month - a.month);
  }
  return out;
}

const find = (obs: Obs[] | undefined, y: number, m: number) => obs?.find((o) => o.year === y && o.month === m)?.value ?? null;
const prevYm = (y: number, m: number, back: number) => {
  const t = y * 12 + (m - 1) - back;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
};
const pctCh = (a: number | null, b: number | null) => (a != null && b != null && b !== 0 ? ((a / b - 1) * 100) : null);
const sgn = (x: number, dp = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(dp)}`;

export const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface Computed {
  ref: { year: number; month: number };
  actual: string;
  vs: string;
  /** Every number string the code produced — the only numbers a note may repeat. */
  facts: string[];
}

/** CPI or PPI: headline + core, m/m (SA) and y/y (NSA), for the newest month the SA headline has. */
export function computeInflation(kind: "cpi" | "ppi", data: Record<string, Obs[]>): Computed | null {
  const ids = BLS_SERIES[kind];
  const head = data[ids.sa]?.[0];
  if (!head) return null;
  const { year: y, month: m } = head;
  const p1 = prevYm(y, m, 1);
  const p2 = prevYm(y, m, 2);
  const y1 = prevYm(y, m, 12);
  const y1p = prevYm(y, m, 13);
  const mm = pctCh(find(data[ids.sa], y, m), find(data[ids.sa], p1.y, p1.m));
  const yy = pctCh(find(data[ids.nsa], y, m), find(data[ids.nsa], y1.y, y1.m));
  const cmm = pctCh(find(data[ids.coreSa], y, m), find(data[ids.coreSa], p1.y, p1.m));
  const cyy = pctCh(find(data[ids.coreNsa], y, m), find(data[ids.coreNsa], y1.y, y1.m));
  const pmm = pctCh(find(data[ids.sa], p1.y, p1.m), find(data[ids.sa], p2.y, p2.m));
  const pyy = pctCh(find(data[ids.nsa], p1.y, p1.m), find(data[ids.nsa], y1p.y, y1p.m));
  if (mm == null || yy == null) return null;
  const actual = `${sgn(mm)}% MoM / ${sgn(yy)}% YoY` + (cmm != null && cyy != null ? `; core ${sgn(cmm)}% / ${sgn(cyy)}%` : "");
  const vs = pmm != null && pyy != null ? `prev ${sgn(pmm)}% / ${sgn(pyy)}%` : "prev n/a";
  return { ref: { year: y, month: m }, actual, vs, facts: [actual, vs] };
}

/** Employment Situation: payroll change (k), unemployment rate, average hourly earnings m/m. */
export function computeNfp(data: Record<string, Obs[]>): Computed | null {
  const ids = BLS_SERIES.nfp;
  const head = data[ids.level]?.[0];
  if (!head) return null;
  const { year: y, month: m } = head;
  const p1 = prevYm(y, m, 1);
  const p2 = prevYm(y, m, 2);
  const lv = find(data[ids.level], y, m);
  const lv1 = find(data[ids.level], p1.y, p1.m);
  const lv2 = find(data[ids.level], p2.y, p2.m);
  if (lv == null || lv1 == null) return null;
  const chg = Math.round(lv - lv1); // the level series is in thousands
  const ur = find(data[ids.urate], y, m);
  const ahe = pctCh(find(data[ids.ahe], y, m), find(data[ids.ahe], p1.y, p1.m));
  // First print: BLS revises payrolls in each of the next two reports, so the stamp says so.
  const actual = `${chg >= 0 ? "+" : "−"}${Math.abs(chg)}k (prelim)` + (ur != null ? `; U-rate ${ur.toFixed(1)}%` : "") + (ahe != null ? `; AHE ${sgn(ahe)}% MoM` : "");
  const vs = lv2 != null ? `prev ${Math.round(lv1 - lv2) >= 0 ? "+" : "−"}${Math.abs(Math.round(lv1 - lv2))}k (as revised)` : "prev n/a";
  return { ref: { year: y, month: m }, actual, vs, facts: [actual, vs] };
}

/* ── BEA ───────────────────────────────────────────────────────────────── */

/** BEA NIPA GetData JSON → newest two (period, value) for LineNumber "1". */
export function parseBeaLine1(json: unknown): { period: string; value: number }[] {
  const rows = (json as { BEAAPI?: { Results?: { Data?: { LineNumber: string; TimePeriod: string; DataValue: string }[] } } })?.BEAAPI?.Results?.Data ?? [];
  return rows
    .filter((r) => r.LineNumber === "1" && Number.isFinite(Number(String(r.DataValue).replace(/,/g, ""))))
    .map((r) => ({ period: r.TimePeriod, value: Number(String(r.DataValue).replace(/,/g, "")) }))
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, 2);
}

export function computeGdp(json: unknown): Computed | null {
  const [now, prev] = parseBeaLine1(json);
  if (!now) return null;
  const q = /^(\d{4})Q([1-4])$/.exec(now.period);
  if (!q) return null;
  const actual = `${sgn(now.value)}% SAAR (Q${q[2]} ${q[1]})`;
  const vs = prev ? `prev ${sgn(prev.value)}%` : "prev n/a";
  return { ref: { year: Number(q[1]), month: Number(q[2]) * 3 }, actual, vs, facts: [actual, vs] };
}

/** PCE price index level (T20804 line 1, monthly) → m/m. */
export function computePce(json: unknown): Computed | null {
  const [now, prev] = parseBeaLine1(json);
  if (!now || !prev) return null;
  const mm = /^(\d{4})M(\d{2})$/.exec(now.period);
  if (!mm) return null;
  const ch = pctCh(now.value, prev.value);
  if (ch == null) return null;
  const actual = `PCE price index ${sgn(ch)}% MoM`;
  return { ref: { year: Number(mm[1]), month: Number(mm[2]) }, actual, vs: "BEA T20804", facts: [actual] };
}

/* ── Fetch ─────────────────────────────────────────────────────────────── */

export interface ActualDeps {
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  ua?: string;
}

export async function fetchBls(seriesIds: string[], startYear: number, endYear: number, deps: ActualDeps = {}): Promise<Record<string, Obs[]>> {
  const f = deps.fetchImpl ?? fetch;
  const key = (deps.env ?? process.env).BLS_API_KEY?.trim();
  const res = await f(BLS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": deps.ua ?? "LedgerDesk-actuals/1.0" },
    body: JSON.stringify({ seriesid: seriesIds, startyear: String(startYear), endyear: String(endYear), ...(key ? { registrationkey: key } : {}) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`BLS API ${res.status}`);
  const json = (await res.json()) as { status?: string; message?: string[] };
  if (json.status && json.status !== "REQUEST_SUCCEEDED") throw new Error(`BLS API: ${(json.message ?? []).join("; ").slice(0, 120) || json.status}`);
  return parseBls(json);
}

async function fetchBea(table: string, frequency: "Q" | "M", year: number, deps: ActualDeps): Promise<unknown> {
  const key = (deps.env ?? process.env).BEA_API_KEY?.trim();
  if (!key) throw new Error("BEA_API_KEY not set — BEA actuals skipped");
  const f = deps.fetchImpl ?? fetch;
  const u = new URL(BEA_API);
  for (const [k, v] of Object.entries({ UserID: key, method: "GetData", DataSetName: "NIPA", TableName: table, Frequency: frequency, Year: `${year - 1},${year}`, ResultFormat: "JSON" }))
    u.searchParams.set(k, v);
  const res = await f(u.toString(), { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`BEA API ${res.status}`);
  return res.json();
}

export async function computeActual(kind: ActualKind, year: number, deps: ActualDeps = {}): Promise<Computed | null> {
  if (kind === "cpi" || kind === "ppi") {
    const s = BLS_SERIES[kind];
    return computeInflation(kind, await fetchBls([s.sa, s.nsa, s.coreSa, s.coreNsa], year - 2, year, deps));
  }
  if (kind === "nfp") {
    const s = BLS_SERIES.nfp;
    return computeNfp(await fetchBls([s.level, s.urate, s.ahe], year - 1, year, deps));
  }
  if (kind === "gdp") return computeGdp(await fetchBea("T10101", "Q", year, deps));
  return computePce(await fetchBea("T20804", "M", year, deps));
}

/* ── Notes and the merge ───────────────────────────────────────────────── */

export function deterministicNote(kind: ActualKind): string {
  const prelim = kind === "nfp" ? " Payrolls are preliminary — BLS revises them in the next two reports." : "";
  return `${kind === "gdp" || kind === "pce" ? "BEA" : "BLS"} official, stamped by code from the agency API.${prelim} Source: ${KIND_SOURCE[kind]}`;
}

export const NOTE_INSTRUCTIONS =
  "You write a one-sentence note for a trading desk's record of an official US economic release. The numbers are given and final; " +
  "do not restate, round, add or compute any number — write words only (what moved, hot/soft/in-line versus the prior period). " +
  "No forecasts, no trade advice. Reply with the sentence only.";

/**
 * Grok writes the prose; the code keeps the numbers. A note with any number the code did not compute is dropped for
 * the deterministic note. The agency URL is always appended by code.
 */
export async function noteFor(
  kind: ActualKind,
  rowName: string,
  c: Computed,
  search: (a: Parameters<typeof grokSearch>[0]) => Promise<GrokSearchResult> = grokSearch,
): Promise<{ note: string; byModel: boolean; rejected: string | null }> {
  const fallback = deterministicNote(kind);
  const res = await search({ instructions: NOTE_INSTRUCTIONS, input: `${rowName}: ${c.actual}; ${c.vs}`, ms: 15_000, webSearch: false, maxTokens: 120 });
  if (!res.ok) return { note: fallback, byModel: false, rejected: res.error };
  const text = res.text.replace(/\s+/g, " ").trim().slice(0, 240);
  const bad = ungroundedNumbers(text, [...c.facts, rowName]);
  if (bad.length) return { note: fallback, byModel: false, rejected: `ungrounded numbers: ${bad.join(", ")}` };
  return { note: `${text} Source: ${KIND_SOURCE[kind]}`, byModel: true, rejected: null };
}

/** True when the prints already carry this release (same date, same release family). Stamps never overwrite. */
export function alreadyStamped(prints: WeekPrint[], date: string, rowName: string): boolean {
  const k = kindOf(rowName);
  return prints.some((p) => p.date === date && (p.name === rowName || (k != null && kindOf(p.name) === k)));
}

/** Append (never overwrite), keep date order. Returns a new array. */
export function mergePrint(prints: WeekPrint[], row: WeekPrint): WeekPrint[] {
  if (alreadyStamped(prints, row.date, row.name)) return prints;
  return [...prints, row].sort((a, b) => a.date.localeCompare(b.date));
}

/** The computed reference month must be the one the row names, e.g. "CPI (Sep)" ↔ September. Guards a stale API answer. */
export function refMatches(rowName: string, c: Computed): boolean {
  const m = /\((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.exec(rowName);
  if (!m) return true;
  return MON_SHORT[c.ref.month - 1] === m[1];
}
