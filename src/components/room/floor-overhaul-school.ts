/**
 * Floor 3D overhaul — Chunk B (16–24) canvas drawers.
 * Pure draw helpers for school boards; data comes from school-contract / FloorProps / Manager feed.
 * Presentation only — no invented hit-rates.
 */

import type {
  BriefingBeat,
  ChecklistItem,
  DebatePanel,
  HitRank,
  RelLink,
  SchoolDeskLine,
  SchoolDisciple,
  SchoolFloor,
} from "@/lib/room/school-contract";
import { SCHOOL_ACCENT, SCHOOL_SHORT } from "@/lib/room/school-contract";
import type { ManagerRoomState, ManagerSteer } from "@/lib/room/manager-feed";
import { debatePanel } from "@/lib/room/school-contract";

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
      if (out.length === maxLines) break;
    }
  }
  if (line && out.length < maxLines) out.push(line);
  if (out.length === maxLines && words.join(" ") !== out.join(" ")) out[maxLines - 1] = fit(ctx, `${out[maxLines - 1]}…`, maxW);
  return out;
}

const STATE_COL: Record<string, string> = {
  pass: "#22c55e",
  fail: "#ef4444",
  unknown: "#64748b",
  "awaiting-model": "#f59e0b",
};

/** 16–18: school hall — disciples + desk signature lines. */
export function drawSchoolsBoard(ctx: Ctx, w: number, h: number, school: SchoolFloor | null) {
  ctx.fillStyle = "#060a12";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#38bdf8";
  ctx.font = `800 28px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("SCHOOL DISCIPLES", 24, 40);
  ctx.fillStyle = "#64748b";
  ctx.font = `600 16px ${FONT}`;
  ctx.fillText("ICT · TJR · Blake · Patty · SMC — desk schools, not celebrity looks", 24, 64);
  ctx.fillStyle = "#22c55e";
  ctx.font = `700 14px ${FONT}`;
  ctx.fillText("Seats from @/lib/room/floor-school-contracts · null stubs stay labelled awaiting", 24, 86);

  const disciples = school?.disciples ?? [];
  const desks = school?.desks ?? [];
  const bySchool = Object.fromEntries(desks.map((d) => [d.school, d]));
  if (!disciples.length) {
    ctx.fillStyle = "#64748b";
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText("awaiting model data", 24, 160);
    return;
  }
  const rowH = (h - 110) / disciples.length;
  disciples.forEach((d, i) => {
    const y = 100 + i * rowH;
    ctx.fillStyle = i % 2 ? "#0a101a" : "#0d1420";
    ctx.fillRect(12, y, w - 24, rowH - 6);
    ctx.fillStyle = d.accent;
    ctx.fillRect(12, y, 8, rowH - 6);
    ctx.fillStyle = "#f8fafc";
    ctx.font = `800 22px ${FONT}`;
    ctx.fillText(`${d.who}`, 32, y + 28);
    ctx.fillStyle = d.accent;
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText(`${SCHOOL_SHORT[d.school]} · ${d.role}`, 32, y + 50);
    const line = bySchool[d.school] as SchoolDeskLine | undefined;
    ctx.fillStyle = line?.empty || line?.source === "awaiting-model" ? "#f59e0b" : "#cbd5e1";
    ctx.font = `600 15px ${FONT}`;
    const src = line ? `[${line.source}] ` : "";
    wrap(ctx, `${src}${line?.line ?? "awaiting model data"}`, w - 56, 3).forEach((l, li) => ctx.fillText(l, 32, y + 72 + li * 18));
  });
}

/** Per-desk floating plate (creed / live signature). */
export function drawSchoolDeskPlate(ctx: Ctx, w: number, h: number, d: SchoolDisciple, line: SchoolDeskLine | null) {
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = d.accent;
  ctx.fillRect(0, 0, w, 10);
  ctx.fillStyle = "#f8fafc";
  ctx.font = `800 28px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(fit(ctx, d.who, w - 24), 14, 44);
  ctx.fillStyle = d.accent;
  ctx.font = `700 18px ${FONT}`;
  ctx.fillText(fit(ctx, `${SCHOOL_SHORT[d.school]} · ${d.role}`, w - 24), 14, 70);
  const empty = !line || line.empty || line.source === "awaiting-model";
  ctx.fillStyle = empty ? "#f59e0b" : "#e2e8f0";
  ctx.font = `600 16px ${FONT}`;
  const text = line?.line ?? "awaiting model data";
  wrap(ctx, text, w - 28, 4).forEach((l, i) => ctx.fillText(l, 14, 98 + i * 20));
  ctx.fillStyle = "#64748b";
  ctx.font = `600 13px ${FONT}`;
  ctx.fillText(line ? line.source : "awaiting-model", 14, h - 14);
}

/** 19: floating must-checklist. */
export function drawChecklist(ctx: Ctx, w: number, h: number, items: ChecklistItem[] | null) {
  ctx.fillStyle = "#070b14";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#f59e0b";
  ctx.font = `800 32px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("MUST-CHECKLIST", 24, 42);
  ctx.fillStyle = "#94a3b8";
  ctx.font = `600 16px ${FONT}`;
  ctx.fillText("CONFLUENCE_STACK · pass/fail only from live desk fields · else awaiting model data", 24, 68);
  const list = items ?? [];
  if (!list.length) {
    ctx.fillStyle = "#f59e0b";
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText("awaiting model data", 24, 120);
    return;
  }
  const rowH = Math.min(62, (h - 90) / list.length);
  list.forEach((it, i) => {
    const y = 86 + i * rowH;
    const col = STATE_COL[it.state] ?? "#64748b";
    ctx.fillStyle = i % 2 ? "#0a1220" : "#0c1524";
    ctx.fillRect(16, y, w - 32, rowH - 4);
    // checkbox
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.strokeRect(28, y + rowH / 2 - 12, 24, 24);
    if (it.state === "pass") {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(32, y + rowH / 2);
      ctx.lineTo(38, y + rowH / 2 + 8);
      ctx.lineTo(48, y + rowH / 2 - 8);
      ctx.lineWidth = 3;
      ctx.stroke();
    } else if (it.state === "fail") {
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.moveTo(34, y + rowH / 2 - 6);
      ctx.lineTo(46, y + rowH / 2 + 6);
      ctx.moveTo(46, y + rowH / 2 - 6);
      ctx.lineTo(34, y + rowH / 2 + 6);
      ctx.stroke();
    }
    ctx.fillStyle = "#f8fafc";
    ctx.font = `800 20px ${FONT}`;
    ctx.fillText(fit(ctx, `${it.must ? "MUST" : "opt"} · ${it.label}`, w - 120), 66, y + 24);
    ctx.fillStyle = col;
    ctx.font = `600 15px ${FONT}`;
    ctx.fillText(fit(ctx, `${it.state} — ${it.detail}`, w - 120), 66, y + 46);
  });
}

/** 20: Manager-chaired debate board. */
export function drawDebateBoard(ctx: Ctx, w: number, h: number, manager: ManagerRoomState | null, steer: ManagerSteer | null) {
  const d: DebatePanel = debatePanel(manager, steer);
  ctx.fillStyle = "#080c16";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#a78bfa";
  ctx.font = `800 28px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("MANAGER DEBATE", 24, 40);
  ctx.fillStyle = "#64748b";
  ctx.font = `600 14px ${FONT}`;
  ctx.fillText("Presentation · Manager feed / steer — no execution wiring", 24, 62);

  if (d.empty) {
    ctx.fillStyle = "#f59e0b";
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText(d.line, 24, 120);
    return;
  }
  ctx.fillStyle = "#e2e8f0";
  ctx.font = `800 22px ${FONT}`;
  ctx.fillText(fit(ctx, `Phase ${d.phase}${d.beat ? ` · beat ${d.beat}` : ""}${d.address ? ` · ${d.address}` : ""}`, w - 48), 24, 100);
  ctx.fillStyle = "#cbd5e1";
  ctx.font = `600 18px ${FONT}`;
  wrap(ctx, d.line, w - 48, 3).forEach((l, i) => ctx.fillText(l, 24, 130 + i * 24));
  let y = 210;
  for (const [label, val] of [
    ["Thesis", d.thesis],
    ["Floor", d.floorCite],
    ["PATH", d.pathCite],
    ["Debate", d.debateCite],
  ] as const) {
    if (!val) continue;
    ctx.fillStyle = "#94a3b8";
    ctx.font = `700 14px ${FONT}`;
    ctx.fillText(label, 24, y);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = `600 16px ${FONT}`;
    wrap(ctx, val, w - 48, 2).forEach((l, i) => ctx.fillText(l, 100, y + i * 20));
    y += 48;
  }
  if (d.blocks.length) {
    ctx.fillStyle = "#ef4444";
    ctx.font = `700 14px ${FONT}`;
    ctx.fillText(fit(ctx, `Blocks: ${d.blocks.join(" · ")}`, w - 48), 24, y);
    y += 28;
  }
  if (d.lenses.length) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = `700 14px ${FONT}`;
    ctx.fillText("Lenses (from Manager call — measured)", 24, y);
    y += 22;
    d.lenses.forEach((l) => {
      ctx.fillStyle = "#e2e8f0";
      ctx.font = `600 16px ${MONO}`;
      ctx.fillText(`${l.who} ${Math.round(l.p * 100)}%`, 24, y);
      y += 22;
    });
  }
  if (d.roomP != null) {
    ctx.fillStyle = "#22c55e";
    ctx.font = `800 18px ${FONT}`;
    ctx.fillText(`Room P ${Math.round(d.roomP * 100)}%`, 24, Math.min(h - 20, y + 8));
  }
}

/** 21: 08:30 ET briefing beat. */
export function drawBriefing(ctx: Ctx, w: number, h: number, b: BriefingBeat | null) {
  ctx.fillStyle = "#061018";
  ctx.fillRect(0, 0, w, h);
  const phaseCol =
    b?.phase === "council" || b?.phase === "morning_brief" ? "#22c55e" : b?.phase === "pre" ? "#f59e0b" : b?.phase === "weekend" ? "#64748b" : "#38bdf8";
  ctx.fillStyle = phaseCol;
  ctx.fillRect(0, 0, w, 8);
  ctx.fillStyle = "#38bdf8";
  ctx.font = `800 28px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("08:30 ET BRIEFING BEAT", 24, 42);
  if (!b) {
    ctx.fillStyle = "#f59e0b";
    ctx.font = `700 20px ${FONT}`;
    ctx.fillText("awaiting model data", 24, 90);
    return;
  }
  ctx.fillStyle = phaseCol;
  ctx.font = `800 22px ${FONT}`;
  ctx.fillText(fit(ctx, `${b.label} · ${b.clock}`, w - 48), 24, 74);
  if (b.inMin > 0 && (b.phase === "pre" || b.phase === "done" || b.phase === "weekend")) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = `600 16px ${FONT}`;
    const mm = Math.round(b.inMin);
    ctx.fillText(`Next council in ${Math.floor(mm / 60)}h ${String(mm % 60).padStart(2, "0")}m`, 24, 98);
  }
  if (b.awaitingModel) {
    ctx.fillStyle = "#f59e0b";
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText("awaiting model data — desk week/card empty", 24, 120);
  }
  let y = b.awaitingModel ? 148 : 120;
  for (const line of b.lines) {
    ctx.fillStyle = line === "awaiting model data" ? "#f59e0b" : "#e2e8f0";
    ctx.font = `600 17px ${FONT}`;
    wrap(ctx, `· ${line}`, w - 48, 2).forEach((l) => {
      ctx.fillText(l, 24, y);
      y += 22;
    });
    if (y > h - 16) break;
  }
}

/** 22: hit-rate ranks — real lab track only. */
export function drawHitRanks(ctx: Ctx, w: number, h: number, ranks: HitRank[] | null) {
  ctx.fillStyle = "#0a0e16";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#22c55e";
  ctx.font = `800 28px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("HIT-RATE RANKS", 24, 40);
  ctx.fillStyle = "#94a3b8";
  ctx.font = `600 15px ${FONT}`;
  ctx.fillText("Lab track / calibration only — never invented", 24, 64);
  const list = ranks ?? [];
  if (!list.length) {
    ctx.fillStyle = "#f59e0b";
    ctx.font = `700 20px ${FONT}`;
    ctx.fillText("awaiting model data", 24, 120);
    return;
  }
  const ordered = [...list].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.who.localeCompare(b.who));
  const rowH = Math.min(80, (h - 90) / ordered.length);
  ordered.forEach((r, i) => {
    const y = 82 + i * rowH;
    ctx.fillStyle = i % 2 ? "#101826" : "#0d1420";
    ctx.fillRect(16, y, w - 32, rowH - 6);
    ctx.fillStyle = SCHOOL_ACCENT[r.school];
    ctx.fillRect(16, y, 8, rowH - 6);
    ctx.fillStyle = r.rank != null ? "#f8fafc" : "#64748b";
    ctx.font = `800 26px ${FONT}`;
    ctx.fillText(r.rank != null ? `#${r.rank}` : "—", 36, y + 32);
    ctx.fillStyle = "#f8fafc";
    ctx.font = `800 22px ${FONT}`;
    ctx.fillText(r.who, 100, y + 28);
    ctx.fillStyle = SCHOOL_ACCENT[r.school];
    ctx.font = `700 14px ${FONT}`;
    ctx.fillText(SCHOOL_SHORT[r.school], 100, y + 50);
    ctx.fillStyle = r.hitRate == null ? "#f59e0b" : "#22c55e";
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText(fit(ctx, r.label, w - 280), 240, y + 36);
    // strategyHitBySchool is TODO on Stand — never drawn as a WR.
  });
}

/** Relationship legend strip (arcs drawn in 3D). */
export function relToneColor(tone: RelLink["tone"]): number {
  if (tone === "warm") return 0x22c55e;
  if (tone === "frayed") return 0xef4444;
  if (tone === "cool") return 0x38bdf8;
  return 0x64748b;
}
