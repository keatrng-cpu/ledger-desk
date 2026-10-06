/**
 * Floor 3D overhaul Chunk C (27–28) — Manager war-room screen draws (presentation only).
 * Arm lever math lives in src/lib/room/arm-lever.ts (item 29).
 */
import type { DiscretionRule, ManagerRoomState } from "@/lib/room/manager-feed";
import { armLeverDisplay } from "@/lib/room/arm-lever";

export { armLeverDisplay } from "@/lib/room/arm-lever";

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
type Ctx = CanvasRenderingContext2D;

function fit(ctx: Ctx, text: string, maxW: number): string {
  let s = text;
  while (s.length > 2 && ctx.measureText(s).width > maxW) s = `${s.slice(0, -2)}…`;
  return s;
}

function wrap(ctx: Ctx, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxW) line = next;
    else {
      if (line) out.push(line);
      line = w;
      if (out.length === maxLines) break;
    }
  }
  if (line && out.length < maxLines) out.push(line);
  if (out.length === maxLines && words.join(" ") !== out.join(" ")) out[maxLines - 1] = fit(ctx, `${out[maxLines - 1]}…`, maxW);
  return out;
}

function monitorFrame(ctx: Ctx, w: number, h: number, title: string, accent: string) {
  ctx.fillStyle = "#060a12";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, w, 6);
  ctx.fillStyle = "#94a3b8";
  ctx.font = `800 18px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(title, 14, 32);
}

/** Third Manager monitor: arms + session flags (read-only). */
export function drawManagerArms(ctx: Ctx, w: number, h: number, s: ManagerRoomState | null) {
  const lever = armLeverDisplay(s?.arms);
  const accent = lever.position === "live" ? "#ef4444" : lever.position === "armed" ? "#f59e0b" : "#64748b";
  monitorFrame(ctx, w, h, "TRADING STAND · ARMS", accent);
  ctx.fillStyle = accent;
  ctx.font = `800 36px ${FONT}`;
  ctx.fillText(lever.label, 14, 78);
  let y = 112;
  for (const line of lever.lines) {
    ctx.fillStyle = "#e2e8f0";
    ctx.font = `600 18px ${FONT}`;
    ctx.fillText(fit(ctx, line, w - 28), 14, y);
    y += 26;
  }
  ctx.fillStyle = "#f59e0b";
  ctx.font = `700 14px ${FONT}`;
  wrap(ctx, lever.note, w - 28, 2).forEach((l, i) => ctx.fillText(l, 14, h - 36 + i * 18));
}

/** Discretion whiteboard: Owner teach rules from the Manager feed (presentation). */
export function drawDiscretionBoard(ctx: Ctx, w: number, h: number, rules: DiscretionRule[] | null) {
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, w, 44);
  ctx.fillStyle = "#f8fafc";
  ctx.font = `800 22px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("DISCRETION · Owner teach", 16, 30);
  ctx.fillStyle = "#64748b";
  ctx.font = `600 13px ${FONT}`;
  ctx.fillText("presentation — biases the chair, never bypasses PATH / envelope / arms", 16, 62);

  const list = rules ?? [];
  if (list.length === 0) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = `700 20px ${FONT}`;
    ctx.fillText("No discretion rules yet", 16, 110);
    ctx.fillStyle = "#64748b";
    ctx.font = `600 16px ${FONT}`;
    wrap(ctx, "Owner Teach (1:1 with Stand or Prototype Lab) writes mock DiscretionRules here.", w - 32, 3).forEach((l, i) =>
      ctx.fillText(l, 16, 145 + i * 24),
    );
    return;
  }

  let y = 95;
  const active = list.filter((r) => r.active);
  const show = (active.length ? active : list).slice(0, 8);
  for (const r of show) {
    ctx.fillStyle = r.active ? "#0f172a" : "#94a3b8";
    ctx.font = `800 16px ${FONT}`;
    ctx.fillText(fit(ctx, `${r.effect} · ${r.scope}:${r.scopeKey}`, w - 32), 16, y);
    y += 22;
    ctx.fillStyle = "#334155";
    ctx.font = `600 15px ${FONT}`;
    wrap(ctx, r.text || "(no text)", w - 32, 2).forEach((l) => {
      ctx.fillText(l, 16, y);
      y += 20;
    });
    ctx.fillStyle = "#64748b";
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText(`hits ${r.hits}${r.lastHitAt ? ` · last ${new Date(r.lastHitAt).toISOString().slice(0, 16)}Z` : ""}`, 16, y);
    y += 28;
    if (y > h - 40) break;
  }
  if (list.length > show.length) {
    ctx.fillStyle = "#64748b";
    ctx.font = `600 14px ${FONT}`;
    ctx.fillText(`+${list.length - show.length} more`, 16, h - 16);
  }
}
