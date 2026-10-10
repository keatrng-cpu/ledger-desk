/**
 * A hand-off between tabs: "show me this part of the Floor". The Predict tab's analyzer can open the Floor looking into the Mead Hall,
 * where the five study the same board. The camera name rides in sessionStorage for one read (the Floor takes it on mount), and the
 * existing `ledger:open-tab` event switches the tab. Presentation only.
 */

const KEY = "ledger.floor.camera";

export function openFloorAt(camera: string): void {
  try {
    window.sessionStorage.setItem(KEY, camera);
  } catch {
    /* private window: the Floor still opens, on its own camera */
  }
  window.dispatchEvent(new CustomEvent("ledger:open-tab", { detail: "floor" }));
}

const FOCUS_KEY = "ledger.predict.focus";

/** Open the Predict tab on one market's desk panel (a tap on a hall screen in the Floor). Paper only: it opens a panel, nothing more. */
export function openPredictAt(marketId: string): void {
  try {
    window.sessionStorage.setItem(FOCUS_KEY, marketId);
  } catch {
    /* the tab still opens, on its own */
  }
  window.dispatchEvent(new CustomEvent("ledger:open-tab", { detail: "predict" }));
}

/** The market another tab asked the analyzer to open, once. */
export function takePredictFocus(): string | null {
  try {
    const v = window.sessionStorage.getItem(FOCUS_KEY);
    if (v) window.sessionStorage.removeItem(FOCUS_KEY);
    return v || null;
  } catch {
    return null;
  }
}

/** The camera another tab asked for, once. Only the Mead Hall's names are honoured. */
export function takeFloorCamera(): string | null {
  try {
    const v = window.sessionStorage.getItem(KEY);
    if (!v) return null;
    window.sessionStorage.removeItem(KEY);
    return v === "mead" || v.startsWith("mead_") ? v : null;
  } catch {
    return null;
  }
}
