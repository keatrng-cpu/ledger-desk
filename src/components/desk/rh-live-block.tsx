/**
 * RhLiveBlock — the live Robinhood breakdown surfaced on the Invest and Predict
 * tabs, reading /api/rh/account (the same live broker read the chip polls).
 *
 *   variant="invest"  — equity value, buying power, cash, and live equity
 *                        holdings (symbol · qty · avg cost).
 *   variant="predict" — event-contract (prediction market) value + the cash and
 *                        buying power available to deploy.
 *
 * Display only. Reads the broker, never trades. Empty / not-connected is a
 * graceful muted line, not an error.
 */
import { useEffect, useState } from "react";
import { Landmark, Percent, RefreshCw } from "lucide-react";

interface Breakdown {
  total: number | null; cash: number | null; options: number | null; equity: number | null;
  predictions: number | null; crypto: number | null; futures: number | null;
}
interface Account { optionsBuyingPowerUsd?: number; cashUsd?: number }
interface EquityPos { symbol: string; quantity: number; avgCost: number | null }
interface LiveRead {
  ok: boolean; linked: boolean; account?: Account | null; breakdown?: Breakdown;
  dayRealized?: number | null; equityPositions?: EquityPos[]; asOf?: string;
}

const usd = (n: number | null | undefined, dp = 2) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toFixed(dp)}`);
const REFRESH_MS = 30_000;

export function RhLiveBlock({ variant }: { variant: "invest" | "predict" }) {
  const [live, setLive] = useState<LiveRead | null>(null);
  const [busy, setBusy] = useState(false);

  const pull = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/rh/account", { headers: { accept: "application/json" } });
      setLive((await res.json()) as LiveRead);
    } catch {
      /* keep last */
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void pull();
    const id = setInterval(() => void pull(), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const linked = live?.linked === true;
  const b = live?.breakdown;
  const bp = live?.account?.optionsBuyingPowerUsd ?? null;
  const cash = live?.account?.cashUsd ?? b?.cash ?? null;
  const Icon = variant === "invest" ? Landmark : Percent;
  const title = variant === "invest" ? "Robinhood · live holdings" : "Robinhood · prediction markets";

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2">
      <header className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-[var(--color-primary)]" aria-hidden />
          <h3 className="text-[12px] font-semibold text-[var(--color-fg)]">{title}</h3>
          {linked ? (
            <span className="rounded bg-[color-mix(in_oklab,var(--color-primary)_15%,transparent)] px-1 text-[9px] font-bold uppercase tracking-wide text-[var(--color-primary)]">live</span>
          ) : (
            <span className="text-[10px] text-[var(--color-muted)]">not connected</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void pull()}
          disabled={busy}
          aria-label="Refresh Robinhood read"
          className="rounded-full p-1 text-[var(--color-muted)] hover:text-[var(--color-fg)] disabled:opacity-50"
        >
          <RefreshCw size={12} className={busy ? "animate-spin" : ""} aria-hidden />
        </button>
      </header>

      {!linked ? (
        <p className="text-[11px] text-[var(--color-muted)]">
          Connect Robinhood on the desk header to stream this account here.
        </p>
      ) : variant === "invest" ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            <Metric label="Equity value" value={usd(b?.equity)} />
            <Metric label="Buying power" value={usd(bp)} />
            <Metric label="Cash" value={usd(cash)} />
            {b?.crypto != null && b.crypto > 0 && <Metric label="Crypto" value={usd(b.crypto)} />}
          </div>
          {live?.equityPositions && live.equityPositions.length > 0 ? (
            <ul className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]">
              {live.equityPositions.map((p) => (
                <li key={p.symbol} className="flex items-center justify-between px-2 py-1 text-[11px]">
                  <span className="font-mono font-semibold text-[var(--color-fg)]">{p.symbol}</span>
                  <span className="text-[var(--color-muted)]">
                    {p.quantity} sh{p.avgCost != null ? ` · avg ${usd(p.avgCost)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-[var(--color-muted)]">No equity positions open — the account is cash/options only right now.</p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            <Metric label="Event contracts" value={usd(b?.predictions)} />
            <Metric label="Cash to deploy" value={usd(cash)} />
            <Metric label="Buying power" value={usd(bp)} />
          </div>
          {!(b?.predictions && b.predictions > 0) && (
            <p className="text-[11px] text-[var(--color-muted)]">No open prediction-market positions. Buying power above is available to deploy.</p>
          )}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-[var(--color-muted)]">
      {label} <span className="font-medium tabular-nums text-[var(--color-fg)]">{value}</span>
    </span>
  );
}
