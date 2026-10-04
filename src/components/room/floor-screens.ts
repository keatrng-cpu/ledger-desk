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
import type { Character, RoomOutput, RoomTrace, UnderlierTape } from "@/lib/room/orchestrator";
import type { Underlier } from "@/lib/room/option-math";

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
  /** The same paths on the model's out-of-sample hit rate — the second number the EV gate requires. */
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
  ctx.fillText(title, 14, 22);
  ctx.font = `600 18px ${MONO}`;
  ctx.fillStyle = C.muted;
  ctx.textAlign = "right";
  ctx.fillText(right, w - 14, 22);
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
  const urg = URGENCY_COLOR[f.output.room_state.market_urgency] ?? C.cyan;
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
  let yy = 72;
  const cal = f.screens.calendar.slice(0, 6);
  ctx.font = `600 19px ${FONT}`;
  if (!cal.length) {
    ctx.fillStyle = C.muted;
    ctx.fillText("No releases on today's calendar.", 16, yy);
    yy += 30;
  }
  for (const e of cal) {
    ctx.fillStyle = e.status === "next" ? C.amber : e.status === "printed" ? C.muted : C.text;
    ctx.font = `700 19px ${MONO}`;
    ctx.fillText(e.timeEt, 16, yy);
    ctx.font = `600 19px ${FONT}`;
    ctx.fillText(`${e.name}${e.impact === "high" ? "  ●" : ""}`, 100, yy);
    ctx.fillStyle = C.muted;
    ctx.font = `500 15px ${FONT}`;
    ctx.fillText(e.status === "printed" ? "printed" : e.status === "next" ? "next — ±15m blackout" : "", 100, yy + 20);
    yy += 50;
    if (yy > h - 60) break;
  }
  ctx.fillStyle = C.text;
  ctx.font = `700 20px ${MONO}`;
  const v = f.screens.vix;
  const t = f.screens.tenYear;
  ctx.fillText(`VIX ${v != null && v > 0 ? v.toFixed(2) : "—"}   10Y ${t != null ? t.toFixed(2) + "%" : "—"}`, 16, h - 18);
}

/* ── Whiteboard ─────────────────────────────────────────────────────────── */

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
  let yy = 92;
  if (p) {
    const rows: [string, number | null, string][] = [
      ["CE", p.entry, ink],
      ["STOP", p.stop, red],
      ["T1", p.t1, green],
      ["T2", p.t2, green],
    ];
    for (const [k, v, col] of rows) {
      if (v == null) continue;
      ctx.fillStyle = col;
      ctx.fillText(`${k}  ${fmt(v, v > 1000 ? 0 : 2)}`, 28, yy);
      yy += 34;
    }
  } else {
    ctx.fillStyle = "#475569";
    ctx.fillText("no priced plan", 28, yy);
    yy += 34;
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
    ctx.fillText(`${g.ok ? "✓" : "✗"} ${g.label.slice(0, 46)}`, w * 0.46, gy);
    gy += 30;
    if (gy > h - 60) break;
  }
  if (!gates.length) {
    ctx.fillStyle = "#475569";
    ctx.fillText(f.trace.refusal ? `✗ ${f.trace.refusal.slice(0, 46)}` : "nothing to clear", w * 0.46, gy);
  }
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
  ctx.fillStyle = t.volume_spike ? C.amber : C.muted;
  ctx.fillText(t.volume_spike ? "VOLUME SPIKE" : "volume normal", 150, 170);
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

function drawPoster(id: string, ctx: Ctx, w: number, h: number) {
  if (id === "note_Vince") {
    ctx.fillStyle = "#fde68a";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#1f2937";
    ctx.font = `700 34px ${HAND}`;
    ctx.fillText("REST AT CE.", 18, 70);
    ctx.fillText("NEVER PAY", 18, 120);
    ctx.fillText("THE PRINT.", 18, 168);
    return;
  }
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#7f1d1d";
  ctx.font = `800 34px ${FONT}`;
  ctx.fillText("THE LIST", 24, 56);
  ctx.fillStyle = "#111827";
  ctx.font = `600 24px ${FONT}`;
  ["1  Desk word", "2  CE touch", "3  Halt room", "4  One book", "5  Slots + cash", "6  Objectives met?", "     → STOP"].forEach((l, i) =>
    ctx.fillText(l, 24, 110 + i * 48),
  );
}

const PLATE: Record<string, string> = {
  plate_Jax: "JAX — TJR · Momentum",
  plate_Nova: "NOVA — Blake Mech · Quant",
  plate_Gemma: "GEMMA — ICT · Macro",
  plate_Sterling: "STERLING — Patty/PB · Risk",
  plate_Vince: "VINCE — SMC · Execution",
};

function drawPlate(id: string, ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = "#cbd5e1";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#0f172a";
  ctx.font = `700 34px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(PLATE[id] ?? id, w / 2, h / 2 + 2);
  ctx.textAlign = "left";
}

/**
 * Market weather: the sky follows the ET clock (night, dawn, day, dusk) and
 * the VIX — clear under 15, scattered cloud to 20, overcast to 30, a storm
 * with rain and lightning above it. Rain and lightning move with `tSec`.
 */
function drawWindow(ctx: Ctx, w: number, h: number, etMin: number, seed: number, vix: number | null, tSec: number) {
  const hour = etMin / 60;
  const night = hour < 6.5 || hour > 19.5;
  const dusk = !night && (hour < 8 || hour > 17.5);
  const v = vix != null && vix > 0 ? vix : 16;
  const storm = v >= 30;
  const overcast = v >= 20;
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
  const clouds = v < 15 ? 1 : v < 20 ? 3 : v < 30 ? 6 : 9;
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
    const drops = storm ? 140 : v >= 25 ? 60 : 0;
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
  const both = L.evUsd > 0 && (L.evCalUsd == null || L.evCalUsd > 0);
  ctx.fillStyle = L.held ? (L.evUsd > 0 ? C.up : C.down) : both ? C.up : C.down;
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
    ctx.fillStyle = r.pnlUsd >= 0 ? C.up : C.down;
    ctx.fillText(`${r.gate.padEnd(10)} ${String(r.n).padStart(3)}×  ${signed(r.pnlUsd).padStart(7)}  ${r.wins}W`, 16, yy);
    yy += 28;
  }
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
    ctx.fillText(L[c].basis.slice(0, 70), 130, yy + 22);
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
  ctx.fillText("#   name       credibility   calls R/W/F        Brier", 16, 68);
  let yy = 104;
  rows.forEach((r, i) => {
    ctx.fillStyle = i === 0 ? "#fde68a" : C.text;
    ctx.font = `800 24px ${MONO}`;
    ctx.fillText(`${i + 1}`, 16, yy);
    ctx.fillStyle = CREW_COLOR[r.c];
    ctx.font = `800 24px ${FONT}`;
    ctx.fillText(r.c, 48, yy);
    ctx.fillStyle = C.text;
    ctx.font = `700 22px ${MONO}`;
    ctx.fillText(String(r.rank).padStart(3), 230, yy);
    ctx.fillStyle = C.muted;
    ctx.fillRect(282, yy - 12, 100, 8);
    ctx.fillStyle = CREW_COLOR[r.c];
    ctx.fillRect(282, yy - 12, r.rank, 8);
    ctx.fillStyle = C.text;
    ctx.font = `600 19px ${MONO}`;
    ctx.fillText(r.rec ? `${r.rec.right}/${r.rec.wrong}/${r.rec.flat}` : "—", 410, yy);
    ctx.fillText(r.brier != null ? `${r.brier.toFixed(3)} (n${r.n})` : `— (n${r.n})`, 560, yy);
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
    else if (id.startsWith("mon_")) drawMonitor(id, ctx, w, h, f);
    else if (id === "neon_Jax") drawNeon(ctx, w, h);
    else if (id === "board_Nova") drawChalk(ctx, w, h, f);
    else if (id === "clocks_Gemma") drawClocks(ctx, w, h, clockMs);
    else if (id === "poster_Sterling" || id === "note_Vince") drawPoster(id, ctx, w, h);
    else if (id.startsWith("plate_")) drawPlate(id, ctx, w, h);
    else if (id.startsWith("window_")) drawWindow(ctx, w, h, etMinOfClock(clockMs, f), Number(id.split("_")[1] ?? 0) * 977 + 13, f.screens.vix, clockMs / 1000);
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
