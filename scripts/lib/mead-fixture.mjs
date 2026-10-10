/**
 * A prediction board for the Mead Hall's verifiers, built through the REAL chain and nothing else:
 *
 *   committed Kalshi fixture → Predict board (parseKalshiEvents + parseEspnScoreboard + buildBoard) → the sports scanner (scanBoard)
 *   → model inputs (modelInputsFromScanRows) → the signal engine (buildSignalBoard) → the hall's Lite (hallLiteFrom).
 *
 * Time is movable: the fixture's absolute times (a Monday night, 22:00 ET) are shifted so a simulation on any clock sees the same
 * board, read at the last ten-minute poll before `nowMs` (the room's poll interval), with settle times the same distance ahead.
 * Nothing here is invented: every price is the fixture's, every model is the scanner's reference for that ticker.
 */
import { readFileSync } from "node:fs";

const B = await import("../../src/lib/predict/board.ts");
const S = await import("../../src/lib/predict/scanner.ts");
const E = await import("../../src/lib/predict/signals.ts");
const M = await import("../../src/lib/predict/math.ts");
const GL = await import("../../src/lib/predict/go-ledger.ts");
const JR = await import("../../src/lib/predict/journal.ts");
const PS = await import("../../src/lib/predict/paper-scorer.ts");
const H = await import("../../src/lib/room/hall-lite.ts");

export const FIXTURE = JSON.parse(readFileSync(new URL("../../src/lib/predict/fixtures/kalshi-markets.sample.json", import.meta.url), "utf8"));
export const FIXTURE_MS = Date.parse(FIXTURE.asOf);
export const POLL_MS = 10 * 60_000;
const iso = (ms) => new Date(ms).toISOString();

const nfl = FIXTURE.markets.filter((m) => m.series === "KXNFLGAME" || /^KXNFLGAME/.test(m.ticker));
const kalshiEvents = {
  events: [
    {
      event_ticker: "KXNFLGAME-26OCT05MINDET",
      title: "Minnesota at Detroit",
      markets: nfl.map((m) => ({
        ticker: m.ticker,
        yes_sub_title: m.yes_sub_title,
        yes_bid_dollars: m.yes_bid_dollars,
        yes_ask_dollars: m.yes_ask_dollars,
        last_price_dollars: m.last_price_dollars ?? m.yes_ask_dollars,
        volume_fp: m.volume_fp ?? "100000",
        volume_24h_fp: m.volume_24h_fp ?? "80000",
        yes_ask_size_fp: m.yes_ask_size_fp,
        yes_bid_size_fp: m.yes_bid_size_fp ?? m.yes_ask_size_fp,
        status: "active",
      })),
    },
  ],
};
const espn = {
  events: [
    {
      id: "9001",
      date: "2026-10-06T02:15Z",
      status: { type: { state: "pre", shortDetail: "10/5 - 10:15 PM EDT" } },
      competitions: [
        {
          competitors: [
            { homeAway: "home", team: { abbreviation: "DET", displayName: "Detroit Lions" }, score: "0" },
            { homeAway: "away", team: { abbreviation: "MIN", displayName: "Minnesota Vikings" }, score: "0" },
          ],
          odds: [{ details: "MIN -3", overUnder: 47.5, moneyline: { home: { close: { odds: "+125" } }, away: { close: { odds: "-145" } } } }],
        },
      ],
    },
  ],
};

let scanMemo = null;
/** The scanner's rows for the fixture game (the real scanSide), as they were at the fixture's own time. */
export function scanRows(prevGap = 0.05) {
  if (prevGap === 0.05 && scanMemo) return scanMemo;
  const games = B.parseEspnScoreboard(espn);
  const events = B.parseKalshiEvents(kalshiEvents);
  const board = B.buildBoard("nfl", games, events);
  const prev = new Map(nfl.map((m) => [m.ticker, prevGap]));
  const rows = S.scanBoard(board, M.DEFAULT_FEES, prev, FIXTURE_MS);
  if (prevGap === 0.05) scanMemo = rows;
  return rows;
}

const shiftIso = (v, shift) => (typeof v === "string" ? iso(Date.parse(v) + shift) : v);

/** Raw Kalshi rows moved onto `nowMs`'s clock: same prices, same distance to close. */
export function rawAt(pollMs) {
  const shift = pollMs - FIXTURE_MS;
  return FIXTURE.markets.map((m) => ({
    ...m,
    close_time: shiftIso(m.close_time, shift),
    expiration_time: shiftIso(m.expiration_time, shift),
    expected_expiration_time: shiftIso(m.expected_expiration_time, shift),
    open_time: m.open_time ? shiftIso(m.open_time, shift) : m.open_time,
  }));
}

/** Real hourly trades for one market: a steady drift of `centsPerHour` over six hours, ending at the mid. */
export function driftHistory(pollMs, mid, centsPerHour) {
  const pts = [];
  for (let k = 5; k >= 1; k--) pts.push({ at: iso(pollMs - k * 3_600_000), price: Math.min(0.99, Math.max(0.01, mid - (centsPerHour * k) / 100)), kind: "trade" });
  return { open: { at: iso(pollMs - 6 * 3_600_000), price: Math.min(0.99, Math.max(0.01, mid - (centsPerHour * 6) / 100)), kind: "trade" }, points: pts };
}

/**
 * The signal board for one poll. opts.models: use the scanner's references (default true). opts.drift: cents per hour on the Minnesota
 * contract (and the opposite way on Detroit's when opts.both), or 0/undefined for no candle reads at all.
 */
const boardMemo = new Map();
export function boardAt(pollMs, opts = {}) {
  const key = `${pollMs}|${opts.models === false ? 0 : 1}|${opts.drift ?? 0}|${opts.both ? 1 : 0}`;
  const hit = boardMemo.get(key);
  if (hit) return hit;
  const out = buildBoard(pollMs, opts);
  if (boardMemo.size > 400) boardMemo.clear();
  boardMemo.set(key, out);
  return out;
}

function buildBoard(pollMs, opts) {
  const models = opts.models === false ? {} : E.modelInputsFromScanRows(scanRows(), iso(pollMs));
  const history = {};
  if (opts.drift) {
    history["KXNFLGAME-26OCT05MINDET-MIN"] = driftHistory(pollMs, 0.55, opts.drift);
    if (opts.both) history["KXNFLGAME-26OCT05MINDET-DET"] = driftHistory(pollMs, 0.45, -opts.drift);
  }
  return E.buildSignalBoard({ raw: rawAt(pollMs), asOf: iso(pollMs) }, { now: pollMs + 3_000, models, history: Object.keys(history).length ? history : undefined });
}

/** A go ledger, a journal and a paper book small enough to read, or empty. */
export function recordLite(kind = "small") {
  if (kind === "empty") return H.recordLiteFrom(GL.goStats([]), JR.readJournal([]), PS.scorePaper([]));
  const go = [
    { key: "a", gameId: "1", league: "nfl", game: "X @ Y", team: "X", phase: "pre", at: "2026-10-04T12:00:00Z", ask: 0.5, fair: 0.56, fee: 0.0175, result: 1, pnl: 0.4825 },
    { key: "b", gameId: "2", league: "nfl", game: "Z @ W", team: "Z", phase: "pre", at: "2026-10-04T13:00:00Z", ask: 0.4, fair: 0.46, fee: 0.0168, result: 0, pnl: -0.4168 },
    { key: "c", gameId: "3", league: "nfl", game: "Q @ R", team: "Q", phase: "in", at: "2026-10-04T14:00:00Z", ask: 0.3, fair: 0.4, fee: 0.0147 },
  ];
  return H.recordLiteFrom(GL.goStats(go), JR.readJournal([]), PS.scorePaper([]));
}

/** The hall as the talk sees it at `nowMs`: the last ten-minute poll's board, aged to now. */
export function hallAt(nowMs, opts = {}) {
  const pollMs = Math.floor(nowMs / POLL_MS) * POLL_MS;
  const board = boardAt(pollMs, opts);
  return H.hallLiteFrom({
    board,
    nowMs,
    scan: opts.models === false ? null : scanRows(),
    scanAsOf: iso(pollMs),
    held: Boolean(opts.held),
    record: opts.record === undefined ? recordLite("small") : opts.record,
  });
}

export function predictAt(nowMs, opts = {}) {
  const pollMs = Math.floor(nowMs / POLL_MS) * POLL_MS;
  return H.predictLiteFromBoard(boardAt(pollMs, opts), nowMs);
}

/** The Predict tab's board as `getPredictBoard` would return it (the real parse + match), for a pull run on fixtures. */
export function predictBoardAt(pollMs) {
  const games = B.parseEspnScoreboard(espn);
  const events = B.parseKalshiEvents(kalshiEvents);
  return { league: "nfl", fetchedAt: iso(pollMs), games: B.buildBoard("nfl", games, events), failed: [], note: "fixture" };
}

/** The signal board as `getPredictionSignals` would return it for these model inputs. */
export function signalsAt(pollMs, models = {}) {
  return E.buildSignalBoard({ raw: rawAt(pollMs), asOf: iso(pollMs) }, { now: pollMs + 3_000, models });
}
