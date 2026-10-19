/**
 * rh-reconcile.test.mjs — proves the auto-journal round-trip builder reproduces
 * the REAL Robinhood fills from 2026-10-19 (account 995386158): two QQQ 0DTE
 * cycles netting +$144 (+57 put, +87 call), the same number get_realized_pnl
 * returns. Run: node --import tsx scripts/rh-reconcile.test.mjs
 */
import assert from "node:assert/strict";
import { roundTripsFromOrders, attachRealized, pnlTradesFrom, analyzeRhJournal, killzoneFor, computeSlippage } from "../src/lib/journal/rh-reconcile.ts";

// ---- real get_option_orders payload (2026-10-19), trimmed to used fields ----
const orders = {
  orders: [
    { id: "6ad625ca", chain_symbol: "QQQ", state: "filled", created_at: "2026-10-19T14:14:34.6Z", updated_at: "2026-10-19T14:14:35Z",
      legs: [{ side: "sell", position_effect: "close", option_type: "call", strike_price: "719.0000", expiration_date: "2026-10-19", option_id: "CALL",
        executions: [{ price: "2.43000000", quantity: "1.00000", timestamp: "2026-10-19T14:14:34.862000Z" }] }] },
    { id: "6ad625b2", chain_symbol: "QQQ", state: "filled", created_at: "2026-10-19T14:14:10.9Z", updated_at: "2026-10-19T14:14:11Z",
      legs: [{ side: "sell", position_effect: "close", option_type: "call", strike_price: "719.0000", expiration_date: "2026-10-19", option_id: "CALL",
        executions: [{ price: "2.14000000", quantity: "1.00000", timestamp: "2026-10-19T14:14:11.084000Z" }] }] },
    { id: "6ad6257c", chain_symbol: "QQQ", state: "filled", created_at: "2026-10-19T14:13:16.7Z", updated_at: "2026-10-19T14:13:17Z",
      legs: [{ side: "buy", position_effect: "open", option_type: "call", strike_price: "719.0000", expiration_date: "2026-10-19", option_id: "CALL",
        executions: [{ price: "1.85000000", quantity: "2.00000", timestamp: "2026-10-19T14:13:17.790000Z" }] }] },
    { id: "6ad621d2", chain_symbol: "QQQ", state: "filled", created_at: "2026-10-19T13:57:38.0Z", updated_at: "2026-10-19T13:57:38Z",
      legs: [{ side: "sell", position_effect: "close", option_type: "put", strike_price: "718.0000", expiration_date: "2026-10-19", option_id: "PUT",
        executions: [{ price: "2.23000000", quantity: "3.00000", timestamp: "2026-10-19T13:57:38.286000Z" }] }] },
    { id: "6ad6218e", chain_symbol: "QQQ", state: "filled", created_at: "2026-10-19T13:56:30.4Z", updated_at: "2026-10-19T13:56:31Z",
      legs: [{ side: "buy", position_effect: "open", option_type: "put", strike_price: "718.0000", expiration_date: "2026-10-19", option_id: "PUT",
        executions: [
          { price: "2.04000000", quantity: "1.00000", timestamp: "2026-10-19T13:56:30.737000Z" },
          { price: "2.04000000", quantity: "1.00000", timestamp: "2026-10-19T13:56:30.737000Z" },
          { price: "2.04000000", quantity: "1.00000", timestamp: "2026-10-19T13:56:30.737000Z" },
        ] }] },
  ],
};

const pnl = pnlTradesFrom({
  trades: [
    { timestamp: "2026-10-19T14:14:34Z", symbol: "QQQ", side: "sell", quantity: "1", price: "243", realized_gain: "58" },
    { timestamp: "2026-10-19T14:14:11Z", symbol: "QQQ", side: "sell", quantity: "1", price: "214", realized_gain: "29" },
    { timestamp: "2026-10-19T13:57:38Z", symbol: "QQQ", side: "sell", quantity: "3", price: "223", realized_gain: "57" },
  ],
});

const trips = attachRealized(roundTripsFromOrders(orders), pnl);

assert.equal(trips.length, 2, "two round-trip cycles");

const put = trips.find((t) => t.optionType === "put");
const call = trips.find((t) => t.optionType === "call");
assert.ok(put && call, "a put cycle and a call cycle");

// put: short, 3x 718P, 2.04 -> 2.23, +57
assert.equal(put.side, "short");
assert.equal(put.contracts, 3);
assert.equal(Number(put.debit.toFixed(2)), 2.04);
assert.equal(Number(put.credit.toFixed(2)), 2.23);
assert.equal(put.realized, 57);
assert.equal(put.status, "closed");

// call: long, 2x 719C, 1.85 -> 2.285 avg, +87 (29 + 58)
assert.equal(call.side, "long");
assert.equal(call.contracts, 2);
assert.equal(Number(call.debit.toFixed(2)), 1.85);
assert.equal(call.realized, 87);
assert.equal(call.closeCount, 2, "call closed across two orders");

const total = trips.reduce((s, t) => s + (t.realized ?? 0), 0);
assert.equal(total, 144, "total realized reproduces get_realized_pnl ($144)");

// analyzer rollup
const rows = trips.map((t) => ({ realized: t.realized, roi: t.roi, hold_secs: t.holdSecs, win: t.realized > 0, card_band: "A", side: t.side, killzone: killzoneFor(t.openedAt), card_match: "none" }));
const a = analyzeRhJournal(rows);
assert.equal(a.overall.n, 2);
assert.equal(a.overall.realizedTotal, 144);
assert.equal(a.overall.winRate, 1);
assert.equal(a.unbound, 2);

// killzone: 13:56 UTC = 09:56 ET -> nyAm.
assert.equal(killzoneFor(put.openedAt), "nyAm");

// slippage: adverse-positive, side-aware. long chased up (+2), short filled worse (+1).
assert.equal(computeSlippage("long", 100, 102), 2); // paid 2 pts up
assert.equal(computeSlippage("short", 100, 99), 1); // sold 1 pt lower than plan
assert.equal(computeSlippage("long", 100, 98), -2); // price came to you
assert.equal(computeSlippage("long", null, 102), null);

console.log("rh-reconcile.test: OK");
console.log(`  put  +${put.realized}  (3x QQQ 718P ${put.debit}->${put.credit}, hold ${put.holdSecs}s, ${killzoneFor(put.openedAt)})`);
console.log(`  call +${call.realized}  (2x QQQ 719C ${call.debit}->${(call.creditTotal / call.contracts / 100).toFixed(3)}, ${call.closeCount} closes, hold ${call.holdSecs}s)`);
console.log(`  total +$${total}  ==  get_realized_pnl day total`);
