/**
 * THE BOOK — what is actually held, lot by lot, marked at a real close.
 *
 * Changed 2026-09-26:
 *   - Every buy is its own tax lot; sales relieve FIFO (Robinhood's default)
 *     and print short- vs long-term before they are recorded.
 *   - Positions mark at a Yahoo daily close with its date, or at cost with
 *     the reason — never a guessed price.
 *   - Real buys are RECORDED even when they break a rule (banned, no
 *     dossier, WATCH, inside a wash window): the ledger's job is to be true.
 *     Each such buy needs a second click that names the rule it breaks, and
 *     the rule's name is written into the entry.
 *   - Sells and dividends exist. So does a void, with a reason.
 */

import { useMemo, useState } from "react";
import { Ban, TriangleAlert } from "lucide-react";
import type { BookRead, RebalanceRead, ShadowRead } from "@/lib/invest/book";
import { SLEEVE_TARGET } from "@/lib/invest/book";
import {
  buyWashWarning,
  heldPositions,
  isDate,
  longTermFrom,
  previewSale,
  taxYear,
  type BuySource,
  type LedgerRead,
  type SaleRead,
} from "@/lib/invest/ledger";
import { canAdd, type Sleeve } from "@/lib/invest/universe";
import { dossierFor } from "@/lib/invest/dossiers";
import { banReason } from "@/lib/invest/rh-bridge";
import { etToday, recordBuy, recordDividend, recordSell, voidEntry } from "@/lib/invest/store";
import type { InvestMarks } from "@/lib/invest/marks";
import { BUTTON, INPUT, LINK, pct, signed, usd } from "./format";
import { Card, Note } from "./ui";

type Tab = "buy" | "sell" | "dividend";

export function BookCard({
  ledger,
  book,
  reb,
  marks,
  marksMsg,
  onRefreshMarks,
  shadow,
  waitingUsd,
  onWrite,
}: {
  ledger: LedgerRead;
  book: BookRead;
  reb: RebalanceRead;
  marks: InvestMarks | null;
  marksMsg: string;
  onRefreshMarks: () => void;
  shadow: ShadowRead | null;
  waitingUsd: number;
  onWrite: () => void;
}) {
  const today = etToday();
  const held = useMemo(() => heldPositions(ledger, today), [ledger, today]);
  const [tab, setTab] = useState<Tab>("buy");
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const markOf = (t: string) => marks?.marks.find((m) => m.ticker === t)?.last ?? null;
  const thisYear = Number(today.slice(0, 4));
  const tax = [taxYear(ledger, thisYear), taxYear(ledger, thisYear - 1)];

  return (
    <Card
      title="The book"
      right={
        <span className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--color-muted)]">
          {marksMsg}
          <button type="button" className={BUTTON} onClick={onRefreshMarks}>
            Refresh marks
          </button>
        </span>
      }
    >
      {held.length === 0 ? (
        <Note>
          Nothing held yet. The first year of this book will look like a joke — that is the correct result, not a bug. The
          habit is the product.
        </Note>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[11px] tabular-nums">
              <thead className="text-[10px] uppercase text-[var(--color-muted)]">
                <tr className="text-left">
                  <th className="py-1 pr-2 font-medium">Name</th>
                  <th className="pr-2 text-right font-medium">Shares</th>
                  <th className="pr-2 text-right font-medium">Cost</th>
                  <th className="pr-2 text-right font-medium">Mark</th>
                  <th className="pr-2 text-right font-medium">Value</th>
                  <th className="pr-2 text-right font-medium">P/L</th>
                  <th className="pr-2 font-medium">Long-term</th>
                </tr>
              </thead>
              <tbody>
                {held.map((p) => {
                  const v = book.positions.find((x) => x.ticker === p.ticker);
                  const m = markOf(p.ticker);
                  return (
                    <tr key={p.ticker} className="border-t border-[var(--color-border)] align-top">
                      <td className="py-1 pr-2">
                        <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => setOpen(open === p.ticker ? null : p.ticker)}>
                          {p.ticker}
                        </button>{" "}
                        <span className="text-[10px] text-[var(--color-muted)]">{p.sleeve}</span>
                      </td>
                      <td className="pr-2 text-right">{p.shares.toFixed(4)}</td>
                      <td className="pr-2 text-right">{usd(p.costUsd)}</td>
                      <td className="pr-2 text-right" title={m ? `as of ${m.at}` : "no mark — valued at cost"}>
                        {m ? m.price.toFixed(2) : "cost"}
                      </td>
                      <td className="pr-2 text-right">{usd(v?.valueUsd ?? p.costUsd)}</td>
                      <td className={`pr-2 text-right ${(v?.plUsd ?? 0) < 0 ? "text-[var(--color-down)]" : ""}`}>
                        {m ? `${signed(v?.plUsd ?? 0)} (${pct((v?.plUsd ?? 0) / (p.costUsd || 1))})` : "—"}
                      </td>
                      <td className="pr-2 text-[10px] text-[var(--color-muted)]">
                        {p.longTermShares > 0 ? `${p.longTermShares.toFixed(4)} sh LT` : "none yet"}
                        {p.nextLongTerm ? ` · next ${p.nextLongTerm}` : ""}
                        {p.hasMigrated ? " · dates approximate" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {open &&
            (() => {
              const p = held.find((x) => x.ticker === open);
              if (!p) return null;
              return (
                <div className="mt-2 rounded border border-[var(--color-border)] p-2">
                  <Note>
                    <span className="text-[var(--color-fg)]">{p.ticker} lots</span> — each is its own holding period; sales
                    take the oldest first (FIFO).
                  </Note>
                  <ul className="mt-1 space-y-0.5 text-[11px] tabular-nums">
                    {p.lots.map((l) => (
                      <li key={l.id} className="flex flex-wrap justify-between gap-2">
                        <span>
                          {l.date} · {l.sharesOpen.toFixed(4)} sh · {usd(l.costOpenUsd)} · {l.source}
                          {l.migrated ? " · merged before lots were tracked — date is the earliest buy" : ""}
                        </span>
                        <span className="text-[var(--color-muted)]">
                          {today >= longTermFrom(l.date) ? "long-term" : `long-term from ${longTermFrom(l.date)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}

          <div className="mt-2 grid grid-cols-3 gap-2">
            {book.sleeves.map((s) => (
              <div key={s.sleeve} className="rounded border border-[var(--color-border)] p-1.5">
                <div className="text-[10px] uppercase text-[var(--color-muted)]">{s.sleeve}</div>
                <div className="text-xs tabular-nums">{usd(s.valueUsd)}</div>
                <div className="text-[10px] tabular-nums text-[var(--color-muted)]">
                  {Math.round(s.weight * 100)}% / {Math.round(SLEEVE_TARGET[s.sleeve] * 100)}% target
                </div>
              </div>
            ))}
          </div>
          <Note>{book.note}</Note>
          <Note>{reb.note}</Note>
          {reb.actions.map((a) => (
            <Note key={a.sleeve} tone="warn">
              {a.reason} ({signed(a.usd)})
            </Note>
          ))}
          {book.banned.map((b) => (
            <p key={b.ticker} className="mt-1 flex gap-1.5 text-[11px] text-[var(--color-down)]">
              <Ban size={12} className="mt-0.5 shrink-0" />
              {b.ticker} is wash-sale entangled with the options sleeve — {b.why}
            </p>
          ))}
          {shadow && (
            <Note>
              <span className="text-[var(--color-fg)]">Against the benchmark · </span>
              {shadow.line}
            </Note>
          )}
        </>
      )}

      <div className="mt-3 border-t border-[var(--color-border)] pt-2">
        <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label="Record">
          {(["buy", "sell", "dividend"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => {
                setTab(t);
                setMsg(null);
              }}
              className={`${BUTTON} ${tab === t ? "border-[var(--color-accent)]" : ""}`}
            >
              Record {t}
            </button>
          ))}
        </div>
        {tab === "buy" && (
          <BuyForm ledger={ledger} waitingUsd={waitingUsd} onDone={(m) => { setMsg(m); onWrite(); }} />
        )}
        {tab === "sell" && (
          <SellForm ledger={ledger} held={held.map((h) => ({ ticker: h.ticker, shares: h.shares }))} onDone={(m) => { setMsg(m); onWrite(); }} />
        )}
        {tab === "dividend" && (
          <DividendForm held={held.map((h) => ({ ticker: h.ticker, sleeve: h.sleeve }))} onDone={(m) => { setMsg(m); onWrite(); }} />
        )}
        {msg && <Note>{msg}</Note>}
      </div>

      <div className="mt-3 space-y-1 border-t border-[var(--color-border)] pt-2">
        {tax.map((t) => (
          <Note key={t.year}>
            <span className="text-[var(--color-fg)]">Tax year · </span>
            {t.line}
          </Note>
        ))}
        <Note>Not tax advice. FIFO matches Robinhood's default disposal; if you chose specific lots at the broker, its 1099-B wins.</Note>
      </div>

      <Activity ledger={ledger} onWrite={onWrite} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function BuyForm({ ledger, waitingUsd, onDone }: { ledger: LedgerRead; waitingUsd: number; onDone: (m: string) => void }) {
  const [f, setF] = useState<{ ticker: string; sleeve: Sleeve; shares: string; cost: string; date: string; source: BuySource }>({
    ticker: "",
    sleeve: "ballast",
    shares: "",
    cost: "",
    date: etToday(),
    source: "sweep",
  });
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const check = (): { ok: boolean; warn: string[]; override: string | null } => {
    const shares = Number(f.shares);
    const cost = Number(f.cost);
    if (!/^[A-Z][A-Z.-]{0,9}$/.test(f.ticker)) return { ok: false, warn: ["Ticker?"], override: null };
    if (!(shares > 0) || !(cost > 0)) return { ok: false, warn: ["Shares and the dollars actually paid, both > 0."], override: null };
    if (!isDate(f.date) || f.date > etToday()) return { ok: false, warn: ["Trade date must be today or earlier."], override: null };
    const warn: string[] = [];
    let override: string | null = null;
    const ban = banReason(f.ticker);
    if (ban) {
      warn.push(`${f.ticker} is BANNED here — ${ban}. Record it only if you ALREADY bought it; the book will show it OUT until it is sold.`);
      override = `banned: ${ban}`;
    } else {
      const d = dossierFor(f.ticker);
      const gate = d ? canAdd(d) : { canAdd: false, reason: "No dossier — outside the researched universe." };
      if (!gate.canAdd) {
        warn.push(`Outside the book's rules: ${gate.reason}`);
        override = gate.reason.slice(0, 160);
      }
    }
    const wash = buyWashWarning(ledger, f.ticker, f.date);
    if (wash) warn.push(wash);
    if (f.source === "sweep" && cost > waitingUsd + 0.005) {
      warn.push(`Tagged "sweep" but only ${usd(waitingUsd)} of swept cash is waiting. Tag the rest "other" (new money) so the deploy queue stays true.`);
    }
    return { ok: true, warn, override };
  };

  const write = (override: string | null) => {
    const res = recordBuy({
      ticker: f.ticker,
      sleeve: f.sleeve,
      shares: Number(f.shares),
      costUsd: Number(f.cost),
      date: f.date,
      source: f.source,
      note: override ? `override — ${override}` : undefined,
    });
    if (!res.ok) return setErr(res.why);
    setWarnings(null);
    setErr(null);
    setF({ ...f, ticker: "", shares: "", cost: "" });
    onDone(`Recorded ${f.shares} ${f.ticker} for ${usd(Number(f.cost))} on ${f.date}${override ? " — as an override" : ""}.`);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <input
          aria-label="Ticker"
          value={f.ticker}
          onChange={(e) => {
            const t = e.target.value.toUpperCase().trim();
            const d = dossierFor(t);
            setF({ ...f, ticker: t, sleeve: d?.sleeve ?? f.sleeve });
            setWarnings(null);
          }}
          placeholder="Ticker"
          className={`w-20 ${INPUT}`}
        />
        <select aria-label="Sleeve" value={f.sleeve} onChange={(e) => setF({ ...f, sleeve: e.target.value as Sleeve })} className={INPUT}>
          <option value="ballast">ballast</option>
          <option value="compounder">compounder</option>
          <option value="drypowder">dry powder</option>
        </select>
        <input aria-label="Shares" value={f.shares} onChange={(e) => setF({ ...f, shares: e.target.value })} inputMode="decimal" placeholder="Shares" className={`w-20 ${INPUT}`} />
        <input aria-label="Total paid" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} inputMode="decimal" placeholder="Total $ paid" className={`w-24 ${INPUT}`} />
        <input aria-label="Trade date" type="date" value={f.date} max={etToday()} onChange={(e) => setF({ ...f, date: e.target.value })} className={INPUT} />
        <select aria-label="Paid with" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value as BuySource })} className={INPUT}>
          <option value="sweep">swept cash</option>
          <option value="other">new money</option>
        </select>
        <button
          type="button"
          className={BUTTON}
          onClick={() => {
            const c = check();
            if (!c.ok) return setErr(c.warn[0]);
            setErr(null);
            if (c.warn.length) return setWarnings(c.warn);
            write(null);
          }}
        >
          Record buy
        </button>
      </div>
      {err && <Note tone="down">{err}</Note>}
      {warnings && (
        <div className="rounded border border-[color-mix(in_oklab,var(--color-warn)_45%,transparent)] p-2">
          {warnings.map((w) => (
            <p key={w} className="flex gap-1.5 text-[11px] leading-relaxed text-[var(--color-warn)]">
              <TriangleAlert size={12} className="mt-0.5 shrink-0" />
              {w}
            </p>
          ))}
          <div className="mt-1.5 flex gap-2">
            <button type="button" className={BUTTON} onClick={() => write(check().override)}>
              I already bought it — record it
            </button>
            <button type="button" className={BUTTON} onClick={() => setWarnings(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SellForm({
  ledger,
  held,
  onDone,
}: {
  ledger: LedgerRead;
  held: { ticker: string; shares: number }[];
  onDone: (m: string) => void;
}) {
  const [ticker, setTicker] = useState(held[0]?.ticker ?? "");
  const [shares, setShares] = useState("");
  const [proceeds, setProceeds] = useState("");
  const [date, setDate] = useState(etToday());
  const [preview, setPreview] = useState<SaleRead | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!held.length) return <Note>Nothing held to sell.</Note>;
  const max = held.find((h) => h.ticker === ticker)?.shares ?? 0;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <select aria-label="Ticker" value={ticker} onChange={(e) => { setTicker(e.target.value); setPreview(null); }} className={INPUT}>
          {held.map((h) => (
            <option key={h.ticker} value={h.ticker}>
              {h.ticker}
            </option>
          ))}
        </select>
        <input aria-label="Shares sold" value={shares} onChange={(e) => { setShares(e.target.value); setPreview(null); }} inputMode="decimal" placeholder={`≤ ${max.toFixed(4)}`} className={`w-24 ${INPUT}`} />
        <button type="button" className={`${LINK} text-[11px]`} onClick={() => { setShares(String(max)); setPreview(null); }}>
          all
        </button>
        <input aria-label="Total received" value={proceeds} onChange={(e) => { setProceeds(e.target.value); setPreview(null); }} inputMode="decimal" placeholder="Total $ received" className={`w-28 ${INPUT}`} />
        <input aria-label="Trade date" type="date" value={date} max={etToday()} onChange={(e) => { setDate(e.target.value); setPreview(null); }} className={INPUT} />
        <button
          type="button"
          className={BUTTON}
          onClick={() => {
            if (date > etToday()) return setErr("Trade date must be today or earlier.");
            const p = previewSale(ledger, { ticker, shares: Number(shares), proceedsUsd: Number(proceeds), date });
            if (!p.ok) {
              setPreview(null);
              return setErr(p.why);
            }
            setErr(null);
            setPreview(p.sale);
          }}
        >
          Preview sale
        </button>
      </div>
      {err && <Note tone="down">{err}</Note>}
      {preview && (
        <div className="rounded border border-[var(--color-border)] p-2">
          <Note>
            Realizes <span className={preview.gainUsd < 0 ? "text-[var(--color-down)]" : "text-[var(--color-fg)]"}>{signed(preview.gainUsd)}</span>{" "}
            — short-term {signed(preview.stGainUsd)} (taxed as income), long-term {signed(preview.ltGainUsd)}. Relieves{" "}
            {preview.relief.map((r) => `${r.shares.toFixed(4)} sh from ${r.buyDate}${r.longTerm ? " (LT)" : " (ST)"}`).join(", ")}.
          </Note>
          {preview.wash && <Note tone="warn">{preview.wash.line}</Note>}
          {preview.relief.some((r) => !r.longTerm) && preview.gainUsd > 0 && (
            <Note tone="warn">
              Part of this gain is short-term. This book's whole advantage is that it never has to sell — the next sweep can
              correct a weight without realising anything.
            </Note>
          )}
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              className={BUTTON}
              onClick={() => {
                const res = recordSell({ ticker, shares: Number(shares), proceedsUsd: Number(proceeds), date });
                if (!res.ok) return setErr(res.why);
                setPreview(null);
                setShares("");
                setProceeds("");
                onDone(`Recorded the sale: ${shares} ${ticker} for ${usd(Number(proceeds))}.`);
              }}
            >
              Record sale
            </button>
            <button type="button" className={BUTTON} onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DividendForm({ held, onDone }: { held: { ticker: string; sleeve: Sleeve }[]; onDone: (m: string) => void }) {
  const [ticker, setTicker] = useState(held[0]?.ticker ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(etToday());
  const [reinvested, setReinvested] = useState(true);
  const [shares, setShares] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!held.length) return <Note>Nothing held pays a dividend yet.</Note>;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <select aria-label="Ticker" value={ticker} onChange={(e) => setTicker(e.target.value)} className={INPUT}>
          {held.map((h) => (
            <option key={h.ticker} value={h.ticker}>
              {h.ticker}
            </option>
          ))}
        </select>
        <input aria-label="Dividend amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="$ paid" className={`w-20 ${INPUT}`} />
        <input aria-label="Pay date" type="date" value={date} max={etToday()} onChange={(e) => setDate(e.target.value)} className={INPUT} />
        <label className="flex items-center gap-1 text-[11px] text-[var(--color-muted)]">
          <input type="checkbox" checked={reinvested} onChange={(e) => setReinvested(e.target.checked)} />
          reinvested
        </label>
        {reinvested && (
          <input aria-label="Shares bought" value={shares} onChange={(e) => setShares(e.target.value)} inputMode="decimal" placeholder="shares bought" className={`w-24 ${INPUT}`} />
        )}
        <button
          type="button"
          className={BUTTON}
          onClick={() => {
            const amt = Number(amount);
            if (!(amt > 0)) return setErr("The dollar amount paid.");
            if (!isDate(date) || date > etToday()) return setErr("Pay date must be today or earlier.");
            const sleeve = held.find((h) => h.ticker === ticker)?.sleeve ?? "ballast";
            const res = recordDividend({ ticker, amountUsd: amt, date, reinvested, shares: Number(shares) || undefined, sleeve });
            if (!res.ok) return setErr(res.why);
            setErr(null);
            setAmount("");
            setShares("");
            onDone(res.why === "saved" ? `Dividend ${usd(amt)} on ${ticker} recorded${reinvested ? " with its reinvested lot" : ""}.` : res.why);
          }}
        >
          Record dividend
        </button>
      </div>
      {err && <Note tone="down">{err}</Note>}
      <Note>
        A reinvested dividend is a BUY: its own lot, its own one-year clock, and inside the 30-day window of any loss sale of
        the same fund.
      </Note>
    </div>
  );
}

function Activity({ ledger, onWrite }: { ledger: LedgerRead; onWrite: () => void }) {
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const rows = ledger.entries.filter((e) => e.kind !== "sweep" && e.kind !== "void").slice(-12).reverse();
  if (!rows.length && !ledger.problems.length) return null;
  const label = (e: (typeof rows)[number]) => {
    switch (e.kind) {
      case "buy":
        return `buy ${e.shares} ${e.ticker} ${usd(e.costUsd)} · ${e.source}${e.note?.startsWith("override") ? " · override" : ""}`;
      case "sell":
        return `sell ${e.shares} ${e.ticker} ${usd(e.proceedsUsd)}`;
      case "dividend":
        return `dividend ${e.ticker} ${usd(e.amountUsd)}${e.reinvested ? " · reinvested" : ""}`;
      default:
        return "";
    }
  };
  return (
    <details className="mt-3 border-t border-[var(--color-border)] pt-2">
      <summary className="cursor-pointer text-[11px] text-[var(--color-muted)]">Recent entries ({rows.length})</summary>
      <ul className="mt-1 space-y-0.5 text-[11px] tabular-nums">
        {rows.map((e) => {
          const v = ledger.voided.get(e.id);
          return (
            <li key={e.id} className="flex flex-wrap justify-between gap-2">
              <span className={v ? "text-[var(--color-muted)] line-through" : ""}>
                {e.date} · {label(e)}
              </span>
              {v ? (
                <span className="text-[10px] text-[var(--color-muted)]">voided — {v.reason}</span>
              ) : (
                <button type="button" className="text-[10px] text-[var(--color-muted)] underline underline-offset-2" onClick={() => { setVoiding(e.id); setReason(""); }}>
                  void
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {voiding && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={`min-w-0 flex-1 ${INPUT}`} placeholder="why this entry is wrong" />
          <button
            type="button"
            className={BUTTON}
            disabled={reason.trim().length < 4}
            onClick={() => {
              const res = voidEntry(voiding, reason);
              setMsg(res.ok ? "Voided — it stays visible, struck through." : res.why);
              if (res.ok) {
                setVoiding(null);
                onWrite();
              }
            }}
          >
            Void
          </button>
          <button type="button" className={BUTTON} onClick={() => setVoiding(null)}>
            Cancel
          </button>
        </div>
      )}
      {msg && <Note>{msg}</Note>}
      {ledger.problems.map((p) => (
        <Note key={p} tone="warn">
          {p}
        </Note>
      ))}
    </details>
  );
}

