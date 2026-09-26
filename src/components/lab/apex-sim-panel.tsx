import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Bot, Dices, Gauge, Play } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CONTRACTS, type ContractKey } from "@/lib/aplus/config";
import { APEX_AUTOMATION_PROHIBITED_REASON } from "@/lib/execution/autofire-gates";
import {
  APEX_EVAL_RULES,
  APEX_MECHANICS,
  APEX_RULES_APPLY_TO,
  APEX_RULES_AS_OF,
  APEX_SIZES,
  CONFIDENCE_LABEL,
  DEFAULT_ROOM_BUFFER,
  DEFAULT_STOP_PTS,
  SIM_DEFAULT_PATHS,
  TRADES_PER_WEEK_MAX,
  TRADES_PER_WEEK_MIN,
  apexRulesFor,
  clampTradesPerWeek,
  defaultSimInput,
  loadEvidenceDist,
  roomToLiquidation,
  runApexSim,
  simCaveats,
  simHonestyLine,
  type AccountPhase,
  type ApexSimInput,
  type ApexSimOk,
  type ApexSimResult,
  type ApexSize,
  type ApexSizeRules,
  type DrawdownType,
  type EvidenceDist,
  type RuleConfidence,
  type RuleFigure,
} from "@/lib/propfirm/apex-sim";
import { cn } from "@/lib/utils";

/**
 * Apex evaluation simulator + room-to-liquidation calculator (Lab tab).
 *
 * The page's first job is to stop a pass rate reading like a forecast. The
 * honesty line prints above every number, the zero-edge control sits beside
 * every number, and the model's omissions are one click away — because a
 * "7% pass" printed alone looks like a property of the trader when it is a
 * property of a roughly breakeven distribution under Apex's rules.
 *
 * Runs synchronously on the click (~20 ms for 5,000 paths × both arms on a
 * laptop). If a slow device overruns the 200 ms budget the next run uses
 * proportionally fewer paths and says so, rather than freezing the tab.
 *
 * Inputs persist in localStorage, restored AFTER mount: the server renders the
 * defaults, so reading storage during render would hand hydration a
 * different tree. Every storage access is wrapped — private windows and
 * blocked storage simply start from the defaults.
 */

const STORAGE_KEY = "ledger-apex-sim-v1";
const RUN_BUDGET_MS = 200;
const MIN_BUDGET_PATHS = 1_000;
const SYMBOLS: ContractKey[] = ["MNQ", "MES", "NQ", "ES"];
const CAP_OPTIONS: (number | null)[] = [1, 2, 3, 4, 6, null];
const TPW_OPTIONS: number[] = [];
for (let x = TRADES_PER_WEEK_MIN; x <= TRADES_PER_WEEK_MAX; x++) TPW_OPTIONS.push(x);

const fieldClass =
  "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 font-mono text-xs text-[var(--color-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";

interface RoomForm {
  phase: AccountPhase;
  balance: string;
  threshold: string;
  peak: string;
  bufferPct: number;
}

const DEFAULT_ROOM: RoomForm = {
  phase: "evaluation",
  balance: "",
  threshold: "",
  peak: "",
  bufferPct: DEFAULT_ROOM_BUFFER * 100,
};

interface RunRecord {
  result: ApexSimResult;
  ms: number;
  key: string;
}

/* ─── formatting ─────────────────────────────────────────────────────────── */

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−" : "";
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const pp = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)} pp`;
const rMult = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(3)}R`;

function num(s: string): number | null {
  if (s.trim() === "") return null;
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}

/** Stable identity of a run's inputs — paths excluded, the budget owns those. */
function inputKey(i: ApexSimInput): string {
  const { paths: _paths, ...rest } = i;
  return JSON.stringify(rest);
}

/* ─── storage (per-viewer convenience only) ──────────────────────────────── */

function restore(): { input: ApexSimInput; room: RoomForm } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { input?: Partial<ApexSimInput>; room?: Partial<RoomForm> };
    const d = defaultSimInput(null);
    const i = saved.input ?? {};
    const finite = (x: unknown, fallback: number) =>
      typeof x === "number" && Number.isFinite(x) ? x : fallback;
    const input: ApexSimInput = {
      ...d,
      size: APEX_SIZES.includes(i.size as ApexSize) ? (i.size as ApexSize) : d.size,
      drawdown: i.drawdown === "EOD" || i.drawdown === "Intraday" ? i.drawdown : d.drawdown,
      riskUsd: finite(i.riskUsd, d.riskUsd),
      tradesPerWeek: clampTradesPerWeek(finite(i.tradesPerWeek, d.tradesPerWeek)),
      maxTradesPerDay:
        i.maxTradesPerDay === null
          ? null
          : CAP_OPTIONS.includes(i.maxTradesPerDay as number)
            ? (i.maxTradesPerDay as number)
            : d.maxTradesPerDay,
      symbol: typeof i.symbol === "string" && i.symbol in CONTRACTS ? (i.symbol as ContractKey) : d.symbol,
      stopPts: finite(i.stopPts, d.stopPts),
      seed: Math.trunc(finite(i.seed, d.seed)),
    };
    const r = saved.room ?? {};
    const room: RoomForm = {
      phase: r.phase === "pa" ? "pa" : "evaluation",
      balance: typeof r.balance === "string" ? r.balance : "",
      threshold: typeof r.threshold === "string" ? r.threshold : "",
      peak: typeof r.peak === "string" ? r.peak : "",
      bufferPct: Math.min(90, Math.max(0, finite(r.bufferPct, DEFAULT_ROOM.bufferPct))),
    };
    return { input, room };
  } catch {
    return null;
  }
}

function persist(input: ApexSimInput, room: RoomForm): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ input, room }));
  } catch {
    /* quota / blocked storage — the panel keeps working from memory */
  }
}

/* ─── small pieces ───────────────────────────────────────────────────────── */

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] text-[var(--color-subtle)]">
      {label}
      {children}
    </label>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 text-[11px] text-[var(--color-subtle)]">
      <span>{label}</span>
      <div role="group" aria-label={label} className="flex gap-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 rounded-[var(--radius-md)] border px-2 py-1.5 text-xs",
              value === o.value
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-[var(--color-border)] text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConfidenceTag({ c }: { c: RuleConfidence }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full border px-1.5 py-px text-[9px] font-medium uppercase tracking-wide",
        c === "apex"
          ? "border-[var(--color-border)] text-[var(--color-subtle)]"
          : "border-[var(--color-warn)] text-[var(--color-warn)]",
      )}
    >
      {CONFIDENCE_LABEL[c]}
    </span>
  );
}

function FigureCell({ f, fmt }: { f: RuleFigure; fmt: (x: number) => string }) {
  const unconfirmed = f.confidence !== "apex";
  return (
    <span
      className={cn(unconfirmed && "text-[var(--color-warn)]")}
      title={unconfirmed ? `${CONFIDENCE_LABEL[f.confidence]} — not confirmed on Apex's own pages` : "Apex help-center text"}
    >
      {fmt(f.value)}
      {unconfirmed ? "*" : ""}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" | "warn" }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1.5">
      <p className="text-[10px] text-[var(--color-subtle)]">{label}</p>
      <p
        className={cn(
          "font-mono text-xs font-semibold text-[var(--color-fg)]",
          tone === "up" && "text-[var(--color-up)]",
          tone === "down" && "text-[var(--color-down)]",
          tone === "warn" && "text-[var(--color-warn)]",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function SubHead({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--color-subtle)]">
      {children}
    </h3>
  );
}

/* ─── results ────────────────────────────────────────────────────────────── */

function diffTone(x: number, higherIsBetter: boolean): string {
  if (Math.abs(x) < 0.0005) return "text-[var(--color-muted)]";
  return (x > 0) === higherIsBetter ? "text-[var(--color-up)]" : "text-[var(--color-down)]";
}

function ResultsTable({ res }: { res: ApexSimOk }) {
  const s = res.strategy;
  const c = res.control;
  const days = (a: typeof s) =>
    a.daysToPass.median == null ? "—" : `${a.daysToPass.median} (${a.daysToPass.p25}–${a.daysToPass.p75})`;
  const rows: {
    label: string;
    strat: string;
    ctrl: string;
    diff: string | null;
    diffCls?: string;
  }[] = [
    { label: "Pass", strat: pct(s.pass), ctrl: pct(c.pass), diff: pp(s.pass - c.pass), diffCls: diffTone(s.pass - c.pass, true) },
    { label: "Bust", strat: pct(s.bust), ctrl: pct(c.bust), diff: pp(s.bust - c.bust), diffCls: diffTone(s.bust - c.bust, false) },
    {
      label: `Timeout (${res.input.horizonDays} days)`,
      strat: pct(s.timeout),
      ctrl: pct(c.timeout),
      diff: pp(s.timeout - c.timeout),
      diffCls: "text-[var(--color-muted)]",
    },
    { label: "Trading days to pass — median (p25–p75)", strat: days(s), ctrl: days(c), diff: null },
    {
      label: "Median worst drawdown (open equity)",
      strat: money(s.medianMaxDrawdownUsd),
      ctrl: money(c.medianMaxDrawdownUsd),
      diff: money(s.medianMaxDrawdownUsd - c.medianMaxDrawdownUsd),
      diffCls: diffTone(s.medianMaxDrawdownUsd - c.medianMaxDrawdownUsd, false),
    },
    { label: "Trades per evaluation", strat: s.tradesPerPath.toFixed(1), ctrl: c.tradesPerPath.toFixed(1), diff: null },
    {
      label: "Mean per trade, gross → net of commission",
      strat: `${rMult(s.meanGrossR)} → ${rMult(s.meanNetR)}`,
      ctrl: `${rMult(c.meanGrossR)} → ${rMult(c.meanNetR)}`,
      diff: rMult(s.meanGrossR - c.meanGrossR),
      diffCls: diffTone(s.meanGrossR - c.meanGrossR, true),
    },
  ];
  if (res.input.drawdown === "EOD") {
    rows.push({
      label: "Days ended by the daily loss limit, per evaluation",
      strat: s.dllDaysPerPath.toFixed(2),
      ctrl: c.dllDaysPerPath.toFixed(2),
      diff: null,
    });
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-[var(--color-subtle)]">
          <tr>
            <th className="pb-1 pr-3 font-medium" scope="col">
              <span className="sr-only">Metric</span>
            </th>
            <th className="pb-1 pr-3 text-right font-medium" scope="col">
              Measured cards
            </th>
            <th className="pb-1 pr-3 text-right font-medium" scope="col">
              Zero-edge control
            </th>
            <th className="pb-1 text-right font-medium" scope="col">
              Edge adds
            </th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-[var(--color-border)]">
              <th scope="row" className="py-1.5 pr-3 text-left font-sans font-normal text-[var(--color-fg)]">
                {r.label}
              </th>
              <td className="tabular py-1.5 pr-3 text-right text-[var(--color-fg)]">{r.strat}</td>
              <td className="tabular py-1.5 pr-3 text-right text-[var(--color-muted)]">{r.ctrl}</td>
              <td className={cn("tabular py-1.5 text-right", r.diffCls ?? "text-[var(--color-subtle)]")}>
                {r.diff ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── rules ──────────────────────────────────────────────────────────────── */

function RulesTable({ selected }: { selected: ApexSize }) {
  const rows: { label: string; cell: (r: ApexSizeRules) => ReactNode }[] = [
    { label: "Profit target", cell: (r) => <FigureCell f={r.profitTarget} fmt={money} /> },
    { label: "Trailing drawdown (EOD and Intraday)", cell: (r) => <FigureCell f={r.drawdown} fmt={money} /> },
    {
      label: "Max size, minis / micros",
      cell: (r) => (
        <>
          <FigureCell f={r.maxMinis} fmt={String} /> / <FigureCell f={r.maxMicros} fmt={String} />
        </>
      ),
    },
    { label: "Daily loss limit (EOD only)", cell: (r) => <FigureCell f={r.eodDailyLossLimit} fmt={money} /> },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-[var(--color-subtle)]">
          <tr>
            <th className="pb-1 pr-3 font-medium" scope="col">
              Evaluation
            </th>
            {APEX_EVAL_RULES.map((r) => {
              const all = [r.profitTarget, r.drawdown, r.maxMinis, r.maxMicros, r.eodDailyLossLimit];
              const c: RuleConfidence = all.every((f) => f.confidence === "apex") ? "apex" : "secondary";
              return (
                <th
                  key={r.size}
                  scope="col"
                  className={cn("pb-1 pr-3 text-right font-medium", r.size === selected && "text-[var(--color-fg)]")}
                >
                  <div>{r.label}</div>
                  <div className="mt-0.5">
                    <ConfidenceTag c={c} />
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-[var(--color-border)]">
              <th scope="row" className="py-1.5 pr-3 text-left font-sans font-normal text-[var(--color-fg)]">
                {row.label}
              </th>
              {APEX_EVAL_RULES.map((r) => (
                <td
                  key={r.size}
                  className={cn(
                    "tabular py-1.5 pr-3 text-right",
                    r.size === selected ? "bg-[var(--color-surface-2)] text-[var(--color-fg)]" : "text-[var(--color-muted)]",
                  )}
                >
                  {row.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-[var(--color-subtle)]">
        * unconfirmed — secondary sources, not Apex&apos;s own pages. Rules as of {APEX_RULES_AS_OF},{" "}
        {APEX_RULES_APPLY_TO}.
      </p>
    </div>
  );
}

/* ─── the panel ──────────────────────────────────────────────────────────── */

export function ApexSimPanel() {
  const [input, setInput] = useState<ApexSimInput>(() => defaultSimInput(null));
  const [room, setRoom] = useState<RoomForm>(DEFAULT_ROOM);
  const [restored, setRestored] = useState(false);
  const [dist, setDist] = useState<EvidenceDist | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [pathBudget, setPathBudget] = useState(SIM_DEFAULT_PATHS);
  const autoRan = useRef(false);

  // Saved inputs, after mount (see header).
  useEffect(() => {
    const saved = restore();
    if (saved) {
      setInput(saved.input);
      setRoom(saved.room);
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (restored) persist(input, room);
  }, [restored, input, room]);

  // The four-year paths live in their own chunk; fetch them once.
  useEffect(() => {
    let cancelled = false;
    loadEvidenceDist()
      .then((d) => {
        if (!cancelled) setDist(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "could not load the evidence");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const simulate = useCallback(
    (which: ApexSimInput) => {
      if (!dist) return;
      const t0 = performance.now();
      const result = runApexSim({ ...which, paths: pathBudget }, dist);
      const ms = performance.now() - t0;
      setRun({ result, ms, key: inputKey(which) });
      if (ms > RUN_BUDGET_MS && pathBudget > MIN_BUDGET_PATHS) {
        const scaled = Math.floor((pathBudget * RUN_BUDGET_MS) / ms / 500) * 500;
        setPathBudget(Math.max(MIN_BUDGET_PATHS, scaled));
      }
    },
    [dist, pathBudget],
  );

  // One automatic run once the evidence and the saved inputs are both in,
  // so the tab never opens on an empty table. Every later run is the button.
  useEffect(() => {
    if (!dist || !restored || autoRan.current) return;
    autoRan.current = true;
    simulate(input);
  }, [dist, restored, input, simulate]);

  const patch = useCallback((p: Partial<ApexSimInput>) => setInput((prev) => ({ ...prev, ...p })), []);
  const patchRoom = useCallback((p: Partial<RoomForm>) => setRoom((prev) => ({ ...prev, ...p })), []);

  const rules = apexRulesFor(input.size);
  const res = run?.result ?? null;
  const stale = run != null && run.key !== inputKey(input);
  const honesty = useMemo(() => simHonestyLine(), []);

  const roomRes = useMemo(
    () =>
      roomToLiquidation({
        phase: room.phase,
        drawdown: input.drawdown,
        size: input.size,
        balanceUsd: num(room.balance) ?? 0,
        thresholdUsd: num(room.threshold),
        peakUsd: num(room.peak),
        symbol: input.symbol,
        stopPts: input.stopPts,
        bufferFrac: room.bufferPct / 100,
      }),
    [room, input.drawdown, input.size, input.symbol, input.stopPts],
  );
  const roomEntered = num(room.balance) != null;
  const roomFrac =
    roomRes.roomUsd != null && rules ? Math.max(0, Math.min(1, roomRes.roomUsd / rules.drawdown.value)) : 0;
  const roomTone = roomFrac > 0.6 ? "var(--color-up)" : roomFrac > 0.3 ? "var(--color-warn)" : "var(--color-down)";

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-dim)] text-[var(--color-primary)]">
            <Dices className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <CardTitle className="text-sm font-medium text-[var(--color-fg)]">
              Apex evaluation — pass, bust or time out
            </CardTitle>
            <CardDescription>
              Monte Carlo on the desk&apos;s own four years of in-band cards, resampled by trading day, against
              Apex&apos;s rules for the account below — beside a zero-edge control run on the same draws.
            </CardDescription>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {stale ? (
            <span className="text-[10px] text-[var(--color-warn)]">inputs changed — run to update</span>
          ) : null}
          <Button type="button" variant="secondary" size="sm" disabled={!dist} onClick={() => simulate(input)}>
            <Play className="h-3.5 w-3.5" />
            Run
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex gap-2 rounded-[var(--radius-md)] border-l-4 border-[var(--color-warn)] bg-[var(--color-surface-2)] px-3 py-2 text-xs leading-relaxed text-[var(--color-muted)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warn)]" aria-hidden />
          <span>
            <b className="text-[var(--color-fg)]">Read this first:</b> {honesty}
          </span>
        </div>

        {/* ---------------- inputs ---------------- */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Account">
            <select
              className={fieldClass}
              value={input.size}
              onChange={(e) => patch({ size: Number(e.target.value) as ApexSize })}
            >
              {APEX_EVAL_RULES.map((r) => (
                <option key={r.size} value={r.size}>
                  {r.label}
                  {r.drawdown.confidence === "apex" ? "" : " (unconfirmed)"}
                </option>
              ))}
            </select>
          </Field>
          <Seg<DrawdownType>
            label="Drawdown"
            value={input.drawdown}
            onChange={(v) => patch({ drawdown: v })}
            options={[
              { value: "EOD", label: "EOD" },
              { value: "Intraday", label: "Intraday" },
            ]}
          />
          <Field label="Risk per trade ($)">
            <input
              type="number"
              inputMode="decimal"
              min={1}
              step={10}
              className={fieldClass}
              value={Number.isFinite(input.riskUsd) && input.riskUsd > 0 ? input.riskUsd : ""}
              onChange={(e) => patch({ riskUsd: Number(e.target.value) })}
            />
          </Field>
          <Field label="Trades / week">
            <select
              className={fieldClass}
              value={TPW_OPTIONS.includes(input.tradesPerWeek) ? input.tradesPerWeek : Math.round(input.tradesPerWeek)}
              onChange={(e) => patch({ tradesPerWeek: clampTradesPerWeek(Number(e.target.value)) })}
            >
              {TPW_OPTIONS.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Max trades / day">
            <select
              className={fieldClass}
              value={input.maxTradesPerDay == null ? "none" : String(input.maxTradesPerDay)}
              onChange={(e) => patch({ maxTradesPerDay: e.target.value === "none" ? null : Number(e.target.value) })}
            >
              {CAP_OPTIONS.map((x) => (
                <option key={x ?? "none"} value={x ?? "none"}>
                  {x == null ? "no cap" : x === 2 ? "2 (desk rule)" : x}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Contract">
            <select
              className={fieldClass}
              value={input.symbol}
              onChange={(e) => {
                const symbol = e.target.value as ContractKey;
                patch({ symbol, stopPts: DEFAULT_STOP_PTS[symbol] });
              }}
            >
              {SYMBOLS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Stop (${input.symbol} points)`}>
            <input
              type="number"
              inputMode="decimal"
              min={0.25}
              step={0.25}
              className={fieldClass}
              value={Number.isFinite(input.stopPts) && input.stopPts > 0 ? input.stopPts : ""}
              onChange={(e) => patch({ stopPts: Number(e.target.value) })}
            />
          </Field>
          <Field label="Seed">
            <input
              type="number"
              inputMode="numeric"
              step={1}
              className={fieldClass}
              value={Number.isFinite(input.seed) ? input.seed : ""}
              onChange={(e) => patch({ seed: Math.trunc(Number(e.target.value)) })}
            />
          </Field>
        </div>

        {/* ---------------- results ---------------- */}
        {loadError ? (
          <p className="text-xs text-[var(--color-down)]">Could not load the evidence distribution: {loadError}</p>
        ) : !dist || !res ? (
          <p className="text-xs text-[var(--color-muted)]">Loading four years of cards…</p>
        ) : !res.ok ? (
          <div className="rounded-[var(--radius-md)] border-l-4 border-[var(--color-down)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-muted)]">
            <b className="text-[var(--color-fg)]">Refused:</b> {res.refusal}
          </div>
        ) : (
          <div className={cn("space-y-3", stale && "opacity-60")}>
            <p className="font-mono text-[11px] text-[var(--color-subtle)]">
              {res.sizing.contracts} × {res.sizing.symbol} at {res.input.stopPts} pt ={" "}
              <span className="text-[var(--color-fg)]">{money(res.sizing.riskUsd)} per trade at risk</span>
              {res.sizing.riskUsd < res.input.riskUsd ? ` (asked ${money(res.input.riskUsd)}; whole contracts)` : ""} ·{" "}
              {money(res.sizing.commissionUsd)} round-turn · cap {res.sizing.capContracts} {res.sizing.capUnit}
            </p>
            <ResultsTable res={res} />
            {res.warnings.length > 0 && (
              <ul className="space-y-1">
                {res.warnings.map((w) => (
                  <li key={w} className="text-[11px] text-[var(--color-warn)]">
                    {w}
                  </li>
                ))}
              </ul>
            )}
            <p className="font-mono text-[10px] text-[var(--color-subtle)]">
              {res.paths.toLocaleString("en-US")} paths · seed {res.input.seed} · {res.sessions} sessions (
              {res.input.horizonDays} calendar days) · {res.thinning.realizedPerWeek.toFixed(2)}/wk simulated (p ={" "}
              {res.thinning.p.toFixed(2)}
              {res.thinning.cap != null ? `, max ${res.thinning.cap}/day` : ", no daily cap"}) · {run?.ms.toFixed(0)} ms
              {res.paths < SIM_DEFAULT_PATHS ? " · paths reduced to stay inside the 200 ms budget" : ""}
              {dist.builtAt ? ` · evidence built ${dist.builtAt.slice(0, 10)}` : ""}
            </p>
            <details className="text-[11px] text-[var(--color-muted)]">
              <summary className="cursor-pointer text-[var(--color-subtle)]">What this model leaves out</summary>
              <ul className="mt-1 space-y-0.5">
                {simCaveats(res).map((c) => (
                  <li key={c}>· {c}</li>
                ))}
              </ul>
            </details>
          </div>
        )}

        {/* ---------------- rules ---------------- */}
        <div>
          <SubHead>Apex rules on file · as of {APEX_RULES_AS_OF}</SubHead>
          <RulesTable selected={input.size} />
          <ul className="mt-3 space-y-1">
            {APEX_MECHANICS.map((m) => (
              <li key={m.key} className="flex items-start gap-2 text-[11px] text-[var(--color-muted)]">
                <span className="mt-px shrink-0">
                  <ConfidenceTag c={m.confidence} />
                </span>
                <span>{m.rule}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
          <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-down)]" aria-hidden />
          <span>
            <b className="text-[var(--color-fg)]">Automation:</b> {APEX_AUTOMATION_PROHIBITED_REASON} The desk&apos;s
            autofire refuses on exactly this reason until then.
          </span>
        </div>

        {/* ---------------- room to liquidation ---------------- */}
        <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
          <div className="flex items-start gap-2">
            <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]" aria-hidden />
            <div>
              <p className="text-xs font-semibold text-[var(--color-fg)]">Room to liquidation</p>
              <p className="text-[11px] text-[var(--color-subtle)]">
                Uses the account, drawdown type, contract and stop above. Leave the threshold blank to derive it from
                the peak.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Seg<AccountPhase>
              label="Phase"
              value={room.phase}
              onChange={(v) => patchRoom({ phase: v })}
              options={[
                { value: "evaluation", label: "Eval" },
                { value: "pa", label: "PA" },
              ]}
            />
            <Field label="Balance now (incl. open P&L)">
              <input
                type="number"
                inputMode="decimal"
                className={fieldClass}
                value={room.balance}
                placeholder={String(input.size)}
                onChange={(e) => patchRoom({ balance: e.target.value })}
              />
            </Field>
            <Field label="Threshold (dashboard)">
              <input
                type="number"
                inputMode="decimal"
                className={fieldClass}
                value={room.threshold}
                placeholder="optional"
                onChange={(e) => patchRoom({ threshold: e.target.value })}
              />
            </Field>
            <Field label={input.drawdown === "Intraday" ? "Peak (incl. open P&L)" : "Highest EOD balance"}>
              <input
                type="number"
                inputMode="decimal"
                className={fieldClass}
                value={room.peak}
                placeholder="optional"
                onChange={(e) => patchRoom({ peak: e.target.value })}
              />
            </Field>
            <Field label="Buffer (% of drawdown)">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={90}
                step={5}
                className={fieldClass}
                value={room.bufferPct}
                onChange={(e) =>
                  patchRoom({ bufferPct: Math.min(90, Math.max(0, Number(e.target.value) || 0)) })
                }
              />
            </Field>
          </div>

          {!roomEntered ? (
            <p className="text-[11px] text-[var(--color-subtle)]">Enter the balance from your Apex dashboard.</p>
          ) : (
            <div className="space-y-2">
              {roomRes.roomUsd != null && rules && (
                <div>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-[var(--color-subtle)]">Room to the threshold</span>
                    <span className="font-mono font-semibold" style={{ color: roomTone }}>
                      {money(roomRes.roomUsd)} / {money(rules.drawdown.value)}
                    </span>
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]"
                    role="progressbar"
                    aria-label="Room to the threshold, as a share of the drawdown"
                    aria-valuenow={Math.round(roomFrac * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className="h-full rounded-full" style={{ width: `${roomFrac * 100}%`, background: roomTone }} />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
                <Stat
                  label={`Threshold · ${roomRes.locked ? "locked" : roomRes.thresholdSource === "entered" ? "entered" : roomRes.thresholdSource === "peak" ? "from peak" : "fresh account"}`}
                  value={money(roomRes.thresholdUsd)}
                />
                <Stat label="Room" value={money(roomRes.roomUsd)} />
                <Stat
                  label={`Max ${input.symbol} (keeps ${money(roomRes.bufferUsd)})`}
                  value={roomRes.maxContracts > 0 ? `${roomRes.maxContracts}${roomRes.boundBy === "account-cap" ? " (cap)" : ""}` : "none"}
                  tone={roomRes.maxContracts > 0 ? undefined : "down"}
                />
                <Stat label="House size (20% of room)" value={String(roomRes.houseContracts)} />
                <Stat
                  label="Daily loss limit"
                  value={
                    roomRes.dll.applies === true
                      ? money(roomRes.dll.amountUsd)
                      : roomRes.dll.applies === false
                        ? "none"
                        : "unknown"
                  }
                  tone={roomRes.dll.applies == null ? "warn" : undefined}
                />
              </div>
              {roomRes.refusal ? (
                <p className="text-[11px] text-[var(--color-down)]">{roomRes.refusal}</p>
              ) : (
                <p className="text-[11px] text-[var(--color-subtle)]">
                  {roomRes.maxContracts} × {input.symbol} at {input.stopPts} pt risks{" "}
                  {money(roomRes.maxContracts * roomRes.perContractUsd)}; a full stop-out still leaves{" "}
                  {money((roomRes.roomUsd ?? 0) - roomRes.maxContracts * roomRes.perContractUsd)} above the threshold.
                  That is the liquidation line, not a size — the desk&apos;s house rule would take{" "}
                  {roomRes.houseContracts}.
                </p>
              )}
              <p className="text-[10px] text-[var(--color-subtle)]">
                DLL: {roomRes.dll.note}
                {roomRes.dll.confidence !== "apex" ? ` (${CONFIDENCE_LABEL[roomRes.dll.confidence]})` : ""}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
