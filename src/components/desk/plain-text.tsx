/**
 * Plain-English rendering: `<Plain>` for any desk sentence, `<PlainToggle>`
 * for the switch. See src/lib/ui/plain-english.ts for the glossary and why.
 */
import { useSyncExternalStore, type ReactNode } from "react";
import { BookA } from "lucide-react";
import {
  GLOSSARY,
  getPlainEnglish,
  plainify,
  setPlainEnglish,
  splitTerms,
  subscribePlainEnglish,
} from "@/lib/ui/plain-english";
import { cn } from "@/lib/utils";

/** The persisted preference. Server render and first paint are always "off" (no hydration mismatch). */
export function usePlainEnglish(): boolean {
  return useSyncExternalStore(subscribePlainEnglish, getPlainEnglish, () => false);
}

/** A desk sentence: plain words when the toggle is on, jargon with tooltips when it is off. */
export function Plain({
  children,
  className,
}: {
  children: string | null | undefined;
  className?: string;
}): ReactNode {
  const on = usePlainEnglish();
  if (!children) return null;
  if (on) return <span className={className}>{plainify(children)}</span>;
  return (
    <span className={className}>
      {splitTerms(children).map((p, i) =>
        p.term ? (
          <abbr
            key={i}
            title={`${GLOSSARY[p.term]!.plain} — ${GLOSSARY[p.term]!.tip}`}
            className="cursor-help no-underline decoration-dotted underline-offset-2 hover:underline"
          >
            {p.text}
          </abbr>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

/** String form, for title attributes and SVG <title>. */
export function usePlainify(): (s: string) => string {
  const on = usePlainEnglish();
  return on ? plainify : (s: string) => s;
}

export function PlainToggle({ className }: { className?: string }) {
  const on = usePlainEnglish();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => setPlainEnglish(!on)}
      title={
        on
          ? "Plain English is on — click for the desk's shorthand (OTE, BSL, CE…)"
          : "Swap the desk's shorthand (OTE, BSL, CE, SMT…) for plain words"
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors",
        on
          ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-bg)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-primary)_25%,transparent)]"
          : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]",
        className,
      )}
    >
      <BookA className="h-3.5 w-3.5" aria-hidden />
      Plain English{on ? " · ON" : ""}
      <span
        aria-hidden
        className={cn(
          "relative ml-0.5 inline-block h-3.5 w-6 rounded-full transition-colors",
          on ? "bg-[var(--color-bg)]" : "bg-[var(--color-surface-3)]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-2.5 w-2.5 rounded-full transition-[left]",
            on ? "bg-[var(--color-primary)]" : "bg-[var(--color-fg)]",
            on ? "left-3" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}
