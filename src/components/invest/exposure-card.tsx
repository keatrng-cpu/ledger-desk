/**
 * WHAT THE BOOK ACTUALLY OWNS — the funds opened up.
 *
 * The old concentration line counted only DIRECT tech holdings, so a book
 * that was 100% VTI read "0% tech, not doubling the sleeve" while VTI is a
 * third information technology and overlaps QQQ by nearly half its weight.
 * Before anything is held this shows the default landing pad (all VTI),
 * because "what does my first swept dollar own" is the useful question.
 */

import type { ExposureRead } from "@/lib/invest/exposure";
import { fundProfile, profilesCapturedAt, OVERLAP_WARN, TECH_SECTORS } from "@/lib/invest/exposure";
import type { DryPowderRead } from "@/lib/invest/book";
import { pct, usd } from "./format";
import { Card, Note, ShareBar } from "./ui";

function techOf(t: string): number | null {
  const p = fundProfile(t);
  if (!p || !p.sectorsReliable) return null;
  return TECH_SECTORS.reduce((s, k) => s + (p.sectors[k] ?? 0), 0);
}

export function ExposureCard({ read, dry }: { read: ExposureRead; dry: DryPowderRead }) {
  const refs = ["VTI", "SPY", "QQQ"].map((t) => ({ t, tech: techOf(t) }));
  return (
    <Card title={read.preview ? "What the first swept dollar owns" : "What the book actually owns"}>
      <p
        className={`text-[11px] leading-relaxed ${read.warn ? "text-[var(--color-warn)]" : "text-[var(--color-fg)]"}`}
      >
        {read.line}
      </p>

      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex justify-between text-[10px] uppercase text-[var(--color-muted)]">
            <span>Overlap with QQQ</span>
            <span className="tabular-nums">{pct(read.overlapQQQ)}</span>
          </div>
          <ShareBar value={read.overlapQQQ} mark={OVERLAP_WARN} label={`Overlap with QQQ ${pct(read.overlapQQQ)}`} />
          <p className="mt-1 text-[10px] text-[var(--color-muted)]">
            Σ min(weight here, weight in QQQ). The tick is {pct(OVERLAP_WARN, 0)} — where the tab starts saying it.
            {read.overlapPartial ? " Part of the book sits in a fund whose holdings list is partial, so this reads low." : ""}
          </p>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-[10px] uppercase text-[var(--color-muted)]">
            <span>Tech + communication</span>
            <span className="tabular-nums">{pct(read.techWeight)}</span>
          </div>
          <ShareBar value={read.techWeight} label={`Tech and communication ${pct(read.techWeight)}`} />
          <p className="mt-1 text-[10px] text-[var(--color-muted)]">
            For reference: {refs.map((r) => `${r.t} ${pct(r.tech)}`).join(" · ")}.
            {read.sectorUnknown > 0.005 ? ` Sector split unknown for ${pct(read.sectorUnknown)} of the book (VXUS in this source).` : ""}
          </p>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[420px] text-[11px] tabular-nums">
          <thead className="text-[10px] uppercase text-[var(--color-muted)]">
            <tr className="text-left">
              <th className="py-1 pr-2 font-medium">Company</th>
              <th className="pr-2 text-right font-medium">Of the book</th>
              <th className="pr-2 text-right font-medium">Direct</th>
              <th className="pr-2 text-right font-medium">Inside funds</th>
              <th className="text-right font-medium">Of QQQ</th>
            </tr>
          </thead>
          <tbody>
            {read.names.slice(0, 8).map((n) => (
              <tr key={n.ticker} className="border-t border-[var(--color-border)]">
                <td className="py-1 pr-2">{n.ticker}</td>
                <td className="pr-2 text-right">{pct(n.weight, 2)}</td>
                <td className="pr-2 text-right">{n.direct > 0 ? pct(n.direct, 2) : "—"}</td>
                <td className="pr-2 text-right">{n.viaFunds > 0 ? pct(n.viaFunds, 2) : "—"}</td>
                <td className="text-right">{n.inQQQ > 0 ? pct(n.inQQQ, 2) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2">
        <Note>
          <span className="text-[var(--color-fg)]">Sectors · </span>
          {read.sectors
            .slice(0, 6)
            .map((s) => `${s.sector.toLowerCase()} ${pct(s.weight)}`)
            .join(" · ")}
        </Note>
        {!read.preview && (
          <Note>
            <span className="text-[var(--color-fg)]">Fees · </span>
            {usd(read.feeUsdYear)}/year at a blended {pct(read.feeBlended, 3)} expense ratio. At this size the fee is not the
            problem — the rent is.
          </Note>
        )}
        <Note tone={dry.armed ? "warn" : undefined}>
          <span className="text-[var(--color-fg)]">Dry powder · </span>
          {dry.line}
        </Note>
        <Note>
          Fund holdings and sectors: Alpha Vantage ETF_PROFILE, issuer data as of {fundProfile("VTI")?.asOf ?? "—"} (captured{" "}
          {profilesCapturedAt()}). Look-through is arithmetic about the book — it moves no verdict except to size a direct buy
          against the cap including what your funds already hold.
        </Note>
      </div>
    </Card>
  );
}
