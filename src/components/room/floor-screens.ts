/**
 * What every screen in the office shows — the TVs, the monitors, the
 * whiteboard, the marquee, the clocks — drawn on 2D canvases that the 3D
 * scene uses as textures. Pure drawing: every value comes from the frame
 * (the cycle, the desk, the book, the news feed); nothing is computed here
 * that the floor did not already decide.
 */

import type { OhlcBar } from "@/lib/market/types";
import type { AgentAct, MindState } from "@/lib/room/agents";
import type { Lenses } from "@/lib/room/debate";
import type { LabRead } from "@/lib/room/lab";
import type { AuditItem } from "@/lib/room/audit";
import { floorCues, type FloorCues } from "@/lib/room/floor-cues";
import { CATALYST_MAX_AGE_DAYS, type FeedRead, type GoalLite, type InvestLite, type InvestThemeLite, type RndLite, type ScanCardLite, type SeatsLite } from "@/lib/room/live-types";
import { boardAgenda, daysBetween, dayPhrase, freshCatalysts, lookAt, themeOfTheDay, watchHit } from "@/lib/room/invest-read";
import { etWallParts } from "@/lib/trading/sessions";
import { feedTone } from "@/lib/ui/feed-tone";
import type { Character, RoomOutput, RoomTrace, UnderlierTape } from "@/lib/room/orchestrator";
import type { Underlier } from "@/lib/room/option-math";

/**
 * What the annex offices and the scanner TV draw: the race (goal, five seats), the R&D board, the desk audit, the setup
 * scanner and the feed's health. Built once per desk refresh from the same reads the live talk quotes.
 */
export interface RaceScreen {
  goal: GoalLite | null;
  seats: SeatsLite | null;
  rnd: RndLite | null;
  audit: AuditItem[];
  scanner: ScanCardLite[];
  feed: FeedRead | null;
  execFlags: { name: string; on: boolean }[];
}

/** Nova's ledger for the card under review or the position held — what the jumbotron's east face draws. */
export interface LedgerScreen {
  title: string;
  contract: string;
  held: boolean;
  measured: boolean;
  pT1Model: number;
  windowBars: number;
  share: number | null;
  paths: { kind: "t1" | "loss" | "none"; p: number; pnlUsd: number; clock: string }[];
  evUsd: number;
  /** The same paths on the model's out-of-sample hit rate — Sterling's number, quoted, not gating. */
  evCalUsd: number | null;
  pCal: number | null;
  t1Pays: boolean;
  /** Held: holding minus selling now, per contract. */
  edgeUsd: number | null;
}

export interface ChartSeries {
  symbol: string;
  price: number;
  bars: OhlcBar[];
  tf: string;
}

export interface FloorScreens {
  market: Record<Underlier, UnderlierTape>;
  charts: Record<Underlier, ChartSeries | null>;
  plan: { symbol: string; side: "long" | "short"; entry: number; stop: number; t1: number | null; t2: number | null } | null;
  news: { title: string; source: string; age: string }[];
  calendar: { timeEt: string; name: string; impact: string; status: "printed" | "next" | "later" }[];
  book: {
    cash: number;
    equity: number;
    start: number;
    dayPnl: number;
    positions: { id: string; contracts: number; pnlPct: number; bid: number | null }[];
    events: string[];
  };
  vix: number | null;
  tenYear: number | null;
  research: Partial<Record<Character, string[]>>;
  source: string;
  synthetic: boolean;
  ledger: LedgerScreen | null;
  lab: LabRead | null;
  lenses: Lenses | null;
  /** The room's number for the card (debate.ts consensus). */
  roomP: number | null;
  /** The race, the audit, the scanner and the feed, for the annex offices and the scanner TV. */
  race: RaceScreen | null;
  /** Overnight through a week, graded live. Empty until the desk builds the swing book. */
  swing: { name: string; verdict: string; score: number; note: string }[];
  /**
   * The investment wing's TVs and monitors (invest-office.ts). Null until the
   * Invest ledger is read from this browser. The field is referenced in seven
   * places in this file and set by `room-engine.ts`, but was not declared —
   * eighteen typecheck errors on main.
   */
  invest: InvestLite | null;
}

export interface FloorFrame {
  id: number;
  nowMs: number;
  etMin: number;
  clockLabel: string;
  output: RoomOutput;
  trace: RoomTrace;
  acts: Record<Character, AgentAct> | null;
  minds: MindState | null;
  screens: FloorScreens;
  caption: string | null;
}

/** The office's props, from this frame. Presentation only. */
export function cuesOfFrame(f: FloorFrame): FloorCues {
  const card = f.trace.entry?.entry ?? null;
  const feed = f.screens.race?.feed ?? null;
  const barsOf = (): { pos: number | null } => {
    const sym = (f.screens.plan?.symbol ?? card?.futSymbol ?? "").toUpperCase();
    const series = /ES|SPY|MES/.test(sym) ? f.screens.charts.SPY : f.screens.charts.QQQ;
    const bars = series?.bars ?? [];
    if (bars.length < 2 || !series) return { pos: null };
    const lo = Math.min(...bars.map((b) => b.l));
    const hi = Math.max(...bars.map((b) => b.h));
    if (!(hi > lo)) return { pos: null };
    return { pos: Math.max(0, Math.min(1, (series.price - lo) / (hi - lo))) };
  };
  const nextHigh = f.screens.calendar.find((c) => c.status === "next" && c.impact === "high");
  let highImpactMin: number | null = null;
  if (nextHigh) {
    const m = /^(\d{1,2}):(\d{2})/.exec(nextHigh.timeEt);
    if (m) highImpactMin = Number(m[1]) * 60 + Number(m[2]) - f.etMin;
  }
  const chase = f.minds?.memories.find((mem) => mem.who === "Jax" && mem.kind === "chase_call");
  const seen = new Set<string>();
  const blocked: string[] = [];
  for (const e of f.screens.race?.seats?.events ?? []) {
    if (!e.seat || seen.has(e.seat)) continue;
    seen.add(e.seat);
    if (e.kind === "blocked") blocked.push(e.seat);
  }
  const L = f.screens.ledger;
  const goal = f.screens.race?.goal ?? null;
  return floorCues({
    etMin: f.etMin,
    beat: f.trace.beat,
    refusalGate: f.trace.refusalGate,
    refusal: f.trace.refusal,
    execute: f.output.broker_action.execute_trade,
    action: f.output.broker_action.action_type,
    feedKind: feed?.kind ?? (f.screens.synthetic ? "synthetic" : null),
    lagSec: feed?.lagSec ?? null,
    synthetic: f.screens.synthetic || feed?.kind === "synthetic",
    verdict: card?.verdict ?? f.screens.race?.scanner.find((c) => c.verdict === "ARMED")?.verdict ?? null,
    band: card?.band ?? null,
    side: card?.futSide ?? f.screens.plan?.side ?? null,
    tier: card?.tier ?? null,
    missing: card?.smcMissing || card?.blocks[0] || null,
    rangePos: barsOf().pos,
    jaxLastChaseWrong: chase?.outcome?.verdict === "wrong",
    quoteAgeSec: null,
    experiments: (f.screens.race?.rnd?.experiments ?? []).map((e) => ({ title: e.title, n: e.n, nNeeded: e.nNeeded, status: e.status })),
    seats: (f.screens.race?.seats?.rows ?? []).map((r) => ({ name: r.name, status: r.status })),
    blockedSeats: blocked,
    leader: f.screens.race?.seats?.leader ?? null,
    refusals: f.screens.lab?.refusals ?? [],
    modelP: L?.pT1Model ?? null,
    calP: L?.pCal ?? null,
    highImpactMin,
    killed: false,
    openPositions: f.screens.book.positions.length,
    winsNeed: goal?.winsNeed ?? null,
    tradeBudget: goal?.tradeBudget ?? null,
    exitReason: f.trace.exit?.reason ?? null,
  });
}

type Ctx = CanvasRenderingContext2D;

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const HAND = "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', 'Chalkboard SE', cursive";

const C = {
  bg: "#070b14",
  panel: "#0d1424",
  grid: "#1c2638",
  text: "#e5edf8",
  muted: "#8a9ab3",
  up: "#22c55e",
  down: "#ef4444",
  amber: "#f59e0b",
  cyan: "#22d3ee",
  violet: "#a78bfa",
  ce: "#facc15",
};

export const URGENCY_COLOR: Record<string, string> = { LOW: "#38bdf8", MEDIUM: "#f59e0b", HIGH_ALERT: "#ef4444" };

const fmt = (n: number, dp = 2) => n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

function clear(ctx: Ctx, w: number, h: number, bg = C.bg) {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
}

function header(ctx: Ctx, w: number, title: string, right: string, accent: string) {
  ctx.fillStyle = C.panel;
  ctx.fillRect(0, 0, w, 44);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 42, w, 2);
  ctx.font = `700 22px ${FONT}`;
  ctx.fillStyle = C.text;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const titleW = ctx.measureText(title).width;
  ctx.fillText(title, 14, 22);
  ctx.font = `600 18px ${MONO}`;
  const room = w - titleW - 36;
  ctx.fillStyle = C.muted;
  ctx.textAlign = "right";
  ctx.fillText(ctx.measureText(right).width > room ? fit(ctx, right, Math.max(40, room)) : right, w - 14, 22);
  ctx.textAlign = "left";
}

function wrap(ctx: Ctx, text: string, x: number, y: number, maxW: number, lineH: number, maxLines: number): number {
  const words = text.split(/\s+/);
  let line = "";
  let lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i]!;
    if (ctx.measureText(test).width > maxW && line) {
      lines++;
      if (lines >= maxLines) {
        ctx.fillText(`${line}…`, x, y);
        return y + lineH;
      }
      ctx.fillText(line, x, y);
      y += lineH;
      line = words[i]!;
    } else line = test;
  }
  if (line) {
    ctx.fillText(line, x, y);
    y += lineH;
  }
  return y;
}

/* ── Charts ─────────────────────────────────────────────────────────────── */

function drawChart(ctx: Ctx, w: number, h: number, s: ChartSeries | null, f: FloorFrame) {
  const cues = cuesOfFrame(f);
  const urg = cues.tint === "amber" ? C.amber : cues.tint === "hatch" ? C.muted : (URGENCY_COLOR[f.output.room_state.market_urgency] ?? C.cyan);
  clear(ctx, w, h);
  if (!s || s.bars.length < 2) {
    header(ctx, w, s?.symbol ?? "—", "no bars", urg);
    ctx.fillStyle = C.muted;
    ctx.font = `500 22px ${FONT}`;
    ctx.fillText("Waiting for the tape…", 20, h / 2);
    return;
  }
  const bars = s.bars.slice(-72);
  const first = bars[0]!.o;
  const chg = ((s.price - first) / first) * 100;
  header(ctx, w, `${s.symbol} · ${s.tf}`, `${fmt(s.price)}  ${chg >= 0 ? "▲" : "▼"}${Math.abs(chg).toFixed(2)}%`, urg);
  const plan = f.screens.plan && f.screens.plan.symbol === s.symbol ? f.screens.plan : null;
  let lo = Math.min(...bars.map((b) => b.l));
  let hi = Math.max(...bars.map((b) => b.h));
  if (plan) {
    for (const v of [plan.entry, plan.stop, plan.t1, plan.t2]) if (v != null) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad;
  hi += pad;
  const top = 56;
  const bottom = h - 26;
  const left = 10;
  const right = w - 92;
  const y = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.font = `500 15px ${MONO}`;
  ctx.fillStyle = C.muted;
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    const yy = y(v);
    ctx.beginPath();
    ctx.moveTo(left, yy);
    ctx.lineTo(right, yy);
    ctx.stroke();
    ctx.fillText(fmt(v, v > 1000 ? 0 : 2), right + 6, yy + 5);
  }
  const step = (right - left) / bars.length;
  bars.forEach((b, i) => {
    const x = left + i * step + step / 2;
    const upBar = b.c >= b.o;
    ctx.strokeStyle = upBar ? C.up : C.down;
    ctx.fillStyle = upBar ? C.up : C.down;
    ctx.beginPath();
    ctx.moveTo(x, y(b.h));
    ctx.lineTo(x, y(b.l));
    ctx.stroke();
    const bh = Math.max(1.5, Math.abs(y(b.o) - y(b.c)));
    ctx.fillRect(x - step * 0.32, Math.min(y(b.o), y(b.c)), step * 0.64, bh);
  });
  if (plan) {
    const line = (v: number | null, col: string, label: string) => {
      if (v == null) return;
      const yy = y(v);
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(left, yy);
      ctx.lineTo(right, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      ctx.font = `700 15px ${MONO}`;
      ctx.fillText(`${label} ${fmt(v, v > 1000 ? 0 : 2)}`, left + 6, yy - 6);
    };
    line(plan.entry, C.ce, "CE");
    line(plan.stop, C.down, "STOP");
    line(plan.t1, C.up, "T1");
    line(plan.t2, "#86efac", "T2");
  }
  ctx.fillStyle = C.muted;
  ctx.font = `500 14px ${FONT}`;
  ctx.fillText(f.screens.synthetic ? "DRILL — synthetic tape" : f.screens.source, left, h - 8);
}

/* ── News, calendar ─────────────────────────────────────────────────────── */

function drawNews(ctx: Ctx, w: number, h: number, f: FloorFrame, big = false) {
  clear(ctx, w, h);
  header(ctx, w, big ? "LOUNGE · NEWS" : "NEWS", f.screens.synthetic ? "DRILL" : "live feeds", C.violet);
  let yy = 70;
  const items = f.screens.news.slice(0, big ? 5 : 6);
  if (!items.length) {
    ctx.fillStyle = C.muted;
    ctx.font = `500 20px ${FONT}`;
    ctx.fillText("No headlines loaded yet.", 16, yy);
    return;
  }
  for (const it of items) {
    ctx.fillStyle = C.cyan;
    ctx.font = `700 14px ${FONT}`;
    ctx.fillText(`${it.source.toUpperCase()} · ${it.age}`, 16, yy);
    yy += 22;
    ctx.fillStyle = C.text;
    ctx.font = `600 ${big ? 24 : 19}px ${FONT}`;
    yy = wrap(ctx, it.title, 16, yy, w - 32, big ? 28 : 23, 2) + 10;
    if (yy > h - 20) break;
  }
}

function drawCalendar(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  clear(ctx, w, h);
  header(ctx, w, "CALENDAR", f.clockLabel, C.amber);
  let yy = 78;
  const cal = f.screens.calendar.slice(0, 6);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  if (!cal.length) {
    ctx.fillStyle = C.muted;
    ctx.font = `600 19px ${FONT}`;
    ctx.fillText("No releases on today's calendar.", 16, yy);
    yy += 30;
  }
  for (const e of cal) {
    if (yy > h - 56) break;
    ctx.fillStyle = e.status === "next" ? C.amber : e.status === "printed" ? C.muted : C.text;
    ctx.font = `700 18px ${MONO}`;
    ctx.fillText(e.timeEt, 16, yy);
    const nameX = 16 + ctx.measureText(e.timeEt).width + 16;
    ctx.font = `600 18px ${FONT}`;
    const mark = e.impact === "high" ? " ●" : "";
    ctx.fillText(fit(ctx, `${e.name}${mark}`, Math.max(48, w - nameX - 16)), nameX, yy);
    const sub = e.status === "printed" ? "printed" : e.status === "next" ? "next — ±15m blackout" : "";
    if (sub) {
      ctx.fillStyle = C.muted;
      ctx.font = `500 14px ${FONT}`;
      ctx.fillText(fit(ctx, sub, Math.max(48, w - nameX - 16)), nameX, yy + 20);
    }
    yy += sub ? 46 : 32;
  }
  ctx.fillStyle = C.text;
  ctx.font = `700 18px ${MONO}`;
  const v = f.screens.vix;
  const t = f.screens.tenYear;
  ctx.fillText(
    fit(ctx, `VIX ${v != null && v > 0 ? v.toFixed(2) : "—"}    10Y ${t != null ? t.toFixed(2) + "%" : "—"}`, w - 32),
    16,
    h - 16,
  );
}

/* ── Whiteboard ─────────────────────────────────────────────────────────── */

/** 09:30, 09:45, 10:00, 11:00. Dim after 10:00 unless the card is A+. Stopped at the flat. */
function drawKillzoneClock(ctx: Ctx, cx: number, cy: number, r: number, etMin: number, cues: FloorCues) {
  ctx.save();
  ctx.globalAlpha = cues.clock.stopped ? 0.35 : cues.clock.dim ? 0.55 : 1;
  ctx.fillStyle = "#f8fafc";
  ctx.strokeStyle = "#1e3a8a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const mark = (min: number, label: string) => {
    const ang = ((min - 9 * 60) / 120) * Math.PI - Math.PI / 2;
    ctx.fillStyle = "#1e3a8a";
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ang) * (r - 8), cy + Math.sin(ang) * (r - 8), 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `700 11px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(label, cx + Math.cos(ang) * (r + 14), cy + Math.sin(ang) * (r + 14));
  };
  mark(9 * 60 + 30, "9:30");
  mark(9 * 60 + 45, "9:45");
  mark(10 * 60, "10");
  mark(11 * 60, "11");
  if (!cues.clock.stopped) {
    const ang = ((Math.min(11 * 60, Math.max(9 * 60 + 30, etMin)) - 9 * 60) / 120) * Math.PI - Math.PI / 2;
    ctx.strokeStyle = "#b91c1c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang) * (r - 12), cy + Math.sin(ang) * (r - 12));
    ctx.stroke();
  }
  ctx.restore();
  ctx.textAlign = "left";
}

function planPrice(f: FloorFrame, symbol: string): number | null {
  const u = /ES/.test(symbol) ? "SPY" : "QQQ";
  const px = f.screens.charts[u]?.price ?? null;
  return typeof px === "number" && px > 0 ? px : null;
}

/** The desk ladder, drawn on the whiteboard: stop, entry, T1, T2, and where price is. */
function drawPlanLadder(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  plan: { side: "long" | "short"; entry: number; stop: number; t1: number | null; t2: number | null },
  price: number | null,
) {
  ctx.save();
  ctx.fillStyle = "#0c1016";
  ctx.fillRect(x, y, w, h);
  const vals = [plan.entry, plan.stop, plan.t1, plan.t2, price].filter((v): v is number => v != null && Number.isFinite(v));
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo) * 0.12 || 1;
  lo -= pad;
  hi += pad;
  const yOf = (p: number) => y + 28 + ((hi - p) / (hi - lo)) * (h - 56);
  const railX = x + w * 0.34;
  const railW = w * 0.16;
  ctx.fillStyle = "#1c2430";
  ctx.fillRect(railX, y + 24, railW, h - 48);
  const band = (a: number, b: number, color: string) => {
    const top = Math.min(yOf(a), yOf(b));
    const bh = Math.max(2, Math.abs(yOf(a) - yOf(b)));
    ctx.fillStyle = color;
    ctx.fillRect(railX, top, railW, bh);
  };
  band(plan.entry, plan.stop, "rgba(220,38,38,0.45)");
  if (plan.t1 != null) band(plan.entry, plan.t1, "rgba(21,128,61,0.40)");
  if (plan.t2 != null) band(plan.t1 ?? plan.entry, plan.t2, "rgba(21,128,61,0.18)");
  const risk = Math.abs(plan.entry - plan.stop) || 1;
  const rungs: { p: number; label: string; color: string }[] = [
    { p: plan.stop, label: "STOP", color: "#f87171" },
    { p: plan.entry, label: "ENTRY · CE", color: "#5eead4" },
  ];
  if (plan.t1 != null) {
    const r = (plan.side === "long" ? plan.t1 - plan.entry : plan.entry - plan.t1) / risk;
    rungs.push({ p: plan.t1, label: `T1 · ${r.toFixed(1)}R`, color: "#86efac" });
  }
  if (plan.t2 != null) {
    const r = (plan.side === "long" ? plan.t2 - plan.entry : plan.entry - plan.t2) / risk;
    rungs.push({ p: plan.t2, label: `T2 · ${r.toFixed(1)}R`, color: "#86efac" });
  }
  const placed = rungs.map((r) => ({ ...r, ly: yOf(r.p) })).sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < placed.length; i++) placed[i]!.ly = Math.max(placed[i]!.ly, placed[i - 1]!.ly + 22);
  ctx.font = `700 18px ${MONO}`;
  ctx.textBaseline = "middle";
  for (const r of placed) {
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(railX, yOf(r.p));
    ctx.lineTo(railX + railW, yOf(r.p));
    ctx.stroke();
    ctx.fillStyle = r.color;
    ctx.textAlign = "right";
    ctx.fillText(r.label, railX - 8, r.ly);
    ctx.textAlign = "left";
    ctx.fillText(fmt(r.p), railX + railW + 8, r.ly);
  }
  if (price != null) {
    const py = Math.max(y + 28, Math.min(y + h - 28, yOf(price)));
    ctx.fillStyle = "#f8fafc";
    ctx.beginPath();
    ctx.moveTo(railX - 8, py);
    ctx.lineTo(railX - 18, py - 6);
    ctx.lineTo(railX - 18, py + 6);
    ctx.closePath();
    ctx.fill();
    ctx.font = `700 14px ${MONO}`;
    ctx.textAlign = "left";
    ctx.fillText("now", railX + railW + 8, py - 16);
  }
  ctx.restore();
}

function drawWhiteboard(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, w, h);
  const ink = "#1d4ed8";
  const red = "#dc2626";
  const green = "#15803d";
  ctx.fillStyle = ink;
  ctx.font = `700 34px ${HAND}`;
  const m = f.trace.meeting;
  const card = f.trace.entry?.entry ?? null;
  const title = m ? m.title : card ? `${card.futSymbol} ${card.futSide} · PATH ${card.band ?? "—"}` : "THE PLAN";
  ctx.fillText(title, 24, 46);
  ctx.font = `600 24px ${HAND}`;
  const p = f.screens.plan;
  if (p) drawPlanLadder(ctx, 16, 64, w * 0.46, h - 150, p, planPrice(f, p.symbol));
  else {
    ctx.fillStyle = "#475569";
    ctx.font = `600 24px ${HAND}`;
    ctx.fillText("no priced plan", 28, 100);
  }
  const b = f.output.broker_action;
  ctx.fillStyle = b.execute_trade ? red : "#334155";
  ctx.font = `700 26px ${HAND}`;
  ctx.fillText(
    b.execute_trade ? `${b.action_type} ${b.contracts_quantity || "all"}× ${b.underlying} ${b.option_type} ${b.strike_offset}` : `HOLD · ${b.underlying} ${b.option_type}`,
    28,
    h - 28,
  );
  // Sterling's list on the right half.
  const gates = f.trace.gates.slice(0, 9);
  let gy = 60;
  ctx.font = `600 20px ${HAND}`;
  for (const g of gates) {
    ctx.fillStyle = g.ok ? green : red;
    ctx.fillText(fit(ctx, `${g.ok ? "✓" : "✗"} ${g.label}`, Math.max(40, w - (16 + w * 0.5) - 16)), 16 + w * 0.5, gy);
    gy += 30;
    if (gy > h - 60) break;
  }
  if (!gates.length) {
    ctx.fillStyle = "#475569";
    ctx.fillText(f.trace.refusal ? fit(ctx, `✗ ${f.trace.refusal}`, w * 0.48) : "nothing to clear", 16 + w * 0.5, gy);
  }
  const cues = cuesOfFrame(f);
  if (cues.stamp) {
    ctx.save();
    ctx.translate(w * 0.72, h * 0.62);
    ctx.rotate(-0.18);
    ctx.strokeStyle = "#b91c1c";
    ctx.lineWidth = 6;
    ctx.strokeRect(-70, -28, 150, 56);
    ctx.fillStyle = "#b91c1c";
    ctx.font = `800 28px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(cues.stamp, 5, 8);
    ctx.restore();
  }
  if (cues.missing) {
    ctx.fillStyle = "#b45309";
    ctx.font = `700 22px ${HAND}`;
    ctx.textAlign = "left";
    ctx.fillText(`PIN · ${cues.missing.slice(0, 28)}`, 28, h - 64);
  }
  if (cues.judas.on) {
    ctx.fillStyle = "#1d4ed8";
    ctx.font = `700 22px ${HAND}`;
    const dir = cues.judas.side === "short" ? "↓" : cues.judas.side === "long" ? "↑" : "·";
    ctx.fillText(`JUDAS ${dir}  raid, not a fill`, 28,  h - 96);
  }
  if (cues.range) {
    const railX = 28;
    const railW = w * 0.36;
    const y = h - 118;
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(railX, y, railW, 8);
    ctx.fillStyle = "#94a3b8";
    ctx.fillRect(railX + railW * 0.45, y - 2, 2, 12);
    const pos = cues.range.zone === "discount" ? 0.22 : cues.range.zone === "premium" ? 0.78 : 0.5;
    ctx.fillStyle = cues.range.hostile ? "#dc2626" : "#15803d";
    ctx.beginPath();
    ctx.arc(railX + railW * pos, y + 4, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `600 16px ${HAND}`;
    ctx.fillStyle = "#334155";
    ctx.fillText(cues.range.zone, railX, y - 8);
  }
  drawKillzoneClock(ctx, w - 120, 78, 46, f.etMin, cues);
}

/* ── Monitors per person ────────────────────────────────────────────────── */

function tapeBlock(ctx: Ctx, w: number, h: number, u: Underlier, f: FloorFrame, accent: string) {
  const t = f.screens.market[u];
  clear(ctx, w, h);
  header(ctx, w, u, f.clockLabel, accent);
  ctx.fillStyle = C.text;
  ctx.font = `800 64px ${MONO}`;
  ctx.fillText(fmt(t.price), 18, 120);
  ctx.font = `600 22px ${MONO}`;
  ctx.fillStyle = t.rsi >= 70 ? C.down : t.rsi <= 30 ? C.up : C.muted;
  ctx.fillText(`RSI ${t.rsi.toFixed(0)}`, 18, 170);
  const rsiW = ctx.measureText(`RSI ${t.rsi.toFixed(0)}`).width;
  ctx.fillStyle = t.volume_spike ? C.amber : C.muted;
  const vol = t.volume_spike ? "VOLUME SPIKE" : "volume normal";
  ctx.fillText(fit(ctx, vol, Math.max(40, w - 36 - rsiW)), 18 + rsiW + 16, 170);
  ctx.fillStyle = t.trend === "BULLISH" ? C.up : t.trend === "BEARISH" ? C.down : C.muted;
  ctx.fillText(t.trend, 18, 210);
  const s = f.screens.charts[u];
  if (s && s.bars.length > 2) {
    const bars = s.bars.slice(-48);
    const lo = Math.min(...bars.map((b) => b.l));
    const hi = Math.max(...bars.map((b) => b.h));
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    bars.forEach((b, i) => {
      const x = 18 + (i / (bars.length - 1)) * (w - 36);
      const yy = h - 18 - ((b.c - lo) / (hi - lo || 1)) * 60;
      if (i) ctx.lineTo(x, yy);
      else ctx.moveTo(x, yy);
    });
    ctx.stroke();
  }
}

function textBlock(ctx: Ctx, w: number, h: number, title: string, right: string, accent: string, lines: string[], size = 19) {
  clear(ctx, w, h);
  header(ctx, w, title, right, accent);
  ctx.fillStyle = C.text;
  ctx.font = `500 ${size}px ${FONT}`;
  let yy = 72;
  for (const l of lines) {
    yy = wrap(ctx, l, 14, yy, w - 28, size + 5, 3) + 6;
    if (yy > h - 10) break;
  }
}

function drawMonitor(id: string, ctx: Ctx, w: number, h: number, f: FloorFrame) {
  const [, who, idxStr] = id.split("_");
  const idx = Number(idxStr);
  const out = f.output;
  const minds = f.minds;
  const rec = minds?.record;
  const research = f.screens.research;
  switch (who) {
    case "Jax":
      if (idx === 0) return tapeBlock(ctx, w, h, "QQQ", f, "#e4572e");
      if (idx === 1) return tapeBlock(ctx, w, h, "SPY", f, "#e4572e");
      return textBlock(ctx, w, h, "CHASE LOG", `rank ${minds?.rank.Jax ?? 50}`, "#e4572e", [
        rec ? `Tape calls today: ${rec.Jax.right} right · ${rec.Jax.wrong} wrong · ${rec.Jax.flat} flat` : "No calls scored yet.",
        ...(minds?.memories.filter((m) => m.who === "Jax").slice(0, 3).map((m) => `${m.clock} ${m.text}${m.outcome ? ` → ${m.outcome.verdict}` : " (open)"}`) ?? []),
        ...(research.Jax ?? []).slice(0, 1),
      ]);
    case "Nova": {
      const e = f.trace.entry;
      const q = e?.quote ?? f.trace.focus.quote;
      if (idx === 0)
        return textBlock(ctx, w, h, "GREEKS (model)", f.screens.synthetic ? "drill" : "BS · VIX-scaled", "#6d28d9", [
          q ? `Strike ${q.strike} · Δ ${Math.abs(q.delta).toFixed(2)} · IV ${(q.iv * 100).toFixed(1)}%` : "No contract in focus.",
          q ? `Bid ${q.bid.toFixed(2)} · Mid ${q.mid.toFixed(2)} · Ask ${q.ask.toFixed(2)}` : "",
          q ? `Theta ${q.thetaDay.toFixed(2)} / share / day` : "",
          e ? `P(T1|fill) ${e.entry.pT1 != null ? Math.round(e.entry.pT1 * 100) + "%" : "n/a"} · E[R] ${e.entry.expR != null ? e.entry.expR.toFixed(2) + "R" : "n/a"}` : "",
          e ? `Theta to 11:00 = ${Math.round(e.decay * 100)}% of the −20% stop` : "",
        ].filter(Boolean));
      return textBlock(ctx, w, h, "RESEARCH", "evidence pack", "#6d28d9", (research.Nova ?? []).slice(0, 3), 17);
    }
    case "Gemma":
      if (idx === 0)
        return textBlock(ctx, w, h, "MACRO", f.clockLabel, "#15803d", [
          ...f.screens.calendar.slice(0, 3).map((c) => `${c.timeEt} ${c.name}${c.status === "printed" ? " (printed)" : c.status === "next" ? " ← next" : ""}`),
          `VIX ${f.screens.vix != null && f.screens.vix > 0 ? f.screens.vix.toFixed(2) : "—"} · 10Y ${f.screens.tenYear != null ? f.screens.tenYear.toFixed(2) + "%" : "—"}`,
          ...(research.Gemma ?? []).slice(0, 1),
        ]);
      return textBlock(ctx, w, h, "HEADLINES", f.screens.synthetic ? "drill" : "live", "#15803d", f.screens.news.slice(0, 4).map((n) => `${n.title} — ${n.source}`), 17);
    case "Sterling":
      if (idx === 0)
        return textBlock(
          ctx,
          w,
          h,
          "THE LIST",
          f.trace.gates.every((g) => g.ok) && f.trace.gates.length ? "CLEAR" : "BLOCKED",
          "#b91c1c",
          f.trace.gates.slice(0, 7).map((g) => `${g.ok ? "✓" : "✗"} ${g.label}`),
          16,
        );
      return textBlock(ctx, w, h, "BOOK", money(f.screens.book.equity), "#b91c1c", [
        `Cash ${money(f.screens.book.cash)} · day ${money(f.screens.book.dayPnl)}`,
        ...f.screens.book.positions.map((p) => `${p.id} ×${p.contracts} ${p.pnlPct >= 0 ? "+" : ""}${p.pnlPct.toFixed(1)}%`),
        rec ? `Vetoes: saved ${money(rec.Sterling.savedUsd)} · cost ${money(rec.Sterling.costUsd)} (model)` : "",
      ].filter(Boolean));
    case "Vince": {
      if (idx === 0)
        return textBlock(ctx, w, h, "ORDER TICKET", out.broker_action.execute_trade ? "SENT" : "IDLE", "#22d3ee", [
          `${out.broker_action.action_type} ${out.broker_action.contracts_quantity}× ${out.broker_action.underlying} ${out.broker_action.option_type} ${out.broker_action.strike_offset}`,
          out.broker_action.target_position_id ? `target ${out.broker_action.target_position_id}` : "no target",
          "paper only — nothing routes to a broker",
        ]);
      if (idx === 1) {
        const q = f.trace.entry?.quote ?? f.trace.focus.quote;
        return textBlock(ctx, w, h, "QUOTE", "model", "#22d3ee", [q ? `${q.strike} ${q.bid.toFixed(2)} × ${q.ask.toFixed(2)} · ${((q.ask - q.bid) * 100).toFixed(0)}¢ wide` : "—"], 22);
      }
      if (idx === 2) {
        const c = f.trace.entry?.entry ?? null;
        return textBlock(ctx, w, h, "TRIGGER", c?.tier?.toUpperCase() ?? "—", "#22d3ee", [
          c?.plan ? `CE ${fmt(c.plan.entry, 2)} on ${c.futSymbol}` : "No CE priced.",
          c?.awayPts != null ? `${c.awayPts.toFixed(1)} pt away` : "",
          c?.pFill != null ? `fill rate at this tier ${Math.round(c.pFill * 100)}%` : "",
        ].filter(Boolean));
      }
      return textBlock(ctx, w, h, "FILLS", `${f.screens.book.events.length}`, "#22d3ee", f.screens.book.events.slice(0, 4), 16);
    }
    default:
      return clear(ctx, w, h);
  }
}

/* ── Wall pieces ────────────────────────────────────────────────────────── */

function drawMarquee(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  clear(ctx, w, h, "#020409");
  const m = f.screens.market;
  const b = f.screens.book;
  const ch = f.screens.charts;
  const parts = [
    `QQQ ${fmt(m.QQQ.price)}`,
    `SPY ${fmt(m.SPY.price)}`,
    ch.QQQ ? `${ch.QQQ.symbol} ${fmt(ch.QQQ.price, 0)}` : "",
    ch.SPY ? `${ch.SPY.symbol} ${fmt(ch.SPY.price, 2)}` : "",
    f.screens.vix != null && f.screens.vix > 0 ? `VIX ${f.screens.vix.toFixed(2)}` : "",
    `ROOM ${money(b.equity)} (${b.equity - b.start >= 0 ? "+" : "−"}${money(Math.abs(b.equity - b.start)).replace("$", "$")})`,
    f.output.room_state.market_urgency.replace("_", " "),
    f.screens.synthetic ? "DRILL — SYNTHETIC" : "PAPER ONLY",
  ].filter(Boolean);
  const text = `${parts.join("   •   ")}   •   `;
  ctx.font = `700 34px ${MONO}`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = URGENCY_COLOR[f.output.room_state.market_urgency] ?? C.cyan;
  const tw = ctx.measureText(text).width;
  for (let x = 0; x < w + tw; x += tw) ctx.fillText(text, x, h / 2 + 2);
}

function drawNeon(ctx: Ctx, w: number, h: number) {
  clear(ctx, w, h, "#0a0710");
  ctx.font = `900 92px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "#ff2d95";
  ctx.shadowBlur = 28;
  ctx.fillStyle = "#ff6bc1";
  ctx.fillText("SEND IT", w / 2, h / 2);
  ctx.shadowBlur = 0;
  ctx.textAlign = "left";
}

function drawChalk(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  ctx.fillStyle = "#1f2d24";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#e7efe7";
  ctx.font = `600 30px ${HAND}`;
  ctx.fillText("E[R] = p·W − (1−p)·L", 24, 56);
  ctx.fillText("1:1 → needs p > ½ + costs", 24, 106);
  ctx.font = `500 22px ${HAND}`;
  let yy = 160;
  for (const l of (f.screens.research.Nova ?? []).slice(0, 2)) yy = wrap(ctx, l, 24, yy, w - 48, 28, 3) + 10;
}

function drawClocks(ctx: Ctx, w: number, h: number, ms: number) {
  ctx.fillStyle = "#2a1d12";
  ctx.fillRect(0, 0, w, h);
  const zones: [string, string][] = [
    ["NEW YORK", "America/New_York"],
    ["CHICAGO", "America/Chicago"],
    ["LONDON", "Europe/London"],
    ["TOKYO", "Asia/Tokyo"],
  ];
  const r = h * 0.33;
  zones.forEach(([label, tz], i) => {
    const cx = (w / zones.length) * (i + 0.5);
    const cy = h * 0.42;
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(ms));
    const hh = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
    const mm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    ctx.fillStyle = "#f5f0e6";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 4;
    const hand = (ang: number, len: number, lw: number) => {
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(ang) * len, cy - Math.cos(ang) * len);
      ctx.stroke();
    };
    hand(((hh % 12) + mm / 60) * (Math.PI / 6), r * 0.55, 5);
    hand(mm * (Math.PI / 30), r * 0.82, 3);
    ctx.fillStyle = "#f5e7c8";
    ctx.font = `700 20px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(label, cx, h - 12);
    ctx.textAlign = "left";
  });
}

function drawPoster(id: string, ctx: Ctx, w: number, h: number, f: FloorFrame) {
  const cues = cuesOfFrame(f);
  if (id === "note_Vince") {
    ctx.fillStyle = cues.blotter === "back" ? "#fecaca" : cues.blotter === "live" ? "#bbf7d0" : "#fde68a";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#1f2937";
    ctx.font = `700 34px ${HAND}`;
    if (cues.blotter === "down") {
      ctx.fillText("FACE DOWN", 18, 70);
      ctx.fillText("until the array", 18, 120);
    } else if (cues.blotter === "back") {
      ctx.fillText("SLID BACK", 18, 70);
      ctx.fillText("no chase", 18, 120);
    } else {
      ctx.fillText("TURNED", 18, 70);
      ctx.fillText("rests at CE", 18, 120);
    }
    return;
  }
  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = cues.kill.lit ? "#ef4444" : "#64748b";
  ctx.lineWidth = 8;
  ctx.strokeRect(18, 18, w - 36, h - 36);
  ctx.fillStyle = cues.kill.lit ? "#ef4444" : "#334155";
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.42, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f8fafc";
  ctx.font = `800 28px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(cues.kill.lit ? "KILL ON" : "KILL", w / 2, h * 0.72);
  ctx.font = `600 16px ${FONT}`;
  ctx.fillText(cues.kill.lit ? (cues.kill.flat ? "flat" : "exits still run") : "server only", w / 2, h * 0.84);
  ctx.textAlign = "left";
}

const PLATE: Record<string, string> = {
  plate_Jax: "JAX — TJR · Momentum",
  plate_Nova: "NOVA — Blake Mech · Quant",
  plate_Gemma: "GEMMA — ICT · Macro",
  plate_Sterling: "STERLING — Patty/PB · Risk",
  plate_Vince: "VINCE — SMC · Execution",
  plate_Rnd: "R&D LAB — fixing the desk",
  plate_Ops: "OPS & DATA — the feed",
  plate_Goal: "GOAL ROOM — $1K → $5K",
  plate_Inv: "INVESTMENT OFFICE — the long game",
  plate_Board: "BOARDROOM — the chair and the five",
  plate_Chair: "CHAIR'S OFFICE — the CEO",
  plate_Manager: "TRADING STAND — the Manager",
  plate_Mead: "MEAD HALL — paper games",
};

function drawPlate(id: string, ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = "#cbd5e1";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#0f172a";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const label = PLATE[id] ?? id;
  let size = 34;
  ctx.font = `700 ${size}px ${FONT}`;
  while (size > 18 && ctx.measureText(label).width > w - 24) {
    size -= 2;
    ctx.font = `700 ${size}px ${FONT}`;
  }
  ctx.fillText(label, w / 2, h / 2 + 2);
  ctx.textAlign = "left";
}

/**
 * Market weather: the sky follows the ET clock (night, dawn, day, dusk) and
 * the VIX — clear under 15, scattered cloud to 20, overcast to 30, a storm
 * with rain and lightning above it. Rain and lightning move with `tSec`.
 */
function drawWindow(ctx: Ctx, w: number, h: number, etMin: number, seed: number, vix: number | null, tSec: number, frost = false) {
  const hour = etMin / 60;
  const night = hour < 6.5 || hour > 19.5;
  const dusk = !night && (hour < 8 || hour > 17.5);
  // No invented VIX: missing/invalid pulse → clear sky from the clock only (same fail-closed as floor-props vixWeather).
  const v = vix != null && Number.isFinite(vix) && vix > 0 ? vix : null;
  const storm = v != null && v >= 30;
  const overcast = v != null && v >= 20;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  if (storm) {
    g.addColorStop(0, night ? "#05060b" : "#1f2430");
    g.addColorStop(1, night ? "#14161f" : "#4b5263");
  } else if (night) {
    g.addColorStop(0, "#020617");
    g.addColorStop(1, "#1e1b4b");
  } else if (dusk) {
    g.addColorStop(0, overcast ? "#334155" : "#1e3a8a");
    g.addColorStop(1, overcast ? "#9a6b3c" : "#f59e0b");
  } else {
    g.addColorStop(0, overcast ? "#64748b" : "#60a5fa");
    g.addColorStop(1, overcast ? "#cbd5e1" : "#dbeafe");
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  if (night && !overcast) {
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    for (let i = 0; i < 40; i++) ctx.fillRect(rnd() * w, rnd() * h * 0.5, 2, 2);
  }
  // Clouds drift slowly with the clock.
  const clouds = v == null ? 0 : v < 15 ? 1 : v < 20 ? 3 : v < 30 ? 6 : 9;
  for (let i = 0; i < clouds; i++) {
    const cx = ((rnd() * w + tSec * (6 + i)) % (w + 220)) - 110;
    const cy = 30 + rnd() * h * 0.3;
    ctx.fillStyle = storm ? "rgba(40,44,56,0.9)" : overcast ? "rgba(203,213,225,0.75)" : "rgba(255,255,255,0.85)";
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.ellipse(cx + k * 34, cy + (k % 2) * 8, 46, 22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  let x = 0;
  while (x < w) {
    const bw = 30 + rnd() * 70;
    const bh = h * (0.25 + rnd() * 0.6);
    ctx.fillStyle = night || storm ? "#0b1020" : dusk ? "#312e81" : "#475569";
    ctx.fillRect(x, h - bh, bw, bh);
    ctx.fillStyle = night || storm ? "#fde68a" : "rgba(226,232,240,0.55)";
    for (let wy = h - bh + 8; wy < h - 6; wy += 14)
      for (let wx = x + 5; wx < x + bw - 6; wx += 12) if (rnd() > (night ? 0.55 : 0.3)) ctx.fillRect(wx, wy, 6, 8);
    x += bw + 4;
  }
  if (overcast) {
    // Rain: streaks that fall with the clock.
    ctx.strokeStyle = storm ? "rgba(191,219,254,0.55)" : "rgba(191,219,254,0.3)";
    ctx.lineWidth = 1.5;
    const drops = storm ? 140 : v != null && v >= 25 ? 60 : 0;
    for (let i = 0; i < drops; i++) {
      const dx = rnd() * w;
      const dy = (rnd() * h + tSec * 420) % h;
      ctx.beginPath();
      ctx.moveTo(dx, dy);
      ctx.lineTo(dx - 6, dy + 18);
      ctx.stroke();
    }
  }
  if (storm) {
    // Lightning: a deterministic flash a few times a minute.
    const beat = Math.floor(tSec * 2);
    const flash = ((beat * 2654435761) >>> 0) % 37 === 0;
    if (flash) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#f8fafc";
      ctx.lineWidth = 3;
      ctx.beginPath();
      let lx = w * (0.2 + ((beat * 7) % 60) / 100);
      let ly = 0;
      ctx.moveTo(lx, ly);
      while (ly < h * 0.7) {
        lx += (rnd() - 0.5) * 50;
        ly += 30 + rnd() * 30;
        ctx.lineTo(lx, ly);
      }
      ctx.stroke();
    }
  }
  if (frost) {
    ctx.fillStyle = "rgba(226,232,240,0.55)";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 28; i++) {
      const x = ((seed * (i + 3)) % 97) / 97 * w;
      const y = ((seed * (i + 11)) % 89) / 89 * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 18, y + 4);
      ctx.moveTo(x + 6, y - 8);
      ctx.lineTo(x + 10, y + 14);
      ctx.stroke();
    }
    ctx.fillStyle = "#0f172a";
    ctx.font = `700 22px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("T−15  ·  high impact", w / 2, h - 28);
    ctx.textAlign = "left";
  }
}

/* ── The jumbotron (quant wall) and the league table ─────────────────────── */

const CREW_ORDER: Character[] = ["Jax", "Nova", "Sterling", "Gemma", "Vince"];
const CREW_COLOR: Record<Character, string> = { Jax: "#e4572e", Nova: "#a78bfa", Sterling: "#ef4444", Gemma: "#22c55e", Vince: "#22d3ee" };
const pct = (p: number | null | undefined) => (p == null ? "—" : `${Math.round(p * 100)}%`);
const signed = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

function drawLedger(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  clear(ctx, w, h);
  const L = f.screens.ledger;
  header(ctx, w, "THE LEDGER", L ? (L.held ? "held" : "card") : "idle", "#a78bfa");
  if (!L) {
    ctx.fillStyle = C.muted;
    ctx.font = `500 22px ${FONT}`;
    ctx.fillText("No priced plan — nothing to price.", 18, 110);
    ctx.font = `500 17px ${FONT}`;
    wrap(ctx, "Every option is priced on three measured paths: T1 before the flat, a loss, or nothing by 11:00.", 18, 150, w - 36, 22, 3);
    return;
  }
  ctx.fillStyle = C.text;
  ctx.font = `700 20px ${MONO}`;
  ctx.fillText(L.contract, 16, 66);
  ctx.font = `500 15px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(`model ${pct(L.pT1Model)} to T1 in 8h · ${L.measured ? `${pct(L.share)} of T1s land inside ${L.windowBars} bars` : "time curve not measured"}`, 16, 90);
  // The tree: root → three branches.
  const rootX = 46;
  const rootY = 190;
  const bx = 210;
  const rows = L.paths;
  const colOf = (k: string) => (k === "t1" ? C.up : k === "loss" ? C.down : C.amber);
  const labelOf = (k: string) => (k === "t1" ? "T1" : k === "loss" ? "LOSS" : "FLAT");
  ctx.fillStyle = C.text;
  ctx.beginPath();
  ctx.arc(rootX, rootY, 9, 0, Math.PI * 2);
  ctx.fill();
  rows.forEach((r, i) => {
    const y = 128 + i * 62;
    ctx.strokeStyle = colOf(r.kind);
    ctx.lineWidth = 2 + 10 * r.p;
    ctx.beginPath();
    ctx.moveTo(rootX, rootY);
    ctx.bezierCurveTo(rootX + 70, rootY, bx - 70, y, bx, y);
    ctx.stroke();
    ctx.fillStyle = colOf(r.kind);
    ctx.font = `800 22px ${MONO}`;
    ctx.fillText(`${labelOf(r.kind)} ${pct(r.p)}`, bx + 10, y - 4);
    ctx.font = `600 17px ${MONO}`;
    ctx.fillStyle = C.text;
    ctx.fillText(`${signed(r.pnlUsd)} · ~${r.clock}`, bx + 10, y + 18);
  });
  ctx.fillStyle = L.evUsd > 0 ? C.up : C.down;
  ctx.font = `900 40px ${MONO}`;
  ctx.textAlign = "right";
  ctx.fillText(`EV ${signed(L.evUsd)}`, w - 16, h - 78);
  ctx.font = `700 17px ${MONO}`;
  if (L.evCalUsd != null && L.pCal != null) {
    ctx.fillStyle = L.evCalUsd > 0 ? C.up : C.down;
    ctx.fillText(`realized-decile ${pct(L.pCal)} → ${signed(L.evCalUsd)}`, w - 16, h - 48);
  }
  ctx.font = `600 16px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(L.held ? (L.edgeUsd != null ? `hold vs sell now ${signed(L.edgeUsd)} a contract` : "") : L.t1Pays ? "T1 pays ✓  · per contract, after both crossings" : "T1 does NOT pay ✗", w - 16, h - 22);
  ctx.textAlign = "left";
}

function drawGhosts(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  clear(ctx, w, h);
  const lab = f.screens.lab;
  header(ctx, w, "GHOST ROOM", lab ? `${lab.ghostsOpen} open` : "—", "#94a3b8");
  ctx.font = `500 16px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText("Never fills. The same rules on the same marks — what each 'no' was worth.", 16, 66);
  if (!lab) return;
  let yy = 104;
  const t = lab.twins;
  ctx.font = `700 19px ${FONT}`;
  ctx.fillStyle = C.text;
  ctx.fillText("Room exits vs the mandate alone", 16, yy);
  ctx.font = `700 22px ${MONO}`;
  ctx.fillStyle = t.n ? (t.deltaUsd >= 0 ? C.up : C.down) : C.muted;
  ctx.fillText(t.n ? `${signed(t.deltaUsd)} over ${t.n} fill${t.n === 1 ? "" : "s"}` : "no paired fills yet", 16, yy + 30);
  yy += 74;
  ctx.font = `700 19px ${FONT}`;
  ctx.fillStyle = C.text;
  ctx.fillText("Refused at the CE — what they'd have made", 16, yy);
  yy += 30;
  ctx.font = `600 18px ${MONO}`;
  if (!lab.refusals.length) {
    ctx.fillStyle = C.muted;
    ctx.fillText("no refused ticket has closed yet", 16, yy);
  }
  for (const r of lab.refusals.slice(0, 4)) {
    ctx.fillStyle = r.pnlUsd >= 0 ? C.down : C.up;
    ctx.fillText(`${r.gate.padEnd(10)} ${String(r.n).padStart(3)}×  ${signed(r.pnlUsd).padStart(7)}  ${r.wins}W`, 16, yy);
    yy += 28;
  }
  const cues = cuesOfFrame(f);
  ctx.font = `700 16px ${FONT}`;
  ctx.fillStyle = C.up;
  ctx.fillText(`saved ${signed(cues.savedUsd)}`, 16, h - 36);
  ctx.fillStyle = C.down;
  ctx.fillText(`cost ${signed(cues.costUsd)}`, 220, h - 36);
  ctx.fillStyle = C.muted;
  ctx.font = `500 13px ${FONT}`;
  ctx.fillText("Green is a no that saved. Red is a no that cost. Neither changes a gate.", 16, h - 14);
}

function drawCalibration(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  clear(ctx, w, h);
  const lab = f.screens.lab;
  const cal = lab?.calibration;
  header(ctx, w, "CALIBRATION", cal ? `n ${cal.n}${cal.brier != null ? ` · Brier ${cal.brier.toFixed(3)}` : ""}` : "—", "#38bdf8");
  ctx.font = `500 15px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText("Said vs happened: P(T1 before 11:00) on every plan whose CE filled.", 16, 64);
  if (!cal || !cal.n) {
    ctx.font = `500 20px ${FONT}`;
    ctx.fillText("No scored plans yet.", 16, 120);
    return;
  }
  const left = 40;
  const bottom = h - 40;
  const top = 92;
  const bw = (w * 0.55 - left) / cal.bins.length;
  cal.bins.forEach((b, i) => {
    const x = left + i * bw + 8;
    const ph = (b.meanP ?? 0) * (bottom - top);
    const hh = (b.hit ?? 0) * (bottom - top);
    ctx.fillStyle = "rgba(167,139,250,0.55)";
    ctx.fillRect(x, bottom - ph, bw * 0.38, ph);
    ctx.fillStyle = b.n ? C.up : C.grid;
    ctx.fillRect(x + bw * 0.42, bottom - hh, bw * 0.38, hh);
    ctx.fillStyle = C.muted;
    ctx.font = `500 13px ${MONO}`;
    ctx.fillText(`${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}`, x, bottom + 16);
    ctx.fillText(`n${b.n}`, x, bottom + 30);
  });
  // Per person.
  let yy = 104;
  const x0 = w * 0.6;
  ctx.font = `700 17px ${FONT}`;
  ctx.fillStyle = C.text;
  ctx.fillText("Brier by person (lower is better)", x0, yy);
  yy += 28;
  for (const c of CREW_ORDER) {
    const t = lab!.track[c];
    ctx.fillStyle = CREW_COLOR[c];
    ctx.font = `700 17px ${MONO}`;
    ctx.fillText(`${c.padEnd(8)} ${t?.brier != null ? t.brier.toFixed(3) : "  —  "}  n${t?.n ?? 0}`, x0, yy);
    yy += 26;
  }
  const gap = cuesOfFrame(f).calGap;
  ctx.font = `600 15px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(gap == null ? "Dial idle — no card with both rates." : `This card: model ${gap >= 0 ? "above" : "below"} realized by ${Math.abs(Math.round(gap * 100))} pts. Not a gate.`, 16, h - 16);
}

function drawVote(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  clear(ctx, w, h);
  const L = f.screens.lenses;
  header(ctx, w, "THE VOTE", L ? `room ${pct(f.screens.roomP)}` : "no card", "#f59e0b");
  ctx.font = `500 15px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText("Each person's own P(T1 before 11:00) — scored later by the lab.", 16, 64);
  if (!L) return;
  let yy = 96;
  for (const c of CREW_ORDER) {
    const p = L[c].p;
    ctx.fillStyle = C.grid;
    ctx.fillRect(130, yy - 16, w - 200, 22);
    ctx.fillStyle = CREW_COLOR[c];
    ctx.fillRect(130, yy - 16, (w - 200) * p, 22);
    ctx.font = `700 18px ${FONT}`;
    ctx.fillText(c, 16, yy);
    ctx.fillStyle = C.text;
    ctx.font = `700 18px ${MONO}`;
    ctx.fillText(pct(p), w - 62, yy);
    ctx.font = `500 12px ${FONT}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(fit(ctx, L[c].basis, Math.max(40, w - 146)), 130, yy + 22);
    yy += 50;
  }
  if (f.screens.roomP != null) {
    const x = 130 + (w - 200) * f.screens.roomP;
    ctx.strokeStyle = "#fde68a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, 80);
    ctx.lineTo(x, yy - 26);
    ctx.stroke();
  }
}

function drawLeague(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  clear(ctx, w, h);
  const minds = f.minds;
  const lab = f.screens.lab;
  header(ctx, w, "LEAGUE TABLE", f.screens.synthetic ? "drill" : "the room", "#fde68a");
  const rows = CREW_ORDER.map((c) => ({
    c,
    rank: minds?.rank[c] ?? 50,
    rec: minds?.record[c],
    brier: lab?.track[c]?.brier ?? null,
    n: lab?.track[c]?.n ?? 0,
  })).sort((a, b) => b.rank - a.rank);
  ctx.font = `600 15px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText("#", 16, 68);
  const nameX = 52;
  const rankX = Math.round(w * 0.34);
  const callsX = Math.round(w * 0.58);
  const brierX = Math.round(w * 0.78);
  ctx.fillText("name", nameX, 68);
  ctx.fillText("cred", rankX, 68);
  ctx.fillText("R/W/F", callsX, 68);
  ctx.fillText("Brier", brierX, 68);
  let yy = 104;
  rows.forEach((r, i) => {
    ctx.fillStyle = i === 0 ? "#fde68a" : C.text;
    ctx.font = `800 24px ${MONO}`;
    ctx.fillText(`${i + 1}`, 16, yy);
    ctx.fillStyle = CREW_COLOR[r.c];
    ctx.font = `800 24px ${FONT}`;
    ctx.fillText(fit(ctx, r.c, rankX - nameX - 12), nameX, yy);
    ctx.fillStyle = C.text;
    ctx.font = `700 22px ${MONO}`;
    ctx.fillText(String(r.rank).padStart(3), rankX, yy);
    ctx.fillStyle = C.muted;
    ctx.fillRect(rankX + 52, yy - 12, Math.max(24, callsX - rankX - 70), 8);
    ctx.fillStyle = CREW_COLOR[r.c];
    ctx.fillRect(rankX + 52, yy - 12, Math.min(r.rank, Math.max(24, callsX - rankX - 70)), 8);
    ctx.fillStyle = C.text;
    ctx.font = `600 18px ${MONO}`;
    ctx.fillText(r.rec ? `${r.rec.right}/${r.rec.wrong}/${r.rec.flat}` : "—", callsX, yy);
    ctx.fillText(fit(ctx, r.brier != null ? `${r.brier.toFixed(3)} n${r.n}` : `— n${r.n}`, w - brierX - 12), brierX, yy);
    yy += 58;
  });
}

/** The ET minute the screen clock reads (the drill's own clock in a drill). */
function etMinOfClock(ms: number, f: FloorFrame): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(ms));
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? NaN) % 24;
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? NaN);
  return Number.isFinite(hh) && Number.isFinite(mm) ? hh * 60 + mm : f.etMin;
}

/* ── The annex: the scanner by the board, the R&D lab, ops & data, the goal room ──────────────── */

const BAND_COLOR: Record<string, string> = { "A+": "#22c55e", A: "#4ade80", "A−": "#86efac", "B+": "#facc15", B: "#f59e0b", C: "#94a3b8" };
const SEV_COLOR = { high: C.down, med: C.amber, low: C.muted } as const;
const STATUS_COLOR = { collecting: C.muted, supported: C.up, not_supported: C.down, undecided: C.amber } as const;

/** Clip a string to a pixel width with an ellipsis (the font must already be set). */
function fit(ctx: Ctx, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** A probability that may be tiny: never prints "0%" for something that is merely very small. */
function pctSmall(p: number): string {
  if (p <= 0) return "0%";
  if (p < 1e-5) return "<0.001%";
  if (p < 0.001) return `${(p * 100).toFixed(4)}%`;
  if (p < 0.1) return `${(p * 100).toFixed(2)}%`;
  return `${Math.round(p * 100)}%`;
}

function kvLine(ctx: Ctx, w: number, y: number, k: string, v: string, color: string = C.text, size = 17) {
  ctx.font = `500 ${size}px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.textAlign = "left";
  ctx.fillText(k, 14, y);
  ctx.font = `700 ${size}px ${MONO}`;
  ctx.fillStyle = color;
  ctx.textAlign = "right";
  ctx.fillText(v, w - 14, y);
  ctx.textAlign = "left";
}

const px = (n: number | null) => (n == null ? "—" : n >= 1000 ? fmt(n, 1) : fmt(n, 2));

/** The setup scanner, by the board: every graded setup the desk is looking at, in board order, with its plan and where price is. */
function drawScanner(ctx: Ctx, w: number, h: number, f: FloorFrame, clockMs = 0) {
  const cues = cuesOfFrame(f);
  clear(ctx, w, h);
  const cards = f.screens.race?.scanner ?? [];
  const armed = cards.filter((c) => c.verdict === "ARMED").length;
  const watch = cards.filter((c) => c.verdict === "WATCH").length;
  const accent = cues.tint === "amber" ? C.amber : cues.tint === "hatch" ? C.muted : armed ? C.up : watch ? C.amber : C.cyan;
  header(ctx, w, "SETUP SCANNER", `${armed} armed · ${watch} watch · ${cards.length - armed - watch} stand`, accent);
  if (cues.tint === "hatch") {
    ctx.strokeStyle = "rgba(148,163,184,0.35)";
    ctx.lineWidth = 2;
    for (let x = -h; x < w; x += 18) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + h, h);
      ctx.stroke();
    }
  }
  if (!cards.length) {
    ctx.fillStyle = C.muted;
    ctx.font = `500 22px ${FONT}`;
    wrap(ctx, "No graded setup is printing. The scanner waits for a sweep, a displacement and a retrace — the desk does not invent one.", 24, 110, w - 48, 30, 4);
    ctx.font = `500 16px ${MONO}`;
    ctx.fillText(f.screens.source, 24, h - 22);
    return;
  }
  ctx.font = `600 13px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.textAlign = "right";
  const pCol = w - 148;
  const eCol = w - 18;
  const priced = cards.some((c) => c.ask != null);
  ctx.fillText(priced ? "ASK" : "P(T1)", pCol, 62);
  ctx.fillText("E[R]", eCol, 62);
  ctx.textAlign = "left";
  ctx.fillText("BAND   SETUP", 24, 62);
  cards.slice(0, 6).forEach((c, i) => {
    const y = 70 + i * 70;
    const rowArmed = c.verdict === "ARMED";
    ctx.fillStyle = cues.tint === "amber" ? "#1a140c" : i % 2 ? "#0a1020" : "#0c1426";
    ctx.fillRect(8, y, w - 16, 64);
    if (rowArmed) {
      const pulse = 0.45 + 0.55 * Math.abs(Math.sin(clockMs / 280));
      ctx.strokeStyle = `rgba(34,197,94,${pulse})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(10, y + 2, w - 20, 60);
    }
    const vcol = c.verdict === "ARMED" ? C.up : c.verdict === "WATCH" ? C.amber : C.down;
    ctx.fillStyle = vcol;
    ctx.fillRect(8, y, 5, 64);
    // A graded band wears its colour; a refused card (band "skip") wears the verdict, small and grey.
    const graded = c.band != null && c.band in BAND_COLOR;
    ctx.fillStyle = graded ? BAND_COLOR[c.band!]! : "#1e293b";
    ctx.fillRect(22, y + 10, 56, 44);
    ctx.fillStyle = graded ? "#04130a" : C.muted;
    ctx.font = graded ? `800 24px ${FONT}` : `700 14px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(graded ? c.band! : c.verdict, 50, y + 33);
    ctx.textAlign = "left";
    ctx.fillStyle = C.text;
    ctx.font = `700 20px ${FONT}`;
    ctx.fillText(fit(ctx, `${c.symbol} ${c.side.toUpperCase()}${c.strategy ? ` · ${c.strategy}` : ""}`, Math.max(80, pCol - 110)), 92, y + 24);
    ctx.font = `500 15px ${MONO}`;
    const state = c.sequence || (c.entryState === "live" ? "ENTER" : c.entryState === "gone" ? "ENTRY GONE" : "ANTICIPATION");
    const sub = c.entryLine || c.block || `${state}${(c.tier ?? "")}`;
    const planLine = c.entry != null && c.stop != null ? `E ${px(c.entry)} · S ${px(c.stop)} · T1 ${px(c.t1)}` : "";
    const planMax = planLine ? Math.min(260, w * 0.32) : 0;
    const subMax = Math.max(80, w - 28 - 92 - planMax);
    ctx.fillStyle = c.sequence?.startsWith("ENTER") ? C.up : c.sequence?.startsWith("STAND") || c.sequence?.startsWith("DRAW") ? C.down : c.entryState === "gone" ? C.down : C.amber;
    ctx.fillText(fit(ctx, sub, subMax), 92, y + 48);
    if (planLine) {
      ctx.fillStyle = C.muted;
      ctx.textAlign = "right";
      ctx.fillText(fit(ctx, planLine, planMax), w - 16, y + 48);
      ctx.textAlign = "left";
    }
    ctx.textAlign = "right";
    ctx.font = `800 22px ${MONO}`;
    ctx.fillStyle = c.pT1 != null ? (c.pT1 >= 0.4 ? C.up : c.pT1 >= 0.25 ? C.amber : C.muted) : C.muted;
    ctx.fillText(c.ask != null ? `$${c.ask.toFixed(2)}` : c.pT1 != null ? `${Math.round(c.pT1 * 100)}%` : "—", pCol, y + 28);
    ctx.fillStyle = c.expR != null ? (c.expR > 0 ? C.up : C.down) : C.muted;
    ctx.fillText(c.expR != null ? `${c.expR > 0 ? "+" : ""}${c.expR.toFixed(2)}` : "—", eCol, y + 28);
    ctx.textAlign = "left";
  });
}

/** The desk audit: what the five find wrong with the desk, ranked, each with its evidence line. */
function drawAudit(ctx: Ctx, w: number, h: number, items: AuditItem[], title: string, max: number) {
  clear(ctx, w, h);
  header(ctx, w, title, `${items.length} open`, items.some((i) => i.severity === "high") ? C.down : items.length ? C.amber : C.up);
  if (!items.length) {
    ctx.fillStyle = C.muted;
    ctx.font = `500 ${w > 600 ? 21 : 16}px ${FONT}`;
    wrap(ctx, "Nothing the five can prove is wrong with the desk right now.", 18, 80, w - 36, w > 600 ? 28 : 22, 3);
    return;
  }
  const big = w > 600;
  const t1 = big ? 21 : 16;
  const t2 = big ? 16 : 13;
  const per = big ? 88 : 64;
  items.slice(0, max).forEach((it, i) => {
    const y = 56 + i * per;
    ctx.fillStyle = SEV_COLOR[it.severity];
    ctx.fillRect(10, y + 2, 5, per - 12);
    ctx.font = `800 ${t1}px ${FONT}`;
    ctx.fillStyle = CREW_COLOR[it.owner];
    const who = it.owner.toUpperCase();
    ctx.fillText(who, 24, y + t1);
    const ow = ctx.measureText(who).width;
    ctx.fillStyle = C.text;
    ctx.font = `700 ${t1}px ${FONT}`;
    ctx.fillText(fit(ctx, it.title, w - 56 - ow), 24 + ow + 10, y + t1);
    ctx.fillStyle = C.muted;
    ctx.font = `500 ${t2}px ${FONT}`;
    wrap(ctx, it.evidence, 24, y + t1 + t2 + 6, w - 40, t2 + 3, 2);
  });
}

/** The R&D board: the six pre-registered experiments and how far each is from its bar. */
function drawRndBoard(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  clear(ctx, w, h);
  const ex = f.screens.race?.rnd?.experiments ?? [];
  const decided = ex.filter((e) => e.status !== "collecting").length;
  header(ctx, w, "R&D BOARD", ex.length ? `${decided}/${ex.length} decided` : "no board", "#34d399");
  if (!ex.length) {
    ctx.fillStyle = C.muted;
    ctx.font = `500 21px ${FONT}`;
    ctx.fillText("The experiments register with the first session.", 18, 90);
    return;
  }
  const focus = cuesOfFrame(f).experiment?.title ?? null;
  ex.slice(0, 6).forEach((e, i) => {
    const y = 54 + i * 62;
    const onBench = focus != null && e.title === focus;
    ctx.fillStyle = onBench ? "#10281c" : i % 2 ? "#0a1020" : "#0c1426";
    ctx.fillRect(8, y, w - 16, 58);
    if (onBench) {
      ctx.strokeStyle = "#fde68a";
      ctx.lineWidth = 2;
      ctx.strokeRect(8, y, w - 16, 58);
    }
    ctx.fillStyle = STATUS_COLOR[e.status];
    ctx.beginPath();
    ctx.arc(26, y + 29, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `800 15px ${FONT}`;
    ctx.fillStyle = CREW_COLOR[e.owner];
    ctx.fillText(e.owner.toUpperCase(), 44, y + 22);
    ctx.fillStyle = C.text;
    ctx.font = `700 19px ${FONT}`;
    ctx.fillText(fit(ctx, e.title, w - 270), 120, y + 22);
    ctx.font = `500 14px ${FONT}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(fit(ctx, e.read, w - 270), 44, y + 46);
    const bw = 150;
    ctx.fillStyle = "#1c2638";
    ctx.fillRect(w - bw - 22, y + 14, bw, 8);
    ctx.fillStyle = STATUS_COLOR[e.status];
    ctx.fillRect(w - bw - 22, y + 14, bw * Math.min(1, e.n / Math.max(1, e.nNeeded)), 8);
    ctx.font = `600 13px ${MONO}`;
    ctx.fillStyle = C.muted;
    ctx.textAlign = "right";
    ctx.fillText(`${e.n}/${e.nNeeded} · ${e.status.replace("_", " ")}`, w - 22, y + 46);
    ctx.textAlign = "left";
  });
}

/** What the five want the trader to look at: every proposal an experiment has earned, in their words. */
function drawProposals(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  const ex = (f.screens.race?.rnd?.experiments ?? []).filter((e) => e.proposal);
  clear(ctx, w, h);
  header(ctx, w, "FOR THE TRADER", ex.length ? `${ex.length} proposal${ex.length === 1 ? "" : "s"}` : "none yet", ex.length ? C.amber : C.muted);
  if (!ex.length) {
    ctx.fillStyle = C.muted;
    ctx.font = `500 17px ${FONT}`;
    wrap(ctx, "No experiment has cleared its bar. Until one does, nothing here is worth your time — and nothing changes a rule.", 14, 74, w - 28, 24, 6);
    return;
  }
  let y = 66;
  for (const e of ex.slice(0, 3)) {
    ctx.fillStyle = CREW_COLOR[e.owner];
    ctx.font = `800 15px ${FONT}`;
    ctx.fillText(e.owner.toUpperCase(), 14, y);
    ctx.fillStyle = C.text;
    ctx.font = `500 15px ${FONT}`;
    y = wrap(ctx, e.proposal ?? "", 14, y + 20, w - 28, 19, 3) + 6;
    if (y > h - 24) break;
  }
}

function drawRefusals(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  const rows = f.screens.lab?.refusals ?? [];
  clear(ctx, w, h);
  header(ctx, w, "GHOST ROOM · REFUSALS", rows.length ? `${rows.reduce((a, r) => a + r.n, 0)} priced` : "none", "#a78bfa");
  if (!rows.length) {
    ctx.fillStyle = C.muted;
    ctx.font = `500 17px ${FONT}`;
    wrap(ctx, "No refused ticket has closed yet. Each gate's \"no\" is priced when one does.", 14, 74, w - 28, 24, 4);
    return;
  }
  rows.slice(0, 5).forEach((r, i) => {
    const y = 78 + i * 38;
    kvLine(ctx, w, y, `${r.gate} · ${r.n} · ${r.wins} would have won`, `${r.pnlUsd >= 0 ? "+" : "−"}$${Math.abs(Math.round(r.pnlUsd))}`, r.pnlUsd > 0 ? C.amber : C.up, 16);
  });
  ctx.fillStyle = C.muted;
  ctx.font = `500 12px ${FONT}`;
  ctx.fillText("A gate that cost money is a question for the four-year test, not a rule change.", 14, h - 12);
}

/** Ops & data: is the feed real, how late is it, what is switched on. */
function drawFeed(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  const r = f.screens.race;
  const feed = r?.feed ?? null;
  clear(ctx, w, h);
  // Same honesty as the header feed dot: source first, then lag. Databento
  // green only at ≤15s (not the old <90s Floor threshold). SYN/Y! never green.
  // Unknown lag (null) stays null — feedTone paints red, never coerce to 0.
  const sources = feed && feed.kind !== "none" ? [feed.kind] : [];
  const tone = feedTone(sources, feed?.lagSec ?? null);
  const accent = tone.tone === "live" ? C.up : tone.tone === "delayed" ? C.amber : C.down;
  const kindWord = !feed || feed.kind === "none"
    ? "NO FEED"
    : feed.kind === "live_gateway"
      ? "LIVE GATEWAY"
      : feed.kind === "databento"
        ? "DATABENTO"
        : feed.kind === "yahoo"
          ? "YAHOO (delayed)"
          : feed.kind === "synthetic"
            ? "SYNTHETIC"
            : "NO FEED";
  header(ctx, w, "OPS · THE FEED", kindWord, accent);
  const lag = feed?.lagSec;
  const printWords =
    lag == null ? "—" : lag < 90 ? `${Math.round(lag)} s old` : `${Math.round(lag / 60)} min old`;
  kvLine(ctx, w, 80, "Newest print", printWords, accent);
  const cues = cuesOfFrame(f);
  const cx = w - 78;
  const cy = 168;
  ctx.beginPath();
  ctx.strokeStyle = cues.lagHot || cues.quoteHot ? C.down : C.muted;
  ctx.lineWidth = 3;
  ctx.arc(cx, cy, 36, 0, Math.PI * 2);
  ctx.stroke();
  const age = cues.quoteAgeSec ?? cues.lagSec;
  const ang = age == null ? -Math.PI / 2 : -Math.PI / 2 + Math.min(1, age / 60) * Math.PI * 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(ang) * 26, cy + Math.sin(ang) * 26);
  ctx.stroke();
  ctx.font = `600 11px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.textAlign = "center";
  ctx.fillText(cues.quoteAgeSec != null ? "QUOTE" : "TAPE", cx, cy + 52);
  ctx.textAlign = "left";
  ctx.fillStyle = C.muted;
  ctx.font = `500 12px ${FONT}`;
  ctx.fillText(cues.quoteAgeSec == null ? "No broker quote age. The hand is the futures print. Red past 30s." : cues.quoteHot ? "Quote older than 15s — not a price." : "Quote inside 15s.", 14, h - 28);
  kvLine(ctx, w, 108, "Source", f.screens.source.slice(0, 30), C.text, 15);
  kvLine(ctx, w, 136, "VIX · 10Y", `${f.screens.vix != null && f.screens.vix > 0 ? f.screens.vix.toFixed(2) : "—"} · ${f.screens.tenYear != null ? `${f.screens.tenYear.toFixed(2)}%` : "—"}`);
  let y = 172;
  for (const x of (r?.execFlags ?? []).slice(0, 3)) {
    kvLine(ctx, w, y, x.name.replace(/_/g, " ").toLowerCase().slice(0, 34), x.on ? "ON" : "OFF", x.on ? C.up : C.muted, 14);
    y += 26;
  }
  ctx.fillStyle = C.muted;
  ctx.font = `500 12px ${FONT}`;
  ctx.fillText("Live trading stays shut until a human flips these.", 14, h - 12);
}

/** The goal's progress bar and pace. */
function drawGoalProgress(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  const g = f.screens.race?.goal ?? null;
  clear(ctx, w, h);
  if (!g) {
    header(ctx, w, "GOAL", "not set", C.muted);
    return;
  }
  const state = g.status === "before" ? `starts ${g.startDate}` : g.status === "running" ? `day ${g.day}/${g.of}` : g.status;
  header(ctx, w, `GOAL ${money(g.start)} → ${money(g.target)}`, state, g.status === "hit" ? C.up : g.status === "floor" || g.status === "expired" ? C.down : "#f472b6");
  ctx.fillStyle = C.text;
  ctx.font = `800 44px ${MONO}`;
  ctx.fillText(money(g.equity), 14, 98);
  ctx.font = `500 14px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(`${g.leader ?? "no one yet"} leads`, 14, 120);
  const x0 = 14;
  const x1 = w - 14;
  const frac = Math.max(0, Math.min(1, (g.equity - g.start) / Math.max(1, g.target - g.start)));
  ctx.fillStyle = "#1c2638";
  ctx.fillRect(x0, 138, x1 - x0, 16);
  ctx.fillStyle = g.equity >= g.start ? C.up : C.down;
  ctx.fillRect(x0, 138, (x1 - x0) * frac, 16);
  const floorX = x0 + (x1 - x0) * Math.max(0, Math.min(1, (g.floor - g.start) / Math.max(1, g.target - g.start)));
  ctx.fillStyle = C.amber;
  ctx.fillRect(floorX, 132, 2, 28);
  ctx.font = `500 12px ${MONO}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(`floor ${money(g.floor)}`, Math.min(floorX, x1 - 90), 172);
  kvLine(ctx, w, 200, "Multiple still needed", `${g.multipleNeeded.toFixed(2)}×`, C.text, 15);
  kvLine(ctx, w, 224, "Per session from here", g.perSessionNeeded != null ? money(g.perSessionNeeded) : "—", C.text, 15);
  kvLine(ctx, w, 248, "Pace vs today's mark", g.paceLabel ? `${g.paceLabel}${g.paceUsd != null ? ` (${g.paceUsd >= 0 ? "+" : "−"}$${Math.abs(Math.round(g.paceUsd))})` : ""}` : "—", g.paceLabel === "ahead" ? C.up : g.paceLabel === "behind" ? C.down : C.text, 15);
  kvLine(ctx, w, 272, "Entries today", g.entriesOver ? "closed" : "open", g.entriesOver ? C.down : C.up, 15);
}

/** The exact odds and what it would take. */
function drawGoalOdds(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  const g = f.screens.race?.goal ?? null;
  clear(ctx, w, h);
  header(ctx, w, "THE ODDS (exact)", g ? `n ${g.measured.n ?? "—"}` : "", "#f472b6");
  if (!g) return;
  kvLine(ctx, w, 80, `Reach ${money(g.target)}`, pctSmall(g.pTarget), g.pTarget >= 0.05 ? C.up : C.down, 20);
  ctx.fillStyle = C.muted;
  ctx.font = `500 12px ${FONT}`;
  ctx.fillText(`best approach: ${g.pTargetBy}`, 14, 98);
  kvLine(ctx, w, 126, "Touch the floor", pctSmall(g.pFloor), C.text, 16);
  kvLine(ctx, w, 150, "No card prints at all", pctSmall(g.pNoCard), C.text, 16);
  kvLine(ctx, w, 174, "Cards per session", g.lambda.toFixed(2), C.text, 16);
  kvLine(ctx, w, 198, "Expected end", money(g.expectedEnd), g.expectedEnd >= g.start ? C.up : C.down, 16);
  if (g.winsNeed != null) kvLine(ctx, w, 222, "Straight wins needed · allowed", `${g.winsNeed} · ${g.tradeBudget}`, g.winsNeed > g.tradeBudget ? C.down : C.text, 15);
  ctx.fillStyle = C.amber;
  ctx.font = `600 13px ${FONT}`;
  wrap(
    ctx,
    g.needed.pWin != null ? `Needs ${(g.needed.pWin * 100).toFixed(0)}% winners${g.needed.lambdaMultiple != null ? ` or ${g.needed.lambdaMultiple.toFixed(1)}× the cards` : ""}. The gates do not move.` : "No win rate within reach gets there on this many cards. The gates do not move.",
    14,
    g.winsNeed != null ? 248 : 232,
    w - 28,
    18,
    3,
  );
}

/** The contract ladder on today's card — what $20 to $300 buys. */
function drawGoalLadder(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  const g = f.screens.race?.goal ?? null;
  clear(ctx, w, h);
  header(ctx, w, "CONTRACT LADDER", g ? `${g.ladder.n} strikes${g.ladder.priced ? " · priced" : ""}` : "", "#f472b6");
  if (!g) return;
  kvLine(ctx, w, 78, "Cheapest · richest", `${g.ladder.cheapestUsd != null ? money(g.ladder.cheapestUsd) : "—"} · ${g.ladder.richestUsd != null ? money(g.ladder.richestUsd) : "—"}`, C.text, 16);
  const b = g.ladder.best;
  if (b) {
    kvLine(ctx, w, 106, "Best odds on this card", `${b.name} ${money(b.askUsd)}`, C.up, 15);
    kvLine(ctx, w, 130, "…× contracts · Δ", `${b.contracts} · ${b.delta.toFixed(2)}`, C.text, 15);
    kvLine(ctx, w, 154, "…odds of the goal", b.pTarget != null ? pctSmall(b.pTarget) : "—", C.text, 15);
  } else {
    ctx.fillStyle = C.muted;
    ctx.font = `500 14px ${FONT}`;
    wrap(ctx, "No live card: the ladder is a price list until one prints.", 14, 108, w - 28, 20, 2);
  }
  if (g.ladder.room) kvLine(ctx, w, 186, "The room's own strike", `${g.ladder.room.name} ${money(g.ladder.room.askUsd)} ×${g.ladder.room.contracts}`, C.muted, 14);
  kvLine(ctx, w, 214, "A stopped ticket costs", g.stopShare != null ? `${(g.stopShare * 100).toFixed(1)}% of the account` : "—", C.text, 14);
  ctx.fillStyle = C.muted;
  ctx.font = `500 12px ${FONT}`;
  ctx.fillText(`floors: Δ ≥ ${g.minDelta.toFixed(2)} · ask ≥ ${money(g.minAskUsd)}`, 14, h - 28);
  if (cuesOfFrame(f).ladderBreak && g.winsNeed != null && g.tradeBudget != null) {
    ctx.fillStyle = C.down;
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText(`Break: ${g.winsNeed} straight winners, ${g.tradeBudget} tickets. The rung does not exist.`, 14, h - 10);
  }
}

/** The five seats and The Room, racing: equity, P&L, what they took and what they turned down. */
function drawSeatLeague(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  const s = f.screens.race?.seats ?? null;
  clear(ctx, w, h);
  header(ctx, w, "THE RACE (paper seats)", s ? `${s.sessions} session${s.sessions === 1 ? "" : "s"} · ${s.touches} touch${s.touches === 1 ? "" : "es"}` : "no seats", "#f472b6");
  if (!s) return;
  ctx.font = `600 13px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText("#  seat", 14, 62);
  ctx.textAlign = "right";
  ctx.fillText("equity", 380, 62);
  ctx.fillText("P&L", 480, 62);
  ctx.fillText("took", 580, 62);
  ctx.fillText("declined", 690, 62);
  ctx.textAlign = "left";
  const seated = new Set(cuesOfFrame(f).seated);
  s.rows.slice(0, 6).forEach((r, i) => {
    const y = 70 + i * 52;
    const sitting = seated.has(r.name) || r.status !== "running";
    ctx.fillStyle = sitting ? "#14110c" : i % 2 ? "#0a1020" : "#0c1426";
    ctx.fillRect(8, y, w - 16, 48);
    const col = r.owner ? CREW_COLOR[r.owner] : C.cyan;
    ctx.fillStyle = r.id === s.leader ? "#fde68a" : C.text;
    ctx.font = `800 22px ${MONO}`;
    ctx.fillText(String(i + 1), 16, y + 31);
    ctx.fillStyle = col;
    ctx.font = `800 22px ${FONT}`;
    ctx.fillText(fit(ctx, r.name, 190), 46, y + 31);
    ctx.textAlign = "right";
    ctx.fillStyle = C.text;
    ctx.font = `700 21px ${MONO}`;
    ctx.fillText(money(r.equity), 380, y + 31);
    ctx.fillStyle = r.pnl >= 0 ? C.up : C.down;
    ctx.fillText(`${r.pnl >= 0 ? "+" : "−"}$${Math.abs(Math.round(r.pnl))}`, 480, y + 31);
    ctx.fillStyle = C.muted;
    ctx.font = `600 18px ${MONO}`;
    ctx.fillText(`${r.taken.n} (${r.taken.wins}W)`, 580, y + 31);
    ctx.fillText(`${r.declined.n}`, 690, y + 31);
    ctx.textAlign = "left";
    if (r.status !== "running" || sitting) {
      ctx.fillStyle = r.status === "hit" ? C.up : C.down;
      ctx.font = `800 13px ${FONT}`;
      ctx.fillText(r.status === "hit" ? "GOAL" : sitting ? "SIT" : "FLOOR", w - 68, y + 29);
    } else if (r.id === s.leader || r.name === s.leader) {
      ctx.fillStyle = "#fde68a";
      ctx.font = `800 13px ${FONT}`;
      ctx.fillText("BOARD", w - 78, y + 29);
    }
  });
  ctx.fillStyle = C.muted;
  ctx.font = `500 13px ${FONT}`;
  ctx.fillText(`syndicates ${s.syndicates.n} · closed ${s.syndicates.closed} · ${s.syndicates.usd >= 0 ? "+" : "−"}$${Math.abs(Math.round(s.syndicates.usd))} · every seat trades the room's checklist on paper`, 14, h - 10);
}

/* ── The investment wing ───────────────────────────────────────────────────
 * The long game's TVs and monitors. Every number is read from `frame.screens.invest` (invest-office.ts: the Invest tab's own
 * functions and the dated research file) and drawn as it came — nothing is computed here. The book is valued at COST (the
 * Floor does not fetch prices) and the screens say so. No verdict, no size, no order: research and arithmetic only.
 */

const INV_ACCENT = "#2dd4bf";
const INV_TIER_COLOR: Record<string, string> = { safe: "#34d399", mid: "#fbbf24", high: "#fb7185" };
const INV_SLEEVE_COLOR: Record<string, string> = { ballast: C.cyan, compounder: C.violet, drypowder: C.amber };
const INV_SLEEVE_NAME: Record<string, string> = { ballast: "Ballast", compounder: "Compounders", drypowder: "Dry powder" };

/** Recorded dollars as they are: cents when they have cents ($240.50 is never drawn as $241), whole dollars otherwise. */
const invUsd = (n: number): string => (Number.isInteger(n) ? money(n) : `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

const isWeekdayAt = (nowMs: number): boolean => {
  const d = etWallParts(nowMs).weekday;
  return d >= 1 && d <= 5;
};

/** Text that fits `maxW` on one line, ellipsised. */
function ell(ctx: Ctx, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** A small filled tag; returns the x where the next one starts. */
function invChip(ctx: Ctx, x: number, y: number, text: string, color: string, size = 13): number {
  ctx.font = `700 ${size}px ${FONT}`;
  const tw = ctx.measureText(text).width + 14;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.18;
  ctx.fillRect(x, y - size, tw, size + 9);
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillRect(x, y - size, 3, size + 9);
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x + 9, y);
  return x + tw + 8;
}

function invDark(ctx: Ctx, w: number, title: string) {
  header(ctx, w, title, "no read", C.muted);
  ctx.fillStyle = C.muted;
  ctx.font = `500 15px ${FONT}`;
  wrap(ctx, "The investment office reads the Invest tab's ledger from this browser. It has nothing to show yet.", 14, 84, w - 28, 22, 4);
}

/** The theme the room is on right now (the same one the talk engine picks for this ET minute). */
function invThemeNow(f: FloorFrame): InvestThemeLite | null {
  const inv = f.screens.invest ?? null;
  return inv ? themeOfTheDay(inv, lookAt(f.etMin, isWeekdayAt(f.nowMs))) : null;
}

/** TV · the long book: total at cost, the three sleeves against their targets, the research tiers the book covers, the next dollar. */
function drawInvPortfolio(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  const inv = f.screens.invest ?? null;
  clear(ctx, w, h);
  if (!inv) return invDark(ctx, w, "THE LONG BOOK");
  const b = inv.book;
  header(ctx, w, "THE LONG BOOK", "valued at cost", INV_ACCENT);
  ctx.textBaseline = "middle";
  ctx.fillStyle = C.text;
  ctx.font = `800 52px ${MONO}`;
  ctx.fillText(invUsd(b.totalUsd), 14, 92);
  ctx.font = `500 15px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(`${b.positions} ${b.positions === 1 ? "position" : "positions"} · marks are fetched in the Invest tab, not here`, 14, 130);
  let y = 168;
  for (const s of b.sleeves) {
    const col = INV_SLEEVE_COLOR[s.sleeve] ?? C.cyan;
    const out = !b.belowMeaningful && Math.abs(s.driftPct) > b.driftBand;
    ctx.font = `600 17px ${FONT}`;
    ctx.fillStyle = C.text;
    ctx.fillText(INV_SLEEVE_NAME[s.sleeve] ?? s.sleeve, 14, y);
    const x0 = 160;
    const x1 = w - 150;
    ctx.fillStyle = "#1c2638";
    ctx.fillRect(x0, y - 9, x1 - x0, 18);
    ctx.fillStyle = out ? C.amber : col;
    ctx.fillRect(x0, y - 9, (x1 - x0) * Math.max(0, Math.min(1, s.weight)), 18);
    ctx.fillStyle = C.text;
    ctx.fillRect(x0 + (x1 - x0) * Math.max(0, Math.min(1, s.target)) - 1, y - 14, 3, 28);
    ctx.font = `700 16px ${MONO}`;
    ctx.textAlign = "right";
    ctx.fillStyle = out ? C.amber : C.text;
    ctx.fillText(`${Math.round(s.weight * 100)}% / ${Math.round(s.target * 100)}%`, w - 14, y);
    ctx.textAlign = "left";
    y += 38;
  }
  ctx.font = `500 13px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(b.belowMeaningful ? `Under ${money(500)} the weights are arithmetic, not allocation — no target binds yet.` : `Tick = target · band ±${Math.round(b.driftBand * 100)}% · ${b.beyondBand} outside`, 14, y - 8);
  y += 22;
  ctx.textBaseline = "alphabetic";
  let x = 14;
  for (const tier of ["safe", "mid", "high"] as const) {
    const ts = inv.themes.filter((t) => t.tier === tier);
    ctx.fillStyle = INV_TIER_COLOR[tier]!;
    x = invChip(ctx, x, y + 6, `${tier.toUpperCase()} ${ts.filter((t) => t.held.length > 0).length}/${ts.length}`, INV_TIER_COLOR[tier]!, 14);
  }
  ctx.fillStyle = C.muted;
  ctx.font = `500 12px ${FONT}`;
  ctx.fillText("research themes the book holds a vehicle of", x + 4, y + 6);
  ctx.fillStyle = C.text;
  ctx.font = `600 15px ${FONT}`;
  wrap(ctx, inv.next ? `Next dollar · ${inv.next.line}` : "Next dollar · nothing swept is waiting.", 14, h - 54, w - 28, 20, 2);
}

/** TV · the funnel: what the day-trading income has swept so far, what waits to be bought, and the arithmetic of the habit. */
function drawInvFunnel(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  const inv = f.screens.invest ?? null;
  clear(ctx, w, h);
  if (!inv) return invDark(ctx, w, "THE FUNNEL");
  const fn = inv.funnel;
  header(ctx, w, "THE FUNNEL", `${fn.ratePct}% · ${fn.closedMonths} ${fn.closedMonths === 1 ? "month" : "months"}`, INV_ACCENT);
  ctx.textBaseline = "middle";
  kvLine(ctx, w, 78, "Swept into the long book", invUsd(fn.sweptUsd), C.up, 19);
  kvLine(ctx, w, 106, "Waiting to be bought", invUsd(fn.waitingUsd), fn.waitingUsd > 0 ? C.amber : C.muted, 19);
  // The same split the Invest tab uses. Local weights, no fetch.
  const split: [string, number][] = [["Safety", 0.42], ["Power", 0.14], ["Grid", 0.12], ["Health", 0.14], ["Fuel", 0.06], ["Halls", 0.05], ["Compute", 0.04], ["Space", 0.03]];
  const light = split.slice().sort((a, b) => a[1] - b[1])[0]!;
  ctx.font = `500 12px ${FONT}`;
  ctx.fillStyle = C.muted;
  wrap(ctx, `Of the waiting dollars: safety ${invUsd(fn.waitingUsd * 0.42)}, power ${invUsd(fn.waitingUsd * 0.14)}, health ${invUsd(fn.waitingUsd * 0.14)}. Lightest sleeve is ${light[0]} at ${Math.round(light[1] * 100)}%. The room does not pick a name.`, 14, 128, w - 28, 15, 2);
  ctx.font = `500 13px ${FONT}`;
  ctx.fillStyle = C.muted;
  wrap(ctx, fn.ladderLine, 14, 166, w - 28, 16, 1);
  if (fn.avgMonthlyUsd != null && fn.fiveYearUsd != null && fn.tenYearUsd != null) {
    const rows: [string, number][] = [
      ["1 year", fn.avgMonthlyUsd * 12],
      ["5 years", fn.fiveYearUsd],
      ["10 years", fn.tenYearUsd],
    ];
    ctx.font = `600 14px ${FONT}`;
    ctx.fillStyle = C.text;
    ctx.fillText(`At the logged average, ${invUsd(fn.avgMonthlyUsd)} a month:`, 14, 188);
    const max = Math.max(1, fn.tenYearUsd);
    rows.forEach(([lab, v], i) => {
      const y = 216 + i * 34;
      ctx.font = `500 15px ${FONT}`;
      ctx.fillStyle = C.muted;
      ctx.fillText(lab, 14, y);
      ctx.fillStyle = "#1c2638";
      ctx.fillRect(100, y - 10, w - 250, 20);
      ctx.fillStyle = INV_ACCENT;
      ctx.fillRect(100, y - 10, (w - 250) * Math.max(0.02, v / max), 20);
      ctx.font = `700 16px ${MONO}`;
      ctx.textAlign = "right";
      ctx.fillStyle = C.text;
      ctx.fillText(money(v), w - 14, y);
      ctx.textAlign = "left";
    });
    ctx.font = `500 12px ${FONT}`;
    ctx.fillStyle = C.muted;
    ctx.fillText("Contributions only — no return assumed.", 14, 322);
  } else {
    ctx.font = `500 15px ${FONT}`;
    ctx.fillStyle = C.muted;
    wrap(ctx, "No month has been logged yet. The path appears with the first sweep — a month has to end, and close above the data rent, before it flows.", 14, 200, w - 28, 22, 4);
  }
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.text;
  ctx.font = `600 15px ${FONT}`;
  if (inv.other) {
    const add = (inv.other.monthlyUsd * inv.other.ratePct) / 100;
    wrap(ctx, `Other income · ${invUsd(inv.other.monthlyUsd)} a month at ${inv.other.ratePct}% → ${invUsd(add)} a month into the same funnel.`, 14, h - 50, w - 28, 20, 2);
  } else {
    ctx.fillStyle = C.amber;
    wrap(ctx, "Other income · not entered. Income that is not day-trading P&L has no line here until the trader sets one in the office panel.", 14, h - 50, w - 28, 20, 2);
  }
}

/** TV · the theme of the day: a dated, sourced demand fact, what is new, who competes, the risk, the vehicles. */
function drawInvTheme(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  const inv = f.screens.invest ?? null;
  clear(ctx, w, h);
  if (!inv) return invDark(ctx, w, "THEME OF THE DAY");
  const t = invThemeNow(f);
  if (!t) {
    header(ctx, w, "THEME OF THE DAY", "no research file", C.muted);
    ctx.fillStyle = C.muted;
    ctx.font = `500 15px ${FONT}`;
    wrap(ctx, "The dated research file has no usable theme. A theme without a sourced demand figure is not shown.", 14, 84, w - 28, 22, 3);
    return;
  }
  const col = INV_TIER_COLOR[t.tier] ?? INV_ACCENT;
  header(ctx, w, "THEME OF THE DAY", `${t.tier.toUpperCase()} · ${t.evidence} evidence`, col);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.text;
  ctx.font = `800 ${t.name.length <= 30 ? 28 : t.name.length <= 40 ? 23 : 19}px ${FONT}`;
  ctx.fillText(ell(ctx, t.name, w - 28), 14, 84);
  ctx.font = `500 14px ${FONT}`;
  ctx.fillStyle = C.muted;
  let y = wrap(ctx, t.summary, 14, 108, w - 28, 18, 2);
  const d = t.demand[0];
  if (d) {
    // A third party's figure is drawn whole: short ones big, long ones smaller and wrapped — never cut.
    const size = d.figure.length <= 16 ? 34 : d.figure.length <= 40 ? 24 : 18;
    ctx.fillStyle = col;
    ctx.font = size === 34 ? `800 34px ${MONO}` : `700 ${size}px ${FONT}`;
    y = wrap(ctx, d.figure, 14, y + size, w - 28, size + 4, 3) + 2;
    ctx.fillStyle = C.text;
    ctx.font = `500 14px ${FONT}`;
    y = wrap(ctx, d.claim, 14, y + 14, w - 28, 18, 2);
    ctx.fillStyle = C.muted;
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText(ell(ctx, `${d.sourceName} · ${d.asOf} — a third party's figure, not ours`, w - 28), 14, y + 2);
    y += 24;
  }
  ctx.fillStyle = C.text;
  ctx.font = `600 13px ${FONT}`;
  for (const inn of t.innovations.slice(0, 2)) {
    ctx.fillText(`▸ ${ell(ctx, inn, w - 44)}`, 14, y);
    y += 20;
  }
  y += 6;
  let x = 14;
  for (const c of t.competitors.slice(0, 4)) {
    // The name without its parenthetical; a long one is cut to its first word so four chips fit the line.
    const nm = c.name.replace(/\s*\(.*?\)\s*/g, " ").trim();
    const short = nm.length > 22 ? nm.split(/\s+/)[0]! : nm;
    x = invChip(ctx, x, y, c.ticker ? `${short} ${c.ticker}` : short, C.cyan, 12);
    if (x > w - 120) break;
  }
  y += 28;
  ctx.fillStyle = C.amber;
  ctx.font = `500 13px ${FONT}`;
  ctx.fillText(ell(ctx, `Risk · ${t.risks[0] ?? "the demand case is not proven"}`, w - 28), 14, y);
  ctx.fillStyle = C.muted;
  ctx.font = `500 11px ${FONT}`;
  ctx.fillText(`Research as of ${inv.themesAsOf} · a theme is context, not a position — a name enters the book only through a dossier.`, 14, h - 10);
}

/** TV · the board: who sits where, and what is on tonight's agenda. */
function drawInvBoard(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  const inv = f.screens.invest ?? null;
  clear(ctx, w, h);
  if (!inv) return invDark(ctx, w, "THE BOARD");
  header(ctx, w, "THE BOARD", "the chair and the five", INV_ACCENT);
  const box = (x: number, y: number, bw: number, bh: number, name: string, role: string, color: string) => {
    ctx.fillStyle = C.panel;
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, bw, 3);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";
    ctx.fillStyle = C.text;
    ctx.font = `700 15px ${FONT}`;
    ctx.fillText(name, x + bw / 2, y + 26);
    ctx.fillStyle = C.muted;
    ctx.font = `500 11px ${FONT}`;
    const words = role.split(" ");
    let line = "";
    let ly = y + 44;
    for (const wd of words) {
      const test = line ? `${line} ${wd}` : wd;
      if (ctx.measureText(test).width > bw - 10 && line) {
        ctx.fillText(line, x + bw / 2, ly);
        ly += 14;
        line = wd;
      } else line = test;
    }
    if (line) ctx.fillText(line, x + bw / 2, ly);
    ctx.textAlign = "left";
  };
  box(144, 58, 170, 62, "Sterling", "Chair / CEO · the order of operations", INV_ACCENT);
  ctx.fillStyle = C.grid;
  ctx.fillRect(228, 120, 2, 16);
  ctx.fillRect(66, 136, 324, 2);
  const crew: [string, string, number][] = [
    ["Nova", "CIO · allocation and the funnel", 14],
    ["Jax", "Scout · industry and innovation", 126],
    ["Gemma", "News and macro · the evidence", 238],
    ["Vince", "Structure · competitors, next buy", 350],
  ];
  for (const [name, role, x] of crew) {
    ctx.fillStyle = C.grid;
    ctx.fillRect(x + 52, 136, 2, 14);
    box(x, 150, 104, 84, name, role, C.cyan);
  }
  ctx.fillStyle = C.text;
  ctx.font = `700 13px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("THE RULE ON THE WALL", 14, 262);
  ctx.fillStyle = C.muted;
  ctx.font = `500 13px ${FONT}`;
  wrap(ctx, inv.funnel.ladderLine, 14, 284, 444, 17, 3);
  // THE CALENDAR: reports inside two weeks that touch the book or the list, from the committed earnings calendar. The talk reads the same list.
  const cats = freshCatalysts(inv);
  ctx.fillStyle = C.text;
  ctx.font = `700 13px ${FONT}`;
  ctx.fillText("REPORTS IN THE NEXT TWO WEEKS", 14, 352);
  if (cats.length > 3) {
    ctx.fillStyle = C.muted;
    ctx.font = `500 12px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(`+${cats.length - 3} more`, 464, 352);
    ctx.textAlign = "left";
  }
  if (!cats.length) {
    ctx.fillStyle = C.muted;
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText(daysBetween(inv.catalystsAsOf, inv.dayKey) > CATALYST_MAX_AGE_DAYS ? `The calendar was captured ${inv.catalystsAsOf} — too old to read.` : "None touches the book or the list.", 14, 374);
  } else {
    cats.slice(0, 3).forEach((c, i) => {
      const y = 374 + i * 19;
      ctx.font = `600 12px ${FONT}`;
      ctx.fillStyle = C.muted;
      ctx.fillText(dayPhrase(c.date, inv.dayKey), 14, y);
      ctx.font = `800 13px ${MONO}`;
      ctx.fillStyle = C.text;
      ctx.fillText(c.ticker, 166, y);
      ctx.font = `500 12px ${FONT}`;
      ctx.fillStyle = C.muted;
      ctx.fillText(c.when, 226, y);
      ctx.fillStyle = c.why === "held" ? C.up : c.why === "theme" ? C.cyan : C.muted;
      ctx.fillText(c.why === "theme" ? "vehicle" : c.why, 356, y);
    });
  }
  ctx.fillStyle = C.grid;
  ctx.fillRect(474, 58, 2, h - 76);
  ctx.fillStyle = C.text;
  ctx.font = `700 15px ${FONT}`;
  ctx.fillText("AGENDA", 492, 78);
  const items = boardAgenda(inv);
  let y = 106;
  ctx.font = `500 15px ${FONT}`;
  if (!items.length) {
    ctx.fillStyle = C.muted;
    wrap(ctx, "Nothing on the agenda — the plan stands.", 492, y, w - 506, 20, 3);
  } else {
    for (const a of items) {
      ctx.fillStyle = C.amber;
      ctx.fillText("▸", 492, y);
      ctx.fillStyle = C.text;
      const text = a.kind === "waiting" ? `${invUsd(a.usd ?? 0)} swept, not yet bought` : a.kind === "rebalance" ? "A sleeve is past its band" : a.kind === "drift" ? "Drift is outside the band but too small to trade" : `Book under ${money(500)} — arithmetic, not allocation`;
      y = wrap(ctx, text, 510, y, w - 524, 20, 3) + 10;
    }
  }
  ctx.fillStyle = C.muted;
  ctx.font = `500 12px ${FONT}`;
  wrap(ctx, "No order is placed from this room. Orders live in the Invest tab, one dossier at a time.", 492, h - 58, w - 506, 16, 3);
}

/** The monitors of the investment wing: Nova's allocation, Jax's scout, Gemma's news, Vince's structure, the chair's one page. */
function drawInvMonitor(who: string, idx: number, ctx: Ctx, w: number, h: number, f: FloorFrame): boolean {
  const inv = f.screens.invest ?? null;
  clear(ctx, w, h);
  ctx.textBaseline = "alphabetic";
  const title = who === "Chair" ? "CHAIR · THE ONE PAGE" : ["CIO · ALLOCATION", "SCOUT · THE THEMES", "NEWS DESK · THE WATCH LIST", "STRUCTURE · WHO COMPETES"][idx] ?? "INVESTMENT";
  if (!inv) {
    invDark(ctx, w, title);
    return true;
  }
  if (who === "Chair") {
    const cov = (["safe", "mid", "high"] as const).map((tier) => {
      const ts = inv.themes.filter((t) => t.tier === tier);
      return `${ts.filter((t) => t.held.length > 0).length}/${ts.length}`;
    });
    header(ctx, w, title, inv.book.valuedAtCost ? "at cost" : "", INV_ACCENT);
    kvLine(ctx, w, 78, "Sweep rate · months", `${inv.funnel.ratePct}% · ${inv.funnel.closedMonths}`, C.text, 16);
    kvLine(ctx, w, 104, "Swept so far", invUsd(inv.funnel.sweptUsd), C.up, 16);
    kvLine(ctx, w, 130, "Waiting to be bought", invUsd(inv.funnel.waitingUsd), inv.funnel.waitingUsd > 0 ? C.amber : C.muted, 16);
    kvLine(ctx, w, 156, "Long book at cost", invUsd(inv.book.totalUsd), C.text, 16);
    kvLine(ctx, w, 182, "Sleeves outside the band", String(inv.book.beyondBand), inv.book.beyondBand > 0 ? C.amber : C.up, 16);
    kvLine(ctx, w, 208, "Research held · safe/mid/high", cov.join(" · "), C.text, 16);
    kvLine(ctx, w, 234, "Other income", inv.other ? `${invUsd(inv.other.monthlyUsd)} × ${inv.other.ratePct}%` : "not entered", inv.other ? C.text : C.muted, 16);
    ctx.fillStyle = C.muted;
    ctx.font = `500 12px ${FONT}`;
    wrap(ctx, inv.next ? inv.next.line : "Nothing swept is waiting to be bought.", 14, 268, w - 28, 16, 2);
    return true;
  }
  if (idx === 0) {
    header(ctx, w, title, inv.book.belowMeaningful ? "arithmetic only" : "weights at cost", INV_ACCENT);
    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = C.muted;
    ["Sleeve", "Now", "Target", "Drift", "To restore"].forEach((c, i) => {
      ctx.textAlign = i === 0 ? "left" : "right";
      ctx.fillText(c, [14, 250, 320, 390, w - 14][i]!, 70);
    });
    ctx.textAlign = "left";
    inv.book.sleeves.forEach((s, i) => {
      const y = 100 + i * 34;
      const out = !inv.book.belowMeaningful && Math.abs(s.driftPct) > inv.book.driftBand;
      ctx.font = `600 15px ${FONT}`;
      ctx.fillStyle = C.text;
      ctx.fillText(INV_SLEEVE_NAME[s.sleeve] ?? s.sleeve, 14, y);
      ctx.font = `700 15px ${MONO}`;
      ctx.textAlign = "right";
      ctx.fillStyle = C.text;
      ctx.fillText(`${Math.round(s.weight * 100)}%`, 250, y);
      ctx.fillText(`${Math.round(s.target * 100)}%`, 320, y);
      ctx.fillStyle = out ? C.amber : C.muted;
      ctx.fillText(`${s.driftPct >= 0 ? "+" : "−"}${Math.abs(Math.round(s.driftPct * 100))}%`, 390, y);
      ctx.fillStyle = C.text;
      ctx.fillText(inv.book.belowMeaningful ? "—" : `${s.correctionUsd >= 0 ? "+" : "−"}${invUsd(Math.abs(s.correctionUsd))}`, w - 14, y);
      ctx.textAlign = "left";
    });
    ctx.fillStyle = C.muted;
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText(`Band ±${Math.round(inv.book.driftBand * 100)}% · no trade below the desk's minimum`, 14, 214);
    ctx.fillStyle = C.text;
    ctx.font = `600 14px ${FONT}`;
    wrap(ctx, inv.next ? `Next dollar · ${inv.next.line}` : "Next dollar · nothing waiting.", 14, 244, w - 28, 18, 3);
    return true;
  }
  if (idx === 1) {
    header(ctx, w, title, `${inv.themes.length} themes`, INV_ACCENT);
    const colW = (w - 28) / 3;
    (["safe", "mid", "high"] as const).forEach((tier, i) => {
      const x = 14 + i * colW;
      const ts = inv.themes.filter((t) => t.tier === tier);
      ctx.fillStyle = INV_TIER_COLOR[tier]!;
      ctx.font = `800 13px ${FONT}`;
      ctx.fillText(`${tier.toUpperCase()} · ${ts.length}`, x, 72);
      ctx.font = `500 12px ${FONT}`;
      ts.slice(0, 7).forEach((t, k) => {
        ctx.fillStyle = t.held.length ? C.up : C.text;
        ctx.fillText(ell(ctx, t.name, colW - 10), x, 98 + k * 25);
        ctx.fillStyle = C.muted;
        ctx.font = `500 10px ${FONT}`;
        ctx.fillText(t.evidence, x, 98 + k * 25 + 11);
        ctx.font = `500 12px ${FONT}`;
      });
    });
    ctx.fillStyle = C.muted;
    ctx.font = `500 11px ${FONT}`;
    ctx.fillText("green = the book holds a vehicle · evidence is the file's own grade", 14, h - 10);
    return true;
  }
  if (idx === 2) {
    header(ctx, w, title, "headlines on the list", INV_ACCENT);
    const rows = f.screens.news.map((n) => ({ n, hit: watchHit(inv, n.title, []) }));
    const hits = rows.filter((r) => r.hit).slice(0, 5);
    const show = hits.length ? hits : rows.slice(0, 5);
    if (!show.length) {
      ctx.fillStyle = C.muted;
      ctx.font = `500 15px ${FONT}`;
      wrap(ctx, "No headlines are loaded yet.", 14, 84, w - 28, 22, 2);
      return true;
    }
    show.forEach((r, i) => {
      const y = 76 + i * 44;
      ctx.fillStyle = r.hit ? C.amber : C.muted;
      ctx.font = `700 11px ${FONT}`;
      ctx.fillText(r.hit ? `${r.hit.kind.toUpperCase()} · ${ell(ctx, r.hit.label, w - 160)}` : "no match", 14, y);
      ctx.textAlign = "right";
      ctx.fillStyle = C.muted;
      ctx.fillText(`${r.n.source} · ${r.n.age}`, w - 14, y);
      ctx.textAlign = "left";
      ctx.fillStyle = C.text;
      ctx.font = `600 13px ${FONT}`;
      ctx.fillText(ell(ctx, r.n.title, w - 28), 14, y + 18);
    });
    ctx.fillStyle = C.muted;
    ctx.font = `500 11px ${FONT}`;
    ctx.fillText(hits.length ? "a headline is context — never a verdict" : "nothing touches the book or the list right now", 14, h - 10);
    return true;
  }
  header(ctx, w, title, "theme of the day", INV_ACCENT);
  const t = invThemeNow(f);
  if (!t) {
    ctx.fillStyle = C.muted;
    ctx.font = `500 15px ${FONT}`;
    wrap(ctx, "No usable theme in the research file.", 14, 84, w - 28, 22, 2);
    return true;
  }
  ctx.fillStyle = C.text;
  ctx.font = `700 17px ${FONT}`;
  ctx.fillText(ell(ctx, t.name, w - 28), 14, 72);
  t.competitors.slice(0, 4).forEach((c, i) => {
    const y = 96 + i * 38;
    ctx.fillStyle = C.cyan;
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText(ell(ctx, c.ticker ? `${c.name} · ${c.ticker}` : c.name, w - 28), 14, y);
    ctx.fillStyle = C.muted;
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText(ell(ctx, c.angle, w - 28), 14, y + 16);
  });
  ctx.fillStyle = C.text;
  ctx.font = `600 12px ${FONT}`;
  ctx.fillText(ell(ctx, `Vehicles · ${t.vehicles.slice(0, 4).map((v) => v.ticker).join(" ")}`, w - 28), 14, h - 26);
  ctx.fillStyle = C.muted;
  ctx.font = `500 11px ${FONT}`;
  ctx.fillText("research, not a recommendation — the dossier gate decides", 14, h - 10);
  return true;
}

/** The monitors of the annex offices, by room and position. */
function drawAnnexMonitor(id: string, ctx: Ctx, w: number, h: number, f: FloorFrame): boolean {
  const [, who, idxStr] = id.split("_");
  const idx = Number(idxStr);
  const audit = f.screens.race?.audit ?? [];
  if (who === "Rnd") {
    if (idx === 0) drawAudit(ctx, w, h, audit, "DESK AUDIT", 2);
    else if (idx === 1) drawProposals(ctx, w, h, f);
    else drawRefusals(ctx, w, h, f);
    return true;
  }
  if (who === "Ops") {
    if (idx === 0) drawFeed(ctx, w, h, f);
    else drawAudit(ctx, w, h, audit.filter((a) => a.area === "data" || a.area === "execution"), "OPS · AUDIT", 2);
    return true;
  }
  if (who === "Goal") {
    if (idx === 0) drawGoalProgress(ctx, w, h, f);
    else if (idx === 1) drawGoalOdds(ctx, w, h, f);
    else drawGoalLadder(ctx, w, h, f);
    return true;
  }
  if (who === "Inv" || who === "Chair") return drawInvMonitor(who, idx, ctx, w, h, f);
  return false;
}

function drawSwing(ctx: Ctx, w: number, h: number, f: FloorFrame) {
  clear(ctx, w, h);
  const rows = f.screens.swing ?? [];
  const lead = rows[0];
  header(ctx, w, "SWING", lead ? lead.verdict : "—", lead?.verdict === "ARMED" ? C.up : C.cyan);
  ctx.font = `500 15px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText("Held through the next open", 16, 58);
  if (!rows.length) {
    ctx.fillStyle = C.text;
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText("No swing book on this read.", 16, 110);
    return;
  }
  const rowH = Math.min(68, (h - 78) / rows.length);
  rows.forEach((r, i) => {
    const y = 72 + i * rowH;
    ctx.fillStyle = i === 0 ? "#122033" : "#0c121c";
    ctx.fillRect(12, y, w - 24, rowH - 6);
    const col = r.verdict === "ARMED" ? C.up : r.verdict === "WATCH" ? C.amber : C.muted;
    ctx.fillStyle = col;
    ctx.font = `700 18px ${MONO}`;
    const verdictW = ctx.measureText(r.verdict).width;
    ctx.fillText(r.verdict, 22, y + 24);
    ctx.fillStyle = C.text;
    ctx.font = `700 20px ${FONT}`;
    const score = r.score.toFixed(2);
    ctx.font = `500 14px ${MONO}`;
    const scoreW = ctx.measureText(score).width;
    ctx.font = `700 20px ${FONT}`;
    const nameX = 22 + verdictW + 16;
    ctx.fillText(fit(ctx, r.name, Math.max(40, w - 28 - nameX - scoreW - 16)), nameX, y + 24);
    ctx.fillStyle = C.muted;
    ctx.font = `500 14px ${MONO}`;
    ctx.textAlign = "right";
    ctx.fillText(score, w - 22, y + 24);
    ctx.textAlign = "left";
    ctx.fillStyle = "#94a3b8";
    ctx.font = `500 14px ${FONT}`;
    ctx.fillText(fit(ctx, r.note, w - 44), 22, y + 46);
  });
}

function drawMead(ctx: Ctx, w: number, h: number, f: FloorFrame): void {
  ctx.fillStyle = "#1c1410";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#e7d7b1";
  ctx.font = `700 28px ${FONT}`;
  ctx.fillText("MEAD HALL", 24, 48);
  ctx.fillStyle = "#d6c4a2";
  ctx.font = `500 16px ${FONT}`;
  const weekend = !isWeekdayAt(f.nowMs);
  const shut = weekend || f.etMin < 9 * 60 + 30 || f.etMin >= 16 * 60;
  const games = (weekend && f.etMin >= 12 * 60 && f.etMin < 23 * 60 + 30) || (!weekend && f.etMin >= 19 * 60 && f.etMin < 23 * 60 + 30);
  ctx.fillText(shut ? "Options book closed. Study the record." : "Options book open. This screen waits.", 24, 88);
  ctx.fillText(games ? "Game window. Paper only. No broker." : "No game window on the clock.", 24, 116);
  ctx.fillStyle = "#8d7b62";
  ctx.font = `500 14px ${FONT}`;
  ctx.fillText("Walk in from the lounge. A number that is not on this screen is not a line.", 24, 156);
}

/** Screens that move between cycles (weather) — the scene redraws these on a timer. */
export const ANIMATED_SCREENS = new Set(["window_0", "window_1", "window_2"]);

/** Draw the screen `id` for this frame. Returns false when the id is unknown. */
export function drawScreen(id: string, ctx: Ctx, w: number, h: number, f: FloorFrame, clockMs: number): boolean {
  ctx.save();
  try {
    if (id === "tv_chart_QQQ") drawChart(ctx, w, h, f.screens.charts.QQQ, f);
    else if (id === "tv_chart_SPY") drawChart(ctx, w, h, f.screens.charts.SPY, f);
    else if (id === "tv_news") drawNews(ctx, w, h, f);
    else if (id === "tv_lounge") drawNews(ctx, w, h, f, true);
    else if (id === "tv_calendar") drawCalendar(ctx, w, h, f);
    else if (id === "whiteboard") drawWhiteboard(ctx, w, h, f);
    else if (id === "marquee") drawMarquee(ctx, w, h, f);
    else if (id === "tv_scanner") drawScanner(ctx, w, h, f, clockMs);
    else if (id === "tv_swing") drawSwing(ctx, w, h, f);
    else if (id === "tv_mead") drawMead(ctx, w, h, f);
    else if (id === "tv_rnd") drawRndBoard(ctx, w, h, f);
    else if (id === "tv_goal") drawSeatLeague(ctx, w, h, f);
    else if (id === "tv_portfolio") drawInvPortfolio(ctx, w, h, f);
    else if (id === "tv_funnel") drawInvFunnel(ctx, w, h, f);
    else if (id === "tv_theme") drawInvTheme(ctx, w, h, f);
    else if (id === "tv_board") drawInvBoard(ctx, w, h, f);
    else if (id.startsWith("mon_")) {
      if (!drawAnnexMonitor(id, ctx, w, h, f)) drawMonitor(id, ctx, w, h, f);
    }
    else if (id === "neon_Jax") drawNeon(ctx, w, h);
    else if (id === "board_Nova") drawChalk(ctx, w, h, f);
    else if (id === "clocks_Gemma") drawClocks(ctx, w, h, clockMs);
    else if (id === "poster_Sterling" || id === "note_Vince") drawPoster(id, ctx, w, h, f);
    else if (id.startsWith("plate_")) drawPlate(id, ctx, w, h);
    else if (id.startsWith("window_")) drawWindow(ctx, w, h, etMinOfClock(clockMs, f), Number(id.split("_")[1] ?? 0) * 977 + 13, f.screens.vix, clockMs / 1000, cuesOfFrame(f).frost);
    else if (id === "jumbo_E") drawLedger(ctx, w, h, f);
    else if (id === "jumbo_S") drawGhosts(ctx, w, h, f);
    else if (id === "jumbo_W") drawCalibration(ctx, w, h, f);
    else if (id === "jumbo_N") drawVote(ctx, w, h, f);
    else if (id === "tv_leader") drawLeague(ctx, w, h, f);
    else return false;
    return true;
  } finally {
    ctx.restore();
  }
}
