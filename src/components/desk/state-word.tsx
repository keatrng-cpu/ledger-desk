/** The display word for an engine verdict (src/lib/ui/state-words.ts), as a chip. */
import { displayWord, WORD_COLOR, wordTitle } from "@/lib/ui/state-words";
import { cn } from "@/lib/utils";

export function StateWord({
  raw,
  suffix,
  className,
}: {
  raw: string | null | undefined;
  suffix?: string;
  className?: string;
}) {
  const w = displayWord(raw);
  const c = WORD_COLOR[w];
  return (
    <span
      title={wordTitle(raw)}
      data-raw={raw ?? ""}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-bold tracking-wide",
        className,
      )}
      style={{ color: c, borderColor: `color-mix(in oklab, ${c} 55%, var(--color-border))` }}
    >
      {w}
      {suffix ? <span className="ml-1 font-normal opacity-80">{suffix}</span> : null}
    </span>
  );
}
