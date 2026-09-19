/**
 * Server functions for the attestation chain.
 *
 * Read-only on purpose. Links are written as a side effect of the trade
 * lifecycle (`openTrade` / `closeTrade` → `appendAttestation`), never from a
 * client call — a client-callable "write a link" endpoint would let the chain
 * be extended without a trade behind it, which is precisely the thing the
 * chain exists to make impossible.
 */

import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { chainHealth, type ChainHealth } from "./attest-server";

/**
 * Integrity of the signed-in trader's record: chain verdict, unsealed trades,
 * and the current tip.
 *
 * Scoped to `context.userId` like every other per-user read — one trader can
 * never see, or be reassured by, another's chain.
 */
export const getChainHealth = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ChainHealth> => {
    const sql = await getSql();
    return chainHealth(sql, context.userId);
  });
