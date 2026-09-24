/**
 * Do the desk's own numbers mean what they say?
 *
 * Every figure here is measured against what actually happened on the shadow
 * book — the refusals, paper-traded both ways — so the desk is grading its own
 * output rather than asserting it. Nothing on this panel is a signal and
 * nothing gates: it says which of the numbers already on screen can be trusted
 * to size and target off, and which are decoration.
 *
 * The one rule that shapes the whole layout: EXPECTANCY LEADS, hit rate
 * follows. A hit rate with a different denominator or a different entry price
 * is not comparable to another hit rate, and reading them side by side is how
 * "chasing is three times better than resting a limit" gets believed.
 */

import { useMemo } from "react";
import { useShadowBook } from "@/lib/trading/shadow-store";
import {
  reliability,
  expectancy,
  conditional,
  compare,
  type Sample,
} from "@/lib/trading/calibration";

/** R from this leg's OWN entry to its OWN target over its OWN risk. */
function rOf(s: {
  status?: string;
  entry?: number | null;
  t1?: number | null;
  riskPts?: number | null;
  side?: string;
}): number {
  if (s.status === "unfilled") return 0;
  if (s.status === "lost") return -1;
  if (s.status !== "won") return 0;
  const { entry, t1, riskPts } = s;
  if (!Number.isFinite(entry ?? NaN) || !Number.isFinite(t1 ?? NaN) || !(riskPts && riskPts > 0)) {
    return 1;
  }
  const move = s.side === "short" ? entry! - t1! : t1! - entry!;
  return move / riskPts;
}

export function CalibrationPanel() {
  const { live, replay } = useShadowBook();

  const read = useMemo(() => {
    const rows = [...replay, ...live].filter(
      (r) => r.status && r.status !== "open",
    ) as unknown as Array<Record<string, unknown>>;

    const toSample = (r: Record<string, unknown>): Sample & Record<string, unknown> => ({
      p: Number(r.confluence),
      hit: r.t1Hit === true,
      filled: r.status !== "unfilled",
      r: rOf(r as never),
      ...r,
    });

    const samples = rows.filter((r) => Number.isFinite(Number(r.confluence))).map(toSample);
    const legSamples = (leg: string) => samples.filter((s) => s.leg === leg);

    return {
      n: samples.length,
      rel: reliability(samples),
      byKillzone: conditional(samples, (s) => String((s as never as { killzone: string }).killzone ?? "—")),
      byReason: conditional(samples, (s) => String((s as never as { reasonId: string }).reasonId ?? "—")),
      bySide: conditional(samples, (s) => String((s as never as { side: string }).side ?? "—")),
      legs: compare(
        { label: "rest at CE", samples: legSamples("limit") },
        { label: "chase", samples: legSamples("chase") },
      ),
      limit: expectancy(legSamples("limit")),
      chase: expectancy(legSamples("chase")),
    };
  }, [live, replay]);

  if (read.n === 0) {
    return (
      <p className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3 text-[11px] leading-snug text-[var(--color-subtle)]">
        No resolved shadow trades yet. Every refusal the sequence makes opens a
        limit leg and a chase leg; once they resolve, this grades the desk's own
        numbers against what happened.
      </p>
    );
  }

  const { rel } = read;
  const bad = rel.verdict === "flat" || rel.verdict === "inverted";

  const Slices = ({ title, rows }: { title: string; rows: typeof read.byKillzone }) => (
    <div>
      <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">{title}</p>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {rows.map((s) => (
          <li key={s.key} className="text-[10px] leading-snug">
            <span className="font-mono text-[var(--color-fg)]">{s.key}</span>
            <span className="text-[var(--color-subtle)]">
              {" "}
              n={s.n}
              {s.fillRate != null && s.fillRate < 1 && ` · filled ${Math.round(s.fillRate * 100)}%`}
              {" · "}
              {s.expectancy.meanR >= 0 ? "+" : ""}
              {s.expectancy.meanR.toFixed(3)}R
              {s.expectancy.significant ? "" : " (ns)"}
              {s.enough && s.ci
                ? ` · T1 ${Math.round((s.rate ?? 0) * 100)}% [${Math.round(s.ci[0] * 100)}–${Math.round(s.ci[1] * 100)}]`
                : " · below the read floor"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="flex flex-col gap-2.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
      {/* ── Is the headline number a probability at all? ─────────────────── */}
      <div>
        <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
          Engine score vs what happened · n={rel.n}
        </p>
        <p
          className={
            bad
              ? "mt-1 text-[11px] font-medium leading-snug text-[var(--color-warn)]"
              : "mt-1 text-[11px] leading-snug text-[var(--color-fg)]"
          }
        >
          {rel.line}
        </p>
        {rel.buckets.some((b) => b.observed != null) && (
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {rel.buckets
              .filter((b) => b.observed != null)
              .map((b) => (
                <li key={b.from} className="font-mono text-[9px] leading-snug">
                  <span className="text-[var(--color-subtle)]">
                    Q {b.from.toFixed(2)}–{b.to.toFixed(2)}
                  </span>
                  <span className="text-[var(--color-fg)]">
                    {"  "}n={String(b.n).padStart(3)} · T1 {Math.round((b.observed ?? 0) * 100)}%
                  </span>
                  <span className="text-[var(--color-subtle)]">
                    {" "}
                    [{Math.round((b.ci?.[0] ?? 0) * 100)}–{Math.round((b.ci?.[1] ?? 0) * 100)}] · shrunk{" "}
                    {Math.round((b.shrunk ?? 0) * 100)}%
                  </span>
                </li>
              ))}
          </ul>
        )}
      </div>

      {/* ── The entry rule, priced ───────────────────────────────────────── */}
      <div className="border-t border-[var(--color-border)] pt-2">
        <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
          The entry rule, measured
        </p>
        <p className="mt-1 text-[10px] leading-snug text-[var(--color-fg)]">{read.legs.line}</p>
        <p className="mt-0.5 text-[9px] leading-snug text-[var(--color-subtle)]">
          Hit rate is deliberately not the headline: the chase enters later, so it
          reaches the same target at a worse R. Expectancy counts an unfilled
          limit as 0R, because you do not get to keep only the fills.
        </p>
      </div>

      {/* ── How / why / when / where ─────────────────────────────────────── */}
      <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-2">
        <Slices title="When · killzone" rows={read.byKillzone} />
        <Slices title="Why · the layer that refused it" rows={read.byReason} />
        <Slices title="Where · side" rows={read.bySide} />
      </div>

      <p className="border-t border-[var(--color-border)] pt-1.5 text-[9px] leading-snug text-[var(--color-subtle)]">
        Shadow refusals only — cards the sequence turned down, not trades taken.
        "(ns)" means not distinguishable from zero. Intervals are Wilson; rates
        below the floor are withheld rather than estimated, and every bucket is
        shrunk toward the base rate in proportion to how little data it has.
      </p>
    </div>
  );
}
