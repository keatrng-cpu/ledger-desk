/**
 * Ring 4 — Place it. A replay execution drill.
 *
 * The other rings ask for a word. This one asks for the ORDER — limit, stop,
 * T1, optional T2, or the one layer that stops it — on a real 15m tape whose
 * future is hidden, with a clock running, and then plays the future bar by bar.
 *
 * The shape follows what deliberate-practice research says a drill needs and
 * nothing else:
 *   - the future is not on screen, and not in the price axis either: the scale
 *     is fitted to the known bars only, so an empty band cannot hint at a move;
 *   - the first answer is the answer — commit writes the attempt to storage
 *     BEFORE the reveal, a case once opened cannot be skipped, and an
 *     attempted case only ever reopens in review;
 *   - there is no rewind: the reveal only moves forward;
 *   - process is scored apart from outcome, rule by rule, and the outcome is
 *     printed with the sentence that one outcome is noise.
 * And nothing that makes it a game: no streak, badge, confetti or composite
 * score. Gamified feedback raises trading frequency, and overtrading is what
 * the desk exists to refuse.
 *
 * The chart is its own small SVG rather than setup-chart.tsx: that one draws a
 * live TradePlan with an overlay, and this needs a hidden future, a decision
 * divider and the trader's own levels beside the desk's. It keeps the same
 * visual language — up/down candles, accent for the array and CE, amber for
 * the raid, green for the draw, red for the stop — so the live chart reads the
 * same afterwards.
 */

import { useEffect, useMemo, useState } from "react";
import {
  BLOCKERS,
  DECISION,
  FUTURE_BARS,
  PAST_BARS,
  RULES,
  STORE_KEY,
  barTime,
  blockerLabel,
  caseBars,
  deskOrder,
  emptyStore,
  expectedAction,
  makeAttempt,
  medianSeconds,
  nextCaseId,
  parseStore,
  recordAttempt,
  ruleCurves,
  ruleLabel,
  simulateOrder,
  traderOrder,
  weakestRule,
  type BlockerId,
  type DrillAttempt,
  type DrillCall,
  type DrillCase,
  type DrillFile,
  type DrillStore,
  type ItemStatus,
  type OrderType,
  type SimResult,
  type Word,
} from "@/lib/learn/replay-drill";
import { evidenceHeadlines } from "@/lib/trading/evidence";
import { etWallParts } from "@/lib/trading/sessions";

/* ── Storage (the only impure part; the rules live in replay-drill.ts) ───── */

function loadStore(): DrillStore {
  if (typeof window === "undefined") return emptyStore();
  try {
    return parseStore(window.localStorage.getItem(STORE_KEY));
  } catch {
    return emptyStore();
  }
}

function saveStore(s: DrillStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* quota or private mode — the drill still runs, it just forgets */
  }
}

/* ── Formatting ──────────────────────────────────────────────────────────── */

const ET_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

function hhmm(t: number): string {
  const w = etWallParts(t);
  return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
}

const KZ: Record<string, string> = {
  london: "London",
  ny_am: "NY AM",
  ny_pm: "NY PM",
  ny_lunch: "NY lunch",
  asia: "Asia",
  dead: "dead zone",
};

const f2 = (n: number) => n.toFixed(2);
const signedR = (r: number) => `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`;

function num(s: string): number | null {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const STATUS_STYLE: Record<ItemStatus, { color: string; text: string }> = {
  pass: { color: "var(--color-up)", text: "pass" },
  fail: { color: "var(--color-down)", text: "fail" },
  na: { color: "var(--color-subtle)", text: "n/a" },
};

/** The must-layers in sequence order, for the desk's strip on the reveal. */
const MUST_ORDER = ["dol", "htf", "sweep", "pd_half", "ltf", "time", "target", "retrace", "clean"] as const;

/* ── The component ───────────────────────────────────────────────────────── */

export function ReplayDrill() {
  const [file, setFile] = useState<DrillFile | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [store, setStore] = useState<DrillStore | null>(null);
  /** A case shown in review (after commit, or picked from the list). Null = the open case. */
  const [view, setView] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(0);

  // Data and storage load on the client only — the server render and the
  // first client render are both the loading line, so nothing mismatches.
  useEffect(() => {
    let live = true;
    import("@/data/replay-drills.json")
      .then((mod) => {
        if (live) setFile((mod.default ?? mod) as unknown as DrillFile);
      })
      .catch(() => live && setLoadError(true));
    setStore(loadStore());
    return () => {
      live = false;
    };
  }, []);

  const cases = file?.cases ?? [];
  const byId = useMemo(() => new Map(cases.map((c) => [c.id, c] as const)), [cases]);

  // With nothing open and nothing in review, open the next case — and start
  // its clock — only now, when it is actually about to be on screen. An open
  // case the file no longer holds (a rebuild renamed it) is dropped rather
  // than left to strand the page.
  useEffect(() => {
    if (!file || !store || view) return;
    const openId = store.open?.caseId;
    if (openId && file.cases.some((c) => c.id === openId)) return;
    const id = nextCaseId(file.cases, store.attempts);
    if (!id && !store.open) return;
    const next: DrillStore = { ...store, open: id ? { caseId: id, openedAt: Date.now() } : null };
    saveStore(next);
    setStore(next);
  }, [file, store, view]);

  if (loadError) {
    return <p className="text-sm text-[var(--color-muted)]">The drill cases did not load — run `npx tsx scripts/build-replay-drills.mjs`.</p>;
  }
  if (!file || !store) {
    return <p className="text-sm text-[var(--color-muted)]">Loading the drill…</p>;
  }

  const attemptOf = (id: string) => store.attempts.find((a) => a.caseId === id) ?? null;
  const reviewCase = view ? (byId.get(view) ?? null) : null;
  const openCase = store.open ? (byId.get(store.open.caseId) ?? null) : null;

  function commit(c: DrillCase, call: DrillCall) {
    if (!store || !store.open || store.open.caseId !== c.id) return;
    const a = makeAttempt(c, call, store.open.openedAt, Date.now());
    const next = recordAttempt(store, a);
    saveStore(next);
    setStore(next);
    setRevealed(0);
    setView(c.id);
  }

  function review(id: string) {
    setRevealed(FUTURE_BARS);
    setView(id);
  }

  return (
    <div className="flex flex-col gap-3">
      <Framing file={file} />
      <Progress attempts={store.attempts} total={cases.length} />

      {reviewCase && attemptOf(reviewCase.id) ? (
        <Reveal
          key={`r-${reviewCase.id}`}
          c={reviewCase}
          attempt={attemptOf(reviewCase.id)!}
          revealed={revealed}
          onReveal={setRevealed}
          onNext={() => setView(null)}
          hasOpen={store.open != null}
          allDone={store.attempts.length >= cases.length}
        />
      ) : openCase ? (
        <Decide key={`d-${openCase.id}`} c={openCase} openedAt={store.open!.openedAt} onCommit={commit} />
      ) : (
        <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm text-[var(--color-fg)]">
          Every case has been attempted once. Review them below — the first answer stays the answer.
        </p>
      )}

      <History attempts={store.attempts} byId={byId} active={view} onPick={review} />
    </div>
  );
}

/* ── Framing and progress ────────────────────────────────────────────────── */

function Framing({ file }: { file: DrillFile }) {
  const lines = evidenceHeadlines().slice(0, 2);
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
        Ring 4 · place it · {file.cases.length} real cases · future hidden · first answer locks
      </p>
      <p className="mt-1 text-[12px] leading-snug text-[var(--color-fg)]">
        This trains EXECUTION of the rule — limit at CE, stop beyond the raid inside the band, T1 at least 1R, or the one
        layer that stops it. It does not train belief in the card:
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-snug text-[var(--color-muted)]">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

function Progress({ attempts, total }: { attempts: DrillAttempt[]; total: number }) {
  const curves = ruleCurves(attempts);
  const med = medianSeconds(attempts);
  const weak = weakestRule(attempts);
  return (
    <section
      aria-label="Progress by rule"
      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px]">
        <span className="tabular text-[var(--color-fg)]">
          Attempts {attempts.length} / {total}
        </span>
        <span className="tabular text-[var(--color-muted)]">
          Median time to decide {med == null ? "—" : `${Math.round(med)}s`} · last 20
        </span>
        <span className="text-[var(--color-muted)]">
          Fails most: {weak ? `${ruleLabel(weak.id)} (${weak.fails} of the last 20)` : "nothing yet"}
        </span>
      </div>
      <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {curves.map((cur) => (
          <li key={cur.id} className="flex min-w-0 items-center gap-2 text-[11px]">
            <span className="w-28 shrink-0 truncate text-[var(--color-muted)]">{ruleLabel(cur.id)}</span>
            <span className="flex min-w-0 flex-1 gap-[3px]" aria-label={`${cur.pass} of ${cur.n}`}>
              {cur.n === 0 ? (
                <span className="text-[10px] text-[var(--color-subtle)]">not tested yet</span>
              ) : (
                cur.marks.map((m, k) => (
                  <span
                    key={k}
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: m === "pass" ? "var(--color-up)" : "var(--color-down)" }}
                  />
                ))
              )}
            </span>
            <span className="tabular shrink-0 text-[var(--color-subtle)]">{cur.n ? `${cur.pass}/${cur.n}` : ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── Deciding ────────────────────────────────────────────────────────────── */

function CaseHeader({ c, sub }: { c: DrillCase; sub: string }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-base font-semibold tracking-tight">
          {c.sym} · {c.side.toUpperCase()} plan · {ET_DAY.format(new Date(c.t))} · {hhmm(c.t)} ET
        </h3>
        <p className="text-[11px] text-[var(--color-muted)]">{sub}</p>
      </div>
    </header>
  );
}

function Legend({ c }: { c: DrillCase }) {
  const rows: { k: string; v: string; color: string }[] = [
    { k: "CE (array mid)", v: f2(c.e), color: "var(--color-primary)" },
    { k: "Array", v: c.zone ? `${f2(c.zone[0])} – ${f2(c.zone[1])}` : "—", color: "var(--color-primary)" },
    { k: "Raid", v: c.raid != null ? f2(c.raid) : "none printed", color: "var(--color-warn)" },
    {
      k: "Draw (T1)",
      v: c.t1 != null ? `${f2(c.t1)}${c.draw ? ` · ${c.draw}` : ""}` : "none ahead of CE",
      color: "var(--color-up)",
    },
    { k: "ERL (T2)", v: c.t2 != null ? f2(c.t2) : "—", color: "var(--color-up)" },
    { k: "Last close", v: f2(c.px), color: "var(--color-muted)" },
    { k: "ATR(14)", v: f2(c.atr), color: "var(--color-muted)" },
    { k: "Card", v: `Q ${c.conf.toFixed(2)} · ${c.band || "—"} · ${KZ[c.kz] ?? c.kz}`, color: "var(--color-muted)" },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 sm:grid-cols-4">
      {rows.map((r) => (
        <div key={r.k} className="min-w-0">
          <dt className="text-[9px] uppercase tracking-wide text-[var(--color-subtle)]">{r.k}</dt>
          <dd className="truncate tabular text-[12px] font-medium" style={{ color: r.color }} title={r.v}>
            {r.v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Decide({
  c,
  openedAt,
  onCommit,
}: {
  c: DrillCase;
  openedAt: number;
  onCommit: (c: DrillCase, call: DrillCall) => void;
}) {
  const [word, setWord] = useState<Word | null>(null);
  const [layer, setLayer] = useState<BlockerId | null>(null);
  const [type, setType] = useState<OrderType>("limit");
  const [limit, setLimit] = useState("");
  const [stop, setStop] = useState("");
  const [t1, setT1] = useState("");
  const [t2, setT2] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const lim = num(limit);
  const st = num(stop);
  const tg1 = num(t1);
  const tg2 = t2.trim() ? num(t2) : null;
  const t2Bad = t2.trim() !== "" && tg2 == null;

  const order =
    word === "TAKE" && st != null && tg1 != null && !t2Bad && (type === "market" || lim != null)
      ? { type, limit: type === "limit" ? lim : null, stop: st, t1: tg1, t2: tg2 }
      : null;
  const ready = word === "TAKE" ? order != null : word != null && layer != null;

  // Ticket preview: what the order is, in the units the rules are written in.
  const ref = type === "limit" ? lim : c.px;
  const long = c.side === "long";
  let preview = "Fill in the order to see its risk and R.";
  if (ref != null && st != null) {
    const risk = Math.abs(ref - st);
    const wrongSide = long ? st >= ref : st <= ref;
    const rr = (t: number | null) =>
      t == null ? null : (long ? t > ref : t < ref) && risk > 0 ? Math.abs(t - ref) / risk : null;
    preview = wrongSide
      ? `Stop ${f2(st)} is on the wrong side of ${f2(ref)}.`
      : `Entry ${f2(ref)}${type === "market" ? " (the print — a market order fills at the next open)" : ""} · risk ${f2(risk)}pt = ${(risk / c.atr).toFixed(2)}×ATR${
          tg1 != null ? ` · T1 ${rr(tg1) == null ? "behind the entry" : `${rr(tg1)!.toFixed(2)}R`}` : ""
        }${tg2 != null ? ` · T2 ${rr(tg2) == null ? "behind the entry" : `${rr(tg2)!.toFixed(2)}R`}` : ""}`;
  }

  const secs = Math.max(0, Math.floor((now - openedAt) / 1000));

  function submit() {
    if (!ready || !word) return;
    onCommit(c, { word, layer: word === "TAKE" ? null : layer, order: word === "TAKE" ? order : null });
  }

  const input =
    "mt-0.5 block w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-[12px] text-[var(--color-fg)] disabled:opacity-40";

  return (
    <section className="flex flex-col gap-3" aria-label="The case">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <CaseHeader
          c={c}
          sub="Tape through the decision bar. Place the whole order, or name the one layer that stops it."
        />
        <span
          className="tabular rounded-full bg-[var(--color-surface-3)] px-2.5 py-1 text-[11px] text-[var(--color-muted)]"
          aria-label="Time since the case opened"
        >
          {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
        </span>
      </div>

      <DrillChart c={c} future={0} decided={false} />
      <Legend c={c} />

      <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] p-3">
        <p className="text-[11px] leading-snug text-[var(--color-fg)]">
          Your call. The first commit is final — there is no second attempt at this case.
        </p>
        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Word">
          {(["TAKE", "WAIT", "STAND"] as const).map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={word === w}
              onClick={() => setWord(w)}
              className={`rounded-[var(--radius-sm)] px-2.5 py-1 text-[11px] font-semibold ${
                word === w
                  ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
                  : "bg-[var(--color-surface-3)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
              }`}
            >
              {w}
            </button>
          ))}
        </div>

        {word && word !== "TAKE" && (
          <div className="mt-2">
            <p className="text-[10px] uppercase tracking-wide text-[var(--color-subtle)]">The one layer that stops it</p>
            <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Blocker">
              {BLOCKERS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={layer === b.id}
                  onClick={() => setLayer(b.id)}
                  className={`rounded-[var(--radius-sm)] px-2 py-1 text-[10px] ${
                    layer === b.id
                      ? "bg-[var(--color-primary-dim)] text-[var(--color-fg)]"
                      : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {word === "TAKE" && (
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Order type">
              {(["limit", "market"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={type === t}
                  onClick={() => setType(t)}
                  className={`rounded-[var(--radius-sm)] px-2 py-1 text-[11px] ${
                    type === t
                      ? "bg-[var(--color-primary-dim)] text-[var(--color-fg)]"
                      : "bg-[var(--color-surface-3)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                  }`}
                >
                  {t === "limit" ? "Limit" : "Market"}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="text-[10px] uppercase text-[var(--color-subtle)]">
                Limit
                <input
                  value={type === "limit" ? limit : ""}
                  onChange={(e) => setLimit(e.target.value)}
                  disabled={type !== "limit"}
                  inputMode="decimal"
                  placeholder={type === "limit" ? "price" : "fills at next open"}
                  className={input}
                />
              </label>
              <label className="text-[10px] uppercase text-[var(--color-subtle)]">
                Stop
                <input value={stop} onChange={(e) => setStop(e.target.value)} inputMode="decimal" placeholder="price" className={input} />
              </label>
              <label className="text-[10px] uppercase text-[var(--color-subtle)]">
                T1
                <input value={t1} onChange={(e) => setT1(e.target.value)} inputMode="decimal" placeholder="price" className={input} />
              </label>
              <label className="text-[10px] uppercase text-[var(--color-subtle)]">
                T2 (optional)
                <input value={t2} onChange={(e) => setT2(e.target.value)} inputMode="decimal" placeholder="runner" className={input} />
              </label>
            </div>
            <p className="tabular text-[11px] text-[var(--color-muted)]">Ticket: {preview}</p>
          </div>
        )}

        <button
          type="button"
          disabled={!ready}
          onClick={submit}
          className="mt-3 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] py-1.5 text-xs text-[var(--color-fg)] hover:bg-[var(--color-surface-2)] disabled:opacity-40"
        >
          Commit — this locks the answer, then the tape plays
        </button>
      </div>
    </section>
  );
}

/* ── The reveal ──────────────────────────────────────────────────────────── */

function Reveal({
  c,
  attempt,
  revealed,
  onReveal,
  onNext,
  hasOpen,
  allDone,
}: {
  c: DrillCase;
  attempt: DrillAttempt;
  revealed: number;
  onReveal: (n: number) => void;
  onNext: () => void;
  hasOpen: boolean;
  allDone: boolean;
}) {
  const exp = expectedAction(c);
  const bars = useMemo(() => caseBars(c), [c]);
  const you = useMemo<SimResult | null>(
    () => (attempt.call.word === "TAKE" && attempt.call.order ? simulateOrder(bars, DECISION, traderOrder(c, attempt.call.order)) : null),
    [bars, c, attempt],
  );
  const desk = useMemo(() => simulateOrder(bars, DECISION, deskOrder(c)), [bars, c]);
  const done = revealed >= FUTURE_BARS;
  const failSet = new Set(c.fail);
  const waitSet = new Set(c.wait);

  return (
    <section className="flex flex-col gap-3" aria-label="The reveal">
      <CaseHeader
        c={c}
        sub={`Committed after ${Math.round(attempt.secondsToDecide)}s: ${attempt.call.word}${
          attempt.call.word === "TAKE" && attempt.call.order
            ? ` · ${attempt.call.order.type} ${attempt.call.order.limit != null ? f2(attempt.call.order.limit) : "at the next open"} · stop ${f2(attempt.call.order.stop)} · T1 ${f2(attempt.call.order.t1)}${attempt.call.order.t2 != null ? ` · T2 ${f2(attempt.call.order.t2)}` : ""}`
            : ` · ${blockerLabel(attempt.call.layer)}`
        }`}
      />

      <DrillChart c={c} future={revealed} decided you={you} youOrder={attempt.call.order} desk={desk} />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={done}
          onClick={() => onReveal(Math.min(FUTURE_BARS, revealed + 1))}
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-fg)] hover:bg-[var(--color-surface-2)] disabled:opacity-40"
        >
          Next bar ▸
        </button>
        <button
          type="button"
          disabled={done}
          onClick={() => onReveal(FUTURE_BARS)}
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)] disabled:opacity-40"
        >
          Reveal all
        </button>
        <span className="tabular text-[10px] text-[var(--color-subtle)]">
          {revealed} / {FUTURE_BARS} bars after the decision · no rewind
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={allDone && !hasOpen}
          className="ml-auto rounded-[var(--radius-sm)] bg-[var(--color-primary)] px-3 py-1 text-xs font-semibold text-[var(--color-primary-fg)] disabled:opacity-40"
        >
          {hasOpen ? "Back to the open case" : "Next case →"}
        </button>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          Process — the part you control, rule by rule
        </p>
        <ol className="mt-2 flex flex-col gap-1.5">
          {RULES.map((r) => {
            const it = attempt.items.find((i) => i.id === r.id);
            const s = STATUS_STYLE[it?.status ?? "na"];
            return (
              <li key={r.id} className="grid grid-cols-[3.25rem_7.5rem_minmax(0,1fr)] items-baseline gap-2 text-[12px]">
                <span className="text-[10px] font-semibold uppercase" style={{ color: s.color }}>
                  {s.text}
                </span>
                <span className="text-[var(--color-muted)]">{r.label}</span>
                <span className="leading-snug text-[var(--color-fg)]">
                  {it?.reason ?? "—"}
                  <span className="block text-[10px] text-[var(--color-subtle)]">{r.cite}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-primary)_35%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_7%,transparent)] p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          The desk · {exp.word}
          {exp.blocker ? ` · ${blockerLabel(exp.blocker)}` : ""}
          {c.word !== exp.word ? ` · sequence printed ${c.word}` : ""}
        </p>
        <p className="mt-1 text-[13px] leading-snug text-[var(--color-fg)]">
          {exp.note.charAt(0).toUpperCase() + exp.note.slice(1)}.{c.why ? ` ${c.why}.` : ""}
        </p>
        <ul className="mt-2 flex flex-wrap gap-1" aria-label="Must-layers at the decision bar">
          {MUST_ORDER.map((id) => {
            const state = failSet.has(id) ? "fail" : waitSet.has(id) ? "wait" : "pass";
            const color = state === "fail" ? "var(--color-down)" : state === "wait" ? "var(--color-warn)" : "var(--color-up)";
            return (
              <li
                key={id}
                className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px]"
                style={{ color, background: `color-mix(in oklab, ${color} 12%, transparent)` }}
              >
                {blockerLabel(id)} · {state}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[10px] text-[var(--color-subtle)]">
          Word and layers as captured by the desk of 2026-09-24; the stop band is today&apos;s rule on top. Desk plan: CE{" "}
          {f2(c.e)} · stop {f2(c.s)} ({(Math.abs(c.e - c.s) / c.atr).toFixed(2)}×ATR) · T1 {c.t1 != null ? f2(c.t1) : "—"} · T2{" "}
          {c.t2 != null ? f2(c.t2) : "—"}.
        </p>
      </div>

      {done ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
            Outcome — reported apart from process
          </p>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            <OutcomeCell title="Your order" r={attempt.yourR} text={outcomeText(attempt.call.word === "TAKE" ? you : null, "you")} />
            <OutcomeCell
              title={exp.word === "TAKE" ? "The desk's plan, as coded" : "The desk's plan, taken anyway as coded"}
              r={attempt.deskR}
              text={outcomeText(desk, "desk")}
            />
          </dl>
          <p className="mt-2 text-[11px] leading-snug text-[var(--color-muted)]">
            One outcome is noise: a rule-perfect order loses often and a broken one sometimes wins. What repeats over
            hundreds of cases is the process above — that is what this drill trains.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-[var(--color-subtle)]">Outcomes print once every bar of the future has been played.</p>
      )}
    </section>
  );
}

function outcomeText(sim: SimResult | null, who: "you" | "desk"): string {
  if (!sim) return "No order — flat.";
  if (sim.kind === "no-fill") return "No fill — the limit was not touched inside 12 bars. 0R, not a loss.";
  if (sim.kind === "invalid") return sim.note;
  const exit =
    sim.exit === "stop"
      ? "stopped out"
      : sim.exit === "be"
        ? "T1 banked, runner stopped at breakeven"
        : sim.exit === "t1"
          ? "all out at T1"
          : sim.exit === "t2"
            ? "T1 banked, runner reached T2"
            : "closed on time";
  return `${who === "you" ? "Filled" : "Filled at CE"} ${f2(sim.entry)} on bar +${sim.fill - DECISION}, ${exit} on bar +${sim.out - DECISION}.`;
}

function OutcomeCell({ title, r, text }: { title: string; r: number | null; text: string }) {
  const color = r == null || r === 0 ? "var(--color-muted)" : r > 0 ? "var(--color-up)" : "var(--color-down)";
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-2">
      <dt className="text-[10px] uppercase tracking-wide text-[var(--color-subtle)]">{title}</dt>
      <dd className="tabular text-base font-semibold" style={{ color }}>
        {r == null ? "—" : signedR(r)}
      </dd>
      <dd className="text-[11px] leading-snug text-[var(--color-muted)]">{text}</dd>
    </div>
  );
}

/* ── History ─────────────────────────────────────────────────────────────── */

function History({
  attempts,
  byId,
  active,
  onPick,
}: {
  attempts: DrillAttempt[];
  byId: Map<string, DrillCase>;
  active: string | null;
  onPick: (id: string) => void;
}) {
  if (!attempts.length) return null;
  const recent = [...attempts].sort((a, b) => b.at - a.at);
  return (
    <section className="border-t border-[var(--color-border)] pt-2" aria-label="Attempted cases">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-subtle)]">Attempted — open to review, not to retry</p>
      <div className="flex flex-wrap gap-1">
        {recent.map((a) => {
          const c = byId.get(a.caseId);
          if (!c) return null;
          const missed = a.items.filter((i) => i.status === "fail").map((i) => ruleLabel(i.id));
          return (
            <button
              key={a.caseId}
              type="button"
              onClick={() => onPick(a.caseId)}
              aria-current={active === a.caseId ? "true" : undefined}
              className={`rounded-[var(--radius-sm)] border px-2 py-1 text-left text-[10px] leading-tight ${
                active === a.caseId
                  ? "border-[var(--color-primary)] bg-[var(--color-primary-dim)]"
                  : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
              }`}
            >
              <span className="block text-[var(--color-fg)]">
                {c.sym} · {ET_DAY.format(new Date(c.t)).replace(/^\w+, /, "")}
              </span>
              <span className="text-[var(--color-subtle)]">{missed.length ? `missed: ${missed.join(", ")}` : "every rule held"}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ── The chart ───────────────────────────────────────────────────────────── */

const W = 720;
const H = 320;
const PAD_L = 8;
const PAD_R = 132;
const PAD_T = 14;
const PAD_B = 30;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;
const SLOTS = PAST_BARS + FUTURE_BARS;
const LABEL_GAP = 11;
/**
 * A level further than this many bar-range spans outside the candles is not
 * allowed to rescale the axis — it is pinned to the edge and says so. Same
 * refusal as setup-chart.tsx: forty candles flattened into a ribbon so a far
 * target fits is a worse chart than one that says the target is off screen.
 */
const INFRAME_SPANS = 0.6;

interface Level {
  price: number;
  label: string;
  color: string;
  dash?: string;
  width?: number;
}

/**
 * Exported for one test, and it is the one that matters: before the commit
 * this must render byte-identically whatever the hidden bars hold — no candle,
 * axis bound, label or time mark may be a function of the future.
 * verify-replay-drills.mjs replaces every future bar with garbage and diffs.
 */
export function DrillChart({
  c,
  future,
  decided,
  you,
  youOrder,
  desk,
}: {
  c: DrillCase;
  future: number;
  decided: boolean;
  you?: SimResult | null;
  youOrder?: DrillCall["order"];
  desk?: SimResult;
}) {
  const last = DECISION + future;
  const shown = c.bars.slice(0, last + 1);

  const levels: Level[] = [];
  levels.push({ price: c.e, label: "CE", color: "var(--color-primary)", width: 1.25 });
  if (c.raid != null) levels.push({ price: c.raid, label: "raid", color: "var(--color-warn)" });
  if (c.t1 != null) levels.push({ price: c.t1, label: "draw T1", color: "var(--color-up)" });
  if (c.t2 != null) levels.push({ price: c.t2, label: "ERL T2", color: "var(--color-up)", dash: "4 3" });
  if (c.range) levels.push({ price: c.range[1], label: "EQ", color: "var(--color-muted)", dash: "1 3" });
  levels.push({ price: c.px, label: "last", color: "var(--color-muted)", dash: "2 2" });
  if (decided) {
    levels.push({ price: c.s, label: "desk stop", color: "var(--color-down)" });
    if (youOrder) {
      if (youOrder.limit != null) levels.push({ price: youOrder.limit, label: "you: limit", color: "var(--color-fg)", dash: "5 3" });
      levels.push({ price: youOrder.stop, label: "you: stop", color: "var(--color-fg)", dash: "5 3" });
      levels.push({ price: youOrder.t1, label: "you: T1", color: "var(--color-fg)", dash: "2 3" });
      if (youOrder.t2 != null) levels.push({ price: youOrder.t2, label: "you: T2", color: "var(--color-fg)", dash: "2 3" });
    }
  }

  // The axis is fitted to the bars ON SCREEN plus the levels near them — never
  // to hidden bars, or an empty band in the axis would hint at the move.
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of shown) {
    lo = Math.min(lo, b[3]);
    hi = Math.max(hi, b[2]);
  }
  const span = hi - lo || 1;
  const zone = c.zone;
  const wants = [...levels.map((l) => l.price), ...(zone ? zone : [])];
  for (const p of wants) {
    if (p >= lo - span * INFRAME_SPANS && p <= hi + span * INFRAME_SPANS) {
      lo = Math.min(lo, p);
      hi = Math.max(hi, p);
    }
  }
  const pad = (hi - lo || 1) * 0.06;
  lo -= pad;
  hi += pad;
  const step = PLOT_W / SLOTS;
  const x = (k: number) => PAD_L + k * step + step / 2;
  const yRaw = (p: number) => PAD_T + ((hi - p) / (hi - lo)) * PLOT_H;
  const y = (p: number) => Math.min(PAD_T + PLOT_H, Math.max(PAD_T, yRaw(p)));
  const off = (p: number) => (p > hi ? "above" : p < lo ? "below" : null);

  // Gutter labels, top to bottom, pushed apart so no two share a line.
  const placed = levels
    .map((l) => ({ l, y: y(l.price) }))
    .sort((a, b) => a.y - b.y)
    .map((p) => ({ ...p, ly: p.y }));
  for (let k = 1; k < placed.length; k++) {
    placed[k]!.ly = Math.max(placed[k]!.ly, placed[k - 1]!.ly + LABEL_GAP);
  }
  const floor = PAD_T + PLOT_H + 4;
  for (let k = placed.length - 1; k >= 0; k--) {
    const cap = k === placed.length - 1 ? floor : placed[k + 1]!.ly - LABEL_GAP;
    placed[k]!.ly = Math.min(placed[k]!.ly, cap);
  }

  // ET time marks on the bars actually shown: every three hours on the hour,
  // and the weekday where the ET date changes.
  const marks: { k: number; text: string; day?: string }[] = [];
  let prevDay = -1;
  for (let k = 0; k <= last; k++) {
    const t = barTime(c, k);
    const w = etWallParts(t);
    const day = w.year * 10_000 + w.month * 100 + w.day;
    const dayText = day !== prevDay && k > 0 ? ET_DAY.format(new Date(t)).split(",")[0] : undefined;
    prevDay = day;
    if ((w.minute === 0 && w.hour % 3 === 0) || dayText) marks.push({ k, text: hhmm(t), day: dayText });
  }

  const divX = x(DECISION) + step / 2;
  const marker = (sim: SimResult | null | undefined, who: "you" | "desk") => {
    if (!sim || sim.kind !== "filled") return null;
    const color = who === "you" ? "var(--color-fg)" : "var(--color-primary)";
    const nodes = [];
    if (sim.fill <= last) {
      nodes.push(
        <circle key={`${who}-in`} cx={x(sim.fill)} cy={y(sim.entry)} r={3.5} fill="none" stroke={color} strokeWidth={1.5} />,
      );
    }
    if (sim.out <= last) {
      nodes.push(
        <rect key={`${who}-out`} x={x(sim.out) - 3} y={y(sim.exitPx) - 3} width={6} height={6} fill={color} opacity={0.9} />,
      );
    }
    return nodes;
  };

  return (
    <figure className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label={`${c.sym} 15m, ${PAST_BARS} bars to the decision at ${hhmm(c.t)} ET${decided ? `, ${future} bars after` : ", future hidden"}`}
      >
        {/* The entry array, from the left edge — its birth bar is not stored. */}
        {zone && (
          <rect
            x={PAD_L}
            y={y(zone[1])}
            width={PLOT_W}
            height={Math.max(1.5, y(zone[0]) - y(zone[1]))}
            fill="var(--color-primary)"
            opacity={0.1}
          />
        )}

        {/* The hidden future. */}
        {future < FUTURE_BARS && (
          <g>
            <rect
              x={x(last) + step / 2}
              y={PAD_T}
              width={PAD_L + PLOT_W - (x(last) + step / 2)}
              height={PLOT_H}
              fill="var(--color-surface-3)"
              opacity={0.35}
            />
            {!decided && (
              <text x={divX + 6} y={PAD_T + 9} fill="var(--color-subtle)" fontSize={9}>
                future hidden — commit to reveal
              </text>
            )}
          </g>
        )}

        {/* Levels — each line at its own price; only its gutter label moves. */}
        {placed.map(({ l, y: lineY }, k) =>
          off(l.price) ? null : (
            <line
              key={`l${k}`}
              x1={PAD_L}
              x2={PAD_L + PLOT_W}
              y1={lineY}
              y2={lineY}
              stroke={l.color}
              strokeWidth={l.width ?? 1}
              strokeDasharray={l.dash}
              opacity={0.85}
            />
          ),
        )}

        {/* Candles. */}
        {shown.map((b, k) => {
          const [, o, h, l, cl] = b;
          const up = cl >= o;
          const color = up ? "var(--color-up)" : "var(--color-down)";
          const top = y(Math.max(o, cl));
          const bh = Math.max(1, y(Math.min(o, cl)) - top);
          const bw = Math.max(1.5, step * 0.6);
          return (
            <g key={k} opacity={k > DECISION ? 0.9 : 1}>
              <line x1={x(k)} x2={x(k)} y1={y(h)} y2={y(l)} stroke={color} strokeWidth={1} />
              <rect x={x(k) - bw / 2} y={top} width={bw} height={bh} fill={color} />
            </g>
          );
        })}

        {/* The decision divider. */}
        <line x1={divX} x2={divX} y1={PAD_T} y2={PAD_T + PLOT_H} stroke="var(--color-muted)" strokeDasharray="3 3" />
        <text x={divX - 4} y={PAD_T + 9} textAnchor="end" fill="var(--color-muted)" fontSize={9}>
          decision {hhmm(c.t)} ET
        </text>

        {marker(desk, "desk")}
        {marker(you, "you")}

        {/* Gutter: price and name, on their own rows. */}
        {placed.map(({ l, ly }, k) => {
          const o = off(l.price);
          return (
            <text
              key={`g${k}`}
              x={W - PAD_R + 6}
              y={ly + 3}
              fill={l.color}
              fontSize={9}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {o === "above" ? "▲ " : o === "below" ? "▼ " : ""}
              {f2(l.price)} {l.label}
            </text>
          );
        })}

        {/* ET time axis. */}
        {marks.map((m) => (
          <g key={`t${m.k}`}>
            <line x1={x(m.k)} x2={x(m.k)} y1={PAD_T + PLOT_H} y2={PAD_T + PLOT_H + 3} stroke="var(--color-subtle)" />
            <text x={x(m.k)} y={PAD_T + PLOT_H + 13} textAnchor="middle" fill="var(--color-subtle)" fontSize={8.5}>
              {m.text}
            </text>
            {m.day && (
              <text x={x(m.k)} y={PAD_T + PLOT_H + 24} textAnchor="middle" fill="var(--color-muted)" fontSize={8.5}>
                {m.day}
              </text>
            )}
          </g>
        ))}
        <text x={W - 4} y={H - 4} textAnchor="end" fill="var(--color-subtle)" fontSize={8} opacity={0.75}>
          historic tape · ET · not live
        </text>
      </svg>
      {decided && (
        <figcaption className="border-t border-[var(--color-border)] px-3 py-1.5 text-[10px] text-[var(--color-subtle)]">
          Ring = fill, square = exit. Dashed foreground lines and marks are yours; accent marks are the desk plan&apos;s.
        </figcaption>
      )}
    </figure>
  );
}
