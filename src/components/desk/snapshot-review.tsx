/**
 * Snapshot review — ROADMAP B6.
 *
 * `captureSnapshot` has been writing decision-time context on every logged
 * trade since Phase 5. `listSnapshots` and `getSnapshot` had ZERO callers. This
 * is the missing reader: the desk was accumulating the one dataset that can
 * separate a good decision from a good outcome, and there was no way to look at
 * it.
 *
 * Why that distinction is the whole point: reviewing a loss three weeks later
 * from a chart that already shows what happened next is hindsight, not review.
 * You will always find the reason it "should have been obvious". A snapshot
 * freezes what was actually on the screen — HTF bias both books, the killzone,
 * the news verdict, whether the data was even trustworthy, and every candidate
 * with its present AND missing confluences. Read against that, "why did I take
 * this?" has an answer, and a losing trade that was correctly taken stops
 * getting punished into a rule change it never earned.
 *
 * Self-fetching, no props required.
 *
 * The stored payload is `jsonb` typed as `JsonValue`, i.e. genuinely unknown at
 * compile time — snapshots written by an older build will not match today's
 * DeskPayload. Every read below goes through the narrowing helpers so a shape
 * change renders a missing section rather than crashing the review screen.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  Circle,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Target,
  XCircle,
} from "lucide-react";
import {
  getSnapshot,
  listSnapshots,
  type DeskSnapshotSummary,
} from "@/lib/journal/snapshots";
import type { JsonValue } from "@/lib/journal/server";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Defensive readers for the stored jsonb                              */
/* ------------------------------------------------------------------ */

type JObj = Record<string, JsonValue>;

const obj = (v: JsonValue | undefined): JObj | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as JObj) : null;
const arr = (v: JsonValue | undefined): JsonValue[] => (Array.isArray(v) ? v : []);
const str = (v: JsonValue | undefined): string | null =>
  typeof v === "string" ? v : null;
const num = (v: JsonValue | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const bool = (v: JsonValue | undefined): boolean | null =>
  typeof v === "boolean" ? v : null;
const strList = (v: JsonValue | undefined): string[] =>
  arr(v).filter((x): x is string => typeof x === "string");

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const ET = "America/New_York";

const etTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    timeZone: ET,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

const etDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    timeZone: ET,
    month: "short",
    day: "2-digit",
  });

const score = (n: number | null) => (n == null ? "—" : n.toFixed(3));
const px = (n: number | null) => (n == null ? "—" : n.toFixed(2));
const pctOf = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(0)}%`);

/** Bias colouring: this is the absolute gate, so it gets the loudest treatment. */
function biasCls(v: string | null): string {
  if (v === "bull" || v === "bullish") return "text-[var(--color-up)]";
  if (v === "bear" || v === "bearish") return "text-[var(--color-down)]";
  return "text-[var(--color-muted)]";
}

function verdictCls(v: string | null): string {
  if (v === "clear" || v === "ok") return "text-[var(--color-up)]";
  if (v === "blackout" || v === "block" || v === "blocked")
    return "text-[var(--color-down)]";
  return "text-[var(--color-warn)]";
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function Chip({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-1.5 py-0.5">
      <span className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
        {label}
      </span>
      <span className={cn("font-mono text-[10px]", className)}>{value}</span>
    </span>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
        {label}
      </p>
      <p className="font-mono text-[11px] text-[var(--color-fg)]">{value}</p>
    </div>
  );
}

function Block({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-subtle)]">
        {title}
      </p>
      {hint && (
        <p className="mb-1.5 text-[10px] text-[var(--color-subtle)]">{hint}</p>
      )}
      <div className={hint ? "" : "mt-1.5"}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

function SnapshotRow({
  snap,
  onOpen,
}: {
  snap: DeskSnapshotSummary;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-2 text-left transition-colors hover:border-[color-mix(in_oklab,var(--color-primary)_40%,var(--color-border))]"
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-mono text-[11px] text-[var(--color-fg)]">
            {etDate(snap.ts)} {etTime(snap.ts)} ET
          </span>
          <span className="font-mono text-[11px] font-semibold text-[var(--color-primary)]">
            {snap.symbol ?? "—"}
          </span>
          {snap.killzone && (
            <span className="font-mono text-[10px] text-[var(--color-muted)]">
              {snap.killzone}
            </span>
          )}
          {/* Data quality is deliberately loud: a snapshot taken on a stale or
              gapped feed is evidence about the FEED, not about the decision. */}
          {!snap.dataQualityOk && (
            <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-down)_40%,var(--color-border))] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--color-down)]">
              <ShieldAlert className="h-3 w-3" />
              data suspect
            </span>
          )}
          {snap.tradeId && (
            <span className="rounded-[var(--radius-sm)] bg-[var(--color-primary-dim)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--color-primary)]">
              trade
            </span>
          )}
        </div>

        <div className="mt-1.5 flex flex-wrap gap-1">
          <Chip label="HTF L" value={snap.htfLeft ?? "—"} className={biasCls(snap.htfLeft)} />
          <Chip label="HTF R" value={snap.htfRight ?? "—"} className={biasCls(snap.htfRight)} />
          <Chip
            label="news"
            value={snap.newsVerdict ?? "—"}
            className={verdictCls(snap.newsVerdict)}
          />
          <Chip
            label="best"
            value={score(snap.bestPrescore)}
            className="text-[var(--color-fg)]"
          />
          <Chip
            label="actionable"
            value={String(snap.actionableCount)}
            className={
              snap.actionableCount > 0
                ? "text-[var(--color-up)]"
                : "text-[var(--color-muted)]"
            }
          />
        </div>
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Detail sections                                                     */
/* ------------------------------------------------------------------ */

function BiasSection({ bias }: { bias: JObj }) {
  const books = (["left", "right"] as const)
    .map((side) => ({ side, read: obj(bias[side]) }))
    .filter((b): b is { side: "left" | "right"; read: JObj } => b.read !== null);

  if (books.length === 0) return null;

  return (
    <Block
      title="HTF bias — the absolute gate"
      hint="If topDown disagreed with the side taken, the entry was wrong at the moment it was made, whatever it later paid."
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {books.map(({ side, read }) => (
          <div
            key={side}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1.5"
          >
            <p className="mb-1 font-mono text-[11px] font-semibold text-[var(--color-fg)]">
              {str(read.symbol) ?? side}
              <span className={cn("ml-2", biasCls(str(read.topDown)))}>
                {str(read.topDown) ?? "—"}
              </span>
              <span className="ml-2 text-[10px] text-[var(--color-subtle)]">
                conf {pctOf(num(read.confidence))}
              </span>
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              <Field label="daily" value={str(read.daily) ?? "—"} />
              <Field label="mid" value={str(read.mid) ?? "—"} />
              <Field label="ltf" value={str(read.ltf) ?? "—"} />
            </div>
            <div className="mt-1.5 grid grid-cols-4 gap-1.5">
              <Field label="PDH" value={px(num(read.pdh))} />
              <Field label="PDL" value={px(num(read.pdl))} />
              <Field label="PWH" value={px(num(read.pwh))} />
              <Field label="PWL" value={px(num(read.pwl))} />
            </div>
            {str(read.summary) && (
              <p className="mt-1.5 text-[10px] text-[var(--color-muted)]">
                {str(read.summary)}
              </p>
            )}
          </div>
        ))}
      </div>
    </Block>
  );
}

function CandidateCard({ c }: { c: JObj }) {
  const actionable = bool(c.actionable) === true;
  const present = strList(c.reasons);
  const missing = strList(c.missing);
  const conf = num(c.confluence);

  return (
    <li
      className={cn(
        "rounded-[var(--radius-sm)] border px-2 py-1.5",
        actionable
          ? "border-[color-mix(in_oklab,var(--color-up)_35%,var(--color-border))]"
          : "border-[var(--color-border)]",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {actionable ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--color-up)]" />
        ) : (
          <Circle className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)]" />
        )}
        <span className="font-mono text-[11px] font-semibold text-[var(--color-fg)]">
          {str(c.symbol) ?? "—"} {(str(c.side) ?? "").toUpperCase()}
        </span>
        <span className="font-mono text-[11px] text-[var(--color-primary)]">
          {str(c.grade) ?? "—"} · {score(conf)}
        </span>
        {str(c.strategyPrimary) && (
          <span className="font-mono text-[10px] text-[var(--color-muted)]">
            {str(c.strategyPrimary)}
          </span>
        )}
        {/* The three hard gates, shown individually — "not actionable" alone
            never tells you WHICH rule refused it. */}
        {(["killzoneOk", "htfOk", "conditionsOk"] as const).map((k) =>
          bool(c[k]) === false ? (
            <span
              key={k}
              className="rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-down)_35%,var(--color-border))] px-1 py-0.5 text-[9px] uppercase tracking-wide text-[var(--color-down)]"
            >
              {k.replace("Ok", "")} ✗
            </span>
          ) : null,
        )}
      </div>

      {str(c.title) && (
        <p className="mt-1 text-[10px] text-[var(--color-muted)]">{str(c.title)}</p>
      )}

      <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <div>
          <p className="text-[9px] uppercase tracking-wider text-[var(--color-up)]">
            Present ({present.length})
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {present.length === 0 ? (
              <li className="text-[10px] text-[var(--color-subtle)]">—</li>
            ) : (
              present.map((r) => (
                <li key={r} className="flex gap-1 text-[10px] text-[var(--color-muted)]">
                  <CheckCircle2 className="mt-[1px] h-2.5 w-2.5 shrink-0 text-[var(--color-up)]" />
                  <span>{r}</span>
                </li>
              ))
            )}
          </ul>
        </div>
        <div>
          {/* Missing is the half a chart can never reconstruct afterwards. */}
          <p className="text-[9px] uppercase tracking-wider text-[var(--color-down)]">
            Missing ({missing.length})
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {missing.length === 0 ? (
              <li className="text-[10px] text-[var(--color-subtle)]">—</li>
            ) : (
              missing.map((r) => (
                <li key={r} className="flex gap-1 text-[10px] text-[var(--color-muted)]">
                  <XCircle className="mt-[1px] h-2.5 w-2.5 shrink-0 text-[var(--color-down)]" />
                  <span>{r}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      {(str(c.entryZone) || str(c.invalidation)) && (
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <Field label="entry" value={str(c.entryZone) ?? "—"} />
          <Field label="invalidation" value={str(c.invalidation) ?? "—"} />
        </div>
      )}
    </li>
  );
}

function ScanSection({ scan }: { scan: JObj }) {
  const candidates = arr(scan.candidates)
    .map(obj)
    .filter((c): c is JObj => c !== null);
  const blocked = strList(scan.blocked);

  return (
    <Block
      title={`Scan — ${candidates.length} candidate${candidates.length === 1 ? "" : "s"} at floor ${score(num(scan.floor))}`}
    >
      {str(scan.focus) && (
        <p className="mb-1.5 flex items-start gap-1.5 text-[11px] text-[var(--color-fg)]">
          <Target className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-primary)]" />
          {str(scan.focus)}
        </p>
      )}
      {blocked.length > 0 && (
        <ul className="mb-1.5 space-y-0.5">
          {blocked.map((b) => (
            <li
              key={b}
              className="flex gap-1.5 text-[10px] text-[var(--color-warn)]"
            >
              <AlertTriangle className="mt-[1px] h-2.5 w-2.5 shrink-0" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
      {candidates.length === 0 ? (
        <p className="text-[11px] text-[var(--color-subtle)]">
          No candidates were on the board.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {candidates.map((c, i) => (
            <CandidateCard key={str(c.id) ?? String(i)} c={c} />
          ))}
        </ul>
      )}
    </Block>
  );
}

function DrawTarget({ label, t }: { label: string; t: JObj | null }) {
  if (!t) return <Field label={label} value="—" />;
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
        {label}
      </p>
      <p className="font-mono text-[11px] text-[var(--color-fg)]">
        {str(t.name) ?? "—"} {px(num(t.price))}
        <span
          className={cn(
            "ml-1.5",
            bool(t.swept) ? "text-[var(--color-muted)]" : "text-[var(--color-up)]",
          )}
        >
          {bool(t.swept) ? "swept" : `reach ${pctOf(num(t.reachProbability))}`}
        </span>
      </p>
    </div>
  );
}

function DrawsSection({ draws }: { draws: JObj }) {
  const books = (["left", "right"] as const)
    .map((side) => ({ side, read: obj(draws[side]) }))
    .filter((b): b is { side: "left" | "right"; read: JObj } => b.read !== null);
  if (books.length === 0) return null;

  return (
    <Block
      title="Draw on liquidity"
      hint="Where price was likely headed, with the empirical reach rate at capture time — and whether the base rate was even reliable."
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {books.map(({ side, read }) => (
          <div
            key={side}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1.5"
          >
            <p className="mb-1 font-mono text-[11px] font-semibold text-[var(--color-fg)]">
              {str(read.symbol) ?? side}
              {bool(read.baseRateReliable) === false && (
                <span className="ml-2 text-[10px] text-[var(--color-warn)]">
                  base rate weak (n={num(read.sessionsSampled) ?? "?"})
                </span>
              )}
            </p>
            <div className="space-y-1">
              <DrawTarget label="primary" t={obj(read.primary)} />
              <div className="grid grid-cols-2 gap-1.5">
                <DrawTarget label="above" t={obj(read.above)} />
                <DrawTarget label="below" t={obj(read.below)} />
              </div>
            </div>
            {str(read.note) && (
              <p className="mt-1 text-[10px] text-[var(--color-muted)]">
                {str(read.note)}
              </p>
            )}
          </div>
        ))}
      </div>
    </Block>
  );
}

function LevelsSection({ levels }: { levels: JsonValue[] }) {
  const books = levels.map(obj).filter((l): l is JObj => l !== null);
  if (books.length === 0) return null;

  return (
    <Block title="Key levels at capture">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {books.map((book, i) => {
          const items = arr(book.items)
            .map(obj)
            .filter((x): x is JObj => x !== null);
          return (
            <div key={str(book.symbol) ?? String(i)}>
              <p className="font-mono text-[11px] font-semibold text-[var(--color-fg)]">
                {str(book.symbol) ?? "—"}
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {items.map((it, j) => (
                  <li
                    key={`${str(it.name) ?? "lvl"}-${j}`}
                    className="flex justify-between gap-2 font-mono text-[10px]"
                  >
                    <span className="text-[var(--color-muted)]">
                      {str(it.name) ?? "—"}
                      <span className="ml-1 text-[var(--color-subtle)]">
                        {str(it.kind) ?? ""}
                      </span>
                    </span>
                    <span className="text-[var(--color-fg)]">{px(num(it.price))}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Block>
  );
}

function NewsSection({ news }: { news: JObj }) {
  const next = obj(news.nextEvent);
  return (
    <Block title="News read at capture">
      <p className="font-mono text-[11px]">
        <span className={verdictCls(str(news.verdict))}>
          {str(news.verdict) ?? "—"}
        </span>
        {str(news.reason) && (
          <span className="ml-2 text-[var(--color-muted)]">{str(news.reason)}</span>
        )}
      </p>
      {next && (
        <p className="mt-1 font-mono text-[10px] text-[var(--color-muted)]">
          next: {str(next.name) ?? "—"} @ {str(next.timeEt) ?? "—"} ET (
          {num(next.minutesAway) ?? "?"}m)
        </p>
      )}
    </Block>
  );
}

/* ------------------------------------------------------------------ */
/* Detail view                                                         */
/* ------------------------------------------------------------------ */

function SnapshotDetail({
  summary,
  payload,
  onBack,
}: {
  summary: DeskSnapshotSummary;
  payload: JsonValue;
  onBack: () => void;
}) {
  const p = obj(payload);
  const clock = p ? obj(p.clock) : null;
  const bias = p ? obj(p.bias) : null;
  const scan = p ? obj(p.scan) : null;
  const draws = p ? obj(p.draws) : null;
  const news = p ? obj(p.news) : null;
  const levels = p ? arr(p.levels) : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={onBack}>
          <ChevronLeft className="h-3.5 w-3.5" />
          All snapshots
        </Button>
        <p className="font-mono text-[11px] text-[var(--color-muted)]">
          {etDate(summary.ts)} {etTime(summary.ts)} ET
          {clock && str(clock.killzoneLabel) ? ` · ${str(clock.killzoneLabel)}` : ""}
          {summary.tradeId ? ` · trade ${summary.tradeId.slice(0, 8)}` : ""}
        </p>
      </div>

      {!summary.dataQualityOk && (
        <p className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-down)_35%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-down)_8%,transparent)] px-3 py-2 text-[11px] text-[var(--color-down)]">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Data quality was flagged at capture. Judge the FEED first — a decision
          made on a suspect print is not evidence about the decision rule.
        </p>
      )}

      {!p && (
        <p className="text-[11px] text-[var(--color-subtle)]">
          This snapshot stored no readable payload.
        </p>
      )}

      {bias && <BiasSection bias={bias} />}
      {scan && <ScanSection scan={scan} />}
      {draws && <DrawsSection draws={draws} />}
      {levels.length > 0 && <LevelsSection levels={levels} />}
      {news && <NewsSection news={news} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function SnapshotReview() {
  const [list, setList] = useState<DeskSnapshotSummary[] | null>(null);
  const [selected, setSelected] = useState<{
    summary: DeskSnapshotSummary;
    payload: JsonValue;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Trade-linked snapshots only — the ones with a real outcome to compare to. */
  const [tradesOnly, setTradesOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setList(await listSnapshots({ data: { limit: 100 } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Snapshots unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useCallback(async (summary: DeskSnapshotSummary) => {
    setOpening(summary.id);
    setError(null);
    try {
      const full = await getSnapshot({ data: { id: summary.id } });
      if (!full) {
        setError("That snapshot no longer exists (retention prunes to 500).");
        return;
      }
      setSelected({ summary: full.summary, payload: full.payload });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open snapshot");
    } finally {
      setOpening(null);
    }
  }, []);

  const rows = (list ?? []).filter((s) => !tradesOnly || s.tradeId);

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:p-4">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-primary-dim)] text-[var(--color-primary)]">
            <Camera className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-fg)]">
              Snapshot review
            </h2>
            <p className="text-xs text-[var(--color-subtle)]">
              What the desk actually looked like — good decision vs. good outcome
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTradesOnly((v) => !v)}
            aria-pressed={tradesOnly}
            className={cn(
              "rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors",
              tradesOnly
                ? "border-[var(--color-primary)] bg-[var(--color-primary-dim)] text-[var(--color-primary)]"
                : "border-[var(--color-border)] text-[var(--color-subtle)] hover:text-[var(--color-fg)]",
            )}
          >
            Trades only
          </button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
        </div>
      </header>

      {error && <p className="mb-3 text-xs text-[var(--color-down)]">{error}</p>}

      {selected ? (
        <SnapshotDetail
          summary={selected.summary}
          payload={selected.payload}
          onBack={() => setSelected(null)}
        />
      ) : (
        <>
          {!list && loading && (
            <div className="flex items-center gap-2 py-6 text-xs text-[var(--color-subtle)]">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--color-primary)]" />
              Loading captured context…
            </div>
          )}

          {list && rows.length === 0 && (
            <p className="py-4 text-xs text-[var(--color-subtle)]">
              {tradesOnly
                ? "No trade-linked snapshots yet."
                : "No snapshots yet. One is captured every time a setup is logged — take a trade and the decision-time context lands here."}
            </p>
          )}

          {rows.length > 0 && (
            <>
              <p className="mb-2 text-[10px] text-[var(--color-subtle)]">
                {rows.length} snapshot{rows.length === 1 ? "" : "s"} · newest first ·
                keeps the most recent 500
              </p>
              <ul className="space-y-1.5">
                {rows.map((s) => (
                  <SnapshotRow key={s.id} snap={s} onOpen={() => void open(s)} />
                ))}
              </ul>
            </>
          )}

          {opening && (
            <p className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--color-subtle)]">
              <Loader2 className="h-3 w-3 animate-spin" />
              Opening…
            </p>
          )}
        </>
      )}
    </section>
  );
}
