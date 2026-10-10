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
