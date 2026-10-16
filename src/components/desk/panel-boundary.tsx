import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportPanelError } from "@/lib/notify/browser-errors";

/**
 * One panel's render crash must not blank the whole tab.
 *
 * 2026-10-16 08:52 CT: a `.toUpperCase()` on undefined threw inside the Now
 * tab. With no boundary React unmounted the entire tree and the tab went white
 * during market hours.
 * Each Now panel is wrapped in this so the failure stays inside its own box.
 */
export class PanelBoundary extends Component<
  { name: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[PanelBoundary] ${this.props.name} crashed`, error, info.componentStack);
    reportPanelError(this.props.name, error, info.componentStack ?? undefined);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          data-panel-error={this.props.name}
          className="rounded border border-[var(--color-down)] px-3 py-2 text-[11px] text-[var(--color-muted)]"
        >
          {this.props.name} failed to render — the rest of the tab is live.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => this.setState({ error: null })}
          >
            retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
