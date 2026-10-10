/**
 * The browser side of the Mead Hall's prediction board: the one place the Floor reads the network and localStorage for it.
 *
 * `pullHall` takes the path the PM analyzer takes (pm-analyzer.tsx): the Predict board's NFL scanner rows are the REAL model inputs
 * (`modelInputsFromScanRows`: DraftKings with the margin removed, or ESPN live), they ride along to `getPredictionSignals`, and a market
 * that has one is graded while every other market says "no edge read" and has no letter. The result goes to the hall store
 * (hall-store.ts), which the talk reads. `readHallRecord` is the go ledger, the trader's journal and the analyzer's paper book.
 *
 * Cost: two server calls per pull (the Predict board is cached eight seconds, the signal board twelve), run at most once every ten
 * minutes by the room engine and never while the cash session is open; a pull that runs out of time is dropped, not retried, and the last
 * board is held. Public reads only. Paper only: no broker is imported here and nothing is sent anywhere.
 */

import { getPredictBoard, getPredictionSignals, type PredictBoard } from "@/lib/predict/predict-server";
import { DEFAULT_FEES } from "@/lib/predict/math";
import { goStats, loadGo } from "@/lib/predict/go-ledger";
import { readJournal, loadTrades } from "@/lib/predict/journal";
import { scorePaper } from "@/lib/predict/paper-scorer";
import { loadPaper } from "@/lib/predict/pm-paper-store";
import { modelInputsFromScanRows, type ModelInput, type SignalBoard } from "@/lib/predict/signal-engine";
import { scanBoard, type ScanRow } from "@/lib/predict/scanner";
import { recordLiteFrom } from "@/lib/room/hall-lite";
import { getHall, setHall } from "@/lib/room/hall-store";
import type { HallRecordLite } from "@/lib/room/live-types";

/** The whole pull (both calls) gets this long. Netlify's synchronous limit is ten seconds; the signal board has its own 8.5 s wall. */
export const HALL_PULL_BUDGET_MS = 14_000;

/** The two public reads a pull makes. Injectable so a verifier can run the whole pull on fixtures, with no network. */
export interface HallDeps {
  board: () => Promise<PredictBoard>;
  signals: (models: Record<string, ModelInput>) => Promise<SignalBoard>;
}

const LIVE: HallDeps = {
  board: () => getPredictBoard({ data: { league: "nfl" } }),
  signals: (models) => getPredictionSignals({ data: Object.keys(models).length ? { models } : {} }) as Promise<SignalBoard>,
};

/** The scanner's "held" layer compares with the previous look; between pulls this module keeps the gaps it saw. */
let lastGaps = new Map<string, number>();
export function resetHallGaps(): void {
  lastGaps = new Map();
}

/** The paper side, or null when this browser has no storage to read. Never throws. */
export function readHallRecord(): HallRecordLite | null {
  try {
    return recordLiteFrom(goStats(loadGo()), readJournal(loadTrades()), scorePaper(loadPaper()));
  } catch {
    return null;
  }
}

function withBudget<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("the prediction read ran out of time")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

async function scannerRows(deps: HallDeps): Promise<{ rows: ScanRow[]; asOf: string } | null> {
  try {
    const board = await deps.board();
    const rows = scanBoard(board.games, DEFAULT_FEES, lastGaps, Date.now());
    const gaps = new Map<string, number>();
    for (const r of rows) if (r.gap != null) gaps.set(r.key, r.gap);
    lastGaps = gaps;
    return { rows, asOf: board.fetchedAt };
  } catch {
    // The scanner's sources are down: every market reads "no edge read", which is the truth.
    return null;
  }
}

/**
 * The signal board, graded where the sports scanner has a model (the PM analyzer's own path). This is what a hall feed's `load` should
 * call: the Floor tab's view-bound feed can pass it to `createSignalHallFeed({ load: loadHallBoard })` so the faster feed keeps the
 * models instead of replacing a graded board with an ungraded one. The scanner's rows ride into the hall store beside it, with the paper
 * records, so the talk can name the missing layer and the limit price.
 */
export async function loadHallBoard(deps: HallDeps = LIVE): Promise<SignalBoard> {
  const scan = await scannerRows(deps);
  const models: Record<string, ModelInput> = scan ? modelInputsFromScanRows(scan.rows, scan.asOf) : {};
  for (const k of Object.keys(models)) models[k] = { ...models[k]!, source: models[k]!.source.slice(0, 120) };
  const board = await deps.signals(models);
  if (board.signals.length > 0) setHall({ scan: scan?.rows ?? null, scanAsOf: scan?.asOf ?? null, record: readHallRecord() });
  return board;
}

/**
 * One pull into the store. Resolves when the store has been updated (or, on failure, marked held/error). Never throws.
 * `alive` lets the caller drop a pull that finished after its owner went away.
 */
export async function pullHall(alive: () => boolean = () => true, opts: { budgetMs?: number; deps?: HallDeps } = {}): Promise<void> {
  try {
    const board = await withBudget(loadHallBoard(opts.deps ?? LIVE), opts.budgetMs ?? HALL_PULL_BUDGET_MS);
    if (!alive()) return;
    if (board.signals.length > 0) {
      setHall({ board, status: "live", held: false, error: null, at: Date.now() });
      return;
    }
    const why = board.reason ?? "The signal board came back empty.";
    if (getHall().board) setHall({ held: true, error: why, at: Date.now() });
    else setHall({ status: "empty", error: why, at: Date.now() });
  } catch (err) {
    if (!alive()) return;
    const why = err instanceof Error ? err.message : String(err);
    if (getHall().board) setHall({ held: true, error: why, at: Date.now() });
    else setHall({ status: "error", error: why, at: Date.now() });
  }
}
