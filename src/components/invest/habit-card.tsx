/**
 * THE HABIT — the sweep log read back. The store existed to answer "did I
 * actually do this every month" a year from now; nothing on the tab ever
 * asked it. This card does: the rate ladder and what the next step needs,
 * every logged month, the months that were skipped, the swept dollars that
 * were never bought, and where the waiting dollars go.
 */

import { useState } from "react";
import {
  contributionPath,
  deployQueue,
  missedMonths,
  type RateLadder,
} from "@/lib/invest/policy";
import type { LedgerRead } from "@/lib/invest/ledger";
import { sweepFundedUsd } from "@/lib/invest/ledger";
import type { NextBuy } from "@/lib/invest/book";
import { etMonth, voidEntry } from "@/lib/invest/store";
import { BUTTON, INPUT, usd } from "./format";
import { Card, Note } from "./ui";

export function HabitCard({
  ledger,
  ladder,
  next,
  onWrite,
}: {
  ledger: LedgerRead;
  ladder: RateLadder;
  next: NextBuy;
  onWrite: () => void;
}) {
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const sweeps = [...ledger.sweeps].sort((a, b) => (a.month < b.month ? 1 : -1));
  const missed = missedMonths(sweeps, etMonth());
  const queue = deployQueue(sweeps, sweepFundedUsd(ledger), Date.now());
  const avg = sweeps.length ? sweeps.reduce((s, r) => s + r.sweptUsd, 0) / sweeps.length : 0;
  const voidedSweeps = ledger.entries.filter((e) => e.kind === "sweep" && ledger.voided.has(e.id));

  return (
    <Card title="The habit">
      <Note>
        <span className="text-[var(--color-fg)]">Rate · </span>
        {ladder.line}
      </Note>
      {missed.length > 0 && (
        <Note tone="warn">
          Missed {missed.length} month{missed.length === 1 ? "" : "s"}: {missed.join(", ")}. A skipped month is not a flat month —
          log it (a losing or empty month logs as HOLD) so the record stays true.
        </Note>
      )}

      {sweeps.length === 0 ? (
        <Note>No month logged yet. The first one starts the record the 30% and 40% rates are earned from.</Note>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-[11px] tabular-nums">
            <thead className="text-[10px] uppercase text-[var(--color-muted)]">
              <tr className="text-left">
                <th className="py-1 pr-2 font-medium">Month</th>
                <th className="pr-2 font-medium">Word</th>
                <th className="pr-2 text-right font-medium">Realized</th>
                <th className="pr-2 text-right font-medium">Rent</th>
                <th className="pr-2 text-right font-medium">Restore</th>
                <th className="pr-2 text-right font-medium">Swept</th>
                <th className="pr-2 text-right font-medium">Rate</th>
                <th className="font-medium" />
              </tr>
            </thead>
            <tbody>
              {sweeps.map((r) => (
                <tr key={r.id} className="border-t border-[var(--color-border)]">
                  <td className="py-1 pr-2">{r.month}</td>
                  <td className="pr-2 text-[var(--color-muted)]">{r.verdict}</td>
                  <td className={`pr-2 text-right ${r.realizedUsd < 0 ? "text-[var(--color-down)]" : ""}`}>{usd(r.realizedUsd)}</td>
                  <td className="pr-2 text-right">{usd(r.rentUsd)}</td>
                  <td className="pr-2 text-right">{usd(r.restoreUsd)}</td>
                  <td className="pr-2 text-right">{usd(r.sweptUsd)}</td>
                  <td className="pr-2 text-right">{Math.round(r.rate * 100)}%</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="text-[10px] text-[var(--color-muted)] underline underline-offset-2"
                      onClick={() => {
                        setVoiding(r.id);
                        setReason("");
                        setMsg(null);
                      }}
                    >
                      void
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {voiding && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-[var(--color-border)] p-2">
          <span className="text-[11px] text-[var(--color-muted)]">Void {voiding.replace("sweep:", "")} because</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={`min-w-0 flex-1 ${INPUT}`} placeholder="the realized figure was wrong — broker says …" />
          <button
            type="button"
            className={BUTTON}
            disabled={reason.trim().length < 4}
            onClick={() => {
              const res = voidEntry(voiding, reason);
              setMsg(res.ok ? "Voided. The month can be logged again with the right figure." : res.why);
              if (res.ok) {
                setVoiding(null);
                onWrite();
              }
            }}
          >
            Void it
          </button>
          <button type="button" className={BUTTON} onClick={() => setVoiding(null)}>
            Cancel
          </button>
        </div>
      )}
      {msg && <Note>{msg}</Note>}
      {voidedSweeps.length > 0 && (
        <Note>
          Voided: {voidedSweeps.map((e) => `${e.kind === "sweep" ? e.month : e.id} (${ledger.voided.get(e.id)?.reason})`).join(" · ")}
        </Note>
      )}

      <div className="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2">
        <Note>
          <span className="text-[var(--color-fg)]">Deploy · </span>
          {queue.line}
        </Note>
        <Note>
          <span className="text-[var(--color-fg)]">Next buy · </span>
          {next.line}
        </Note>
        {avg > 0 && (
          <Note>
            <span className="text-[var(--color-fg)]">The habit, in dollars · </span>
            at the logged average of {usd(avg)}/month: {contributionPath(avg, 5).line} Ten years:{" "}
            {usd(contributionPath(avg, 10).totalUsd)}. Raise the sweep, not the risk — the lever is the realized month above rent.
          </Note>
        )}
      </div>
    </Card>
  );
}
