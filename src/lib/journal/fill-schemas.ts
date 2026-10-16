/**
 * Journal input schemas shared by the server fns (journal/server.ts) and the watcher fill endpoint
 * (desk/watcher-fills.ts). Kept free of server imports so the watcher module and its tests can validate through
 * the SAME schemas (stop-vs-fill side check, EXIT_REASON_IDS enum) without loading the server-fn graph.
 */
import { z } from "zod";
import { CONTRACTS, type ContractKey } from "@/lib/aplus/config";
import { EXIT_REASON_IDS, MISTAKE_IDS } from "./discipline";

const SYMBOLS = Object.keys(CONTRACTS) as [ContractKey, ...ContractKey[]];
const symbolSchema = z.enum(SYMBOLS);
const sideSchema = z.enum(["long", "short"]);
const price = z.number().finite().positive();

export const closeTradeSchema = z.object({
  id: z.string().min(1).max(64),
  exit: price,
  slippage: z.number().finite().min(0).max(100_000).default(0),
  reason: z.string().max(500).optional(),
  /** journal/discipline.ts EXIT_REASONS — why it ended, in the fixed vocabulary. */
  exitReason: z.enum(EXIT_REASON_IDS).optional(),
  /** journal/discipline.ts MISTAKE_TAGS — added to any already on the row. */
  mistakes: z.array(z.enum(MISTAKE_IDS)).max(10).optional(),
});

const isoTime = z.string().datetime({ offset: true });

export const realFillSchema = z
  .object({
    symbol: symbolSchema,
    side: sideSchema,
    /** The ACTUAL fill — not the plan's CE. The two are kept apart below. */
    entry: price,
    stop: price.optional(),
    target: price.optional(),
    contracts: z.number().int().min(1).max(1000),
    filledAt: isoTime.optional(),
    /** Optional: record a finished trade in one go. */
    exit: price.optional(),
    exitedAt: isoTime.optional(),
    exitReason: z.enum(EXIT_REASON_IDS).optional(),
    slippage: z.number().finite().min(0).max(100_000).default(0),
    /* --- the decision, as the desk saw it --- */
    deskWord: z.enum(["TAKE", "WAIT", "STAND"]).optional(),
    missingLayers: z.array(z.string().max(64)).max(16).optional(),
    pathBand: z.enum(["A+", "A", "A-", "B+", "B", "C", "skip"]).optional(),
    planEntry: price.optional(),
    planStop: price.optional(),
    why: z.string().max(500).optional(),
    whyPre: z.boolean().optional(),
    stateRating: z.number().int().min(1).max(5).optional(),
    mistakes: z.array(z.enum(MISTAKE_IDS)).max(10).optional(),
    prescore: z.number().min(0).max(1).optional(),
    killzone: z.string().max(32).optional(),
    strategyPrimary: z.string().max(64).optional(),
    regime: z.string().max(32).optional(),
    reason: z.string().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.stop != null && !(v.side === "long" ? v.stop < v.entry : v.stop > v.entry)) {
      ctx.addIssue({ code: "custom", path: ["stop"], message: `Stop must be ${v.side === "long" ? "below" : "above"} the fill for a ${v.side}` });
    }
  });
