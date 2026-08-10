# INTEGRATION-P1 — Journal + active risk governor

Wiring instructions for the integrator. Phase 1 did NOT touch
`src/routes/index.tsx`, `src/lib/trading/**`, `src/lib/market/**`, or any desk
component except `src/components/desk/risk-panel.tsx` (owned by this phase).

## What shipped

| Path | Role |
|------|------|
| `migrations/0002_journal.sql` | `desk_trades`, `desk_events`, `desk_settings` (snake_case, user-scoped) |
| `src/lib/journal/server.ts` | Server fns: `openTrade`, `closeTrade`, `listTrades`, `logEvent`, `listEvents`, `getRiskState`, `getSettings`, `updateEquity` (all behind `authMiddleware`, zod-validated, parameterized SQL) |
| `src/lib/journal/risk.ts` | Pure ET-calendar math (`tradingDayStart` 18:00 ET, `tradingWeekStart` Sun 18:00 ET, `currentKillzoneWindow`) + `RiskState` type + `computeRiskFlags` |
| `src/components/journal/journal-panel.tsx` | `JournalPanel` — metrics header (computeMetrics over real closed trades, n<100 badge), open-trade close forms, closed-trade table, inline equity editor |
| `src/components/journal/log-setup-dialog.tsx` | `LogSetupDialog` — prefilled from a `SetupCandidate`, $risk vs allowed (equity x 0.5%) with oversized warning |
| `src/components/journal/halt-banner.tsx` | `HaltBanner` — red on daily/weekly halt, amber on killzone cap |
| `src/components/desk/risk-panel.tsx` | Now self-fetches `getRiskState` (poll 30s): day/week PnL progress bars vs −2%/−5% limits, entries-this-killzone chip, open-trades count. Static rules rows kept. No prop changes — existing `<RiskPanel desk={desk} />` call sites keep working untouched. |

## 1 · Mount in `src/routes/index.tsx`

State to add in `MasterplacePage`:

```tsx
import { useState, useCallback, useEffect } from "react";
import { HaltBanner } from "@/components/journal/halt-banner";
import { JournalPanel } from "@/components/journal/journal-panel";
import { LogSetupDialog } from "@/components/journal/log-setup-dialog";
import { getRiskState, getSettings } from "@/lib/journal/server";
import type { RiskState } from "@/lib/journal/risk";
import type { SetupCandidate } from "@/lib/trading/scanner";

const [risk, setRisk] = useState<RiskState | null>(null);
const [equity, setEquity] = useState(10_000);
const [logCandidate, setLogCandidate] = useState<SetupCandidate | null>(null);

const loadRisk = useCallback(async () => {
  try {
    const [rs, s] = await Promise.all([getRiskState(), getSettings()]);
    setRisk(rs);
    setEquity(s.equity);
  } catch { /* signed-out / preview — banner simply hidden */ }
}, []);
useEffect(() => { void loadRisk(); }, [loadRisk]);
// Optionally piggyback on the existing DESK_POLL_MS interval by calling
// loadRisk() inside the same `load` callback that fetches the desk.
```

Placement:

- **HaltBanner** — directly under `<SessionHud …/>` (before the section nav) so
  it is the first thing seen: `{risk && <HaltBanner risk={risk} />}`.
- **JournalPanel** — new section between `#liquidity` and the `#risk` grid
  (suggested anchor `#journal`, nav label "5 Journal", renumber later sections
  or leave numbering as-is): `<div id="journal"><JournalPanel onChanged={() => void loadRisk()} /></div>`.
  `onChanged` fires after a close/equity save so the banner + risk panel stay
  fresh.
- **LogSetupDialog** — mount once at page level:

```tsx
{logCandidate && (
  <LogSetupDialog
    candidate={logCandidate}
    equity={equity}
    killzone={desk?.clock.killzone}
    open={!!logCandidate}
    onOpenChange={(o) => !o && setLogCandidate(null)}
    onLogged={() => void loadRisk()}
  />
)}
```

## 2 · Trigger on scanner cards (`src/components/desk/setup-scanner.tsx`)

Add an optional callback prop so the desk stays decoupled:

```tsx
export function SetupScanner({ scan, onLog }: { scan: ScanResult; onLog?: (c: SetupCandidate) => void })
```

Inside `SetupCard`, next to the "actionable" pill, render a small
`<Button size="sm" variant="secondary" onClick={() => onLog?.(c)}>Log setup</Button>`
(only when `c.actionable`, or always — journaling skips is also valuable).
Then in index.tsx: `<SetupScanner scan={desk.scan} onLog={setLogCandidate} />`.

## 3 · build-desk checklist "risk" item + scanner suppression

`build-desk.ts` currently hardcodes `{ id: "risk", ok: true }`. It runs
server-side, so it can call the risk computation directly — but it has NO user
context (it's called from the page without auth middleware). Two options:

- **Preferred (no build-desk change):** compute suppression client-side in
  index.tsx from the `risk` state above: a candidate is displayed
  non-actionable when `risk.dailyHaltHit || risk.weeklyHaltHit ||
  risk.killzoneCapHit`. Pass a `suppressed: boolean` prop into `SetupScanner`
  and grey out / disable the Log button; the checklist "risk" row detail can be
  overridden the same way.
- **Alternative (server-side):** add `.middleware([authMiddleware])` to
  `fetchTradingDesk`, then inside the handler reuse the same aggregate the
  journal uses — import `tradingDayStart`, `tradingWeekStart`,
  `currentKillzoneWindow`, `computeRiskFlags` from `@/lib/journal/risk` and run
  the one aggregate query from `getRiskState` (copy it, or export a
  `readRiskState(sql, userId, now)` helper — ask P1 owner to extract it if you
  take this path). Set `checklist.risk.ok = !dailyHaltHit && !weeklyHaltHit &&
  !killzoneCapHit` and force `candidate.actionable = false` when halted.

Suppression rule either way:
`entryAllowed = !risk.dailyHaltHit && !risk.weeklyHaltHit && !risk.killzoneCapHit`.

## 4 · Props contracts (stable — other phases code against these)

```ts
// halt-banner
HaltBanner: { risk: RiskState }            // renders null when no gate active

// journal-panel
JournalPanel: { onChanged?: () => void }   // fully self-fetching

// log-setup-dialog
LogSetupDialog: {
  candidate: SetupCandidate;               // from src/lib/trading/scanner
  equity: number;                          // from getSettings()
  killzone?: string;                       // desk.clock.killzone
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogged?: (trade: JournalTrade) => void;
}

// risk state (src/lib/journal/risk.ts)
RiskState: {
  equity, dayPnl, weekPnl, dailyLimit, weeklyLimit,        // dollars
  dailyHaltHit, weeklyHaltHit,                             // pnl <= -limit
  killzone, killzoneLabel, entriesThisKillzone,
  killzoneCap /* =2 */, killzoneCapHit,
  openTrades, dayStartUtc, weekStartUtc                    // ISO audit
}
```

## 5 · Server-fn call shapes

```ts
await openTrade({ data: { symbol: "MNQ", side: "long", entry: 18250, stop: 18230,
  target: 18300, contracts: 2, mode: "live", source: "desk", prescore: 0.78,
  grade: "A+", killzone: "ny_am", componentsPresent: [...], componentsMissing: [...] } });
await closeTrade({ data: { id, exit: 18290, slippage: 1.5, reason: "TP1" } });
await listTrades({ data: { status: "closed", limit: 200, offset: 0 } });  // newest first
await listEvents({ data: { limit: 50, offset: 0 } });                     // newest first
await logEvent({ data: { event: "SKIP", symbol: "ES", prescore: 0.44, reason: "below floor" } });
await getRiskState();  await getSettings();
await updateEquity({ data: { equity: 12000 } });
```

Notes:
- PnL is NET: `(exit-entry)*pointValue*contracts*dir − commission*contracts − slippage`;
  commission comes from `CONTRACTS[symbol]` (ES/NQ $4, MES/MNQ $1 per contract).
  `r = pnl / (|entry−stop| * pointValue * contracts)`; `r` is null when the
  trade had no stop.
- Symbol whitelist = `keyof CONTRACTS` (`ES | NQ | MES | MNQ`).
- Halt PnL windows count ALL closed trades (live + paper). If paper trades
  should not burn the live loss limit, add `and mode = 'live'` to the day/week
  filters in `getRiskState` — flagged as an open decision, not silently chosen.
- `getRiskState` does not gate `openTrade` server-side; the governor is
  surfaced state + UI suppression. Add a server-side block in `openTrade` if a
  later phase wants hard enforcement.
