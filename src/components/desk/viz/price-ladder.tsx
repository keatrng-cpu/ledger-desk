/**
 * Entry / stop / targets as a vertical price ladder.
 *
 * The plan used to be a grid of strings ("31344.25 (31335.50–31353.00)",
 * "31331.13 · 13.12pt · 0.62×ATR", "no draw ahead · 31390.00 (3.5R)"). The
 * ladder draws the same numbers to scale: the red zone is entry→stop, the
 * green zone entry→T1, so the two HEIGHTS are the R before any number is
 * read; T2 sits beyond as a lighter rung and the live price is a marker on
 * the rail. Every exact number stays printed beside its rung — this is the
 * thing the trader types into a broker. Nothing is computed here but pixels.
 */
import { cn } from "@/lib/utils";

export interface LadderPlan {
  side: "long" | "short";
  entry: number;
  zone?: { top: number; bottom: number } | null;
  stop: number;
  t1: number | null;
  t2: number | null;
  rr1?: number | null;
  rr2?: number | null;
  riskPts?: number | null;
}

const fx = (n: number) => n.toFixed(2);

export function PriceLadder({
  plan,
  price,
  height = 200,
  className,
  t1Label = "T1",
}: {
  plan: LadderPlan;
  /** Live print; drawn as a marker (clamped to the rail when far away). */
  price: number | null;
  height?: number;
  className?: string;
  t1Label?: string;
}) {
  const vals = [plan.entry, plan.stop, plan.t1, plan.t2, plan.zone?.top, plan.zone?.bottom].filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  // The live price joins the scale only when it is near the plan; far away it
  // is pinned to the rail's end with its distance, so the plan stays legible.
  const span0 = Math.max(hi - lo, 1e-6);
  const priceIn = price != null && price >= lo - span0 * 0.6 && price <= hi + span0 * 0.6;
  if (price != null && priceIn) {
    lo = Math.min(lo, price);
    hi = Math.max(hi, price);
  }
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad;
  hi += pad;
  const y = (p: number) => ((hi - p) / (hi - lo)) * height;

  type Rung = { key: string; p: number; label: string; color: string; strong?: boolean };
  const rungs: Rung[] = [
    { key: "stop", p: plan.stop, label: "STOP", color: "var(--color-down)", strong: true },
    { key: "entry", p: plan.entry, label: "ENTRY · CE", color: "var(--color-primary)", strong: true },
  ];
  if (plan.t1 != null) rungs.push({ key: "t1", p: plan.t1, label: `${t1Label}${plan.rr1 != null ? ` · ${plan.rr1.toFixed(1)}R` : ""}`, color: "var(--color-up)", strong: true });
  if (plan.t2 != null) rungs.push({ key: "t2", p: plan.t2, label: `T2${plan.rr2 != null ? ` · ${plan.rr2.toFixed(1)}R` : ""}`, color: "var(--color-up)" });
  // Labels never overlap: walk top→bottom, push each at least 16px below the last.
  const placed = [...rungs].sort((a, b) => y(a.p) - y(b.p)).map((r) => ({ ...r, ly: y(r.p) }));
  for (let i = 1; i < placed.length; i++) placed[i]!.ly = Math.max(placed[i]!.ly, placed[i - 1]!.ly + 16);
  const overflow = Math.max(0, (placed.at(-1)?.ly ?? 0) - (height - 6));
  if (overflow) for (const r of placed) r.ly -= overflow;

  const band = (a: number, b: number) => ({ top: Math.min(y(a), y(b)), h: Math.abs(y(a) - y(b)) });
  const risk = band(plan.entry, plan.stop);
  const reward = plan.t1 != null ? band(plan.entry, plan.t1) : null;
  const toT2 = plan.t2 != null ? band(plan.t1 ?? plan.entry, plan.t2) : null;
  const priceY = price == null ? null : priceIn ? y(price) : price > hi ? 0 : height;
  const away = price == null ? null : price - plan.entry;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="relative w-full" style={{ height }} role="img" aria-label={`Plan ladder: ${plan.side} entry ${fx(plan.entry)}, stop ${fx(plan.stop)}${plan.t1 != null ? `, T1 ${fx(plan.t1)}` : ""}${plan.t2 != null ? `, T2 ${fx(plan.t2)}` : ""}`}>
        {/* The rail. */}
        <div className="absolute inset-y-0 left-[34%] w-[18%] rounded bg-[var(--color-surface-2)]" />
        {/* Risk and reward zones, to scale. */}
        <div className="absolute left-[34%] w-[18%] bg-[color-mix(in_oklab,var(--color-down)_40%,transparent)]" style={{ top: risk.top, height: Math.max(2, risk.h) }} title={`Risk ${plan.riskPts != null ? `${plan.riskPts.toFixed(2)}pt` : fx(Math.abs(plan.entry - plan.stop))}`} />
        {reward && (
          <div className="absolute left-[34%] w-[18%] bg-[color-mix(in_oklab,var(--color-up)_38%,transparent)]" style={{ top: reward.top, height: Math.max(2, reward.h) }} title={`Reward to T1${plan.rr1 != null ? ` ${plan.rr1.toFixed(2)}R` : ""}`} />
        )}
        {toT2 && (
          <div className="absolute left-[34%] w-[18%] bg-[color-mix(in_oklab,var(--color-up)_14%,transparent)]" style={{ top: toT2.top, height: Math.max(2, toT2.h) }} />
        )}
        {plan.zone && (
          <div
            className="absolute left-[32%] w-[22%] border-y border-dashed border-[var(--color-primary)]/60"
            style={{ top: Math.min(y(plan.zone.top), y(plan.zone.bottom)), height: Math.max(2, Math.abs(y(plan.zone.top) - y(plan.zone.bottom))) }}
            title={`Entry array ${fx(plan.zone.bottom)}–${fx(plan.zone.top)}`}
          />
        )}
        {/* Rungs + labels: name left, exact price right. */}
        {placed.map((r) => (
          <div key={r.key}>
            <div className="absolute left-[30%] w-[26%]" style={{ top: y(r.p), height: r.strong ? 2 : 1, background: r.color, opacity: r.strong ? 1 : 0.7 }} />
            <div className="absolute left-0 w-[29%] -translate-y-1/2 truncate pr-1 text-right text-[11px] font-semibold" style={{ top: r.ly, color: r.color }}>
              {r.label}
            </div>
            <div className="absolute left-[58%] -translate-y-1/2 font-mono text-[13px] font-semibold tabular-nums" style={{ top: r.ly, color: r.color }}>
              {fx(r.p)}
            </div>
          </div>
        ))}
        {/* Live price marker. */}
        {priceY != null && price != null && (
          <div className="absolute left-[24%] -translate-y-1/2" style={{ top: priceY, transition: "top 500ms ease-out" }} title={`Live ${fx(price)}`}>
            <div className="flex items-center gap-1">
              <span className="font-mono text-[10px] font-semibold text-[var(--color-fg)]">{priceIn ? "now" : price > hi ? "▲ now" : "▼ now"}</span>
              <span className="h-0 w-0 border-y-[5px] border-l-[7px] border-y-transparent border-l-[var(--color-fg)]" />
            </div>
          </div>
        )}
      </div>
      <p className="mt-1 font-mono text-[11px] text-[var(--color-muted)]">
        {plan.side.toUpperCase()}
        {plan.riskPts != null ? ` · risk ${plan.riskPts.toFixed(2)}pt` : ""}
        {plan.rr1 != null ? ` · 1 : ${plan.rr1.toFixed(2)} to ${t1Label}` : plan.t1 == null ? " · no T1 ahead" : ""}
        {price != null && away != null ? ` · now ${fx(price)} (${away >= 0 ? "+" : "−"}${Math.abs(away).toFixed(2)} from CE)` : ""}
        {plan.zone ? ` · array ${fx(plan.zone.bottom)}–${fx(plan.zone.top)}` : ""}
      </p>
    </div>
  );
}

/** Either plan shape the desk prints (CardPlan / TradePlan) → the ladder's view. No numbers are derived. */
export function ladderFrom(p: {
  side: "long" | "short";
  entry: number;
  entryZone: { top: number; bottom: number } | null;
  stop: number;
  t1: number | null;
  t2: number | null;
  rr1: number | null;
  rr2: number | null;
  riskPts: number;
  drawName?: string | null;
  draw?: { name: string } | null;
}): { plan: LadderPlan; t1Label: string } {
  const name = p.drawName ?? p.draw?.name ?? null;
  return {
    plan: { side: p.side, entry: p.entry, zone: p.entryZone, stop: p.stop, t1: p.t1, t2: p.t2, rr1: p.rr1, rr2: p.rr2, riskPts: p.riskPts },
    t1Label: name ? `T1 ${name}` : "T1",
  };
}
