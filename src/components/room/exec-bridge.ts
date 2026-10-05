/**
 * The browser's half of the execution layer (src/lib/room/exec).
 *
 * After every live room cycle it hands the server what the room did (the positions it opened, the trades
 * it closed) and what it holds now; the server decides whether anything may leave (the phase, the kill
 * switch and the executor lease are server-side — this file can ask, never arm), does it, and answers with
 * the audit rows and the entries that never became positions. Those come back as VOIDS and the room's book
 * stops claiming them.
 *
 * One step at a time (a second one queues, never overlaps), and while any order is still working it looks
 * again every few seconds so a fill, a cancel after 20 s and an exit's escalation are not left waiting
 * for the next cycle. Drill days never come through here: nothing synthetic reaches a broker.
 */

import { create } from "zustand";
import { execStepFn, getExecState, setExecKill, setExecPhase, type ExecStatus } from "@/lib/room/exec/exec-server";
import type { StepResult, Void } from "@/lib/room/exec/executor";
import { desiredOf, intentsFromCycle } from "@/lib/room/exec/intent";
import type { ExecPhase, OrderIntent } from "@/lib/room/exec/types";
import type { RoomCycle } from "@/lib/room/orchestrator";
import type { RoomBook } from "@/lib/room/paper-book";

const DEVICE_STORAGE = "ledger-room-device-v1";
const memId = `m-${Math.random().toString(36).slice(2, 12)}`;
const STATUS_TTL_MS = 60_000;
const POLL_MS = 3_000;
const MAX_POLLS = 12;

/** Which browser this is: the executor lease belongs to one device at a time. */
export function deviceId(): string {
  try {
    let id = window.localStorage.getItem(DEVICE_STORAGE);
    if (!id || id.length < 8) {
      id = `d-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
      window.localStorage.setItem(DEVICE_STORAGE, id);
    }
    return id;
  } catch {
    return memId;
  }
}

const why = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);

interface ExecUi {
  status: ExecStatus | null;
  statusAt: number;
  last: StepResult | null;
  error: string | null;
  refresh: () => Promise<void>;
  setPhase: (p: ExecPhase) => Promise<{ ok: boolean; why: string }>;
  setKill: (on: boolean, reason?: string) => Promise<void>;
}

export const useExecStore = create<ExecUi>((set, get) => ({
  status: null,
  statusAt: 0,
  last: null,
  error: null,
  refresh: async () => {
    try {
      const status = await getExecState();
      set({ status, statusAt: Date.now(), error: null });
    } catch (e) {
      // Signed out, offline or no database: the bridge idles and the card says why.
      set({ error: why(e), statusAt: Date.now() });
    }
  },
  setPhase: async (p) => {
    try {
      const r = await setExecPhase({ data: { phase: p } });
      await get().refresh();
      return { ok: r.ok, why: r.why };
    } catch (e) {
      return { ok: false, why: why(e) };
    }
  },
  setKill: async (on, reason) => {
    try {
      await setExecKill({ data: { killed: on, reason } });
    } finally {
      await get().refresh();
    }
  },
}));

export interface CycleArgs {
  before: RoomBook;
  after: RoomBook;
  cycle: RoomCycle;
  /** The desk's futures feed lag when the room decided. */
  feedLagSec: number | null;
  nowMs: number;
}

export interface BridgeHooks {
  /** The room's latest book (a void from an earlier step is already in it). */
  getBook: () => RoomBook;
  onVoids: (voids: Void[]) => void;
}

let running = false;
let queued: { entries: OrderIntent[]; exits: OrderIntent[]; feedLagSec: number | null; flatten?: boolean } | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let polls = 0;
let lastLag: number | null = null;

async function runStep(h: BridgeHooks, over: { entries: OrderIntent[]; exits: OrderIntent[]; feedLagSec: number | null; flatten?: boolean }): Promise<void> {
  if (running) {
    // Never overlap two steps; carry the decisions into the next one.
    queued = { entries: [...(queued?.entries ?? []), ...over.entries], exits: [...(queued?.exits ?? []), ...over.exits], feedLagSec: over.feedLagSec, flatten: Boolean(queued?.flatten || over.flatten) };
    return;
  }
  running = true;
  try {
    const book = h.getBook();
    const desired = desiredOf(book).map((d) => ({ ...d, openedAt: book.positions.find((p) => p.id === d.positionId)?.openedAt ?? 0 }));
    lastLag = over.feedLagSec;
    const res = await execStepFn({ data: { deviceId: deviceId(), entries: over.entries, exits: over.exits, desired, feedLagSec: over.feedLagSec, flatten: over.flatten } });
    useExecStore.setState({ last: res, error: null });
    if (res.voids.length) h.onVoids(res.voids);
    if (res.rows.some((r) => r.status === "working" || r.status === "reserved")) schedulePoll(h);
    else polls = 0;
  } catch (e) {
    useExecStore.setState({ error: why(e) });
  } finally {
    running = false;
    if (queued) {
      const q = queued;
      queued = null;
      void runStep(h, q);
    }
  }
}

function schedulePoll(h: BridgeHooks) {
  if (pollTimer || polls >= MAX_POLLS) return;
  polls++;
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void runStep(h, { entries: [], exits: [], feedLagSec: lastLag });
  }, POLL_MS);
}

/** Called once per live room cycle, after the book has been saved. Never throws. */
export async function execAfterCycle(a: CycleArgs, h: BridgeHooks): Promise<void> {
  try {
    const ui = useExecStore.getState();
    // Learn the phase now and once a minute: a phase set on another device is noticed here.
    if (!ui.status || Date.now() - ui.statusAt > STATUS_TTL_MS) await ui.refresh();
    const wanted = useExecStore.getState().status?.wanted ?? "off";
    if (wanted === "off") return;
    const { entries, exits } = intentsFromCycle({ before: a.before, after: a.after, cycle: a.cycle, nowMs: a.nowMs });
    // Shadow only has something to say when the room did something; paper/live also reconcile every cycle.
    if (wanted === "shadow" && !entries.length && !exits.length) return;
    await runStep(h, { entries, exits, feedLagSec: a.feedLagSec });
  } catch (e) {
    useExecStore.setState({ error: why(e) });
  }
}

/** The trader's button: close everything this system owns, whatever the room says. Also stops new entries. */
export async function execFlatten(h: BridgeHooks): Promise<void> {
  await useExecStore.getState().setKill(true, "flatten all");
  await runStep(h, { entries: [], exits: [], feedLagSec: lastLag, flatten: true });
}
