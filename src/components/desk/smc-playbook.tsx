import { useMemo, useState } from "react";
import { BookOpen, GraduationCap } from "lucide-react";
import {
  CANON_RULES,
  CONFLUENCE_STACK,
  ENTRY_SKELETON,
  SCHOOLS,
  TOP_DOWN,
  type SchoolId,
  type CanonStack,
} from "@/lib/trading/smc-canon";
import { cn } from "@/lib/utils";

const SCHOOL_ORDER: SchoolId[] = [
  "ict",
  "smc",
  "tjr",
  "blake",
  "patty",
  "ronan",
];

export function SmcPlaybook({
  stack,
  compact,
}: {
  stack?: CanonStack | null;
  compact?: boolean;
}) {
  const [school, setSchool] = useState<SchoolId>("tjr");
  const s = SCHOOLS[school];
  const live = stack;

  const gradeCls = useMemo(() => {
    if (!live) return "";
    if (live.grade === "A+" || live.grade === "A")
      return "text-[var(--color-up)]";
    if (live.grade === "A-") return "text-[var(--color-warn)]";
    return "text-[var(--color-muted)]";
  }, [live]);

  return (
    <section
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]",
        compact ? "px-3 py-2.5" : "px-3 py-3 sm:px-4",
      )}
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[var(--color-primary)]">
          <GraduationCap className="h-3.5 w-3.5" />
          <p className="text-[10px] font-semibold uppercase tracking-wide">
            SMC / ICT / TJR / PB canon
          </p>
        </div>
        {live && (
          <span className={cn("font-mono text-[11px] font-bold", gradeCls)}>
            stack {live.grade} · {live.mustHits}/{live.mustNeed}
          </span>
        )}
      </header>

      {live && (
        <div className="mb-3 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-2">
          <p className="text-[12px] text-[var(--color-fg)]">{live.thesis}</p>
          <ul className="mt-1.5 grid gap-0.5 sm:grid-cols-2">
            {live.factors.map((f) => (
              <li
                key={f.id}
                className={cn(
                  "font-mono text-[10px]",
                  f.pass
                    ? "text-[var(--color-up)]"
                    : f.must
                      ? "text-[var(--color-down)]"
                      : "text-[var(--color-subtle)]",
                )}
              >
                {f.pass ? "●" : "○"} {f.label}
                {!f.must && " · opt"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!compact && (
        <>
          <div className="mb-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
              Shared skeleton
            </p>
            <ol className="space-y-0.5 text-[11px] text-[var(--color-muted)]">
              {ENTRY_SKELETON.map((line, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="font-mono text-[var(--color-primary)]">
                    {i + 1}.
                  </span>
                  {line}
                </li>
              ))}
            </ol>
          </div>

          <div className="mb-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
              Top-down
            </p>
            <ul className="space-y-0.5 text-[11px] text-[var(--color-muted)]">
              {TOP_DOWN.map((line) => (
                <li key={line}>→ {line}</li>
              ))}
            </ul>
          </div>

          <div className="mb-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
              Stack (independent — do not sum strategies)
            </p>
            <p className="text-[11px] text-[var(--color-muted)]">
              {CONFLUENCE_STACK.map((c) => c.label).join(" + ")}
            </p>
          </div>
        </>
      )}

      <div className="mb-2 flex flex-wrap gap-1">
        {SCHOOL_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSchool(id)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              school === id
                ? "border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_14%,transparent)] text-[var(--color-primary)]"
                : "border-[var(--color-border)] text-[var(--color-muted)]",
            )}
          >
            {SCHOOLS[id].name.split(" ")[0]}
          </button>
        ))}
      </div>
      <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-2">
        <p className="text-[12px] font-semibold text-[var(--color-fg)]">
          {s.name}
        </p>
        <p className="mt-0.5 text-[10px] text-[var(--color-subtle)]">
          {s.origin} · {s.style}
        </p>
        <ol className="mt-1.5 space-y-0.5 text-[11px] text-[var(--color-muted)]">
          {s.sequence.map((step, i) => (
            <li key={i}>
              <span className="font-mono text-[var(--color-primary)]">
                {i + 1}.
              </span>{" "}
              {step}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11px] text-[var(--color-fg)]">
          <span className="text-[var(--color-subtle)]">Time · </span>
          {s.timeFilter}
        </p>
        <p className="text-[11px] text-[var(--color-fg)]">
          <span className="text-[var(--color-subtle)]">Entry · </span>
          {s.entry}
        </p>
        {!compact && (
          <>
            <p className="mt-1 text-[11px] text-[var(--color-muted)]">
              Journal: {s.journal}
            </p>
            <p className="text-[11px] text-[var(--color-muted)]">
              Discretion: {s.discretion}
            </p>
          </>
        )}
      </div>

      {!compact && (
        <ul className="mt-3 space-y-0.5 text-[10px] text-[var(--color-subtle)]">
          {CANON_RULES.slice(0, 6).map((r) => (
            <li key={r} className="flex gap-1.5">
              <BookOpen className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-primary)]" />
              {r}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
