/**
 * A heartbeat that keeps the desk's live loops running when the Chrome tab is in the background.
 *
 * WHY: the quote poll, the desk rebuild, the room's 5-second tick, the paper book's stop manager and auto paper were all timers on the
 * page (setTimeout / setInterval), and four of them also returned early when `document.visibilityState` was not "visible". So a trader
 * on another Chrome tab got no new quotes, no new cards at the candle close, no Stand / stop / 11:00-flat checks, until they came back.
 * Chrome also clamps a hidden tab's timers to once a second and, after five minutes hidden, to once a minute, and it can freeze a hidden
 * tab altogether.
 *
 * HOW: one dedicated worker posts a message every second. A worker's timer is not clamped the way the page's is, and its message
 * arrives as an ordinary task. A shared Web Lock is held for the life of the page, which is what keeps Chrome from freezing a hidden tab.
 * Loops subscribe with `onBeat`; each one still decides for itself whether it is due (so a foreground tab does no extra work).
 *
 * If a worker cannot be made (no Worker, a blocking policy) the beat is a plain 1 s interval: the same behaviour in the foreground, and
 * the old throttling in the background. Nothing here touches a rule, a gate, a size or an order.
 *
 * What it cannot do: draw the 3D floor or speak the voices (those exist only while the Floor tab is open), or run if the browser is
 * closed or the computer sleeps. The server's `room-step` function covers the paper book every five minutes in the NY session.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let started = false;
let worker: Worker | null = null;
let fallbackId: number | null = null;

function fire(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* one subscriber must never stop the others */
    }
  }
}

function startLock(): void {
  try {
    const locks = (typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined) ?? null;
    // Never resolved: the lock is held for as long as the page lives.
    void locks?.request("ledger-desk-live", { mode: "shared" }, () => new Promise<void>(() => {}))?.catch(() => {});
  } catch {
    /* no Web Locks: the beat still runs */
  }
}

function startInterval(): void {
  if (fallbackId == null) fallbackId = window.setInterval(fire, 1000);
}

function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  startLock();
  try {
    const url = URL.createObjectURL(new Blob(["setInterval(function(){postMessage(0)},1000)"], { type: "text/javascript" }));
    const w = new Worker(url);
    worker = w;
    w.onmessage = fire;
    w.onerror = () => {
      // Blocked or failed after construction: fall back to the page's own timer, once.
      w.terminate();
      if (worker === w) worker = null;
      startInterval();
    };
  } catch {
    startInterval();
  }
}

/**
 * Call `fn` about every `everyBeats` seconds, in the foreground and the background alike. Returns the unsubscribe.
 * `fn` must be cheap when nothing is due: it is called whether or not the tab is visible.
 */
export function onBeat(fn: Listener, everyBeats = 1): () => void {
  let n = 0;
  const l: Listener = () => {
    n += 1;
    if (n >= everyBeats) {
      n = 0;
      fn();
    }
  };
  listeners.add(l);
  start();
  return () => {
    listeners.delete(l);
  };
}

/** For tests and hot reload: stop the worker / interval and forget every subscriber. */
export function stopKeepLive(): void {
  listeners.clear();
  if (worker) {
    worker.terminate();
    worker = null;
  }
  if (fallbackId != null && typeof window !== "undefined") {
    window.clearInterval(fallbackId);
    fallbackId = null;
  }
  started = false;
}
