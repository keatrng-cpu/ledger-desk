/**
 * Floor 3D overhaul Chunk D (34–35): canvas drawers for the race board and session scrubber screens.
 * Presentation only — every figure comes from floor-race-replay (real seats / closed / book events).
 */

import type { RaceAnim, SessionMoment } from "@/lib/room/floor-race-replay";
import { usd } from "@/lib/room/format";

type Ctx = CanvasRenderingContext2D;
const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

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
      if (out.length >= maxLines) break;
    }
  }
  if (line && out.length < maxLines) out.push(line);
  return out;
}

/** 34 — race board: school/seat runners by real equity progress. */
export function drawRaceBoard(ctx: Ctx, w: number, h: number, race: RaceAnim | null, highlightId: string | null = null) {
  ctx.fillStyle = "#070b14";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#f472b6";
  ctx.font = `800 34px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("SESSION RACE", 24, 44);
  ctx.fillStyle = "#94a3b8";
  ctx.font = `600 16px ${FONT}`;
  ctx.fillText("paper seats · SCHOOL_SHORT labels · no invented WRs", 24, 70);

  if (!race || race.empty) {
    ctx.fillStyle = "#f59e0b";
    ctx.font = `700 24px ${FONT}`;
    ctx.fillText(race?.reason ?? "awaiting seats and goal", 24, 130);
    ctx.fillStyle = "#64748b";
    ctx.font = `500 16px ${FONT}`;
    ctx.fillText("The track fills when the room's paper race has seats and a goal.", 24, 168);
    return;
  }

  ctx.fillStyle = "#e2e8f0";
  ctx.font = `700 18px ${MONO}`;
  ctx.fillText(`${usd(race.start)} → ${usd(race.target)}`, 24, 102);
  ctx.fillStyle = "#94a3b8";
  ctx.font = `600 15px ${FONT}`;
  ctx.fillText(
    `${race.sessions} session${race.sessions === 1 ? "" : "s"} · ${race.touches} touch${race.touches === 1 ? "" : "es"}${race.leaderLabel ? ` · lead ${race.leaderLabel}` : ""}`,
    24,
    126,
  );

  const trackX = 24;
  const trackW = w - 48;
  const trackY0 = 150;
  const rowH = Math.min(52, (h - 170) / Math.max(1, race.runners.length));

  race.runners.forEach((r, i) => {
    const y = trackY0 + i * rowH;
    const hi = highlightId != null && (r.id === highlightId || r.who === highlightId);
    ctx.fillStyle = hi ? "#1e293b" : i % 2 ? "#0a1020" : "#0c1426";
    ctx.fillRect(trackX, y, trackW, rowH - 4);
    // track bar
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(trackX + 120, y + rowH / 2 - 4, trackW - 280, 8);
    ctx.fillStyle = r.color;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(trackX + 120, y + rowH / 2 - 4, (trackW - 280) * r.progress, 8);
    ctx.globalAlpha = 1;
    // runner puck
    const px = trackX + 120 + (trackW - 280) * r.progress;
    ctx.beginPath();
    ctx.arc(px, y + rowH / 2, 9, 0, Math.PI * 2);
    ctx.fillStyle = r.color;
    ctx.fill();
    if (r.isLeader) {
      ctx.strokeStyle = "#fde68a";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = r.isLeader ? "#fde68a" : "#f8fafc";
    ctx.font = `800 18px ${FONT}`;
    ctx.fillText(fit(ctx, r.label, 110), trackX + 8, y + rowH / 2 + 6);
    ctx.textAlign = "right";
    ctx.fillStyle = r.pnl >= 0 ? "#22c55e" : "#ef4444";
    ctx.font = `700 16px ${MONO}`;
    ctx.fillText(`${r.pnl >= 0 ? "+" : "−"}${usd(Math.abs(Math.round(r.pnl)))}`, trackX + trackW - 8, y + rowH / 2 + 6);
    ctx.textAlign = "left";
    if (r.status !== "running") {
      ctx.fillStyle = r.status === "hit" ? "#22c55e" : "#ef4444";
      ctx.font = `800 12px ${FONT}`;
      ctx.fillText(r.status === "hit" ? "GOAL" : "FLOOR", trackX + trackW - 90, y + rowH / 2 + 6);
    }
  });
}

/** 35 — scrubber strip: real moments only; empty when none recorded. */
export function drawScrubberBoard(
  ctx: Ctx,
  w: number,
  h: number,
  moments: readonly SessionMoment[] | null,
  scrubIndex: number | null,
) {
  ctx.fillStyle = "#070b14";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#38bdf8";
  ctx.font = `800 32px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("SESSION REPLAY", 24, 42);
  ctx.fillStyle = "#94a3b8";
  ctx.font = `600 15px ${FONT}`;
  ctx.fillText("scrub real seat / close / book moments · no invented history", 24, 68);

  const list = moments ?? [];
  if (!list.length) {
    ctx.fillStyle = "#f59e0b";
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText("no moments yet", 24, 120);
    ctx.fillStyle = "#64748b";
    ctx.font = `500 16px ${FONT}`;
    wrap(ctx, "Seat events, closed paper, and book log entries appear here as they happen. Nothing is fabricated.", w - 48, 3).forEach(
      (l, i) => ctx.fillText(l, 24, 156 + i * 22),
    );
    return;
  }

  const idx = scrubIndex == null ? 0 : Math.min(list.length - 1, Math.max(0, scrubIndex));
  const cur = list[idx]!;

  // scrub track
  const barX = 24;
  const barW = w - 48;
  const barY = 96;
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(barX, barY, barW, 10);
  const t = list.length <= 1 ? 0 : idx / (list.length - 1);
  ctx.fillStyle = "#38bdf8";
  ctx.fillRect(barX, barY, barW * t, 10);
  ctx.beginPath();
  ctx.arc(barX + barW * t, barY + 5, 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#94a3b8";
  ctx.font = `600 14px ${MONO}`;
  ctx.fillText(`${idx + 1} / ${list.length}`, 24, 130);

  ctx.fillStyle = "#f8fafc";
  ctx.font = `800 22px ${FONT}`;
  ctx.fillText(fit(ctx, cur.title, w - 48), 24, 168);
  ctx.fillStyle = "#cbd5e1";
  ctx.font = `600 16px ${FONT}`;
  wrap(ctx, cur.detail, w - 48, 3).forEach((l, i) => ctx.fillText(l, 24, 198 + i * 22));

  const meta = [
    cur.kind.toUpperCase(),
    cur.schoolShort ? cur.schoolShort : null,
    cur.who,
    new Date(cur.at).toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " ET",
  ]
    .filter(Boolean)
    .join(" · ");
  ctx.fillStyle = "#64748b";
  ctx.font = `600 14px ${FONT}`;
  ctx.fillText(fit(ctx, meta, w - 48), 24, h - 24);

  // nearby list
  let y = 280;
  ctx.fillStyle = "#64748b";
  ctx.font = `700 12px ${FONT}`;
  ctx.fillText("NEARBY (real)", 24, y);
  y += 18;
  for (let i = Math.max(0, idx - 1); i < Math.min(list.length, idx + 4); i++) {
    const m = list[i]!;
    ctx.fillStyle = i === idx ? "#e2e8f0" : "#64748b";
    ctx.font = i === idx ? `700 15px ${FONT}` : `500 14px ${FONT}`;
    ctx.fillText(fit(ctx, `${i + 1}. ${m.title}`, w - 48), 24, y);
    y += 22;
    if (y > h - 40) break;
  }
}
