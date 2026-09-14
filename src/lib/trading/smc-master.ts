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
  missing: string;
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

  const retracePass = narrative.confirmation === "armed_entry";
  const shiftPrinted =
    narrative.confirmation === "confirmed" ||
    narrative.confirmation === "sweep_displace" ||
    narrative.confirmation === "armed_entry";
  layers.push({
    id: "retrace",
    label: "Retrace into array",
    must: true,
    state: retracePass ? "pass" : "wait",
    detail: retracePass
      ? "Armed retrace — limit at FVG CE / IFVG / last OB. Never the impulse print."
      : shiftPrinted
        ? "Shift printed — wait the first clean retrace, do not chase"
        : "No retrace until LTF shift exists",
  });

  const want: "bull" | "bear" | null =
    side === "long" ? "bull" : side === "short" ? "bear" : null;
  const fresh = want
    ? tape?.arrays.find(
        (a) =>
          a.side === want &&
          (a.kind === "ifvg" || a.kind === "fvg" || a.kind === "ob") &&
          (a.state === "fresh" || a.state === "partial"),
      )
    : undefined;
  const mss = want
    ? tape?.alerts.find(
        (a) =>
          a.side === want && (a.kind === "mss" || a.kind === "displacement"),
      )
    : undefined;
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

  const missing =
    mustFail?.label ??
    mustWait?.label ??
    (!pathOk ? "No A+/A/A− PATH" : "Sequence complete");

  return {
    symbol: bias.symbol,
    side,
    word,
    missing,
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
