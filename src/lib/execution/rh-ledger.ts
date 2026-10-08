/**
 * Positions this desk opened on Agentic. A Robinhood long we did not write
 * here is not ours: the cycle will not close it and will not open another.
 * One process shares one ledger so two requests cannot forget each other's row.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { RH_MIN_PLACE_GAP_MS, RH_PREFERRED_ACCOUNT_NUMBER } from "./rh-autofire-gates";
import { memoryLedger, type DeskOpen, type RhLedger } from "./rh-tools";
import type { Sql } from "@/lib/db";

const PATH = process.env.RH_LEDGER_PATH || "/tmp/ledger-desk-rh.json";
const cache = new Map<string, RhLedger>();

export function fileLedger(path = PATH): RhLedger {
  const hit = cache.get(path);
  if (hit) return hit;
  const mem = memoryLedger();
  let loaded = false;
  let chain: Promise<unknown> = Promise.resolve();
  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  async function load(): Promise<void> {
    if (loaded) return;
    loaded = true;
    try {
      const raw = JSON.parse(await readFile(path, "utf8")) as { rows?: DeskOpen[]; placedAt?: number | null };
      for (const row of raw.rows ?? []) await mem.put(row);
      if (typeof raw.placedAt === "number") await mem.notePlace(raw.placedAt);
    } catch {
      /* first run */
    }
  }
  async function save(): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ rows: await mem.list(), placedAt: await mem.lastPlaceAt() }), "utf8");
  }
  const ledger: RhLedger = {
    list() {
      return serialized(async () => {
        await load();
        return mem.list();
      });
    },
    put(row) {
      return serialized(async () => {
        await load();
        await mem.put(row);
        await save();
      });
    },
    drop(optionId) {
      return serialized(async () => {
        await load();
        await mem.drop(optionId);
        await save();
      });
    },
    notePlace(at) {
      return serialized(async () => {
        await load();
        await mem.notePlace(at);
        await save();
      });
    },
    lastPlaceAt() {
      return serialized(async () => {
        await load();
        return mem.lastPlaceAt();
      });
    },
    claim(at) {
      return serialized(async () => {
        await load();
        const ok = await mem.claim(at);
        if (ok) await save();
        return ok;
      });
    },
  };
  cache.set(path, ledger);
  return ledger;
}

function asRows(raw: unknown): DeskOpen[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is DeskOpen => !!r && typeof r === "object" && typeof (r as DeskOpen).optionId === "string");
}

/**
 * The book the floor and the cron share. Keyed by the trade account, not by
 * which process happened to open the contract.
 */
export function sqlLedger(sql: Sql, account = RH_PREFERRED_ACCOUNT_NUMBER): RhLedger {
  let chain: Promise<unknown> = Promise.resolve();
  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  async function load(): Promise<{ rows: DeskOpen[]; placedAt: number | null }> {
    const found = await sql.query<{ rows: unknown; placed_at: number | null }>(
      `select rows, placed_at from rh_desk_book where account_number = $1`,
      [account],
    );
    const row = found[0];
    if (!row) return { rows: [], placedAt: null };
    const placed = typeof row.placed_at === "number" ? row.placed_at : null;
    return { rows: asRows(row.rows), placedAt: placed };
  }
  async function save(rows: DeskOpen[], placedAt: number | null): Promise<void> {
    await sql.query(
      `insert into rh_desk_book (account_number, rows, placed_at)
       values ($1, $2::jsonb, $3)
       on conflict (account_number) do update set rows = excluded.rows, placed_at = excluded.placed_at`,
      [account, JSON.stringify(rows), placedAt],
    );
  }
  return {
    list() {
      return serialized(async () => (await load()).rows);
    },
    put(row) {
      return serialized(async () => {
        const book = await load();
        const i = book.rows.findIndex((r) => r.optionId === row.optionId);
        if (i >= 0) book.rows[i] = row;
        else book.rows.push(row);
        const placed = book.placedAt == null || row.openedAt > book.placedAt ? row.openedAt : book.placedAt;
        await save(book.rows, placed);
      });
    },
    drop(optionId) {
      return serialized(async () => {
        const book = await load();
        await save(
          book.rows.filter((r) => r.optionId !== optionId),
          book.placedAt,
        );
      });
    },
    notePlace(at) {
      return serialized(async () => {
        const book = await load();
        const placed = book.placedAt == null || at > book.placedAt ? at : book.placedAt;
        await save(book.rows, placed);
      });
    },
    lastPlaceAt() {
      return serialized(async () => {
        const book = await load();
        const from = book.rows.reduce<number | null>((m, r) => (m == null || r.openedAt > m ? r.openedAt : m), null);
        if (book.placedAt == null) return from;
        if (from == null) return book.placedAt;
        return Math.max(book.placedAt, from);
      });
    },
    claim(at) {
      return serialized(async () => {
        if (!Number.isFinite(at)) return false;
        await sql.query(
          `insert into rh_desk_book (account_number, rows, placed_at) values ($1, '[]'::jsonb, null) on conflict (account_number) do nothing`,
          [account],
        );
        const won = await sql.query<{ placed_at: number }>(
          `update rh_desk_book set placed_at = $2
           where account_number = $1 and (placed_at is null or $2 - placed_at >= $3)
           returning placed_at`,
          [account, at, RH_MIN_PLACE_GAP_MS],
        );
        return won.length === 1;
      });
    },
  };
}