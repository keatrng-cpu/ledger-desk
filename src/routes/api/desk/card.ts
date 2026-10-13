/**
 * GET /api/desk/card — scanner, floor, and brain. No account, no positions.
 *
 * The handoff stays behind the cron secret. Grok's webhook trigger exists,
 * but the create call does not return the endpoint or the signing secret,
 * so the site cannot POST to it. This read is the path that works.
 */
import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse } from "@/lib/alerts/cron";
import { fetchTradingDesk } from "@/lib/trading/build-desk";
import { deskListenCard, masterInputOf, type DeskListenCard } from "@/lib/trading/desk-listen";
import { masterSeat } from "@/lib/smc/master-seat";
import { attachGrokReport } from "@/lib/desk/grok-report";

const FRESH_MS = 1_000;
let cached: { at: number; card: DeskListenCard } | null = null;

async function withReport(card: DeskListenCard): Promise<DeskListenCard> {
  try {
    const { getSql } = await import("@/lib/db");
    const { readGrokReport } = await import("@/lib/desk/grok-report");
    const sql = await getSql();
    const out = attachGrokReport(card, await readGrokReport(sql));
    // fast-move layer (shadow): wire.fast.floorLine is published for the Floor, but no Floor seat reads it yet; never graded until replay-proven
    try {
      const { fastWire } = await import("@/lib/desk/fast");
      const r = (await sql`select body from desk_fast where id = 1`) as { body: never }[];
      (out.wire as unknown as { fast?: unknown }).fast = fastWire(r[0]?.body ?? null, Date.now());
    } catch { /* table not there yet */ }
    return out;
  } catch {
    return card;
  }
}

/**
 * Fix 23/25/19/24: journal A-band cards, resolve open rows against the live
 * prints, set wire.day from the journal and re-run the Master seat with the
 * day governor. Any DB failure leaves the card as built and wire.day null —
 * never an invented R.
 */
async function withJournal(card: DeskListenCard, ctx: Parameters<typeof masterInputOf>[1]): Promise<DeskListenCard> {
  try {
    const { getSql } = await import("@/lib/db");
    const j = await import("@/lib/desk/card-journal");
    const sql = await getSql();
    const now = Date.now();
    const w = card.wire;
    const prices = { [card.quotes.left.symbol]: card.quotes.left.price, [card.quotes.right.symbol]: card.quotes.right.price };
    await j.resolveJournal(sql, prices, now);
    if (w.strategy) {
      await j.journalCards(sql, [{
        symbol: w.strategy.symbol, side: w.strategy.side, band: w.strategy.band, q: w.strategy.q,
        entry: w.strategy.entry, stopPx: w.strategy.stopPx, target: w.strategy.target, rr: w.strategy.rr,
        context: {
          mtfAlign: ctx?.books.find((b) => b.symbol === w.strategy!.symbol)?.align[w.strategy.side as "long" | "short"]?.score ?? null,
          chop: w.strategy.chop, ltfKill: w.strategy.exitPlan?.killWhy ?? null, dispStrength: w.strategy.displacementStrength,
          smt: w.smt?.lead ? `${w.smt.lead.tf} ${w.smt.lead.kind} ${w.smt.lead.leader}/${w.smt.lead.failing}` : null,
          master: w.master?.verdict ?? null, judas: w.strategy.judas,
        },
      }], now);
    }
    const rep = await j.journalReport(sql, now, 7);
    const governor = j.governorOf(rep.rToday);
    w.day = { rToday: rep.rToday, governor, closedToday: rep.closedToday };
    // dayGovernor (shared rules): it reads PAPER journal R (never-traded card outcomes) — shadow by default, reported on
    // wire.day only. Real stops are the watcher's daily cap and the weekly lock (RH realized fills).
    const govLive = j.governorLive();
    if (govLive && governor === "A+ only" && w.strategy && w.strategy.band !== "A+") w.strategy.actionable = false;
    w.day.governorMode = govLive ? "live" : "shadow";
    w.master = masterSeat(masterInputOf(w, ctx, govLive ? governor : "normal"));
  } catch (err) {
    console.error("[desk] journal failed:", err);
  }
  return card;
}

async function handle(): Promise<Response> {
  const now = Date.now();
  try {
    if (cached && now - cached.at < FRESH_MS) {
      return jsonResponse(await withReport(cached.card), 200, { "cache-control": "no-store" });
    }
    // Learning loop: the applied calibration (weights + band edges) is loaded
    // into the engine BEFORE the build so this card grades on that version.
    let sql: import("@/lib/db").Sql | null = null;
    try { sql = await (await import("@/lib/db")).getSql(); await (await import("@/lib/desk/learning-live")).applyCalibration(sql, now); } catch { sql = null; }
    const res = await fetchTradingDesk({ data: { left: "MNQ", right: "ES" } });
    if (!res.ok) return jsonResponse({ ok: false, error: res.error, desk: "unavailable" }, 503);
    const card = await withJournal(deskListenCard(res), res.mtfContext ?? null);
    if (sql) await (await import("@/lib/desk/learning-live")).learnOnRead(sql, res, card, now);
    cached = { at: now, card };
    return jsonResponse(await withReport(card), 200, { "cache-control": "no-store" });
  } catch (err) {
    console.error("[desk] card failed:", err);
    return jsonResponse({ ok: false, error: "Desk card failed" }, 500);
  }
}

export const Route = createFileRoute("/api/desk/card")({
  server: {
    handlers: { GET: handle },
  },
});
