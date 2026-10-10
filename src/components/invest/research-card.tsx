/**
 * THE RESEARCH — one card per name, verdict on the left, caveat always
 * visible, never a score.
 *
 * Changed 2026-09-26:
 *   - The verdict reads the book: look-through weight against the cap, the
 *     twin rule for the ballast, WATCH as a refusal, and a kill rule a
 *     PERSON judged tripped.
 *   - Each company shows its earnings yield against the ten-year (the
 *     comparison dossiers.ts promised and never printed), implied growth
 *     from forward as well as trailing earnings, and how much of it VTI
 *     already holds.
 *   - The operator line links the filing that verified it.
 */

import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { ALL_DOSSIERS, RISK_FREE } from "@/lib/invest/dossiers";
import { fundamentalsFor, snapshotCapturedAt, oldestAsOf, canAdd } from "@/lib/invest/universe";
import { impliedGrowth, sensitivity, qualityRead, trendRead, earningsYield } from "@/lib/invest/factors";
import { evidenceFor, SOURCES } from "@/lib/invest/evidence";
import { verdictFor, type VerdictContext } from "@/lib/invest/book";
import { effectiveWeight, weightInFund, type ExposureRead } from "@/lib/invest/exposure";
import { durabilityLegs, requiredVsDelivered } from "@/lib/invest/durability";
import { LINK, VERDICT_CLS, pct } from "./format";
import { Card, Line, Note } from "./ui";

export interface Judged {
  tripped: boolean;
  judgedAt: string;
  note: string;
}

export function ResearchCard({
  weights,
  held,
  exposure,
  judgements,
  closes,
  belowMeaningful,
}: {
  /** Direct weight per held ticker. */
  weights: Map<string, number>;
  held: Set<string>;
  exposure: ExposureRead;
  /** Latest human judgement per ticker (kill-store.ts). */
  judgements: Map<string, Judged>;
  /** Latest real close per ticker, when marks are loaded. */
  closes: Map<string, number>;
  belowMeaningful: boolean;
}) {
  const oldest = oldestAsOf();
  const [q, setQ] = useState("");
  const [sleeve, setSleeve] = useState<"all" | "ballast" | "drypowder" | "compounder">("all");
  const sleeves = ["ballast", "drypowder", "compounder"] as const;
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ALL_DOSSIERS.filter((d) => {
      if (sleeve !== "all" && d.sleeve !== sleeve) return false;
      if (!needle) return true;
      return `${d.ticker} ${d.name} ${d.sells}`.toLowerCase().includes(needle);
    });
  }, [q, sleeve]);
  return (
    <Card
      title="Research"
      right={<span className="font-mono text-[10px] text-[var(--color-muted)]">{`fundamentals ${snapshotCapturedAt()}${oldest && oldest !== snapshotCapturedAt() ? ` · oldest ${oldest}` : ""} · 10y ${RISK_FREE.yieldPct}%`}</span>}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a name"
          className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-[11px]"
        />
        <button type="button" onClick={() => setSleeve("all")} className={`rounded-full border px-2 py-0.5 text-[10px] ${sleeve === "all" ? "border-[var(--color-fg)] text-[var(--color-fg)]" : "border-[var(--color-border)] text-[var(--color-muted)]"}`}>All</button>
        {sleeves.map((s) => (
          <button key={s} type="button" onClick={() => setSleeve(s)} className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${sleeve === s ? "border-[var(--color-fg)] text-[var(--color-fg)]" : "border-[var(--color-border)] text-[var(--color-muted)]"}`}>{s}</button>
        ))}
      </div>
      <div className="space-y-2">
        {sleeves.filter((s) => sleeve === "all" || sleeve === s).map((s) => {
          const group = rows.filter((d) => d.sleeve === s);
          if (!group.length) return null;
          return (
            <details key={s} open={q.trim().length > 0} className="rounded border border-[var(--color-border)]">
              <summary className="cursor-pointer px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">{s} · {group.length}</summary>
              <div className="space-y-1.5 p-1.5">
        {group.map((d) => {
          const j = judgements.get(d.ticker);
          const ctx: VerdictContext = {
            held,
            effective: exposure.preview ? undefined : effectiveWeight(exposure, d.ticker),
            tripped: j?.tripped ? { judgedAt: j.judgedAt, note: j.note } : null,
            belowMeaningful,
          };
          const v = verdictFor(d, weights.get(d.ticker) ?? 0, ctx);
          const f = fundamentalsFor(d.ticker);
          const gate = canAdd(d);
          const inVti = d.kind === "company" ? weightInFund("VTI", d.ticker) : null;
          const src = SOURCES[`${d.ticker}.governance.ceo`];
          return (
            <details key={d.ticker} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs">
                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${VERDICT_CLS[v.verdict]}`}>{v.verdict}</span>
                <span className="font-medium">{d.ticker}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-muted)]">{d.name}</span>
                {d.watch && (
                  <span className="rounded border border-[var(--color-border)] px-1 text-[9px] uppercase text-[var(--color-muted)]">watch</span>
                )}
                <span className="shrink-0 text-[10px] uppercase text-[var(--color-muted)]">
                  {d.cycle} · cap {Math.round(d.maxWeight * 100)}%{inVti ? ` · ${pct(inVti, 1)} of VTI` : ""}
                </span>
              </summary>

              <div className="mt-2 space-y-1 text-[11px] leading-relaxed">
                <p className="text-[var(--color-muted)]">{v.why}</p>
                <Line label="Sells">{d.sells}</Line>
                <Line label="Moat">{d.moat}</Line>
                <Line label="2035">{d.useIn2035}</Line>
                {d.kind === "company" && (
                  <Line label="Who runs it">
                    {d.governance.ceo || "UNCONFIRMED — read the proxy"}
                    {d.governance.ceoSince ? ` since ${d.governance.ceoSince}` : ""}
                    {d.governance.founderLed ? " (founder)" : ""}
                    {d.governance.dualClass ? " · dual-class, you do not get a vote" : ""}
                    {src?.url ? (
                      <>
                        {" · "}
                        <a href={src.url} target="_blank" rel="noopener noreferrer" className={LINK}>
                          verified {src.checkedAt}
                        </a>
                      </>
                    ) : null}
                    {d.governance.successionNote ? ` — ${d.governance.successionNote}` : ""}
                  </Line>
                )}
                <Line label="Kill rule">{d.killRule}</Line>
                {j && (
                  <p className={j.tripped ? "text-[var(--color-down)]" : "text-[var(--color-muted)]"}>
                    Your judgement {j.judgedAt.slice(0, 10)}: {j.tripped ? "TRIPPED" : "not tripped"}
                    {j.note ? ` — ${j.note}` : ""}
                  </p>
                )}
                {d.watch && (
                  <>
                    <Line label="Watch because">{d.watch.reason}</Line>
                    <Line label="Clears when">{d.watch.clearsWhen}</Line>
                  </>
                )}
                {d.regulatory && <Line label="Regulatory">{d.regulatory}</Line>}
                {f && !f.pendingCapture && d.kind === "company" && (
                  <p className="tabular-nums text-[var(--color-muted)]">
                    P/E {f.peTrailing ?? "—"} trail · {f.peForward ?? "—"} fwd · margin {pct(f.profitMargin)} · rev{" "}
                    {pct(f.revenueGrowthYoy)} · earnings{" "}
                    <span className={(f.earningsGrowthYoy ?? 0) < 0 ? "text-[var(--color-down)]" : ""}>{pct(f.earningsGrowthYoy)}</span> ·
                    beta {f.beta ?? "—"} · insiders {f.insiderPct ?? "—"}% · inst {f.institutionPct ?? "—"}% · as of {f.asOf}
                  </p>
                )}
                {d.kind === "company" &&
                  (() => {
                    const g = impliedGrowth(f);
                    if (g.growth == null) return null;
                    const gf = impliedGrowth(f, { basis: "forward" });
                    const band = sensitivity(f)
                      .map((x) => (x.growth == null ? "—" : `${(x.growth * 100).toFixed(1)}%`))
                      .join(" / ");
                    const q = qualityRead(f);
                    const t = trendRead(f, closes.get(d.ticker) ?? null);
                    const ey = earningsYield(f);
                    return (
                      <>
                        <p className="rounded border border-[var(--color-border)] p-1.5">
                          <span className="text-[var(--color-muted)]">The price already assumes · </span>
                          <span className="font-semibold tabular-nums">
                            {(g.growth * 100).toFixed(1)}% earnings growth a year for {g.years} years
                          </span>{" "}
                          <span className="text-[var(--color-muted)]">
                            ({g.demand}) from trailing earnings
                            {gf.growth != null ? `, ${(gf.growth * 100).toFixed(1)}% from forward` : ""} — {band} across a
                            3.5–5.5% equity risk premium. Not a forecast: this is the assumption inside today's price, so you can
                            disagree with it.
                          </span>
                        </p>
                        {(() => {
                          const rd = requiredVsDelivered(d.ticker);
                          const legs = durabilityLegs(d.ticker);
                          return (
                            <div className="rounded border border-[var(--color-border)] p-1.5">
                              <p>
                                <span className="text-[var(--color-muted)]">Price vs record · </span>
                                <span className={rd.read === "asks-more" ? "text-[var(--color-warn)]" : ""}>{rd.line}</span>
                              </p>
                              {legs.length > 0 && (
                                <p className="mt-0.5 text-[var(--color-muted)]">
                                  {legs.map((l, k) => (
                                    <span key={l.key} className={l.flag ? "text-[var(--color-warn)]" : ""}>
                                      {k ? " · " : ""}
                                      {l.label} {l.value == null ? "—" : `${(l.value * 100).toFixed(1)}%`} ({l.reads})
                                    </span>
                                  ))}
                                </p>
                              )}
                            </div>
                          );
                        })()}
                        <p className="text-[var(--color-muted)]">{ey.line}</p>
                        <p className="text-[var(--color-muted)]">Quality · {q.legs.map((l) => `${l.label} ${l.reads}`).join(" · ")}</p>
                        <p className="text-[var(--color-muted)]">Trend · {t.line}</p>
                      </>
                    );
                  })()}
                {d.kind === "company" && evidenceFor(d.ticker, "governance.ceo") !== "verified" && (
                  <Note tone="warn">
                    Operator is asserted, not verified — no primary source attached. Settle it from the newest filing (an 8-K
                    or a signed 10-Q certification beats an old proxy) before treating it as checked.
                  </Note>
                )}
                {d.caveat && (
                  <p className="flex gap-1.5 rounded border border-[var(--color-border)] p-1.5 text-[var(--color-warn)]">
                    <Info size={12} className="mt-0.5 shrink-0" />
                    {d.caveat}
                  </p>
                )}
                {!gate.canAdd && !d.watch && <Note tone="down">Blocked · {gate.reason}</Note>}
              </div>
            </details>
          );
        })}
              </div>
            </details>
          );
        })}
        {rows.length === 0 && <p className="text-[11px] text-[var(--color-muted)]">Nothing matches.</p>}
      </div>
    </Card>
  );
}
