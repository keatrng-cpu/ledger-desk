/**
 * Keep the browser ledger and the server ledger the same set of entries.
 *
 * Pull first, then push what the server lacks. Entries are immutable and
 * keyed by id, so a union is the whole algorithm — with one exception:
 * sweeps have a DETERMINISTIC id ("sweep:YYYY-MM") so a month can be logged
 * once per trader, not once per device. If two devices logged the same
 * month offline, the server's copy (the first to arrive) stands, this
 * device's copy is replaced, and the difference is reported rather than
 * silently resolved.
 *
 * Failure is loud and harmless: signed out, no database, or offline → the
 * status says "local only" with the reason, and the browser ledger keeps
 * working exactly as before.
 */

import { appendInvestLedger, listInvestLedger } from "./ledger-server";
import { loadEntries, mergeEntries, replaceEntries } from "./store";
import type { InvestEntry } from "./ledger";

export interface SyncState {
  status: "ok" | "local";
  at: string;
  pulled: number;
  pushed: number;
  /** Plain-language notes on anything the server decided for this device. */
  conflicts: string[];
  why: string;
}

const BATCH = 200;
let inflight: Promise<SyncState> | null = null;

function same(a: InvestEntry, b: InvestEntry): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function run(): Promise<SyncState> {
  const at = new Date().toISOString();
  try {
    const { entries: server } = await listInvestLedger();
    const serverById = new Map(server.map((e) => [e.id, e]));
    const local = loadEntries();
    const conflicts: string[] = [];
    const replace: InvestEntry[] = [];
    for (const e of local) {
      const s = serverById.get(e.id);
      if (s && !same(s, e)) {
        replace.push(s);
        if (s.kind === "sweep" && e.kind === "sweep") {
          conflicts.push(
            `${s.month} was logged first on another device ($${s.realizedUsd.toFixed(2)} realized, $${s.sweptUsd.toFixed(2)} swept). This device's copy ($${e.realizedUsd.toFixed(2)} / $${e.sweptUsd.toFixed(2)}) was replaced — void and re-log if the other one is wrong.`,
          );
        } else {
          conflicts.push(`Entry ${e.id} differed from the server's copy; the server's was kept.`);
        }
      }
    }
    if (replace.length) replaceEntries(replace);
    const { added } = mergeEntries(server);

    const serverIds = new Set(server.map((e) => e.id));
    const toPush = loadEntries().filter((e) => !serverIds.has(e.id));
    let pushed = 0;
    for (let i = 0; i < toPush.length; i += BATCH) {
      const res = await appendInvestLedger({ data: { entries: toPush.slice(i, i + BATCH) } });
      pushed += res.written;
      if (res.refused) conflicts.push(`${res.refused} entr${res.refused === 1 ? "y" : "ies"} refused by the server as malformed.`);
    }
    return {
      status: "ok",
      at,
      pulled: added,
      pushed,
      conflicts,
      why:
        added || pushed
          ? `Synced — ${added} pulled from other devices, ${pushed} saved to the server.`
          : "In sync with the server.",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: "local",
      at,
      pulled: 0,
      pushed: 0,
      conflicts: [],
      why: `Local only — the server ledger did not answer (${msg.slice(0, 120)}). Entries stay in this browser; export them if this persists.`,
    };
  }
}

/** One sync at a time; a second caller shares the first one's result. */
export function syncInvestLedger(): Promise<SyncState> {
  if (!inflight) inflight = run().finally(() => (inflight = null));
  return inflight;
}
