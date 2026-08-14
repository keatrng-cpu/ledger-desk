import {
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  Clock3,
  Crosshair,
  Minus,
  Newspaper,
  ShieldAlert,
  Sunrise,
} from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import {
  buildSessionBrief,
  type PathPlan,
  type PricedLevel,
  type SessionBrief,
} from "@/lib/trading/session-brief";
import { cn } from "@/lib/utils";

function fmt(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function VerdictBanner({ brief }: { brief: SessionBrief }) {
  const tone =
    brief.verdict === "stand_down"
      ? "border-[color-mix(in_oklab,var(--color-down)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-down)_10%,transparent)]"
      : brief.verdict === "reduce"
        ? "border-[color-mix(in_oklab,var(--color-warn)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)]"
        : "border-[color-mix(in_oklab,var(--color-up)_40%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-up)_8%,transparent)]";
  const word =
    brief.verdict === "stand_down"
      ? "Stand down"
      : brief.verdict === "reduce"
        ? "Reduce"
        : "Trade";
  return (
    <div className={cn("rounded-[var(--radius-md)] border px-3 py-3 sm:px-4", tone)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-subtle)]">
            Session brief
          </p>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-[var(--color-fg)]">
            {word}
            <span className="mx-2 text-[var(--color-subtle)]">·</span>
            <span className="font-medium text-[var(--color-muted)]">
              {brief.headline.replace(/^(STAND DOWN|REDUCE|TRADE) · /, "")}
            </span>
          </h2>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
            <Clock3 className="h-3.5 w-3.5 shrink-0" />
            {brief.clockLine}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-semibold tabular text-[var(--color-fg)]">
            {brief.score}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
            day quality
          </p>
        </div>
      </div>
      <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--color-muted)]">
        <Newspaper className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{brief.newsLine}</span>
      </p>
      {brief.standDownReasons.length > 0 && (
        <ul className="mt-2 space-y-1">
          {brief.standDownReasons.map((r) => (
            <li
              key={r}
              className="flex gap-1.5 text-xs font-medium text-[var(--color-down)]"
            >
              <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {r}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LevelRow({ l }: { l: PricedLevel }) {
  return (
    <li className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-0.5 border-b border-[var(--color-border)]/60 py-1.5 last:border-0">
      <span className="text-xs text-[var(--color-fg)]">{l.name}</span>
      <span className="font-mono text-xs tabular text-[var(--color-fg)]">
        {fmt(l.price)}
      </span>
      <span className="text-[10px] text-[var(--color-subtle)]">{l.window}</span>
      <span
        className={cn(
          "text-[10px] font-medium uppercase tracking-wide",
          l.swept ? "text-[var(--color-warn)]" : "text-[var(--color-subtle)]",
        )}
      >
        {l.swept ? "swept" : l.scope}
      </span>
    </li>
  );
}

function PathCard({
  plan,
  accent,
  featured,
}: {
  plan: PathPlan;
  accent: "up" | "down";
  featured: boolean;
}) {
  const color = accent === "up" ? "var(--color-up)" : "var(--color-down)";
  const Icon = accent === "up" ? ArrowUpRight : ArrowDownRight;
  const statusLabel =
    plan.status === "armed"
      ? "Armed"
      : plan.status === "invalid"
        ? "Off"
        : "Wait";
  return (
    <article
      className={cn(
        "flex flex-col rounded-[var(--radius-md)] border bg-[var(--color-surface)] p-3 sm:p-4",
        featured
          ? "border-[color-mix(in_oklab,var(--color-primary)_40%,var(--color-border))]"
          : "border-[var(--color-border)]",
        plan.status === "invalid" && "opacity-70",
      )}
    >
      <header className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color }}
          >
            <Icon className="h-3.5 w-3.5" />
            {plan.side === "long" ? "Bullish path" : "Bearish path"}
          </p>
          <p className="mt-1 text-sm font-medium leading-snug text-[var(--color-fg)]">
            {plan.headline}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
            plan.status === "armed" &&
              "border-[color-mix(in_oklab,var(--color-up)_45%,var(--color-border))] text-[var(--color-up)]",
            plan.status === "wait" &&
              "border-[var(--color-border)] text-[var(--color-subtle)]",
            plan.status === "invalid" &&
              "border-[color-mix(in_oklab,var(--color-down)_40%,var(--color-border))] text-[var(--color-down)]",
          )}
        >
          {statusLabel}
        </span>
      </header>

      {plan.trigger && (
        <div className="mb-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)]/60 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
            {plan.trigger.swept ? "Raid already in" : "Trigger raid"}
          </p>
          <p className="mt-0.5 font-mono text-sm tabular text-[var(--color-fg)]">
            {fmt(plan.trigger.price)}
            <span className="ml-2 font-sans text-xs text-[var(--color-muted)]">
              {plan.trigger.name}
            </span>
          </p>
          <p className="text-[10px] text-[var(--color-subtle)]">
            {plan.trigger.window}
            {plan.trigger.swept ? " · swept" : " · untapped"}
          </p>
        </div>
      )}

      <dl className="space-y-2 text-xs">
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
            Confirm
          </dt>
          <dd className="mt-1 space-y-1 text-[var(--color-muted)]">
            {plan.confirm.map((c) => (
              <p key={c} className="leading-snug">
                {c}
              </p>
            ))}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
            Entry
          </dt>
          <dd className="mt-0.5 font-mono text-[var(--color-fg)]">{plan.entry}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
            Invalidation
          </dt>
          <dd className="mt-0.5 text-[var(--color-muted)]">{plan.invalidation}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
            Targets
          </dt>
          <dd className="mt-1 space-y-1">
            {plan.targets.map((t) => (
              <p key={`${t.name}-${t.price}`} className="flex justify-between gap-2">
                <span className="text-[var(--color-muted)]">
                  {t.name}
                  <span className="ml-1.5 text-[10px] text-[var(--color-subtle)]">
                    {t.window}
                  </span>
                </span>
                <span className="font-mono tabular text-[var(--color-fg)]">
                  {fmt(t.price)}
                </span>
              </p>
            ))}
            {!plan.targets.length && (
              <p className="text-[var(--color-subtle)]">No magnet priced yet</p>
            )}
          </dd>
        </div>
        <p className="flex items-center gap-1.5 pt-1 text-[10px] text-[var(--color-subtle)]">
          <Crosshair className="h-3 w-3" />
          {plan.timeWindow}
        </p>
      </dl>
    </article>
  );
}

export function PremarketPanel({ desk }: { desk: DeskPayload }) {
  const brief = desk.brief ?? buildSessionBrief(desk);
  const { left, right } = brief.books;

  return (
    <section className="space-y-3">
      <VerdictBanner brief={brief} />

      {brief.reasons.length > 0 && (
        <ul className="space-y-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5">
          {brief.reasons.map((r) => (
            <li key={r} className="flex gap-2 text-xs leading-snug text-[var(--color-muted)]">
              <Minus className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-subtle)]" />
              {r}
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <PathCard
          plan={brief.bull}
          accent="up"
          featured={brief.primaryPath === "bull"}
        />
        <PathCard
          plan={brief.bear}
          accent="down"
          featured={brief.primaryPath === "bear"}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {[left, right].map((b) => (
          <div
            key={b.symbol}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:p-4"
          >
            <header className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--color-fg)]">
                {b.symbol}
                <span className="ml-2 text-xs font-normal text-[var(--color-subtle)]">
                  HTF {b.htf} · sess {b.session} {Math.round(b.sessionStrength * 100)}% · {b.zone}
                </span>
              </h3>
              <span className="font-mono text-sm tabular text-[var(--color-fg)]">
                {fmt(b.last)}
              </span>
            </header>
            {b.dealing && (
              <p className="mb-2 text-[10px] text-[var(--color-subtle)]">
                Range {fmt(b.dealing.low)} – {fmt(b.dealing.high)} · EQ {fmt(b.dealing.eq)} ·
                dealing range
                {b.lastBos
                  ? ` · BOS ${b.lastBos.direction} @ ${fmt(b.lastBos.level)} ${b.lastBos.at}`
                  : ""}
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-down)]">
                  Sell-side · SSL
                </p>
                <ul>
                  {b.ssl.slice(0, 4).map((l) => (
                    <LevelRow key={`s-${l.name}-${l.price}`} l={l} />
                  ))}
                  {!b.ssl.length && (
                    <li className="text-xs text-[var(--color-subtle)]">No SSL mapped</li>
                  )}
                </ul>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-up)]">
                  Buy-side · BSL
                </p>
                <ul>
                  {b.bsl.slice(0, 4).map((l) => (
                    <LevelRow key={`b-${l.name}-${l.price}`} l={l} />
                  ))}
                  {!b.bsl.length && (
                    <li className="text-xs text-[var(--color-subtle)]">No BSL mapped</li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
        {brief.gates.map((g) => (
          <div
            key={g.id}
            className={cn(
              "rounded-[var(--radius-sm)] border px-2.5 py-2",
              g.ok
                ? "border-[color-mix(in_oklab,var(--color-up)_28%,var(--color-border))]"
                : "border-[var(--color-border)]",
            )}
          >
            <p
              className={cn(
                "text-[10px] font-medium uppercase tracking-wider",
                g.ok ? "text-[var(--color-up)]" : "text-[var(--color-subtle)]",
              )}
            >
              {g.ok ? "OK" : "WAIT"} · {g.label}
            </p>
            <p className="mt-0.5 line-clamp-3 text-xs text-[var(--color-muted)]">
              {g.detail}
            </p>
          </div>
        ))}
      </div>

      <p className="flex items-center gap-1.5 text-[10px] text-[var(--color-subtle)]">
        <Sunrise className="h-3 w-3" />
        Built from structure + calendar + session clock · prices in index points · all times America/New_York
        {brief.verdict === "stand_down" && (
          <span className="ml-1 inline-flex items-center gap-1 text-[var(--color-down)]">
            <ShieldAlert className="h-3 w-3" /> no new risk
          </span>
        )}
      </p>
    </section>
  );
}
