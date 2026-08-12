import { useEffect, useMemo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle, NotebookPen, X } from "lucide-react";
import type { SetupCandidate } from "@/lib/trading/scanner";
import {
  APLUS_RULES,
  CONTRACTS,
  riskPctForScore,
  riskGradeFromScore,
  type ContractKey,
} from "@/lib/aplus/config";
import {
  openTrade,
  type JournalTrade,
  type OpenTradeInput,
} from "@/lib/journal/server";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { rememberLiveSetup } from "@/lib/trading/desk-memory";
import { buildPaperLevels } from "@/lib/trading/paper-manager";

const SYMBOLS = Object.keys(CONTRACTS) as ContractKey[];

const formSchema = z
  .object({
    symbol: z.enum(SYMBOLS as [ContractKey, ...ContractKey[]]),
    side: z.enum(["long", "short"]),
    mode: z.enum(["live", "paper"]),
    entry: z.number({ message: "Entry required" }).finite().positive(),
    stop: z.number({ message: "Stop required" }).finite().positive(),
    target: z.number().finite().positive().optional(),
    contracts: z.number({ message: "Contracts required" }).int().min(1).max(1000),
  })
  .superRefine((v, ctx) => {
    if (v.side === "long" ? v.stop >= v.entry : v.stop <= v.entry) {
      ctx.addIssue({
        code: "custom",
        path: ["stop"],
        message: `Stop must be ${v.side === "long" ? "below" : "above"} entry`,
      });
    }
    if (
      v.target != null &&
      (v.side === "long" ? v.target <= v.entry : v.target >= v.entry)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["target"],
        message: `Target must be ${v.side === "long" ? "above" : "below"} entry`,
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

/** First price-looking number in a scanner string ("18250.25 – 18300.00"). */
function firstNumber(s: string | undefined): number | undefined {
  const m = s?.match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : undefined;
}

function defaultsFrom(
  candidate: SetupCandidate,
  mode: "paper" | "live" = "paper",
  equity: number = 100_000,
): Partial<FormValues> {
  const levels = buildPaperLevels(candidate, equity);
  return {
    symbol: levels.symbol,
    side: levels.side,
    mode,
    entry: levels.entry,
    stop: levels.stop,
    target: levels.tp1,
    contracts: levels.contracts,
  };
}

const fieldClass =
  "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 font-mono text-xs text-[var(--color-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";

/**
 * Log-setup dialog — prefilled from a scanner SetupCandidate. Shows planned
 * $risk vs allowed risk (equity x 0.5%) with a red oversized warning. Submits
 * via the openTrade server fn (which re-validates everything server-side).
 */
export function LogSetupDialog({
  candidate,
  equity,
  killzone,
  open,
  onOpenChange,
  onLogged,
  defaultMode = "paper",
}: {
  candidate: SetupCandidate;
  /** Account equity from desk_settings (getSettings). */
  equity: number;
  /** Current killzone id/label from the session clock, stored on the trade. */
  killzone?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogged?: (trade: JournalTrade) => void;
  /** Prefill paper vs live — set by Paper / Live buttons on the scanner. */
  defaultMode?: "paper" | "live";
}) {
  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultsFrom(candidate, defaultMode),
  });

  // Re-prefill when the dialog opens on a (possibly different) candidate/mode.
  useEffect(() => {
    if (open) reset(defaultsFrom(candidate, defaultMode, equity));
  }, [open, candidate, defaultMode, equity, reset]);

  const [entry, stop, contracts, symbol, mode] = watch([
    "entry",
    "stop",
    "contracts",
    "symbol",
    "mode",
  ]);
  const contract = CONTRACTS[symbol ?? "MNQ"];
  const plannedRisk = useMemo(() => {
    if (!entry || !stop || !contracts || !contract) return null;
    return Math.abs(entry - stop) * contract.pointValue * contracts;
  }, [entry, stop, contracts, contract]);
  const gradePct = riskPctForScore(candidate.confluence);
  const gradeLabel = riskGradeFromScore(candidate.confluence);
  const allowedRisk = equity * gradePct;

  const oversized = plannedRisk != null && plannedRisk > allowedRisk;

  const submit = handleSubmit(async (values) => {
    try {
      const input: OpenTradeInput = {
        symbol: values.symbol,
        side: values.side,
        entry: values.entry,
        stop: values.stop,
        target: values.target,
        contracts: values.contracts,
        mode: values.mode,
        source: "desk",
        prescore: candidate.confluence,
        grade: candidate.grade,
        killzone,
        componentsPresent: candidate.components ?? candidate.reasons,
        componentsMissing: candidate.missing,
        // Attribution + the profit-rule inputs the server gate reads. Passing
        // these explicitly is what turns the HTF gate on server-side (it
        // defaults permissive when absent) and what gives Phase C something to
        // group by — the scoreboard is blank without them.
        strategyPrimary: candidate.strategyPrimary,
        pathBand: candidate.pathBand,
        regime: candidate.regime,
        htfOk: candidate.htfOk,
        actionable: candidate.actionable,
        reason: [
          candidate.title,
          candidate.strategyPrimary
            ? `strategy:${candidate.strategyPrimary}`
            : null,
          `mode:${values.mode}`,
        ]
          .filter(Boolean)
          .join(" · "),
      };
      const trade = await openTrade({ data: input });
      rememberLiveSetup({
        symbol: input.symbol,
        side: input.side,
        grade: candidate.grade,
        score: candidate.confluence,
        mode: input.mode === "live" ? "live" : "paper",
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("ledger-memory"));
      }
      onOpenChange(false);
      onLogged?.(trade);
    } catch (e) {
      setError("root", {
        message: e instanceof Error ? e.message : "Failed to log trade",
      });
    }
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xl focus:outline-none">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <Dialog.Title className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                <NotebookPen className="h-4 w-4 text-[var(--color-primary)]" />
                Log {mode === "live" ? "LIVE" : "PAPER"} — {candidate.symbol}{" "}
                <span
                  className={
                    candidate.side === "long"
                      ? "text-[var(--color-up)]"
                      : "text-[var(--color-down)]"
                  }
                >
                  {candidate.side.toUpperCase()}
                </span>
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-[var(--color-subtle)]">
                {candidate.grade} · conf {candidate.confluence.toFixed(2)} ·{" "}
                {candidate.title}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="rounded-md p-1 text-[var(--color-subtle)] transition-colors hover:text-[var(--color-fg)]"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={(e) => void submit(e)} className="space-y-3">
            <div>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-subtle)]">
                Journal as
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setValue("mode", "paper", { shouldDirty: true })}
                  className={cn(
                    "rounded-[var(--radius-md)] border px-3 py-2.5 text-left transition-colors",
                    mode === "paper"
                      ? "border-[color-mix(in_oklab,var(--color-primary)_50%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)]"
                      : "border-[var(--color-border)] bg-[var(--color-surface-2)] hover:border-[var(--color-border-strong)]",
                  )}
                >
                  <span className="block text-sm font-semibold text-[var(--color-fg)]">
                    Paper
                  </span>
                  <span className="mt-0.5 block text-[10px] text-[var(--color-subtle)]">
                    Simulated — builds path sample risk-free
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setValue("mode", "live", { shouldDirty: true })}
                  className={cn(
                    "rounded-[var(--radius-md)] border px-3 py-2.5 text-left transition-colors",
                    mode === "live"
                      ? "border-[color-mix(in_oklab,var(--color-warn)_50%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-warn)_12%,transparent)]"
                      : "border-[var(--color-border)] bg-[var(--color-surface-2)] hover:border-[var(--color-border-strong)]",
                  )}
                >
                  <span className="block text-sm font-semibold text-[var(--color-warn)]">
                    Live
                  </span>
                  <span className="mt-0.5 block text-[10px] text-[var(--color-subtle)]">
                    Real capital — only after A-path is proven
                  </span>
                </button>
              </div>
              <input type="hidden" {...register("mode")} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
                  Symbol
                </span>
                <select {...register("symbol")} className={fieldClass}>
                  {SYMBOLS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
                  Side
                </span>
                <select {...register("side")} className={fieldClass}>
                  <option value="long">long</option>
                  <option value="short">short</option>
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["entry", "Entry"],
                  ["stop", "Stop"],
                  ["target", "Target (opt)"],
                  ["contracts", "Contracts"],
                ] as const
              ).map(([name, label]) => (
                <label key={name} className="block text-xs">
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
                    {label}
                  </span>
                  <input
                    type="number"
                    step={name === "contracts" ? 1 : contract?.tick ?? 0.25}
                    inputMode="decimal"
                    {...register(name, {
                      setValueAs: (v: unknown) =>
                        v === "" || v == null ? undefined : Number(v),
                    })}
                    className={cn(
                      fieldClass,
                      errors[name] &&
                        "border-[var(--color-down)] focus:ring-[var(--color-down)]",
                    )}
                  />
                  {errors[name] && (
                    <span className="mt-0.5 block text-[10px] text-[var(--color-down)]">
                      {errors[name]?.message}
                    </span>
                  )}
                </label>
              ))}
            </div>

            {/* Risk sizing readout */}
            <div
              className={cn(
                "rounded-[var(--radius-md)] border px-3 py-2 font-mono text-xs",
                oversized
                  ? "border-[color-mix(in_oklab,var(--color-down)_50%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-down)_10%,transparent)] text-[var(--color-down)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)]",
              )}
            >
              <div className="flex justify-between">
                <span>Planned risk (1R)</span>
                <span>
                  {plannedRisk != null ? `$${plannedRisk.toFixed(2)}` : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>
                  Allowed ({(gradePct * 100).toFixed(0)}% {gradeLabel} of $
                  {equity.toLocaleString()})
                </span>
                <span>${allowedRisk.toFixed(2)}</span>
              </div>
              {oversized && (
                <p className="mt-1.5 flex items-center gap-1.5 font-sans font-medium">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Oversized — exceeds the {(gradePct * 100).toFixed(0)}% {gradeLabel} risk
                  rule. Reduce contracts or tighten the stop.
                </p>
              )}
            </div>

            {errors.root && (
              <p className="text-xs text-[var(--color-down)]">
                {errors.root.message}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" size="sm">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting
                  ? "Logging…"
                  : mode === "live"
                    ? "Save LIVE trade"
                    : "Save PAPER trade"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
