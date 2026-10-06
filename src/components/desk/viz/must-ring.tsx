/**
 * The must-layers as a ring, one segment per must (9 on the SMC sequence).
 *
 * Replaces the "● Draw on liquidity ○ POI × Liquidity sweep …" text row: the
 * fill answers "how close is this" before any word is read. Green = passed,
 * amber = pending, red = failed. Every segment carries the layer's own name
 * and detail as a tooltip (SVG <title>), in the order smc-master grades them.
 */
import type { SmcLayer } from "@/lib/trading/smc-master";
import { usePlainify } from "@/components/desk/plain-text";

const COLOR = {
  pass: "var(--color-up)",
  wait: "var(--color-warn)",
  fail: "var(--color-down)",
} as const;

function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)] as const;
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

export function MustRing({
  layers,
  size = 64,
  label,
}: {
  layers: SmcLayer[];
  size?: number;
  /** Small caption under the count (e.g. the symbol). */
  label?: string;
}) {
  const plain = usePlainify();
  const musts = layers.filter((l) => l.must);
  const n = Math.max(1, musts.length);
  const passed = musts.filter((l) => l.state === "pass").length;
  const failed = musts.filter((l) => l.state === "fail").length;
  const c = size / 2;
  const stroke = Math.max(5, size * 0.12);
  const r = c - stroke / 2 - 1;
  const gap = n > 1 ? 0.07 : 0;
  const seg = (2 * Math.PI) / n;
  const summary = `${passed} of ${musts.length} must-layers passed${failed ? `, ${failed} failed` : ""}`;
  return (
    <figure className="m-0 inline-flex shrink-0 flex-col items-center" aria-label={summary}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <title>{summary}</title>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--color-surface-3)" strokeWidth={stroke} />
        {musts.map((l, i) => (
          <path
            key={l.id}
            d={arc(c, c, r, i * seg + gap / 2, (i + 1) * seg - gap / 2)}
            fill="none"
            stroke={COLOR[l.state]}
            strokeWidth={stroke}
            strokeLinecap="butt"
            opacity={l.state === "pass" ? 1 : l.state === "fail" ? 0.95 : 0.55}
            style={{ transition: "stroke 300ms, opacity 300ms" }}
          >
            <title>{`${i + 1}. ${plain(l.label)} — ${l.state === "pass" ? "passed" : l.state === "fail" ? "failed" : "pending"}${l.detail ? `: ${plain(l.detail)}` : ""}`}</title>
          </path>
        ))}
        <text
          x={c}
          y={c + size * 0.07}
          textAnchor="middle"
          fontSize={size * 0.26}
          fontWeight={700}
          fill="var(--color-fg)"
          className="tabular"
        >
          {passed}/{musts.length}
        </text>
      </svg>
      {label && <figcaption className="mt-0.5 font-mono text-[11px] text-[var(--color-muted)]">{label}</figcaption>}
    </figure>
  );
}
