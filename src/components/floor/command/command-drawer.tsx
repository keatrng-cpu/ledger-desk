/**
 * Right-side drawer embedding a tab's main panel (lazy-loaded).
 * Heavy work is paused while the drawer is closed (unmounted) so the 3D Floor
 * framerate is not taxed. Display only — Open full tab routes away.
 */
import { lazy, Suspense, useEffect } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { COMMAND_CARDS, type CommandTabId } from "./types";

const NewsTab = lazy(() =>
  import("@/components/news/news-tab").then((m) => ({ default: m.NewsTab })),
);
const OptionsSwingPanel = lazy(() =>
  import("@/components/desk/options-swing-panel").then((m) => ({ default: m.OptionsSwingPanel })),
);
const DualIndexCharts = lazy(() =>
  import("@/components/dashboard/dual-index-charts").then((m) => ({ default: m.DualIndexCharts })),
);
const VeteranBrainPanel = lazy(() =>
  import("@/components/desk/veteran-brain").then((m) => ({ default: m.VeteranBrainPanel })),
);
const PredictTab = lazy(() =>
  import("@/components/predict/predict-tab").then((m) => ({ default: m.PredictTab })),
);
const ShadowBookPanel = lazy(() =>
  import("@/components/desk/shadow-book-panel").then((m) => ({ default: m.ShadowBookPanel })),
);
const RiskPanel = lazy(() =>
  import("@/components/desk/risk-panel").then((m) => ({ default: m.RiskPanel })),
);
const DiscussTab = lazy(() =>
  import("@/components/desk/discuss-tab").then((m) => ({ default: m.DiscussTab })),
);
const LearnTab = lazy(() =>
  import("@/components/learn/learn-tab").then((m) => ({ default: m.LearnTab })),
);

function Fallback() {
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-[var(--color-muted)]">
      <Loader2 className="h-4 w-4 animate-spin text-[var(--color-primary)]" />
      Loading panel…
    </div>
  );
}

function NeedDesk({ label }: { label: string }) {
  return (
    <p className="p-4 text-[12px] text-[var(--color-muted)]">
      {label} needs a live desk payload — waiting for the next refresh.
    </p>
  );
}

function PanelBody({
  id,
  desk,
}: {
  id: CommandTabId;
  desk: DeskPayload | null;
}) {
  switch (id) {
    case "news":
      return <NewsTab />;
    case "swing":
      return desk ? <OptionsSwingPanel desk={desk} /> : <NeedDesk label="Options" />;
    case "tape":
      return <DualIndexCharts desk={desk} />;
    case "brain":
      return desk ? <VeteranBrainPanel desk={desk} /> : <NeedDesk label="Brain" />;
    case "predict":
      return <PredictTab />;
    case "path":
      return <ShadowBookPanel mode="full" />;
    case "lab":
      return desk ? <RiskPanel desk={desk} /> : <NeedDesk label="Lab" />;
    case "discuss":
      return desk ? <DiscussTab desk={desk} /> : <NeedDesk label="Discuss" />;
    case "learn":
      return desk ? <LearnTab desk={desk} /> : <NeedDesk label="Learn" />;
    default:
      return null;
  }
}

export function CommandDrawer({
  openId,
  desk,
  onClose,
}: {
  openId: CommandTabId | null;
  desk: DeskPayload | null;
  onClose: () => void;
}) {
  const open = openId != null;
  const def = COMMAND_CARDS.find((c) => c.id === openId) ?? null;

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const openFull = () => {
    if (!def) return;
    window.dispatchEvent(new CustomEvent("ledger:open-tab", { detail: def.openTab }));
    onClose();
  };

  return (
    <>
      {/* Scrim — click to close; does not block the 3D canvas pointer when closed */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        aria-hidden={!open}
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal={open}
        aria-hidden={!open}
        aria-label={def ? `${def.label} panel` : "Command drawer"}
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-[var(--color-border)] bg-[var(--color-bg)] shadow-xl transition-transform duration-200 sm:max-w-lg ${
          open ? "translate-x-0" : "translate-x-full pointer-events-none"
        }`}
      >
        <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
          <h3 className="text-sm font-semibold text-[var(--color-fg)]">{def?.label ?? "Panel"}</h3>
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-fg)] hover:border-[var(--color-primary)]"
            onClick={openFull}
            disabled={!def}
          >
            <ExternalLink className="h-3 w-3" /> Open full tab
          </button>
          <button
            type="button"
            className="rounded border border-[var(--color-border)] p-1 text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-fg)]"
            onClick={onClose}
            aria-label="Close drawer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>
        {/* Unmount when closed so polls / charts / 3D inside panels stop. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {openId && (
            <Suspense fallback={<Fallback />}>
              <PanelBody id={openId} desk={desk} />
            </Suspense>
          )}
        </div>
      </aside>
    </>
  );
}
