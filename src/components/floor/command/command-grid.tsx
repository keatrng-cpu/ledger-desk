/**
 * Command cards — responsive grid; collapses to a horizontal scroller on mobile.
 */
import { COMMAND_CARDS, type CommandTabId } from "./types";
import type { CardRead } from "./types";
import { CommandCard } from "./command-card";

export function CommandGrid({
  reads,
  active,
  onOpen,
}: {
  reads: Record<CommandTabId, CardRead>;
  active: CommandTabId | null;
  onOpen: (id: CommandTabId) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        Command center
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-3 sm:overflow-visible lg:grid-cols-5 xl:grid-cols-9">
        {COMMAND_CARDS.map((def) => (
          <CommandCard
            key={def.id}
            def={def}
            read={reads[def.id]}
            active={active === def.id}
            onOpen={() => onOpen(def.id)}
          />
        ))}
      </div>
    </div>
  );
}
