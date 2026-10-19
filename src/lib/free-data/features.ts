/**
 * Free data feeds — desk/Brain/Floor side (TS twin of feeds/free_data/*.py). SHADOW / LOG-ONLY.
 *
 * Config: shared/free-data.json (deliberately OUTSIDE shared/desk-rules.json, so RULES_HASH is unchanged).
 * Nothing here is read by a gate, the score, the fire path or order review. The card carries the read as
 * `freeData` (wire `freeData`), Brain shows one narrative line, the Floor one `freeDataShadow` line, and the
 * watcher logs it to free_data_shadow.jsonl.
 *
 * - Forex Factory free weekly JSON: normalized to CT, USD High/Medium scope, raw surprise sign once an `actual`
 *   exists (the free feed does not carry actuals today), and a shadow 07:30 CT print-window flag. The existing news
 *   gate (src/lib/trading/news.ts) is untouched.
 * - Cboe VIX / VIX9D / VIX3M daily closes → VIX9D/VIX and VIX/VIX3M ratios + regime. Closed days only.
 * Polite: per-instance cache, FF at most once per 15 min, 429 → back off (Retry-After or 30 min), every fetch has
 * a 4 s timeout, and any failure keeps the last good read. Default OFF: on only when DESK_FREE_DATA is exactly "1" or "true".
 */
import CFG from "../../../shared/free-data.json";

export type FfRaw = { title?: string; country?: string; date?: string; impact?: string; forecast?: string; previous?: string; actual?: string };
export interface FfRow {
  title: string; country: string; impact: string; tsMs: number; dateCt: string; timeCt: string;
  forecast: string | null; previous: string | null; actual: string | null;
  forecastNum: number | null; previousNum: number | null; actualNum: number | null;
  surpriseSign: 1 | -1 | 0 | null; inScope: boolean;
}
export interface VixRead { date: string; vix: number; vix9d: number; vix3m: number; vix9dVix: number; vixVix3m: number; regime: "backwardation" | "flat" | "contango"; frontInverted: boolean }
export interface FreeDataRead {
  mode: "shadow"; live: false; asOf: string;
  ff: { source: "network" | "cache" | "none"; usdScoped: FfRow[]; nextPrint: FfRow | null; printWindow: { flag: boolean; events: string[] }; actualsAvailable: boolean } | null;
  vix: VixRead | null;
}

const CT = "America/Chicago";
const NUM = /^\s*([<>]?)\s*(-?\d+(?:\.\d+)?)\s*([KMBT%]?)\s*$/i;
const MULT: Record<string, number> = { "": 1, "%": 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

export function parseNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = NUM.exec(String(v).replace(/,/g, ""));
  return m ? Number(m[2]) * MULT[m[3].toUpperCase()] : null;
}

/** sign(actual − forecast); null when either is missing. Raw sign only (no "good for USD" reading). */
export function surpriseSign(actual: unknown, forecast: unknown): 1 | -1 | 0 | null {
  const a = parseNum(actual), f = parseNum(forecast);
  if (a == null || f == null) return null;
  const d = Math.round((a - f) * 1e10) / 1e10;
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

function ctParts(ms: number): { date: string; time: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: CT, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function normalizeFf(events: FfRaw[]): FfRow[] {
  const c = CFG.ffCalendar;
  const out: FfRow[] = [];
  for (const e of events ?? []) {
    const tsMs = Date.parse(String(e?.date ?? ""));
    if (!Number.isFinite(tsMs)) continue;
    const { date, time } = ctParts(tsMs);
    out.push({
      title: String(e.title ?? ""), country: String(e.country ?? ""), impact: String(e.impact ?? ""), tsMs, dateCt: date, timeCt: time,
      forecast: e.forecast || null, previous: e.previous || null, actual: e.actual || null,
      forecastNum: parseNum(e.forecast), previousNum: parseNum(e.previous), actualNum: parseNum(e.actual),
      surpriseSign: surpriseSign(e.actual, e.forecast),
      inScope: c.countries.includes(String(e.country)) && c.impacts.includes(String(e.impact)),
    });
  }
  return out.sort((a, b) => a.tsMs - b.tsMs);
}

/** Shadow flag: within [−beforeMin, +afterMin] of a 07:30 CT USD print (any impact). Log-only. */
export function printWindow(rows: FfRow[], nowMs: number): { flag: boolean; events: string[] } {
  const pw = CFG.ffCalendar.printWindow;
  const hits = rows.filter((r) => pw.countries.includes(r.country) && pw.timesCt.includes(r.timeCt)
    && nowMs >= r.tsMs - pw.beforeMin * 60_000 && nowMs <= r.tsMs + pw.afterMin * 60_000);
  return { flag: hits.length > 0, events: hits.map((h) => h.title) };
}

export function nextPrint(rows: FfRow[], nowMs: number): FfRow | null {
  return rows.find((r) => r.inScope && r.tsMs >= nowMs) ?? null;
}

export function parseCboeCsv(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of String(text ?? "").split(/\r?\n/).slice(1)) {
    const [d, , , , close] = line.split(",");
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((d ?? "").trim());
    const v = Number(close);
    if (m && Number.isFinite(v)) out[`${m[3]}-${m[1]}-${m[2]}`] = v;
  }
  return out;
}

export function vixRatios(vix: number, vix9d: number, vix3m: number): Omit<VixRead, "date"> {
  const rg = CFG.vix.regime;
  const r93 = Math.round((vix9d / vix) * 1e4) / 1e4;
  const r3m = Math.round((vix / vix3m) * 1e4) / 1e4;
  const raw3m = vix / vix3m;
  const regime = raw3m >= rg.backwardationAt ? "backwardation" : raw3m >= rg.flatFrom ? "flat" : "contango";
  return { vix, vix9d, vix3m, vix9dVix: r93, vixVix3m: r3m, regime, frontInverted: vix9d / vix >= rg.frontInvertedAt };
}

/** Latest CLOSED day common to all three series; today's row only after settleCt (15:30 CT). */
export function termStructure(s: { VIX: Record<string, number>; VIX9D: Record<string, number>; VIX3M: Record<string, number> }, nowMs: number): VixRead | null {
  const { date: today, time } = ctParts(nowMs);
  const settled = time >= CFG.vix.settleCt;
  const days = Object.keys(s.VIX).filter((d) => d in s.VIX9D && d in s.VIX3M && (d < today || (d === today && settled))).sort();
  const d = days.at(-1);
  return d ? { date: d, ...vixRatios(s.VIX[d], s.VIX9D[d], s.VIX3M[d]) } : null;
}

/** Release Watch: free data is OFF unless DESK_FREE_DATA is exactly "1" or "true" (unset, "0", anything else → off). */
export function freeDataEnabled(env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): boolean {
  const v = env.DESK_FREE_DATA;
  return v === "1" || v === "true";
}

/**
 * Brain/Floor line. The server gate is freeDataRead (desk.freeData is null unless the flag is on), so in the browser
 * (no process.env) a null read means off. Pass `env` to apply the flag again explicitly (server/tests).
 */
export function freeDataSeatLine(r: FreeDataRead | null | undefined, env?: Record<string, string | undefined>): string | null {
  if (!r || (env && !freeDataEnabled(env))) return null;
  const parts: string[] = [];
  const n = r.ff?.nextPrint;
  if (n) parts.push(`next USD print ${n.title} ${n.dateCt} ${n.timeCt} CT${n.forecast ? ` f ${n.forecast}` : ""}`);
  if (r.ff?.printWindow.flag) parts.push(`07:30 CT print window ON (${r.ff.printWindow.events.join(", ")})`);
  if (r.vix) parts.push(`VIX ${r.vix.vix} · 9D/VIX ${r.vix.vix9dVix} · VIX/3M ${r.vix.vixVix3m} ${r.vix.regime}${r.vix.frontInverted ? ", front inverted" : ""} (${r.vix.date})`);
  return parts.length ? `Free data (shadow, no gate): ${parts.join(" · ")}` : null;
}

// ---- per-instance polite cache ------------------------------------------------------------------------------
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const cache: { ffAt: number; ffRows: FfRow[] | null; ffBackoffUntil: number; vixAt: number; vix: Parameters<typeof termStructure>[0] | null; inflight: Promise<void> | null; coldFailUntil: number } =
  { ffAt: 0, ffRows: null, ffBackoffUntil: 0, vixAt: 0, vix: null, inflight: null, coldFailUntil: 0 };

/** After a refresh that leaves the cache empty, builds stop waiting on the cold path for this long (negative cache). */
export const COLD_FAIL_TTL_MS = 5 * 60_000;
/** Default cold-start wait inside a desk build (was 1.2 s). */
export const COLD_WAIT_MS = 400;

export function _resetFreeDataCache(): void {
  Object.assign(cache, { ffAt: 0, ffRows: null, ffBackoffUntil: 0, vixAt: 0, vix: null, inflight: null, coldFailUntil: 0 });
}

async function refresh(nowMs: number, f: Fetcher): Promise<void> {
  const c = CFG.ffCalendar;
  const ffDue = nowMs - cache.ffAt >= c.minFetchIntervalS * 1000 && nowMs >= cache.ffBackoffUntil;
  if (ffDue) {
    cache.ffAt = nowMs;   // stamp the attempt: a failure still waits the full 15 min
    try {
      const r = await f(c.url, { signal: AbortSignal.timeout(4000), headers: { "user-agent": "ledger-desk-free-data/1.0 (cached, <=1 req/15min)" } });
      if (r.status === 429) {
        const ra = Number(r.headers.get("retry-after"));
        cache.ffBackoffUntil = nowMs + Math.max(Number.isFinite(ra) && ra > 0 ? ra * 1000 : c.backoff429S * 1000, c.minFetchIntervalS * 1000);
      } else if (r.ok) cache.ffRows = normalizeFf((await r.json()) as FfRaw[]);
    } catch { /* keep last good */ }
  }
  if (nowMs - cache.vixAt >= CFG.vix.minFetchIntervalS * 1000) {
    cache.vixAt = nowMs;
    try {
      const u = CFG.vix.urls;
      const [a, b, d] = await Promise.all([u.VIX, u.VIX9D, u.VIX3M].map(async (url) => {
        const r = await f(url, { signal: AbortSignal.timeout(4000), redirect: "follow" });
        if (!r.ok) throw new Error(String(r.status));
        return parseCboeCsv(await r.text());
      }));
      if (Object.keys(a).length && Object.keys(b).length && Object.keys(d).length) cache.vix = { VIX: a, VIX9D: b, VIX3M: d };
    } catch { /* keep last good */ }
  }
}

export function freeDataFromCache(nowMs: number): FreeDataRead {
  const rows = cache.ffRows;
  return {
    mode: "shadow", live: false, asOf: new Date(nowMs).toISOString(),
    ff: rows
      ? { source: "cache", usdScoped: rows.filter((r) => r.inScope), nextPrint: nextPrint(rows, nowMs), printWindow: printWindow(rows, nowMs), actualsAvailable: rows.some((r) => r.actual != null) }
      : null,
    vix: cache.vix ? termStructure(cache.vix, nowMs) : null,
  };
}

/**
 * Never throws, never blocks long: a warm instance answers from cache and refreshes in the background; a cold one
 * waits at most `coldWaitMs` for the first fill. Default OFF: null (no FF/Cboe fetch) unless freeDataEnabled(env).
 */
export async function freeDataRead(nowMs = Date.now(), f: Fetcher = fetch, coldWaitMs = COLD_WAIT_MS, env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): Promise<FreeDataRead | null> {
  if (!freeDataEnabled(env)) return null;
  try {
    if (!cache.inflight) cache.inflight = refresh(nowMs, f).catch(() => {}).finally(() => {
      cache.inflight = null;
      if (!cache.ffRows && !cache.vix) cache.coldFailUntil = nowMs + COLD_FAIL_TTL_MS;   // negative cache
    });
    if (!cache.ffRows && !cache.vix && nowMs >= cache.coldFailUntil) {
      let t: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([cache.inflight, new Promise((r) => { t = setTimeout(r, coldWaitMs); })]);
      if (t) clearTimeout(t);
    }
    return freeDataFromCache(nowMs);
  } catch {
    return null;
  }
}
