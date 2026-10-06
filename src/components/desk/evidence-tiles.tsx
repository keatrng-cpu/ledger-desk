import type { ReactNode } from "react";
import { EVIDENCE, evidenceHeadlines, type EvidenceBucket } from "@/lib/trading/evidence";
import { cn } from "@/lib/utils";

/**
 * The "Measured · four years" wall as stat tiles. Every number comes straight
 * from the evidence pack (src/data/evidence-pack.json) — the same buckets the
 * headline sentences are built from; the full sentences sit behind the expand.
 */

const byKey = (arr: EvidenceBucket[] | undefined, key: string) =>
  arr?.find((b) => b.key === key) ?? null;

const signedR = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}R`;

interface Row {
  label: string;
  value: number | null;
  n?: number;
  /** "r" = expectancy per card (centred bar), "pct" = 0..1 hit rate. */
  kind: "r" | "pct";
}

function MiniBar({ row, scale }: { row: Row; scale: number }) {
  const v = row.value;
  const text = v == null ? "—" : row.kind === "r" ? signedR(v) : `${(v * 100).toFixed(1)}%`;
  let bar: ReactNode = null;
  if (v != null) {
    if (row.kind === "r") {
      const w = Math.min(50, (Math.abs(v) / scale) * 50);
      bar = (
        <span
          className={cn(
            "absolute top-0 h-full rounded-sm",
            v >= 0 ? "bg-[var(--color-up)]" : "bg-[var(--color-down)]",
          )}
          style={v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
        />
      );
    } else {
      bar = (
        <span
          className="absolute left-0 top-0 h-full rounded-sm bg-[var(--color-primary)]"
          style={{ width: `${Math.min(100, v * 100)}%` }}
        />
      );
    }
  }
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className="w-14 shrink-0 truncate text-[var(--color-subtle)]" title={row.label}>
        {row.label}
      </span>
      <span className="relative h-1.5 flex-1 rounded-sm bg-[var(--color-surface-2)]">
        {row.kind === "r" && (
          <span className="absolute left-1/2 top-[-2px] h-[10px] w-px bg-[var(--color-border)]" />
        )}
        {bar}
      </span>
      <span className="w-12 shrink-0 text-right font-mono text-[var(--color-fg)]">{text}</span>
      {row.n != null && (
        <span className="w-10 shrink-0 text-right font-mono text-[9px] text-[var(--color-subtle)]">
          n {row.n}
        </span>
      )}
    </div>
  );
}

export function EvidenceTiles() {
  const base = EVIDENCE.baseline;
  const tiles: { title: string; rows: Row[] }[] = [];
  if (base?.exp != null)
    tiles.push({
      title: "Every card ≥ 0.65",
      rows: [{ label: "as coded", value: base.exp, n: base.n, kind: "r" }],
    });
  const pair = (
    title: string,
    a: [string, EvidenceBucket | null],
    b: [string, EvidenceBucket | null],
  ) => {
    if (a[1]?.exp == null || b[1]?.exp == null) return;
    tiles.push({
      title,
      rows: [
        { label: a[0], value: a[1].exp, n: a[1].n, kind: "r" },
        { label: b[0], value: b[1].exp, n: b[1].n, kind: "r" },
      ],
    });
  };
  pair(
    "Stop vs 0.5–1.5 ATR",
    ["inside", byKey(EVIDENCE.inBand, "in")],
    ["outside", byKey(EVIDENCE.inBand, "out")],
  );
  const q85 = byKey(EVIDENCE.q, "0.85+");
  const q65 = byKey(EVIDENCE.q, "0.65-0.70");
  if (q85?.dirHit != null && q65?.dirHit != null)
    tiles.push({
      title: "Q is fit, not odds · went its way",
      rows: [
        { label: "Q 0.85+", value: q85.dirHit, n: q85.dirN, kind: "pct" },
        { label: "Q .65–.70", value: q65.dirHit, n: q65.dirN, kind: "pct" },
      ],
    });
  const outEvent = byKey(EVIDENCE.event, "out-event");
  if (outEvent?.exp != null)
    tiles.push({
      title: "Tape event outside killzones",
      rows: [{ label: "out-KZ", value: outEvent.exp, n: outEvent.n, kind: "r" }],
    });
  pair(
    "Inducement (decoy sweep)",
    ["decoy", byKey(EVIDENCE.inducement, "yes")],
    ["none", byKey(EVIDENCE.inducement, "no")],
  );
  pair(
    "Mitigation block",
    ["block", byKey(EVIDENCE.mitigation, "yes")],
    ["none", byKey(EVIDENCE.mitigation, "no")],
  );

  const scale = Math.max(
    0.1,
    ...tiles.flatMap((t) =>
      t.rows.filter((r) => r.kind === "r" && r.value != null).map((r) => Math.abs(r.value!)),
    ),
  );
  const lines = evidenceHeadlines();

  return (
    <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2">
      <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
        Measured · four years of the desk&apos;s own cards (Lab › Evidence) · R per card
      </p>
      {tiles.length > 0 ? (
        <div className="mt-1.5 grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
          {tiles.map((t) => (
            <div
              key={t.title}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5"
            >
              <p className="mb-1 text-[10px] font-semibold text-[var(--color-fg)]">{t.title}</p>
              <div className="space-y-1">
                {t.rows.map((r) => (
                  <MiniBar key={r.label} row={r} scale={scale} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-[var(--color-muted)]">Evidence pack not built yet.</p>
      )}
      {lines.length > 0 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-[10px] text-[var(--color-primary)]">
            Read the findings in full
          </summary>
          {lines.map((l) => (
            <p key={l} className="mt-0.5 text-[11px] leading-snug text-[var(--color-fg)]">
              {l}
            </p>
          ))}
        </details>
      )}
    </div>
  );
}
