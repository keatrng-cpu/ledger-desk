/**
 * Client-side chart markup — copies user TradeZella screenshots and returns
 * annotated versions with system overlays (bias, S/L, targets, confluences).
 * Does not invent fills; labels are from analysis + user notes.
 */

import type { TradezellaAnalysis, SetupPlan } from "./tradezella-analyze";

export type ChartTimeframe = "1m" | "5m" | "15m" | "1h" | "4h";

export const CHART_TIMEFRAMES: ChartTimeframe[] = [
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
];

export interface ChartShot {
  tf: ChartTimeframe;
  dataUrl: string;
  name: string;
}

export interface MarkedChart {
  tf: ChartTimeframe;
  name: string;
  /** Annotated PNG data URL */
  dataUrl: string;
  focus: string;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load chart image"));
    img.src = src;
  });
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function tfFocus(tf: ChartTimeframe): string {
  switch (tf) {
    case "4h":
      return "HTF structure · weekly/daily proxy · BOS/MSS";
    case "1h":
      return "MTF bias · dealing range · displacement";
    case "15m":
      return "Session model · sweep · IFVG/OB";
    case "5m":
      return "Entry refine · CISD · rejection";
    case "1m":
      return "Precision entry · S/L · micro structure";
  }
}

function setupForMarkup(a: TradezellaAnalysis): SetupPlan | null {
  return a.setups[0] ?? null;
}

/**
 * Draw annotations onto a copy of the chart. Returns PNG data URL.
 */
export async function markChart(
  shot: ChartShot,
  analysis: TradezellaAnalysis,
): Promise<MarkedChart> {
  const img = await loadImage(shot.dataUrl);
  const panelW = Math.max(220, Math.round(img.width * 0.28));
  const w = img.width + panelW;
  const h = img.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  // Base chart copy
  ctx.drawImage(img, 0, 0);

  // Dim strip top for TF badge
  ctx.fillStyle = "rgba(11, 11, 15, 0.72)";
  ctx.fillRect(0, 0, img.width, 36);
  ctx.fillStyle = "#14b8a6";
  ctx.font = "bold 16px ui-monospace, monospace";
  ctx.fillText(`${shot.tf.toUpperCase()}  ·  ${tfFocus(shot.tf)}`, 12, 24);

  const setup = setupForMarkup(analysis);
  const side = setup?.side ?? "flat";
  const isLong = side === "long";

  // Approximate structure guides (relative — not price-axis calibrated)
  // Used as educational overlays when user did not pin exact y-prices.
  const guide = (yFrac: number, color: string, label: string) => {
    const y = Math.round(img.height * yFrac);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(img.width, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = "bold 12px ui-sans-serif, system-ui, sans-serif";
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(11,11,15,0.85)";
    ctx.fillRect(8, y - 16, tw + 12, 18);
    ctx.fillStyle = color;
    ctx.fillText(label, 14, y - 3);
  };

  if (setup && side !== "flat") {
    if (isLong) {
      guide(0.72, "#f43f5e", `S/L · ${String(setup.stop).slice(0, 40)}`);
      guide(0.5, "#14b8a6", `ENTRY · ${String(setup.entry).slice(0, 40)}`);
      guide(0.28, "#22c55e", `TP · ${String(setup.targets[0] ?? "").slice(0, 36)}`);
      if (setup.targets[1]) {
        guide(0.18, "#22c55e", `TP2 · ${String(setup.targets[1]).slice(0, 36)}`);
      }
      // discount zone tint
      ctx.fillStyle = "rgba(34, 197, 94, 0.08)";
      ctx.fillRect(0, img.height * 0.55, img.width, img.height * 0.45);
    } else {
      guide(0.28, "#f43f5e", `S/L · ${String(setup.stop).slice(0, 40)}`);
      guide(0.5, "#14b8a6", `ENTRY · ${String(setup.entry).slice(0, 40)}`);
      guide(0.72, "#22c55e", `TP · ${String(setup.targets[0] ?? "").slice(0, 36)}`);
      ctx.fillStyle = "rgba(244, 63, 94, 0.08)";
      ctx.fillRect(0, 0, img.width, img.height * 0.45);
    }
  }

  // Sweep / IFVG callouts (corner chips)
  const chips: string[] = [];
  for (const c of analysis.confluences.filter((x) => x.present).slice(0, 6)) {
    chips.push(c.key);
  }
  let chipX = 10;
  const chipY = img.height - 28;
  ctx.font = "11px ui-monospace, monospace";
  for (const chip of chips) {
    const tw = ctx.measureText(chip).width + 14;
    ctx.fillStyle = "rgba(20, 184, 166, 0.2)";
    ctx.strokeStyle = "rgba(20, 184, 166, 0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(chipX, chipY, tw, 20, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#5eead4";
    ctx.fillText(chip, chipX + 7, chipY + 14);
    chipX += tw + 6;
  }

  // Side panel with full system notes
  ctx.fillStyle = "#12121a";
  ctx.fillRect(img.width, 0, panelW, h);
  ctx.strokeStyle = "#26262f";
  ctx.beginPath();
  ctx.moveTo(img.width, 0);
  ctx.lineTo(img.width, h);
  ctx.stroke();

  let y = 22;
  const pad = img.width + 12;
  const maxTw = panelW - 24;

  const heading = (s: string, color = "#e7e7ea") => {
    ctx.fillStyle = color;
    ctx.font = "bold 12px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(s, pad, y);
    y += 18;
  };
  const body = (s: string, color = "#a0a0ab") => {
    ctx.fillStyle = color;
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    for (const line of wrapText(ctx, s, maxTw)) {
      if (y > h - 12) return;
      ctx.fillText(line, pad, y);
      y += 14;
    }
    y += 4;
  };

  heading("LEDGER MARKUP", "#14b8a6");
  body(`${shot.tf} · ${tfFocus(shot.tf)}`);
  heading("HTF");
  const htf = analysis.timeframes.find((t) => t.tf === "HTF");
  body(`${htf?.bias ?? "?"} — ${htf?.notes ?? ""}`);
  heading("MTF");
  const mtf = analysis.timeframes.find((t) => t.tf === "MTF");
  body(`${mtf?.bias ?? "?"} — ${mtf?.notes ?? ""}`);
  heading("LTF");
  const ltf = analysis.timeframes.find((t) => t.tf === "LTF");
  body(`${ltf?.bias ?? "?"} — ${ltf?.notes ?? ""}`);

  if (setup) {
    heading("SETUP", "#14b8a6");
    body(
      `${setup.strategy} · ${setup.side.toUpperCase()} · ${setup.grade} (${setup.confluenceScore.toFixed(2)})`,
      "#e7e7ea",
    );
    body(`Entry: ${setup.entry}`, "#e7e7ea");
    body(`S/L: ${setup.stop}`, "#fb7185");
    body(`TP: ${setup.targets.join(" | ")}`, "#4ade80");
    body(`R:R ${setup.rr}`);
    body(setup.invalidation);
  }

  heading("STRATEGIES");
  body(
    analysis.strategiesHit.map((s) => s.label).join(", ") || "none locked",
  );

  heading("CONDITIONS");
  body(
    `${analysis.conditions.regime} · ${analysis.conditions.volatility} · ${analysis.conditions.session}`,
  );

  heading("PATH");
  body(analysis.systemAlignment.wrVsTarget);
  body(`Floor ${analysis.systemAlignment.actionFloor} · A+ ${analysis.systemAlignment.aPlusFloor}`);

  // Footer disclaimer on chart
  ctx.fillStyle = "rgba(11,11,15,0.75)";
  ctx.fillRect(0, img.height - 48, img.width, 18);
  ctx.fillStyle = "#71717a";
  ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(
    "Guides are system labels (not auto price-axis calibrated). Confirm levels on tape. Not an order.",
    10,
    img.height - 36,
  );

  return {
    tf: shot.tf,
    name: `marked-${shot.tf}-${shot.name || "chart"}.png`,
    dataUrl: canvas.toDataURL("image/png"),
    focus: tfFocus(shot.tf),
  };
}

export async function markAllCharts(
  shots: ChartShot[],
  analysis: TradezellaAnalysis,
): Promise<MarkedChart[]> {
  const out: MarkedChart[] = [];
  for (const s of shots) {
    out.push(await markChart(s, analysis));
  }
  return out;
}
