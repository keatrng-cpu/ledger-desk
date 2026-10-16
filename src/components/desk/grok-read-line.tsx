import type { DeskPayload } from "@/lib/trading/build-desk";

/** Grok SHADOW reader — informational line only (shared/grok-reader.json). Renders nothing when the flag is off. */
export function GrokReadLine({ desk }: { desk: DeskPayload | null | undefined }) {
  const reads = desk?.grokReads ?? [];
  const sug = desk?.grokSuggest ?? [];
  if (!reads.length && !sug.length) return null;
  const top = reads.slice(0, 3);
  return (
    <div className="rounded border border-dashed border-muted-foreground/30 px-2 py-1 text-xs text-muted-foreground" data-testid="grok-read-line">
      <div className="font-medium">Grok read · shadow, informational — only the watcher's fast review can act on a suggestion</div>
      {sug.slice(0, 2).map((g) => (
        <div key={g.id}>
          SUGGESTION ({g.mode}) {g.symbol} {g.side} @{g.entry} stop {g.review.stop} T1 {g.review.t1} · {g.setup} · desk review {g.review.decision} [{g.review.route}] · Trading Stand: {g.standReview}
        </div>
      ))}
      {top.map((r) => (
        <div key={r.key} className="whitespace-pre-wrap">
          {r.kind === "missed" ? "MISSED? " : ""}{r.symbol} {r.side}
          {r.staleEntry ? " · stale entry" : ""} · {r.status === "ok" ? (r.text ?? "").split("\n").slice(0, 2).join(" / ") : r.status}
          {r.suggestions[0] ? ` · ${r.suggestions[0]}` : ""}
        </div>
      ))}
    </div>
  );
}
