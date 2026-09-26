/**
 * The live TAKE census — what the sequence actually says on the poll, as
 * opposed to what it says on a closed 15m bar.
 *
 * The panel deliberately shows the PRE-REGISTERED thresholds next to the
 * result. Seeing "2.0/week decides it" beside "0.3/week so far" is what stops
 * the number being renegotiated on the day it arrives, which is the entire
 * reason `take-census.ts` fixed them in advance.
 *
 * Below the sample floor it shows how much is still needed and NO rate-derived
 * verdict. That will be its state for the first fortnight, and that is correct.
 */

import { useEffect, useMemo, useState } from "react";
import { useShadowBook } from "@/lib/trading/shadow-store";
import {
  census,
  loadCensus,
  PRE_REGISTERED,
  type Census,
} from "@/lib/trading/take-census";

export function TakeCensusPanel({ shadowExpR: given }: { shadowExpR?: number | null }) {
  // The pre-registered safeguard (`requireShadowPositive`) needs the shadow
  // book's expectancy on the refused NY AM cards, chase leg. Nothing ever
  // passed it, so a "the clock, not the gate" verdict could print while the
  // refused cards lost money. Computed here from the same shadow store the
  // gate scorecard reads, unless a caller supplies its own.
  const { live, replay } = useShadowBook();
  const derived = useMemo(() => {
    const rs = [...replay, ...live]
      .filter((t) => t.killzone === "ny_am" && t.leg === "chase" && (t.status === "won" || t.status === "lost" || t.status === "scratch"))
      .map((t) => t.r)
      .filter((r): r is number => typeof r === "number" && Number.isFinite(r));
    return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  }, [live, replay]);
  const shadowExpR = given ?? derived;
  const [tick, setTick] = useState(0);

  // Re-read on a slow timer rather than on every desk poll: this is a
  // fortnight-scale measurement and repainting it every 20s would suggest it
  // changes meaningfully at that rate.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const c: Census = useMemo(
    () => census(loadCensus(), shadowExpR ?? null),
    [tick, shadowExpR],
  );

  const pct = Math.min(100, Math.round((c.polls / PRE_REGISTERED.minPolls) * 100));
  const decided = c.verdict !== "insufficient";

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
          Live TAKE census · pre-registered {PRE_REGISTERED.registeredAt}
        </p>
        <p className="font-mono text-[10px] text-[var(--color-subtle)]">
          {c.polls.toLocaleString()} clean · {c.sessions} session
          {c.sessions === 1 ? "" : "s"}
        </p>
      </div>

      {/* Sample progress. Honest about being incomplete rather than hiding. */}
      {!decided && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
          <div
            className="h-full rounded-full bg-[var(--color-accent)]"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* STARVING — the failure that looks like patience. Loud, and above the
          sample bar, because a tidy zero reads as "not yet" when it means
          "never, until the gateway is up". */}
      {c.starving && c.starvingLine && (
        <p className="rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-warn)_60%,transparent)] bg-[color-mix(in_oklab,var(--color-warn)_12%,transparent)] px-2 py-1.5 text-[10px] font-medium leading-snug text-[var(--color-warn)]">
          {c.starvingLine}
        </p>
      )}

      <p className="text-[11px] leading-snug text-[var(--color-fg)]">{c.line}</p>

      {/* The thresholds, always visible, so the result cannot be renegotiated. */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[9px] text-[var(--color-subtle)]">
        <span>
          ≥{PRE_REGISTERED.clockNotGateTakesPerWeek}/wk → wrong clock
        </span>
        <span>≤{PRE_REGISTERED.gateTooTightTakesPerWeek}/wk → gate tight</span>
        <span>between → undecided</span>
        <span>lag &gt;{PRE_REGISTERED.maxLagSec}s excluded</span>
      </div>

      {c.byLayer.length > 0 && (
        <div>
          <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
            What is blocking
          </p>
          <ul className="mt-0.5 flex flex-wrap gap-1">
            {c.byLayer.slice(0, 6).map((l) => (
              <li
                key={l.layer}
                className={
                  l.binding
                    ? "rounded-full border border-[color-mix(in_oklab,var(--color-warn)_55%,transparent)] px-1.5 py-[1px] font-mono text-[9px] text-[var(--color-warn)]"
                    : "rounded-full border border-[var(--color-border)] px-1.5 py-[1px] font-mono text-[9px] text-[var(--color-subtle)]"
                }
              >
                {l.layer} {Math.round(l.share * 100)}%
              </li>
            ))}
          </ul>
        </div>
      )}

      <p
        className={
          decided
            ? "rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-accent)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-accent)_8%,transparent)] px-2 py-1.5 text-[10px] leading-snug text-[var(--color-fg)]"
            : "text-[10px] leading-snug text-[var(--color-subtle)]"
        }
      >
        {c.conclusion}
      </p>

      {c.medianLagSec != null && (
        <p className="font-mono text-[9px] text-[var(--color-subtle)]">
          median lag {c.medianLagSec}s
          {c.excludedStale > 0 && ` · ${c.excludedStale} stale excluded`}
        </p>
      )}
    </div>
  );
}
