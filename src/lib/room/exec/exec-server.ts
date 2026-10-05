/**
 * Server functions for the execution layer. Every one is behind authMiddleware and scoped to
 * `context.userId`; the wanted phase, the kill switch and the executor lease live in the database, so
 * a browser can ask but never arm. Broker keys come from the environment only and never leave it.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { etDateOf } from "../option-math";
import { brokerFromEnv } from "./alpaca";
import { PgExecStore } from "./exec-sql";
import { execStep, type StepRequest, type StepResult } from "./executor";
import { stepSchema } from "./exec-schema";
import { evidenceOf, liveReadiness, type Evidence, type LiveReadiness } from "./gates";
import { EXEC_FLAGS, EXEC_LIMITS, LIVE_EVIDENCE } from "./limits";
import { PHASES, type AuditRow, type ExecPhase } from "./types";

async function storeFor(userId: string) {
  const sql = await getSql();
  return new PgExecStore((t, p) => sql.query(t, p), userId);
}

const hasLiveKeys = () => Boolean(process.env.ALPACA_LIVE_KEY_ID && process.env.ALPACA_LIVE_SECRET_KEY);
const hasPaperKeys = () => Boolean(process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET_KEY);
const dataFeed = (): "opra" | "indicative" => (process.env.ALPACA_DATA_FEED === "opra" ? "opra" : "indicative");

export interface ExecStatus {
  /** The trader's id — what CRON_USER_ID must be set to for the safety-net cron to see this trader's orders. */
  userId: string;
  wanted: ExecPhase;
  killed: boolean;
  killReason: string | null;
  /** When the unattended safety net (cron) last ran for this trader, ms; null = never. */
  netMs: number | null;
  readiness: LiveReadiness;
  evidence: Evidence;
  rows: AuditRow[];
  keys: { paper: boolean; live: boolean };
  feed: "opra" | "indicative";
  flags: typeof EXEC_FLAGS;
  limits: typeof EXEC_LIMITS;
  evidenceLimits: typeof LIVE_EVIDENCE;
}

export const getExecState = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ExecStatus> => {
    const store = await storeFor(context.userId);
    const st = await store.state();
    const evidence = evidenceOf(await store.evidenceRows(500), Date.now());
    return {
      userId: context.userId,
      wanted: st.wanted,
      killed: st.killed,
      killReason: st.killReason,
      netMs: st.netMs,
      readiness: liveReadiness({ evidence, feed: dataFeed(), liveKeys: hasLiveKeys(), killed: st.killed }),
      evidence,
      rows: await store.recent(40),
      keys: { paper: hasPaperKeys(), live: hasLiveKeys() },
      feed: dataFeed(),
      flags: EXEC_FLAGS,
      limits: EXEC_LIMITS,
      evidenceLimits: LIVE_EVIDENCE,
    };
  });

export const setExecPhase = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ phase: z.enum(["off", "shadow", "paper", "live"]) }))
  .handler(async ({ data, context }): Promise<{ ok: boolean; phase: ExecPhase; why: string }> => {
    const store = await storeFor(context.userId);
    const cur = (await store.state()).wanted;
    const phase = data.phase;
    if (!PHASES.includes(phase)) return { ok: false, phase: cur, why: "unknown phase" };
    if (phase === "paper" && !hasPaperKeys()) return { ok: false, phase: cur, why: "set ALPACA_KEY_ID and ALPACA_SECRET_KEY (Alpaca paper keys) on the server first" };
    if (phase === "live") {
      const st = await store.state();
      const evidence = evidenceOf(await store.evidenceRows(500), Date.now());
      const r = liveReadiness({ evidence, feed: dataFeed(), liveKeys: hasLiveKeys(), killed: st.killed });
      if (!r.ok) return { ok: false, phase: cur, why: `live is not cleared: ${r.items.filter((i) => !i.ok).map((i) => i.label).join("; ")}` };
    }
    await store.setWanted(phase);
    return { ok: true, phase, why: phase === "off" ? "execution is off" : `phase is now ${phase}` };
  });

export const setExecKill = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ killed: z.boolean(), reason: z.string().max(200).optional() }))
  .handler(async ({ data, context }): Promise<{ killed: boolean }> => {
    const store = await storeFor(context.userId);
    await store.setKilled(data.killed, data.reason ?? "kill switch");
    return { killed: data.killed };
  });

export const execStepFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(stepSchema)
  .handler(async ({ data, context }): Promise<StepResult> => {
    const store = await storeFor(context.userId);
    const nowMs = Date.now();
    const wanted = (await store.state()).wanted;
    const broker = wanted === "off" ? null : brokerFromEnv(wanted);
    // The server dates every intent itself; a browser's clock is never an input to an order.
    const etDate = etDateOf(nowMs);
    const req: StepRequest = {
      ...data,
      entries: data.entries.filter((i) => i.role === "entry" && i.side === "buy").map((i) => ({ ...i, etDate, positionId: i.positionId ?? null })),
      exits: data.exits.filter((i) => i.role === "exit" && i.side === "sell").map((i) => ({ ...i, etDate, positionId: i.positionId ?? null })),
    };
    return execStep({ store, broker, nowMs, liveKeys: hasLiveKeys() }, req);
  });
