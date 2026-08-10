import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  ImagePlus,
  Loader2,
  MessagesSquare,
  Send,
  Trash2,
  X,
} from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import {
  analyzeTradezellaChat,
  type TradezellaChatResult,
} from "@/lib/trading/tradezella-server";
import type { TradezellaAnalysis } from "@/lib/trading/tradezella-analyze";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Role = "user" | "assistant" | "system";

interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  imageDataUrl?: string | null;
  imageName?: string | null;
  analysis?: TradezellaAnalysis;
  markdown?: string;
  ts: number;
}

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "system",
  text: "TradeZella lab · paste session stats and/or drop a backtest chart. I map HTF/MTF/LTF, conditions, confluences, strategies, S/L, targets, and setup cards to our engine (TJR · mechanical · Judas · PDI · Patty · SMT…). Not an order — structure only.",
  ts: Date.now(),
};

const QUICK = [
  "WR 64.3% · 14 trades · net $2500 · MNQ May — grade vs path 70%",
  "Chart attached: mark HTF bias, sweep, IFVG, S/L and targets",
  "Complete NY AM backtest checklist for this session",
  "Which strategies fired? List confluences present vs missing",
];

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function BiasPill({ bias }: { bias: string }) {
  return (
    <span
      className={cn(
        "rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase",
        bias === "bull" &&
          "border-[color-mix(in_oklab,var(--color-up)_40%,var(--color-border))] text-[var(--color-up)]",
        bias === "bear" &&
          "border-[color-mix(in_oklab,var(--color-down)_40%,var(--color-border))] text-[var(--color-down)]",
        bias !== "bull" &&
          bias !== "bear" &&
          "border-[var(--color-border)] text-[var(--color-subtle)]",
      )}
    >
      {bias}
    </span>
  );
}

function AnalysisCard({ a }: { a: TradezellaAnalysis }) {
  return (
    <div className="mt-2 space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs">
      <div>
        <p className="text-sm font-semibold text-[var(--color-fg)]">{a.title}</p>
        <p className="mt-1 text-[var(--color-muted)]">{a.summary}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
            WR
          </p>
          <p className="font-mono font-semibold text-[var(--color-fg)]">
            {a.stats.winRate != null
              ? `${(a.stats.winRate * 100).toFixed(1)}%`
              : "—"}
          </p>
        </div>
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
            Trades
          </p>
          <p className="font-mono font-semibold text-[var(--color-fg)]">
            {a.stats.trades ?? "—"}
          </p>
        </div>
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
            Net
          </p>
          <p className="font-mono font-semibold text-[var(--color-fg)]">
            {a.stats.netPnl != null ? `$${a.stats.netPnl}` : "—"}
          </p>
        </div>
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
            Path target
          </p>
          <p className="font-mono font-semibold text-[var(--color-primary)]">
            {(a.systemAlignment.pathWrTarget * 100).toFixed(0)}%
          </p>
        </div>
      </div>

      <p className="text-[var(--color-muted)]">{a.systemAlignment.wrVsTarget}</p>

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          HTF · MTF · LTF
        </p>
        <div className="space-y-1.5">
          {a.timeframes.map((tf) => (
            <div key={tf.tf} className="flex flex-wrap items-start gap-2">
              <span className="w-10 font-mono text-[10px] font-bold text-[var(--color-fg)]">
                {tf.tf}
              </span>
              <BiasPill bias={tf.bias} />
              <span className="min-w-0 flex-1 text-[var(--color-muted)]">
                {tf.label} — {tf.notes}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          Conditions
        </p>
        <p className="text-[var(--color-muted)]">
          {a.conditions.regime} · {a.conditions.volatility} vol ·{" "}
          {a.conditions.session} · news {a.conditions.news}
          {a.conditions.tradeable ? " · tradeable env" : " · stand down env"}
        </p>
      </div>

      {a.strategiesHit.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
            Strategies
          </p>
          <div className="flex flex-wrap gap-1">
            {a.strategiesHit.map((s) => (
              <span
                key={s.id}
                title={s.why}
                className="rounded-full border border-[color-mix(in_oklab,var(--color-primary)_40%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_10%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-primary)]"
              >
                {s.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {a.setups.map((s) => (
        <div
          key={s.id}
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5"
        >
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-fg)]">
              Setup · {String(s.strategy)} · {s.side.toUpperCase()}
            </span>
            <span className="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px]">
              {s.grade} · {s.confluenceScore.toFixed(2)}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
            <p>
              <span className="text-[var(--color-subtle)]">Entry </span>
              <span className="font-mono text-[var(--color-fg)]">{s.entry}</span>
            </p>
            <p>
              <span className="text-[var(--color-subtle)]">S/L </span>
              <span className="font-mono text-[var(--color-down)]">{s.stop}</span>
            </p>
            <p>
              <span className="text-[var(--color-subtle)]">TP </span>
              <span className="font-mono text-[var(--color-up)]">
                {s.targets.join(" · ")}
              </span>
            </p>
          </div>
          <p className="mt-1 text-[var(--color-muted)]">R:R {s.rr}</p>
          <p className="mt-1 text-[var(--color-muted)]">
            <span className="text-[var(--color-up)]">+</span>{" "}
            {s.confluencesPresent.join(", ") || "—"}
          </p>
          <p className="text-[var(--color-muted)]">
            <span className="text-[var(--color-down)]">−</span>{" "}
            {s.confluencesMissing.slice(0, 6).join(", ") || "—"}
          </p>
          <p className="mt-1 text-[var(--color-subtle)]">{s.notes}</p>
        </div>
      ))}

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          Confluences present
        </p>
        <div className="flex flex-wrap gap-1">
          {a.confluences
            .filter((c) => c.present)
            .map((c) => (
              <span
                key={c.key}
                className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--color-muted)]"
              >
                {c.key}
              </span>
            ))}
          {!a.confluences.some((c) => c.present) && (
            <span className="text-[var(--color-subtle)]">
              none parsed — use chart + keywords (sweep, ifvg, smt…)
            </span>
          )}
        </div>
      </div>

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          Backtest checklist
        </p>
        <ul className="space-y-0.5">
          {a.backtestChecklist.map((b) => (
            <li key={b.item} className="flex gap-2 text-[var(--color-muted)]">
              <span
                className={cn(
                  "font-mono text-[10px] uppercase",
                  b.status === "pass" && "text-[var(--color-up)]",
                  b.status === "fail" && "text-[var(--color-down)]",
                  b.status === "unknown" && "text-[var(--color-warn)]",
                )}
              >
                {b.status === "pass" ? "OK" : b.status === "fail" ? "NO" : "??"}
              </span>
              <span>
                {b.item}
                <span className="text-[var(--color-subtle)]"> — {b.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          Next
        </p>
        <ol className="list-decimal space-y-0.5 pl-4 text-[var(--color-muted)]">
          {a.nextActions.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ol>
      </div>

      <p className="text-[10px] text-[var(--color-subtle)]">{a.disclaimer}</p>
    </div>
  );
}

export function TradezellaChat({ desk }: { desk?: DeskPayload | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [text, setText] = useState("");
  const [pendingImage, setPendingImage] = useState<{
    dataUrl: string;
    name: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const onFile = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Upload an image (PNG/JPG of the TradeZella chart).");
      return;
    }
    if (file.size > 4_500_000) {
      setError("Image too large (max ~4.5MB). Compress or crop the chart.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      setPendingImage({ dataUrl, name: file.name });
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const send = useCallback(async () => {
    const msg = text.trim();
    if (!msg && !pendingImage) return;
    setBusy(true);
    setError(null);

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      text: msg || "(chart only — run system checklist)",
      imageDataUrl: pendingImage?.dataUrl,
      imageName: pendingImage?.name,
      ts: Date.now(),
    };
    setMessages((m) => [...m, userMsg]);
    setText("");
    const img = pendingImage;
    setPendingImage(null);

    try {
      const deskContext = desk
        ? {
            htfLeft: `${desk.bias.left.symbol} ${desk.bias.left.topDown} — ${desk.bias.left.summary}`,
            htfRight: `${desk.bias.right.symbol} ${desk.bias.right.topDown} — ${desk.bias.right.summary}`,
            killzone: desk.clock.killzoneLabel,
            smt: desk.scan.smt.note,
            bestSetup: desk.scan.candidates[0]
              ? `${desk.scan.candidates[0].symbol} ${desk.scan.candidates[0].side} ${desk.scan.candidates[0].grade} ${desk.scan.candidates[0].confluence}`
              : undefined,
          }
        : undefined;

      const result: TradezellaChatResult = await analyzeTradezellaChat({
        data: {
          message: userMsg.text,
          imageDataUrl: img?.dataUrl ?? null,
          imageName: img?.name ?? null,
          deskContext,
        },
      });

      const assistant: ChatMessage = {
        id: uid(),
        role: "assistant",
        text: result.analysis.summary,
        analysis: result.analysis,
        markdown: result.markdown,
        ts: Date.now(),
      };
      setMessages((m) => [...m, assistant]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setBusy(false);
    }
  }, [text, pendingImage, desk]);

  return (
    <section className="flex min-h-[420px] flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-primary-dim)] text-[var(--color-primary)]">
            <MessagesSquare className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-fg)]">
              TradeZella lab · chart & session chat
            </h2>
            <p className="text-[11px] text-[var(--color-subtle)]">
              Drop charts · paste WR/trades/PnL · get HTF/MTF/LTF · S/L · targets ·
              strategies · confluences
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setMessages([WELCOME]);
            setError(null);
            setPendingImage(null);
          }}
          title="Clear chat"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </Button>
      </header>

      <div className="flex flex-wrap gap-1.5 border-b border-[var(--color-border)] px-3 py-2">
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setText(q)}
            className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1 text-left text-[10px] text-[var(--color-muted)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]"
          >
            {q.length > 52 ? `${q.slice(0, 52)}…` : q}
          </button>
        ))}
      </div>

      <div className="max-h-[min(520px,55vh)] flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "flex",
              m.role === "user" ? "justify-end" : "justify-start",
            )}
          >
            <div
              className={cn(
                "max-w-[min(100%,36rem)] rounded-[var(--radius-md)] px-3 py-2 text-sm",
                m.role === "user" &&
                  "bg-[color-mix(in_oklab,var(--color-primary)_14%,var(--color-surface-2))] text-[var(--color-fg)]",
                m.role === "assistant" &&
                  "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)]",
                m.role === "system" &&
                  "border border-dashed border-[var(--color-border)] bg-transparent text-[var(--color-subtle)]",
              )}
            >
              {m.imageDataUrl && (
                <div className="mb-2 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)]">
                  <img
                    src={m.imageDataUrl}
                    alt={m.imageName || "TradeZella chart"}
                    className="max-h-48 w-full object-contain bg-[var(--color-surface-2)]"
                  />
                </div>
              )}
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.analysis && <AnalysisCard a={m.analysis} />}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-[var(--color-subtle)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Mapping to engine rules…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="px-4 text-xs text-[var(--color-down)]">{error}</p>
      )}

      {pendingImage && (
        <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-3 py-2">
          <Camera className="h-4 w-4 text-[var(--color-primary)]" />
          <img
            src={pendingImage.dataUrl}
            alt=""
            className="h-12 w-16 rounded border border-[var(--color-border)] object-cover"
          />
          <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-muted)]">
            {pendingImage.name}
          </span>
          <button
            type="button"
            aria-label="Remove image"
            onClick={() => setPendingImage(null)}
            className="rounded p-1 text-[var(--color-subtle)] hover:text-[var(--color-fg)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="border-t border-[var(--color-border)] p-3">
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => fileRef.current?.click()}
            title="Attach TradeZella chart screenshot"
            className="shrink-0"
          >
            <ImagePlus className="h-4 w-4" />
            Chart
          </Button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Paste TradeZella stats or describe the chart… (Enter to send)"
            className="min-h-[44px] flex-1 resize-y rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
          />
          <Button
            type="button"
            size="sm"
            disabled={busy || (!text.trim() && !pendingImage)}
            onClick={() => void send()}
            className="shrink-0"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Analyze
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] text-[var(--color-subtle)]">
          Tip: paste e.g. “WR 64.3% · 14 trades · $2500 · MNQ · NY AM · bullish HTF ·
          sellside sweep + IFVG” with a chart for the fullest setup card.
        </p>
      </div>
    </section>
  );
}
