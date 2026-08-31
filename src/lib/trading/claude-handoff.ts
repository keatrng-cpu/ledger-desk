/**
 * One-block desk snapshot for Cursor/Claude/Grok.
 * Copy from the HUD; paste into any Claude chat so they see the same desk.
 */

import type { DeskPayload } from "./build-desk";
import { isJudasWindow } from "./sessions";
import { evaluateOptionsDesk } from "./options-desk";
import { ritualWindow, LIVE_PULSE_CONTRACT } from "./live-session";
import { APLUS_RULES } from "@/lib/aplus/config";

function px(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function qLine(
  label: string,
  q: { symbol: string; price: number; changePct: number; source: string; lagSec: number },
): string {
  const sign = q.changePct >= 0 ? "+" : "";
  return `${label} ${q.symbol} ${px(q.price)} (${sign}${q.changePct.toFixed(2)}%) src=${q.source} lag=${Math.round(q.lagSec)}s`;
}

export function buildClaudeHandoff(desk: DeskPayload): string {
  const ritual = ritualWindow();
  const judas = isJudasWindow(desk.clock.etHour, desk.clock.etMinute);
  const best = desk.scan.candidates.slice(0, 4);
  const tapeAlerts = [
    ...(desk.smc?.left.alerts ?? []).slice(-6).map((a) => `L ${a.tf} ${a.kind} ${a.label}`),
    ...(desk.smc?.right.alerts ?? []).slice(-6).map((a) => `R ${a.tf} ${a.kind} ${a.label}`),
  ].slice(0, 8);

  const lines: string[] = [
    "=== LEDGER DESK HANDOFF ===",
    `fetched ${desk.fetchedAt} · feed ${desk.feed}`,
    `clock ${desk.clock.nowEt} · kz ${desk.clock.killzoneLabel} · phase ${desk.clock.sessionPhase} · window ${desk.clock.inTradeWindow ? "OPEN" : "CLOSED"}`,
    `ritual ${ritual.id} ${ritual.label} · ${ritual.et} · judas=${judas ? "YES STAND" : "no"}`,
    qLine("LEFT", desk.quotes.left),
    qLine("RIGHT", desk.quotes.right),
    desk.liveSays
      ? `LIVE DATA SAYS ${JSON.stringify({
          live: desk.liveSays.live,
          window: desk.liveSays.window,
          source: desk.liveSays.source,
          lagSec: desk.liveSays.lagSec,
          mnq: desk.liveSays.mnq,
          es: desk.liveSays.es,
          path: desk.liveSays.path,
        })}`
      : "LIVE DATA SAYS { live: false }",
    `HTF ${desk.bias.left.symbol} ${desk.bias.left.topDown} (${Math.round(desk.bias.left.confidence * 100)}%) sess ${desk.bias.left.sessionStance}`,
    `HTF ${desk.bias.right.symbol} ${desk.bias.right.topDown} (${Math.round(desk.bias.right.confidence * 100)}%) sess ${desk.bias.right.sessionStance}`,
  ];

  const dl = desk.bias.left.dealing;
  if (dl) {
    lines.push(
      `dealing ${desk.bias.left.symbol} H ${px(dl.high)} EQ ${px(dl.eq)} L ${px(dl.low)} zone ${dl.zone}`,
    );
  }
  const dr = desk.bias.right.dealing;
  if (dr) {
    lines.push(
      `dealing ${desk.bias.right.symbol} H ${px(dr.high)} EQ ${px(dr.eq)} L ${px(dr.low)} zone ${dr.zone}`,
    );
  }

  lines.push(`news ${desk.news.verdict}${desk.news.nextEvent ? ` · ${desk.news.nextEvent.name} ${desk.news.nextEvent.timeEt} ET in ${desk.news.nextEvent.minutesAway}m` : ""}`);
  if (desk.scan.smt?.note) lines.push(`SMT ${desk.scan.smt.edge}: ${desk.scan.smt.note}`);
  if (desk.smtStack?.primary?.note) lines.push(`SMT stack ${desk.smtStack.primary.note}`);
  if (desk.brief) {
    lines.push(`brief ${desk.brief.verdict} ${desk.brief.score} — ${desk.brief.headline}`);
  }
  if (desk.weekAhead) {
    const w = desk.weekAhead;
    lines.push(`WEEK ${w.plan.weekLabel} · ${w.plan.htfBias}`);
    if (w.focus) {
      lines.push(
        `WEEK ${w.today ? "TODAY" : "NEXT"} ${w.focus.weekday} ${w.focus.date} · ${w.focus.dailyBias}`,
      );
      lines.push(`WEEK tape: ${w.focus.likelyTape}`);
      lines.push(`WEEK trade: ${w.focus.trade}`);
      lines.push(`WEEK skip: ${w.focus.skipIf}`);
    }
    lines.push(
      `WEEK NQ PWH ${w.plan.nq.pwh} EQ ${w.plan.nq.eq} PWL ${w.plan.nq.pwl}${w.plan.nq.cwh != null ? ` CWH ${w.plan.nq.cwh} CWL ${w.plan.nq.cwl}` : ""} · ES PWH ${w.plan.es.pwh} PWL ${w.plan.es.pwl}${w.plan.es.cwh != null ? ` CWH ${w.plan.es.cwh} CWL ${w.plan.es.cwl}` : ""}`,
    );
  }
  if (desk.monthAhead) {
    const m = desk.monthAhead;
    const p = m.phase ?? m.nextPhase;
    lines.push(`MONTH ${m.plan.monthLabel} · ${m.plan.thesis}`);
    if (p) {
      lines.push(
        `MONTH ${m.phase ? "NOW" : "NEXT"} ${p.label} ${p.start}–${p.end} · ${p.dailyBias}`,
      );
      lines.push(`MONTH strategy: ${p.strategy}`);
      lines.push(`MONTH quota: ${p.pathQuota} · book: ${p.book}`);
      lines.push(`MONTH skip: ${p.skipIf}`);
    }
    lines.push(
      `MONTH NQ PWH ${m.plan.nq.pwh} EQ ${m.plan.nq.eq} PWL ${m.plan.nq.pwl}${m.plan.nq.cmh != null ? ` CMH ${m.plan.nq.cmh} CML ${m.plan.nq.cml}` : ""} · ES PWH ${m.plan.es.pwh} PWL ${m.plan.es.pwl}`,
    );
  }
  if (desk.narrative?.summary) lines.push(`narrative ${desk.narrative.summary.slice(0, 280)}`);

  const failed = desk.checklist.filter((c) => !c.ok);
  if (failed.length) {
    lines.push(`checklist FAIL: ${failed.map((c) => c.label).join(" · ")}`);
  }

  lines.push("", "PATH CANDIDATES:");
  if (!best.length) lines.push("(none)");
  for (const c of best) {
    lines.push(
      `- ${c.symbol} ${c.side} band=${c.pathBand ?? c.grade} Q=${c.confluence.toFixed(2)} actionable=${c.actionable} model=${c.completeStrategy || c.strategyPrimary}`,
    );
    lines.push(`  entry ${c.entryZone} | inv ${c.invalidation}`);
    if (c.targets[0]) lines.push(`  T ${c.targets.slice(0, 2).join(" · ")}`);
    if (c.missing.length) lines.push(`  missing: ${c.missing.slice(0, 6).join(", ")}`);
    if (c.strategyWhy[0]) lines.push(`  why: ${c.strategyWhy.slice(0, 2).join(" | ")}`);
  }

  if (tapeAlerts.length) {
    lines.push("", "SMC TAPE:");
    for (const a of tapeAlerts) lines.push(`- ${a.slice(0, 160)}`);
  }

  const lv = desk.levels?.[0]?.items?.slice(0, 8) ?? [];
  if (lv.length) {
    lines.push("", `LEVELS ${desk.levels[0]?.symbol}:`);
    for (const it of lv) lines.push(`- ${it.name} ${px(it.price)} (${it.kind})`);
  }

  try {
    const opt = evaluateOptionsDesk(desk);
    lines.push("", `OPTIONS ${opt.focus}`);
    if (opt.best?.ticket) {
      const t = opt.best.ticket;
      lines.push(
        `OPTIONS best ${opt.best.id} ${t.contracts} ${t.underlier} ${t.side} ${t.product} pay~$${t.estDebitTotal} max$${t.maxLoss}`,
      );
    }
    lines.push(
      `OPTIONS sleeve $${opt.sleeve.equity} risk ${(opt.sleeve.riskPct * 100).toFixed(0)}% cap $${opt.maxDebit} primary ${opt.primary}`,
    );
  } catch {
    /* options desk is additive */
  }

  lines.push(
    "",
    `RULES floor=${APLUS_RULES.confluenceFloor} A+=${APLUS_RULES.aPlusThreshold} PATH/mo=${APLUS_RULES.targetTradesPerMonth.center} one-book RR>=1 micros ${APLUS_RULES.useMicros}`,
    `CONTRACT ${LIVE_PULSE_CONTRACT}`,
    "=== END HANDOFF ===",
  );
  return lines.join("\n");
}
