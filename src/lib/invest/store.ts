/**
 * Local state for the share book — one append-only ledger of entries.
 *
 * WHAT CHANGED AND WHY (2026-09-26)
 * v1 kept two arrays: positions (one merged row per ticker) and a sweep log.
 * Merging buys destroyed the per-lot holding period the tax clock runs on,
 * and the two arrays never met, so a swept month could go unbought forever.
 * v2 is one ledger (ledger.ts) of buys, sells, dividends, sweeps and voids.
 * Everything the tab shows is DERIVED from it by `replay`, so there is one
 * record and nothing to drift.
 *
 * v1 data is migrated once, read-only: each merged position becomes one lot
 * flagged `migrated` (its date is the EARLIEST buy of the merge, so its
 * long-term flag may be early and the tab says so), and each logged month
 * becomes a sweep entry. The v1 keys are left in place, untouched.
 *
 * DURABILITY
 * localStorage is one browser. `sync.ts` mirrors every entry to the
 * `invest_ledger` table (append-only, insert-or-ignore by id) and pulls the
 * other devices' entries back, so a cleared cache no longer deletes the
 * habit record. Export/import below is the manual copy of the same thing.
 */

import type { Position } from "./book";
import type { SweepPlan } from "./policy";
import { validateSweepMonth } from "./policy";
import {
  replay,
  isDate,
  type BuyEntry,
  type BuySource,
  type InvestEntry,
  type LedgerRead,
  type SweepEntry,
  heldPositions,
  previewSale,
} from "./ledger";
import type { Sleeve } from "./universe";

const LEDGER_KEY = "ledger.invest.ledger.v2";
const POS_KEY_V1 = "ledger.invest.positions.v1";
const SWEEP_KEY_V1 = "ledger.invest.sweeps.v1";
const EVENT = "ledger-invest";
/** A personal ledger; this is years of monthly entries with room to spare. */
const MAX_ENTRIES = 5_000;

export interface SweepRecord {
  /** YYYY-MM — one record per month, ever. */
  month: string;
  verdict: SweepPlan["verdict"];
  realizedUsd: number;
  rentUsd: number;
  restoreUsd: number;
  sweptUsd: number;
  rate: number;
  loggedAt: string;
  note: string;
}

function emit(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeInvest(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const on = () => fn();
  window.addEventListener(EVENT, on);
  // Another tab of the desk wrote the ledger.
  const onStorage = (e: StorageEvent) => {
    if (e.key === LEDGER_KEY) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, on);
    window.removeEventListener("storage", onStorage);
  };
}

function readRaw<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Write, and SAY whether it stuck — a full or blocked store must not look saved. */
function writeEntries(rows: InvestEntry[]): { ok: boolean; why: string } {
  if (typeof window === "undefined") return { ok: false, why: "no browser storage here" };
  try {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(rows.slice(-MAX_ENTRIES)));
  } catch (e) {
    return { ok: false, why: `Browser storage refused the write (${String(e).slice(0, 80)}). Export the ledger now.` };
  }
  emit();
  return { ok: true, why: "saved" };
}

export function newId(prefix: string): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}-${Date.now().toString(36)}-${rnd}`;
}

/** Today on the New York calendar, YYYY-MM-DD. */
export function etToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
}

export function etMonth(now = new Date()): string {
  return etToday(now).slice(0, 7);
}

/* ------------------------------------------------------------------ */
/* v1 → v2                                                             */
/* ------------------------------------------------------------------ */

interface V1Position {
  ticker: string;
  sleeve: Sleeve;
  shares: number;
  costUsd: number;
  openedAt: string;
}

function migrateV1(): InvestEntry[] {
  const out: InvestEntry[] = [];
  const pos = readRaw<V1Position[]>(POS_KEY_V1, []);
  if (Array.isArray(pos)) {
    for (const p of pos) {
      if (!p || !(p.shares > 0) || !(p.costUsd > 0)) continue;
      const date = typeof p.openedAt === "string" ? p.openedAt.slice(0, 10) : "";
      out.push({
        id: `v1-buy-${p.ticker}`,
        kind: "buy",
        date: isDate(date) ? date : etToday(),
        loggedAt: typeof p.openedAt === "string" ? p.openedAt : new Date().toISOString(),
        ticker: p.ticker,
        sleeve: p.sleeve,
        shares: p.shares,
        costUsd: p.costUsd,
        source: "other",
        migrated: true,
        note: "Merged row from before lots were tracked — dated to its EARLIEST buy, so the long-term flag may be early.",
      });
    }
  }
  const sweeps = readRaw<SweepRecord[]>(SWEEP_KEY_V1, []);
  if (Array.isArray(sweeps)) {
    for (const r of sweeps) {
      if (!r || typeof r.month !== "string") continue;
      out.push({
        id: `sweep:${r.month}`,
        kind: "sweep",
        date: `${r.month}-01`,
        loggedAt: r.loggedAt ?? new Date().toISOString(),
        month: r.month,
        verdict: r.verdict,
        realizedUsd: r.realizedUsd,
        rentUsd: r.rentUsd,
        restoreUsd: r.restoreUsd,
        sweptUsd: r.sweptUsd,
        rate: r.rate,
        note: r.note,
      });
    }
  }
  return out;
}

export function loadEntries(): InvestEntry[] {
  if (typeof window === "undefined") return [];
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(LEDGER_KEY);
  } catch {
    return [];
  }
  if (raw == null) {
    const migrated = migrateV1();
    if (migrated.length) writeEntries(migrated);
    return migrated;
  }
  try {
    const rows = JSON.parse(raw) as InvestEntry[];
    return Array.isArray(rows) ? rows.filter(isEntry) : [];
  } catch {
    return [];
  }
}

export function loadLedger(): LedgerRead {
  return replay(loadEntries());
}

/* ------------------------------------------------------------------ */
/* Validation — every entry that enters the ledger, from any source    */
/* ------------------------------------------------------------------ */

const TICKER = /^[A-Z][A-Z.-]{0,9}$/;
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);

export function isEntry(e: unknown): e is InvestEntry {
  if (!e || typeof e !== "object") return false;
  const x = e as Record<string, unknown>;
  if (typeof x.id !== "string" || x.id.length < 3 || x.id.length > 120) return false;
  if (typeof x.date !== "string" || !isDate(x.date)) return false;
  if (typeof x.loggedAt !== "string") return false;
  switch (x.kind) {
    case "buy":
      return (
        typeof x.ticker === "string" &&
        TICKER.test(x.ticker) &&
        ["ballast", "compounder", "drypowder"].includes(String(x.sleeve)) &&
        num(x.shares) &&
        (x.shares as number) > 0 &&
        num(x.costUsd) &&
        (x.costUsd as number) > 0 &&
        ["sweep", "dividend", "other"].includes(String(x.source))
      );
    case "sell":
      return (
        typeof x.ticker === "string" &&
        TICKER.test(x.ticker) &&
        num(x.shares) &&
        (x.shares as number) > 0 &&
        num(x.proceedsUsd) &&
        (x.proceedsUsd as number) >= 0
      );
    case "dividend":
      return (
        typeof x.ticker === "string" &&
        TICKER.test(x.ticker) &&
        num(x.amountUsd) &&
        (x.amountUsd as number) > 0 &&
        typeof x.reinvested === "boolean"
      );
    case "sweep":
      return (
        typeof x.month === "string" &&
        /^\d{4}-(0[1-9]|1[0-2])$/.test(x.month) &&
        num(x.realizedUsd) &&
        num(x.sweptUsd) &&
        num(x.rate) &&
        num(x.rentUsd) &&
        num(x.restoreUsd)
      );
    case "void":
      return typeof x.targetId === "string" && typeof x.reason === "string" && x.reason.trim().length >= 4;
    default:
      return false;
  }
}

export interface WriteResult {
  ok: boolean;
  why: string;
  entry?: InvestEntry;
}

function append(entry: InvestEntry): WriteResult {
  if (!isEntry(entry)) return { ok: false, why: "That entry is malformed and was not written." };
  const rows = loadEntries();
  if (rows.some((r) => r.id === entry.id)) return { ok: false, why: `${entry.id} is already in the ledger.` };
  const w = writeEntries([...rows, entry]);
  return w.ok ? { ok: true, why: "saved", entry } : { ok: false, why: w.why };
}

/* ------------------------------------------------------------------ */
/* Writers                                                             */
/* ------------------------------------------------------------------ */

export function recordBuy(b: {
  ticker: string;
  sleeve: Sleeve;
  shares: number;
  costUsd: number;
  date: string;
  source: BuySource;
  note?: string;
}): WriteResult {
  const entry: BuyEntry = {
    id: newId("buy"),
    kind: "buy",
    loggedAt: new Date().toISOString(),
    ...b,
  };
  return append(entry);
}

export function recordSell(s: { ticker: string; shares: number; proceedsUsd: number; date: string; note?: string }): WriteResult {
  const check = previewSale(loadLedger(), s);
  if (!check.ok) return { ok: false, why: check.why };
  return append({ id: newId("sell"), kind: "sell", loggedAt: new Date().toISOString(), ...s });
}

/** A dividend is income either way; reinvested, it is ALSO a new lot. */
export function recordDividend(d: {
  ticker: string;
  amountUsd: number;
  date: string;
  reinvested: boolean;
  shares?: number;
  sleeve?: Sleeve;
}): WriteResult {
  const div = append({
    id: newId("div"),
    kind: "dividend",
    loggedAt: new Date().toISOString(),
    date: d.date,
    ticker: d.ticker,
    amountUsd: d.amountUsd,
    reinvested: d.reinvested,
  });
  if (!div.ok || !d.reinvested) return div;
  if (!(d.shares && d.shares > 0)) {
    return { ok: true, why: "Dividend recorded. Add the reinvested shares as a buy when the confirm shows them." };
  }
  return recordBuy({
    ticker: d.ticker,
    sleeve: d.sleeve ?? "ballast",
    shares: d.shares,
    costUsd: d.amountUsd,
    date: d.date,
    source: "dividend",
    note: "dividend reinvestment — its own lot, its own holding period",
  });
}

export function voidEntry(targetId: string, reason: string): WriteResult {
  const rows = loadEntries();
  const target = rows.find((r) => r.id === targetId);
  if (!target) return { ok: false, why: "Nothing with that id to void." };
  if (target.kind === "void") return { ok: false, why: "A void cannot be voided — record the entry again instead." };
  if (rows.some((r) => r.kind === "void" && r.targetId === targetId)) return { ok: false, why: "Already voided." };
  if (reason.trim().length < 4) return { ok: false, why: "Say why — a correction without a reason is an edit." };
  return append({
    id: newId("void"),
    kind: "void",
    date: etToday(),
    loggedAt: new Date().toISOString(),
    targetId,
    reason: reason.trim(),
  });
}

/* ------------------------------------------------------------------ */
/* The v1 surface, kept so every caller keeps working                  */
/* ------------------------------------------------------------------ */

export function loadPositions(): Position[] {
  return heldPositions(loadLedger(), etToday()).map((p) => ({
    ticker: p.ticker,
    sleeve: p.sleeve,
    shares: p.shares,
    costUsd: p.costUsd,
    openedAt: p.openedAt,
  }));
}

/** Kept for callers; now writes a LOT instead of merging into a row. */
export function addShares(next: Position): Position[] {
  recordBuy({
    ticker: next.ticker,
    sleeve: next.sleeve,
    shares: next.shares,
    costUsd: next.costUsd,
    date: isDate(next.openedAt.slice(0, 10)) ? next.openedAt.slice(0, 10) : etToday(),
    source: "other",
  });
  return loadPositions();
}

export function loadSweeps(): SweepRecord[] {
  return loadLedger()
    .sweeps.map((s) => ({
      month: s.month,
      verdict: s.verdict,
      realizedUsd: s.realizedUsd,
      rentUsd: s.rentUsd,
      restoreUsd: s.restoreUsd,
      sweptUsd: s.sweptUsd,
      rate: s.rate,
      loggedAt: s.loggedAt,
      note: s.note ?? "",
    }))
    .sort((a, b) => (a.month < b.month ? 1 : -1));
}

/**
 * Record a month. Refuses a month that has not ended, and one already
 * logged. A voided month may be logged again (new id), which is how a typo
 * is corrected without editing history.
 */
export function logSweep(rec: SweepRecord): { logged: boolean; why: string } {
  const valid = validateSweepMonth(rec.month, etMonth());
  if (!valid.ok) return { logged: false, why: valid.why };
  const read = loadLedger();
  if (read.sweeps.some((s) => s.month === rec.month)) {
    return { logged: false, why: `${rec.month} is already logged. A month is priced once — void it with a reason to correct it.` };
  }
  const priorIds = read.entries.filter((e) => e.kind === "sweep" && e.month === rec.month).length;
  const entry: SweepEntry = {
    id: priorIds ? `sweep:${rec.month}:r${priorIds}` : `sweep:${rec.month}`,
    kind: "sweep",
    date: `${rec.month}-01`,
    loggedAt: rec.loggedAt,
    month: rec.month,
    verdict: rec.verdict,
    realizedUsd: rec.realizedUsd,
    rentUsd: rec.rentUsd,
    restoreUsd: rec.restoreUsd,
    sweptUsd: rec.sweptUsd,
    rate: rec.rate,
    note: rec.note,
  };
  const w = append(entry);
  return { logged: w.ok, why: w.ok ? "logged" : w.why };
}

/** Months logged, for the rate ladder in policy.ts. */
export function closedMonths(): number {
  return loadLedger().sweeps.length;
}

/** Total ever swept — the only "performance" number worth showing early. */
export function totalSwept(): number {
  return Math.round(loadLedger().sweeps.reduce((s, r) => s + r.sweptUsd, 0) * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Export / import — the manual backup                                 */
/* ------------------------------------------------------------------ */

export interface InvestExport {
  app: "ledger-desk";
  kind: "invest-ledger";
  version: 2;
  exportedAt: string;
  entries: InvestEntry[];
}

export function exportLedger(): string {
  const doc: InvestExport = {
    app: "ledger-desk",
    kind: "invest-ledger",
    version: 2,
    exportedAt: new Date().toISOString(),
    entries: loadEntries(),
  };
  return JSON.stringify(doc, null, 1);
}

/**
 * Merge an export in. Union by id — an entry already here is kept as is, so
 * importing the same file twice changes nothing and an import can never
 * overwrite history. Malformed rows are counted and refused, not repaired.
 */
export function importLedger(text: string): { ok: boolean; added: number; skipped: number; refused: number; why: string } {
  let doc: Partial<InvestExport>;
  try {
    doc = JSON.parse(text) as Partial<InvestExport>;
  } catch {
    return { ok: false, added: 0, skipped: 0, refused: 0, why: "Not JSON." };
  }
  if (doc?.kind !== "invest-ledger" || !Array.isArray(doc.entries)) {
    return { ok: false, added: 0, skipped: 0, refused: 0, why: "Not an invest-ledger export." };
  }
  const rows = loadEntries();
  const have = new Set(rows.map((r) => r.id));
  let added = 0;
  let skipped = 0;
  let refused = 0;
  const next = [...rows];
  for (const e of doc.entries) {
    if (!isEntry(e)) {
      refused++;
      continue;
    }
    if (have.has(e.id)) {
      skipped++;
      continue;
    }
    have.add(e.id);
    next.push(e);
    added++;
  }
  if (added === 0) return { ok: true, added, skipped, refused, why: "Nothing new in that file." };
  const w = writeEntries(next);
  return { ok: w.ok, added, skipped, refused, why: w.ok ? `Imported ${added} entr${added === 1 ? "y" : "ies"}.` : w.why };
}

/**
 * Used by sync.ts ONLY, for the one case where the server is authoritative:
 * an id both sides hold with different bodies (a month logged on two devices
 * offline). The server's copy replaces this browser's; sync reports it.
 */
export function replaceEntries(authoritative: InvestEntry[]): void {
  const byId = new Map(authoritative.filter(isEntry).map((e) => [e.id, e]));
  if (!byId.size) return;
  writeEntries(loadEntries().map((e) => byId.get(e.id) ?? e));
}

/** Used by sync.ts: merge server rows in without re-announcing each one. */
export function mergeEntries(incoming: InvestEntry[]): { added: number } {
  const rows = loadEntries();
  const have = new Set(rows.map((r) => r.id));
  const fresh = incoming.filter((e) => isEntry(e) && !have.has(e.id));
  if (!fresh.length) return { added: 0 };
  writeEntries([...rows, ...fresh]);
  return { added: fresh.length };
}
