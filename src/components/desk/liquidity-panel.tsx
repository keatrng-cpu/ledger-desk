import { Droplets, Layers } from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { cn } from "@/lib/utils";

export function LiquidityPanel({ desk }: { desk: DeskPayload }) {
  const sides = [
    { read: desk.bias.left, levels: desk.levels[0] },
    { read: desk.bias.right, levels: desk.levels[1] },
  ];

  return (
    <section>
      <header className="mb-3">
        <h2 className="text-sm font-semibold tracking-tight text-[var(--color-fg)]">
          4 · Liquidity & key levels
        </h2>
        <p className="text-xs text-[var(--color-subtle)]">
          Equal highs/lows, session extremes, PDH/PDL, dealing range — mark these on the dual charts
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {sides.map(({ read, levels }) => (
          <div
            key={read.symbol}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="font-mono text-sm font-semibold">{read.symbol}</p>
              {read.dealing && (
                <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  {read.dealing.zone} ·{" "}
                  {(read.dealing.position * 100).toFixed(0)}% of range
                </span>
              )}
            </div>

            <div className="mb-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-subtle)]">
                <Droplets className="h-3 w-3 text-[var(--color-primary)]" />
                Liquidity pools
              </p>
              <ul className="space-y-1">
                {read.liquidity.length === 0 && (
                  <li className="text-xs text-[var(--color-subtle)]">
                    No clustered EQH/EQL yet
                  </li>
                )}
                {read.liquidity.map((l) => (
                  <li
                    key={`${l.label}-${l.price}`}
                    className="flex items-center justify-between gap-2 font-mono text-xs"
                  >
                    <span
                      className={cn(
                        l.side === "buyside"
                          ? "text-[var(--color-down)]"
                          : "text-[var(--color-up)]",
                      )}
                    >
                      {l.label}
                      {l.swept ? " · SWEPT" : ""}
                    </span>
                    <span className="tabular text-[var(--color-fg)]">
                      {l.price.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-subtle)]">
                <Layers className="h-3 w-3 text-[var(--color-primary)]" />
                Ladder
              </p>
              <div className="max-h-44 overflow-auto">
                <table className="w-full text-left text-xs font-mono">
                  <tbody>
                    {(levels?.items ?? []).map((it) => (
                      <tr
                        key={`${it.name}-${it.price}`}
                        className="border-t border-[var(--color-border)]"
                      >
                        <td className="py-1 text-[var(--color-subtle)]">
                          {it.name}
                        </td>
                        <td className="py-1 text-right tabular text-[var(--color-fg)]">
                          {it.price.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
