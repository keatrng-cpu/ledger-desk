/**
 * Label | price | R. The Rule 1 ticket uses mode="table".
 * The desk card ladder stays PriceLadder.
 */
import { cn } from "@/lib/utils";
import type { LevelRow } from "./shadow-view";

export function LevelsBlock({ mode = "table", rows }: { mode?: "table"; rows: LevelRow[] }) {
  if (mode !== "table" || rows.length === 0) return null;
  return (
    <table className="mt-1.5 w-full border-collapse font-mono text-[13px]">
      <thead className="sr-only">
        <tr>
          <th>Label</th>
          <th>Price</th>
          <th>R</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <th
              scope="row"
              className={cn(
                "py-0.5 pr-3 text-left text-[12px] font-bold uppercase tracking-wide",
                row.tone === "stop" && "text-[var(--level-stop)]",
                row.tone === "entry" && "text-[var(--level-entry)]",
                row.tone === "target" && "text-[var(--level-target)]",
                row.tone === "target-soft" && "font-medium text-[var(--level-target)] opacity-75",
                row.tone === "plain" && "text-[var(--color-subtle)]",
              )}
            >
              {row.label}
            </th>
            <td
              className={cn(
                "py-0.5 text-right text-[15px] font-semibold tabular-nums",
                row.tone === "stop" && "text-[var(--level-stop)]",
                row.tone === "entry" && "text-[var(--level-entry)]",
                row.tone === "target" && "font-bold text-[var(--level-target)]",
                row.tone === "target-soft" && "font-medium text-[var(--level-target)] opacity-75",
                row.tone === "plain" && "text-[var(--color-fg)]",
              )}
            >
              {row.price}
            </td>
            <td className="py-0.5 pl-3 text-right text-[12px] font-medium tabular-nums text-[var(--color-muted)]">{row.r ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
