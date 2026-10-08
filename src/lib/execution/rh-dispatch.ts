/**
 * The only Robinhood sender.
 *
 * review, then place, on Agentic 995386158. Opens need the arms and a clean
 * review. Closes of a position this desk opened go out even if the arm is off,
 * so a kill cannot trap one. A position this desk did not open is not closed
 * and blocks a new open. No tooling (RH_ACCESS_TOKEN unset) decides the cycle
 * and sends nothing.
 *
 * propose / the cycle return a shape. They do not call this.
 */
import { mayPlaceAfterReview, rhAutofireEnabled, rhLiveArmed } from "./rh-autofire";
import { rhAccountFromPortfolio } from "./rh-account";
import { toManagerRhAccount, type ManagerRhAccount } from "./manager-account";
import { failedHoldClose, type RhCycle, type RhHeld, type RhOrder } from "./rh-cycle";
import { refIdFor, type DeskOpen, type RhLedger, type RhPos, type RhQuote, type RhReview, type RhTooling } from "./rh-tools";
import { rhCycleOnDesk, type RhCycleDesk } from "../room/manager-live-loop";
import type { ManagerFeed, ManagerRoomState } from "../room/manager-feed";
import type { RhLiveOptionQuote } from "./rh-autofire";

/** A fill can take a minute to show. Inside this window a missing line is not "flat". */
const POSITION_LAG_MS = 15 * 60_000;
const BAR_MS = 15 * 60_000;

export interface RhDispatchResult {
  cycle: RhCycle;
  sent: boolean;
  why: string;
  orderId: string | null;
}

export interface RhDispatchArgs {
  desk: RhCycleDesk | null;
  /** Real room state. A stub is not passed here — the caller already dropped it. */
  manager: ManagerRoomState | null;
  nowMs: number;
  tooling: RhTooling | null;
  ledger: RhLedger;
  /** Sell every desk-owned contract. Does not open. */
  flatten?: boolean;
  /** Kill switch. Stops a new open. Does not stop a close. */
  blockNewEntries?: boolean;
}

const NO_SESSION = "No Robinhood session (RH_ACCESS_TOKEN). Nothing was sent.";

function look(reason: string): RhDispatchResult {
  return { cycle: { phase: "look", reason, order: null }, sent: false, why: reason, orderId: null };
}

function feedOf(manager: ManagerRoomState | null): ManagerFeed | null {
  if (!manager) return null;
  return { getState: () => manager, stub: false } as unknown as ManagerFeed;
}

function bookOf(desk: RhCycleDesk | null, underlier: "QQQ" | "SPY") {
  if (!desk) return null;
  const want = underlier === "QQQ" ? /NQ$/ : /^ES$/;
  const legs = [
    { symbol: desk.left?.symbol, price: desk.quotes?.left?.price, bars: desk.left?.bars, book: desk.smcMaster?.left },
    { symbol: desk.right?.symbol, price: desk.quotes?.right?.price, bars: desk.right?.bars, book: desk.smcMaster?.right },
  ];
  return legs.find((l) => want.test(String(l.symbol ?? ""))) ?? null;
}

function closed15(bars: { t: number; c: number }[] | undefined, nowMs: number): number | null {
  if (!bars) return null;
  let close: number | null = null;
  for (const b of bars) {
    if (typeof b?.t === "number" && typeof b?.c === "number" && b.t + BAR_MS <= nowMs + 1500) close = b.c;
  }
  return close;
}

function levelsOf(desk: RhCycleDesk | null, underlier: "QQQ" | "SPY", side: "long" | "short" | null): { entry: number | null; stop: number | null } {
  const leg = bookOf(desk, underlier);
  const plan = leg?.book?.plan;
  if (!plan || (side && plan.side && plan.side !== side)) return { entry: null, stop: null };
  const entry = typeof plan.entry === "number" && Number.isFinite(plan.entry) ? plan.entry : null;
  const stop = typeof plan.stop === "number" && Number.isFinite(plan.stop) ? plan.stop : null;
  return { entry, stop };
}

/** A close still goes if the only block is buying power or a missing review route. A hard reject does not. */
export function closeMaySend(review: RhReview): boolean {
  if (review.ok && !review.blocking) return true;
  const text = review.alerts.join(" \n ");
  if (/rejected|halt|invalid|denied/i.test(text)) return false;
  return /not enough|insufficient|buying power|not available/i.test(text);
}

function heldFrom(pos: RhPos, row: DeskOpen | null, quote: RhQuote | null, desk: RhCycleDesk | null, nowMs: number, listed: boolean): RhHeld {
  const underlier: "QQQ" | "SPY" = row?.underlier ?? (pos.chainSymbol === "SPY" ? "SPY" : "QQQ");
  const optionType = row?.optionType ?? pos.optionType ?? "call";
  const side: "long" | "short" = row?.side ?? (optionType === "put" ? "short" : "long");
  const leg = bookOf(desk, underlier);
  const mark = typeof leg?.price === "number" && Number.isFinite(leg.price) ? leg.price : null;
  const entry = row?.entry ?? null;
  const stop = row?.stop ?? null;
  const close = closed15(leg?.bars, nowMs);
  return {
    optionId: pos.optionId || row?.optionId || "",
    underlier,
    optionType,
    quantity: listed ? pos.quantity : row?.quantity ?? 0,
    avgDebit: row?.avgDebit && row.avgDebit > 0 ? row.avgDebit : (pos.averagePrice ?? 0),
    bid: quote?.bid ?? null,
    mark,
    entry,
    stop,
    side,
    failedHold: listed ? failedHoldClose({ side, entry, stop, close }) : false,
    deskOwned: true,
    decisionKey: row?.decisionKey || pos.optionId,
  };
}

function foreignHeld(pos: RhPos): RhHeld {
  const underlier: "QQQ" | "SPY" = pos.chainSymbol === "SPY" ? "SPY" : "QQQ";
  return {
    optionId: pos.optionId,
    underlier,
    optionType: pos.optionType ?? "call",
    quantity: pos.quantity,
    avgDebit: pos.averagePrice ?? 0,
    bid: null,
    mark: null,
    entry: null,
    stop: null,
    side: pos.optionType === "put" ? "short" : "long",
    failedHold: false,
    deskOwned: false,
    decisionKey: pos.optionId,
  };
}

async function sendClose(args: {
  tooling: RhTooling;
  ledger: RhLedger;
  cycle: RhCycle;
  nowMs: number;
  listed: boolean;
}): Promise<RhDispatchResult> {
  const order = args.cycle.order;
  if (!order || args.cycle.phase !== "close") {
    return { cycle: args.cycle, sent: false, why: args.cycle.reason, orderId: null };
  }
  if (!args.listed) {
    const cycle: RhCycle = {
      phase: "manage",
      reason: "This desk opened a contract the broker does not list yet. Nothing new is opened, and nothing was sold.",
      order: null,
    };
    return { cycle, sent: false, why: cycle.reason, orderId: null };
  }
  let review: RhReview;
  try {
    review = await args.tooling.review(order);
  } catch (err) {
    const why = err instanceof Error ? err.message : "review failed";
    return { cycle: args.cycle, sent: false, why, orderId: null };
  }
  if (!closeMaySend(review)) {
    const why = review.alerts[0] || "Review refused the close.";
    return { cycle: args.cycle, sent: false, why, orderId: null };
  }
  return placeOrder(args.tooling, args.ledger, args.cycle, order, args.nowMs, null);
}

async function placeOrder(
  tooling: RhTooling,
  ledger: RhLedger,
  cycle: RhCycle,
  order: RhOrder,
  nowMs: number,
  opened: DeskOpen | null,
): Promise<RhDispatchResult> {
  const refId = refIdFor(order.refKey);
  try {
    const res = await tooling.place(order, refId);
    await ledger.notePlace(nowMs);
    if (opened) await ledger.put({ ...opened, refId, openedAt: nowMs });
    else await ledger.drop(order.legs[0]?.option_id ?? "");
    return { cycle, sent: true, why: res.id, orderId: res.id };
  } catch (err) {
    const why = err instanceof Error ? err.message : "place failed";
    return { cycle, sent: false, why, orderId: null };
  }
}

export async function runRhDesk(args: RhDispatchArgs): Promise<RhDispatchResult> {
  const nowMs = args.nowMs;
  if (!args.tooling) return look(NO_SESSION);
  const tooling = args.tooling;
  if (args.desk?.feed === "synthetic" && !args.flatten) {
    return look("A synthetic feed is not a ticket. Nothing was sent.");
  }

  let raw: { portfolio: unknown; account: unknown } | null;
  try {
    raw = await tooling.readAccount();
  } catch (err) {
    const why = err instanceof Error ? err.message : "account read failed";
    return look(`${why} Nothing was sent.`);
  }
  if (!raw) return look("Robinhood account 995386158 did not answer. Nothing was sent.");
  const snap = rhAccountFromPortfolio({ portfolio: raw.portfolio, account: raw.account, asOfMs: nowMs });
  const mgrAccount: ManagerRhAccount = toManagerRhAccount({
    cashUsd: snap.cash,
    optionsBuyingPowerUsd: snap.buyingPower,
    asOf: new Date(nowMs).toISOString(),
    accountNumber: snap.accountNumber,
    agenticAllowed: snap.agenticAllowed === true,
    optionLevel: snap.optionLevel,
    label: snap.label,
    isSnapshot: false,
  });
  const manager = args.manager ? { ...args.manager, account: mgrAccount } : null;

  let positions: RhPos[];
  try {
    positions = await tooling.positions();
  } catch (err) {
    const why = err instanceof Error ? err.message : "positions failed";
    return look(`${why} Nothing was sent.`);
  }
  const rows = await args.ledger.list();
  for (const row of rows) {
    const live = positions.find((p) => p.optionId === row.optionId);
    if (!live && nowMs - row.openedAt > POSITION_LAG_MS) await args.ledger.drop(row.optionId);
  }
  const liveRows = (await args.ledger.list()).filter((r) => nowMs - r.openedAt <= POSITION_LAG_MS || positions.some((p) => p.optionId === r.optionId));

  const ours = positions
    .map((p) => ({ p, row: liveRows.find((r) => r.optionId === p.optionId) ?? null }))
    .filter((x) => x.row);
  const pending = liveRows.filter((r) => !positions.some((p) => p.optionId === r.optionId) && nowMs - r.openedAt <= POSITION_LAG_MS);
  const foreign = positions.filter((p) => !liveRows.some((r) => r.optionId === p.optionId));

  if (args.flatten) {
    const targets = [
      ...ours.map((x) => ({ held: heldFrom(x.p, x.row, null, args.desk, nowMs, true), listed: true, quoteId: x.p.optionId })),
      ...pending.map((r) => ({
        held: heldFrom(
          { optionId: r.optionId, quantity: r.quantity, averagePrice: r.avgDebit, chainSymbol: r.underlier, optionType: r.optionType },
          r,
          null,
          args.desk,
          nowMs,
          false,
        ),
        listed: false,
        quoteId: r.optionId,
      })),
    ];
    if (!targets.length) return look(foreign.length ? "A position this desk did not open is already on. It is not closed." : "Nothing this desk opened is on.");
    let last: RhDispatchResult = look("Flatten found nothing to send.");
    for (const t of targets) {
      const q = await tooling.quote(t.quoteId).catch(() => null);
      const held = { ...t.held, bid: q?.bid ?? null };
      const cycle = rhCycleOnDesk({
        feed: feedOf(manager),
        desk: args.desk,
        held,
        account: snap,
        nowMs,
        forceClose: "Flatten. The desk closes what it opened.",
      });
      last = await sendClose({ tooling, ledger: args.ledger, cycle, nowMs, listed: t.listed });
    }
    return last;
  }

  let held: RhHeld | null = null;
  let listed = false;
  if (ours[0]) {
    const q = await tooling.quote(ours[0].p.optionId).catch(() => null);
    held = heldFrom(ours[0].p, ours[0].row, q, args.desk, nowMs, true);
    listed = true;
  } else if (pending[0]) {
    held = heldFrom(
      { optionId: pending[0].optionId, quantity: pending[0].quantity, averagePrice: pending[0].avgDebit, chainSymbol: pending[0].underlier, optionType: pending[0].optionType },
      pending[0],
      null,
      args.desk,
      nowMs,
      false,
    );
    listed = false;
  } else if (foreign[0]) {
    held = foreignHeld(foreign[0]);
  }

  const call = manager?.call ?? null;
  const sig = manager?.signals;
  const underlier = call?.underlier ?? null;
  const optType = call?.side ?? (sig?.futSide === "short" ? "put" : sig?.futSide === "long" ? "call" : null);
  const strike = sig?.strike ?? null;
  const expiry = sig?.expiry ?? null;
  let liveQuote: RhLiveOptionQuote | null = null;
  let strikeMissing = strike == null;
  if (!held && underlier && optType && strike != null && expiry) {
    strikeMissing = false;
    const id = await tooling.findOption({ underlier, expiry, type: optType, strike }).catch(() => null);
    const q = id ? await tooling.quote(id).catch(() => null) : null;
    if (id && q) {
      liveQuote = { optionId: id, askPrice: q.ask, bidPrice: q.bid, asOfMs: q.asOfMs, source: "get_option_quotes" };
    }
  }

  const dayPnlPct = await tooling.dayPnlPct().catch(() => null);
  const lastPlaceAtMs = await args.ledger.lastPlaceAt();
  let cycle = rhCycleOnDesk({
    feed: feedOf(manager),
    desk: args.desk,
    held,
    account: snap,
    liveQuote,
    nowMs,
    lastPlaceAtMs,
    dayPnlPct,
  });
  if (cycle.phase === "look" && !held && strikeMissing && /quote|option id/i.test(cycle.reason)) {
    cycle = { ...cycle, reason: "no strike on the room plan" };
  }
  if (args.blockNewEntries && cycle.phase === "place") {
    cycle = { phase: "look", reason: "Kill switch is on — no new entries.", order: null };
  }

  if (cycle.phase === "close") {
    return sendClose({ tooling, ledger: args.ledger, cycle, nowMs, listed: listed && !!held?.deskOwned });
  }
  if (cycle.phase !== "place" || !cycle.order) {
    return { cycle, sent: false, why: cycle.reason, orderId: null };
  }
  if (!rhAutofireEnabled() || !rhLiveArmed()) {
    return { cycle: { ...cycle, phase: "look", order: null }, sent: false, why: "The arm is off. Nothing was sent.", orderId: null };
  }
  const order = cycle.order;
  let review: RhReview;
  try {
    review = await tooling.review(order);
  } catch (err) {
    const why = err instanceof Error ? err.message : "review failed";
    return { cycle, sent: false, why, orderId: null };
  }
  if (review.blocking || !review.ok) {
    const why = review.alerts[0] || "Review refused the open.";
    return { cycle, sent: false, why, orderId: null };
  }
  let again: { portfolio: unknown; account: unknown } | null;
  try {
    again = await tooling.readAccount();
  } catch {
    again = null;
  }
  if (!again) return { cycle, sent: false, why: "No account read after review. Nothing was sent.", orderId: null };
  const atReview = rhAccountFromPortfolio({ portfolio: again.portfolio, account: again.account, asOfMs: nowMs });
  const mgrAtReview = toManagerRhAccount({
    cashUsd: atReview.cash,
    optionsBuyingPowerUsd: atReview.buyingPower,
    asOf: new Date(nowMs).toISOString(),
    accountNumber: atReview.accountNumber,
    agenticAllowed: atReview.agenticAllowed === true,
    optionLevel: atReview.optionLevel,
    label: atReview.label,
    isSnapshot: false,
  });
  const qty = Number(order.quantity);
  const limit = Number(order.price);
  const debit = Number.isFinite(limit) && Number.isFinite(qty) ? Math.round(limit * 100 * qty * 100) / 100 : null;
  const may = mayPlaceAfterReview({
    gatesStillOk: true,
    liveArmedNow: rhAutofireEnabled() && rhLiveArmed(),
    reviewHadBlockingAlert: false,
    agenticAllowed: atReview.agenticAllowed === true,
    optionsLevelOk: atReview.optionLevel == null || /option_level_[23]/.test(atReview.optionLevel),
    account: mgrAtReview,
    accountAtReview: atReview,
    debitTotal: debit,
    liveQuote,
    quantity: qty,
    pathBand: manager?.path?.band ?? null,
    nowMs,
  });
  if (!may.ok) return { cycle, sent: false, why: may.reason, orderId: null };
  const side = optType === "put" ? "put" : "call";
  const u: "QQQ" | "SPY" = underlier === "SPY" ? "SPY" : "QQQ";
  const futSide = sig?.futSide === "short" || sig?.futSide === "long" ? sig.futSide : side === "put" ? "short" : "long";
  const lv = levelsOf(args.desk, u, futSide);
  const opened: DeskOpen = {
    optionId: order.legs[0]?.option_id ?? "",
    decisionKey: order.refKey.replace(/^open:/, ""),
    underlier: u,
    optionType: side,
    quantity: qty,
    avgDebit: Number.isFinite(limit) ? limit : 0,
    entry: lv.entry,
    stop: lv.stop,
    side: futSide,
    refId: refIdFor(order.refKey),
    openedAt: nowMs,
  };
  return placeOrder(tooling, args.ledger, cycle, order, nowMs, opened);
}
