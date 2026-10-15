/**
 * Two-sided ladder on the desk card (Keaton 2026-10-15): BOTH conditions, always — bull column and bear column,
 * per book. Entries with their real stops (✗ when price already crossed it), the full target ladder in distance
 * order with calibrated odds (n shown; "n/a" when the sample is too small), and the 1h body-close flip line.
 * DISPLAY-ONLY: renders desk.twoSided as-is; nothing here gates or scores a trade.
 */
import type { DeskPayload } from "@/lib/trading/build-desk";
import type { LadderBook, LadderSide, Prob } from "@/lib/smc/seq/ladder";

const pct = (p: Prob) => (p.p == null ? <span title={p.note ?? `n=${p.n}`} className="text-[var(--color-subtle)]">n/a</span> : <span title={`${p.key} · n=${p.n}`}>{Math.round(p.p * 100)}%</span>);

function Side({ s, atr }: { s: LadderSide; atr: number }) {
  const bull = s.side === "long";
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <div className={`text-[11px] font-semibold ${bull ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
        {bull ? "BULL ▲" : "BEAR ▼"} <span className="font-normal text-[var(--color-muted)]">{s.bias}{s.prior.p != null ? ` · prior ${Math.round(s.prior.p * 100)}%` : ""}</span>
      </div>
      <div className="text-[10px] text-[var(--color-muted)]">Entries</div>
      {s.entries.length === 0 && <div className="text-[10px] text-[var(--color-subtle)]">no POI within 4 ATR</div>}
      {s.entries.map((e) => (
        <div key={`${e.kind}${e.entry}`} className={`tabular text-[10px] ${e.valid ? "" : "line-through opacity-60"}`} title={e.invalidWhy ?? e.stopWhy}>
          {e.kind} <span className="text-[var(--color-muted)]">{e.tf}</span> {e.entry} · SL {e.stop} · fill {pct(e.pFill)} · T1 {e.t1R ?? "–"}R win {pct(e.pWin)}
          {!e.valid && <span className="ml-1 text-[var(--color-down)]">✗ {e.invalidWhy}</span>}
        </div>
      ))}
      <div className="text-[10px] text-[var(--color-muted)]">Targets (ATR1h {atr})</div>
      {s.targets.map((t, k) => (
        <div key={`${t.touch}${k}`} className="tabular text-[10px]" title={t.names.join(" · ")}>
          T{k + 1} {t.lo === t.hi ? t.touch : `${t.lo}–${t.hi}`} <span className="text-[var(--color-muted)]">{t.distAtr}A · c{t.confluence} · #{t.rank} · {t.names.slice(0, 2).join(" · ")}</span> · sess {pct(t.pSession)} · 5d {pct(t.p5d)}
        </div>
      ))}
    </div>
  );
}

function Book({ b }: { b: LadderBook }) {
  return (
    <div className="space-y-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-2">
      <div className="text-[11px] font-semibold">
        {b.symbol} <span className="tabular font-normal text-[var(--color-muted)]">{b.price}</span>
        {b.flip && (
          <span className="ml-2 text-[10px] font-normal" title={b.flip.why}>
            flip ({b.flip.tf}): <span className="tabular font-semibold">{b.flip.level}</span> {b.flip.from} → {b.flip.to}
          </span>
        )}
      </div>
      {b.ltfFlip && (
        <div className={`text-[10px] font-semibold ${b.ltfFlip.side === "long" ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`} title={b.ltfFlip.why.join(" · ")}>
          LTF flip {b.ltfFlip.stage}: {b.ltfFlip.side === "long" ? "BULL" : "BEAR"} promoted, {b.ltfFlip.demotes} demoted
          {b.ltfFlip.entry != null && <span className="tabular font-normal"> · entry {b.ltfFlip.entry} · SL {b.ltfFlip.stop} · T1 {b.ltfFlip.targets[0]?.touch ?? "–"}</span>}
        </div>
      )}
      {b.noUpgrade.map((n) => (
        <div key={n.side} className="text-[10px] text-[var(--color-muted)]">No upgrade ({n.side}): {n.pool} just swept</div>
      ))}
      {b.cardCheck && !b.cardCheck.valid && (
        <div className="text-[10px] font-semibold text-[var(--color-down)]">Card plan invalid: {b.cardCheck.why}</div>
      )}
      <div className="flex gap-3">
        <Side s={b.bull} atr={b.atr1h} />
        <Side s={b.bear} atr={b.atr1h} />
      </div>
    </div>
  );
}

export function TwoSidedLadderPanel({ desk }: { desk: DeskPayload }) {
  const w = desk.twoSided;
  if (!w) return null;
  const books = Object.values(w.books);
  if (!books.length) return null;
  return (
    <section className="space-y-2" aria-label="Two-sided ladder">
      <div className="text-[10px] text-[var(--color-subtle)]">Both sides · display only · odds: {w.method}</div>
      {books.map((b) => <Book key={b.symbol} b={b} />)}
    </section>
  );
}
