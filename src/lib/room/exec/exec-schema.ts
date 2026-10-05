/**
 * The shape the browser may send to the executor (zod strips every key not listed — `force`, which only the
 * server-side safety net may set, can never arrive through here).
 */

import { z } from "zod";

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

export const intentSchema = z.object({
  decisionKey: z.string().min(3).max(200),
  role: z.enum(["entry", "exit"]),
  side: z.enum(["buy", "sell"]),
  underlier: z.enum(["QQQ", "SPY"]),
  type: z.enum(["CALL", "PUT"]),
  strike: z.number().positive().max(100_000),
  exp: z.string().regex(dateRe),
  qty: z.number().int().min(1).max(1000),
  modelPx: z.number().min(0).max(100_000),
  reason: z.string().max(400),
  etDate: z.string().regex(dateRe),
  atMs: z.number().finite(),
  positionId: z.string().max(100).nullable().optional(),
});

export const stepSchema = z.object({
  deviceId: z.string().min(8).max(64),
  entries: z.array(intentSchema).max(5),
  exits: z.array(intentSchema).max(10),
  desired: z
    .array(z.object({ symbol: z.string().max(30), qty: z.number().int().min(1).max(1000), positionId: z.string().max(100), openedAt: z.number().finite() }))
    .max(20),
  feedLagSec: z.number().finite().nullable(),
  flatten: z.boolean().optional(),
});
