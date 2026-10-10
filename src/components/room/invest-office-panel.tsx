/**
 * The investment office, beside the 3D floor: the funnel (day-trading income and the other income into the long book), the
 * book (sleeves against the trader's own targets, valued at cost), and the research themes — safe, mid and high — each with a
 * dated, sourced demand fact, what is new, who competes, the risk and the listed vehicles.
 *
 * The same reads the TVs in the wing draw and the five quote (frame.screens.invest). Reading only, except one input: "other
 * income" — money that is not day-trading P&L and the share the trader chooses to send to the long book. It is two numbers kept
 * in this browser; it never writes to the Invest ledger and never moves a dollar. A theme is context, not a recommendation: a
 * name enters the book only through a dossier and the ADD gate in the Invest tab.
 */

import { useEffect, useMemo, useState } from "react";
import { Landmark } from "lucide-react";
import { contributionPath } from "@/lib/invest/policy";
import { subscribeInvest } from "@/lib/invest/store";
import { usableThemes } from "@/lib/room/invest-themes";
import { boardAgenda, lookAt, themeOfTheDay } from "@/lib/room/invest-read";
import { investReadProblem, loadOtherIncome, readInvestOffice, saveOtherIncome, subscribeOtherIncome } from "@/lib/room/invest-sources";
import type { InvestLite } from "@/lib/room/live-types";
import { etWallParts } from "@/lib/trading/sessions";
import { refreshInvestScreens } from "./room-engine";
import type { FloorFrame } from "./floor-screens";

const CARD = "min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3";
const BTN =
  "inline-flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-fg)] hover:border-[var(--color-primary)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)] disabled:opacity-40";
const INPUT = "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-[12px] text-[var(--color-fg)]";

const SECTIONS = [
  { id: "funnel", label: "Funnel", wall: "tv_funnel" },
  { id: "book", label: "Book", wall: "tv_portfolio" },
  { id: "themes", label: "Research", wall: "tv_theme" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const TIER_COLOR = { safe: "#34d399", mid: "#fbbf24", high: "#fb7185" } as const;
const SLEEVE_NAME: Record<string, string> = { ballast: "Ballast", compounder: "Compounders", drypowder: "Dry powder" };
const SLEEVE_COLOR: Record<string, string> = { ballast: "#22d3ee", compounder: "#a78bfa", drypowder: "#f59e0b" };

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const money2 = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function KV({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border)] py-1 text-[12px]">
      <span className="text-[var(--color-muted)]">{k}</span>
      <span className="font-mono font-semibold" style={tone ? { color: tone } : undefined}>
        {v}
      </span>
    </div>
  );
}

/** Other income and the share sent to the long book: arithmetic only, kept in this browser. */
function OtherIncome({ inv }: { inv: InvestLite }) {
  const saved = loadOtherIncome();
  const [monthly, setMonthly] = useState(saved ? String(saved.monthlyUsd) : "");
  const [rate, setRate] = useState(saved ? String(saved.ratePct) : "");
  const [msg, setMsg] = useState<string | null>(null);
  const m = Number(monthly);
  const r = Number(rate);
  const ok = monthly.trim() !== "" && rate.trim() !== "" && Number.isFinite(m) && Number.isFinite(r) && m >= 0 && r >= 0 && r <= 100;
  const add = ok ? (m * r) / 100 : 0;
  const combined = (inv.funnel.avgMonthlyUsd ?? 0) + add;

  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Other income → the same funnel</div>
      <p className="mb-2 text-[11px] text-[var(--color-subtle)]">
        Income that is not day-trading P&amp;L (a salary, a side business, a refund). You choose the share. This is arithmetic — it is kept in this browser and never
        moves money or writes the Invest ledger.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-[var(--color-muted)]">
          Monthly dollars
          <input className={INPUT} inputMode="decimal" placeholder="e.g. 1500" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </label>
        <label className="text-[11px] text-[var(--color-muted)]">
          Share to the long book, %
          <input className={INPUT} inputMode="decimal" placeholder="e.g. 20" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={BTN}
          disabled={!ok}
          onClick={() => {
            const res = saveOtherIncome({ monthlyUsd: m, ratePct: r });
            setMsg(res.why);
            if (res.ok) refreshInvestScreens();
          }}
        >
          Save
        </button>
        <button
          type="button"
          className={BTN}
          onClick={() => {
            const res = saveOtherIncome(null);
            setMonthly("");
            setRate("");
            setMsg(res.why);
            if (res.ok) refreshInvestScreens();
          }}
        >
          Clear
        </button>
        {msg && <span className="text-[11px] text-[var(--color-muted)]">{msg}</span>}
      </div>
      {ok && (
        <p className="mt-2 text-[12px] text-[var(--color-fg)]">
          {money2(m)} × {r}% = <b>{money2(add)}</b> a month.
          {inv.funnel.avgMonthlyUsd != null && (
            <>
              {" "}
              With the logged average sweep ({money2(inv.funnel.avgMonthlyUsd)}) the long book receives <b>{money2(combined)}</b> a month: {money(contributionPath(combined, 5).totalUsd)} in
              five years, {money(contributionPath(combined, 10).totalUsd)} in ten — contributions only, no return assumed.
            </>
          )}
        </p>
      )}
    </div>
  );
}

export function InvestOfficePanel({ frame, onGo }: { frame: FloorFrame | null; onGo: (screenId: string) => void }) {
  const [tab, setTab] = useState<SectionId>("funnel");
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => subscribeInvest(() => setVersion((n) => n + 1)), []);
  useEffect(() => subscribeOtherIncome(() => setVersion((n) => n + 1)), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const inv = useMemo(() => readInvestOffice(Date.now()), [version, frame?.id]);
  const research = useMemo(() => usableThemes(), []);
  const section = SECTIONS.find((s) => s.id === tab)!;
  const nowMs = frame?.nowMs ?? Date.now();
  const wd = etWallParts(nowMs).weekday;
  const etMin = frame?.etMin ?? etWallParts(nowMs).hour * 60 + etWallParts(nowMs).minute;
  const today = inv ? themeOfTheDay(inv, lookAt(etMin, wd >= 1 && wd <= 5)) : null;

  return (
    <div className={CARD}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Landmark className="h-4 w-4 text-[#2dd4bf]" />
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Investment office — the long game</div>
        <div className="ml-auto flex flex-wrap gap-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setTab(s.id)}
              aria-pressed={tab === s.id}
              className={`rounded px-2 py-0.5 text-[11px] ${tab === s.id ? "bg-white text-black" : "border border-[var(--color-border)] text-[var(--color-fg)]"}`}
            >
              {s.label}
            </button>
          ))}
          <button type="button" className={BTN} onClick={() => onGo(section.wall)} title="Fly to the screen that shows this in the office">
            On the wall
          </button>
        </div>
      </div>

      {!inv ? (
        <p className="text-[12px] text-[var(--color-muted)]">{investReadProblem() ?? "The investment office reads the Invest tab's ledger from this browser — nothing to show here yet."}</p>
      ) : (
        <>
          {tab === "funnel" && (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <KV k="Sweep rate · closed months" v={`${inv.funnel.ratePct}% · ${inv.funnel.closedMonths}`} />
                <KV k="Swept so far" v={money2(inv.funnel.sweptUsd)} tone="var(--color-up)" />
                <KV k="Waiting to be bought" v={money2(inv.funnel.waitingUsd)} tone={inv.funnel.waitingUsd > 0 ? "#f59e0b" : undefined} />
                {inv.funnel.avgMonthlyUsd != null && inv.funnel.fiveYearUsd != null && inv.funnel.tenYearUsd != null ? (
                  <>
                    <KV k="Average sweep a month" v={money2(inv.funnel.avgMonthlyUsd)} />
                    <KV k="Five years of that" v={money(inv.funnel.fiveYearUsd)} />
                    <KV k="Ten years of that" v={money(inv.funnel.tenYearUsd)} />
                    <p className="mt-1 text-[11px] text-[var(--color-subtle)]">Contributions only — no return assumed.</p>
                  </>
                ) : (
                  <p className="mt-2 text-[12px] text-[var(--color-muted)]">No month is logged yet. The path appears with the first sweep: a month has to end, and close above the data rent.</p>
                )}
                <p className="mt-2 text-[11px] text-[var(--color-subtle)]">{inv.funnel.ladderLine}</p>
                <p className="mt-1 text-[11px] text-[var(--color-subtle)]">The order never changes: data rent, then the options sleeve, then the split. Swept dollars never return to the sleeve.</p>
              </div>
              <OtherIncome inv={inv} />
            </div>
          )}

          {tab === "book" && (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <KV k="Long book at cost" v={money2(inv.book.totalUsd)} />
                <KV k="Positions" v={String(inv.book.positions)} />
                {inv.book.sleeves.map((s) => {
                  const out = !inv.book.belowMeaningful && Math.abs(s.driftPct) > inv.book.driftBand;
                  return (
                    <div key={s.sleeve} className="border-b border-[var(--color-border)] py-1.5 text-[12px]">
                      <div className="flex items-baseline justify-between">
                        <span>{SLEEVE_NAME[s.sleeve] ?? s.sleeve}</span>
                        <span className="font-mono" style={out ? { color: "#f59e0b" } : undefined}>
                          {Math.round(s.weight * 100)}% / {Math.round(s.target * 100)}%
                        </span>
                      </div>
                      <div className="relative mt-1 h-2 rounded bg-[var(--color-surface)]">
                        <div className="h-2 rounded" style={{ width: `${Math.max(0, Math.min(1, s.weight)) * 100}%`, background: out ? "#f59e0b" : (SLEEVE_COLOR[s.sleeve] ?? "#22d3ee") }} />
                        <div className="absolute top-[-3px] h-[14px] w-[2px] bg-[var(--color-fg)]" style={{ left: `${Math.max(0, Math.min(1, s.target)) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
                <p className="mt-1 text-[11px] text-[var(--color-subtle)]">
                  {inv.book.valuedAtCost ? "Valued at cost — marks are fetched in the Invest tab, not on the Floor. " : ""}
                  {inv.book.belowMeaningful ? "Under $500 the weights are arithmetic, not allocation; no sleeve target binds yet." : `Band ±${Math.round(inv.book.driftBand * 100)}% · ${inv.book.beyondBand} outside.`}
                </p>
              </div>
              <div>
                <div className="mb-2 text-[10px] leading-snug text-[var(--color-muted)]">Long board on the Invest tab: safety, power, grid, fuel, compute, building, space, health. The room does not pick one.</div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Research the book holds</div>
                {(["safe", "mid", "high"] as const).map((tier) => {
                  const ts = inv.themes.filter((t) => t.tier === tier);
                  return (
                    <KV key={tier} k={`${tier} tier`} v={`${ts.filter((t) => t.held.length > 0).length} of ${ts.length} themes`} tone={TIER_COLOR[tier]} />
                  );
                })}
                <div className="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Next dollar</div>
                <p className="text-[12px] text-[var(--color-fg)]">{inv.next ? inv.next.line : "Nothing swept is waiting to be bought."}</p>
                <div className="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">On the board's agenda</div>
                {boardAgenda(inv).length === 0 ? (
                  <p className="text-[12px] text-[var(--color-muted)]">Nothing — the plan stands.</p>
                ) : (
                  <ul className="list-disc pl-4 text-[12px]">
                    {boardAgenda(inv).map((a) => (
                      <li key={a.kind}>
                        {a.kind === "waiting" ? `${money2(a.usd ?? 0)} swept, not yet bought` : a.kind === "rebalance" ? "A sleeve is past its band" : a.kind === "drift" ? "Drift is outside the band but too small to trade" : "Book under $500 — arithmetic, not allocation"}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {tab === "themes" && (
            <div>
              <p className="mb-2 text-[11px] text-[var(--color-subtle)]">
                Dated research as of {inv.themesAsOf}: what each industry needs, who competes for it, and the risk. A third party's figure is quoted as theirs. Context only — a name
                enters the book through a dossier and the ADD gate in the Invest tab; none of these is a recommendation.
                {today ? ` On the wall today: ${today.name}.` : ""}
              </p>
              {(["safe", "mid", "high"] as const).map((tier) => (
                <div key={tier} className="mb-2">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: TIER_COLOR[tier] }}>
                    {tier} risk
                  </div>
                  <div className="space-y-1">
                    {research
                      .filter((t) => t.tier === tier)
                      .map((t) => {
                        const held = inv.themes.find((x) => x.id === t.id)?.held ?? [];
                        return (
                          <div key={t.id} className="rounded border border-[var(--color-border)] px-2 py-1">
                            <button type="button" className="flex w-full items-center gap-2 text-left text-[12px]" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>
                              <span className="font-semibold">{t.name}</span>
                              <span className="text-[10px] text-[var(--color-muted)]">
                                {t.horizon === "long" ? "long horizon" : "mid horizon"} · {t.evidence} evidence
                              </span>
                              {held.length > 0 && <span className="rounded bg-[var(--color-surface)] px-1 text-[10px] text-[var(--color-up)]">held: {held.join(", ")}</span>}
                              <span className="ml-auto text-[var(--color-subtle)]">{open === t.id ? "−" : "+"}</span>
                            </button>
                            {open === t.id && (
                              <div className="mt-1 space-y-1 border-t border-[var(--color-border)] pt-1 text-[12px]">
                                <p className="text-[var(--color-fg)]">{t.summary}</p>
                                {t.demand.map((d) => (
                                  <p key={d.claim} className="text-[var(--color-muted)]">
                                    <b className="text-[var(--color-fg)]">{d.figure}</b> — {d.claim}{" "}
                                    <a className="underline underline-offset-2" href={d.source} target="_blank" rel="noopener noreferrer">
                                      {d.sourceName}, {d.asOf}
                                    </a>
                                  </p>
                                ))}
                                {t.innovations.length > 0 && <p className="text-[var(--color-muted)]">New: {t.innovations.join(" · ")}</p>}
                                <p className="text-[var(--color-muted)]">
                                  Competitors:{" "}
                                  {t.competitors.map((c) => `${c.name}${c.ticker ? ` (${c.ticker})` : ""} — ${c.angle}`).join(" · ")}
                                </p>
                                {t.risks.length > 0 && <p style={{ color: "#f59e0b" }}>Risk: {t.risks.join(" · ")}</p>}
                                <p className="text-[var(--color-muted)]">Vehicles on the table: {t.vehicles.map((v) => `${v.ticker} (${v.kind})`).join(", ")}. Wash-sale list applies; the dossier gate decides.</p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
