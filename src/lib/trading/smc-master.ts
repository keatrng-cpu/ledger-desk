/**
 * Live SMC sequence grade — one tape, independent layers, no school-stacking.
 *
 * ICT maps a narrative. TJR is sweep → 5m confirm. Blake is IFVG mechanical.
 * This desk prices DOL, demands sweep polarity, dealing-range location, then
 * LTF shift, then the retrace. A single concept is never TAKE.
 */

import { isHighProbPath } from "@/lib/alerts/path-alarm";
import { isJudasWindow, type SessionClock } from "./sessions";
import {
  canonInputForCandidate,
  scoreCanonStack,
  type CanonStack,
} from "./smc-canon";
import type { SmcTape } from "./smc-board";
import type { HtfBiasRead, SmtStack } from "./structure";
import type { DrawRead } from "./draw";
import type { MarketNarrative } from "./market-narrative";
import type { ScanResult, SetupCandidate } from "./scanner";
import type { NewsRead } from "./news";

export type SmcLayerState = "pass" | "wait" | "fail";

export interface SmcLayer {
  id: string;
  label: string;
  must: boolean;
  state: SmcLayerState;
  detail: string;
  price?: number;
}

export interface SmcMasterBook {
  symbol: string;
  side: "long" | "short" | null;
  word: "TAKE" | "WAIT" | "STAND";
  /** Label of the first must-layer that is not passing (or "Sequence complete"). */
  missing: string;
  /** Why that layer is not passing, in tape terms — the one line a trader needs. */
  missingDetail: string;
  layers: SmcLayer[];
  mustPass: number;
  mustNeed: number;
  canon: CanonStack;
  entry: string;
  invalidation: string;
  t1: string;
  t2: string;
  pathBand: string | null;
}

export interface SmcMasterRead {
  left: SmcMasterBook;
  right: SmcMasterBook;
  oneBook: SmcMasterBook | null;
  thesis: string;
  vsSchools: string;
}

export interface SmcMasterInput {
  clock: SessionClock;
  bias: { left: HtfBiasRead; right: HtfBiasRead };
  scan: ScanResult;
  draws: { left: DrawRead; right: DrawRead };
  narrative: { left: MarketNarrative; right: MarketNarrative };
  news: NewsRead;
  smtStack?: SmtStack;
  smc?: { left: SmcTape; right: SmcTape };
  /** Live prints — the retrace layer is a fact about WHERE price is now. */
  quotes?: { left: { price: number }; right: { price: number } };
  /** Post-shock: arrays/sweeps before this ms don't count (fresh sequence only). */
  shockFloorMs?: number | null;
}

function factorState(
  pass: boolean,
  must: boolean,
  waiting: boolean,
): SmcLayerState {
  if (pass) return "pass";
  if (!must || waiting) return "wait";
  return "fail";
}

function pickCandidate(
  scan: ScanResult,
  bias: HtfBiasRead,
): SetupCandidate | undefined {
  const book = scan.candidates.filter((c) => c.symbol === bias.symbol);
  const need = bias.topDown === "bull" ? "long" : bias.topDown === "bear" ? "short" : null;
  const aligned = need ? book.find((c) => c.side === need) : undefined;
  const path = book.find((c) => isHighProbPath(c));
  return path ?? aligned ?? [...book].sort((a, b) => b.confluence - a.confluence)[0];
}

function gradeBook(
  bias: HtfBiasRead,
  draw: DrawRead,
  narrative: MarketNarrative,
  scan: ScanResult,
  clock: SessionClock,
  news: NewsRead,
  smtOn: boolean,
  tape: SmcTape | undefined,
  price: number | null,
  shockFloorMs: number | null,
): SmcMasterBook {
  const cand = pickCandidate(scan, bias);
  const side =
    cand?.side ??
    (bias.topDown === "bull" ? "long" : bias.topDown === "bear" ? "short" : null);
  const canon = scoreCanonStack(
    cand
      ? canonInputForCandidate(cand, bias, narrative, clock)
      : {
          side,
          htf: bias.topDown,
          mtf: bias.mid,
          dealingZone: bias.dealing?.zone ?? null,
          swept: narrative.liquidity.lastSweep,
          confirmation: narrative.confirmation,
          inKillzone: clock.inTradeWindow,
          killzoneLabel: clock.killzoneLabel,
          smt: smtOn,
          components: [],
          strategy: null,
        },
  );

  const judas = isJudasWindow(clock.etHour, clock.etMinute);
  const newsBlk = news.verdict === "blackout";
  const dol = draw.primary;
  const dolAgrees =
    !!dol &&
    ((side === "short" && dol.side === "below") ||
      (side === "long" && dol.side === "above"));

  const layers: SmcLayer[] = canon.factors.map((f) => {
    const waiting =
      (f.id === "sweep" && narrative.liquidity.lastSweep === "none") ||
      (f.id === "ltf" &&
        (narrative.confirmation === "sweep_only" ||
          narrative.confirmation === "none")) ||
      (f.id === "time" && !clock.inTradeWindow);
    return {
      id: f.id,
      label: f.label,
      must: f.must,
      state: factorState(f.pass, f.must, waiting),
      detail: f.detail,
    };
  });

  layers.unshift({
    id: "dol",
    label: "Draw on liquidity",
    must: true,
    state: !dol ? "wait" : dolAgrees ? "pass" : "fail",
    detail: dol
      ? `${dol.name} ${dol.price.toFixed(2)} · ${(dol.reachProbability * 100).toFixed(0)}% · ${dol.side}`
      : "No magnet yet",
    price: dol?.price,
  });

  const shiftPrinted =
    narrative.confirmation === "confirmed" ||
    narrative.confirmation === "sweep_displace" ||
    narrative.confirmation === "armed_entry";

  // The array the retrace goes INTO: same side as the trade, still fresh, and
  // formed after the raid (an array from before the sweep is the leg into
  // liquidity, not the reversal's footprint). Nearest to price wins.
  const want: "bull" | "bear" | null =
    side === "long" ? "bull" : side === "short" ? "bear" : null;
  const raidT = narrative.liquidity.lastSweepT;
  // After a shock, the array must have formed AFTER the shock too — a
  // pre-shock FVG is a relic of the old regime, not a retrace target.
  const floorT = Math.max(raidT ?? 0, shockFloorMs ?? 0) || null;
  const candidates = want
    ? (tape?.arrays ?? []).filter(
        (a) =>
          a.side === want &&
          (a.kind === "ifvg" || a.kind === "fvg" || a.kind === "ob") &&
          (a.state === "fresh" || a.state === "partial") &&
          (floorT == null || a.t >= floorT),
      )
    : [];
  const fresh =
    price != null
      ? [...candidates].sort(
          (a, b) => Math.abs(a.mid - price) - Math.abs(b.mid - price),
        )[0]
      : candidates[0];
  const mss = want
    ? tape?.alerts.find(
        (a) =>
          a.side === want && (a.kind === "mss" || a.kind === "displacement"),
      )
    : undefined;

  // RETRACE = price is IN the array now (± a quarter of its height). Before
  // 2026-09-16 this layer passed on narrative "armed_entry", which only meant
  // "a sweep, a shift and SOME array exist" — true at the top of the impulse,
  // i.e. exactly the print the desk says never to chase.
  let retraceState: SmcLayerState = "wait";
  let retraceDetail: string;
  if (!shiftPrinted) {
    retraceDetail = "No retrace until LTF shift exists";
  } else if (!fresh) {
    retraceDetail = "Shift printed — no fresh FVG/IFVG/OB on this side after the raid yet";
  } else if (price == null) {
    retraceDetail = `${fresh.kind.toUpperCase()} ${fresh.bottom.toFixed(2)}–${fresh.top.toFixed(2)} — no live print to place you`;
  } else {
    const pad = Math.max((fresh.top - fresh.bottom) * 0.25, 0.25);
    const inside = price >= fresh.bottom - pad && price <= fresh.top + pad;
    if (inside) {
      retraceState = "pass";
      retraceDetail = `In ${fresh.tf} ${fresh.kind.toUpperCase()} ${fresh.bottom.toFixed(2)}–${fresh.top.toFixed(2)} · limit at CE ${fresh.mid.toFixed(2)}`;
    } else {
      const away = price > fresh.top ? price - fresh.top : fresh.bottom - price;
      const dir = price > fresh.top ? "above" : "below";
      retraceDetail = `${fresh.kind.toUpperCase()} ${fresh.bottom.toFixed(2)}–${fresh.top.toFixed(2)} is ${away.toFixed(2)}pt ${dir} price — wait for it, do not chase ${price.toFixed(2)}`;
    }
  }
  layers.push({
    id: "retrace",
    label: "Retrace into array",
    must: true,
    state: retraceState,
    detail: retraceDetail,
    price: fresh?.mid,
  });

  layers.push({
    id: "array",
    label: "Live PD array",
    must: false,
    state: fresh ? "pass" : "wait",
    detail: fresh
      ? `${fresh.tf} ${fresh.kind} ${fresh.label}${mss ? ` · ${mss.kind}` : ""}`
      : "No fresh FVG/IFVG/OB on this side",
    price: fresh?.mid,
  });

  layers.push({
    id: "clean",
    label: "Judas / news",
    must: true,
    state: judas || newsBlk ? "fail" : "pass",
    detail: judas
      ? "Judas 9:30–9:45 — name the raid"
      : newsBlk
        ? news.reason || "News blackout"
        : "Tape is tradable",
  });

  const musts = layers.filter((l) => l.must);
  const mustPass = musts.filter((l) => l.state === "pass").length;
  const mustNeed = musts.length;
  const mustFail = musts.find((l) => l.state === "fail");
  const mustWait = musts.find((l) => l.state === "wait");
  const pathOk = isHighProbPath(cand);

  let word: SmcMasterBook["word"] = "STAND";
  if (mustFail) word = "STAND";
  else if (mustWait || !pathOk) word = "WAIT";
  else if (mustPass === mustNeed && pathOk) word = "TAKE";

  const blocker = mustFail ?? mustWait ?? null;
  const missing =
    blocker?.label ?? (!pathOk ? "No A+/A/A− PATH" : "Sequence complete");
  const missingDetail =
    blocker?.detail ??
    (!pathOk
      ? cand
        ? `${cand.symbol} ${cand.side} grades ${String(cand.pathBand || cand.grade)} Q ${cand.confluence.toFixed(2)} — below the PATH bar`
        : "No candidate on this book"
      : "All must-layers pass");

  return {
    symbol: bias.symbol,
    side,
    word,
    missing,
    missingDetail,
    layers,
    mustPass,
    mustNeed,
    canon,
    entry:
      cand?.entryZone ??
      (fresh
        ? `${fresh.kind.toUpperCase()} ${fresh.bottom.toFixed(2)}–${fresh.top.toFixed(2)}`
        : "await array"),
    invalidation: cand?.invalidation ?? "Beyond the sweep extreme",
    t1: cand?.targets[0] ?? (dol ? `${dol.name} ${dol.price.toFixed(2)}` : "IRL"),
    t2: cand?.targets[1] ?? "ERL runner",
    pathBand: cand ? String(cand.pathBand || cand.grade) : null,
  };
}

export function gradeSmcMaster(desk: SmcMasterInput): SmcMasterRead {
  const smtOn =
    desk.scan.smt.edge !== "none" || Boolean(desk.smtStack?.primary.active);
  const left = gradeBook(
    desk.bias.left,
    desk.draws.left,
    desk.narrative.left,
    desk.scan,
    desk.clock,
    desk.news,
    smtOn,
    desk.smc?.left,
    desk.quotes?.left.price ?? null,
    desk.shockFloorMs ?? null,
  );
  const right = gradeBook(
    desk.bias.right,
    desk.draws.right,
    desk.narrative.right,
    desk.scan,
    desk.clock,
    desk.news,
    smtOn,
    desk.smc?.right,
    desk.quotes?.right.price ?? null,
    desk.shockFloorMs ?? null,
  );

  const ranked = [left, right].sort((a, b) => {
    const rank = (w: SmcMasterBook["word"]) =>
      w === "TAKE" ? 2 : w === "WAIT" ? 1 : 0;
    if (rank(a.word) !== rank(b.word)) return rank(b.word) - rank(a.word);
    return b.mustPass - a.mustPass;
  });
  const oneBook = ranked[0] ?? null;

  const vsSchools =
    "ICT narrates; we price DOL. TJR is sweep→5m confirm — we add dealing-range + retrace + one book. Blake IFVG without the raid is B+. Sequence or STAND.";

  const thesis = oneBook
    ? `${oneBook.word} ${oneBook.symbol} ${oneBook.side ?? ""} · ${oneBook.mustPass}/${oneBook.mustNeed} · ${oneBook.missing}`.trim()
    : "STAND — map DOL and wait.";

  return { left, right, oneBook, thesis, vsSchools };
}
