/**
 * Positions this desk opened on Agentic. A Robinhood long we did not write
 * here is not ours: the cycle will not close it and will not open another.
 * One process shares one ledger so two requests cannot forget each other's row.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { memoryLedger, type DeskOpen, type RhLedger } from "./rh-tools";

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
  };
  cache.set(path, ledger);
  return ledger;
}