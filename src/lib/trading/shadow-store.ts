/**
 * Client-side owner of the shadow book.
 *
 * Runs the pure state machine (shadow-book.ts) on every desk poll and every
 * quote tick, keeps the rows in memory + localStorage for instant UI, and
 * pushes changed rows to the server ledger (shadow-book-server.ts) in small
 * debounced batches — fire-and-forget, because nothing on the desk waits on
 * a database write. On load it pulls the server's rows (other devices, other
 * days) and the replay seed (src/data/shadow-replay.json, two months of
 * historical refusals) so the discretion memory has a sample from day one.
 *
 * Replay rows are kept apart from live rows and labelled everywhere they
 * are shown; they are counted in the scorecard, never in the live ledger.
 */

import { useEffect, useState } from "react";
import type { DeskPayload } from "./build-desk";
import {
  loadShadowsLocal,
  mergeShadows,
  observeShadows,
  saveShadowsLocal,
  subscribeShadows,
  type ShadowTrade,
} from "./shadow-book";
import { listShadowTrades, upsertShadowTrades } from "./shadow-book-server";

const FLUSH_MS = 2_500;
const BATCH = 60;

let rows: ShadowTrade[] = [];
let replayRows: ShadowTrade[] = [];
let hydrated = false;
let inited = false;
const dirty = new Map<string, ShadowTrade>();
let flushTimer: number | null = null;
let flushing = false;

function init(): void {
  if (inited || typeof window === "undefined") return;
  inited = true;
  rows = loadShadowsLocal();
}

function scheduleFlush(): void {
  if (typeof window === "undefined" || flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_MS);
}

async function flush(): Promise<void> {
  if (flushing || !dirty.size) return;
  flushing = true;
  const batch = [...dirty.values()].slice(0, BATCH);
  for (const s of batch) dirty.delete(s.id);
  try {
    await upsertShadowTrades({ data: { rows: batch } });
  } catch {
    // Signed out, offline, or the pooler is slow: keep them for the next
    // pass. localStorage already has the rows, so nothing is lost.
    for (const s of batch) if (!dirty.has(s.id)) dirty.set(s.id, s);
  } finally {
    flushing = false;
    if (dirty.size) scheduleFlush();
  }
}

/** Tick + open shadows against a fresh desk payload. Call on every poll. */
export function observeShadowBook(desk: DeskPayload): void {
  init();
  if (typeof window === "undefined") return;
  const now = Date.now();
  const res = observeShadows(desk, rows, now);
  rows = res.rows;
  if (res.changed.length) {
    saveShadowsLocal(rows);
    for (const s of res.changed) dirty.set(s.id, s);
    scheduleFlush();
  }
}

/** Pull the server ledger and the replay seed once per page load. */
export async function hydrateShadowBook(): Promise<void> {
  init();
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const remote = await listShadowTrades({ data: { days: 120 } });
    if (remote.length) {
      rows = mergeShadows(rows, remote);
      saveShadowsLocal(rows);
    }
  } catch {
    /* signed out or offline — local rows carry on */
  }
  try {
    const mod = await import("@/data/shadow-replay.json");
    const seed = (mod.default ?? mod) as unknown as ShadowTrade[];
    if (Array.isArray(seed)) {
      replayRows = seed;
      window.dispatchEvent(new Event("ledger-shadow"));
    }
  } catch {
    /* no seed shipped — live only */
  }
}

/** Live rows (this trader's, from this and other devices). Newest first. */
export function getLiveShadows(): ShadowTrade[] {
  init();
  return rows;
}

/** The replay seed, for the scorecard. */
export function getReplayShadows(): ShadowTrade[] {
  return replayRows;
}

/** Everything the discretion memory should count: live + replay. */
export function getAllShadows(): ShadowTrade[] {
  init();
  return rows.length && replayRows.length ? [...rows, ...replayRows] : rows.length ? rows : replayRows;
}

/** React hook: live rows + replay rows, re-rendering on every change. */
export function useShadowBook(): { live: ShadowTrade[]; replay: ShadowTrade[] } {
  const [, force] = useState(0);
  useEffect(() => {
    init();
    const off = subscribeShadows(() => force((n) => n + 1));
    return off;
  }, []);
  return { live: getLiveShadows(), replay: getReplayShadows() };
}
